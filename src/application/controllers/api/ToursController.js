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

      // Transform results for DataTables
      const data = tours.map((tour) => {
        const destinationPOI = tour.get('destinationPOI');

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
      const { rateId } = req.query;

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
          const price = tourPrice.get('price') || 0;

          // Format price to MXN
          const formattedPrice = `$${Math.round(price).toLocaleString()} MXN`;

          pricesMap[tourId].push({
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
          });
        }
      });

      // Format the tour response data with price information
      const toursWithPrices = tours.map((tour) => {
        const destinationPOI = tour.get('destinationPOI');
        const tourId = tour.id;
        const priceData = pricesMap[tourId] || [];

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
        };
      });

      return res.json({
        success: true,
        message: 'Tours con precios obtenidos exitosamente',
        data: toursWithPrices,
      });
    } catch (error) {
      console.error('Error al obtener tours con precios:', error.message);
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
      console.error('Error al obtener precios del tour:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Error al obtener los precios del tour',
        timestamp: new Date().toISOString(),
      });
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
