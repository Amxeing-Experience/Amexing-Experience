/**
 * VehicleType - Domain model for vehicle type classification.
 *
 * Manages the catalog of vehicle types used throughout the system.
 * Provides dynamic vehicle classification instead of hardcoded string values.
 *
 * Lifecycle States:
 * - active: true, exists: true = Available for selection in UI and API
 * - active: false, exists: true = Hidden from selection but preserved in existing vehicles
 * - active: false, exists: false = Soft deleted (audit trail only).
 * @augments BaseModel
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2025-10-14
 * @example
 * // Create new vehicle type
 * const sedan = new VehicleType();
 * sedan.set('name', 'Sedan');
 * sedan.set('code', 'sedan');
 * sedan.set('defaultCapacity', 4);
 * await sedan.save();
 *
 * // Query active vehicle types
 * const activeTypes = await VehicleType.queryActive('VehicleType').find();
 *
 * // Find by code
 * const suvType = await VehicleType.findByCode('suv');
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * VehicleType class for managing vehicle classification catalog.
 * @class VehicleType
 * @augments BaseModel
 */
class VehicleType extends BaseModel {
  /**
   * Create a VehicleType instance.
   * @example
   */
  constructor() {
    super('VehicleType');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get vehicle type name.
   * @returns {string} Vehicle type name (e.g., "Sedan").
   * @example
   */
  getName() {
    return this.get('name');
  }

  /**
   * Set vehicle type name.
   * @param {string} name - Display name.
   * @example
   */
  setName(name) {
    this.set('name', name);
  }

  /**
   * Get vehicle type code.
   * @returns {string} Unique code (e.g., "sedan").
   * @example
   */
  getCode() {
    return this.get('code');
  }

  /**
   * Set vehicle type code (must be unique).
   * @param {string} code - Unique type code.
   * @example
   */
  setCode(code) {
    this.set('code', code.toLowerCase());
  }

  /**
   * Get vehicle type description.
   * @returns {string} Description text.
   * @example
   */
  getDescription() {
    return this.get('description') || '';
  }

  /**
   * Set vehicle type description.
   * @param {string} description - Type description.
   * @example
   */
  setDescription(description) {
    this.set('description', description);
  }

  /**
   * Get Tabler icon name.
   * @returns {string} Icon name for UI.
   * @example
   */
  getIcon() {
    return this.get('icon') || 'car';
  }

  /**
   * Set Tabler icon name.
   * @param {string} icon - Icon name.
   * @example
   */
  setIcon(icon) {
    this.set('icon', icon);
  }

  /**
   * Get default passenger capacity.
   * @returns {number} Default capacity.
   * @example
   */
  getDefaultCapacity() {
    return this.get('defaultCapacity') || 4;
  }

  /**
   * Set default passenger capacity.
   * @param {number} capacity - Default capacity.
   * @example
   */
  setDefaultCapacity(capacity) {
    this.set('defaultCapacity', capacity);
  }

  /**
   * Get sort order.
   * @returns {number} Display order.
   * @example
   */
  getSortOrder() {
    return this.get('sortOrder') || 0;
  }

  /**
   * Set sort order.
   * @param {number} order - Display order.
   * @example
   */
  setSortOrder(order) {
    this.set('sortOrder', order);
  }

  // =================
  // BUSINESS LOGIC
  // =================

  /**
   * Validate vehicle type data before save.
   * @returns {object} Validation result {valid: boolean, errors: string[]}.
   * @example
   */
  validate() {
    const errors = [];

    if (!this.getName()) {
      errors.push('Name is required');
    }

    if (!this.getCode()) {
      errors.push('Code is required');
    }

    if (this.getCode() && !/^[a-z0-9_-]+$/.test(this.getCode())) {
      errors.push(
        'Code must contain only lowercase letters, numbers, hyphens and underscores'
      );
    }

    const capacity = this.getDefaultCapacity();
    if (capacity && (capacity < 1 || capacity > 100)) {
      errors.push('Default capacity must be between 1 and 100');
    }

    const sortOrder = this.getSortOrder();
    if (sortOrder < 0) {
      errors.push('Sort order must be non-negative');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if this vehicle type can be deleted.
   * @returns {Promise<object>} {canDelete: boolean, reason: string}.
   * @example
   */
  async canDelete() {
    try {
      // Check if any vehicles are using this type
      const Vehicle = Parse.Object.extend('Vehicle');
      const query = new Parse.Query(Vehicle);
      query.equalTo('vehicleTypeId', this);
      query.equalTo('exists', true);

      const count = await query.count({ useMasterKey: true });

      if (count > 0) {
        return {
          canDelete: false,
          reason: `Cannot delete: ${count} vehicle(s) are using this type`,
        };
      }

      return {
        canDelete: true,
        reason: null,
      };
    } catch (error) {
      logger.error('Error checking vehicle type deletion', {
        vehicleTypeId: this.id,
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
   * Find vehicle type by code.
   * @param {string} code - Type code.
   * @returns {Promise<VehicleType|undefined>} Vehicle type or undefined.
   * @example
   */
  static async findByCode(code) {
    try {
      const query = new Parse.Query('VehicleType');
      query.equalTo('code', code.toLowerCase());
      query.equalTo('exists', true);

      const result = await query.first({ useMasterKey: true });
      return result;
    } catch (error) {
      logger.error('Error finding vehicle type by code', {
        code,
        error: error.message,
      });
      return undefined;
    }
  }

  /**
   * Get all active vehicle types ordered by sortOrder.
   * @returns {Promise<VehicleType[]>} Array of active vehicle types.
   * @example
   */
  static async getActiveTypes() {
    try {
      const query = BaseModel.queryActive('VehicleType');
      query.ascending('sortOrder');
      query.limit(100);

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting active vehicle types', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get vehicle types for dropdown/select options.
   * @returns {Promise<Array>} Array of {value, label, capacity}.
   * @example
   */
  static async getSelectOptions() {
    try {
      const types = await VehicleType.getActiveTypes();

      return types.map((type) => ({
        value: type.id,
        label: type.getName(),
        code: type.getCode(),
        capacity: type.getDefaultCapacity(),
        icon: type.getIcon(),
      }));
    } catch (error) {
      logger.error('Error getting vehicle type select options', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Check if code is unique.
   * @param {string} code - Code to check.
   * @param {string} excludeId - Exclude this ID from check (for updates).
   * @returns {Promise<boolean>} True if code is unique.
   * @example
   */
  static async isCodeUnique(code, excludeId = null) {
    try {
      const query = new Parse.Query('VehicleType');
      query.equalTo('code', code.toLowerCase());
      query.equalTo('exists', true);

      if (excludeId) {
        query.notEqualTo('objectId', excludeId);
      }

      const count = await query.count({ useMasterKey: true });
      return count === 0;
    } catch (error) {
      logger.error('Error checking vehicle type code uniqueness', {
        code,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Seed default vehicle types.
   * @returns {Promise<object>} {created: number, errors: number}.
   * @example
   */
  static async seedDefaults() {
    const defaultTypes = [
      {
        name: 'Sedan',
        code: 'sedan',
        description: 'Vehículo de pasajeros estándar',
        icon: 'car',
        defaultCapacity: 4,
        sortOrder: 1,
      },
      {
        name: 'SUV',
        code: 'suv',
        description: 'Vehículo utilitario deportivo',
        icon: 'car-suv',
        defaultCapacity: 6,
        sortOrder: 2,
      },
      {
        name: 'Van',
        code: 'van',
        description: 'Van de pasajeros',
        icon: 'bus',
        defaultCapacity: 8,
        sortOrder: 3,
      },
      {
        name: 'Bus',
        code: 'bus',
        description: 'Autobús de pasajeros',
        icon: 'bus',
        defaultCapacity: 20,
        sortOrder: 4,
      },
      {
        name: 'Limousine',
        code: 'limousine',
        description: 'Limusina de lujo',
        icon: 'car-garage',
        defaultCapacity: 8,
        sortOrder: 5,
      },
    ];

    let created = 0;
    let errors = 0;

    for (const typeData of defaultTypes) {
      try {
        // Check if already exists
        const existing = await VehicleType.findByCode(typeData.code);
        if (!existing) {
          const vehicleType = new VehicleType();
          vehicleType.setName(typeData.name);
          vehicleType.setCode(typeData.code);
          vehicleType.setDescription(typeData.description);
          vehicleType.setIcon(typeData.icon);
          vehicleType.setDefaultCapacity(typeData.defaultCapacity);
          vehicleType.setSortOrder(typeData.sortOrder);

          await vehicleType.save(null, { useMasterKey: true });
          created++;

          logger.info('Vehicle type seeded', {
            name: typeData.name,
            code: typeData.code,
          });
        }
      } catch (error) {
        errors++;
        logger.error('Error seeding vehicle type', {
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
// Using Parse.Object.extend('VehicleType') directly works correctly
// Parse.Object.registerSubclass('VehicleType', VehicleType);

module.exports = VehicleType;
