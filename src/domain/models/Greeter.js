/**
 * Greeter - Domain model for greeter services management.
 *
 * Manages greeter services catalog with location and pricing.
 * Supports reception and personalized assistance services at various POIs.
 *
 * Lifecycle States:
 * - active: true, exists: true = Available for booking
 * - active: false, exists: true = Hidden but preserved in historical bookings
 * - active: false, exists: false = Soft deleted (audit trail only).
 * @augments BaseModel
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Create new greeter service
 * const greeter = new Greeter();
 * greeter.setName('Recepción VIP Aeropuerto');
 * greeter.setPOI(poiPointer);
 * greeter.setPrice(250.00);
 * greeter.setDescription('Servicio de recepción y asistencia personalizada');
 * await greeter.save();
 *
 * // Query active greeter services
 * const query = new Parse.Query('Greeter');
 * query.include(['poi']);
 * query.equalTo('active', true);
 * query.equalTo('exists', true);
 * const greeters = await query.find();
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * Greeter class for managing greeter services.
 * @class Greeter
 * @augments BaseModel
 */
class Greeter extends BaseModel {
  /**
   * Create a Greeter instance.
   * @example
   * const greeter = new Greeter();
   */
  constructor() {
    super('Greeter');
  }

  /**
   * Get the service name.
   * @returns {string} The greeter service name.
   * @example
   */
  getName() {
    return this.get('name');
  }

  /**
   * Set the service name.
   * @param {string} name - The greeter service name.
   * @example
   */
  setName(name) {
    this.set('name', name);
  }

  /**
   * Get the POI (Point of Interest) where the greeter service is provided.
   * @returns {Parse.Object} The POI object.
   * @example
   */
  getPOI() {
    return this.get('poi');
  }

  /**
   * Set the POI for the greeter service.
   * @param {Parse.Object} poi - The POI object or pointer.
   * @example
   */
  setPOI(poi) {
    this.set('poi', poi);
  }

  /**
   * Get the service price.
   * @returns {number} The greeter service price.
   * @example
   */
  getPrice() {
    return this.get('price');
  }

  /**
   * Set the service price.
   * @param {number} price - The greeter service price.
   * @example
   */
  setPrice(price) {
    this.set('price', price);
  }

  /**
   * Get the service description.
   * @returns {string} The greeter service description.
   * @example
   */
  getDescription() {
    return this.get('description');
  }

  /**
   * Set the service description.
   * @param {string} description - The greeter service description.
   * @example
   */
  setDescription(description) {
    this.set('description', description);
  }

  /**
   * Get the service duration in minutes.
   * @returns {number} The service duration in minutes.
   * @example
   */
  getDuration() {
    return this.get('duration');
  }

  /**
   * Set the service duration.
   * @param {number} duration - The service duration in minutes.
   * @example
   */
  setDuration(duration) {
    this.set('duration', duration);
  }

  /**
   * Get the service capacity (max people).
   * @returns {number} The service capacity.
   * @example
   */
  getCapacity() {
    return this.get('capacity');
  }

  /**
   * Set the service capacity.
   * @param {number} capacity - The service capacity (max people).
   * @example
   */
  setCapacity(capacity) {
    this.set('capacity', capacity);
  }

  /**
   * Query active greeter services with POI relationships.
   * @param {object} options - Query options.
   * @param {number} options.limit - Limit results (default: 100).
   * @param {number} options.skip - Skip results for pagination (default: 0).
   * @param {string} options.orderBy - Order by field (default: 'name').
   * @param {string} options.orderDirection - Order direction 'asc' or 'desc' (default: 'asc').
   * @param {string} options.search - Search term for name filtering.
   * @param {Parse.Object} options.poi - Filter by specific POI.
   * @returns {Promise<Array<Parse.Object>>} Array of greeter services.
   * @example
   */
  static async queryWithRelations(options = {}) {
    try {
      const {
        limit = 100, skip = 0, orderBy = 'name', orderDirection = 'asc', search = null, poi = null,
      } = options;

      const query = new Parse.Query('Greeter');

      // Base filters
      query.equalTo('active', true);
      query.equalTo('exists', true);

      // Search filter
      if (search) {
        query.contains('name', search);
      }

      // POI filter
      if (poi) {
        query.equalTo('poi', poi);
      }

      // Include relationships
      query.include(['poi']);

      // Pagination and sorting
      query.limit(limit);
      query.skip(skip);

      if (orderDirection === 'desc') {
        query.descending(orderBy);
      } else {
        query.ascending(orderBy);
      }

      const results = await query.find({ useMasterKey: true });
      logger.info(`Retrieved ${results.length} greeter services with relations`);

      return results;
    } catch (error) {
      logger.error('Error querying greeter services with relations:', error);
      throw error;
    }
  }

