/**
 * Rate - Domain model for pricing rates management.
 *
 * Manages the catalog of pricing rates with percentage-based pricing.
 * Provides dynamic rate classification for service pricing.
 *
 * Lifecycle States:
 * - active: true, exists: true = Available for selection in UI and API
 * - active: false, exists: true = Hidden from selection but preserved in bookings
 * - active: false, exists: false = Soft deleted (audit trail only).
 * @augments BaseModel
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Create new Rate
 * const standardRate = new Rate();
 * standardRate.set('name', 'Tarifa Estándar');
 * standardRate.set('percentage', 10);
 * await standardRate.save();
 *
 * // Query active Rates
 * const activeRates = await Rate.queryActive('Rate').find();
 *
 * // Find by name
 * const rate = await Rate.findByName('Tarifa Estándar');
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * Rate class for managing pricing rates catalog.
 * @class Rate
 * @augments BaseModel
 */
class Rate extends BaseModel {
  /**
   * Create a Rate instance.
   * @example
   * // Usage example documented above
   */
  constructor() {
    super('Rate');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get Rate name.
   * @returns {string} Rate name (e.g., "Tarifa Estándar").
   * @example
   * // Usage example documented above
   */
  getName() {
    return this.get('name');
  }

  /**
   * Set Rate name.
   * @param {string} name - Display name.
   * @example
   * // Usage example documented above
   */
  setName(name) {
    this.set('name', name);
  }

  /**
   * Get Rate percentage.
   * @returns {number} Rate percentage value (e.g., 10 for 10%).
   * @example
   * // Usage example documented above
   */
  getPercentage() {
    return this.get('percentage');
  }

  /**
   * Set Rate percentage.
   * @param {number} percentage - Percentage value (0-100).
   * @example
   * // Usage example documented above
   */
  setPercentage(percentage) {
    this.set('percentage', percentage);
  }

  /**
   * Get formatted percentage string.
   * @returns {string} Formatted percentage (e.g., "10%").
   * @example
   * // Usage example documented above
   */
  getFormattedPercentage() {
    const percentage = this.getPercentage();
    return percentage !== undefined && percentage !== null ? `${percentage}%` : '-';
  }

  /**
   * Get Rate color.
   * @returns {string} Hex color code (e.g., "#6366F1").
   * @example
   * // Usage example documented above
   */
  getColor() {
    return this.get('color') || '#6366F1';
  }

  /**
   * Set Rate color.
   * @param {string} color - Hex color code (#RRGGBB).
   * @example
   * // Usage example documented above
   */
  setColor(color) {
    this.set('color', color);
  }

  // =================
  // BUSINESS LOGIC
  // =================

  /**
   * Validate Rate data before save.
   * @returns {object} Validation result {valid: boolean, errors: string[]}.
   * @example
   * // Usage example documented above
   */
  validate() {
    const errors = [];

    // Validate name
    if (!this.getName()) {
      errors.push('Name is required');
    }

    if (this.getName() && this.getName().trim().length === 0) {
      errors.push('Name cannot be empty');
    }

    if (this.getName() && this.getName().length > 200) {
      errors.push('Name must be 200 characters or less');
    }

    // Validate percentage
    const percentage = this.getPercentage();
    if (percentage === undefined || percentage === null) {
      errors.push('Percentage is required');
    }

    if (typeof percentage !== 'number') {
      errors.push('Percentage must be a number');
    }

    if (percentage !== undefined && percentage !== null) {
      if (percentage < 0 || percentage > 100) {
        errors.push('Percentage must be between 0 and 100');
      }
    }

    // Validate color format (optional field)
    const color = this.getColor();
    if (color) {
      const hexColorRegex = /^#[0-9A-F]{6}$/i;
      if (!hexColorRegex.test(color)) {
        errors.push('Color must be in hexadecimal format (#RRGGBB)');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if this Rate can be deleted.
   * Future implementation: check if any bookings reference this Rate.
   * @returns {Promise<object>} {canDelete: boolean, reason: string}.
   * @example
   * // Usage example documented above
   */
  async canDelete() {
    try {
      // TODO: In future phases, check if any ServiceRequest references this Rate
      // For now, allow deletion
      return {
        canDelete: true,
        reason: null,
      };
    } catch (error) {
      logger.error('Error checking Rate deletion', {
        rateId: this.id,
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
   * Find Rate by name (case insensitive).
   * @param {string} name - Rate name.
   * @returns {Promise<Rate|undefined>} Rate or undefined.
   * @example
   * // Usage example documented above
   */
  static async findByName(name) {
    try {
      const query = new Parse.Query('Rate');
      query.matches('name', name, 'i'); // Case insensitive
      query.equalTo('exists', true);

      const result = await query.first({ useMasterKey: true });
      return result;
    } catch (error) {
      logger.error('Error finding Rate by name', {
        name,
        error: error.message,
      });
      return undefined;
    }
  }

  /**
   * Get all active Rates ordered by name.
   * @returns {Promise<Rate[]>} Array of active Rates.
   * @example
   * // Usage example documented above
   */
  static async getActiveRates() {
    try {
      const query = BaseModel.queryActive('Rate');
      query.ascending('name');
      query.limit(1000);

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting active Rates', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get Rates for dropdown/select options.
   * @returns {Promise<Array>} Array of {value, label, percentage}.
   * @example
   * // Usage example documented above
   */
  static async getSelectOptions() {
    try {
      const rates = await Rate.getActiveRates();

      return rates.map((rate) => ({
        value: rate.id,
        label: rate.getName(),
        percentage: rate.getPercentage(),
        formattedPercentage: rate.getFormattedPercentage(),
      }));
    } catch (error) {
      logger.error('Error getting Rate select options', {
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
      const query = new Parse.Query('Rate');
      query.matches('name', name, 'i'); // Case insensitive
      query.equalTo('exists', true);

      if (excludeId) {
        query.notEqualTo('objectId', excludeId);
      }

      const count = await query.count({ useMasterKey: true });
      return count === 0;
    } catch (error) {
      logger.error('Error checking Rate name uniqueness', {
        name,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Seed default Rates.
   * @returns {Promise<object>} {created: number, errors: number}.
   * @example
   * // Usage example documented above
   */
  static async seedDefaults() {
    const defaultRates = [
      { name: 'Tarifa Estándar', percentage: 0 },
      { name: 'Tarifa Corporativa', percentage: 10 },
      { name: 'Tarifa Premium', percentage: 15 },
      { name: 'Tarifa VIP', percentage: 20 },
      { name: 'Descuento Departamental', percentage: 5 },
    ];

    let created = 0;
    let errors = 0;

    for (const rateData of defaultRates) {
      try {
        // Check if already exists
        const existing = await Rate.findByName(rateData.name);
        if (!existing) {
          const rate = new Rate();
          rate.setName(rateData.name);
          rate.setPercentage(rateData.percentage);

          await rate.save(null, { useMasterKey: true });
          created++;

          logger.info('Rate seeded', {
            name: rateData.name,
            percentage: rateData.percentage,
          });
        }
      } catch (error) {
        errors++;
        logger.error('Error seeding Rate', {
          rateData,
          error: error.message,
        });
      }
    }

    return { created, errors };
  }
}

// COMMENTED OUT: registerSubclass causes issues with set() + save() for boolean fields
// The BaseModel inheritance interferes with Parse.Object field updates
// Using Parse.Object.extend('Rate') directly works correctly
// Parse.Object.registerSubclass('Rate', Rate);

module.exports = Rate;
