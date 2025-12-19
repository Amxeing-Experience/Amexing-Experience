const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');

/**
 * AgencyRate Domain Model.
 *
 * Manages agency commission rates within the system.
 * Handles CRUD operations, validation, and business logic for agency rates.
 * Supports active/inactive states and maintains rate history.
 *
 * Created by Denisse Maldonado.
 */
class AgencyRate extends Parse.Object {
  constructor() {
    super('AgencyRate');
  }

  /**
   * Get current active agency rate.
   * @returns {Promise<AgencyRate|null>} Current active rate or null if none exists.
   * @example
   * const current = await AgencyRate.getCurrentAgencyRate();
   * console.log(current ? current.get('value') : 'No rate found');
   */
  static async getCurrentAgencyRate() {
    try {
      const query = new Parse.Query('AgencyRate');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.descending('createdAt');
      query.include('createdBy');

      return await query.first({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting current agency rate:', error);
      throw error;
    }
  }

  /**
   * Create new agency rate (replaces current active one).
   * @param {object} data - Rate data.
   * @param {number} data.value - Rate value (percentage).
   * @param {string} [data.description] - Rate description.
   * @param {string} [data.createdBy] - User ID who created the rate.
   * @returns {Promise<AgencyRate>} Created rate object.
   * @example
   * const rate = await AgencyRate.createAgencyRate({
   *   value: 15.0,
   *   description: 'New agency commission rate',
   *   createdBy: user.id
   * });
   */
  static async createAgencyRate(data) {
    try {
      // Validate required fields
      if (!data.value || Number.isNaN(Number(data.value)) || data.value <= 0) {
        throw new Error('Agency rate value must be a positive number');
      }

      // Validate value range (0.01% to 50.00%)
      if (!this.isValidValue(data.value)) {
        throw new Error('Agency rate value must be between 0.01 and 50.00');
      }

      // Deactivate current active rate
      const currentRate = await this.getCurrentAgencyRate();
      if (currentRate) {
        currentRate.set('active', false);
        await currentRate.save(null, { useMasterKey: true });
      }

      // Create new rate
      const agencyRate = new AgencyRate();
      agencyRate.set('value', parseFloat(data.value));
      agencyRate.set('description', data.description || '');
      agencyRate.set('active', true);
      agencyRate.set('exists', true);

      // Set creator if provided
      if (data.createdBy) {
        try {
          const userQuery = new Parse.Query(Parse.User);
          const creator = await userQuery.get(data.createdBy, { useMasterKey: true });
          agencyRate.set('createdBy', creator);
        } catch (userError) {
          // If user not found, log warning but continue without setting creator
          logger.warn('User not found for agency rate creator', {
            userId: data.createdBy,
            error: userError.message,
          });
        }
      }

      const savedRate = await agencyRate.save(null, { useMasterKey: true });

      logger.info('Agency rate created successfully', {
        rateId: savedRate.id,
        value: data.value,
        createdBy: data.createdBy,
        previousRateId: currentRate?.id,
      });

      return savedRate;
    } catch (error) {
      logger.error('Error creating agency rate:', error);
      throw error;
    }
  }

  /**
   * Get agency rate history with pagination.
   * @param {object} options - Query options.
   * @param {number} [options.page] - Page number.
   * @param {number} [options.limit] - Results per page.
   * @param {string} [options.sortBy] - Sort field.
   * @param {string} [options.sortOrder] - Sort order.
   * @param {string} [options.search] - Search term.
   * @returns {Promise<object>} Paginated results with data and pagination info.
   * @example
   * const history = await AgencyRate.getHistory({
   *   page: 1,
   *   limit: 20,
   *   sortBy: 'createdAt',
   *   sortOrder: 'desc'
   * });
   */
  static async getHistory(options = {}) {
    try {
      const {
        page = 1,
        limit = 10,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        search = '',
      } = options;

      const query = new Parse.Query('AgencyRate');
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
      const totalQuery = new Parse.Query('AgencyRate');
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
      logger.error('Error getting agency rate history:', error);
      throw error;
    }
  }

  /**
   * Get agency rate by ID.
   * @param {string} id - Rate ID.
   * @returns {Promise<AgencyRate|null>} Rate object or null if not found.
   * @example
   * const rate = await AgencyRate.getById('rateId123');
   * if (rate) console.log(rate.get('value'));
   */
  static async getById(id) {
    try {
      const query = new Parse.Query('AgencyRate');
      query.include('createdBy');
      return await query.get(id, { useMasterKey: true });
    } catch (error) {
      if (error.code === Parse.Error.OBJECT_NOT_FOUND) {
        return null;
      }
      logger.error('Error getting agency rate by ID:', error);
      throw error;
    }
  }

  /**
   * Validate agency rate value range.
   * @param {number} value - Rate value to validate.
   * @returns {boolean} True if valid, false otherwise.
   * @example
   * const isValid = AgencyRate.isValidValue(15.5); // true
   * const invalid = AgencyRate.isValidValue(75.0); // false
   */
  static isValidValue(value) {
    const numValue = parseFloat(value);
    return !Number.isNaN(numValue) && numValue >= 0.01 && numValue <= 50.0;
  }

  /**
   * Format agency rate value for display.
   * @param {number} value - Rate value to format.
   * @returns {string} Formatted rate value.
   * @example
   * const formatted = AgencyRate.formatValue(15.25); // "15.25"
   */
  static formatValue(value) {
    const numValue = parseFloat(value);
    if (Number.isNaN(numValue)) return '0.00';
    return numValue.toFixed(2);
  }

  /**
   * Soft delete agency rate.
   * @param {string} id - Rate ID.
   * @returns {Promise<boolean>} True if deleted successfully.
   * @example
   * const deleted = await AgencyRate.softDelete('rateId123');
   */
  static async softDelete(id) {
    try {
      const rate = await this.getById(id);
      if (!rate) {
        throw new Error('Agency rate not found');
      }

      rate.set('exists', false);
      rate.set('active', false);
      await rate.save(null, { useMasterKey: true });

      logger.info('Agency rate soft deleted', {
        rateId: id,
        value: rate.get('value'),
      });

      return true;
    } catch (error) {
      logger.error('Error soft deleting agency rate:', error);
      throw error;
    }
  }

  /**
   * Get current agency rate for calculations.
   * @returns {Promise<number>} Current rate value or default.
   * @example
   * const currentRate = await AgencyRate.getCurrentRate();
   * const commission = amount * (currentRate / 100);
   */
  static async getCurrentRate() {
    try {
      const current = await this.getCurrentAgencyRate();
      return current ? current.get('value') : 15.0; // Default 15% commission
    } catch (error) {
      logger.error('Error getting current agency rate value:', error);
      return 15.0; // Fallback to default
    }
  }
}

// Register the subclass
Parse.Object.registerSubclass('AgencyRate', AgencyRate);

module.exports = AgencyRate;
