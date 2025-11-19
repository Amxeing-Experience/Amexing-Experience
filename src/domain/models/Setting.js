/**
 * Setting - Domain model for system configuration.
 * Manages runtime-editable system settings with type-safe value handling.
 *
 * Settings provide centralized configuration management for volatile business
 * values that may change over time. Unlike environment variables which require
 * redeployment, settings are stored in MongoDB and can be modified via seed
 * updates or direct database access (programmer-only).
 *
 * Features:
 * - Type-safe value storage (string, number, boolean, json)
 * - Category organization (pricing, system, email, etc.)
 * - Editable flag for configuration protection
 * - Key uniqueness validation
 * - BaseModel lifecycle management (active/exists/audit trail).
 * @class Setting
 * @augments BaseModel
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Query a setting by key
 * const setting = await Setting.findByKey('paymentSurchargePercentage');
 * const percentage = setting.getTypedValue(); // Returns: 21.09 (number)
 *
 * // Create a new setting
 * const setting = new Setting();
 * setting.set('key', 'maxUploadSize');
 * setting.set('value', 5242880);
 * setting.set('valueType', 'number');
 * setting.set('category', 'system');
 * setting.set('description', 'Maximum file upload size in bytes');
 * setting.set('active', true);
 * setting.set('exists', true);
 * await setting.save(null, { useMasterKey: true });
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * Setting model for managing application settings.
 * Extends BaseModel to provide standardized database operations.
 * @augments BaseModel
 */
class Setting extends BaseModel {
  constructor() {
    super('Setting');
  }

  // ============================================================
  // GETTERS
  // ============================================================

  /**
   * Get the unique setting key identifier.
   * @returns {string} Setting key (e.g., 'paymentSurchargePercentage').
   * @example
   * const key = setting.getKey(); // Returns: 'paymentSurchargePercentage'
   */
  getKey() {
    return this.get('key');
  }

  /**
   * Get the raw setting value (untyped).
   * @returns {*} Raw value as stored in database.
   * @example
   * const value = setting.getValue(); // Returns: 21.09 (raw)
   */
  getValue() {
    return this.get('value');
  }

  /**
   * Get the value type indicator.
   * @returns {string} Value type: 'string' | 'number' | 'boolean' | 'json'.
   * @example
   * const type = setting.getValueType(); // Returns: 'number'
   */
  getValueType() {
    return this.get('valueType');
  }

  /**
   * Get the category for organizational grouping.
   * @returns {string} Category name (e.g., 'pricing', 'system', 'email').
   * @example
   * const category = setting.getCategory(); // Returns: 'pricing'
   */
  getCategory() {
    return this.get('category');
  }

  /**
   * Get the human-readable description.
   * @returns {string} Setting description.
   * @example
   * const desc = setting.getDescription();
   * // Returns: 'Surcharge percentage for non-cash payment methods'
   */
  getDescription() {
    return this.get('description');
  }

  /**
   * Get the display name for UI rendering.
   * @returns {string} Display name.
   * @example
   * const name = setting.getDisplayName(); // Returns: 'Surcharge de Pago con Tarjeta'
   */
  getDisplayName() {
    return this.get('displayName');
  }

  /**
   * Check if the setting is editable (programmer-only modification if false).
   * @returns {boolean} True if editable, false if protected.
   * @example
   * if (setting.isEditable()) {
   *   // Allow modification
   * }
   */
  isEditable() {
    return this.get('editable') !== false;
  }

  /**
   * Get validation rules for the setting value.
   * @returns {object|null} Validation rules object or null.
   * @example
   * const rules = setting.getValidationRules();
   * // Returns: { min: 0, max: 100 }
   */
  getValidationRules() {
    return this.get('validationRules') || null;
  }

  // ============================================================
  // SETTERS
  // ============================================================

  /**
   * Set the unique setting key identifier.
   * @param {string} key - Unique key identifier.
   * @example
   * setting.setKey('paymentSurchargePercentage');
   */
  setKey(key) {
    this.set('key', key);
  }

  /**
   * Set the setting value (will be coerced based on valueType).
   * @param {*} value - Value to store.
   * @example
   * setting.setValue(21.09);
   */
  setValue(value) {
    this.set('value', value);
  }

  /**
   * Set the value type indicator.
   * @param {string} type - Value type: 'string' | 'number' | 'boolean' | 'json'.
   * @example
   * setting.setValueType('number');
   */
  setValueType(type) {
    this.set('valueType', type);
  }

  /**
   * Set the category for organizational grouping.
   * @param {string} category - Category name.
   * @example
   * setting.setCategory('pricing');
   */
  setCategory(category) {
    this.set('category', category);
  }

  /**
   * Set the human-readable description.
   * @param {string} description - Setting description.
   * @example
   * setting.setDescription('Surcharge percentage for non-cash payment methods');
   */
  setDescription(description) {
    this.set('description', description);
  }

  /**
   * Set the display name for UI rendering.
   * @param {string} displayName - Display name.
   * @example
   * setting.setDisplayName('Surcharge de Pago con Tarjeta');
   */
  setDisplayName(displayName) {
    this.set('displayName', displayName);
  }

  /**
   * Set whether the setting is editable.
   * @param {boolean} editable - True if editable, false if protected.
   * @example
   * setting.setEditable(true);
   */
  setEditable(editable) {
    this.set('editable', editable);
  }