  /**
   * Find greeter services by POI.
   * @param {Parse.Object} poi - The POI to search for.
   * @returns {Promise<Array<Parse.Object>>} Array of greeter services at the POI.
   * @example
   */
  static async findByPOI(poi) {
    try {
      const query = new Parse.Query('Greeter');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.equalTo('poi', poi);
      query.include(['poi']);

      const results = await query.find({ useMasterKey: true });
      logger.info(`Found ${results.length} greeter services for POI: ${poi.get('name')}`);

      return results;
    } catch (error) {
      logger.error('Error finding greeter services by POI:', error);
      throw error;
    }
  }

  /**
   * Find greeter service by name.
   * @param {string} name - The greeter service name to search for.
   * @returns {Promise<Parse.Object|null>} The greeter service or null if not found.
   * @example
   */
  static async findByName(name) {
    try {
      const query = new Parse.Query('Greeter');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.equalTo('name', name);
      query.include(['poi']);

      const result = await query.first({ useMasterKey: true });

      if (result) {
        logger.info(`Found greeter service by name: ${name}`);
      } else {
        logger.info(`No greeter service found with name: ${name}`);
      }

      return result;
    } catch (error) {
      logger.error('Error finding greeter service by name:', error);
      throw error;
    }
  }

  /**
   * Get count of active greeter services.
   * @param {object} filters - Optional filters.
   * @param {Parse.Object} filters.poi - Filter by POI.
   * @returns {Promise<number>} Count of active greeter services.
   * @example
   */
  static async getActiveCount(filters = {}) {
    try {
      const query = new Parse.Query('Greeter');
      query.equalTo('active', true);
      query.equalTo('exists', true);

      if (filters.poi) {
        query.equalTo('poi', filters.poi);
      }

      const count = await query.count({ useMasterKey: true });
      logger.info(`Active greeter services count: ${count}`);

      return count;
    } catch (error) {
      logger.error('Error getting active greeter services count:', error);
      throw error;
    }
  }

  /**
   * Validate greeter service data before save.
   * @returns {object} Validation result with success flag and errors array.
   * @example
   */
  validate() {
    const errors = [];

    // Required fields validation
    // Name is now optional

    if (!this.getPOI()) {
      errors.push('POI is required');
    }

    if (!this.getPrice() || this.getPrice() <= 0) {
      errors.push('Valid price is required');
    }

    // Optional validations
    if (this.getDuration() && this.getDuration() <= 0) {
      errors.push('Duration must be positive if specified');
    }

    if (this.getCapacity() && this.getCapacity() <= 0) {
      errors.push('Capacity must be positive if specified');
    }

    return {
      success: errors.length === 0,
      errors,
    };
  }

  /**
   * Save the greeter service with validation.
   * @param {object} attrs - Additional attributes to set before saving.
   * @param {object} options - Parse save options.
   * @returns {Promise<Parse.Object>} The saved greeter service.
   * @example
   */
  async save(attrs = null, options = {}) {
    try {
      // Set attributes if provided
      if (attrs) {
        Object.keys(attrs).forEach((key) => {
          this.set(key, attrs[key]);
        });
      }

      // Validate before save
      const validation = this.validate();
      if (!validation.success) {
        const error = new Error(`Validation failed: ${validation.errors.join(', ')}`);
        error.code = 'VALIDATION_ERROR';
        error.errors = validation.errors;
        throw error;
      }

      // Set timestamps
      const now = new Date();
      if (this.isNew()) {
        this.set('createdAt', now);
      }
      this.set('updatedAt', now);

      const result = await super.save(null, { useMasterKey: true, ...options });
      logger.info(`Greeter service saved successfully: ${this.getName() || 'unnamed service'}`);

      return result;
    } catch (error) {
      logger.error('Error saving greeter service:', error);
      throw error;
    }
  }
}

// Register the class with Parse
Parse.Object.registerSubclass('Greeter', Greeter);

module.exports = Greeter;
