/**
 * Jest Environment Setup
 * Sets environment variables for testing
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Set NODE_ENV to test
process.env.NODE_ENV = 'test';

// Load test environment variables from .env.test (if exists)
const envTestPath = path.join(__dirname, '../environments/.env.test');
const envExamplePath = path.join(__dirname, '../environments/.env.test.example');

if (fs.existsSync(envTestPath)) {
  // Load real AWS credentials for local testing
  dotenv.config({ path: envTestPath });
  console.log('✅ Loaded .env.test with real AWS credentials (local testing)');
} else {
  console.log('⚠️  .env.test not found - using example configuration');
  console.log('   For S3 integration tests, create .env.test with real credentials');
  console.log('   See: docs/AWS_TEST_CREDENTIALS.md');

  // Fallback to .env.test.example for structure validation
  if (fs.existsSync(envExamplePath)) {
    dotenv.config({ path: envExamplePath });
    console.log('ℹ️  Loaded .env.test.example as base configuration');
  }
}

// Override specific test configurations (MongoDB Memory Server)
process.env.PARSE_APP_ID = 'test-app-id';
process.env.PARSE_MASTER_KEY = 'test-master-key';
process.env.PARSE_SERVER_URL = 'http://localhost:1339/parse';
process.env.DATABASE_URI = process.env.TEST_DATABASE_URI || 'mongodb://localhost:27017/AmexingTEST';
process.env.PORT = '1340'; // Use different port for main app in tests
process.env.DASHBOARD_PORT = '4041'; // Use different port for dashboard in tests
process.env.LOG_LEVEL = 'error';

// Disable certain features during testing
process.env.ENABLE_MONITORING = 'false';
process.env.ENABLE_AUDIT_LOGGING = 'false';
process.env.ENABLE_DASHBOARD = 'false'; // Disable dashboard for most tests

// Mock OAuth environment variables for testing
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
process.env.MICROSOFT_CLIENT_ID = 'test-microsoft-client-id';
process.env.APPLE_CLIENT_ID = 'test-apple-client-id';

// Validate AWS credentials for S3 integration tests
const hasAWSCredentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY;
if (!hasAWSCredentials) {
  console.log('⚠️  AWS credentials not configured - S3 integration tests will fail');
  console.log('   Create environments/.env.test with real test IAM credentials');
  console.log('   Quick setup:');
  console.log('   1. cp environments/.env.test.example environments/.env.test');
  console.log('   2. Edit .env.test with real AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
  console.log('   3. See: docs/AWS_TEST_CREDENTIALS.md for complete guide');
} else {
  // Mask credentials in output for security
  const maskedKey = process.env.AWS_ACCESS_KEY_ID.substring(0, 8) + '***';
  console.log(`✅ AWS credentials configured: ${maskedKey}`);
}

console.log('Test environment configured');
console.log('Database URI:', process.env.DATABASE_URI);
console.log('Parse Server URL:', process.env.PARSE_SERVER_URL);