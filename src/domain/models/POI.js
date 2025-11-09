/**
 * POI (Point of Interest) - Domain model for location management.
 *
 * Manages the catalog of frequently used locations for transportation services.
 * Provides dynamic location classification for pickup/dropoff points.
 *
 * Lifecycle States:
 * - active: true, exists: true = Available for selection in UI and API
 * - active: false, exists: true = Hidden from selection but preserved in bookings
 * - active: false, exists: false = Soft deleted (audit trail only).
 * @augments BaseModel
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-01-15
 * @example
 * // Create new POI
 * const airport = new POI();
 * airport.set('name', 'Aeropuerto Internacional de Querétaro');
 * await airport.save();
 *
 * // Query active POIs
 * const activePOIs = await POI.queryActive('POI').find();
 *
 * // Find by name
 * const qroAirport = await POI.findByName('Aeropuerto Internacional de Querétaro');
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * POI class for managing points of interest catalog.
 * @class POI
 * @augments BaseModel
 */
class POI extends BaseModel {
  /**
   * Create a POI instance.
   * @example
   * // Usage example documented above
   */
  constructor() {
    super('POI');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get POI name.
   * @returns {string} POI name (e.g., "Aeropuerto Internacional de Querétaro").
   * @example
   * // Usage example documented above
   */
  getName() {
    return this.get('name');
  }

  /**
   * Set POI name.
   * @param {string} name - Display name.
   * @example
   * // Usage example documented above
   */
  setName(name) {
    this.set('name', name);
  }

  /**
   * Get service type pointer.
   * @returns {object} Service type pointer.
   * @example
   * // Usage example documented above
   */
  getServiceType() {
    return this.get('serviceType');
  }

  /**
   * Set service type pointer.
   * @param {object} serviceType - Service type Parse object or pointer.
   * @example
   * // Usage example documented above
   */
  setServiceType(serviceType) {
    this.set('serviceType', serviceType);
  }

  // =================
  // BUSINESS LOGIC
  // =================

  /**
   * Validate POI data before save.
   * @returns {object} Validation result {valid: boolean, errors: string[]}.
   * @example
   * // Usage example documented above
   */
  validate() {
    const errors = [];

    if (!this.getName()) {
      errors.push('Name is required');
    }

    if (this.getName() && this.getName().trim().length === 0) {
      errors.push('Name cannot be empty');
    }

    if (this.getName() && this.getName().length > 200) {
      errors.push('Name must be 200 characters or less');
    }

    if (!this.getServiceType()) {
      errors.push('Service type is required');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if this POI can be deleted.
   * Future implementation: check if any bookings reference this POI.
   * @returns {Promise<object>} {canDelete: boolean, reason: string}.
   * @example
   * // Usage example documented above
   */
  async canDelete() {
    try {
      // TODO: In future phases, check if any ServiceRequest references this POI
      // For now, allow deletion
      return {
        canDelete: true,
        reason: null,
      };
    } catch (error) {
      logger.error('Error checking POI deletion', {
        poiId: this.id,
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
   * Find POI by name (case insensitive).
   * @param {string} name - POI name.
   * @returns {Promise<POI|undefined>} POI or undefined.
   * @example
   * // Usage example documented above
   */
  static async findByName(name) {
    try {
      const query = new Parse.Query('POI');
      query.matches('name', name, 'i'); // Case insensitive
      query.equalTo('exists', true);

      const result = await query.first({ useMasterKey: true });
      return result;
    } catch (error) {
      logger.error('Error finding POI by name', {
        name,
        error: error.message,
      });
      return undefined;
    }
  }

  /**
   * Get all active POIs ordered by name.
   * @returns {Promise<POI[]>} Array of active POIs.
   * @example
   * // Usage example documented above
   */
  static async getActivePOIs() {
    try {
      const query = BaseModel.queryActive('POI');
      query.ascending('name');
      query.limit(1000);

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting active POIs', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get POIs for dropdown/select options.
   * @returns {Promise<Array>} Array of {value, label}.
   * @example
   * // Usage example documented above
   */
  static async getSelectOptions() {
    try {
      const pois = await POI.getActivePOIs();

      return pois.map((poi) => ({
        value: poi.id,
        label: poi.getName(),
      }));
    } catch (error) {
      logger.error('Error getting POI select options', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Check if name is unique.
   * @param {string} name - Name to check.
   * @param {string} excludeId - Exclude this ID from check (for updates).
   * @returns {Promise<boolean>} True if name is unique.
   * @example
   * // Usage example documented above
   */
  static async isNameUnique(name, excludeId = null) {
    try {
      const query = new Parse.Query('POI');
      query.matches('name', name, 'i'); // Case insensitive
      query.equalTo('exists', true);

      if (excludeId) {
        query.notEqualTo('objectId', excludeId);
      }

      const count = await query.count({ useMasterKey: true });
      return count === 0;
    } catch (error) {
      logger.error('Error checking POI name uniqueness', {
        name,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Seed default POIs.
   * @returns {Promise<object>} {created: number, errors: number}.
   * @example
   * // Usage example documented above
   */
  static async seedDefaults() {
    const defaultPOIs = [
      { name: 'Aeropuerto Internacional de Querétaro (QRO)' },
      { name: 'Aeropuerto Internacional de la Ciudad de México (MEX)' },
      { name: 'Aeropuerto Internacional de Guadalajara (GDL)' },
      { name: 'Aeropuerto Internacional de Monterrey (MTY)' },
      { name: 'Terminal de Autobuses de Querétaro' },
      { name: 'Centro Histórico de Querétaro' },
      { name: 'Zona Industrial Querétaro' },
      { name: 'Antea Lifestyle Center' },
    ];

    let created = 0;
    let errors = 0;

    for (const poiData of defaultPOIs) {
      try {
        // Check if already exists
        const existing = await POI.findByName(poiData.name);
        if (!existing) {
          const poi = new POI();
          poi.setName(poiData.name);

          await poi.save(null, { useMasterKey: true });
          created++;

          logger.info('POI seeded', {
            name: poiData.name,
          });
        }
      } catch (error) {
        errors++;
        logger.error('Error seeding POI', {
          poiData,
          error: error.message,
        });
      }
    }

    return { created, errors };
  }
}

// COMMENTED OUT: registerSubclass causes issues with set() + save() for boolean fields
// The BaseModel inheritance interferes with Parse.Object field updates
// Using Parse.Object.extend('POI') directly works correctly
// Parse.Object.registerSubclass('POI', POI);

module.exports = POI;
