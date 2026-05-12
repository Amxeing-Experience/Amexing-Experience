const Parse = require('parse/node');
const Setting = require('../../../domain/models/Setting');
const logger = require('../../../infrastructure/logger');

/**
 * Settings API Controller.
 *
 * Handles API endpoints for system settings management:
 * - Get/update cash rounding setting
 * - Centralized configuration for pricing features.
 *
 * Created by Denisse Maldonado.
 */
class SettingsController {
  /**
   * Get cash rounding setting status.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with cash rounding setting.
   * @example
   * // GET /api/settings/cash-rounding
   * // Returns: { success: true, data: { enabled: true, lastUpdated: "2024-01-01" } }
   */
  async getCashRoundingSetting(req, res) {
    try {
      // Use direct Parse Query to find setting (consistent with save method)
      const query = new Parse.Query('Setting');
      query.equalTo('key', 'cashRoundingEnabled');
      query.equalTo('exists', true);

      const setting = await query.first({ useMasterKey: true });

      if (!setting) {
        // Default to enabled for backward compatibility
        return res.json({
          success: true,
          data: {
            enabled: true,
            lastUpdated: null,
            source: 'default',
          },
        });
      }

      // Convert stored number back to boolean (1 = true, 0 = false)
      const storedValue = setting.get('value');
      const enabled = storedValue === 1 || storedValue === true || storedValue === 'true';

      logger.info('Retrieved cash rounding setting:', {
        storedValue,
        convertedEnabled: enabled,
        valueType: setting.get('valueType'),
      });

      return res.json({
        success: true,
        data: {
          enabled,
          lastUpdated: setting.get('updatedAt'),
          source: 'database',
        },
      });
    } catch (error) {
      logger.error('Error getting cash rounding setting:', error);
      return res.status(500).json({
        success: false,
        error: 'Error al obtener configuración de redondeo',
      });
    }
  }

