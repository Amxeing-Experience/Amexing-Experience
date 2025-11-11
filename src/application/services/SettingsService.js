/**
 * SettingsService - Business logic for system settings management.
 *
 * Provides centralized access to system configuration settings stored in MongoDB.
 * Implements in-memory caching to minimize database queries and improve performance.
 *
 * Features:
 * - In-memory caching with TTL (Time To Live)
 * - Type-safe value retrieval
 * - Category-based filtering
 * - Read-only operations (modifications via seed or direct DB access).
 *
 * Usage:
 * - Access settings throughout the application
 * - Automatic type coercion based on setting valueType
 * - Cache invalidation on update operations.
 * @class SettingsService
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * const settingsService = new SettingsService();
 *
 * // Get typed value
 * const percentage = await settingsService.getNumericValue('paymentSurchargePercentage', 0);
 * // Returns: 21.09 (number)
 *
 * // Get raw setting object
 * const setting = await settingsService.getSetting('paymentSurchargePercentage');
 * const value = setting.getTypedValue();
 *
 * // Get all settings in a category
 * const pricingSettings = await settingsService.getSettingsByCategory('pricing');
 */

const Parse = require('parse/node');
const Setting = require('../../domain/models/Setting');
const logger = require('../../infrastructure/logger');

class SettingsService {
  constructor() {
    /**
     * In-memory cache for settings to reduce database queries.
     * Structure: Map<key, { value: Setting, timestamp: number }>.
     */
    this.cache = new Map();

    /**
     * Cache TTL (Time To Live) in milliseconds.
     * Default: 60 seconds (60000ms).
     */
    this.cacheTimeout = 60000;
  }

  // ============================================================
  // READ OPERATIONS
  // ============================================================

