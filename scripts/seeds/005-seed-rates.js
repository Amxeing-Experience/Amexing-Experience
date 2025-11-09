/**
 * Seed 005 - Rates (Pricing Catalog)
 *
 * Creates or updates the 4 system rates:
 * - Económico (5%, #ebab3c - amber)
 * - First Class (1%, #982933 - burgundy)
 * - Green Class (10%, #2d673c - green)
 * - Premium (20%, #dc713d - orange)
 *
 * This seed is idempotent - creates rates if they don't exist, updates if they do.
 *
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 2024-10-26
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');
const SeedTracker = require('../global/seeds/seed-tracker');

// Seed configuration
const SEED_NAME = '005-seed-rates';
const VERSION = '2.0.0';

/**
 * Expected rates with their colors (these should already exist in the database)
 */
const EXPECTED_RATES = [
  {
    name: 'First Class',
    percentage: 1,
    color: '#982933', // Existing burgundy
  },
  {
    name: 'Económico',
    percentage: 5,
    color: '#ebab3c', // Existing amber
  },
  {
    name: 'Green Class',
    percentage: 10,
    color: '#2d673c', // Existing green
  },
  {
    name: 'Premium',
    percentage: 20,
    color: '#dc713d', // Existing orange
  },
];

/**
 * Get rate by name (case insensitive)
 * @param {string} name - Rate name
 * @returns {Promise<object|null>} Rate object or null
 */
async function getRateByName(name) {
  try {
    const RateClass = Parse.Object.extend('Rate');
    const query = new Parse.Query(RateClass);
    query.matches('name', `^${name}$`, 'i'); // Case insensitive exact match
    query.equalTo('exists', true);

    return await query.first({ useMasterKey: true });
  } catch (error) {
    logger.error(`[${SEED_NAME}] Error getting rate`, {
      name,
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
  logger.info(`[${SEED_NAME}] This seed creates or updates rates with colors`);

  try {
    for (const expectedRate of EXPECTED_RATES) {
      try {
        // Get existing rate
        let rate = await getRateByName(expectedRate.name);

        if (!rate) {
          // Create new rate
          const RateClass = Parse.Object.extend('Rate');
          rate = new RateClass();
          rate.set('name', expectedRate.name);
          rate.set('percentage', expectedRate.percentage);
          rate.set('color', expectedRate.color);
          rate.set('active', true);
          rate.set('exists', true);

          await rate.save(null, { useMasterKey: true });
          created++;

          logger.info(`[${SEED_NAME}] Rate created`, {
            id: rate.id,
            name: expectedRate.name,
            percentage: expectedRate.percentage,
            color: expectedRate.color,
          });
          continue;
        }

        // Check if update needed
        const currentColor = rate.get('color');
        const currentPercentage = rate.get('percentage');
        let needsUpdate = false;

        if (currentColor !== expectedRate.color) {
          rate.set('color', expectedRate.color);
          needsUpdate = true;
        }

        if (currentPercentage !== expectedRate.percentage) {
          rate.set('percentage', expectedRate.percentage);
          needsUpdate = true;
        }

        if (needsUpdate) {
          await rate.save(null, { useMasterKey: true });
          updated++;

          logger.info(`[${SEED_NAME}] Rate updated`, {
            id: rate.id,
            name: expectedRate.name,
            oldColor: currentColor || 'none',
            newColor: expectedRate.color,
            percentage: expectedRate.percentage,
          });
        } else {
          skipped++;
          logger.info(`[${SEED_NAME}] Rate already correct, skipping`, {
            name: expectedRate.name,
          });
        }
      } catch (error) {
        errors++;
        logger.error(`[${SEED_NAME}] Error processing rate`, {
          name: expectedRate.name,
          error: error.message,
          stack: error.stack,
        });
      }
    }

    const duration = Date.now() - startTime;

    // Record seed execution
    await tracker.recordExecution({
      name: SEED_NAME,
      version: VERSION,
      status: 'completed',
      idempotent: true,
      statistics: {
        created,
        updated,
        skipped,
        errors,
        duration,
      },
    });

    const summary = {
      status: 'success',
      created,
      updated,
      skipped,
      errors,
      total: EXPECTED_RATES.length,
      duration,
    };

    logger.info(`[${SEED_NAME}] Seed completed successfully`, summary);

    return summary;
  } catch (error) {
    const duration = Date.now() - startTime;

    // Record seed failure
    await tracker.recordFailure(SEED_NAME, error);

    logger.error(`[${SEED_NAME}] Seed execution failed`, {
      error: error.message,
      stack: error.stack,
      created,
      updated,
      skipped,
      errors,
      duration,
    });

    throw error;
  }
}

/**
 * Rollback function (optional)
 * Removes color field from all rates
 * @returns {Promise<object>} Rollback result
 */
async function rollback() {
  logger.info(`[${SEED_NAME}] Starting rollback`);
  let reverted = 0;
  let errors = 0;

  try {
    for (const rateData of EXPECTED_RATES) {
      try {
        const rate = await getRateByName(rateData.name);

        if (rate && rate.get('color')) {
          rate.unset('color');
          await rate.save(null, { useMasterKey: true });
          reverted++;

          logger.info(`[${SEED_NAME}] Rate color removed`, {
            name: rateData.name,
          });
        }
      } catch (error) {
        errors++;
        logger.error(`[${SEED_NAME}] Error during rollback`, {
          name: rateData.name,
          error: error.message,
        });
      }
    }

    logger.info(`[${SEED_NAME}] Rollback completed`, {
      reverted,
      errors,
    });

    return {
      status: 'success',
      reverted,
      errors,
    };
  } catch (error) {
    logger.error(`[${SEED_NAME}] Rollback failed`, {
      error: error.message,
      reverted,
      errors,
    });

    throw error;
  }
}

module.exports = {
  name: SEED_NAME,
  version: VERSION,
  run,
  rollback,
};
