/**
 * Component Testing Setup
 * Setup file for EJS component testing
 */

const { customMatchers } = require('../helpers/ejsTestUtils');

// Extend Jest with custom matchers for component testing
expect.extend(customMatchers);

// Mock console warnings for cleaner test output
const originalConsoleWarn = console.warn;
console.warn = (message, ...args) => {
  // Suppress specific EJS warnings during testing
  if (typeof message === 'string' && message.includes('ejs')) {
    return;
  }
  originalConsoleWarn(message, ...args);
};

// Global test timeout for component rendering
jest.setTimeout(10000);

// Setup global variables for testing
global.COMPONENT_TEST_MODE = true;