  /**
   * Get a setting by its unique key.
   * Uses in-memory cache to minimize database queries.
   * @param {string} key - Setting key to retrieve.
   * @returns {Promise<Setting|null>} Setting instance or null if not found.
   * @example
   * const setting = await settingsService.getSetting('paymentSurchargePercentage');
   * if (setting) {
   *   const value = setting.getTypedValue();
   * }
   */
  async getSetting(key) {
    try {
      // Check cache first
      const cached = this.cache.get(key);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        logger.debug('Setting retrieved from cache', { key });
        return cached.value;
      }

      // Query database if not in cache or expired
      logger.debug('Setting cache miss, querying database', { key });
      const setting = await Setting.findByKey(key);

      // Update cache
      if (setting) {
        this.cache.set(key, {
          value: setting,
          timestamp: Date.now(),
        });
        logger.debug('Setting cached', { key });
      } else {
        logger.warn('Setting not found', { key });
      }

      return setting;
    } catch (error) {
      logger.error('Error retrieving setting', {
        key,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Get a setting value with automatic type coercion.
   * @param {string} key - Setting key to retrieve.
   * @param {*} defaultValue - Default value to return if setting not found.
   * @returns {Promise<string|number|boolean|object>} Typed value or default.
   * @example
   * // Get number value
   * const percentage = await settingsService.getValue('paymentSurchargePercentage', 0);
   *
   * // Get string value
   * const apiKey = await settingsService.getValue('stripeApiKey', '');
   *
   * // Get boolean value
   * const enabled = await settingsService.getValue('maintenanceMode', false);
   */
  async getValue(key, defaultValue = null) {
    try {
      const setting = await this.getSetting(key);
      if (!setting) {
        logger.debug('Setting not found, returning default value', {
          key,
          defaultValue,
        });
        return defaultValue;
      }

      return setting.getTypedValue();
    } catch (error) {
      logger.error('Error getting setting value', {
        key,
        error: error.message,
        defaultValue,
      });
      return defaultValue;
    }
  }

  /**
   * Get a numeric setting value with type safety.
   * @param {string} key - Setting key to retrieve.
   * @param {number} defaultValue - Default number to return if setting not found.
   * @returns {Promise<number>} Numeric value or default.
   * @example
   * const surcharge = await settingsService.getNumericValue('paymentSurchargePercentage', 0);
   * // Returns: 21.09 (guaranteed number type)
   */
  async getNumericValue(key, defaultValue = 0) {
    const value = await this.getValue(key, defaultValue);
    const numericValue = parseFloat(value);

    if (Number.isNaN(numericValue)) {
      logger.warn('Setting value is not numeric, returning default', {
        key,
        value,
        defaultValue,
      });
      return defaultValue;
    }

    return numericValue;
  }

  /**
   * Get a string setting value with type safety.
   * @param {string} key - Setting key to retrieve.
   * @param {string} defaultValue - Default string to return if setting not found.
   * @returns {Promise<string>} String value or default.
   * @example
   * const apiUrl = await settingsService.getStringValue('apiBaseUrl', 'https://api.example.com');
   */
  async getStringValue(key, defaultValue = '') {
    const value = await this.getValue(key, defaultValue);
    return String(value);
  }

  /**
   * Get a boolean setting value with type safety.
   * @param {string} key - Setting key to retrieve.
   * @param {boolean} defaultValue - Default boolean to return if setting not found.
   * @returns {Promise<boolean>} Boolean value or default.
   * @example
   * const isEnabled = await settingsService.getBooleanValue('maintenanceMode', false);
   */
  async getBooleanValue(key, defaultValue = false) {
    const value = await this.getValue(key, defaultValue);
    return value === true || value === 'true';
  }

  /**
   * Get a JSON setting value with type safety.
   * @param {string} key - Setting key to retrieve.
   * @param {object} defaultValue - Default object to return if setting not found.
   * @returns {Promise<object>} Parsed JSON object or default.
   * @example
   * const config = await settingsService.getJSONValue('emailTemplateConfig', {});
   */
  async getJSONValue(key, defaultValue = {}) {
    const value = await this.getValue(key, defaultValue);
    if (typeof value === 'object') {
      return value;
    }
    try {
      return JSON.parse(value);
    } catch (error) {
      logger.warn('Failed to parse JSON setting value, returning default', {
        key,
        value,
        error: error.message,
      });
      return defaultValue;
    }
  }

  /**
   * Get a setting by its database ID.
   * @param {string} id - Setting objectId.
   * @returns {Promise<Setting|null>} Setting instance or null if not found.
   * @example
   * const setting = await settingsService.getSettingById('abc123');
   */
  async getSettingById(id) {
    try {
      const query = new Parse.Query('Setting');
      query.equalTo('exists', true);
      const setting = await query.get(id, { useMasterKey: true });
      return setting;
    } catch (error) {
      logger.error('Error retrieving setting by ID', {
        id,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get all settings in a specific category.
   * @param {string} category - Category name to filter by.
   * @returns {Promise<Setting[]>} Array of setting instances.
   * @example
   * const pricingSettings = await settingsService.getSettingsByCategory('pricing');
   * for (const setting of pricingSettings) {
   *   console.log(setting.getKey(), setting.getTypedValue());
   * }
   */
  async getSettingsByCategory(category) {
    try {
      logger.debug('Retrieving settings by category', { category });
      const settings = await Setting.findByCategory(category);
      logger.debug('Settings retrieved', {
        category,
        count: settings.length,
      });
      return settings;
    } catch (error) {
      logger.error('Error retrieving settings by category', {
        category,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get all active settings.
   * @returns {Promise<Setting[]>} Array of all active setting instances.
   * @example
   * const allSettings = await settingsService.getAllSettings();
   */
  async getAllSettings() {
    try {
      logger.debug('Retrieving all settings');
      const settings = await Setting.findAll();
      logger.debug('All settings retrieved', { count: settings.length });
      return settings;
    } catch (error) {
      logger.error('Error retrieving all settings', {
        error: error.message,
      });
      throw error;
    }
  }

  // ============================================================
  // CACHE MANAGEMENT
  // ============================================================

  /**
   * Clear the in-memory cache.
   * Useful after direct database modifications or seed updates.
   * @example
   * // After running seed or direct DB update
   * settingsService.clearCache();
   */
  clearCache() {
    this.cache.clear();
    logger.info('Settings cache cleared');
  }

  /**
   * Invalidate a specific setting in the cache.
   * @param {string} key - Setting key to invalidate.
   * @example
   * settingsService.invalidateCache('paymentSurchargePercentage');
   */
  invalidateCache(key) {
    const deleted = this.cache.delete(key);
    if (deleted) {
      logger.debug('Setting cache invalidated', { key });
    }
  }

  /**
   * Get cache statistics for monitoring.
   * @returns {{size: number, timeout: number}} Cache stats.
   * @example
   * const stats = settingsService.getCacheStats();
   * console.log(`Cache size: ${stats.size}, TTL: ${stats.timeout}ms`);
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      timeout: this.cacheTimeout,
    };
  }

  /**
   * Set cache timeout (TTL) in milliseconds.
   * @param {number} timeout - Cache timeout in milliseconds.
   * @example
   * // Set 5-minute cache timeout
   * settingsService.setCacheTimeout(300000);
   */
  setCacheTimeout(timeout) {
    this.cacheTimeout = timeout;
    logger.info('Settings cache timeout updated', { timeout });
  }

  // ============================================================
  // VALIDATION HELPERS
  // ============================================================

  /**
   * Check if a setting exists and is active.
   * @param {string} key - Setting key to check.
   * @returns {Promise<boolean>} True if setting exists and is active.
   * @example
   * if (await settingsService.exists('paymentSurchargePercentage')) {
   *   // Setting is available
   * }
   */
  async exists(key) {
    const setting = await this.getSetting(key);
    return setting !== null && setting.get('active') === true;
  }

  /**
   * Get setting with validation.
   * Throws error if setting not found or invalid.
   * @param {string} key - Setting key to retrieve.
   * @returns {Promise<Setting>} Setting instance.
   * @throws {Error} If setting not found or invalid.
   * @example
   * try {
   *   const setting = await settingsService.getSettingRequired('paymentSurchargePercentage');
   * } catch (error) {
   *   console.error('Setting not found:', error.message);
   * }
   */
  async getSettingRequired(key) {
    const setting = await this.getSetting(key);
    if (!setting) {
      const error = new Error(`Required setting not found: ${key}`);
      logger.error('Required setting not found', { key });
      throw error;
    }

    const validation = setting.validate();
    if (!validation.valid) {
      const error = new Error(`Setting validation failed: ${validation.errors.join(', ')}`);
      logger.error('Setting validation failed', {
        key,
        errors: validation.errors,
      });
      throw error;
    }

    return setting;
  }
}

module.exports = SettingsService;
