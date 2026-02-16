/**
 * GuideTransportRate Parse Object Model
 * Manages guide pricing rates for transportation services
 * Created by Denisse Maldonado.
 */

const Parse = require('parse/node');

/**
 * GuideTransportRate class for managing guide transport pricing.
 */
class GuideTransportRate extends Parse.Object {
  constructor() {
    super('GuideTransportRate');
  }

  /**
   * Get current active guide transport rate.
   * @returns {Promise<GuideTransportRate|null>} Current rate or null.
   * @example
   * const currentRate = await GuideTransportRate.getCurrentRate();
   */
  static async getCurrentRate() {
    try {
      const query = new Parse.Query(GuideTransportRate);
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.descending('effectiveDate');
      query.limit(1);

      const result = await query.first({ useMasterKey: true });
      return result;
    } catch (error) {
      // Use logger instead of console for production
      const logger = require('../../infrastructure/logger');
      logger.error('Error getting current guide transport rate:', error);
      return null;
    }
  }

  /**
   * Create a new guide transport rate.
   * @param {number} value - Rate value in MXN.
   * @param {Date} effectiveDate - When the rate becomes effective.
   * @param {Parse.User} createdBy - User creating the rate.
   * @param {string} notes - Optional notes.
   * @returns {Promise<GuideTransportRate>} Created rate.
   * @example
   * const rate = await GuideTransportRate.createRate(450, new Date(), user, 'New rate');
   */
  static async createRate(value, effectiveDate, createdBy, notes = '') {
    try {
      // Deactivate any existing active rates
      const activeRatesQuery = new Parse.Query(GuideTransportRate);
      activeRatesQuery.equalTo('active', true);
      activeRatesQuery.equalTo('exists', true);

      const activeRates = await activeRatesQuery.find({ useMasterKey: true });

      // Set all existing rates to inactive using Promise.all for better performance
      const deactivatePromises = activeRates.map((rate) => {
        rate.set('active', false);
        return rate.save(null, { useMasterKey: true });
      });
      await Promise.all(deactivatePromises);

      // Create new rate
      const newRate = new GuideTransportRate();
      newRate.set('value', parseFloat(value));
      newRate.set('effectiveDate', new Date(effectiveDate));
      newRate.set('notes', notes || '');
      newRate.set('active', true);
      newRate.set('exists', true);
      newRate.set('createdBy', createdBy);

      const savedRate = await newRate.save(null, { useMasterKey: true });
      return savedRate;
    } catch (error) {
      // Use logger instead of console for production
      const logger = require('../../infrastructure/logger');
      logger.error('Error creating guide transport rate:', error);
      throw error;
    }
  }

  /**
   * Get rate history with pagination.
   * @param {number} page - Page number (0-based).
   * @param {number} limit - Number of items per page.
   * @returns {Promise<{data: Array, total: number}>} Paginated results.
   * @example
   * const history = await GuideTransportRate.getHistory(0, 10);
   */
  static async getHistory(page = 0, limit = 10) {
    try {
      const query = new Parse.Query(GuideTransportRate);
      query.equalTo('exists', true);
      query.descending('effectiveDate');
      query.include('createdBy');
      query.skip(page * limit);
      query.limit(limit);

      const results = await query.find({ useMasterKey: true });

      // Get total count
      const countQuery = new Parse.Query(GuideTransportRate);
      countQuery.equalTo('exists', true);
      const total = await countQuery.count({ useMasterKey: true });

      return {
        data: results,
        total,
      };
    } catch (error) {
      // Use logger instead of console for production
      const logger = require('../../infrastructure/logger');
      logger.error('Error getting guide transport rate history:', error);
      throw error;
    }
  }

  /**
   * Create default rate if none exists.
   * @returns {Promise<GuideTransportRate|null>} Created default rate or null if already exists.
   * @example
   * const defaultRate = await GuideTransportRate.createDefaultIfNotExists();
   */
  static async createDefaultIfNotExists() {
    try {
      const currentRate = await GuideTransportRate.getCurrentRate();

      if (!currentRate) {
        // Create default rate of 400 MXN
        const defaultUser = await new Parse.Query(Parse.User)
          .equalTo('username', 'system')
          .first({ useMasterKey: true }) || null;

        const defaultRate = await GuideTransportRate.createRate(
          400.00,
          new Date(),
          defaultUser,
          'Tarifa por defecto creada automáticamente'
        );

        // Use logger instead of console for production
        const logger = require('../../infrastructure/logger');
        logger.info('✅ Default guide transport rate created:', { value: 400, currency: 'MXN' });
        return defaultRate;
      }

      return null;
    } catch (error) {
      // Use logger instead of console for production
      const logger = require('../../infrastructure/logger');
      logger.error('Error creating default guide transport rate:', error);
      throw error;
    }
  }

  /**
   * Format rate value for display.
   * @returns {string} Formatted rate.
   * @example
   * const formattedValue = rate.getFormattedValue(); // "$400.00 MXN"
   */
  getFormattedValue() {
    const value = this.get('value') || 0;
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
    }).format(value);
  }
}

// Register the subclass
Parse.Object.registerSubclass('GuideTransportRate', GuideTransportRate);

module.exports = GuideTransportRate;
