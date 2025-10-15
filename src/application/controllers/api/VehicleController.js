/**
 * VehicleController - RESTful API for Vehicle Fleet Management.
 *
 * Provides Ajax-ready endpoints for managing the vehicle fleet inventory.
 * Restricted to Admin and SuperAdmin roles.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE)
 * - DataTables server-side integration
 * - VehicleType integration with Pointer references
 * - License plate uniqueness validation
 * - Insurance expiry tracking
 * - Comprehensive validation and audit logging.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2025-10-14
 * @example
 * GET /api/vehicles - List vehicles with DataTables
 * POST /api/vehicles - Create vehicle
 * PUT /api/vehicles/:id - Update vehicle
 * DELETE /api/vehicles/:id - Soft delete vehicle
 */

const Parse = require('parse/node');
const Vehicle = require('../../../domain/models/Vehicle');
const VehicleType = require('../../../domain/models/VehicleType');
const logger = require('../../../infrastructure/logger');

/**
 * VehicleController class implementing RESTful API.
 */
class VehicleController {
  constructor() {
    this.maxPageSize = 100;
    this.defaultPageSize = 25;
  }

  /**
   * GET /api/vehicles - Get vehicles with DataTables server-side processing.
   *
   * Includes VehicleType information for display.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getVehicles(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
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

      // Column mapping for sorting
      const columns = [
        'brand',
        'licensePlate',
        'capacity',
        'maintenanceStatus',
        'updatedAt',
      ];
      const sortField = columns[sortColumnIndex] || 'updatedAt';

      // Get total records count (without search filter) - do this first
      // Show all records (active and inactive) but exclude deleted ones
      const totalRecordsQuery = new Parse.Query('Vehicle');
      totalRecordsQuery.equalTo('exists', true);
      const recordsTotal = await totalRecordsQuery.count({
        useMasterKey: true,
      });

      // Build base query for all existing records (not just active)
      const baseQuery = new Parse.Query('Vehicle');
      baseQuery.equalTo('exists', true);

      // Build filtered query with search
      let filteredQuery = baseQuery;
      if (searchValue) {
        const brandQuery = new Parse.Query('Vehicle');
        brandQuery.equalTo('exists', true);
        brandQuery.matches('brand', searchValue, 'i');

        const modelQuery = new Parse.Query('Vehicle');
        modelQuery.equalTo('exists', true);
        modelQuery.matches('model', searchValue, 'i');

        const plateQuery = new Parse.Query('Vehicle');
        plateQuery.equalTo('exists', true);
        plateQuery.matches('licensePlate', searchValue, 'i');

        filteredQuery = Parse.Query.or(brandQuery, modelQuery, plateQuery);
      }

      // Get count of filtered results
      const recordsFiltered = await filteredQuery.count({ useMasterKey: true });

      // Apply sorting
      if (sortDirection === 'asc') {
        filteredQuery.ascending(sortField);
      } else {
        filteredQuery.descending(sortField);
      }

      // Include VehicleType for display
      filteredQuery.include('vehicleTypeId');

      // Apply pagination
      filteredQuery.skip(start);
      filteredQuery.limit(length);

      // Execute query
      const vehicles = await filteredQuery.find({ useMasterKey: true });

      // Format data for DataTables
      const data = await Promise.all(
        vehicles.map(async (vehicle) => {
          const vehicleType = vehicle.get('vehicleTypeId');
          let vehicleTypeData = null;

          if (vehicleType) {
            await vehicleType.fetch({ useMasterKey: true });
            vehicleTypeData = {
              id: vehicleType.id,
              name: vehicleType.get('name'),
              code: vehicleType.get('code'),
              icon: vehicleType.get('icon'),
            };
          }

          return {
            id: vehicle.id,
            objectId: vehicle.id,
            brand: vehicle.get('brand'),
            model: vehicle.get('model'),
            year: vehicle.get('year'),
            licensePlate: vehicle.get('licensePlate'),
            vehicleTypeId: vehicleTypeData,
            capacity: vehicle.get('capacity'),
            color: vehicle.get('color'),
            maintenanceStatus: vehicle.get('maintenanceStatus'),
            insuranceExpiry: vehicle.get('insuranceExpiry')?.toISOString(),
            active: vehicle.get('active'),
            createdAt: vehicle.createdAt,
            updatedAt: vehicle.updatedAt,
          };
        })
      );

      // DataTables response format
      const response = {
        draw,
        recordsTotal,
        recordsFiltered,
        data,
      };

      return res.json(response);
    } catch (error) {
      logger.error('Error in VehicleController.getVehicles', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development'
          ? `Error: ${error.message}`
          : 'Failed to retrieve vehicles',
        500
      );
    }
  }

  /**
   * GET /api/vehicles/:id - Get single vehicle by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getVehicleById(req, res) {
    try {
      const currentUser = req.user;
      const vehicleId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!vehicleId) {
        return this.sendError(res, 'Vehicle ID is required', 400);
      }

      const query = new Parse.Query('Vehicle');
      query.equalTo('exists', true);
      query.include('vehicleTypeId');
      const vehicle = await query.get(vehicleId, { useMasterKey: true });

      if (!vehicle) {
        return this.sendError(res, 'Vehicle not found', 404);
      }

      const data = {
        id: vehicle.id,
        brand: vehicle.get('brand'),
        model: vehicle.get('model'),
        year: vehicle.get('year'),
        licensePlate: vehicle.get('licensePlate'),
        vehicleTypeId: vehicle.get('vehicleTypeId')?.id,
        capacity: vehicle.get('capacity'),
        color: vehicle.get('color'),
        maintenanceStatus: vehicle.get('maintenanceStatus'),
        insuranceExpiry: vehicle
          .get('insuranceExpiry')
          ?.toISOString()
          .split('T')[0], // Format for input[type=date]
        active: vehicle.get('active'),
        createdAt: vehicle.createdAt,
        updatedAt: vehicle.updatedAt,
      };

      return this.sendSuccess(res, data, 'Vehicle retrieved successfully');
    } catch (error) {
      logger.error('Error in VehicleController.getVehicleById', {
        error: error.message,
        vehicleId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Failed to retrieve vehicle', 500);
    }
  }

  /**
   * POST /api/vehicles - Create new vehicle.
   *
   * Body Parameters:
   * - brand: string (required)
   * - model: string (required)
   * - year: number (required)
   * - licensePlate: string (required, unique)
   * - vehicleTypeId: string (required, Pointer to VehicleType)
   * - capacity: number (required)
   * - color: string (required)
   * - maintenanceStatus: string (required)
   * - insuranceExpiry: date (optional).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async createVehicle(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const {
        brand,
        model,
        year,
        licensePlate,
        vehicleTypeId,
        capacity,
        color,
        maintenanceStatus,
        insuranceExpiry,
      } = req.body;

      // Validate required fields
      if (
        !brand
        || !model
        || !year
        || !licensePlate
        || !vehicleTypeId
        || !capacity
        || !color
        || !maintenanceStatus
      ) {
        return this.sendError(res, 'Missing required fields', 400);
      }

      // Validate license plate uniqueness
      const isUnique = await Vehicle.isLicensePlateUnique(licensePlate);
      if (!isUnique) {
        return this.sendError(res, 'License plate already exists', 409);
      }

      // Validate VehicleType exists
      const vehicleType = (await VehicleType.findByCode(vehicleTypeId))
        || (await (async () => {
          const query = new Parse.Query('VehicleType');
          query.equalTo('exists', true);
          return query.get(vehicleTypeId, { useMasterKey: true });
        })());

      if (!vehicleType) {
        return this.sendError(res, 'Vehicle type not found', 404);
      }

      // Create new vehicle using Parse.Object.extend (not registered subclass)
      const VehicleClass = Parse.Object.extend('Vehicle');
      const vehicle = new VehicleClass();

      vehicle.set('brand', brand);
      vehicle.set('model', model);
      vehicle.set('year', parseInt(year, 10));
      vehicle.set('licensePlate', licensePlate);
      vehicle.set('vehicleTypeId', vehicleType);
      vehicle.set('capacity', parseInt(capacity, 10));
      vehicle.set('color', color);
      vehicle.set('maintenanceStatus', maintenanceStatus);
      vehicle.set('active', true);
      vehicle.set('exists', true);

      if (insuranceExpiry) {
        vehicle.set('insuranceExpiry', new Date(insuranceExpiry));
      }

      // Save with master key
      await vehicle.save(null, { useMasterKey: true });

      logger.info('Vehicle created', {
        vehicleId: vehicle.id,
        brand: vehicle.get('brand'),
        model: vehicle.get('model'),
        licensePlate: vehicle.get('licensePlate'),
        createdBy: currentUser.id,
      });

      const data = {
        id: vehicle.id,
        brand: vehicle.get('brand'),
        model: vehicle.get('model'),
        year: vehicle.get('year'),
        licensePlate: vehicle.get('licensePlate'),
        capacity: vehicle.get('capacity'),
        color: vehicle.get('color'),
        maintenanceStatus: vehicle.get('maintenanceStatus'),
        insuranceExpiry: vehicle.get('insuranceExpiry'),
        active: vehicle.get('active'),
        vehicleType: {
          id: vehicleType.id,
          name: vehicleType.get('name'),
          code: vehicleType.get('code'),
        },
      };

      return this.sendSuccess(res, data, 'Vehicle created successfully', 201);
    } catch (error) {
      logger.error('Error in VehicleController.createVehicle', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        body: req.body,
      });

      return this.sendError(
        res,
        error.message || 'Failed to create vehicle',
        500
      );
    }
  }

  /**
   * PUT /api/vehicles/:id - Update vehicle.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async updateVehicle(req, res) {
    try {
      const currentUser = req.user;
      const vehicleId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!vehicleId) {
        return this.sendError(res, 'Vehicle ID is required', 400);
      }

      // Get existing vehicle
      const query = new Parse.Query('Vehicle');
      query.equalTo('exists', true);
      const vehicle = await query.get(vehicleId, { useMasterKey: true });

      if (!vehicle) {
        return this.sendError(res, 'Vehicle not found', 404);
      }

      const {
        brand,
        model,
        year,
        licensePlate,
        vehicleTypeId,
        capacity,
        color,
        maintenanceStatus,
        insuranceExpiry,
        active,
      } = req.body;

      // Update fields if provided
      if (brand) vehicle.set('brand', brand);
      if (model) vehicle.set('model', model);
      if (year) vehicle.set('year', parseInt(year, 10));
      if (capacity) vehicle.set('capacity', parseInt(capacity, 10));
      if (color) vehicle.set('color', color);
      if (maintenanceStatus) vehicle.set('maintenanceStatus', maintenanceStatus);
      if (active !== undefined) vehicle.set('active', active);

      if (insuranceExpiry) {
        vehicle.set('insuranceExpiry', new Date(insuranceExpiry));
      }

      // Update license plate if changed
      if (licensePlate && licensePlate !== vehicle.get('licensePlate')) {
        const isUnique = await Vehicle.isLicensePlateUnique(
          licensePlate,
          vehicleId
        );
        if (!isUnique) {
          return this.sendError(res, 'License plate already exists', 409);
        }
        vehicle.set('licensePlate', licensePlate);
      }

      // Update vehicle type if changed
      const currentVehicleTypeId = vehicle.get('vehicleTypeId')?.id;
      if (vehicleTypeId && vehicleTypeId !== currentVehicleTypeId) {
        const vehicleType = await (async () => {
          const typeQuery = new Parse.Query('VehicleType');
          typeQuery.equalTo('exists', true);
          return typeQuery.get(vehicleTypeId, { useMasterKey: true });
        })();

        if (!vehicleType) {
          return this.sendError(res, 'Vehicle type not found', 404);
        }
        vehicle.set('vehicleTypeId', vehicleType);
      }

      // Save changes
      await vehicle.save(null, { useMasterKey: true });

      logger.info('Vehicle updated', {
        vehicleId: vehicle.id,
        licensePlate: vehicle.get('licensePlate'),
        updatedBy: currentUser.id,
      });

      const data = {
        id: vehicle.id,
        brand: vehicle.get('brand'),
        model: vehicle.get('model'),
        year: vehicle.get('year'),
        licensePlate: vehicle.get('licensePlate'),
        capacity: vehicle.get('capacity'),
        color: vehicle.get('color'),
        maintenanceStatus: vehicle.get('maintenanceStatus'),
        insuranceExpiry: vehicle.get('insuranceExpiry'),
        active: vehicle.get('active'),
      };

      return this.sendSuccess(res, data, 'Vehicle updated successfully');
    } catch (error) {
      logger.error('Error in VehicleController.updateVehicle', {
        error: error.message,
        vehicleId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Failed to update vehicle', 500);
    }
  }

  /**
   * DELETE /api/vehicles/:id - Soft delete vehicle.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async deleteVehicle(req, res) {
    try {
      const currentUser = req.user;
      const vehicleId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!vehicleId) {
        return this.sendError(res, 'Vehicle ID is required', 400);
      }

      // Get vehicle
      const query = new Parse.Query('Vehicle');
      query.equalTo('exists', true);
      const vehicle = await query.get(vehicleId, { useMasterKey: true });

      if (!vehicle) {
        return this.sendError(res, 'Vehicle not found', 404);
      }

      // TODO: Check if vehicle has active bookings
      // const hasBookings = await checkActiveBookings(vehicleId);
      // if (hasBookings) {
      //   return this.sendError(res, 'Cannot delete vehicle with active bookings', 409);
      // }

      // Soft delete
      vehicle.set('exists', false);
      vehicle.set('active', false);
      await vehicle.save(null, { useMasterKey: true });

      logger.info('Vehicle deleted', {
        vehicleId: vehicle.id,
        licensePlate: vehicle.get('licensePlate'),
        deletedBy: currentUser.id,
      });

      return this.sendSuccess(res, null, 'Vehicle deleted successfully');
    } catch (error) {
      logger.error('Error in VehicleController.deleteVehicle', {
        error: error.message,
        vehicleId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Failed to delete vehicle', 500);
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

module.exports = new VehicleController();
