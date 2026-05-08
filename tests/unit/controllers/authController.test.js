/**
 * Authentication Controller Unit Tests
 */

// Mock Parse and logger BEFORE requiring the controller
jest.mock('parse/node', () => ({
  User: {
    logIn: jest.fn(),
    logOut: jest.fn(),
  },
  Query: jest.fn(),
  Cloud: {
    run: jest.fn(),
  },
  initialize: jest.fn(),
  serverURL: '',
}));

jest.mock('../../../src/infrastructure/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock bcrypt
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));

// Mock securityMiddlewares
jest.mock('../../../src/infrastructure/security/securityMiddleware', () => ({
  csrfProtection: {
    create: jest.fn(() => 'test-csrf-token'),
  },
}));

const Parse = require('parse/node');
const bcrypt = require('bcrypt');
const authController = require('../../../src/application/controllers/authController');
const { createMockRequest, createMockResponse, createMockNext } = require('../../helpers/testUtils');

describe('Authentication Controller', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = createMockRequest();
    mockRes = createMockResponse();
    mockNext = createMockNext();
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('should render login page for GET request', async () => {
      mockReq.method = 'GET';
      mockReq.session = {
        csrfSecret: 'test-csrf-secret',
      };
      mockReq.query = {};

      // Mock Parse.Cloud.run for OAuth providers
      Parse.Cloud.run.mockResolvedValue({ providers: [] });

      await authController.login(mockReq, mockRes);

      expect(mockRes.render).toHaveBeenCalledWith('auth/login', {
        title: 'Login - AmexingWeb',
        error: null,
        message: null,
        info: null,
        csrfToken: expect.any(String),
        parseAppId: expect.any(String),
        oauthProviders: expect.any(Array),
        oauthLinkingData: null,
      });
    });

    it('should authenticate user and redirect on successful login', async () => {
      mockReq.method = 'POST';
      mockReq.body = { username: 'testuser', password: 'testpass' };
      mockReq.session = {};
      mockReq.accepts = jest.fn(() => false); // Return false for 'json' to force HTML response

      const mockUser = {
        id: 'test-user-id',
        get: jest.fn((field) => {
          if (field === 'username') return 'testuser';
          if (field === 'email') return 'testuser@test.com';
          if (field === 'password') return '$2b$10$hashedpassword';
          if (field === 'active') return true;
          if (field === 'exists') return true;
          return null;
        }),
      };

      // Mock authenticateAmexingUser method directly
      authController.authenticateAmexingUser = jest.fn().mockResolvedValue(mockUser);

      // Mock Parse.Cloud.run for session creation
      Parse.Cloud.run.mockResolvedValue('test-session-token');

      await authController.login(mockReq, mockRes);

      expect(authController.authenticateAmexingUser).toHaveBeenCalledWith('testuser', 'testpass');
      expect(mockReq.session.user).toEqual({
        id: 'test-user-id',
        username: 'testuser',
        email: 'testuser@test.com'
      });
      expect(mockReq.session.sessionToken).toBe('test-session-token');
      expect(mockRes.redirect).toHaveBeenCalledWith('/');
    });

    it('should render login page with error on failed login', async () => {
      mockReq.method = 'POST';
      mockReq.body = { username: 'testuser', password: 'wrongpass' };
      mockReq.accepts = jest.fn(() => false); // Return false for 'json' to force HTML response
      mockReq.session = { csrfSecret: 'test-csrf' };

      // Mock authenticateAmexingUser to return null (authentication failed)
      authController.authenticateAmexingUser = jest.fn().mockResolvedValue(null);
      
      // Mock returnWithToken method
      authController.returnWithToken = jest.fn();

      await authController.login(mockReq, mockRes);

      expect(authController.authenticateAmexingUser).toHaveBeenCalledWith('testuser', 'wrongpass');
      expect(authController.returnWithToken).toHaveBeenCalledWith(mockReq, mockRes);
    });

    it('should return JSON response for API requests', async () => {
      mockReq.method = 'POST';
      mockReq.body = { username: 'testuser', password: 'testpass' };
      mockReq.path = '/api/auth/login';
      mockReq.session = {};
      mockReq.accepts = jest.fn(() => 'json'); // Mock JSON accept

      const mockUser = {
        id: 'test-user-id',
        get: jest.fn((field) => {
          if (field === 'username') return 'testuser';
          if (field === 'email') return 'testuser@test.com';
          if (field === 'password') return '$2b$10$hashedpassword';
          if (field === 'active') return true;
          if (field === 'exists') return true;
          return null;
        }),
      };

      // Mock authenticateAmexingUser method directly
      authController.authenticateAmexingUser = jest.fn().mockResolvedValue(mockUser);

      // Mock Parse.Cloud.run for session creation
      Parse.Cloud.run.mockResolvedValue('test-session-token');

      await authController.login(mockReq, mockRes);

      expect(authController.authenticateAmexingUser).toHaveBeenCalledWith('testuser', 'testpass');
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        user: {
          id: 'test-user-id',
          username: 'testuser',
          email: 'testuser@test.com'
        }
      });
    });
  });

  describe('logout', () => {
    it('should logout user and redirect to home', async () => {
      mockReq.user = { id: 'test-user-id' };
      mockReq.session = {
        sessionToken: 'test-session-token',
        regenerate: jest.fn((callback) => callback()),
        save: jest.fn((callback) => callback()),
        destroy: jest.fn((callback) => callback())
      };
      mockReq.accepts = jest.fn(() => false); // Return false for 'json' to force HTML response

      Parse.User.logOut.mockResolvedValue();

      await authController.logout(mockReq, mockRes);

      // Wait for setTimeout(100ms) to complete
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(Parse.User.logOut).toHaveBeenCalledWith({ sessionToken: 'test-session-token' });
      expect(mockReq.session.regenerate).toHaveBeenCalled();
      expect(mockRes.clearCookie).toHaveBeenCalledWith('amexing.sid');
      expect(mockRes.redirect).toHaveBeenCalledWith('/');
    });

    it('should return JSON response for API requests', async () => {
      mockReq.user = { id: 'test-user-id' };
      mockReq.session = {
        regenerate: jest.fn((callback) => callback()),
        save: jest.fn((callback) => callback()),
        destroy: jest.fn((callback) => callback())
      };
      mockReq.path = '/api/auth/logout';
      mockReq.accepts = jest.fn(() => 'json'); // Mock JSON accept

      await authController.logout(mockReq, mockRes);

      // Wait for setTimeout(100ms) to complete
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'Logged out successfully'
      });
    });
  });

  describe('register', () => {
    it('should redirect to request access page for GET request', async () => {
      mockReq.method = 'GET';

      await authController.register(mockReq, mockRes);

      expect(mockRes.redirect).toHaveBeenCalledWith('/auth/request-access');
    });
  });
});