/**
 * PriceAdjustments - Domain model for managing price adjustment factors.
 *
 * Manages different types of price adjustments with historical tracking.
 * Supports exchange rates, inflation rates, agency percentages, and transfer fees.
 *
 * Database Structure:
 * - type: Adjustment type (exchange_rate, inflation, agency, transfer)
 * - value: Adjustment value (rate or percentage)
 * - currency: Currency code for exchange rates
 * - effectiveDate: When this adjustment becomes active
 * - createdBy: User who created the adjustment
 * - note: Optional note about the adjustment
 * - active: Whether this is the current active value
 * - exists: Soft deletion flag.
 *
 * Types:
 * - exchange_rate: USD to MXN exchange rate
 * - inflation: Inflation percentage for price adjustments
 * - agency: Agency commission percentage
 * - transfer: Transfer payment fee percentage.
 * @augments BaseModel
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Create new exchange rate adjustment
 * const adjustment = new PriceAdjustments();
 * adjustment.set('type', 'exchange_rate');
 * adjustment.set('value', 18.50);
 * adjustment.set('currency', 'MXN');
 * adjustment.set('effectiveDate', new Date());
 * adjustment.set('createdBy', userPointer);
 * await adjustment.save();
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * PriceAdjustments class for managing price adjustment factors.
 * @class PriceAdjustments
 * @augments BaseModel
 */
