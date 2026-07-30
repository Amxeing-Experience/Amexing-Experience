/**
 * PublicReservationController - Handles public reservation viewing without authentication.
 * Mirrors PublicQuoteController but for Reservation + ReservationService records.
 * Folio acts as access token (e.g. MAY-2605-001).
 * Created by Denisse Maldonado.
 * @version 1.0.0
 */

const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');
const FileStorageService = require('../services/FileStorageService');
const PaymentService = require('../services/PaymentService');
const { renderUrlToPdf } = require('../services/PdfRenderService');
const { getArponaEmbedCss, getMyriadEmbedCss } = require('../../infrastructure/utils/fontEmbed');

const fileStorageService = new FileStorageService({
  baseFolder: 'general',
  isPublic: false,
  presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
});

/**
 * Controller for viewing reservations publicly without authentication, where the
 * folio (e.g. MAY-2605-001) acts as the access token. Mirrors PublicQuoteController
 * but operates on Reservation and ReservationService records, including itinerary
 * rendering and PDF export.
 * @example
 *   const controller = new PublicReservationController();
 *   router.get('/reservations/:folio', controller.viewPublicReservation);
 */
class PublicReservationController {
  constructor() {
    this.viewPublicReservation = this.viewPublicReservation.bind(this);
    this.viewReservationItinerary = this.viewReservationItinerary.bind(this);
    this.downloadReservationPdf = this.downloadReservationPdf.bind(this);
    this.preparePublicReservationData = this.preparePublicReservationData.bind(this);

    this.experiencesCache = null;
    this.providerExperiencesCache = null;
    this.cacheLoadPromise = null;
  }

