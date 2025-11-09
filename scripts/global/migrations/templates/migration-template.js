/**
 * Migration Template - [MIGRATION_NAME]
 *
 * This migration handles: [DESCRIPTION]
 *
 * Database Changes:
 * - [LIST YOUR DATABASE CHANGES HERE]
 *
 * Dependencies:
 * - [LIST ANY DEPENDENCIES OR PREREQUISITES]
 *
 * @author [AUTHOR_NAME]
 * @version 1.0.0
 * @since [DATE]
 */

const Parse = require('parse/node');
const logger = require('../../../../src/infrastructure/logger');

// Configuration
const MIGRATION_NAME = '[MIGRATION_NAME]';
const VERSION = '1.0.0';

/**
 * Apply migration (forward)
 *
 * This function should:
 * 1. Create new tables/collections if needed
 * 2. Add new fields to existing tables
 * 3. Migrate data if necessary
 * 4. Create indexes for performance
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
    // STEP 1: CREATE TABLES/COLLECTIONS
    // ==========================================
    // Example:
    // const MyTableClass = Parse.Object.extend('MyTable');
    // const testRecord = new MyTableClass();
    // testRecord.set('test', true);
    // await testRecord.save(null, { useMasterKey: true });
    // await testRecord.destroy({ useMasterKey: true });
    // stats.tablesCreated++;
    // logger.info(`[${MIGRATION_NAME}] Created table: MyTable`);

    // ==========================================
    // STEP 2: SEED INITIAL DATA
    // ==========================================
    // Example:
    // const records = [
    //   { name: 'Record 1', active: true },
    //   { name: 'Record 2', active: true },
    // ];
    //
    // for (const recordData of records) {
    //   const record = new MyTableClass();
    //   record.set('name', recordData.name);
    //   record.set('active', recordData.active);
    //   record.set('exists', true);
    //   await record.save(null, { useMasterKey: true });
    //   stats.recordsCreated++;
    // }

    // ==========================================
    // STEP 3: UPDATE EXISTING RECORDS
    // ==========================================
    // Example:
    // const query = new Parse.Query(MyTableClass);
    // query.equalTo('exists', true);
    // const existingRecords = await query.find({ useMasterKey: true });
    //
    // for (const record of existingRecords) {
    //   record.set('newField', 'defaultValue');
    //   await record.save(null, { useMasterKey: true });
    //   stats.recordsUpdated++;
    // }

    // ==========================================
    // STEP 4: CREATE INDEXES (if applicable)
    // ==========================================
    // Note: Parse Server handles basic indexes automatically
    // Complex indexes may need to be created directly in MongoDB
    // Example:
    // const db = await getMongoDBConnection();
    // await db.collection('MyTable').createIndex({ name: 1 }, { unique: true });
    // stats.indexesCreated++;

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
 * This function should undo all changes made by up():
 * 1. Remove created tables (use with EXTREME caution)
 * 2. Remove added fields
 * 3. Restore previous data state
 * 4. Remove indexes
 *
 * IMPORTANT: Rollbacks are destructive operations!
 * - Test thoroughly in development before using in production
 * - Always backup your database before rollback
 * - Some operations may not be reversible (e.g., deleted data)
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
    // STEP 1: REMOVE CREATED DATA
    // ==========================================
    // Example:
    // const MyTableClass = Parse.Object.extend('MyTable');
    // const query = new Parse.Query(MyTableClass);
    // const records = await query.find({ useMasterKey: true });
    //
    // for (const record of records) {
    //   await record.destroy({ useMasterKey: true });
    //   stats.recordsDeleted++;
    // }

    // ==========================================
    // STEP 2: REVERT FIELD CHANGES
    // ==========================================
    // Example:
    // const query = new Parse.Query(MyTableClass);
    // const existingRecords = await query.find({ useMasterKey: true });
    //
    // for (const record of existingRecords) {
    //   record.unset('newField');
    //   await record.save(null, { useMasterKey: true });
    //   stats.recordsUpdated++;
    // }

    // ==========================================
    // STEP 3: DROP TABLES (DANGEROUS!)
    // ==========================================
    // WARNING: This permanently deletes all data in the table
    // Only use if absolutely necessary and you have backups
    // Example:
    // const db = await getMongoDBConnection();
    // await db.collection('MyTable').drop();
    // stats.tablesDeleted++;
    // logger.warn(`[${MIGRATION_NAME}] Dropped table: MyTable`);

    // ==========================================
    // STEP 4: REMOVE INDEXES
    // ==========================================
    // Example:
    // const db = await getMongoDBConnection();
    // await db.collection('MyTable').dropIndex('name_1');
    // stats.indexesRemoved++;

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
// HELPER FUNCTIONS
// ==========================================

/**
 * Check if a record exists by name (case insensitive)
 * @param {string} className - Parse class name
 * @param {string} name - Record name to check
 * @returns {Promise<boolean>} True if exists
 */
async function recordExists(className, name) {
  try {
    const TableClass = Parse.Object.extend(className);
    const query = new Parse.Query(TableClass);
    query.matches('name', `^${name}$`, 'i');
    query.equalTo('exists', true);
    query.limit(1);

    const count = await query.count({ useMasterKey: true });
    return count > 0;
  } catch (error) {
    logger.error(`Error checking record existence`, {
      className,
      name,
      error: error.message,
    });
    return false;
  }
}

/**
 * Get MongoDB connection (for direct DB operations)
 * @returns {Promise<object>} MongoDB database instance
 */
async function getMongoDBConnection() {
  // This requires direct MongoDB connection
  // Implementation depends on your MongoDB setup
  throw new Error('Direct MongoDB operations not implemented in template');
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  version: VERSION,
  description: '[DESCRIPTION]',
  up,
  down,
};
