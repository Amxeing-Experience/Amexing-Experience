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
  validateAvailability,
  sortDayCodesChronological,
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

      // Extract additional filters (if provided)
      const { rateId } = req.query;

      // Column mapping for sorting (matches frontend columns order)
      const columns = ['destinationPOI', 'time', 'vehicleType', 'price', 'rate', 'active'];
      const sortField = columns[sortColumnIndex] || 'createdAt';

      // Get total records count (without search filter)
      const totalRecordsQuery = new Parse.Query('Tours');
      totalRecordsQuery.equalTo('exists', true);
      const recordsTotal = await totalRecordsQuery.count({
        useMasterKey: true,
      });

      // Build base query for all existing records
      const baseQuery = new Parse.Query('Tours');
      baseQuery.equalTo('exists', true);
      baseQuery.include(['destinationPOI', 'vehicleType', 'rate']);

      // Apply rate filter if provided
      if (rateId) {
        const rateFilterQuery = new Parse.Query('Rate');
        try {
          const ratePointer = await rateFilterQuery.get(rateId, { useMasterKey: true });
          baseQuery.equalTo('rate', ratePointer);
        } catch (error) {
          logger.warn('Invalid rate ID provided for filtering', { rateId, error: error.message });
          // Continue without filter if rate not found
        }
      }

      // Build filtered query with search
      let filteredQuery = baseQuery;
      if (searchValue) {
        // Create subqueries for searching in related objects
        const poiQuery = new Parse.Query('POI');
        poiQuery.matches('name', searchValue, 'i');

        const vehicleTypeQuery = new Parse.Query('VehicleType');
        vehicleTypeQuery.matches('name', searchValue, 'i');

        const rateQuery = new Parse.Query('Rate');
        rateQuery.matches('name', searchValue, 'i');

        // Create separate queries for each search field
        const searchQueries = [
          new Parse.Query('Tours').equalTo('exists', true).matchesQuery('destinationPOI', poiQuery),
          new Parse.Query('Tours').equalTo('exists', true).matchesQuery('vehicleType', vehicleTypeQuery),
          new Parse.Query('Tours').equalTo('exists', true).matchesQuery('rate', rateQuery),
        ];

        filteredQuery = Parse.Query.or(...searchQueries);
        filteredQuery.include(['destinationPOI', 'vehicleType', 'rate']);

        // Apply rate filter to filtered query as well
        if (rateId) {
          const rateFilterQuery = new Parse.Query('Rate');
          try {
            const ratePointer = await rateFilterQuery.get(rateId, { useMasterKey: true });
            filteredQuery.equalTo('rate', ratePointer);
          } catch (error) {
            // Already logged above, continue without filter
          }
        }
      }

      // Get count of filtered results
      const recordsFiltered = await filteredQuery.count({ useMasterKey: true });

      // Apply sorting - handle pointer fields differently
      if (['destinationPOI', 'vehicleType', 'rate'].includes(sortField)) {
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
        const vehicleType = tour.get('vehicleType');
        const rate = tour.get('rate');

        return {
          id: tour.id,
          objectId: tour.id,
          destinationPOI: {
            objectId: destinationPOI?.id,
            name: destinationPOI?.get('name') || 'Sin destino',
          },
          time: tour.get('time') || 0,
          vehicleType: {
            objectId: vehicleType?.id,
            name: vehicleType?.get('name') || 'Sin tipo',
          },
          price: tour.get('price') || 0,
          rate: {
            id: rate?.id,
            name: rate?.get('name') || 'Sin tarifa',
            color: rate?.get('color') || '#6366F1',
          },
          minPassengers: tour.get('minPassengers') || null,
          maxPassengers: tour.get('maxPassengers') || null,
          notes: tour.get('notes') || null,
          availability: tour.get('availability') || null,
          // Legacy fields for backward compatibility
          availableDays: tour.get('availableDays') || null,
          startTime: tour.get('startTime') || null,
          endTime: tour.get('endTime') || null,
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

      const query = new Parse.Query('Tours');
      query.equalTo('exists', true);
      query.include(['destinationPOI', 'vehicleType', 'rate']);

      const tour = await query.get(tourId, { useMasterKey: true });

      if (!tour) {
        return this.sendError(res, 'Tour no encontrado', 404);
      }

      const destinationPOI = tour.get('destinationPOI');
      const vehicleType = tour.get('vehicleType');
      const rate = tour.get('rate');

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
        vehicleType: vehicleType
          ? {
            objectId: vehicleType.id,
            name: vehicleType.get('name'),
          }
          : null,
        price: tour.get('price'),
        rate: rate
          ? {
            id: rate.id,
            name: rate.get('name'),
            color: rate.get('color') || '#6366F1',
          }
          : null,
        minPassengers: tour.get('minPassengers'),
        maxPassengers: tour.get('maxPassengers'),
        notes: tour.get('notes'),
        availability: tour.get('availability'),
        // Legacy fields for backward compatibility
        availableDays: tour.get('availableDays'),
        startTime: tour.get('startTime'),
        endTime: tour.get('endTime'),
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
        vehicleType,
        price,
        rate,
        minPassengers,
        maxPassengers,
        notes,
        availability,
        // Legacy fields for backward compatibility
        availableDays,
        startTime,
        endTime,
      } = req.body;

      // Validate required fields
      if (!destinationPOI || !time || !vehicleType || !price || !rate) {
        return this.sendError(res, 'Todos los campos son requeridos', 400);
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
      } else if (availableDays || startTime || endTime) {
        // Legacy format validation (backward compatibility)
        if (!availableDays || !startTime || !endTime) {
          return this.sendError(
            res,
            'Para configurar disponibilidad, debe proporcionar días disponibles, hora de inicio y hora de fin',
            400
          );
        }

        const availabilityValidation = validateAvailability({
          availableDays,
          startTime,
          endTime,
        });

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

      if (price <= 0) {
        return this.sendError(res, 'El precio debe ser mayor a 0', 400);
      }

      // Validate passenger range (optional fields)
      if (minPassengers !== null && minPassengers !== undefined) {
        if (minPassengers < 1) {
          return this.sendError(res, 'El mínimo de pasajeros debe ser mayor a 0', 400);
        }
      }

      if (maxPassengers !== null && maxPassengers !== undefined) {
        if (maxPassengers < 1) {
          return this.sendError(res, 'El máximo de pasajeros debe ser mayor a 0', 400);
        }
      }

      if (minPassengers && maxPassengers && minPassengers > maxPassengers) {
        return this.sendError(res, 'El mínimo de pasajeros no puede ser mayor al máximo', 400);
      }

      // Verify related objects exist
      const poiQuery = new Parse.Query('POI');
      const poi = await poiQuery.get(destinationPOI, { useMasterKey: true });

      const vehicleTypeQuery = new Parse.Query('VehicleType');
      const vType = await vehicleTypeQuery.get(vehicleType, { useMasterKey: true });

      const rateQuery = new Parse.Query('Rate');
      const rateObj = await rateQuery.get(rate, { useMasterKey: true });

      // Create new tour
      const Tour = Parse.Object.extend('Tours');
      const tour = new Tour();

      tour.set('destinationPOI', poi);
      tour.set('time', parseInt(time, 10));
      tour.set('vehicleType', vType);
      tour.set('price', parseFloat(price));
      tour.set('rate', rateObj);

      // Set passenger range (optional fields)
      if (minPassengers !== null && minPassengers !== undefined) {
        tour.set('minPassengers', parseInt(minPassengers, 10));
      }

      if (maxPassengers !== null && maxPassengers !== undefined) {
        tour.set('maxPassengers', parseInt(maxPassengers, 10));
      }

      // Set notes (optional field)
      if (notes && notes.trim() !== '') {
        tour.set('notes', notes.trim());
      }

      // Set new availability format (array of day schedules)
      if (availability && Array.isArray(availability) && availability.length > 0) {
        const sortedSchedules = sortDaySchedulesChronological(availability);
        tour.set('availability', sortedSchedules);
      } else if (availableDays && startTime && endTime) {
        // Legacy format support (backward compatibility)
        // Sort day codes chronologically for consistency
        const sortedDays = sortDayCodesChronological(availableDays);
        tour.set('availableDays', sortedDays);
        tour.set('startTime', startTime);
        tour.set('endTime', endTime);
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
        vehicleType,
        price,
        rate,
        minPassengers,
        maxPassengers,
        notes,
        availability,
        // Legacy fields for backward compatibility
        availableDays,
        startTime,
        endTime,
      } = req.body;

      if (!tourId) {
        return this.sendError(res, 'ID de tour requerido', 400);
      }

      // Validate required fields
      if (!destinationPOI || !time || !vehicleType || !price || !rate) {
        return this.sendError(res, 'Todos los campos son requeridos', 400);
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
      } else if (availableDays || startTime || endTime) {
        // Legacy format validation (backward compatibility)
        if (!availableDays || !startTime || !endTime) {
          return this.sendError(
            res,
            'Para configurar disponibilidad, debe proporcionar días disponibles, hora de inicio y hora de fin',
            400
          );
        }

        const availabilityValidation = validateAvailability({
          availableDays,
          startTime,
          endTime,
        });

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

      if (price <= 0) {
        return this.sendError(res, 'El precio debe ser mayor a 0', 400);
      }

      // Validate passenger range (optional fields)
      if (minPassengers !== null && minPassengers !== undefined) {
        if (minPassengers < 1) {
          return this.sendError(res, 'El mínimo de pasajeros debe ser mayor a 0', 400);
        }
      }

      if (maxPassengers !== null && maxPassengers !== undefined) {
        if (maxPassengers < 1) {
          return this.sendError(res, 'El máximo de pasajeros debe ser mayor a 0', 400);
        }
      }

      if (minPassengers && maxPassengers && minPassengers > maxPassengers) {
        return this.sendError(res, 'El mínimo de pasajeros no puede ser mayor al máximo', 400);
      }

      // Get existing tour
      const query = new Parse.Query('Tours');
      query.equalTo('exists', true);
      const tour = await query.get(tourId, { useMasterKey: true });

      if (!tour) {
        return this.sendError(res, 'Tour no encontrado', 404);
      }

      // Verify related objects exist
      const poiQuery = new Parse.Query('POI');
      const poi = await poiQuery.get(destinationPOI, { useMasterKey: true });

      const vehicleTypeQuery = new Parse.Query('VehicleType');
      const vType = await vehicleTypeQuery.get(vehicleType, { useMasterKey: true });

      const rateQuery = new Parse.Query('Rate');
      const rateObj = await rateQuery.get(rate, { useMasterKey: true });

      // Update tour
      tour.set('destinationPOI', poi);
      tour.set('time', parseInt(time, 10));
      tour.set('vehicleType', vType);
      tour.set('price', parseFloat(price));
      tour.set('rate', rateObj);

      // Update passenger range (optional fields)
      if (minPassengers !== null && minPassengers !== undefined) {
        tour.set('minPassengers', parseInt(minPassengers, 10));
      } else {
        tour.unset('minPassengers');
      }

      if (maxPassengers !== null && maxPassengers !== undefined) {
        tour.set('maxPassengers', parseInt(maxPassengers, 10));
      } else {
        tour.unset('maxPassengers');
      }

      // Update notes (optional field)
      if (notes && notes.trim() !== '') {
        tour.set('notes', notes.trim());
      } else {
        tour.unset('notes');
      }

      // Update new availability format (array of day schedules)
      if (availability && Array.isArray(availability) && availability.length > 0) {
        const sortedSchedules = sortDaySchedulesChronological(availability);
        tour.set('availability', sortedSchedules);
        // Clear legacy fields when using new format
        tour.unset('availableDays');
        tour.unset('startTime');
        tour.unset('endTime');
      } else if (availability === null) {
        // If explicitly set to null, remove all availability fields
        tour.unset('availability');
        tour.unset('availableDays');
        tour.unset('startTime');
        tour.unset('endTime');
      } else if (availableDays && startTime && endTime) {
        // Legacy format support (backward compatibility)
        const sortedDays = sortDayCodesChronological(availableDays);
        tour.set('availableDays', sortedDays);
        tour.set('startTime', startTime);
        tour.set('endTime', endTime);
      } else if (availableDays === null || startTime === null || endTime === null) {
        // If legacy fields explicitly set to null, remove them
        tour.unset('availableDays');
        tour.unset('startTime');
        tour.unset('endTime');
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

      const query = new Parse.Query('Tours');
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

      const query = new Parse.Query('Tours');
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
