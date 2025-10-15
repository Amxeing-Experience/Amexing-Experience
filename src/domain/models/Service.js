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
 * @since 2025-10-14
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
   */
  getOriginPOI() {
    return this.get('originPOI');
  }

  /**
   * Set origin POI.
   * @param {object} poi - POI Parse object or Pointer.
   * @example
   */
  setOriginPOI(poi) {
    this.set('originPOI', poi);
  }

  /**
   * Get destination POI.
   * @returns {object} Destination POI Parse object.
   * @example
   */
  getDestinationPOI() {
    return this.get('destinationPOI');
  }

  /**
   * Set destination POI.
   * @param {object} poi - POI Parse object or Pointer.
   * @example
   */
  setDestinationPOI(poi) {
    this.set('destinationPOI', poi);
  }

  /**
   * Get vehicle type.
   * @returns {object} VehicleType Parse object.
   * @example
   */
  getVehicleType() {
    return this.get('vehicleType');
  }

  /**
   * Set vehicle type.
   * @param {object} vehicleType - VehicleType Parse object or Pointer.
   * @example
   */
  setVehicleType(vehicleType) {
    this.set('vehicleType', vehicleType);
  }

  /**
   * Get service note.
   * @returns {string} Service note.
   * @example
   */
  getNote() {
    return this.get('note') || '';
  }

  /**
   * Set service note.
   * @param {string} note - Service note.
   * @example
   */
  setNote(note) {
    this.set('note', note);
  }

  /**
   * Get service price.
   * @returns {number} Service price.
   * @example
   */
  getPrice() {
    return this.get('price') || 0;
  }

  /**
   * Set service price.
   * @param {number} price - Service price.
   * @example
   */
  setPrice(price) {
    this.set('price', parseFloat(price));
  }

  /**
   * Get formatted price with currency.
   * @returns {string} Formatted price (e.g., "$10,000.00").
   * @example
   */
  getFormattedPrice() {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
    }).format(this.getPrice());
  }

  // =================
  // BUSINESS LOGIC
  // =================

  /**
   * Validate service data before save.
   * @returns {object} Validation result {valid: boolean, errors: string[]}.
   * @example
   */
  validate() {
    const errors = [];

    if (!this.getOriginPOI()) {
      errors.push('Origin POI is required');
    }

    if (!this.getDestinationPOI()) {
      errors.push('Destination POI is required');
    }

    // Validate origin !== destination
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
   * Find service by route (origin, destination, vehicle type).
   * @param {string} originId - Origin POI ID.
   * @param {string} destinationId - Destination POI ID.
   * @param {string} vehicleTypeId - VehicleType ID.
   * @returns {Promise<Service|undefined>} Service or undefined.
   * @example
   */
  static async findByRoute(originId, destinationId, vehicleTypeId) {
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

      query.equalTo('originPOI', originPointer);
      query.equalTo('destinationPOI', destPointer);
      query.equalTo('vehicleType', vehiclePointer);
      query.equalTo('exists', true);

      const result = await query.first({ useMasterKey: true });
      return result;
    } catch (error) {
      logger.error('Error finding service by route', {
        originId,
        destinationId,
        vehicleTypeId,
        error: error.message,
      });
      return undefined;
    }
  }

  /**
   * Get all active services ordered by price.
   * @returns {Promise<Service[]>} Array of active services.
   * @example
   */
  static async getActiveServices() {
    try {
      const query = BaseModel.queryActive('Service');
      query.include('originPOI');
      query.include('destinationPOI');
      query.include('vehicleType');
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
   * Get services that use a specific POI (origin or destination).
   * @param {string} poiId - POI ID.
   * @returns {Promise<Service[]>} Array of services.
   * @example
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
   */
  static async seedDefaults() {
    // TODO: Implement seed with actual POI and VehicleType IDs from database
    logger.info(
      'Service seeding not implemented - requires existing POIs and VehicleTypes'
    );
    return { created: 0, errors: 0 };
  }
}

// COMMENTED OUT: registerSubclass causes issues with set() + save() for boolean fields
// Parse.Object.registerSubclass('Service', Service);

module.exports = Service;
