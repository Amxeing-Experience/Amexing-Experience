/**
 * ToursController - RESTful API for Tours Management.
 *
 * Provides Ajax-ready endpoints for managing Tours catalog.
 * Restricted to SuperAdmin and Admin roles for write operations.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE)
 * - Admin/SuperAdmin access control for write operations
 * - DataTables server-side integration
 * - Comprehensive validation and audit logging.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * GET /api/tours - List all tours with pagination
 * POST /api/tours - Create new tour
 * PUT /api/tours/:id - Update tour
 * DELETE /api/tours/:id - Soft delete tour
 * GET /api/tours/active - Get active tours for dropdowns
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');
const {
  validateDaySchedules,
  sortDaySchedulesChronological,
} = require('../../../infrastructure/utils/availabilityUtils');
const FileStorageService = require('../../services/FileStorageService');
const ImageOptimizationService = require('../../services/ImageOptimizationService');
const ServerImageOptimizationService = require('../../services/ServerImageOptimizationService');
const TourImage = require('../../../domain/models/TourImage');

/**
 * ToursController class implementing RESTful API.
 */
class ToursController {
  constructor() {
    this.maxPageSize = 100;
    this.defaultPageSize = 25;

    // Initialize image optimization services
    this.fileStorageService = new FileStorageService();
    this.imageOptimizationService = new ImageOptimizationService({
      enableOptimization: process.env.ENABLE_IMAGE_OPTIMIZATION === 'true',
      formatPriority: ['avif', 'webp', 'jpeg'],
    });
    this.serverOptimizationService = new ServerImageOptimizationService({
      formats: ['avif', 'webp', 'jpeg'],
      sizes: ['thumb', 'mobile', 'desktop', 'original'],
      quality: {
        avif: parseInt(process.env.SHARP_AVIF_QUALITY) || 50,
        webp: parseInt(process.env.SHARP_WEBP_QUALITY) || 80,
        jpeg: parseInt(process.env.SHARP_JPEG_QUALITY) || 85,
      },
    });
  }

