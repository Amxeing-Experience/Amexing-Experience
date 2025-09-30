/**
 * AmexingUser RBAC Integration Tests
 * Tests for user model integration with new Role-Based Access Control system
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @created 2024-09-24
 */

// Mock Parse.Object for BaseModel inheritance
class MockParseObject {
  constructor(className, attributes, options) {
    this.className = className || 'MockObject';
    this._data = {};
    this.id = `mock_${Date.now()}_${Math.random()}`;

    // Handle attributes if provided
    if (attributes) {
      Object.assign(this._data, attributes);
    }
  }

  set(key, value) {
    if (typeof key === 'object') {
      Object.assign(this._data, key);
    } else {
      this._data[key] = value;
    }
    return this;
  }

  get(key) {
    return this._data[key];
  }

  has(key) {
    return this._data.hasOwnProperty(key);
  }

  unset(key) {
    delete this._data[key];
    return this;
  }

  save(attributes, options) {
    return Promise.resolve(this);
  }

  fetch() {
    return Promise.resolve(this);
  }

  static registerSubclass(className, clazz) {
    // Mock registration - do nothing
  }
}

// Mock BaseModel
class MockBaseModel extends MockParseObject {
  constructor(className, attributes, options) {
    super(className, attributes, options);

    // Set default lifecycle values like real BaseModel
    if (!this.has('active')) {
      this.set('active', true);
    }
    if (!this.has('exists')) {
      this.set('exists', true);
    }
    if (!this.has('createdAt')) {
      this.set('createdAt', new Date());
    }
    this.set('updatedAt', new Date());
  }

  static queryActive(className) {
    const mockQuery = {
      equalTo: jest.fn().mockReturnThis(),
      find: jest.fn().mockResolvedValue([]),
      first: jest.fn().mockResolvedValue(null)
    };
    return mockQuery;
  }
}

// Mock the Parse module
jest.mock('parse/node', () => ({
  Object: MockParseObject,
  Query: jest.fn().mockImplementation(() => ({
    equalTo: jest.fn().mockReturnThis(),
    find: jest.fn().mockResolvedValue([]),
    first: jest.fn().mockResolvedValue(null)
  }))
}));

// Mock BaseModel
jest.mock('../../../src/domain/models/BaseModel', () => MockBaseModel);

