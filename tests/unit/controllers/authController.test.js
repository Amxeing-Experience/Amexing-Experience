/**
 * Authentication Controller Unit Tests
 */

// Mock Parse and logger BEFORE requiring the controller
jest.mock('parse/node', () => ({
  User: {
    logIn: jest.fn(),
    logOut: jest.fn(),
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

const Parse = require('parse/node');
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

      await authController.login(mockReq, mockRes);

      expect(mockRes.render).toHaveBeenCalledWith('auth/login', {
        title: 'Login - AmexingWeb',
        error: null,
        csrfToken: expect.any(String),
        parseAppId: expect.any(String),
      });
    });

    it('should authenticate user and redirect on successful login', async () => {
      mockReq.method = 'POST';
      mockReq.body = { username: 'testuser', password: 'testpass' };
      mockReq.session = {};
      mockReq.accepts = jest.fn(() => false); // Return false for 'json' to force HTML response
      
      const mockUser = {
        id: 'test-user-id',
        get: jest.fn((field) => field === 'username' ? 'testuser' : null),
        getSessionToken: jest.fn().mockReturnValue('test-session-token')
      };
      
      Parse.User.logIn.mockResolvedValue(mockUser);

      await authController.login(mockReq, mockRes);

      expect(Parse.User.logIn).toHaveBeenCalledWith('testuser', 'testpass');
      expect(mockReq.session.user).toEqual({ id: 'test-user-id', username: 'testuser' });
      expect(mockReq.session.sessionToken).toBe('test-session-token');
      expect(mockRes.redirect).toHaveBeenCalledWith('/');
    });

    it('should render login page with error on failed login', async () => {
      mockReq.method = 'POST';
      mockReq.body = { username: 'testuser', password: 'wrongpass' };
      mockReq.accepts = jest.fn(() => false); // Return false for 'json' to force HTML response
      
      Parse.User.logIn.mockRejectedValue(new Error('Invalid credentials'));

      await authController.login(mockReq, mockRes);

      expect(Parse.User.logIn).toHaveBeenCalledWith('testuser', 'wrongpass');
      expect(mockRes.render).toHaveBeenCalledWith('auth/login', {
        title: 'Login - AmexingWeb',
        error: 'Invalid username or password',
        csrfToken: expect.any(String),
        parseAppId: expect.any(String),
      });
    });

    it('should return JSON response for API requests', async () => {
      mockReq.method = 'POST';
      mockReq.body = { username: 'testuser', password: 'testpass' };
      mockReq.path = '/api/auth/login';
      mockReq.accepts = jest.fn(() => 'json'); // Mock JSON accept
      
      const mockUser = {
        id: 'test-user-id',
        get: jest.fn((field) => field === 'username' ? 'testuser' : null),
        getSessionToken: jest.fn().mockReturnValue('test-session-token')
      };
      
      Parse.User.logIn.mockResolvedValue(mockUser);

      await authController.login(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        user: {
          id: 'test-user-id',
          username: 'testuser'
        }
      });
    });
  });

  describe('logout', () => {
    it('should logout user and redirect to home', async () => {
      mockReq.user = { id: 'test-user-id' };
      mockReq.session = { 
        sessionToken: 'test-session-token',
        destroy: jest.fn((callback) => callback()) 
      };
      mockReq.accepts = jest.fn(() => false); // Return false for 'json' to force HTML response
      
      Parse.User.logOut.mockResolvedValue();

      await authController.logout(mockReq, mockRes);

      expect(Parse.User.logOut).toHaveBeenCalledWith({ sessionToken: 'test-session-token' });
      expect(mockReq.session.destroy).toHaveBeenCalled();
      expect(mockRes.clearCookie).toHaveBeenCalledWith('amexing.sid');
      expect(mockRes.redirect).toHaveBeenCalledWith('/');
    });

    it('should return JSON response for API requests', async () => {
      mockReq.user = { id: 'test-user-id' };
      mockReq.session = { destroy: jest.fn((callback) => callback()) };
      mockReq.path = '/api/auth/logout';
      mockReq.accepts = jest.fn(() => 'json'); // Mock JSON accept

      await authController.logout(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'Logged out successfully'
      });
    });
  });

  describe('register', () => {
    it('should render register page for GET request', async () => {
      mockReq.method = 'GET';

      await authController.register(mockReq, mockRes);

      expect(mockRes.render).toHaveBeenCalledWith('auth/register', {
        title: 'Register - AmexingWeb',
        error: null,
        csrfToken: expect.any(String),
        parseAppId: expect.any(String),
      });
    });
  });
});