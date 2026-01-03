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

      // Extract additional filters (if provided) - removed since Tour table doesn't have rate field

      // Column mapping for sorting (matches frontend columns order)
      const columns = ['destinationPOI', 'time', 'availability', 'active'];
      const sortField = columns[sortColumnIndex] || 'createdAt';

      // Get total records count (without search filter)
      const totalRecordsQuery = new Parse.Query('Tour');
      totalRecordsQuery.equalTo('exists', true);
      const recordsTotal = await totalRecordsQuery.count({
        useMasterKey: true,
      });

      // Build base query for all existing records
      const baseQuery = new Parse.Query('Tour');
      baseQuery.equalTo('exists', true);
      baseQuery.include(['destinationPOI']);

      // Remove rate filter since Tour table doesn't have rate field

      // Build filtered query with search
      let filteredQuery = baseQuery;
      if (searchValue) {
        // Create subqueries for searching in related objects
        const poiQuery = new Parse.Query('POI');
        poiQuery.matches('name', searchValue, 'i');

        // Create separate queries for each search field
        const searchQueries = [
          new Parse.Query('Tour').equalTo('exists', true).matchesQuery('destinationPOI', poiQuery),
        ];

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
            } : null,
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
          destinationPOI: destinationPOI ? {
            objectId: destinationPOI.id,
            id: destinationPOI.id,
            name: destinationPOI.get('name'),
          } : null,
          time: tour.get('time'),
          availability: tour.get('availability'),
          active: tour.get('active'),
          exists: tour.get('exists'),
          createdAt: tour.get('createdAt'),
          updatedAt: tour.get('updatedAt'),
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
          } : null,
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
      logger.info(`[getAllRatePricesForTourWithClientPrices] Found ${allClientPrices.length} total TOUR client prices for client ${clientId}`);
      allClientPrices.forEach((cp) => {
        logger.info(`ClientPrice ID: ${cp.id}, ItemId: "${cp.get('itemId')}", Looking for tourId: "${tourId}"`);
      });

      // Filter client prices for this specific tour
      const clientPrices = allClientPrices.filter((cp) => cp.get('itemId') === tourId);
      logger.info(`[getAllRatePricesForTourWithClientPrices] After filtering for tour ${tourId}: ${clientPrices.length} prices found`);

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
          rate: rate ? {
            id: rate.id,
            name: rate.get('name'),
            color: rate.get('color') || '#6c757d',
          } : null,
          vehicleType: vehicleType ? {
            id: vehicleType.id,
            name: vehicleType.get('name'),
            code: vehicleType.get('code') || '',
            defaultCapacity: vehicleType.get('defaultCapacity') || 4,
            trunkCapacity: vehicleType.get('trunkCapacity') || 2,
          } : null,
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
              rate: ratePtr ? {
                id: ratePtr.id,
                name: ratePtr.get('name'),
                color: ratePtr.get('color') || '#6c757d',
              } : null,
              vehicleType: vehiclePtr ? {
                id: vehiclePtr.id,
                name: vehiclePtr.get('name'),
                code: vehiclePtr.get('code') || '',
                defaultCapacity: vehiclePtr.get('defaultCapacity') || 4,
                trunkCapacity: vehiclePtr.get('trunkCapacity') || 2,
              } : null,
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
