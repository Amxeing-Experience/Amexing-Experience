/**
 * Jest Configuration for Parse Platform Testing
 * Extends base Jest config with Parse Platform-specific settings
 */

const baseConfig = require('./jest.config');

module.exports = {
  ...baseConfig,

  // Test environment
  displayName: {
    name: 'Parse Platform Tests',
    color: 'green'
  },

  // Parse Platform-specific test patterns
  testMatch: [
    '**/tests/parse-platform/**/*.test.js',
    '**/tests/parse-platform/**/*.spec.js'
  ],

  // Ignore patterns specific to Parse Platform testing
  testPathIgnorePatterns: [
    ...baseConfig.testPathIgnorePatterns,
    '/tests/parse-platform/helpers/mocks/', // Mock implementations
    '/tests/parse-platform/fixtures/', // Test fixtures
    '/tests/parse-platform/deprecated/' // Deprecated tests
  ],

  // Extended timeout for Parse Platform operations (database operations can be slow)
  testTimeout: 60000, // 60 seconds

  // Parse Platform-specific setup files
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup.js',
    '<rootDir>/tests/parse-platform/helpers/parse-test-setup.js'
  ],

  // Environment setup for Parse Platform testing
  setupFiles: [
    '<rootDir>/tests/jest.env.js',
    '<rootDir>/tests/parse-platform/parse-platform.env.js'
  ],

  // Coverage configuration for Parse Platform modules
  collectCoverageFrom: [
    ...baseConfig.collectCoverageFrom,
    'src/**/*.js',
    'src/cloud/**/*.js',
    'src/application/**/*.js',
    'src/domain/**/*.js',
    'src/infrastructure/**/*.js',
    'src/services/**/*.js',
    // Exclude Parse Platform mocks and test utilities
    '!src/cloud/main.js', // Exclude main cloud code file
    '!src/**/*.mock.js',
    '!src/**/*.fixture.js'
  ],

  // Parse Platform-specific coverage thresholds
  coverageThreshold: {
    global: {
      branches: 75, // Higher threshold for Parse Platform code
      functions: 75,
      lines: 75,
      statements: 75
    },
    // Specific thresholds for Parse Platform modules
    'src/domain/': {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85
    },
    'src/application/': {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },

  // Custom reporters for Parse Platform testing
  reporters: [
    'default'
  ],

  // Global setup and teardown for Parse Platform testing
  globalSetup: '<rootDir>/tests/parse-platform/helpers/parse-global-setup.js',
  globalTeardown: '<rootDir>/tests/parse-platform/helpers/parse-global-teardown.js',

  // Module name mapping for Parse Platform dependencies (only custom mappings)
  moduleNameMapper: {
    '^@parse-tests/(.*)$': '<rootDir>/tests/parse-platform/$1',
    '^@parse-mocks/(.*)$': '<rootDir>/tests/parse-platform/helpers/mocks/$1',
    '^@test-data/(.*)$': '<rootDir>/tests/parse-platform/helpers/test-data/$1'
  },

  // Transform configuration
  transform: {
    '^.+\\.js$': 'babel-jest'
  },

  // Test environment variables
  testEnvironment: 'node',

  // Additional Jest options for Parse Platform testing
  verbose: true,
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,

  // Sequential test execution for database operations
  maxWorkers: process.env.CI ? 1 : '25%', // More conservative for database operations

  // Detect open handles (important for Parse Server connections)
  detectOpenHandles: true,
  detectLeaks: true,

  // Fail fast on first test failure in CI
  bail: process.env.CI ? 1 : false,

  // Cache directory specific to Parse Platform tests
  cacheDirectory: '<rootDir>/node_modules/.cache/jest-parse-platform',

  // Watch mode configuration
  watchPathIgnorePatterns: [
    '<rootDir>/reports/',
    '<rootDir>/coverage/',
    '<rootDir>/logs/',
    '<rootDir>/node_modules/',
    '<rootDir>/.runtime/'
  ],

};