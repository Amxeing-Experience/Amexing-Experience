/**
 * PublicQuoteController - Handles public quote viewing without authentication.
 * Provides public access to quotes via folio number for client sharing.
 * No authentication required - uses folio as the access key.
 * Security Considerations:
 * - Folio acts as access token (QTE-YYYY-NNNN format).
 * - Only active quotes with exists=true are accessible.
 * - Sensitive internal data filtered before rendering.
 * - Rate limiting applied to prevent abuse.
 * - Audit logging for all public access.
 * @author Amexing Development Team
 * @version 1.0.0
 */

const Parse = require('parse/node');
const Quote = require('../../domain/models/Quote');
const logger = require('../../infrastructure/logger');
const FileStorageService = require('../services/FileStorageService');

const fileStorageService = new FileStorageService({
  baseFolder: 'general',
  isPublic: false,
  presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
});

/**
 * PublicQuoteController class for public quote viewing.
 * @class PublicQuoteController
 */
class PublicQuoteController {
  constructor() {
    // Bind methods to maintain 'this' context
    this.viewPublicQuote = this.viewPublicQuote.bind(this);
    this.preparePublicQuoteData = this.preparePublicQuoteData.bind(this);

    // Initialize experience caches for provider detection
    this.experiencesCache = null;
    this.providerExperiencesCache = null;
    this.cacheLoadPromise = null;
  }

  /**
   * View public quote by folio.
   * GET /quotes/:folio.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Renders public quote view or error page.
   * @example
   * // Access public quote
   * GET /quotes/QTE-2025-0004
   */
  async viewPublicQuote(req, res) {
    const { folio } = req.params;

    try {
      const folioValidation = this.validateFolio(folio, req, res);
      if (folioValidation) return folioValidation;

      const quote = await this.fetchQuoteByFolio(folio, req, res);
      if (!quote) return;

      this.logPublicAccess(quote, req);
      const quoteData = await this.preparePublicQuoteData(quote);

      // Fetch primary images for tours and experiences
      await this.injectServiceImages(quoteData);

      return res.render('dashboards/admin/quote-public', {
        quote: quoteData,
        isPublicView: true,
        pageTitle: `Cotización ${folio}`,
      });
    } catch (error) {
      return this.handlePublicQuoteError(error, folio, req, res);
    }
  }

  // ===== HELPER METHODS =====

