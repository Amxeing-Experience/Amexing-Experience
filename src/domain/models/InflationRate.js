const Parse = require('parse/node');

/**
 * InflationRate Model - Manages inflation rate adjustments for pricing calculations.
 *
 * Features:
 * - Automatic deactivation of previous rates when creating new ones
 * - Historical tracking of all rate changes
 * - Validation and formatting utilities
 * - Pagination support for DataTables.
 *
 * Created by Denisse Maldonado.
 */
class InflationRate {
  /**
   * Create a new inflation rate (deactivates previous active rate).
   * @param {object} data - Inflation rate data.
   * @param {number} data.value - Inflation rate percentage (e.g., 5.25).
   * @param {string} data.description - Optional description for the rate change.
   * @param {string} data.createdBy - User ID who created the rate.
   * @returns {Promise<Parse.Object>} - Created inflation rate object.
   * @example
   */
  static async createInflationRate(data) {
    try {
      // Validate value
      if (!data.value || Number.isNaN(Number(data.value)) || data.value <= 0) {
        throw new Error('Inflation rate value must be a positive number');
      }

      // Validate value range (0.01% to 50.00%)
      if (!this.isValidValue(data.value)) {
        throw new Error('Inflation rate value must be between 0.01 and 50.00');
      }

      // Deactivate current active rate
      const activeRateQuery = new Parse.Query('InflationRate');
      activeRateQuery.equalTo('active', true);
      activeRateQuery.equalTo('exists', true);

      const activeRates = await activeRateQuery.find({ useMasterKey: true });

      // Deactivate all currently active rates
      for (const rate of activeRates) {
        rate.set('active', false);
        await rate.save(null, { useMasterKey: true });
      }

      // Create new inflation rate
      const InflationRateClass = Parse.Object.extend('InflationRate');
      const newRate = new InflationRateClass();

      newRate.set('value', parseFloat(data.value));
      newRate.set('description', data.description || '');
      newRate.set('active', true);
      newRate.set('exists', true);

      if (data.createdBy) {
        const userPointer = new Parse.User();
        userPointer.id = data.createdBy;
        newRate.set('createdBy', userPointer);
      }

      const savedRate = await newRate.save(null, { useMasterKey: true });
      return savedRate;
    } catch (error) {
      console.error('Error creating inflation rate:', error);
      throw error;
    }
  }

  /**
   * Get current active inflation rate.
   * @returns {Promise<Parse.Object|null>} - Current active inflation rate.
   * @example
   */
  static async getCurrentInflationRate() {
    try {
      const query = new Parse.Query('InflationRate');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.descending('createdAt');
      query.include('createdBy');

      const currentRate = await query.first({ useMasterKey: true });
      return currentRate;
    } catch (error) {
      console.error('Error getting current inflation rate:', error);
      throw error;
    }
  }

  /**
   * Get inflation rate by ID.
   * @param {string} id - Rate ID.
   * @returns {Promise<Parse.Object|null>} - Inflation rate object.
   * @example
   */
  static async getById(id) {
    try {
      const query = new Parse.Query('InflationRate');
      query.equalTo('exists', true);
      query.include('createdBy');

      const rate = await query.get(id, { useMasterKey: true });
      return rate;
    } catch (error) {
      console.error('Error getting inflation rate by ID:', error);
      return null;
    }
  }

  /**
   * Get inflation rate history with pagination.
   * @param {object} options - Query options.
   * @param {number} options.page - Page number (1-based).
   * @param {number} options.limit - Records per page.
   * @param {string} options.sortBy - Field to sort by.
   * @param {string} options.sortOrder - Sort order (asc/desc).
   * @param {string} options.search - Search term.
   * @returns {Promise<object>} - Paginated results with data and pagination info.
   * @example
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

      const query = new Parse.Query('InflationRate');
      query.equalTo('exists', true);
      query.include('createdBy');

      // Apply search filter
      if (search) {
        query.contains('description', search);
      }

      // Apply sorting
      if (sortOrder === 'desc') {
        query.descending(sortBy);
      } else {
        query.ascending(sortBy);
      }

      // Get total count
      const totalQuery = new Parse.Query('InflationRate');
      totalQuery.equalTo('exists', true);
      if (search) {
        totalQuery.contains('description', search);
      }
      const total = await totalQuery.count({ useMasterKey: true });

      // Apply pagination
      const skip = (page - 1) * limit;
      query.skip(skip);
      query.limit(limit);

      const results = await query.find({ useMasterKey: true });

      return {
        data: results,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      console.error('Error getting inflation rate history:', error);
      throw error;
    }
  }

  /**
   * Format inflation rate value for display.
   * @param {number} value - Raw inflation rate value.
   * @returns {string} - Formatted value (e.g., "5.25").
   * @example
   */
  static formatValue(value) {
    if (!value || Number.isNaN(Number(value))) {
      return '0.00';
    }
    return parseFloat(value).toFixed(2);
  }

  /**
   * Validate inflation rate value range.
   * @param {number} value - Inflation rate percentage to validate.
   * @returns {boolean} - True if valid, false otherwise.
   * @example
   */
  static isValidValue(value) {
    return !Number.isNaN(Number(value)) && value > 0 && value <= 50; // 0.01% to 50.00%
  }
}

module.exports = InflationRate;
