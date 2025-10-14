/**
 * VehicleTypeController - RESTful API for Vehicle Type Management.
 *
 * Provides Ajax-ready endpoints for managing vehicle type catalog.
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
 * @since 2025-10-14
 * @example
 * GET /api/vehicle-types - List all vehicle types with pagination
 * POST /api/vehicle-types - Create new vehicle type
 * PUT /api/vehicle-types/:id - Update vehicle type
 * DELETE /api/vehicle-types/:id - Soft delete vehicle type
 * GET /api/vehicle-types/active - Get active types for dropdowns
 */

const Parse = require('parse/node');
const VehicleTypeService = require('../../services/VehicleTypeService');
const logger = require('../../../infrastructure/logger');

/**
 * VehicleTypeController class implementing RESTful API.
 */
class VehicleTypeController {
  constructor() {
    this.vehicleTypeService = new VehicleTypeService();
    this.maxPageSize = 100;
    this.defaultPageSize = 25;
  }

  /**
   * GET /api/vehicle-types - Get vehicle types with DataTables server-side processing.
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
  async getVehicleTypes(req, res) {
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
      const columns = ['name', 'code', 'defaultCapacity', 'active'];
      const sortField = columns[sortColumnIndex] || 'name';

      // Get total records count (without search filter) - do this first
      // Show all records (active and inactive) but exclude deleted ones
      const totalRecordsQuery = new Parse.Query('VehicleType');
      totalRecordsQuery.equalTo('exists', true);
      const recordsTotal = await totalRecordsQuery.count({ useMasterKey: true });

      // Build base query for all existing records (not just active)
      const baseQuery = new Parse.Query('VehicleType');
      baseQuery.equalTo('exists', true);

      // Build filtered query with search
      let filteredQuery = baseQuery;
      if (searchValue) {
        const searchQuery = new Parse.Query('VehicleType');
        searchQuery.equalTo('exists', true);
        searchQuery.matches('name', searchValue, 'i');

        const codeQuery = new Parse.Query('VehicleType');
        codeQuery.equalTo('exists', true);
        codeQuery.matches('code', searchValue, 'i');

        const descQuery = new Parse.Query('VehicleType');
        descQuery.equalTo('exists', true);
        descQuery.matches('description', searchValue, 'i');

        filteredQuery = Parse.Query.or(searchQuery, codeQuery, descQuery);
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
      const vehicleTypes = await filteredQuery.find({ useMasterKey: true });

      // Format data for DataTables
      // Note: Using get() instead of getter methods since VehicleType subclass is not registered
      const data = vehicleTypes.map((type) => ({
        id: type.id,
        objectId: type.id,
        name: type.get('name'),
        code: type.get('code'),
        description: type.get('description') || '',
        icon: type.get('icon') || 'car',
        defaultCapacity: type.get('defaultCapacity') || 4,
        sortOrder: type.get('sortOrder') || 0,
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
      logger.error('Error in VehicleTypeController.getVehicleTypes', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development'
          ? `Error: ${error.message}`
          : 'Error al obtener los tipos de vehículos',
        500
      );
    }
  }

  /**
   * GET /api/vehicle-types/active - Get active vehicle types for dropdowns.
   *
   * Returns simplified array of active vehicle types suitable for select/dropdown elements.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getActiveVehicleTypes(req, res) {
    try {
      // Get active vehicle types manually
      const query = new Parse.Query('VehicleType');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.ascending('sortOrder');
      query.limit(100);

      const types = await query.find({ useMasterKey: true });

      // Format for select options
      const options = types.map((type) => ({
        value: type.id,
        label: type.get('name'),
        code: type.get('code'),
        capacity: type.get('defaultCapacity') || 4,
        icon: type.get('icon') || 'car',
      }));

      return this.sendSuccess(res, options, 'Active vehicle types retrieved successfully');
    } catch (error) {
      logger.error('Error in VehicleTypeController.getActiveVehicleTypes', {
        error: error.message,
        stack: error.stack,
      });

      return this.sendError(
        res,
        'Error al obtener los tipos de vehículos activos',
        500
      );
    }
  }

  /**
   * GET /api/vehicle-types/:id - Get single vehicle type by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getVehicleTypeById(req, res) {
    try {
      const currentUser = req.user;
      const typeId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!typeId) {
        return this.sendError(res, 'El ID del tipo de vehículo es requerido', 400);
      }

      const query = new Parse.Query('VehicleType');
      query.equalTo('exists', true);
      const vehicleType = await query.get(typeId, { useMasterKey: true });

      if (!vehicleType) {
        return this.sendError(res, 'Tipo de vehículo no encontrado', 404);
      }

      const data = {
        id: vehicleType.id,
        name: vehicleType.get('name'),
        code: vehicleType.get('code'),
        description: vehicleType.get('description'),
        icon: vehicleType.get('icon'),
        defaultCapacity: vehicleType.get('defaultCapacity'),
        sortOrder: vehicleType.get('sortOrder'),
        active: vehicleType.get('active'),
        createdAt: vehicleType.createdAt,
        updatedAt: vehicleType.updatedAt,
      };

      return this.sendSuccess(res, data, 'Tipo de vehículo obtenido exitosamente');
    } catch (error) {
      logger.error('Error in VehicleTypeController.getVehicleTypeById', {
        error: error.message,
        typeId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al obtener el tipo de vehículo', 500);
    }
  }

  /**
   * POST /api/vehicle-types - Create new vehicle type.
   *
   * Body Parameters:
   * - name: string (required) - Display name
   * - code: string (required) - Unique code
   * - description: string (optional) - Type description
   * - icon: string (optional) - Tabler icon name
   * - defaultCapacity: number (optional) - Default passenger capacity
   * - sortOrder: number (optional) - Display order.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async createVehicleType(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const {
        name, code, description, icon, defaultCapacity, sortOrder,
      } = req.body;

      // Validate required fields
      if (!name || !code) {
        return this.sendError(res, 'El nombre y código son requeridos', 400);
      }

      // Check code uniqueness manually
      const checkQuery = new Parse.Query('VehicleType');
      checkQuery.equalTo('code', code.toLowerCase());
      checkQuery.equalTo('exists', true);
      const existingCount = await checkQuery.count({ useMasterKey: true });

      if (existingCount > 0) {
        return this.sendError(res, 'El código del tipo de vehículo ya existe', 409);
      }

      // Create new vehicle type using Parse.Object.extend
      const VehicleTypeClass = Parse.Object.extend('VehicleType');
      const vehicleType = new VehicleTypeClass();

      vehicleType.set('name', name);
      vehicleType.set('code', code.toLowerCase());
      vehicleType.set('description', description || '');
      vehicleType.set('icon', icon || 'car');
      vehicleType.set('defaultCapacity', parseInt(defaultCapacity) || 4);
      vehicleType.set('sortOrder', parseInt(sortOrder) || 0);
      vehicleType.set('active', true);
      vehicleType.set('exists', true);

      // Basic validation
      if (!name || !code) {
        return this.sendError(res, 'El nombre y código son requeridos', 400);
      }
      if (!/^[a-z0-9_-]+$/.test(code.toLowerCase())) {
        return this.sendError(res, 'El código debe contener solo letras minúsculas, números, guiones y guiones bajos', 400);
      }

      // Save with master key
      await vehicleType.save(null, { useMasterKey: true });

      logger.info('Vehicle type created', {
        vehicleTypeId: vehicleType.id,
        name: vehicleType.get('name'),
        code: vehicleType.get('code'),
        createdBy: currentUser.id,
      });

      const data = {
        id: vehicleType.id,
        name: vehicleType.get('name'),
        code: vehicleType.get('code'),
        description: vehicleType.get('description'),
        icon: vehicleType.get('icon'),
        defaultCapacity: vehicleType.get('defaultCapacity'),
        sortOrder: vehicleType.get('sortOrder'),
      };

      return this.sendSuccess(res, data, 'Tipo de vehículo creado exitosamente', 201);
    } catch (error) {
      logger.error('Error in VehicleTypeController.createVehicleType', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        body: req.body,
      });

      return this.sendError(res, 'Error al crear el tipo de vehículo', 500);
    }
  }

  /**
   * PUT /api/vehicle-types/:id - Update vehicle type.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async updateVehicleType(req, res) {
    try {
      const currentUser = req.user;
      const typeId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!typeId) {
        return this.sendError(res, 'El ID del tipo de vehículo es requerido', 400);
      }

      // Get existing vehicle type
      const query = new Parse.Query('VehicleType');
      query.equalTo('exists', true);
      const vehicleType = await query.get(typeId, { useMasterKey: true });

      if (!vehicleType) {
        return this.sendError(res, 'Tipo de vehículo no encontrado', 404);
      }

      const {
        name, code, description, icon, defaultCapacity, sortOrder, active,
      } = req.body;

      // Update fields if provided using set()
      if (name) vehicleType.set('name', name);

      if (code && code !== vehicleType.get('code')) {
        // Check code uniqueness if changing
        const checkQuery = new Parse.Query('VehicleType');
        checkQuery.equalTo('code', code.toLowerCase());
        checkQuery.equalTo('exists', true);
        checkQuery.notEqualTo('objectId', typeId);
        const existingCount = await checkQuery.count({ useMasterKey: true });

        if (existingCount > 0) {
          return this.sendError(res, 'El código del tipo de vehículo ya existe', 409);
        }
        vehicleType.set('code', code.toLowerCase());
      }

      if (description !== undefined) vehicleType.set('description', description);
      if (icon) vehicleType.set('icon', icon);
      if (defaultCapacity) vehicleType.set('defaultCapacity', parseInt(defaultCapacity));
      if (sortOrder !== undefined) vehicleType.set('sortOrder', parseInt(sortOrder));
      if (active !== undefined) vehicleType.set('active', active);

      // Basic validation
      if (code && !/^[a-z0-9_-]+$/.test(code.toLowerCase())) {
        return this.sendError(res, 'Code must contain only lowercase letters, numbers, hyphens and underscores', 400);
      }

      // Save changes
      await vehicleType.save(null, { useMasterKey: true });

      logger.info('Vehicle type updated', {
        vehicleTypeId: vehicleType.id,
        name: vehicleType.get('name'),
        active: vehicleType.get('active'),
        updatedBy: currentUser.id,
      });

      const data = {
        id: vehicleType.id,
        name: vehicleType.get('name'),
        code: vehicleType.get('code'),
        description: vehicleType.get('description'),
        icon: vehicleType.get('icon'),
        defaultCapacity: vehicleType.get('defaultCapacity'),
        sortOrder: vehicleType.get('sortOrder'),
        active: vehicleType.get('active'),
      };

      return this.sendSuccess(res, data, 'Tipo de vehículo actualizado exitosamente');
    } catch (error) {
      logger.error('Error in VehicleTypeController.updateVehicleType', {
        error: error.message,
        typeId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al actualizar el tipo de vehículo', 500);
    }
  }

  /**
   * DELETE /api/vehicle-types/:id - Soft delete vehicle type.
   *
   * Checks if any vehicles are using this type before deletion.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async deleteVehicleType(req, res) {
    try {
      const currentUser = req.user;
      const typeId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!typeId) {
        return this.sendError(res, 'El ID del tipo de vehículo es requerido', 400);
      }

      // Get vehicle type
      const query = new Parse.Query('VehicleType');
      query.equalTo('exists', true);
      const vehicleType = await query.get(typeId, { useMasterKey: true });

      if (!vehicleType) {
        return this.sendError(res, 'Tipo de vehículo no encontrado', 404);
      }

      // Check if any vehicles are using this type
      const Vehicle = Parse.Object.extend('Vehicle');
      const vehicleQuery = new Parse.Query(Vehicle);
      vehicleQuery.equalTo('vehicleTypeId', vehicleType);
      vehicleQuery.equalTo('exists', true);
      const vehicleCount = await vehicleQuery.count({ useMasterKey: true });

      if (vehicleCount > 0) {
        return this.sendError(
          res,
          `Cannot delete: ${vehicleCount} vehicle(s) are using this type`,
          409
        );
      }

      // Soft delete: set both active and exists to false
      vehicleType.set('active', false);
      vehicleType.set('exists', false);
      await vehicleType.save(null, { useMasterKey: true });

      logger.info('Vehicle type deleted', {
        vehicleTypeId: vehicleType.id,
        name: vehicleType.get('name'),
        deletedBy: currentUser.id,
      });

      return this.sendSuccess(res, null, 'Tipo de vehículo eliminado exitosamente');
    } catch (error) {
      logger.error('Error in VehicleTypeController.deleteVehicleType', {
        error: error.message,
        typeId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al eliminar el tipo de vehículo', 500);
    }
  }

  /**
   * PATCH /api/vehicle-types/:id/toggle-status - Toggle active/inactive status.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * PATCH /api/vehicle-types/abc123/toggle-status
   * Body: { active: false }
   */
  async toggleVehicleTypeStatus(req, res) {
    try {
      const currentUser = req.user;
      const typeId = req.params.id;
      const { active } = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!typeId) {
        return this.sendError(res, 'El ID del tipo de vehículo es requerido', 400);
      }

      if (typeof active !== 'boolean') {
        return this.sendError(res, 'El estado activo debe ser un valor booleano', 400);
      }

      // Add role to currentUser for service validation
      const currentUserRole = req.userRole || currentUser.role || currentUser.get?.('role');
      const userWithRole = currentUser;
      userWithRole.role = currentUserRole;

      // Toggle status using service
      const result = await this.vehicleTypeService.toggleVehicleTypeStatus(
        userWithRole,
        typeId,
        active,
        'Status changed via vehicle types dashboard'
      );

      if (!result.success) {
        return this.sendError(res, result.message, 400);
      }

      return this.sendSuccess(
        res,
        result.vehicleType,
        `Vehicle type ${active ? 'activated' : 'deactivated'} successfully`
      );
    } catch (error) {
      logger.error('Error in VehicleTypeController.toggleVehicleTypeStatus', {
        error: error.message,
        stack: error.stack,
        typeId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Failed to toggle vehicle type status', 500);
    }
  }

  // =================
  // HELPER METHODS
  // =================

  /**
   * Send success response.
   * @param {object} res - Express response.
   * @param {*} data - Response data.
   * @param {string} message - Success message.
   * @param {number} statusCode - HTTP status code.
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
   * @param {object} res - Express response.
   * @param {string} message - Error message.
   * @param {number} statusCode - HTTP status code.
   * @example
   */
  sendError(res, message, statusCode = 500) {
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
}

module.exports = new VehicleTypeController();
