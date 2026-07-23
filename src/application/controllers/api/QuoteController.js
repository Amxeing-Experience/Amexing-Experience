/**
 * QuoteController - Handles quote/cotización CRUD operations
 * Uses Quote domain model that extends BaseModel with validation.
 */

const Parse = require('parse/node');
const Quote = require('../../../domain/models/Quote');
const QuoteOwnership = require('../../../domain/models/QuoteOwnership');
const ReservationService = require('../../../domain/models/ReservationService');
const Payment = require('../../../domain/models/Payment');
const ExchangeRate = require('../../../domain/models/ExchangeRate');
const ServiceChangeRequest = require('../../../domain/models/ServiceChangeRequest');
const QuoteActivityService = require('../../services/QuoteActivityService');
const QuoteService = require('../../services/QuoteService');
const QuoteOwnershipService = require('../../services/QuoteOwnershipService');
const QuoteCollaborationService = require('../../services/QuoteCollaborationService');
const QuoteVersioningService = require('../../services/QuoteVersioningService');
const pricingHelper = require('../../utils/pricingHelper');
const logger = require('../../../infrastructure/logger');
const FileStorageService = require('../../services/FileStorageService');

// Module-level FileStorageService for presigned S3 URLs
const fileStorageService = new FileStorageService({
  baseFolder: 'general',
  isPublic: false,
  presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
});

// Tolerancia (MXN) de divergencia entre lo que el front envía y lo que el motor de precios recalcula
// al guardar service-items (costura #1). Hasta $1.00 se acepta como redondeo normal (solo se loggea);
// una divergencia mayor rechaza el guardado, porque esos centavos se acumulan en pérdidas reales.
const PRICE_MISMATCH_TOLERANCE = 1.00;

/**
 * Batch fetch primary images for a list of item IDs.
 * Works with TourImage, ExperienceImage, VehicleImage, etc.
 * @param {string} imageClass - Parse class name (e.g. 'TourImage').
 * @param {string} pointerField - Field name for the parent pointer (e.g. 'tourId').
 * @param {string} parentClass - Parent class name (e.g. 'Tour').
 * @param {Array<string>} ids - Array of parent object IDs.
 * @returns {Promise<object>} Map of parentId to presigned image URL.
 * @example
 */
async function batchFetchPrimaryImages(imageClass, pointerField, parentClass, ids) {
  const imageMap = {};
  if (!ids || ids.length === 0) return imageMap;

  try {
    const ParentClass = Parse.Object.extend(parentClass);
    const pointers = ids.map((id) => ParentClass.createWithoutData(id));

    const imgQuery = new Parse.Query(imageClass);
    imgQuery.containedIn(pointerField, pointers);
    imgQuery.equalTo('isPrimary', true);
    imgQuery.equalTo('exists', true);
    let images = await imgQuery.find({ useMasterKey: true });

    // Fallback: if no primary images, get first image per item
    if (images.length === 0) {
      const fallbackQuery = new Parse.Query(imageClass);
      fallbackQuery.containedIn(pointerField, pointers);
      fallbackQuery.equalTo('exists', true);
      fallbackQuery.ascending('displayOrder');
      images = await fallbackQuery.find({ useMasterKey: true });
    }

    const formatPriority = ['avif', 'webp', 'jpeg'];
    await Promise.all(images.map(async (img) => {
      const pid = img.get(pointerField)?.id;
      if (!pid || imageMap[pid]) return;

      let imageUrl = '';
      const optimizedVariants = img.get('optimizedVariants');
      const s3Key = img.get('s3Key');
      const imageFile = img.get('imageFile');

      if (optimizedVariants && typeof optimizedVariants === 'object') {
        for (const format of formatPriority) {
          const variant = optimizedVariants[format];
          if (variant?.s3Key) {
            try {
              imageUrl = await fileStorageService.getPresignedUrl(variant.s3Key);
              break;
            } catch (e) { /* continue */ }
          }
        }
      }

      if (!imageUrl && s3Key) {
        try {
          imageUrl = await fileStorageService.getPresignedUrl(s3Key);
        } catch (e) { /* continue */ }
      }

      if (!imageUrl && s3Key) {
        const s3Bucket = img.get('s3Bucket');
        const s3Region = img.get('s3Region');
        if (s3Bucket && s3Region) {
          imageUrl = `https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${s3Key}`;
        }
      }

      if (!imageUrl && imageFile) {
        imageUrl = imageFile.url();
      }

      if (imageUrl) imageMap[pid] = imageUrl;
    }));
  } catch (err) {
    logger.warn('Failed to batch fetch images', { imageClass, error: err.message });
  }

  return imageMap;
}

/**
 * Batch fetch "incluye" / "no incluye" text for tours or experiences.
 * These fields live on the Tour/Experience catalog records, not on the
 * quote's serviceItems, so we resolve them by id to enrich each subconcept.
 * @param {string} parentClass - Parse class name ('Tour' or 'Experience').
 * @param {Array<string>} ids - Array of parent object IDs.
 * @returns {Promise<object>} Map of parentId to { includes, notincludes }.
 * @example
 */
async function batchFetchIncludes(parentClass, ids) {
  const map = {};
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (uniqueIds.length === 0) return map;

  try {
    const query = new Parse.Query(parentClass);
    query.containedIn('objectId', uniqueIds);
    query.select('includes', 'notincludes');
    const records = await query.find({ useMasterKey: true });
    records.forEach((rec) => {
      map[rec.id] = {
        includes: rec.get('includes') ?? null,
        notincludes: rec.get('notincludes') ?? null,
      };
    });
  } catch (err) {
    logger.warn('Failed to batch fetch includes/notincludes', { parentClass, error: err.message });
  }

  return map;
}

/**
 * Enrich each tour/experience subconcept with its catalog "incluye" / "no incluye"
 * text so the unified renderer (summary + public quote) can display it without
 * needing client-side catalog caches. Mutates the provided serviceItems in place.
 * @param {object} serviceItems - ServiceItems object with days[].subconcepts[].
 * @returns {Promise<void>}
 * @example
 */
async function injectServiceIncludes(serviceItems) {
  if (!serviceItems || !Array.isArray(serviceItems.days)) return;

  const tourIds = [];
  const experienceIds = [];
  serviceItems.days.forEach((day) => {
    (day.subconcepts || []).forEach((sc) => {
      if (sc.tourId) tourIds.push(sc.tourId);
      if (sc.experienceId) experienceIds.push(sc.experienceId);
    });
  });

  // Las experiencias pueden ser de catálogo (clase Experience) o de proveedor/establecimiento
  // (ProviderExperiencia). El id vive en una u otra clase, así que consultamos ambas y mezclamos
  // (Experience tiene prioridad, igual que el frontend que busca primero en su caché de catálogo).
  const [tourMap, expCatalogMap, expProviderMap] = await Promise.all([
    batchFetchIncludes('Tour', tourIds),
    batchFetchIncludes('Experience', experienceIds),
    batchFetchIncludes('ProviderExperiencia', experienceIds),
  ]);
  const expMap = { ...expProviderMap, ...expCatalogMap };

  serviceItems.days.forEach((day) => {
    (day.subconcepts || []).forEach((sc) => {
      const info = (sc.tourId && tourMap[sc.tourId])
        || (sc.experienceId && expMap[sc.experienceId])
        || null;
      if (info) {
        Object.assign(sc, { includes: info.includes, notincludes: info.notincludes });
      }
    });
  });
}

/**
 * Aplana los subconceptos de un serviceItems a un Map por id → { sc, dayNumber }.
 * @param {object} serviceItems - ServiceItems con days[].subconcepts[].
 * @returns {Map<string, object>} Map por id de subconcepto.
 * @example flattenSubconcepts(quote.get('serviceItems'))
 */
function flattenSubconcepts(serviceItems) {
  const map = new Map();
  ((serviceItems && serviceItems.days) || []).forEach((d) => {
    (d.subconcepts || []).forEach((sc) => {
      if (sc && sc.id) map.set(sc.id, { sc, dayNumber: d.dayNumber });
    });
  });
  return map;
}

/**
 * Firma de contenido "significativo" de un subconcepto (ignora metadata de lock/solicitud)
 * para detectar ediciones reales en el timeline.
 * @param {object} sc - Subconcepto.
 * @returns {string} Firma JSON.
 * @example subconceptSignature(sc)
 */
function subconceptSignature(sc) {
  return JSON.stringify({
    concept: sc.concept || '',
    time: sc.time || '',
    quantity: sc.quantity ?? null,
    unitPrice: sc.unitPrice ?? 0,
    total: sc.total ?? 0,
    notes: sc.notes || '',
    originName: sc.originName || '',
    destinationName: sc.destinationName || '',
    vehicleTypeName: sc.vehicleTypeName || '',
  });
}

/**
 * Compara el serviceItems previo vs el nuevo y arma los eventos legibles del timeline
 * (agregado/editado/quitado por servicio).
 * @param {object} before - ServiceItems previo.
 * @param {object} after - ServiceItems nuevo (ya guardado).
 * @returns {Array<object>} Eventos { action, summary, meta }.
 * @example buildServiceItemsActivities(before, after)
 */
function buildServiceItemsActivities(before, after) {
  const b = flattenSubconcepts(before);
  const a = flattenSubconcepts(after);
  const events = [];
  a.forEach(({ sc, dayNumber }, id) => {
    const label = sc.concept || 'servicio';
    if (!b.has(id)) {
      events.push({ action: 'service_added', summary: `agregó "${label}" al Día ${dayNumber || '?'}`, meta: { serviceId: id, dayNumber } });
    } else if (subconceptSignature(sc) !== subconceptSignature(b.get(id).sc)) {
      events.push({ action: 'service_edited', summary: `editó "${label}" (Día ${dayNumber || '?'})`, meta: { serviceId: id, dayNumber } });
    }
  });
  b.forEach(({ sc, dayNumber }, id) => {
    if (!a.has(id)) {
      const label = sc.concept || 'servicio';
      events.push({ action: 'service_removed', summary: `quitó "${label}" (Día ${dayNumber || '?'})`, meta: { serviceId: id, dayNumber } });
    }
  });
  return events;
}

/**
 * Quote Controller - Manages quote/cotización CRUD operations
 * Handles creation, retrieval, update, and deletion of quotes with rate assignments.
 * @class QuoteController
 */
class QuoteController {
  constructor() {
    this.quoteService = new QuoteService();
    this.ownershipService = new QuoteOwnershipService();
    this.collaborationService = new QuoteCollaborationService();
    this.versioningService = new QuoteVersioningService();
  }

