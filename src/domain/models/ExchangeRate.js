const Parse = require('parse/node');
const { TtlCache } = require('../../infrastructure/cache/ttlCache');

// Caché del registro "actual" (cambia rara vez, se consulta en cada carga de cotización).
// Se invalida al crear un nuevo tipo de cambio. Ver ttlCache.js.
const currentRateCache = new TtlCache();

/**
 * ExchangeRate Model.
 *
 * Manages exchange rate values and history tracking for price calculations.
 * Each record represents a specific exchange rate value with activation status.
 *
 * Created by Denisse Maldonado.
 */
class ExchangeRate extends Parse.Object {
  constructor(attributes) {
    super('ExchangeRate', attributes);
  }

  /**
   * Create a new exchange rate record.
   * @param {object} params - Exchange rate parameters.
   * @param {number} params.value - Exchange rate value.
   * @param {string} [params.description] - Optional description for the change.
   * @param {string} [params.createdBy] - User ID who created this rate.
   * @returns {Promise<ExchangeRate>} Created exchange rate.
   * @example
   */
  static async createExchangeRate({ value, description = '', createdBy = null }) {
    try {
      // Validate value
      if (!value || Number.isNaN(Number(value)) || value <= 0) {
        throw new Error('Exchange rate value must be a positive number');
      }

      // Deactivate current active exchange rate
      const currentActive = await this.getCurrentExchangeRate();
      if (currentActive) {
        currentActive.set('active', false);
        await currentActive.save(null, { useMasterKey: true });
      }

      // Create new exchange rate
      const exchangeRate = new ExchangeRate();
      exchangeRate.set('value', parseFloat(value));
      exchangeRate.set('description', description);
      exchangeRate.set('active', true);
      exchangeRate.set('exists', true);
      exchangeRate.set('createdAt', new Date());

      if (createdBy) {
        exchangeRate.set('createdBy', createdBy);
      }

      const savedRate = await exchangeRate.save(null, { useMasterKey: true });
      currentRateCache.clear(); // el "actual" cambió -> invalidar caché
      return savedRate;
    } catch (error) {
      throw new Error(`Failed to create exchange rate: ${error.message}`);
    }
  }

  /**
   * Get the current active exchange rate.
   * @returns {Promise<ExchangeRate|null>} Current active exchange rate.
   * @example
   */
  static async getCurrentExchangeRate() {
    try {
      const cached = currentRateCache.get();
      if (cached !== undefined) return cached;

      const query = new Parse.Query(ExchangeRate);
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.descending('createdAt');
      query.limit(1);

      const result = await query.first({ useMasterKey: true });
      return currentRateCache.set(result || null);
    } catch (error) {
      console.error('Error getting current exchange rate:', error);
      return null;
    }
  }

  /**
   * Get current exchange rate value.
   * @returns {Promise<number>} Current exchange rate value.
   * @example
   */
  static async getCurrentValue() {
    try {
      const current = await this.getCurrentExchangeRate();
      return current ? current.get('value') : 18.5; // Default fallback
    } catch (error) {
      console.error('Error getting current exchange rate value:', error);
      return 18.5; // Default fallback
    }
  }

  /**
   * Get exchange rate history with pagination.
   * @param {object} options - Query options.
   * @param {number} [options.page] - Page number.
   * @param {number} [options.limit] - Records per page.
   * @param {string} [options.sortBy] - Sort field.
   * @param {string} [options.sortOrder] - Sort order.
   * @returns {Promise<object>} Paginated results.
   * @example
   */
  static async getHistory(options = {}) {
    try {
      const {
        page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc',
      } = options;

      const query = new Parse.Query(ExchangeRate);
      query.equalTo('exists', true);

      // Apply sorting
      if (sortOrder === 'desc') {
        query.descending(sortBy);
      } else {
        query.ascending(sortBy);
      }

      // Apply pagination
      query.skip((page - 1) * limit);
      query.limit(limit);

      // Include user who created the rate
      query.include('createdBy');

      const [results, total] = await Promise.all([
        query.find({ useMasterKey: true }),
        query.count({ useMasterKey: true }),
      ]);

      return {
        data: results,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      throw new Error(`Failed to get exchange rate history: ${error.message}`);
    }
  }

  /**
   * Update current exchange rate.
   * @param {object} params - Update parameters.
   * @param {number} params.value - New exchange rate value.
   * @param {string} [params.description] - Description for the change.
   * @param {string} [params.updatedBy] - User ID who updated the rate.
   * @returns {Promise<ExchangeRate>} Updated exchange rate.
   * @example
   */
  static async updateCurrentExchangeRate({ value, description = '', updatedBy = null }) {
    try {
      // Create new record instead of updating (for history tracking)
      return await this.createExchangeRate({ value, description, createdBy: updatedBy });
    } catch (error) {
      throw new Error(`Failed to update exchange rate: ${error.message}`);
    }
  }

  /**
   * Get exchange rate by ID.
   * @param {string} rateId - Exchange rate ID.
   * @returns {Promise<ExchangeRate|null>} Exchange rate record.
   * @example
   */
  static async getById(rateId) {
    try {
      const query = new Parse.Query(ExchangeRate);
      query.equalTo('exists', true);
      query.include('createdBy');

      const result = await query.get(rateId, { useMasterKey: true });
      return result;
    } catch (error) {
      console.error(`Error getting exchange rate ${rateId}:`, error);
      return null;
    }
  }

  /**
   * Format exchange rate value for display.
   * @param {number} value - Exchange rate value.
   * @returns {string} Formatted value.
   * @example
   */
  static formatValue(value) {
    return parseFloat(value).toFixed(2);
  }

  /**
   * Validate exchange rate value.
   * @param {number} value - Value to validate.
   * @returns {boolean} Is valid.
   * @example
   */
  static isValidValue(value) {
    return !Number.isNaN(Number(value)) && value > 0 && value < 1000; // Reasonable bounds
  }
}

// Register the class
Parse.Object.registerSubclass('ExchangeRate', ExchangeRate);

module.exports = ExchangeRate;
