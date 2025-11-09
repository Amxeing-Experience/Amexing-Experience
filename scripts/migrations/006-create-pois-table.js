/**
 * Migration 006 - Create POI Table Structure with ServiceType Pointer
 *
 * This migration documents and validates the POI (Points of Interest) table structure.
 * Since Parse Server creates collections automatically, this migration ensures
 * the table exists with the correct structure including the serviceType pointer.
 *
 * Database Changes:
 * - Creates POI collection if not exists
 * - Validates table structure
 * - Validates serviceType pointer relationships
 * - Documents schema fields
 *
 * Dependencies:
 * - 005-create-service-types-table (requires ServiceType table to exist)
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-10-25
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

// Configuration
const MIGRATION_NAME = '006-create-pois-table';
const VERSION = '1.0.0';

/**
 * POI Table Schema Documentation
 *
 * Fields:
 * - name: String (required, max 200 chars) - POI display name
 * - serviceType: Pointer<ServiceType> (required) - Reference to ServiceType
 * - active: Boolean (required, default: true) - Active status for UI visibility
 * - exists: Boolean (required, default: true) - Soft delete flag
 * - createdAt: Date (auto) - Creation timestamp
 * - updatedAt: Date (auto) - Last update timestamp
 *
 * Indexes:
 * - name (for uniqueness checks and queries)
 * - serviceType (for filtering by service type)
 * - active (for filtering active records)
 * - exists (for filtering non-deleted records)
 *
 * Expected Records:
 * - 45 Local destinations
 * - 10 Airport destinations
 * - 18 City destinations (Punto a Punto)
 * Total: 73 POIs
 */

/**
 * Apply migration (forward)
 *
 * Creates the POI table structure and validates schema including pointers.
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
    // STEP 1: VERIFY SERVICE TYPE TABLE EXISTS
    // ==========================================
    const ServiceTypeClass = Parse.Object.extend('ServiceType');
    const serviceTypeQuery = new Parse.Query(ServiceTypeClass);
    serviceTypeQuery.equalTo('exists', true);
    const serviceTypes = await serviceTypeQuery.find({ useMasterKey: true });

    if (serviceTypes.length === 0) {
      throw new Error('ServiceType table is empty. Please run migration 005-create-service-types-table first.');
    }

    logger.info(`[${MIGRATION_NAME}] Verified ServiceType table exists with ${serviceTypes.length} records`);

    // ==========================================
    // STEP 2: CREATE TABLE/COLLECTION
    // ==========================================
    const POIClass = Parse.Object.extend('POI');

    // Check if table already exists by querying
    const checkQuery = new Parse.Query(POIClass);
    checkQuery.limit(1);
    const existingRecords = await checkQuery.find({ useMasterKey: true });

    if (existingRecords.length === 0) {
      // Table doesn't exist or is empty, create test record to initialize table
      const testRecord = new POIClass();
      testRecord.set('name', '_migration_test');
      testRecord.set('active', false);
      testRecord.set('exists', false);
      testRecord.set('serviceType', serviceTypes[0]); // Use first service type for test

      await testRecord.save(null, { useMasterKey: true });

      // Delete test record immediately
      await testRecord.destroy({ useMasterKey: true });

      stats.tablesCreated++;
      logger.info(`[${MIGRATION_NAME}] Created table: POI`);
    } else {
      logger.info(`[${MIGRATION_NAME}] Table POI already exists`);
    }

    // ==========================================
    // STEP 3: VALIDATE EXISTING RECORDS
    // ==========================================
    // Ensure all existing records have required fields
    const allQuery = new Parse.Query(POIClass);
    allQuery.equalTo('exists', true);
    allQuery.include('serviceType'); // Include pointer for validation
    const allRecords = await allQuery.find({ useMasterKey: true });

    let recordsWithoutServiceType = 0;

    for (const record of allRecords) {
      let needsUpdate = false;

      // Ensure active field exists
      if (record.get('active') === undefined) {
        record.set('active', true);
        needsUpdate = true;
      }

      // Ensure exists field exists
      if (record.get('exists') === undefined) {
        record.set('exists', true);
        needsUpdate = true;
      }

      // Check serviceType pointer
      const serviceType = record.get('serviceType');
      if (!serviceType) {
        recordsWithoutServiceType++;
        logger.warn(`[${MIGRATION_NAME}] POI without serviceType pointer found`, {
          id: record.id,
          name: record.get('name'),
        });
      }

      if (needsUpdate) {
        await record.save(null, { useMasterKey: true });
        stats.recordsUpdated++;
        logger.info(`[${MIGRATION_NAME}] Updated record with missing fields`, {
          id: record.id,
          name: record.get('name'),
        });
      }
    }

    // ==========================================
    // STEP 4: LOG SCHEMA DOCUMENTATION
    // ==========================================
    logger.info(`[${MIGRATION_NAME}] POI table schema`, {
      fields: {
        name: 'String (required, max 200 chars)',
        serviceType: 'Pointer<ServiceType> (required)',
        active: 'Boolean (required, default: true)',
        exists: 'Boolean (required, default: true)',
        createdAt: 'Date (auto)',
        updatedAt: 'Date (auto)',
      },
      indexes: ['name', 'serviceType', 'active', 'exists'],
      expectedRecords: 73, // 45 Local + 10 Airport + 18 Cities
      currentRecords: allRecords.length,
      recordsWithoutServiceType,
    });

    if (recordsWithoutServiceType > 0) {
      logger.warn(`[${MIGRATION_NAME}] WARNING: ${recordsWithoutServiceType} POIs without serviceType pointer`);
      logger.warn(`[${MIGRATION_NAME}] These records should be updated manually or via dashboard`);
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
      warnings: recordsWithoutServiceType > 0 ? [`${recordsWithoutServiceType} POIs without serviceType pointer`] : [],
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
 * WARNING: This operation is DESTRUCTIVE and will delete all POI records!
 * Only use in development environments with proper backups.
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
    logger.warn(`[${MIGRATION_NAME}] This will delete all POI records!`);

    // ==========================================
    // STEP 1: DELETE ALL RECORDS
    // ==========================================
    const POIClass = Parse.Object.extend('POI');
    const query = new Parse.Query(POIClass);
    const records = await query.find({ useMasterKey: true });

    logger.warn(`[${MIGRATION_NAME}] Found ${records.length} records to delete`);

    for (const record of records) {
      await record.destroy({ useMasterKey: true });
      stats.recordsDeleted++;
    }

    logger.warn(`[${MIGRATION_NAME}] Deleted ${stats.recordsDeleted} POI records`);

    // ==========================================
    // NOTE: Collection Drop
    // ==========================================
    // Parse Server doesn't provide a direct way to drop collections
    // The collection will remain in MongoDB but will be empty
    // To fully drop the collection, you would need direct MongoDB access:
    //
    // const db = await getMongoDBConnection();
    // await db.collection('POI').drop();
    // stats.tablesDeleted++;

    const duration = Date.now() - startTime;
    logger.warn(`[${MIGRATION_NAME}] Rollback completed`, {
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
  description: 'Create and validate POI table structure with serviceType pointer',
  up,
  down,
};
