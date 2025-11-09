/**
 * AuthenticationService Unit Tests
 * Tests for the enhanced authentication service with JWT and AmexingUser
 * 
 * @author Amexing Development Team  
 * @version 1.0.0
 * @created 2024-09-12
 */

// Mock Parse and dependencies BEFORE requiring the service
jest.mock('parse/node', () => {
  const mockQuery = {
    equalTo: jest.fn().mockReturnThis(),
    greaterThan: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue(null), // Default to no results
    get: jest.fn(),
    count: jest.fn()
  };

  // Mock Parse.Error class
  class ParseError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
      this.name = 'ParseError';
    }
  }

  // Add static properties to ParseError
  ParseError.VALIDATION_ERROR = 142;
  ParseError.USERNAME_TAKEN = 202;
  ParseError.OBJECT_NOT_FOUND = 101;
  ParseError.INVALID_REQUEST = 104;

  // Mock the Parse object
  const Parse = {
    Query: jest.fn(() => mockQuery),
    Error: ParseError,
    Cloud: {
      run: jest.fn()
    },
    Object: {
      extend: jest.fn()
    },
    masterKey: 'test-master-key'
  };

  // Set Parse globally to enable master key
  global.Parse = Parse;

  return Parse;
});

jest.mock('jsonwebtoken', () => {
  class TokenExpiredError extends Error {
    constructor(message) {
      super(message);
      this.name = 'TokenExpiredError';
    }
  }

  class JsonWebTokenError extends Error {
    constructor(message) {
      super(message);
      this.name = 'JsonWebTokenError';
    }
  }

  return {
    sign: jest.fn(() => 'mock.jwt.token'),
    verify: jest.fn(() => ({
      userId: 'test-user-id',
      username: 'testuser',
      role: 'user',
      type: 'access'
    })),
    TokenExpiredError,
    JsonWebTokenError
  };
});

jest.mock('../../../src/infrastructure/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  logSecurityEvent: jest.fn(),
  logAccessAttempt: jest.fn()
}));

// Mock AmexingUser
jest.mock('../../../src/domain/models/AmexingUser', () => {
  return class AmexingUser {
    static create = jest.fn();
  };
});

const AuthenticationService = require('../../../src/application/services/AuthenticationService');
const AmexingUser = require('../../../src/domain/models/AmexingUser');
const logger = require('../../../src/infrastructure/logger');
const jwt = require('jsonwebtoken');

