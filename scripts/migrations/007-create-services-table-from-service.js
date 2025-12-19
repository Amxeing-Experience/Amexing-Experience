/**
 * Migration - Create Services Table from Service Data
 *
 * This migration handles: Copying Service table data to new Services table without rate and isRoundTrip columns
 *
 * Database Changes:
 * - Creates new Services table
 * - Copies data from Service table (omitting rate and isRoundTrip fields)
 * - Copies only records from a specific rate type
 *
 * Dependencies:
 * - Service table must exist with data
 * - Rate table must exist
 *
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 2024-12-11
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

// Configuration
const MIGRATION_NAME = 'create-services-table-from-service';
const VERSION = '1.0.0';

/**
 * Apply migration (forward)
 *
 * This function will:
 * 1. Create new Services table
 * 2. Query Service table for records with a specific rate
 * 3. Copy data to Services table (without rate and isRoundTrip)
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
    // STEP 1: CREATE SERVICES TABLE
    // ==========================================
    const ServicesClass = Parse.Object.extend('Services');
    
    // Create a test record to initialize the table
    const testRecord = new ServicesClass();
    testRecord.set('test', true);
    await testRecord.save(null, { useMasterKey: true });
    await testRecord.destroy({ useMasterKey: true });
    stats.tablesCreated++;
    logger.info(`[${MIGRATION_NAME}] Created table: Services`);

    // ==========================================
    // STEP 2: GET A DEFAULT RATE TO USE FOR FILTERING
    // ==========================================
    // We'll copy services from the first available rate
    // You can modify this to use a specific rate name
    const RateClass = Parse.Object.extend('Rate');
    const rateQuery = new Parse.Query(RateClass);
    rateQuery.equalTo('exists', true);
    rateQuery.equalTo('active', true);
    rateQuery.limit(1);
    const defaultRate = await rateQuery.first({ useMasterKey: true });
    
    if (!defaultRate) {
      logger.warn(`[${MIGRATION_NAME}] No active rates found. Services table created but no data copied.`);
      return {
        success: true,
        duration: Date.now() - startTime,
        stats,
        message: `Migration ${MIGRATION_NAME} completed (no rates found)`,
      };
    }

    const selectedRateName = defaultRate.get('name');
    logger.info(`[${MIGRATION_NAME}] Using rate: ${selectedRateName}`);

    // ==========================================
    // STEP 3: QUERY SERVICE TABLE FOR RECORDS WITH THE SELECTED RATE
    // ==========================================
    const ServiceClass = Parse.Object.extend('Service');
    const serviceQuery = new Parse.Query(ServiceClass);
    serviceQuery.equalTo('exists', true);
    serviceQuery.equalTo('rate', defaultRate);
    serviceQuery.include('originPOI');
    serviceQuery.include('destinationPOI');
    serviceQuery.include('vehicleType');
    serviceQuery.limit(1000); // Process in batches if needed
    
    const services = await serviceQuery.find({ useMasterKey: true });
    logger.info(`[${MIGRATION_NAME}] Found ${services.length} services with rate: ${selectedRateName}`);

    // ==========================================
    // STEP 4: COPY DATA TO SERVICES TABLE
    // ==========================================
    for (const service of services) {
      try {
        // Check if this service already exists in Services table
        // to avoid duplicates if migration runs twice
        const existsQuery = new Parse.Query(ServicesClass);
        existsQuery.equalTo('originPOI', service.get('originPOI'));
        existsQuery.equalTo('destinationPOI', service.get('destinationPOI'));
        existsQuery.equalTo('vehicleType', service.get('vehicleType'));
        existsQuery.equalTo('exists', true);
        
        const existingService = await existsQuery.first({ useMasterKey: true });
        
        if (!existingService) {
          const newService = new ServicesClass();
          
          // Copy all fields except rate, isRoundTrip, and price
          newService.set('originPOI', service.get('originPOI'));
          newService.set('destinationPOI', service.get('destinationPOI'));
          newService.set('vehicleType', service.get('vehicleType'));
          newService.set('note', service.get('note'));
          newService.set('active', service.get('active'));
          newService.set('exists', true);
          
          await newService.save(null, { useMasterKey: true });
          stats.recordsCreated++;
        }
      } catch (error) {
        logger.error(`[${MIGRATION_NAME}] Error copying service`, {
          serviceId: service.id,
          error: error.message,
        });
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`[${MIGRATION_NAME}] Migration completed successfully`, {
      duration: `${duration}ms`,
      stats,
      selectedRate: selectedRateName,
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
 * 1. Delete all records from Services table
 * 2. Optionally drop the Services table
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
    // STEP 1: DELETE ALL RECORDS FROM SERVICES TABLE
    // ==========================================
    const ServicesClass = Parse.Object.extend('Services');
    const query = new Parse.Query(ServicesClass);
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
    
    logger.warn(`[${MIGRATION_NAME}] Deleted ${stats.recordsDeleted} records from Services table`);

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
  description: 'Copy Service table data to new Services table without rate and isRoundTrip columns',
  up,
  down,
};