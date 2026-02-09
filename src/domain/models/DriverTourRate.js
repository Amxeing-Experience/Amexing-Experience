const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');

/**
 * DriverTourRate Domain Model.
 *
 * Manages driver tour rates within the system.
 * Handles CRUD operations, validation, and business logic for driver tour rates.
 * Supports active/inactive states and maintains rate history.
 *
 * Created by Denisse Maldonado.
 */
class DriverTourRate extends Parse.Object {
  constructor() {
    super('DriverTourRate');
  }

  /**
   * Get current active driver tour rate.
   * @returns {Promise<DriverTourRate|null>} Current active rate or null if none exists.
   * @example
   * const current = await DriverTourRate.getCurrentDriverTourRate();
   * console.log(current ? current.get('value') : 'No rate found');
   */
  static async getCurrentDriverTourRate() {
    try {
      const query = new Parse.Query('DriverTourRate');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.descending('createdAt');
      query.include('createdBy');

      return await query.first({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting current driver tour rate:', error);
      throw error;
    }
  }

  /**
   * Create new driver tour rate (replaces current active one).
   * @param {object} data - Rate data.
   * @param {number} data.value - Rate value (amount in currency).
   * @param {string} [data.description] - Rate description.
   * @param {string} [data.createdBy] - User ID who created the rate.
   * @returns {Promise<DriverTourRate>} Created rate object.
   * @example
   * const rate = await DriverTourRate.createDriverTourRate({
   *   value: 635.0,
   *   description: 'New driver tour rate',
   *   createdBy: user.id
   * });
   */
  static async createDriverTourRate(data) {
    try {
      // Validate required fields
      if (!data.value || Number.isNaN(Number(data.value)) || data.value <= 0) {
        throw new Error('Driver tour rate value must be a positive number');
      }

      // Validate value range (1 to 10000)
      if (!this.isValidValue(data.value)) {
        throw new Error('Driver tour rate value must be between 1.00 and 10000.00');
      }

      // Deactivate current active rate
      const currentRate = await this.getCurrentDriverTourRate();
      if (currentRate) {
        currentRate.set('active', false);
        await currentRate.save(null, { useMasterKey: true });
      }

      // Create new rate
      const driverTourRate = new DriverTourRate();
      driverTourRate.set('value', parseFloat(data.value));
      driverTourRate.set('description', data.description || '');
      driverTourRate.set('active', true);
      driverTourRate.set('exists', true);

      // Set creator if provided
      if (data.createdBy) {
        try {
          const userQuery = new Parse.Query(Parse.User);
          const creator = await userQuery.get(data.createdBy, { useMasterKey: true });
          driverTourRate.set('createdBy', creator);
        } catch (userError) {
          // If user not found, log warning but continue without setting creator
          logger.warn('User not found for driver tour rate creator', {
            userId: data.createdBy,
            error: userError.message,
          });
        }
      }

      const savedRate = await driverTourRate.save(null, { useMasterKey: true });

      logger.info('Driver tour rate created successfully', {
        rateId: savedRate.id,
        value: data.value,
        createdBy: data.createdBy,
        previousRateId: currentRate?.id,
      });

      return savedRate;
    } catch (error) {
      logger.error('Error creating driver tour rate:', error);
      throw error;
    }
  }

  /**
   * Get driver tour rate history with pagination.
   * @param {object} options - Query options.
   * @param {number} [options.page] - Page number.
   * @param {number} [options.limit] - Results per page.
   * @param {string} [options.sortBy] - Sort field.
   * @param {string} [options.sortOrder] - Sort order.
   * @param {string} [options.search] - Search term.
   * @returns {Promise<object>} Paginated results with data and pagination info.
   * @example
   * const history = await DriverTourRate.getHistory({
   *   page: 1,
   *   limit: 20,
   *   sortBy: 'createdAt',
   *   sortOrder: 'desc'
   * });
   */
  static async getHistory(options = {}) {
    try {
      const {
        page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc', search = '',
      } = options;

      const query = new Parse.Query('DriverTourRate');
      query.equalTo('exists', true);
      query.include('createdBy');

      // Apply search filter if provided
      if (search && search.trim()) {
        query.contains('description', search.trim());
      }

      // Apply sorting
      if (sortOrder === 'desc') {
        query.descending(sortBy);
      } else {
        query.ascending(sortBy);
      }

      // Get total count
      const totalQuery = new Parse.Query('DriverTourRate');
      totalQuery.equalTo('exists', true);
      if (search && search.trim()) {
        totalQuery.contains('description', search.trim());
      }
      const total = await totalQuery.count({ useMasterKey: true });

      // Apply pagination
      const skip = (page - 1) * limit;
      query.skip(skip);
      query.limit(limit);

      const data = await query.find({ useMasterKey: true });

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      logger.error('Error getting driver tour rate history:', error);
      throw error;
    }
  }

  /**
   * Get driver tour rate by ID.
   * @param {string} id - Rate ID.
   * @returns {Promise<DriverTourRate|null>} Rate object or null if not found.
   * @example
   * const rate = await DriverTourRate.getById('rateId123');
   * if (rate) console.log(rate.get('value'));
   */
  static async getById(id) {
    try {
      const query = new Parse.Query('DriverTourRate');
      query.include('createdBy');
      return await query.get(id, { useMasterKey: true });
    } catch (error) {
      if (error.code === Parse.Error.OBJECT_NOT_FOUND) {
        return null;
      }
      logger.error('Error getting driver tour rate by ID:', error);
      throw error;
    }
  }

  /**
   * Validate driver tour rate value range.
   * @param {number} value - Rate value to validate.
   * @returns {boolean} True if valid, false otherwise.
   * @example
   * const isValid = DriverTourRate.isValidValue(635.0); // true
   * const invalid = DriverTourRate.isValidValue(15000.0); // false
   */
  static isValidValue(value) {
    const numValue = parseFloat(value);
    return !Number.isNaN(numValue) && numValue >= 1.0 && numValue <= 10000.0;
  }

  /**
   * Format driver tour rate value for display.
   * @param {number} value - Rate value to format.
   * @returns {string} Formatted rate value.
   * @example
   * const formatted = DriverTourRate.formatValue(635.25); // "635.25"
   */
  static formatValue(value) {
    const numValue = parseFloat(value);
    if (Number.isNaN(numValue)) return '0.00';
    return numValue.toFixed(2);
  }

  /**
   * Soft delete driver tour rate.
   * @param {string} id - Rate ID.
   * @returns {Promise<boolean>} True if deleted successfully.
   * @example
   * const deleted = await DriverTourRate.softDelete('rateId123');
   */
  static async softDelete(id) {
    try {
      const rate = await this.getById(id);
      if (!rate) {
        throw new Error('Driver tour rate not found');
      }

      rate.set('exists', false);
      rate.set('active', false);
      await rate.save(null, { useMasterKey: true });

      logger.info('Driver tour rate soft deleted', {
        rateId: id,
        value: rate.get('value'),
      });

      return true;
    } catch (error) {
      logger.error('Error soft deleting driver tour rate:', error);
      throw error;
    }
  }

  /**
   * Get current driver tour rate for calculations.
   * @returns {Promise<number>} Current rate value or default.
   * @example
   * const currentRate = await DriverTourRate.getCurrentRate();
   * const totalCost = basePrice + currentRate;
   */
  static async getCurrentRate() {
    try {
      const current = await this.getCurrentDriverTourRate();
      return current ? current.get('value') : 635.0; // Default 635 MXN
    } catch (error) {
      logger.error('Error getting current driver tour rate value:', error);
      return 635.0; // Fallback to default
    }
  }

  /**
   * Create default driver tour rate if none exists.
   * @returns {Promise<DriverTourRate>} Created default rate or existing active rate.
   * @example
   */
  static async ensureDefaultRate() {
    try {
      const current = await this.getCurrentDriverTourRate();
      if (!current) {
        logger.info('Creating default driver tour rate of 635.00 MXN');
        return await this.createDriverTourRate({
          value: 635.0,
          description: 'Tarifa por defecto para tours con guía+chofer',
        });
      }
      return current;
    } catch (error) {
      logger.error('Error ensuring default driver tour rate:', error);
      throw error;
    }
  }
}

// Register the subclass
Parse.Object.registerSubclass('DriverTourRate', DriverTourRate);

module.exports = DriverTourRate;
