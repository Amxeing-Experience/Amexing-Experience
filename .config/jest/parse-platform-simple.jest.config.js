/**
 * Simplified Jest Configuration for Parse Platform Testing
 */

const baseConfig = require('./jest.config');

module.exports = {
  ...baseConfig,

  // Test environment
  displayName: 'Parse Platform Tests',

  // Parse Platform-specific test patterns
  testMatch: [
    '**/tests/parse-platform/**/*.test.js'
  ],

  // Extended timeout for Parse Platform operations
  testTimeout: 60000,

  // Parse Platform-specific setup files
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup.js'
  ],

  // Environment setup for Parse Platform testing
  setupFiles: [
    '<rootDir>/tests/jest.env.js',
    '<rootDir>/tests/parse-platform/parse-platform.env.js'
  ],

  // Global setup and teardown for Parse Platform testing
  globalSetup: '<rootDir>/tests/parse-platform/helpers/parse-global-setup.js',
  globalTeardown: '<rootDir>/tests/parse-platform/helpers/parse-global-teardown.js',

  // Sequential test execution for database operations
  maxWorkers: 1,

  // Detect open handles (important for Parse Server connections)
  detectOpenHandles: true,

  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true
};