/* eslint-disable max-lines */
/**
 * ProviderExperienciaController - RESTful API for Provider Experiencias Management.
 *
 * Provides Ajax-ready endpoints for managing provider services (experiencias).
 * Restricted to Admin and SuperAdmin roles.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE)
 * - Provider-specific experiencia management
 * - Comprehensive validation and audit logging.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * GET /api/providers/:providerId/experiencias - List provider experiencias
 * POST /api/providers/:providerId/experiencias - Create experiencia
 * PUT /api/providers/:providerId/experiencias/:id - Update experiencia
 * DELETE /api/providers/:providerId/experiencias/:id - Delete experiencia
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');
const ProviderExperiencia = require('../../../domain/models/ProviderExperiencia');
const FileStorageService = require('../../services/FileStorageService');
const ImageOptimizationService = require('../../services/ImageOptimizationService');
const ServerImageOptimizationService = require('../../services/ServerImageOptimizationService');

/**
 * ProviderExperienciaController class implementing RESTful API.
 */
class ProviderExperienciaController {
  constructor() {
    this.maxExperienciasPerProvider = 50;

    // Initialize FileStorageService for S3 operations
    this.fileStorageService = new FileStorageService({
      baseFolder: 'experiences',
      isPublic: false, // Use presigned URLs with IAM role credentials
      deletionStrategy: process.env.S3_DELETION_STRATEGY || 'move',
      presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
    });

    // Initialize ImageOptimizationService for multi-format support
    this.imageOptimizationService = new ImageOptimizationService({
      baseFolder: 'experiences',
      isPublic: false,
      deletionStrategy: process.env.S3_DELETION_STRATEGY || 'move',
      presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
      enableOptimization: process.env.ENABLE_IMAGE_OPTIMIZATION !== 'false',
    });

    // Initialize ServerImageOptimizationService for server-side processing
    this.serverOptimizationService = new ServerImageOptimizationService({
      baseFolder: 'experiences',
      isPublic: false,
      deletionStrategy: process.env.S3_DELETION_STRATEGY || 'move',
      presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
    });
  }

