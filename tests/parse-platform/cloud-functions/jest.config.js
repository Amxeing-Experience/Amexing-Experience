/**
 * Jest configuration for Parse Cloud Functions testing
 */

module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Root directory for tests
  rootDir: '../../../',

  // Test files pattern
  testMatch: [
    '<rootDir>/tests/parse-platform/cloud-functions/**/*.test.js'
  ],

  // Setup files
  setupFilesAfterEnv: [
    '<rootDir>/tests/parse-platform/helpers/parse-global-setup.js'
  ],

  // Global teardown
  globalTeardown: '<rootDir>/tests/parse-platform/helpers/parse-global-teardown.js',

  // Test timeout (increased for cloud function calls)
  testTimeout: 30000,

  // Coverage configuration
  collectCoverage: false, // Disable for external service testing
  coverageDirectory: '<rootDir>/coverage/cloud-functions',
  collectCoverageFrom: [
    'src/cloud/**/*.js',
    '!src/cloud/main.js', // Main file is integration point
    '!**/node_modules/**'
  ],

  // Module paths
  moduleDirectories: ['node_modules', '<rootDir>/src'],

  // Transform configuration
  transform: {
    '^.+\\.js$': 'babel-jest'
  },

  // Environment variables
  setupFiles: ['<rootDir>/tests/parse-platform/cloud-functions/jest.setup.js'],

  // Test reporting
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: '<rootDir>/test-results/cloud-functions',
      outputName: 'cloud-functions-results.xml',
      classNameTemplate: '{classname}',
      titleTemplate: '{title}',
      ancestorSeparator: ' › ',
      usePathForSuiteName: true
    }]
  ],

  // Verbose output for debugging
  verbose: true,

  // Clear mocks between tests
  clearMocks: true,

  // Reset modules between tests
  resetMocks: false,
  resetModules: false,

  // Error handling
  errorOnDeprecated: false, // Parse SDK may have deprecation warnings

  // Module name mapping
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1'
  },

  // Test result processor
  testResultsProcessor: '<rootDir>/tests/parse-platform/cloud-functions/test-processor.js',

  // Maximum worker processes (reduce for cloud function testing)
  maxWorkers: 2,

  // Bail configuration (stop on first failure for debugging)
  bail: false,

  // Cache configuration
  cache: true,
  cacheDirectory: '<rootDir>/.jest-cache/cloud-functions',

  // Watch configuration
  watchman: false, // Disable watchman for CI environments

  // Silent mode for cleaner output during automated runs
  silent: false,

  // Force exit after tests complete
  forceExit: true,

  // Detect handles that prevent Jest from exiting
  detectOpenHandles: true,

  // Run tests in serial to avoid Parse Server conflicts
  maxConcurrency: 1,

  // Global configuration
  globals: {
    'process.env.NODE_ENV': 'test',
    'process.env.PARSE_PLATFORM_TEST_PREFIX': 'CloudTest_'
  }
};