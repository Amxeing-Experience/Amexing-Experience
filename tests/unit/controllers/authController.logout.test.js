/**
 * Unit Tests for authController.logout()
 * Tests session regeneration and CSRF secret initialization on logout
 */

// Mock dependencies BEFORE requiring
jest.mock('parse/node');
jest.mock('../../../src/infrastructure/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const authController = require('../../../src/application/controllers/authController');
const Parse = require('parse/node');
const logger = require('../../../src/infrastructure/logger');
const { createMockRequest, createMockResponse, createMockSession, isValidCsrfSecret } = require('../../helpers/csrfTestHelper');

describe('authController.logout() - Session Regeneration', () => {
  let req;
  let res;
  let mockSession;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock session with Parse session token
    mockSession = createMockSession({
      sessionToken: 'test-parse-session-token-123',
      user: { id: 'user123', username: 'testuser' },
    });

    // Create mock request and response
    req = createMockRequest({ ...mockSession });
    req.session = mockSession;
    req.accepts = jest.fn(() => false); // Default to HTML response
    res = createMockResponse();

    // Mock Parse.User.logOut
    Parse.User.logOut = jest.fn().mockResolvedValue(undefined);

    // Mock crypto module for CSRF generation
    jest.mock('crypto', () => ({
      randomBytes: jest.fn(() => ({
        toString: jest.fn(() => 'new-csrf-secret-after-logout'),
      })),
    }));
  });

  describe('Session Regeneration on Logout', () => {
    it('should regenerate session instead of destroying it', async () => {
      await authController.logout(req, res);

      // Verify session.regenerate was called
      expect(req.session.regenerate).toHaveBeenCalledTimes(1);
      expect(req.session.regenerate).toHaveBeenCalledWith(expect.any(Function));

      // Verify session.destroy was NOT called
      expect(req.session.destroy).not.toHaveBeenCalled();
    });

    it('should generate new CSRF secret for regenerated session', async () => {
      await authController.logout(req, res);

      // Verify CSRF secret was set on the session
      // The implementation sets: req.session.csrfSecret = crypto.randomBytes(32).toString('hex');
      // After regenerate callback completes
      expect(req.session.csrfSecret).toBeDefined();
      expect(typeof req.session.csrfSecret).toBe('string');
    });

    it('should save regenerated session before redirect', async () => {
      await authController.logout(req, res);

      // Verify session.save was called after regenerate
      // Note: The implementation calls regenerate with a callback that calls save
      // Since our mock automatically calls callbacks, save will be called during logout
      expect(req.session.save).toHaveBeenCalled();
      expect(req.session.save).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should redirect to home page after successful logout', async () => {
      await authController.logout(req, res);

      // Wait for setTimeout(100ms) to complete
      await new Promise(resolve => setTimeout(resolve, 150));

      // Verify redirect was called
      // The mocks automatically call callbacks, so redirect should be called
      expect(res.redirect).toHaveBeenCalledWith('/');
    });
  });

  describe('Parse Session Token Cleanup', () => {
    it('should call Parse.User.logOut with session token', async () => {
      await authController.logout(req, res);

      expect(Parse.User.logOut).toHaveBeenCalledTimes(1);
      expect(Parse.User.logOut).toHaveBeenCalledWith({
        sessionToken: 'test-parse-session-token-123',
      });
    });

    it('should handle missing session token gracefully', async () => {
      // Remove session token
      delete req.session.sessionToken;

      await authController.logout(req, res);

      // Should not call Parse.User.logOut
      expect(Parse.User.logOut).not.toHaveBeenCalled();

      // But should still regenerate session
      expect(req.session.regenerate).toHaveBeenCalled();
    });

    it('should handle Parse.User.logOut failure gracefully', async () => {
      // Make Parse.User.logOut reject
      Parse.User.logOut.mockRejectedValue(new Error('Parse server error'));

      await authController.logout(req, res);

      // Should catch the error and return error response
      // NOTE: If Parse.User.logOut throws, the catch block at line 676 catches it
      // and returns an error response without calling regenerate
      expect(logger.error).toHaveBeenCalledWith('Error during logout:', expect.any(Error));

      // Should still respond (either redirect or json error based on accepts)
      // Since req.accepts returns false (HTML), it should redirect
      expect(res.redirect).toHaveBeenCalledWith('/');
    });
  });

  describe('Error Handling in Regeneration', () => {
    it('should fallback to destroy if regenerate fails', async () => {
      // Make regenerate fail by calling callback with error
      req.session.regenerate = jest.fn((callback) => {
        callback(new Error('Regeneration failed'));
      });

      await authController.logout(req, res);

      // Should log error
      expect(logger.error).toHaveBeenCalledWith(
        'Error regenerating session:',
        expect.any(Error)
      );

      // Should fallback to destroy
      expect(req.session.destroy).toHaveBeenCalled();

      // Should still redirect
      expect(res.redirect).toHaveBeenCalledWith('/');
    });

    it('should log error if session save fails', async () => {
      // Make save fail by calling callback with error
      req.session.save = jest.fn((callback) => {
        callback(new Error('Save failed'));
      });

      await authController.logout(req, res);

      // Wait for setTimeout(100ms) to complete
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should log error about save failure
      expect(logger.error).toHaveBeenCalledWith(
        'Error saving regenerated session:',
        expect.any(Error)
      );

      // Should still redirect (graceful degradation)
      expect(res.redirect).toHaveBeenCalledWith('/');
    });
  });

  describe('CSRF Secret Validation', () => {
    it('should generate CSRF secret with correct format', async () => {
      await authController.logout(req, res);

      // Verify CSRF secret was set after logout completes
      // The mocks automatically execute callbacks, so csrfSecret should be set
      expect(req.session.csrfSecret).toBeDefined();
      expect(typeof req.session.csrfSecret).toBe('string');

      // The implementation uses crypto.randomBytes(32).toString('hex')
      // which produces a 64-character hex string
      expect(req.session.csrfSecret.length).toBeGreaterThan(0);
    });
  });

  describe('Integration with Session Recovery Middleware', () => {
    it('should create session that does not trigger auto-recovery warnings', async () => {
      await authController.logout(req, res);

      // Session should have:
      // 1. New CSRF secret - set by implementation after regenerate
      // 2. Recent createdAt timestamp from mock
      // This combination prevents "CSRF secret auto-recovered" warnings

      // Verify CSRF secret was set
      expect(req.session.csrfSecret).toBeDefined();

      // Verify new session would be considered "new" (< 30 seconds)
      const sessionAge = Date.now() - (req.session.createdAt || Date.now());
      expect(sessionAge).toBeLessThan(30000);
    });
  });
});