  /**
   * Update cash rounding setting.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with updated setting.
   * @example
   * // PUT /api/settings/cash-rounding
   * // Body: { enabled: false }
   * // Returns: { success: true, data: { enabled: false } }
   */
  async updateCashRoundingSetting(req, res) {
    try {
      const { enabled } = req.body;
      logger.info('updateCashRoundingSetting called', { enabled, bodyType: typeof enabled });

      // Validate input
      if (typeof enabled !== 'boolean') {
        logger.warn('Invalid input type for enabled', { enabled, type: typeof enabled });
        return res.status(400).json({
          success: false,
          error: 'El valor "enabled" debe ser true o false',
        });
      }

      // Use direct Parse Query to find/create setting (bypass Setting model completely)
      logger.info('Step 1: Using direct Parse Query to find cashRoundingEnabled setting...');
      const query = new Parse.Query('Setting');
      query.equalTo('key', 'cashRoundingEnabled');
      query.equalTo('exists', true);

      const existingSetting = await query.first({ useMasterKey: true });
      logger.info('Direct query result:', { exists: !!existingSetting, settingId: existingSetting?.id });

      // Always create a fresh Parse Object to avoid any prototype/inheritance issues
      logger.info('Step 2: Creating fresh Parse Object to avoid any corruption issues...');
      const setting = new Parse.Object('Setting');

      if (existingSetting) {
        logger.info('Step 2a: Copying data from existing setting to fresh Parse Object...');
        // Copy ID to make it an update operation
        setting.id = existingSetting.id;
        // Copy existing values
        setting.set('key', existingSetting.get('key') || 'cashRoundingEnabled');
        setting.set('category', existingSetting.get('category') || 'pricing');
        setting.set('displayName', existingSetting.get('displayName') || 'Redondeo para Efectivo');
        setting.set('description', existingSetting.get('description') || 'Habilitar redondeo a múltiplos de $5 MXN para pagos en efectivo');
        setting.set('editable', existingSetting.get('editable') !== false); // default true
        setting.set('active', existingSetting.get('active') !== false); // default true
        setting.set('exists', existingSetting.get('exists') !== false); // default true
        logger.info('✅ Step 2a completed - Existing data copied to fresh Parse Object');
      } else {
        logger.info('Step 2b: Setting up fresh Parse Object with initial values...');
        // Set all required fields for new setting
        setting.set('key', 'cashRoundingEnabled');
        setting.set('category', 'pricing');
        setting.set('displayName', 'Redondeo para Efectivo');
        setting.set('description', 'Habilitar redondeo a múltiplos de $5 MXN para pagos en efectivo');
        setting.set('editable', true);
        setting.set('active', true);
        setting.set('exists', true);
        logger.info('✅ Step 2b completed - Fresh Parse Object created with initial values');
      }

      // Step 3: Set value using direct Parse Object operations only
      logger.info('Step 3: Setting value using direct Parse Object operations...');

      // Convert boolean to number to match schema expectations
      const valueAsNumber = enabled ? 1 : 0;
      logger.info('Converting boolean to number for schema compatibility:', {
        originalValue: enabled,
        convertedValue: valueAsNumber,
        originalType: typeof enabled,
        convertedType: typeof valueAsNumber,
      });

      setting.set('value', valueAsNumber);
      setting.set('valueType', 'boolean');

      logger.info('✅ Step 3 completed - Direct Parse Object value set worked');

      // Step 4: Log setting state before save (using direct Parse Object gets)
      logger.info('Step 4: Parse Object state before save:', {
        key: setting.get('key'),
        value: setting.get('value'),
        valueType: setting.get('valueType'),
        category: setting.get('category'),
        displayName: setting.get('displayName'),
        description: setting.get('description'),
        editable: setting.get('editable'),
        active: setting.get('active'),
        exists: setting.get('exists'),
        isNew: !setting.id,
        className: setting.className,
        objectType: setting.constructor?.name || 'Unknown',
      });

      // Step 5: Save the setting using direct Parse Object save
      logger.info('Step 5: Saving cash rounding setting with direct Parse Object...');
      await setting.save(null, { useMasterKey: true });
      logger.info('✅ Step 5 completed - Cash rounding setting saved successfully!', {
        settingId: setting.id,
        finalValue: setting.get('value'),
        finalValueType: setting.get('valueType'),
      });

      logger.info(`Cash rounding setting updated: ${enabled} by user ${req.userRole || 'unknown'}`);

      return res.json({
        success: true,
        data: {
          enabled,
          lastUpdated: setting.get('updatedAt'),
        },
      });
    } catch (error) {
      logger.error('❌ MAIN ERROR - Cash rounding setting update failed:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
        code: error.code,
        cause: error.cause,
        toString: error.toString(),
        type: typeof error,
        constructor: error.constructor?.name,
        details: error.details || 'No additional details',
        parseError: error.error || 'No parse error details',
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      });
      return res.status(500).json({
        success: false,
        error: 'Error al actualizar configuración de redondeo',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        debugInfo: process.env.NODE_ENV === 'development' ? {
          errorName: error.name,
          errorCode: error.code,
        } : undefined,
      });
    }
  }

  /**
   * Get all pricing-related settings.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with all pricing settings.
   * @example
   * // GET /api/settings/pricing
   * // Returns: { success: true, data: [{ key: 'cashRoundingEnabled', value: true }, ...] }
   */
  async getPricingSettings(req, res) {
    try {
      const settings = await Setting.findByCategory('pricing');

      const formattedSettings = settings.map((setting) => ({
        key: setting.getKey(),
        value: setting.getTypedValue(),
        displayName: setting.getDisplayName(),
        description: setting.getDescription(),
        lastUpdated: setting.get('updatedAt'),
        editable: setting.isEditable(),
      }));

      return res.json({
        success: true,
        data: formattedSettings,
      });
    } catch (error) {
      logger.error('Error getting pricing settings:', error);
      return res.status(500).json({
        success: false,
        error: 'Error al obtener configuraciones de precios',
      });
    }
  }
}

module.exports = SettingsController;
