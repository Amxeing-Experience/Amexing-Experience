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
 * @since 1.0.0
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
   * // Usage example documented above
   */
  async getVehicles(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Parse DataTables parameters
      const draw = parseInt(req.query.draw, 10) || 1;
      const start = parseInt(req.query.start, 10) || 0;
      const length = Math.min(parseInt(req.query.length, 10) || this.defaultPageSize, this.maxPageSize);
      const searchValue = req.query.search?.value || '';
      const sortColumnIndex = parseInt(req.query.order?.[0]?.column, 10) || 0;
      const sortDirection = req.query.order?.[0]?.dir || 'asc';

      // Column mapping for sorting
      const columns = ['brand', 'licensePlate', 'capacity', 'maintenanceStatus', 'updatedAt'];
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

      // Apply rate filter if provided
      const { rateId } = req.query;
      if (rateId && rateId.trim() !== '') {
        // Create Rate pointer
        const Rate = Parse.Object.extend('Rate');
        const ratePointer = Rate.createWithoutData(rateId);

        // If we already have a filtered query from search, need to combine with AND
        if (searchValue) {
          // Create new queries for each search field that also include rate filter
          const brandQuery = new Parse.Query('Vehicle');
          brandQuery.equalTo('exists', true);
          brandQuery.matches('brand', searchValue, 'i');
          brandQuery.equalTo('rateId', ratePointer);

          const modelQuery = new Parse.Query('Vehicle');
          modelQuery.equalTo('exists', true);
          modelQuery.matches('model', searchValue, 'i');
          modelQuery.equalTo('rateId', ratePointer);

          const plateQuery = new Parse.Query('Vehicle');
          plateQuery.equalTo('exists', true);
          plateQuery.matches('licensePlate', searchValue, 'i');
          plateQuery.equalTo('rateId', ratePointer);

          filteredQuery = Parse.Query.or(brandQuery, modelQuery, plateQuery);
        } else {
          // Just apply rate filter to base query
          filteredQuery.equalTo('rateId', ratePointer);
        }
      }

      // Get count of filtered results
      const recordsFiltered = await filteredQuery.count({ useMasterKey: true });

      // Apply sorting
      if (sortDirection === 'asc') {
        filteredQuery.ascending(sortField);
      } else {
        filteredQuery.descending(sortField);
      }

      // Include VehicleType and Rate for display
      filteredQuery.include('vehicleTypeId');
      filteredQuery.include('rateId');

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

          // Include rate information
          const rate = vehicle.get('rateId');
          let rateData = null;

          if (rate) {
            await rate.fetch({ useMasterKey: true });
            rateData = {
              id: rate.id,
              objectId: rate.id,
              name: rate.get('name'),
              percentage: rate.get('percentage'),
              color: rate.get('color') || '#6366F1',
            };
          }

          return {
            id: vehicle.id,
            objectId: vehicle.id,
            brand: vehicle.get('brand'),
            model: vehicle.get('model'),
            year: vehicle.get('year'),
            licensePlate: vehicle.get('licensePlate'),
            vin: vehicle.get('vin'),
            vehicleId: vehicle.get('vehicleId'),
            vehicleTypeId: vehicleTypeData,
            rateId: rateData,
            capacity: vehicle.get('capacity'),
            luggageCapacity: vehicle.get('luggageCapacity'),
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
        success: true,
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
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to retrieve vehicles',
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
   * // Usage example documented above
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
      query.include('rateId');
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
        vin: vehicle.get('vin'),
        vehicleId: vehicle.get('vehicleId'),
        vehicleTypeId: vehicle.get('vehicleTypeId')?.id,
        rateId: vehicle.get('rateId')?.id,
        capacity: vehicle.get('capacity'),
        luggageCapacity: vehicle.get('luggageCapacity'),
        color: vehicle.get('color'),
        maintenanceStatus: vehicle.get('maintenanceStatus'),
        insuranceExpiry: vehicle.get('insuranceExpiry')?.toISOString().split('T')[0], // Format for input[type=date]
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
   * - rateId: string (optional, Pointer to Rate - must be active)
   * - capacity: number (required)
   * - color: string (required)
   * - maintenanceStatus: string (required)
   * - insuranceExpiry: date (optional).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
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
        vin,
        vehicleId,
        vehicleTypeId,
        rateId,
        capacity,
        luggageCapacity,
        color,
        maintenanceStatus,
        insuranceExpiry,
      } = req.body;

      // Validate required fields
      if (!brand || !model || !year || !licensePlate || !vehicleTypeId || !capacity || !color || !maintenanceStatus) {
        return this.sendError(res, 'Missing required fields', 400);
      }

      // Validate license plate uniqueness
      const isUnique = await Vehicle.isLicensePlateUnique(licensePlate);
      if (!isUnique) {
        return this.sendError(res, 'License plate already exists', 409);
      }

      // Validate VIN uniqueness if provided
      if (vin && vin.trim()) {
        const isVinUnique = await Vehicle.isVinUnique(vin);
        if (!isVinUnique) {
          return this.sendError(res, 'VIN already exists', 409);
        }
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

      // Validate Rate if provided (optional field)
      let rate = null;
      if (rateId) {
        const rateQuery = new Parse.Query('Rate');
        rateQuery.equalTo('exists', true);
        try {
          rate = await rateQuery.get(rateId, { useMasterKey: true });

          // Check if rate is active
          if (!rate.get('active')) {
            return this.sendError(res, 'Rate is inactive and cannot be assigned', 400);
          }
        } catch (error) {
          return this.sendError(res, 'Rate not found', 404);
        }
      }

      // Create new vehicle using Parse.Object.extend (not registered subclass)
      const VehicleClass = Parse.Object.extend('Vehicle');
      const vehicle = new VehicleClass();

      vehicle.set('brand', brand);
      vehicle.set('model', model);
      vehicle.set('year', parseInt(year, 10));
      vehicle.set('licensePlate', licensePlate);
      if (vin && vin.trim()) {
        vehicle.set('vin', vin.toUpperCase().trim());
      }
      if (vehicleId && vehicleId.trim()) {
        vehicle.set('vehicleId', vehicleId.trim());
      }
      vehicle.set('vehicleTypeId', vehicleType);
      vehicle.set('capacity', parseInt(capacity, 10));

      if (luggageCapacity !== undefined) {
        vehicle.set('luggageCapacity', parseInt(luggageCapacity, 10));
      }
      vehicle.set('color', color);
      vehicle.set('maintenanceStatus', maintenanceStatus);
      vehicle.set('active', true);
      vehicle.set('exists', true);

      // Set rate if provided
      if (rate) {
        vehicle.set('rateId', rate);
      }

      if (insuranceExpiry) {
        // Normalize to end of day UTC to avoid timezone issues
        const expiryDate = new Date(`${insuranceExpiry}T23:59:59.999Z`);
        vehicle.set('insuranceExpiry', expiryDate);
      }

      // Save with master key and user context for audit trail
      await vehicle.save(null, {
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
        vin: vehicle.get('vin'),
        capacity: vehicle.get('capacity'),
        luggageCapacity: vehicle.get('luggageCapacity'),
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

      return this.sendError(res, error.message || 'Failed to create vehicle', 500);
    }
  }

  /**
   * PUT /api/vehicles/:id - Update vehicle.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
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
        vin,
        vehicleId: newVehicleId,
        vehicleTypeId,
        rateId,
        capacity,
        luggageCapacity,
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
      if (luggageCapacity !== undefined) vehicle.set('luggageCapacity', parseInt(luggageCapacity, 10));
      if (color) vehicle.set('color', color);
      if (maintenanceStatus) vehicle.set('maintenanceStatus', maintenanceStatus);
      if (active !== undefined) vehicle.set('active', active);

      if (insuranceExpiry) {
        // Normalize to end of day UTC to avoid timezone issues
        const expiryDate = new Date(`${insuranceExpiry}T23:59:59.999Z`);
        vehicle.set('insuranceExpiry', expiryDate);
      }

      // Update license plate if changed
      if (licensePlate !== undefined && licensePlate.trim()) {
        const normalizedLicensePlate = licensePlate.toUpperCase();
        const currentLicensePlate = vehicle.get('licensePlate');

        // Only check and update if the license plate is actually different
        if (normalizedLicensePlate !== currentLicensePlate) {
          const isUnique = await Vehicle.isLicensePlateUnique(normalizedLicensePlate, vehicleId);
          if (!isUnique) {
            return this.sendError(res, 'License plate already exists', 409);
          }
          vehicle.set('licensePlate', normalizedLicensePlate);
        }
      }

      // Update VIN if changed
      if (vin !== undefined) {
        const currentVin = vehicle.get('vin') || '';
        const newVin = vin ? vin.toUpperCase().trim() : '';

        if (newVin !== currentVin) {
          if (newVin && newVin.trim()) {
            const isVinUnique = await Vehicle.isVinUnique(newVin, vehicleId);
            if (!isVinUnique) {
              return this.sendError(res, 'VIN already exists', 409);
            }
            vehicle.set('vin', newVin);
          } else {
            vehicle.unset('vin');
          }
        }
      }

      // Update Vehicle ID if provided
      if (newVehicleId !== undefined) {
        if (newVehicleId && newVehicleId.trim()) {
          vehicle.set('vehicleId', newVehicleId.trim());
        } else {
          vehicle.unset('vehicleId');
        }
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

      // Update rate if changed
      if (rateId !== undefined) {
        if (rateId === null) {
          // Remove rate assignment
          vehicle.unset('rateId');
        } else {
          const currentRateId = vehicle.get('rateId')?.id;
          if (rateId !== currentRateId) {
            // Validate new rate
            const rateQuery = new Parse.Query('Rate');
            rateQuery.equalTo('exists', true);
            try {
              const rate = await rateQuery.get(rateId, { useMasterKey: true });

              // Check if rate is active
              if (!rate.get('active')) {
                return this.sendError(res, 'Rate is inactive and cannot be assigned', 400);
              }

              vehicle.set('rateId', rate);
            } catch (error) {
              return this.sendError(res, 'Rate not found', 404);
            }
          }
        }
      }

      // Save changes with user context for audit trail
      await vehicle.save(null, {
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
        vin: vehicle.get('vin'),
        capacity: vehicle.get('capacity'),
        luggageCapacity: vehicle.get('luggageCapacity'),
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
   * // Usage example documented above
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
   * // Usage example documented above
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
   * // Usage example documented above
   */
  sendError(res, message, statusCode = 500) {
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
}

module.exports = new VehicleController();
