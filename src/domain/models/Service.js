/**
 * Service - Domain model for transportation service catalog.
 *
 * Manages service definitions with origin/destination POIs, vehicle types, and pricing.
 * Represents a specific transportation route with associated costs.
 *
 * Lifecycle States:
 * - active: true, exists: true = Available for booking
 * - active: false, exists: true = Hidden but preserved in historical bookings
 * - active: false, exists: false = Soft deleted (audit trail only).
 * @augments BaseModel
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Create new service
 * const service = new Service();
 * service.set('originPOI', originPointer);
 * service.set('destinationPOI', destPointer);
 * service.set('vehicleType', vehicleTypePointer);
 * service.set('price', 1000.00);
 * await service.save();
 *
 * // Query services with populated relations
 * const query = new Parse.Query('Service');
 * query.include('originPOI');
 * query.include('destinationPOI');
 * query.include('vehicleType');
 * const services = await query.find();
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * Service class for managing transportation service catalog.
 * @class Service
 * @augments BaseModel
 */
class Service extends BaseModel {
  /**
   * Create a Service instance.
   * @example
   * // Usage example documented above
   */
  constructor() {
    super('Service');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get origin POI.
   * @returns {object} Origin POI Parse object.
   * @example
   * // Usage example documented above
   */
  getOriginPOI() {
    return this.get('originPOI');
  }

  /**
   * Set origin POI.
   * @param {object} poi - POI Parse object or Pointer.
   * @example
   * // Usage example documented above
   */
  setOriginPOI(poi) {
    this.set('originPOI', poi);
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
   * @param {object} poi - POI Parse object or Pointer.
   * @example
   * // Usage example documented above
   */
  setDestinationPOI(poi) {
    this.set('destinationPOI', poi);
  }

  /**
   * Get vehicle type.
   * @returns {object} VehicleType Parse object.
   * @example
   * // Usage example documented above
   */
  getVehicleType() {
    return this.get('vehicleType');
  }

  /**
   * Set vehicle type.
   * @param {object} vehicleType - VehicleType Parse object or Pointer.
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
   * Get service note.
   * @returns {string} Service note.
   * @example
   * // Usage example documented above
   */
  getNote() {
    return this.get('note') || '';
  }

  /**
   * Set service note.
   * @param {string} note - Service note.
   * @example
   * // Usage example documented above
   */
  setNote(note) {
    this.set('note', note);
  }

  /**
   * Get service price.
   * @returns {number} Service price.
   * @example
   * // Usage example documented above
   */
  getPrice() {
    return this.get('price') || 0;
  }

  /**
   * Set service price.
   * @param {number} price - Service price.
   * @example
   * // Usage example documented above
   */
  setPrice(price) {
    this.set('price', parseFloat(price));
  }

  /**
   * Get formatted price with currency.
   * @returns {string} Formatted price (e.g., "$10,000.00").
   * @example
   * // Usage example documented above
   */
  getFormattedPrice() {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
    }).format(this.getPrice());
  }

  /**
   * Get round trip status.
   * Indicates if the service price applies to both directions (bidirectional).
   * @returns {boolean} True if service supports round trips, false otherwise.
   * @example
   * // Check if service is round trip
   * const service = await Service.getServiceById('serviceId');
   * if (service.getRoundTrip()) {
   *   console.log('This service applies to both directions');
   * }
   */
  getRoundTrip() {
    return this.get('isRoundTrip') || false;
  }

  /**
   * Set round trip status.
   * Mark service as bidirectional (same price applies to both origin→destination and destination→origin).
   * @param {boolean} isRoundTrip - True if service supports round trips.
   * @example
   * // Mark service as round trip
   * const service = Service.create({...});
   * service.setRoundTrip(true);
   * await service.save();
   */
  setRoundTrip(isRoundTrip) {
    this.set('isRoundTrip', !!isRoundTrip);
  }

  // =================
  // BUSINESS LOGIC
  // =================