  /**
   * Create a new quote
   * POST /api/quotes
   * Note: Rate is no longer required at quote level (v2.0.0+).
   * Rates are now managed at subconcept/service level.
   * @param {object} req - Express request object.
   * @param {object} req.body - Request body.
   * @param {string} [req.body.client] - Client ID (AmexingUser objectId) - OPTIONAL.
   * @param {string} [req.body.contactPerson] - Contact person name.
   * @param {string} [req.body.contactEmail] - Contact email.
   * @param {string} [req.body.contactPhone] - Contact phone.
   * @param {string} [req.body.notes] - Additional notes.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async createQuote(req, res) {
    // Declare variables at method scope for error logging
    let clientObj = null;
    let companyClientObj = null;
    let createdByObj = null;

    try {
      // 1. Verify authenticated user
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Usuario no autenticado', 401);
      }

      // 1b. Cliente directo/home owner (end_client de solo lectura) no pueden crear cotizaciones.
      if (req.userRole === 'end_client') {
        // eslint-disable-next-line global-require
        const { getEndClientCapabilities } = require('../../config/endClientCapabilities');
        let clientCategory = currentUser.clientCategory
          || (typeof currentUser.get === 'function' ? currentUser.get('clientCategory') : null) || null;
        if (!clientCategory && (currentUser.id || currentUser.objectId)) {
          try {
            const u = await new Parse.Query('AmexingUser').get(currentUser.id || currentUser.objectId, { useMasterKey: true });
            clientCategory = u.get('clientCategory') || null;
          } catch (e) { /* cae al default (solo lectura) */ }
        }
        if (!getEndClientCapabilities(clientCategory).createQuotes) {
          return this.sendError(res, 'Este tipo de cliente no puede crear cotizaciones', 403);
        }
      }

      // 2. Extract fields from request body
      const {
        client, clientId, clientType, clientFinalId, clientFinalName, contactPerson, contactEmail, contactPhone,
        contactFirstName, contactLastName, notes, lodging, eventType,
        leadGuestFirstName, leadGuestLastName,
        ownerId: initialOwnerId, // Propietario inicial elegido (solo admin/superadmin; se valida)
        numberOfAdults, numberOfChildren, numberOfInfants, preferredLanguage,
      } = req.body;

      // Normalize field names (accept both formats)
      const clientIdNormalized = client || clientId;

      // Debug: Log the received request data
      logger.info('QuoteController.createQuote - Request data received', {
        clientId,
        client,
        clientIdNormalized,
        clientType,
        requestBody: req.body,
        userId: currentUser.id,
      });

      // 3. Handle client field - DUAL FIELD ARCHITECTURE
      if (clientIdNormalized) {
        // Check if this is a direct Amexing client quote
        const isDirectClient = clientType === 'direct';

        logger.info('QuoteController.createQuote - Processing client logic', {
          clientIdNormalized,
          clientType,
          isDirectClient,
          userId: currentUser.id,
        });

        if (isDirectClient) {
          logger.info('QuoteController.createQuote - Entering DIRECT CLIENT logic branch', {
            clientId: clientIdNormalized,
            userId: currentUser.id,
          });
          // People-type clients now live in AmexingUser (role 'end_client'): store them in the
          // `client` pointer (AmexingUser), no companyClientPtr. Fall back to a legacy Client
          // record (clientBelongsTo='amexing') for pre-migration ids so old data still works.
          try {
            const userQuery = new Parse.Query('AmexingUser');
            const endClient = await userQuery.get(clientIdNormalized, { useMasterKey: true }).catch(() => null);

            if (endClient && endClient.get('role') === 'end_client') {
              clientObj = {
                __type: 'Pointer',
                className: 'AmexingUser',
                objectId: clientIdNormalized,
              };
              companyClientObj = null;
              logger.info('QuoteController.createQuote - Direct quote for end_client user', {
                clientId: clientIdNormalized,
              });
            } else {
              // Legacy direct Client (pre-migration).
              const clientQuery = new Parse.Query('Client');
              const clientRecord = await clientQuery.get(clientIdNormalized, { useMasterKey: true });
              if (clientRecord.get('clientBelongsTo') === 'amexing') {
                companyClientObj = {
                  __type: 'Pointer',
                  className: 'Client',
                  objectId: clientIdNormalized,
                };
                clientObj = null;
              } else {
                return this.sendError(res, 'El cliente seleccionado no es un cliente directo de Amexing', 400);
              }
            }
          } catch (error) {
            logger.error('QuoteController.createQuote - Error verifying direct client', {
              error: error.message,
              clientId: clientIdNormalized,
            });
            return this.sendError(res, 'Error al verificar el cliente', 500);
          }
        } else {
          logger.info('QuoteController.createQuote - Entering AGENCY CLIENT logic branch', {
            clientId: clientIdNormalized,
            userId: currentUser.id,
          });
          // Agency client - existing logic
          try {
            // 3a. Save as companyClientPtr (Client pointer) for new hierarchical system
            const companyClientPointer = {
              __type: 'Pointer',
              className: 'Client',
              objectId: clientIdNormalized,
            };

            // 3b. Find the AmexingUser who owns this Client for backward compatibility
            const clientQuery = new Parse.Query('Client');
            const clientRecord = await clientQuery.get(clientIdNormalized, { useMasterKey: true });
            const ownedByPointer = clientRecord.get('ownedBy');

            if (ownedByPointer) {
              // Extract the actual ID from the ownedBy pointer
              const ownerId = ownedByPointer.id || ownedByPointer.objectId || ownedByPointer;

              // Role-based logic for client field assignment
              let clientAmexingUserId;
              if (req.userRole === 'department_manager') {
                // Department manager: client field should be the department manager themselves
                clientAmexingUserId = currentUser.id;
                logger.info('QuoteController.createQuote - Department manager: setting client to currentUser', {
                  currentUserId: currentUser.id,
                  selectedClientId: clientIdNormalized,
                });
              } else {
                // Client role: client field should be the owner of the selected Client
                clientAmexingUserId = ownerId;
                logger.info('QuoteController.createQuote - Client role: setting client to Client owner', {
                  clientId: clientIdNormalized,
                  ownerId,
                });
              }

              // Create AmexingUser pointer for backward compatibility
              clientObj = {
                __type: 'Pointer',
                className: 'AmexingUser',
                objectId: clientAmexingUserId,
              };

              // Store both pointers - we'll set them after creating the quote object
              companyClientObj = companyClientPointer;
            } else {
              logger.warn('QuoteController.createQuote - Client has no owner', {
                clientId: clientIdNormalized,
              });
            }
          } catch (error) {
            logger.error('QuoteController.createQuote - Error setting client pointers', {
              error: error.message,
              clientId: clientIdNormalized,
            });

            // Fallback to old behavior if Client lookup fails
            clientObj = {
              __type: 'Pointer',
              className: 'AmexingUser',
              objectId: clientIdNormalized,
            };
          }
        }
      }

      // 4. Create createdBy pointer to current user (required)
      createdByObj = {
        __type: 'Pointer',
        className: 'AmexingUser',
        objectId: currentUser.id,
      };

      // 5. Generate unique folio
      const folio = await this.generateFolio();

      // 6. Create quote using Quote domain model (extends BaseModel)
      const quote = new Quote();

      // Debug: Log what objects will be set on the quote
      logger.info('QuoteController.createQuote - Setting quote client fields', {
        hasClientObj: !!clientObj,
        clientObj,
        hasCompanyClientObj: !!companyClientObj,
        companyClientObj,
        clientType,
        userId: currentUser.id,
      });

      // 7. Assign Parse objects (NOT string IDs!) - Using Pointer structure
      if (clientObj) {
        quote.set('client', clientObj); // AmexingUser pointer for backward compatibility
        logger.info('QuoteController.createQuote - Set client field', { clientObj });
      }
      if (companyClientObj) {
        quote.set('companyClientPtr', companyClientObj); // Client pointer for new hierarchical system
        logger.info('QuoteController.createQuote - Set companyClientPtr field', { companyClientObj });
      }
      // Note: Rate is no longer set at quote level (v2.0.0+)
      quote.set('createdBy', createdByObj); // Full Pointer object (required)

      // 7.5. Handle Cliente Final selection and contact data
      const finalContactData = {
        contactPerson: contactPerson || '',
        contactFirstName: contactFirstName || '',
        contactLastName: contactLastName || '',
        contactEmail: contactEmail || '',
        contactPhone: contactPhone || '',
      };

      // Cliente Final: los clientes (directos y de agencia) ahora viven en AmexingUser
      // (role 'end_client'); fallback a Client legado para data pre-migración.
      if (clientFinalId) {
        // Guardar la referencia SIEMPRE, aunque no se pueda leer su data de contacto.
        quote.set('clientFinalId', clientFinalId);
        try {
          let finalClientRecord = await new Parse.Query('AmexingUser')
            .get(clientFinalId, { useMasterKey: true }).catch(() => null);
          if (!finalClientRecord) {
            finalClientRecord = await new Parse.Query('Client')
              .get(clientFinalId, { useMasterKey: true }).catch(() => null);
          }

          if (finalClientRecord) {
            // Use final client's data for contact fields (unless explicitly overridden)
            finalContactData.contactFirstName = contactFirstName || finalClientRecord.get('firstName') || finalClientRecord.get('contactFirstName') || '';
            finalContactData.contactLastName = contactLastName || finalClientRecord.get('lastName') || finalClientRecord.get('contactLastName') || '';
            finalContactData.contactEmail = contactEmail || finalClientRecord.get('email') || '';
            finalContactData.contactPhone = contactPhone || finalClientRecord.get('phone') || '';

            if (!contactPerson && (finalContactData.contactFirstName || finalContactData.contactLastName)) {
              finalContactData.contactPerson = `${finalContactData.contactFirstName} ${finalContactData.contactLastName}`.trim();
            } else if (!contactPerson) {
              finalContactData.contactPerson = finalClientRecord.get('contactPerson') || finalClientRecord.get('name') || '';
            }

            logger.info('QuoteController.createQuote - Cliente Final data applied', {
              clientFinalId, userId: currentUser.id,
            });
          } else {
            logger.warn('QuoteController.createQuote - Cliente Final no encontrado (AmexingUser/Client)', { clientFinalId });
          }
        } catch (error) {
          logger.warn('QuoteController.createQuote - Error fetching Cliente Final data, using provided values', {
            error: error.message, clientFinalId, userId: currentUser.id,
          });
        }
      }

      // 8. Set basic fields
      quote.set('folio', folio);
      quote.set('contactPerson', finalContactData.contactPerson);
      quote.set('contactFirstName', finalContactData.contactFirstName);
      quote.set('contactLastName', finalContactData.contactLastName);
      quote.set('contactEmail', finalContactData.contactEmail);
      quote.set('contactPhone', finalContactData.contactPhone);
      quote.set('leadGuestFirstName', leadGuestFirstName || '');
      quote.set('leadGuestLastName', leadGuestLastName || '');
      // Cliente Final tecleado (no guardado como cliente): se persiste como texto libre.
      // Mutuamente excluyente con clientFinalId (el frontend envía solo uno con valor).
      quote.set('clientFinalName', clientFinalName || '');
      quote.set('notes', notes || '');
      quote.set('lodging', lodging || '');
      quote.set('eventType', eventType || '');

      // Set individual person counts
      const adultsCount = numberOfAdults ? parseInt(numberOfAdults, 10) : 0;
      const childrenCount = numberOfChildren ? parseInt(numberOfChildren, 10) : 0;
      const infantsCount = numberOfInfants ? parseInt(numberOfInfants, 10) : 0;

      quote.set('numberOfAdults', adultsCount);
      quote.set('numberOfChildren', childrenCount);
      quote.set('numberOfInfants', infantsCount);

      // Calculate total numberOfPeople as sum of all person types
      const calculatedTotal = adultsCount + childrenCount + infantsCount;
      quote.set('numberOfPeople', calculatedTotal);

      quote.set('preferredLanguage', preferredLanguage || 'es');

      // Set clientType for direct Amexing clients
      if (clientType === 'direct') {
        quote.set('clientType', 'direct');
      }

      // 9. Set automatic fields
      quote.set('status', 'quoted');
      // validUntil: 30 days from now
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + 30);
      quote.set('validUntil', validUntil);
      quote.set('active', true);
      quote.set('exists', true);

      // 10. Log what we're about to save (debugging)
      logger.info('Attempting to save quote with data:', {
        folio,
        clientPointer: clientObj,
        contactPerson: contactPerson || '',
        contactEmail: contactEmail || '',
        contactPhone: contactPhone || '',
        notes: notes || '',
        status: 'quoted',
        userId: currentUser.id,
      });

      // 11. Save with user context for audit trail
      await quote.save(null, {
        useMasterKey: true,
        context: {
          user: {
            objectId: currentUser.id,
            id: currentUser.id,
            email: currentUser.get('email'),
            username: currentUser.get('username') || currentUser.get('email'),
          },
        },
      });

      // 11a. Propietario inicial: admin/superadmin puede asignar otro usuario (validado contra los
      // owners disponibles del cliente); si no aplica o no es válido, el creador. createdBy siempre
      // queda como el creador real.
      let resolvedOwnerId = currentUser.id;
      const canAssignOwner = ['admin', 'superadmin'].includes(req.userRole);
      if (initialOwnerId && initialOwnerId !== currentUser.id && canAssignOwner) {
        try {
          const avail = await this.ownershipService.getAvailableOwnersForClientId({
            clientId: clientIdNormalized,
            clientType,
          });
          const list = Array.isArray(avail) ? avail : (avail && avail.users) || [];
          if (list.some((u) => u.id === initialOwnerId)) {
            resolvedOwnerId = initialOwnerId;
          } else {
            logger.warn('QuoteController.createQuote - ownerId no válido; se usa el creador', {
              initialOwnerId,
              clientId: clientIdNormalized,
            });
          }
        } catch (e) {
          logger.warn('QuoteController.createQuote - no se pudo validar ownerId; se usa el creador', { error: e.message });
        }
      }

      // 11b. Inicializar ownership (owner = elegido, createdBy = creador).
      await this.ownershipService.initializeOwnership(quote.id, resolvedOwnerId, currentUser.id);

      // 11c. Reflejar el owner elegido en el campo del quote (consistente con initializeOwnership).
      quote.set('owner', {
        __type: 'Pointer',
        className: 'AmexingUser',
        objectId: resolvedOwnerId,
      });
      await quote.save(null, { useMasterKey: true });

      // 12. Log success (using Pointer objects - IDs only)
      logger.info('Quote created successfully with ownership', {
        quoteId: quote.id,
        folio,
        clientId: clientObj ? clientObj.objectId : null,
        createdBy: currentUser.id,
        ownerId: currentUser.id,
        createdByEmail: currentUser.get('email'),
      });

      // 13. Return success response (using Pointer objects - IDs only)
      const data = {
        id: quote.id,
        folio,
        clientId: clientObj ? clientObj.objectId : null,
        contactPerson: contactPerson || '',
        contactEmail: contactEmail || '',
        contactPhone: contactPhone || '',
        notes: notes || '',
        status: 'quoted',
        validUntil: validUntil.toISOString(),
        active: true,
      };

      return this.sendSuccess(res, data, 'Cotización creada exitosamente', 201);
    } catch (error) {
      logger.error('Error in QuoteController.createQuote - DETAILED ERROR:', {
        errorMessage: error.message,
        errorCode: error.code,
        errorName: error.name,
        errorToString: error.toString(),
        parseErrorCode: error.code,
        stack: error.stack,
        userId: req.user?.id,
        requestBody: req.body,
        clientPointerAttempted: clientObj,
      });

      // Return more detailed error message
      const errorMsg = error.message || 'Error al crear la cotización';
      return this.sendError(res, `Error al crear la cotización: ${errorMsg}`, 500);
    }
  }

  /**
   * GET /api/quotes - Get quotes with DataTables server-side processing.
   * Now supports role-based filtering for department managers.
   *
   * Query Parameters (DataTables format):
   * - draw: Draw counter for DataTables
   * - start: Starting record number
   * - length: Number of records to return
   * - search[value]: Search term
   * - order[0][column]: Column index to sort
   * - order[0][dir]: Sort direction (asc/desc).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // DataTables will call this endpoint automatically
   */
  async getQuotes(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Parse DataTables parameters
      const draw = parseInt(req.query.draw, 10) || 1;
      const searchValue = req.query.search?.value || '';
      const sortColumnIndex = parseInt(req.query.order?.[0]?.column, 10) || 0;
      const sortDirection = req.query.order?.[0]?.dir || 'desc';
      const dateFilter = req.query.dateFilter || 'future';
      const statusFilter = req.query.statusFilter || null;

      // Agency/Client filter (molecule client-agency-filter). On quotes the link is
      // direct: 'agency' → quote.client (AmexingUser); 'client' → quote.companyClientPtr (Client).
      // Empty type = no filter; with type but no id, filter by type. With id, by entity.
      // '', 'agency', 'client', o una categoría de persona (wedding_planner/concierge/home_owner)
      const clientTypeFilter = req.query.clientTypeFilter || '';
      const clientIdFilter = req.query.clientIdFilter || '';
      // Mapea el tipo de filtro de persona → clientCategory en AmexingUser.
      // 'client' = clientes directos; las categorías especiales usan su propio nombre.
      const PERSON_CATEGORY_BY_FILTER = {
        client: 'direct_client',
        wedding_planner: 'wedding_planner',
        concierge: 'concierge',
        home_owner: 'home_owner',
      };
      /**
       * Apply the agency/client filter to a quotes query based on the request's
       * clientTypeFilter and clientIdFilter. For 'agency' it filters on the
       * AmexingUser pointer (quote.client, clientType != 'direct'); for 'client'
       * and the specialty person categories (wedding_planner/concierge/home_owner)
       * it filters on quote.client (AmexingUser end_client, clientType 'direct')
       * scoped by clientCategory. With no ID, filters by type/category presence.
       * Mutates the query in place; no-op when no valid type filter is set.
       * @param {Parse.Query} q - The quotes query to constrain.
       * @returns {void}
       * @example
       *   applyQuoteClientFilter(query); // narrows query to the selected agency/client
       */
      const applyQuoteClientFilter = (q) => {
        const personCategory = PERSON_CATEGORY_BY_FILTER[clientTypeFilter];
        if (clientTypeFilter !== 'agency' && !personCategory) return;
        if (personCategory) {
          // Clientes directos y categorías especiales (wedding_planner/concierge/
          // home_owner): viven en quote.client (AmexingUser end_client) con
          // clientType 'direct'. (Antes eran companyClientPtr → Client legado, ya migrado.)
          if (clientIdFilter) {
            const UserCls = Parse.Object.extend('AmexingUser');
            const u = new UserCls();
            u.id = clientIdFilter;
            q.equalTo('client', u);
            q.equalTo('clientType', 'direct');
          } else {
            // Sin id: acota a la categoría seleccionada (direct_client / wedding_planner
            // / concierge / home_owner) vía subquery sobre el pointer client.
            const innerClient = new Parse.Query('AmexingUser');
            innerClient.equalTo('clientCategory', personCategory);
            q.matchesQuery('client', innerClient);
            q.equalTo('clientType', 'direct');
          }
        } else if (clientIdFilter) {
          const UserCls = Parse.Object.extend('AmexingUser');
          const u = new UserCls();
          u.id = clientIdFilter;
          q.equalTo('client', u);
        } else {
          // Agencia = tiene client (AmexingUser) y NO es directo.
          q.exists('client');
          q.notEqualTo('clientType', 'direct');
        }
      };

      // Column mapping for sorting (must match frontend columns exactly)
      // Frontend columns depend on user role (admin/superadmin show client column)
      const isAdminRole = ['admin', 'superadmin'].includes(req.userRole);

      // Build columns array to match frontend table structure
      let columns;
      if (isAdminRole) {
        // With client column: Folio, Mi Rol, Cliente, Tipo de Evento, No. Personas, Creado Por, Estatus, Fecha Creación, Última Modificación
        columns = ['folio', 'userQuoteRole', 'client', 'eventType', 'numberOfPeople', 'createdBy', 'status', 'createdAt', 'updatedAt'];
      } else {
        // Without client column: Folio, Mi Rol, Tipo de Evento, No. Personas, Creado Por, Estatus, Fecha Creación, Última Modificación
        columns = ['folio', 'userQuoteRole', 'eventType', 'numberOfPeople', 'createdBy', 'status', 'createdAt', 'updatedAt'];
      }

      const sortField = columns[sortColumnIndex] || 'createdAt';

      // Use the same base query logic as the counter for perfect consistency
      const baseQuery = await this.buildBaseQuoteQuery(currentUser, req.userRole, statusFilter);
      applyQuoteClientFilter(baseQuery);

      // Get total records count using same base query logic
      const totalRecordsQuery = await this.buildBaseQuoteQuery(currentUser, req.userRole, statusFilter);
      const recordsTotal = await totalRecordsQuery.count({
        useMasterKey: true,
      });

      // Build filtered query with search
      let filteredQuery = baseQuery;
      if (searchValue) {
        // Search in folio, client name, or contact person using same base query logic
        const folioQuery = await this.buildBaseQuoteQuery(currentUser, req.userRole, statusFilter);
        folioQuery.matches('folio', searchValue, 'i');
        applyQuoteClientFilter(folioQuery);

        const contactQuery = await this.buildBaseQuoteQuery(currentUser, req.userRole, statusFilter);
        contactQuery.matches('contactPerson', searchValue, 'i');
        applyQuoteClientFilter(contactQuery);

        filteredQuery = Parse.Query.or(folioQuery, contactQuery);
        filteredQuery.include('client');
        filteredQuery.include('companyClientPtr');
        filteredQuery.include('rate');
        filteredQuery.include('createdBy');
        filteredQuery.include('owner');
        filteredQuery.include('serviceItems');
      }

      // Apply sorting
      if (sortDirection === 'asc') {
        filteredQuery.ascending(sortField);
      } else {
        filteredQuery.descending(sortField);
      }

      // La tabla del front es client-side (serverSide:false): el navegador hace paginación,
      // búsqueda y orden. Por eso el servidor debe devolver TODAS las cotizaciones que pasan el
      // filtro de estado + el filtro de fecha (este último se aplica en JS más abajo porque la
      // fecha vive dentro de serviceItems.days[].date y Parse no la puede consultar). Antes se
      // aplicaba skip/limit ANTES del filtro de fecha, así que las cotizaciones cuya fecha caía
      // fuera del lote paginado (p. ej. folios bajos con el orden por folio desc) desaparecían
      // de "Actuales/Anteriores" y ni el buscador client-side las encontraba.
      filteredQuery.limit(10000);

      // Execute query
      const quotes = await filteredQuery.find({ useMasterKey: true });

      // DEBUGGING: Check if specific quote is in results
      console.log('=== QUOTES RETURNED FROM DATABASE ===');
      console.log('Total quotes found:', quotes.length);
      console.log('User role:', req.userRole);
      console.log('Current user ID:', currentUser.id);
      const quoteFolios = quotes.map((q) => q.get('folio')).filter((f) => f);
      console.log('Quote folios returned:', quoteFolios);

      // Check for the specific problematic quote
      const problemQuote = quotes.find((q) => q.id === 'pVYlMjqbfa');
      if (problemQuote) {
        console.log('🚨 PROBLEMATIC QUOTE FOUND IN RESULTS!');
        console.log('Quote folio:', problemQuote.get('folio'));
        console.log('Quote createdBy:', problemQuote.get('createdBy')?.id);
        console.log('Quote client:', problemQuote.get('client')?.id);
      }

      // Resolver el nombre del Cliente Final (clientFinalId es un string, no pointer) en un solo
      // query por lote, para la columna "Cliente Final" de la tabla. Cubre AmexingUser y Client.
      const finalClientIds = [...new Set(quotes.map((q) => q.get('clientFinalId')).filter(Boolean))];
      const finalClientNameById = {};
      if (finalClientIds.length) {
        const auQ = new Parse.Query('AmexingUser');
        auQ.containedIn('objectId', finalClientIds);
        auQ.limit(finalClientIds.length);
        const clQ = new Parse.Query('Client');
        clQ.containedIn('objectId', finalClientIds);
        clQ.limit(finalClientIds.length);
        const [aus, cls] = await Promise.all([
          auQ.find({ useMasterKey: true }).catch(() => []),
          clQ.find({ useMasterKey: true }).catch(() => []),
        ]);
        [...aus, ...cls].forEach((u) => {
          const fn = `${u.get('firstName') || ''} ${u.get('lastName') || ''}`.trim();
          finalClientNameById[u.id] = u.get('companyName') || fn || u.get('email') || '';
        });
      }

      // Format data for DataTables and check for pending invoice requests
      const data = await Promise.all(
        quotes.map(async (quote) => {
          const client = quote.get('client');
          const companyClientPtr = quote.get('companyClientPtr');
          const rate = quote.get('rate');
          const createdBy = quote.get('createdBy');
          // Current owner: denormalized 'owner' pointer (updated on transfers),
          // falling back to the creator (default owner) when there is no owner
          // or it didn't resolve to a usable name (e.g. deleted user).
          const ownerPtr = quote.get('owner');
          const owner = (ownerPtr && (ownerPtr.get('firstName') || ownerPtr.get('lastName') || ownerPtr.get('email')))
            ? ownerPtr
            : createdBy;

          // Check if quote has pending invoice request
          let hasPendingInvoiceRequest = false;
          try {
            hasPendingInvoiceRequest = await this.quoteService.hasPendingInvoiceRequest(quote.id);
          } catch (error) {
            logger.warn('Error checking pending invoice request', { quoteId: quote.id, error: error.message });
          }

          // Determine user's role for this specific quote
          let userQuoteRole = 'visualizador'; // Default to viewer
          let userQuoteRoleSpanish = 'Visualizador';

          try {
            // Check if user is the owner
            const currentOwnership = await QuoteOwnership.getCurrentOwnership(quote);
            const isOwner = currentOwnership && currentOwnership.getOwner()?.id === currentUser.id;

            if (isOwner) {
              userQuoteRole = 'propietario';
              userQuoteRoleSpanish = 'Propietario';
            } else if (createdBy && createdBy.id === currentUser.id) {
              // Check if user created the quote (legacy ownership)
              userQuoteRole = 'propietario';
              userQuoteRoleSpanish = 'Propietario';
            } else {
              // Check collaboration access
              const userAccess = await this.collaborationService.getUserAccess(quote.id, currentUser.id);
              if (userAccess && userAccess.role) {
                if (userAccess.role === 'editor') {
                  userQuoteRole = 'editor';
                  userQuoteRoleSpanish = 'Editor';
                } else if (userAccess.role === 'viewer') {
                  userQuoteRole = 'visualizador';
                  userQuoteRoleSpanish = 'Visualizador';
                }
              }
            }
          } catch (roleError) {
            logger.warn('Error determining user role for quote', {
              quoteId: quote.id,
              userId: currentUser.id,
              error: roleError.message,
            });
            // Keep default viewer role on error
          }

          // Extract company name from all possible sources
          let companyName = '';
          let clientData = null;

          if (client) {
            // Check contextualData first, then direct companyName field
            const contextualData = client.get('contextualData') || {};
            companyName = contextualData.companyName
              || client.get('companyName')
              || '';

            clientData = {
              id: client.id,
              firstName: client.get('firstName') || '',
              lastName: client.get('lastName') || '',
              companyName,
              fullName: companyName || `${client.get('firstName') || ''} ${client.get('lastName') || ''}`.trim(),
              contextualData: client.get('contextualData') || null,
            };
          }

          // If no company name from client, check companyClientPtr
          if (!companyName && companyClientPtr) {
            companyName = companyClientPtr.get('name') || '';

            // If we have companyClientPtr but no client, create client data from it
            if (!clientData) {
              clientData = {
                id: companyClientPtr.id,
                firstName: '',
                lastName: '',
                companyName,
                fullName: companyName,
              };
            } else {
              // Update existing client data with company name from companyClientPtr
              clientData.companyName = companyName;
              clientData.fullName = companyName || clientData.fullName;
            }
          }

          return {
            id: quote.id,
            objectId: quote.id,
            folio: quote.get('folio') || 'N/A',
            userQuoteRole, // Add user's role for this quote
            userQuoteRoleSpanish, // Add Spanish role name
            client: clientData,
            rate: rate
              ? {
                id: rate.id,
                name: rate.get('name') || 'N/A',
                color: rate.get('color') || '#6366F1',
              }
              : null,
            eventType: quote.get('eventType') || '',
            numberOfPeople: quote.get('numberOfPeople') || 0,
            numberOfAdults: quote.get('numberOfAdults') || 0,
            numberOfChildren: quote.get('numberOfChildren') || 0,
            numberOfInfants: quote.get('numberOfInfants') || 0,
            createdBy: createdBy
              ? {
                id: createdBy.id,
                firstName: createdBy.get('firstName') || '',
                lastName: createdBy.get('lastName') || '',
                email: createdBy.get('email') || '',
                fullName: `${createdBy.get('firstName') || ''} ${createdBy.get('lastName') || ''}`.trim(),
              }
              : null,
            owner: owner
              ? {
                id: owner.id,
                firstName: owner.get('firstName') || '',
                lastName: owner.get('lastName') || '',
                email: owner.get('email') || '',
                phone: owner.get('phone') || '',
                fullName: `${owner.get('firstName') || ''} ${owner.get('lastName') || ''}`.trim(),
                isMe: !!(currentUser && owner.id === currentUser.id),
              }
              : null,
            status: quote.get('status') || 'quoted',
            contactPerson: quote.get('contactPerson') || '',
            contactFirstName: quote.get('contactFirstName') || '',
            contactLastName: quote.get('contactLastName') || '',
            contactEmail: quote.get('contactEmail') || '',
            contactPhone: quote.get('contactPhone') || '',
            leadGuestFirstName: quote.get('leadGuestFirstName') || '',
            leadGuestLastName: quote.get('leadGuestLastName') || '',
            notes: quote.get('notes') || '',
            lodging: quote.get('lodging') || '',
            clientFinalId: quote.get('clientFinalId') || null,
            clientFinalName: quote.get('clientFinalName') || '',
            // Nombre a mostrar del Cliente Final: cliente resuelto por id, o texto libre tecleado.
            clientFinalDisplay: (quote.get('clientFinalId') && finalClientNameById[quote.get('clientFinalId')])
              || quote.get('clientFinalName') || '',
            validUntil: quote.get('validUntil'),
            active: quote.get('active'),
            hasPendingInvoiceRequest, // Add invoice status
            serviceCount: (() => {
              const si = quote.get('serviceItems');
              if (!si || !si.days) return 0;
              return si.days.reduce((sum, d) => sum + (d.subconcepts ? d.subconcepts.length : 0), 0);
            })(),
            dayCount: (() => {
              const si = quote.get('serviceItems');
              return (si && si.days) ? si.days.length : 0;
            })(),
            serviceItems: quote.get('serviceItems') || {
              days: [],
              subtotal: 0,
              iva: 0,
              total: 0,
            },
            createdAt: quote.createdAt,
            updatedAt: quote.updatedAt,
          };
        })
      );

      // Apply date filtering to the data array
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Start of today

      const filteredData = data.filter((quote) => {
        const serviceItems = quote.serviceItems || {};
        const days = serviceItems.days || [];

        // Check if quote has no services or no valid dates
        const hasNoServices = days.length === 0;
        let hasValidDates = false;
        let earliestDate = null;
        let latestDate = null;

        // Calculate earliest and latest service dates
        for (const day of days) {
          if (day.date) {
            hasValidDates = true;
            const serviceDate = new Date(`${day.date}T12:00:00`);
            if (!earliestDate || serviceDate < earliestDate) {
              earliestDate = serviceDate;
            }
            if (!latestDate || serviceDate > latestDate) {
              latestDate = serviceDate;
            }
          }
        }

        if (dateFilter === 'no-services') {
          // Show only quotes without services or without valid dates
          return hasNoServices || !hasValidDates;
        }

        if (hasNoServices || !hasValidDates) {
          // Quotes without services should not appear in future/previous filters
          return false;
        }

        if (dateFilter === 'future') {
          // Show quotes where the earliest service date is today or in the future
          return earliestDate >= today;
        } if (dateFilter === 'previous') {
          // Show quotes where the latest service date has passed
          return latestDate < today;
        }

        return true;
      });

      // Update recordsFiltered count for DataTables based on date filtering

      // Count statuses from the same filtered data that the DataTable will show
      const statusCounts = {
        quoted: 0,
        requested: 0,
      };

      filteredData.forEach((quote) => {
        if (quote.status === 'quoted') {
          statusCounts.quoted++;
        } else if (quote.status === 'requested') {
          statusCounts.requested++;
        }
      });

      // DataTables response format
      const response = {
        success: true,
        draw,
        recordsTotal,
        recordsFiltered: filteredData.length,
        data: filteredData,
        statusCounts, // Include status counts for the UI
      };

      return res.json(response);
    } catch (error) {
      logger.error('Error in QuoteController.getQuotes', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al obtener las cotizaciones',
        500
      );
    }
  }

  /**
   * GET /api/quotes/:id - Get quote by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getQuoteById(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const quoteId = req.params.id;
      if (!quoteId) {
        return this.sendError(res, 'El ID de la cotización es requerido', 400);
      }

      // Query quote with includes
      const query = new Parse.Query('Quote');
      query.include('client');
      query.include('companyClientPtr');
      query.include('rate');
      query.include('createdBy');
      query.equalTo('exists', true);

      const quote = await query.get(quoteId, { useMasterKey: true });

      if (!quote) {
        return this.sendError(res, 'Cotización no encontrada', 404);
      }

      // Acceso + ownership: las 3 consultas solo dependen de quoteId y son independientes entre
      // sí, así que se piden EN PARALELO en vez de en serie (antes sumaban ~0.6-1.2 s al request
      // más lento). El fallback legacy (que necesita el objeto quote) queda condicional debajo.
      const [hasAccess, userAccess, owner] = await Promise.all([
        this.collaborationService.hasAccess(quoteId, currentUser.id),
        this.collaborationService.getUserAccess(quoteId, currentUser.id),
        this.ownershipService.getCurrentOwner(quoteId),
      ]);

      // Check access permissions after getting the quote using collaboration service
      if (!hasAccess) {
        // Fallback to original check for backward compatibility
        const hasLegacyAccess = await this.checkQuoteAccess(currentUser, quote, req.userRole);
        if (!hasLegacyAccess) {
          return this.sendError(res, 'No tienes permisos para acceder a esta cotización', 403);
        }
      }

      const client = quote.get('client');
      const companyClientPtr = quote.get('companyClientPtr');
      const rate = quote.get('rate');
      const createdBy = quote.get('createdBy');

      // DEBUG: Log what we're getting for client and companyClientPtr
      logger.info('DEBUG getQuoteById - client data:', {
        quoteId: quote.id,
        folio: quote.get('folio'),
        clientRaw: client,
        clientId: client ? client.id : null,
        clientKeys: client ? Object.keys(client.attributes || {}) : null,
        hasClientPointer: !!quote.get('client'),
        companyClientPtrRaw: companyClientPtr,
        companyClientPtrId: companyClientPtr ? companyClientPtr.id : null,
        companyClientPtrKeys: companyClientPtr ? Object.keys(companyClientPtr.attributes || {}) : null,
        hasCompanyClientPointer: !!quote.get('companyClientPtr'),
      });

      const data = {
        id: quote.id,
        folio: quote.get('folio'),
        clientType: quote.get('clientType') || null,
        client: client
          ? {
            id: client.id,
            firstName: client.get('firstName') || '',
            lastName: client.get('lastName') || '',
            companyName: client.get('contextualData')?.companyName || client.get('name') || '',
            email: client.get('email') || '',
            phone: client.get('phone') || '',
            fullName: client.get('contextualData')?.companyName || client.get('name') || `${client.get('firstName') || ''} ${client.get('lastName') || ''}`.trim(),
            contextualData: client.get('contextualData') || null,
          }
          : null,
        companyClientPtr: companyClientPtr
          ? {
            id: companyClientPtr.id,
            name: companyClientPtr.get('name') || '',
            email: companyClientPtr.get('email') || '',
            phone: companyClientPtr.get('phone') || '',
            contactPerson: companyClientPtr.get('contactPerson') || null,
            fullName: companyClientPtr.get('name') || '',
          }
          : null,
        rate: rate
          ? {
            id: rate.id,
            name: rate.get('name'),
            color: rate.get('color'),
          }
          : null,
        eventType: quote.get('eventType') || '',
        numberOfPeople: quote.get('numberOfPeople') || 0,
        numberOfAdults: quote.get('numberOfAdults') || 0,
        numberOfChildren: quote.get('numberOfChildren') || 0,
        numberOfInfants: quote.get('numberOfInfants') || 0,
        preferredLanguage: quote.get('preferredLanguage') || 'es',
        contactPerson: quote.get('contactPerson') || '',
        contactFirstName: quote.get('contactFirstName') || '',
        contactLastName: quote.get('contactLastName') || '',
        contactEmail: quote.get('contactEmail') || '',
        contactPhone: quote.get('contactPhone') || '',
        leadGuestFirstName: quote.get('leadGuestFirstName') || '',
        leadGuestLastName: quote.get('leadGuestLastName') || '',
        notes: quote.get('notes') || '',
        lodging: quote.get('lodging') || '',
        clientFinalId: quote.get('clientFinalId') || null,
        clientFinalName: quote.get('clientFinalName') || '',
        status: quote.get('status') || 'quoted',
        validUntil: quote.get('validUntil'),
        serviceItems: quote.get('serviceItems') || {
          days: [],
          subtotal: 0,
          iva: 0,
          total: 0,
        },
        createdBy: createdBy
          ? {
            id: createdBy.id,
            firstName: createdBy.get('firstName') || '',
            lastName: createdBy.get('lastName') || '',
            email: createdBy.get('email') || '',
            fullName: `${createdBy.get('firstName') || ''} ${createdBy.get('lastName') || ''}`.trim(),
          }
          : null,
        active: quote.get('active'),
        createdAt: quote.createdAt,
        updatedAt: quote.updatedAt,
        // Add ownership and collaboration info
        owner,
        userAccess,
        version: quote.get('version') || 1,
        collaborationEnabled: quote.isCollaborationEnabled(),
        requiresApproval: quote.requiresApproval(),
      };

      // Batch fetch primary images for tours and experiences in serviceItems
      const tourIds = [];
      const experienceIds = [];
      (data.serviceItems.days || []).forEach((day) => {
        (day.subconcepts || []).forEach((sc) => {
          if (sc.tourId) tourIds.push(sc.tourId);
          if (sc.experienceId) experienceIds.push(sc.experienceId);
        });
      });

      const [tourImageMap, expImageMap] = await Promise.all([
        batchFetchPrimaryImages('TourImage', 'tourId', 'Tour', [...new Set(tourIds)]),
        batchFetchPrimaryImages('ExperienceImage', 'experienceId', 'Experience', [...new Set(experienceIds)]),
      ]);

      // Inject imageUrl into each subconcept
      data.serviceItems.days.forEach((day) => {
        (day.subconcepts || []).forEach((sc) => {
          if (sc.tourId && tourImageMap[sc.tourId]) {
            Object.assign(sc, { imageUrl: tourImageMap[sc.tourId] });
          } else if (sc.experienceId && expImageMap[sc.experienceId]) {
            Object.assign(sc, { imageUrl: expImageMap[sc.experienceId] });
          }
        });
      });

      // Enrich tour/experience subconcepts with "incluye" / "no incluye" text
      await injectServiceIncludes(data.serviceItems);

      // Fetch and merge suggested departure times from ReservationService records
      await this.mergeSuggestedDepartureTimes(data);

      // Resolve the final client's name (Lead Guest falls back to it when no
      // explicit lead guest is set).
      data.clientFinal = null;
      if (data.clientFinalId) {
        try {
          // Cliente final ahora vive en AmexingUser (end_client); fallback a Client legado.
          let cf = await new Parse.Query('AmexingUser').get(data.clientFinalId, { useMasterKey: true }).catch(() => null);
          if (!cf) cf = await new Parse.Query('Client').get(data.clientFinalId, { useMasterKey: true }).catch(() => null);
          if (!cf) throw new Error('Cliente final no encontrado');
          const companyName = cf.get('contextualData')?.companyName || '';
          const firstName = cf.get('firstName') || cf.get('contactFirstName') || '';
          const lastName = cf.get('lastName') || cf.get('contactLastName') || '';
          const name = cf.get('name') || '';
          data.clientFinal = {
            id: cf.id,
            firstName,
            lastName,
            name,
            companyName,
            fullName: companyName || name || `${firstName} ${lastName}`.trim(),
          };
        } catch (cfError) {
          logger.warn('Failed to resolve clientFinal name', {
            quoteId: quote.id,
            clientFinalId: data.clientFinalId,
            error: cfError.message,
          });
        }
      }

      return res.json({
        success: true,
        data,
      });
    } catch (error) {
      logger.error('Error in QuoteController.getQuoteById', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al obtener la cotización',
        500
      );
    }
  }

  /**
   * PUT /api/quotes/:id - Update quote.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Update quote status
   */
  async updateQuote(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const quoteId = req.params.id;
      const updates = req.body;

      // Debug current user information
      logger.info('🔍 QuoteController.updateQuote - User check', {
        userId: currentUser.id,
        userEmail: currentUser.get('email'),
        userRole: req.userRole || 'unknown',
        quoteId,
        updates: Object.keys(updates),
      });

      // Check if user has permission to edit
      let canEdit = await this.versioningService.canEdit(quoteId, currentUser.id);

      // ADMIN FIX: Handle role pointer to get actual role name
      const rolePointer = currentUser.get('roleId');
      let roleName = null;

      if (rolePointer && rolePointer.id) {
        try {
          // Fetch the role from the Role table
          await rolePointer.fetch({ useMasterKey: true });
          roleName = rolePointer.get('name');
        } catch (roleError) {
          logger.warn('Failed to fetch user role', {
            userId: currentUser.id,
            roleError: roleError.message,
          });
        }
      }

      // Role override check - allow admin, superadmin, department_manager, and client roles
      if (!canEdit && (roleName === 'admin' || roleName === 'superadmin' || roleName === 'department_manager' || roleName === 'client')) {
        logger.info('🔓 Controller-level role override granted', {
          userId: currentUser.id,
          roleName,
          rolePointerId: rolePointer?.id,
          quoteId,
        });
        canEdit = true;
      }

      logger.info('🔍 QuoteController.updateQuote - Permission result', {
        userId: currentUser.id,
        quoteId,
        canEdit,
        userRole: req.userRole || 'unknown',
      });

      if (!canEdit) {
        // Enhanced debugging for 403 errors
        const debugRolePointer = currentUser.get('roleId');
        let debugRoleName = 'unknown';
        if (debugRolePointer && debugRolePointer.id) {
          try {
            await debugRolePointer.fetch({ useMasterKey: true });
            debugRoleName = debugRolePointer.get('name');
          } catch (e) {
            logger.warn('Failed to fetch role in 403 debug', { error: e.message });
          }
        }

        logger.error('🚫 QuoteController.updateQuote - PERMISSION DENIED (403)', {
          userId: currentUser.id,
          userEmail: currentUser.get('email'),
          userFirstName: currentUser.get('firstName'),
          userLastName: currentUser.get('lastName'),
          userRole: req.userRole || 'unknown',
          debugRoleName,
          rolePointer: debugRolePointer?.id,
          quoteId,
          updates: Object.keys(updates),
          hasRoleObject: !!req.roleObject,
          jwtRole: req.userRole,
          requestUrl: req.url,
          requestMethod: req.method,
          userAgent: req.headers['user-agent'],
          ip: req.ip || req.connection.remoteAddress,
          timestamp: new Date().toISOString(),
        });

        return this.sendError(res, `Access denied: You don't have permission to edit this quote. Role: ${roleName || req.userRole || 'unknown'}`, 403);
      }

      // Check if this is a status-only update to skip versioning
      const updateKeys = Object.keys(updates);
      const isStatusOnlyUpdate = updateKeys.length <= 2
        && updateKeys.includes('status')
        && updateKeys.every((key) => ['status', 'reason'].includes(key));

      // Track the edit with versioning service (skip for status-only updates)
      let editRecord = null;
      if (!isStatusOnlyUpdate) {
        editRecord = await this.versioningService.recordEdit(
          quoteId,
          currentUser.id,
          updates,
          {
            description: updates.reason || 'Quote updated',
          }
        );
      } else {
        logger.info('🔄 Skipping versioning for status-only update', {
          userId: currentUser.id,
          quoteId,
          updateKeys,
          status: updates.status,
        });
      }

      // Handle clientFinalId if it's being updated
      if (updates.clientFinalId !== undefined) {
        if (updates.clientFinalId) {
          // If setting a new clientFinalId, fetch Client data for contact fields
          try {
            const finalClientQuery = new Parse.Query('Client');
            const finalClientRecord = await finalClientQuery.get(updates.clientFinalId, { useMasterKey: true });

            // Update contact fields from Cliente Final data (unless explicitly overridden in updates)
            if (!updates.contactFirstName && !updates.contactLastName && !updates.contactPerson) {
              updates.contactFirstName = finalClientRecord.get('firstName') || finalClientRecord.get('contactFirstName') || '';
              updates.contactLastName = finalClientRecord.get('lastName') || finalClientRecord.get('contactLastName') || '';

              if (!updates.contactPerson) {
                updates.contactPerson = `${updates.contactFirstName} ${updates.contactLastName}`.trim()
                                        || finalClientRecord.get('contactPerson') || finalClientRecord.get('name') || '';
              }
            }

            if (!updates.contactEmail) {
              updates.contactEmail = finalClientRecord.get('email') || '';
            }
            if (!updates.contactPhone) {
              updates.contactPhone = finalClientRecord.get('phone') || '';
            }

            logger.info('QuoteController.updateQuote - Updated contact fields from Cliente Final', {
              quoteId,
              clientFinalId: updates.clientFinalId,
              contactData: {
                contactFirstName: updates.contactFirstName,
                contactLastName: updates.contactLastName,
                contactEmail: updates.contactEmail,
                contactPhone: updates.contactPhone,
              },
              userId: currentUser.id,
            });
          } catch (error) {
            logger.warn('QuoteController.updateQuote - Error fetching Cliente Final data for update', {
              error: error.message,
              clientFinalId: updates.clientFinalId,
              userId: currentUser.id,
            });
          }
        } else {
          // If clearing clientFinalId, don't automatically clear contact fields
          // The user might want to keep the contact data
          logger.info('QuoteController.updateQuote - Clearing clientFinalId', {
            quoteId,
            userId: currentUser.id,
          });
        }
      }

      // If status is being updated, always use the reliable status update method (same as admin)
      // This ensures consistent reservation creation logic between admin and department manager flows
      if (updates.status) {
        // updateQuoteStatus only changes the status, so any general-info fields
        // sent alongside it (contact, lead guest, people, notes, eventType, etc.)
        // would be dropped. Persist them first via updateQuote — which also syncs
        // the linked reservation's info. Isolated so it never blocks the status change.
        const infoUpdates = { ...updates };
        delete infoUpdates.status;
        delete infoUpdates.reason;
        if (Object.keys(infoUpdates).length > 0) {
          try {
            await this.quoteService.updateQuote(
              currentUser,
              quoteId,
              infoUpdates,
              updates.reason || 'Quote info updated',
              req.userRole
            );
          } catch (infoError) {
            logger.error('Failed to persist general info alongside status change', {
              quoteId,
              error: infoError.message,
            });
          }
        }

        logger.info('🔄 Status change detected, delegating to updateQuoteStatus', {
          quoteId,
          status: updates.status,
          reason: updates.reason,
          userId: currentUser.id,
          userRole: req.userRole,
        });

        const result = await this.quoteService.updateQuoteStatus(
          currentUser,
          quoteId,
          updates.status,
          updates.reason || 'Status updated',
          req.userRole
        );

        // Timeline (Fase A): registrar el cambio de estado en un texto legible.
        if (result && result.success !== false) {
          const STATUS_LABELS = {
            quoted: 'COTIZADO',
            requested: 'SOLICITADO',
            hold: 'BLOQUEADO',
            scheduled: 'AGENDADO',
            rejected: 'RECHAZADO',
            cancelled: 'CANCELADO',
          };
          await QuoteActivityService.log({
            quoteId,
            actor: currentUser,
            actorRole: req.userRole,
            action: 'status_changed',
            summary: `cambió el estado a ${STATUS_LABELS[updates.status] || updates.status}`,
            meta: { status: updates.status },
          });
        }

        // Add edit tracking info to result (handle null editRecord for status-only updates)
        if (editRecord) {
          result.editId = editRecord.id;
          result.version = editRecord.version;
          result.requiresApproval = editRecord.approvalStatus === 'pending';
        } else {
          // Status-only update, no edit record
          result.editId = null;
          result.version = null;
          result.requiresApproval = false;
        }

        return res.json(result);
      }

      // Call original service for backward compatibility
      const result = await this.quoteService.updateQuote(
        currentUser,
        quoteId,
        updates,
        updates.reason || 'Quote updated',
        req.userRole // Pass userRole from JWT middleware
      );

      // Add edit tracking info to result
      result.editId = editRecord.id;
      result.version = editRecord.version;
      result.requiresApproval = editRecord.approvalStatus === 'pending';

      // Timeline (Fase B1): edición de datos generales (personas/fechas/cliente/notas).
      const FIELD_LABELS = {
        numberOfPeople: 'personas',
        eventType: 'tipo de evento',
        startDate: 'fechas',
        endDate: 'fechas',
        eventDate: 'fechas',
        clientFinalId: 'cliente final',
        clientFinalName: 'cliente final',
        clientType: 'tipo de cliente',
        notes: 'notas',
        clientNotes: 'notas',
      };
      const changedKeys = Object.keys(updates).filter((k) => k !== 'reason' && k !== 'status');
      const changedLabels = [...new Set(changedKeys.map((k) => FIELD_LABELS[k]).filter(Boolean))];
      if (changedLabels.length) {
        await QuoteActivityService.log({
          quoteId,
          actor: currentUser,
          actorRole: req.userRole,
          action: 'quote_edited',
          summary: `editó la cotización (${changedLabels.join(', ')})`,
          meta: { fields: Object.keys(updates).filter((k) => k !== 'reason') },
        });
      }

      return res.json(result);
    } catch (error) {
      logger.error('Error in QuoteController.updateQuote', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al actualizar la cotización',
        500
      );
    }
  }

  /**
   * POST /api/quotes/:id/duplicate - Duplicate an existing quote.
   * Creates a copy of a quote with:
   * - New auto-generated folio (QTE-YYYY-####)
   * - EventType with incremented "Opción X" suffix
   * - Status set to "draft"
   * - ValidUntil set to +30 days from now
   * - Complete copy of serviceItems
   * - Same rate, client, contact info, and notes.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Duplicate quote
   * POST /api/quotes/abc123/duplicate
   * // Response:
   * {
   *   success: true,
   *   message: 'Cotización duplicada exitosamente',
   *   data: {
   *     quote: { id, folio, eventType, status, ... },
   *     originalFolio: 'QTE-2025-0041'
   *   }
   * }
   */
  async duplicateQuote(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const quoteId = req.params.id;
      if (!quoteId) {
        return this.sendError(res, 'El ID de la cotización es requerido', 400);
      }

      // 1. Get original quote with all includes
      const query = new Parse.Query('Quote');
      query.include('client');
      query.include('rate');
      query.include('createdBy');
      query.equalTo('exists', true);

      let originalQuote;
      try {
        originalQuote = await query.get(quoteId, { useMasterKey: true });
      } catch (error) {
        logger.warn('Quote not found for duplication', {
          quoteId,
          error: error.message,
          userId: currentUser.id,
        });
        return this.sendError(res, 'Cotización no encontrada', 404);
      }

      if (!originalQuote) {
        return this.sendError(res, 'Cotización no encontrada', 404);
      }

      const originalFolio = originalQuote.get('folio');

      // 2. Process eventType to add/increment "Opción X"
      const originalEventType = originalQuote.get('eventType') || '';
      let newEventType;

      // Regex to match "- Opción X" at the end of the string
      const optionRegex = / - Opción (\d+)$/;
      const match = originalEventType.match(optionRegex);

      if (match) {
        // EventType already has "Opción X" - increment the number
        const currentNumber = parseInt(match[1], 10);
        const newNumber = currentNumber + 1;
        newEventType = originalEventType.replace(optionRegex, ` - Opción ${newNumber}`);
      } else {
        // EventType doesn't have suffix - add "Opción 2"
        newEventType = `${originalEventType} - Opción 2`;
      }

      // 3. Generate new folio
      const newFolio = await this.generateFolio();

      // 4. Create new quote object
      const newQuote = new Quote();

      // 5. Copy pointer fields (rate, client)
      const rate = originalQuote.get('rate');
      if (rate) {
        newQuote.set('rate', {
          __type: 'Pointer',
          className: 'Rate',
          objectId: rate.id,
        });
      }

      const client = originalQuote.get('client');
      if (client) {
        newQuote.set('client', {
          __type: 'Pointer',
          className: 'AmexingUser',
          objectId: client.id,
        });
      }

      // 6. Set createdBy to current user (who is duplicating)
      newQuote.set('createdBy', {
        __type: 'Pointer',
        className: 'AmexingUser',
        objectId: currentUser.id,
      });

      // 7. Copy basic fields
      newQuote.set('folio', newFolio);
      newQuote.set('eventType', newEventType);
      newQuote.set('numberOfPeople', originalQuote.get('numberOfPeople') || 1);
      newQuote.set('contactPerson', originalQuote.get('contactPerson') || '');
      newQuote.set('contactEmail', originalQuote.get('contactEmail') || '');
      newQuote.set('contactPhone', originalQuote.get('contactPhone') || '');
      newQuote.set('notes', originalQuote.get('notes') || '');

      // 8. Copy serviceItems (complete itinerary)
      const originalServiceItems = originalQuote.get('serviceItems');
      if (originalServiceItems) {
        // Deep clone serviceItems to avoid reference issues
        newQuote.set('serviceItems', JSON.parse(JSON.stringify(originalServiceItems)));
      } else {
        newQuote.set('serviceItems', {
          days: [],
          subtotal: 0,
          iva: 0,
          total: 0,
        });
      }

      // 9. Set new values for status and validUntil
      newQuote.set('status', 'requested');
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + 30);
      newQuote.set('validUntil', validUntil);

      // 10. Set standard fields
      newQuote.set('active', true);
      newQuote.set('exists', true);

      // 11. Save new quote
      await newQuote.save(null, {
        useMasterKey: true,
        context: {
          user: {
            objectId: currentUser.id,
            id: currentUser.id,
            email: currentUser.get('email'),
            username: currentUser.get('username') || currentUser.get('email'),
          },
        },
      });

      // 12. Fetch the saved quote with includes for response
      const fetchQuery = new Parse.Query('Quote');
      fetchQuery.include('client');
      fetchQuery.include('rate');
      fetchQuery.include('createdBy');
      const savedQuote = await fetchQuery.get(newQuote.id, { useMasterKey: true });

      // 13. Format response data
      const clientData = savedQuote.get('client');
      const rateData = savedQuote.get('rate');
      const createdByData = savedQuote.get('createdBy');

      const responseData = {
        objectId: savedQuote.id,
        id: savedQuote.id,
        folio: savedQuote.get('folio'),
        client: clientData
          ? {
            id: clientData.id,
            firstName: clientData.get('firstName') || '',
            lastName: clientData.get('lastName') || '',
            companyName: clientData.get('companyName') || '',
            email: clientData.get('email') || '',
            fullName: clientData.get('companyName') || `${clientData.get('firstName') || ''} ${clientData.get('lastName') || ''}`.trim(),
          }
          : null,
        rate: rateData
          ? {
            id: rateData.id,
            objectId: rateData.id,
            name: rateData.get('name'),
            color: rateData.get('color'),
          }
          : null,
        eventType: savedQuote.get('eventType'),
        numberOfPeople: savedQuote.get('numberOfPeople'),
        contactPerson: savedQuote.get('contactPerson'),
        contactEmail: savedQuote.get('contactEmail'),
        contactPhone: savedQuote.get('contactPhone'),
        notes: savedQuote.get('notes'),
        status: savedQuote.get('status'),
        validUntil: savedQuote.get('validUntil'),
        serviceItems: savedQuote.get('serviceItems'),
        createdBy: createdByData
          ? {
            id: createdByData.id,
            firstName: createdByData.get('firstName') || '',
            lastName: createdByData.get('lastName') || '',
            email: createdByData.get('email') || '',
            fullName: `${createdByData.get('firstName') || ''} ${createdByData.get('lastName') || ''}`.trim(),
          }
          : null,
        active: savedQuote.get('active'),
        createdAt: savedQuote.createdAt,
        updatedAt: savedQuote.updatedAt,
      };

      // 14. Log success
      logger.info('Quote duplicated successfully', {
        originalQuoteId: quoteId,
        originalFolio,
        newQuoteId: savedQuote.id,
        newFolio,
        originalEventType,
        newEventType,
        userId: currentUser.id,
        userEmail: currentUser.get('email'),
      });

      // 15. Return response
      return res.status(201).json({
        success: true,
        message: 'Cotización duplicada exitosamente',
        data: {
          quote: responseData,
          originalFolio,
        },
      });
    } catch (error) {
      logger.error('Error in QuoteController.duplicateQuote', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al duplicar la cotización',
        500
      );
    }
  }

  /**
   * POST /api/quotes/:id/convert-to-reservation - Convert quote to reservation.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Convert quote to reservation
   * // Request body: { currentStatus: 'quoted' }
   * // Response: { success: true, message: 'Reservación creada exitosamente', data: {...} }
   */
  async convertToReservation(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const quoteId = req.params.id;
      if (!quoteId) {
        return this.sendError(res, 'El ID de la cotización es requerido', 400);
      }

      const { currentStatus } = req.body;

      logger.info('🔄 Converting quote to reservation', {
        quoteId,
        currentStatus,
        userId: currentUser.id,
        userEmail: currentUser.get('email'),
      });

      // Fetch the quote
      const query = new Parse.Query('Quote');
      query.equalTo('exists', true);
      query.include('client');
      query.include('rate');
      const quote = await query.get(quoteId, { useMasterKey: true });

      if (!quote) {
        return this.sendError(res, 'Cotización no encontrada', 404);
      }

      const quoteFolio = quote.get('folio');
      const quoteStatus = quote.get('status');

      // Check if quote can be converted (must be quoted or requested)
      if (quoteStatus !== 'quoted' && quoteStatus !== 'requested') {
        return this.sendError(
          res,
          `La cotización debe estar en estado "COTIZADO" o "SOLICITADO" para convertirse en reservación. Estado actual: ${quoteStatus}`,
          400
        );
      }

      let reservationData = null;
      let statusChanged = false;

      // If quote is in 'quoted' status, first update it to 'requested'
      if (quoteStatus === 'quoted') {
        logger.info('📝 Updating quote status from quoted to requested', {
          quoteId,
          quoteFolio,
        });

        // Update status to requested using the service
        const statusResult = await this.quoteService.updateQuoteStatus(
          currentUser,
          quoteId,
          'requested',
          'Converted to reservation via button',
          req.userRole
        );

        if (!statusResult.success) {
          return this.sendError(res, statusResult.error || 'Error al actualizar el estado de la cotización', 500);
        }

        statusChanged = true;

        // The updateQuoteStatus method already creates the reservation when changing to 'requested'
        reservationData = statusResult.data?.reservation;
      } else {
        // Quote is already 'requested', check if reservation exists
        logger.info('📋 Quote already in requested status, checking for existing reservation', {
          quoteId,
          quoteFolio,
        });

        // Check if reservation already exists
        const reservationQuery = new Parse.Query('Reservation');
        reservationQuery.equalTo('quoteFolio', quoteFolio);
        reservationQuery.equalTo('exists', true);
        const existingReservation = await reservationQuery.first({ useMasterKey: true });

        if (existingReservation) {
          logger.info('✅ Reservation already exists for this quote', {
            quoteId,
            quoteFolio,
            reservationId: existingReservation.id,
            reservationFolio: existingReservation.get('folio'),
          });

          reservationData = {
            id: existingReservation.id,
            folio: existingReservation.get('folio'),
            servicesCount: 0, // Would need to count services if needed
          };
        } else {
          // Create reservation manually if it doesn't exist
          logger.info('🆕 Creating new reservation for requested quote', {
            quoteId,
            quoteFolio,
          });

          reservationData = await this.quoteService.createReservationFromQuote(quote, currentUser);
        }
      }

      // Prepare response
      const response = {
        success: true,
        message: reservationData ? 'Reservación creada exitosamente' : 'Estado actualizado a SOLICITADO',
        data: {
          quoteId: quote.id,
          quoteFolio,
          quoteStatus: statusChanged ? 'requested' : quoteStatus,
          statusChanged,
        },
      };

      // Add reservation data if available
      if (reservationData) {
        response.data.reservationId = reservationData.id;
        response.data.reservationFolio = reservationData.folio;
        response.data.servicesCount = reservationData.servicesCount || 0;
      }

      logger.info('✅ Quote conversion completed', {
        quoteId,
        quoteFolio,
        reservationCreated: !!reservationData,
        statusChanged,
        response: response.data,
      });

      // Timeline (Fase B1): registrar la conversión a reservación.
      if (reservationData) {
        await QuoteActivityService.log({
          quoteId,
          actor: currentUser,
          actorRole: req.userRole,
          action: 'converted_to_reservation',
          summary: `convirtió la cotización en reservación${reservationData.folio ? ` (${reservationData.folio})` : ''}`,
          meta: { reservationId: reservationData.id, reservationFolio: reservationData.folio },
        });
      }

      return res.json(response);
    } catch (error) {
      logger.error('Error in QuoteController.convertToReservation', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al convertir la cotización en reservación',
        500
      );
    }
  }

  /**
   * DELETE /api/quotes/:id - Soft delete quote.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Delete quote
   */
  async deleteQuote(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const quoteId = req.params.id;

      // Call service
      const result = await this.quoteService.softDeleteQuote(
        currentUser,
        quoteId,
        req.body.reason || 'Quote deleted',
        req.userRole // Pass userRole from JWT middleware
      );

      return res.json(result);
    } catch (error) {
      logger.error('Error in QuoteController.deleteQuote', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al eliminar la cotización',
        500
      );
    }
  }

  /**
   * Update service items for a quote
   * PUT /api/quotes/:id/service-items.
   * @param {object} req - Express request object.
   * @param {object} req.params - Request parameters.
   * @param {string} req.params.id - Quote ID.
   * @param {object} req.body - Service items object.
   * @param {Array} req.body.days - Array of day objects.
   * @param {number} req.body.subtotal - Subtotal amount.
   * @param {number} req.body.iva - IVA amount (16% of subtotal).
   * @param {number} req.body.total - Total amount (subtotal + iva).
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async updateServiceItems(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const quoteId = req.params.id;
      if (!quoteId) {
        return this.sendError(res, 'El ID de la cotización es requerido', 400);
      }

      const {
        days = [], subtotal = 0, iva = 0, total = 0,
        currency = 'MXN', paymentType = 'efectivo',
        globalTip = null, // Fase 2b: propina global de la cotización (persistir tal cual).
        suggestedTipPct = null, // Fase 2c: % de propina sugerida (default 10 en el front).
      } = req.body;

      // Enum guard: paymentType alimenta reservation.paymentType (ancla del carrito de pagos) y se
      // renderiza en el desglose de las 3 vistas de reservación. Un valor fuera de los métodos válidos
      // habilitaba stored XSS (council L3F0) y corrompía el ancla (bloqueaba el registro de pagos). Se
      // rechaza aquí, el único punto de escritura de paymentType desde el request.
      if (!Payment.isValidMethod(paymentType)) {
        return this.sendError(res, `Forma de pago inválida. Use: ${Payment.METHODS.join(', ')}`, 400);
      }

      // FIX 3: tope de 100% en la propina general de tipo porcentaje. El monto fijo (type 'amount') no
      // lleva límite. Se rechaza (400) antes de tocar la BD; computeGeneralTip además recorta a 100 en
      // la función pura (defensa en profundidad). Se valida ANTES de la comparación RBAC para que un
      // porcentaje imposible se rechace con 400 sin importar el rol.
      if (globalTip && globalTip.type === 'percent' && Number(globalTip.value) > 100) {
        return this.sendError(res, 'El porcentaje de propina no puede ser mayor a 100%', 400);
      }

      // Validate serviceItems structure
      if (!Array.isArray(days)) {
        return this.sendError(res, 'El campo days debe ser un array', 400);
      }

      // Validate numeric fields
      if (typeof subtotal !== 'number' || subtotal < 0) {
        return this.sendError(res, 'El subtotal debe ser un número positivo', 400);
      }

      // IVA validation removed - modal value is the final value that already includes everything

      // Validate day structure with new subconcepts format
      for (let i = 0; i < days.length; i++) {
        const day = days[i];

        // Validate dayNumber
        if (!day.dayNumber || typeof day.dayNumber !== 'number' || day.dayNumber < 1) {
          return this.sendError(res, `El día ${i + 1} debe tener un dayNumber válido (>= 1)`, 400);
        }

        // Validate dayTitle (optional field - can be empty string)
        if (day.dayTitle !== undefined && day.dayTitle !== null && typeof day.dayTitle !== 'string') {
          return this.sendError(res, `El título del día ${day.dayNumber} debe ser texto`, 400);
        }

        // Validate subconcepts array (new structure)
        if (!Array.isArray(day.subconcepts)) {
          return this.sendError(res, `El día ${day.dayNumber} debe tener un array de subconcepts`, 400);
        }

        // Validate each subconcept
        for (let j = 0; j < day.subconcepts.length; j++) {
          const sub = day.subconcepts[j];

          // Validate time format HH:MM (optional but if exists must be valid)
          if (sub.time && !/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(sub.time)) {
            return this.sendError(
              res,
              `Hora inválida en subconcepto ${j + 1} del día ${day.dayNumber}. Use formato HH:MM (00:00 - 23:59)`,
              400
            );
          }

          // Validate numeric fields in subconcept
          if (sub.hours !== null && sub.hours !== undefined) {
            if (typeof sub.hours !== 'number' || sub.hours < 0) {
              return this.sendError(res, `Horas inválidas en subconcepto ${j + 1} del día ${day.dayNumber}`, 400);
            }
          }

          if (sub.unitPrice !== null && sub.unitPrice !== undefined) {
            if (typeof sub.unitPrice !== 'number' || sub.unitPrice < 0) {
              return this.sendError(
                res,
                `Precio unitario inválido en subconcepto ${j + 1} del día ${day.dayNumber}`,
                400
              );
            }
          }

          if (sub.total !== null && sub.total !== undefined) {
            if (typeof sub.total !== 'number' || sub.total < 0) {
              return this.sendError(res, `Total inválido en subconcepto ${j + 1} del día ${day.dayNumber}`, 400);
            }
          }

          // Validate per-person pricing fields
          if (sub.isPerPerson !== undefined && typeof sub.isPerPerson !== 'boolean') {
            return this.sendError(
              res,
              `isPerPerson debe ser booleano en subconcepto ${j + 1} del día ${day.dayNumber}`,
              400
            );
          }

          if (sub.isPerPerson && sub.numberOfPeople !== undefined) {
            if (typeof sub.numberOfPeople !== 'number' || sub.numberOfPeople < 1) {
              return this.sendError(
                res,
                `numberOfPeople debe ser mayor a 0 en subconcepto ${j + 1} del día ${day.dayNumber}`,
                400
              );
            }
          }

          if (sub.vehicleCapacity !== undefined && sub.vehicleCapacity !== null) {
            if (typeof sub.vehicleCapacity !== 'number' || sub.vehicleCapacity < 1) {
              return this.sendError(
                res,
                `vehicleCapacity debe ser mayor a 0 en subconcepto ${j + 1} del día ${day.dayNumber}`,
                400
              );
            }
          }

          if (sub.vehicleMultiplier !== undefined && sub.vehicleMultiplier !== null) {
            if (typeof sub.vehicleMultiplier !== 'number' || sub.vehicleMultiplier < 1) {
              return this.sendError(
                res,
                `vehicleMultiplier debe ser mayor a 0 en subconcepto ${j + 1} del día ${day.dayNumber}`,
                400
              );
            }
          }

          // FIX 3: tope de 100% en la propina POR SERVICIO de tipo porcentaje (el monto fijo no se
          // limita). Rechaza aquí, antes de persistir, identificando el subconcepto/día.
          if (sub.tipType === 'percent' && Number(sub.tipValue) > 100) {
            return this.sendError(
              res,
              `El porcentaje de propina no puede ser mayor a 100% (subconcepto ${j + 1} del día ${day.dayNumber})`,
              400
            );
          }
        }

        // Validate dayTotal (new field - must equal sum of subconcepts totals)
        if (typeof day.dayTotal !== 'number' || day.dayTotal < 0) {
          return this.sendError(res, `El total del día ${day.dayNumber} debe ser un número positivo`, 400);
        }

        const calculatedDayTotal = day.subconcepts.reduce((sum, sub) => sum + (parseFloat(sub.total) || 0), 0);

        const dayTotalRounded = Math.round(day.dayTotal * 100) / 100;
        const expectedRounded = Math.round(calculatedDayTotal * 100) / 100;

        if (Math.abs(dayTotalRounded - expectedRounded) > 0.01) {
          return this.sendError(
            res,
            `El total del día ${day.dayNumber} ($${dayTotalRounded}) no coincide con la suma de subconceptos ($${expectedRounded})`,
            400
          );
        }
      }

      // Consistencia de totales (costura #1 — backend, motor único). Re-verifica con el motor que los
      // números del front cuadren, usando solo los datos del payload (sin fetches extra a la BD).
      // Divergencias de centavos (redondeo normal) solo se loggean y siguen guardando; una divergencia
      // mayor a PRICE_MISMATCH_TOLERANCE ($1.00) RECHAZA el guardado — ocurre ANTES del query/save de
      // la cotización, así que nada se persiste si se rechaza.
      try {
        const consistency = this.evaluateTotalsConsistency({
          days, subtotal, iva, total, paymentType,
        });

        if (consistency.subtotalDiff > 0.01) {
          logger.warn('⚠️ Inconsistencia de subtotal (front vs suma de subconcepts)', {
            quoteId,
            subtotalRecibido: consistency.subtotalRounded,
            sumaSubconcepts: consistency.sumOfSubconceptTotals,
            diferencia: consistency.subtotalSignedDiff,
            paymentType,
            currency,
          });
        }
        if (consistency.subconceptMismatches > 0) {
          logger.warn('⚠️ Subconcepts cuyo total no coincide con pricesByType[formaPago]', {
            quoteId, count: consistency.subconceptMismatches, paymentType,
          });
        }
        if (consistency.totalDiff > 0.01) {
          logger.warn('⚠️ Inconsistencia de total (subtotal + IVA vs total recibido)', {
            quoteId,
            subtotal: consistency.subtotalRounded,
            iva: consistency.ivaRounded,
            totalEsperado: consistency.totalEsperado,
            totalRecibido: consistency.totalRecibido,
          });
        }

        if (consistency.rejectMessage) {
          return this.sendError(res, consistency.rejectMessage, 400);
        }
      } catch (calcErr) {
        logger.warn('No se pudo verificar la consistencia de totales con el motor', { error: calcErr.message });
      }

      // Query quote
      const query = new Parse.Query('Quote');
      query.equalTo('exists', true);
      const quote = await query.get(quoteId, { useMasterKey: true });

      if (!quote) {
        return this.sendError(res, 'Cotización no encontrada', 404);
      }

      // Timeline (Fase A): snapshot del serviceItems previo para diffear agregados/editados/quitados.
      const beforeServiceItems = quote.get('serviceItems') || { days: [] };

      // Deduplicación (keep-first) + ordenamiento ADELANTADOS aquí, ANTES del guard RBAC de propina, para
      // que el guard evalúe EXACTAMENTE los datos que se van a persistir (antes se deduplicaba después del
      // guard). Sin esto, un no-admin podía mandar en el mismo día DOS subconceptos con el MISMO id (el
      // primero con tip bajo/cero, el segundo con el tip real): tipFieldsChanged sumaba AMBAS ocurrencias
      // sobre el payload crudo -> la suma cuadraba con lo guardado -> no bloqueaba (200); pero al persistir,
      // sortAndCleanServiceDays deja solo la PRIMERA ocurrencia (tip bajo/cero), bajando/anulando la propina
      // fijada por un admin sin disparar 403. Al deduplicar antes, ambas ocurrencias colapsan en una sola y
      // el guard ve el tip real que quedaría guardado -> el intento se bloquea con 403.
      // evaluateTotalsConsistency (arriba) se deja intencionalmente sobre `days` crudos: valida el
      // subtotal/total COSMÉTICO del header (PaymentService no depende de él, y los servicios bloqueados se
      // recomputan más abajo desde el contenido restaurado); correrlo sobre los días deduplicados
      // rechazaría con 400 quotes legítimos con servicios idénticos sin id (que el dedup colapsa por
      // contenido), un cambio de comportamiento fuera del alcance de este fix de propina.
      const sortedAndCleanedDays = this.sortAndCleanServiceDays(days);

      // FIX 1: RBAC server-side de la propina. El wizard oculta los controles de propina a los no-admin,
      // pero el server persistía globalTip/suggestedTipPct + tipType/tipValue/tipMandatory/tipAmount por
      // subconcepto sin validar rol -> un agente/agencia podía FIJAR cualquier propina por API directa.
      // Solo admin/superadmin puede fijar o cambiar la propina; un no-admin únicamente puede REENVIAR la
      // misma propina ya guardada (el wizard la reenvía para no perderla). El guard va DENTRO del
      // controller y condicional a si la propina realmente cambia: en la ruta bloquearía TODA edición de
      // servicios (horario/precio) de agentes/agencias, que sí está permitida.
      // Se prioriza req.roleObject (fila fresca de Role en DB, ya cargada por el middleware) sobre
      // req.userRole (claim del JWT, puede quedar stale hasta 8h tras un cambio de rol — council
      // L3F1): un admin recién degradado no debe conservar el privilegio de tocar propina solo porque
      // su token viejo todavía diga 'admin'. Fallback a userRole SOLO si no hay roleObject fresco.
      const isAdminForTip = req.roleObject
        ? (typeof req.roleObject.getLevel === 'function' && req.roleObject.getLevel() >= 6)
        : ['admin', 'superadmin'].includes(req.userRole);
      // El guard evalúa los días YA deduplicados (sortedAndCleanedDays), no el payload crudo (ver arriba).
      const incomingTipData = { globalTip, suggestedTipPct, days: sortedAndCleanedDays };
      if (!isAdminForTip && this.tipFieldsChanged(beforeServiceItems, incomingTipData)) {
        logger.warn('updateServiceItems: non-admin attempted to set/change tip fields', {
          quoteId: quote.id, userRole: req.userRole,
        });
        return this.sendError(res, 'Solo un administrador puede modificar la propina', 403);
      }

      // Debug: Log transport services with suggested departure time fields
      days.forEach((day, dayIndex) => {
        if (day.subconcepts) {
          day.subconcepts.forEach((subconcept, subIndex) => {
            if (subconcept.type === 'transport') {
              logger.info('🔍 BACKEND DEBUG - Transport service received for saving:', {
                dayIndex,
                subIndex,
                concept: subconcept.concept,
                type: subconcept.type,
                suggestedTimeFields: {
                  flightDepartureTimeSuggested: subconcept.flightDepartureTimeSuggested,
                  roundTripDepartureTimeSuggestedIda: subconcept.roundTripDepartureTimeSuggestedIda,
                  roundTripDepartureTimeSuggestedVuelta: subconcept.roundTripDepartureTimeSuggestedVuelta,
                },
                allFieldsCount: Object.keys(subconcept).length,
                hasFlightTime: !!subconcept.flightTime,
                hasStartTime: !!subconcept.startTime,
              });
            }
          });
        }
      });

      // Update serviceItems (days ya deduplicados/ordenados arriba, antes del guard de propina)
      const serviceItems = {
        days: sortedAndCleanedDays,
        subtotal,
        iva,
        total,
        currency,
        paymentType,
        globalTip, // Fase 2b: propina global de la cotización.
        suggestedTipPct, // Fase 2c: % de propina sugerida.
      };

      // Asegura un id estable por subconcepto ANTES de guardar. Los servicios agregados desde
      // "Agregar a cotización" (tarifario) llegan sin id; sin id se rompen request-change y el
      // bloqueo por-servicio, que keyean por sc.id. Se asigna solo a los que falten.
      const nowId = Date.now();
      serviceItems.days = (serviceItems.days || []).map((d, di) => ({
        ...d,
        subconcepts: (d.subconcepts || []).map((sc, si) => (
          (sc && !sc.id)
            ? { ...sc, id: `service_${nowId}_${di}_${si}_${Math.random().toString(36).slice(2, 8)}` }
            : sc
        )),
      }));

      // Congelamiento del tipo de cambio: en cotizaciones USD se captura la tasa vigente que produjo
      // los pricesByType actuales, y viaja dentro del mismo blob serviceItems. Se re-captura en cada
      // guardado (los precios también se recalculan con la tasa vigente en cada edición del wizard); el
      // congelamiento real ocurre al pasar de cotización a reservación (QuoteService no pisa uno existente).
      if (String(currency).toUpperCase() === 'USD') {
        serviceItems.exchangeRateSnapshot = await ExchangeRate.getCurrentValue();
      }

      // Bloqueo por-servicio: los subconceptos PROTEGIDOS no pueden ser editados ni eliminados
      // por no-admins (el servidor los restaura), reforzando lo que la UI ya impide.
      // Un subconcepto está protegido si:
      //  - es adminLocked (agregado/editado por un admin), o
      //  - la cotización ya es reservación (scheduled/hold): cualquier cambio a un servicio EXISTENTE
      //    debe pasar por una solicitud aprobada por admin (agregar nuevos sí se permite directo,
      //    porque un servicio nuevo aún no está en el estado guardado).
      // Los locks son "sticky" por id. Solo admin/superadmin pueden editar directo.
      const isAdminUser = ['admin', 'superadmin'].includes(req.userRole);
      const isReservation = ['scheduled', 'hold'].includes(quote.get('status'));
      const storedServiceItems = quote.get('serviceItems') || {};
      const storedLockedById = new Map();
      (Array.isArray(storedServiceItems.days) ? storedServiceItems.days : []).forEach((d) => {
        (d.subconcepts || []).forEach((sc) => {
          // Protegido: adminLocked, o cualquier servicio existente si la cotización ya es reservación.
          if (sc && sc.id && (sc.adminLocked || isReservation)) {
            storedLockedById.set(sc.id, { sub: sc, dayNumber: d.dayNumber });
          }
        });
      });

      if (storedLockedById.size > 0) {
        const seenLockedIds = new Set();
        const enforcedDays = serviceItems.days.map((d) => ({
          ...d,
          subconcepts: (d.subconcepts || []).map((sc) => {
            if (!sc || !sc.id) return sc;
            const locked = storedLockedById.get(sc.id);
            if (locked) {
              seenLockedIds.add(sc.id);
              // Sticky: para no-admin se restaura el contenido guardado (no puede editar un
              // servicio protegido); admin conserva sus cambios. Se PRESERVA el adminLocked
              // original: un servicio de proveedor del owner (adminLocked=false) sigue sin
              // marcarse como admin-locked; solo queda protegido por la regla de reservación.
              return isAdminUser
                ? { ...sc, adminLocked: true }
                : { ...locked.sub, adminLocked: locked.sub.adminLocked === true };
            }
            // Un no-admin no puede marcar como bloqueado un servicio nuevo.
            if (!isAdminUser && sc.adminLocked) {
              return { ...sc, adminLocked: false };
            }
            return sc;
          }),
        }));

        // No-admin: re-insertar los servicios bloqueados que se hayan quitado del payload
        // (intento de borrado no permitido).
        if (!isAdminUser) {
          storedLockedById.forEach((locked, id) => {
            if (seenLockedIds.has(id)) return;
            const restored = { ...locked.sub, adminLocked: locked.sub.adminLocked === true };
            let idx = enforcedDays.findIndex((d) => d.dayNumber === locked.dayNumber);
            if (idx < 0) idx = enforcedDays.length > 0 ? 0 : -1;
            if (idx >= 0) {
              enforcedDays[idx] = {
                ...enforcedDays[idx],
                subconcepts: [...(enforcedDays[idx].subconcepts || []), restored],
              };
            } else {
              enforcedDays.push({ dayNumber: locked.dayNumber || 1, dayTitle: '', subconcepts: [restored] });
            }
          });
          logger.info('updateServiceItems: enforced protected services for non-admin', {
            quoteId: quote.id,
            userRole: req.userRole,
            lockedCount: storedLockedById.size,
            reinserted: storedLockedById.size - seenLockedIds.size,
          });
        }

        serviceItems.days = enforcedDays;

        // Re-deriva subtotal/total desde el contenido YA restaurado (protegido), nunca desde lo que
        // mandó el front. evaluateTotalsConsistency (arriba) solo valida que el payload sea
        // AUTOCONSISTENTE contra SUS PROPIOS days -- un payload manipulado por un no-admin puede pasar
        // esa validación trayendo un subtotal/total fabricados a juego con un precio de servicio
        // protegido alterado. El bloqueo de arriba ya restauró el contenido real en `enforcedDays`;
        // sin este recálculo, ese subtotal/total fabricados se persistían igual (council L2F0/L5F1),
        // reintroduciendo el "tercer total" en el header de las 4 vistas para un rol nivel 4 (agencia/
        // agente), no solo admin. El motor de pagos real (PaymentService) no depende de este campo.
        const pricingEngine = require('../../../domain/pricing/pricingEngine');
        const r2 = pricingEngine.round2;
        let enforcedSubtotal = 0;
        enforcedDays.forEach((day) => {
          (day.subconcepts || []).forEach((sc) => {
            if (sc && sc.includeInTotal !== false) enforcedSubtotal += (parseFloat(sc.total) || 0);
          });
        });
        serviceItems.subtotal = r2(enforcedSubtotal);
        serviceItems.total = r2(serviceItems.subtotal + (r2(parseFloat(serviceItems.iva) || 0)));
      }

      quote.set('serviceItems', serviceItems);

      // Save with user context
      await quote.save(null, {
        useMasterKey: true,
        context: {
          user: {
            objectId: currentUser.id,
            id: currentUser.id,
            email: currentUser.get('email'),
            username: currentUser.get('username') || currentUser.get('email'),
          },
        },
      });

      // Create or update ReservationService records for transport services with suggested departure times
      await this.persistSuggestedDepartureTimes(quote.id, sortedAndCleanedDays, currentUser);

      // Timeline (Fase A): eventos legibles de agregados/editados/quitados de servicios.
      const activityEvents = buildServiceItemsActivities(beforeServiceItems, serviceItems);
      if (activityEvents.length) {
        await QuoteActivityService.logMany(activityEvents.map((e) => ({
          quoteId: quote.id, actor: currentUser, actorRole: req.userRole, ...e,
        })));
      }

      // If this quote is already a reservation, keep the reservation in sync with
      // the edited service items (preserving driver/vehicle assignments). Isolated
      // so a sync failure never blocks the quote save.
      try {
        await this.quoteService.syncReservationFromQuote(quote, serviceItems);
      } catch (syncError) {
        logger.error('Failed to sync reservation after service items update', {
          quoteId: quote.id,
          error: syncError.message,
          stack: syncError.stack,
        });
      }

      logger.info('Service items updated successfully', {
        quoteId: quote.id,
        folio: quote.get('folio'),
        daysCount: days.length,
        subtotal,
        iva,
        total,
        updatedBy: currentUser.id,
      });

      return this.sendSuccess(
        res,
        {
          id: quote.id,
          folio: quote.get('folio'),
          serviceItems,
        },
        'Servicios actualizados exitosamente',
        200
      );
    } catch (error) {
      logger.error('Error in QuoteController.updateServiceItems', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al actualizar los servicios',
        500
      );
    }
  }

  /**
   * FIX 1: detecta si un payload de service-items INTENTA fijar/cambiar/quitar la propina respecto a lo
   * ya guardado. Se usa para bloquear (403) a los no-admin, que solo pueden reenviar la misma propina
   * existente. Compara: globalTip (type/value/mandatory; ignora `amount`, que es derivado y lo recomputa
   * el server), suggestedTipPct (solo se protege MODIFICAR/QUITAR una sugerencia ya guardada — el wizard
   * SIEMPRE manda un default 10, bloquearlo sobre cotizaciones legacy sin sugerencia rompería ediciones
   * legítimas; además es una nota, no se cobra) y la SUMA AGREGADA de la propina por servicio (Σ tipAmount
   * de los subconceptos activos, sin emparejar por id) — si esa suma cambia, es un cambio de propina. La
   * suma agregada permite splits/fusiones que preservan el total (ej. round-trip que parte la propina de
   * un servicio en dos piernas) y bloquea cualquier subida/bajada real. Números con tolerancia de centavo.
   * @param {object} storedSI - serviceItems actualmente guardado en la cotización.
   * @param {object} incoming - Datos del request { globalTip, suggestedTipPct, days }.
   * @returns {boolean} true si la propina cambia (debe bloquearse para no-admin).
   * @example
   * this.tipFieldsChanged(quote.get('serviceItems'), { globalTip, suggestedTipPct, days });
   */
  tipFieldsChanged(storedSI, incoming) {
    const CENT = 0.01;
    const numEq = (a, b) => {
      const na = Number(a);
      const nb = Number(b);
      return Math.abs((Number.isFinite(na) ? na : 0) - (Number.isFinite(nb) ? nb : 0)) <= CENT;
    };
    const stored = storedSI || {};
    const inc = incoming || {};

    const normType = (t) => {
      if (t === 'amount') return 'amount';
      if (t === 'percent') return 'percent';
      return null;
    };
    // globalTip normalizado: propina efectiva o null. `amount` se ignora (lo recomputa computeGeneralTip).
    const normGT = (gt) => {
      if (!gt || typeof gt !== 'object') return null;
      const type = normType(gt.type);
      const value = Number(gt.value);
      if (!type || !Number.isFinite(value) || value <= 0) return null;
      return { type, value, mandatory: gt.mandatory === true };
    };
    const storedGT = normGT(stored.globalTip);
    const incomingGT = normGT(inc.globalTip);
    if (!storedGT !== !incomingGT) return true; // se agrega o se quita la propina general
    if (storedGT && incomingGT && (
      storedGT.type !== incomingGT.type
      || !numEq(storedGT.value, incomingGT.value)
      || storedGT.mandatory !== incomingGT.mandatory
    )) return true;

    // suggestedTipPct: solo se protege MODIFICAR/QUITAR una sugerencia ya guardada (>0).
    const storedPct = Number(stored.suggestedTipPct);
    if (Number.isFinite(storedPct) && storedPct > 0) {
      const inPct = Number(inc.suggestedTipPct);
      const normInPct = Number.isFinite(inPct) && inPct > 0 ? inPct : 0;
      if (!numEq(storedPct, normInPct)) return true;
    }

    // Propina por subconcepto: se compara la SUMA AGREGADA de tipAmount (lo que realmente se cobra) de
    // TODOS los subconceptos activos, sea cual sea su id, en lo guardado vs lo entrante. NO se empareja
    // por id ni se comparan campos uno a uno: un split ida-vuelta reparte la propina de un servicio en
    // dos piernas (id reutilizado para Ida + id nuevo para Vuelta) conservando la suma total; empatar por
    // id daba un falso positivo (el id existente pasa de 200 a 100 y el id nuevo aporta 100 "sin previo")
    // y bloqueaba con 403 a un no-admin aunque la SUMA no cambiara (100+100=200). Con la suma agregada,
    // cualquier reparto/fusión que preserve el total se permite, y toda subida/bajada real (o la
    // desaparición de un servicio con propina sin compensación) mueve la suma y se bloquea.
    //
    // Esto subsume de raíz el chequeo previo "tipSilentlyRemoved" (council L0F0: borrar el servicio o
    // reenviarlo con id vacío para quitar la propina): al desaparecer su tipAmount la suma baja y se
    // detecta sin necesitar rastrear ids que se pierden. Se usa el MISMO criterio que el motor de dinero
    // (QuoteService.sumServiceTipsFromDays / PaymentService.sumServiceTips): tipAmount finito y > 0 de los
    // subconceptos con includeInTotal !== false.
    const sumServiceTips = (si) => {
      const days = Array.isArray(si.days) ? si.days : [];
      let sum = 0;
      days.forEach((d) => {
        ((d && Array.isArray(d.subconcepts)) ? d.subconcepts : []).forEach((sc) => {
          if (sc && sc.includeInTotal !== false) {
            const tip = Number(sc.tipAmount);
            if (Number.isFinite(tip) && tip > 0) sum += tip;
          }
        });
      });
      return sum;
    };
    if (!numEq(sumServiceTips(stored), sumServiceTips(inc))) return true;

    return false;
  }

  /**
   * POST /api/quotes/:id/services/:serviceId/request-change — Fase 2 del bloqueo por-servicio.
   * El owner (no-admin) solicita BORRAR o MODIFICAR un servicio bloqueado por admin. Solo
   * guarda la solicitud en el subconcepto (no elimina/edita nada); el admin la aprueba/rechaza.
   * @param {object} req - Express request; params id/serviceId; body { type: 'delete'|'modify', note? }.
   * @param {object} res - Express response.
   * @returns {Promise<void>} JSON con la solicitud creada.
   * @example
   *   POST /api/quotes/abc/services/service_17/request-change { "type": "delete", "note": "..." }
   */
  async requestServiceChange(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) return this.sendError(res, 'Autenticación requerida', 401);
      const { id: quoteId, serviceId } = req.params;
      const type = req.body?.type === 'modify' ? 'modify' : 'delete';
      const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';

      const query = new Parse.Query('Quote');
      query.equalTo('exists', true);
      const quote = await query.get(quoteId, { useMasterKey: true });
      if (!quote) return this.sendError(res, 'Cotización no encontrada', 404);

      const serviceItems = quote.get('serviceItems') || {};
      let target = null;
      (serviceItems.days || []).forEach((d) => (d.subconcepts || []).forEach((sc) => {
        if (sc && sc.id === serviceId) target = sc;
      }));
      if (!target) return this.sendError(res, 'Servicio no encontrado en la cotización', 404);
      // Se permite solicitar cambio si el servicio está protegido: adminLocked, o bien la
      // cotización ya es reservación (scheduled/hold) — ahí cualquier servicio requiere aprobación.
      const isReservation = ['scheduled', 'hold'].includes(quote.get('status'));
      if (!target.adminLocked && !isReservation) {
        return this.sendError(res, 'Este servicio no está bloqueado; puedes editarlo directamente', 400);
      }
      if (target.changeRequest && target.changeRequest.status === 'pending') {
        return this.sendError(res, 'Este servicio ya tiene una solicitud pendiente', 400);
      }

      const requesterName = `${currentUser.get('firstName') || ''} ${currentUser.get('lastName') || ''}`.trim()
        || currentUser.get('email') || currentUser.get('username') || 'Owner';
      const serviceLabel = target.concept || target.name || 'Servicio';
      const requestedAt = new Date();

      // Registro durable (historial + contador). Sobrevive si el servicio se elimina.
      const record = new ServiceChangeRequest();
      record.set('active', true);
      record.set('exists', true);
      record.set('quote', { __type: 'Pointer', className: 'Quote', objectId: quote.id });
      record.set('serviceId', serviceId);
      record.set('serviceLabel', serviceLabel);
      record.set('type', type);
      record.set('note', note);
      record.set('status', ServiceChangeRequest.STATUS.PENDING);
      record.set('requestedBy', { __type: 'Pointer', className: 'AmexingUser', objectId: currentUser.id });
      record.set('requestedByName', requesterName);
      record.set('requestedAt', requestedAt);
      record.set('seenByRequester', true); // el owner ya la conoce (la acaba de crear)
      await record.save(null, { useMasterKey: true });

      // Marcador inline en el subconcepto (UI de acción de Fase 2 + badge del owner).
      target.changeRequest = {
        requestId: record.id,
        type,
        note,
        requestedBy: currentUser.id,
        requestedByName: requesterName,
        requestedAt: requestedAt.toISOString(),
        status: 'pending',
      };
      quote.set('serviceItems', serviceItems);
      await quote.save(null, { useMasterKey: true });

      logger.info('Service change requested', {
        quoteId: quote.id, serviceId, type, requestId: record.id, requestedBy: currentUser.id,
      });
      await QuoteActivityService.log({
        quoteId: quote.id,
        actor: currentUser,
        actorRole: req.userRole,
        action: 'change_requested',
        summary: `solicitó ${type === 'delete' ? 'borrar' : 'modificar'} "${serviceLabel}"`,
        meta: { serviceId, type, requestId: record.id },
      });
      return this.sendSuccess(res, { serviceId, changeRequest: target.changeRequest }, 'Solicitud enviada', 200);
    } catch (error) {
      logger.error('Error in requestServiceChange', { error: error.message });
      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al solicitar el cambio',
        500
      );
    }
  }

  /**
   * POST /api/quotes/:id/services/:serviceId/review-change — Admin aprueba/rechaza la solicitud
   * de cambio de un servicio. approve+delete elimina el servicio; approve+modify y reject dejan
   * el servicio pero transicionan la solicitud (aprobada/rechazada) para el historial y el badge
   * del owner. SOLO admin/superadmin (gate en la ruta).
   * @param {object} req - Express request; params id/serviceId; body { decision, reviewNote? }.
   * @param {object} res - Express response.
   * @returns {Promise<void>} JSON con la acción aplicada.
   * @example
   *   POST /api/quotes/abc/services/service_17/review-change { "decision": "approve" }
   */
  async reviewServiceChange(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) return this.sendError(res, 'Autenticación requerida', 401);
      const { id: quoteId, serviceId } = req.params;
      const decision = req.body?.decision === 'reject' ? 'reject' : 'approve';
      const reviewNote = typeof req.body?.reviewNote === 'string' ? req.body.reviewNote.trim().slice(0, 1000) : '';

      const query = new Parse.Query('Quote');
      query.equalTo('exists', true);
      const quote = await query.get(quoteId, { useMasterKey: true });
      if (!quote) return this.sendError(res, 'Cotización no encontrada', 404);

      const serviceItems = quote.get('serviceItems') || {};
      let target = null;
      let targetDay = null;
      (serviceItems.days || []).forEach((d) => (d.subconcepts || []).forEach((sc) => {
        if (sc && sc.id === serviceId) { target = sc; targetDay = d; }
      }));
      if (!target) return this.sendError(res, 'Servicio no encontrado en la cotización', 404);
      if (!target.changeRequest || target.changeRequest.status !== 'pending') {
        return this.sendError(res, 'Este servicio no tiene una solicitud pendiente', 400);
      }

      const reqType = target.changeRequest.type;
      const { requestId } = target.changeRequest;
      const reviewerName = `${currentUser.get('firstName') || ''} ${currentUser.get('lastName') || ''}`.trim()
        || currentUser.get('email') || currentUser.get('username') || 'Admin';
      const reviewedAt = new Date();
      const newStatus = decision === 'approve' ? 'approved' : 'rejected';
      let action;
      let serviceDeleted = false;

      if (decision === 'approve' && reqType === 'delete') {
        targetDay.subconcepts = (targetDay.subconcepts || []).filter((sc) => sc.id !== serviceId);
        serviceDeleted = true;
        action = 'deleted';
      } else {
        // modify-approve o reject: el servicio se queda; el marcador inline transiciona a
        // aprobada/rechazada (badge del owner) hasta que lo vea (seenByRequester=false).
        target.changeRequest = {
          ...target.changeRequest,
          status: newStatus,
          reviewedByName: reviewerName,
          reviewedAt: reviewedAt.toISOString(),
          reviewNote,
          seenByRequester: false,
        };
        action = decision === 'approve' ? 'modify-approved' : 'rejected';
      }

      quote.set('serviceItems', serviceItems);
      await quote.save(null, { useMasterKey: true });

      // Actualizar el registro durable (historial).
      if (requestId) {
        try {
          const rec = await new Parse.Query('ServiceChangeRequest').get(requestId, { useMasterKey: true });
          if (rec) {
            rec.set('status', newStatus);
            rec.set('reviewedBy', { __type: 'Pointer', className: 'AmexingUser', objectId: currentUser.id });
            rec.set('reviewedByName', reviewerName);
            rec.set('reviewedAt', reviewedAt);
            rec.set('reviewNote', reviewNote);
            rec.set('serviceDeleted', serviceDeleted);
            rec.set('seenByRequester', false); // el owner debe enterarse del resultado
            await rec.save(null, { useMasterKey: true });
          }
        } catch (recErr) {
          logger.warn('reviewServiceChange: no se pudo actualizar el registro', { error: recErr.message, requestId });
        }
      }

      logger.info('Service change reviewed', {
        quoteId: quote.id, serviceId, decision, reqType, action, reviewedBy: currentUser.id,
      });
      const reviewedLabel = (target && target.concept) || 'servicio';
      await QuoteActivityService.log({
        quoteId: quote.id,
        actor: currentUser,
        actorRole: req.userRole,
        action: decision === 'approve' ? 'change_approved' : 'change_rejected',
        summary: `${decision === 'approve' ? 'aprobó' : 'rechazó'} la solicitud de ${reqType === 'delete' ? 'borrado' : 'modificación'} de "${reviewedLabel}"`,
        meta: { serviceId, type: reqType, requestId },
      });
      return this.sendSuccess(res, { serviceId, action, type: reqType }, 'Solicitud revisada', 200);
    } catch (error) {
      logger.error('Error in reviewServiceChange', { error: error.message });
      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al revisar la solicitud',
        500
      );
    }
  }

  /**
   * GET /api/quotes/:id/change-requests — Historial de solicitudes de cambio de la cotización
   * (Fase 3). Devuelve la lista para el modal y un contador de novedades: admin = pendientes;
   * owner = sus solicitudes resueltas sin ver.
   * @param {object} req - Express request; params id.
   * @param {object} res - Express response.
   * @returns {Promise<void>} JSON { requests, counter }.
   * @example
   *   GET /api/quotes/abc/change-requests
   */
  async getServiceChangeRequests(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) return this.sendError(res, 'Autenticación requerida', 401);
      const { id: quoteId } = req.params;
      const isAdmin = ['admin', 'superadmin'].includes(req.userRole);

      const q = new Parse.Query('ServiceChangeRequest');
      q.equalTo('quote', { __type: 'Pointer', className: 'Quote', objectId: quoteId });
      q.equalTo('exists', true);
      q.descending('createdAt');
      q.limit(500);
      const records = await q.find({ useMasterKey: true });
      const requests = records.map((r) => r.toDisplayJSON());

      const counter = isAdmin
        ? requests.filter((r) => r.status === 'pending').length
        : requests.filter((r) => r.status !== 'pending' && !r.seenByRequester
          && r.requestedById === currentUser.id).length;

      return this.sendSuccess(res, { requests, counter, isAdmin }, 'OK', 200);
    } catch (error) {
      logger.error('Error in getServiceChangeRequests', { error: error.message });
      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al obtener las solicitudes',
        500
      );
    }
  }

  /**
   * POST /api/quotes/:id/change-requests/mark-seen — Marca como vistas las solicitudes resueltas
   * del owner (limpia el contador) y limpia los marcadores inline resueltos del subconcepto.
   * @param {object} req - Express request; params id.
   * @param {object} res - Express response.
   * @returns {Promise<void>} JSON.
   * @example
   *   POST /api/quotes/abc/change-requests/mark-seen
   */
  async markServiceChangeRequestsSeen(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) return this.sendError(res, 'Autenticación requerida', 401);
      const { id: quoteId } = req.params;

      const q = new Parse.Query('ServiceChangeRequest');
      q.equalTo('quote', { __type: 'Pointer', className: 'Quote', objectId: quoteId });
      q.equalTo('requestedBy', { __type: 'Pointer', className: 'AmexingUser', objectId: currentUser.id });
      q.equalTo('exists', true);
      q.notEqualTo('status', 'pending');
      q.equalTo('seenByRequester', false);
      q.limit(500);
      const records = await q.find({ useMasterKey: true });
      records.forEach((r) => r.set('seenByRequester', true));
      if (records.length) await Parse.Object.saveAll(records, { useMasterKey: true });

      // Limpiar los marcadores inline resueltos del owner en el subconcepto.
      const quote = await new Parse.Query('Quote').equalTo('exists', true).get(quoteId, { useMasterKey: true }).catch(() => null);
      if (quote) {
        const serviceItems = quote.get('serviceItems') || {};
        let changed = false;
        const newDays = (serviceItems.days || []).map((d) => ({
          ...d,
          subconcepts: (d.subconcepts || []).map((sc) => {
            const cr = sc && sc.changeRequest;
            if (cr && cr.status && cr.status !== 'pending' && cr.requestedBy === currentUser.id) {
              changed = true;
              const rest = { ...sc };
              delete rest.changeRequest;
              return rest;
            }
            return sc;
          }),
        }));
        if (changed) {
          serviceItems.days = newDays;
          quote.set('serviceItems', serviceItems);
          await quote.save(null, { useMasterKey: true });
        }
      }

      return this.sendSuccess(res, { seen: records.length }, 'OK', 200);
    } catch (error) {
      logger.error('Error in markServiceChangeRequestsSeen', { error: error.message });
      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error',
        500
      );
    }
  }

  /**
   * GET /api/quotes/:id/activity — Timeline de actividades legible de la cotización (Fase A).
   * Lo ven admin y owner/agencia (nivel 4+). Read-only.
   * @param {object} req - Express request; params id.
   * @param {object} res - Express response.
   * @returns {Promise<void>} JSON { activities }.
   * @example
   *   GET /api/quotes/abc/activity
   */
  async getQuoteActivity(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) return this.sendError(res, 'Autenticación requerida', 401);
      const { id: quoteId } = req.params;
      const activities = await QuoteActivityService.list(quoteId);
      return this.sendSuccess(res, { activities }, 'OK', 200);
    } catch (error) {
      logger.error('Error in getQuoteActivity', { error: error.message });
      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al obtener la actividad',
        500
      );
    }
  }

  /**
   * Generate unique folio for quote
   * Format: QTE-YYYY-0001.
   * @returns {Promise<string>} Generated folio.
   * @example
   */
  async generateFolio() {
    try {
      const year = new Date().getFullYear();
      const prefix = `QTE-${year}-`;

      // Find the highest existing folio for this year (include ALL quotes, even deleted)
      const query = new Parse.Query('Quote');
      query.startsWith('folio', prefix);
      query.descending('folio');
      query.limit(1);
      query.select('folio');

      const lastQuote = await query.first({ useMasterKey: true });

      let nextNumber = 1;
      if (lastQuote) {
        const lastFolio = lastQuote.get('folio');
        const lastNumber = parseInt(lastFolio.replace(prefix, ''), 10);
        if (!Number.isNaN(lastNumber)) nextNumber = lastNumber + 1;
      }

      return `${prefix}${String(nextNumber).padStart(4, '0')}`;
    } catch (error) {
      logger.error('Error generating folio', { error: error.message });
      return `QTE-${new Date().getFullYear()}-${Date.now()}`;
    }
  }

  /**
   * Send success response.
   * @param {object} res - Express response object.
   * @param {object} data - Response data.
   * @param {string} message - Success message.
   * @param {number} statusCode - HTTP status code.
   * @returns {object} JSON response.
   * @example
   */
  sendSuccess(res, data, message, statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
    });
  }

  /**
   * Get available services (transfers) for a quote filtered by its assigned rate.
   * GET /api/quotes/:id/available-services
   * Used by quote-services.ejs to populate transfer selector.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Response structure:
   * {
   *   success: true,
   *   data: [{
   *     value: "service123",
   *     label: "Aeropuerto Internacional → Hotel Rosewood",
   *     vehicleType: "Sprinter",
   *     vehicleTypeId: "vt456",
   *     price: 2500.00,
   *     note: "Recepción en sala VIP",
   *     isRoundTrip: false,
   *     serviceType: "Aeropuerto"
   *   }]
   * }
   */
  async getAvailableServicesForQuote(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const quoteId = req.params.id;
      if (!quoteId) {
        return this.sendError(res, 'El ID de la cotización es requerido', 400);
      }

      // Get quote
      const query = new Parse.Query('Quote');
      query.include('rate');
      query.equalTo('exists', true);

      const quote = await query.get(quoteId, { useMasterKey: true });

      if (!quote) {
        return this.sendError(res, 'Cotización no encontrada', 404);
      }

      // Get quote's rate
      const rate = quote.get('rate');
      if (!rate) {
        return this.sendError(res, 'La cotización no tiene una tarifa asignada', 400);
      }

      await rate.fetch({ useMasterKey: true });

      // Get services filtered by this rate
      const servicesQuery = new Parse.Query('Service');
      servicesQuery.equalTo('rate', rate);
      servicesQuery.equalTo('active', true);
      servicesQuery.equalTo('exists', true);
      servicesQuery.include('originPOI');
      servicesQuery.include('destinationPOI');
      servicesQuery.include('destinationPOI.serviceType');
      servicesQuery.include('vehicleType');
      servicesQuery.limit(1000); // Support large datasets

      const services = await servicesQuery.find({ useMasterKey: true });

      // Group services by route (origin → destination)
      const routeMap = new Map();

      // Use for...of to support async price calculations
      for (const service of services) {
        const originPOI = service.get('originPOI');
        const destinationPOI = service.get('destinationPOI');
        const vehicleType = service.get('vehicleType');
        const serviceType = destinationPOI?.get('serviceType');

        const originId = originPOI ? originPOI.id : 'local';
        const destinationId = destinationPOI ? destinationPOI.id : '';
        const routeKey = `${originId}_${destinationId}`;

        const originName = originPOI ? originPOI.get('name') : 'Local';
        const destinationName = destinationPOI ? destinationPOI.get('name') : '';
        const isRoundTrip = service.get('isRoundTrip') || false;

        if (!routeMap.has(routeKey)) {
          routeMap.set(routeKey, {
            routeKey,
            originName,
            destinationName,
            originId,
            destinationId,
            serviceType: serviceType ? serviceType.get('name') : '',
            vehicles: [],
            hasRoundTrip: false, // Will be set to true if any vehicle is round trip
          });
        }

        // Update hasRoundTrip flag if this service is round trip
        const route = routeMap.get(routeKey);
        if (isRoundTrip) {
          route.hasRoundTrip = true;
        }

        // Get price breakdown with surcharge
        const basePrice = service.get('price') || 0;
        const priceBreakdown = pricingHelper.getBasePriceBreakdown(basePrice);

        // Add vehicle type to this route with price breakdown
        route.vehicles.push({
          serviceId: service.id,
          vehicleType: vehicleType ? vehicleType.get('name') : '',
          vehicleTypeId: vehicleType ? vehicleType.id : null,
          capacity: vehicleType ? vehicleType.get('defaultCapacity') || 4 : 4,
          basePrice: priceBreakdown.basePrice, // Cash price (precio efectivo)
          price: priceBreakdown.totalPrice, // Price with surcharge (precio base - default display)
          surcharge: priceBreakdown.surcharge, // Surcharge amount
          surchargePercentage: priceBreakdown.surchargePercentage, // Current percentage
          note: service.get('note') || '',
          isRoundTrip,
        });
      }

      // Convert map to array and add labels with appropriate arrows
      const groupedRoutes = Array.from(routeMap.values()).map((route) => {
        const arrow = route.hasRoundTrip ? '<->' : '->';
        const label = route.originName === 'Local'
          ? route.destinationName
          : `${route.originName} ${arrow} ${route.destinationName}`;

        return {
          ...route,
          label,
        };
      });

      logger.info('Available services fetched and grouped for quote', {
        quoteId,
        rateId: rate.id,
        rateName: rate.get('name'),
        servicesCount: services.length,
        routesCount: groupedRoutes.length,
        userId: currentUser.id,
      });

      return res.json({
        success: true,
        data: groupedRoutes,
      });
    } catch (error) {
      logger.error('Error in QuoteController.getAvailableServicesForQuote', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al obtener los servicios disponibles', 500);
    }
  }

  /**
   * Get available services filtered by specific rate (not quote-level).
   * GET /api/quotes/services-by-rate/:rateId?numberOfPeople=X.
   *
   * Used when adding traslado subconcept - user selects rate first, then service.
   * Returns services grouped by route with vehicle types and pricing.
   * Filters vehicles by capacity if numberOfPeople query parameter is provided.
   * Includes trunk capacity for each vehicle type.
   * @param {object} req - Express request object.
   * @param {string} req.params.rateId - Rate ID to filter services.
   * @param {number} [req.query.numberOfPeople] - Optional number of people for capacity filtering.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/quotes/services-by-rate/ABC123?numberOfPeople=10
   * Response: { success: true, data: [{ routeKey, originName, destinationName, vehicles: [{ capacity: 14, trunkCapacity: 10, ... }] }] }
   */
  async getAvailableServicesByRate(req, res) {
    try {
      // 1. Verify authenticated user
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // 2. Get rate ID from params and optional quoteNumberOfPeople from query
      const { rateId } = req.params;
      const quoteNumberOfPeople = parseInt(req.query.numberOfPeople) || 0;

      if (!rateId) {
        return this.sendError(res, 'El ID de la tarifa es requerido', 400);
      }

      // 3. Fetch rate
      const rateQuery = new Parse.Query('Rate');
      const rate = await rateQuery.get(rateId, { useMasterKey: true });

      if (!rate) {
        return this.sendError(res, 'Tarifa no encontrada', 404);
      }

      // 4. Get RatePrices filtered by this rate (matching traslados system)
      const ratePricesQuery = new Parse.Query('RatePrices');
      ratePricesQuery.equalTo('rate', {
        __type: 'Pointer',
        className: 'Rate',
        objectId: rateId,
      });
      ratePricesQuery.equalTo('exists', true);
      ratePricesQuery.equalTo('active', true);
      ratePricesQuery.doesNotExist('valid_until'); // Only active (non-historical) prices
      ratePricesQuery.include([
        'service',
        'service.originPOI',
        'service.destinationPOI',
        'service.originPOI.serviceType',
        'service.destinationPOI.serviceType',
        'vehicleType',
      ]);
      ratePricesQuery.limit(1000); // Support large datasets

      const ratePrices = await ratePricesQuery.find({ useMasterKey: true });

      // 5. Group services by route (origin → destination)
      const routeMap = new Map();

      // Use for...of to support async price calculations
      for (const ratePrice of ratePrices) {
        const service = ratePrice.get('service');
        const originPOI = service?.get('originPOI');
        const destinationPOI = service?.get('destinationPOI');
        const vehicleType = ratePrice.get('vehicleType');
        const serviceType = destinationPOI?.get('serviceType');

        const originId = originPOI ? originPOI.id : 'local';
        const destinationId = destinationPOI ? destinationPOI.id : '';
        const routeKey = `${originId}_${destinationId}`;

        const originName = originPOI ? originPOI.get('name') : 'Local';
        const destinationName = destinationPOI ? destinationPOI.get('name') : '';
        const isRoundTrip = service.get('isRoundTrip') || false;

        if (!routeMap.has(routeKey)) {
          routeMap.set(routeKey, {
            routeKey,
            originName,
            destinationName,
            originId,
            destinationId,
            serviceType: serviceType ? serviceType.get('name') : '',
            vehicles: [],
            hasRoundTrip: false, // Will be set to true if any vehicle is round trip
          });
        }

        // Update hasRoundTrip flag if this service is round trip
        const route = routeMap.get(routeKey);
        if (isRoundTrip) {
          route.hasRoundTrip = true;
        }

        // Get vehicle capacity
        const vehicleCapacity = vehicleType ? vehicleType.get('defaultCapacity') || 4 : 4;
        const trunkCapacity = vehicleType ? vehicleType.get('trunkCapacity') || 0 : 0;

        // Filter by capacity if quoteNumberOfPeople is provided
        // Only add vehicle if it meets capacity requirements
        if (!(quoteNumberOfPeople > 0 && vehicleCapacity < quoteNumberOfPeople)) {
          // Get price breakdown with surcharge (from RatePrices record)
          const basePrice = ratePrice.get('price') || 0;
          const priceBreakdown = pricingHelper.getBasePriceBreakdown(basePrice);

          // Add vehicle type to this route with price breakdown and capacity info
          route.vehicles.push({
            serviceId: service.id,
            vehicleType: vehicleType ? vehicleType.get('name') : '',
            vehicleTypeId: vehicleType ? vehicleType.id : null,
            capacity: vehicleCapacity,
            trunkCapacity,
            basePrice: priceBreakdown.basePrice, // Cash price (precio efectivo)
            price: priceBreakdown.totalPrice, // Price with surcharge (precio base - default display)
            surcharge: priceBreakdown.surcharge, // Surcharge amount
            surchargePercentage: priceBreakdown.surchargePercentage, // Current percentage
            note: service.get('note') || '',
            isRoundTrip,
          });
        }
      }

      // 6. Convert map to array and add labels with appropriate arrows
      const groupedRoutes = Array.from(routeMap.values()).map((route) => {
        const arrow = route.hasRoundTrip ? '<->' : '->';
        const label = route.originName === 'Local'
          ? route.destinationName
          : `${route.originName} ${arrow} ${route.destinationName}`;

        return {
          ...route,
          label,
        };
      });

      logger.info('Available services fetched and grouped by rate', {
        rateId,
        rateName: rate.get('name'),
        servicesCount: ratePrices.length,
        routesCount: groupedRoutes.length,
        userId: currentUser.id,
      });

      return res.json({
        success: true,
        data: groupedRoutes,
      });
    } catch (error) {
      logger.error('Error in QuoteController.getAvailableServicesByRate', {
        error: error.message,
        stack: error.stack,
        rateId: req.params.rateId,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al obtener los servicios disponibles', 500);
    }
  }

  /**
   * Get available tours filtered by specific rate (not quote-level).
   * GET /api/quotes/tours-by-rate/:rateId.
   *
   * Used when adding tour subconcept - user selects rate first, then tour.
   * Returns tours grouped by destination with vehicle types and pricing.
   * @param {object} req - Express request object.
   * @param {string} req.params.rateId - Rate ID to filter tours.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/quotes/tours-by-rate/ABC123
   * Response: { success: true, data: [{ destinationKey, destinationName, vehicles: [...] }] }
   */
  async getAvailableToursByRate(req, res) {
    try {
      // 1. Verify authenticated user
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // 2. Get rate ID from params
      const { rateId } = req.params;
      if (!rateId) {
        return this.sendError(res, 'El ID de la tarifa es requerido', 400);
      }

      // 3. Fetch rate
      const rateQuery = new Parse.Query('Rate');
      const rate = await rateQuery.get(rateId, { useMasterKey: true });

      if (!rate) {
        return this.sendError(res, 'Tarifa no encontrada', 404);
      }

      // 4. Get tours filtered by this rate
      const toursQuery = new Parse.Query('Tours');
      toursQuery.equalTo('rate', rate);
      toursQuery.equalTo('active', true);
      toursQuery.equalTo('exists', true);
      toursQuery.include('destinationPOI');
      toursQuery.include('vehicleType');
      toursQuery.limit(1000); // Support large datasets

      const tours = await toursQuery.find({ useMasterKey: true });

      // 5. Group tours by destination POI
      const destinationMap = new Map();

      // Use for...of to support async price calculations
      for (const tour of tours) {
        const destinationPOI = tour.get('destinationPOI');
        const vehicleType = tour.get('vehicleType');

        const destinationId = destinationPOI ? destinationPOI.id : 'unknown';
        const destinationName = destinationPOI ? destinationPOI.get('name') : 'Sin destino';

        if (!destinationMap.has(destinationId)) {
          destinationMap.set(destinationId, {
            destinationKey: destinationId,
            destinationName,
            vehicles: [],
          });
        }

        // Get price breakdown with surcharge
        const basePrice = tour.get('price') || 0;
        const priceBreakdown = pricingHelper.getBasePriceBreakdown(basePrice);

        // Get duration in minutes and convert to hours
        const durationMinutes = tour.get('time') || 0;
        const durationHours = Math.round((durationMinutes / 60) * 10) / 10; // Round to 1 decimal

        // Add vehicle type to this destination with price breakdown
        const destination = destinationMap.get(destinationId);
        destination.vehicles.push({
          tourId: tour.id,
          vehicleType: vehicleType ? vehicleType.get('name') : '',
          vehicleTypeId: vehicleType ? vehicleType.id : null,
          capacity: vehicleType ? vehicleType.get('defaultCapacity') || 4 : 4,
          basePrice: priceBreakdown.basePrice, // Cash price (precio efectivo)
          price: priceBreakdown.totalPrice, // Price with surcharge (precio base - default display)
          surcharge: priceBreakdown.surcharge, // Surcharge amount
          surchargePercentage: priceBreakdown.surchargePercentage, // Current percentage
          durationMinutes, // Original duration in minutes
          durationHours, // Converted to hours for display
          minPassengers: tour.get('minPassengers') || null,
          maxPassengers: tour.get('maxPassengers') || null,
          note: tour.get('notes') || '',
        });
      }

      // 6. Convert map to array and add labels
      const groupedDestinations = Array.from(destinationMap.values()).map((destination) => ({
        ...destination,
        label: destination.destinationName, // For dropdown display
      }));

      logger.info('Available tours fetched and grouped by destination', {
        rateId,
        rateName: rate.get('name'),
        toursCount: tours.length,
        destinationsCount: groupedDestinations.length,
        userId: currentUser.id,
      });

      return res.json({
        success: true,
        data: groupedDestinations,
      });
    } catch (error) {
      logger.error('Error in QuoteController.getAvailableToursByRate', {
        error: error.message,
        stack: error.stack,
        rateId: req.params.rateId,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al obtener los tours disponibles', 500);
    }
  }

  /**
   * Get unique tour destinations for a specific rate (Step 2 of 3-step tour selection).
   * GET /api/quotes/tours/destinations-by-rate/:rateId?dayDate=YYYY-MM-DD.
   *
   * Returns list of unique destinations that have tours available for the specified rate.
   * Supports day-of-week filtering via optional dayDate query parameter.
   * This is the second step in the tour selection flow: Rate → Destination → Vehicle.
   * @param {object} req - Express request object with rateId in params.
   * @param {string} [req.query.dayDate] - Optional date in YYYY-MM-DD format for day-of-week filtering.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/quotes/tours/destinations-by-rate/ABC123?dayDate=2024-12-25
   * Response: {
   *   success: true,
   *   data: [
   *     { destinationId: 'abc123', destinationName: 'San Miguel de Allende' },
   *     { destinationId: 'def456', destinationName: 'Dolores Hidalgo' }
   *   ]
   * }
   */
  async getTourDestinationsByRate(req, res) {
    try {
      // 1. Verify authenticated user
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // 2. Get rate ID from params and optional dayDate from query
      const { rateId } = req.params;
      const { dayDate } = req.query;

      if (!rateId) {
        return this.sendError(res, 'El ID de la tarifa es requerido', 400);
      }

      // 3. Fetch rate
      const rateQuery = new Parse.Query('Rate');
      const rate = await rateQuery.get(rateId, { useMasterKey: true });

      if (!rate) {
        return this.sendError(res, 'Tarifa no encontrada', 404);
      }

      // 4. Get all tours for this rate
      const toursQuery = new Parse.Query('Tours');
      toursQuery.equalTo('rate', rate);
      toursQuery.equalTo('active', true);
      toursQuery.equalTo('exists', true);
      toursQuery.include('destinationPOI');
      toursQuery.limit(1000);

      let tours = await toursQuery.find({ useMasterKey: true });

      // Apply day-of-week filtering if dayDate provided (client-side filtering)
      // Note: We filter client-side because not all tours have availability field defined
      if (dayDate && tours.length > 0) {
        const QuoteServiceHelper = require('../../services/QuoteServiceHelper');
        const dayCode = QuoteServiceHelper.getDayOfWeekCode(dayDate);

        if (dayCode !== null) {
          tours = tours.filter((tour) => {
            const availability = tour.get('availability');

            // If no availability field, include the tour (available all days)
            if (!availability || !Array.isArray(availability)) {
              return true;
            }

            // Check if tour is available on the specified day
            return availability.some((avail) => avail.day === dayCode);
          });
        }
      }

      // 5. Extract unique destinations
      const destinationMap = new Map();

      tours.forEach((tour) => {
        const destinationPOI = tour.get('destinationPOI');
        if (destinationPOI) {
          const destinationId = destinationPOI.id;
          const destinationName = destinationPOI.get('name');

          if (!destinationMap.has(destinationId)) {
            destinationMap.set(destinationId, {
              destinationId,
              destinationName,
            });
          }
        }
      });

      // 6. Convert map to array
      const uniqueDestinations = Array.from(destinationMap.values());

      logger.info('Tour destinations fetched for rate', {
        rateId,
        rateName: rate.get('name'),
        destinationsCount: uniqueDestinations.length,
        userId: currentUser.id,
      });

      return res.json({
        success: true,
        data: uniqueDestinations,
      });
    } catch (error) {
      logger.error('Error in QuoteController.getTourDestinationsByRate', {
        error: error.message,
        stack: error.stack,
        rateId: req.params.rateId,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al obtener destinos de tours', 500);
    }
  }

  /**
   * Get available vehicles for a specific rate and destination (Step 3 of 3-step tour selection).
   * GET /api/quotes/tours/vehicles-by-rate-destination/:rateId/:destinationId?numberOfPeople=X&dayDate=YYYY-MM-DD.
   *
   * Returns list of vehicle types available for the specified rate + destination combination.
   * Each vehicle includes tour details (tourId, price, duration, capacity, trunk capacity).
   * Supports filtering by capacity and day-of-week availability.
   * This is the third step in the tour selection flow: Rate → Destination → Vehicle.
   * @param {object} req - Express request object with rateId and destinationId in params.
   * @param {number} [req.query.numberOfPeople] - Optional number of people for capacity filtering.
   * @param {string} [req.query.dayDate] - Optional date in YYYY-MM-DD format for day-of-week filtering.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/quotes/tours/vehicles-by-rate-destination/ABC123/POI456?numberOfPeople=10&dayDate=2024-12-25
   * Response: {
   *   success: true,
   *   data: [
   *     {
   *       tourId: 'tour123',
   *       vehicleType: 'Sprinter',
   *       vehicleTypeId: 'veh456',
   *       capacity: 14,
   *       trunkCapacity: 10,
   *       basePrice: 925.72,
   *       price: 1065.58,
   *       surcharge: 139.86,
   *       surchargePercentage: 15.1,
   *       durationMinutes: 120,
   *       durationHours: 2.0
   *     }
   *   ]
   * }
   */
  async getTourVehiclesByRateAndDestination(req, res) {
    try {
      // 1. Verify authenticated user
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // 2. Get rate ID, destination ID from params, and optional numberOfPeople and dayDate from query
      const { rateId, destinationId } = req.params;
      const quoteNumberOfPeople = parseInt(req.query.numberOfPeople) || 0;
      const { dayDate } = req.query;

      if (!rateId || !destinationId) {
        return this.sendError(res, 'El ID de la tarifa y destino son requeridos', 400);
      }

      // 3. Fetch rate
      const rateQuery = new Parse.Query('Rate');
      const rate = await rateQuery.get(rateId, { useMasterKey: true });

      if (!rate) {
        return this.sendError(res, 'Tarifa no encontrada', 404);
      }

      // 4. Fetch destination POI
      const poiQuery = new Parse.Query('POI');
      const destinationPOI = await poiQuery.get(destinationId, { useMasterKey: true });

      if (!destinationPOI) {
        return this.sendError(res, 'Destino no encontrado', 404);
      }

      // 5. Get tours filtered by rate AND destination
      const toursQuery = new Parse.Query('Tours');
      toursQuery.equalTo('rate', rate);
      toursQuery.equalTo('destinationPOI', destinationPOI);
      toursQuery.equalTo('active', true);
      toursQuery.equalTo('exists', true);
      toursQuery.include('vehicleType');
      toursQuery.limit(1000);

      let tours = await toursQuery.find({ useMasterKey: true });

      logger.info('[DEBUG] Tours found before filtering', {
        count: tours.length,
        rateId,
        destinationId,
        dayDate,
        numberOfPeople: quoteNumberOfPeople,
      });

      // Apply day-of-week filtering if dayDate provided (client-side filtering)
      // Note: We filter client-side because not all tours have availability field defined
      if (dayDate && tours.length > 0) {
        const QuoteServiceHelper = require('../../services/QuoteServiceHelper');
        const dayCode = QuoteServiceHelper.getDayOfWeekCode(dayDate);

        logger.info('[DEBUG] Day filtering', {
          dayDate,
          dayCode,
          toursBeforeFilter: tours.length,
        });

        if (dayCode !== null) {
          tours = tours.filter((tour) => {
            const availability = tour.get('availability');

            // If no availability field, include the tour (available all days)
            if (!availability || !Array.isArray(availability)) {
              logger.info('[DEBUG] Tour included - no availability field', {
                tourId: tour.id,
                vehicleType: tour.get('vehicleType')?.get('name'),
              });
              return true;
            }

            // Check if tour is available on the specified day
            const isAvailable = availability.some((avail) => avail.day === dayCode);
            logger.info('[DEBUG] Tour availability check', {
              tourId: tour.id,
              vehicleType: tour.get('vehicleType')?.get('name'),
              availability: availability.map((a) => a.day),
              dayCode,
              isAvailable,
            });
            return isAvailable;
          });

          logger.info('[DEBUG] After day filtering', {
            toursAfterFilter: tours.length,
          });
        }
      }

      if (tours.length === 0) {
        logger.warn('[DEBUG] No tours found after filtering', {
          rateId,
          destinationId,
          dayDate,
          numberOfPeople: quoteNumberOfPeople,
        });
        return this.sendResponse(res, []);
      }

      // 6. Build vehicle list with pricing
      const vehicles = [];

      logger.info('[DEBUG] Building vehicle list', {
        toursCount: tours.length,
        numberOfPeople: quoteNumberOfPeople,
      });

      for (const tour of tours) {
        const vehicleType = tour.get('vehicleType');

        if (vehicleType) {
          // Get vehicle capacity
          const vehicleCapacity = vehicleType ? vehicleType.get('defaultCapacity') || 4 : 4;
          const trunkCapacity = vehicleType ? vehicleType.get('trunkCapacity') || 0 : 0;

          // Check if vehicle has sufficient capacity
          const hasSufficientCapacity = !(quoteNumberOfPeople > 0 && vehicleCapacity < quoteNumberOfPeople);

          logger.info('[DEBUG] Checking vehicle capacity', {
            tourId: tour.id,
            vehicleType: vehicleType.get('name'),
            vehicleCapacity,
            quoteNumberOfPeople,
            hasSufficientCapacity,
            willInclude: true, // Always include for now, show warning in frontend
          });

          // CAPACITY WARNING IMPLEMENTATION (Option B):
          // All vehicles are included in the response, regardless of capacity.
          // The 'hasSufficientCapacity' flag is sent to frontend for warning display.
          // Frontend shows visual warnings (red text + alert) when capacity is insufficient.
          // This allows users to select any vehicle but be informed of capacity limitations.
          if (true) {
            // Include all vehicles
            // Get price breakdown with surcharge
            const basePrice = tour.get('price') || 0;
            const priceBreakdown = pricingHelper.getBasePriceBreakdown(basePrice);

            // Get duration in minutes and convert to hours
            const durationMinutes = tour.get('time') || 0;
            const durationHours = Math.round((durationMinutes / 60) * 10) / 10;

            vehicles.push({
              tourId: tour.id,
              vehicleType: vehicleType ? vehicleType.get('name') : '',
              vehicleTypeId: vehicleType ? vehicleType.id : null,
              capacity: vehicleCapacity,
              trunkCapacity,
              hasSufficientCapacity, // Flag to show warnings in frontend
              basePrice: priceBreakdown.basePrice,
              price: priceBreakdown.totalPrice,
              surcharge: priceBreakdown.surcharge,
              surchargePercentage: priceBreakdown.surchargePercentage,
              durationMinutes,
              durationHours,
              minPassengers: tour.get('minPassengers') || null,
              maxPassengers: tour.get('maxPassengers') || null,
              note: tour.get('notes') || '',
            });
          }
        }
      }

      logger.info('[DEBUG] Final vehicles list', {
        vehiclesCount: vehicles.length,
        vehicles: vehicles.map((v) => ({
          vehicleType: v.vehicleType,
          capacity: v.capacity,
          price: v.price,
        })),
      });

      logger.info('Tour vehicles fetched for rate and destination', {
        rateId,
        rateName: rate.get('name'),
        destinationId,
        destinationName: destinationPOI.get('name'),
        vehiclesCount: vehicles.length,
        userId: currentUser.id,
      });

      return res.json({
        success: true,
        data: vehicles,
      });
    } catch (error) {
      logger.error('Error in QuoteController.getTourVehiclesByRateAndDestination', {
        error: error.message,
        stack: error.stack,
        rateId: req.params.rateId,
        destinationId: req.params.destinationId,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al obtener vehículos de tours', 500);
    }
  }

  /**
   * Generate share link for public quote viewing.
   * POST /api/quotes/:id/share-link.
   *
   * Generates a shareable public URL using the quote's folio.
   * No token generation needed - folio acts as the access key.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * POST /api/quotes/A2tZ1JtzD4/share-link
   * Response: { success: true, data: { shareUrl: "http://localhost:1337/quotes/QTE-2025-0004" } }
   */
  async generateShareLink(req, res) {
    try {
      // 1. Verify authenticated user
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Usuario no autenticado', 401);
      }

      // 2. Get quote ID from params
      const { id } = req.params;
      if (!id) {
        return this.sendError(res, 'ID de cotización requerido', 400);
      }

      // 3. Fetch quote
      const query = new Parse.Query('Quote');
      query.equalTo('exists', true);
      const quote = await query.get(id, { useMasterKey: true });

      if (!quote) {
        return this.sendError(res, 'Cotización no encontrada', 404);
      }

      // 4. Verify quote is active
      const isActive = quote.get('active');
      if (!isActive) {
        return this.sendError(res, 'No se puede compartir una cotización inactiva', 400);
      }

      // 5. Get folio (required for public access)
      const folio = quote.get('folio');
      if (!folio) {
        return this.sendError(res, 'La cotización no tiene folio asignado', 500);
      }

      // 6. Generate share URL using folio, plus the quote id (?q=) so the public
      // view resolves the exact record even if the folio is duplicated.
      const { protocol } = req; // http or https
      const host = req.get('host'); // localhost:1337 or domain
      const shareUrl = `${protocol}://${host}/quotes/${folio}?q=${quote.id}`;

      // 7. Log share link generation for audit trail
      logger.info('Share link generated for quote', {
        quoteId: quote.id,
        folio,
        shareUrl,
        generatedBy: currentUser.id,
        timestamp: new Date().toISOString(),
      });

      // 8. Return share URL
      return res.json({
        success: true,
        data: {
          shareUrl,
          folio,
          quoteId: quote.id,
        },
      });
    } catch (error) {
      logger.error('Error in QuoteController.generateShareLink', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al generar enlace de compartir', 500);
    }
  }

  /**
   * Check if a user has access to view a specific quote.
   * Used for single quote access validation in getQuoteById.
   * @param {object} currentUser - Current authenticated user.
   * @param {object} quote - Parse Quote object.
   * @param {string} userRole - User role from middleware.
   * @returns {Promise<boolean>} True if user has access, false otherwise.
   * @example
   * const hasAccess = await this.checkQuoteAccess(currentUser, quote, userRole);
   */
  async checkQuoteAccess(currentUser, quote, userRole) {
    try {
      // Super admins and admins can access all quotes
      if (userRole === 'superadmin' || userRole === 'admin') {
        return true;
      }

      // For non-client roles, having created the quote grants access.
      // Clients are gated strictly by current ownership below (created == owner unless transferred).
      const createdBy = quote.get('createdBy');
      if (userRole !== 'client' && createdBy && createdBy.id === currentUser.id) {
        return true;
      }

      // Department managers can access quotes created by users in their department or organization
      if (userRole === 'department_manager') {
        const userDepartmentId = currentUser.departmentId || currentUser.get('departmentId');

        // Check if client pointer matches the current user (quotes assigned to them)
        const clientPtr = quote.get('client');
        if (clientPtr && clientPtr.id === currentUser.id) {
          return true;
        }

        if (createdBy) {
          try {
            const creatorQuery = new Parse.Query('AmexingUser');
            const creator = await creatorQuery.get(createdBy.id, { useMasterKey: true });

            if (creator) {
              // Check same department
              const creatorDepartmentId = creator.departmentId || creator.get('departmentId');
              if (userDepartmentId && creatorDepartmentId === userDepartmentId) {
                return true;
              }
              // Check if creator's clientId points to current user (org member)
              const creatorClientId = creator.get('clientId');
              if (creatorClientId === currentUser.id) {
                return true;
              }
            }
          } catch (error) {
            logger.warn('Could not fetch quote creator for access check', {
              createdById: createdBy.id,
              error: error.message,
            });
          }
        }
      }

      // Clients can access ONLY quotes they currently own. Collaboration-shared quotes
      // are granted earlier in getQuoteById via collaborationService.hasAccess.
      if (userRole === 'client') {
        const ownerPtr = quote.get('owner');
        if (ownerPtr && ownerPtr.id === currentUser.id) {
          return true;
        }
        // Legacy quotes without an owner pointer: creator is the de-facto owner.
        if (!ownerPtr && createdBy && createdBy.id === currentUser.id) {
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Error checking quote access', {
        error: error.message,
        userId: currentUser.id,
        quoteId: quote.id,
        role: userRole,
      });
      return false;
    }
  }

  /**
   * Apply role-based filters to quote queries.
   * Ensures department managers only see quotes created by users in their department.
   * @param {Parse.Query} query - Parse query to apply filters to.
   * @param {object} currentUser - Current authenticated user.
   * @param {string} userRole - User role from middleware.
   * @returns {Promise<void>}
   * @example
   * // Apply filters to a quote query
   * await this.applyRoleBasedQuoteFilters(query, currentUser, userRole);
   */
  async applyRoleBasedQuoteFilters(query, currentUser, userRole) {
    try {
      logger.debug('Applying role-based quote filters', {
        userId: currentUser.id,
        role: userRole,
      });

      // Super admins and admins can see all quotes
      if (userRole === 'superadmin' || userRole === 'admin') {
        logger.debug('Admin/superadmin user - showing all quotes', { userRole });
        return; // No additional filters needed
      }

      // Department managers see ALL quotes related to their department users (no ownership/collaboration restrictions)
      if (userRole === 'department_manager') {
        const userDepartmentId = currentUser.departmentId || currentUser.get('departmentId');

        if (!userDepartmentId) {
          logger.warn('Department manager missing departmentId, restricting to own quotes only', {
            userId: currentUser.id,
            role: userRole,
          });
          query.equalTo('client', {
            __type: 'Pointer',
            className: 'AmexingUser',
            objectId: currentUser.id,
          });
          return;
        }

        // Find all users in the same department
        const departmentUsersQuery = new Parse.Query('AmexingUser');
        departmentUsersQuery.equalTo('departmentId', userDepartmentId);
        departmentUsersQuery.equalTo('exists', true);
        departmentUsersQuery.equalTo('active', true);

        const departmentUsers = await departmentUsersQuery.find({ useMasterKey: true });

        // Also find users whose clientId points to this manager (org members)
        const orgUsersQuery = new Parse.Query('AmexingUser');
        orgUsersQuery.equalTo('clientId', currentUser.id);
        orgUsersQuery.equalTo('exists', true);
        orgUsersQuery.equalTo('active', true);

        const orgUsers = await orgUsersQuery.find({ useMasterKey: true });

        // Merge department + org users (deduplicate by id)
        const allUserIds = new Set();
        const allUserPointers = [];

        // Always include current user
        allUserIds.add(currentUser.id);
        allUserPointers.push({
          __type: 'Pointer',
          className: 'AmexingUser',
          objectId: currentUser.id,
        });

        [...departmentUsers, ...orgUsers].forEach((user) => {
          if (!allUserIds.has(user.id)) {
            allUserIds.add(user.id);
            allUserPointers.push({
              __type: 'Pointer',
              className: 'AmexingUser',
              objectId: user.id,
            });
          }
        });

        // Department managers get unrestricted access to ALL department quotes
        // No ownership/collaboration filtering - they see everything
        const queries = [];

        // Query 1: Quotes where any department user is the client
        const queryByClient = new Parse.Query('Quote');
        queryByClient.containedIn('client', allUserPointers);
        queries.push(queryByClient);

        // Query 2: Quotes created by any department user
        const queryByCreator = new Parse.Query('Quote');
        queryByCreator.containedIn('createdBy', allUserPointers);
        queries.push(queryByCreator);

        // Combine with OR
        // eslint-disable-next-line no-underscore-dangle
        query._orQuery(queries);

        logger.info('Applied unrestricted department filter to quotes query (department_manager)', {
          userId: currentUser.id,
          departmentId: userDepartmentId,
          departmentUsersCount: departmentUsers.length,
          orgUsersCount: orgUsers.length,
          totalUsersInScope: allUserPointers.length,
        });

        return;
      }

      // Clients see ONLY quotes they currently own (creator = initial owner; updated on
      // transfer via the denormalized `owner` pointer) PLUS quotes explicitly shared with
      // them via collaboration (QuoteAccess editor/viewer). No org-wide visibility.
      const userClientId = currentUser.clientId || currentUser.get('clientId');
      // client y end_client (cliente directo) ven SOLO sus cotizaciones (propias/compartidas).
      if (userRole === 'client' || userRole === 'end_client' || userClientId) {
        const currentUserPointer = {
          __type: 'Pointer',
          className: 'AmexingUser',
          objectId: currentUser.id,
        };

        // Quotes explicitly shared with this user via collaboration
        const accessQuery = new Parse.Query('QuoteAccess');
        accessQuery.equalTo('agent', currentUserPointer);
        accessQuery.equalTo('active', true);
        accessQuery.equalTo('exists', true);
        const accessRecords = await accessQuery.find({ useMasterKey: true });
        const now = new Date();
        const sharedQuoteIds = accessRecords
          // Match QuoteAccess.isValid(): exclude revoked and expired shares so the list
          // never shows a quote the open-gate (hasAccess) would 403.
          .filter((access) => access.get('revoked') !== true)
          .filter((access) => {
            const expiresAt = access.get('expiresAt');
            return !expiresAt || expiresAt > now;
          })
          .map((access) => access.get('quote')?.id)
          .filter((id) => id);

        const queries = [];

        // Current owner (creator = initial owner; pointer updated on transfer)
        const queryByOwner = new Parse.Query('Quote');
        queryByOwner.equalTo('owner', currentUserPointer);
        queries.push(queryByOwner);

        // Fallback for legacy quotes without an `owner` pointer: the creator is the
        // de-facto owner (mirrors QuoteOwnershipService.transferOwnership fallback).
        const queryByCreator = new Parse.Query('Quote');
        queryByCreator.equalTo('createdBy', currentUserPointer);
        queryByCreator.doesNotExist('owner');
        queries.push(queryByCreator);

        // Quotes explicitly shared with this user via collaboration
        if (sharedQuoteIds.length > 0) {
          const queryByCollaboration = new Parse.Query('Quote');
          queryByCollaboration.containedIn('objectId', sharedQuoteIds);
          queries.push(queryByCollaboration);
        }

        // eslint-disable-next-line no-underscore-dangle
        query._orQuery(queries);

        logger.info('Applied owner + collaboration filter to quotes query (client)', {
          userId: currentUser.id,
          clientId: userClientId,
          sharedQuotesCount: sharedQuoteIds.length,
        });

        return;
      }

      // Employees, drivers, guests can only see their own quotes
      query.equalTo('createdBy', {
        __type: 'Pointer',
        className: 'AmexingUser',
        objectId: currentUser.id,
      });

      logger.info('Applied user-only filter to quotes query', {
        userId: currentUser.id,
        role: userRole,
      });
    } catch (error) {
      logger.error('Error applying role-based quote filters', {
        error: error.message,
        userId: currentUser.id,
        role: userRole,
      });

      // On error, restrict to user's own quotes as fallback
      query.equalTo('createdBy', {
        __type: 'Pointer',
        className: 'AmexingUser',
        objectId: currentUser.id,
      });
    }
  }

  /**
   * Generate receipt for reserved quote.
   * POST /api/quotes/:id/generate-receipt.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async generateReceipt(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const quoteId = req.params.id;

      // Get payment info parameters from request body (for admin role)
      // billingProfileId: perfil fiscal de la agencia a imprimir en el recibo (los 3 roles).
      // force: solo admin/superadmin puede saltarse el bloqueo de "reservación no saldada".
      const {
        includePaymentInfo,
        paymentInfoId,
        billingProfileId,
        force,
      } = req.body;

      const result = await this.quoteService.generateReceipt(
        currentUser,
        quoteId,
        req.userRole, // Pass userRole from JWT middleware
        includePaymentInfo, // Pass the flag from request
        paymentInfoId, // Pass the specific payment info ID
        billingProfileId, // Perfil de facturación elegido (o undefined)
        force === true // Override admin del bloqueo de reservación no saldada
      );

      // If PDF buffer is returned, send it as a downloadable file
      if (result.success && result.data.pdfBuffer) {
        const { pdfBuffer, filename } = result.data;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        return res.send(pdfBuffer);
      }

      return res.json(result);
    } catch (error) {
      // Reservación no saldada: 409 estructurado para que el front muestre el saldo pendiente
      // y (solo a admin/superadmin) ofrezca "Generar de todos modos".
      if (error && error.code === 'RESERVATION_NOT_SETTLED') {
        return res.status(409).json({
          success: false,
          code: 'RESERVATION_NOT_SETTLED',
          error: error.message,
          data: error.payment || null,
        });
      }

      logger.error('Error in QuoteController.generateReceipt', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al generar el recibo',
        500
      );
    }
  }

  /**
   * GET /api/quotes/:id/billing-profiles — Perfiles de facturación de la AGENCIA de la
   * cotización (quote.client = AmexingUser de la agencia), para elegir cuál se imprime en el
   * recibo. Devuelve además el perfil ya guardado en la reservación (o el principal) para
   * preseleccionarlo. Accesible por los roles que pueden generar el recibo (nivel 4+).
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>} JSON { success, data: { profiles, selectedProfileId } }.
   * @example
   *   GET /api/quotes/abc123/billing-profiles
   */
  async getQuoteBillingProfiles(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }
      const quoteId = req.params.id;

      const query = new Parse.Query('Quote');
      query.equalTo('exists', true);
      query.include('client');
      const quote = await query.get(quoteId, { useMasterKey: true });
      if (!quote) {
        return this.sendError(res, 'Cotización no encontrada', 404);
      }

      const agency = quote.get('client'); // AmexingUser de la agencia (o cliente directo)
      if (!agency) {
        return res.json({ success: true, data: { profiles: [], selectedProfileId: null } });
      }

      const bpQuery = new Parse.Query('BillingProfile');
      bpQuery.equalTo('userPtr', agency);
      bpQuery.equalTo('exists', true);
      bpQuery.equalTo('active', true);
      bpQuery.descending('isPrimary');
      bpQuery.addAscending('label');
      bpQuery.limit(200);
      const bps = await bpQuery.find({ useMasterKey: true });

      const profiles = bps.map((bp) => ({
        id: bp.id,
        label: bp.get('label') || bp.get('razonSocial') || bp.get('commercialName') || 'Perfil',
        rfc: bp.get('rfc') || bp.get('taxId') || '',
        razonSocial: bp.get('razonSocial') || bp.get('commercialName') || '',
        isPrimary: bp.get('isPrimary') || false,
      }));

      // Preselección: SIEMPRE el perfil principal (o el primero si ninguno es principal).
      const primary = profiles.find((p) => p.isPrimary);
      const selectedProfileId = primary ? primary.id : (profiles[0]?.id || null);

      return res.json({ success: true, data: { profiles, selectedProfileId } });
    } catch (error) {
      logger.error('Error in QuoteController.getQuoteBillingProfiles', {
        error: error.message, quoteId: req.params.id, userId: req.user?.id,
      });
      return this.sendError(res, 'Error al obtener perfiles de facturación', 500);
    }
  }

  /**
   * Send quote confirmation email with PDF attachment.
   * POST /api/quotes/:id/send-email.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async sendQuoteEmail(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const quoteId = req.params.id;

      // Fetch quote with includes
      const query = new Parse.Query('Quote');
      query.equalTo('exists', true);
      query.include('client');
      const quote = await query.get(quoteId, { useMasterKey: true });

      if (!quote) {
        return this.sendError(res, 'Cotización no encontrada', 404);
      }

      const emailService = require('../../services/EmailService');

      // Check if multiple recipients were provided
      const { recipients } = req.body || {};
      if (Array.isArray(recipients) && recipients.length > 0) {
        // Validate email format and cap at 10
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const uniqueEmails = [...new Set(recipients.map((e) => e.trim().toLowerCase()))];

        if (uniqueEmails.length > 10) {
          return this.sendError(res, 'Máximo 10 destinatarios permitidos', 400);
        }

        const invalidEmails = uniqueEmails.filter((e) => !emailRegex.test(e));
        if (invalidEmails.length > 0) {
          return this.sendError(res, `Email(s) inválido(s): ${invalidEmails.join(', ')}`, 400);
        }

        const results = await this.quoteService.sendQuoteEmailToMultiple(quote, currentUser, uniqueEmails);
        const totalSent = results.filter((r) => r.success).length;
        const totalFailed = results.filter((r) => !r.success).length;

        return res.json({
          success: totalSent > 0,
          message: totalFailed === 0
            ? `Correo enviado a ${totalSent} destinatario(s)`
            : `Correos enviados: ${totalSent} de ${uniqueEmails.length} exitoso(s)`,
          data: { results, totalSent, totalFailed },
        });
      }

      // Fallback: single-email behavior (backward compatible)
      const recipientEmail = quote.get('contactEmail')
        || currentUser.get('email');
      if (!recipientEmail) {
        return this.sendError(res, 'No se encontró un email de destinatario', 400);
      }

      await this.quoteService.sendScheduledConfirmationEmail(quote, currentUser, null);

      const maskedEmail = emailService.maskEmail(recipientEmail);

      return res.json({
        success: true,
        message: `Correo enviado a ${maskedEmail}`,
        data: { recipientEmail: maskedEmail },
      });
    } catch (error) {
      logger.error('Error sending quote email', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development'
          ? `Error: ${error.message}` : 'Error al enviar correo',
        500
      );
    }
  }

  /**
   * Request invoice for reserved quote.
   * POST /api/quotes/:id/request-invoice.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async requestInvoice(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const quoteId = req.params.id;

      const result = await this.quoteService.requestInvoice(
        currentUser,
        quoteId,
        req.userRole // Pass userRole from JWT middleware
      );

      return res.json(result);
    } catch (error) {
      logger.error('Error in QuoteController.requestInvoice', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
      });

      // Check for specific business rule errors that should return 400
      const businessRuleErrors = [
        'There is already a pending invoice request for this quote',
        'Quote must be in scheduled status to request invoice',
        'Quote not found',
        'Unauthorized: Role',
      ];

      const isBusinessRuleError = businessRuleErrors.some((errorText) => error.message.includes(errorText));

      const statusCode = isBusinessRuleError ? 400 : 500;
      let errorMessage;
      if (isBusinessRuleError) {
        errorMessage = error.message;
      } else if (process.env.NODE_ENV === 'development') {
        errorMessage = `Error: ${error.message}`;
      } else {
        errorMessage = 'Error al solicitar la factura';
      }

      return this.sendError(res, errorMessage, statusCode);
    }
  }

  /**
   * Cancel reservation for reserved quote.
   * POST /api/quotes/:id/cancel-reservation.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async cancelReservation(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const quoteId = req.params.id;
      const { reason } = req.body;

      const result = await this.quoteService.cancelReservation(
        currentUser,
        quoteId,
        reason || '',
        req.userRole // Pass userRole from JWT middleware
      );

      return res.json(result);
    } catch (error) {
      logger.error('Error in QuoteController.cancelReservation', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
        reason: req.body?.reason,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al cancelar la reserva',
        500
      );
    }
  }

  /**
   * Get quotes with completed invoices and file information
   * GET /api/quotes/with-invoices
   * Filters quotes that have completed invoices with XML and PDF files available
   * Department managers can only access quotes from their department.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getQuotesWithInvoices(req, res) {
    try {
      logger.info('getQuotesWithInvoices called', {
        hasUser: !!req.user,
        userRole: req.userRole,
        userId: req.user?.objectId || req.user?.userId || req.user?.id,
        query: req.query,
      });

      const currentUser = req.user;
      if (!currentUser) {
        logger.warn('getQuotesWithInvoices: No user found');
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Parse DataTables parameters
      const draw = parseInt(req.query.draw, 10) || 1;
      const start = parseInt(req.query.start, 10) || 0;
      const length = Math.min(parseInt(req.query.length, 10) || 25, 100);
      const searchValue = req.query.search?.value || '';
      const sortColumnIndex = parseInt(req.query.order?.[0]?.column, 10) || 0;
      const sortDirection = req.query.order?.[0]?.dir || 'desc';

      // Column mapping for sorting (matches frontend columns order)
      const sortColumns = [
        'quote.folio', // 0
        'quote.client.fullName', // 1
        'quote.eventType', // 2
        'quote.numberOfPeople', // 3
        'invoiceNumber', // 4
        'processDate', // 5
        null, // 6 - Files (not sortable)
        null, // 7 - Downloads (not sortable)
      ];

      const sortBy = sortColumns[sortColumnIndex] || 'processDate';

      // Build base query for invoices with completed status and files
      const Invoice = Parse.Object.extend('Invoice');
      const query = new Parse.Query(Invoice);

      // Base conditions for all completed invoices
      query.equalTo('status', 'completed');
      query.equalTo('exists', true);

      // For now, let's get all completed invoices and filter for files later in code
      // This avoids compound query issues with Parse.Query.or()

      // Department manager filtering based on requestedBy field
      if (req.userRole === 'department_manager') {
        // Get the full AmexingUser record to access user information
        const userId = currentUser.objectId || currentUser.userId || currentUser.id;

        logger.info('Department manager filtering - user details', {
          userId,
          currentUser: {
            objectId: currentUser.objectId,
            userId: currentUser.userId,
            id: currentUser.id,
            username: currentUser.username,
            role: currentUser.role,
          },
        });

        try {
          const AmexingUser = Parse.Object.extend('AmexingUser');
          const fullUserQuery = new Parse.Query(AmexingUser);
          fullUserQuery.equalTo('objectId', userId);

          logger.info('Looking up AmexingUser with objectId', { userId });
          const fullUser = await fullUserQuery.first({ useMasterKey: true });

          if (!fullUser) {
            logger.warn('Department manager AmexingUser record not found', { userId });
            return res.status(400).json({
              success: false,
              error: 'User account not found. Please contact administrator.',
              code: 'USER_NOT_FOUND',
            });
          }

          logger.info('Found AmexingUser record', {
            id: fullUser.id,
            username: fullUser.get('username'),
            role: fullUser.get('role'),
            departmentId: fullUser.get('departmentId'),
          });

          // Filter by requestedBy field
          query.equalTo('requestedBy', fullUser);

          logger.info('Applied requestedBy filtering for department manager', {
            userId,
            username: fullUser.get('username'),
            departmentId: fullUser.get('departmentId'),
          });
        } catch (departmentError) {
          logger.error('Error fetching department manager user details', {
            error: departmentError.message,
            userId,
            stack: departmentError.stack,
          });

          return res.status(500).json({
            success: false,
            error: 'Error retrieving user information',
            code: 'USER_LOOKUP_ERROR',
          });
        }
      }

      // Include related data
      query.include(['quote', 'quote.client', 'requestedBy']);

      // Search functionality - temporarily disabled to fix main query issue
      // TODO: Re-implement search with proper compound query handling
      if (searchValue.trim()) {
        logger.info('Search functionality temporarily disabled during query refactoring', {
          searchValue,
          userRole: req.userRole,
        });
      }

      // Get total count for pagination (create separate count query)
      const totalQuery = new Parse.Query(Invoice);
      totalQuery.equalTo('status', 'completed');
      totalQuery.equalTo('exists', true);

      // Apply same role-based filtering for count query
      if (req.userRole === 'department_manager') {
        const userId = currentUser.objectId || currentUser.userId || currentUser.id;
        const AmexingUser = Parse.Object.extend('AmexingUser');
        const fullUserQuery = new Parse.Query(AmexingUser);
        fullUserQuery.equalTo('objectId', userId);
        const fullUser = await fullUserQuery.first({ useMasterKey: true });

        if (fullUser) {
          totalQuery.equalTo('requestedBy', fullUser);
        }
      }

      const totalRecords = await totalQuery.count({ useMasterKey: true });

      // Apply sorting
      if (sortBy && sortBy !== 'null') {
        if (sortDirection === 'desc') {
          query.descending(sortBy);
        } else {
          query.ascending(sortBy);
        }
      } else {
        // Default sort by process date descending
        query.descending('processDate');
      }

      // Apply pagination
      query.skip(start);
      query.limit(length);

      // Execute query
      logger.info('Executing invoices query with filters', {
        userRole: req.userRole,
        searchValue,
        sortBy,
        sortDirection,
      });

      logger.info('About to execute invoice query...');
      const invoices = await query.find({ useMasterKey: true });
      logger.info('Invoice query executed successfully', { count: invoices.length });

      logger.info('Invoices found', {
        count: invoices.length,
        firstInvoiceId: invoices.length > 0 ? invoices[0].id : null,
      });

      // Transform invoices data to match expected format - only include invoices with files
      const invoicesData = [];

      for (const invoice of invoices) {
        try {
          // Check if invoice has at least one file (XML or PDF)
          const hasXmlFile = invoice.get('xmlFileS3Key') || invoice.get('xmlFileUrl');
          const hasPdfFile = invoice.get('pdfFileS3Key') || invoice.get('pdfFileUrl');

          if (hasXmlFile || hasPdfFile) {
            const quote = invoice.get('quote');

            // Build invoice data object
            const invoiceData = {
              objectId: quote ? quote.id : null,
              folio: quote ? quote.get('folio') : 'N/A',
              eventType: quote ? quote.get('eventType') : 'N/A',
              numberOfPeople: quote ? quote.get('numberOfPeople') || 1 : 1,
              status: quote ? quote.get('status') : 'N/A',
              createdAt: quote ? quote.get('createdAt') : invoice.get('createdAt'),
              updatedAt: quote ? quote.get('updatedAt') : invoice.get('updatedAt'),
              client: null,
              invoice: {
                objectId: invoice.id,
                invoiceNumber: invoice.get('invoiceNumber'),
                processDate: invoice.get('processDate'),
                xmlFileS3Key: invoice.get('xmlFileS3Key'),
                xmlFileUrl: invoice.get('xmlFileUrl'),
                xmlStorageMethod: invoice.get('xmlStorageMethod'),
                pdfFileS3Key: invoice.get('pdfFileS3Key'),
                pdfFileUrl: invoice.get('pdfFileUrl'),
                pdfStorageMethod: invoice.get('pdfStorageMethod'),
              },
            };

            // Add client information if available
            const client = quote ? quote.get('client') : null;
            if (client) {
              invoiceData.client = {
                objectId: client.id,
                fullName: client.get('companyName') || client.get('fullName') || `${client.get('firstName')} ${client.get('lastName')}`,
                companyName: client.get('companyName'),
                email: client.get('email'),
                contextualData: client.get('contextualData') || null,
              };
            }

            invoicesData.push(invoiceData);
          }
        } catch (invoiceError) {
          logger.error('Error processing invoice data', {
            invoiceId: invoice.id,
            error: invoiceError.message,
            stack: invoiceError.stack,
          });
          // Error logged, skip to next invoice
        }
      }

      logger.info('Invoices with quotes retrieved successfully', {
        userId: currentUser.objectId || currentUser.userId || currentUser.id,
        userRole: req.userRole,
        totalRecords,
        filteredRecords: invoicesData.length,
        returnedRecords: invoicesData.length,
        searchValue,
      });

      return res.json({
        draw,
        recordsTotal: totalRecords,
        recordsFiltered: invoicesData.length,
        data: invoicesData,
      });
    } catch (error) {
      logger.error('Error in QuoteController.getQuotesWithInvoices', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        userRole: req.userRole,
        query: req.query,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al cargar las facturas',
        500
      );
    }
  }

  /**
   * Sort subconcepts by time and remove duplicates within service days.
   * @param {Array} days - Array of day objects with subconcepts.
   * @returns {Array} Days with sorted and deduplicated subconcepts.
   * @example
   * const cleanedDays = this.sortAndCleanServiceDays([
   *   {
   *     dayNumber: 1,
   *     subconcepts: [
   *       { time: "13:00 - 15:00", concept: "Tour A", unitPrice: 200 },
   *       { time: "08:00 - 12:00", concept: "Tour B", unitPrice: 100 },
   *       { time: "13:00 - 15:00", concept: "Tour A", unitPrice: 200 } // duplicate
   *     ]
   *   }
   * ]);
   * // Returns days with subconcepts sorted by time and duplicates removed
   */
  sortAndCleanServiceDays(days) {
    if (!Array.isArray(days)) {
      return days;
    }

    return days.map((day) => {
      if (!day.subconcepts || !Array.isArray(day.subconcepts)) {
        return day;
      }

      // Remove duplicates. Prefer de-duping by stable id so intentionally duplicated
      // services (identical concept/time/price/type) survive — only collapse entries
      // that share the SAME id. Fall back to content matching for legacy subconcepts
      // that have no id.
      const uniqueSubconcepts = day.subconcepts.filter(
        (subconcept, index, self) => {
          if (subconcept.id) {
            return index === self.findIndex((s) => s.id === subconcept.id);
          }
          return index === self.findIndex(
            (s) => !s.id
              && s.concept === subconcept.concept
              && s.time === subconcept.time
              && s.unitPrice === subconcept.unitPrice
              && s.type === subconcept.type
          );
        }
      );

      // Sort subconcepts by time (chronological order)
      const sortedSubconcepts = this.sortSubconceptsByTime(uniqueSubconcepts);

      return {
        ...day,
        subconcepts: sortedSubconcepts,
      };
    });
  }

  /**
   * Sort subconcepts by time (horario) within a day
   * Empty times are placed at the end.
   * @param {Array} subconcepts - Array of subconcept objects.
   * @returns {Array} Sorted array of subconcepts.
   * @example
   * const sorted = this.sortSubconceptsByTime([
   *   { time: "13:00 - 15:00", concept: "Afternoon Tour" },
   *   { time: "08:00 - 12:00", concept: "Morning Tour" },
   *   { time: "", concept: "TBD Activity" }
   * ]);
   * // Returns: Morning Tour, Afternoon Tour, TBD Activity
   */
  sortSubconceptsByTime(subconcepts) {
    if (!Array.isArray(subconcepts)) {
      return subconcepts;
    }

    return subconcepts.sort((a, b) => {
      const timeA = a.time || '';
      const timeB = b.time || '';

      // Empty times go to the end
      if (!timeA && !timeB) return 0;
      if (!timeA) return 1;
      if (!timeB) return -1;

      /**
       * Parse a time string into minutes since midnight for sorting.
       * @param {string} timeStr - Time in HH:MM or HH:MM - HH:MM format.
       * @returns {number} Minutes since midnight.
       * @example
       */
      const parseTime = (timeStr) => {
        // First try to match a time range (e.g., "13:00 - 15:00")
        const rangeMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
        if (rangeMatch) {
          // Use the start time of the range for sorting
          const hours = parseInt(rangeMatch[1], 10);
          const minutes = parseInt(rangeMatch[2], 10);
          return hours * 60 + minutes;
        }

        // Otherwise, try to match a single time (e.g., "09:30", "14:00")
        const singleMatch = timeStr.match(/^(\d{1,2}):(\d{2})/);
        if (singleMatch) {
          const hours = parseInt(singleMatch[1], 10);
          const minutes = parseInt(singleMatch[2], 10);
          return hours * 60 + minutes; // Convert to minutes for comparison
        }

        return null; // Invalid time format
      };

      const minutesA = parseTime(timeA);
      const minutesB = parseTime(timeB);

      // If either time is invalid, treat as empty
      if (minutesA === null && minutesB === null) return 0;
      if (minutesA === null) return 1;
      if (minutesB === null) return -1;

      return minutesA - minutesB;
    });
  }

  /**
   * Merge suggested departure times from ReservationService records back into quote data.
   * @param {object} quoteData - Quote data object with serviceItems.
   * @returns {Promise<void>}
   * @example
   */
  async mergeSuggestedDepartureTimes(quoteData) {
    try {
      if (!quoteData.serviceItems || !quoteData.serviceItems.days) {
        return;
      }

      const quoteId = quoteData.id;

      // Create Quote pointer
      const quotePtr = new Parse.Object('Quote');
      quotePtr.id = quoteId;

      // Query all ReservationService records for this quote with suggested departure times
      const query = new Parse.Query('ReservationService');
      query.equalTo('reservationPtr', quotePtr);
      query.equalTo('exists', true);
      query.equalTo('type', 'transport');

      // Only fetch records that have at least one suggested departure time field
      const orQuery = Parse.Query.or(
        query.exists('flightDepartureTimeSuggested'),
        query.exists('roundTripDepartureTimeSuggestedIda'),
        query.exists('roundTripDepartureTimeSuggestedVuelta')
      );

      const reservationServices = await orQuery.find({ useMasterKey: true });

      if (reservationServices.length === 0) {
        return;
      }

      // Create lookup map by day number and concept
      const serviceMap = new Map();
      reservationServices.forEach((resSvc) => {
        const dayNumber = resSvc.getDayNumber();
        const concept = resSvc.getConcept();
        const key = `${dayNumber}_${concept}`;

        serviceMap.set(key, {
          flightDepartureTimeSuggested: resSvc.getFlightDepartureTimeSuggested(),
          roundTripDepartureTimeSuggestedIda: resSvc.getRoundTripDepartureTimeSuggestedIda(),
          roundTripDepartureTimeSuggestedVuelta: resSvc.getRoundTripDepartureTimeSuggestedVuelta(),
        });
      });

      // Merge the suggested departure times back into serviceItems
      quoteData.serviceItems.days.forEach((day) => {
        (day.subconcepts || []).forEach((subconcept) => {
          if (subconcept.type === 'transport') {
            const key = `${day.dayNumber}_${subconcept.concept}`;
            const suggestedTimes = serviceMap.get(key);

            if (suggestedTimes) {
              // Extract suggested times with shorter variable names
              const {
                flightDepartureTimeSuggested: flightTime,
                roundTripDepartureTimeSuggestedIda: idaTime,
                roundTripDepartureTimeSuggestedVuelta: vueltaTime,
              } = suggestedTimes;

              // Build object with only non-null suggested times
              const timesToMerge = {};
              if (flightTime) timesToMerge.flightDepartureTimeSuggested = flightTime;
              if (idaTime) timesToMerge.roundTripDepartureTimeSuggestedIda = idaTime;
              if (vueltaTime) timesToMerge.roundTripDepartureTimeSuggestedVuelta = vueltaTime;

              // Merge times into subconcept using Object.assign to avoid param-reassign
              Object.assign(subconcept, timesToMerge);

              logger.debug('🔄 Merged suggested departure times for transport service', {
                quoteId,
                dayNumber: day.dayNumber,
                concept: subconcept.concept,
                flightDepartureTimeSuggested: suggestedTimes.flightDepartureTimeSuggested,
                roundTripDepartureTimeSuggestedIda: suggestedTimes.roundTripDepartureTimeSuggestedIda,
                roundTripDepartureTimeSuggestedVuelta: suggestedTimes.roundTripDepartureTimeSuggestedVuelta,
              });
            }
          }
        });
      });
    } catch (error) {
      logger.error('❌ Error merging suggested departure times', {
        error: error.message,
        stack: error.stack,
        quoteId: quoteData.id,
      });
      // Don't throw - this shouldn't block the main quote loading
    }
  }

  /**
   * Persist suggested departure times to ReservationService records.
   * Creates or updates ReservationService records for transport services that have suggested departure times.
   * @param {string} quoteId - Quote ID.
   * @param {Array} days - Array of service days with subconcepts.
   * @param {object} currentUser - Current user making the update.
   * @returns {Promise<void>}
   * @example
   */
  async persistSuggestedDepartureTimes(quoteId, days, currentUser) {
    try {
      // Create Quote pointer
      const quotePtr = new Parse.Object('Quote');
      quotePtr.id = quoteId;

      for (const day of days) {
        for (let subIndex = 0; subIndex < (day.subconcepts || []).length; subIndex++) {
          const subconcept = day.subconcepts[subIndex];

          // Only process transport services with suggested departure times
          if (subconcept.type === 'transport') {
            const hasSuggestedTimes = subconcept.flightDepartureTimeSuggested
                                    || subconcept.roundTripDepartureTimeSuggestedIda
                                    || subconcept.roundTripDepartureTimeSuggestedVuelta;

            if (hasSuggestedTimes) {
              // Query for existing ReservationService record
              const query = new Parse.Query('ReservationService');
              query.equalTo('reservationPtr', quotePtr);
              query.equalTo('dayNumber', day.dayNumber);
              query.equalTo('concept', subconcept.concept);
              query.equalTo('type', subconcept.type);
              query.equalTo('exists', true);

              let resSvc;
              try {
                resSvc = await query.first({ useMasterKey: true });
              } catch (error) {
                // Record doesn't exist, will create new one
                resSvc = null;
              }

              if (!resSvc) {
                // Create new ReservationService record
                resSvc = new ReservationService();
                resSvc.setReservationPtr(quotePtr);
                resSvc.setDayNumber(day.dayNumber);
                resSvc.setConcept(subconcept.concept);
                resSvc.setType(subconcept.type);
                resSvc.setTime(subconcept.time || null);
                resSvc.setActive(true);
                resSvc.setExists(true);
                resSvc.setStatus('active');
              }

              // Update suggested departure time fields
              if (subconcept.flightDepartureTimeSuggested) {
                resSvc.setFlightDepartureTimeSuggested(subconcept.flightDepartureTimeSuggested);
              }
              if (subconcept.roundTripDepartureTimeSuggestedIda) {
                resSvc.setRoundTripDepartureTimeSuggestedIda(subconcept.roundTripDepartureTimeSuggestedIda);
              }
              if (subconcept.roundTripDepartureTimeSuggestedVuelta) {
                resSvc.setRoundTripDepartureTimeSuggestedVuelta(subconcept.roundTripDepartureTimeSuggestedVuelta);
              }

              // Save the service record
              await resSvc.save(null, {
                useMasterKey: true,
                context: {
                  user: {
                    objectId: currentUser.id,
                    id: currentUser.id,
                    email: currentUser.get('email'),
                    username: currentUser.get('username') || currentUser.get('email'),
                  },
                },
              });

              logger.info('✅ Persisted suggested departure times to ReservationService', {
                quoteId,
                dayNumber: day.dayNumber,
                concept: subconcept.concept,
                serviceId: resSvc.id,
                flightDepartureTimeSuggested: subconcept.flightDepartureTimeSuggested,
                roundTripDepartureTimeSuggestedIda: subconcept.roundTripDepartureTimeSuggestedIda,
                roundTripDepartureTimeSuggestedVuelta: subconcept.roundTripDepartureTimeSuggestedVuelta,
              });
            }
          }
        }
      }
    } catch (error) {
      logger.error('❌ Error persisting suggested departure times', {
        error: error.message,
        stack: error.stack,
        quoteId,
        userId: currentUser.id,
      });
      // Don't throw - this shouldn't block the main serviceItems update
    }
  }

  /**
   * Build base quote query with all filtering logic (reservations, role-based, etc.)
   * This ensures consistency between DataTable and counter.
   * @param {object} currentUser - Current user object.
   * @param {string} userRole - User role string.
   * @param {string} statusFilter - Optional status filter.
   * @returns {Parse.Query} Configured base query.
   * @example
   */
  async buildBaseQuoteQuery(currentUser, userRole, statusFilter = null) {
    // Build base query for all active, existing records with role-based filtering
    const baseQuery = new Parse.Query('Quote');
    baseQuery.equalTo('active', true);
    baseQuery.equalTo('exists', true);

    // Only show quotes in 'quoted' or 'requested' status
    // This automatically excludes: scheduled, hold, rejected
    if (statusFilter) {
      // If a specific status filter is applied, use it
      baseQuery.equalTo('status', statusFilter);
    } else {
      // Default: only show quoted and requested quotes
      baseQuery.containedIn('status', ['quoted', 'requested']);
    }

    baseQuery.include('client');
    baseQuery.include('companyClientPtr');
    baseQuery.include('rate');
    baseQuery.include('createdBy');
    baseQuery.include('owner');
    baseQuery.include('serviceItems');

    // Apply role-based filters (handles visibility per role)
    await this.applyRoleBasedQuoteFilters(baseQuery, currentUser, userRole);

    return baseQuery;
  }

  /**
   * Send error response.
   * @param {object} res - Express response object.
   * @param {string} error - Error message to send in response.
   * @param {number} statusCode - HTTP status code.
   * @returns {object} JSON response.
   * @example
   */
  sendError(res, error, statusCode = 400) {
    return res.status(statusCode).json({
      success: false,
      error,
    });
  }

  /**
   * Evalúa la consistencia de totales del payload de service-items contra el motor de precios
   * (costura #1). Compara el subtotal recibido contra la suma de los totales de subconceptos, y cada
   * subconcepto contra pricesByType[paymentType]. Es pura: no toca Parse ni loggea. Divergencias de
   * hasta 0.01 se ignoran; entre 0.01 y PRICE_MISMATCH_TOLERANCE ($1.00) se reportan como warning
   * (subtotalDiff / subconceptMismatches / totalDiff, para que el controller loggee igual que antes);
   * una divergencia MAYOR a la tolerancia produce `rejectMessage`, que el controller convierte en 400
   * sin guardar nada. El límite es inclusivo del lado "está bien": exactamente $1.00 no rechaza.
   * @param {object} params - Payload numérico ya validado.
   * @param {Array<object>} params.days - Días con `subconcepts`.
   * @param {number} params.subtotal - Subtotal recibido del front.
   * @param {number} params.iva - IVA recibido del front.
   * @param {number} params.total - Total recibido del front.
   * @param {string} params.paymentType - Método de pago ancla (llave de pricesByType).
   * @returns {object} Métricas de divergencia + `rejectMessage` (string|null).
   * @example
   * this.evaluateTotalsConsistency({ days, subtotal, iva, total, paymentType });
   */
  evaluateTotalsConsistency({
    days, subtotal, iva, total, paymentType,
  }) {
    const pricingEngine = require('../../../domain/pricing/pricingEngine');
    const r2 = pricingEngine.round2;

    let sumOfSubconceptTotals = 0;
    let subconceptMismatches = 0;
    let subconceptHardMismatch = null; // primer subconcepto que supera la tolerancia
    (Array.isArray(days) ? days : []).forEach((day) => {
      ((day && day.subconcepts) || []).forEach((sc) => {
        if (!sc || sc.includeInTotal === false) return;
        const scTotal = parseFloat(sc.total) || 0;
        sumOfSubconceptTotals += scTotal;
        if (sc.pricesByType && typeof sc.pricesByType === 'object') {
          const base = parseFloat(sc.pricesByType[paymentType]);
          if (!Number.isNaN(base)) {
            // El descuento por servicio (Fase 1) se captura en efectivo y ya viene restado del precio
            // neto guardado (sc.total). Se escala por el mismo factor multiplicativo que el front
            // (getServiceDiscountInPaymentType) para que ambos lados comparen la misma fórmula; sin
            // restarlo aquí, cualquier servicio con descuento divergiría del pricesByType bruto y se
            // rechazaría por error.
            const discEf = parseFloat(sc.discountAmount) || 0;
            let discountInType = 0;
            if (discEf > 0) {
              const efBase = Number(sc.pricesByType.efectivo);
              discountInType = (efBase > 0 && sc.pricesByType[paymentType] != null)
                ? r2(discEf * (base / efBase))
                : discEf;
            }
            const expected = Math.max(0, r2(base - discountInType));
            const diff = Math.abs(expected - r2(scTotal));
            if (diff > 0.01) {
              subconceptMismatches += 1;
              if (diff > PRICE_MISMATCH_TOLERANCE && !subconceptHardMismatch) {
                subconceptHardMismatch = { concept: sc.concept, diff: r2(diff) };
              }
            }
          }
        }
      });
    });

    sumOfSubconceptTotals = r2(sumOfSubconceptTotals);
    const subtotalRounded = r2(subtotal);
    const subtotalSignedDiff = r2(subtotalRounded - sumOfSubconceptTotals);
    const subtotalDiff = Math.abs(subtotalSignedDiff);

    const ivaRounded = r2(parseFloat(iva) || 0);
    const totalEsperado = r2(subtotalRounded + ivaRounded);
    const totalRecibido = r2(total);
    const totalDiff = Math.abs(totalEsperado - totalRecibido);

    // Se prefiere el mensaje específico del subconcepto (más accionable); si no, el del subtotal.
    let rejectMessage = null;
    if (subconceptHardMismatch) {
      const label = subconceptHardMismatch.concept ? `"${subconceptHardMismatch.concept}"` : 'un servicio';
      rejectMessage = `El precio de ${label} no coincide con lo calculado `
        + `(diferencia de $${subconceptHardMismatch.diff.toFixed(2)}). Verifica el precio antes de guardar.`;
    } else if (subtotalDiff > PRICE_MISMATCH_TOLERANCE) {
      rejectMessage = `El subtotal ($${subtotalRounded.toFixed(2)}) no coincide con la suma de los servicios `
        + `($${sumOfSubconceptTotals.toFixed(2)}), diferencia de $${subtotalDiff.toFixed(2)}. `
        + 'Verifica los precios antes de guardar.';
    }

    return {
      subtotalRounded,
      sumOfSubconceptTotals,
      subtotalSignedDiff,
      subtotalDiff,
      subconceptMismatches,
      ivaRounded,
      totalEsperado,
      totalRecibido,
      totalDiff,
      rejectMessage,
    };
  }
}

module.exports = new QuoteController();
