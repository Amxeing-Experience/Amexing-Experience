/**
 * Authentication Middleware Unit Tests
 */

const authMiddleware = require('../../../src/application/middleware/authMiddleware');
const Parse = require('parse/node');
const { createMockRequest, createMockResponse, createMockNext } = require('../../helpers/testUtils');

// Mock Parse
jest.mock('parse/node');

describe('Authentication Middleware', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = createMockRequest();
    mockRes = createMockResponse();
    mockNext = createMockNext();
    jest.clearAllMocks();
  });

  describe('requireAuth', () => {
    it('should call next() if user is authenticated', async () => {
      const mockUser = { id: 'test-user-id', username: 'testuser' };
      mockReq.headers = { 'x-parse-session-token': 'valid-session-token' };
      Parse.User.become = jest.fn().mockResolvedValue(mockUser);

      await authMiddleware.requireAuth(mockReq, mockRes, mockNext);

      expect(Parse.User.become).toHaveBeenCalledWith('valid-session-token');
      expect(mockReq.user).toBe(mockUser);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 401 if no session token provided', async () => {
      mockReq.headers = {};
      mockReq.session = {};
      mockReq.cookies = {};

      await authMiddleware.requireAuth(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'No session token provided'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 if session token is invalid', async () => {
      mockReq.headers = { 'x-parse-session-token': 'invalid-session-token' };
      Parse.User.become = jest.fn().mockResolvedValue(null);

      await authMiddleware.requireAuth(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid session token'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('requireRole', () => {
    it('should call next() if user has required role', async () => {
      const mockUser = { id: 'test-user-id', username: 'testuser' };
      mockReq.user = mockUser;
      
      const mockQuery = {
        equalTo: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue({ name: 'admin' })
      };
      Parse.Query = jest.fn().mockImplementation(() => mockQuery);

      const middleware = authMiddleware.requireRole('admin');
      await middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 403 if user does not have required role', async () => {
      const mockUser = { id: 'test-user-id', username: 'testuser' };
      mockReq.user = mockUser;
      mockReq.path = '/admin';
      
      const mockQuery = {
        equalTo: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue(null)
      };
      Parse.Query = jest.fn().mockImplementation(() => mockQuery);

      const middleware = authMiddleware.requireRole('admin');
      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Forbidden',
        message: 'Insufficient permissions'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 if user is not authenticated', async () => {
      mockReq.user = null;

      const middleware = authMiddleware.requireRole('admin');
      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});