  /**
   * Validate service data before save.
   * @returns {object} Validation result {valid: boolean, errors: string[]}.
   * @example
   * // Usage example documented above
   */
  validate() {
    const errors = [];

    // Origin is optional (for local transfers), destination is required
    if (!this.getDestinationPOI()) {
      errors.push('Destination POI is required');
    }

    // Validate origin !== destination (only if both exist)
    if (this.getOriginPOI() && this.getDestinationPOI()) {
      const originId = this.getOriginPOI().id;
      const destId = this.getDestinationPOI().id;
      if (originId === destId) {
        errors.push('Origin and destination must be different');
      }
    }

    if (!this.getVehicleType()) {
      errors.push('Vehicle type is required');
    }

    if (!this.getRate()) {
      errors.push('Rate is required');
    }

    const price = this.getPrice();
    if (!price || price <= 0) {
      errors.push('Price must be greater than 0');
    }

    const note = this.getNote();
    if (note && note.length > 500) {
      errors.push('Note must be 500 characters or less');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if this service can be deleted.
   * Future: Check if any bookings use this service.
   * @returns {Promise<object>} {canDelete: boolean, reason: string}.
   * @example
   * // Usage example documented above
   */
  async canDelete() {
    try {
      // TODO: In future phases, check if any ServiceRequest references this Service
      // For now, allow deletion
      return {
        canDelete: true,
        reason: null,
      };
    } catch (error) {
      logger.error('Error checking Service deletion', {
        serviceId: this.id,
        error: error.message,
      });
      return {
        canDelete: false,
        reason: 'Error checking dependencies',
      };
    }
  }

  // =================
  // STATIC METHODS
  // =================

  /**
   * Find service by route (origin, destination, vehicle type, rate).
   * @param {string} originId - Origin POI ID.
   * @param {string} destinationId - Destination POI ID.
   * @param {string} vehicleTypeId - VehicleType ID.
   * @param {string} rateId - Rate ID.
   * @returns {Promise<Service|undefined>} Service or undefined.
   * @example
   * // Usage example documented above
   */
  static async findByRoute(originId, destinationId, vehicleTypeId, rateId) {
    try {
      const query = new Parse.Query('Service');

      // Create pointers
      const originPointer = {
        __type: 'Pointer',
        className: 'POI',
        objectId: originId,
      };
      const destPointer = {
        __type: 'Pointer',
        className: 'POI',
        objectId: destinationId,
      };
      const vehiclePointer = {
        __type: 'Pointer',
        className: 'VehicleType',
        objectId: vehicleTypeId,
      };
      const ratePointer = {
        __type: 'Pointer',
        className: 'Rate',
        objectId: rateId,
      };

      query.equalTo('originPOI', originPointer);
      query.equalTo('destinationPOI', destPointer);
      query.equalTo('vehicleType', vehiclePointer);
      query.equalTo('rate', ratePointer);
      query.equalTo('exists', true);

      const result = await query.first({ useMasterKey: true });
      return result;
    } catch (error) {
      logger.error('Error finding service by route', {
        originId,
        destinationId,
        vehicleTypeId,
        rateId,
        error: error.message,
      });
      return undefined;
    }
  }

  /**
   * Get all active services ordered by price.
   * @returns {Promise<Service[]>} Array of active services.
   * @example
   * // Usage example documented above
   */
  static async getActiveServices() {
    try {
      const query = BaseModel.queryActive('Service');
      query.include('originPOI');
      query.include('destinationPOI');
      query.include('vehicleType');
      query.include('rate');
      query.ascending('price');
      query.limit(1000);

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting active services', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get services by vehicle type.
   * @param {string} vehicleTypeId - VehicleType ID.
   * @returns {Promise<Service[]>} Array of services.
   * @example
   * // Usage example documented above
   */
  static async getServicesByVehicleType(vehicleTypeId) {
    try {
      const query = new Parse.Query('Service');
      const vehiclePointer = {
        __type: 'Pointer',
        className: 'VehicleType',
        objectId: vehicleTypeId,
      };
      query.equalTo('vehicleType', vehiclePointer);
      query.equalTo('exists', true);
      query.include('originPOI');
      query.include('destinationPOI');
      query.include('rate');
      query.limit(100);

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting services by vehicle type', {
        vehicleTypeId,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get services by rate.
   * @param {string} rateId - Rate ID.
   * @returns {Promise<Service[]>} Array of services.
   * @example
   * // Usage example documented above
   */
  static async getServicesByRate(rateId) {
    try {
      const query = new Parse.Query('Service');
      const ratePointer = {
        __type: 'Pointer',
        className: 'Rate',
        objectId: rateId,
      };
      query.equalTo('rate', ratePointer);
      query.equalTo('exists', true);
      query.include('originPOI');
      query.include('destinationPOI');
      query.include('vehicleType');
      query.include('rate');
      query.limit(100);

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting services by rate', {
        rateId,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get services that use a specific POI (origin or destination).
   * @param {string} poiId - POI ID.
   * @returns {Promise<Service[]>} Array of services.
   * @example
   * // Usage example documented above
   */
  static async getServicesByPOI(poiId) {
    try {
      const poiPointer = {
        __type: 'Pointer',
        className: 'POI',
        objectId: poiId,
      };

      const originQuery = new Parse.Query('Service');
      originQuery.equalTo('originPOI', poiPointer);
      originQuery.equalTo('exists', true);

      const destQuery = new Parse.Query('Service');
      destQuery.equalTo('destinationPOI', poiPointer);
      destQuery.equalTo('exists', true);

      const query = Parse.Query.or(originQuery, destQuery);
      query.include('originPOI');
      query.include('destinationPOI');
      query.include('vehicleType');
      query.include('rate');
      query.limit(100);

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting services by POI', {
        poiId,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Seed default services.
   * @returns {Promise<object>} {created: number, errors: number}.
   * @example
   * // Usage example documented above
   */
  static async seedDefaults() {
    // TODO: Implement seed with actual POI and VehicleType IDs from database
    logger.info('Service seeding not implemented - requires existing POIs and VehicleTypes');
    return { created: 0, errors: 0 };
  }
}

// COMMENTED OUT: registerSubclass causes issues with set() + save() for boolean fields
// Parse.Object.registerSubclass('Service', Service);

module.exports = Service;