  /**
   * Download reservation as PDF via headless Chrome (puppeteer).
   * GET /reservations/:folio/pdf.
   * @param req
   * @param res
   * @example
   */
  async downloadReservationPdf(req, res) {
    const { folio } = req.params;
    try {
      const folioError = this.validateFolio(folio, req, res);
      if (folioError) return folioError;

      const reservation = await this.fetchReservationByFolio(folio, req, res);
      if (!reservation) return;

      const proto = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.get('host');
      const url = `${proto}://${host}/reservations/${encodeURIComponent(folio)}/itinerary?pdf=1`;

      // Full-bleed: header reaches the page edges; per-page top spacing comes from the template, not the margin.
      const pdfBuffer = await renderUrlToPdf(url, {
        footer: false,
        margin: {
          top: '0', bottom: '0', left: '0', right: '0',
        },
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${folio}.pdf"`);
      return res.end(pdfBuffer);
    } catch (error) {
      logger.error('Failed to render reservation PDF', {
        folio, error: error.message, stack: error.stack,
      });
      return res.status(500).json({ success: false, error: 'Error al generar el PDF' });
    }
  }

  /**
   * View public reservation by folio.
   * GET /reservations/:folio.
   * @param req
   * @param res
   * @example
   */
  async viewPublicReservation(req, res) {
    const { folio } = req.params;
    try {
      const folioError = this.validateFolio(folio, req, res);
      if (folioError) return folioError;

      const reservation = await this.fetchReservationByFolio(folio, req, res);
      if (!reservation) return;

      const services = await this.fetchReservationServices(reservation);
      this.logPublicAccess(reservation, req);

      const quoteShaped = await this.preparePublicReservationData(reservation, services);
      await this.injectServiceImages(quoteShaped);

      return res.render('dashboards/admin/reservation-public', {
        quote: quoteShaped,
        isPublicView: true,
        isReservationView: true,
        pageTitle: `Reservación ${folio}`,
        arponaEmbedCss: getArponaEmbedCss(),
        myriadEmbedCss: getMyriadEmbedCss(),
      });
    } catch (error) {
      return this.handleError(error, folio, req, res);
    }
  }

  /**
   * View reservation as a travel-itinerary page (rendered to PDF via ?pdf=1).
   * GET /reservations/:folio/itinerary.
   * @param req
   * @param res
   * @example
   */
  async viewReservationItinerary(req, res) {
    const { folio } = req.params;
    try {
      const folioError = this.validateFolio(folio, req, res);
      if (folioError) return folioError;

      const reservation = await this.fetchReservationByFolio(folio, req, res);
      if (!reservation) return;

      const services = await this.fetchReservationServices(reservation);
      this.logPublicAccess(reservation, req);

      const quoteShaped = await this.preparePublicReservationData(reservation, services);
      await this.injectServiceImages(quoteShaped);

      return res.render('dashboards/admin/reservation-itinerary', {
        quote: quoteShaped,
        isPublicView: true,
        isReservationView: true,
        pageTitle: `Itinerario ${folio}`,
        arponaEmbedCss: getArponaEmbedCss(),
        myriadEmbedCss: getMyriadEmbedCss(),
      });
    } catch (error) {
      return this.handleError(error, folio, req, res);
    }
  }

  // ===== Helpers =====

  /**
   * Validate the reservation folio format. Renders a 400 page on mismatch.
   * @param {string} folio - Reservation folio (MMM-YYMM-NNN).
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {object|null} The response object if invalid, null when valid.
   * @example
   *   if (this.validateFolio(folio, req, res)) return;
   */
  validateFolio(folio, req, res) {
    // Reservation folio: MMM-YYMM-NNN (e.g. MAY-2605-001)
    const folioRegex = /^[A-Z]{3}-\d{4}-\d{3}$/;
    if (!folioRegex.test(folio)) {
      logger.warn('Invalid reservation folio format for public access', {
        folio, ip: req.ip,
      });
      res.status(400).render('errors/error', {
        status: 400,
        title: 'Folio Inválido',
        message: 'El formato del folio de reservación no es válido.',
      });
      return res;
    }
    return null;
  }

  /**
   * Fetch the Reservation Parse object by folio. Renders a 404 if not found.
   * @param {string} folio - Reservation folio.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<object|null>} Reservation Parse object or null when not found.
   * @example
   *   const reservation = await this.fetchReservationByFolio(folio, req, res);
   */
  async fetchReservationByFolio(folio, req, res) {
    const query = new Parse.Query('Reservation');
    query.equalTo('folio', folio);
    query.equalTo('exists', true);
    query.include('quotePtr');
    query.include('clientPtr');
    query.include('serviceCustomer');
    query.include('createdBy');
    const reservation = await query.first({ useMasterKey: true });
    if (!reservation) {
      logger.warn('Reservation not found for public access', { folio, ip: req.ip });
      res.status(404).render('errors/404', { message: 'Reservación no encontrada' });
      return null;
    }
    return reservation;
  }

  /**
   * Fetch all active ReservationService records for the given reservation, with
   * assignedDriver / assignedGuide / assignedGreeter / assignedVehicle / assignedServiceCustomer
   * pointers included.
   * @param {object} reservation - Reservation Parse object.
   * @returns {Promise<Array>} Array of ReservationService Parse objects sorted by dayNumber + time.
   * @example
   *   const services = await this.fetchReservationServices(reservation);
   */
  async fetchReservationServices(reservation) {
    const q = new Parse.Query('ReservationService');
    q.equalTo('reservationPtr', reservation);
    q.equalTo('active', true);
    q.equalTo('exists', true);
    q.include('assignedDriver');
    q.include('assignedGuide');
    q.include('assignedGreeter');
    q.include('assignedVehicle');
    q.include('assignedServiceCustomer');
    q.ascending('dayNumber');
    q.addAscending('time');
    q.limit(1000);
    return q.find({ useMasterKey: true });
  }

  /**
   * Format an AmexingUser Parse object into a public-safe person object.
   * @param parseUser
   * @example
   */
  formatPerson(parseUser) {
    if (!parseUser) return null;
    const firstName = parseUser.get('firstName') || '';
    const lastName = parseUser.get('lastName') || '';
    const fullName = parseUser.get('fullName')
      || `${firstName} ${lastName}`.trim()
      || parseUser.get('username')
      || '';
    return {
      id: parseUser.id,
      fullName,
      firstName,
      lastName,
      email: parseUser.get('email') || '',
      phone: parseUser.get('phone') || '',
      profilePhotoUrl: parseUser.get('profilePhotoUrl') || '',
    };
  }

  /**
   * Format a Vehicle Parse object + image map lookup into a public-safe vehicle object.
   * @param parseVehicle
   * @param vehicleImageMap
   * @example
   */
  formatVehicle(parseVehicle, vehicleImageMap = {}) {
    if (!parseVehicle) return null;
    const brand = parseVehicle.get('brand') || '';
    const model = parseVehicle.get('model') || '';
    return {
      id: parseVehicle.id,
      name: `${brand} ${model}`.trim() || parseVehicle.get('name') || '',
      brand,
      model,
      plate: parseVehicle.get('plate') || parseVehicle.get('licensePlate') || '',
      color: parseVehicle.get('color') || '',
      year: parseVehicle.get('year') || '',
      imageUrl: vehicleImageMap[parseVehicle.id] || '',
    };
  }

  /**
   * Build a map of Vehicle id -> primary image URL for the given list of services.
   * Mirrors the logic in ReservationController.getReservationById.
   * @param services
   * @example
   */
  async buildVehicleImageMap(services) {
    const vehicleIds = [];
    for (const svc of services) {
      const vid = svc.get('assignedVehicle')?.id;
      if (vid) vehicleIds.push(vid);
      const extras = svc.get('extraAssignments') || [];
      extras.forEach((ea) => { if (ea.vehicleId) vehicleIds.push(ea.vehicleId); });
    }
    const unique = [...new Set(vehicleIds)];
    const map = {};
    if (unique.length === 0) return map;
    try {
      const Vehicle = Parse.Object.extend('Vehicle');
      const pointers = unique.map((vid) => Vehicle.createWithoutData(vid));
      let imgs;
      const q1 = new Parse.Query('VehicleImage');
      q1.containedIn('vehicleId', pointers);
      q1.equalTo('isPrimary', true);
      q1.equalTo('exists', true);
      imgs = await q1.find({ useMasterKey: true });
      if (imgs.length === 0) {
        const q2 = new Parse.Query('VehicleImage');
        q2.containedIn('vehicleId', pointers);
        q2.equalTo('exists', true);
        q2.ascending('displayOrder');
        imgs = await q2.find({ useMasterKey: true });
      }
      const formatPriority = ['avif', 'webp', 'jpeg'];
      await Promise.all(imgs.map(async (img) => {
        const vid = img.get('vehicleId')?.id;
        if (!vid || map[vid]) return;
        let url = '';
        const variants = img.get('optimizedVariants');
        const s3Key = img.get('s3Key');
        if (variants && typeof variants === 'object') {
          for (const fmt of formatPriority) {
            if (variants[fmt]?.s3Key) {
              try {
                url = await fileStorageService.getPresignedUrl(variants[fmt].s3Key);
                break;
              } catch (e) { /* continue */ }
            }
          }
        }
        if (!url && s3Key) {
          try { url = await fileStorageService.getPresignedUrl(s3Key); } catch (e) { /* continue */ }
        }
        if (!url && s3Key) {
          const bucket = img.get('s3Bucket');
          const region = img.get('s3Region');
          if (bucket && region) url = `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`;
        }
        if (!url) {
          const f = img.get('imageFile');
          if (f && typeof f.url === 'function') url = f.url();
          else url = img.get('url') || '';
        }
        if (url) map[vid] = url;
      }));
    } catch (err) {
      logger.warn('PublicReservationController: failed to build vehicle image map', { error: err.message });
    }
    return map;
  }

  /**
   * Resolve extra assignments by fetching driver / vehicle records they reference.
   * Returns an array of { driver, vehicle, segmentName, segmentColor, vehicleTypeName }.
   * @param extras
   * @param vehicleImageMap
   * @example
   */
  async resolveExtraAssignments(extras, vehicleImageMap) {
    if (!Array.isArray(extras) || extras.length === 0) return [];
    const driverIds = extras.map((e) => e.driverId).filter(Boolean);
    const vehicleIds = extras.map((e) => e.vehicleId).filter(Boolean);

    const [driversMap, vehiclesMap] = await Promise.all([
      this.fetchUsersByIds([...new Set(driverIds)]),
      this.fetchVehiclesByIds([...new Set(vehicleIds)]),
    ]);

    return extras.map((ea) => ({
      vehicleTypeId: ea.vehicleTypeId || '',
      vehicleName: ea.vehicleName || '',
      segmentId: ea.segmentId || '',
      segmentName: ea.segmentName || '',
      segmentColor: ea.segmentColor || '',
      driver: ea.driverId ? this.formatPerson(driversMap.get(ea.driverId)) : null,
      vehicle: ea.vehicleId ? this.formatVehicle(vehiclesMap.get(ea.vehicleId), vehicleImageMap) : null,
    }));
  }

  /**
   * Fetch AmexingUser records by ID and return them as a Map keyed by id.
   * @param {string[]} ids - Array of AmexingUser object IDs to fetch.
   * @returns {Promise<Map<string, object>>} Map of id -> Parse user object.
   * @example
   *   const users = await this.fetchUsersByIds(['abc123', 'def456']);
   */
  async fetchUsersByIds(ids) {
    const map = new Map();
    if (!ids || ids.length === 0) return map;
    try {
      const q = new Parse.Query('AmexingUser');
      q.containedIn('objectId', ids);
      const users = await q.find({ useMasterKey: true });
      users.forEach((u) => map.set(u.id, u));
    } catch (err) {
      logger.warn('PublicReservationController: failed to fetch users by ids', { error: err.message });
    }
    return map;
  }

  /**
   * Fetch Vehicle records by ID and return them as a Map keyed by id.
   * @param {string[]} ids - Array of Vehicle object IDs to fetch.
   * @returns {Promise<Map<string, object>>} Map of id -> Parse vehicle object.
   * @example
   *   const vehicles = await this.fetchVehiclesByIds(['abc123']);
   */
  async fetchVehiclesByIds(ids) {
    const map = new Map();
    if (!ids || ids.length === 0) return map;
    try {
      const q = new Parse.Query('Vehicle');
      q.containedIn('objectId', ids);
      const vehicles = await q.find({ useMasterKey: true });
      vehicles.forEach((v) => map.set(v.id, v));
    } catch (err) {
      logger.warn('PublicReservationController: failed to fetch vehicles by ids', { error: err.message });
    }
    return map;
  }

  /**
   * Audit-log a public reservation view access.
   * @param {object} reservation - Reservation Parse object.
   * @param {object} req - Express request.
   * @returns {void}
   * @example
   *   this.logPublicAccess(reservation, req);
   */
  logPublicAccess(reservation, req) {
    logger.info('Public reservation accessed', {
      reservationId: reservation.id,
      folio: reservation.get('folio'),
      ip: req.ip,
      userAgent: req.get('user-agent'),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Render a 500 error page when something blows up during public reservation handling.
   * @param {Error} error - The thrown error.
   * @param {string} folio - The folio that was being processed.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {object} Express response.
   * @example
   *   return this.handleError(err, folio, req, res);
   */
  handleError(error, folio, req, res) {
    logger.error('Error rendering public reservation', {
      error: error.message, stack: error.stack, folio, ip: req.ip,
    });
    return res.status(500).render('errors/error', {
      status: 500,
      title: 'Error del Servidor',
      message: 'Error al cargar la reservación. Por favor intente nuevamente.',
      error: process.env.NODE_ENV === 'development' ? error : undefined,
    });
  }

  /**
   * Load Rate id → { name, color } map for segment enrichment on legacy subconcepts.
   * @example
   */
  async loadSegmentNamesMap() {
    try {
      const query = new Parse.Query('Rate');
      query.equalTo('exists', true);
      query.limit(1000);
      const rates = await query.find({ useMasterKey: true });
      const map = new Map();
      rates.forEach((r) => map.set(r.id, {
        name: r.get('name') || '',
        color: r.get('color') || '',
      }));
      return map;
    } catch (error) {
      logger.warn('PublicReservationController: failed to load segment names map', {
        error: error.message,
      });
      return new Map();
    }
  }

  /**
   * Build the quote-shaped payload that quote-summary.ejs + the unified renderer expects.
   * Reservations don't carry a day grouping by default — we derive it from each
   * ReservationService's dayNumber + serviceDate.
   * @param reservation
   * @param services
   * @example
   */
  async preparePublicReservationData(reservation, services) {
    const segmentNames = await this.loadSegmentNamesMap();
    const vehicleImageMap = await this.buildVehicleImageMap(services);
    const client = reservation.get('clientPtr');
    const snapshot = reservation.get('serviceItemsSnapshot') || {};

    // Group services by dayNumber (preserve original day ordering)
    const dayBuckets = new Map();
    for (const svc of services) {
      const dayNumber = svc.get('dayNumber') || 1;
      if (!dayBuckets.has(dayNumber)) {
        dayBuckets.set(dayNumber, {
          dayNumber,
          dayTitle: '',
          date: '',
          city: '',
          services: [],
        });
      }
      dayBuckets.get(dayNumber).services.push(svc);
    }

    // Pull dayTitle/city/date from snapshot.days when available
    if (Array.isArray(snapshot.days)) {
      for (const snapDay of snapshot.days) {
        const bucket = dayBuckets.get(snapDay.dayNumber);
        if (bucket) {
          bucket.dayTitle = snapDay.dayTitle || snapDay.title || '';
          bucket.date = snapDay.date || '';
          bucket.city = snapDay.city || '';
        }
      }
    }

    // If a bucket still has no date, fall back to the first service's serviceDate
    for (const bucket of dayBuckets.values()) {
      if (!bucket.date && bucket.services.length > 0) {
        const first = bucket.services[0];
        const serviceDate = first.get('serviceDate');
        if (serviceDate) {
          bucket.date = serviceDate instanceof Date
            ? serviceDate.toISOString().split('T')[0]
            : String(serviceDate).split('T')[0];
        }
      }
    }

    // Build days[] sorted by dayNumber
    const sortedDays = [...dayBuckets.values()].sort((a, b) => a.dayNumber - b.dayNumber);
    const days = await Promise.all(sortedDays.map(async (bucket) => {
      const subconcepts = await Promise.all(
        bucket.services.map((svc) => this.formatServiceAsSubconcept(svc, segmentNames, vehicleImageMap))
      );
      return {
        id: `day_${bucket.dayNumber}`,
        dayNumber: bucket.dayNumber,
        title: bucket.dayTitle,
        dayTitle: bucket.dayTitle,
        date: bucket.date,
        city: bucket.city,
        description: '',
        subconcepts,
      };
    }));

    // Totales por método de pago (misma fuente de verdad que PaymentService): se cobra
    // pricesByType[paymentType], el valor ya calculado y aprobado por la cotización.
    const paymentType = reservation.get('paymentType') || snapshot.paymentType || 'efectivo';
    const currency = reservation.get('currency') || snapshot.currency || 'MXN';

    const totalItems = [];
    for (const day of days) {
      for (const sc of day.subconcepts) {
        // discountAmount es obligatorio: chargeAmount lo resta del bruto; sin él la vista pública y el
        // PDF (misma construcción, ambos vía este método) mostraban el precio sin descuento. Alimenta
        // dispTotals (Subtotal/Total de la vista) Y methodTotals (desglose por método) por igual.
        totalItems.push({
          includeInTotal: sc.includeInTotal,
          pricesByType: sc.pricesByType,
          total: sc.total,
          discountAmount: sc.discountAmount,
        });
      }
    }
    // Servicios solos (sin ajustes) para el desglose Subtotal/recargo/Total de la vista.
    const dispTotals = PaymentService.computeTotals(totalItems, paymentType, 0, currency);
    const { subtotal } = dispTotals; // base (efectivo)
    const { iva } = dispTotals; // recargo por método (IVA, o IVA + comisión de tarjeta)
    const total = dispTotals.servicesTotal; // base × factor

    // Framing por tipo de cliente DUEÑO de la reservación (no de quién ve la página: la vista
    // pública se sirve por folio, sin sesión). Señal primaria = rol department_manager, con el
    // que ClientsController crea las agencias; clientCategory casi nunca queda seteado en el
    // registro real, así que solo suma como condición OR. Se lee el rol string barato del pointer
    // (mismo patrón que dashboard/AdminController), sin un fetch extra de Role en esta página.
    const clientRole = (client && typeof client.get === 'function') ? (client.get('role') || '') : '';
    const clientCategory = (client && typeof client.get === 'function') ? (client.get('clientCategory') || '') : '';
    const isAgency = clientRole === 'department_manager' || clientCategory === 'agency';

    // Totales por los TRES métodos a nivel reservación (mismo motor), para la línea de
    // descuento/IVA. Se computa junto a dispTotals (FUERA del try/catch de summarize) para que
    // el desglose/framing siga renderizando aunque summarize() falle.
    const methodTotals = {
      efectivo: PaymentService.computeTotals(totalItems, 'efectivo', 0, currency).servicesTotal,
      transferencia: PaymentService.computeTotals(totalItems, 'transferencia', 0, currency).servicesTotal,
      tarjeta: PaymentService.computeTotals(totalItems, 'tarjeta', 0, currency).servicesTotal,
    };
    // Sin ningún pricesByType no se puede armar el desglose por método: se cae al render legado.
    const hasPricesByType = totalItems.some((it) => it.pricesByType && typeof it.pricesByType === 'object');

    // Ajustes de la reservación (cargos/descuentos), itemizados en la vista. Se renderizan verbatim
    // (la descripción ya viene lista) y se normalizan fuera del try/catch para que sobrevivan a un
    // fallo de summarize.
    const rawAdjustments = reservation.get('adjustments');
    const adjustments = (Array.isArray(rawAdjustments) ? rawAdjustments : []).map((a) => ({
      id: (a && a.id) ? a.id : '',
      type: (a && a.type === 'discount') ? 'discount' : 'charge',
      description: (a && typeof a.description === 'string') ? a.description : '',
      amount: Number(a && a.amount) || 0,
      source: (a && a.source) ? a.source : null,
    }));

    // Payment rollup (fresh, non-persisting): amount paid, balance and status.
    // payment.total es el monto total a pagar (servicios + ajustes); serviceItems.total es solo servicios.
    let payment = {
      paymentStatus: reservation.get('paymentStatus') || 'pending',
      paidAmount: reservation.get('paidAmount') || 0,
      balance: reservation.get('balance'),
      // Fallback (summarize() lanzó): deriva total = balance + paidAmount (los campos que sobreviven
      // al fallo) para que el Total no se contradiga con el desglose de ajustes ya renderizado —
      // usar dispTotals.servicesTotal ignoraba ajustes. Mismo fix que
      // ReservationController.getReservationById (Fase 3); Fase 2 no lo tenía.
      total: Math.round(
        ((Number(reservation.get('balance')) || 0) + (Number(reservation.get('paidAmount')) || 0)) * 100
      ) / 100,
    };
    try {
      const summary = await PaymentService.summarize(reservation.id);
      payment = {
        paymentStatus: summary.paymentStatus,
        paidAmount: summary.paidAmount,
        balance: summary.balance,
        total: summary.total,
      };
    } catch (payErr) {
      logger.warn('preparePublicReservationData: payment summary failed', { error: payErr.message });
    }

    const rate = reservation.get('rate') || snapshot.rate || null;
    const reservationServiceCustomer = this.formatPerson(reservation.get('serviceCustomer'));

    return {
      id: reservation.id,
      folio: reservation.get('folio'),
      status: reservation.get('status'),
      reservationFolio: reservation.get('folio'),
      reservationServiceCustomer,
      quoteFolio: reservation.get('quotePtr')?.get('folio') || snapshot.quoteFolio || '',
      client: this.formatClientData(client, reservation),
      contactPerson: reservation.get('contactPerson') || snapshot.contactPerson || '',
      contactFirstName: reservation.get('contactFirstName') || snapshot.contactFirstName || '',
      contactLastName: reservation.get('contactLastName') || snapshot.contactLastName || '',
      contactEmail: reservation.get('contactEmail') || snapshot.contactEmail || '',
      contactPhone: reservation.get('contactPhone') || snapshot.contactPhone || '',
      numberOfPeople: reservation.get('numberOfPeople') || snapshot.numberOfPeople || 0,
      eventType: reservation.get('eventType') || snapshot.eventType || '',
      notes: reservation.get('notes') || snapshot.notes || '',
      leadGuestFirstName: reservation.get('leadGuestFirstName') || snapshot.leadGuestFirstName || '',
      leadGuestLastName: reservation.get('leadGuestLastName') || snapshot.leadGuestLastName || '',
      rate: this.formatRateData(rate),
      isAgency,
      adjustments,
      serviceItems: {
        days,
        subtotal,
        iva,
        total,
        paymentType,
        currency,
        methodTotals,
        hasPricesByType,
      },
      payment,
      createdAt: reservation.get('createdAt') || null,
      updatedAt: reservation.get('updatedAt') || null,
      startDate: reservation.get('startDate') || null,
      endDate: reservation.get('endDate') || null,
      travelSpecialist: this.formatPerson(reservation.get('createdBy')),
    };
  }

  /**
   * Build a public-safe client info object, falling back to the reservation snapshot when
   * the linked Client pointer is missing.
   * @param {object|null} client - Client Parse object (may be null).
   * @param {object} reservation - Reservation Parse object (used for fallback snapshot data).
   * @returns {object} Plain object with firstName, lastName, email, phone, companyName.
   * @example
   *   const c = this.formatClientData(reservation.get('clientPtr'), reservation);
   */
  formatClientData(client, reservation) {
    if (client) {
      return {
        firstName: client.get('firstName') || '',
        lastName: client.get('lastName') || '',
        email: client.get('email') || '',
        phone: client.get('phone') || '',
        companyName: client.get('contextualData')?.companyName || client.get('name') || '',
      };
    }
    const snapshot = reservation.get('serviceItemsSnapshot') || {};
    const c = snapshot.client || {};
    return {
      firstName: c.firstName || '',
      lastName: c.lastName || '',
      email: c.email || '',
      phone: c.phone || '',
      companyName: c.companyName || '',
    };
  }

  /**
   * Normalize the rate info (which may be a Parse pointer or a plain snapshot object)
   * into a plain object the renderer can consume.
   * @param {object|null} rate - Rate pointer or snapshot.
   * @returns {object|null} Plain rate object or null when no rate.
   * @example
   *   const rate = this.formatRateData(reservation.get('rate'));
   */
  formatRateData(rate) {
    if (!rate) return null;
    // Rate can be either a Parse pointer or a plain object from snapshot
    if (typeof rate.get === 'function') {
      return {
        name: rate.get('name') || '',
        destination: rate.get('destination') || '',
        originCity: rate.get('originCity') || '',
        startDate: rate.get('startDate') || null,
        endDate: rate.get('endDate') || null,
        numberOfDays: rate.get('numberOfDays') || 0,
      };
    }
    return {
      name: rate.name || '',
      destination: rate.destination || '',
      originCity: rate.originCity || '',
      startDate: rate.startDate || null,
      endDate: rate.endDate || null,
      numberOfDays: rate.numberOfDays || 0,
    };
  }

  /**
   * Format a ReservationService into the subconcept shape the renderer expects.
   * The subconcept blob already contains most fields — we enrich with segment
   * names/colors from the rateMap and surface extraAssignments alongside.
   * @param svc
   * @param segmentNames
   * @param vehicleImageMap
   * @example
   */
  async formatServiceAsSubconcept(svc, segmentNames, vehicleImageMap = {}) {
    const sub = svc.get('subconcept') || {};

    // Build assignments block from the service's assigned pointers + extraAssignments
    const driver = this.formatPerson(svc.get('assignedDriver'));
    const guide = this.formatPerson(svc.get('assignedGuide'));
    const greeter = this.formatPerson(svc.get('assignedGreeter'));
    const vehicle = this.formatVehicle(svc.get('assignedVehicle'), vehicleImageMap);
    const serviceCustomer = this.formatPerson(svc.get('assignedServiceCustomer'));
    const extras = await this.resolveExtraAssignments(svc.get('extraAssignments') || [], vehicleImageMap);
    const hasAnyAssignment = !!(driver || guide || greeter || vehicle || serviceCustomer
      || extras.some((e) => e.driver || e.vehicle));
    const assignments = hasAnyAssignment
      ? {
        driver, guide, greeter, vehicle, serviceCustomer, extras,
      }
      : null;

    // Resolve main segment
    const mainSegmentId = sub.category || sub.rateId || '';
    const mainSegmentRate = mainSegmentId ? segmentNames.get(mainSegmentId) : null;
    const categoryName = sub.categoryName || mainSegmentRate?.name || '';
    const categoryColor = sub.categoryColor || mainSegmentRate?.color || '';

    // Resolve additional vehicle segment
    const additionalSegmentId = sub.additionalVehicleSegment || '';
    const additionalSegmentRate = additionalSegmentId ? segmentNames.get(additionalSegmentId) : null;
    const additionalVehicleSegmentName = sub.additionalVehicleSegmentName
      || additionalSegmentRate?.name || '';
    const additionalVehicleSegmentColor = sub.additionalVehicleSegmentColor
      || additionalSegmentRate?.color || '';

    // Enrich extra additional vehicles segment data
    const extraAdditionalVehicles = Array.isArray(sub.extraAdditionalVehicles)
      ? sub.extraAdditionalVehicles.map((v) => {
        if (!v || !v.segment) return v;
        const r = segmentNames.get(v.segment);
        if (!r) return v;
        return {
          ...v,
          segmentName: v.segmentName || r.name,
          segmentColor: v.segmentColor || r.color,
        };
      })
      : [];

    // Concept fallback for tours
    let concept = sub.concept || svc.get('concept') || '';
    if (sub.type === 'tour' && (!concept || concept.trim() === '')) {
      concept = sub.destinationPOI || sub.destination || 'Tour';
    }

    // serviceType normalization
    let serviceType = sub.serviceType || '';
    if (sub.type === 'traslado' && !serviceType) serviceType = 'Traslado';
    else if (sub.type === 'tour' && !serviceType) serviceType = 'Tour';
    else if (sub.type === 'experiencia' && !serviceType) serviceType = 'Experiencia';

    const providerType = await this.getProviderType(sub);
    if (sub.type === 'experiencia' && providerType === 'Establishment') {
      serviceType = 'Experiencia';
    }

    return {
      id: svc.id,
      type: sub.type || '',
      concept,
      serviceType,
      vehicleType: sub.vehicleType || '',
      vehicleTypeName: sub.vehicleTypeName || '',
      vehicleTypeId: sub.vehicleTypeId || '',
      vehicleCapacity: sub.vehicleCapacity || null,
      vehicleMultiplier: sub.vehicleMultiplier || 1,
      quantity: sub.quantity || 1,
      startTime: sub.startTime || '',
      endTime: sub.endTime || '',
      time: sub.time || svc.get('time') || '',
      selectedSchedule: sub.selectedSchedule || '',
      hours: sub.hours || 0,
      unitPrice: sub.unitPrice || 0,
      isPerPerson: sub.isPerPerson || false,
      numberOfPeople: sub.numberOfPeople || 0,
      total: sub.total || svc.get('total') || 0,
      destinationPOI: sub.destinationPOI || '',
      destination: sub.destination || '',
      origin: sub.origin || '',
      originName: sub.originName || '',
      flightNumber: sub.flightNumber || '',
      airline: sub.airline || '',
      includeGuide: sub.includeGuide || false,
      includeGreeter: sub.includeGreeter || false,
      waitingTimeHours: sub.waitingTimeHours || 0,
      transportType: sub.transportType || '',
      directionType: sub.directionType || '',
      isPackage: sub.isPackage || false,
      includedExperiences: sub.includedExperiences || [],
      isCashPayment: sub.isCashPayment || false,
      tourId: sub.tourId || '',
      experienceId: sub.experienceId || '',
      providerType,
      providerName: sub.providerName || '',
      imageUrl: sub.imageUrl || '',
      notes: sub.notes || '',
      clientNotes: sub.clientNotes || '',
      providerNotes: sub.providerNotes || '',
      teamNotes: sub.teamNotes || '',
      internalNotes: sub.internalNotes || '',
      adultsQuantity: sub.adultsQuantity || 0,
      childrenQuantity: sub.childrenQuantity || 0,
      adultsNoAlcoholQuantity: sub.adultsNoAlcoholQuantity || 0,
      infantsQuantity: sub.infantsQuantity || 0,
      transportAdults: sub.transportAdults || 0,
      transportChildren: sub.transportChildren || 0,
      transportInfants: sub.transportInfants || 0,
      customPrice: sub.customPrice || null,
      priceOverride: sub.priceOverride || false,
      customPrices: sub.customPrices || null,
      hasAdditionalVehicle: sub.hasAdditionalVehicle || false,
      additionalVehicleId: sub.additionalVehicleId || '',
      additionalVehicleType: sub.additionalVehicleType || '',
      additionalVehicleTypeName: sub.additionalVehicleTypeName || '',
      additionalVehicleSegment: sub.additionalVehicleSegment || '',
      additionalVehicleSegmentName,
      additionalVehicleSegmentColor,
      duration: sub.duration || null,
      // Duración REAL de la ruta, en MINUTOS (los traslados no usan `duration`: ese campo viene del
      // catálogo de experiencias y en ellos llega con un 1 espurio). La vista la necesita para poder
      // mostrar la duración correcta de un traslado en vez de ese 1.
      routeDuration: sub.routeDuration || null,
      isWalkingTour: sub.isWalkingTour || false,
      pricesByType: sub.pricesByType || null,
      includeInTotal: sub.includeInTotal !== false,
      // Descuento por servicio (Fase 1): se expone para que preparePublicReservationData lo pase a
      // PaymentService.computeTotals (chargeAmount resta discountAmount del precio bruto). Sin este
      // campo la vista/PDF PÚBLICOS (sin auth) mostraban/cobraban el precio BRUTO, divergiendo de
      // PaymentService.summarize (que sí lo resta vía toServiceItems). discountType/discountValue
      // viajan para el desglose por servicio, igual que en el subconcepto del lado cotización.
      discountAmount: Number(sub.discountAmount) || 0,
      discountType: sub.discountType || '',
      discountValue: Number(sub.discountValue) || 0,
      category: sub.category || '',
      categoryName,
      categoryColor,
      attendees: Array.isArray(sub.attendees) ? sub.attendees : [],
      additionalFlights: Array.isArray(sub.additionalFlights) ? sub.additionalFlights : [],
      extraAdditionalVehicles,
      tripType: sub.tripType || '',
      specificLocation: sub.specificLocation || '',
      // Pickup / drop-off addresses (Punto a Punto + Local; one-way + per-leg round-trip)
      pickupAddress: sub.pickupAddress || '',
      dropoffAddress: sub.dropoffAddress || '',
      pickupAddressIda: sub.pickupAddressIda || '',
      dropoffAddressIda: sub.dropoffAddressIda || '',
      pickupAddressVuelta: sub.pickupAddressVuelta || '',
      dropoffAddressVuelta: sub.dropoffAddressVuelta || '',
      vehicleCount: sub.vehicleCount || null,
      hourlyPrice: sub.hourlyPrice || null,
      discountPercent: sub.discountPercent || null,
      rateId: sub.rateId || '',
      flightDepartureTimeSuggested: sub.flightDepartureTimeSuggested || '',
      roundTripDepartureTimeSuggestedIda: sub.roundTripDepartureTimeSuggestedIda || '',
      roundTripDepartureTimeSuggestedVuelta: sub.roundTripDepartureTimeSuggestedVuelta || '',
      greeterInVehicle: sub.greeterInVehicle || false,
      returnOrigin: sub.returnOrigin || '',
      returnDestination: sub.returnDestination || '',
      returnAirline: sub.returnAirline || '',
      returnFlightNumber: sub.returnFlightNumber || '',
      // Reservation-only: assignments with images, email, phone
      assignments,
    };
  }

  /**
   * Inject primary image URLs for tours and experiences (copy of PublicQuoteController logic).
   * @param quoteData
   * @example
   */
  async injectServiceImages(quoteData) {
    try {
      const tourIds = [];
      const experienceIds = [];
      (quoteData.serviceItems?.days || []).forEach((day) => {
        (day.subconcepts || []).forEach((sc) => {
          if (sc.tourId) tourIds.push(sc.tourId);
          if (sc.experienceId) experienceIds.push(sc.experienceId);
        });
      });

      const uniqueTourIds = [...new Set(tourIds.filter(Boolean))];
      const uniqueExpIds = [...new Set(experienceIds.filter(Boolean))];
      const formatPriority = ['avif', 'webp', 'jpeg'];

      /**
       * Fetch primary (or first-ordered fallback) image URLs for a set of parent
       * records, keyed by parent ID. Prefers optimized variants by format priority.
       * @param {string} className - Image Parse class to query (e.g. 'TourImage').
       * @param {string} pointerField - Pointer field on the image referencing the parent.
       * @param {string} parentClass - Parent Parse class name (e.g. 'Tour').
       * @param {Array<string>} ids - Parent object IDs to resolve images for.
       * @returns {Promise<object>} Map of parent ID to image URL.
       * @example
       *   const map = await fetchImages('TourImage', 'tour', 'Tour', ['t1', 't2']);
       */
      const fetchImages = async (className, pointerField, parentClass, ids) => {
        const map = {};
        if (ids.length === 0) return map;
        const Parent = Parse.Object.extend(parentClass);
        const pointers = ids.map((id) => Parent.createWithoutData(id));
        const q = new Parse.Query(className);
        q.containedIn(pointerField, pointers);
        q.equalTo('isPrimary', true);
        q.equalTo('exists', true);
        let images = await q.find({ useMasterKey: true });
        if (images.length === 0) {
          const fb = new Parse.Query(className);
          fb.containedIn(pointerField, pointers);
          fb.equalTo('exists', true);
          fb.ascending('displayOrder');
          images = await fb.find({ useMasterKey: true });
        }
        await Promise.all(images.map(async (img) => {
          const pid = img.get(pointerField)?.id;
          if (!pid || map[pid]) return;
          let url = '';
          const variants = img.get('optimizedVariants');
          const s3Key = img.get('s3Key');
          if (variants && typeof variants === 'object') {
            for (const fmt of formatPriority) {
              if (variants[fmt]?.s3Key) {
                try {
                  url = await fileStorageService.getPresignedUrl(variants[fmt].s3Key);
                  break;
                } catch (e) { /* continue */ }
              }
            }
          }
          if (!url && s3Key) {
            try { url = await fileStorageService.getPresignedUrl(s3Key); } catch (e) { /* continue */ }
          }
          if (!url && s3Key) {
            const bucket = img.get('s3Bucket');
            const region = img.get('s3Region');
            if (bucket && region) url = `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`;
          }
          if (url) map[pid] = url;
        }));
        return map;
      };

      const [tourMap, expMap] = await Promise.all([
        fetchImages('TourImage', 'tourId', 'Tour', uniqueTourIds),
        fetchImages('ExperienceImage', 'experienceId', 'Experience', uniqueExpIds),
      ]);

      quoteData.serviceItems.days.forEach((day) => {
        (day.subconcepts || []).forEach((sc) => {
          if (sc.tourId && tourMap[sc.tourId]) Object.assign(sc, { imageUrl: tourMap[sc.tourId] });
          else if (sc.experienceId && expMap[sc.experienceId]) Object.assign(sc, { imageUrl: expMap[sc.experienceId] });
        });
      });
    } catch (err) {
      logger.warn('Failed to inject service images for public reservation', { error: err.message });
    }
  }

  /**
   * Detect provider type (delegates to lazy-loaded caches, same as PublicQuoteController).
   * @param subconcept
   * @example
   */
  async getProviderType(subconcept) {
    if (subconcept.providerType === 'Establishment') return 'Establishment';
    if (!subconcept.experienceId || subconcept.type !== 'experiencia') return null;

    await this.loadExperienceCaches();

    if (Array.isArray(this.providerExperiencesCache)) {
      const match = this.providerExperiencesCache.find(
        (exp) => (exp.id === subconcept.experienceId || exp.objectId === subconcept.experienceId)
          && exp.provider?.type === 'Establishment'
      );
      if (match) return 'Establishment';
    }
    if (Array.isArray(this.experiencesCache)) {
      const match = this.experiencesCache.find(
        (exp) => (exp.id === subconcept.experienceId || exp.objectId === subconcept.experienceId)
          && exp.provider?.type === 'Establishment'
      );
      if (match) return 'Establishment';
    }
    return null;
  }

  /**
   * Lazy-load the experience + provider-experience caches used for provider-type detection.
   * Idempotent — repeated calls reuse the in-flight promise.
   * @returns {Promise<void>}
   * @example
   *   await this.loadExperienceCaches();
   */
  async loadExperienceCaches() {
    if (this.cacheLoadPromise) return this.cacheLoadPromise;
    this.cacheLoadPromise = (async () => {
      try {
        await Promise.all([this.loadExperiencesInternal(), this.loadProviderExperiencesInternal()]);
      } catch (error) {
        logger.warn('Failed to load experience caches for public reservation', { error: error.message });
        this.experiencesCache = [];
        this.providerExperiencesCache = [];
      }
    })();
    return this.cacheLoadPromise;
  }

  /**
   * Internal — populate the experiencesCache with active Experience records.
   * @returns {Promise<void>}
   * @example
   *   await this.loadExperiencesInternal();
   */
  async loadExperiencesInternal() {
    try {
      const q = new Parse.Query('Experience');
      q.include('provider');
      q.equalTo('active', true);
      q.limit(1000);
      const results = await q.find({ useMasterKey: true });
      this.experiencesCache = results.map((exp) => ({
        id: exp.id,
        objectId: exp.id,
        provider: exp.get('provider') ? {
          id: exp.get('provider').id,
          type: exp.get('provider').get('type'),
        } : null,
      }));
    } catch (error) {
      this.experiencesCache = [];
    }
  }

  /**
   * Internal — populate the providerExperiencesCache with active ProviderExperiencia records.
   * @returns {Promise<void>}
   * @example
   *   await this.loadProviderExperiencesInternal();
   */
  async loadProviderExperiencesInternal() {
    try {
      const q = new Parse.Query('ProviderExperiencia');
      q.include('provider');
      q.equalTo('active', true);
      q.limit(1000);
      const results = await q.find({ useMasterKey: true });
      this.providerExperiencesCache = results.map((exp) => ({
        id: exp.id,
        objectId: exp.id,
        provider: exp.get('provider') ? {
          id: exp.get('provider').id,
          type: exp.get('provider').get('type'),
        } : null,
      }));
    } catch (error) {
      this.providerExperiencesCache = [];
    }
  }
}

module.exports = new PublicReservationController();
