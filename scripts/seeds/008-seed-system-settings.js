/**
 * Seed 008 - System Settings
 *
 * Creates initial system configuration settings stored in MongoDB.
 * These settings provide centralized configuration for volatile business
 * values that may change over time without requiring code redeployment.
 *
 * Initial Settings:
 * - paymentSurchargePercentage (21.09%): Surcharge for non-cash payment methods
 *
 * This seed is idempotent - creates settings if they don't exist,
 * updates descriptions if they do (preserves existing values).
 *
 * Modification Policy:
 * - Settings are programmer-only modifiable (no Admin UI)
 * - Change via seed update + `yarn seed` OR direct DB access
 * - No API endpoints for modification
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-11-10
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');
const SeedTracker = require('../global/seeds/seed-tracker');

// Seed configuration
const SEED_NAME = '008-seed-system-settings';
const VERSION = '1.0.0';

/**
 * System settings to be seeded
 *
 * Structure:
 * - key: Unique setting identifier (camelCase)
 * - value: Setting value (will be type-coerced based on valueType)
 * - valueType: Data type ('string', 'number', 'boolean', 'json')
 * - category: Organizational grouping ('pricing', 'system', 'email', etc.)
 * - description: Human-readable explanation
 * - displayName: Spanish display name
 * - editable: Whether setting can be modified (future-proofing)
 * - validationRules: Optional validation constraints
 */
const SYSTEM_SETTINGS = [
  {
    key: 'paymentSurchargePercentage',
    value: 21.09,
    valueType: 'number',
    category: 'pricing',
    description: 'Surcharge percentage for non-cash payment methods (credit cards, debit cards, digital wallets). Applied to base price to calculate standard displayed price. Legal terminology: base price = cash discount price (precio efectivo), total price = base price + surcharge (precio base).',
    displayName: 'Surcharge de Pago con Tarjeta',
    editable: true,
    validationRules: {
      min: 0,
      max: 100
    }
  }
];

/**
 * Get setting by unique key
 * @param {string} key - Setting key identifier
 * @returns {Promise<object|null>} Setting object or null
 */
async function getSettingByKey(key) {
  try {
    const SettingClass = Parse.Object.extend('Setting');
    const query = new Parse.Query(SettingClass);
    query.equalTo('key', key);
    query.equalTo('exists', true);
    return await query.first({ useMasterKey: true });
  } catch (error) {
    logger.error(`[${SEED_NAME}] Error getting setting`, {
      key,
      error: error.message,
    });
    return null;
  }
}

/**
 * Main seed execution function
 * @returns {Promise<object>} Execution result with stats
 */
async function run() {
  const tracker = new SeedTracker();
  const startTime = Date.now();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  logger.info(`[${SEED_NAME}] Starting seed execution v${VERSION}`);
  logger.info(`[${SEED_NAME}] Seeding ${SYSTEM_SETTINGS.length} system settings`);

  try {
    for (const settingData of SYSTEM_SETTINGS) {
      try {
        // Get existing setting
        let setting = await getSettingByKey(settingData.key);

        if (!setting) {
          // Create new setting
          const SettingClass = Parse.Object.extend('Setting');
          setting = new SettingClass();
          setting.set('key', settingData.key);
          setting.set('value', settingData.value);
          setting.set('valueType', settingData.valueType);
          setting.set('category', settingData.category);
          setting.set('description', settingData.description);
          setting.set('editable', settingData.editable);
          setting.set('displayName', settingData.displayName);
          setting.set('validationRules', settingData.validationRules);
          setting.set('active', true);
          setting.set('exists', true);

          await setting.save(null, { useMasterKey: true });
          created++;

          logger.info(`[${SEED_NAME}] Setting created`, {
            key: settingData.key,
            value: settingData.value,
            valueType: settingData.valueType,
            category: settingData.category
          });
        } else {
          // Update metadata if changed (preserve value)
          // This allows description updates without overwriting user-modified values
          let needsUpdate = false;

          if (setting.get('description') !== settingData.description) {
            setting.set('description', settingData.description);
            needsUpdate = true;
          }

          if (setting.get('displayName') !== settingData.displayName) {
            setting.set('displayName', settingData.displayName);
            needsUpdate = true;
          }

          if (setting.get('category') !== settingData.category) {
            setting.set('category', settingData.category);
            needsUpdate = true;
          }

          if (setting.get('valueType') !== settingData.valueType) {
            setting.set('valueType', settingData.valueType);
            needsUpdate = true;
          }

          // Update validation rules if changed
          const existingRules = setting.get('validationRules');
          const newRules = settingData.validationRules;
          if (JSON.stringify(existingRules) !== JSON.stringify(newRules)) {
            setting.set('validationRules', newRules);
            needsUpdate = true;
          }

          if (needsUpdate) {
            await setting.save(null, { useMasterKey: true });
            updated++;
            logger.info(`[${SEED_NAME}] Setting metadata updated`, {
              key: settingData.key,
              preservedValue: setting.get('value')
            });
          } else {
            skipped++;
            logger.debug(`[${SEED_NAME}] Setting unchanged`, {
              key: settingData.key
            });
          }
        }
      } catch (error) {
        errors++;
        logger.error(`[${SEED_NAME}] Error processing setting`, {
          key: settingData.key,
          error: error.message,
          stack: error.stack
        });
      }
    }

    const duration = Date.now() - startTime;

    // Record successful execution in SeedTracker
    await tracker.recordExecution({
      name: SEED_NAME,
      version: VERSION,
      status: 'completed',
      idempotent: true,
      statistics: { created, updated, skipped, errors, duration }
    });

    const summary = {
      status: 'success',
      created,
      updated,
      skipped,
      errors,
      total: SYSTEM_SETTINGS.length,
      duration
    };

    logger.info(`[${SEED_NAME}] Seed completed successfully`, summary);
    return summary;
  } catch (error) {
    const duration = Date.now() - startTime;
    await tracker.recordFailure(SEED_NAME, error);
    logger.error(`[${SEED_NAME}] Seed execution failed`, {
      error: error.message,
      stack: error.stack,
      created,
      updated,
      skipped,
      errors,
      duration
    });
    throw error;
  }
}

/**
 * Rollback function - soft delete all seeded settings
 * @returns {Promise<object>} Rollback result with stats
 */
async function rollback() {
  logger.info(`[${SEED_NAME}] Starting rollback`);
  let deleted = 0;
  let errors = 0;

  try {
    for (const settingData of SYSTEM_SETTINGS) {
      try {
        const setting = await getSettingByKey(settingData.key);
        if (setting) {
          // Soft delete (set exists = false)
          setting.set('exists', false);
          setting.set('active', false);
          await setting.save(null, { useMasterKey: true });
          deleted++;
          logger.info(`[${SEED_NAME}] Setting soft deleted`, {
            key: settingData.key
          });
        }
      } catch (error) {
        errors++;
        logger.error(`[${SEED_NAME}] Error rolling back setting`, {
          key: settingData.key,
          error: error.message
        });
      }
    }

    const summary = {
      status: 'success',
      deleted,
      errors,
      total: SYSTEM_SETTINGS.length
    };

    logger.info(`[${SEED_NAME}] Rollback completed`, summary);
    return summary;
  } catch (error) {
    logger.error(`[${SEED_NAME}] Rollback failed`, {
      error: error.message,
      deleted,
      errors
    });
    throw error;
  }
}

module.exports = {
  name: SEED_NAME,
  version: VERSION,
  run,
  rollback
};
