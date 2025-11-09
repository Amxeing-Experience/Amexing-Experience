/**
 * Jest setup file for Parse Cloud Functions testing
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PARSE_PLATFORM_TEST_PREFIX = 'CloudTest_';

// Increase default timeout for cloud function calls
jest.setTimeout(30000);

// Global test configuration
global.CLOUD_FUNCTION_TIMEOUT = 10000; // 10 seconds for individual functions
global.INTEGRATION_TIMEOUT = 30000; // 30 seconds for integration tests
global.JOB_TIMEOUT = 60000; // 60 seconds for job tests

// Custom matchers for cloud function testing
expect.extend({
  toBeCloudFunctionResult(received) {
    const pass = received && typeof received === 'object' && received !== null;

    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid cloud function result`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid cloud function result (object)`,
        pass: false,
      };
    }
  },

  toHaveValidCloudFunctionError(received) {
    const pass = received &&
                 received.code !== undefined &&
                 typeof received.code === 'number' &&
                 received.message !== undefined &&
                 typeof received.message === 'string';

    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid Parse error`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid Parse error with code and message`,
        pass: false,
      };
    }
  },

  toBeWithinPerformanceThreshold(received, threshold) {
    const pass = received &&
                 typeof received === 'object' &&
                 received.averageDuration !== undefined &&
                 received.averageDuration <= threshold;

    if (pass) {
      return {
        message: () => `expected performance ${received.averageDuration}ms to exceed threshold ${threshold}ms`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected performance ${received.averageDuration}ms to be within threshold ${threshold}ms`,
        pass: false,
      };
    }
  },

  toHaveSuccessfulOperations(received, expectedCount) {
    const pass = received &&
                 typeof received === 'object' &&
                 received.successfulOperations !== undefined &&
                 received.successfulOperations === expectedCount;

    if (pass) {
      return {
        message: () => `expected ${received.successfulOperations} successful operations not to equal ${expectedCount}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received.successfulOperations} successful operations to equal ${expectedCount}`,
        pass: false,
      };
    }
  }
});

// Global error handler for unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.warn('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process during tests
});

// Global warning handler
process.on('warning', (warning) => {
  // Suppress Parse SDK deprecation warnings during tests
  if (warning.name === 'DeprecationWarning' && warning.message.includes('Parse')) {
    return;
  }
  console.warn('Warning:', warning.message);
});

// Mock console methods to reduce noise in tests (optional)
if (process.env.JEST_SILENT === 'true') {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: console.error, // Keep errors visible
  };
}

// Helper function to wait for conditions in tests
global.waitForCondition = async (condition, timeout = 10000, interval = 100) => {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const result = await condition();
      if (result) {
        return result;
      }
    } catch (error) {
      if (Date.now() - startTime >= timeout - interval) {
        throw error;
      }
    }

    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`Condition not met within ${timeout}ms`);
};

// Helper function to retry operations
global.retryOperation = async (operation, maxRetries = 3, delay = 1000) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      console.warn(`Operation attempt ${attempt} failed, retrying...`, error.message);
      await new Promise(resolve => setTimeout(resolve, delay * attempt));
    }
  }
};

console.log('Parse Cloud Functions test environment initialized');