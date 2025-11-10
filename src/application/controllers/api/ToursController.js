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
      const data = tours.map((tour) => ({
        id: tour.id,
        objectId: tour.id,
        destinationPOI: {
          objectId: tour.get('destinationPOI')?.id,
          name: tour.get('destinationPOI')?.get('name') || 'Sin destino',
        },
        time: tour.get('time') || 0,
        vehicleType: {
          objectId: tour.get('vehicleType')?.id,
          name: tour.get('vehicleType')?.get('name') || 'Sin tipo',
        },
        price: tour.get('price') || 0,
        rate: {
          objectId: tour.get('rate')?.id,
          name: tour.get('rate')?.get('name') || 'Sin tarifa',
        },
        minPassengers: tour.get('minPassengers') || null,
        maxPassengers: tour.get('maxPassengers') || null,
        notes: tour.get('notes') || null,
        active: tour.get('active') || false,
        exists: tour.get('exists') || true,
        createdAt: tour.get('createdAt'),
        updatedAt: tour.get('updatedAt'),
      }));

      // Send DataTables response
      res.json({
        success: true,
        draw,
        recordsTotal,
        recordsFiltered,
        data: {
          tours: data,
          pagination: {
            total: recordsTotal,
            totalCount: recordsTotal,
            filtered: recordsFiltered,
            page: Math.floor(start / length) + 1,
            limit: length,
          },
        },
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

      const tourData = {
        id: tour.id,
        objectId: tour.id,
        destinationPOI: tour.get('destinationPOI') ? {
          objectId: tour.get('destinationPOI').id,
          name: tour.get('destinationPOI').get('name'),
        } : null,
        time: tour.get('time'),
        vehicleType: tour.get('vehicleType') ? {
          objectId: tour.get('vehicleType').id,
          name: tour.get('vehicleType').get('name'),
        } : null,
        price: tour.get('price'),
        rate: tour.get('rate') ? {
          objectId: tour.get('rate').id,
          name: tour.get('rate').get('name'),
        } : null,
        minPassengers: tour.get('minPassengers'),
        maxPassengers: tour.get('maxPassengers'),
        notes: tour.get('notes'),
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
        destinationPOI, time, vehicleType, price, rate, minPassengers, maxPassengers, notes,
      } = req.body;

      // Validate required fields
      if (!destinationPOI || !time || !vehicleType || !price || !rate) {
        return this.sendError(res, 'Todos los campos son requeridos', 400);
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
        destinationPOI, time, vehicleType, price, rate, minPassengers, maxPassengers, notes,
      } = req.body;

      if (!tourId) {
        return this.sendError(res, 'ID de tour requerido', 400);
      }

      // Validate required fields
      if (!destinationPOI || !time || !vehicleType || !price || !rate) {
        return this.sendError(res, 'Todos los campos son requeridos', 400);
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