class PriceAdjustments extends BaseModel {
  /**
   * Create a PriceAdjustments instance.
   * @example
   */
  constructor() {
    super('PriceAdjustments');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get adjustment type.
   * @returns {string} Adjustment type (exchange_rate, inflation, agency, transfer).
   * @example
   */
  getType() {
    return this.get('type');
  }

  /**
   * Set adjustment type.
   * @param {string} type - Adjustment type.
   * @example
   */
  setType(type) {
    this.set('type', type);
  }

  /**
   * Get adjustment value.
   * @returns {number} Adjustment value.
   * @example
   */
  getValue() {
    return this.get('value') || 0;
  }

  /**
   * Set adjustment value.
   * @param {number} value - Adjustment value.
   * @example
   */
  setValue(value) {
    this.set('value', parseFloat(value));
  }

  /**
   * Get currency code.
   * @returns {string} Currency code (e.g., 'MXN', 'USD').
   * @example
   */
  getCurrency() {
    return this.get('currency') || 'MXN';
  }

  /**
   * Set currency code.
   * @param {string} currency - Currency code.
   * @example
   */
  setCurrency(currency) {
    this.set('currency', currency.toUpperCase());
  }

  /**
   * Get effective date.
   * @returns {Date} Effective date.
   * @example
   */
  getEffectiveDate() {
    return this.get('effectiveDate');
  }

  /**
   * Set effective date.
   * @param {Date} date - Effective date.
   * @example
   */
  setEffectiveDate(date) {
    this.set('effectiveDate', date);
  }

  /**
   * Get created by user.
   * @returns {object} User Parse object.
   * @example
   */
  getCreatedBy() {
    return this.get('createdBy');
  }

  /**
   * Set created by user.
   * @param {object} user - User Parse object or Pointer.
   * @example
   */
  setCreatedBy(user) {
    this.set('createdBy', user);
  }

  /**
   * Get note.
   * @returns {string} Note about the adjustment.
   * @example
   */
  getNote() {
    return this.get('note') || '';
  }

  /**
   * Set note.
   * @param {string} note - Note about the adjustment.
   * @example
   */
  setNote(note) {
    this.set('note', note);
  }

  // =================
  // VALIDATION
  // =================

  /**
   * Validate price adjustment data before save.
   * @returns {object} Validation result { isValid, errors[] }.
   * @example
   */
  validate() {
    const errors = [];

    // Type validation (required)
    const validTypes = ['exchange_rate', 'inflation', 'agency', 'transfer'];
    const type = this.getType();
    if (!type || !validTypes.includes(type)) {
      errors.push(`Type must be one of: ${validTypes.join(', ')}`);
    }

    // Value validation (required)
    const value = this.getValue();
    if (!value || value <= 0) {
      errors.push('Value must be greater than 0');
    }

    // Type-specific validation
    if (type === 'exchange_rate') {
      const currency = this.getCurrency();
      if (!currency) {
        errors.push('Currency is required for exchange rate adjustments');
      }
    }

    // Effective date validation (required)
    if (!this.getEffectiveDate()) {
      errors.push('Effective date is required');
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
   * Get current active adjustment by type.
   * @param {string} type - Adjustment type.
   * @returns {Promise<PriceAdjustments>} Current active adjustment or null.
   * @example
   */
  static async getCurrentByType(type) {
    try {
      const query = new Parse.Query('PriceAdjustments');
      query.equalTo('type', type);
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.include('createdBy');
      query.descending('effectiveDate');

      const result = await query.first({ useMasterKey: true });
      return result || null;
    } catch (error) {
      logger.error('Error getting current adjustment by type', {
        type,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get adjustment history by type.
   * @param {string} type - Adjustment type.
   * @param {number} limit - Number of records to return (default: 50).
   * @returns {Promise<Array>} Array of PriceAdjustments objects.
   * @example
   */
  static async getHistoryByType(type, limit = 50) {
    try {
      const query = new Parse.Query('PriceAdjustments');
      query.equalTo('type', type);
      query.equalTo('exists', true);
      query.include('createdBy');
      query.descending('effectiveDate');
      query.limit(limit);

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting adjustment history', {
        type,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Create new adjustment and deactivate previous one.
   * @param {object} params - Adjustment parameters.
   * @param {string} params.type - Adjustment type.
   * @param {number} params.value - Adjustment value.
   * @param {string} params.currency - Currency code (for exchange rates).
   * @param {Date} params.effectiveDate - Effective date.
   * @param {string} params.createdById - User ID who created the adjustment.
   * @param {string} params.note - Optional note.
   * @returns {Promise<PriceAdjustments>} Created adjustment instance.
   * @example
   */
  static async createAdjustment(params) {
    try {
      const {
        type, value, currency, effectiveDate, createdById, note,
      } = params;

      // Deactivate current active adjustment of this type
      const currentActive = await this.getCurrentByType(type);
      if (currentActive) {
        currentActive.set('active', false);
        await currentActive.save(null, { useMasterKey: true });
      }

      // Create new adjustment
      const adjustment = new PriceAdjustments();
      adjustment.setType(type);
      adjustment.setValue(value);

      if (currency) {
        adjustment.setCurrency(currency);
      }

      adjustment.setEffectiveDate(effectiveDate);
      adjustment.setCreatedBy({
        __type: 'Pointer',
        className: '_User',
        objectId: createdById,
      });

      if (note) {
        adjustment.setNote(note);
      }

      adjustment.set('active', true);
      adjustment.set('exists', true);

      // Validate before saving
      const validation = adjustment.validate();
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      await adjustment.save(null, { useMasterKey: true });

      logger.info('Price adjustment created successfully', {
        type,
        value,
        effectiveDate,
        createdById,
      });

      return adjustment;
    } catch (error) {
      logger.error('Error creating price adjustment', {
        params,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get all current adjustments (one per type).
   * @returns {Promise<object>} Object with current adjustments by type.
   * @example
   */
  static async getAllCurrent() {
    try {
      const types = ['exchange_rate', 'inflation', 'agency', 'transfer'];
      const result = {};

      await Promise.all(types.map(async (type) => {
        result[type] = await this.getCurrentByType(type);
      }));

      return result;
    } catch (error) {
      logger.error('Error getting all current adjustments', {
        error: error.message,
      });
      return {};
    }
  }

  /**
   * Get formatted display value based on type.
   * @returns {string} Formatted display value.
   * @example
   */
  getFormattedValue() {
    const type = this.getType();
    const value = this.getValue();

    switch (type) {
      case 'exchange_rate':
        return `$${value.toFixed(2)} ${this.getCurrency()}`;
      case 'inflation':
      case 'agency':
      case 'transfer':
        return `${value.toFixed(2)}%`;
      default:
        return value.toString();
    }
  }

  /**
   * Get type display name.
   * @param {string} type - Adjustment type.
   * @returns {string} Display name.
   * @example
   */
  static getTypeDisplayName(type) {
    const displayNames = {
      exchange_rate: 'Tipo de Cambio',
      inflation: '% de Inflación',
      agency: '% de Agencia',
      transfer: '% de Transferencia',
    };
    return displayNames[type] || type;
  }
}

// Export the PriceAdjustments class
module.exports = PriceAdjustments;
