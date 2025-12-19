/**
 * RatePrices - Domain model for rate-specific pricing with vehicle types.
 *
 * Manages pricing information for specific rate, service, and vehicle combinations.
 * This allows different rates and vehicle types to have different prices for the same service.
 *
 * Database Structure:
 * - originPOI: Origin point (can be null for airport/local services)
 * - destinationPOI: Destination point (required)
 * - rate: Rate object (required)
 * - vehicleType: Vehicle type object (required)
 * - service: Service object reference (required)
 * - price: Price amount (required).
 *
 * Lifecycle States:
 * - active: true, exists: true = Available for pricing calculations
 * - active: false, exists: true = Hidden but preserved for historical pricing
 * - active: false, exists: false = Soft deleted (audit trail only).
 * @augments BaseModel
 * @author Denisse Maldonado
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // Create new rate price
 * const ratePrice = new RatePrices();
 * ratePrice.set('originPOI', originPOI);
 * ratePrice.set('destinationPOI', destinationPOI);
 * ratePrice.set('rate', rate);
 * ratePrice.set('vehicleType', vehicleType);
 * ratePrice.set('service', service);
 * ratePrice.set('price', 1500.00);
 * await ratePrice.save();
 *
 * // Query rate prices with populated relations
 * const query = new Parse.Query('RatePrices');
 * query.include('originPOI');
 * query.include('destinationPOI');
 * query.include('rate');
 * query.include('vehicleType');
 * query.include('service');
 * const ratePrices = await query.find();
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * RatePrices class for managing rate-specific pricing catalog.
 * @class RatePrices
 * @augments BaseModel
 */
