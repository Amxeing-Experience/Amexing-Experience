/**
 * Parse.Cloud Hooks Operations Test Suite
 * Tests Parse.Cloud hooks (beforeSave, afterSave, beforeDelete, afterDelete)
 */

const Parse = require('parse/node');
const ParseTestHelpers = require('../helpers/parse-test-helpers');
const TestDataFactory = require('../helpers/test-data-factory');

describe('Parse.Cloud Hooks Operations', () => {
  let testHelpers;
  let testDataFactory;
  let testObjects = [];

  beforeAll(async () => {
    // Initialize Parse connection
    const parseConfig = require('../parse-platform.env.js');
    Parse.initialize(parseConfig.appId, parseConfig.jsKey, parseConfig.masterKey);
    Parse.serverURL = parseConfig.serverURL;

    testHelpers = new ParseTestHelpers();
    testDataFactory = new TestDataFactory();

    // Verify Parse is initialized
    expect(Parse.applicationId).toBe(parseConfig.appId);
    expect(Parse.serverURL).toBe(parseConfig.serverURL);
  });

  afterEach(async () => {
    // Clean up test data
    if (testObjects.length > 0) {
      try {
        await Parse.Object.destroyAll(testObjects, { useMasterKey: true });
        testObjects = [];
      } catch (error) {
        console.warn('Error cleaning up test objects:', error.message);
      }
    }
  });

  describe('AmexingUser Hooks Testing', () => {
    test('should validate AmexingUser beforeSave hook execution', async () => {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const testUser = new AmexingUser();

      // Set valid user data
      testUser.set('username', 'hookstestuser');
      testUser.set('email', 'hookstest@example.com');
      testUser.set('firstName', 'Hooks');
      testUser.set('lastName', 'Test');
      testUser.set('role', 'user');

      const savedUser = await testHelpers.saveWithRetry(testUser);
      testObjects.push(savedUser);

      // Verify hook processed the data
      expect(savedUser.get('username')).toBe('hookstestuser'); // Should be lowercase
      expect(savedUser.get('email')).toBe('hookstest@example.com'); // Should be lowercase
      expect(savedUser.get('createdAt')).toBeDefined();
      expect(savedUser.get('updatedAt')).toBeDefined();
    });

    test('should validate AmexingUser beforeSave hook validation', async () => {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const invalidUser = new AmexingUser();

      // Missing required fields - should trigger validation error
      invalidUser.set('username', 'incomplete');

      await expect(testHelpers.saveWithRetry(invalidUser))
        .rejects
        .toThrow(/required/);
    });

    test('should validate AmexingUser beforeSave email validation', async () => {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const userWithInvalidEmail = new AmexingUser();

      userWithInvalidEmail.set('username', 'emailtest');
      userWithInvalidEmail.set('email', 'invalid-email'); // Invalid email format
      userWithInvalidEmail.set('firstName', 'Email');
      userWithInvalidEmail.set('lastName', 'Test');
      userWithInvalidEmail.set('role', 'user');

      await expect(testHelpers.saveWithRetry(userWithInvalidEmail))
        .rejects
        .toThrow(/Invalid email format/);
    });

    test('should validate AmexingUser beforeSave username validation', async () => {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const userWithInvalidUsername = new AmexingUser();

      userWithInvalidUsername.set('username', 'ab'); // Too short
      userWithInvalidUsername.set('email', 'valid@example.com');
      userWithInvalidUsername.set('firstName', 'Username');
      userWithInvalidUsername.set('lastName', 'Test');
      userWithInvalidUsername.set('role', 'user');

      await expect(testHelpers.saveWithRetry(userWithInvalidUsername))
        .rejects
        .toThrow(/Username must be 3-20 characters/);
    });

    test('should validate AmexingUser beforeSave role validation', async () => {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const userWithInvalidRole = new AmexingUser();

      userWithInvalidRole.set('username', 'roletest');
      userWithInvalidRole.set('email', 'roletest@example.com');
      userWithInvalidRole.set('firstName', 'Role');
      userWithInvalidRole.set('lastName', 'Test');
      userWithInvalidRole.set('role', 'invalidrole'); // Invalid role

      await expect(testHelpers.saveWithRetry(userWithInvalidRole))
        .rejects
        .toThrow(/Invalid role/);
    });

    test('should validate AmexingUser afterSave hook execution', async () => {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const testUser = new AmexingUser();

      testUser.set('username', 'aftersavetest');
      testUser.set('email', 'aftersave@example.com');
      testUser.set('firstName', 'After');
      testUser.set('lastName', 'Save');
      testUser.set('role', 'user');

      const savedUser = await testHelpers.saveWithRetry(testUser);
      testObjects.push(savedUser);

      // AfterSave hook should have executed
      // We can't directly test the hook's internal logging, but we can verify the user was saved
      expect(savedUser.id).toBeDefined();
      expect(savedUser.get('createdAt')).toBeDefined();
    });

    test('should validate AmexingUser beforeDelete hook protection', async () => {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const testUser = new AmexingUser();

      testUser.set('username', 'deletetest');
      testUser.set('email', 'deletetest@example.com');
      testUser.set('firstName', 'Delete');
      testUser.set('lastName', 'Test');
      testUser.set('role', 'user');

      const savedUser = await testHelpers.saveWithRetry(testUser);

      // Should not be able to delete without master key
      await expect(savedUser.destroy())
        .rejects
        .toThrow(/can only be deleted with master key/);

      // Should be able to delete with master key
      await savedUser.destroy({ useMasterKey: true });
    });

    test('should validate AmexingUser update triggers beforeSave hook', async () => {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const testUser = new AmexingUser();

      testUser.set('username', 'updatetest');
      testUser.set('email', 'updatetest@example.com');
      testUser.set('firstName', 'Update');
      testUser.set('lastName', 'Test');
      testUser.set('role', 'user');

      const savedUser = await testHelpers.saveWithRetry(testUser);
      testObjects.push(savedUser);

      const originalUpdatedAt = savedUser.get('updatedAt');

      // Wait a moment to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 100));

      // Update user
      savedUser.set('firstName', 'Updated');
      const updatedUser = await testHelpers.saveWithRetry(savedUser);

      // updatedAt should be updated by hook
      expect(updatedUser.get('updatedAt').getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });

  describe('Legacy Parse.User Hooks Testing', () => {
    test('should validate Parse.User beforeSave hook execution', async () => {
      const testUser = new Parse.User();

      testUser.set('username', 'legacytest');
      testUser.set('email', 'legacy@example.com');
      testUser.set('password', 'password123');

      const savedUser = await testHelpers.saveWithRetry(testUser);
      testObjects.push(savedUser);

      // Verify basic validation executed
      expect(savedUser.get('username')).toBe('legacytest');
      expect(savedUser.get('email')).toBe('legacy@example.com');
    });

    test('should validate Parse.User beforeSave validation', async () => {
      const invalidUser = new Parse.User();

      // Missing username - should trigger validation error
      invalidUser.set('email', 'test@example.com');
      invalidUser.set('password', 'password123');

      await expect(testHelpers.saveWithRetry(invalidUser))
        .rejects
        .toThrow(/Username is required/);
    });

    test('should validate Parse.User beforeSave email validation', async () => {
      const userWithInvalidEmail = new Parse.User();

      userWithInvalidEmail.set('username', 'emailvalidation');
      userWithInvalidEmail.set('email', 'invalid-email-format');
      userWithInvalidEmail.set('password', 'password123');

      await expect(testHelpers.saveWithRetry(userWithInvalidEmail))
        .rejects
        .toThrow(/Invalid email format/);
    });

    test('should validate Parse.User afterSave hook execution', async () => {
      const testUser = new Parse.User();

      testUser.set('username', 'legacyaftersave');
      testUser.set('email', 'legacyafter@example.com');
      testUser.set('password', 'password123');

      const savedUser = await testHelpers.saveWithRetry(testUser);
      testObjects.push(savedUser);

      // AfterSave hook should have executed (logged new user creation)
      expect(savedUser.id).toBeDefined();
      expect(savedUser.get('createdAt')).toBeDefined();
    });

    test('should validate Parse.User beforeDelete hook protection', async () => {
      const testUser = new Parse.User();

      testUser.set('username', 'legacydelete');
      testUser.set('email', 'legacydelete@example.com');
      testUser.set('password', 'password123');

      const savedUser = await testHelpers.saveWithRetry(testUser);

      // Should not be able to delete without master key
      await expect(savedUser.destroy())
        .rejects
        .toThrow(/can only be deleted with master key/);

      // Should be able to delete with master key
      await savedUser.destroy({ useMasterKey: true });
    });
  });

  describe('Session and Login Hooks Testing', () => {
    test('should validate afterLogin hook execution', async () => {
      // Create a test user first
      const testUser = new Parse.User();
      testUser.set('username', 'loginhookusr');
      testUser.set('email', 'loginhook@example.com');
      testUser.set('password', 'testpassword123');

      const savedUser = await testHelpers.saveWithRetry(testUser);
      testObjects.push(savedUser);

      // Test login triggers afterLogin hook
      const loggedInUser = await Parse.User.logIn('loginhookusr', 'testpassword123');

      expect(loggedInUser).toBeDefined();
      expect(loggedInUser.get('username')).toBe('loginhookusr');

      // The hook should have updated lastLoginAt
      await loggedInUser.fetch();
      expect(loggedInUser.get('lastLoginAt')).toBeDefined();
      expect(loggedInUser.get('lastLoginAt')).toBeInstanceOf(Date);

      // Clean up session
      await Parse.User.logOut();
    });

    test('should validate afterLogout hook execution', async () => {
      // Create and login a test user
      const testUser = new Parse.User();
      testUser.set('username', 'logouthookusr');
      testUser.set('email', 'logouthook@example.com');
      testUser.set('password', 'testpassword123');

      const savedUser = await testHelpers.saveWithRetry(testUser);
      testObjects.push(savedUser);

      await Parse.User.logIn('logouthookusr', 'testpassword123');

      // Test logout triggers afterLogout hook
      await Parse.User.logOut();

      // Hook should have executed (logged the logout event)
      // We can't directly test the logging, but logout should succeed
      expect(Parse.User.current()).toBeNull();
    });
  });

  describe('Hook Error Handling and Edge Cases', () => {
    test('should handle hook execution with master key bypass', async () => {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const testUser = new AmexingUser();

      // Set data that would normally trigger validation
      testUser.set('username', 'masterkey');
      testUser.set('email', 'master@example.com');
      testUser.set('firstName', 'Master');
      testUser.set('lastName', 'Key');
      testUser.set('role', 'user');

      // Save with master key - should bypass some validations
      const savedUser = await testUser.save(null, { useMasterKey: true });
      testObjects.push(savedUser);

      expect(savedUser.id).toBeDefined();
      expect(savedUser.get('username')).toBe('masterkey');
    });

    test('should handle hook execution during batch operations', async () => {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const batchUsers = [];

      for (let i = 0; i < 5; i++) {
        const user = new AmexingUser();
        user.set('username', `batchuser${i}`);
        user.set('email', `batch${i}@example.com`);
        user.set('firstName', 'Batch');
        user.set('lastName', `User${i}`);
        user.set('role', 'user');
        batchUsers.push(user);
      }

      // Save all users in batch - hooks should execute for each
      const savedUsers = await Parse.Object.saveAll(batchUsers, { useMasterKey: true });
      testObjects.push(...savedUsers);

      expect(savedUsers.length).toBe(5);
      savedUsers.forEach((user, index) => {
        expect(user.get('username')).toBe(`batchuser${index}`);
        expect(user.get('createdAt')).toBeDefined();
        expect(user.get('updatedAt')).toBeDefined();
      });
    });

    test('should handle hook validation errors gracefully', async () => {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const invalidUsers = [];

      // Create multiple invalid users
      for (let i = 0; i < 3; i++) {
        const user = new AmexingUser();
        user.set('username', `invalid${i}`);
        user.set('email', 'invalid-email'); // Invalid email
        user.set('firstName', 'Invalid');
        user.set('lastName', `User${i}`);
        user.set('role', 'user');
        invalidUsers.push(user);
      }

      // Batch save should fail due to validation hooks
      await expect(Parse.Object.saveAll(invalidUsers))
        .rejects
        .toThrow(/Invalid email format/);
    });

    test('should measure hook performance impact', async () => {
      const AmexingUser = Parse.Object.extend('AmexingUser');

      const performanceStats = await testHelpers.measurePerformance(
        async () => {
          const user = new AmexingUser();
          user.set('username', `perfuser${Date.now()}`);
          user.set('email', `perf${Date.now()}@example.com`);
          user.set('firstName', 'Performance');
          user.set('lastName', 'Test');
          user.set('role', 'user');

          const savedUser = await user.save();
          testObjects.push(savedUser);
          return savedUser;
        },
        10 // 10 iterations
      );

      expect(performanceStats.successfulOperations).toBe(10);
      expect(performanceStats.failedOperations).toBe(0);
      // Hook execution should not significantly impact performance
      expect(performanceStats.averageDuration).toBeLessThan(5000); // 5 seconds max
    });
  });

  describe('Hook Execution Order and Dependencies', () => {
    test('should validate beforeSave hook executes before save', async () => {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const testUser = new AmexingUser();

      // Set uppercase values that should be normalized by hook
      testUser.set('username', 'HOOKORDER');
      testUser.set('email', 'HOOKORDER@EXAMPLE.COM');
      testUser.set('firstName', 'Hook');
      testUser.set('lastName', 'Order');
      testUser.set('role', 'user');

      const savedUser = await testHelpers.saveWithRetry(testUser);
      testObjects.push(savedUser);

      // Hook should have normalized to lowercase
      expect(savedUser.get('username')).toBe('hookorder');
      expect(savedUser.get('email')).toBe('hookorder@example.com');
    });

    test('should validate hook execution with object relationships', async () => {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const testUser = new AmexingUser();

      testUser.set('username', 'reluser');
      testUser.set('email', 'rel@example.com');
      testUser.set('firstName', 'Relation');
      testUser.set('lastName', 'User');
      testUser.set('role', 'user');
      testUser.set('oauthAccounts', [
        {
          provider: 'google',
          providerId: 'google123',
          email: 'rel@google.com'
        }
      ]);

      const savedUser = await testHelpers.saveWithRetry(testUser);
      testObjects.push(savedUser);

      // Hook should have validated OAuth account structure
      expect(savedUser.get('oauthAccounts')).toBeDefined();
      expect(savedUser.get('oauthAccounts')[0].provider).toBe('google');
      expect(savedUser.get('oauthAccounts')[0].providerId).toBe('google123');
    });

    test('should validate hook behavior with invalid OAuth account data', async () => {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const testUser = new AmexingUser();

      testUser.set('username', 'invalidoauth');
      testUser.set('email', 'invalidoauth@example.com');
      testUser.set('firstName', 'Invalid');
      testUser.set('lastName', 'OAuth');
      testUser.set('role', 'user');
      testUser.set('oauthAccounts', [
        {
          provider: 'google'
          // Missing providerId - should trigger validation error
        }
      ]);

      await expect(testHelpers.saveWithRetry(testUser))
        .rejects
        .toThrow(/OAuth accounts must have provider and providerId/);
    });
  });
});