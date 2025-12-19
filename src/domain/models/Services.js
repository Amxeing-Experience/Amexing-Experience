/**
 * Services - Domain model for simplified transportation service catalog.
 *
 * Manages service route definitions with rate associations.
 * Supports airport transfers, point-to-point, and local services.
 *
 * Lifecycle States:
 * - active: true, exists: true = Available for booking
 * - active: false, exists: true = Hidden but preserved in historical bookings
 * - active: false, exists: false = Soft deleted (audit trail only).
 *
 * Service Types (via destinationPOI.serviceType):
 * - Aeropuerto: Airport transfers (origin optional for return trips)
 * - Punto a Punto: Point-to-point transfers (origin required)
 * - Local: Local services (origin typically null).
 * @augments BaseModel
 * @author Denisse Maldonado
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // Create new service
 * const service = new Services();
 * service.setOriginPOI(originPointer); // Optional for airport/local
 * service.setDestinationPOI(destPointer); // Required
 * service.setRate(ratePointer); // Required
 * service.setNote('Additional service information');
 * await service.save();
 *
 * // Query services with populated relations
 * const query = new Parse.Query('Services');
 * query.include(['originPOI', 'destinationPOI', 'rate']);
 * query.equalTo('active', true);
 * query.equalTo('exists', true);
 * const services = await query.find();
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * Services class for managing simplified transportation service catalog.
 * @class Services
 * @augments BaseModel
 */
class Services extends BaseModel {
  /**
   * Create a Services instance.
   * @example
   * // Usage example documented above
   */
  constructor() {
    super('Services');
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

  // =================
  // VALIDATION
  // =================

  /**
   * Validate service data before save.
   * @returns {object} Validation result { isValid, errors[] }.
   * @example
   * // Usage example documented above
   */
  validate() {
    const errors = [];

    // Destination POI is required for all service types
    if (!this.getDestinationPOI()) {
      errors.push('Destination POI is required');
    }

    // Rate validation - required for pricing
    if (!this.getRate()) {
      errors.push('Rate is required');
    }

    // Business logic validation
    const destinationPOI = this.getDestinationPOI();
    if (destinationPOI) {
      const serviceType = destinationPOI.get('serviceType')?.get('name');

      // For Punto a Punto services, origin is typically required
      if (serviceType === 'Punto a Punto' && !this.getOriginPOI()) {
        console.warn('Point-to-point service without origin POI - verify this is intentional');
      }
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
   * Find service by route (origin, destination, rate).
   * @param {string|null} originId - Origin POI ID (optional for airport/local services).
   * @param {string} destinationId - Destination POI ID.
   * @param {string} rateId - Rate ID.
   * @returns {Promise<Services>} Service instance or null.
   * @example
   * // Find airport service (origin optional)
   * const service = await Services.findByRoute(null, 'destinationId', 'rateId');
   *
   * // Find point-to-point service (origin required)
   * const service = await Services.findByRoute('originId', 'destinationId', 'rateId');
   */
  static async findByRoute(originId, destinationId, rateId) {
    try {
      const query = new Parse.Query('Services');
      query.equalTo('exists', true);

      // Handle origin POI (can be null for airport/local services)
      if (originId) {
        const originPointer = {
          __type: 'Pointer',
          className: 'POI',
          objectId: originId,
        };
        query.equalTo('originPOI', originPointer);
      } else {
        query.doesNotExist('originPOI');
      }

      // Destination POI (required)
      const destinationPointer = {
        __type: 'Pointer',
        className: 'POI',
        objectId: destinationId,
      };
      query.equalTo('destinationPOI', destinationPointer);

      // Rate (required)
      const ratePointer = {
        __type: 'Pointer',
        className: 'Rate',
        objectId: rateId,
      };
      query.equalTo('rate', ratePointer);

      // Include related objects
      query.include(['originPOI', 'destinationPOI', 'rate']);

      const result = await query.first({ useMasterKey: true });
      return result || null;
    } catch (error) {
      logger.error('Error finding service by route', {
        originId,
        destinationId,
        rateId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get all active services.
   * @returns {Promise<Array>} Array of Services objects.
   * @example
   * const activeServices = await Services.getActiveServices();
   * console.log(`Found ${activeServices.length} active services`);
   */
  static async getActiveServices() {
    try {
      const query = new Parse.Query('Services');
      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.include(['originPOI', 'destinationPOI', 'rate', 'destinationPOI.serviceType']);
      query.limit(1000); // Prevent timeout on large datasets

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting active services', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get services by rate.
   * @param {string} rateId - Rate ID.
   * @returns {Promise<Array>} Array of Services objects.
   * @example
   * const rateServices = await Services.getServicesByRate('rateId');
   * console.log(`Found ${rateServices.length} services for this rate`);
   */
  static async getServicesByRate(rateId) {
    try {
      const query = new Parse.Query('Services');
      const ratePointer = {
        __type: 'Pointer',
        className: 'Rate',
        objectId: rateId,
      };
      query.equalTo('rate', ratePointer);
      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.include(['originPOI', 'destinationPOI', 'rate', 'destinationPOI.serviceType']);

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
   * Get services by POI (as origin or destination).
   * @param {string} poiId - POI ID.
   * @returns {Promise<Array>} Array of Services objects.
   * @example
   * const poiServices = await Services.getServicesByPOI('poiId');
   * console.log(`Found ${poiServices.length} services involving this POI`);
   */
  static async getServicesByPOI(poiId) {
    try {
      const poiPointer = {
        __type: 'Pointer',
        className: 'POI',
        objectId: poiId,
      };

      const originQuery = new Parse.Query('Services');
      originQuery.equalTo('originPOI', poiPointer);
      originQuery.equalTo('exists', true);

      const destQuery = new Parse.Query('Services');
      destQuery.equalTo('destinationPOI', poiPointer);
      destQuery.equalTo('exists', true);

      const query = Parse.Query.or(originQuery, destQuery);
      query.include(['originPOI', 'destinationPOI', 'rate', 'destinationPOI.serviceType']);

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
   * Get services by service type (Airport, Point-to-Point, Local).
   * @param {string} serviceTypeName - Service type name ('Aeropuerto', 'Punto a Punto', 'Local').
   * @returns {Promise<Array>} Array of Services objects.
   * @example
   * const airportServices = await Services.getServicesByType('Aeropuerto');
   * const localServices = await Services.getServicesByType('Local');
   */
  static async getServicesByType(serviceTypeName) {
    try {
      // First get the service type
      const serviceTypeQuery = new Parse.Query('ServiceType');
      serviceTypeQuery.equalTo('name', serviceTypeName);
      serviceTypeQuery.equalTo('exists', true);
      const serviceType = await serviceTypeQuery.first({ useMasterKey: true });

      if (!serviceType) {
        logger.warn(`Service type '${serviceTypeName}' not found`);
        return [];
      }

      // Then get POIs with this service type
      const poiQuery = new Parse.Query('POI');
      poiQuery.equalTo('serviceType', serviceType);
      poiQuery.equalTo('exists', true);
      const pois = await poiQuery.find({ useMasterKey: true });

      if (pois.length === 0) {
        return [];
      }

      // Finally get services with these POIs as destinations
      const query = new Parse.Query('Services');
      query.containedIn('destinationPOI', pois);
      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.include(['originPOI', 'destinationPOI', 'rate', 'destinationPOI.serviceType']);

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting services by type', {
        serviceTypeName,
        error: error.message,
      });
      return [];
    }
  }
}

// Export the Services class
module.exports = Services;
