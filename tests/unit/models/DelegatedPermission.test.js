/**
 * DelegatedPermission Model Unit Tests
 * Tests for permission delegation system between users
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

const DelegatedPermission = require('../../../src/domain/models/DelegatedPermission');

describe('DelegatedPermission Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Delegation Creation', () => {
    it('should create delegation with valid data', () => {
      const delegationData = {
        fromUserId: 'manager-123',
        toUserId: 'employee-456',
        permission: 'bookings.approve',
        context: { maxAmount: 2000, departmentId: 'sales' },
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        reason: 'Temporary approval authority during vacation'
      };

      const delegation = DelegatedPermission.create(delegationData);

      expect(delegation.get('fromUserId')).toBe('manager-123');
      expect(delegation.get('toUserId')).toBe('employee-456');
      expect(delegation.get('permission')).toBe('bookings.approve');
      expect(delegation.get('active')).toBe(true);
      expect(delegation.get('exists')).toBe(true);
    });

    it('should set default values correctly', () => {
      const delegation = DelegatedPermission.create({
        fromUserId: 'user1',
        toUserId: 'user2',
        permission: 'test.permission'
      });

      expect(delegation.get('active')).toBe(true);
      expect(delegation.get('exists')).toBe(true);
      expect(delegation.get('usageCount')).toBe(0);
      expect(delegation.get('delegatedAt')).toBeInstanceOf(Date);
    });

    it('should validate required fields', () => {
      expect(() => {
        DelegatedPermission.create({});
      }).toThrow('From user, to user, and permission are required');

      expect(() => {
        DelegatedPermission.create({
          fromUserId: 'user1',
          toUserId: 'user2'
        });
      }).toThrow('From user, to user, and permission are required');
    });

    it('should prevent self-delegation', () => {
      expect(() => {
        DelegatedPermission.create({
          fromUserId: 'user1',
          toUserId: 'user1',
          permission: 'test.permission'
        });
      }).toThrow('Cannot delegate permission to yourself');
    });
  });

  describe('Permission Validation', () => {
    let delegation;

    beforeEach(() => {
      delegation = DelegatedPermission.create({
        fromUserId: 'manager-123',
        toUserId: 'employee-456',
        permission: 'bookings.approve',
        context: {
          maxAmount: 5000,
          departmentId: 'sales'
        },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      });
    });

    it('should validate permission with matching context', () => {
      const context = {
        amount: 3000,
        departmentId: 'sales'
      };

      expect(delegation.hasPermission('bookings.approve', context)).toBe(true);
    });

    it('should deny permission with invalid context', () => {
      const overAmountContext = {
        amount: 6000,
        departmentId: 'sales'
      };

      const wrongDepartmentContext = {
        amount: 3000,
        departmentId: 'marketing'
      };

      expect(delegation.hasPermission('bookings.approve', overAmountContext)).toBe(false);
      expect(delegation.hasPermission('bookings.approve', wrongDepartmentContext)).toBe(false);
    });

    it('should deny different permissions', () => {
      const context = { amount: 1000 };
      expect(delegation.hasPermission('reports.view', context)).toBe(false);
    });

    it('should check expiration', () => {
      // Create expired delegation
      const expiredDelegation = DelegatedPermission.create({
        fromUserId: 'manager-123',
        toUserId: 'employee-456',
        permission: 'bookings.approve',
        expiresAt: new Date(Date.now() - 1000) // Expired 1 second ago
      });

      expect(expiredDelegation.isExpired()).toBe(true);
      expect(expiredDelegation.hasPermission('bookings.approve')).toBe(false);
      expect(delegation.isExpired()).toBe(false);
    });

    it('should check if delegation is active', () => {
      expect(delegation.isActive()).toBe(true);

      delegation.set('active', false);
      expect(delegation.isActive()).toBe(false);
      expect(delegation.hasPermission('bookings.approve')).toBe(false);
    });
  });

  describe('Usage Tracking', () => {
    let delegation;

    beforeEach(() => {
      delegation = DelegatedPermission.create({
        fromUserId: 'manager-123',
        toUserId: 'employee-456',
        permission: 'bookings.approve',
        usageLimit: 5
      });
    });

    it('should track permission usage', () => {
      expect(delegation.get('usageCount')).toBe(0);

      delegation.recordUsage({ amount: 1000 });
      expect(delegation.get('usageCount')).toBe(1);

      const usageHistory = delegation.get('usageHistory') || [];
      expect(usageHistory).toHaveLength(1);
      expect(usageHistory[0].timestamp).toBeInstanceOf(Date);
      expect(usageHistory[0].context.amount).toBe(1000);
    });

    it('should enforce usage limits', () => {
      // Use up the limit
      for (let i = 0; i < 5; i++) {
        delegation.recordUsage({ amount: 100 });
      }

      expect(delegation.get('usageCount')).toBe(5);
      expect(delegation.hasReachedUsageLimit()).toBe(true);
      expect(delegation.hasPermission('bookings.approve')).toBe(false);
    });

    it('should handle unlimited usage when no limit set', () => {
      const unlimitedDelegation = DelegatedPermission.create({
        fromUserId: 'manager-123',
        toUserId: 'employee-456',
        permission: 'reports.view'
        // No usageLimit set
      });

      for (let i = 0; i < 100; i++) {
        unlimitedDelegation.recordUsage();
      }

      expect(unlimitedDelegation.hasReachedUsageLimit()).toBe(false);
      expect(unlimitedDelegation.hasPermission('reports.view')).toBe(true);
    });
  });

  describe('Delegation Management', () => {
    let delegation;

    beforeEach(() => {
      delegation = DelegatedPermission.create({
        fromUserId: 'manager-123',
        toUserId: 'employee-456',
        permission: 'bookings.approve'
      });
    });

    it('should revoke delegation', () => {
      expect(delegation.isActive()).toBe(true);

      delegation.revoke('Manager returned from vacation');

      expect(delegation.get('active')).toBe(false);
      expect(delegation.get('revokedAt')).toBeInstanceOf(Date);
      expect(delegation.get('revocationReason')).toBe('Manager returned from vacation');
      expect(delegation.hasPermission('bookings.approve')).toBe(false);
    });

    it('should extend expiration', () => {
      const originalExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
      delegation.set('expiresAt', originalExpiry);

      const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      delegation.extendExpiration(newExpiry);

      expect(delegation.get('expiresAt')).toEqual(newExpiry);
      expect(delegation.get('extensionHistory')).toBeDefined();
    });

    it('should prevent extending to past date', () => {
      const pastDate = new Date(Date.now() - 1000);

      expect(() => {
        delegation.extendExpiration(pastDate);
      }).toThrow('Cannot extend to a past date');
    });
  });

  describe('Context Validation', () => {
    it('should validate amount constraints', () => {
      const delegation = DelegatedPermission.create({
        fromUserId: 'manager-123',
        toUserId: 'employee-456',
        permission: 'bookings.approve',
        context: { maxAmount: 2000 }
      });

      expect(delegation.validateContext({ amount: 1500 })).toBe(true);
      expect(delegation.validateContext({ amount: 2500 })).toBe(false);
      expect(delegation.validateContext({})).toBe(false); // No amount
    });

    it('should validate department constraints', () => {
      const delegation = DelegatedPermission.create({
        fromUserId: 'manager-123',
        toUserId: 'employee-456',
        permission: 'reports.view',
        context: { departmentId: 'sales' }
      });

      expect(delegation.validateContext({ departmentId: 'sales' })).toBe(true);
      expect(delegation.validateContext({ departmentId: 'marketing' })).toBe(false);
    });

    it('should validate time constraints', () => {
      const delegation = DelegatedPermission.create({
        fromUserId: 'manager-123',
        toUserId: 'employee-456',
        permission: 'bookings.approve',
        context: {
          timeRestrictions: {
            startTime: '09:00',
            endTime: '17:00',
            daysOfWeek: [1, 2, 3, 4, 5] // Monday to Friday
          }
        }
      });

      const mondayMorning = new Date('2024-09-23T10:00:00Z'); // Monday 10 AM
      const sundayMorning = new Date('2024-09-22T10:00:00Z'); // Sunday 10 AM
      const mondayEvening = new Date('2024-09-23T20:00:00Z'); // Monday 8 PM

      expect(delegation.validateTimeContext({ timestamp: mondayMorning })).toBe(true);
      expect(delegation.validateTimeContext({ timestamp: sundayMorning })).toBe(false);
      expect(delegation.validateTimeContext({ timestamp: mondayEvening })).toBe(false);
    });
  });

  describe('Audit Trail', () => {
    it('should maintain complete audit trail', () => {
      const delegation = DelegatedPermission.create({
        fromUserId: 'manager-123',
        toUserId: 'employee-456',
        permission: 'bookings.approve',
        reason: 'Temporary delegation for project'
      });

      // Use the permission a few times
      delegation.recordUsage({ amount: 1000, bookingId: 'booking-1' });
      delegation.recordUsage({ amount: 1500, bookingId: 'booking-2' });

      // Extend the delegation
      delegation.extendExpiration(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

      // Revoke it
      delegation.revoke('Project completed');

      // Check audit trail
      expect(delegation.get('delegatedAt')).toBeInstanceOf(Date);
      expect(delegation.get('usageHistory')).toHaveLength(2);
      expect(delegation.get('extensionHistory')).toBeDefined();
      expect(delegation.get('revokedAt')).toBeInstanceOf(Date);
      expect(delegation.get('revocationReason')).toBe('Project completed');
    });

    it('should generate audit report', () => {
      const delegation = DelegatedPermission.create({
        fromUserId: 'manager-123',
        toUserId: 'employee-456',
        permission: 'bookings.approve'
      });

      delegation.recordUsage({ amount: 1000 });
      delegation.recordUsage({ amount: 2000 });

      const auditReport = delegation.generateAuditReport();

      expect(auditReport.delegationId).toBe(delegation.id);
      expect(auditReport.fromUserId).toBe('manager-123');
      expect(auditReport.toUserId).toBe('employee-456');
      expect(auditReport.permission).toBe('bookings.approve');
      expect(auditReport.totalUsages).toBe(2);
      expect(auditReport.isActive).toBe(true);
      expect(auditReport.timeline).toBeDefined();
    });
  });

  describe('Static Query Methods', () => {
    it('should find delegations for user', async () => {
      // Mock the query
      const mockQuery = {
        equalTo: jest.fn().mockReturnThis(),
        find: jest.fn().mockResolvedValue([])
      };
      require('parse/node').Query.mockImplementation(() => mockQuery);

      await DelegatedPermission.findDelegationsForUser('employee-456');

      expect(mockQuery.equalTo).toHaveBeenCalledWith('toUserId', 'employee-456');
      expect(mockQuery.equalTo).toHaveBeenCalledWith('active', true);
      expect(mockQuery.equalTo).toHaveBeenCalledWith('exists', true);
    });

    it('should find delegations by delegator', async () => {
      const mockQuery = {
        equalTo: jest.fn().mockReturnThis(),
        find: jest.fn().mockResolvedValue([])
      };
      require('parse/node').Query.mockImplementation(() => mockQuery);

      await DelegatedPermission.findDelegationsByDelegator('manager-123');

      expect(mockQuery.equalTo).toHaveBeenCalledWith('fromUserId', 'manager-123');
      expect(mockQuery.equalTo).toHaveBeenCalledWith('exists', true);
    });
  });
});