/**
 * ServiceController - RESTful API for Service Management.
 *
 * Provides Ajax-ready endpoints for managing transportation service catalog.
 * Restricted to SuperAdmin and Admin roles for write operations.
 * Public read access for active services.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE)
 * - Admin/SuperAdmin access control for write operations
 * - DataTables server-side integration
 * - Comprehensive validation and audit logging
 * - Pointer handling for POIs and VehicleTypes.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2025-10-14
 * @example
 * GET /api/services - List all services with pagination
 * POST /api/services - Create new service
 * PUT /api/services/:id - Update service
 * DELETE /api/services/:id - Soft delete service
 * GET /api/services/active - Get active services for dropdowns
 */

const Parse = require('parse/node');
const ServiceService = require('../../services/ServiceService');
const logger = require('../../../infrastructure/logger');

/**
 * ServiceController class implementing RESTful API.
 */
class ServiceController {
  constructor() {
    this.serviceService = new ServiceService();
    this.maxPageSize = 100;
    this.defaultPageSize = 25;
  }

  /**
   * GET /api/services - Get services with DataTables server-side processing.
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
   */
  async getServices(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Parse DataTables parameters
      const draw = parseInt(req.query.draw) || 1;
      const start = parseInt(req.query.start) || 0;
      const length = Math.min(
        parseInt(req.query.length) || this.defaultPageSize,
        this.maxPageSize
      );
      const searchValue = req.query.search?.value || '';
      const sortColumnIndex = parseInt(req.query.order?.[0]?.column) || 0;
      const sortDirection = req.query.order?.[0]?.dir || 'asc';

      // Column mapping for sorting (matches frontend columns order)
      const columns = ['originPOI.name', 'destinationPOI.name', 'vehicleType.name', 'price', 'active'];
      const sortField = columns[sortColumnIndex] || 'price';

      // Get total records count (without search filter)
      const totalRecordsQuery = new Parse.Query('Service');
      totalRecordsQuery.equalTo('exists', true);
      const recordsTotal = await totalRecordsQuery.count({ useMasterKey: true });

      // Build base query for all existing records
      const baseQuery = new Parse.Query('Service');
      baseQuery.equalTo('exists', true);
      baseQuery.include('originPOI');
      baseQuery.include('destinationPOI');
      baseQuery.include('vehicleType');

      // Build filtered query with search
      let filteredQuery = baseQuery;
      if (searchValue) {
        // Search in POI names and vehicle type
        const originQuery = new Parse.Query('Service');
        originQuery.equalTo('exists', true);
        originQuery.include('originPOI');
        originQuery.include('destinationPOI');
        originQuery.include('vehicleType');
        originQuery.matches('originPOI.name', searchValue, 'i');

        const destQuery = new Parse.Query('Service');
        destQuery.equalTo('exists', true);
        destQuery.include('originPOI');
        destQuery.include('destinationPOI');
        destQuery.include('vehicleType');
        destQuery.matches('destinationPOI.name', searchValue, 'i');

        const vehicleQuery = new Parse.Query('Service');
        vehicleQuery.equalTo('exists', true);
        vehicleQuery.include('originPOI');
        vehicleQuery.include('destinationPOI');
        vehicleQuery.include('vehicleType');
        vehicleQuery.matches('vehicleType.name', searchValue, 'i');

        filteredQuery = Parse.Query.or(originQuery, destQuery, vehicleQuery);
      }

      // Get count of filtered results
      const recordsFiltered = await filteredQuery.count({ useMasterKey: true });

      // Apply sorting (Parse doesn't support nested field sorting directly)
      // We'll sort by simple fields and handle complex sorting client-side if needed
      if (sortField === 'price') {
        if (sortDirection === 'asc') {
          filteredQuery.ascending('price');
        } else {
          filteredQuery.descending('price');
        }
      } else if (sortField === 'active') {
        if (sortDirection === 'asc') {
          filteredQuery.ascending('active');
        } else {
          filteredQuery.descending('active');
        }
      } else {
        // Default sort by price
        filteredQuery.ascending('price');
      }

      // Apply pagination
      filteredQuery.skip(start);
      filteredQuery.limit(length);

      // Execute query
      const services = await filteredQuery.find({ useMasterKey: true });

      // Format data for DataTables
      const data = services.map((service) => {
        const originPOI = service.get('originPOI');
        const destinationPOI = service.get('destinationPOI');
        const vehicleType = service.get('vehicleType');

        return {
          id: service.id,
          objectId: service.id,
          originPOI: {
            id: originPOI?.id,
            name: originPOI?.get('name') || '-',
          },
          destinationPOI: {
            id: destinationPOI?.id,
            name: destinationPOI?.get('name') || '-',
          },
          vehicleType: {
            id: vehicleType?.id,
            name: vehicleType?.get('name') || '-',
          },
          note: service.get('note') || '',
          price: service.get('price') || 0,
          active: service.get('active'),
          createdAt: service.createdAt,
          updatedAt: service.updatedAt,
        };
      });

      // DataTables response format
      const response = {
        draw,
        recordsTotal,
        recordsFiltered,
        data,
      };

      return res.json(response);
    } catch (error) {
      logger.error('Error in ServiceController.getServices', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development'
          ? `Error: ${error.message}`
          : 'Error al obtener los servicios',
        500
      );
    }
  }

  /**
   * GET /api/services/active - Get active services for dropdowns.
   *
   * Returns simplified array of active services suitable for select/dropdown elements.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getActiveServices(req, res) {
    try {
      const query = new Parse.Query('Service');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.include('originPOI');
      query.include('destinationPOI');
      query.include('vehicleType');
      query.ascending('price');
      query.limit(1000);

      const services = await query.find({ useMasterKey: true });

      // Format for select options
      const options = services.map((service) => {
        const originPOI = service.get('originPOI');
        const destinationPOI = service.get('destinationPOI');
        const vehicleType = service.get('vehicleType');

        return {
          value: service.id,
          label: `${originPOI?.get('name')} → ${destinationPOI?.get('name')} (${vehicleType?.get('name')})`,
          origin: originPOI?.get('name'),
          destination: destinationPOI?.get('name'),
          vehicleType: vehicleType?.get('name'),
          price: service.get('price'),
        };
      });

      return this.sendSuccess(res, options, 'Active services retrieved successfully');
    } catch (error) {
      logger.error('Error in ServiceController.getActiveServices', {
        error: error.message,
        stack: error.stack,
      });

      return this.sendError(
        res,
        'Error al obtener los servicios activos',
        500
      );
    }
  }

  /**
   * GET /api/services/:id - Get single service by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getServiceById(req, res) {
    try {
      const currentUser = req.user;
      const serviceId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!serviceId) {
        return this.sendError(res, 'El ID del servicio es requerido', 400);
      }

      const query = new Parse.Query('Service');
      query.equalTo('exists', true);
      query.include('originPOI');
      query.include('destinationPOI');
      query.include('vehicleType');
      const service = await query.get(serviceId, { useMasterKey: true });

      if (!service) {
        return this.sendError(res, 'Servicio no encontrado', 404);
      }

      const originPOI = service.get('originPOI');
      const destinationPOI = service.get('destinationPOI');
      const vehicleType = service.get('vehicleType');

      const data = {
        id: service.id,
        originPOI: {
          id: originPOI?.id,
          name: originPOI?.get('name'),
        },
        destinationPOI: {
          id: destinationPOI?.id,
          name: destinationPOI?.get('name'),
        },
        vehicleType: {
          id: vehicleType?.id,
          name: vehicleType?.get('name'),
        },
        note: service.get('note') || '',
        price: service.get('price'),
        active: service.get('active'),
        createdAt: service.createdAt,
        updatedAt: service.updatedAt,
      };

      return this.sendSuccess(res, data, 'Servicio obtenido exitosamente');
    } catch (error) {
      logger.error('Error in ServiceController.getServiceById', {
        error: error.message,
        serviceId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al obtener el servicio', 500);
    }
  }

  /**
   * POST /api/services - Create new service.
   *
   * Body Parameters:
   * - originPOI: string (required) - Origin POI ID
   * - destinationPOI: string (required) - Destination POI ID
   * - vehicleType: string (required) - VehicleType ID
   * - note: string (optional) - Service note
   * - price: number (required) - Service price.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async createService(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const {
        originPOI, destinationPOI, vehicleType, note, price,
      } = req.body;

      // Validate required fields
      if (!originPOI) {
        return this.sendError(res, 'El origen es requerido', 400);
      }

      if (!destinationPOI) {
        return this.sendError(res, 'El destino es requerido', 400);
      }

      if (originPOI === destinationPOI) {
        return this.sendError(res, 'El origen y destino deben ser diferentes', 400);
      }

      if (!vehicleType) {
        return this.sendError(res, 'El tipo de vehículo es requerido', 400);
      }

      if (!price || parseFloat(price) <= 0) {
        return this.sendError(res, 'El precio debe ser mayor a 0', 400);
      }

      if (note && note.length > 500) {
        return this.sendError(res, 'La nota debe tener 500 caracteres o menos', 400);
      }

      // Check if route already exists
      const existingQuery = new Parse.Query('Service');
      existingQuery.equalTo('originPOI', {
        __type: 'Pointer',
        className: 'POI',
        objectId: originPOI,
      });
      existingQuery.equalTo('destinationPOI', {
        __type: 'Pointer',
        className: 'POI',
        objectId: destinationPOI,
      });
      existingQuery.equalTo('vehicleType', {
        __type: 'Pointer',
        className: 'VehicleType',
        objectId: vehicleType,
      });
      existingQuery.equalTo('exists', true);
      const existingCount = await existingQuery.count({ useMasterKey: true });

      if (existingCount > 0) {
        return this.sendError(res, 'Ya existe un servicio con esta ruta y tipo de vehículo', 409);
      }

      // Verify POIs exist
      const originQuery = new Parse.Query('POI');
      const originPOIObj = await originQuery.get(originPOI, { useMasterKey: true });
      if (!originPOIObj) {
        return this.sendError(res, 'El origen no existe', 404);
      }

      const destQuery = new Parse.Query('POI');
      const destPOIObj = await destQuery.get(destinationPOI, { useMasterKey: true });
      if (!destPOIObj) {
        return this.sendError(res, 'El destino no existe', 404);
      }

      // Verify VehicleType exists
      const vehicleQuery = new Parse.Query('VehicleType');
      const vehicleTypeObj = await vehicleQuery.get(vehicleType, { useMasterKey: true });
      if (!vehicleTypeObj) {
        return this.sendError(res, 'El tipo de vehículo no existe', 404);
      }

      // Create new service using Parse.Object.extend
      const ServiceClass = Parse.Object.extend('Service');
      const service = new ServiceClass();

      service.set('originPOI', originPOIObj);
      service.set('destinationPOI', destPOIObj);
      service.set('vehicleType', vehicleTypeObj);
      service.set('note', note || '');
      service.set('price', parseFloat(price));
      service.set('active', true);
      service.set('exists', true);

      // Save with master key
      await service.save(null, { useMasterKey: true });

      logger.info('Service created', {
        serviceId: service.id,
        origin: originPOIObj.get('name'),
        destination: destPOIObj.get('name'),
        vehicleType: vehicleTypeObj.get('name'),
        price: parseFloat(price),
        createdBy: currentUser.id,
      });

      const data = {
        id: service.id,
        originPOI: {
          id: originPOIObj.id,
          name: originPOIObj.get('name'),
        },
        destinationPOI: {
          id: destPOIObj.id,
          name: destPOIObj.get('name'),
        },
        vehicleType: {
          id: vehicleTypeObj.id,
          name: vehicleTypeObj.get('name'),
        },
        note: service.get('note'),
        price: service.get('price'),
        active: service.get('active'),
      };

      return this.sendSuccess(res, data, 'Servicio creado exitosamente', 201);
    } catch (error) {
      logger.error('Error in ServiceController.createService', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        body: req.body,
      });

      return this.sendError(res, 'Error al crear el servicio', 500);
    }
  }

  /**
   * PUT /api/services/:id - Update service.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async updateService(req, res) {
    try {
      const currentUser = req.user;
      const serviceId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!serviceId) {
        return this.sendError(res, 'El ID del servicio es requerido', 400);
      }

      // Get existing service
      const query = new Parse.Query('Service');
      query.equalTo('exists', true);
      query.include('originPOI');
      query.include('destinationPOI');
      query.include('vehicleType');
      const service = await query.get(serviceId, { useMasterKey: true });

      if (!service) {
        return this.sendError(res, 'Servicio no encontrado', 404);
      }

      const {
        originPOI, destinationPOI, vehicleType, note, price, active,
      } = req.body;

      // Update originPOI if provided
      if (originPOI) {
        const originQuery = new Parse.Query('POI');
        const originPOIObj = await originQuery.get(originPOI, { useMasterKey: true });
        if (!originPOIObj) {
          return this.sendError(res, 'El origen no existe', 404);
        }
        service.set('originPOI', originPOIObj);
      }

      // Update destinationPOI if provided
      if (destinationPOI) {
        const destQuery = new Parse.Query('POI');
        const destPOIObj = await destQuery.get(destinationPOI, { useMasterKey: true });
        if (!destPOIObj) {
          return this.sendError(res, 'El destino no existe', 404);
        }
        service.set('destinationPOI', destPOIObj);
      }

      // Validate origin !== destination
      const currentOrigin = service.get('originPOI');
      const currentDest = service.get('destinationPOI');
      if (currentOrigin && currentDest && currentOrigin.id === currentDest.id) {
        return this.sendError(res, 'El origen y destino deben ser diferentes', 400);
      }

      // Update vehicleType if provided
      if (vehicleType) {
        const vehicleQuery = new Parse.Query('VehicleType');
        const vehicleTypeObj = await vehicleQuery.get(vehicleType, { useMasterKey: true });
        if (!vehicleTypeObj) {
          return this.sendError(res, 'El tipo de vehículo no existe', 404);
        }
        service.set('vehicleType', vehicleTypeObj);
      }

      // Update note if provided
      if (note !== undefined) {
        if (note.length > 500) {
          return this.sendError(res, 'La nota debe tener 500 caracteres o menos', 400);
        }
        service.set('note', note);
      }

      // Update price if provided
      if (price !== undefined) {
        const priceNum = parseFloat(price);
        if (priceNum <= 0) {
          return this.sendError(res, 'El precio debe ser mayor a 0', 400);
        }
        service.set('price', priceNum);
      }

      // Update active status if provided
      if (typeof active === 'boolean') {
        service.set('active', active);
      }

      // Save changes
      await service.save(null, { useMasterKey: true });

      logger.info('Service updated', {
        serviceId: service.id,
        origin: service.get('originPOI')?.get('name'),
        destination: service.get('destinationPOI')?.get('name'),
        vehicleType: service.get('vehicleType')?.get('name'),
        price: service.get('price'),
        active: service.get('active'),
        updatedBy: currentUser.id,
      });

      const data = {
        id: service.id,
        originPOI: {
          id: service.get('originPOI')?.id,
          name: service.get('originPOI')?.get('name'),
        },
        destinationPOI: {
          id: service.get('destinationPOI')?.id,
          name: service.get('destinationPOI')?.get('name'),
        },
        vehicleType: {
          id: service.get('vehicleType')?.id,
          name: service.get('vehicleType')?.get('name'),
        },
        note: service.get('note'),
        price: service.get('price'),
        active: service.get('active'),
        updatedAt: service.updatedAt,
      };

      return this.sendSuccess(res, data, 'Servicio actualizado exitosamente');
    } catch (error) {
      logger.error('Error in ServiceController.updateService', {
        error: error.message,
        stack: error.stack,
        serviceId: req.params.id,
        userId: req.user?.id,
        body: req.body,
      });

      return this.sendError(res, 'Error al actualizar el servicio', 500);
    }
  }

  /**
   * PATCH /api/services/:id/toggle-status - Toggle service active/inactive status.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async toggleServiceStatus(req, res) {
    try {
      const currentUser = req.user;
      const serviceId = req.params.id;
      const { active } = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!serviceId) {
        return this.sendError(res, 'El ID del servicio es requerido', 400);
      }

      if (typeof active !== 'boolean') {
        return this.sendError(res, 'El estado activo debe ser un valor booleano', 400);
      }

      const result = await this.serviceService.toggleServiceStatus(
        currentUser,
        serviceId,
        active,
        req.body?.reason || '',
        req.userRole // Pass userRole from JWT middleware
      );

      return this.sendSuccess(res, result.service, result.message || 'Estado actualizado exitosamente');
    } catch (error) {
      logger.error('Error in ServiceController.toggleServiceStatus', {
        error: error.message,
        stack: error.stack,
        serviceId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, error.message || 'Error al cambiar el estado del servicio', 500);
    }
  }

  /**
   * DELETE /api/services/:id - Soft delete service.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async deleteService(req, res) {
    try {
      const currentUser = req.user;
      const serviceId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!serviceId) {
        return this.sendError(res, 'El ID del servicio es requerido', 400);
      }

      await this.serviceService.softDeleteService(
        currentUser,
        serviceId,
        req.body?.reason || '',
        req.userRole // Pass userRole from JWT middleware
      );

      return this.sendSuccess(res, null, 'Servicio eliminado exitosamente');
    } catch (error) {
      logger.error('Error in ServiceController.deleteService', {
        error: error.message,
        stack: error.stack,
        serviceId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, error.message || 'Error al eliminar el servicio', 500);
    }
  }

  /**
   * Send success response.
   * @param {object} res - Express response object.
   * @param {object} data - Response data.
   * @param {string} message - Success message.
   * @param {number} statusCode - HTTP status code.
   * @returns {object} Express response.
   * @example
   */
  sendSuccess(res, data, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
    });
  }

  /**
   * Send error response.
   * @param {object} res - Express response object.
   * @param {string} error - Error message.
   * @param {number} statusCode - HTTP status code.
   * @returns {object} Express response.
   * @example
   */
  sendError(res, error, statusCode = 400) {
    return res.status(statusCode).json({
      success: false,
      error,
    });
  }
}

// Export singleton instance
const serviceController = new ServiceController();
module.exports = serviceController;
