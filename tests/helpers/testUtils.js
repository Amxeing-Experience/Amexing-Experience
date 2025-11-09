/**
 * Test Utilities
 * Common helper functions for testing
 */

const Parse = require('parse/node');

/**
 * Create a test user
 */
const createTestUser = async (userData = {}) => {
  const defaultData = {
    username: `testuser${Date.now()}`,
    email: `test${Date.now()}@example.com`,
    password: 'TestPass123!',
  };

  const user = new Parse.User();
  user.set({ ...defaultData, ...userData });
  
  try {
    await user.signUp();
    return user;
  } catch (error) {
    console.error('Failed to create test user:', error);
    throw error;
  }
};

/**
 * Login test user and return session token
 */
const loginTestUser = async (username, password) => {
  try {
    const user = await Parse.User.logIn(username, password);
    return user.getSessionToken();
  } catch (error) {
    console.error('Failed to login test user:', error);
    throw error;
  }
};

/**
 * Create test object with specified class and data
 */
const createTestObject = async (className, data = {}) => {
  const TestObject = Parse.Object.extend(className);
  const testObject = new TestObject();
  
  Object.keys(data).forEach(key => {
    testObject.set(key, data[key]);
  });
  
  try {
    await testObject.save();
    return testObject;
  } catch (error) {
    console.error(`Failed to create test ${className}:`, error);
    throw error;
  }
};

/**
 * Generate random string for testing
 */
const generateRandomString = (length = 10) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

/**
 * Wait for specified milliseconds
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Mock request object for middleware testing
 */
const createMockRequest = (data = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  user: null,
  session: {
    csrfSecret: 'test-csrf-secret-12345678901234567890123456789012', // 32 chars for CSRF
  },
  accepts: jest.fn(() => 'html'), // Default to HTML
  method: 'GET',
  path: '/',
  ...data,
});

/**
 * Mock response object for middleware testing
 */
const createMockResponse = () => {
  const res = {
    status: jest.fn(() => res),
    json: jest.fn(() => res),
    send: jest.fn(() => res),
    render: jest.fn(() => res),
    redirect: jest.fn(() => res),
    cookie: jest.fn(() => res),
    clearCookie: jest.fn(() => res),
    locals: {},
  };
  return res;
};

/**
 * Mock next function for middleware testing
 */
const createMockNext = () => jest.fn();

module.exports = {
  createTestUser,
  loginTestUser,
  createTestObject,
  generateRandomString,
  sleep,
  createMockRequest,
  createMockResponse,
  createMockNext,
};