/**
 * JWT Middleware Unit Tests
 * Tests for JWT authentication middleware functionality
 * 
 * @author Amexing Development Team  
 * @version 1.0.0
 * @created 2024-09-12
 */

// Mock AuthenticationService
jest.mock('../../../src/application/services/AuthenticationService', () => ({
  validateToken: jest.fn(),
  refreshToken: jest.fn()
}));

jest.mock('../../../src/infrastructure/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const jwtMiddleware = require('../../../src/application/middleware/jwtMiddleware');
const AuthenticationService = require('../../../src/application/services/AuthenticationService');
const { createMockRequest, createMockResponse, createMockNext } = require('../../helpers/testUtils');

describe('JWT Middleware', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = createMockRequest();
    mockRes = createMockResponse();
    mockNext = createMockNext();
    jest.clearAllMocks();
  });

  describe('authenticateToken', () => {
    const validTokenResult = {
      success: true,
      userId: 'test-user-id',
      username: 'testuser',
      role: 'user',
      user: {
        id: 'test-user-id',
        username: 'testuser',
        email: 'test@example.com',
        role: 'user'
      }
    };

    it('should authenticate with valid token from cookies', async () => {
      mockReq.cookies = { accessToken: 'valid.token' };
      AuthenticationService.validateToken.mockResolvedValue(validTokenResult);

      await jwtMiddleware.authenticateToken(mockReq, mockRes, mockNext);

      expect(AuthenticationService.validateToken).toHaveBeenCalledWith('valid.token');
      expect(mockReq.user).toEqual(validTokenResult.user);
      expect(mockReq.userId).toBe(validTokenResult.userId);
      expect(mockReq.userRole).toBe(validTokenResult.role);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should authenticate with valid token from Authorization header', async () => {
      mockReq.headers = { authorization: 'Bearer valid.token' };
      AuthenticationService.validateToken.mockResolvedValue(validTokenResult);

      await jwtMiddleware.authenticateToken(mockReq, mockRes, mockNext);

      expect(AuthenticationService.validateToken).toHaveBeenCalledWith('valid.token');
      expect(mockReq.user).toEqual(validTokenResult.user);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should return 401 when no token provided', async () => {
      await jwtMiddleware.authenticateToken(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Access token required'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when token is expired', async () => {
      mockReq.cookies = { accessToken: 'expired.token' };
      AuthenticationService.validateToken.mockRejectedValue(new Error('Token expired'));

      await jwtMiddleware.authenticateToken(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when token is invalid', async () => {
      mockReq.cookies = { accessToken: 'invalid.token' };
      AuthenticationService.validateToken.mockRejectedValue(new Error('Invalid token'));

      await jwtMiddleware.authenticateToken(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid or malformed token'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('authenticateOptional', () => {
    const validTokenResult = {
      success: true,
      userId: 'test-user-id',
      username: 'testuser',
      role: 'user',
      user: {
        id: 'test-user-id',
        username: 'testuser'
      }
    };

    it('should authenticate when valid token is provided', async () => {
      mockReq.cookies = { accessToken: 'valid.token' };
      AuthenticationService.validateToken.mockResolvedValue(validTokenResult);

      await jwtMiddleware.authenticateOptional(mockReq, mockRes, mockNext);

      expect(mockReq.user).toEqual(validTokenResult.user);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should continue without authentication when no token provided', async () => {
      await jwtMiddleware.authenticateOptional(mockReq, mockRes, mockNext);

      expect(mockReq.user).toBeFalsy();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should continue without authentication when token is invalid', async () => {
      mockReq.cookies = { accessToken: 'invalid.token' };
      AuthenticationService.validateToken.mockRejectedValue(new Error('Invalid token'));

      await jwtMiddleware.authenticateOptional(mockReq, mockRes, mockNext);

      expect(mockReq.user).toBeFalsy();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('requireRole', () => {
    it('should allow access for user with required role', () => {
      mockReq.user = { id: 'test-user-id' };
      mockReq.userRole = 'admin';

      const middleware = jwtMiddleware.requireRole('admin');
      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow access for user with one of multiple required roles', () => {
      mockReq.user = { id: 'test-user-id' };
      mockReq.userRole = 'employee';

      const middleware = jwtMiddleware.requireRole(['admin', 'employee']);
      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should deny access for user without required role', () => {
      mockReq.user = { id: 'test-user-id' };
      mockReq.userRole = 'user';

      const middleware = jwtMiddleware.requireRole('admin');
      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Insufficient permissions'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should deny access for unauthenticated user', () => {
      const middleware = jwtMiddleware.requireRole('admin');
      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Authentication required'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('autoRefreshToken', () => {
    const refreshTokenResult = {
      success: true,
      tokens: {
        accessToken: 'new.access.token',
        refreshToken: 'new.refresh.token'
      },
      user: {
        id: 'test-user-id',
        username: 'testuser',
        role: 'user'
      }
    };

    it('should refresh token when access token is missing but refresh token exists', async () => {
      mockReq.cookies = { refreshToken: 'valid.refresh.token' };
      AuthenticationService.refreshToken.mockResolvedValue(refreshTokenResult);

      await jwtMiddleware.autoRefreshToken(mockReq, mockRes, mockNext);

      expect(AuthenticationService.refreshToken).toHaveBeenCalledWith('valid.refresh.token');
      expect(mockRes.cookie).toHaveBeenCalledWith('accessToken', 'new.access.token', expect.any(Object));
      expect(mockRes.cookie).toHaveBeenCalledWith('refreshToken', 'new.refresh.token', expect.any(Object));
      expect(mockReq.user).toEqual(refreshTokenResult.user);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should continue normally when both tokens are present', async () => {
      mockReq.cookies = { 
        accessToken: 'valid.access.token',
        refreshToken: 'valid.refresh.token' 
      };

      await jwtMiddleware.autoRefreshToken(mockReq, mockRes, mockNext);

      expect(AuthenticationService.refreshToken).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should continue normally when no tokens are present', async () => {
      await jwtMiddleware.autoRefreshToken(mockReq, mockRes, mockNext);

      expect(AuthenticationService.refreshToken).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should clear invalid refresh token on error', async () => {
      mockReq.cookies = { refreshToken: 'invalid.refresh.token' };
      AuthenticationService.refreshToken.mockRejectedValue(new Error('Invalid refresh token'));

      await jwtMiddleware.autoRefreshToken(mockReq, mockRes, mockNext);

      expect(mockRes.clearCookie).toHaveBeenCalledWith('refreshToken');
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('extractUser', () => {
    it('should skip extraction when user is already authenticated via JWT', () => {
      mockReq.user = { id: 'test-user-id', username: 'testuser' };

      jwtMiddleware.extractUser(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toEqual({ id: 'test-user-id', username: 'testuser' });
    });

    it('should extract user from session when no JWT user exists', () => {
      mockReq.session = {
        user: {
          id: 'session-user-id',
          username: 'sessionuser',
          role: 'user'
        }
      };

      jwtMiddleware.extractUser(mockReq, mockRes, mockNext);

      expect(mockReq.user).toEqual(mockReq.session.user);
      expect(mockReq.userId).toBe('session-user-id');
      expect(mockReq.userRole).toBe('user');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should continue without user when no authentication exists', () => {
      jwtMiddleware.extractUser(mockReq, mockRes, mockNext);

      expect(mockReq.user).toBeFalsy();
      expect(mockNext).toHaveBeenCalled();
    });
  });
});