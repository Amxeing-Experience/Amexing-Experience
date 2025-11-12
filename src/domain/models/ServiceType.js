/**
 * ServiceType - Domain model for service/transfer type classification.
 *
 * Manages the catalog of service types (transportation types) used throughout the system.
 * Provides simple classification for transfers: Airport, Point-to-Point, Local, etc.
 *
 * Lifecycle States:
 * - active: true, exists: true = Available for selection in UI and API
 * - active: false, exists: true = Hidden from selection but preserved in existing services
 * - active: false, exists: false = Soft deleted (audit trail only).
 * @augments BaseModel
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Create new service type
 * const airport = new ServiceType();
 * airport.set('name', 'Aeropuerto');
 * await airport.save();
 *
 * // Query active service types
 * const activeTypes = await ServiceType.queryActive('ServiceType').find();
 *
 * // Find by name
 * const airportType = await ServiceType.findByName('Aeropuerto');
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * ServiceType class for managing service type catalog.
 * @class ServiceType
 * @augments BaseModel
 */
class ServiceType extends BaseModel {
  /**
   * Create a ServiceType instance.
   * @example
   * // Usage example documented above
   */
  constructor() {
    super('ServiceType');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get service type name.
   * @returns {string} Service type name (e.g., "Aeropuerto").
   * @example
   * // Usage example documented above
   */
  getName() {
    return this.get('name');
  }

  /**
   * Set service type name.
   * @param {string} name - Display name.
   * @example
   * // Usage example documented above
   */
  setName(name) {
    this.set('name', name);
  }

  // =================
  // BUSINESS LOGIC
  // =================

  /**
   * Validate service type data before save.
   * @returns {object} Validation result {valid: boolean, errors: string[]}.
   * @example
   * // Usage example documented above
   */
  validate() {
    const errors = [];

    if (!this.getName()) {
      errors.push('Name is required');
    }

    if (this.getName() && this.getName().length > 100) {
      errors.push('Name must be 100 characters or less');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if this service type can be deleted.
   * @returns {Promise<object>} {canDelete: boolean, reason: string}.
   * @example
   * // Usage example documented above
   */
  async canDelete() {
    try {
      // Check if any services are using this type
      // TODO: Uncomment when Service model adds serviceType relationship
      /*
      const Service = Parse.Object.extend('Service');
      const query = new Parse.Query(Service);
      query.equalTo('serviceType', this);
      query.equalTo('exists', true);

      const count = await query.count({ useMasterKey: true });

      if (count > 0) {
        return {
          canDelete: false,
          reason: `Cannot delete: ${count} service(s) are using this type`,
        };
      }
      */

      // For now, allow deletion as Service doesn't have serviceType field yet
      return {
        canDelete: true,
        reason: null,
      };
    } catch (error) {
      logger.error('Error checking service type deletion', {
        serviceTypeId: this.id,
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
   * Find service type by name.
   * @param {string} name - Type name.
   * @returns {Promise<ServiceType|undefined>} Service type or undefined.
   * @example
   * // Usage example documented above
   */
  static async findByName(name) {
    try {
      const query = new Parse.Query('ServiceType');
      query.equalTo('name', name);
      query.equalTo('exists', true);

      const result = await query.first({ useMasterKey: true });
      return result;
    } catch (error) {
      logger.error('Error finding service type by name', {
        name,
        error: error.message,
      });
      return undefined;
    }
  }

  /**
   * Get all active service types ordered by name.
   * @returns {Promise<ServiceType[]>} Array of active service types.
   * @example
   * // Usage example documented above
   */
  static async getActiveTypes() {
    try {
      const query = BaseModel.queryActive('ServiceType');
      query.ascending('name');
      query.limit(100);

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting active service types', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get service types for dropdown/select options.
   * @returns {Promise<Array>} Array of {value, label}.
   * @example
   * // Usage example documented above
   */
  static async getSelectOptions() {
    try {
      const types = await ServiceType.getActiveTypes();

      return types.map((type) => ({
        value: type.id,
        label: type.getName(),
      }));
    } catch (error) {
      logger.error('Error getting service type select options', {
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
      const query = new Parse.Query('ServiceType');
      query.equalTo('name', name);
      query.equalTo('exists', true);

      if (excludeId) {
        query.notEqualTo('objectId', excludeId);
      }

      const count = await query.count({ useMasterKey: true });
      return count === 0;
    } catch (error) {
      logger.error('Error checking service type name uniqueness', {
        name,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Seed default service types.
   * Creates the initial 3 service types: Aeropuerto, Punto a Punto, Local.
   * @returns {Promise<object>} {created: number, errors: number}.
   * @example
   * // Usage example documented above
   */
  static async seedDefaults() {
    const defaultTypes = [
      {
        name: 'Aeropuerto',
      },
      {
        name: 'Punto a Punto',
      },
      {
        name: 'Local',
      },
    ];

    let created = 0;
    let errors = 0;

    for (const typeData of defaultTypes) {
      try {
        // Check if already exists
        const existing = await ServiceType.findByName(typeData.name);
        if (!existing) {
          // IMPORTANT: Use Parse.Object.extend instead of ServiceType class
          // The registered ServiceType class (BaseModel subclass) has issues with set() + save()
          // Using Parse.Object.extend directly works correctly
          const ServiceTypeClass = Parse.Object.extend('ServiceType');
          const serviceType = new ServiceTypeClass();

          serviceType.set('name', typeData.name);
          serviceType.set('active', true);
          serviceType.set('exists', true);

          await serviceType.save(null, { useMasterKey: true });
          created++;

          logger.info('Service type seeded', {
            name: typeData.name,
          });
        }
      } catch (error) {
        errors++;
        logger.error('Error seeding service type', {
          typeData,
          error: error.message,
        });
      }
    }

    return { created, errors };
  }
}

// COMMENTED OUT: registerSubclass causes issues with set() + save() for boolean fields
// The BaseModel inheritance interferes with Parse.Object field updates
// Using Parse.Object.extend('ServiceType') directly works correctly
// Parse.Object.registerSubclass('ServiceType', ServiceType);

module.exports = ServiceType;