  /**
   * Validate folio format.
   * @param {string} folio - Quote folio to validate.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {object|null} Error response or null if valid.
   * @example
   * const error = this.validateFolio('QTE-2024-0001', req, res);
   */
  validateFolio(folio, req, res) {
    const folioRegex = /^QTE-\d{4}-\d{4}$/;
    if (!folioRegex.test(folio)) {
      logger.warn('Invalid folio format for public access', {
        folio,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      return res.status(400).render('errors/error', {
        status: 400,
        title: 'Folio Inválido',
        message: 'El formato del folio no es válido. Debe ser QTE-YYYY-####',
      });
    }
    return null;
  }

  /**
   * Fetch quote by folio with error handling.
   * @param {string} folio - Quote folio to fetch.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object|null>} Quote object or null if error.
   * @example
   * const quote = await this.fetchQuoteByFolio('QTE-2024-0001', req, res);
   */
  async fetchQuoteByFolio(folio, req, res) {
    const quote = await Quote.findByFolioPublic(folio);

    if (!quote) {
      logger.warn('Quote not found for public access', {
        folio,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.status(404).render('errors/404', {
        message: 'Cotización no encontrada',
      });
      return null;
    }

    return quote;
  }

  /**
   * Log public access for audit trail.
   * @param {object} quote - Quote object.
   * @param {object} req - Express request object.
   * @example
   * this.logPublicAccess(quote, req);
   */
  logPublicAccess(quote, req) {
    logger.info('Public quote accessed', {
      quoteId: quote.id,
      folio: quote.getFolio(),
      ip: req.ip,
      userAgent: req.get('user-agent'),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle errors in public quote viewing.
   * @param {Error} error - Error object.
   * @param {string} folio - Quote folio.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {object} Error response.
   * @example
   * return this.handlePublicQuoteError(error, folio, req, res);
   */
  handlePublicQuoteError(error, folio, req, res) {
    logger.error('Error rendering public quote', {
      error: error.message,
      stack: error.stack,
      folio,
      ip: req.ip,
    });

    return res.status(500).render('errors/error', {
      status: 500,
      title: 'Error del Servidor',
      message: 'Error al cargar la cotización. Por favor intente nuevamente.',
      error: process.env.NODE_ENV === 'development' ? error : undefined,
    });
  }

  /**
   * Prepare quote data for public view.
   * Filters sensitive internal data before rendering.
   * @param {Quote} quote - Quote Parse object.
   * @returns {Promise<object>} Filtered quote data for public display.
   * @example
   * const quoteData = await controller.preparePublicQuoteData(quote);
   */
  async preparePublicQuoteData(quote) {
    const rate = quote.getRate();
    const client = quote.getClient();
    const serviceItems = quote.getServiceItems() || {};

    return {
      id: quote.id,
      folio: quote.getFolio(),
      status: quote.getStatus(),
      client: this.formatClientData(client),
      contactPerson: quote.getContactPerson() || '',
      contactEmail: quote.getContactEmail() || '',
      contactPhone: quote.getContactPhone() || '',
      numberOfPeople: quote.getNumberOfPeople() || 1,
      eventType: quote.getEventType() || '',
      rate: this.formatRateData(rate),
      serviceItems: await this.formatServiceItems(serviceItems),
      createdAt: quote.get('createdAt') || null,
      updatedAt: quote.get('updatedAt') || null,
    };
  }

  /**
   * Format client data for public view.
   * @param {object} client - Client object.
   * @returns {object|null} Formatted client data or null.
   * @example
   * const clientData = this.formatClientData(client);
   */
  formatClientData(client) {
    return client
      ? {
        firstName: client.get('firstName') || '',
        lastName: client.get('lastName') || '',
        email: client.get('email') || '',
        phone: client.get('phone') || '',
        companyName: client.get('contextualData')?.companyName || client.get('name') || '',
      }
      : null;
  }

  /**
   * Format rate data for public view.
   * @param {object} rate - Rate object.
   * @returns {object|null} Formatted rate data or null.
   * @example
   * const rateData = this.formatRateData(rate);
   */
  formatRateData(rate) {
    return rate
      ? {
        name: rate.get('name') || '',
        destination: rate.get('destination') || '',
        originCity: rate.get('originCity') || '',
        startDate: rate.get('startDate') || null,
        endDate: rate.get('endDate') || null,
        numberOfDays: rate.get('numberOfDays') || 0,
      }
      : null;
  }

  /**
   * Format service items for public view.
   * @param {object} serviceItems - Service items object.
   * @returns {Promise<object>} Formatted service items.
   * @example
   * const formattedItems = await this.formatServiceItems(serviceItems);
   */
  async formatServiceItems(serviceItems) {
    const days = await Promise.all((serviceItems.days || []).map((day) => this.formatDayData(day)));

    return {
      days,
      subtotal: serviceItems.subtotal || 0,
      iva: serviceItems.iva || 0,
      total: serviceItems.total || 0,
    };
  }

  /**
   * Format day data for public view.
   * @param {object} day - Day object.
   * @returns {Promise<object>} Formatted day data.
   * @example
   * const dayData = await this.formatDayData(day);
   */
  async formatDayData(day) {
    const subconcepts = await Promise.all((day.subconcepts || []).map((sub) => this.formatSubconcept(sub)));

    return {
      dayNumber: day.dayNumber || 0,
      date: day.date || '',
      city: day.city || '',
      description: day.description || '',
      subconcepts,
    };
  }

  /**
   * Format subconcept data for public view.
   * @param {object} sub - Subconcept object.
   * @returns {Promise<object>} Formatted subconcept data.
   * @example
   * const subData = await this.formatSubconcept(subconcept);
   */
  async formatSubconcept(sub) {
    // For tours, prioritize destination name over empty concept
    let concept = sub.concept || '';
    if (sub.type === 'tour' && (!concept || concept.trim() === '')) {
      concept = sub.destinationPOI || sub.destination || 'Tour';
    }

    // For transfers, ensure we have proper service type
    let serviceType = sub.serviceType || '';
    if (sub.type === 'traslado' && (!serviceType || serviceType.trim() === '')) {
      serviceType = 'Traslado';
    } else if (sub.type === 'tour' && (!serviceType || serviceType.trim() === '')) {
      serviceType = 'Tour';
    } else if (sub.type === 'experiencia' && (!serviceType || serviceType.trim() === '')) {
      serviceType = 'Experiencia';
    }

    // Detect provider type for establishment labeling
    const providerType = await this.getProviderType(sub);

    // Update serviceType based on providerType for experiences
    if (sub.type === 'experiencia' && providerType === 'Establishment') {
      serviceType = 'Establecimiento';
    }

    return {
      id: sub.id || '',
      type: sub.type || '',
      concept,
      serviceType,
      vehicleType: sub.vehicleType || '',
      vehicleTypeName: sub.vehicleTypeName || '',
      vehicleTypeId: sub.vehicleTypeId || '',
      vehicleCapacity: sub.vehicleCapacity || null,
      vehicleMultiplier: sub.vehicleMultiplier || 1,
      startTime: sub.startTime || '',
      endTime: sub.endTime || '',
      time: sub.time || '',
      selectedSchedule: sub.selectedSchedule || '',
      hours: sub.hours || 0,
      unitPrice: sub.unitPrice || 0,
      isPerPerson: sub.isPerPerson || false,
      numberOfPeople: sub.numberOfPeople || 1,
      total: sub.total || 0,
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
      imageUrl: sub.imageUrl || '',
      // Include all missing service data fields for complete parity with admin views
      notes: sub.notes || '',
      adultsQuantity: sub.adultsQuantity || 0,
      childrenQuantity: sub.childrenQuantity || 0,
      adultsNoAlcoholQuantity: sub.adultsNoAlcoholQuantity || 0,
      customPrice: sub.customPrice || null,
      priceOverride: sub.priceOverride || false,
      customPrices: sub.customPrices || null,
    };
  }

  /**
   * Inject primary image URLs for tours and experiences into quote data.
   * @param {object} quoteData - Prepared quote data with serviceItems.
   * @returns {Promise<void>}
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
       * Fetch primary images for a set of parent object IDs.
       * @param {string} className - Image class name.
       * @param {string} pointerField - Pointer field name on the image class.
       * @param {string} parentClass - Parent class name.
       * @param {string[]} ids - Array of parent object IDs.
       * @returns {Promise<object>} Map of parent ID to image URL.
       * @example
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
      logger.warn('Failed to inject service images for public quote', { error: err.message });
    }
  }

  /**
   * Load experience caches for provider detection.
   * Uses singleton pattern to avoid multiple loads.
   * @returns {Promise<void>}
   * @example
   */
  async loadExperienceCaches() {
    // Use singleton pattern to avoid multiple concurrent loads
    if (this.cacheLoadPromise) {
      return this.cacheLoadPromise;
    }

    // eslint-disable-next-line no-underscore-dangle
    this.cacheLoadPromise = this._loadExperienceCachesInternal();
    return this.cacheLoadPromise;
  }

  /**
   * Internal method to load experience and provider caches.
   * @private
   * @returns {Promise<void>}
   * @example
   */
  async _loadExperienceCachesInternal() {
    try {
      // Load both caches in parallel
      /* eslint-disable no-underscore-dangle */
      await Promise.all([
        this._loadExperiences(),
        this._loadProviderExperiences(),
      ]);
      /* eslint-enable no-underscore-dangle */

      logger.debug('Experience caches loaded successfully', {
        experiencesCount: this.experiencesCache?.length || 0,
        providerExperiencesCount: this.providerExperiencesCache?.length || 0,
      });
    } catch (error) {
      logger.warn('Failed to load experience caches for public quote', { error: error.message });
      // Set empty arrays to prevent errors in detection logic
      this.experiencesCache = [];
      this.providerExperiencesCache = [];
    }
  }

  /**
   * Load regular experiences from Parse.
   * @private
   * @returns {Promise<void>}
   * @example
   */
  async _loadExperiences() {
    try {
      const Experience = Parse.Object.extend('Experience');
      const query = new Parse.Query(Experience);
      query.include('provider');
      query.include('destinationPOI');
      query.equalTo('active', true);
      query.limit(1000);

      const results = await query.find({ useMasterKey: true });
      this.experiencesCache = results.map((exp) => ({
        id: exp.id,
        objectId: exp.id,
        title: exp.get('title') || exp.get('name'),
        name: exp.get('name') || exp.get('title'),
        provider: exp.get('provider') ? {
          id: exp.get('provider').id,
          name: exp.get('provider').get('name'),
          type: exp.get('provider').get('type'),
        } : null,
      }));
    } catch (error) {
      logger.warn('Failed to load experiences for public quote', { error: error.message });
      this.experiencesCache = [];
    }
  }

  /**
   * Load provider experiences from Parse.
   * @private
   * @returns {Promise<void>}
   * @example
   */
  async _loadProviderExperiences() {
    try {
      const ProviderExperiencia = Parse.Object.extend('ProviderExperiencia');
      const query = new Parse.Query(ProviderExperiencia);
      query.include('provider');
      query.equalTo('active', true);
      query.limit(1000);

      const results = await query.find({ useMasterKey: true });
      this.providerExperiencesCache = results.map((exp) => ({
        id: exp.id,
        objectId: exp.id,
        title: exp.get('title') || exp.get('experienceName'),
        name: exp.get('experienceName') || exp.get('title'),
        provider: exp.get('provider') ? {
          id: exp.get('provider').id,
          name: exp.get('provider').get('name'),
          type: exp.get('provider').get('type'),
        } : null,
      }));
    } catch (error) {
      logger.warn('Failed to load provider experiences for public quote', { error: error.message });
      this.providerExperiencesCache = [];
    }
  }

  /**
   * Detect provider type from experienceId.
   * @param {object} subconcept - Service subconcept object.
   * @returns {Promise<string|null>} Provider type or null.
   * @example
   */
  async getProviderType(subconcept) {
    // Ensure caches are loaded
    await this.loadExperienceCaches();

    console.log('🔍 getProviderType debug:', {
      experienceId: subconcept.experienceId,
      type: subconcept.type,
      savedProviderType: subconcept.providerType,
      cacheSizes: {
        experiences: this.experiencesCache?.length || 0,
        providerExperiences: this.providerExperiencesCache?.length || 0,
      },
    });

    // Tier 1: Check if providerType is already saved (new services)
    if (subconcept.providerType === 'Establishment') {
      console.log('✅ Found Establishment via Tier 1 (saved providerType)');
      return 'Establishment';
    }

    // Tier 2: Fallback to experienceId lookup (existing services)
    if (subconcept.experienceId && subconcept.type === 'experiencia') {
      // Check provider experiences cache first
      if (this.providerExperiencesCache && Array.isArray(this.providerExperiencesCache)) {
        const experience = this.providerExperiencesCache.find(
          (exp) => (exp.id === subconcept.experienceId || exp.objectId === subconcept.experienceId)
            && exp.provider?.type === 'Establishment'
        );
        if (experience) {
          console.log('✅ Found Establishment via Tier 2 (providerExperiences cache)');
          return 'Establishment';
        }
      }

      // Check regular experiences cache
      if (this.experiencesCache && Array.isArray(this.experiencesCache)) {
        const experience = this.experiencesCache.find(
          (exp) => (exp.id === subconcept.experienceId || exp.objectId === subconcept.experienceId)
            && exp.provider?.type === 'Establishment'
        );
        if (experience) {
          console.log('✅ Found Establishment via Tier 2 (experiences cache)');
          return 'Establishment';
        }
      }
    }

    // Tier 3: Direct database lookup as fallback
    if (subconcept.experienceId && subconcept.type === 'experiencia') {
      try {
        console.log(`🔍 Tier 3: Attempting direct database lookup for experienceId: ${subconcept.experienceId}`);

        const Experience = Parse.Object.extend('Experience');
        const query = new Parse.Query(Experience);
        query.include('provider');

        const experience = await query.get(subconcept.experienceId);
        if (experience) {
          const provider = experience.get('provider');
          const providerType = provider?.get('type');

          console.log('✅ Found experience in database:', {
            experienceId: subconcept.experienceId,
            providerType,
            providerName: provider?.get('name') || 'Unknown',
          });

          if (providerType === 'Establishment') {
            console.log('✅ Found Establishment via Tier 3 (direct database lookup)');
            return 'Establishment';
          }
        }
      } catch (error) {
        console.error(`❌ Error in direct database lookup for experienceId ${subconcept.experienceId}:`, error.message);
      }
    }

    // Tier 4: Default (no establishment provider detected)
    console.log('❌ No Establishment provider found, defaulting to null');
    return null;
  }
}

module.exports = new PublicQuoteController();