  /**
   * GET /api/tours - Get tours with DataTables server-side processing.
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
   * // Usage example documented above
   */
  async getTours(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Role checking is handled by jwtMiddleware.requireRoleLevel(6) in routes

      // Parse DataTables parameters
      const draw = parseInt(req.query.draw, 10) || 1;
      const start = parseInt(req.query.start, 10) || 0;
      const length = Math.min(parseInt(req.query.length, 10) || this.defaultPageSize, this.maxPageSize);
      const searchValue = req.query.search?.value || '';
      const sortColumnIndex = parseInt(req.query.order?.[0]?.column, 10) || 0;
      const sortDirection = req.query.order?.[0]?.dir || 'asc';

      // Check for client ID to include client-specific prices
      const { clientId } = req.query;

      // Extract tour type filter and includeInactive parameter (for admin views)
      const { tourType } = req.query; // 'walking', 'vehicle', or undefined (all)
      const includeInactive = req.query.includeInactive === 'true';

      // Column mapping for sorting (matches frontend columns order)
      const columns = ['destinationPOI', 'time', 'availability', 'active'];
      const sortField = columns[sortColumnIndex] || 'createdAt';

      // Get total records count (with tour type filter but without search filter)
      const totalRecordsQuery = new Parse.Query('Tour');
      totalRecordsQuery.equalTo('exists', true);
      if (!includeInactive) {
        totalRecordsQuery.equalTo('active', true);
      }

      // Apply tour type filter to total count
      if (tourType === 'walking') {
        totalRecordsQuery.equalTo('isWalkingTour', true);
      } else if (tourType === 'vehicle') {
        totalRecordsQuery.notEqualTo('isWalkingTour', true);
      }

      const recordsTotal = await totalRecordsQuery.count({
        useMasterKey: true,
      });

      // Build base query for existing records (optionally include inactive)
      const baseQuery = new Parse.Query('Tour');
      baseQuery.equalTo('exists', true);
      if (!includeInactive) {
        baseQuery.equalTo('active', true);
      }
      baseQuery.include(['destinationPOI']);

      // Apply tour type filter if provided
      if (tourType === 'walking') {
        baseQuery.equalTo('isWalkingTour', true);
      } else if (tourType === 'vehicle') {
        baseQuery.notEqualTo('isWalkingTour', true);
      }
      // If tourType is undefined, show all tours (no additional filter)

      // Build filtered query with search
      let filteredQuery = baseQuery;
      if (searchValue) {
        // Create subqueries for searching in related objects
        const poiQuery = new Parse.Query('POI');
        poiQuery.matches('name', searchValue, 'i');

        // Create separate queries for each search field with tour type filter
        const searchQueries = [];

        const tourSearchQuery = new Parse.Query('Tour');
        tourSearchQuery.equalTo('exists', true);
        tourSearchQuery.matchesQuery('destinationPOI', poiQuery);

        // Apply tour type filter to search query
        if (tourType === 'walking') {
          tourSearchQuery.equalTo('isWalkingTour', true);
        } else if (tourType === 'vehicle') {
          tourSearchQuery.notEqualTo('isWalkingTour', true);
        }

        searchQueries.push(tourSearchQuery);

        filteredQuery = Parse.Query.or(...searchQueries);
        filteredQuery.include(['destinationPOI']);
      }

      // Get count of filtered results
      const recordsFiltered = await filteredQuery.count({ useMasterKey: true });

      // Apply sorting - handle pointer fields differently
      if (['destinationPOI'].includes(sortField)) {
        // For pointer fields, we'll sort by createdAt instead to avoid complexity
        if (sortDirection === 'asc') {
          filteredQuery.ascending('createdAt');
        } else {
          filteredQuery.descending('createdAt');
        }
      } else if (sortDirection === 'asc') {
        filteredQuery.ascending(sortField);
      } else {
        filteredQuery.descending(sortField);
      }

      // Apply pagination
      filteredQuery.limit(length);
      filteredQuery.skip(start);

      // Execute query
      const tours = await filteredQuery.find({ useMasterKey: true });

      // Load client-specific prices if clientId is provided
      const clientPricesMap = new Map();
      if (clientId) {
        const clientPricesQuery = new Parse.Query('ClientPrices');
        const AmexingUser = Parse.Object.extend('AmexingUser');
        const clientPointer = new AmexingUser();
        clientPointer.id = clientId;

        clientPricesQuery.equalTo('clientPtr', clientPointer);
        clientPricesQuery.equalTo('itemType', 'TOUR'); // CRITICAL: Filter by tour prices
        clientPricesQuery.equalTo('exists', true);
        clientPricesQuery.equalTo('active', true);
        clientPricesQuery.doesNotExist('valid_until'); // Only active records
        clientPricesQuery.include(['ratePtr', 'vehiclePtr']);

        const clientPrices = await clientPricesQuery.find({ useMasterKey: true });

        // Create map: tourId_rateId_vehicleId -> clientPrice
        clientPrices.forEach((clientPrice) => {
          const tourId = clientPrice.get('itemId');
          const rateId = clientPrice.get('ratePtr')?.id;
          const vehicleId = clientPrice.get('vehiclePtr')?.id;

          if (tourId && rateId && vehicleId) {
            const key = `${tourId}_${rateId}_${vehicleId}`;
            clientPricesMap.set(key, {
              price: clientPrice.get('precio') || 0,
              basePrice: clientPrice.get('basePrice') || 0,
              isClientPrice: true,
            });
          }
        });
      }

      // Transform results for DataTables
      const data = tours.map((tour) => {
        const destinationPOI = tour.get('destinationPOI');

        // Add client pricing information if available
        const tourClientPrices = {};
        if (clientId && clientPricesMap.size > 0) {
          // Find all client prices for this tour
          for (const [key, priceInfo] of clientPricesMap.entries()) {
            if (key.startsWith(`${tour.id}_`)) {
              const [, rateId, vehicleId] = key.split('_');
              tourClientPrices[`${rateId}_${vehicleId}`] = priceInfo;
            }
          }
        }

        return {
          id: tour.id,
          objectId: tour.id,
          destinationPOI: {
            objectId: destinationPOI?.id,
            name: destinationPOI?.get('name') || 'Sin destino',
          },
          time: tour.get('time') || 0,
          availability: tour.get('availability') || null,
          availableDays: tour.get('availableDays') || null,
          active: tour.get('active') || false,
          exists: tour.get('exists') || true,
          createdAt: tour.get('createdAt'),
          updatedAt: tour.get('updatedAt'),
          // Additional fields needed for frontend
          type: tour.get('type') || null,
          description: tour.get('description') || null,
          price: tour.get('price') || null,
          price_no_alcohol: tour.get('price_no_alcohol') || null,
          price_child: tour.get('price_child') || null,
          travel_duration: tour.get('travel_duration') || null,
          advance_booking_time: tour.get('advance_booking_time') || null,
          min_people: tour.get('min_people') || null,
          max_people: tour.get('max_people') || null,
          includes: tour.get('includes') || [],
          notincludes: tour.get('notincludes') || [],
          languages: tour.get('languages') || [],
          // Notes fields
          internal_notes: tour.get('internal_notes') || null,
          client_booking_notes: tour.get('client_booking_notes') || null,
          provider_notes: tour.get('provider_notes') || null,
          team_notes: tour.get('team_notes') || null,
          // Walking tour pricing fields
          isWalkingTour: tour.get('isWalkingTour') || false,
          walkingPriceSmall: tour.get('walkingPriceSmall') || null,
          walkingPriceMedium: tour.get('walkingPriceMedium') || null,
          walkingPriceLarge: tour.get('walkingPriceLarge') || null,
          walkingPriceCurrency: tour.get('walkingPriceCurrency') || null,
          walkingRangeSmall: tour.get('walkingRangeSmall') || null,
          walkingRangeMedium: tour.get('walkingRangeMedium') || null,
          walkingRangeLarge: tour.get('walkingRangeLarge') || null,
          // Include client pricing information
          clientPrices: Object.keys(tourClientPrices).length > 0 ? tourClientPrices : {},
          hasClientPrices: Object.keys(tourClientPrices).length > 0,
        };
      });

      // Debug logging before sending response
      console.log('🔍 [TOURS API DEBUG]', {
        tourType,
        includeInactive,
        totalTours: data.length,
        activeTours: data.filter((t) => t.active).length,
        inactiveTours: data.filter((t) => !t.active).length,
        tourSample: data.slice(0, 3).map((t) => ({
          name: t.destinationPOI?.name,
          active: t.active,
          isWalkingTour: t.isWalkingTour,
        })),
      });

      // Send DataTables response (standardized format matching Services)
      res.json({
        success: true,
        draw,
        recordsTotal,
        recordsFiltered,
        data,
      });
    } catch (error) {
      logger.error('Error getting tours:', error);
      this.sendError(res, 'Error al obtener tours', 500);
    }
  }

  /**
   * GET /api/tours/:id - Get tour by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getTourById(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Role checking is handled by jwtMiddleware.requireRoleLevel(6) in routes

      const tourId = req.params.id;
      if (!tourId) {
        return this.sendError(res, 'ID de tour requerido', 400);
      }

      // Support includeInactive parameter for admin views
      const includeInactive = req.query.includeInactive === 'true';

      logger.info('getTourById called:', { tourId, includeInactive, user: currentUser.id });

      const query = new Parse.Query('Tour');
      query.equalTo('exists', true);

      // Only filter by active status if includeInactive is not true
      if (!includeInactive) {
        query.equalTo('active', true);
      }

      query.include(['destinationPOI']);

      const tour = await query.get(tourId, { useMasterKey: true });

      if (!tour) {
        logger.warn('Tour not found:', {
          tourId, includeInactive, exists: true, active: !includeInactive,
        });
        return this.sendError(res, 'Tour no encontrado', 404);
      }

      logger.info('Tour found successfully:', {
        tourId,
        tourActive: tour.get('active'),
        tourExists: tour.get('exists'),
        destinationPOIRaw: tour.get('destinationPOI'),
        destinationPOIId: tour.get('destinationPOI')?.id,
        destinationPOIName: tour.get('destinationPOI')?.get?.('name'),
      });

      const destinationPOI = tour.get('destinationPOI');

      // Fetch vehicle pricing data for this tour
      let priceData = [];
      try {
        const priceQuery = new Parse.Query('TourPrices'); // Note: Table name is TourPrices (plural)
        priceQuery.equalTo('tourPtr', tour);
        priceQuery.equalTo('exists', true);
        priceQuery.doesNotExist('valid_until'); // Only get active prices (no end date)
        priceQuery.include(['ratePtr', 'vehicleType']);

        const tourPrices = await priceQuery.find({ useMasterKey: true });

        priceData = tourPrices.map((tourPrice) => {
          const rate = tourPrice.get('ratePtr');
          const vehicleType = tourPrice.get('vehicleType');
          const price = tourPrice.get('price') || 0;

          return {
            id: tourPrice.id,
            price,
            formattedPrice: `$${Number(price).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`,
            rate: rate ? {
              id: rate.id,
              name: rate.get('name'),
              color: rate.get('color') || '#6c757d',
            } : null,
            vehicleType: vehicleType ? {
              id: vehicleType.id,
              name: vehicleType.get('name'),
              defaultCapacity: vehicleType.get('defaultCapacity') || 4,
              trunkCapacity: vehicleType.get('trunkCapacity') || 2,
              description: vehicleType.get('description') || null,
            } : null,
          };
        });
      } catch (error) {
        logger.warn('Error fetching tour prices:', { tourId, error: error.message });
      }

      const tourData = {
        id: tour.id,
        objectId: tour.id,
        destinationPOI: destinationPOI
          ? {
            id: destinationPOI.id,
            objectId: destinationPOI.id,
            name: destinationPOI.get('name'),
          }
          : null,
        time: tour.get('time'),
        availability: tour.get('availability'),
        availableDays: tour.get('availableDays') || null,
        active: tour.get('active'),
        exists: tour.get('exists'),
        createdAt: tour.get('createdAt'),
        updatedAt: tour.get('updatedAt'),
        // Additional fields
        type: tour.get('type') || null,
        description: tour.get('description') || null,
        price: tour.get('price') || null,
        price_no_alcohol: tour.get('price_no_alcohol') || null,
        price_child: tour.get('price_child') || null,
        travel_duration: tour.get('travel_duration') || null,
        advance_booking_time: tour.get('advance_booking_time') || null,
        min_people: tour.get('min_people') || null,
        max_people: tour.get('max_people') || null,
        includes: tour.get('includes') || [],
        notincludes: tour.get('notincludes') || [],
        languages: tour.get('languages') || [],
        photos: await (async () => {
          // Modo lite (vista de cotización): no usa fotos de tours -> se omite la consulta de
          // imágenes por tour (era N+1: una query por cada tour) + su optimización/S3.
          if (req.query.lite) return [];
          // First, try to get images from TourImage table (new approach)
          const tourImages = await TourImage.getImagesForTour(tour.id);

          if (tourImages && tourImages.length > 0) {
            // Use TourImage objects with optimization
            const formattedImages = await this.formatTourImagesForResponse(tourImages, req.get('accept'));
            return formattedImages;
          }
          // Fallback to legacy photos array
          const rawPhotos = tour.get('photos');
          if (rawPhotos && rawPhotos.length > 0) {
            const formattedPhotos = await this.formatTourPhotosForResponse(tour, req.get('accept'));
            return formattedPhotos;
          }

          return [];
        })(),
        // Notes fields
        internal_notes: tour.get('internal_notes') || null,
        client_booking_notes: tour.get('client_booking_notes') || null,
        provider_notes: tour.get('provider_notes') || null,
        team_notes: tour.get('team_notes') || null,
        // Walking tour pricing fields
        isWalkingTour: tour.get('isWalkingTour') || false,
        walkingPriceSmall: tour.get('walkingPriceSmall') || null,
        walkingPriceMedium: tour.get('walkingPriceMedium') || null,
        walkingPriceLarge: tour.get('walkingPriceLarge') || null,
        walkingPriceCurrency: tour.get('walkingPriceCurrency') || null,
        // Vehicle pricing data
        priceData,
      };

      res.json({
        success: true,
        data: {
          tour: tourData,
        },
      });
    } catch (error) {
      logger.error('Error getting tour by ID:', error);
      this.sendError(res, 'Error al obtener tour', 500);
    }
  }

  /**
   * POST /api/tours - Create new tour.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async createTour(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Get user role for logging
      const userRole = req.userRole || currentUser.role || currentUser.get?.('role');

      // Role checking is handled by jwtMiddleware.requireRoleLevel(6) in routes

      const {
        destinationPOI,
        time,
        availability,
        type,
        description,
        price,
        price_no_alcohol: priceNoAlcohol,
        price_child: priceChild,
        travel_duration: travelDuration,
        advance_booking_time: advanceBookingTime,
        anticipation,
        min_people: minPeople,
        max_people: maxPeople,
        includes,
        notincludes,
        languages,
        photos,
        internal_notes: internalNotes,
        client_booking_notes: clientBookingNotes,
        provider_notes: providerNotes,
        team_notes: teamNotes,
        // Walking tour fields
        isWalkingTour,
        walkingPriceSmall,
        walkingPriceMedium,
        walkingPriceLarge,
        walkingPriceCurrency,
        walkingRangeSmall,
        walkingRangeMedium,
        walkingRangeLarge,
      } = req.body;

      // Validate required fields
      if (!destinationPOI || !time) {
        return this.sendError(res, 'Destino y tiempo son requeridos', 400);
      }

      // Validate new availability format (array of day schedules)
      if (availability && Array.isArray(availability)) {
        if (availability.length === 0) {
          return this.sendError(
            res,
            'Datos de disponibilidad inválidos: At least one day schedule must be provided',
            400
          );
        }

        const availabilityValidation = validateDaySchedules(availability);

        if (!availabilityValidation.valid) {
          return this.sendError(
            res,
            `Datos de disponibilidad inválidos: ${availabilityValidation.errors.join(', ')}`,
            400
          );
        }
      }

      if (time <= 0) {
        return this.sendError(res, 'La duración debe ser mayor a 0', 400);
      }

      // Verify related objects exist
      const poiQuery = new Parse.Query('POI');
      const poi = await poiQuery.get(destinationPOI, { useMasterKey: true });

      // Create new tour
      const Tour = Parse.Object.extend('Tour');
      const tour = new Tour();

      tour.set('destinationPOI', poi);
      tour.set('time', parseInt(time, 10));

      // Set availability format (array of day schedules)
      if (availability && Array.isArray(availability) && availability.length > 0) {
        const sortedSchedules = sortDaySchedulesChronological(availability);
        tour.set('availability', sortedSchedules);
      }

      // Set optional fields
      if (type !== undefined && type !== null) tour.set('type', type);
      if (description !== undefined && description !== null) tour.set('description', description);
      if (price !== undefined && price !== null) tour.set('price', price);
      if (priceNoAlcohol !== undefined && priceNoAlcohol !== null) tour.set('price_no_alcohol', priceNoAlcohol);
      if (priceChild !== undefined && priceChild !== null) tour.set('price_child', priceChild);
      if (travelDuration !== undefined && travelDuration !== null) tour.set('travel_duration', travelDuration);
      if (advanceBookingTime !== undefined && advanceBookingTime !== null) tour.set('advance_booking_time', advanceBookingTime);
      if (minPeople !== undefined && minPeople !== null) tour.set('min_people', minPeople);
      if (maxPeople !== undefined && maxPeople !== null) tour.set('max_people', maxPeople);

      // Set array fields
      if (includes !== undefined && Array.isArray(includes)) tour.set('includes', includes);
      if (notincludes !== undefined && Array.isArray(notincludes)) tour.set('notincludes', notincludes);
      if (languages !== undefined && Array.isArray(languages)) tour.set('languages', languages);

      // Set notes fields
      if (internalNotes !== undefined && internalNotes !== null && internalNotes !== '') {
        tour.set('internal_notes', internalNotes);
      }
      if (clientBookingNotes !== undefined && clientBookingNotes !== null && clientBookingNotes !== '') {
        tour.set('client_booking_notes', clientBookingNotes);
      }
      if (providerNotes !== undefined && providerNotes !== null && providerNotes !== '') {
        tour.set('provider_notes', providerNotes);
      }
      if (teamNotes !== undefined && teamNotes !== null && teamNotes !== '') {
        tour.set('team_notes', teamNotes);
      }

      // Set walking tour fields
      if (isWalkingTour !== undefined) {
        tour.set('isWalkingTour', Boolean(isWalkingTour));
      }
      if (walkingPriceSmall !== undefined && walkingPriceSmall !== null) {
        tour.set('walkingPriceSmall', parseFloat(walkingPriceSmall));
      }
      if (walkingPriceMedium !== undefined && walkingPriceMedium !== null) {
        tour.set('walkingPriceMedium', parseFloat(walkingPriceMedium));
      }
      if (walkingPriceLarge !== undefined && walkingPriceLarge !== null) {
        tour.set('walkingPriceLarge', parseFloat(walkingPriceLarge));
      }
      if (walkingPriceCurrency !== undefined && walkingPriceCurrency !== null) {
        tour.set('walkingPriceCurrency', walkingPriceCurrency);
      }
      if (walkingRangeSmall !== undefined && walkingRangeSmall !== null) {
        tour.set('walkingRangeSmall', walkingRangeSmall);
      }
      if (walkingRangeMedium !== undefined && walkingRangeMedium !== null) {
        tour.set('walkingRangeMedium', walkingRangeMedium);
      }
      if (walkingRangeLarge !== undefined && walkingRangeLarge !== null) {
        tour.set('walkingRangeLarge', walkingRangeLarge);
      }
      if (anticipation !== undefined && anticipation !== null) {
        tour.set('anticipation', parseInt(anticipation, 10));
      }

      tour.set('active', true);
      tour.set('exists', true);

      // Save tour first to get the ID
      const savedTour = await tour.save(null, { useMasterKey: true });

      // Process photos - create TourImage objects for new uploads
      if (photos !== undefined && Array.isArray(photos) && photos.length > 0) {
        const userContext = {
          userId: currentUser.id,
          email: currentUser.get('email'),
          username: currentUser.get('username'),
        };

        // Create TourImage objects for each photo upload
        for (let i = 0; i < photos.length; i++) {
          const photo = photos[i];

          // Create new TourImage for uploads
          if (photo.dataUrl || photo.buffer || photo.s3Key) {
            await this.createTourImageFromUpload(photo, savedTour, userContext, i);
          }
        }
      }

      logger.info('Tour created successfully', {
        tourId: savedTour.id,
        userId: currentUser.id,
        userRole,
      });

      res.status(201).json({
        success: true,
        message: 'Tour creado exitosamente',
        data: {
          tour: {
            id: savedTour.id,
            objectId: savedTour.id,
          },
        },
      });
    } catch (error) {
      logger.error('Error creating tour:', error);
      this.sendError(res, 'Error al crear tour', 500);
    }
  }

  /**
   * PUT /api/tours/:id - Update tour.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async updateTour(req, res) {
    logger.debug('Tour update requested', {
      method: req.method,
      url: req.url,
      tourId: req.params.id,
      timestamp: new Date().toISOString(),
    });

    try {
      logger.debug('Tour update details', {
        tourId: req.params.id,
        hasPhotos: !!req.body.photos,
        photoCount: req.body.photos ? req.body.photos.length : 0,
        photos: req.body.photos
          ? req.body.photos.map((p, i) => ({ index: i, hasDataUrl: !!p.dataUrl, fileName: p.fileName }))
          : [],
      });

      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Get user role for logging
      const userRole = req.userRole || currentUser.role || currentUser.get?.('role');

      // Role checking is handled by jwtMiddleware.requireRoleLevel(6) in routes

      const tourId = req.params.id;
      const {
        destinationPOI,
        time,
        availability,
        type,
        description,
        price,
        price_no_alcohol: priceNoAlcohol,
        price_child: priceChild,
        travel_duration: travelDuration,
        advance_booking_time: advanceBookingTime,
        anticipation,
        min_people: minPeople,
        max_people: maxPeople,
        includes,
        notincludes,
        languages,
        photos,
        internal_notes: internalNotes,
        client_booking_notes: clientBookingNotes,
        provider_notes: providerNotes,
        team_notes: teamNotes,
        // Walking tour fields
        isWalkingTour,
        walkingPriceSmall,
        walkingPriceMedium,
        walkingPriceLarge,
        walkingPriceCurrency,
        walkingRangeSmall,
        walkingRangeMedium,
        walkingRangeLarge,
      } = req.body;

      if (!tourId) {
        return this.sendError(res, 'ID de tour requerido', 400);
      }

      // Validate required fields
      if (!destinationPOI || !time) {
        return this.sendError(res, 'Destino y tiempo son requeridos', 400);
      }

      // Validate new availability format (array of day schedules)
      if (availability && Array.isArray(availability)) {
        if (availability.length === 0) {
          return this.sendError(
            res,
            'Datos de disponibilidad inválidos: At least one day schedule must be provided',
            400
          );
        }

        const availabilityValidation = validateDaySchedules(availability);

        if (!availabilityValidation.valid) {
          return this.sendError(
            res,
            `Datos de disponibilidad inválidos: ${availabilityValidation.errors.join(', ')}`,
            400
          );
        }
      }

      if (time <= 0) {
        return this.sendError(res, 'La duración debe ser mayor a 0', 400);
      }

      // Get existing tour
      const query = new Parse.Query('Tour');
      query.equalTo('exists', true);
      const tour = await query.get(tourId, { useMasterKey: true });

      if (!tour) {
        return this.sendError(res, 'Tour no encontrado', 404);
      }

      // Verify related objects exist
      const poiQuery = new Parse.Query('POI');
      const poi = await poiQuery.get(destinationPOI, { useMasterKey: true });

      // Update tour
      tour.set('destinationPOI', poi);
      tour.set('time', parseInt(time, 10));

      // Update new availability format (array of day schedules)
      if (availability && Array.isArray(availability) && availability.length > 0) {
        const sortedSchedules = sortDaySchedulesChronological(availability);
        tour.set('availability', sortedSchedules);
      } else if (availability === null) {
        // If explicitly set to null, remove availability field
        tour.unset('availability');
      }

      // Update optional fields
      if (type !== undefined) {
        if (type === null || type === '') tour.unset('type');
        else tour.set('type', type);
      }
      if (description !== undefined) {
        if (description === null || description === '') tour.unset('description');
        else tour.set('description', description);
      }
      if (price !== undefined) {
        if (price === null) tour.unset('price');
        else tour.set('price', price);
      }
      if (priceNoAlcohol !== undefined) {
        if (priceNoAlcohol === null) tour.unset('price_no_alcohol');
        else tour.set('price_no_alcohol', priceNoAlcohol);
      }
      if (priceChild !== undefined) {
        if (priceChild === null) tour.unset('price_child');
        else tour.set('price_child', priceChild);
      }
      if (travelDuration !== undefined) {
        if (travelDuration === null) tour.unset('travel_duration');
        else tour.set('travel_duration', travelDuration);
      }
      if (advanceBookingTime !== undefined) {
        if (advanceBookingTime === null) tour.unset('advance_booking_time');
        else tour.set('advance_booking_time', advanceBookingTime);
      }
      if (minPeople !== undefined) {
        if (minPeople === null) tour.unset('min_people');
        else tour.set('min_people', minPeople);
      }
      if (maxPeople !== undefined) {
        if (maxPeople === null) tour.unset('max_people');
        else tour.set('max_people', maxPeople);
      }

      // Update array fields
      if (includes !== undefined) {
        if (includes === null || !Array.isArray(includes)) tour.set('includes', []);
        else tour.set('includes', includes);
      }
      if (notincludes !== undefined) {
        if (notincludes === null || !Array.isArray(notincludes)) tour.set('notincludes', []);
        else tour.set('notincludes', notincludes);
      }
      if (languages !== undefined) {
        if (languages === null || !Array.isArray(languages)) tour.set('languages', []);
        else tour.set('languages', languages);
      }
      // Process photos - handle both additions and deletions
      if (photos !== undefined && Array.isArray(photos)) {
        const userContext = {
          userId: currentUser.id,
          email: currentUser.get('email'),
          username: currentUser.get('username'),
        };

        // Get existing TourImage records
        const existingImages = await TourImage.getImagesForTour(tour.id);
        logger.debug('Tour image management - existing images', {
          tourId: tour.id,
          existingImageCount: existingImages.length,
          existingImages: existingImages.map((img) => ({ id: img.id, fileName: img.get('fileName') })),
        });

        // Get IDs of photos that should remain (from the modal)
        const remainingPhotoIds = photos
          .filter((photo) => photo.id) // Only existing photos have IDs
          .map((photo) => photo.id);
        logger.debug('Tour image management - remaining photos', {
          tourId: tour.id,
          remainingPhotoIds,
          remainingCount: remainingPhotoIds.length,
        });

        // Delete TourImage records that are no longer in the photos array
        for (const existingImage of existingImages) {
          if (!remainingPhotoIds.includes(existingImage.id)) {
            logger.info('Tour image removed', {
              tourId: tour.id,
              imageId: existingImage.id,
              fileName: existingImage.get('fileName'),
              userId: userContext.userId,
            });

            // Soft delete the TourImage record
            existingImage.set('exists', false);
            existingImage.set('deletedAt', new Date());
            existingImage.set('deletedBy', Parse.User.createWithoutData(userContext.userId));
            await existingImage.save(null, { useMasterKey: true });
          }
        }

        // Handle new photo uploads as TourImage objects
        for (let i = 0; i < photos.length; i++) {
          const photo = photos[i];

          // Skip if photo already exists (has an id)
          if (!photo.id) {
            // Create new TourImage for new uploads
            if (photo.dataUrl || photo.buffer || photo.s3Key) {
              logger.info('Tour image upload', {
                tourId: tour.id,
                fileName: photo.fileName,
                userId: userContext.userId,
              });
              await this.createTourImageFromUpload(photo, tour, userContext, i);
            }
          }
        }
      }

      // Update notes fields
      if (internalNotes !== undefined) {
        if (internalNotes === null || internalNotes === '') tour.unset('internal_notes');
        else tour.set('internal_notes', internalNotes);
      }
      if (clientBookingNotes !== undefined) {
        if (clientBookingNotes === null || clientBookingNotes === '') tour.unset('client_booking_notes');
        else tour.set('client_booking_notes', clientBookingNotes);
      }
      if (providerNotes !== undefined) {
        if (providerNotes === null || providerNotes === '') tour.unset('provider_notes');
        else tour.set('provider_notes', providerNotes);
      }
      if (teamNotes !== undefined) {
        if (teamNotes === null || teamNotes === '') tour.unset('team_notes');
        else tour.set('team_notes', teamNotes);
      }

      // Update walking tour fields
      if (isWalkingTour !== undefined) {
        tour.set('isWalkingTour', Boolean(isWalkingTour));
      }
      if (walkingPriceSmall !== undefined) {
        if (walkingPriceSmall === null) tour.unset('walkingPriceSmall');
        else tour.set('walkingPriceSmall', parseFloat(walkingPriceSmall));
      }
      if (walkingPriceMedium !== undefined) {
        if (walkingPriceMedium === null) tour.unset('walkingPriceMedium');
        else tour.set('walkingPriceMedium', parseFloat(walkingPriceMedium));
      }
      if (walkingPriceLarge !== undefined) {
        if (walkingPriceLarge === null) tour.unset('walkingPriceLarge');
        else tour.set('walkingPriceLarge', parseFloat(walkingPriceLarge));
      }
      if (walkingPriceCurrency !== undefined) {
        if (walkingPriceCurrency === null || walkingPriceCurrency === '') tour.unset('walkingPriceCurrency');
        else tour.set('walkingPriceCurrency', walkingPriceCurrency);
      }
      if (walkingRangeSmall !== undefined) {
        if (walkingRangeSmall === null || walkingRangeSmall === '') tour.unset('walkingRangeSmall');
        else tour.set('walkingRangeSmall', walkingRangeSmall);
      }
      if (walkingRangeMedium !== undefined) {
        if (walkingRangeMedium === null || walkingRangeMedium === '') tour.unset('walkingRangeMedium');
        else tour.set('walkingRangeMedium', walkingRangeMedium);
      }
      if (walkingRangeLarge !== undefined) {
        if (walkingRangeLarge === null || walkingRangeLarge === '') tour.unset('walkingRangeLarge');
        else tour.set('walkingRangeLarge', walkingRangeLarge);
      }
      if (anticipation !== undefined) {
        if (anticipation === null) tour.unset('anticipation');
        else tour.set('anticipation', parseInt(anticipation, 10));
      }

      await tour.save(null, { useMasterKey: true });

      logger.info('Tour updated successfully', {
        tourId: tour.id,
        userId: currentUser.id,
        userRole,
      });

      res.json({
        success: true,
        message: 'Tour actualizado exitosamente',
      });
    } catch (error) {
      logger.error('Error updating tour:', error);
      this.sendError(res, 'Error al actualizar tour', 500);
    }
  }

  /**
   * PATCH /api/tours/:id/toggle-status - Toggle tour active status.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async toggleTourStatus(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Get user role for logging
      const userRole = req.userRole || currentUser.role || currentUser.get?.('role');

      // Role checking is handled by jwtMiddleware.requireRoleLevel(6) in routes

      const tourId = req.params.id;
      const { active } = req.body;

      if (!tourId) {
        return this.sendError(res, 'ID de tour requerido', 400);
      }

      const query = new Parse.Query('Tour');
      query.equalTo('exists', true);
      const tour = await query.get(tourId, { useMasterKey: true });

      if (!tour) {
        return this.sendError(res, 'Tour no encontrado', 404);
      }

      tour.set('active', Boolean(active));
      await tour.save(null, { useMasterKey: true });

      logger.info('Tour status toggled', {
        tourId: tour.id,
        newStatus: active,
        userId: currentUser.id,
        userRole,
      });

      res.json({
        success: true,
        message: `Tour ${active ? 'activado' : 'desactivado'} exitosamente`,
      });
    } catch (error) {
      logger.error('Error toggling tour status:', error);
      this.sendError(res, 'Error al cambiar estado del tour', 500);
    }
  }

  /**
   * DELETE /api/tours/:id - Soft delete tour.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async deleteTour(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Get user role for logging
      const userRole = req.userRole || currentUser.role || currentUser.get?.('role');

      // Role checking is handled by jwtMiddleware.requireRoleLevel(6) in routes

      const tourId = req.params.id;

      if (!tourId) {
        return this.sendError(res, 'ID de tour requerido', 400);
      }

      const query = new Parse.Query('Tour');
      query.equalTo('exists', true);
      const tour = await query.get(tourId, { useMasterKey: true });

      if (!tour) {
        return this.sendError(res, 'Tour no encontrado', 404);
      }

      // Soft delete
      tour.set('exists', false);
      tour.set('active', false);
      await tour.save(null, { useMasterKey: true });

      logger.info('Tour soft deleted', {
        tourId: tour.id,
        userId: currentUser.id,
        userRole,
      });

      res.json({
        success: true,
        message: 'Tour eliminado exitosamente',
      });
    } catch (error) {
      logger.error('Error deleting tour:', error);
      this.sendError(res, 'Error al eliminar tour', 500);
    }
  }

  /**
   * GET /api/tours/with-rate-prices - Get tours with prices for a specific rate.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   */
  async getToursWithRatePrices(req, res) {
    try {
      const { rateId, clientId, includeInactive } = req.query;

      if (!rateId) {
        return res.status(400).json({
          success: false,
          error: 'ID de tarifa requerido',
          timestamp: new Date().toISOString(),
        });
      }

      // Get tours based on includeInactive parameter
      const toursQuery = new Parse.Query('Tour');

      // Only filter by active status if includeInactive is not true
      if (includeInactive !== 'true') {
        toursQuery.equalTo('active', true);
      }

      toursQuery.equalTo('exists', true);
      toursQuery.include(['destinationPOI']);
      toursQuery.ascending('destinationPOI.name');

      const tours = await toursQuery.find({ useMasterKey: true });

      // Get TourPrices for the specified rate
      const tourPricesQuery = new Parse.Query('TourPrices');

      // Create pointer to the rate
      const ratePointer = {
        __type: 'Pointer',
        className: 'Rate',
        objectId: rateId,
      };

      tourPricesQuery.equalTo('ratePtr', ratePointer);
      tourPricesQuery.equalTo('exists', true);
      tourPricesQuery.equalTo('active', true);
      // Only get active records (valid_until IS NULL) - price versioning
      tourPricesQuery.doesNotExist('valid_until');
      tourPricesQuery.include(['tourPtr', 'vehicleType', 'ratePtr']);
      tourPricesQuery.ascending('vehicleType.name');

      const tourPrices = await tourPricesQuery.find({ useMasterKey: true });

      // Get client-specific prices if clientId is provided
      const clientPricesMap = {};
      if (clientId) {
        const clientPricesQuery = new Parse.Query('ClientPrices');
        const AmexingUser = Parse.Object.extend('AmexingUser');
        const clientPointer = new AmexingUser();
        clientPointer.id = clientId;

        clientPricesQuery.equalTo('clientPtr', clientPointer);
        clientPricesQuery.equalTo('itemType', 'TOUR');
        clientPricesQuery.equalTo('active', true);
        clientPricesQuery.equalTo('exists', true);
        clientPricesQuery.include(['ratePtr', 'vehiclePtr']);

        const clientPrices = await clientPricesQuery.find({ useMasterKey: true });

        // Create a map of client prices by tour ID and vehicle ID
        clientPrices.forEach((clientPrice) => {
          const itemId = clientPrice.get('itemId'); // This is the tourId
          const vehiclePtr = clientPrice.get('vehiclePtr');
          const ratePtr = clientPrice.get('ratePtr');
          const vehicleId = vehiclePtr?.id;
          const rateIdValue = ratePtr?.id;

          // Only include client prices for the selected rate
          if (rateIdValue === rateId) {
            const key = `${itemId}_${vehicleId}`;
            clientPricesMap[key] = {
              price: clientPrice.get('precio'),
              basePrice: clientPrice.get('basePrice'),
              isClientPrice: true,
            };
          }
        });
      }

      // Create a map of tour prices by tour ID
      const pricesMap = {};
      tourPrices.forEach((tourPrice) => {
        const tour = tourPrice.get('tourPtr');
        const tourId = tour?.id;

        if (tourId) {
          if (!pricesMap[tourId]) {
            pricesMap[tourId] = [];
          }

          const rate = tourPrice.get('ratePtr');
          const vehicleType = tourPrice.get('vehicleType');
          const vehicleId = vehicleType?.id;
          let price = tourPrice.get('price') || 0;
          let isClientPrice = false;

          // Check if there's a client price override for this tour and vehicle
          if (clientId && vehicleId) {
            const clientPriceKey = `${tourId}_${vehicleId}`;
            if (clientPricesMap[clientPriceKey]) {
              const { price: clientPrice } = clientPricesMap[clientPriceKey];
              price = clientPrice;
              isClientPrice = true;
            }
          }

          // Format price to MXN
          const formattedPrice = `$${Number(price).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;

          pricesMap[tourId].push({
            id: tourPrice.id,
            price,
            formattedPrice,
            isClientPrice,
            rate: rate
              ? {
                id: rate.id,
                name: rate.get('name'),
                color: rate.get('color') || '#6c757d',
              }
              : null,
            vehicleType: vehicleType
              ? {
                id: vehicleType.id,
                name: vehicleType.get('name'),
                defaultCapacity: vehicleType.get('defaultCapacity') || 4,
                trunkCapacity: vehicleType.get('trunkCapacity') || 2,
              }
              : null,
          });
        }
      });

      // Format the tour response data with price information
      const toursWithPrices = await Promise.all(tours.map(async (tour) => {
        const destinationPOI = tour.get('destinationPOI');
        const tourId = tour.id;
        const priceData = pricesMap[tourId] || [];

        // Check if this tour has any client prices
        const hasClientPrices = priceData.some((p) => p.isClientPrice);

        // Build client prices object for compatibility with frontend
        const clientPrices = {};
        if (hasClientPrices) {
          priceData.forEach((p) => {
            if (p.isClientPrice && p.rate && p.vehicleType) {
              const key = `${p.rate.id}_${p.vehicleType.id}`;
              clientPrices[key] = {
                price: p.price,
                formattedPrice: p.formattedPrice,
                isClientPrice: true,
              };
            }
          });
        }

        // Get tour photos with optimization - just the primary/first photo for card display
        let primaryPhoto = null;
        try {
          // Try to get images from TourImage table first
          const tourImages = await TourImage.getImagesForTour(tour.id);
          if (tourImages && tourImages.length > 0) {
            // Get the primary image or first image
            const primaryImage = tourImages.find((img) => img.get('isPrimary')) || tourImages[0];
            if (primaryImage) {
              const s3Key = primaryImage.get('s3Key');
              const optimizationMetadata = primaryImage.get('optimizationMetadata');

              if (s3Key && this.fileStorageService) {
                // Build optimized image data with all formats
                primaryPhoto = {
                  s3Key,
                  fileName: primaryImage.get('fileName'),
                  isPrimary: true,
                  optimizationMetadata,
                };

                // Generate presigned URLs for optimized formats
                // Try optimizationMetadata.formats first, fall back to optimizedVariants on TourImage
                const storedVariants = primaryImage.get('optimizedVariants');
                if (s3Key && (optimizationMetadata?.formats || storedVariants)) {
                  const variants = {};
                  const basePath = s3Key.replace(/\.[^.]+$/, ''); // Remove extension

                  // Priority order for <picture> element: avif, webp, jpeg (browser negotiates)
                  const formatPriority = ['avif', 'webp', 'jpeg'];

                  for (const formatName of formatPriority) {
                    // First try optimizationMetadata.formats, then storedVariants
                    const formatData = optimizationMetadata?.formats?.[formatName]
                      || (storedVariants && storedVariants[formatName]);
                    if (formatData && formatData.s3Key) {
                      try {
                        const url = await this.fileStorageService.getPresignedUrl(formatData.s3Key);
                        variants[formatName] = {
                          s3Key: formatData.s3Key,
                          format: formatName,
                          url,
                        };
                      } catch (error) {
                        // If variant URL fails, try the simple pattern
                        const ext = formatName === 'jpeg' ? 'jpg' : formatName;
                        const simpleKey = `${basePath}.${ext}`;
                        try {
                          const url = await this.fileStorageService.getPresignedUrl(simpleKey);
                          variants[formatName] = {
                            s3Key: simpleKey,
                            format: formatName,
                            url,
                          };
                        } catch (innerError) {
                          // Variant doesn't exist, skip silently
                        }
                      }
                    }
                  }

                  // Only add variants if we found at least one
                  if (Object.keys(variants).length > 0) {
                    primaryPhoto.optimizedVariants = variants;
                  }
                }

                // Fallback original URL
                primaryPhoto.url = await this.fileStorageService.getPresignedUrl(s3Key);
              }
            }
          }

          // Fallback to legacy photos array if no TourImage found
          if (!primaryPhoto) {
            const photos = tour.get('photos');
            if (photos && photos.length > 0) {
              const firstPhoto = photos[0];
              if (firstPhoto.s3Key && this.fileStorageService) {
                primaryPhoto = {
                  s3Key: firstPhoto.s3Key,
                  fileName: firstPhoto.fileName,
                  isPrimary: true,
                  optimizationMetadata: firstPhoto.optimizationMetadata,
                };

                // For now, skip optimization check since images aren't optimized yet
                // TODO: Re-enable this once images are optimized
                /*
                // Generate presigned URLs for optimized formats if metadata exists
                if (firstPhoto.optimizationMetadata?.formats && firstPhoto.s3Key) {
                  const variants = {};
                  // Extract env prefix and path components from original key
                  const keyParts = firstPhoto.s3Key.split('/');
                  const env = keyParts[0]; // staging, dev, or prod
                  const fileName = keyParts[keyParts.length - 1].replace(/\.[^.]+$/, ''); // filename without extension

                  // Build variant URLs for each format
                  // Pattern: {env}/optimized/{format}/files/{filename}.{format}
                  for (const format of firstPhoto.optimizationMetadata.formats) {
                    const variantKey = `${env}/optimized/${format}/files/${fileName}.${format}`;
                    try {
                      // Check if file exists first
                      await this.fileStorageService.checkFileExists(variantKey);
                      const url = await this.fileStorageService.getPresignedUrl(variantKey);
                      variants[format] = {
                        s3Key: variantKey,
                        format,
                        url
                      };
                    } catch (error) {
                      // If variant doesn't exist, skip it silently
                    }
                  }

                  // Only add variants if we found at least one
                  if (Object.keys(variants).length > 0) {
                    primaryPhoto.optimizedVariants = variants;
                  }
                }
                */

                // Fallback original URL
                primaryPhoto.url = await this.fileStorageService.getPresignedUrl(firstPhoto.s3Key);
              }
            }
          }
        } catch (error) {
          logger.warn('Error getting tour photo:', {
            tourId: tour.id,
            error: error.message,
          });
        }

        return {
          id: tour.id,
          objectId: tour.id,
          destinationPOI: destinationPOI
            ? {
              objectId: destinationPOI.id,
              id: destinationPOI.id,
              name: destinationPOI.get('name'),
            }
            : null,
          time: tour.get('time'),
          availability: tour.get('availability'),
          availableDays: tour.get('availableDays'),
          advance_booking_time: tour.get('advance_booking_time'),
          description: tour.get('notes') || tour.get('description'),
          primaryPhoto,
          active: tour.get('active'),
          exists: tour.get('exists'),
          createdAt: tour.get('createdAt'),
          updatedAt: tour.get('updatedAt'),
          // Type field for badge display
          type: tour.get('type') || null,
          // Walking tour pricing fields
          isWalkingTour: tour.get('isWalkingTour') || false,
          walkingPriceSmall: tour.get('walkingPriceSmall') || null,
          walkingPriceMedium: tour.get('walkingPriceMedium') || null,
          walkingPriceLarge: tour.get('walkingPriceLarge') || null,
          walkingPriceCurrency: tour.get('walkingPriceCurrency') || null,
          walkingRangeSmall: tour.get('walkingRangeSmall') || null,
          walkingRangeMedium: tour.get('walkingRangeMedium') || null,
          walkingRangeLarge: tour.get('walkingRangeLarge') || null,
          priceData,
          hasClientPrices,
          clientPrices,
        };
      }));

      return res.json({
        success: true,
        message: 'Tours con precios obtenidos exitosamente',
        data: toursWithPrices,
      });
    } catch (error) {
      logger.error('Error al obtener tours con precios:', error);
      return res.status(500).json({
        success: false,
        error: 'Error al obtener tours con precios',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * GET /api/tours/:id/all-prices - Get all prices for a specific tour from TourPrices table.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   */
  async getAllTourPrices(req, res) {
    try {
      const tourId = req.params.id;

      if (!tourId) {
        return res.status(400).json({
          success: false,
          error: 'ID del tour requerido',
          timestamp: new Date().toISOString(),
        });
      }

      // Get the tour first
      const tourQuery = new Parse.Query('Tour');
      tourQuery.equalTo('exists', true);
      const tour = await tourQuery.get(tourId, { useMasterKey: true });

      if (!tour) {
        return res.status(404).json({
          success: false,
          error: 'Tour no encontrado',
          timestamp: new Date().toISOString(),
        });
      }

      // Query TourPrices for this tour
      const tourPricesQuery = new Parse.Query('TourPrices');

      // Create pointer to the tour
      const tourPointer = {
        __type: 'Pointer',
        className: 'Tour',
        objectId: tourId,
      };

      tourPricesQuery.equalTo('tourPtr', tourPointer);
      tourPricesQuery.equalTo('exists', true);
      tourPricesQuery.equalTo('active', true);
      // Only get active records (valid_until IS NULL) - price versioning
      tourPricesQuery.doesNotExist('valid_until');
      tourPricesQuery.include(['ratePtr', 'vehicleType']);
      tourPricesQuery.ascending('ratePtr.name');
      tourPricesQuery.ascending('vehicleType.name');

      const tourPrices = await tourPricesQuery.find({ useMasterKey: true });

      // Format the response data
      const formattedPrices = tourPrices.map((tourPrice) => {
        const rate = tourPrice.get('ratePtr');
        const vehicleType = tourPrice.get('vehicleType');
        const price = tourPrice.get('price') || 0;

        // Format price to MXN
        const formattedPrice = `$${Number(price).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;

        return {
          id: tourPrice.id,
          price,
          formattedPrice,
          rate: rate
            ? {
              id: rate.id,
              name: rate.get('name'),
              color: rate.get('color') || '#6c757d',
            }
            : null,
          vehicleType: vehicleType
            ? {
              id: vehicleType.id,
              name: vehicleType.get('name'),
              defaultCapacity: vehicleType.get('defaultCapacity') || 4,
              trunkCapacity: vehicleType.get('trunkCapacity') || 2,
            }
            : null,
        };
      });

      return res.json({
        success: true,
        message: 'Precios del tour obtenidos exitosamente',
        data: formattedPrices,
      });
    } catch (error) {
      logger.error('Error al obtener precios del tour:', error);
      return res.status(500).json({
        success: false,
        error: 'Error al obtener los precios del tour',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * GET /api/tours/:id/all-rate-prices-with-client-prices - Get tour prices with client-specific overrides.
   * Combines base tour prices from TourPrices with client-specific prices from ClientTourPrices.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getAllRatePricesForTourWithClientPrices(req, res) {
    try {
      const tourId = req.params.id;
      const { clientId } = req.query;

      logger.info(`[getAllRatePricesForTourWithClientPrices] Called with tourId: ${tourId}, clientId: ${clientId}`);

      if (!tourId) {
        return res.status(400).json({
          success: false,
          error: 'ID del tour requerido',
          timestamp: new Date().toISOString(),
        });
      }

      if (!clientId) {
        return res.status(400).json({
          success: false,
          error: 'ID del cliente requerido',
          timestamp: new Date().toISOString(),
        });
      }

      // Get the tour first
      const tourQuery = new Parse.Query('Tour');
      tourQuery.equalTo('exists', true);
      const tour = await tourQuery.get(tourId, { useMasterKey: true });

      if (!tour) {
        return res.status(404).json({
          success: false,
          error: 'Tour no encontrado',
          timestamp: new Date().toISOString(),
        });
      }

      // Query TourPrices for base prices
      const tourPricesQuery = new Parse.Query('TourPrices');
      const tourPointer = {
        __type: 'Pointer',
        className: 'Tour',
        objectId: tourId,
      };
      tourPricesQuery.equalTo('tourPtr', tourPointer);
      tourPricesQuery.equalTo('exists', true);
      tourPricesQuery.equalTo('active', true);
      // Only get active records (valid_until IS NULL) - price versioning
      tourPricesQuery.doesNotExist('valid_until');
      tourPricesQuery.include(['ratePtr', 'vehicleType']);
      tourPricesQuery.ascending('ratePtr.name');
      tourPricesQuery.ascending('vehicleType.name');

      const tourPrices = await tourPricesQuery.find({ useMasterKey: true });

      // Query ClientPrices for client-specific overrides (using itemType='TOUR')
      const clientPricesQuery = new Parse.Query('ClientPrices');
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const clientPointer = new AmexingUser();
      clientPointer.id = clientId;

      clientPricesQuery.equalTo('clientPtr', clientPointer);
      clientPricesQuery.equalTo('itemType', 'TOUR'); // CRITICAL: Use TOUR for tours
      clientPricesQuery.equalTo('exists', true);
      clientPricesQuery.equalTo('active', true);
      clientPricesQuery.doesNotExist('valid_until'); // Only get active records
      clientPricesQuery.include(['ratePtr', 'vehiclePtr']);

      const allClientPrices = await clientPricesQuery.find({ useMasterKey: true });

      // Debug: Log all client prices and their itemIds
      logger.info(
        `[getAllRatePricesForTourWithClientPrices] Found ${allClientPrices.length} total TOUR client prices for client ${clientId}`
      );
      allClientPrices.forEach((cp) => {
        logger.info(`ClientPrice ID: ${cp.id}, ItemId: "${cp.get('itemId')}", Looking for tourId: "${tourId}"`);
      });

      // Filter client prices for this specific tour
      const clientPrices = allClientPrices.filter((cp) => cp.get('itemId') === tourId);
      logger.info(
        `[getAllRatePricesForTourWithClientPrices] After filtering for tour ${tourId}: ${clientPrices.length} prices found`
      );

      // Create a map of client prices for easy lookup
      const clientPriceMap = {};
      clientPrices.forEach((clientPrice) => {
        const rateId = clientPrice.get('ratePtr')?.id;
        const vehicleId = clientPrice.get('vehiclePtr')?.id; // Note: ClientPrices uses vehiclePtr, not vehicleType
        if (rateId && vehicleId) {
          const key = `${rateId}_${vehicleId}`;
          clientPriceMap[key] = clientPrice.get('precio') || 0;
        }
      });

      // Create a set to track which rate_vehicle combinations we've processed
      const processedKeys = new Set();

      // Format the response data with client price overrides
      const formattedPrices = tourPrices.map((tourPrice) => {
        const rate = tourPrice.get('ratePtr');
        const vehicleType = tourPrice.get('vehicleType');
        const basePrice = tourPrice.get('price') || 0;

        // Check for client-specific price
        const key = `${rate?.id}_${vehicleType?.id}`;
        const clientPrice = clientPriceMap[key];
        const hasClientPrice = clientPrice !== undefined;
        const finalPrice = hasClientPrice ? clientPrice : basePrice;

        // Mark this key as processed
        processedKeys.add(key);

        return {
          id: tourPrice.id,
          price: finalPrice,
          formattedPrice: `$${Number(finalPrice).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`,
          basePrice,
          isClientPrice: hasClientPrice,
          rate: rate
            ? {
              id: rate.id,
              name: rate.get('name'),
              color: rate.get('color') || '#6c757d',
            }
            : null,
          vehicleType: vehicleType
            ? {
              id: vehicleType.id,
              name: vehicleType.get('name'),
              code: vehicleType.get('code') || '',
              defaultCapacity: vehicleType.get('defaultCapacity') || 4,
              trunkCapacity: vehicleType.get('trunkCapacity') || 2,
            }
            : null,
        };
      });

      // Add client prices that don't have corresponding tour prices
      clientPrices.forEach((clientPrice) => {
        const ratePtr = clientPrice.get('ratePtr');
        const vehiclePtr = clientPrice.get('vehiclePtr');
        const rateId = ratePtr?.id;
        const vehicleId = vehiclePtr?.id;

        if (rateId && vehicleId) {
          const key = `${rateId}_${vehicleId}`;

          // Only add if we haven't already processed this combination
          if (!processedKeys.has(key)) {
            const clientPriceValue = clientPrice.get('precio') || 0;
            formattedPrices.push({
              id: `client_${clientPrice.id}`, // Use client price ID with prefix
              price: clientPriceValue,
              formattedPrice: `$${Number(clientPriceValue).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`,
              basePrice: 0, // No base price since there's no TourPrice record
              isClientPrice: true,
              rate: ratePtr
                ? {
                  id: ratePtr.id,
                  name: ratePtr.get('name'),
                  color: ratePtr.get('color') || '#6c757d',
                }
                : null,
              vehicleType: vehiclePtr
                ? {
                  id: vehiclePtr.id,
                  name: vehiclePtr.get('name'),
                  code: vehiclePtr.get('code') || '',
                  defaultCapacity: vehiclePtr.get('defaultCapacity') || 4,
                  trunkCapacity: vehiclePtr.get('trunkCapacity') || 2,
                }
                : null,
            });
          }
        }
      });

      return res.json({
        success: true,
        message: 'Precios del tour con tarifas de cliente obtenidos exitosamente',
        data: formattedPrices,
      });
    } catch (error) {
      logger.error('Error al obtener precios del tour con cliente:', error);
      return res.status(500).json({
        success: false,
        error: 'Error al obtener los precios del tour',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * POST /api/tours/client-prices - Save client-specific prices for a tour.
   * IMPORTANT: Sets itemType='TOUR' in ClientPrices table to distinguish from service prices.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async saveTourClientPrices(req, res) {
    try {
      const { clientId, tourId, prices } = req.body;
      const currentUser = req.user;

      // Validate input
      if (!clientId || !tourId || !prices || !Array.isArray(prices)) {
        return this.sendError(res, 'Datos incompletos: clientId, tourId y prices son requeridos', 400);
      }

      // Process each price
      const objectsToSave = [];
      const ClientPricesClass = Parse.Object.extend('ClientPrices');

      // First, find existing ACTIVE prices for this client and tour (valid_until IS NULL)
      const existingQuery = new Parse.Query(ClientPricesClass);

      const AmexingUser = Parse.Object.extend('AmexingUser');
      const clientPointer = new AmexingUser();
      clientPointer.id = clientId;

      existingQuery.equalTo('clientPtr', clientPointer);
      existingQuery.equalTo('itemType', 'TOUR'); // CRITICAL: Use TOUR for tours, not SERVICES
      existingQuery.equalTo('itemId', tourId);
      existingQuery.equalTo('exists', true);
      // Only get active records (not versioned/historical ones)
      existingQuery.doesNotExist('valid_until');

      const existingPrices = await existingQuery.find({ useMasterKey: true });

      // Create a map to track which prices to update vs create
      const existingMap = new Map();
      existingPrices.forEach((price) => {
        const ratePtr = price.get('ratePtr');
        const vehiclePtr = price.get('vehiclePtr');
        if (ratePtr && vehiclePtr) {
          const key = `${ratePtr.id}_${vehiclePtr.id}`;
          existingMap.set(key, price);
        }
      });

      // Process each new price
      for (const priceData of prices) {
        const key = `${priceData.ratePtr}_${priceData.vehiclePtr}`;
        const existingPriceObject = existingMap.get(key);

        if (existingPriceObject) {
          // Frontend already filtered to only send modified prices, so this price changed
          // VERSIONING: Don't update existing price, instead:
          // 1. Mark existing price as historical (set valid_until to today)
          existingPriceObject.set('valid_until', new Date());
          existingPriceObject.set('lastModifiedBy', currentUser ? currentUser.id : null);
          objectsToSave.push(existingPriceObject);

          // 2. Create NEW price record with the updated price
          const newPriceObject = new ClientPricesClass();

          const Rate = Parse.Object.extend('Rate');
          const ratePointer = new Rate();
          ratePointer.id = priceData.ratePtr;

          const VehicleType = Parse.Object.extend('VehicleType');
          const vehiclePointer = new VehicleType();
          vehiclePointer.id = priceData.vehiclePtr;

          newPriceObject.set('clientPtr', clientPointer);
          newPriceObject.set('ratePtr', ratePointer);
          newPriceObject.set('vehiclePtr', vehiclePointer);
          newPriceObject.set('itemType', 'TOUR'); // CRITICAL: Use TOUR for tours
          newPriceObject.set('itemId', tourId);
          newPriceObject.set('precio', priceData.precio);
          newPriceObject.set('basePrice', priceData.basePrice || 0);
          newPriceObject.set('currency', 'MXN');
          newPriceObject.set('active', true);
          newPriceObject.set('exists', true);
          newPriceObject.set('createdBy', currentUser ? currentUser.id : null);
          newPriceObject.set('lastModifiedBy', currentUser ? currentUser.id : null);
          // valid_until remains null (active record)

          objectsToSave.push(newPriceObject);
        } else {
          // Create completely new price (no existing record)
          const newPriceObject = new ClientPricesClass();

          const Rate = Parse.Object.extend('Rate');
          const ratePointer = new Rate();
          ratePointer.id = priceData.ratePtr;

          const VehicleType = Parse.Object.extend('VehicleType');
          const vehiclePointer = new VehicleType();
          vehiclePointer.id = priceData.vehiclePtr;

          newPriceObject.set('clientPtr', clientPointer);
          newPriceObject.set('ratePtr', ratePointer);
          newPriceObject.set('vehiclePtr', vehiclePointer);
          newPriceObject.set('itemType', 'TOUR'); // CRITICAL: Use TOUR for tours
          newPriceObject.set('itemId', tourId);
          newPriceObject.set('precio', priceData.precio);
          newPriceObject.set('basePrice', priceData.basePrice || 0);
          newPriceObject.set('currency', 'MXN');
          newPriceObject.set('active', true);
          newPriceObject.set('exists', true);
          newPriceObject.set('createdBy', currentUser ? currentUser.id : null);
          newPriceObject.set('lastModifiedBy', currentUser ? currentUser.id : null);
          // valid_until remains null (active record)

          objectsToSave.push(newPriceObject);
        }
      }

      // Note: We don't handle "removal" here because the frontend only sends modified prices,
      // not the complete set of prices. Unmodified prices should remain unchanged.

      // Save all objects
      if (objectsToSave.length > 0) {
        await Parse.Object.saveAll(objectsToSave, { useMasterKey: true });
      }

      // Log the action
      logger.info('Tour client prices saved', {
        clientId,
        tourId,
        savedCount: prices.length,
        updatedCount: objectsToSave.length,
        userId: currentUser ? currentUser.id : null,
        itemType: 'TOUR', // Log to confirm correct type
      });

      return res.json({
        success: true,
        message: `Se guardaron ${prices.length} precio(s) personalizados para este tour`,
        savedCount: prices.length,
        itemType: 'TOUR', // Return to confirm correct type
      });
    } catch (error) {
      logger.error('Error saving tour client prices:', {
        error: error.message,
        stack: error.stack,
        body: req.body,
      });
      return this.sendError(res, 'Error al guardar los precios del cliente');
    }
  }

  /**
   * POST /:id/update-base-prices - Update base tour prices (TourPrices).
   * Route: POST /api/tours/:id/update-base-prices
   * Access: Admin and above
   * Body: { prices: [{id, price}] }
   * Returns: Success message with updated count.
   * @param {object} req - Express request object with params.id and body.prices.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * POST /api/tours/abc123/update-base-prices
   * Body: {
   *   prices: [
   *     { id: "tourPriceId1", price: 1500 },
   *     { id: "tourPriceId2", price: 2000 }
   *   ]
   * }
   */
  async updateBasePrices(req, res) {
    try {
      const currentUser = req.user;
      const tourId = req.params.id;
      const { prices } = req.body;

      // Validate user permissions
      if (!currentUser) {
        return this.sendError(res, 'Usuario no autenticado', 401);
      }

      // Validate input
      if (!tourId) {
        return this.sendError(res, 'ID del tour es requerido', 400);
      }

      if (!prices || !Array.isArray(prices) || prices.length === 0) {
        return this.sendError(res, 'Lista de precios es requerida', 400);
      }

      // Verify tour exists
      const TourClass = Parse.Object.extend('Tour');
      const tourQuery = new Parse.Query(TourClass);
      tourQuery.equalTo('objectId', tourId);
      tourQuery.equalTo('exists', true);
      const tour = await tourQuery.first({ useMasterKey: true });

      if (!tour) {
        return this.sendError(res, 'Tour no encontrado', 404);
      }

      // Get TourPrices class (Tours use TourPrices)
      const TourPricesClass = Parse.Object.extend('TourPrices');
      const objectsToSave = [];

      logger.info('Starting tour price versioning update', {
        tourId,
        pricesCount: prices.length,
        userId: currentUser.id,
        timestamp: new Date().toISOString(),
      });

      // Process each price update/creation with VERSIONING
      for (const priceData of prices) {
        const {
          id, rateId, vehicleId, price,
        } = priceData;

        if (typeof price === 'number' && price >= 0) {
          if (id) {
            // UPDATE EXISTING: Handle existing TourPrices record
            logger.info('Processing price update for existing TourPrice', {
              tourPriceId: id,
              newPrice: price,
            });

            // Get the existing TourPrice record
            const priceQuery = new Parse.Query(TourPricesClass);
            priceQuery.equalTo('objectId', id);
            priceQuery.include('tourPtr');
            priceQuery.include('ratePtr');
            priceQuery.include('vehicleType');
            const priceRecord = await priceQuery.first({ useMasterKey: true });

            if (priceRecord) {
              const currentPrice = priceRecord.get('price');

              if (currentPrice !== price) {
                // Only version if price has changed
                logger.info('Creating price version history', {
                  tourPriceId: id,
                  oldPrice: currentPrice,
                  newPrice: price,
                });

                // VERSIONING: Don't update existing price, instead:
                // 1. Mark existing price as historical (set valid_until to today)
                priceRecord.set('valid_until', new Date());
                priceRecord.set('lastModifiedBy', currentUser.id);
                objectsToSave.push(priceRecord);

                // 2. Create NEW price record with the updated price
                const newPriceRecord = new TourPricesClass();

                // Copy all fields from original record
                newPriceRecord.set('tourPtr', priceRecord.get('tourPtr'));
                newPriceRecord.set('ratePtr', priceRecord.get('ratePtr'));
                newPriceRecord.set('vehicleType', priceRecord.get('vehicleType'));
                newPriceRecord.set('price', price); // New price value
                // valid_until remains null (active record)
                newPriceRecord.set('active', true);
                newPriceRecord.set('exists', true);
                newPriceRecord.set('createdBy', currentUser.id);
                newPriceRecord.set('lastModifiedBy', currentUser.id);

                objectsToSave.push(newPriceRecord);

                logger.info('Prepared versioning update', {
                  originalRecordId: id,
                  newRecordWillBeCreated: true,
                  historicalPrice: currentPrice,
                  newActivePrice: price,
                });
              } else {
                logger.info('Price unchanged, skipping versioning', {
                  tourPriceId: id,
                  price,
                });
              }
            } else {
              logger.warn('TourPrice record not found', {
                tourPriceId: id,
              });
            }
          } else if (rateId && vehicleId && price > 0) {
            // CREATE NEW: Handle new TourPrices record for new tours
            logger.info('Creating new TourPrice record', {
              tourId,
              rateId,
              vehicleId,
              price,
            });

            // Create pointers to related objects
            const tourPointer = new Parse.Object('Tour');
            tourPointer.id = tourId;

            const ratePointer = new Parse.Object('Rate');
            ratePointer.id = rateId;

            const vehiclePointer = new Parse.Object('VehicleType');
            vehiclePointer.id = vehicleId;

            // Create NEW TourPrices record
            const newPriceRecord = new TourPricesClass();

            // Set all fields for new record
            newPriceRecord.set('tourPtr', tourPointer);
            newPriceRecord.set('ratePtr', ratePointer);
            newPriceRecord.set('vehicleType', vehiclePointer);
            newPriceRecord.set('price', price);
            newPriceRecord.set('active', true);
            newPriceRecord.set('exists', true);
            newPriceRecord.set('createdBy', currentUser.id);
            newPriceRecord.set('lastModifiedBy', currentUser.id);
            // valid_until remains null (active record)

            objectsToSave.push(newPriceRecord);

            logger.info('Prepared new TourPrice creation', {
              tourId,
              rateId,
              vehicleId,
              price,
            });
          } else {
            logger.warn('Invalid price data, missing rateId/vehicleId or price is 0', {
              rateId,
              vehicleId,
              price,
            });
          }
        }
      }

      // Save all updated prices
      if (objectsToSave.length > 0) {
        await Parse.Object.saveAll(objectsToSave, { useMasterKey: true });
      }

      // Log the action
      logger.info('Tour base prices updated', {
        tourId,
        updatedPrices: objectsToSave.length,
        userId: currentUser.id,
        userEmail: currentUser.get('email'),
        timestamp: new Date().toISOString(),
      });

      return res.json({
        success: true,
        message: `${objectsToSave.length} precios base actualizados exitosamente`,
        updatedCount: objectsToSave.length,
      });
    } catch (error) {
      logger.error('Error updating tour base prices', {
        error: error.message,
        stack: error.stack,
        tourId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error interno del servidor al actualizar precios base', 500);
    }
  }

  /**
   * GET /api/tours/:id/price-history - Get price history for a tour.
   *
   * Retrieves all historical price records for a specific tour,
   * including active and historical versions ordered by creation date.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {object} JSON response with price history data.
   * @author Amexing Development Team
   * @version 1.0.0
   * @since 1.0.0
   * @example
   * GET /api/tours/abcd1234/price-history
   * Response: {
   *   success: true,
   *   data: [
   *     {
   *       price: 1500.00,
   *       validFrom: "2024-01-01T00:00:00Z",
   *       validUntil: "2024-06-01T00:00:00Z",
   *       status: "historical",
   *       duration: 152,
   *       vehicleTypeName: "Sedan",
   *       rateName: "Tarifa Base"
   *     }
   *   ]
   * }
   */
  async getPriceHistory(req, res) {
    try {
      const { id: tourId } = req.params;
      const currentUser = req.user;

      if (!tourId) {
        return this.sendError(res, 'Tour ID is required', 400);
      }

      logger.info('Getting tour price history', {
        tourId,
        userId: currentUser?.id,
      });

      // Get the current tour to find the name
      const tourQuery = new Parse.Query('Tour');
      tourQuery.equalTo('objectId', tourId);
      tourQuery.equalTo('exists', true);
      tourQuery.include(['destinationPOI']);

      const currentTour = await tourQuery.first({ useMasterKey: true });

      if (!currentTour) {
        return this.sendError(res, 'Tour not found', 404);
      }

      const tourName = currentTour.get('name');

      // Query all TourPrices for this tour (current and historical)
      const TourPricesClass = Parse.Object.extend('TourPrices');
      const historyQuery = new Parse.Query(TourPricesClass);

      // Create tour pointer for query
      const tourPointer = new Parse.Object('Tour');
      tourPointer.id = tourId;

      // Filter by tour reference (use correct field name: tourPtr)
      historyQuery.equalTo('tourPtr', tourPointer);

      // Include related objects for complete data (use correct field names)
      historyQuery.include(['tourPtr', 'vehicleType', 'ratePtr']);
      historyQuery.equalTo('exists', true);
      historyQuery.addDescending('createdAt');
      historyQuery.limit(100); // Limit to last 100 price changes

      const priceHistory = await historyQuery.find({ useMasterKey: true });

      if (!priceHistory || priceHistory.length === 0) {
        return res.json({
          success: true,
          data: [],
          message: 'No price history found for this tour',
        });
      }

      // Process and format price history data
      const formattedHistory = priceHistory.map((record) => {
        const price = parseFloat(record.get('price') || 0);
        const createdAt = record.get('createdAt');
        const validUntil = record.get('valid_until');
        const isActive = !validUntil; // No valid_until means it's the active record

        // Get related object names (use correct field names)
        const vehicleType = record.get('vehicleType');
        const rate = record.get('ratePtr');
        const vehicleTypeName = vehicleType ? vehicleType.get('name') : null;
        const rateName = rate ? rate.get('name') : null;

        // Calculate duration if there's a valid_until date
        let duration = null;
        if (validUntil) {
          const diffMs = validUntil.getTime() - createdAt.getTime();
          duration = Math.ceil(diffMs / (1000 * 60 * 60 * 24)); // Convert to days
        } else {
          // For active record, calculate days since creation
          const diffMs = new Date().getTime() - createdAt.getTime();
          duration = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        }

        return {
          id: record.id,
          price: price.toFixed(2),
          validFrom: createdAt.toISOString(),
          validUntil: validUntil ? validUntil.toISOString() : null,
          status: isActive ? 'active' : 'historical',
          duration,
          vehicleTypeName,
          rateName,
          createdAt: createdAt.toISOString(),
        };
      });

      logger.info('Tour price history retrieved successfully', {
        tourId,
        tourName,
        recordCount: formattedHistory.length,
        userId: currentUser?.id,
      });

      return res.json({
        success: true,
        data: formattedHistory,
        tourName,
        totalRecords: formattedHistory.length,
      });
    } catch (error) {
      logger.error('Error getting tour price history', {
        tourId: req.params.id,
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error retrieving price history', 500);
    }
  }

  /**
   * Create TourImage object from upload data.
   * @param {object} photo - Photo upload data.
   * @param {Parse.Object} tour - Tour object.
   * @param {object} userContext - User context for auditing.
   * @param {number} displayOrder - Display order for the image.
   * @returns {Promise<TourImage>} Created TourImage object.
   * @example
   */
  async createTourImageFromUpload(photo, tour, userContext, displayOrder) {
    try {
      logger.debug('Creating tour image upload', {
        tourId: tour.id,
        hasDataUrl: !!photo.dataUrl,
        fileName: photo.fileName,
        displayOrder,
      });

      // Handle base64 uploads
      if (photo.dataUrl && photo.dataUrl.startsWith('data:')) {
        const base64Match = photo.dataUrl.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);

        if (base64Match) {
          const mimeType = base64Match[1];
          const base64Data = base64Match[2];
          const buffer = Buffer.from(base64Data, 'base64');

          // Generate unique filename
          const timestamp = Date.now();

          // Preserve original extension if it matches the MIME type, otherwise use MIME type extension
          let baseFileName = photo.fileName || 'tour_image';
          let fileExtension;

          const lastDotIndex = baseFileName.lastIndexOf('.');
          if (lastDotIndex > 0) {
            const originalExt = baseFileName.substring(lastDotIndex + 1).toLowerCase();
            baseFileName = baseFileName.substring(0, lastDotIndex);

            // For JPEG images, preserve original extension (.jpg vs .jpeg)
            if (mimeType === 'image/jpeg' && (originalExt === 'jpg' || originalExt === 'jpeg')) {
              fileExtension = originalExt;
            } else {
              fileExtension = mimeType.split('/')[1] || 'jpg';
            }
          } else {
            fileExtension = mimeType.split('/')[1] || 'jpg';
          }

          const uniqueFileName = `${timestamp}_${baseFileName}.${fileExtension}`;

          // Process with server optimization service
          const optimizationResult = await this.serverOptimizationService.uploadOptimizedImage(
            buffer,
            uniqueFileName,
            mimeType,
            {
              entityPath: `tours/${tour.id}`,
              entityId: tour.id,
              userContext,
            }
          );

          if (!optimizationResult || !optimizationResult.originalS3Key) {
            throw new Error('Failed to upload and optimize image');
          }

          // Get current image count for display order
          const existingCount = await TourImage.getImageCount(tour.id);
          const actualDisplayOrder = displayOrder !== undefined ? displayOrder : existingCount;

          // Create TourImage record
          const tourImage = new TourImage();
          tourImage.set('tourId', tour);
          tourImage.set('s3Key', optimizationResult.originalS3Key);
          tourImage.set('s3Bucket', process.env.S3_BUCKET);
          tourImage.set('s3Region', process.env.AWS_REGION);
          tourImage.set('fileName', photo.fileName || uniqueFileName);
          tourImage.set('fileSize', buffer.length);
          tourImage.set('mimeType', mimeType);
          tourImage.set('uploadedBy', Parse.User.createWithoutData(userContext.userId));
          tourImage.set('uploadedAt', new Date());
          tourImage.set('active', true);
          tourImage.set('exists', true);
          tourImage.set('optimizedVariants', optimizationResult.optimizedVariants);
          tourImage.set('optimizationMetadata', optimizationResult.metadata);
          tourImage.set('isPrimary', actualDisplayOrder === 0);
          tourImage.set('displayOrder', actualDisplayOrder);

          await tourImage.save(null, { useMasterKey: true });

          logger.info('TourImage created successfully', {
            tourId: tour.id,
            imageId: tourImage.id,
            fileName: uniqueFileName,
            userId: userContext.userId,
          });

          return tourImage;
        }
      }

      return null;
    } catch (error) {
      logger.error('Error creating TourImage from upload:', {
        tourId: tour.id,
        error: error.message,
        userId: userContext.userId,
      });
      throw error;
    }
  }

  /**
   * Process photos for optimization.
   * @param {Array} photos - Array of photo objects.
   * @param {string} tourId - Tour ID for S3 path organization.
   * @param {object} userContext - User context for auditing.
   * @returns {Array} Processed photos with optimization data.
   * @example
   */
  async processPhotosForOptimization(photos, tourId, userContext) {
    if (!photos || !Array.isArray(photos)) {
      return [];
    }

    const processedPhotos = [];

    for (const photo of photos) {
      try {
        // Check if this is a new base64 upload
        if (photo.dataUrl && photo.dataUrl.startsWith('data:')) {
          logger.info('Processing base64 image for optimization', {
            tourId,
            fileName: photo.fileName,
            userId: userContext.userId,
          });

          // Extract file info from base64
          const base64Match = photo.dataUrl.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);

          if (base64Match) {
            const mimeType = base64Match[1];
            const base64Data = base64Match[2];
            const buffer = Buffer.from(base64Data, 'base64');

            // Generate unique filename
            const fileExtension = mimeType.split('/')[1] || 'jpg';
            const timestamp = Date.now();
            const uniqueFileName = `${timestamp}_${photo.fileName || 'tour_image'}.${fileExtension}`;

            // Process with server optimization service
            const optimizationResult = await this.serverOptimizationService.uploadOptimizedImage(
              buffer,
              uniqueFileName,
              mimeType,
              {
                entityPath: `tours/${tourId}`,
                entityId: tourId,
                userContext,
              }
            );

            logger.info('Image optimization completed for tour', {
              tourId,
              fileName: uniqueFileName,
              originalSize: buffer.length,
              optimizedFormats: optimizationResult.metadata?.availableFormats,
              userId: userContext.userId,
            });

            // Use optimization result data
            processedPhotos.push({
              fileName: photo.fileName || uniqueFileName,
              s3Key: optimizationResult.originalS3Key,
              optimizedVariants: optimizationResult.optimizedVariants,
              optimizationMetadata: optimizationResult.metadata,
              dataUrl: optimizationResult.presignedUrl, // Use the presigned URL for immediate display
              fileSize: buffer.length,
              mimeType,
            });
          } else {
            logger.warn('Invalid base64 data URL format', { tourId, photoIndex: photos.indexOf(photo) });
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
            tourId,
            photoIndex: photos.indexOf(photo),
          });
        }
      } catch (error) {
        logger.error('Error processing photo for optimization', {
          tourId,
          error: error.message,
          photoIndex: photos.indexOf(photo),
          fileName: photo.fileName,
        });
        // Keep original photo on error
        processedPhotos.push(photo);
      }
    }

    logger.info('Photo processing completed for tour', {
      tourId,
      totalPhotos: photos.length,
      processedPhotos: processedPhotos.length,
      userId: userContext.userId,
    });

    return processedPhotos;
  }

  /**
   * Queue background optimization for an image missing optimized variants.
   * Fire-and-forget: does not block the response.
   * @param {Parse.Object} imageRecord - TourImage Parse object.
   * @param {string} entityPath - S3 entity path (e.g., 'tours').
   * @example
   */
  // eslint-disable-next-line no-underscore-dangle
  _queueBackgroundOptimization(imageRecord, entityPath) {
    if (!this.serverOptimizationService?.enableOptimization) return;

    setImmediate(async () => {
      try {
        await this.serverOptimizationService.optimizeExistingImage(imageRecord, entityPath);
        logger.info('Background optimization completed', { imageId: imageRecord.id });
      } catch (error) {
        logger.warn('Background optimization failed', {
          imageId: imageRecord.id,
          error: error.message,
        });
      }
    });
  }

  /**
   * Format TourImage objects for response with optimization.
   * @param {Array<TourImage>} tourImages - Array of TourImage Parse objects.
   * @param {string} acceptHeader - Browser accept header for format negotiation.
   * @param _acceptHeader
   * @returns {Array} Formatted images with optimized URLs.
   * @example
   */
  async formatTourImagesForResponse(tourImages, _acceptHeader) {
    const formattedImages = await Promise.all(
      tourImages.map(async (img) => {
        try {
          const s3Key = img.get('s3Key');
          const optimizedVariants = img.get('optimizedVariants');
          const fileName = img.get('fileName') || '';

          let imageUrl = null;
          const optimizationMetadata = img.get('optimizationMetadata');

          // Strategy: Use optimizedVariants first, then optimizationMetadata.formats, then original s3Key
          const formatPriority = ['avif', 'webp', 'jpeg'];

          // Try optimizedVariants (flat: { avif: { s3Key } }) or nested with sizes
          if (optimizedVariants && typeof optimizedVariants === 'object') {
            for (const format of formatPriority) {
              const variant = optimizedVariants[format];
              if (variant?.s3Key) {
                try {
                  imageUrl = await this.fileStorageService.getPresignedUrl(variant.s3Key);
                  if (imageUrl) break;
                } catch (variantError) {
                  // Continue to next format
                }
              }
            }
          }

          // Fallback: try optimizationMetadata.formats (older uploads store variants here)
          if (!imageUrl && optimizationMetadata?.formats && typeof optimizationMetadata.formats === 'object') {
            for (const format of formatPriority) {
              const formatData = optimizationMetadata.formats[format];
              if (formatData?.s3Key) {
                try {
                  imageUrl = await this.fileStorageService.getPresignedUrl(formatData.s3Key);
                  if (imageUrl) break;
                } catch (variantError) {
                  // Continue to next format
                }
              }
            }
          }

          // Fallback to original s3Key if no optimized variant worked
          if (!imageUrl && s3Key) {
            try {
              imageUrl = await this.fileStorageService.getPresignedUrl(s3Key);
              // Queue background optimization for images missing variants
              if (!optimizedVariants) {
                this._queueBackgroundOptimization(img, 'tours'); // eslint-disable-line no-underscore-dangle
              }
            } catch (s3KeyError) {
              // Log error but continue
              logger.warn('Failed to get presigned URL for tour image', {
                imageId: img.id,
                error: s3KeyError.message,
              });
            }
          }

          return {
            id: img.id,
            fileName,
            dataUrl: imageUrl,
            url: imageUrl, // Keep both for compatibility
            isPrimary: img.get('isPrimary'),
            displayOrder: img.get('displayOrder'),
            fileSize: img.get('fileSize'),
            mimeType: img.get('mimeType'),
            optimizationMetadata: img.get('optimizationMetadata'),
            uploadedAt: img.get('uploadedAt'),
          };
        } catch (error) {
          logger.error('Error processing TourImage for response', {
            imageId: img.id,
            error: error.message,
          });
          return null;
        }
      })
    );

    // Filter out any null results and sort by displayOrder
    return formattedImages.filter((img) => img !== null).sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  }

  /**
   * Format tour photos for response with optimization metadata (LEGACY).
   * @param {Parse.Object} tour - Tour object.
   * @param {string} acceptHeader - Browser accept header for format negotiation.
   * @param _acceptHeader
   * @returns {Array} Formatted photos with optimized URLs.
   * @example
   */
  async formatTourPhotosForResponse(tour, _acceptHeader) {
    const photos = tour.get('photos') || [];

    if (!Array.isArray(photos) || photos.length === 0) {
      return [];
    }

    const formattedPhotos = await Promise.all(
      photos.map(async (photo) => {
        try {
          // Handle s3Key (newer legacy format)
          if (photo.s3Key) {
            const presignedUrl = await this.fileStorageService.getPresignedUrl(photo.s3Key);
            return {
              ...photo,
              dataUrl: presignedUrl,
              fileName: photo.fileName || 'image.jpg',
            };
          }

          // Handle Parse.File format { __type: "File", name: "...", url: "https://bucket.s3..." }
          // eslint-disable-next-line no-underscore-dangle
          if (photo.__type === 'File' || (photo.url && photo.url.includes('amazonaws.com'))) {
            const s3Key = this.extractS3KeyFromUrl(photo.url);
            if (s3Key) {
              const presignedUrl = await this.fileStorageService.getPresignedUrl(s3Key);
              return {
                dataUrl: presignedUrl,
                url: presignedUrl,
                fileName: photo.name || photo.fileName || 'image.jpg',
              };
            }
          }

          // Handle base64 dataUrl (very old format)
          if (photo.dataUrl && photo.dataUrl.startsWith('data:')) {
            return { ...photo, fileName: photo.fileName || 'image.jpg' };
          }

          // Return photo as-is
          return {
            ...photo,
            fileName: photo.fileName || 'image.jpg',
          };
        } catch (error) {
          logger.error('Error processing legacy photo', {
            tourId: tour.id,
            photoFileName: photo.fileName || photo.name,
            error: error.message,
          });
          return null;
        }
      })
    );

    return formattedPhotos.filter((p) => p !== null);
  }

  /**
   * Extract S3 object key from an S3 URL.
   * @param {string} url - S3 URL to extract key from.
   * @returns {string|null} S3 key or null if not extractable.
   * @example
   */
  extractS3KeyFromUrl(url) {
    if (!url) return null;
    try {
      const bucket = process.env.S3_BUCKET;
      // Format: https://bucket.s3.region.amazonaws.com/key
      const bucketPrefix = `https://${bucket}.s3.`;
      if (url.startsWith(bucketPrefix)) {
        const pathStart = url.indexOf('.amazonaws.com/');
        if (pathStart !== -1) return url.substring(pathStart + '.amazonaws.com/'.length);
      }
      // Format: https://s3.region.amazonaws.com/bucket/key
      if (url.startsWith('https://s3.')) {
        const bucketPath = `/${bucket}/`;
        const bucketIdx = url.indexOf(bucketPath);
        if (bucketIdx !== -1) return url.substring(bucketIdx + bucketPath.length);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Send a standardized error response.
   * @param {object} res - Express response object.
   * @param {string} message - Error message.
   * @param {number} statusCode - HTTP status code.
   * @example
   */
  sendError(res, message, statusCode = 500) {
    return res.status(statusCode).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  }
}

// Export singleton instance
const toursController = new ToursController();
module.exports = toursController;
