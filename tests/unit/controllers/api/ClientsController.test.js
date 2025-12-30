/**
 * ClientsController Unit Tests
 * Tests for client management API controller with comprehensive CRUD operation coverage
 */

// Mock dependencies BEFORE requiring the controller
jest.mock('../../../../src/application/services/UserManagementService');
jest.mock('../../../../src/infrastructure/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock Parse Query for Role lookups
jest.mock('parse/node', () => {
  const mockQuery = {
    equalTo: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue({ id: 'role-department-manager-id' }),
  };
  return {
    Object: class MockParseObject {
      constructor() {
        this.className = '';
      }

      static extend(className) {
        return class extends MockParseObject {
          constructor() {
            super();
            this.className = className;
          }
        };
      }

      static registerSubclass() {}

      set() {}

      get() {}

      save() {
        return Promise.resolve(this);
      }
    },
    Query: jest.fn(() => mockQuery),
  };
});

const ClientsController = require('../../../../src/application/controllers/api/ClientsController');
const UserManagementService = require('../../../../src/application/services/UserManagementService');
const logger = require('../../../../src/infrastructure/logger');
const {
  createMockRequest,
  createMockResponse,
  createMockNext,
} = require('../../../helpers/testUtils');

describe('ClientsController', () => {
  let clientsController;
  let mockReq;
  let mockRes;
  let mockNext;
  let mockUserService;

  beforeEach(() => {
    clientsController = new ClientsController();
    mockUserService = clientsController.userService;
    mockReq = createMockRequest();
    mockRes = createMockResponse();
    mockNext = createMockNext();
    jest.clearAllMocks();
  });

  describe('getClients', () => {
    const mockUser = {
      id: 'test-user-123',
      get: jest.fn((field) => (field === 'role' ? 'admin' : null)),
    };

    const mockClientsData = {
      users: [
        {
          id: 'client-1',
          username: 'client1@test.com',
          firstName: 'Test',
          lastName: 'Client',
          role: 'department_manager',
          active: true,
          exists: true,
        },
        {
          id: 'client-2',
          username: 'client2@test.com',
          firstName: 'Another',
          lastName: 'Client',
          role: 'department_manager',
          active: true,
          exists: true,
        },
      ],
      pagination: {
        page: 1,
        limit: 25,
        totalCount: 2,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    };

    it('should retrieve clients successfully', async () => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.query = {};

      mockUserService.getUsers = jest.fn().mockResolvedValue(mockClientsData);

      await clientsController.getClients(mockReq, mockRes);

      expect(mockUserService.getUsers).toHaveBeenCalledWith(mockUser, {
        targetRole: 'department_manager',
        page: 1,
        limit: 25,
        filters: {},
        sort: { field: 'lastName', direction: 'asc' },
      });

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            users: mockClientsData.users,
            pagination: mockClientsData.pagination,
          }),
          message: 'Clients retrieved successfully',
        })
      );
    });

    it('should handle pagination parameters', async () => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.query = { page: '2', limit: '10' };

      mockUserService.getUsers = jest.fn().mockResolvedValue({
        ...mockClientsData,
        pagination: { ...mockClientsData.pagination, page: 2, limit: 10 },
      });

      await clientsController.getClients(mockReq, mockRes);

      expect(mockUserService.getUsers).toHaveBeenCalledWith(
        mockUser,
        expect.objectContaining({
          page: 2,
          limit: 10,
        })
      );
    });

    it('should handle filter parameters', async () => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.query = { active: 'true' };

      mockUserService.getUsers = jest.fn().mockResolvedValue(mockClientsData);

      await clientsController.getClients(mockReq, mockRes);

      expect(mockUserService.getUsers).toHaveBeenCalledWith(
        mockUser,
        expect.objectContaining({
          filters: expect.objectContaining({
            active: true,
          }),
        })
      );
    });

    it('should enforce maximum page size limit', async () => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.query = { limit: '500' }; // Exceeds max of 100

      mockUserService.getUsers = jest.fn().mockResolvedValue(mockClientsData);

      await clientsController.getClients(mockReq, mockRes);

      expect(mockUserService.getUsers).toHaveBeenCalledWith(
        mockUser,
        expect.objectContaining({
          limit: 100, // Should be capped at max
        })
      );
    });

    it('should handle service errors', async () => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';

      const error = new Error('Database connection failed');
      mockUserService.getUsers = jest.fn().mockRejectedValue(error);

      await clientsController.getClients(mockReq, mockRes);

      expect(logger.error).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Failed to retrieve clients'),
        })
      );
    });
  });

  describe('createClient', () => {
    const mockUser = {
      id: 'admin-user-123',
      get: jest.fn((field) => (field === 'role' ? 'admin' : null)),
    };

    const validClientData = {
      username: 'newclient@test.com',
      email: 'newclient@test.com',
      password: 'SecurePass123!',
      firstName: 'New',
      lastName: 'Client',
      company: 'Test Company',
      active: true,
      exists: true,
    };

    it('should create client successfully', async () => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.body = {
        ...validClientData,
        companyName: 'Test Company',
      };

      const createdClient = { user: { id: 'new-client-id', ...validClientData, role: 'department_manager' } };
      mockUserService.createUser = jest.fn().mockResolvedValue(createdClient);

      await clientsController.createClient(mockReq, mockRes);

      expect(mockUserService.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: validClientData.email,
          firstName: validClientData.firstName,
          lastName: validClientData.lastName,
          password: validClientData.password,
          role: 'department_manager', // Should force role
          roleId: 'role-department-manager-id', // Pointer ID
          organizationId: 'client',
          username: validClientData.username,
          active: true,
          exists: true,
          company: 'Test Company',
          companyName: 'Test Company',
          mustChangePassword: false,
          contextualData: expect.objectContaining({
            companyName: 'Test Company',
            createdVia: 'admin_panel',
          }),
        }),
        mockUser
      );

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });

    it('should force department_manager role', async () => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.body = {
        ...validClientData,
        companyName: 'Test Company',
        role: 'admin', // Try to set different role
      };

      const createdClient = { user: { id: 'new-client-id', ...validClientData, role: 'department_manager' } };
      mockUserService.createUser = jest.fn().mockResolvedValue(createdClient);

      await clientsController.createClient(mockReq, mockRes);

      expect(mockUserService.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'department_manager', // Should override to department_manager
          roleId: 'role-department-manager-id', // Pointer ID
        }),
        mockUser
      );
    });

    it('should validate required fields', async () => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.body = {
        email: 'incomplete@test.com',
        // Missing required fields (firstName, lastName, companyName)
      };

      await clientsController.createClient(mockReq, mockRes);

      // Should return 400 for missing required fields, not call service
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockUserService.createUser).not.toHaveBeenCalled();
    });

    it('should handle duplicate email error', async () => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.body = {
        ...validClientData,
        companyName: 'Test Company', // Add required field
      };

      const error = new Error('User with this email already exists');
      mockUserService.createUser = jest.fn().mockRejectedValue(error);

      await clientsController.createClient(mockReq, mockRes);

      expect(logger.error).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(409); // Conflict status code
    });
  });

  describe('updateClient', () => {
    const mockUser = {
      id: 'admin-user-123',
      get: jest.fn((field) => (field === 'role' ? 'admin' : null)),
    };

    const mockClientId = 'client-id-123';

    it('should update client successfully', async () => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.params = { id: mockClientId };
      mockReq.body = {
        firstName: 'Updated',
        lastName: 'Name',
        company: 'New Company',
      };

      const updatedClient = {
        user: {
          id: mockClientId,
          ...mockReq.body,
          role: 'department_manager',
        },
      };
      mockUserService.updateUser = jest.fn().mockResolvedValue(updatedClient);

      await clientsController.updateClient(mockReq, mockRes);

      expect(mockUserService.updateUser).toHaveBeenCalledWith(
        mockClientId,
        expect.objectContaining(mockReq.body),
        mockUser
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: updatedClient,
        })
      );
    });

    it('should prevent role changes', async () => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.params = { id: mockClientId };
      mockReq.body = {
        firstName: 'Test',
        role: 'admin', // Try to change role
      };

      await clientsController.updateClient(mockReq, mockRes);

      // Should return error 400 when trying to change role
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Cannot change client role'),
        })
      );
    });

    it('should handle not found error', async () => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.params = { id: 'nonexistent-id' };
      mockReq.body = { firstName: 'Test' };

      const error = new Error('User not found');
      mockUserService.updateUser = jest.fn().mockRejectedValue(error);

      await clientsController.updateClient(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('deactivateClient', () => {
    const mockUser = {
      id: 'admin-user-123',
      get: jest.fn((field) => (field === 'role' ? 'admin' : null)),
    };

    const mockClientId = 'client-id-123';

    it('should deactivate client successfully (set active: false)', async () => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.params = { id: mockClientId };

      const deactivatedClient = { user: { id: mockClientId, active: false } };
      mockUserService.deactivateUser = jest.fn().mockResolvedValue(deactivatedClient);

      await clientsController.deactivateClient(mockReq, mockRes);

      expect(mockUserService.deactivateUser).toHaveBeenCalledWith(
        mockClientId,
        mockUser
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining('deactivated'),
        })
      );
    });

    it('should handle not found error', async () => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.params = { id: 'nonexistent-id' };

      const error = new Error('User not found');
      mockUserService.deactivateUser = jest.fn().mockRejectedValue(error);

      await clientsController.deactivateClient(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('toggleClientStatus', () => {
    const mockUser = {
      id: 'admin-user-123',
      get: jest.fn((field) => (field === 'role' ? 'admin' : null)),
    };

    const mockClientId = 'client-id-123';

    it('should toggle client status to active successfully', async () => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.params = { id: mockClientId };
      mockReq.body = { active: true };

      const toggledClient = { user: { id: mockClientId, active: true } };
      mockUserService.toggleUserStatus = jest.fn().mockResolvedValue(toggledClient);

      await clientsController.toggleClientStatus(mockReq, mockRes);

      expect(mockUserService.toggleUserStatus).toHaveBeenCalledWith(
        mockUser,
        mockClientId,
        true,
        'Status changed via clients dashboard'
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining('activated'),
        })
      );
    });

    it('should toggle client status to inactive successfully', async () => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.params = { id: mockClientId };
      mockReq.body = { active: false };

      const toggledClient = { user: { id: mockClientId, active: false } };
      mockUserService.toggleUserStatus = jest.fn().mockResolvedValue(toggledClient);

      await clientsController.toggleClientStatus(mockReq, mockRes);

      expect(mockUserService.toggleUserStatus).toHaveBeenCalledWith(
        mockUser,
        mockClientId,
        false,
        'Status changed via clients dashboard'
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining('deactivated'),
        })
      );
    });

    it('should require authentication', async () => {
      mockReq.user = null;
      mockReq.params = { id: mockClientId };
      mockReq.body = { active: true };

      await clientsController.toggleClientStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Authentication required',
        })
      );
    });

    it('should validate client ID is provided', async () => {
      mockReq.user = mockUser;
      mockReq.params = {};
      mockReq.body = { active: true };

      await clientsController.toggleClientStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Client ID is required',
        })
      );
    });

    it('should validate active status is boolean', async () => {
      mockReq.user = mockUser;
      mockReq.params = { id: mockClientId };
      mockReq.body = { active: 'true' }; // String instead of boolean

      await clientsController.toggleClientStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Active status must be a boolean',
        })
      );
    });

    it('should handle service errors', async () => {
      mockReq.user = mockUser;
      mockReq.params = { id: mockClientId };
      mockReq.body = { active: true };

      const error = new Error('Permission denied');
      mockUserService.toggleUserStatus = jest.fn().mockRejectedValue(error);

      await clientsController.toggleClientStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Permission denied',
        })
      );
    });

    it('should use correct parameter order for service call', async () => {
      mockReq.user = mockUser;
      mockReq.params = { id: mockClientId };
      mockReq.body = { active: true };

      const toggledClient = { user: { id: mockClientId, active: true } };
      mockUserService.toggleUserStatus = jest.fn().mockResolvedValue(toggledClient);

      await clientsController.toggleClientStatus(mockReq, mockRes);

      // Verify parameter order: currentUser, userId, targetStatus, reason
      const callArgs = mockUserService.toggleUserStatus.mock.calls[0];
      expect(callArgs[0]).toBe(mockUser); // First param: currentUser
      expect(callArgs[1]).toBe(mockClientId); // Second param: userId
      expect(callArgs[2]).toBe(true); // Third param: targetStatus
      expect(callArgs[3]).toBe('Status changed via clients dashboard'); // Fourth param: reason
    });
  });

  describe('parseQueryParams', () => {
    it('should parse pagination parameters correctly', () => {
      const query = { page: '2', limit: '50' };
      const params = clientsController.parseQueryParams(query);

      expect(params.page).toBe(2);
      expect(params.limit).toBe(50);
    });

    it('should use default values for missing parameters', () => {
      const query = {};
      const params = clientsController.parseQueryParams(query);

      expect(params.page).toBe(1);
      expect(params.limit).toBe(25);
    });

    it('should parse filter parameters', () => {
      const query = {
        active: 'true',
        emailVerified: 'false',
        sortField: 'email',
        sortDirection: 'desc',
      };
      const params = clientsController.parseQueryParams(query);

      expect(params.filters.active).toBe(true);
      expect(params.filters.emailVerified).toBe(false);
      expect(params.sort.field).toBe('email');
      expect(params.sort.direction).toBe('desc');
    });

    it('should enforce maximum page size', () => {
      const query = { limit: '500' };
      const params = clientsController.parseQueryParams(query);

      expect(params.limit).toBe(100); // maxPageSize
    });

    it('should handle invalid boolean strings', () => {
      const query = { active: 'invalid' };
      const params = clientsController.parseQueryParams(query);

      expect(params.filters.active).toBe(false);
    });
  });

  describe('Error handling', () => {
    it('should send proper error response format', async () => {
      const errorMessage = 'Test error message';
      const statusCode = 400;

      clientsController.sendError(mockRes, errorMessage, statusCode);

      expect(mockRes.status).toHaveBeenCalledWith(statusCode);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: errorMessage,
          timestamp: expect.any(String),
        })
      );
    });

    it('should send proper success response format', async () => {
      const data = { test: 'data' };
      const message = 'Success message';

      clientsController.sendSuccess(mockRes, data, message);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data,
          message,
          timestamp: expect.any(String),
        })
      );
    });
  });
});
