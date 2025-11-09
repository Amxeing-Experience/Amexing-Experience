/**
 * Parse Platform Real Environment Configuration
 * Uses .env.development configuration for real database testing
 * This file is specifically for real environment tests that connect to actual Parse Server
 */

const path = require('path');

// Load development environment variables (real MongoDB Atlas and Parse Server)
require('dotenv').config({
  path: path.join(__dirname, '../../environments/.env.development')
});

// Set NODE_ENV for testing but keep development database connections
process.env.NODE_ENV = 'test';

// Parse Server Configuration - Use development values for real testing
process.env.PARSE_APPLICATION_ID = process.env.PARSE_APP_ID;
process.env.PARSE_JAVASCRIPT_KEY = process.env.PARSE_JAVASCRIPT_KEY || 'parse-platform-real-test-js-key';
process.env.PARSE_MASTER_KEY = process.env.PARSE_MASTER_KEY;

// Use real Parse Server (development instance)
process.env.PARSE_SERVER_URL = process.env.PARSE_SERVER_URL; // http://localhost:1337/parse
process.env.PARSE_PUBLIC_SERVER_URL = process.env.PARSE_PUBLIC_SERVER_URL;

// Use real MongoDB Atlas database (development instance with test prefixes)
process.env.DATABASE_URI = process.env.DATABASE_URI; // MongoDB Atlas URL
process.env.DATABASE_NAME = process.env.DATABASE_NAME; // AmexingDEV

// Test-specific configurations (safe prefixes to avoid affecting real data)
process.env.PARSE_PLATFORM_TEST_PREFIX = 'ParseTest_';
process.env.PARSE_PLATFORM_TEST_MODE = 'real';
process.env.PARSE_PLATFORM_REAL_ENVIRONMENT = 'true';

// Security Configuration (from .env.development)
process.env.SESSION_SECRET = process.env.SESSION_SECRET;
process.env.JWT_SECRET = process.env.JWT_SECRET;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

// Parse Platform specific configurations for real testing
process.env.PARSE_PLATFORM_LOG_LEVEL = 'warn'; // More verbose for real testing
process.env.PARSE_PLATFORM_ENABLE_CACHE = 'true'; // Use real caching
process.env.PARSE_PLATFORM_MAX_LIMIT = '1000'; // Set reasonable limit for tests

// Real Database Connection Settings
process.env.PARSE_PLATFORM_DB_TIMEOUT = '60000'; // 60 seconds for real connections
process.env.PARSE_PLATFORM_QUERY_TIMEOUT = '30000'; // 30 seconds for real queries
process.env.PARSE_PLATFORM_CONNECTION_POOL_SIZE = '10'; // Larger pool for real tests

// Parse Platform Real Testing Features
process.env.PARSE_PLATFORM_ENABLE_SCHEMA_VALIDATION = 'true';
process.env.PARSE_PLATFORM_ENABLE_LIVE_QUERY = 'false'; // Still disable for testing
process.env.PARSE_PLATFORM_ENABLE_PUSH_NOTIFICATIONS = 'false'; // Still disable for testing

// Real Test Data Configuration
process.env.USE_SYNTHETIC_TEST_DATA = 'true';
process.env.GENERATE_RANDOM_TEST_DATA = 'true';
process.env.TEST_DATA_CLEANUP_ON_TEARDOWN = 'true';
process.env.CLEANUP_TEST_DATA_IMMEDIATELY = 'true'; // Clean up immediately in real env

// Performance Testing Settings for Real Environment
process.env.PARSE_PLATFORM_MAX_CONCURRENT_OPERATIONS = '5'; // More conservative for real env
process.env.PARSE_PLATFORM_BULK_OPERATION_BATCH_SIZE = '25'; // Smaller batches for real env
process.env.PARSE_PLATFORM_TEST_PERFORMANCE_METRICS = 'true';

// Error Testing Configuration (disabled for real environment)
process.env.SIMULATE_PARSE_SERVER_ERRORS = 'false';
process.env.SIMULATE_DATABASE_CONNECTION_ERRORS = 'false';
process.env.SIMULATE_NETWORK_TIMEOUT_ERRORS = 'false';