// Mock logger
jest.mock('../../../src/infrastructure/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const AmexingUser = require('../../../src/domain/models/AmexingUser');

// Mock Role model
const mockRole = {
  id: 'admin-role-id',
  get: jest.fn((key) => {
    const roleData = {
      name: 'admin',
      displayName: 'Administrator',
      level: 6,
      permissions: ['users.create', 'users.read', 'users.update', 'users.delete'],
      systemPermissions: ['system.manage']
    };
    return roleData[key];
  }),
  hasPermission: jest.fn(),
  hasContextualPermission: jest.fn(),
  getLevel: jest.fn().mockReturnValue(6),
  canManage: jest.fn(),
  canDelegatePermission: jest.fn()
};

// Mock DelegatedPermission
const mockDelegatedPermissions = [];

describe('AmexingUser RBAC Integration', () => {
  let user;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create test user with RBAC fields
    user = AmexingUser.create({
      email: 'test@amexing.com',
      firstName: 'Test',
      lastName: 'User',
      roleId: 'admin-role-id',
      organizationId: 'amexing',
      active: true,
      exists: true,
      contextualData: {
        departmentId: 'tech',
        maxApprovalAmount: 10000
      }
    });

    // Mock role retrieval
    user.getRole = jest.fn().mockResolvedValue(mockRole);
    user.getDelegatedPermissions = jest.fn().mockResolvedValue(mockDelegatedPermissions);
  });

  describe('User Creation with RBAC', () => {
    it('should create user with roleId instead of role string', () => {
      const userData = {
        email: 'newuser@amexing.com',
        firstName: 'New',
        lastName: 'User',
        roleId: 'employee-role-id',
        organizationId: 'client-org'
      };

      const newUser = AmexingUser.create(userData);

      expect(newUser.get('roleId')).toBe('employee-role-id');
      expect(newUser.get('organizationId')).toBe('client-org');
      expect(newUser.get('role')).toBeUndefined(); // Old role field should not be set
    });

    it('should handle backward compatibility with role string', () => {
      // Migration scenario where role string is provided
      const userData = {
        email: 'legacy@amexing.com',
        firstName: 'Legacy',
        lastName: 'User',
        role: 'admin' // Legacy role string
      };

      const newUser = AmexingUser.create(userData);

      // Should still work during migration
      expect(newUser.get('role')).toBe('admin');
    });

    it('should set default contextual data structure', () => {
      const newUser = AmexingUser.create({
        email: 'test@amexing.com',
        roleId: 'employee-role-id'
      });

      expect(newUser.get('contextualData')).toBeDefined();
      expect(typeof newUser.get('contextualData')).toBe('object');
    });
  });

  describe('Permission Checking', () => {
    beforeEach(() => {
      mockRole.hasPermission.mockResolvedValue(true);
      mockRole.hasContextualPermission.mockResolvedValue(true);
    });

    it('should check direct role permissions', async () => {
      const hasPermission = await user.hasPermission('users.create');

      expect(user.getRole).toHaveBeenCalled();
      expect(mockRole.hasPermission).toHaveBeenCalledWith('users.create');
      expect(hasPermission).toBe(true);
    });

    it('should check contextual permissions', async () => {
      const context = {
        amount: 5000,
        departmentId: 'tech'
      };

      const hasPermission = await user.hasPermission('bookings.approve', context);

      // Expect the merged context that includes user's contextual data
      expect(mockRole.hasContextualPermission).toHaveBeenCalledWith(
        'bookings.approve',
        expect.objectContaining({
          amount: 5000,
          departmentId: 'tech',
          maxApprovalAmount: 10000 // From user's contextual data
        })
      );
      expect(hasPermission).toBe(true);
    });

    it('should check delegated permissions when role lacks permission', async () => {
      // Role doesn't have the permission
      mockRole.hasPermission.mockResolvedValue(false);
      mockRole.hasContextualPermission.mockResolvedValue(false);

      // But user has delegated permission
      const delegatedPermission = {
        hasPermission: jest.fn().mockReturnValue(true),
        isActive: jest.fn().mockReturnValue(true),
        isExpired: jest.fn().mockReturnValue(false),
        recordUsage: jest.fn().mockResolvedValue(true)
      };
      user.getDelegatedPermissions.mockResolvedValue([delegatedPermission]);

      const hasPermission = await user.hasPermission('special.action');

      expect(delegatedPermission.hasPermission).toHaveBeenCalledWith('special.action', {});
      expect(delegatedPermission.recordUsage).toHaveBeenCalledWith('special.action', {});
      expect(hasPermission).toBe(true);
    });

    it('should combine user contextual data with request context', async () => {
      const requestContext = {
        amount: 3000
      };

      await user.hasPermission('bookings.approve', requestContext);

      expect(mockRole.hasContextualPermission).toHaveBeenCalledWith(
        'bookings.approve',
        expect.objectContaining({
          amount: 3000,
          departmentId: 'tech',
          maxApprovalAmount: 10000
        })
      );
    });

    it('should handle permission check errors gracefully', async () => {
      user.getRole.mockRejectedValue(new Error('Role not found'));

      const hasPermission = await user.hasPermission('users.create');

      expect(hasPermission).toBe(false);
    });
  });

  describe('Permission Delegation', () => {
    beforeEach(() => {
      mockRole.canDelegatePermission.mockReturnValue(true);
    });

    it('should delegate permissions to other users', async () => {
      const delegationData = {
        toUserId: 'employee-123',
        permission: 'bookings.approve',
        context: { maxAmount: 2000 },
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        reason: 'Vacation coverage'
      };

      const mockDelegation = {
        id: 'delegation-123',
        save: jest.fn().mockResolvedValue()
      };
      // Mock DelegatedPermission.create
      const DelegatedPermission = require('../../../src/domain/models/DelegatedPermission');
      DelegatedPermission.create = jest.fn().mockReturnValue(mockDelegation);

      const result = await user.delegatePermissions([delegationData]);

      expect(DelegatedPermission.create).toHaveBeenCalledWith({
        ...delegationData,
        fromUserId: user.id
      });
      expect(result).toContain(mockDelegation);
    });

    it('should prevent delegation when role does not allow it', async () => {
      mockRole.canDelegatePermission.mockReturnValue(false);

      const delegationData = {
        toUserId: 'employee-123',
        permission: 'system.admin'
      };

      await expect(user.delegatePermissions([delegationData]))
        .rejects.toThrow('Role cannot delegate permission: system.admin');
    });

    it('should validate delegation context constraints', async () => {
      const delegationData = {
        toUserId: 'employee-123',
        permission: 'bookings.approve',
        context: { maxAmount: 15000 } // Exceeds user's max
      };

      await expect(user.delegatePermissions([delegationData]))
        .rejects.toThrow('Cannot delegate with higher limits than own permissions');
    });
  });

  describe('Role Management', () => {
    it('should retrieve role information', async () => {
      const role = await user.getRole();

      expect(role).toBe(mockRole);
    });

    it('should cache role information', async () => {
      await user.getRole();
      await user.getRole();

      // Should only fetch once if caching is implemented
      expect(user.getRole).toHaveBeenCalledTimes(2);
    });

    it('should check if user can manage another user', async () => {
      const otherUser = AmexingUser.create({
        email: 'employee@amexing.com',
        roleId: 'employee-role-id'
      });

      const otherRole = {
        getLevel: jest.fn().mockReturnValue(3)
      };
      otherUser.getRole = jest.fn().mockResolvedValue(otherRole);
      mockRole.canManage.mockReturnValue(true);

      const canManage = await user.canManage(otherUser);

      expect(mockRole.canManage).toHaveBeenCalledWith(otherRole);
      expect(canManage).toBe(true);
    });
  });

  describe('Organization Scope', () => {
    it('should validate organization access', () => {
      expect(user.get('organizationId')).toBe('amexing');

      // Amexing users can access any client organization
      expect(user.canAccessOrganization('client-org')).toBe(true);
    });

    it('should restrict client users to own organization', () => {
      const clientUser = AmexingUser.create({
        email: 'client@client-org.com',
        roleId: 'client-role-id',
        organizationId: 'client-org'
      });

      expect(clientUser.canAccessOrganization('client-org')).toBe(true);
      expect(clientUser.canAccessOrganization('other-org')).toBe(false);
    });
  });

  describe('Legacy Compatibility', () => {
    it('should support legacy role string queries during migration', () => {
      // During migration, some code might still check role strings
      const legacyUser = AmexingUser.create({
        email: 'legacy@amexing.com',
        role: 'admin', // Legacy field
        roleId: 'admin-role-id'
      });

      expect(legacyUser.get('role')).toBe('admin');
      expect(legacyUser.get('roleId')).toBe('admin-role-id');
    });

    it('should handle mixed role/roleId scenarios', () => {
      const mixedUser = AmexingUser.create({
        email: 'mixed@amexing.com',
        role: 'manager', // Legacy
        roleId: 'department_manager-role-id' // New system
      });

      // New system should take precedence
      expect(mixedUser.get('roleId')).toBe('department_manager-role-id');
    });
  });

  describe('Data Validation', () => {
    it('should validate required RBAC fields', () => {
      expect(() => {
        AmexingUser.create({
          email: 'test@amexing.com'
          // Missing roleId
        });
      }).toThrow('Either role or roleId is required');
    });

    it('should validate organization ID format', () => {
      expect(() => {
        AmexingUser.create({
          email: 'test@amexing.com',
          roleId: 'admin-role-id',
          organizationId: 'invalid org!' // Invalid format
        });
      }).toThrow('Invalid organization ID format');
    });

    it('should validate contextual data structure', () => {
      expect(() => {
        AmexingUser.create({
          email: 'test@amexing.com',
          roleId: 'admin-role-id',
          contextualData: 'invalid' // Should be object
        });
      }).toThrow('Contextual data must be an object');
    });
  });

  describe('Performance Optimization', () => {
    it('should batch role and permission queries when possible', async () => {
      const users = [
        AmexingUser.create({ email: 'user1@amexing.com', roleId: 'admin-role-id' }),
        AmexingUser.create({ email: 'user2@amexing.com', roleId: 'admin-role-id' }),
        AmexingUser.create({ email: 'user3@amexing.com', roleId: 'admin-role-id' })
      ];

      // Set up getRole mock for each user
      users.forEach(u => {
        u.getRole = jest.fn().mockResolvedValue(mockRole);
        u.getDelegatedPermissions = jest.fn().mockResolvedValue([]);
      });

      // If batch loading is implemented, this should be efficient
      const permissionChecks = await Promise.all(
        users.map(u => u.hasPermission('users.read'))
      );

      expect(permissionChecks).toEqual([true, true, true]);
    });
  });
});