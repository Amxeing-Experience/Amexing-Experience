/**
 * Parse Platform Global Test Setup
 * Initializes test environment before all tests
 */

const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '../../../environments/.env.development')
});

module.exports = async () => {
  console.log('\n🚀 Starting Parse Platform global test setup...');

  // Set test environment
  process.env.NODE_ENV = 'test';

  // Override database URL to use test database
  if (process.env.MONGODB_URI) {
    const testDbUrl = process.env.MONGODB_URI.replace(/\/[^/]+$/, '/parse-test');
    process.env.MONGODB_URI_TEST = testDbUrl;
    console.log('   📦 Test database configured');
  }

  // Set test-specific environment variables
  process.env.PARSE_TEST_MODE = 'true';
  process.env.LOG_LEVEL = process.env.CI ? 'error' : 'warn';

  console.log('   ✅ Parse Platform global setup complete\n');
};