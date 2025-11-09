/**
 * Parse Platform Testing Environment Configuration
 * Sets up environment variables for Parse Platform testing scenarios
 * Uses .env.development configuration for real database testing
 */

require('dotenv').config(); // Load .env.development configuration

// Set NODE_ENV for testing
process.env.NODE_ENV = 'test';

// Parse Server Configuration for Parse Platform Testing
// Use development database with test table prefixes to avoid conflicts
process.env.PARSE_APPLICATION_ID = process.env.PARSE_APP_ID || 'CrTRTaJpoJFNt8PJ';
process.env.PARSE_JAVASCRIPT_KEY = 'parse-platform-test-javascript-key';
process.env.PARSE_MASTER_KEY = process.env.PARSE_MASTER_KEY || 'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP';
process.env.PARSE_SERVER_URL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

// Database Configuration - Use development database with test prefixes
process.env.DATABASE_URI = process.env.DATABASE_URI || 'mongodb+srv://meeplab:4BPNSdISUd5u1K29@cluster0.pxvyx.mongodb.net/AmexingDEV?retryWrites=true&w=majority&appName=Cluster0';
process.env.DATABASE_NAME = process.env.DATABASE_NAME || 'AmexingDEV';

// Test-specific configurations
process.env.PARSE_PLATFORM_TEST_PREFIX = 'ParseTest_'; // Prefix for test collections
process.env.PARSE_PLATFORM_TEST_MODE = 'true';

// Security Configuration (from .env.development)
process.env.SESSION_SECRET = process.env.SESSION_SECRET || '4d+pkkGLk1CyjFM0a/4ppPRezJAxwSQrAz+ViPNI+l9WByAaN5+Y0vN9B0uvzTr21DykNY4L8c0hSheXspq5FA==';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'pnpyG85KTzerWz6YQHjmzfVUSwQs7iedKixkSZvfpr+jYt1Rk9clgNNAGfNCIscFmXh9pZbWhnUj046u4sRoDQ==';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'UVcyEGNFHDNyn49g2VxuuTi29h4Ecsetk78LWhM352U=';

// Parse Platform specific configurations
process.env.PARSE_PLATFORM_LOG_LEVEL = 'error'; // Reduce noise during testing
process.env.PARSE_PLATFORM_ENABLE_CACHE = 'false'; // Disable caching for consistent tests
process.env.PARSE_PLATFORM_MAX_LIMIT = '1000'; // Set reasonable limit for tests

// Test Database Connection Settings
process.env.PARSE_PLATFORM_DB_TIMEOUT = '30000'; // 30 seconds
process.env.PARSE_PLATFORM_QUERY_TIMEOUT = '15000'; // 15 seconds
process.env.PARSE_PLATFORM_CONNECTION_POOL_SIZE = '5'; // Small pool for tests

// Parse Platform Testing Features
process.env.PARSE_PLATFORM_ENABLE_SCHEMA_VALIDATION = 'true';
process.env.PARSE_PLATFORM_ENABLE_LIVE_QUERY = 'false'; // Disable for testing
process.env.PARSE_PLATFORM_ENABLE_PUSH_NOTIFICATIONS = 'false'; // Disable for testing

// Test Data Configuration
process.env.USE_SYNTHETIC_TEST_DATA = 'true';
process.env.GENERATE_RANDOM_TEST_DATA = 'true';
process.env.TEST_DATA_CLEANUP_ON_TEARDOWN = 'true';

// Performance Testing Settings
process.env.PARSE_PLATFORM_MAX_CONCURRENT_OPERATIONS = '10';
process.env.PARSE_PLATFORM_BULK_OPERATION_BATCH_SIZE = '50';
process.env.PARSE_PLATFORM_TEST_PERFORMANCE_METRICS = 'true';

// Error Testing Configuration
process.env.SIMULATE_PARSE_SERVER_ERRORS = 'false';
process.env.SIMULATE_DATABASE_CONNECTION_ERRORS = 'false';
process.env.SIMULATE_NETWORK_TIMEOUT_ERRORS = 'false';

// Logging Configuration for Tests
process.env.LOG_LEVEL = 'error'; // Reduce log noise during testing
process.env.LOG_DIR = '.runtime/logs/test';
process.env.ENABLE_AUDIT_LOGGING = 'false'; // Disable audit logging for tests

// Security Settings for Testing (relaxed for test environment)
process.env.DISABLE_HTTPS_REQUIREMENT = 'true';
process.env.ALLOW_INSECURE_COOKIES = 'true';
process.env.SKIP_CSRF_VALIDATION = 'true';

// Rate Limiting (relaxed for testing)
process.env.RATE_LIMIT_WINDOW_MS = '60000'; // 1 minute
process.env.RATE_LIMIT_MAX_REQUESTS = '1000'; // High limit for tests

// Parse Platform Cloud Code Configuration
process.env.PARSE_PLATFORM_CLOUD_CODE_TIMEOUT = '10000'; // 10 seconds
process.env.PARSE_PLATFORM_ENABLE_CLOUD_CODE = 'true';
process.env.PARSE_PLATFORM_CLOUD_CODE_STRICT_MODE = 'true';

// Test Validation Settings
process.env.ENABLE_SCHEMA_VALIDATION = 'true';
process.env.ENABLE_DATA_INTEGRITY_CHECKS = 'true';
process.env.ENABLE_PERFORMANCE_MONITORING = 'true';

// Parse Platform specific test collections (using test prefix)
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

// Feature Flags for Testing
process.env.ENABLE_PARSE_OBJECT_TESTING = 'true';
process.env.ENABLE_PARSE_QUERY_TESTING = 'true';
process.env.ENABLE_PARSE_USER_TESTING = 'true';
process.env.ENABLE_PARSE_CLOUD_TESTING = 'true';
process.env.ENABLE_PARSE_SCHEMA_TESTING = 'true';
process.env.ENABLE_PARSE_SECURITY_TESTING = 'true';

// Test Timeouts and Retries
process.env.PARSE_PLATFORM_DEFAULT_TIMEOUT = '30000';
process.env.PARSE_PLATFORM_RETRY_ATTEMPTS = '3';
process.env.PARSE_PLATFORM_RETRY_DELAY = '1000';

// Memory and Performance Limits
process.env.PARSE_PLATFORM_MEMORY_LIMIT_MB = '256';
process.env.PARSE_PLATFORM_CPU_LIMIT_PERCENT = '50';

console.log('Parse Platform testing environment configured');
console.log(`Parse Server URL: ${process.env.PARSE_SERVER_URL}`);
console.log(`Parse App ID: ${process.env.PARSE_APPLICATION_ID}`);
console.log(`Database URI: ${process.env.DATABASE_URI.replace(/\/\/([^:]+):([^@]+)@/, '//****:****@')}`); // Mask credentials
console.log(`Test Collection Prefix: ${process.env.PARSE_PLATFORM_TEST_PREFIX}`);
console.log(`Test Mode: ${process.env.PARSE_PLATFORM_TEST_MODE}`);