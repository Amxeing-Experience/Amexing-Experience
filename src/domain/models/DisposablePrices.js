/**
 * DisposablePrices - Domain model for hourly vehicle rental pricing (A Disposición).
 *
 * Manages hourly rate pricing for vehicle rental services with historical tracking.
 * Similar to RatePrices but specifically designed for hourly rental calculations.
 *
 * Database Structure:
 * - vehicleType: Vehicle type object (required)
 * - rate: Rate object (required for historical tracking)
 * - hourlyPrice: Hourly rental price (required)
 * - currency: Currency code (default: MXN)
 * - active: Boolean for availability
 * - exists: Boolean for logical deletion
 * - effectiveDate: Date when the price becomes effective
 * - endDate: Date when the price stops being effective (null for current).
 *
 * Lifecycle States:
 * - active: true, exists: true = Available for pricing calculations
 * - active: false, exists: true = Hidden but preserved for historical pricing
 * - active: false, exists: false = Soft deleted (audit trail only).
 * @augments BaseModel
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Create new disposable price
 * const disposablePrice = new DisposablePrices();
 * disposablePrice.setVehicleType(vehicleTypePointer);
 * disposablePrice.setRate(ratePointer);
 * disposablePrice.setHourlyPrice(500.00);
 * disposablePrice.setCurrency('MXN');
 * disposablePrice.setEffectiveDate(new Date());
 * await disposablePrice.save();
 *
 * // Query current disposable prices
 * const currentPrices = await DisposablePrices.getCurrentPrices();
 *
 * // Get price for specific vehicle type
 * const price = await DisposablePrices.getPriceByVehicleType('vehicleTypeId');
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * DisposablePrices class for managing hourly rental pricing catalog.
 * @class DisposablePrices
 * @augments BaseModel
 */
