/**
 * RolesController Unit Tests
 * Tests for role management API controller with focus on updateRole functionality
 */

// Mock Parse and logger BEFORE requiring the controller
jest.mock('parse/node', () => ({
  Query: jest.fn(),
  Object: {
    extend: jest.fn(),
  },
  initialize: jest.fn(),
  serverURL: '',
}));

jest.mock('../../../../src/infrastructure/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const Parse = require('parse/node');
const RolesController = require('../../../../src/application/controllers/api/RolesController');
const logger = require('../../../../src/infrastructure/logger');
const {
  createMockRequest,
  createMockResponse,
  createMockNext,
} = require('../../../helpers/testUtils');

describe('RolesController', () => {
  let rolesController;
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    rolesController = new RolesController();
    mockReq = createMockRequest();
    mockRes = createMockResponse();
    mockNext = createMockNext();
    jest.clearAllMocks();
  });

  describe('updateRole', () => {
    const mockRoleId = 'test-role-id-123';
    const mockUserId = 'test-user-id-456';
    const mockUserEmail = 'superadmin@test.com';
    const currentDisplayName = 'Current Role Name';
    const newDisplayName = 'Updated Role Name';

    /**
     * Helper to create mock user object
     */
    const createMockUser = (role = 'superadmin') => ({
      id: mockUserId,
      get: jest.fn((field) => {
        if (field === 'role') return role;
        if (field === 'email') return mockUserEmail;
        return null;
      }),
    });

    /**
     * Helper to create mock role object
     */
    const createMockRole = (displayName = currentDisplayName, description = 'Test role description') => {
      let currentName = displayName;
      let currentDesc = description;
      return {
        id: mockRoleId,
        get: jest.fn((field) => {
          const roleData = {
            displayName: currentName,
            name: 'testRole',
            description: currentDesc,
            level: 1,
            scope: 'global',
            organization: null,
            active: true,
            updatedAt: new Date(),
          };
          return roleData[field];
        }),
        set: jest.fn((field, value) => {
          if (field === 'displayName') {
            currentName = value;
          }
          if (field === 'description') {
            currentDesc = value;
          }
        }),
        save: jest.fn().mockResolvedValue(true),
      };
    };

    /**
     * Helper to setup Parse Query mock
     */
    const setupQueryMock = (mockRole) => {
      const mockQuery = {
        equalTo: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(mockRole),
      };
      Parse.Query.mockImplementation(() => mockQuery);
      return mockQuery;
    };

    // ========================================================================
    // SUCCESS CASES
    // ========================================================================

    describe('Success Cases', () => {
      it('should successfully update displayName when all validations pass', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        const mockRole = createMockRole(currentDisplayName);
        const mockQuery = setupQueryMock(mockRole);

        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: newDisplayName };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert - Query was called correctly
        expect(Parse.Query).toHaveBeenCalledWith('Role');
        expect(mockQuery.equalTo).toHaveBeenCalledWith('exists', true);
        expect(mockQuery.get).toHaveBeenCalledWith(mockRoleId, {
          useMasterKey: true,
        });

        // Assert - Only displayName was updated
        expect(mockRole.set).toHaveBeenCalledWith('displayName', newDisplayName);

        // Assert - Save was called with useMasterKey
        expect(mockRole.save).toHaveBeenCalledWith(null, { useMasterKey: true });

        // Assert - Audit log was created
        expect(logger.info).toHaveBeenCalledWith(
          'Role updated successfully',
          expect.objectContaining({
            roleId: mockRoleId,
            changes: expect.objectContaining({
              displayName: expect.objectContaining({
                old: currentDisplayName,
                new: newDisplayName,
              }),
            }),
            updatedBy: mockUserId,
            updatedByEmail: mockUserEmail,
          })
        );

        // Assert - Success response with status 200
        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: true,
            message: 'Role updated successfully',
            data: expect.objectContaining({
              role: expect.objectContaining({
                id: mockRoleId,
                displayName: newDisplayName,
              }),
            }),
          })
        );
      });

      it('should trim whitespace from displayName before saving', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        const mockRole = createMockRole(currentDisplayName);
        setupQueryMock(mockRole);

        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: '  Trimmed Name  ' };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockRole.set).toHaveBeenCalledWith('displayName', 'Trimmed Name');
      });

      it('should handle user role from different sources (req.userRole)', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        const mockRole = createMockRole(currentDisplayName);
        setupQueryMock(mockRole);

        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin'; // Set from middleware
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: newDisplayName };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({ success: true })
        );
      });

      it('should handle user role from user.get() method', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        const mockRole = createMockRole(currentDisplayName);
        setupQueryMock(mockRole);

        mockReq.user = mockUser;
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: newDisplayName };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockUser.get).toHaveBeenCalledWith('role');
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({ success: true })
        );
      });

      it('should handle user role from user.role property', async () => {
        // Arrange
        const mockUser = { id: mockUserId, role: 'superadmin' };
        const mockRole = createMockRole(currentDisplayName);
        setupQueryMock(mockRole);

        mockReq.user = mockUser;
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: newDisplayName };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({ success: true })
        );
      });
    });

    // ========================================================================
    // AUTHENTICATION & AUTHORIZATION
    // ========================================================================

    describe('Authentication & Authorization', () => {
      it('should return 401 when user is not authenticated', async () => {
        // Arrange
        mockReq.user = null;
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: newDisplayName };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: 'Authentication required',
          })
        );
        expect(Parse.Query).not.toHaveBeenCalled();
      });

      it('should return 403 when user is not superadmin', async () => {
        // Arrange
        const mockUser = createMockUser('admin');
        mockReq.user = mockUser;
        mockReq.userRole = 'admin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: newDisplayName };
        mockReq.ip = '127.0.0.1';

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: 'Access denied. SuperAdmin role required.',
          })
        );

        // Should log warning
        expect(logger.warn).toHaveBeenCalledWith(
          'Unauthorized role update attempt',
          expect.objectContaining({
            userId: mockUserId,
            userRole: 'admin',
            roleId: mockRoleId,
            ip: '127.0.0.1',
          })
        );

        expect(Parse.Query).not.toHaveBeenCalled();
      });

      it('should return 403 for employee role', async () => {
        // Arrange
        const mockUser = createMockUser('employee');
        mockReq.user = mockUser;
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: newDisplayName };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockRes.status).toHaveBeenCalledWith(403);
      });

      it('should return 403 for departmentmanager role', async () => {
        // Arrange
        const mockUser = createMockUser('departmentmanager');
        mockReq.user = mockUser;
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: newDisplayName };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockRes.status).toHaveBeenCalledWith(403);
      });
    });

    // ========================================================================
    // INPUT VALIDATION
    // ========================================================================

    describe('Input Validation', () => {
      it('should return 400 when roleId is missing', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = {}; // No id
        mockReq.body = { displayName: newDisplayName };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: 'Role ID is required',
          })
        );
      });

      it('should return 400 when neither displayName nor description provided', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = {}; // No displayName or description

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: 'At least one field (displayName or description) must be provided',
          })
        );
      });

      it('should return 400 when only displayName provided but is empty', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: '' }; // Empty string is falsy, triggers "at least one field" error

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert - Empty string is treated as "no field provided"
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: 'At least one field (displayName or description) must be provided',
          })
        );
      });

      it('should return 400 when displayName is only whitespace', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: '   ' };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: 'Display name cannot be empty',
          })
        );
      });

      it('should return 400 when displayName is not a string', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: 12345 }; // Number

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockRes.status).toHaveBeenCalledWith(400);
      });

      it('should return 400 when displayName exceeds 100 characters', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: 'a'.repeat(101) }; // 101 characters

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: 'Display name cannot exceed 100 characters',
          })
        );
      });

      it('should accept displayName with exactly 100 characters', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        const mockRole = createMockRole(currentDisplayName);
        setupQueryMock(mockRole);

        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: 'a'.repeat(100) }; // Exactly 100

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockRole.set).toHaveBeenCalledWith('displayName', 'a'.repeat(100));
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({ success: true })
        );
      });

      it('should return 400 when displayName is same as current', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        const mockRole = createMockRole(currentDisplayName);
        setupQueryMock(mockRole);

        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: currentDisplayName }; // Same as current

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: 'No changes detected. The provided values are the same as current values.',
          })
        );
        expect(mockRole.save).not.toHaveBeenCalled();
      });

      it('should return 400 when displayName with whitespace equals current and no description', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        const mockRole = createMockRole('TestName');
        setupQueryMock(mockRole);

        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: '  TestName  ' }; // Same after trim

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'No changes detected. The provided values are the same as current values.',
          })
        );
      });
    });

    // ========================================================================
    // ERROR HANDLING
    // ========================================================================

    describe('Error Handling', () => {
      it('should return 404 when role does not exist', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        const mockQuery = {
          equalTo: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue(null), // Role not found
        };
        Parse.Query.mockImplementation(() => mockQuery);

        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: newDisplayName };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockRes.status).toHaveBeenCalledWith(404);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: 'Role not found',
          })
        );
      });

      it('should handle Parse query errors gracefully', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        const mockQuery = {
          equalTo: jest.fn().mockReturnThis(),
          get: jest.fn().mockRejectedValue(new Error('Database connection error')),
        };
        Parse.Query.mockImplementation(() => mockQuery);

        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: newDisplayName };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(logger.error).toHaveBeenCalledWith(
          'Error in RolesController.updateRole',
          expect.objectContaining({
            error: 'Database connection error',
            roleId: mockRoleId,
            userId: mockUserId,
          })
        );
        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: expect.stringContaining('Failed to update role'),
          })
        );
      });

      it('should handle role save errors gracefully', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        const mockRole = createMockRole(currentDisplayName);
        mockRole.save.mockRejectedValue(new Error('Save operation failed'));
        setupQueryMock(mockRole);

        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: newDisplayName };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(logger.error).toHaveBeenCalled();
        expect(mockRes.status).toHaveBeenCalledWith(500);
      });

      it('should show detailed error in development environment', async () => {
        // Arrange
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        const mockUser = createMockUser('superadmin');
        const mockQuery = {
          equalTo: jest.fn().mockReturnThis(),
          get: jest.fn().mockRejectedValue(new Error('Specific error message')),
        };
        Parse.Query.mockImplementation(() => mockQuery);

        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: newDisplayName };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Error: Specific error message',
          })
        );

        // Cleanup
        process.env.NODE_ENV = originalEnv;
      });

      it('should hide error details in production environment', async () => {
        // Arrange
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';

        const mockUser = createMockUser('superadmin');
        const mockQuery = {
          equalTo: jest.fn().mockReturnThis(),
          get: jest.fn().mockRejectedValue(new Error('Specific error message')),
        };
        Parse.Query.mockImplementation(() => mockQuery);

        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: newDisplayName };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Failed to update role',
          })
        );

        // Cleanup
        process.env.NODE_ENV = originalEnv;
      });
    });

    // ========================================================================
    // SECURITY
    // ========================================================================

    describe('Security', () => {
      it('should only update displayName field, not other fields', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        const mockRole = createMockRole(currentDisplayName);
        setupQueryMock(mockRole);

        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = {
          displayName: newDisplayName,
          level: 7, // Attempt to escalate privileges
          basePermissions: ['admin.all'], // Attempt to add permissions
          active: false, // Attempt to deactivate
        };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert - Only displayName was set, other fields ignored
        expect(mockRole.set).toHaveBeenCalledTimes(1);
        expect(mockRole.set).toHaveBeenCalledWith('displayName', newDisplayName);
        expect(mockRole.set).not.toHaveBeenCalledWith('level', expect.anything());
        expect(mockRole.set).not.toHaveBeenCalledWith(
          'basePermissions',
          expect.anything()
        );
        expect(mockRole.set).not.toHaveBeenCalledWith('active', expect.anything());
      });

      it('should use useMasterKey for query operations', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        const mockRole = createMockRole(currentDisplayName);
        const mockQuery = setupQueryMock(mockRole);

        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: newDisplayName };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockQuery.get).toHaveBeenCalledWith(mockRoleId, {
          useMasterKey: true,
        });
      });

      it('should use useMasterKey for save operations', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        const mockRole = createMockRole(currentDisplayName);
        setupQueryMock(mockRole);

        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: newDisplayName };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockRole.save).toHaveBeenCalledWith(null, { useMasterKey: true });
      });

      it('should query only roles with exists=true', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        const mockRole = createMockRole(currentDisplayName);
        const mockQuery = setupQueryMock(mockRole);

        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: newDisplayName };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(mockQuery.equalTo).toHaveBeenCalledWith('exists', true);
      });
    });

    // ========================================================================
    // AUDIT LOGGING
    // ========================================================================

    describe('Audit Logging', () => {
      it('should log successful update with complete details', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        const mockRole = createMockRole(currentDisplayName);
        setupQueryMock(mockRole);

        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: newDisplayName };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(logger.info).toHaveBeenCalledWith(
          'Role updated successfully',
          expect.objectContaining({
            roleId: mockRoleId,
            roleName: 'testRole',
            changes: expect.objectContaining({
              displayName: expect.objectContaining({
                old: currentDisplayName,
                new: newDisplayName,
              }),
            }),
            updatedBy: mockUserId,
            updatedByEmail: mockUserEmail,
            timestamp: expect.any(String),
          })
        );
      });

      it('should log unauthorized access attempts', async () => {
        // Arrange
        const mockUser = createMockUser('employee');
        mockReq.user = mockUser;
        mockReq.userRole = 'employee';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: newDisplayName };
        mockReq.ip = '192.168.1.100';

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(logger.warn).toHaveBeenCalledWith(
          'Unauthorized role update attempt',
          expect.objectContaining({
            userId: mockUserId,
            userRole: 'employee',
            roleId: mockRoleId,
            ip: '192.168.1.100',
          })
        );
      });

      it('should log errors with stack trace', async () => {
        // Arrange
        const mockUser = createMockUser('superadmin');
        const testError = new Error('Test error');
        const mockQuery = {
          equalTo: jest.fn().mockReturnThis(),
          get: jest.fn().mockRejectedValue(testError),
        };
        Parse.Query.mockImplementation(() => mockQuery);

        mockReq.user = mockUser;
        mockReq.userRole = 'superadmin';
        mockReq.params = { id: mockRoleId };
        mockReq.body = { displayName: newDisplayName };

        // Act
        await rolesController.updateRole(mockReq, mockRes);

        // Assert
        expect(logger.error).toHaveBeenCalledWith(
          'Error in RolesController.updateRole',
          expect.objectContaining({
            error: 'Test error',
            stack: expect.any(String),
            roleId: mockRoleId,
            userId: mockUserId,
          })
        );
      });
    });
  });
});
