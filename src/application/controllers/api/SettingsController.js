const Parse = require('parse/node');
const Setting = require('../../../domain/models/Setting');
const logger = require('../../../infrastructure/logger');
const SettingsService = require('../../services/SettingsService');
const {
  getGatewayRegistry,
  encodeGatewayId,
  decodeGatewayCode,
} = require('../../services/payments/gatewayBootstrap');

// Shared metadata for the activePaymentGateway toggle (kept in sync with seed 008 so a
// setting created here via PUT matches one created by the seed). The toggle is stored as a
// numeric code (0 = 'stripe', 1 = 'mexican') because Setting.value is a Number column; the
// numeric default lives inline in the getNumericValue(...) call below (code 0), so no
// string default constant is needed here.
const ACTIVE_GATEWAY_KEY = 'activePaymentGateway';
const ACTIVE_GATEWAY_DEFAULT_CODE = 0;
// Gateway ids are short enums ('stripe'/'mexican'); cap the accepted input so a giant
// payload is never lowercased or reflected back in an error (repo text-clamp rule).
const MAX_GATEWAY_ID_LENGTH = 32;
const ACTIVE_GATEWAY_DISPLAY_NAME = 'Pasarela de Pago Activa';
const ACTIVE_GATEWAY_DESCRIPTION = 'Pasarela que procesa los cobros en línea en MXN. Se almacena como número: 0 = Stripe, 1 = pasarela mexicana (Openpay). El API traduce ese código a los identificadores "stripe"/"mexican"; el número nunca se expone por el API. Los cobros en USD siempre se procesan por Stripe, sin importar este ajuste.';

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
   * Get the active payment gateway toggle (which gateway processes MXN online charges).
   * Read path: goes through SettingsService (cached read) to fetch the numeric code (0/1),
   * then decodes it to the string id at the API boundary. The raw number never leaves here;
   * an unknown/corrupt code decodes to 'stripe' (safe default) rather than 500ing.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with the active gateway + registered ids.
   * @example
   * // GET /api/settings/active-gateway
   * // Returns: { success: true, data: { gateway: 'stripe', availableGateways: ['stripe','mexican'] } }
   */
  async getActivePaymentGateway(req, res) {
    try {
      const code = await new SettingsService().getNumericValue(
        ACTIVE_GATEWAY_KEY,
        ACTIVE_GATEWAY_DEFAULT_CODE
      );
      const gateway = decodeGatewayCode(code);

      return res.json({
        success: true,
        data: {
          gateway,
          availableGateways: getGatewayRegistry().list(),
        },
      });
    } catch (error) {
      logger.error('Error getting active payment gateway:', error);
      return res.status(500).json({
        success: false,
        error: 'Error al obtener la pasarela de pago activa',
      });
    }
  }

  /**
   * Update the active payment gateway toggle.
   *
   * Rejection rule (single reason): the requested gateway must be REGISTERED in the
   * GatewayRegistry. It is deliberately NOT gated on isConfigured() -- in this phase both
   * adapters report isConfigured() === false, so gating on it would make the endpoint
   * (and even the default 'stripe') unsettable. GatewayRouter already covers "toggle
   * points to a registered-but-unconfigured gateway" by falling back to Stripe.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with the normalized gateway id.
   * @example
   * // PUT /api/settings/active-gateway
   * // Body: { gateway: 'mexican' }
   * // Returns: { success: true, data: { gateway: 'mexican' } }
   */
  async updateActivePaymentGateway(req, res) {
    try {
      const { gateway } = req.body;

      // 1. Validate it is a non-empty string (after trim).
      if (typeof gateway !== 'string' || gateway.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'El campo gateway es requerido y debe ser texto',
        });
      }

      // 1b. Clamp length before any further processing or reflecting it in an error
      // (repo rule: bound every text input server-side). Gateway ids are short enums
      // ('stripe'/'mexican'); anything past MAX_GATEWAY_ID_LENGTH cannot be a valid id, so
      // reject it up front instead of lowercasing/echoing an arbitrarily large payload.
      if (gateway.length > MAX_GATEWAY_ID_LENGTH) {
        return res.status(400).json({
          success: false,
          error: 'El campo gateway excede la longitud permitida',
        });
      }

      // 2. Normalize the same way GatewayRouter.resolveMxnToggle does (trim + lowercase),
      // so 'Stripe' / ' MEXICAN ' are accepted like 'stripe' / 'mexican'.
      const id = String(gateway).trim().toLowerCase();

      // 3. Only reason to reject: the id is not registered (never leak adapter internals).
      if (!getGatewayRegistry().has(id)) {
        return res.status(400).json({
          success: false,
          error: `Pasarela desconocida: ${id}`,
        });
      }

      // 4. Persist via a direct Parse.Object (SettingsService is read-only by design).
      // Same fresh-object pattern as updateCashRoundingSetting: find existing, copy its
      // metadata onto a new Parse.Object, set the value, save.
      // Known limitation (preexisting, shared with cash-rounding, NOT unique to this toggle):
      // Setting.key has no unique DB index, so if the row does not exist yet, two concurrent
      // writers (PUT+PUT, or a PUT racing the first seed) can each insert a row and later
      // reads via findByKey().first() become non-deterministic. The window is narrow (only
      // before the seed has ever created the row, or after a seed rollback) and admin-only.
      // Deferred to a dedicated Setting-hardening change (unique index on key); tracked here
      // so a future money-routing reader is aware.
      const query = new Parse.Query('Setting');
      query.equalTo('key', ACTIVE_GATEWAY_KEY);
      query.equalTo('exists', true);
      const existingSetting = await query.first({ useMasterKey: true });

      const setting = new Parse.Object('Setting');
      if (existingSetting) {
        setting.id = existingSetting.id;
        setting.set('key', existingSetting.get('key') || ACTIVE_GATEWAY_KEY);
        setting.set('category', existingSetting.get('category') || 'payments');
        setting.set('displayName', existingSetting.get('displayName') || ACTIVE_GATEWAY_DISPLAY_NAME);
        setting.set('description', existingSetting.get('description') || ACTIVE_GATEWAY_DESCRIPTION);
        setting.set('editable', existingSetting.get('editable') !== false);
        setting.set('active', existingSetting.get('active') !== false);
        setting.set('exists', existingSetting.get('exists') !== false);
      } else {
        setting.set('key', ACTIVE_GATEWAY_KEY);
        setting.set('category', 'payments');
        setting.set('displayName', ACTIVE_GATEWAY_DISPLAY_NAME);
        setting.set('description', ACTIVE_GATEWAY_DESCRIPTION);
        setting.set('editable', true);
        setting.set('active', true);
        setting.set('exists', true);
      }

      // Persist the numeric code, never the string id: Setting.value is a Number column.
      // encodeGatewayId is safe here because `id` was already validated against the
      // registry above (its ids match the encoder's mapping).
      setting.set('value', encodeGatewayId(id));
      setting.set('valueType', 'number');

      await setting.save(null, { useMasterKey: true });

      // 5. No cache invalidation is done here on purpose. The read path
      // (getActivePaymentGateway) builds a fresh SettingsService per request, so its cache
      // Map always starts empty and it never serves a stale toggle -- there is no live cache
      // to invalidate. Calling invalidateCache() on a new SettingsService would be a no-op
      // (it would delete a key from an empty, throwaway Map), so it is deliberately omitted
      // rather than left as a misleading safeguard.
      // Contract for PR4: read the toggle fresh per charge (new SettingsService()) OR, if the
      // charge path caches it on a long-lived shared SettingsService, invalidate THAT same
      // instance here on write -- a fresh instance cannot reach another instance's cache.
      // Audit log for a money-routing lever (PCI): record WHO, not just the role. Same
      // performedBy pattern as PaymentController; req.user is an AmexingUser Parse object,
      // guarded in case a future auth path sets a plain object or leaves it undefined.
      const performedByEmail = typeof req.user?.get === 'function'
        ? req.user.get('email')
        : req.user?.email;
      logger.info('Active payment gateway updated', {
        gateway: id,
        performedBy: req.userId,
        email: performedByEmail,
        role: req.userRole || 'unknown',
      });

      return res.json({
        success: true,
        data: { gateway: id },
      });
    } catch (error) {
      logger.error('Error updating active payment gateway:', error);
      return res.status(500).json({
        success: false,
        error: 'Error al actualizar la pasarela de pago activa',
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
