/**
 * Test Setup Configuration
 * Sets up test environment for Parse Server and database testing
 *
 * NOTE: This setup is now simplified since globalSetup.js handles
 * Parse Server initialization and database seeding.
 * This file is kept for backward compatibility with existing tests.
 */

const Parse = require('parse/node');

// Test configuration
const testConfig = {
  databaseURI: process.env.TEST_DATABASE_URI || process.env.DATABASE_URI || 'mongodb://localhost:27017/AmexingTEST',
  appId: 'test-app-id',
  masterKey: 'test-master-key',
  serverURL: 'http://localhost:1339/parse',
  port: 1339,
  silent: true,
  logLevel: 'error',
  maxUploadSize: '1mb',
};

/**
 * Setup test environment before running tests
 * Now just ensures Parse SDK is configured correctly
 */
const setupTests = async () => {
  try {
    // Re-initialize Parse SDK with master key for tests
    // This ensures tests have master key access
    Parse.initialize(testConfig.appId, null, testConfig.masterKey);
    Parse.serverURL = testConfig.serverURL;
    Parse.masterKey = testConfig.masterKey;

    // Wait a bit for everything to be ready
    await new Promise(resolve => setTimeout(resolve, 500));

    return true;
  } catch (error) {
    console.error('Failed to setup test environment:', error);
    throw error;
  }
};

/**
 * Cleanup test environment after tests
 * Now handled by globalTeardown.js
 */
const teardownTests = async () => {
  try {
    // Logout current user if any
    await Parse.User.logOut().catch(() => {});
  } catch (error) {
    // Ignore cleanup errors
  }
};

/**
 * Clear test database
 * @deprecated DO NOT USE - This destroys seeded data required by new test system
 *
 * The new test system uses globalSetup.js to seed the database once before all tests.
 * Clearing the database between tests will break RBAC tests and other tests that
 * depend on seeded roles, permissions, and users.
 *
 * If you need to clean up test data, use TestCleanupHelper.cleanupNonSeededUsers()
 * which preserves the seeded data while removing test-created data.
 */
const clearDatabase = async () => {
  console.warn('⚠️  WARNING: clearDatabase() is deprecated and should not be used!');
  console.warn('⚠️  This function destroys seeded data required by the test system.');
  console.warn('⚠️  Use TestCleanupHelper.cleanupNonSeededUsers() instead.');

  // Commenting out the actual clearing to prevent accidental data loss
  /*
  try {
    const schemas = await Parse.Schema.all();

    for (const schema of schemas) {
      if (schema.className.startsWith('_')) continue; // Skip system classes

      const query = new Parse.Query(schema.className);
      const objects = await query.find({ useMasterKey: true });

      if (objects.length > 0) {
        await Parse.Object.destroyAll(objects, { useMasterKey: true });
      }
    }

    console.log('Test database cleared');
  } catch (error) {
    console.error('Failed to clear test database:', error);
  }
  */
};

module.exports = {
  setupTests,
  teardownTests,
  clearDatabase,
  testConfig,
};