/**
 * Parse Platform Test Data Factory
 * Creates test objects safely with proper isolation and cleanup tracking
 */

const Parse = require('parse/node');
const crypto = require('crypto');

class TestDataFactory {
  constructor(testSetup) {
    this.testSetup = testSetup;
    this.createdObjects = [];
  }

  /**
   * Create AmexingUser test data
   */
  createAmexingUserData(overrides = {}) {
    const timestamp = Date.now();
    const randomSuffix = crypto.randomBytes(4).toString('hex');

    const baseData = {
      email: `test.user.${timestamp}.${randomSuffix}@amexing-test.com`,
      username: `testuser_${timestamp}_${randomSuffix}`,
      firstName: 'Test',
      lastName: 'User',
      role: 'employee',
      status: 'active',
      isEmailVerified: true,
      corporateId: `TEST_CORP_${timestamp}`,
      department: 'Technology',
      profile: {
        avatar: 'https://example.com/avatar.jpg',
        phone: '+1234567890',
        timezone: 'America/Mexico_City',
        language: 'es'
      },
      permissions: {
        canCreateEvents: true,
        canManageUsers: false,
        canAccessReports: true,
        canViewDashboard: true
      },
      preferences: {
        notifications: true,
        theme: 'light',
        language: 'es'
      },
      lastLogin: new Date(),
      passwordChangedAt: new Date()
    };

    return { ...baseData, ...overrides };
  }

  /**
   * Create Event test data
   */
  createEventData(overrides = {}) {
    const timestamp = Date.now();

    const baseData = {
      title: `Test Event ${timestamp}`,
      description: 'This is a test event for Parse Platform testing',
      startDate: new Date(),
      endDate: new Date(Date.now() + 3600000), // 1 hour later
      location: 'Test Location',
      capacity: 100,
      currentAttendees: 0,
      isActive: true,
      isPublic: true,
      category: 'technology',
      tags: ['test', 'parse', 'platform'],
      metadata: {
        createdBy: 'test-factory',
        testEvent: true
      }
    };

    return { ...baseData, ...overrides };
  }

  /**
   * Create Notification test data
   */
  createNotificationData(overrides = {}) {
    const timestamp = Date.now();

    const baseData = {
      title: `Test Notification ${timestamp}`,
      message: 'This is a test notification for Parse Platform testing',
      type: 'info',
      priority: 'normal',
      isRead: false,
      channel: 'general',
      metadata: {
        source: 'test-factory',
        category: 'platform-test'
      },
      scheduledFor: new Date(),
      expiresAt: new Date(Date.now() + 86400000) // 24 hours
    };

    return { ...baseData, ...overrides };
  }

  /**
   * Create Role test data
   */
  createRoleData(overrides = {}) {
    const timestamp = Date.now();

    const baseData = {
      name: `TestRole_${timestamp}`,
      description: 'Test role for Parse Platform testing',
      permissions: ['read', 'write', 'create'],
      isActive: true,
      isSystem: false,
      level: 1,
      metadata: {
        createdBy: 'test-factory',
        testRole: true
      }
    };

    return { ...baseData, ...overrides };
  }

  /**
   * Create Permission test data
   */
  createPermissionData(overrides = {}) {
    const timestamp = Date.now();

    const baseData = {
      name: `testPermission_${timestamp}`,
      resource: 'testResource',
      action: 'read',
      context: 'global',
      isActive: true,
      description: 'Test permission for Parse Platform testing',
      metadata: {
        createdBy: 'test-factory',
        testPermission: true
      }
    };

    return { ...baseData, ...overrides };
  }

  /**
   * Create AuditLog test data
   */
  createAuditLogData(overrides = {}) {
    const timestamp = Date.now();

    const baseData = {
      action: 'test_action',
      resource: 'testResource',
      userId: 'test-user-id',
      timestamp: new Date(),
      details: {
        method: 'POST',
        endpoint: '/api/test',
        userAgent: 'ParsePlatformTest/1.0'
      },
      result: 'success',
      metadata: {
        testLog: true,
        createdBy: 'test-factory'
      }
    };

    return { ...baseData, ...overrides };
  }

  /**
   * Create test object and save it
   */
  async createTestObject(className, data, options = {}) {
    try {
      const testObj = this.testSetup.createTestObject(className, data);
      const savedObj = await this.testSetup.saveTestObject(testObj, options);

      // Track for cleanup
      this.createdObjects.push({
        className: savedObj.className,
        objectId: savedObj.id,
        object: savedObj
      });

      return savedObj;
    } catch (error) {
      console.error(`Failed to create test ${className}:`, error);
      throw error;
    }
  }

  /**
   * Create AmexingUser test object
   */
  async createAmexingUser(overrides = {}, options = {}) {
    const userData = this.createAmexingUserData(overrides);
    return await this.createTestObject('AmexingUser', userData, options);
  }

  /**
   * Create Event test object
   */
  async createEvent(overrides = {}, options = {}) {
    const eventData = this.createEventData(overrides);
    return await this.createTestObject('Event', eventData, options);
  }

  /**
   * Create Notification test object
   */
  async createNotification(overrides = {}, options = {}) {
    const notificationData = this.createNotificationData(overrides);
    return await this.createTestObject('Notification', notificationData, options);
  }

