/**
 * Migration - Create RatePrices Table
 *
 * This migration handles: Creating RatePrices table for rate-specific pricing
 *
 * Database Changes:
 * - Creates new RatePrices table with ratePtr, servicePtr, price, and currency fields
 * - Seeds initial data with default pricing from Service table
 *
 * Dependencies:
 * - Rate table must exist
 * - Services table must exist
 *
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 2024-12-11
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

// Configuration
const MIGRATION_NAME = 'create-rate-prices-table';
const VERSION = '1.0.0';

/**
 * Apply migration (forward)
 *
 * This function will:
 * 1. Create new RatePrices table
 * 2. Optionally seed with initial data
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
    // STEP 1: CREATE RATE PRICES TABLE
    // ==========================================
    const RatePricesClass = Parse.Object.extend('RatePrices');
    
    // Create a test record to initialize the table
    const testRecord = new RatePricesClass();
    testRecord.set('test', true);
    await testRecord.save(null, { useMasterKey: true });
    await testRecord.destroy({ useMasterKey: true });
    stats.tablesCreated++;
    logger.info(`[${MIGRATION_NAME}] Created table: RatePrices`);

    // ==========================================
    // STEP 2: SEED INITIAL DATA (OPTIONAL)
    // ==========================================
    // Get all active rates
    const RateClass = Parse.Object.extend('Rate');
    const rateQuery = new Parse.Query(RateClass);
    rateQuery.equalTo('exists', true);
    rateQuery.equalTo('active', true);
    const rates = await rateQuery.find({ useMasterKey: true });

    if (rates.length === 0) {
      logger.warn(`[${MIGRATION_NAME}] No active rates found. RatePrices table created but no data seeded.`);
      return {
        success: true,
        duration: Date.now() - startTime,
        stats,
        message: `Migration ${MIGRATION_NAME} completed (no rates found)`,
      };
    }

    // Get all active services
    const ServicesClass = Parse.Object.extend('Services');
    const servicesQuery = new Parse.Query(ServicesClass);
    servicesQuery.equalTo('exists', true);
    servicesQuery.equalTo('active', true);
    const services = await servicesQuery.find({ useMasterKey: true });

    if (services.length === 0) {
      logger.warn(`[${MIGRATION_NAME}] No active services found. RatePrices table created but no data seeded.`);
      return {
        success: true,
        duration: Date.now() - startTime,
        stats,
        message: `Migration ${MIGRATION_NAME} completed (no services found)`,
      };
    }

    logger.info(`[${MIGRATION_NAME}] Found ${rates.length} rates and ${services.length} services`);

    // ==========================================
    // STEP 3: CREATE RATE PRICES FOR EACH RATE-SERVICE COMBINATION
    // ==========================================
    // We'll create a default price structure
    // You can modify this logic based on your specific pricing requirements
    
    const defaultPrices = {
      'Green Class': { basePrice: 1000, currency: 'MXN' },
      'Premium': { basePrice: 1500, currency: 'MXN' },
      'Executive': { basePrice: 2000, currency: 'MXN' },
    };

    for (const rate of rates) {
      const rateName = rate.get('name');
      const priceConfig = defaultPrices[rateName] || { basePrice: 1200, currency: 'MXN' };
      
      for (const service of services) {
        try {
          // Check if rate price already exists
          const existsQuery = new Parse.Query(RatePricesClass);
          existsQuery.equalTo('ratePtr', rate);
          existsQuery.equalTo('servicePtr', service);
          existsQuery.equalTo('exists', true);
          
          const existingRatePrice = await existsQuery.first({ useMasterKey: true });
          
          if (!existingRatePrice) {
            const ratePrice = new RatePricesClass();
            
            // Set relationships
            ratePrice.set('ratePtr', rate);
            ratePrice.set('servicePtr', service);
            
            // Set pricing (you can customize this logic)
            // For now, using a simple base price structure
            ratePrice.set('price', priceConfig.basePrice);
            ratePrice.set('currency', priceConfig.currency);
            
            // Set lifecycle fields
            ratePrice.set('active', true);
            ratePrice.set('exists', true);
            
            await ratePrice.save(null, { useMasterKey: true });
            stats.recordsCreated++;
          }
        } catch (error) {
          logger.error(`[${MIGRATION_NAME}] Error creating rate price`, {
            rateId: rate.id,
            rateName: rateName,
            serviceId: service.id,
            error: error.message,
          });
        }
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`[${MIGRATION_NAME}] Migration completed successfully`, {
      duration: `${duration}ms`,
      stats,
      ratesProcessed: rates.length,
      servicesProcessed: services.length,
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
 * This function will:
 * 1. Delete all records from RatePrices table
 * 2. Optionally drop the RatePrices table
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

  try {
    logger.warn(`[${MIGRATION_NAME}] Starting rollback...`);

    // ==========================================
    // STEP 1: DELETE ALL RECORDS FROM RATE PRICES TABLE
    // ==========================================
    const RatePricesClass = Parse.Object.extend('RatePrices');
    const query = new Parse.Query(RatePricesClass);
    query.limit(1000); // Process in batches
    
    let hasMore = true;
    while (hasMore) {
      const records = await query.find({ useMasterKey: true });
      
      if (records.length === 0) {
        hasMore = false;
      } else {
        for (const record of records) {
          await record.destroy({ useMasterKey: true });
          stats.recordsDeleted++;
        }
      }
    }
    
    logger.warn(`[${MIGRATION_NAME}] Deleted ${stats.recordsDeleted} records from RatePrices table`);

    const duration = Date.now() - startTime;
    logger.warn(`[${MIGRATION_NAME}] Rollback completed successfully`, {
      duration: `${duration}ms`,
      stats,
    });

    return {
      success: true,
      duration,
      stats,
      message: `Rollback of ${MIGRATION_NAME} completed successfully`,
    };
  } catch (error) {
    logger.error(`[${MIGRATION_NAME}] Rollback failed`, {
      error: error.message,
      stack: error.stack,
    });

    throw new Error(`Rollback failed: ${error.message}`);
  }
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  version: VERSION,
  description: 'Create RatePrices table for rate-specific pricing',
  up,
  down,
};