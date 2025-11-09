/**
 * Jest Configuration for Parse Platform Real Environment Testing
 * Uses .env.development configuration for real database testing
 */

const baseConfig = require('./jest.config');
const path = require('path');

// Load development environment variables
require('dotenv').config({
  path: path.join(__dirname, '../../environments/.env.development')
});

module.exports = {
  ...baseConfig,

  // Test environment
  displayName: {
    name: 'Parse Platform Real Environment Tests',
    color: 'yellow'
  },

  // Parse Platform real environment test patterns
  testMatch: [
    '**/tests/parse-platform/real-environment/**/*.test.js'
  ],

  // Ignore patterns specific to Parse Platform testing
  testPathIgnorePatterns: [
    ...baseConfig.testPathIgnorePatterns,
    '/tests/parse-platform/helpers/mocks/',
    '/tests/parse-platform/fixtures/',
    '/tests/parse-platform/deprecated/'
  ],

  // Extended timeout for real database operations
  testTimeout: 120000, // 2 minutes for real operations

  // Global setup and teardown for Parse Platform real testing
  globalSetup: '<rootDir>/tests/parse-platform/helpers/parse-global-setup.js',
  globalTeardown: '<rootDir>/tests/parse-platform/helpers/parse-global-teardown.js',

  // Parse Platform-specific setup files (skip jest.env.js to avoid port override)
  setupFilesAfterEnv: [
    '<rootDir>/tests/parse-platform/helpers/parse-test-setup.js'
  ],

  // Environment setup for real testing (uses .env.development)
  setupFiles: [
    '<rootDir>/tests/parse-platform/parse-platform-real.env.js'
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
    '!src/cloud/main.js',
    '!src/**/*.mock.js',
    '!src/**/*.fixture.js'
  ],

  // Coverage thresholds for real environment testing
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },

  // Custom reporters for real environment testing
  reporters: [
    'default'
  ],

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

  // Additional Jest options for real environment testing
  verbose: true,
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,

  // Sequential test execution for real database operations
  maxWorkers: 1, // Real environment tests must run sequentially

  // Detect open handles (important for Parse Server connections)
  detectOpenHandles: true,
  detectLeaks: true,

  // Fail fast on first test failure
  bail: 1, // Stop on first failure for real environment tests

  // Cache directory specific to Parse Platform real tests
  cacheDirectory: '<rootDir>/node_modules/.cache/jest-parse-platform-real',

  // Watch mode configuration
  watchPathIgnorePatterns: [
    '<rootDir>/reports/',
    '<rootDir>/coverage/',
    '<rootDir>/logs/',
    '<rootDir>/node_modules/',
    '<rootDir>/.runtime/'
  ]
};