  /**
   * Set validation rules for the setting value.
   * @param {object} rules - Validation rules object.
   * @example
   * setting.setValidationRules({ min: 0, max: 100 });
   */
  setValidationRules(rules) {
    this.set('validationRules', rules);
  }

  // ============================================================
  // VALIDATION
  // ============================================================

  /**
   * Validate the setting data integrity.
   * @returns {{valid: boolean, errors: string[]}} Validation result.
   * @example
   * const validation = setting.validate();
   * if (!validation.valid) {
   *   console.error('Validation errors:', validation.errors);
   * }
   */
  validate() {
    const errors = [];

    // Key validation
    if (!this.getKey()) {
      errors.push('Key is required');
    }

    // Value validation
    if (this.getValue() === undefined || this.getValue() === null) {
      errors.push('Value is required');
    }

    // ValueType validation
    const validTypes = ['string', 'number', 'boolean', 'json'];
    if (!validTypes.includes(this.getValueType())) {
      errors.push(`Invalid valueType. Must be one of: ${validTypes.join(', ')}`);
    }

    // Type-specific validation
    const value = this.getValue();
    const type = this.getValueType();

    if (type === 'number' && Number.isNaN(parseFloat(value))) {
      errors.push('Value must be a valid number');
    }

    if (type === 'boolean' && typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
      errors.push('Value must be a valid boolean');
    }

    if (type === 'json') {
      try {
        if (typeof value === 'string') {
          JSON.parse(value);
        }
      } catch (e) {
        errors.push('Value must be valid JSON');
      }
    }

    // Validation rules check
    const rules = this.getValidationRules();
    if (rules && type === 'number') {
      const numValue = parseFloat(value);
      if (rules.min !== undefined && numValue < rules.min) {
        errors.push(`Value must be at least ${rules.min}`);
      }
      if (rules.max !== undefined && numValue > rules.max) {
        errors.push(`Value must be at most ${rules.max}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // ============================================================
  // TYPE COERCION
  // ============================================================

  /**
   * Get the value with proper type coercion based on valueType.
   * @returns {string|number|boolean|object} Typed value.
   * @example
   * // For 'number' type
   * const percentage = setting.getTypedValue(); // Returns: 21.09 (number)
   *
   * // For 'boolean' type
   * const enabled = setting.getTypedValue(); // Returns: true (boolean)
   *
   * // For 'json' type
   * const config = setting.getTypedValue(); // Returns: { key: 'value' } (object)
   */
  getTypedValue() {
    const value = this.getValue();
    const type = this.getValueType();

    switch (type) {
      case 'number':
        return parseFloat(value);
      case 'boolean':
        return value === true || value === 'true';
      case 'json':
        return typeof value === 'string' ? JSON.parse(value) : value;
      default:
        return String(value);
    }
  }

  // ============================================================
  // STATIC METHODS
  // ============================================================

  /**
   * Find a setting by its unique key.
   * @param {string} key - Setting key to search for.
   * @returns {Promise<Setting|undefined>} Setting instance or undefined if not found.
   * @example
   * const setting = await Setting.findByKey('paymentSurchargePercentage');
   * if (setting) {
   *   const value = setting.getTypedValue();
   * }
   */
  static async findByKey(key) {
    const query = new Parse.Query('Setting');
    query.equalTo('key', key);
    query.equalTo('exists', true);
    return await query.first({ useMasterKey: true });
  }

  /**
   * Check if a setting key is unique (not already in use).
   * @param {string} key - Setting key to check.
   * @param {string|null} excludeId - Optional setting ID to exclude from check (for updates).
   * @returns {Promise<boolean>} True if key is unique, false if already exists.
   * @example
   * // Check if key is available for new setting
   * const isUnique = await Setting.isKeyUnique('newSettingKey');
   *
   * // Check if key is unique excluding current setting (for updates)
   * const isUnique = await Setting.isKeyUnique('existingKey', settingId);
   */
  static async isKeyUnique(key, excludeId = null) {
    const query = new Parse.Query('Setting');
    query.equalTo('key', key);
    query.equalTo('exists', true);
    if (excludeId) {
      query.notEqualTo('objectId', excludeId);
    }
    const count = await query.count({ useMasterKey: true });
    return count === 0;
  }

  /**
   * Get all settings in a specific category.
   * @param {string} category - Category name to filter by.
   * @returns {Promise<Setting[]>} Array of setting instances.
   * @example
   * const pricingSettings = await Setting.findByCategory('pricing');
   */
  static async findByCategory(category) {
    const query = new Parse.Query('Setting');
    query.equalTo('category', category);
    query.equalTo('active', true);
    query.equalTo('exists', true);
    query.ascending('key');
    return await query.find({ useMasterKey: true });
  }

  /**
   * Get all active settings.
   * @returns {Promise<Setting[]>} Array of all active setting instances.
   * @example
   * const allSettings = await Setting.findAll();
   */
  static async findAll() {
    const query = new Parse.Query('Setting');
    query.equalTo('active', true);
    query.equalTo('exists', true);
    query.ascending('category');
    query.addAscending('key');
    return await query.find({ useMasterKey: true });
  }
}

// Register the Setting subclass with Parse
Parse.Object.registerSubclass('Setting', Setting);

module.exports = Setting;
