/**
 * EmployeesController Unit Tests
 * Tests for Amexing employee management API controller (employee_amexing role)
 * Comprehensive coverage for CRUD operations and permission validation
 *
 * @author Amexing Development Team
 * @version 1.0.0
 */

// Mock dependencies BEFORE requiring the controller
jest.mock('../../../../src/application/services/UserManagementService');
jest.mock('../../../../src/infrastructure/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock Parse/node for Role queries in createEmployee
jest.mock('parse/node', () => {
  const mockRoleObject = {
    id: 'mock-role-id-123',
    get: jest.fn((field) => {
      if (field === 'name') return 'employee_amexing';
      if (field === 'active') return true;
      if (field === 'exists') return true;
      return null;
    }),
  };

  // Base Parse.Object class for BaseModel extension
  class ParseObject {
    constructor() {
      this.attributes = {};
    }
  }

  return {
    Object: ParseObject,
    Query: jest.fn().mockImplementation(() => ({
      equalTo: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(mockRoleObject),
    })),
  };
});

const EmployeesController = require('../../../../src/application/controllers/api/EmployeesController');
const UserManagementService = require('../../../../src/application/services/UserManagementService');

describe('EmployeesController', () => {
  let employeesController;
  let mockUserService;
  let mockReq;
  let mockRes;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create controller instance
    employeesController = new EmployeesController();

    // Mock UserManagementService
    mockUserService = {
      getUsers: jest.fn(),
      createUser: jest.fn(),
      updateUser: jest.fn(),
      getUserById: jest.fn(),
      toggleUserStatus: jest.fn(),
      deactivateUser: jest.fn(),
    };
    employeesController.userService = mockUserService;

    // Mock request and response objects
    mockReq = {
      user: null,
      userRole: null,
      params: {},
      query: {},
      body: {},
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  describe('getEmployees', () => {
    const mockAdminUser = {
      id: 'admin-123',
      role: 'admin',
    };

    beforeEach(() => {
      mockReq.user = mockAdminUser;
      mockReq.userRole = 'admin';
      mockReq.query = {
        page: 1,
        limit: 25,
      };
    });

    it('should return employees list successfully', async () => {
      const mockUsersResponse = {
        users: [
          { id: 'emp1', email: 'emp1@amexing.com', role: 'employee_amexing' },
          { id: 'emp2', email: 'emp2@amexing.com', role: 'employee_amexing' },
        ],
        pagination: {
          totalCount: 2,
          page: 1,
          limit: 25,
        },
      };

      mockUserService.getUsers.mockResolvedValue(mockUsersResponse);

      await employeesController.getEmployees(mockReq, mockRes);

      expect(mockUserService.getUsers).toHaveBeenCalledWith(
        mockAdminUser,
        expect.objectContaining({
          filters: expect.objectContaining({
            roleNames: expect.arrayContaining(['employee_amexing', 'driver']),
          }),
          page: 1,
          limit: 25,
          sort: expect.any(Object),
        })
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Employees retrieved successfully',
          data: expect.objectContaining({
            users: mockUsersResponse.users,
            pagination: mockUsersResponse.pagination,
            requestMetadata: expect.any(Object),
          }),
        })
      );
    });

    it('should return 401 if user not authenticated', async () => {
      mockReq.user = null;

      await employeesController.getEmployees(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Authentication required',
        })
      );
    });

    it('should call service even with employee role (permission check in middleware)', async () => {
      // Note: Permission validation is done in middleware (requireRoleLevel(6))
      // Controller just executes the logic assuming user has already been authorized
      mockReq.user = { id: 'emp-123', role: 'employee' };
      mockReq.userRole = 'employee';

      const mockUsersResponse = {
        users: [],
        pagination: { totalCount: 0, page: 1, limit: 25 },
      };

      mockUserService.getUsers.mockResolvedValue(mockUsersResponse);

      await employeesController.getEmployees(mockReq, mockRes);

      // Should call service (middleware would have blocked non-admin users)
      expect(mockUserService.getUsers).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });
  });

  describe('toggleEmployeeStatus', () => {
    const mockAdminUser = {
      id: 'admin-123',
    };

    beforeEach(() => {
      mockReq.user = mockAdminUser;
      mockReq.userRole = 'admin';
      mockReq.params = { id: 'employee-123' };
      mockReq.body = { active: false };
    });

    it('should toggle employee status successfully', async () => {
      mockUserService.toggleUserStatus.mockResolvedValue({
        success: true,
        user: { id: 'employee-123', active: false },
      });

      await employeesController.toggleEmployeeStatus(mockReq, mockRes);

      // Verify that currentUser.role was enriched
      expect(mockUserService.toggleUserStatus).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'admin-123', role: 'admin' }),
        'employee-123',
        false,
        'Status changed via employees dashboard'
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Employee deactivated successfully',
        })
      );
    });

    it('should handle permission denied from service', async () => {
      mockUserService.toggleUserStatus.mockResolvedValue({
        success: false,
        message: 'Insufficient permissions to change user status',
      });

      await employeesController.toggleEmployeeStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Insufficient permissions to change user status',
        })
      );
    });

    it('should enrich currentUser with role when missing', async () => {
      // Simulate middleware behavior - user object without role property
      mockReq.user = { id: 'admin-123' }; // No role property
      mockReq.userRole = 'admin'; // Role is in separate property

      mockUserService.toggleUserStatus.mockResolvedValue({
        success: true,
        user: { id: 'employee-123', active: false },
      });

      await employeesController.toggleEmployeeStatus(mockReq, mockRes);

      // Verify role was added to user object
      expect(mockUserService.toggleUserStatus).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'admin-123', role: 'admin' }),
        'employee-123',
        false,
        expect.any(String)
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should return 401 if user not authenticated', async () => {
      mockReq.user = null;

      await employeesController.toggleEmployeeStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Authentication required',
        })
      );
    });

    it('should return 400 if active is not boolean', async () => {
      mockReq.body = { active: 'invalid' };

      await employeesController.toggleEmployeeStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Active status must be a boolean',
        })
      );
    });

    it('should return 400 if employee ID is missing', async () => {
      mockReq.params = {};

      await employeesController.toggleEmployeeStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Employee ID is required',
        })
      );
    });

    it('should return 403 if user is not admin or superadmin', async () => {
      // Permission check IS in controller (line 520-522)
      mockReq.userRole = 'employee';
      mockReq.user = { id: 'employee-123' };
      mockReq.params = { id: 'another-employee-123' };
      mockReq.body = { active: false };

      await employeesController.toggleEmployeeStatus(mockReq, mockRes);

      // Should be rejected by controller permission check
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringMatching(/access denied/i),
        })
      );
    });
  });

  describe('deactivateEmployee', () => {
    const mockAdminUser = {
      id: 'admin-123',
    };

    beforeEach(() => {
      mockReq.user = mockAdminUser;
      mockReq.userRole = 'admin';
      mockReq.params = { id: 'employee-123' };
    });

    it('should deactivate employee successfully', async () => {
      mockUserService.deactivateUser.mockResolvedValue(true);

      await employeesController.deactivateEmployee(mockReq, mockRes);

      // Verify currentUser was enriched with role
      expect(mockUserService.deactivateUser).toHaveBeenCalledWith(
        'employee-123',
        expect.objectContaining({ id: 'admin-123', role: 'admin' })
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Employee deactivated successfully',
        })
      );
    });

    it('should return 401 if user not authenticated', async () => {
      mockReq.user = null;

      await employeesController.deactivateEmployee(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should return 403 if user is not admin or superadmin', async () => {
      // Permission check IS in controller
      mockReq.userRole = 'employee';
      mockReq.user = { id: 'employee-123' };
      mockReq.params = { id: 'another-employee-123' };

      await employeesController.deactivateEmployee(mockReq, mockRes);

      // Should be rejected by controller permission check
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringMatching(/access denied/i),
        })
      );
    });

    it('should return 400 if employee ID is missing', async () => {
      mockReq.params = {};

      await employeesController.deactivateEmployee(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should handle service errors gracefully', async () => {
      mockUserService.deactivateUser.mockRejectedValue(
        new Error('Cannot deactivate your own account')
      );

      await employeesController.deactivateEmployee(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Cannot deactivate your own account',
        })
      );
    });
  });

  describe('updateEmployee', () => {
    const mockAdminUser = {
      id: 'admin-123',
    };

    beforeEach(() => {
      mockReq.user = mockAdminUser;
      mockReq.userRole = 'admin';
      mockReq.params = { id: 'employee-123' };
      mockReq.body = {
        firstName: 'John',
        lastName: 'Doe',
        active: true,
      };
    });

    it('should update employee successfully', async () => {
      const mockUpdatedUser = {
        id: 'employee-123',
        firstName: 'John',
        lastName: 'Doe',
        active: true,
      };

      mockUserService.updateUser.mockResolvedValue({
        success: true,
        user: mockUpdatedUser,
      });

      await employeesController.updateEmployee(mockReq, mockRes);

      // Verify currentUser was enriched with role
      expect(mockUserService.updateUser).toHaveBeenCalledWith(
        'employee-123',
        expect.objectContaining({
          firstName: 'John',
          lastName: 'Doe',
          active: true,
        }),
        expect.objectContaining({ id: 'admin-123', role: 'admin' })
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Employee updated successfully',
        })
      );
    });

    it('should prevent role change from employee_amexing', async () => {
      mockReq.body.role = 'admin';

      await employeesController.updateEmployee(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Cannot change employee role'),
        })
      );
    });

    it('should return 401 if user not authenticated', async () => {
      mockReq.user = null;

      await employeesController.updateEmployee(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should return 403 if user is not admin or superadmin', async () => {
      // Permission check IS in controller
      mockReq.userRole = 'employee';
      mockReq.user = { id: 'employee-123' };
      mockReq.params = { id: 'another-employee-123' };
      mockReq.body = {
        firstName: 'John',
        lastName: 'Doe',
        active: true,
      };

      await employeesController.updateEmployee(mockReq, mockRes);

      // Should be rejected by controller permission check
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringMatching(/access denied/i),
        })
      );
    });
  });

  describe('createEmployee', () => {
    const mockSuperadminUser = {
      id: 'superadmin-123',
    };

    beforeEach(() => {
      mockReq.user = mockSuperadminUser;
      mockReq.userRole = 'superadmin';
      mockReq.body = {
        email: 'newemployee@amexing.com',
        password: 'SecurePass123!',
        firstName: 'New',
        lastName: 'Employee',
        role: 'employee_amexing',
      };
    });

    it('should create employee successfully', async () => {
      const mockCreatedUser = {
        id: 'new-employee-123',
        email: 'newemployee@amexing.com',
        role: 'employee_amexing',
      };

      mockUserService.createUser.mockResolvedValue({
        success: true,
        user: mockCreatedUser,
      });

      await employeesController.createEmployee(mockReq, mockRes);

      expect(mockUserService.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'newemployee@amexing.com',
          username: 'newemployee@amexing.com',
          role: 'employee_amexing',
          roleId: expect.any(String),
          organizationId: 'amexing',
          password: expect.any(String),
          mustChangePassword: true,
          contextualData: expect.any(Object),
        }),
        expect.objectContaining({ id: 'superadmin-123', role: 'superadmin' })
      );

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringMatching(/empleado creado|employee created/i),
        })
      );
    });

    it('should return 400 if required fields are missing', async () => {
      mockReq.body = { email: 'test@amexing.com' }; // Missing password, names

      await employeesController.createEmployee(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringMatching(/requeridos|required/i),
        })
      );
    });

    it('should return 403 if user is not admin or superadmin', async () => {
      // Permission check IS in controller
      mockReq.userRole = 'employee';
      mockReq.user = { id: 'employee-123' };
      mockReq.body = {
        email: 'newemployee@amexing.com',
        password: 'SecurePass123!',
        firstName: 'New',
        lastName: 'Employee',
        role: 'employee_amexing',
      };

      await employeesController.createEmployee(mockReq, mockRes);

      // Should be rejected by controller permission check
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringMatching(/access denied/i),
        })
      );
    });
  });

  // Tests for Multiple Roles Functionality
  describe('Multiple Roles Functionality', () => {
    const mockAdminUser = {
      id: 'admin-123',
    };

    beforeEach(() => {
      mockReq.user = mockAdminUser;
      mockReq.userRole = 'admin';
    });

    describe('createEmployee with roles array', () => {
      it('should create employee with multiple roles successfully', async () => {
        mockReq.body = {
          email: 'multiemployee@amexing.test',
          firstName: 'Multi',
          lastName: 'Role Employee',
          roles: ['driver', 'guia', 'greeter'], // Multiple roles
        };

        const mockCreatedUser = {
          id: 'multi-employee-123',
          email: 'multiemployee@amexing.test',
          role: 'driver', // RBAC role
          futureRoles: ['driver', 'guia', 'greeter'], // Display roles
          displayRole: 'driver',
        };

        mockUserService.createUser.mockResolvedValue({
          success: true,
          user: mockCreatedUser,
        });

        await employeesController.createEmployee(mockReq, mockRes);

        expect(mockUserService.createUser).toHaveBeenCalledWith(
          expect.objectContaining({
            email: 'multiemployee@amexing.test',
            role: 'driver', // Actual RBAC role
            futureRoles: ['driver', 'guia', 'greeter'], // All selected roles
            displayRole: 'driver', // First role for backward compatibility
            organizationId: 'amexing',
          }),
          mockAdminUser
        );

        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: true,
            data: expect.objectContaining({
              employee: expect.objectContaining({
                user: expect.objectContaining({
                  id: mockCreatedUser.id,
                  role: mockCreatedUser.role,
                }),
                success: true,
              }),
            }),
            message: expect.stringContaining('Empleado creado exitosamente'),
          })
        );
      });

      it('should handle Administrator role as exclusive', async () => {
        mockReq.body = {
          email: 'adminemployee@amexing.test',
          firstName: 'Admin',
          lastName: 'Employee',
          roles: ['employee_amexing'], // Administrator role
        };

        const mockCreatedUser = {
          id: 'admin-employee-123',
          email: 'adminemployee@amexing.test',
          role: 'employee_amexing', // RBAC role stays as admin
          futureRoles: ['employee_amexing'],
          displayRole: 'employee_amexing',
        };

        mockUserService.createUser.mockResolvedValue({
          success: true,
          user: mockCreatedUser,
        });

        await employeesController.createEmployee(mockReq, mockRes);

        expect(mockUserService.createUser).toHaveBeenCalledWith(
          expect.objectContaining({
            role: 'employee_amexing', // Admin role preserved
            futureRoles: ['employee_amexing'],
            displayRole: 'employee_amexing',
          }),
          mockAdminUser
        );
      });

      it('should validate roles array against allowed roles', async () => {
        mockReq.body = {
          email: 'invalidemployee@amexing.test',
          firstName: 'Invalid',
          lastName: 'Employee',
          roles: ['driver', 'invalid_role', 'guia'], // Contains invalid role
        };

        await employeesController.createEmployee(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith({
          success: false,
          error: expect.stringContaining('Roles inválidos: invalid_role'),
          timestamp: expect.any(String),
        });
      });

      it('should require at least one role', async () => {
        mockReq.body = {
          email: 'noroleemployee@amexing.test',
          firstName: 'No Role',
          lastName: 'Employee',
          roles: [], // Empty roles array
        };

        await employeesController.createEmployee(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith({
          success: false,
          error: expect.stringContaining('Campos requeridos faltantes: roles'),
          timestamp: expect.any(String),
        });
      });

      it('should maintain backward compatibility with single role field', async () => {
        mockReq.body = {
          email: 'backwardemployee@amexing.test',
          firstName: 'Backward',
          lastName: 'Compatible Employee',
          role: 'guia', // Single role field for backward compatibility
        };

        const mockCreatedUser = {
          id: 'backward-employee-123',
          email: 'backwardemployee@amexing.test',
          role: 'driver', // Maps to driver for RBAC
          futureRoles: ['guia'], // Single role in array
          displayRole: 'guia',
        };

        mockUserService.createUser.mockResolvedValue({
          success: true,
          user: mockCreatedUser,
        });

        await employeesController.createEmployee(mockReq, mockRes);

        expect(mockUserService.createUser).toHaveBeenCalledWith(
          expect.objectContaining({
            role: 'driver', // Maps to driver for permissions
            futureRoles: ['guia'], // Original role stored for display
            displayRole: 'guia',
          }),
          mockAdminUser
        );
      });
    });

    describe('updateEmployee with roles array', () => {
      beforeEach(() => {
        mockReq.params = { id: 'employee-123' };
      });

      it('should update employee roles successfully', async () => {
        mockReq.body = {
          roles: ['driver', 'limpieza'], // Updated roles
        };

        const mockUpdatedUser = {
          id: 'employee-123',
          role: 'driver',
          futureRoles: ['driver', 'limpieza'],
          displayRole: 'driver',
        };

        mockUserService.updateUser.mockResolvedValue({
          success: true,
          user: mockUpdatedUser,
          futureRoles: ['driver', 'limpieza'],
          displayRole: 'driver',
        });

        await employeesController.updateEmployee(mockReq, mockRes);

        expect(mockUserService.updateUser).toHaveBeenCalledWith(
          'employee-123',
          expect.objectContaining({
            role: 'driver', // RBAC role
            futureRoles: ['driver', 'limpieza'], // Display roles
            displayRole: 'driver', // First role
          }),
          mockAdminUser
        );

        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: true,
            data: expect.objectContaining({
              futureRoles: ['driver', 'limpieza'],
              displayRole: 'driver',
              user: expect.objectContaining({
                role: 'driver',
              }),
            }),
          })
        );
      });

      it('should validate updated roles array', async () => {
        mockReq.body = {
          roles: ['driver', 'invalid_role'], // Invalid role in update
        };

        await employeesController.updateEmployee(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith({
          success: false,
          error: expect.stringContaining('Roles inválidos: invalid_role'),
          timestamp: expect.any(String),
        });
      });

      it('should handle Administrator role updates', async () => {
        mockReq.body = {
          roles: ['employee_amexing'], // Change to Administrator
        };

        const mockUpdatedUser = {
          id: 'employee-123',
          role: 'employee_amexing', // Admin role preserved
          futureRoles: ['employee_amexing'],
          displayRole: 'employee_amexing',
        };

        mockUserService.updateUser.mockResolvedValue({
          success: true,
          user: mockUpdatedUser,
          futureRoles: ['employee_amexing'],
          displayRole: 'employee_amexing',
        });

        await employeesController.updateEmployee(mockReq, mockRes);

        expect(mockUserService.updateUser).toHaveBeenCalledWith(
          'employee-123',
          expect.objectContaining({
            role: 'employee_amexing', // Admin role for RBAC
            futureRoles: ['employee_amexing'],
            displayRole: 'employee_amexing',
          }),
          mockAdminUser
        );
      });

      it('should maintain backward compatibility with single role updates', async () => {
        mockReq.body = {
          role: 'greeter', // Single role field update
        };

        const mockUpdatedUser = {
          id: 'employee-123',
          role: 'driver',
          futureRoles: ['greeter'],
          displayRole: 'greeter',
        };

        mockUserService.updateUser.mockResolvedValue({
          success: true,
          user: mockUpdatedUser,
          futureRoles: ['greeter'],
          displayRole: 'greeter',
        });

        await employeesController.updateEmployee(mockReq, mockRes);

        expect(mockUserService.updateUser).toHaveBeenCalledWith(
          'employee-123',
          expect.objectContaining({
            role: 'driver', // Maps to driver for RBAC
            futureRoles: ['greeter'], // Single role in array
            displayRole: 'greeter',
          }),
          mockAdminUser
        );
      });
    });

    describe('Role priority logic', () => {
      it('should map all employee types to driver role except Administrator', async () => {
        const testCases = [
          {
            input: ['driver', 'guia'],
            expectedRole: 'driver',
            description: 'Multiple employee roles map to driver',
          },
          {
            input: ['greeter', 'limpieza'],
            expectedRole: 'driver',
            description: 'Service roles map to driver',
          },
          {
            input: ['employee_amexing'],
            expectedRole: 'employee_amexing',
            description: 'Administrator role preserved',
          },
          {
            input: ['driver'],
            expectedRole: 'driver',
            description: 'Single driver role',
          },
        ];

        for (const testCase of testCases) {
          mockReq.body = {
            email: `test${Date.now()}@amexing.test`,
            firstName: 'Test',
            lastName: 'Employee',
            roles: testCase.input,
          };

          const mockCreatedUser = {
            id: `test-${Date.now()}`,
            email: mockReq.body.email,
            role: testCase.expectedRole,
            futureRoles: testCase.input,
          };

          mockUserService.createUser.mockResolvedValue({
            success: true,
            user: mockCreatedUser,
          });

          await employeesController.createEmployee(mockReq, mockRes);

          expect(mockUserService.createUser).toHaveBeenCalledWith(
            expect.objectContaining({
              role: testCase.expectedRole,
              futureRoles: testCase.input,
            }),
            mockAdminUser
          );

          jest.clearAllMocks();
        }
      });
    });
  });
});
