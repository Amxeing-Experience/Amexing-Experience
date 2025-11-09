/**
 * OAuth Testing Environment Configuration
 * Sets up environment variables for OAuth testing scenarios
 */

// Set NODE_ENV for testing
process.env.NODE_ENV = 'test';

// Parse Server Configuration for OAuth Testing
process.env.PARSE_APPLICATION_ID = 'amexing-oauth-test';
process.env.PARSE_JAVASCRIPT_KEY = 'test-javascript-key';
process.env.PARSE_MASTER_KEY = 'test-master-key';
process.env.PARSE_SERVER_URL = 'http://localhost:1337/parse';

// OAuth Provider Configurations (Test Values)
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/oauth/callback/google';

process.env.MICROSOFT_CLIENT_ID = 'test-microsoft-client-id';
process.env.MICROSOFT_CLIENT_SECRET = 'test-microsoft-client-secret';
process.env.MICROSOFT_REDIRECT_URI = 'http://localhost:3000/oauth/callback/microsoft';

// Test Database Configuration
process.env.DATABASE_URI = 'mongodb://localhost:27017/amexing-oauth-test';
process.env.REDIS_URL = 'redis://localhost:6379/1'; // Use database 1 for testing

// Encryption Keys for Testing
process.env.AUDIT_ENCRYPTION_KEY = 'test-audit-encryption-key-32-chars';
process.env.SESSION_SECRET = 'test-session-secret-for-oauth-testing';

// Permission System Configuration
process.env.PERMISSION_CACHE_TTL = '300'; // 5 minutes for testing
process.env.CONTEXT_VALIDATION_TIMEOUT = '5000'; // 5 seconds for testing
process.env.DELEGATION_MAX_DURATION = '86400000'; // 24 hours in milliseconds

// PCI DSS Compliance Settings
process.env.AUDIT_RETENTION_PERIOD = '31536000000'; // 1 year in milliseconds
process.env.AUDIT_ENCRYPTION_ALGORITHM = 'AES-256-GCM';
process.env.REQUIRE_AUDIT_ENCRYPTION = 'true';

// Logging Configuration
process.env.LOG_LEVEL = 'debug';
process.env.LOG_AUDIT_EVENTS = 'true';
process.env.LOG_PERFORMANCE_METRICS = 'true';

// Corporate Configuration for Testing
process.env.CORPORATE_DOMAIN_WHITELIST = 'company.com,subsidiary.com';
process.env.ENABLE_CORPORATE_SSO = 'true';
process.env.CORPORATE_PERMISSION_INHERITANCE = 'true';

// Rate Limiting (Relaxed for Testing)
process.env.OAUTH_RATE_LIMIT = '1000'; // 1000 requests per minute
process.env.CONTEXT_SWITCH_RATE_LIMIT = '100'; // 100 context switches per minute

// Feature Flags
process.env.ENABLE_PERMISSION_INHERITANCE = 'true';
process.env.ENABLE_CONTEXT_SWITCHING = 'true';
process.env.ENABLE_PERMISSION_DELEGATION = 'true';
process.env.ENABLE_TEMPORARY_ELEVATION = 'true';
process.env.ENABLE_COMPREHENSIVE_AUDIT = 'true';

// Test-Specific Configurations
process.env.MOCK_OAUTH_RESPONSES = 'true';
process.env.SKIP_EXTERNAL_API_CALLS = 'true';
process.env.USE_SYNTHETIC_TEST_DATA = 'true';
process.env.ENABLE_TEST_MATCHERS = 'true';

// Timeout Configurations
process.env.OAUTH_FLOW_TIMEOUT = '30000'; // 30 seconds
process.env.PERMISSION_CALCULATION_TIMEOUT = '10000'; // 10 seconds
process.env.AUDIT_WRITE_TIMEOUT = '5000'; // 5 seconds

// Security Settings for Testing
process.env.DISABLE_HTTPS_REQUIREMENT = 'true'; // Only for testing
process.env.ALLOW_INSECURE_COOKIES = 'true'; // Only for testing
process.env.SKIP_CSRF_VALIDATION = 'true'; // Only for testing

// Performance Testing Settings
process.env.MAX_CONCURRENT_OAUTH_FLOWS = '50';
process.env.MAX_CONCURRENT_CONTEXT_SWITCHES = '20';
process.env.MAX_CONCURRENT_DELEGATIONS = '10';

// Error Simulation Flags (for resilience testing)
process.env.SIMULATE_OAUTH_PROVIDER_ERRORS = 'false';
process.env.SIMULATE_DATABASE_ERRORS = 'false';
process.env.SIMULATE_NETWORK_TIMEOUTS = 'false';

console.log('OAuth testing environment configured');
console.log(`Parse Server URL: ${process.env.PARSE_SERVER_URL}`);
console.log(`Test Database: ${process.env.DATABASE_URI}`);
console.log(`OAuth Rate Limit: ${process.env.OAUTH_RATE_LIMIT} requests/minute`);