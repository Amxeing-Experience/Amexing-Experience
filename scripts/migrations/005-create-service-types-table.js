/**
 * Migration 005 - Create ServiceType Table Structure
 *
 * This migration documents and validates the ServiceType table structure.
 * Since Parse Server creates collections automatically, this migration ensures
 * the table exists with the correct structure.
 *
 * Database Changes:
 * - Creates ServiceType collection if not exists
 * - Validates table structure
 * - Documents schema fields
 *
 * Dependencies:
 * - None (first data structure migration)
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-10-25
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

// Configuration
const MIGRATION_NAME = '005-create-service-types-table';
const VERSION = '1.0.0';

/**
 * ServiceType Table Schema Documentation
 *
 * Fields:
 * - name: String (required, max 100 chars) - Service type display name
 * - active: Boolean (required, default: true) - Active status for UI visibility
 * - exists: Boolean (required, default: true) - Soft delete flag
 * - createdAt: Date (auto) - Creation timestamp
 * - updatedAt: Date (auto) - Last update timestamp
 *
 * Indexes:
 * - name (for uniqueness checks and queries)
 * - active (for filtering active records)
 * - exists (for filtering non-deleted records)
 *
 * Expected Records:
 * - Aeropuerto (Airport transfers)
 * - Punto a Punto (Point to point transfers)
 * - Local (Local destinations)
 */

/**
 * Apply migration (forward)
 *
 * Creates the ServiceType table structure and validates schema.
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
    // STEP 1: CREATE TABLE/COLLECTION
    // ==========================================
    // Parse Server creates collections automatically when first object is saved
    // We'll create a test record to ensure the collection exists
    const ServiceTypeClass = Parse.Object.extend('ServiceType');

    // Check if table already exists by querying
    const checkQuery = new Parse.Query(ServiceTypeClass);
    checkQuery.limit(1);
    const existingRecords = await checkQuery.find({ useMasterKey: true });

    if (existingRecords.length === 0) {
      // Table doesn't exist or is empty, create test record to initialize table
      const testRecord = new ServiceTypeClass();
      testRecord.set('name', '_migration_test');
      testRecord.set('active', false);
      testRecord.set('exists', false);

      await testRecord.save(null, { useMasterKey: true });

      // Delete test record immediately
      await testRecord.destroy({ useMasterKey: true });

      stats.tablesCreated++;
      logger.info(`[${MIGRATION_NAME}] Created table: ServiceType`);
    } else {
      logger.info(`[${MIGRATION_NAME}] Table ServiceType already exists`);
    }

    // ==========================================
    // STEP 2: VALIDATE EXISTING RECORDS
    // ==========================================
    // Ensure all existing records have required fields
    const allQuery = new Parse.Query(ServiceTypeClass);
    allQuery.equalTo('exists', true);
    const allRecords = await allQuery.find({ useMasterKey: true });

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
    // STEP 3: LOG SCHEMA DOCUMENTATION
    // ==========================================
    logger.info(`[${MIGRATION_NAME}] ServiceType table schema`, {
      fields: {
        name: 'String (required, max 100 chars)',
        active: 'Boolean (required, default: true)',
        exists: 'Boolean (required, default: true)',
        createdAt: 'Date (auto)',
        updatedAt: 'Date (auto)',
      },
      indexes: ['name', 'active', 'exists'],
      expectedRecords: 3,
      currentRecords: allRecords.length,
    });

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
 * WARNING: This operation is DESTRUCTIVE and will delete all ServiceType records!
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
    logger.warn(`[${MIGRATION_NAME}] This will delete all ServiceType records!`);

    // ==========================================
    // STEP 1: DELETE ALL RECORDS
    // ==========================================
    const ServiceTypeClass = Parse.Object.extend('ServiceType');
    const query = new Parse.Query(ServiceTypeClass);
    const records = await query.find({ useMasterKey: true });

    logger.warn(`[${MIGRATION_NAME}] Found ${records.length} records to delete`);

    for (const record of records) {
      await record.destroy({ useMasterKey: true });
      stats.recordsDeleted++;
    }

    logger.warn(`[${MIGRATION_NAME}] Deleted ${stats.recordsDeleted} ServiceType records`);

    // ==========================================
    // NOTE: Collection Drop
    // ==========================================
    // Parse Server doesn't provide a direct way to drop collections
    // The collection will remain in MongoDB but will be empty
    // To fully drop the collection, you would need direct MongoDB access:
    //
    // const db = await getMongoDBConnection();
    // await db.collection('ServiceType').drop();
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
  description: 'Create and validate ServiceType table structure',
  up,
  down,
};
