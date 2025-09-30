/**
 * Jest Configuration
 */

module.exports = {
  // Root directory
  rootDir: '../../',
  
  // Test environment
  testEnvironment: 'node',

  // Setup files
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup.js',
    '<rootDir>/tests/setup/componentSetup.js'
  ],

  // Test patterns
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.js'
  ],

  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/coverage/',
    '/.runtime/logs/',
    '/tests/parse-platform/' // Exclude Parse Platform tests until proper server setup
  ],

  // Coverage configuration
  collectCoverage: false, // Enable when needed
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/*.spec.js',
    '!src/cloud/main.js', // Exclude cloud code main
    '!**/node_modules/**'
  ],

  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },

  // Module directories
  moduleDirectories: ['node_modules', 'src'],

  // Test timeout
  testTimeout: 30000,

  // Verbose output
  verbose: true,

  // Clear mocks between tests
  clearMocks: true,

  // Force exit after tests complete
  forceExit: true,

  // Detect open handles
  detectOpenHandles: true,

  // Run tests serially to avoid port conflicts
  maxWorkers: 1,

  // Additional Jest configuration for stability
  testSequencer: '<rootDir>/tests/testSequencer.js',

  // Environment variables for tests
  setupFiles: ['<rootDir>/tests/jest.env.js'],

  // Transform configuration
  transform: {
    '\\.ejs$': '<rootDir>/tests/transformers/ejsTransformer.js'
  },

  // Module file extensions
  moduleFileExtensions: ['js', 'json', 'ejs'],

  // Global setup and teardown
  globalSetup: '<rootDir>/tests/globalSetup.js',
  globalTeardown: '<rootDir>/tests/globalTeardown.js',
};