describe('AuthenticationService', () => {
  let mockUser;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock AmexingUser instance
    mockUser = {
      id: 'test-user-id',
      get: jest.fn(),
      set: jest.fn(),
      unset: jest.fn(),
      save: jest.fn(),
      setPassword: jest.fn(),
      validatePassword: jest.fn(),
      isAccountLocked: jest.fn(() => false),
      recordFailedLogin: jest.fn(() => false),
      recordSuccessfulLogin: jest.fn(),
      toSafeJSON: jest.fn(() => ({
        id: 'test-user-id',
        username: 'testuser',
        email: 'test@example.com',
        role: 'user'
      }))
    };

    // Mock AmexingUser.create
    jest.spyOn(AmexingUser, 'create').mockReturnValue(mockUser);
  });

  describe('registerUser', () => {
    const validUserData = {
      username: 'testuser',
      email: 'test@example.com',
      password: 'TestPassword123!',
      firstName: 'Test',
      lastName: 'User',
      role: 'user'
    };

    it('should successfully register a new user', async () => {
      // Mock Parse.Query for checkUserExists - no existing users
      const Parse = require('parse/node');
      Parse.Query.mockImplementation(() => ({
        equalTo: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue(null) // No existing user
      }));

      mockUser.save.mockResolvedValue(mockUser);

      const result = await AuthenticationService.registerUser(validUserData);

      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.tokens).toBeDefined();
      expect(result.message).toBe('User registered successfully');
      expect(logger.logSecurityEvent).toHaveBeenCalledWith('USER_REGISTRATION', expect.any(Object));
    });

    it('should validate required fields', async () => {
      const invalidData = { ...validUserData };
      delete invalidData.email;

      await expect(AuthenticationService.registerUser(invalidData))
        .rejects.toThrow('email is required');
    });

    it('should validate email format', async () => {
      const invalidData = { ...validUserData, email: 'invalid-email' };

      await expect(AuthenticationService.registerUser(invalidData))
        .rejects.toThrow('Invalid email format');
    });

    it('should validate username format', async () => {
      const invalidData = { ...validUserData, username: 'a' }; // Too short

      await expect(AuthenticationService.registerUser(invalidData))
        .rejects.toThrow('Username must be 3-20 characters');
    });
  });

  describe('loginUser', () => {
    beforeEach(() => {
      mockUser.get.mockImplementation((field) => {
        const userData = {
          username: 'testuser',
          email: 'test@example.com',
          active: true
        };
        return userData[field];
      });

      // Mock the findUserByIdentifier method
      jest.spyOn(AuthenticationService, 'findUserByIdentifier').mockResolvedValue(mockUser);
    });

    it('should successfully login with valid credentials', async () => {
      mockUser.validatePassword.mockResolvedValue(true);

      const result = await AuthenticationService.loginUser('testuser', 'TestPassword123!');

      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.tokens).toBeDefined();
      expect(mockUser.recordSuccessfulLogin).toHaveBeenCalledWith('password');
      expect(logger.logAccessAttempt).toHaveBeenCalledWith(true, 'testuser', 'Password login');
    });

    it('should fail with invalid password', async () => {
      mockUser.validatePassword.mockResolvedValue(false);

      await expect(AuthenticationService.loginUser('testuser', 'wrongpassword'))
        .rejects.toThrow('Invalid credentials');
      
      expect(mockUser.recordFailedLogin).toHaveBeenCalled();
      expect(logger.logAccessAttempt).toHaveBeenCalledWith(false, 'testuser', 'Invalid password');
    });

    it('should fail with locked account', async () => {
      mockUser.isAccountLocked.mockReturnValue(true);

      await expect(AuthenticationService.loginUser('testuser', 'TestPassword123!'))
        .rejects.toThrow('Account is temporarily locked');
      
      expect(logger.logSecurityEvent).toHaveBeenCalledWith('LOGIN_ATTEMPT_LOCKED', expect.any(Object));
    });

    it('should fail with inactive account', async () => {
      mockUser.get.mockImplementation((field) => {
        if (field === 'active') return false;
        return field === 'username' ? 'testuser' : undefined;
      });

      await expect(AuthenticationService.loginUser('testuser', 'TestPassword123!'))
        .rejects.toThrow('Account is inactive');
      
      expect(logger.logSecurityEvent).toHaveBeenCalledWith('LOGIN_ATTEMPT_INACTIVE', expect.any(Object));
    });

    it('should fail with non-existent user', async () => {
      jest.spyOn(AuthenticationService, 'findUserByIdentifier').mockResolvedValue(null);

      await expect(AuthenticationService.loginUser('nonexistent', 'password'))
        .rejects.toThrow('Invalid credentials');
      
      expect(logger.logAccessAttempt).toHaveBeenCalledWith(false, 'nonexistent', 'User not found');
    });
  });

  describe('refreshToken', () => {
    const validRefreshToken = 'valid.refresh.token';

    it('should successfully refresh token', async () => {
      jwt.verify.mockReturnValue({
        userId: 'test-user-id',
        type: 'refresh'
      });

      jest.spyOn(AuthenticationService, 'findUserById').mockResolvedValue(mockUser);
      mockUser.get.mockReturnValue(true); // active: true

      const result = await AuthenticationService.refreshToken(validRefreshToken);

      expect(result.success).toBe(true);
      expect(result.tokens).toBeDefined();
      expect(result.user).toBeDefined();
      expect(logger.logSecurityEvent).toHaveBeenCalledWith('TOKEN_REFRESH', expect.any(Object));
    });

    it('should fail with invalid token type', async () => {
      jwt.verify.mockReturnValue({
        userId: 'test-user-id',
        type: 'access' // Wrong type
      });

      await expect(AuthenticationService.refreshToken(validRefreshToken))
        .rejects.toThrow('Invalid or expired refresh token');
    });

    it('should fail with inactive user', async () => {
      jwt.verify.mockReturnValue({
        userId: 'test-user-id',
        type: 'refresh'
      });

      const inactiveUser = { ...mockUser };
      inactiveUser.get.mockReturnValue(false); // active: false
      jest.spyOn(AuthenticationService, 'findUserById').mockResolvedValue(inactiveUser);

      await expect(AuthenticationService.refreshToken(validRefreshToken))
        .rejects.toThrow('Invalid or expired refresh token');
    });
  });

  describe('validateToken', () => {
    const validToken = 'valid.access.token';

    it('should successfully validate access token', async () => {
      jwt.verify.mockReturnValue({
        userId: 'test-user-id',
        username: 'testuser',
        role: 'user',
        type: 'access'
      });

      jest.spyOn(AuthenticationService, 'findUserById').mockResolvedValue(mockUser);
      mockUser.get.mockReturnValue(true); // active: true

      const result = await AuthenticationService.validateToken(validToken);

      expect(result.success).toBe(true);
      expect(result.userId).toBe('test-user-id');
      expect(result.username).toBe('testuser');
      expect(result.role).toBe('user');
    });

    it('should fail with invalid token type', async () => {
      jwt.verify.mockReturnValue({
        userId: 'test-user-id',
        type: 'refresh' // Wrong type
      });

      await expect(AuthenticationService.validateToken(validToken))
        .rejects.toThrow('Invalid token type');
    });

    it('should fail with expired token', async () => {
      const expiredError = new jwt.TokenExpiredError('Token expired');
      jwt.verify.mockImplementation(() => {
        throw expiredError;
      });

      await expect(AuthenticationService.validateToken(validToken))
        .rejects.toThrow('Token expired');
    });
  });

  describe('generateTokens', () => {
    beforeEach(() => {
      mockUser.get.mockImplementation((field) => {
        const userData = {
          username: 'testuser',
          email: 'test@example.com',
          role: 'user'
        };
        return userData[field];
      });
    });

    it('should generate access and refresh tokens', async () => {
      jwt.sign.mockReturnValueOnce('access.token').mockReturnValueOnce('refresh.token');

      const result = await AuthenticationService.generateTokens(mockUser);

      expect(result.accessToken).toBe('access.token');
      expect(result.refreshToken).toBe('refresh.token');
      expect(result.tokenType).toBe('Bearer');
      expect(result.expiresIn).toBeDefined();
      expect(jwt.sign).toHaveBeenCalledTimes(2);
    });
  });

  describe('password reset', () => {
    const resetToken = 'reset-token-123';
    const newPassword = 'NewPassword123!';

    describe('initiatePasswordReset', () => {
      it('should initiate password reset for existing user', async () => {
        jest.spyOn(AuthenticationService, 'findUserByEmail').mockResolvedValue(mockUser);
        mockUser.save.mockResolvedValue(mockUser);

        const result = await AuthenticationService.initiatePasswordReset('test@example.com');

        expect(result.success).toBe(true);
        expect(result.message).toContain('Password reset link has been sent');
        expect(mockUser.set).toHaveBeenCalledWith('passwordResetToken', expect.any(String));
        expect(mockUser.set).toHaveBeenCalledWith('passwordResetExpires', expect.any(Date));
        expect(logger.logSecurityEvent).toHaveBeenCalledWith('PASSWORD_RESET_INITIATED', expect.any(Object));
      });

      it('should return success message even for non-existent user', async () => {
        jest.spyOn(AuthenticationService, 'findUserByEmail').mockResolvedValue(null);

        const result = await AuthenticationService.initiatePasswordReset('nonexistent@example.com');

        expect(result.success).toBe(true);
        expect(result.message).toContain('If the email exists');
      });
    });

    describe('resetPassword', () => {
      it('should successfully reset password with valid token', async () => {
        const Parse = require('parse/node');
        Parse.Query.mockImplementation(() => ({
          equalTo: jest.fn().mockReturnThis(),
          greaterThan: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue(mockUser)
        }));

        mockUser.save.mockResolvedValue(mockUser);

        const result = await AuthenticationService.resetPassword(resetToken, newPassword);

        expect(result.success).toBe(true);
        expect(result.message).toBe('Password has been reset successfully');
        expect(mockUser.setPassword).toHaveBeenCalledWith(newPassword);
        expect(mockUser.unset).toHaveBeenCalledWith('passwordResetToken');
        expect(mockUser.unset).toHaveBeenCalledWith('passwordResetExpires');
        expect(logger.logSecurityEvent).toHaveBeenCalledWith('PASSWORD_RESET_COMPLETED', expect.any(Object));
      });

      it('should fail with invalid or expired token', async () => {
        const Parse = require('parse/node');
        Parse.Query.mockImplementation(() => ({
          equalTo: jest.fn().mockReturnThis(),
          greaterThan: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue(null) // No user found
        }));

        await expect(AuthenticationService.resetPassword(resetToken, newPassword))
          .rejects.toThrow('Invalid or expired reset token');
      });
    });
  });

  describe('utility methods', () => {
    describe('maskEmail', () => {
      it('should mask email addresses correctly', () => {
        const masked = AuthenticationService.maskEmail('test@example.com');
        expect(masked).toBe('tes***@example.com');
      });

      it('should handle empty email', () => {
        const masked = AuthenticationService.maskEmail('');
        expect(masked).toBe('');
      });

      it('should handle null email', () => {
        const masked = AuthenticationService.maskEmail(null);
        expect(masked).toBe('');
      });
    });
  });
});