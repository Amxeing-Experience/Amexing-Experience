/**
 * VehicleRatePrices Domain Model.
 *
 * Manages vehicle pricing per rate with complete history tracking.
 * Each record represents a price for a specific vehicle type within a rate category.
 *
 * Features:
 * - Complete price history with valid_from/valid_until
 * - Audit trail with created_by and reason_for_change
 * - Support for multiple currencies
 * - Logical deletion with exists flag.
 *
 * Parse Server Table: VehicleRatePrices.
 */

const Parse = require('parse/node');

/**
 * VehicleRatePrices domain model for managing vehicle pricing by rate and service.
 * Extends Parse.Object to provide structured vehicle rate pricing data with
 * service, rate, and vehicle type relationships for pricing calculations.
 * @class VehicleRatePrices
 * @extends Parse.Object
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Create a new vehicle rate price
 * const vehicleRatePrice = new VehicleRatePrices();
 * vehicleRatePrice.set('servicePtr', serviceObject);
 * vehicleRatePrice.set('ratePtr', rateObject);
 * vehicleRatePrice.set('price', 150.00);
 * await vehicleRatePrice.save();
 */
class VehicleRatePrices extends Parse.Object {
  constructor() {
    super('VehicleRatePrices');
  }

  /**
   * Initialize with default values.
   * @example
   */
  initialize() {
    super.initialize();
    this.set('active', true);
    this.set('exists', true);
    this.set('currency', 'MXN');
    this.set('valid_from', new Date());
    // valid_until remains unset for current prices
  }

  /**
   * Get current active price for a rate and vehicle type.
   * @param {string} rateId - Rate ID.
   * @param {string} vehicleTypeId - Vehicle Type ID.
   * @returns {Promise<VehicleRatePrices|null>}
   * @example
   */
  static async getCurrentPrice(rateId, vehicleTypeId) {
    const query = new Parse.Query(VehicleRatePrices);
    query.equalTo('rateId', rateId);
    query.equalTo('vehicleTypeId', vehicleTypeId);
    query.doesNotExist('valid_until'); // Current price has no end date
    query.equalTo('exists', true);
    query.equalTo('active', true);

    return query.first({ useMasterKey: true });
  }

  /**
   * Get price at a specific date.
   * @param {string} rateId - Rate ID.
   * @param {string} vehicleTypeId - Vehicle Type ID.
   * @param {Date} targetDate - Date to check price for.
   * @returns {Promise<VehicleRatePrices|null>}
   * @example
   */
  static async getPriceAtDate(rateId, vehicleTypeId, targetDate) {
    const query = new Parse.Query(VehicleRatePrices);
    query.equalTo('rateId', rateId);
    query.equalTo('vehicleTypeId', vehicleTypeId);
    query.lessThanOrEqualTo('valid_from', targetDate);
    query.equalTo('exists', true);

    // Check if valid_until is after target date OR doesn't exist (current)
    const query1 = new Parse.Query(VehicleRatePrices);
    query1.greaterThan('valid_until', targetDate);

    const query2 = new Parse.Query(VehicleRatePrices);
    query2.doesNotExist('valid_until');

    const validQuery = Parse.Query.or(query1, query2);

    // Combine with main query
    const finalQuery = Parse.Query.and(query, validQuery);

    return finalQuery.first({ useMasterKey: true });
  }

  /**
   * Get complete price history for a rate and vehicle type.
   * @param {string} rateId - Rate ID.
   * @param {string} vehicleTypeId - Vehicle Type ID.
   * @returns {Promise<Array<VehicleRatePrices>>}
   * @example
   */
  static async getPriceHistory(rateId, vehicleTypeId) {
    const query = new Parse.Query(VehicleRatePrices);
    query.equalTo('rateId', rateId);
    query.equalTo('vehicleTypeId', vehicleTypeId);
    query.equalTo('exists', true);
    query.descending('valid_from');
    query.limit(1000);

    return query.find({ useMasterKey: true });
  }

  /**
   * Create a new price (handles history automatically).
   * @param {object} priceData - Price data.
   * @param {string} priceData.rateId - Rate ID.
   * @param {string} priceData.vehicleTypeId - Vehicle Type ID.
   * @param {number} priceData.pricePerHour - Price per hour.
   * @param {string} priceData.currency - Currency (default MXN).
   * @param {string} priceData.created_by - User ID who created.
   * @param {string} priceData.reason_for_change - Reason for price change.
   * @returns {Promise<VehicleRatePrices>}
   * @example
   */
  static async createNewPrice(priceData) {
    // Find current active price
    const currentPrice = await VehicleRatePrices.getCurrentPrice(priceData.rateId, priceData.vehicleTypeId);

    // Set valid_until on current price if exists
    if (currentPrice) {
      currentPrice.set('valid_until', new Date());
      await currentPrice.save(null, { useMasterKey: true });
    }

    // Create new price record
    const newPrice = new VehicleRatePrices();
    newPrice.set('rateId', priceData.rateId);
    newPrice.set('vehicleTypeId', priceData.vehicleTypeId);
    newPrice.set('pricePerHour', priceData.pricePerHour);
    newPrice.set('currency', priceData.currency || 'MXN');
    newPrice.set('valid_from', new Date());
    // valid_until remains unset

    if (priceData.created_by) {
      newPrice.set('created_by', priceData.created_by);
    }

    if (priceData.reason_for_change) {
      newPrice.set('reason_for_change', priceData.reason_for_change);
    }

    if (currentPrice) {
      newPrice.set('replaced_by', currentPrice.id);
    }

    newPrice.set('active', true);
    newPrice.set('exists', true);

    return newPrice.save(null, { useMasterKey: true });
  }

  /**
   * Bulk create prices (for seeding).
   * @param {Array<object>} pricesData - Array of price data.
   * @returns {Promise<Array<VehicleRatePrices>>}
   * @example
   */
  static async bulkCreate(pricesData) {
    const prices = pricesData.map((data) => {
      const price = new VehicleRatePrices();
      price.set('rateId', data.rateId);
      price.set('vehicleTypeId', data.vehicleTypeId);
      price.set('pricePerHour', data.pricePerHour);
      price.set('currency', data.currency || 'MXN');
      price.set('valid_from', data.valid_from || new Date());
      // valid_until remains unset for current prices

      if (data.created_by) {
        price.set('created_by', data.created_by);
      }

      price.set('active', true);
      price.set('exists', true);

      return price;
    });

    return Parse.Object.saveAll(prices, { useMasterKey: true });
  }
}

// Register the class with Parse
Parse.Object.registerSubclass('VehicleRatePrices', VehicleRatePrices);

module.exports = VehicleRatePrices;
