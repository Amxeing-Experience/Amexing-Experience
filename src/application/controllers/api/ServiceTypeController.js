/**
 * ServiceTypeController - RESTful API for Service Type Management.
 *
 * Provides Ajax-ready endpoints for managing service type catalog.
 * Restricted to SuperAdmin and Admin roles for write operations.
 * Public read access for active types.
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
 * GET /api/service-types - List all service types with pagination
 * POST /api/service-types - Create new service type
 * PUT /api/service-types/:id - Update service type
 * DELETE /api/service-types/:id - Soft delete service type
 * GET /api/service-types/active - Get active types for dropdowns
 */

const Parse = require('parse/node');
const ServiceTypeService = require('../../services/ServiceTypeService');
const logger = require('../../../infrastructure/logger');

/**
 * ServiceTypeController class implementing RESTful API.
 */
class ServiceTypeController {
  constructor() {
    this.serviceTypeService = new ServiceTypeService();
    this.maxPageSize = 100;
    this.defaultPageSize = 25;
  }

  /**
   * GET /api/service-types - Get service types with DataTables server-side processing.
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
  async getServiceTypes(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Parse DataTables parameters
      const draw = parseInt(req.query.draw, 10) || 1;
      const start = parseInt(req.query.start, 10) || 0;
      const length = Math.min(parseInt(req.query.length, 10) || this.defaultPageSize, this.maxPageSize);
      const searchValue = req.query.search?.value || '';
      const sortColumnIndex = parseInt(req.query.order?.[0]?.column, 10) || 0;
      const sortDirection = req.query.order?.[0]?.dir || 'asc';

      // Column mapping for sorting (matches frontend columns order)
      const columns = ['name', 'active'];
      const sortField = columns[sortColumnIndex] || 'name';

      // Get total records count (without search filter)
      // Show all records (active and inactive) but exclude deleted ones
      const totalRecordsQuery = new Parse.Query('ServiceType');
      totalRecordsQuery.equalTo('exists', true);
      const recordsTotal = await totalRecordsQuery.count({
        useMasterKey: true,
      });

      // Build base query for all existing records (not just active)
      const baseQuery = new Parse.Query('ServiceType');
      baseQuery.equalTo('exists', true);

      // Build filtered query with search
      let filteredQuery = baseQuery;
      if (searchValue) {
        const searchQuery = new Parse.Query('ServiceType');
        searchQuery.equalTo('exists', true);
        searchQuery.matches('name', searchValue, 'i');

        filteredQuery = searchQuery;
      }

      // Get count of filtered results
      const recordsFiltered = await filteredQuery.count({ useMasterKey: true });

      // Apply sorting
      if (sortDirection === 'asc') {
        filteredQuery.ascending(sortField);
      } else {
        filteredQuery.descending(sortField);
      }

      // Apply pagination
      filteredQuery.skip(start);
      filteredQuery.limit(length);

      // Execute query
      const serviceTypes = await filteredQuery.find({ useMasterKey: true });

      // Format data for DataTables
      const data = serviceTypes.map((type) => ({
        id: type.id,
        objectId: type.id,
        name: type.get('name'),
        active: type.get('active'),
        createdAt: type.createdAt,
        updatedAt: type.updatedAt,
      }));

      // DataTables response format
      const response = {
        draw,
        recordsTotal,
        recordsFiltered,
        data,
      };

      return res.json(response);
    } catch (error) {
      logger.error('Error in ServiceTypeController.getServiceTypes', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al obtener los tipos de traslado',
        500
      );
    }
  }

  /**
   * GET /api/service-types/active - Get active service types for dropdowns.
   *
   * Returns simplified array of active service types suitable for select/dropdown elements.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async getActiveServiceTypes(req, res) {
    try {
      // Get active service types manually
      const query = new Parse.Query('ServiceType');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.ascending('name');
      query.limit(100);

      const types = await query.find({ useMasterKey: true });

      // Format for select options
      const options = types.map((type) => ({
        value: type.id,
        label: type.get('name'),
      }));

      return this.sendSuccess(res, options, 'Active service types retrieved successfully');
    } catch (error) {
      logger.error('Error in ServiceTypeController.getActiveServiceTypes', {
        error: error.message,
        stack: error.stack,
      });

      return this.sendError(res, 'Error al obtener los tipos de traslado activos', 500);
    }
  }

  /**
   * GET /api/service-types/:id - Get single service type by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async getServiceTypeById(req, res) {
    try {
      const currentUser = req.user;
      const typeId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!typeId) {
        return this.sendError(res, 'El ID del tipo de traslado es requerido', 400);
      }

      const query = new Parse.Query('ServiceType');
      query.equalTo('exists', true);
      const serviceType = await query.get(typeId, { useMasterKey: true });

      if (!serviceType) {
        return this.sendError(res, 'Tipo de traslado no encontrado', 404);
      }

      const data = {
        id: serviceType.id,
        name: serviceType.get('name'),
        active: serviceType.get('active'),
        createdAt: serviceType.createdAt,
        updatedAt: serviceType.updatedAt,
      };

      return this.sendSuccess(res, data, 'Tipo de traslado obtenido exitosamente');
    } catch (error) {
      logger.error('Error in ServiceTypeController.getServiceTypeById', {
        error: error.message,
        typeId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al obtener el tipo de traslado', 500);
    }
  }

  /**
   * POST /api/service-types - Create new service type.
   *
   * Body Parameters:
   * - name: string (required) - Display name.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async createServiceType(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const { name } = req.body;

      // Validate required fields
      if (!name) {
        return this.sendError(res, 'El nombre es requerido', 400);
      }

      if (name.length > 100) {
        return this.sendError(res, 'El nombre debe tener 100 caracteres o menos', 400);
      }

      // Check name uniqueness manually
      const checkQuery = new Parse.Query('ServiceType');
      checkQuery.equalTo('name', name);
      checkQuery.equalTo('exists', true);
      const existingCount = await checkQuery.count({ useMasterKey: true });

      if (existingCount > 0) {
        return this.sendError(res, 'Ya existe un tipo de traslado con ese nombre', 409);
      }

      // Create new service type using Parse.Object.extend
      const ServiceTypeClass = Parse.Object.extend('ServiceType');
      const serviceType = new ServiceTypeClass();

      serviceType.set('name', name);
      serviceType.set('active', true);
      serviceType.set('exists', true);

      // Save with master key and user context for audit trail
      await serviceType.save(null, {
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

      logger.info('Service type created', {
        serviceTypeId: serviceType.id,
        name: serviceType.get('name'),
        createdBy: currentUser.id,
      });

      const data = {
        id: serviceType.id,
        name: serviceType.get('name'),
        active: serviceType.get('active'),
      };

      return this.sendSuccess(res, data, 'Tipo de traslado creado exitosamente', 201);
    } catch (error) {
      logger.error('Error in ServiceTypeController.createServiceType', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        body: req.body,
      });

      return this.sendError(res, 'Error al crear el tipo de traslado', 500);
    }
  }

  /**
   * PUT /api/service-types/:id - Update service type.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async updateServiceType(req, res) {
    try {
      const currentUser = req.user;
      const typeId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!typeId) {
        return this.sendError(res, 'El ID del tipo de traslado es requerido', 400);
      }

      // Get existing service type
      const query = new Parse.Query('ServiceType');
      query.equalTo('exists', true);
      const serviceType = await query.get(typeId, { useMasterKey: true });

      if (!serviceType) {
        return this.sendError(res, 'Tipo de traslado no encontrado', 404);
      }

      const { name, active } = req.body;

      // Check if trying to modify a system-protected type
      const currentName = serviceType.get('name');
      const PROTECTED_TYPES = ['Aeropuerto', 'Punto a Punto', 'Local'];

      if (PROTECTED_TYPES.includes(currentName)) {
        logger.warn('Attempted to modify protected service type', {
          typeId,
          currentName,
          userId: currentUser.id,
        });

        return this.sendError(
          res,
          'No se puede modificar este tipo de traslado. Es un tipo de sistema protegido.',
          403
        );
      }

      // Also prevent renaming TO a protected type name
      if (name && name !== currentName && PROTECTED_TYPES.includes(name)) {
        return this.sendError(res, 'No se puede usar ese nombre. Es un nombre reservado del sistema.', 400);
      }

      // Update fields if provided
      if (name) {
        // Check name uniqueness if changing
        if (name !== serviceType.get('name')) {
          const checkQuery = new Parse.Query('ServiceType');
          checkQuery.equalTo('name', name);
          checkQuery.equalTo('exists', true);
          checkQuery.notEqualTo('objectId', typeId);
          const existingCount = await checkQuery.count({ useMasterKey: true });

          if (existingCount > 0) {
            return this.sendError(res, 'Ya existe un tipo de traslado con ese nombre', 409);
          }
        }
        serviceType.set('name', name);
      }

      if (typeof active === 'boolean') {
        serviceType.set('active', active);
      }

      serviceType.set('updatedAt', new Date());

      // Save with context
      await serviceType.save(null, {
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

      logger.info('Service type updated', {
        serviceTypeId: serviceType.id,
        name: serviceType.get('name'),
        updatedBy: currentUser.id,
      });

      const data = {
        id: serviceType.id,
        name: serviceType.get('name'),
        active: serviceType.get('active'),
        updatedAt: serviceType.get('updatedAt'),
      };

      return this.sendSuccess(res, data, 'Tipo de traslado actualizado exitosamente');
    } catch (error) {
      logger.error('Error in ServiceTypeController.updateServiceType', {
        error: error.message,
        stack: error.stack,
        typeId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al actualizar el tipo de traslado', 500);
    }
  }

  /**
   * PATCH /api/service-types/:id/toggle-status - Toggle service type active status.
   *
   * Body: { active: boolean }.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async toggleServiceTypeStatus(req, res) {
    try {
      const currentUser = req.user;
      const typeId = req.params.id;
      const { active } = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!typeId) {
        return this.sendError(res, 'El ID del tipo de traslado es requerido', 400);
      }

      if (typeof active !== 'boolean') {
        return this.sendError(res, 'El campo "active" debe ser un booleano', 400);
      }

      // Attach userRole to currentUser for permission validation
      currentUser.userRole = req.userRole;

      // Use service for toggle operation
      const result = await this.serviceTypeService.toggleServiceTypeStatus(
        currentUser,
        typeId,
        active,
        'Toggle status via API'
      );

      if (!result.success) {
        return this.sendError(res, result.message, 400);
      }

      logger.info('Service type status toggled via API', {
        typeId,
        previousStatus: result.previousStatus,
        newStatus: result.newStatus,
        userId: currentUser.id,
      });

      return this.sendSuccess(
        res,
        result.serviceType,
        `Tipo de traslado ${active ? 'activado' : 'desactivado'} exitosamente`
      );
    } catch (error) {
      logger.error('Error in ServiceTypeController.toggleServiceTypeStatus', {
        error: error.message,
        stack: error.stack,
        typeId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al cambiar el estado del tipo de traslado', 500);
    }
  }

  /**
   * DELETE /api/service-types/:id - Soft delete service type.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async deleteServiceType(req, res) {
    try {
      const currentUser = req.user;
      const typeId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!typeId) {
        return this.sendError(res, 'El ID del tipo de traslado es requerido', 400);
      }

      // Attach userRole to currentUser for permission validation
      currentUser.userRole = req.userRole;

      // Use service for soft delete operation
      const result = await this.serviceTypeService.softDeleteServiceType(currentUser, typeId, 'Soft delete via API');

      if (!result.success) {
        return this.sendError(res, result.message, 400);
      }

      logger.info('Service type soft deleted via API', {
        typeId,
        userId: currentUser.id,
      });

      return this.sendSuccess(res, null, result.message);
    } catch (error) {
      logger.error('Error in ServiceTypeController.deleteServiceType', {
        error: error.message,
        stack: error.stack,
        typeId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al eliminar el tipo de traslado', 500);
    }
  }

  /**
   * Send success response.
   * @param {object} res - Express response object.
   * @param {*} data - Data to send.
   * @param {string} message - Success message.
   * @param {number} statusCode - HTTP status code (default 200).
   * @returns {object} Response object.
   * @private
   * @example
   */
  sendSuccess(res, data, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      data,
      message,
    });
  }

  /**
   * Send error response.
   * @param {object} res - Express response object.
   * @param {string} message - Error message.
   * @param {number} statusCode - HTTP status code (default 400).
   * @returns {object} Response object.
   * @private
   * @example
   */
  sendError(res, message, statusCode = 400) {
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
}

// Create singleton instance
const instance = new ServiceTypeController();

// Export methods with proper binding
module.exports = {
  getServiceTypes: (req, res) => instance.getServiceTypes(req, res),
  getActiveServiceTypes: (req, res) => instance.getActiveServiceTypes(req, res),
  getServiceTypeById: (req, res) => instance.getServiceTypeById(req, res),
  createServiceType: (req, res) => instance.createServiceType(req, res),
  updateServiceType: (req, res) => instance.updateServiceType(req, res),
  toggleServiceTypeStatus: (req, res) => instance.toggleServiceTypeStatus(req, res),
  deleteServiceType: (req, res) => instance.deleteServiceType(req, res),
};
