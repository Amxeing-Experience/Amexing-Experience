/**
 * Unit Tests for sessionRecoveryMiddleware
 * Tests conditional logging based on session age (30 second threshold)
 */

const { createMockRequest, createMockResponse, createNewSession, createOldSession, getSessionAge } = require('../../helpers/csrfTestHelper');

// Mock dependencies BEFORE requiring
jest.mock('../../../src/infrastructure/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../../src/infrastructure/monitoring/sessionMetrics', () => ({
  recordSessionRecovered: jest.fn(),
  recordCsrfTokenGenerated: jest.fn(),
}));

// Get references to mocked modules
const logger = require('../../../src/infrastructure/logger');
const sessionMetrics = require('../../../src/infrastructure/monitoring/sessionMetrics');

// Import middleware AFTER mocking (ensures middleware gets mocked dependencies)
const { autoRecoverSession } = require('../../../src/application/middleware/sessionRecoveryMiddleware');

describe('sessionRecoveryMiddleware - Conditional Logging', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    // Clear mock call history before each test
    jest.clearAllMocks();

    res = createMockResponse();
    next = jest.fn();
  });

  // Sanity check: verify mocks are working
  it('should have logger and sessionMetrics mocked', () => {
    expect(logger.debug).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.error).toBeDefined();
    expect(sessionMetrics.recordSessionRecovered).toBeDefined();
    expect(typeof logger.debug).toBe('function');
  });

  describe('Session Age Detection', () => {
    it('should use debug logging for new sessions (< 30 seconds old)', async () => {
      // Create new session (< 30 seconds)
      req = createMockRequest();
      req.session = createNewSession();

      // Remove csrfSecret to trigger recovery
      delete req.session.csrfSecret;

      // Verify csrfSecret is actually undefined before middleware runs
      expect(req.session.csrfSecret).toBeUndefined();

      // Clear any previous mock calls
      jest.clearAllMocks();

      // Get the middleware function
      const middleware = autoRecoverSession();

      await middleware(req, res, next);

      // Verify middleware ran and next was called
      expect(next).toHaveBeenCalled();

      // Verify csrfSecret was set by middleware
      expect(req.session.csrfSecret).toBeDefined();

      // Verify session age is less than 30 seconds
      const sessionAge = getSessionAge(req.session);
      expect(sessionAge).toBeLessThan(30000);

      // Verify debug logging was used (not warn)
      expect(logger.debug).toHaveBeenCalled();

      // Verify warning was NOT used for new sessions
      const warnCalls = logger.warn.mock.calls.filter(call =>
        call[0].includes('CSRF secret auto-recovered')
      );
      expect(warnCalls.length).toBe(0);
    });

    it('should use warn logging for old sessions (>= 30 seconds old)', async () => {
      // Create old session (> 30 seconds)
      req = createMockRequest();
      req.session = createOldSession();

      // Remove csrfSecret to trigger recovery
      delete req.session.csrfSecret;

      // Clear any previous mock calls
      jest.clearAllMocks();

      // Get the middleware function
      const middleware = autoRecoverSession();

      await middleware(req, res, next);

      // Verify session age is >= 30 seconds
      const sessionAge = getSessionAge(req.session);
      expect(sessionAge).toBeGreaterThanOrEqual(30000);

      // Verify warning logging was used for old sessions
      expect(logger.warn).toHaveBeenCalled();
      const warnCalls = logger.warn.mock.calls.filter(call =>
        call[0].includes('CSRF secret auto-recovered')
      );
      expect(warnCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Logging Context Validation', () => {
    it('should include session age in debug log context for new sessions', async () => {
      req = createMockRequest();
      req.session = createNewSession();
      delete req.session.csrfSecret;

      // Clear any previous mock calls
      jest.clearAllMocks();

      // Get the middleware function
      const middleware = autoRecoverSession();

      await middleware(req, res, next);

      // Verify debug was called with session context
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('CSRF secret auto-recovered'),
        expect.objectContaining({
          sessionID: expect.any(String),
          sessionAge: expect.any(Number),
        })
      );

      // Get the session age from the log call
      const debugCalls = logger.debug.mock.calls;
      const recoveryCall = debugCalls.find(call =>
        call[0].includes('CSRF secret auto-recovered')
      );

      if (recoveryCall && recoveryCall[1]) {
        expect(recoveryCall[1].sessionAge).toBeLessThan(30000);
      }
    });

    it('should include session age in warn log context for old sessions', async () => {
      req = createMockRequest();
      req.session = createOldSession();
      delete req.session.csrfSecret;

      // Clear any previous mock calls
      jest.clearAllMocks();

      // Get the middleware function
      const middleware = autoRecoverSession();

      await middleware(req, res, next);

      // Verify warning was called with session context
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('CSRF secret auto-recovered'),
        expect.objectContaining({
          sessionID: expect.any(String),
          sessionAge: expect.any(Number),
        })
      );

      // Get the session age from the log call
      const warnCalls = logger.warn.mock.calls;
      const recoveryCall = warnCalls.find(call =>
        call[0].includes('CSRF secret auto-recovered')
      );

      if (recoveryCall && recoveryCall[1]) {
        expect(recoveryCall[1].sessionAge).toBeGreaterThanOrEqual(30000);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle session exactly at 30 second threshold', async () => {
      req = createMockRequest();
      req.session = {
        id: 'test-session-id',
        createdAt: Date.now() - 30000, // Exactly 30 seconds
        // No csrfSecret - triggers recovery
        save: jest.fn((callback) => {
          if (callback) callback(null);
          return Promise.resolve();
        }),
      };

      // Clear any previous mock calls
      jest.clearAllMocks();

      // Get the middleware function
      const middleware = autoRecoverSession();

      await middleware(req, res, next);

      const sessionAge = getSessionAge(req.session);

      // At exactly 30 seconds, should use warn (>= 30000)
      if (sessionAge >= 30000) {
        expect(logger.warn).toHaveBeenCalled();
      } else {
        expect(logger.debug).toHaveBeenCalled();
      }
    });

    it('should handle missing createdAt timestamp gracefully', async () => {
      req = createMockRequest();
      req.session = {
        id: 'test-session-no-timestamp',
        // No csrfSecret - triggers recovery
        // No createdAt
        save: jest.fn((callback) => {
          if (callback) callback(null);
          return Promise.resolve();
        }),
      };

      // Clear any previous mock calls
      jest.clearAllMocks();

      // Get the middleware function
      const middleware = autoRecoverSession();

      await middleware(req, res, next);

      // Should still work and log appropriately
      expect(logger.debug).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  describe('Recovery Metrics', () => {
    it('should record metrics for new session recovery', async () => {
      req = createMockRequest();
      req.session = createNewSession();
      delete req.session.csrfSecret;

      // Clear any previous mock calls
      jest.clearAllMocks();

      // Get the middleware function
      const middleware = autoRecoverSession();

      await middleware(req, res, next);

      expect(sessionMetrics.recordSessionRecovered).toHaveBeenCalledWith(
        req.session.id,
        'csrf-secret-missing'
      );
    });

    it('should record metrics for old session recovery', async () => {
      req = createMockRequest();
      req.session = createOldSession();
      delete req.session.csrfSecret;

      // Clear any previous mock calls
      jest.clearAllMocks();

      // Get the middleware function
      const middleware = autoRecoverSession();

      await middleware(req, res, next);

      expect(sessionMetrics.recordSessionRecovered).toHaveBeenCalledWith(
        req.session.id,
        'csrf-secret-missing'
      );
    });
  });

  describe('Normal Operation (No Recovery Needed)', () => {
    it('should not log recovery for sessions with valid CSRF secret', async () => {
      req = createMockRequest();
      req.session = createNewSession();
      // Session has valid CSRF secret
      req.session.csrfSecret = 'valid-csrf-secret-123';

      // Get the middleware function
      const middleware = autoRecoverSession();

      await middleware(req, res, next);

      // Should not log recovery
      const recoveryLogs = [
        ...logger.debug.mock.calls,
        ...logger.warn.mock.calls
      ].filter(call => call[0] && call[0].includes('auto-recovered'));

      expect(recoveryLogs.length).toBe(0);

      // Should proceed normally
      expect(next).toHaveBeenCalled();
    });
  });
});