// Logging Configuration for Real Tests
process.env.LOG_LEVEL = 'warn'; // More verbose than unit tests
process.env.LOG_DIR = '.runtime/logs/real-test';
process.env.ENABLE_AUDIT_LOGGING = 'false'; // Still disable audit logging for tests

// Security Settings for Real Testing (more restrictive)
process.env.DISABLE_HTTPS_REQUIREMENT = 'true'; // Still needed for localhost
process.env.ALLOW_INSECURE_COOKIES = 'true'; // Still needed for localhost
process.env.SKIP_CSRF_VALIDATION = 'true'; // Still needed for testing

// Rate Limiting (more realistic for real testing)
process.env.RATE_LIMIT_WINDOW_MS = '60000'; // 1 minute
process.env.RATE_LIMIT_MAX_REQUESTS = '500'; // More realistic limit

// Parse Platform Cloud Code Configuration for Real Testing
process.env.PARSE_PLATFORM_CLOUD_CODE_TIMEOUT = '15000'; // 15 seconds for real env
process.env.PARSE_PLATFORM_ENABLE_CLOUD_CODE = 'true';
process.env.PARSE_PLATFORM_CLOUD_CODE_STRICT_MODE = 'true';

// Real Environment Validation Settings
process.env.ENABLE_SCHEMA_VALIDATION = 'true';
process.env.ENABLE_DATA_INTEGRITY_CHECKS = 'true';
process.env.ENABLE_PERFORMANCE_MONITORING = 'true';
process.env.VALIDATE_PARSE_SERVER_CONNECTION = 'true';

// Parse Platform specific real test collections (using test prefix for safety)
process.env.TEST_COLLECTIONS = JSON.stringify([
  'ParseTest_User',
  'ParseTest_Role',
  'ParseTest_Session',
  'ParseTest_Installation',
  'ParseTest_AmexingUser',
  'ParseTest_Event',
  'ParseTest_Notification',
  'ParseTest_Permission',
  'ParseTest_AuditLog'
]);

// Feature Flags for Real Environment Testing
process.env.ENABLE_PARSE_OBJECT_TESTING = 'true';
process.env.ENABLE_PARSE_QUERY_TESTING = 'true';
process.env.ENABLE_PARSE_USER_TESTING = 'true';
process.env.ENABLE_PARSE_CLOUD_TESTING = 'true';
process.env.ENABLE_PARSE_SCHEMA_TESTING = 'true';
process.env.ENABLE_PARSE_SECURITY_TESTING = 'true';
process.env.ENABLE_REAL_DATABASE_TESTING = 'true';

// Real Environment Test Timeouts and Retries
process.env.PARSE_PLATFORM_DEFAULT_TIMEOUT = '60000'; // Longer for real env
process.env.PARSE_PLATFORM_RETRY_ATTEMPTS = '3';
process.env.PARSE_PLATFORM_RETRY_DELAY = '2000'; // Longer delay for real env

// Memory and Performance Limits for Real Environment
process.env.PARSE_PLATFORM_MEMORY_LIMIT_MB = '512'; // More memory for real env
process.env.PARSE_PLATFORM_CPU_LIMIT_PERCENT = '75'; // More CPU for real env

// Connection validation settings
process.env.WAIT_FOR_PARSE_SERVER = 'true';
process.env.PARSE_SERVER_READY_TIMEOUT = '30000'; // 30 seconds to wait for server
process.env.SKIP_TESTS_IF_SERVER_UNAVAILABLE = 'false'; // Fail if server not available

console.log('Parse Platform REAL environment testing configured');
console.log(`Parse Server URL: ${process.env.PARSE_SERVER_URL}`);
console.log(`Parse App ID: ${process.env.PARSE_APPLICATION_ID}`);
console.log(`Database URI: ${process.env.DATABASE_URI.replace(/\/\/([^:]+):([^@]+)@/, '//****:****@')}`); // Mask credentials
console.log(`Database Name: ${process.env.DATABASE_NAME}`);
console.log(`Test Collection Prefix: ${process.env.PARSE_PLATFORM_TEST_PREFIX}`);
console.log(`Test Mode: ${process.env.PARSE_PLATFORM_TEST_MODE}`);
console.log(`Real Environment: ${process.env.PARSE_PLATFORM_REAL_ENVIRONMENT}`);