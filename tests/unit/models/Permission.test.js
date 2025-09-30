/**
 * Permission Model Unit Tests
 * Tests for the granular Permission model with contextual conditions
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

const Permission = require('../../../src/domain/models/Permission');

describe('Permission Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Permission Creation', () => {
    it('should create permission with valid data', () => {
      const permissionData = {
        name: 'users.create',
        resource: 'users',
        action: 'create',
        description: 'Create new users',
        active: true,
        exists: true
      };

      const permission = Permission.create(permissionData);

      expect(permission.get('name')).toBe('users.create');
      expect(permission.get('resource')).toBe('users');
      expect(permission.get('action')).toBe('create');
      expect(permission.get('active')).toBe(true);
      expect(permission.get('exists')).toBe(true);
    });

    it('should auto-generate name from resource and action', () => {
      const permission = Permission.create({
        resource: 'reports',
        action: 'read'
      });

      expect(permission.get('name')).toBe('reports.read');
    });

    it('should validate required fields', () => {
      expect(() => {
        Permission.create({});
      }).toThrow('Resource and action are required');

      expect(() => {
        Permission.create({ resource: 'users' });
      }).toThrow('Resource and action are required');
    });

    it('should set default values correctly', () => {
      const permission = Permission.create({
        resource: 'test',
        action: 'read'
      });

      expect(permission.get('active')).toBe(true);
      expect(permission.get('exists')).toBe(true);
      expect(permission.get('delegatable')).toBe(true);
    });
  });

  describe('Contextual Conditions', () => {
    let permission;

    beforeEach(() => {
      permission = Permission.create({
        resource: 'bookings',
        action: 'approve',
        conditions: {
          maxAmount: 5000,
          businessHoursOnly: true,
          departmentScope: true
        }
      });
    });

    it('should validate amount conditions', () => {
      expect(permission.validateContext({ amount: 3000 })).toBe(true);
      expect(permission.validateContext({ amount: 6000 })).toBe(false);
      expect(permission.validateContext({})).toBe(false); // No amount provided
    });

    it('should validate time conditions', () => {
      const businessHoursTime = new Date('2024-09-24T10:00:00Z'); // Tuesday 10 AM
      const afterHoursTime = new Date('2024-09-24T22:00:00Z'); // Tuesday 10 PM
      const weekendTime = new Date('2024-09-22T10:00:00Z'); // Sunday 10 AM

      expect(permission.validateContext({ timestamp: businessHoursTime })).toBe(true);
      expect(permission.validateContext({ timestamp: afterHoursTime })).toBe(false);
      expect(permission.validateContext({ timestamp: weekendTime })).toBe(false);
    });

    it('should validate department scope', () => {
      expect(permission.validateContext({
        amount: 1000,
        departmentId: 'dept1',
        userDepartmentId: 'dept1'
      })).toBe(true);

      expect(permission.validateContext({
        amount: 1000,
        departmentId: 'dept1',
        userDepartmentId: 'dept2'
      })).toBe(false);
    });

    it('should handle multiple conditions correctly', () => {
      const validContext = {
        amount: 3000,
        timestamp: new Date('2024-09-24T10:00:00Z'),
        departmentId: 'dept1',
        userDepartmentId: 'dept1'
      };

      const invalidAmountContext = { ...validContext, amount: 6000 };
      const invalidTimeContext = { ...validContext, timestamp: new Date('2024-09-24T22:00:00Z') };
      const invalidDeptContext = { ...validContext, userDepartmentId: 'dept2' };

      expect(permission.validateContext(validContext)).toBe(true);
      expect(permission.validateContext(invalidAmountContext)).toBe(false);
      expect(permission.validateContext(invalidTimeContext)).toBe(false);
      expect(permission.validateContext(invalidDeptContext)).toBe(false);
    });
  });

  describe('Permission Categories', () => {
    it('should identify system permissions', () => {
      const systemPerm = Permission.create({
        resource: 'system',
        action: 'manage',
        category: 'system'
      });

      const userPerm = Permission.create({
        resource: 'users',
        action: 'read',
        category: 'user'
      });

      expect(systemPerm.isSystemPermission()).toBe(true);
      expect(userPerm.isSystemPermission()).toBe(false);
    });

    it('should check delegatability', () => {
      const delegatablePerm = Permission.create({
        resource: 'reports',
        action: 'view',
        delegatable: true
      });

      const nonDelegatablePerm = Permission.create({
        resource: 'system',
        action: 'admin',
        delegatable: false
      });

      expect(delegatablePerm.isDelegatable()).toBe(true);
      expect(nonDelegatablePerm.isDelegatable()).toBe(false);
    });
  });

  describe('Static Factory Methods', () => {
    it('should create system permissions', () => {
      const permissions = Permission.createSystemPermissions();

      expect(permissions.length).toBeGreaterThan(0);
      expect(permissions.find(p => p.get('name') === 'users.create')).toBeDefined();
      expect(permissions.find(p => p.get('name') === 'bookings.approve')).toBeDefined();
      expect(permissions.find(p => p.get('name') === 'system.admin')).toBeDefined();
    });

    it('should validate system permission structure', () => {
      const permissions = Permission.createSystemPermissions();

      permissions.forEach(permission => {
        expect(permission.get('name')).toMatch(/^[a-z_]+\.[a-z_]+$/);
        expect(permission.get('resource')).toBeTruthy();
        expect(permission.get('action')).toBeTruthy();
        expect(typeof permission.get('active')).toBe('boolean');
        expect(typeof permission.get('exists')).toBe('boolean');
      });
    });

    it('should include contextual permissions', () => {
      const permissions = Permission.createSystemPermissions();
      const bookingApprove = permissions.find(p => p.get('name') === 'bookings.approve');

      expect(bookingApprove).toBeDefined();
      expect(bookingApprove.get('conditions')).toBeDefined();
      expect(bookingApprove.get('conditions').maxAmount).toBeDefined();
    });
  });

  describe('Permission Inheritance', () => {
    it('should check if permission inherits from another', () => {
      const readPerm = Permission.create({
        resource: 'users',
        action: 'read'
      });

      const managePerm = Permission.create({
        resource: 'users',
        action: 'manage',
        includes: ['users.read', 'users.update', 'users.delete']
      });

      expect(managePerm.includes(readPerm.get('name'))).toBe(true);
      expect(managePerm.includes('users.nonexistent')).toBe(false);
    });

    it('should handle hierarchical permissions', () => {
      const managePerm = Permission.create({
        resource: 'users',
        action: 'manage',
        includes: ['users.create', 'users.read', 'users.update', 'users.delete']
      });

      expect(managePerm.impliesPermission('users.read')).toBe(true);
      expect(managePerm.impliesPermission('users.delete')).toBe(true);
      expect(managePerm.impliesPermission('reports.read')).toBe(false);
    });
  });

  describe('Permission Validation', () => {
    it('should validate permission names', () => {
      expect(() => {
        Permission.create({
          resource: 'invalid resource!',
          action: 'read'
        });
      }).toThrow();

      expect(() => {
        Permission.create({
          resource: 'users',
          action: 'invalid action!'
        });
      }).toThrow();

      expect(() => {
        Permission.create({
          resource: 'valid_resource',
          action: 'valid_action'
        });
      }).not.toThrow();
    });

    it('should validate condition structure', () => {
      expect(() => {
        Permission.create({
          resource: 'test',
          action: 'action',
          conditions: 'invalid' // Should be object
        });
      }).toThrow('Conditions must be an object');

      expect(() => {
        Permission.create({
          resource: 'test',
          action: 'action',
          conditions: {
            maxAmount: 'not a number'
          }
        });
      }).toThrow('maxAmount must be a number');
    });
  });

  describe('Business Hours Validation', () => {
    let permission;

    beforeEach(() => {
      permission = Permission.create({
        resource: 'bookings',
        action: 'approve',
        conditions: { businessHoursOnly: true }
      });
    });

    it('should identify business hours correctly', () => {
      // Monday 9 AM UTC
      const mondayMorning = new Date('2024-09-23T09:00:00Z');
      // Monday 6 PM UTC
      const mondayEvening = new Date('2024-09-23T18:00:00Z');
      // Monday 10 PM UTC (after hours)
      const mondayNight = new Date('2024-09-23T22:00:00Z');
      // Saturday 10 AM UTC (weekend)
      const saturday = new Date('2024-09-21T10:00:00Z');

      expect(permission.isBusinessHours(mondayMorning)).toBe(true);
      expect(permission.isBusinessHours(mondayEvening)).toBe(true);
      expect(permission.isBusinessHours(mondayNight)).toBe(false);
      expect(permission.isBusinessHours(saturday)).toBe(false);
    });

    it('should handle timezone considerations', () => {
      // This test ensures our business hours logic is consistent
      const permission = Permission.create({
        resource: 'test',
        action: 'action',
        conditions: {
          businessHoursOnly: true,
          timezone: 'America/New_York'
        }
      });

      // The actual implementation should handle timezone-aware business hours
      // For now, we test the UTC logic
      const noonUTC = new Date('2024-09-23T12:00:00Z'); // Monday noon UTC
      expect(permission.validateContext({ timestamp: noonUTC })).toBe(true);
    });
  });
});