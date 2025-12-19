/**
 * Migration - Remove Price Column from Services Table
 *
 * This migration handles: Removing the price field from all existing Services records
 *
 * Database Changes:
 * - Removes price field from all Services records
 *
 * Dependencies:
 * - Services table must exist
 *
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 2024-12-11
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

// Configuration
const MIGRATION_NAME = 'remove-price-from-services';
const VERSION = '1.0.0';

/**
 * Apply migration (forward)
 *
 * This function will:
 * 1. Query all Services records
 * 2. Remove the price field from each record
 *
 * @returns {Promise<object>} Migration result with statistics
 */
async function up() {
  const startTime = Date.now();
  const stats = {
    tablesCreated: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    indexesCreated: 0,
  };

  try {
    logger.info(`[${MIGRATION_NAME}] Starting migration...`);

    // ==========================================
    // STEP 1: QUERY ALL SERVICES RECORDS
    // ==========================================
    const ServicesClass = Parse.Object.extend('Services');
    const query = new Parse.Query(ServicesClass);
    query.limit(1000); // Process in batches if needed
    
    let hasMore = true;
    let skip = 0;
    
    while (hasMore) {
      query.skip(skip);
      const services = await query.find({ useMasterKey: true });
      
      if (services.length === 0) {
        hasMore = false;
      } else {
        // ==========================================
        // STEP 2: REMOVE PRICE FIELD FROM EACH RECORD
        // ==========================================
        for (const service of services) {
          try {
            // Check if the service has a price field
            if (service.has('price')) {
              service.unset('price');
              await service.save(null, { useMasterKey: true });
              stats.recordsUpdated++;
            }
          } catch (error) {
            logger.error(`[${MIGRATION_NAME}] Error updating service`, {
              serviceId: service.id,
              error: error.message,
            });
          }
        }
        
        skip += services.length;
        
        // If we got less than the limit, we've reached the end
        if (services.length < 1000) {
          hasMore = false;
        }
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`[${MIGRATION_NAME}] Migration completed successfully`, {
      duration: `${duration}ms`,
      stats,
    });

    return {
      success: true,
      duration,
      stats,
      message: `Migration ${MIGRATION_NAME} completed successfully`,
    };
  } catch (error) {
    logger.error(`[${MIGRATION_NAME}] Migration failed`, {
      error: error.message,
      stack: error.stack,
    });

    throw new Error(`Migration failed: ${error.message}`);
  }
}

/**
 * Revert migration (backward)
 *
 * Note: This migration cannot be reversed as we cannot restore the original price values
 * once they are removed. This function logs a warning.
 *
 * @returns {Promise<object>} Rollback result with statistics
 */
async function down() {
  const startTime = Date.now();
  const stats = {
    tablesDeleted: 0,
    recordsDeleted: 0,
    recordsUpdated: 0,
    indexesRemoved: 0,
  };

  logger.warn(`[${MIGRATION_NAME}] Rollback requested, but this migration cannot be reversed`);
  logger.warn(`[${MIGRATION_NAME}] The price field data cannot be restored once removed`);

  const duration = Date.now() - startTime;
  
  return {
    success: true,
    duration,
    stats,
    message: `Rollback of ${MIGRATION_NAME} skipped - cannot restore price data`,
  };
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  version: VERSION,
  description: 'Remove price field from all Services records',
  up,
  down,
};