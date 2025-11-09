/**
 * Jest Configuration for OAuth Testing
 * Extends base Jest config with OAuth-specific settings and PCI DSS compliance
 */

const baseConfig = require('./jest.config');
const path = require('path');

// Resolve project root directory (two levels up from .config/jest/)
const projectRoot = path.resolve(__dirname, '../../');

module.exports = {
  ...baseConfig,

  // Set correct rootDir
  rootDir: projectRoot,

  // Test environment
  displayName: {
    name: 'OAuth Tests',
    color: 'blue'
  },
  
  // OAuth-specific test patterns
  testMatch: [
    '**/tests/oauth/**/*.test.js',
    '**/tests/oauth/**/*.spec.js'
  ],
  
  // Ignore patterns specific to OAuth testing
  testPathIgnorePatterns: [
    ...baseConfig.testPathIgnorePatterns,
    '/tests/oauth/helpers/mocks/', // Mock implementations
    '/tests/oauth/fixtures/', // Test fixtures
    '/tests/oauth/deprecated/' // Deprecated tests
  ],
  
  // Extended timeout for OAuth flows (can be slow)
  testTimeout: 45000, // 45 seconds
  
  // OAuth-specific setup files
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup.js',
    '<rootDir>/tests/oauth/helpers/oauth-setup.js',
    '<rootDir>/tests/oauth/helpers/pci-compliance-setup.js'
  ],
  
  // Environment setup for OAuth testing
  setupFiles: [
    '<rootDir>/tests/jest.env.js',
    '<rootDir>/tests/oauth/oauth.env.js'
  ],
  
  // Coverage configuration for OAuth modules
  collectCoverageFrom: [
    ...baseConfig.collectCoverageFrom,
    'src/oauth/**/*.js',
    'src/auth/oauth/**/*.js',
    'src/middleware/oauth/**/*.js',
    'src/services/oauth/**/*.js',
    'src/utils/oauth/**/*.js',
    // Exclude OAuth mocks and test utilities
    '!src/oauth/mocks/**',
    '!src/oauth/**/*.mock.js',
    '!src/oauth/**/*.fixture.js'
  ],
  
  // OAuth-specific coverage thresholds
  coverageThreshold: {
    global: {
      branches: 80, // Higher threshold for OAuth code
      functions: 80,
      lines: 80,
      statements: 80
    },
    // Specific thresholds for OAuth modules
    'src/oauth/': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    },
    'src/auth/oauth/': {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85
    }
  },
  
  // Custom reporters for OAuth testing
  reporters: [
    'default'
  ],
  
  // Global setup and teardown for OAuth testing
  globalSetup: path.join(projectRoot, 'tests/oauth/helpers/oauth-global-setup.js'),
  globalTeardown: path.join(projectRoot, 'tests/oauth/helpers/oauth-global-teardown.js'),
  
  // Module name mapping for OAuth dependencies (only custom mappings)
  moduleNameMapper: {
    '^@oauth-tests/(.*)$': '<rootDir>/tests/oauth/$1',
    '^@oauth-mocks/(.*)$': '<rootDir>/tests/oauth/helpers/oauth-mocks/$1',
    '^@synthetic-data/(.*)$': '<rootDir>/tests/oauth/helpers/synthetic-data/$1'
  },
  
  // Transform configuration
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  
  // Test environment variables
  testEnvironment: 'node',
  
  // Additional Jest options for OAuth testing
  verbose: true,
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,
  
  // Force sequential test execution for integration tests
  maxWorkers: process.env.CI ? 1 : '50%',
  
  // Detect open handles (important for OAuth async operations)
  detectOpenHandles: true,
  detectLeaks: true,
  
  // Fail fast on first test failure in CI
  bail: process.env.CI ? 1 : false,
  
  // Cache directory specific to OAuth tests
  cacheDirectory: '<rootDir>/node_modules/.cache/jest-oauth',
  
  // Custom test results processor (disabled for now)
  // testResultsProcessor: '<rootDir>/tests/oauth/helpers/oauth-results-processor.js',
  
  // Watch mode configuration
  watchPathIgnorePatterns: [
    '<rootDir>/reports/',
    '<rootDir>/coverage/',
    '<rootDir>/logs/',
    '<rootDir>/node_modules/'
  ],
  
  // Snapshot configuration (disabled for now)
  // snapshotSerializers: [
  //   '<rootDir>/tests/oauth/helpers/oauth-snapshot-serializer.js'
  // ],
  
  // Custom matchers
  setupFilesAfterEnv: [
    ...baseConfig.setupFilesAfterEnv || [],
    '<rootDir>/tests/oauth/helpers/custom-matchers.js'
  ],
  
};