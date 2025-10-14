/**
 * ClientEmployeesController Unit Tests
 * Tests for client employee management API controller with comprehensive CRUD operation coverage
 * Tests both 'client' (Agent) and 'employee' roles management
 */

// Mock dependencies BEFORE requiring the controller
jest.mock('../../../../src/application/services/UserManagementService');
jest.mock('../../../../src/infrastructure/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock BaseModel for queryExisting
jest.mock('../../../../src/domain/models/BaseModel', () => {
  class MockBaseModel {
    constructor(className) {
      this.className = className;
    }

    static queryExisting() {
      return {
        equalTo: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue({
          id: 'employee-123',
          get: jest.fn((field) => {
            const data = {
              clientId: 'client-abc',
              organizationId: 'client-abc',
              active: true,
              role: 'client',
            };
            return data[field];
          }),
        }),
      };
    }

    static queryActive() {
      return {
        equalTo: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue({
          id: 'client-abc',
          get: jest.fn((field) => {
            const data = {
              roleId: 'role-dept-manager',
              role: 'department_manager',
              active: true,
            };
            return data[field];
          }),
        }),
      };
    }
  }

  return MockBaseModel;
});

// Mock Parse Query for Role lookups
jest.mock('parse/node', () => {
  const mockQuery = {
    equalTo: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue({
      id: 'role-client-id',
      get: jest.fn(() => 'client'),
      name: 'client',
    }),
    get: jest.fn().mockResolvedValue({
      id: 'role-dept-manager',
      get: jest.fn(() => 'department_manager'),
      name: 'department_manager',
    }),
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

const ClientEmployeesController = require('../../../../src/application/controllers/api/ClientEmployeesController');
const UserManagementService = require('../../../../src/application/services/UserManagementService');
const logger = require('../../../../src/infrastructure/logger');
const {
  createMockRequest,
  createMockResponse,
  createMockNext,
} = require('../../../helpers/testUtils');

describe('ClientEmployeesController', () => {
  let clientEmployeesController;
  let mockReq;
  let mockRes;
  let mockNext;
  let mockUserService;

  beforeEach(() => {
    clientEmployeesController = new ClientEmployeesController();
    mockUserService = clientEmployeesController.userService;
    mockReq = createMockRequest();
    mockRes = createMockResponse();
    mockNext = createMockNext();
    jest.clearAllMocks();
  });

  describe('getEmployees', () => {
    const mockUser = {
      id: 'test-admin-123',
      role: 'admin',
    };

    const mockEmployeesData = {
      users: [
        {
          id: 'employee-1',
          username: 'agent@company.com',
          firstName: 'John',
          lastName: 'Agent',
          role: 'client',
          active: true,
          exists: true,
          clientId: 'client-abc',
        },
        {
          id: 'employee-2',
          username: 'employee@company.com',
          firstName: 'Jane',
          lastName: 'Employee',
          role: 'employee',
          active: true,
          exists: true,
          clientId: 'client-abc',
        },
      ],
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalCount: 2,
        limit: 25,
      },
    };

    beforeEach(() => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.params = { clientId: 'client-abc' };
      mockReq.query = {};
      mockUserService.getUsers = jest.fn().mockResolvedValue(mockEmployeesData);
      // Mock validateClientExists to not throw
      jest
        .spyOn(clientEmployeesController, 'validateClientExists')
        .mockResolvedValue(true);
    });

    it('should return employees list successfully', async () => {
      await clientEmployeesController.getEmployees(mockReq, mockRes);

      expect(mockUserService.getUsers).toHaveBeenCalledWith(
        mockUser,
        expect.objectContaining({
          filters: expect.objectContaining({
            clientId: 'client-abc',
            roleFilter: ['client', 'employee'],
          }),
        })
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });

    it('should filter by role when provided', async () => {
      mockReq.query = { role: 'client' };

      await clientEmployeesController.getEmployees(mockReq, mockRes);

      expect(mockUserService.getUsers).toHaveBeenCalledWith(
        mockUser,
        expect.objectContaining({
          filters: expect.objectContaining({
            targetRole: 'client',
          }),
        })
      );
    });

    it('should return 401 if user not authenticated', async () => {
      mockReq.user = null;

      await clientEmployeesController.getEmployees(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Authentication required',
        })
      );
    });

    it('should return 400 if clientId not provided', async () => {
      mockReq.params = {};

      await clientEmployeesController.getEmployees(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Client ID is required',
        })
      );
    });
  });

  describe('createEmployee', () => {
    const mockUser = {
      id: 'test-admin-123',
      role: 'admin',
    };

    const mockEmployeeData = {
      firstName: 'New',
      lastName: 'Agent',
      email: 'newagent@company.com',
      role: 'client',
      phone: '+52 999 123 4567',
      notes: 'Agency representative',
    };

    beforeEach(() => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.params = { clientId: 'client-abc' };
      mockReq.body = mockEmployeeData;
      mockUserService.createUser = jest.fn().mockResolvedValue({
        user: {
          id: 'new-employee-123',
          ...mockEmployeeData,
        },
      });
      // Mock validateClientExists to not throw
      jest
        .spyOn(clientEmployeesController, 'validateClientExists')
        .mockResolvedValue(true);
    });

    it('should create employee with client role successfully', async () => {
      await clientEmployeesController.createEmployee(mockReq, mockRes);

      expect(mockUserService.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: 'New',
          lastName: 'Agent',
          email: 'newagent@company.com',
          role: 'client',
          clientId: 'client-abc',
          organizationId: 'client-abc',
          roleId: expect.any(String),
        }),
        expect.objectContaining({ role: 'admin' })
      );
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Empleado creado exitosamente',
        })
      );
    });

    it('should create employee with employee role successfully', async () => {
      mockReq.body.role = 'employee';

      await clientEmployeesController.createEmployee(mockReq, mockRes);

      expect(mockUserService.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'employee',
        }),
        expect.any(Object)
      );
      expect(mockRes.status).toHaveBeenCalledWith(201);
    });

    it('should return 403 if user is not admin or superadmin', async () => {
      mockReq.userRole = 'department_manager';

      await clientEmployeesController.createEmployee(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Access denied'),
        })
      );
    });

    it('should return 400 if required fields are missing', async () => {
      mockReq.body = { firstName: 'Test' };

      await clientEmployeesController.createEmployee(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Campos requeridos faltantes'),
        })
      );
    });

    it('should return 400 if role is invalid', async () => {
      mockReq.body.role = 'superadmin';

      await clientEmployeesController.createEmployee(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Rol inválido'),
        })
      );
    });

    it('should return 400 if email format is invalid', async () => {
      mockReq.body = {
        firstName: 'New',
        lastName: 'Agent',
        email: 'invalid-email',
        role: 'client',
        phone: '+52 999 123 4567',
        notes: 'Agency representative',
      };

      await clientEmployeesController.createEmployee(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Formato de email inválido',
        })
      );
    });
  });

  describe('toggleEmployeeStatus', () => {
    const mockUser = {
      id: 'test-admin-123',
      role: 'admin',
    };

    beforeEach(() => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.params = { clientId: 'client-abc', id: 'employee-123' };
      mockReq.body = { active: false };
      mockUserService.getUserById = jest.fn().mockResolvedValue({
        id: 'employee-123',
        clientId: 'client-abc',
        role: 'employee',
        roleId: 'employee',
        get: jest.fn((field) => {
          const data = {
            clientId: 'client-abc',
            organizationId: 'client-abc',
            role: 'employee',
          };
          return data[field];
        }),
      });
      mockUserService.toggleUserStatus = jest.fn().mockResolvedValue({
        success: true,
        user: { id: 'employee-123', active: false },
      });
      // Mock validateClientExists
      jest
        .spyOn(clientEmployeesController, 'validateClientExists')
        .mockResolvedValue(true);
    });

    it('should toggle employee status successfully', async () => {
      await clientEmployeesController.toggleEmployeeStatus(mockReq, mockRes);

      expect(mockUserService.toggleUserStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'admin' }),
        'employee-123',
        false,
        'Status changed via client employees dashboard'
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Employee deactivated successfully',
        })
      );
    });

    it('should return 400 if active is not boolean', async () => {
      mockReq.body = { active: 'invalid' };

      await clientEmployeesController.toggleEmployeeStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Active status must be a boolean',
        })
      );
    });

    it('should return 403 if employee does not belong to client', async () => {
      mockUserService.getUserById = jest.fn().mockResolvedValue({
        id: 'employee-123',
        clientId: 'different-client',
        role: 'employee',
        roleId: 'employee',
        get: jest.fn((field) => {
          const data = {
            clientId: 'different-client',
            organizationId: 'different-client',
            role: 'employee',
          };
          return data[field];
        }),
      });

      await clientEmployeesController.toggleEmployeeStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Employee does not belong to specified client',
        })
      );
    });
  });

  describe('deactivateEmployee', () => {
    const mockUser = {
      id: 'test-admin-123',
      role: 'admin',
    };

    beforeEach(() => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.params = { clientId: 'client-abc', id: 'employee-123' };
      mockUserService.deactivateUser = jest.fn().mockResolvedValue(true);
      // Mock validateClientExists
      jest
        .spyOn(clientEmployeesController, 'validateClientExists')
        .mockResolvedValue(true);
    });

    it('should deactivate employee successfully', async () => {
      await clientEmployeesController.deactivateEmployee(mockReq, mockRes);

      expect(mockUserService.deactivateUser).toHaveBeenCalledWith(
        'employee-123',
        expect.objectContaining({ role: 'admin' })
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Employee deactivated successfully',
        })
      );
    });

    it('should return 403 if user is not admin or superadmin', async () => {
      mockReq.userRole = 'employee';

      await clientEmployeesController.deactivateEmployee(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Access denied'),
        })
      );
    });
  });

  describe('updateEmployee', () => {
    const mockUser = {
      id: 'test-admin-123',
      role: 'admin',
    };

    beforeEach(() => {
      mockReq.user = mockUser;
      mockReq.userRole = 'admin';
      mockReq.params = { clientId: 'client-abc', id: 'employee-123' };
      mockReq.body = { firstName: 'Updated', active: true };
      mockUserService.getUserById = jest.fn().mockResolvedValue({
        id: 'employee-123',
        clientId: 'client-abc',
        role: 'employee',
        roleId: 'employee',
        get: jest.fn((field) => {
          const data = {
            clientId: 'client-abc',
            organizationId: 'client-abc',
            role: 'employee',
          };
          return data[field];
        }),
      });
      mockUserService.updateUser = jest.fn().mockResolvedValue({
        user: { id: 'employee-123', firstName: 'Updated' },
      });
      // Mock validateClientExists
      jest
        .spyOn(clientEmployeesController, 'validateClientExists')
        .mockResolvedValue(true);
    });

    it('should update employee successfully', async () => {
      await clientEmployeesController.updateEmployee(mockReq, mockRes);

      expect(mockUserService.updateUser).toHaveBeenCalledWith(
        'employee-123',
        { firstName: 'Updated', active: true },
        expect.objectContaining({ role: 'admin' })
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should return 400 if trying to change to invalid role', async () => {
      mockReq.body = { role: 'superadmin' };

      await clientEmployeesController.updateEmployee(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Cannot change to invalid role'),
        })
      );
    });
  });
});
