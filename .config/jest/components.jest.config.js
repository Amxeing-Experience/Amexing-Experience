/**
 * Jest Configuration for Component Testing
 */

module.exports = {
  // Root directory
  rootDir: '../../',

  // Test environment
  testEnvironment: 'node',

  // Display name for this configuration
  displayName: 'Components',

  // Setup files for component testing
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup.js',
    '<rootDir>/tests/setup/componentSetup.js'
  ],

  // Test patterns - only component tests
  testMatch: [
    '**/tests/unit/components/**/*.test.js',
    '**/tests/unit/components/**/*.spec.js'
  ],

  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/coverage/',
    '/.runtime/logs/',
    '/tests/integration/',
    '/tests/oauth/',
    '/tests/parse-platform/'
  ],

  // Coverage configuration specific to components
  collectCoverage: false, // Disable for now until EJS coverage is properly configured
  coverageDirectory: 'coverage/components',
  coverageReporters: ['text', 'lcov', 'html', 'json'],

  // Module directories
  moduleDirectories: ['node_modules', 'src', 'tests'],

  // Test timeout for component rendering
  testTimeout: 15000,

  // Verbose output for component tests
  verbose: true,

  // Clear mocks between tests
  clearMocks: true,

  // Don't force exit (let tests complete naturally)
  forceExit: false,

  // Detect open handles for debugging
  detectOpenHandles: true,

  // Environment variables for component tests
  setupFiles: ['<rootDir>/tests/jest.env.js'],

  // Transform configuration (for EJS files if needed)
  transform: {
    '\\.ejs$': '<rootDir>/tests/transformers/ejsTransformer.js'
  },

  // Module file extensions
  moduleFileExtensions: ['js', 'json', 'ejs'],

  // Global setup and teardown
  globalSetup: '<rootDir>/tests/globalSetup.js',
  globalTeardown: '<rootDir>/tests/globalTeardown.js',

  // Test results processor for component reporting
  testResultsProcessor: '<rootDir>/tests/processors/componentResultsProcessor.js',

  // Reporters
  reporters: ['default'],

  // Custom test name pattern
  testNamePattern: undefined,

  // Bail after first test failure (optional)
  bail: false,

  // Maximum number of concurrent test files
  maxConcurrency: 5,

  // Maximum worker processes
  maxWorkers: '50%'
};