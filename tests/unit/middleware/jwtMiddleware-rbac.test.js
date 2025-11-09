/**
 * JWT Middleware RBAC Unit Tests
 * Tests for new permission-based middleware functions
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @created 2024-09-24
 */

// Mock AuthenticationService and logger
jest.mock('../../../src/application/services/AuthenticationService', () => ({
  validateToken: jest.fn()
}));

jest.mock('../../../src/infrastructure/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const jwtMiddleware = require('../../../src/application/middleware/jwtMiddleware');
const { createMockRequest, createMockResponse, createMockNext } = require('../../helpers/testUtils');

describe('JWT Middleware RBAC Functions', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = createMockRequest();
    mockRes = createMockResponse();
    mockNext = createMockNext();
    jest.clearAllMocks();
  });

  describe('requirePermission', () => {
    const mockUser = {
      id: 'user-123',
      hasPermission: jest.fn()
    };

    beforeEach(() => {
      mockReq.user = mockUser;
      mockUser.hasPermission.mockClear();
    });

    it('should allow access when user has required permission', async () => {
      mockUser.hasPermission.mockResolvedValue(true);
      const middleware = jwtMiddleware.requirePermission('users.read');

      await middleware(mockReq, mockRes, mockNext);

      expect(mockUser.hasPermission).toHaveBeenCalledWith('users.read', {});
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should deny access when user lacks required permission', async () => {
      mockUser.hasPermission.mockResolvedValue(false);
      const middleware = jwtMiddleware.requirePermission('users.delete');

      await middleware(mockReq, mockRes, mockNext);

      expect(mockUser.hasPermission).toHaveBeenCalledWith('users.delete', {});
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Permission denied',
        permission: 'users.delete'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should deny access when user is not authenticated', async () => {
      mockReq.user = null;
      const middleware = jwtMiddleware.requirePermission('users.read');

      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Authentication required'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should pass context to permission check when contextExtractor provided', async () => {
      mockUser.hasPermission.mockResolvedValue(true);
      mockReq.body = { amount: 5000 };
      mockReq.params = { departmentId: 'sales' };

      const contextExtractor = (req) => ({
        amount: req.body.amount,
        departmentId: req.params.departmentId
      });

      const middleware = jwtMiddleware.requirePermission('bookings.approve', contextExtractor);

      await middleware(mockReq, mockRes, mockNext);

      expect(mockUser.hasPermission).toHaveBeenCalledWith('bookings.approve', {
        amount: 5000,
        departmentId: 'sales'
      });
      expect(mockReq.permissionContext).toEqual({
        amount: 5000,
        departmentId: 'sales'
      });
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle permission check errors gracefully', async () => {
      mockUser.hasPermission.mockRejectedValue(new Error('Database error'));
      const middleware = jwtMiddleware.requirePermission('users.read');

      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Permission validation failed'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('requireRoleLevel', () => {
    const mockRoleObject = {
      getLevel: jest.fn()
    };

    beforeEach(() => {
      mockReq.user = { id: 'user-123' };
      mockReq.roleObject = mockRoleObject;
      mockReq.userId = 'user-123';
      mockReq.userRole = 'admin';
      mockRoleObject.getLevel.mockClear();
    });

    it('should allow access when user has sufficient role level', async () => {
      mockRoleObject.getLevel.mockReturnValue(6); // Admin level
      const middleware = jwtMiddleware.requireRoleLevel(5); // Requires level 5

      await middleware(mockReq, mockRes, mockNext);

      expect(mockRoleObject.getLevel).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should deny access when user has insufficient role level', async () => {
      mockRoleObject.getLevel.mockReturnValue(3); // Employee level
      const middleware = jwtMiddleware.requireRoleLevel(6); // Requires admin level

      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Insufficient role level',
        required: 6,
        current: 3
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should deny access when user is not authenticated', async () => {
      mockReq.user = null;
      mockReq.roleObject = null;
      const middleware = jwtMiddleware.requireRoleLevel(5);

      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Authentication required'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle exact role level match correctly', async () => {
      mockRoleObject.getLevel.mockReturnValue(5);
      const middleware = jwtMiddleware.requireRoleLevel(5);

      await middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should handle role level check errors', async () => {
      mockRoleObject.getLevel.mockImplementation(() => {
        throw new Error('Role data corrupted');
      });
      const middleware = jwtMiddleware.requireRoleLevel(5);

      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Role level validation failed'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('requireOrganizationScope', () => {
    beforeEach(() => {
      mockReq.user = {
        id: 'user-123',
        organizationId: 'client-org'
      };
    });

    describe('own scope', () => {
      it('should allow access to own organization data', async () => {
        mockReq.params = { organizationId: 'client-org' };
        const middleware = jwtMiddleware.requireOrganizationScope('own');

        await middleware(mockReq, mockRes, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(mockRes.status).not.toHaveBeenCalled();
      });

      it('should deny access to other organization data', async () => {
        mockReq.params = { organizationId: 'other-org' };
        const middleware = jwtMiddleware.requireOrganizationScope('own');

        await middleware(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith({
          success: false,
          error: 'Access limited to your own organization'
        });
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should allow when no specific organization is targeted', async () => {
        // No organizationId in params or body
        const middleware = jwtMiddleware.requireOrganizationScope('own');

        await middleware(mockReq, mockRes, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });
    });

    describe('client scope', () => {
      it('should allow Amexing users to access any client organization', async () => {
        mockReq.user.organizationId = 'amexing';
        mockReq.params = { organizationId: 'any-client' };
        const middleware = jwtMiddleware.requireOrganizationScope('client');

        await middleware(mockReq, mockRes, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(mockRes.status).not.toHaveBeenCalled();
      });

      it('should limit client users to their own organization', async () => {
        mockReq.user.organizationId = 'client-org';
        mockReq.params = { organizationId: 'other-client' };
        const middleware = jwtMiddleware.requireOrganizationScope('client');

        await middleware(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith({
          success: false,
          error: 'Access limited to your own organization'
        });
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('system scope', () => {
      it('should allow Amexing users system access', async () => {
        mockReq.user.organizationId = 'amexing';
        const middleware = jwtMiddleware.requireOrganizationScope('system');

        await middleware(mockReq, mockRes, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(mockRes.status).not.toHaveBeenCalled();
      });

      it('should deny non-Amexing users system access', async () => {
        mockReq.user.organizationId = 'client-org';
        const middleware = jwtMiddleware.requireOrganizationScope('system');

        await middleware(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith({
          success: false,
          error: 'System access required'
        });
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    it('should handle invalid scope configuration', async () => {
      const middleware = jwtMiddleware.requireOrganizationScope('invalid_scope');

      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid scope configuration'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should deny access when user is not authenticated', async () => {
      mockReq.user = null;
      const middleware = jwtMiddleware.requireOrganizationScope('own');

      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Authentication required'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should check organization ID from request body', async () => {
      mockReq.user.organizationId = 'client-org';
      mockReq.body = { organizationId: 'other-org' };
      const middleware = jwtMiddleware.requireOrganizationScope('own');

      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle organization scope check errors', async () => {
      // Simulate an error by making the organizationId property throw when accessed
      Object.defineProperty(mockReq, 'user', {
        get() {
          throw new Error('Database connection failed');
        }
      });

      const middleware = jwtMiddleware.requireOrganizationScope('own');

      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Organization scope validation failed'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Integration with updated authenticateToken', () => {
    const AuthenticationService = require('../../../src/application/services/AuthenticationService');

    it('should attach roleObject from validation result', async () => {
      const mockRoleObject = { getLevel: () => 6 };
      const validationResult = {
        success: true,
        userId: 'user-123',
        role: 'admin',
        roleObject: mockRoleObject,
        user: {
          id: 'user-123',
          username: 'admin',
          email: 'admin@amexing.com',
          get: jest.fn((field) => {
            const data = {
              active: true,
              exists: true,
              email: 'admin@amexing.com'
            };
            return data[field];
          })
        }
      };

      mockReq.cookies = { accessToken: 'valid.token' };
      AuthenticationService.validateToken.mockResolvedValue(validationResult);

      await jwtMiddleware.authenticateToken(mockReq, mockRes, mockNext);

      expect(mockReq.user).toEqual(validationResult.user);
      expect(mockReq.userId).toBe('user-123');
      expect(mockReq.userRole).toBe('admin');
      expect(mockReq.roleObject).toBe(mockRoleObject);
      expect(mockNext).toHaveBeenCalled();
    });
  });
});