  /**
   * Create Role test object
   */
  async createRole(overrides = {}, options = {}) {
    const roleData = this.createRoleData(overrides);
    return await this.createTestObject('Role', roleData, options);
  }

  /**
   * Create Permission test object
   */
  async createPermission(overrides = {}, options = {}) {
    const permissionData = this.createPermissionData(overrides);
    return await this.createTestObject('Permission', permissionData, options);
  }

  /**
   * Create AuditLog test object
   */
  async createAuditLog(overrides = {}, options = {}) {
    const auditLogData = this.createAuditLogData(overrides);
    return await this.createTestObject('AuditLog', auditLogData, options);
  }

  /**
   * Create multiple test objects of the same type
   */
  async createMultiple(className, count = 5, dataGenerator = null, options = {}) {
    const objects = [];

    for (let i = 0; i < count; i++) {
      let data;

      if (dataGenerator) {
        data = dataGenerator(i);
      } else {
        // Use appropriate default data generator based on className
        switch (className.toLowerCase()) {
          case 'amexinguser':
            data = this.createAmexingUserData({ username: `testuser_${Date.now()}_${i}` });
            break;
          case 'event':
            data = this.createEventData({ title: `Test Event ${Date.now()} ${i}` });
            break;
          case 'notification':
            data = this.createNotificationData({ title: `Test Notification ${Date.now()} ${i}` });
            break;
          case 'role':
            data = this.createRoleData({ name: `TestRole_${Date.now()}_${i}` });
            break;
          case 'permission':
            data = this.createPermissionData({ name: `testPermission_${Date.now()}_${i}` });
            break;
          case 'auditlog':
            data = this.createAuditLogData({ action: `test_action_${i}` });
            break;
          default:
            data = { name: `Test ${className} ${i}`, value: `test_value_${i}` };
        }
      }

      const obj = await this.createTestObject(className, data, options);
      objects.push(obj);
    }

    return objects;
  }

  /**
   * Create related test objects (with relationships)
   */
  async createRelatedObjects() {
    try {
      // Create a user
      const user = await this.createAmexingUser({
        email: 'test.related@amexing-test.com',
        username: 'test_related_user'
      });

      // Create a role
      const role = await this.createRole({
        name: 'TestRelatedRole'
      });

      // Create an event created by the user
      const event = await this.createEvent({
        title: 'Test Related Event',
        createdBy: user.id
      });

      // Create a notification for the user
      const notification = await this.createNotification({
        title: 'Test Related Notification',
        userId: user.id
      });

      return {
        user,
        role,
        event,
        notification
      };
    } catch (error) {
      console.error('Failed to create related test objects:', error);
      throw error;
    }
  }

  /**
   * Create test data with specific relationships
   */
  async createTestDataWithRelations(specifications) {
    const results = {};

    for (const spec of specifications) {
      const { type, name, data, relations } = spec;

      // Create the object
      let createdObject;
      switch (type) {
        case 'AmexingUser':
          createdObject = await this.createAmexingUser(data);
          break;
        case 'Event':
          createdObject = await this.createEvent(data);
          break;
        case 'Notification':
          createdObject = await this.createNotification(data);
          break;
        case 'Role':
          createdObject = await this.createRole(data);
          break;
        case 'Permission':
          createdObject = await this.createPermission(data);
          break;
        case 'AuditLog':
          createdObject = await this.createAuditLog(data);
          break;
        default:
          createdObject = await this.createTestObject(type, data);
      }

      results[name] = createdObject;

      // Handle relations if specified
      if (relations && relations.length > 0) {
        for (const relation of relations) {
          if (results[relation.target]) {
            // Add relation
            createdObject.set(relation.field, results[relation.target]);
            await createdObject.save(null, { useMasterKey: true });
          }
        }
      }
    }

    return results;
  }

  /**
   * Get all created objects
   */
  getCreatedObjects() {
    return [...this.createdObjects];
  }

  /**
   * Get created objects by class name
   */
  getCreatedObjectsByClass(className) {
    const fullClassName = className.startsWith('ParseTest_')
      ? className
      : `ParseTest_${className}`;

    return this.createdObjects.filter(item => item.className === fullClassName);
  }

  /**
   * Clean up all created objects
   */
  async cleanup() {
    try {
      console.log(`Cleaning up ${this.createdObjects.length} test objects from factory...`);

      for (const item of this.createdObjects) {
        try {
          await this.testSetup.cleanupTestObject(item.className, item.objectId);
        } catch (error) {
          console.warn(`Failed to cleanup object ${item.objectId}:`, error.message);
        }
      }

      this.createdObjects = [];
      console.log('Test data factory cleanup completed');
    } catch (error) {
      console.error('Failed to cleanup test data factory:', error);
    }
  }

  /**
   * Clean up specific objects
   */
  async cleanupObjects(objectIds) {
    const toCleanup = this.createdObjects.filter(item => objectIds.includes(item.objectId));

    for (const item of toCleanup) {
      try {
        await this.testSetup.cleanupTestObject(item.className, item.objectId);
        // Remove from tracking
        this.createdObjects = this.createdObjects.filter(obj => obj.objectId !== item.objectId);
      } catch (error) {
        console.warn(`Failed to cleanup object ${item.objectId}:`, error.message);
      }
    }
  }
}

module.exports = TestDataFactory;