class RatePrices extends BaseModel {
  /**
   * Create a RatePrices instance.
   * @example
   * // Usage example documented above
   */
  constructor() {
    super('RatePrices');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get origin POI.
   * @returns {object} Origin POI Parse object (can be null).
   * @example
   * // Usage example documented above
   */
  getOriginPOI() {
    return this.get('originPOI');
  }

  /**
   * Set origin POI.
   * @param {object} originPOI - Origin POI Parse object or Pointer.
   * @example
   * // Usage example documented above
   */
  setOriginPOI(originPOI) {
    this.set('originPOI', originPOI);
  }

  /**
   * Get destination POI.
   * @returns {object} Destination POI Parse object.
   * @example
   * // Usage example documented above
   */
  getDestinationPOI() {
    return this.get('destinationPOI');
  }

  /**
   * Set destination POI.
   * @param {object} destinationPOI - Destination POI Parse object or Pointer.
   * @example
   * // Usage example documented above
   */
  setDestinationPOI(destinationPOI) {
    this.set('destinationPOI', destinationPOI);
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
   * Get service.
   * @returns {object} Service Parse object.
   * @example
   * // Usage example documented above
   */
  getService() {
    return this.get('service');
  }

  /**
   * Set service.
   * @param {object} service - Service Parse object or Pointer.
   * @example
   * // Usage example documented above
   */
  setService(service) {
    this.set('service', service);
  }

  /**
   * Get price.
   * @returns {number} Price amount.
   * @example
   * // Usage example documented above
   */
  getPrice() {
    return this.get('price') || 0;
  }

  /**
   * Set price.
   * @param {number} price - Price amount.
   * @example
   * // Usage example documented above
   */
  setPrice(price) {
    this.set('price', parseFloat(price));
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
   * Get formatted price with currency.
   * @returns {string} Formatted price (e.g., "$10,000.00 MXN").
   * @example
   * // Usage example documented above
   */
  getFormattedPrice() {
    const price = this.getPrice();
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
   * Validate rate price data before save.
   * @returns {object} Validation result { isValid, errors[] }.
   * @example
   * // Usage example documented above
   */
  validate() {
    const errors = [];

    // Destination POI validation (required)
    if (!this.getDestinationPOI()) {
      errors.push('Destination POI is required');
    }

    // Rate validation (required)
    if (!this.getRate()) {
      errors.push('Rate is required');
    }

    // Vehicle type validation (required)
    if (!this.getVehicleType()) {
      errors.push('Vehicle type is required');
    }

    // Service validation (required)
    if (!this.getService()) {
      errors.push('Service is required');
    }

    // Price validation
    const price = this.getPrice();
    if (!price || price <= 0) {
      errors.push('Price must be greater than 0');
    }

    // Currency validation
    const currency = this.getCurrency();
    const validCurrencies = ['MXN', 'USD', 'EUR'];
    if (!validCurrencies.includes(currency)) {
      errors.push(`Currency must be one of: ${validCurrencies.join(', ')}`);
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
   * Find rate price by rate, service, and vehicle type.
   * @param {string} rateId - Rate ID.
   * @param {string} serviceId - Service ID.
   * @param {string} vehicleTypeId - Vehicle type ID.
   * @returns {Promise<RatePrices>} RatePrices instance or null.
   * @example
   * // Usage example documented above
   */
  static async findByRateServiceAndVehicle(rateId, serviceId, vehicleTypeId) {
    try {
      const query = new Parse.Query('RatePrices');
      query.equalTo('exists', true);

      // Create pointers
      const ratePointer = {
        __type: 'Pointer',
        className: 'Rate',
        objectId: rateId,
      };
      const servicePointer = {
        __type: 'Pointer',
        className: 'Services',
        objectId: serviceId,
      };
      const vehicleTypePointer = {
        __type: 'Pointer',
        className: 'VehicleType',
        objectId: vehicleTypeId,
      };

      query.equalTo('rate', ratePointer);
      query.equalTo('service', servicePointer);
      query.equalTo('vehicleType', vehicleTypePointer);
      query.include(['originPOI', 'destinationPOI', 'rate', 'vehicleType', 'service']);

      const result = await query.first({ useMasterKey: true });
      return result || null;
    } catch (error) {
      logger.error('Error finding rate price by rate, service, and vehicle', {
        rateId,
        serviceId,
        vehicleTypeId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get all rate prices for a specific rate.
   * @param {string} rateId - Rate ID.
   * @returns {Promise<Array>} Array of RatePrices objects.
   * @example
   * // Usage example documented above
   */
  static async getRatePricesByRate(rateId) {
    try {
      const query = new Parse.Query('RatePrices');
      const ratePointer = {
        __type: 'Pointer',
        className: 'Rate',
        objectId: rateId,
      };
      query.equalTo('rate', ratePointer);
      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.include(['originPOI', 'destinationPOI', 'rate', 'vehicleType', 'service']);
      query.ascending('price');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting rate prices by rate', {
        rateId,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get all rate prices for a specific service.
   * @param {string} serviceId - Service ID.
   * @returns {Promise<Array>} Array of RatePrices objects.
   * @example
   * // Usage example documented above
   */
  static async getRatePricesByService(serviceId) {
    try {
      const query = new Parse.Query('RatePrices');
      const servicePointer = {
        __type: 'Pointer',
        className: 'Services',
        objectId: serviceId,
      };
      query.equalTo('service', servicePointer);
      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.include(['originPOI', 'destinationPOI', 'rate', 'vehicleType', 'service']);
      query.ascending('price');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting rate prices by service', {
        serviceId,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get all active rate prices.
   * @returns {Promise<Array>} Array of RatePrices objects.
   * @example
   * // Usage example documented above
   */
  static async getActiveRatePrices() {
    try {
      const query = new Parse.Query('RatePrices');
      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.include(['originPOI', 'destinationPOI', 'rate', 'vehicleType', 'service']);
      query.ascending('price');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting active rate prices', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get rate prices by currency.
   * @param {string} currency - Currency code (e.g., 'MXN', 'USD').
   * @returns {Promise<Array>} Array of RatePrices objects.
   * @example
   * // Usage example documented above
   */
  static async getRatePricesByCurrency(currency) {
    try {
      const query = new Parse.Query('RatePrices');
      query.equalTo('currency', currency.toUpperCase());
      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.include(['originPOI', 'destinationPOI', 'rate', 'vehicleType', 'service']);
      query.ascending('price');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting rate prices by currency', {
        currency,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get rate prices by route and vehicle type (for pricing calculations).
   * @param {string} originPOIId - Origin POI ID (can be null).
   * @param {string} destinationPOIId - Destination POI ID.
   * @param {string} vehicleTypeId - Vehicle type ID.
   * @returns {Promise<Array>} Array of RatePrices objects for all rates.
   * @example
   * // Usage example documented above
   */
  static async getRatePricesByRoute(originPOIId, destinationPOIId, vehicleTypeId) {
    try {
      const query = new Parse.Query('RatePrices');

      // Set origin POI condition
      if (originPOIId) {
        query.equalTo('originPOI', {
          __type: 'Pointer',
          className: 'POI',
          objectId: originPOIId,
        });
      } else {
        query.doesNotExist('originPOI');
      }

      // Set destination and vehicle type
      query.equalTo('destinationPOI', {
        __type: 'Pointer',
        className: 'POI',
        objectId: destinationPOIId,
      });
      query.equalTo('vehicleType', {
        __type: 'Pointer',
        className: 'VehicleType',
        objectId: vehicleTypeId,
      });

      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.include(['originPOI', 'destinationPOI', 'rate', 'vehicleType', 'service']);
      query.ascending('price');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting rate prices by route', {
        originPOIId,
        destinationPOIId,
        vehicleTypeId,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Create or update rate price.
   * @param {object} params - Rate price parameters.
   * @param {string} params.rateId - Rate ID.
   * @param {string} params.serviceId - Service ID.
   * @param {string} params.vehicleTypeId - Vehicle type ID.
   * @param {string} params.originPOIId - Origin POI ID (optional).
   * @param {string} params.destinationPOIId - Destination POI ID.
   * @param {number} params.price - Price amount.
   * @param {string} params.currency - Currency code (default: 'MXN').
   * @returns {Promise<RatePrices>} Created or updated RatePrices instance.
   * @example
   * // Usage example documented above
   */
  static async createOrUpdateRatePrice(params) {
    try {
      const {
        rateId, serviceId, vehicleTypeId, originPOIId, destinationPOIId, price, currency = 'MXN',
      } = params;

      // Check if rate price already exists
      let ratePrice = await this.findByRateServiceAndVehicle(rateId, serviceId, vehicleTypeId);

      if (!ratePrice) {
        // Create new rate price
        ratePrice = new RatePrices();

        // Set required fields
        ratePrice.set('rate', {
          __type: 'Pointer',
          className: 'Rate',
          objectId: rateId,
        });
        ratePrice.set('service', {
          __type: 'Pointer',
          className: 'Services',
          objectId: serviceId,
        });
        ratePrice.set('vehicleType', {
          __type: 'Pointer',
          className: 'VehicleType',
          objectId: vehicleTypeId,
        });
        ratePrice.set('destinationPOI', {
          __type: 'Pointer',
          className: 'POI',
          objectId: destinationPOIId,
        });

        // Set optional origin POI
        if (originPOIId) {
          ratePrice.set('originPOI', {
            __type: 'Pointer',
            className: 'POI',
            objectId: originPOIId,
          });
        }

        ratePrice.set('active', true);
        ratePrice.set('exists', true);
      }

      // Set price and currency
      ratePrice.setPrice(price);
      ratePrice.setCurrency(currency);

      // Validate before saving
      const validation = ratePrice.validate();
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      await ratePrice.save(null, { useMasterKey: true });
      return ratePrice;
    } catch (error) {
      logger.error('Error creating or updating rate price', {
        params,
        error: error.message,
      });
      throw error;
    }
  }
}

// Export the RatePrices class
module.exports = RatePrices;
