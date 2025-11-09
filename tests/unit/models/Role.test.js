/**
 * Role Model Unit Tests
 * Tests for the new hierarchical Role model with contextual permissions
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

const Role = require('../../../src/domain/models/Role');

describe('Role Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Role Creation', () => {
    it('should create a role with valid data', () => {
      const roleData = {
        name: 'admin',
        displayName: 'Administrator',
        level: 6,
        active: true,
        exists: true
      };

      const role = Role.create(roleData);

      expect(role.get('name')).toBe('admin');
      expect(role.get('displayName')).toBe('Administrator');
      expect(role.get('level')).toBe(6);
      expect(role.get('active')).toBe(true);
      expect(role.get('exists')).toBe(true);
    });

    it('should set default values correctly', () => {
      const role = Role.create({ name: 'test_role' });

      expect(role.get('active')).toBe(true);
      expect(role.get('exists')).toBe(true);
      expect(role.get('delegatable')).toBe(false);
    });

    it('should validate required name field', () => {
      expect(() => {
        Role.create({});
      }).toThrow('Role name is required');
    });
  });

  describe('Permission Management', () => {
    let role;

    beforeEach(() => {
      role = Role.create({
        name: 'admin',
        level: 6,
        basePermissions: ['users.create', 'users.read', 'users.update', 'system.manage']
      });
    });

    it('should check if role has permission', async () => {
      expect(await role.hasPermission('users.create')).toBe(true);
      expect(await role.hasPermission('users.delete')).toBe(false);
    });

    it('should check system permissions', () => {
      expect(role.hasSystemPermission('system.manage')).toBe(true);
      expect(role.hasSystemPermission('system.admin')).toBe(false);
    });

    it('should handle contextual permissions', () => {
      role.set('contextualPermissions', {
        'bookings.approve': {
          conditions: { maxAmount: 1000 },
          scope: 'department'
        }
      });

      const context = { amount: 500, departmentId: 'test-dept' };
      expect(role.hasContextualPermission('bookings.approve', context)).toBe(true);

      const contextOverLimit = { amount: 1500 };
      expect(role.hasContextualPermission('bookings.approve', contextOverLimit)).toBe(false);
    });
  });

  describe('Role Hierarchy', () => {
    it('should return correct level for role', () => {
      const superadmin = Role.create({ name: 'superadmin', level: 7 });
      const admin = Role.create({ name: 'admin', level: 6 });
      const user = Role.create({ name: 'user', level: 3 });

      expect(superadmin.getLevel()).toBe(7);
      expect(admin.getLevel()).toBe(6);
      expect(user.getLevel()).toBe(3);
    });

    it('should check if role can manage another role', () => {
      const admin = Role.create({ name: 'admin', level: 6 });
      const user = Role.create({ name: 'user', level: 3 });
      const superadmin = Role.create({ name: 'superadmin', level: 7 });

      expect(admin.canManage(user)).toBe(true);
      expect(user.canManage(admin)).toBe(false);
      expect(admin.canManage(superadmin)).toBe(false);
    });

    it('should handle equal levels correctly', () => {
      const admin1 = Role.create({ name: 'admin', level: 6 });
      const admin2 = Role.create({ name: 'admin_other', level: 6 });

      expect(admin1.canManage(admin2)).toBe(false);
    });
  });

  describe('Permission Delegation', () => {
    it('should check delegation permissions', () => {
      const manager = Role.create({
        name: 'department_manager',
        delegatable: true,
        basePermissions: ['bookings.approve', 'reports.view'],
        delegatablePermissions: ['bookings.approve', 'reports.view']
      });

      expect(manager.canDelegatePermission('bookings.approve')).toBe(true);
      expect(manager.canDelegatePermission('system.admin')).toBe(false);
    });

    it('should prevent delegation when not allowed', () => {
      const employee = Role.create({
        name: 'employee',
        delegatable: false
      });

      expect(employee.canDelegatePermission('reports.view')).toBe(false);
    });
  });

  describe('Organization Scope', () => {
    it('should validate organization access correctly', () => {
      const clientRole = Role.create({
        name: 'client',
        organizationScope: 'own'
      });

      const systemRole = Role.create({
        name: 'admin',
        organizationScope: 'system'
      });

      expect(clientRole.canAccessOrganization('client-org', 'client-org')).toBe(true);
      expect(clientRole.canAccessOrganization('client-org', 'other-org')).toBe(false);
      expect(systemRole.canAccessOrganization('amexing', 'any-org')).toBe(true);
    });

    it('should handle cross-client access for system roles', () => {
      const amexingRole = Role.create({
        name: 'admin',
        organizationScope: 'client'
      });

      expect(amexingRole.canAccessOrganization('amexing', 'client-org')).toBe(true);
      expect(amexingRole.canAccessOrganization('client-org', 'other-client')).toBe(false);
    });
  });

  describe('Static Factory Methods', () => {
    it('should create system roles correctly', () => {
      const roles = Role.getSystemRoles();

      expect(roles).toHaveLength(8); // Updated to 8 - added driver role
      expect(roles.find(r => r.name === 'superadmin')).toBeDefined();
      expect(roles.find(r => r.name === 'guest')).toBeDefined();
      expect(roles.find(r => r.name === 'driver')).toBeDefined(); // New driver role

      const superadmin = roles.find(r => r.name === 'superadmin');
      expect(superadmin.level).toBe(7);
      expect(superadmin.delegatable).toBe(true);
    });

    it('should validate system role hierarchy', () => {
      const roles = Role.getSystemRoles();
      const superadmin = roles.find(r => r.name === 'superadmin');
      const admin = roles.find(r => r.name === 'admin');
      const guest = roles.find(r => r.name === 'guest');

      expect(superadmin.level).toBeGreaterThan(admin.level);
      expect(admin.level).toBeGreaterThan(guest.level);
    });
  });

  describe('Permission Inheritance', () => {
    it('should inherit permissions from lower level roles', () => {
      const roles = Role.getSystemRoles();
      const admin = roles.find(r => r.name === 'admin');
      const employee = roles.find(r => r.name === 'employee');

      // Admin should have all employee permissions plus more
      const adminPermissions = admin.basePermissions || [];
      const employeePermissions = employee.basePermissions || [];

      // Test that admin has key permissions that employee might not have
      expect(adminPermissions.includes('users.create')).toBe(true);
      expect(adminPermissions.includes('users.update')).toBe(true);
    });
  });

  describe('Role Validation', () => {
    it('should validate role names', () => {
      expect(() => {
        Role.create({ name: 'invalid role!' });
      }).toThrow();

      expect(() => {
        Role.create({ name: 'valid_role' });
      }).not.toThrow();
    });

    it('should validate level ranges', () => {
      expect(() => {
        Role.create({ name: 'test', level: 0 });
      }).toThrow('Role level must be between 1 and 7');

      expect(() => {
        Role.create({ name: 'test', level: 8 });
      }).toThrow('Role level must be between 1 and 7');

      expect(() => {
        Role.create({ name: 'test', level: 5 });
      }).not.toThrow();
    });
  });
});