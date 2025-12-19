/**
 * Seed 011 - Create EmailLog Class
 *
 * Creates the EmailLog Parse class with proper schema, indexes, and CLPs
 * for email traceability and notification tracking.
 *
 * This seed is idempotent and can be run multiple times safely.
 * If the class already exists, it will be skipped.
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2025-01-18
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

// Seed configuration
const SEED_NAME = '011-create-emaillog-class';
const VERSION = '1.0.0';
const CLASS_NAME = 'EmailLog';

/**
 * Check if EmailLog class exists
 * @returns {Promise<boolean>} True if class exists
 */
async function classExists() {
  try {
    const schemas = await Parse.Schema.all({ useMasterKey: true });
    const exists = schemas.some(schema => schema.className === CLASS_NAME);
    return exists;
  } catch (error) {
    logger.error(`[${SEED_NAME}] Error checking class existence`, {
      error: error.message,
    });
    return false;
  }
}

/**
 * Create EmailLog class with schema
 * @returns {Promise<Parse.Schema>} Created schema
 */
async function createEmailLogClass() {
  try {
    const schema = new Parse.Schema(CLASS_NAME);

    // Core fields
    schema.addString('messageId'); // MailerSend/FCM/Twilio message ID
    schema.addString('recipientEmail'); // Email address (indexed)
    schema.addPointer('recipientUser', 'AmexingUser'); // User pointer (indexed)
    schema.addString('channel'); // email, push, sms
    schema.addString('notificationType'); // booking_confirmation, welcome, etc. (indexed)
    schema.addString('subject'); // Email subject
    schema.addString('htmlContent'); // HTML content snapshot
    schema.addString('textContent'); // Plain text content snapshot
    schema.addString('status'); // sent, delivered, failed, bounced (indexed)
    schema.addDate('sentAt'); // When email was sent (indexed)
    schema.addDate('deliveredAt'); // When email was delivered (nullable)
    schema.addObject('metadata'); // Additional metadata (bookingId, quoteId, etc.)
    schema.addArray('tags'); // Tags for categorization
    schema.addString('error'); // Error message if failed (nullable)

    // Base model required fields
    schema.addBoolean('active'); // Activation status
    schema.addBoolean('exists'); // Logical deletion flag

    // Save schema
    await schema.save({ useMasterKey: true });

    logger.info(`[${SEED_NAME}] EmailLog class created successfully`);

    return schema;
  } catch (error) {
    logger.error(`[${SEED_NAME}] Error creating EmailLog class`, {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Add indexes to EmailLog class
 * @returns {Promise<void>}
 */
async function addIndexes() {
  try {
    const schema = new Parse.Schema(CLASS_NAME);

    // Add indexes for common queries
    // Note: Parse Server automatically creates some indexes
    // We're defining the most important ones explicitly

    logger.info(`[${SEED_NAME}] Adding indexes to EmailLog class...`);

    // Index for recipient email queries
    schema.addIndex('recipientEmail_index', { recipientEmail: 1 });

    // Index for recipient user queries
    schema.addIndex('recipientUser_index', { recipientUser: 1 });

    // Index for notification type queries
    schema.addIndex('notificationType_index', { notificationType: 1 });

    // Index for status queries
    schema.addIndex('status_index', { status: 1 });

    // Index for date range queries
    schema.addIndex('sentAt_index', { sentAt: -1 }); // Descending for latest first

    // Compound index for user + date queries
    schema.addIndex('recipientUser_sentAt_index', {
      recipientUser: 1,
      sentAt: -1,
    });

    // Compound index for exists + sentAt (common query pattern)
    schema.addIndex('exists_sentAt_index', {
      exists: 1,
      sentAt: -1,
    });

    // Update schema with indexes
    await schema.update({ useMasterKey: true });

    logger.info(`[${SEED_NAME}] Indexes added successfully`);
  } catch (error) {
    // Index errors are non-fatal (may already exist)
    logger.warn(`[${SEED_NAME}] Error adding indexes (may already exist)`, {
      error: error.message,
    });
  }
}

/**
 * Set Class Level Permissions (CLPs)
 * @returns {Promise<void>}
 */
async function setClassLevelPermissions() {
  try {
    const schema = new Parse.Schema(CLASS_NAME);

    // Set CLPs - only SuperAdmin and system (masterKey) can manage email logs
    const clp = {
      find: {},
      count: {},
      get: {},
      create: {}, // Only masterKey can create
      update: {}, // Only masterKey can update
      delete: {}, // Only masterKey can delete
      addField: {},
      protectedFields: {
        '*': [], // No protected fields (all accessible with proper permissions)
      },
    };

    schema.setCLP(clp);
    await schema.update({ useMasterKey: true });

    logger.info(`[${SEED_NAME}] Class Level Permissions set successfully`, {
      clp: 'MasterKey only (SuperAdmin via cloud functions)',
    });
  } catch (error) {
    logger.error(`[${SEED_NAME}] Error setting CLPs`, {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Run the seed
 * @returns {Promise<object>} Seed result with statistics
 */
async function run() {
  const startTime = Date.now();
  const statistics = {
    created: 0,
    skipped: 0,
    errors: 0,
  };

  logger.info(`[${SEED_NAME}] Starting seed execution...`);

  try {
    // Check if class already exists
    const exists = await classExists();

    if (exists) {
      logger.info(`[${SEED_NAME}] EmailLog class already exists, skipping creation`);
      statistics.skipped++;

      // Still try to add indexes and CLPs in case they're missing
      try {
        await addIndexes();
        await setClassLevelPermissions();
        logger.info(`[${SEED_NAME}] Updated indexes and CLPs for existing class`);
      } catch (error) {
        logger.warn(`[${SEED_NAME}] Error updating existing class`, {
          error: error.message,
        });
      }
    } else {
      // Create class
      await createEmailLogClass();
      statistics.created++;

      // Add indexes
      await addIndexes();

      // Set CLPs
      await setClassLevelPermissions();
    }

    const duration = Date.now() - startTime;

    logger.info(`[${SEED_NAME}] Seed completed successfully`, {
      duration: `${duration}ms`,
      statistics,
    });

    return {
      success: true,
      seedName: SEED_NAME,
      version: VERSION,
      statistics,
      duration,
    };
  } catch (error) {
    statistics.errors++;
    const duration = Date.now() - startTime;

    logger.error(`[${SEED_NAME}] Seed execution failed`, {
      error: error.message,
      statistics,
      duration: `${duration}ms`,
    });

    return {
      success: false,
      seedName: SEED_NAME,
      version: VERSION,
      error: error.message,
      statistics,
      duration,
    };
  }
}

// Export for seed runner
module.exports = {
  run,
  seedName: SEED_NAME,
  version: VERSION,
  description: 'Create EmailLog class with schema, indexes, and CLPs for email traceability',
};

// Allow direct execution for testing
if (require.main === module) {
  // Initialize Parse
  Parse.initialize(
    process.env.PARSE_APP_ID || 'amexing-app-id',
    null,
    process.env.PARSE_MASTER_KEY
  );
  Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

  run()
    .then(result => {
      console.log('Seed result:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Seed failed:', error);
      process.exit(1);
    });
}
