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

/**
 * ToursController class implementing RESTful API.
 */
class ToursController {
  constructor() {
    this.maxPageSize = 100;
    this.defaultPageSize = 25;
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

      // Extract tour type filter
      const { tourType } = req.query; // 'walking', 'vehicle', or undefined (all)

      // Column mapping for sorting (matches frontend columns order)
      const columns = ['destinationPOI', 'time', 'availability', 'active'];
      const sortField = columns[sortColumnIndex] || 'createdAt';

      // Get total records count (with tour type filter but without search filter)
      const totalRecordsQuery = new Parse.Query('Tour');
      totalRecordsQuery.equalTo('exists', true);

      // Apply tour type filter to total count
      if (tourType === 'walking') {
        totalRecordsQuery.equalTo('isWalkingTour', true);
      } else if (tourType === 'vehicle') {
        totalRecordsQuery.notEqualTo('isWalkingTour', true);
      }

      const recordsTotal = await totalRecordsQuery.count({
        useMasterKey: true,
      });

      // Build base query for all existing records
      const baseQuery = new Parse.Query('Tour');
      baseQuery.equalTo('exists', true);
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
          active: tour.get('active') || false,
          exists: tour.get('exists') || true,
          createdAt: tour.get('createdAt'),
          updatedAt: tour.get('updatedAt'),
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

      const query = new Parse.Query('Tour');
      query.equalTo('exists', true);
      query.include(['destinationPOI']);

      const tour = await query.get(tourId, { useMasterKey: true });

      if (!tour) {
        return this.sendError(res, 'Tour no encontrado', 404);
      }

      const destinationPOI = tour.get('destinationPOI');

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
        photos: tour.get('photos') || [],
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
      if (photos !== undefined && Array.isArray(photos)) tour.set('photos', photos);

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

      tour.set('active', true);
      tour.set('exists', true);

      const savedTour = await tour.save(null, { useMasterKey: true });

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
    try {
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
      if (photos !== undefined) {
        if (photos === null || !Array.isArray(photos)) tour.set('photos', []);
        else tour.set('photos', photos);
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
      const { rateId, clientId } = req.query;

      if (!rateId) {
        return res.status(400).json({
          success: false,
          error: 'ID de tarifa requerido',
          timestamp: new Date().toISOString(),
        });
      }

      // Get all active tours
      const toursQuery = new Parse.Query('Tour');
      toursQuery.equalTo('active', true);
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
          const formattedPrice = `$${Math.round(price).toLocaleString()} MXN`;

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
      const toursWithPrices = tours.map((tour) => {
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
          active: tour.get('active'),
          exists: tour.get('exists'),
          createdAt: tour.get('createdAt'),
          updatedAt: tour.get('updatedAt'),
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
      });

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
        const formattedPrice = `$${Math.round(price).toLocaleString()} MXN`;

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
          formattedPrice: `$${Math.round(finalPrice).toLocaleString()} MXN`,
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
              formattedPrice: `$${Math.round(clientPriceValue).toLocaleString()} MXN`,
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
   * Send error response.
   * @param {object} res - Express response object.
   * @param {string} message - Error message.
   * @param {number} statusCode - HTTP status code.
   * @returns {object} JSON error response.
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