  /**
   * GET /api/provider-experiencias/all - Get all provider experiencias from all providers.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/provider-experiencias/all
   */
  // eslint-disable-next-line max-lines-per-function
  async getAllProviderExperiencias(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Get all active provider experiencias with provider info
      const query = new Parse.Query('ProviderExperiencia');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.include('provider');
      query.ascending('provider');
      query.ascending('name');
      query.limit(1000); // Get many for selection

      const experiencias = await query.find({ useMasterKey: true });

      // Filter out experiencias where the provider is not active or doesn't exist
      const activeExperiencias = experiencias.filter((exp) => {
        const provider = exp.get('provider');
        if (!provider) {
          // No provider linked, exclude this experiencia
          logger.warn('Provider experiencia without provider reference', {
            experienciaId: exp.id,
            experienciaName: exp.get('name'),
          });
          return false;
        }
        // Only include if provider is both active and exists
        const isProviderActive = provider.get('active') === true;
        const isProviderExists = provider.get('exists') === true;

        if (!isProviderActive || !isProviderExists) {
          logger.debug('Excluding experiencia due to inactive/deleted provider', {
            experienciaId: exp.id,
            experienciaName: exp.get('name'),
            providerId: provider.id,
            providerName: provider.get('name'),
            providerActive: isProviderActive,
            providerExists: isProviderExists,
          });
        }

        return isProviderActive && isProviderExists;
      });

      // Log filtering results if any were excluded
      if (experiencias.length !== activeExperiencias.length) {
        logger.info('Provider experiencias filtered by provider status', {
          totalFound: experiencias.length,
          activeCount: activeExperiencias.length,
          filteredOut: experiencias.length - activeExperiencias.length,
        });
      }

      // Format response with ALL fields from database including extra fields AND optimized photos
      const acceptHeader = req.get('accept') || '';
      const startTime = Date.now();
      const data = await Promise.all(activeExperiencias.map(async (exp) => {
        // Process photos with optimization
        const photos = exp.get('photos') || [];
        const processedPhotos = [];

        // Process each photo to generate optimized URLs.
        // Modo lite (vista de cotización): se omite el procesamiento de fotos (genera URLs
        // firmadas de S3 por cada foto) — es el grueso del payload (~71KB) y de la latencia, y la
        // cotización no usa las fotos. Iterar sobre [] deja processedPhotos vacío.
        for (const photo of (req.query.lite ? [] : photos)) {
          try {
            const processedPhoto = { ...photo };

            // Debug: log photo structure
            if (photos.indexOf(photo) === 0) {
              console.log('Provider photo structure:', {
                hasS3Key: !!photo.s3Key,
                hasFormats: !!photo.formats,
                hasOptimizedVariants: !!photo.optimizedVariants,
                formats: photo.formats ? Object.keys(photo.formats) : [],
                formatsValues: photo.formats,
              });
            }

            // Check if photo has S3 key (prioritize optimization)
            if (photo.s3Key && this.imageOptimizationService?.enableOptimization) {
              // Always generate fresh URLs to avoid 403 errors from expired signatures
              // Never use cached URLs as they expire after 24 hours
              try {
                // Create a mock Parse object to pass to optimization service
                const mockImageObj = {
                  get: (field) => {
                    if (field === 's3Key') return photo.s3Key;
                    // Check for optimizedVariants or formats (provider experiences use 'formats')
                    if (field === 'optimizedVariants') return photo.optimizedVariants || photo.formats;
                    if (field === 'optimizationMetadata') return photo.optimizationMetadata;
                    return photo[field];
                  },
                };

                // Use optimization service to get best format for client
                const imageData = await this.imageOptimizationService.getImageWithOptimalFormat(
                  mockImageObj,
                  acceptHeader
                );
                processedPhoto.url = imageData.url;
                processedPhoto.formats = imageData.formats || {};
                processedPhoto.optimizationMetadata = imageData.metadata || photo.optimizationMetadata;

                // Debug logging
                if (processedPhoto.formats && Object.keys(processedPhoto.formats).length > 0) {
                  console.log('Provider experience photo formats:', {
                    hasAvif: !!processedPhoto.formats.avif,
                    hasWebp: !!processedPhoto.formats.webp,
                    hasJpeg: !!processedPhoto.formats.jpeg,
                    formats: Object.keys(processedPhoto.formats),
                  });
                }

                // Also check if we have optimizationMetadata with formats
                if (photo.optimizationMetadata && photo.optimizationMetadata.formats) {
                  // Extract URLs from optimizationMetadata.formats structure
                  const formats = {};
                  for (const format of Object.keys(photo.optimizationMetadata.formats)) {
                    if (photo.optimizationMetadata.formats[format] && photo.optimizationMetadata.formats[format].url) {
                      formats[format] = photo.optimizationMetadata.formats[format].url;
                    }
                  }
                  // Merge with existing formats
                  processedPhoto.formats = { ...formats, ...processedPhoto.formats };
                }

                // Also check if photo already has formats directly (provider experiences often do)
                if (photo.formats && typeof photo.formats === 'object') {
                  // Merge any existing formats (they might be direct URL strings)
                  processedPhoto.formats = { ...photo.formats, ...processedPhoto.formats };
                }
              } catch (optimizationError) {
                console.warn('Optimization failed for provider experience photo:', optimizationError.message);
                // Fallback to regular presigned URL
                if (photo.s3Key) {
                  const presignedUrl = await this.fileStorageService.getPresignedUrl(photo.s3Key);
                  processedPhoto.url = presignedUrl;
                }
              }
            } else if (photo.url) {
              // Keep existing URL as-is
              processedPhoto.url = photo.url;
            }

            // Debug: log processed photo result
            if (photos.indexOf(photo) === 0) {
              console.log('Processed provider photo:', {
                hasUrl: !!processedPhoto.url,
                hasFormats: !!processedPhoto.formats,
                formatsKeys: processedPhoto.formats ? Object.keys(processedPhoto.formats) : [],
                avifUrl: processedPhoto.formats?.avif ? processedPhoto.formats.avif.substring(0, 100) : null,
              });
            }

            processedPhotos.push(processedPhoto);
          } catch (error) {
            console.error('Error processing provider experience photo:', error.message);
            // Keep the original photo data as fallback
            processedPhotos.push(photo);
          }
        }

        return {
          id: exp.id,
          objectId: exp.id,
          name: exp.get('name'),
          description: exp.get('description'),
          price: exp.get('price'),
          tipo: exp.get('tipo'),
          duration: exp.get('duration'),
          min_people: exp.get('min_people'),
          max_people: exp.get('max_people'),
          cancellation_policy: exp.get('cancellation_policy') || null,
          buyout: exp.get('buyout') ?? null,
          private_min_type: exp.get('private_min_type') || null,
          private_min_value: exp.get('private_min_value') ?? null,
          fixed_schedule: exp.get('fixed_schedule') === true,
          availability: exp.get('availability') || null,
          active: exp.get('active'),

          // Additional pricing fields from database
          price_child: exp.get('price_child'),
          price_no_alcohol: exp.get('price_no_alcohol'),

          // Include/exclude fields from database
          includes: exp.get('includes'),
          notincludes: exp.get('notincludes'),
          languages: exp.get('languages'),

          // Notes fields from database
          client_booking_notes: exp.get('client_booking_notes'),
          provider_notes: exp.get('provider_notes'),
          team_notes: exp.get('team_notes'),
          internal_notes: exp.get('internal_notes'),

          // Duration fields from database
          travel_duration: exp.get('travel_duration'),
          advance_booking_time: exp.get('advance_booking_time'),

          // Optimized photos from release-0.8.4
          photos: processedPhotos,
          images: processedPhotos, // Alias for compatibility

          provider: exp.get('provider')
            ? {
              id: exp.get('provider').id,
              name: exp.get('provider').get('name'),
              type: exp.get('provider').get('type'),
            }
            : null,
          createdAt: exp.createdAt,
          updatedAt: exp.updatedAt,

          // Mark as provider experience for frontend identification
          type: 'provider_experience',
        };
      }));

      const processingTime = Date.now() - startTime;
      console.log(`Provider experiences processed in ${processingTime}ms for ${data.length} experiences`);

      return res.json({
        success: true,
        data,
        count: data.length,
      });
    } catch (error) {
      logger.error('Error in ProviderExperienciaController.getAllProviderExperiencias', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to retrieve provider experiencias',
        500
      );
    }
  }

  /**
   * GET /api/providers/:providerId/experiencias - Get provider experiencias.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/providers/abc123/experiencias
   */
  async getProviderExperiencias(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const { providerId } = req.params;

      // Verify provider or establishment exists
      const providerQuery = new Parse.Query('Experience');
      providerQuery.equalTo('objectId', providerId);
      providerQuery.containedIn('type', ['Provider', 'Establishment']); // Accept both types
      providerQuery.equalTo('exists', true);

      const provider = await providerQuery.first({ useMasterKey: true });
      if (!provider) {
        return this.sendError(res, 'Provider or establishment not found', 404);
      }

      // Get experiencias for this provider
      const experiencias = await ProviderExperiencia.findByProvider(providerId);

      // Format response with optimized URLs
      const acceptHeader = req.get('accept') || '';
      const data = await Promise.all(experiencias.map((exp) => this.formatExperienciaForResponse(exp, acceptHeader)));

      return res.json({
        success: true,
        data,
        count: data.length,
        provider: {
          id: provider.id,
          name: provider.get('name'),
          description: provider.get('description'),
        },
      });
    } catch (error) {
      logger.error('Error in ProviderExperienciaController.getProviderExperiencias', {
        error: error.message,
        stack: error.stack,
        providerId: req.params.providerId,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to retrieve experiencias',
        500
      );
    }
  }

  /**
   * GET /api/provider-experiences/:id - Get provider experiencia by ID directly.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/provider-experiences/xyz456
   */
  async getProviderExperienciaById(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const { id } = req.params;

      const query = new Parse.Query('ProviderExperiencia');
      query.equalTo('objectId', id);
      query.equalTo('exists', true);
      query.include('provider');

      const experiencia = await query.first({ useMasterKey: true });

      if (!experiencia) {
        return this.sendError(res, 'Provider experiencia not found', 404);
      }

      return res.json({
        success: true,
        data: await this.formatExperienciaForResponse(experiencia, req.get('accept') || ''),
      });
    } catch (error) {
      logger.error('Error in ProviderExperienciaController.getProviderExperienciaById', {
        error: error.message,
        experienciaId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Failed to retrieve provider experiencia', 500);
    }
  }

  /**
   * GET /api/providers/:providerId/experiencias/:id - Get single experiencia.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/providers/abc123/experiencias/xyz456
   */
  async getExperienciaById(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const { providerId, id } = req.params;

      const query = new Parse.Query('ProviderExperiencia');
      query.equalTo('objectId', id);
      query.equalTo('exists', true);
      query.include('provider');

      const experiencia = await query.first({ useMasterKey: true });

      if (!experiencia) {
        return this.sendError(res, 'Experiencia not found', 404);
      }

      // Verify it belongs to the specified provider/establishment
      if (experiencia.get('provider')?.id !== providerId) {
        return this.sendError(res, 'Experiencia does not belong to this provider/establishment', 403);
      }

      return res.json({
        success: true,
        data: await this.formatExperienciaForResponse(experiencia, req.get('accept') || ''),
      });
    } catch (error) {
      logger.error('Error in ProviderExperienciaController.getExperienciaById', {
        error: error.message,
        providerId: req.params.providerId,
        experienciaId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Failed to retrieve experiencia', 500);
    }
  }

  /**
   * POST /api/providers/:providerId/experiencias - Create new experiencia.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * POST /api/providers/abc123/experiencias
   * Body: { name, description, price, duration, min_people, max_people }
   */
  // eslint-disable-next-line max-lines-per-function, complexity
  async createExperiencia(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const { providerId } = req.params;
      const {
        name,
        description,
        price,
        price_no_alcohol: priceNoAlcohol,
        price_child: priceChild,
        duration,
        travel_duration: travelDuration,
        min_people: minPeople,
        max_people: maxPeople,
        cancellation_policy: cancellationPolicy,
        buyout,
        private_min_type: privateMinType,
        private_min_value: privateMinValue,
        fixed_schedule: fixedSchedule,
        displayOrder,
        tipo,
        availability,
        includes,
        languages,
        notincludes,
        advance_booking_time: advanceBookingTime,
        photos,
        internal_notes: internalNotes,
        client_booking_notes: clientBookingNotes,
        provider_notes: providerNotes,
        team_notes: teamNotes,
      } = req.body;

      // Validate required fields
      if (!name || !description) {
        return this.sendError(res, 'Name and description are required', 400);
      }

      // Verify provider/establishment exists
      const providerQuery = new Parse.Query('Experience');
      providerQuery.equalTo('objectId', providerId);
      providerQuery.containedIn('type', ['Provider', 'Establishment']);
      providerQuery.equalTo('exists', true);

      const provider = await providerQuery.first({ useMasterKey: true });
      if (!provider) {
        return this.sendError(res, 'Provider/Establishment not found', 404);
      }

      // Check experiencias limit
      const count = await ProviderExperiencia.countByProvider(providerId);
      if (count >= this.maxExperienciasPerProvider) {
        return this.sendError(res, `Maximum ${this.maxExperienciasPerProvider} experiencias per ${provider.get('type').toLowerCase()}`, 400);
      }

      // Check name uniqueness for this provider/establishment
      const isUnique = await ProviderExperiencia.isNameUnique(providerId, name);
      if (!isUnique) {
        return this.sendError(res, `An experiencia with this name already exists for this ${provider.get('type').toLowerCase()}`, 409);
      }

      // Create new experiencia
      const experiencia = new ProviderExperiencia();

      // Create proper Parse pointer for provider
      const providerPointer = {
        __type: 'Pointer',
        className: 'Experience',
        objectId: provider.id,
      };

      experiencia.setProvider(providerPointer);

      experiencia.setName(name);

      experiencia.setDescription(description);

      experiencia.setPrice(price || 0);

      if (priceNoAlcohol !== undefined && priceNoAlcohol !== null) {
        experiencia.set('price_no_alcohol', priceNoAlcohol);
      }
      if (priceChild !== undefined && priceChild !== null) {
        experiencia.set('price_child', priceChild);
      }
      if (tipo !== undefined && tipo !== null && tipo !== '') {
        experiencia.setTipo(tipo);
      }
      if (duration !== undefined && duration !== null) {
        experiencia.setDuration(duration);
      }
      if (travelDuration !== undefined && travelDuration !== null) {
        experiencia.set('travel_duration', travelDuration);
      }
      if (minPeople !== undefined && minPeople !== null) {
        experiencia.setMinPeople(minPeople);
      }
      if (maxPeople !== undefined && maxPeople !== null) {
        experiencia.setMaxPeople(maxPeople);
      }
      if (cancellationPolicy !== undefined) {
        experiencia.setCancellationPolicy(cancellationPolicy);
      }
      if (buyout !== undefined) {
        experiencia.setBuyout(buyout);
      }
      if (privateMinType !== undefined) {
        experiencia.setPrivateMinType(privateMinType);
      }
      if (privateMinValue !== undefined) {
        experiencia.setPrivateMinValue(privateMinValue);
      }
      if (fixedSchedule !== undefined) {
        experiencia.setFixedSchedule(fixedSchedule);
      }
      if (displayOrder !== undefined && displayOrder !== null) {
        experiencia.setDisplayOrder(displayOrder);
      }
      if (availability !== undefined && availability !== null) {
        experiencia.setAvailability(availability);
      }

      // Set includes, languages, notincludes, and photos fields
      if (includes !== undefined && Array.isArray(includes)) {
        experiencia.set('includes', includes);
      }
      if (languages !== undefined && Array.isArray(languages)) {
        experiencia.set('languages', languages);
      }
      if (notincludes !== undefined && Array.isArray(notincludes)) {
        experiencia.set('notincludes', notincludes);
      }
      if (advanceBookingTime !== undefined) {
        if (typeof advanceBookingTime === 'number' && advanceBookingTime > 0) {
          experiencia.set('advance_booking_time', advanceBookingTime);
        } else if (advanceBookingTime === 0 || advanceBookingTime === null) {
          experiencia.unset('advance_booking_time');
        }
      }
      // Process photos for optimization before saving
      if (photos !== undefined && Array.isArray(photos)) {
        const userContext = {
          userId: req.user.id,
          email: req.user.get('email'),
          username: req.user.get('username'),
        };

        const processedPhotos = await this.processPhotosForOptimization(photos, providerId, userContext);
        experiencia.set('photos', processedPhotos);
      }

      // Set notes fields
      if (internalNotes !== undefined && internalNotes !== null && internalNotes !== '') {
        experiencia.set('internal_notes', internalNotes);
      }
      if (clientBookingNotes !== undefined && clientBookingNotes !== null && clientBookingNotes !== '') {
        experiencia.set('client_booking_notes', clientBookingNotes);
      }
      if (providerNotes !== undefined && providerNotes !== null && providerNotes !== '') {
        experiencia.set('provider_notes', providerNotes);
      }
      if (teamNotes !== undefined && teamNotes !== null && teamNotes !== '') {
        experiencia.set('team_notes', teamNotes);
      }

      // Set required lifecycle fields before validation
      experiencia.set('active', true);
      experiencia.set('exists', true);

      // Validate experiencia before saving
      const validation = experiencia.validateExplicitly();

      if (!validation.valid) {
        return this.sendError(res, validation.errors.join(', '), 400);
      }

      // Save experiencia
      await experiencia.save(null, { useMasterKey: true });

      logger.info('Provider experiencia created', {
        providerId,
        experienciaId: experiencia.id,
        name,
        userId: req.user.id,
      });

      return res.status(201).json({
        success: true,
        data: await this.formatExperienciaForResponse(experiencia, req.get('accept') || ''),
        message: 'Experiencia created successfully',
      });
    } catch (error) {
      logger.error('Error in ProviderExperienciaController.createExperiencia', {
        error: error.message,
        stack: error.stack,
        providerId: req.params.providerId,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to create experiencia',
        500
      );
    }
  }

  /**
   * PUT /api/providers/:providerId/experiencias/:id - Update experiencia.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * PUT /api/providers/abc123/experiencias/xyz456
   */
  // eslint-disable-next-line max-lines-per-function, complexity
  async updateExperiencia(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const { providerId, id } = req.params;
      const {
        name,
        description,
        price,
        price_no_alcohol: priceNoAlcohol,
        price_child: priceChild,
        duration,
        travel_duration: travelDuration,
        min_people: minPeople,
        max_people: maxPeople,
        cancellation_policy: cancellationPolicy,
        buyout,
        private_min_type: privateMinType,
        private_min_value: privateMinValue,
        fixed_schedule: fixedSchedule,
        displayOrder,
        active,
        tipo,
        availability,
        includes,
        languages,
        notincludes,
        advance_booking_time: advanceBookingTime,
        photos,
        internal_notes: internalNotes,
        client_booking_notes: clientBookingNotes,
        provider_notes: providerNotes,
        team_notes: teamNotes,
      } = req.body;

      // Get experiencia
      const query = new Parse.Query('ProviderExperiencia');
      query.equalTo('objectId', id);
      query.equalTo('exists', true);
      query.include('provider');

      const experiencia = await query.first({ useMasterKey: true });

      if (!experiencia) {
        return this.sendError(res, 'Experiencia not found', 404);
      }

      // Verify it belongs to the specified provider/establishment
      if (experiencia.get('provider')?.id !== providerId) {
        return this.sendError(res, 'Experiencia does not belong to this provider/establishment', 403);
      }

      // Update fields
      if (name !== undefined) {
        // Check name uniqueness if changing
        if (name !== experiencia.getName()) {
          const isUnique = await ProviderExperiencia.isNameUnique(providerId, name, id);
          if (!isUnique) {
            return this.sendError(res, 'An experiencia with this name already exists for this provider/establishment', 409);
          }
        }
        experiencia.setName(name);
      }

      if (description !== undefined) experiencia.setDescription(description);
      if (price !== undefined) experiencia.setPrice(price);
      if (priceNoAlcohol !== undefined) {
        if (priceNoAlcohol === null || priceNoAlcohol === '') {
          experiencia.unset('price_no_alcohol');
        } else {
          experiencia.set('price_no_alcohol', priceNoAlcohol);
        }
      }
      if (priceChild !== undefined) {
        if (priceChild === null || priceChild === '') {
          experiencia.unset('price_child');
        } else {
          experiencia.set('price_child', priceChild);
        }
      }
      if (tipo !== undefined) experiencia.setTipo(tipo === '' ? null : tipo);
      if (duration !== undefined) experiencia.setDuration(duration);
      if (travelDuration !== undefined) {
        if (travelDuration === null || travelDuration === '') {
          experiencia.unset('travel_duration');
        } else {
          experiencia.set('travel_duration', travelDuration);
        }
      }
      if (minPeople !== undefined) experiencia.setMinPeople(minPeople);
      if (maxPeople !== undefined) experiencia.setMaxPeople(maxPeople);
      if (cancellationPolicy !== undefined) experiencia.setCancellationPolicy(cancellationPolicy);
      if (buyout !== undefined) experiencia.setBuyout(buyout);
      if (privateMinType !== undefined) experiencia.setPrivateMinType(privateMinType);
      if (privateMinValue !== undefined) experiencia.setPrivateMinValue(privateMinValue);
      if (fixedSchedule !== undefined) experiencia.setFixedSchedule(fixedSchedule);
      if (displayOrder !== undefined) experiencia.setDisplayOrder(displayOrder);
      if (active !== undefined) experiencia.set('active', active); // setActive() no existe en el modelo
      if (availability !== undefined) experiencia.setAvailability(availability);

      // Update includes, languages, notincludes, advance booking time, and photos fields
      if (includes !== undefined) {
        if (Array.isArray(includes)) {
          experiencia.set('includes', includes);
        } else if (includes === null) {
          experiencia.set('includes', []);
        }
      }
      if (languages !== undefined) {
        if (Array.isArray(languages)) {
          experiencia.set('languages', languages);
        } else if (languages === null) {
          experiencia.set('languages', []);
        }
      }
      if (notincludes !== undefined) {
        if (Array.isArray(notincludes)) {
          experiencia.set('notincludes', notincludes);
        } else if (notincludes === null) {
          experiencia.set('notincludes', []);
        }
      }
      if (advanceBookingTime !== undefined) {
        if (typeof advanceBookingTime === 'number' && advanceBookingTime > 0) {
          experiencia.set('advance_booking_time', advanceBookingTime);
        } else if (advanceBookingTime === 0 || advanceBookingTime === null) {
          experiencia.unset('advance_booking_time');
        }
      }
      // Process photos for optimization before saving
      if (photos !== undefined) {
        if (Array.isArray(photos)) {
          const userContext = {
            userId: req.user.id,
            email: req.user.get('email'),
            username: req.user.get('username'),
          };

          try {
            logger.info('Processing photos for optimization', {
              experienciaId: id,
              providerId,
              photoCount: photos.length,
              hasNewPhotos: photos.some((p) => p.dataUrl && p.dataUrl.startsWith('data:')),
              userId: req.user.id,
            });

            const processedPhotos = await this.processPhotosForOptimization(photos, providerId, userContext);
            experiencia.set('photos', processedPhotos);

            logger.info('Photos processed successfully', {
              experienciaId: id,
              processedCount: processedPhotos.length,
            });
          } catch (photoError) {
            logger.error('Photo processing failed, using original photos', {
              experienciaId: id,
              providerId,
              error: photoError.message,
              stack: photoError.stack,
              photoCount: photos.length,
            });

            // Graceful fallback: use original photos without optimization
            experiencia.set('photos', photos);
          }
        } else if (photos === null) {
          experiencia.set('photos', []);
        }
      }

      // Update notes fields
      if (internalNotes !== undefined) {
        if (internalNotes === null || internalNotes === '') {
          experiencia.unset('internal_notes');
        } else {
          experiencia.set('internal_notes', internalNotes);
        }
      }
      if (clientBookingNotes !== undefined) {
        if (clientBookingNotes === null || clientBookingNotes === '') {
          experiencia.unset('client_booking_notes');
        } else {
          experiencia.set('client_booking_notes', clientBookingNotes);
        }
      }
      if (providerNotes !== undefined) {
        if (providerNotes === null || providerNotes === '') {
          experiencia.unset('provider_notes');
        } else {
          experiencia.set('provider_notes', providerNotes);
        }
      }
      if (teamNotes !== undefined) {
        if (teamNotes === null || teamNotes === '') {
          experiencia.unset('team_notes');
        } else {
          experiencia.set('team_notes', teamNotes);
        }
      }

      // Validate experiencia before saving
      logger.info('Validating experiencia before save', {
        experienciaId: id,
        providerId,
        name: experiencia.getName(),
        hasProvider: !!experiencia.getProvider(),
        hasDescription: !!experiencia.getDescription(),
        price: experiencia.getPrice(),
      });

      const validation = experiencia.validateExplicitly();
      if (!validation.valid) {
        logger.error('Experiencia validation failed', {
          experienciaId: id,
          providerId,
          validationErrors: validation.errors,
          experienciaData: {
            name: experiencia.getName(),
            description: experiencia.getDescription()?.substring(0, 100),
            price: experiencia.getPrice(),
            hasProvider: !!experiencia.getProvider(),
          },
        });
        return this.sendError(res, `Validation failed: ${validation.errors.join(', ')}`, 400);
      }

      // Save
      logger.info('Attempting to save experiencia', {
        experienciaId: id,
        providerId,
        name: experiencia.getName(),
      });

      await experiencia.save(null, { useMasterKey: true });

      logger.info('Provider experiencia updated successfully', {
        providerId,
        experienciaId: id,
        name: experiencia.getName(),
        updates: Object.keys(req.body),
        userId: req.user.id,
      });

      return res.json({
        success: true,
        data: await this.formatExperienciaForResponse(experiencia, req.get('accept') || ''),
        message: 'Experiencia updated successfully',
      });
    } catch (error) {
      logger.error('Error in ProviderExperienciaController.updateExperiencia', {
        error: error.message,
        stack: error.stack,
        code: error.code,
        providerId: req.params.providerId,
        experienciaId: req.params.id,
        userId: req.user?.id,
        requestBody: {
          name: req.body.name,
          hasPhotos: Array.isArray(req.body.photos) && req.body.photos.length > 0,
          photoCount: Array.isArray(req.body.photos) ? req.body.photos.length : 0,
        },
      });

      // Return specific error message in development mode
      const errorMessage = process.env.NODE_ENV === 'development'
        ? `Failed to update experiencia: ${error.message}`
        : 'Failed to update experiencia';

      return this.sendError(res, errorMessage, 500);
    }
  }

  /**
   * DELETE /api/providers/:providerId/experiencias/:id - Delete experiencia.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * DELETE /api/providers/abc123/experiencias/xyz456
   */
  async deleteExperiencia(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const { providerId, id } = req.params;

      // Get experiencia
      const query = new Parse.Query('ProviderExperiencia');
      query.equalTo('objectId', id);
      query.equalTo('exists', true);
      query.include('provider');

      const experiencia = await query.first({ useMasterKey: true });

      if (!experiencia) {
        return this.sendError(res, 'Experiencia not found', 404);
      }

      // Verify it belongs to the specified provider/establishment
      if (experiencia.get('provider')?.id !== providerId) {
        return this.sendError(res, 'Experiencia does not belong to this provider/establishment', 403);
      }

      // Soft delete (set() — antes usaba setExists()/setActive() que NO existen en
      // el objeto Parse → lanzaba TypeError → 500 "Failed to delete experiencia").
      experiencia.set('exists', false);
      experiencia.set('active', false);
      await experiencia.save(null, { useMasterKey: true });

      logger.info('Provider experiencia deleted', {
        providerId,
        experienciaId: id,
        name: experiencia.get('name'),
        userId: req.user.id,
      });

      return res.json({
        success: true,
        message: 'Experiencia deleted successfully',
      });
    } catch (error) {
      logger.error('Error in ProviderExperienciaController.deleteExperiencia', {
        error: error.message,
        providerId: req.params.providerId,
        experienciaId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Failed to delete experiencia', 500);
    }
  }

  /**
   * PUT /api/providers/:providerId/experiencias/reorder - Reorder experiencias.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * PUT /api/providers/abc123/experiencias/reorder
   * Body: { experiencias: [{id: 'xyz', order: 0}, {id: 'abc', order: 1}] }
   */
  async reorderExperiencias(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const { providerId } = req.params;
      const { experiencias } = req.body;

      if (!Array.isArray(experiencias)) {
        return this.sendError(res, 'Experiencias array is required', 400);
      }

      // Get all experiencias for this provider
      const providerExperiencias = await ProviderExperiencia.findByProvider(providerId);
      const experienciaMap = new Map(providerExperiencias.map((exp) => [exp.id, exp]));

      // Update display order for each experiencia
      const updates = experiencias.map((item) => {
        const experiencia = experienciaMap.get(item.id);
        if (experiencia) {
          experiencia.setDisplayOrder(item.order);
          return experiencia.save(null, { useMasterKey: true });
        }
        return Promise.resolve();
      });

      await Promise.all(updates);

      logger.info('Provider experiencias reordered', {
        providerId,
        count: updates.length,
        userId: req.user.id,
      });

      return res.json({
        success: true,
        message: 'Experiencias reordered successfully',
      });
    } catch (error) {
      logger.error('Error in ProviderExperienciaController.reorderExperiencias', {
        error: error.message,
        providerId: req.params.providerId,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Failed to reorder experiencias', 500);
    }
  }

  /**
   * Process photos array to optimize base64 images and maintain existing optimized images.
   * @param {Array} photos - Array of photo objects with dataUrl and fileName.
   * @param {string} providerId - Provider ID for S3 path organization.
   * @param {object} userContext - User context for logging.
   * @returns {Promise<Array>} Processed photos array with optimized S3 images.
   * @private
   * @example
   * const processedPhotos = await controller.processPhotosForOptimization(photos, providerId, userContext);
   */
  // eslint-disable-next-line max-lines-per-function, no-restricted-syntax
  async processPhotosForOptimization(photos, providerId, userContext) {
    if (!photos || !Array.isArray(photos) || photos.length === 0) {
      return [];
    }

    const processedPhotos = [];

    for (const photo of photos) {
      try {
        // Check if photo is a base64 data URL (new upload)
        if (photo.dataUrl && photo.dataUrl.startsWith('data:')) {
          // Extract buffer from base64
          const matches = photo.dataUrl.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            const mimeType = matches[1];
            const base64Data = matches[2];
            const buffer = Buffer.from(base64Data, 'base64');

            // Generate unique filename
            const timestamp = Date.now();
            const randomString = Math.random().toString(36).substr(2, 9);
            const originalFileName = photo.fileName || 'image.jpg';
            const extension = originalFileName.split('.').pop() || 'jpg';
            const uniqueFileName = `${timestamp}-${randomString}.${extension}`;

            // Use server optimization service to upload and optimize
            logger.debug('Attempting image optimization', {
              providerId,
              fileName: originalFileName,
              bufferSize: buffer.length,
              mimeType,
            });

            const optimizationResult = await this.serverOptimizationService.uploadOptimizedImage(
              buffer,
              uniqueFileName,
              mimeType,
              {
                entityPath: `providers/${providerId}`,
                entityId: providerId,
                userContext,
              }
            );

            // Store optimized image data
            processedPhotos.push({
              s3Key: optimizationResult.originalS3Key,
              fileName: originalFileName,
              originalName: originalFileName,
              optimizedVariants: optimizationResult.optimizedVariants,
              optimizationMetadata: optimizationResult.metadata,
              fileSize: buffer.length,
              mimeType,
            });

            logger.info('Photo optimized for provider experiencia', {
              providerId,
              fileName: originalFileName,
              s3Key: optimizationResult.originalS3Key,
              optimizedFormats: optimizationResult.metadata?.availableFormats || [],
              userId: userContext?.userId,
            });
          } else {
            logger.warn('Invalid base64 data URL format', { providerId, photoIndex: photos.indexOf(photo) });
            // Keep the original photo data as fallback
            processedPhotos.push(photo);
          }
        } else if (photo.s3Key || photo.optimizedVariants || photo.optimizationMetadata) {
          // Keep existing photos but ensure we preserve all optimization data
          // If the photo has essential fields, keep it as-is
          // This handles photos that already have optimization data
          processedPhotos.push(photo);
          logger.debug('Keeping existing optimized photo', {
            fileName: photo.fileName,
            hasS3Key: !!photo.s3Key,
            hasOptimizationMetadata: !!photo.optimizationMetadata,
          });
        } else {
          // This is likely a photo with just a URL but missing optimization data
          // It might be from the frontend that lost the metadata
          // Keep it but log a warning
          processedPhotos.push(photo);
          logger.warn('Photo missing optimization data, keeping as-is', {
            fileName: photo.fileName,
            providerId,
            photoIndex: photos.indexOf(photo),
          });
        }
      } catch (error) {
        logger.error('Error processing photo for optimization', {
          providerId,
          error: error.message,
          photoIndex: photos.indexOf(photo),
          userId: userContext?.userId,
        });
        // Keep the original photo data as fallback
        processedPhotos.push(photo);
      }
    }

    return processedPhotos;
  }

  /**
   * Format experiencia for response.
   * @param {ProviderExperiencia} experiencia - Experiencia object.
   * @param {string} acceptHeader - Browser Accept header for format negotiation.
   * @returns {Promise<object>} Formatted experiencia data with optimized URLs for photos.
   * @private
   * @example
   * const formatted = await controller.formatExperienciaForResponse(experiencia, req.get('accept'));
   */
  // eslint-disable-next-line no-restricted-syntax
  async formatExperienciaForResponse(experiencia, acceptHeader = '') {
    const photos = experiencia.get('photos') || [];
    const processedPhotos = [];

    // Process each photo to generate presigned URLs
    for (const photo of photos) {
      try {
        const processedPhoto = { ...photo };

        // Check if photo has S3 key (prioritize optimization)
        if (photo.s3Key && this.imageOptimizationService?.enableOptimization) {
          try {
            // Use optimization service to get best format for client
            const imageData = await this.imageOptimizationService.getImageWithOptimalFormat(photo, acceptHeader);
            processedPhoto.url = imageData.url;
            processedPhoto.dataUrl = imageData.url;
            processedPhoto.optimizationMetadata = imageData.metadata || photo.optimizationMetadata;
          } catch (optimizationError) {
            logger.warn('Optimization service failed, attempting fallbacks', {
              experienciaId: experiencia.id,
              s3Key: photo.s3Key,
              error: optimizationError.message,
            });

            // Try to fallback to existing optimized variants first
            let fallbackUrl = null;
            if (photo.optimizedVariants) {
              // Try AVIF, WebP, JPEG in order of preference
              const preferredFormats = ['avif', 'webp', 'jpeg'];
              for (const format of preferredFormats) {
                if (photo.optimizedVariants[format]?.s3Key) {
                  try {
                    // Check if the optimized variant exists and generate presigned URL
                    const variantKey = photo.optimizedVariants[format].s3Key;
                    const exists = await this.fileStorageService.objectExists(variantKey);
                    if (exists) {
                      fallbackUrl = await this.fileStorageService.getPresignedUrl(variantKey);
                      logger.info(`Using ${format} variant as fallback`, {
                        experienciaId: experiencia.id,
                        variantKey,
                      });
                      break;
                    }
                  } catch (variantError) {
                    logger.debug(`Failed to check ${format} variant`, {
                      experienciaId: experiencia.id,
                      variantKey: photo.optimizedVariants[format].s3Key,
                      error: variantError.message,
                    });
                  }
                }
              }
            }

            if (fallbackUrl) {
              processedPhoto.url = fallbackUrl;
              processedPhoto.dataUrl = fallbackUrl;
            } else {
              // Final fallback: try original S3 key if it exists
              try {
                const originalExists = await this.fileStorageService.objectExists(photo.s3Key);
                if (originalExists) {
                  const presignedUrl = await this.fileStorageService.getPresignedUrl(photo.s3Key);
                  processedPhoto.url = presignedUrl;
                  processedPhoto.dataUrl = presignedUrl;
                } else {
                  // S3 object doesn't exist - use placeholder
                  logger.error('S3 object not found, using placeholder', {
                    experienciaId: experiencia.id,
                    s3Key: photo.s3Key,
                  });
                  processedPhoto.url = '/images/placeholder-image.svg';
                  processedPhoto.dataUrl = '/images/placeholder-image.svg';
                }
              } catch (existsError) {
                logger.error('Failed to check S3 object existence, using placeholder', {
                  experienciaId: experiencia.id,
                  s3Key: photo.s3Key,
                  error: existsError.message,
                });
                processedPhoto.url = '/images/placeholder-image.svg';
                processedPhoto.dataUrl = '/images/placeholder-image.svg';
              }
            }
          }
        } else if (photo.dataUrl && photo.dataUrl.includes('amazonaws.com')) {
          // Handle legacy presigned URLs (might be expired)
          // Already a presigned URL, but might be expired - regenerate if we have s3Key
          if (photo.s3Key || photo.key) {
            const s3Key = photo.s3Key || photo.key;
            const presignedUrl = await this.fileStorageService.getPresignedUrl(s3Key);
            processedPhoto.url = presignedUrl;
            processedPhoto.dataUrl = presignedUrl;
          } else {
            // Try to extract s3Key from the existing URL
            const urlParts = photo.dataUrl.split('?')[0]; // Remove query parameters
            const s3KeyMatch = urlParts.match(/amazonaws\.com\/(.+)$/);
            if (s3KeyMatch) {
              const s3Key = s3KeyMatch[1];
              const presignedUrl = await this.fileStorageService.getPresignedUrl(s3Key);
              processedPhoto.url = presignedUrl;
              processedPhoto.dataUrl = presignedUrl;
              // Store the extracted s3Key for future use
              processedPhoto.s3Key = s3Key;
            } else {
              // Can't extract S3 key, keep the original URL (might be expired)
              processedPhoto.url = photo.dataUrl;
            }
          }
        } else if (photo.s3Key || photo.key) {
          // Handle S3 keys without optimization
          const s3Key = photo.s3Key || photo.key;
          const presignedUrl = await this.fileStorageService.getPresignedUrl(s3Key);
          processedPhoto.url = presignedUrl;
          processedPhoto.dataUrl = presignedUrl; // For compatibility with frontend
        } else if (photo.dataUrl && photo.dataUrl.startsWith('data:')) {
          // Keep base64 data URLs as-is for new uploads
          processedPhoto.url = photo.dataUrl;
        } else if (photo.url) {
          // Keep other URLs as-is
          processedPhoto.url = photo.url;
          processedPhoto.dataUrl = photo.url;
        }

        // Ensure filename is available for frontend
        processedPhoto.fileName = photo.fileName || photo.originalName || photo.name || 'image';

        processedPhotos.push(processedPhoto);
      } catch (error) {
        logger.error('Error processing photo for experiencia response', {
          experienciaId: experiencia.id,
          photo,
          error: error.message,
        });
        // Include photo without URL if there's an error
        processedPhotos.push({
          ...photo,
          fileName: photo.fileName || photo.originalName || photo.name || 'image',
        });
      }
    }

    return {
      id: experiencia.id,
      name: experiencia.getName(),
      description: experiencia.getDescription(),
      price: experiencia.getPrice(),
      price_no_alcohol: experiencia.get('price_no_alcohol') || null,
      price_child: experiencia.get('price_child') || null,
      tipo: experiencia.getTipo(),
      duration: experiencia.getDuration(),
      travel_duration: experiencia.get('travel_duration') || null,
      min_people: experiencia.getMinPeople(),
      max_people: experiencia.getMaxPeople(),
      cancellation_policy: experiencia.getCancellationPolicy(),
      buyout: experiencia.getBuyout(),
      private_min_type: experiencia.getPrivateMinType(),
      private_min_value: experiencia.getPrivateMinValue(),
      fixed_schedule: experiencia.getFixedSchedule(),
      includes: experiencia.get('includes') || [],
      languages: experiencia.get('languages') || [],
      notincludes: experiencia.get('notincludes') || [],
      advance_booking_time: experiencia.get('advance_booking_time') || null,
      photos: processedPhotos,
      internal_notes: experiencia.get('internal_notes') || null,
      client_booking_notes: experiencia.get('client_booking_notes') || null,
      provider_notes: experiencia.get('provider_notes') || null,
      team_notes: experiencia.get('team_notes') || null,
      displayOrder: experiencia.getDisplayOrder(),
      active: experiencia.isActive(),
      availability: experiencia.getAvailability(),
      createdAt: experiencia.createdAt,
      updatedAt: experiencia.updatedAt,
    };
  }

  /**
   * Send error response.
   * @param {object} res - Express response.
   * @param {string} message - Error message.
   * @param {number} statusCode - HTTP status code.
   * @returns {object} Error response.
   * @private
   * @example
   * return this.sendError(res, 'Not found', 404);
   */
  sendError(res, message, statusCode = 500) {
    return res.status(statusCode).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Check if a presigned URL is still fresh (not expired).
   * @param url
   * @param maxAgeMs
   * @example
   */
  isUrlFresh(url, maxAgeMs = 12 * 60 * 60 * 1000) {
    try {
      const match = url.match(/X-Amz-Date=(\d{8}T\d{6}Z)/);
      if (match) {
        const dateStr = match[1];
        const urlDate = new Date(dateStr.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')).getTime();
        return (Date.now() - urlDate) < maxAgeMs;
      }
    } catch (error) {
      // If we can't parse the date, assume it's expired
    }
    return false;
  }

  /**
   * Select the best format URL based on Accept header.
   * @param formats
   * @param acceptHeader
   * @example
   */
  selectBestFormatUrl(formats, acceptHeader = '') {
    // Detect preferred format from Accept header
    const preferredFormat = this.detectPreferredFormat(acceptHeader);

    // Return the preferred format if available
    if (preferredFormat === 'avif' && formats.avif) return formats.avif;
    if (preferredFormat === 'webp' && formats.webp) return formats.webp;
    if (preferredFormat === 'jpeg' && formats.jpeg) return formats.jpeg;

    // Fallback chain
    return formats.avif || formats.webp || formats.jpeg || null;
  }

  /**
   * Detect preferred image format from Accept header.
   * @param acceptHeader
   * @example
   */
  detectPreferredFormat(acceptHeader) {
    if (acceptHeader.includes('image/avif')) return 'avif';
    if (acceptHeader.includes('image/webp')) return 'webp';
    return 'jpeg';
  }
}

module.exports = new ProviderExperienciaController();
