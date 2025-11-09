/**
 * CSRF Test Helper
 * Utilities for testing CSRF token functionality
 */

const crypto = require('crypto');

/**
 * Generate a mock CSRF secret
 * @returns {string} - CSRF secret
 */
function generateMockCsrfSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create mock Express request with session
 * @param {object} sessionData - Session data to include
 * @returns {object} - Mock request object
 */
function createMockRequest(sessionData = {}) {
  const defaultSession = {
    id: 'test-session-id',
    cookie: {
      originalMaxAge: 3600000, // 1 hour
      maxAge: 3600000,
    },
    createdAt: Date.now(),
    ...sessionData,
  };

  return {
    session: defaultSession,
    sessionID: defaultSession.id,
    cookies: {},
    headers: {},
    path: '/test-path',
    method: 'GET',
    ip: '127.0.0.1',
    get: jest.fn((header) => {
      if (header === 'User-Agent') {
        return 'test-user-agent';
      }
      return null;
    }),
  };
}

/**
 * Create mock Express response
 * @returns {object} - Mock response object
 */
function createMockResponse() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    locals: {},
  };

  return res;
}

/**
 * Create mock session with CSRF
 * @param {object} options - Session options
 * @returns {object} - Mock session
 */
function createMockSession(options = {}) {
  return {
    id: options.id || 'test-session-id',
    csrfSecret: options.csrfSecret || generateMockCsrfSecret(),
    cookie: {
      originalMaxAge: options.maxAge || 3600000,
      maxAge: options.maxAge || 3600000,
    },
    createdAt: options.createdAt || Date.now(),
    user: options.user || null,
    sessionToken: options.sessionToken || null,
    save: jest.fn((callback) => {
      if (callback) callback(null);
      return Promise.resolve();
    }),
    destroy: jest.fn((callback) => {
      if (callback) callback(null);
      return Promise.resolve();
    }),
    regenerate: jest.fn((callback) => {
      if (callback) callback(null);
      return Promise.resolve();
    }),
    ...options,
  };
}

/**
 * Verify CSRF secret format
 * @param {string} secret - CSRF secret to validate
 * @returns {boolean} - True if valid format
 */
function isValidCsrfSecret(secret) {
  return typeof secret === 'string' && secret.length === 64 && /^[a-f0-9]{64}$/.test(secret);
}

/**
 * Calculate session age in milliseconds
 * @param {object} session - Session object
 * @returns {number} - Age in milliseconds
 */
function getSessionAge(session) {
  if (!session.createdAt) return 0;
  return Date.now() - session.createdAt;
}

/**
 * Create session that appears "new" (< 30 seconds old)
 * @returns {object} - Mock session
 */
function createNewSession() {
  return createMockSession({
    createdAt: Date.now() - 10000, // 10 seconds ago
  });
}

/**
 * Create session that appears "old" (> 30 seconds old)
 * @returns {object} - Mock session
 */
function createOldSession() {
  return createMockSession({
    createdAt: Date.now() - 60000, // 60 seconds ago
  });
}

module.exports = {
  generateMockCsrfSecret,
  createMockRequest,
  createMockResponse,
  createMockSession,
  isValidCsrfSecret,
  getSessionAge,
  createNewSession,
  createOldSession,
};
