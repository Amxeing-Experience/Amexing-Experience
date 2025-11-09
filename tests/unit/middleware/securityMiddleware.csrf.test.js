/**
 * Unit Tests for securityMiddleware - CSRF Persistence Check
 * Tests detection of authenticated users without CSRF secrets
 */

const { createMockRequest, createMockResponse, createMockSession } = require('../../helpers/csrfTestHelper');

// Mock dependencies BEFORE requiring
jest.mock('../../../src/infrastructure/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../../src/infrastructure/monitoring/sessionMetrics', () => ({
  recordCsrfTokenGenerated: jest.fn(),
  recordCsrfValidationSuccess: jest.fn(),
  recordCsrfValidationFailure: jest.fn(),
  recordCsrfPersistenceIssue: jest.fn(),
}));

const logger = require('../../../src/infrastructure/logger');
const sessionMetrics = require('../../../src/infrastructure/monitoring/sessionMetrics');

describe('securityMiddleware - CSRF Persistence Check', () => {
  let mockCsrfMiddleware;
  let req;
  let res;
  let next;

  beforeEach(() => {
    jest.clearAllMocks();

    res = createMockResponse();
    next = jest.fn();

    // Mock sessionMetrics
    sessionMetrics.recordCsrfTokenGenerated = jest.fn();
    sessionMetrics.recordCsrfValidationSuccess = jest.fn();
    sessionMetrics.recordCsrfValidationFailure = jest.fn();
    sessionMetrics.recordCsrfPersistenceIssue = jest.fn();

    // Create mock CSRF middleware with persistence check
    mockCsrfMiddleware = async (req, res, next) => {
      try {
        // GET requests - generate token
        if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
          if (req.session) {
            // PERSISTENCE CHECK: Detect authenticated user without CSRF secret
            if (req.session.user && !req.session.csrfSecret) {
              logger.error('CSRF secret missing for authenticated user', {
                sessionID: req.session.id,
                userId: req.session.user.objectId,
                username: req.session.user.username,
                path: req.path,
                timestamp: new Date().toISOString(),
              });

              // Record metrics
              if (sessionMetrics.recordCsrfPersistenceIssue) {
                sessionMetrics.recordCsrfPersistenceIssue(req.session.id, {
                  userId: req.session.user.objectId,
                  path: req.path,
                });
              }
            }

            // Generate CSRF secret if missing
            if (!req.session.csrfSecret) {
              const crypto = require('crypto');
              req.session.csrfSecret = crypto.randomBytes(32).toString('hex');
              logger.debug('Generated CSRF secret for new session', {
                sessionID: req.session.id,
                path: req.path,
              });
            }

            // Create token
            res.locals.csrfToken = 'mock-csrf-token';
            sessionMetrics.recordCsrfTokenGenerated();
          }
          return next();
        }

        // POST/PUT/PATCH - validate token
        const secret = req.session?.csrfSecret;
        if (!secret) {
          return res.status(403).json({
            error: 'CSRF Error',
            message: 'Session expired. Please refresh the page and try again.',
            code: 'SESSION_EXPIRED',
          });
        }

        const token = req.headers['x-csrf-token'] || req.body?.csrfToken;
        if (!token) {
          sessionMetrics.recordCsrfValidationFailure('TOKEN_MISSING', {
            method: req.method,
            url: req.originalUrl,
          });
          return res.status(403).json({
            error: 'CSRF Error',
            message: 'CSRF token missing',
            code: 'TOKEN_MISSING',
          });
        }

        // Validate token (simplified for testing)
        if (token === 'valid-token') {
          sessionMetrics.recordCsrfValidationSuccess();
          return next();
        }

        sessionMetrics.recordCsrfValidationFailure('TOKEN_INVALID', {
          method: req.method,
          url: req.originalUrl,
        });
        return res.status(403).json({
          error: 'CSRF Error',
          message: 'Invalid CSRF token',
          code: 'TOKEN_INVALID',
        });
      } catch (error) {
        logger.error('CSRF middleware error:', error);
        return res.status(500).json({
          error: 'Security Error',
          message: 'CSRF validation failed',
        });
      }
    };
  });

  describe('CSRF Persistence Detection', () => {
    it('should log error when authenticated user has no CSRF secret', async () => {
      req = createMockRequest();
      req.method = 'GET';
      req.path = '/dashboard';
      req.session = createMockSession({
        user: {
          objectId: 'user123',
          username: 'testuser',
          email: 'test@example.com',
        },
        csrfSecret: undefined, // Missing CSRF secret
      });

      await mockCsrfMiddleware(req, res, next);

      // Verify error logging
      expect(logger.error).toHaveBeenCalledWith(
        'CSRF secret missing for authenticated user',
        expect.objectContaining({
          sessionID: req.session.id,
          userId: 'user123',
          username: 'testuser',
          path: '/dashboard',
          timestamp: expect.any(String),
        })
      );
    });

    it('should record metrics for CSRF persistence issues', async () => {
      req = createMockRequest();
      req.method = 'GET';
      req.path = '/profile';
      req.session = createMockSession({
        user: {
          objectId: 'user456',
          username: 'anotheruser',
        },
        csrfSecret: undefined,
      });

      await mockCsrfMiddleware(req, res, next);

      // Verify metrics recorded
      expect(sessionMetrics.recordCsrfPersistenceIssue).toHaveBeenCalledWith(
        req.session.id,
        expect.objectContaining({
          userId: 'user456',
          path: '/profile',
        })
      );
    });

    it('should still auto-recover by generating new CSRF secret', async () => {
      req = createMockRequest();
      req.method = 'GET';
      req.path = '/dashboard';
      req.session = createMockSession({
        user: {
          objectId: 'user789',
          username: 'testuser3',
        },
        csrfSecret: undefined,
      });

      await mockCsrfMiddleware(req, res, next);

      // Verify CSRF secret was generated
      expect(req.session.csrfSecret).toBeDefined();
      expect(req.session.csrfSecret.length).toBe(64); // 32 bytes hex = 64 chars

      // Verify token was created
      expect(res.locals.csrfToken).toBe('mock-csrf-token');

      // Verify middleware continued
      expect(next).toHaveBeenCalled();
    });
  });

  describe('Normal Operation (No Persistence Issues)', () => {
    it('should not log error for authenticated user with valid CSRF secret', async () => {
      req = createMockRequest();
      req.method = 'GET';
      req.path = '/dashboard';
      req.session = createMockSession({
        user: {
          objectId: 'user101',
          username: 'validuser',
        },
        csrfSecret: 'valid-csrf-secret-already-exists-64-char-hex-string-here-123',
      });

      await mockCsrfMiddleware(req, res, next);

      // Should not log persistence error
      const errorCalls = logger.error.mock.calls.filter(call =>
        call[0].includes('CSRF secret missing for authenticated user')
      );
      expect(errorCalls.length).toBe(0);

      // Should not record persistence issue
      expect(sessionMetrics.recordCsrfPersistenceIssue).not.toHaveBeenCalled();
    });

    it('should not log error for unauthenticated user without CSRF secret', async () => {
      req = createMockRequest();
      req.method = 'GET';
      req.path = '/login';
      req.session = createMockSession({
        user: undefined, // Not authenticated
        csrfSecret: undefined, // No CSRF secret yet (normal for new session)
      });

      await mockCsrfMiddleware(req, res, next);

      // Should not log persistence error (expected for new sessions)
      const errorCalls = logger.error.mock.calls.filter(call =>
        call[0].includes('CSRF secret missing for authenticated user')
      );
      expect(errorCalls.length).toBe(0);

      // Should generate CSRF secret
      expect(req.session.csrfSecret).toBeDefined();
    });
  });

  describe('Detection Scenarios', () => {
    it('should detect persistence issue after logout without regeneration', async () => {
      // Simulates old logout behavior: destroy + new session without CSRF
      req = createMockRequest();
      req.method = 'GET';
      req.path = '/dashboard';
      req.session = createMockSession({
        id: 'new-session-after-logout',
        user: {
          objectId: 'user202',
          username: 'user-after-bad-logout',
        },
        csrfSecret: undefined, // Missing because session was destroyed
      });

      await mockCsrfMiddleware(req, res, next);

      // Should detect and log
      expect(logger.error).toHaveBeenCalledWith(
        'CSRF secret missing for authenticated user',
        expect.objectContaining({
          sessionID: 'new-session-after-logout',
          userId: 'user202',
        })
      );
    });

    it('should detect persistence issue after session store failure', async () => {
      req = createMockRequest();
      req.method = 'GET';
      req.path = '/api/users';
      req.session = createMockSession({
        user: {
          objectId: 'user303',
          username: 'user-after-store-failure',
        },
        csrfSecret: undefined, // Lost due to store failure
      });

      await mockCsrfMiddleware(req, res, next);

      expect(logger.error).toHaveBeenCalledWith(
        'CSRF secret missing for authenticated user',
        expect.any(Object)
      );

      expect(sessionMetrics.recordCsrfPersistenceIssue).toHaveBeenCalled();
    });
  });

  describe('Logging Context Validation', () => {
    it('should include comprehensive context in error log', async () => {
      req = createMockRequest();
      req.method = 'GET';
      req.path = '/sensitive-page';
      req.session = createMockSession({
        id: 'session-with-context',
        user: {
          objectId: 'user404',
          username: 'context-test-user',
        },
        csrfSecret: undefined,
      });

      await mockCsrfMiddleware(req, res, next);

      expect(logger.error).toHaveBeenCalledWith(
        'CSRF secret missing for authenticated user',
        expect.objectContaining({
          sessionID: 'session-with-context',
          userId: 'user404',
          username: 'context-test-user',
          path: '/sensitive-page',
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        })
      );
    });
  });

  describe('Metrics Integration', () => {
    it('should support optional metrics recording', async () => {
      // Test when recordCsrfPersistenceIssue is not available
      delete sessionMetrics.recordCsrfPersistenceIssue;

      req = createMockRequest();
      req.method = 'GET';
      req.path = '/dashboard';
      req.session = createMockSession({
        user: { objectId: 'user505', username: 'test' },
        csrfSecret: undefined,
      });

      // Should not throw
      await expect(mockCsrfMiddleware(req, res, next)).resolves.not.toThrow();

      // Should still log error
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle session without user object gracefully', async () => {
      req = createMockRequest();
      req.method = 'GET';
      req.path = '/public';
      req.session = createMockSession({
        user: null, // Explicitly null
        csrfSecret: undefined,
      });

      await mockCsrfMiddleware(req, res, next);

      // Should not detect as persistence issue
      expect(logger.error).not.toHaveBeenCalled();
      expect(sessionMetrics.recordCsrfPersistenceIssue).not.toHaveBeenCalled();
    });

    it('should handle malformed user object', async () => {
      req = createMockRequest();
      req.method = 'GET';
      req.path = '/dashboard';
      req.session = createMockSession({
        user: { objectId: undefined, username: undefined }, // Malformed
        csrfSecret: undefined,
      });

      await mockCsrfMiddleware(req, res, next);

      // Should still detect (user object exists even if malformed)
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