class DisposablePrices extends BaseModel {
  /**
   * Create a DisposablePrices instance.
   * @example
   * // Usage example documented above
   */
  constructor() {
    super('DisposablePrices');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get vehicle type.
   * @returns {object} Vehicle type Parse object.
   * @example
   * // Usage example documented above
   */
  getVehicleType() {
    return this.get('vehicleType');
  }

  /**
   * Set vehicle type.
   * @param {object} vehicleType - Vehicle type Parse object or Pointer.
   * @example
   * // Usage example documented above
   */
  setVehicleType(vehicleType) {
    this.set('vehicleType', vehicleType);
  }

  /**
   * Get rate.
   * @returns {object} Rate Parse object.
   * @example
   * // Usage example documented above
   */
  getRate() {
    return this.get('rate');
  }

  /**
   * Set rate.
   * @param {object} rate - Rate Parse object or Pointer.
   * @example
   * // Usage example documented above
   */
  setRate(rate) {
    this.set('rate', rate);
  }

  /**
   * Get hourly price.
   * @returns {number} Hourly price amount.
   * @example
   * // Usage example documented above
   */
  getHourlyPrice() {
    return this.get('hourlyPrice') || 0;
  }

  /**
   * Set hourly price.
   * @param {number} price - Hourly price amount.
   * @example
   * // Usage example documented above
   */
  setHourlyPrice(price) {
    this.set('hourlyPrice', parseFloat(price));
  }

  /**
   * Get currency.
   * @returns {string} Currency code (e.g., 'MXN', 'USD').
   * @example
   * // Usage example documented above
   */
  getCurrency() {
    return this.get('currency') || 'MXN';
  }

  /**
   * Set currency.
   * @param {string} currency - Currency code.
   * @example
   * // Usage example documented above
   */
  setCurrency(currency) {
    this.set('currency', currency.toUpperCase());
  }

  /**
   * Get effective date.
   * @returns {Date} Date when the price becomes effective.
   * @example
   * // Usage example documented above
   */
  getEffectiveDate() {
    return this.get('effectiveDate');
  }

  /**
   * Set effective date.
   * @param {Date} date - Effective date.
   * @example
   * // Usage example documented above
   */
  setEffectiveDate(date) {
    this.set('effectiveDate', date);
  }

  /**
   * Get end date.
   * @returns {Date} Date when the price stops being effective (null for current).
   * @example
   * // Usage example documented above
   */
  getEndDate() {
    return this.get('endDate');
  }

  /**
   * Set end date.
   * @param {Date} date - End date.
   * @example
   * // Usage example documented above
   */
  setEndDate(date) {
    this.set('endDate', date);
  }

  /**
   * Check if price is currently effective.
   * @returns {boolean} True if price is currently effective.
   * @example
   * // Usage example documented above
   */
  isCurrentlyEffective() {
    const now = new Date();
    const effectiveDate = this.getEffectiveDate();
    const endDate = this.getEndDate();

    if (!effectiveDate || effectiveDate > now) {
      return false;
    }

    if (endDate && endDate <= now) {
      return false;
    }

    return true;
  }

  /**
   * Get formatted hourly price with currency.
   * @returns {string} Formatted price (e.g., "$500.00 MXN").
   * @example
   * // Usage example documented above
   */
  getFormattedPrice() {
    const price = this.getHourlyPrice();
    const currency = this.getCurrency();

    const formatOptions = {
      style: 'currency',
      currency,
    };

    // Use appropriate locale for currency
    let locale = 'en-US';
    if (currency === 'MXN') {
      locale = 'es-MX';
    }

    return new Intl.NumberFormat(locale, formatOptions).format(price);
  }

  // =================
  // VALIDATION
  // =================

  /**
   * Validate disposable price data before save.
   * @returns {object} Validation result { isValid, errors[] }.
   * @example
   * // Usage example documented above
   */
  validate() {
    const errors = [];

    // Vehicle type validation (required)
    if (!this.getVehicleType()) {
      errors.push('Vehicle type is required');
    }

    // Rate validation (required for historical tracking)
    if (!this.getRate()) {
      errors.push('Rate is required for historical tracking');
    }

    // Hourly price validation
    const hourlyPrice = this.getHourlyPrice();
    if (!hourlyPrice || hourlyPrice <= 0) {
      errors.push('Hourly price must be greater than 0');
    }

    // Currency validation
    const currency = this.getCurrency();
    const validCurrencies = ['MXN', 'USD', 'EUR'];
    if (!validCurrencies.includes(currency)) {
      errors.push(`Currency must be one of: ${validCurrencies.join(', ')}`);
    }

    // Effective date validation
    if (!this.getEffectiveDate()) {
      errors.push('Effective date is required');
    }

    // Date logic validation
    const effectiveDate = this.getEffectiveDate();
    const endDate = this.getEndDate();
    if (effectiveDate && endDate && endDate <= effectiveDate) {
      errors.push('End date must be after effective date');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // =================
  // STATIC METHODS
  // =================

  /**
   * Get current effective disposable prices for all vehicle types.
   * @returns {Promise<Array>} Array of DisposablePrices objects.
   * @example
   * // Usage example documented above
   */
  static async getCurrentPrices() {
    try {
      const query = new Parse.Query('DisposablePrices');
      query.equalTo('exists', true);
      query.equalTo('active', true);

      // Only current prices (no end date or end date in future)
      const now = new Date();
      query.lessThanOrEqualTo('effectiveDate', now);

      // Create compound query for end date logic
      const noEndDateQuery = new Parse.Query('DisposablePrices');
      noEndDateQuery.doesNotExist('endDate');

      const futureEndDateQuery = new Parse.Query('DisposablePrices');
      futureEndDateQuery.greaterThan('endDate', now);

      const endDateQuery = Parse.Query.or(noEndDateQuery, futureEndDateQuery);

      // Combine queries
      const finalQuery = Parse.Query.and(query, endDateQuery);
      finalQuery.include(['vehicleType', 'rate']);
      finalQuery.ascending('vehicleType'); // Sort by vehicle type
      finalQuery.ascending('rate'); // Then by rate

      const results = await finalQuery.find({ useMasterKey: true });

      // Return all prices for admin management (not grouped)
      return results;
    } catch (error) {
      logger.error('Error getting current disposable prices', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get current effective disposable prices grouped by vehicle type (one per vehicle).
   * @returns {Promise<Array>} Array of DisposablePrices objects grouped by vehicle type.
   * @example
   * // Usage example documented above
   */
  static async getCurrentPricesGrouped() {
    try {
      const allPrices = await this.getCurrentPrices();

      // Group by vehicle type and return most recent for each
      const pricesByVehicleType = new Map();
      allPrices.forEach((price) => {
        const vehicleType = price.get('vehicleType');
        if (vehicleType) {
          const vehicleTypeId = vehicleType.id;
          if (!pricesByVehicleType.has(vehicleTypeId)) {
            pricesByVehicleType.set(vehicleTypeId, price);
          }
        }
      });

      return Array.from(pricesByVehicleType.values());
    } catch (error) {
      logger.error('Error getting grouped current disposable prices', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get all disposable prices for admin management (including logically deleted ones).
   * @returns {Promise<Array>} Array of all DisposablePrices objects.
   * @example
   * // Usage example documented above
   */
  static async getAllPricesForManagement() {
    try {
      const query = new Parse.Query('DisposablePrices');
      // Don't filter by exists - show all records for admin management
      query.equalTo('active', true);

      // Only current prices (no end date or end date in future)
      const now = new Date();
      query.lessThanOrEqualTo('effectiveDate', now);

      // Create compound query for end date logic
      const noEndDateQuery = new Parse.Query('DisposablePrices');
      noEndDateQuery.doesNotExist('endDate');

      const futureEndDateQuery = new Parse.Query('DisposablePrices');
      futureEndDateQuery.greaterThan('endDate', now);

      const endDateQuery = Parse.Query.or(noEndDateQuery, futureEndDateQuery);

      // Combine queries
      const finalQuery = Parse.Query.and(query, endDateQuery);
      finalQuery.include(['vehicleType', 'rate']);
      finalQuery.ascending('vehicleType'); // Sort by vehicle type
      finalQuery.ascending('rate'); // Then by rate

      const results = await finalQuery.find({ useMasterKey: true });

      return results;
    } catch (error) {
      logger.error('Error getting all disposable prices for management', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get disposable price for specific vehicle type.
   * @param {string} vehicleTypeId - Vehicle type ID.
   * @returns {Promise<DisposablePrices>} Current DisposablePrices instance or null.
   * @example
   * // Usage example documented above
   */
  static async getPriceByVehicleType(vehicleTypeId) {
    try {
      const query = new Parse.Query('DisposablePrices');
      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.equalTo('vehicleType', {
        __type: 'Pointer',
        className: 'VehicleType',
        objectId: vehicleTypeId,
      });

      // Only current prices
      const now = new Date();
      query.lessThanOrEqualTo('effectiveDate', now);

      // Create compound query for end date logic
      const noEndDateQuery = new Parse.Query('DisposablePrices');
      noEndDateQuery.doesNotExist('endDate');

      const futureEndDateQuery = new Parse.Query('DisposablePrices');
      futureEndDateQuery.greaterThan('endDate', now);

      const endDateQuery = Parse.Query.or(noEndDateQuery, futureEndDateQuery);

      // Combine queries
      const finalQuery = Parse.Query.and(query, endDateQuery);
      finalQuery.include(['vehicleType', 'rate']);
      finalQuery.descending('effectiveDate'); // Most recent first

      return await finalQuery.first({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting disposable price by vehicle type', {
        vehicleTypeId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get price history for specific vehicle type.
   * @param {string} vehicleTypeId - Vehicle type ID.
   * @returns {Promise<Array>} Array of DisposablePrices objects ordered by date.
   * @example
   * // Usage example documented above
   */
  static async getPriceHistoryByVehicleType(vehicleTypeId) {
    try {
      const query = new Parse.Query('DisposablePrices');
      query.equalTo('exists', true);
      query.equalTo('vehicleType', {
        __type: 'Pointer',
        className: 'VehicleType',
        objectId: vehicleTypeId,
      });
      query.include(['vehicleType', 'rate']);
      query.descending('effectiveDate');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting disposable price history by vehicle type', {
        vehicleTypeId,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Update an existing disposable price by ID.
   * @param {string} priceId - ID of the price to update.
   * @param {object} data - Update data (hourlyPrice, etc.).
   * @returns {Promise<Parse.Object|null>} - Updated price or null if not found.
   * @example
   */
  static async updatePriceById(priceId, data) {
    try {
      const query = new Parse.Query('DisposablePrices');
      query.equalTo('objectId', priceId);
      query.include('vehicleType');
      query.include('rate');

      const price = await query.first({ useMasterKey: true });

      if (!price) {
        logger.warn('DisposablePrices not found for update', { priceId });
        return null;
      }

      // Update fields
      if (data.hourlyPrice !== undefined) {
        price.set('hourlyPrice', parseFloat(data.hourlyPrice));
      }

      if (data.currency) {
        price.set('currency', data.currency);
      }

      // Save the updated price
      const updatedPrice = await price.save(null, { useMasterKey: true });

      logger.info('DisposablePrices updated', {
        priceId: updatedPrice.id,
        vehicleType: updatedPrice.get('vehicleType')?.get('name'),
        rate: updatedPrice.get('rate')?.get('name'),
        hourlyPrice: updatedPrice.get('hourlyPrice'),
      });

      return updatedPrice;
    } catch (error) {
      logger.error('Error updating disposable price', {
        priceId,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Create new disposable price (with history tracking).
   * @param {object} params - Price parameters.
   * @param {string} params.vehicleTypeId - Vehicle type ID.
   * @param {string} params.rateId - Rate ID.
   * @param {number} params.hourlyPrice - Hourly price amount.
   * @param {string} params.currency - Currency code (default: 'MXN').
   * @param {Date} params.effectiveDate - Effective date (default: now).
   * @returns {Promise<DisposablePrices>} Created DisposablePrices instance.
   * @example
   * // Usage example documented above
   */
  static async createPrice(params) {
    try {
      const {
        vehicleTypeId, rateId, hourlyPrice, currency = 'MXN', effectiveDate = new Date(),
      } = params;

      // End any current active price for this vehicle type
      const currentPrice = await this.getPriceByVehicleType(vehicleTypeId);
      if (currentPrice && !currentPrice.getEndDate()) {
        currentPrice.setEndDate(effectiveDate);
        await currentPrice.save(null, { useMasterKey: true });
      }

      // Create new price
      const disposablePrice = new DisposablePrices();

      disposablePrice.setVehicleType({
        __type: 'Pointer',
        className: 'VehicleType',
        objectId: vehicleTypeId,
      });

      disposablePrice.setRate({
        __type: 'Pointer',
        className: 'Rate',
        objectId: rateId,
      });

      disposablePrice.setHourlyPrice(hourlyPrice);
      disposablePrice.setCurrency(currency);
      disposablePrice.setEffectiveDate(effectiveDate);
      disposablePrice.set('active', true);
      disposablePrice.set('exists', true);

      // Validate before saving
      const validation = disposablePrice.validate();
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      await disposablePrice.save(null, { useMasterKey: true });
      return disposablePrice;
    } catch (error) {
      logger.error('Error creating disposable price', {
        params,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Update disposable price (creates new record for history).
   * @param {string} vehicleTypeId - Vehicle type ID.
   * @param {number} newHourlyPrice - New hourly price.
   * @param {string} rateId - Rate ID for tracking.
   * @param {Date} effectiveDate - When the new price becomes effective (default: now).
   * @returns {Promise<DisposablePrices>} New DisposablePrices instance.
   * @example
   * // Usage example documented above
   */
  static async updatePrice(vehicleTypeId, newHourlyPrice, rateId, effectiveDate = new Date()) {
    try {
      const currentPrice = await this.getPriceByVehicleType(vehicleTypeId);

      if (!currentPrice) {
        throw new Error('No current price found for vehicle type');
      }

      return await this.createPrice({
        vehicleTypeId,
        rateId,
        hourlyPrice: newHourlyPrice,
        currency: currentPrice.getCurrency(),
        effectiveDate,
      });
    } catch (error) {
      logger.error('Error updating disposable price', {
        vehicleTypeId,
        newHourlyPrice,
        rateId,
        effectiveDate,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get all disposable prices by rate (for inflation/rate change operations).
   * @param {string} rateId - Rate ID.
   * @returns {Promise<Array>} Array of DisposablePrices objects.
   * @example
   * // Usage example documented above
   */
  static async getPricesByRate(rateId) {
    try {
      const query = new Parse.Query('DisposablePrices');
      query.equalTo('exists', true);
      query.equalTo('rate', {
        __type: 'Pointer',
        className: 'Rate',
        objectId: rateId,
      });
      query.include(['vehicleType', 'rate']);
      query.descending('effectiveDate');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting disposable prices by rate', {
        rateId,
        error: error.message,
      });
      return [];
    }
  }
}

// Export the DisposablePrices class
module.exports = DisposablePrices;
