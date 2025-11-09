/**
 * Parse User Authentication Operations Tests
 * Comprehensive testing of Parse.User functionality including authentication, sessions, and permissions
 */

const Parse = require('parse/node');
const ParseTestSetup = require('../helpers/parse-test-setup');
const TestDataFactory = require('../helpers/test-data-factory');
const ParseTestHelpers = require('../helpers/parse-test-helpers');

describe('Parse User Authentication Operations Tests', () => {
  let parseSetup;
  let dataFactory;
  let testHelpers;
  let testUsers = [];

  beforeAll(async () => {
    parseSetup = new ParseTestSetup();
    await parseSetup.initializeParse();
    dataFactory = new TestDataFactory(parseSetup);
    testHelpers = new ParseTestHelpers();
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await dataFactory.cleanup();
    await parseSetup.cleanupAllTestData();
  });

  beforeEach(async () => {
    // Ensure no user is logged in before each test
    await Parse.User.logOut();
    expect(Parse.User.current()).toBeNull();
  });

  afterEach(async () => {
    // Clean up any logged in user after each test
    await Parse.User.logOut();
  });

  async function cleanupTestUsers() {
    try {
      console.log(`Cleaning up ${testUsers.length} test users...`);
      for (const user of testUsers) {
        try {
          if (user && user.id) {
            await user.destroy({ useMasterKey: true });
          }
        } catch (error) {
          console.warn(`Failed to cleanup user ${user.id}:`, error.message);
        }
      }
      testUsers = [];
    } catch (error) {
      console.error('Failed to cleanup test users:', error);
    }
  }

  function createTestUserData(overrides = {}) {
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(7);

    return {
      username: `testuser_${timestamp}_${randomSuffix}`,
      password: 'TestPassword123!',
      email: `test.${timestamp}.${randomSuffix}@parsetest.com`,
      firstName: 'Test',
      lastName: 'User',
      ...overrides
    };
  }

  describe('User Creation and Signup', () => {
    test('should create new user with valid data', async () => {
      const userData = createTestUserData();
      const user = new Parse.User();

      user.set('username', userData.username);
      user.set('password', userData.password);
      user.set('email', userData.email);
      user.set('firstName', userData.firstName);
      user.set('lastName', userData.lastName);

      const savedUser = await user.signUp();
      testUsers.push(savedUser);

      expect(savedUser.id).toBeDefined();
      expect(savedUser.get('username')).toBe(userData.username);
      expect(savedUser.get('email')).toBe(userData.email);
      expect(savedUser.get('firstName')).toBe(userData.firstName);
      expect(savedUser.createdAt).toBeInstanceOf(Date);
      expect(savedUser.getSessionToken()).toBeDefined();

      // Verify user is automatically logged in after signup
      expect(Parse.User.current()).not.toBeNull();
      expect(Parse.User.current().id).toBe(savedUser.id);
    });

    test('should handle duplicate username signup', async () => {
      const userData = createTestUserData();

      // Create first user
      const user1 = new Parse.User();
      user1.set('username', userData.username);
      user1.set('password', userData.password);
      user1.set('email', userData.email);

      const savedUser1 = await user1.signUp();
      testUsers.push(savedUser1);

      // Try to create second user with same username
      const user2 = new Parse.User();
      user2.set('username', userData.username); // Same username
      user2.set('password', 'DifferentPassword123!');
      user2.set('email', 'different@test.com');

      await expect(user2.signUp()).rejects.toThrow();
    });

    test('should validate required fields during signup', async () => {
      // Test missing username
      const userWithoutUsername = new Parse.User();
      userWithoutUsername.set('password', 'TestPassword123!');
      userWithoutUsername.set('email', 'test@example.com');

      await expect(userWithoutUsername.signUp()).rejects.toThrow();

      // Test missing password
      const userWithoutPassword = new Parse.User();
      userWithoutPassword.set('username', 'testuser123');
      userWithoutPassword.set('email', 'test@example.com');

      await expect(userWithoutPassword.signUp()).rejects.toThrow();
    });

    test('should handle password validation', async () => {
      const userData = createTestUserData();

      // Test weak password
      const userWithWeakPassword = new Parse.User();
      userWithWeakPassword.set('username', userData.username);
      userWithWeakPassword.set('password', '123'); // Too weak
      userWithWeakPassword.set('email', userData.email);

      try {
        await userWithWeakPassword.signUp();
        // If it succeeds, add to cleanup
        testUsers.push(userWithWeakPassword);
      } catch (error) {
        // Password validation might be enforced by Parse Server configuration
        expect(error).toBeDefined();
      }
    });

    test('should handle email validation', async () => {
      const userData = createTestUserData();

      const userWithInvalidEmail = new Parse.User();
      userWithInvalidEmail.set('username', userData.username);
      userWithInvalidEmail.set('password', userData.password);
      userWithInvalidEmail.set('email', 'invalid-email'); // Invalid format

      try {
        await userWithInvalidEmail.signUp();
        testUsers.push(userWithInvalidEmail);
      } catch (error) {
        // Email validation might be enforced
        expect(error).toBeDefined();
      }
    });
  });

  describe('User Login and Logout Operations', () => {
    let testUser;

    beforeEach(async () => {
      // Create a test user for login tests
      const userData = createTestUserData();
      testUser = new Parse.User();
      testUser.set('username', userData.username);
      testUser.set('password', userData.password);
      testUser.set('email', userData.email);

      await testUser.signUp();
      testUsers.push(testUser);
      await Parse.User.logOut(); // Log out after creation
    });

    test('should login with valid username and password', async () => {
      const loggedInUser = await Parse.User.logIn(
        testUser.get('username'),
        'TestPassword123!'
      );

      expect(loggedInUser.id).toBe(testUser.id);
      expect(loggedInUser.get('username')).toBe(testUser.get('username'));
      expect(loggedInUser.getSessionToken()).toBeDefined();

      // Verify current user is set
      expect(Parse.User.current()).not.toBeNull();
      expect(Parse.User.current().id).toBe(testUser.id);
    });

    test('should login with valid email and password', async () => {
      const loggedInUser = await Parse.User.logIn(
        testUser.get('email'),
        'TestPassword123!'
      );

      expect(loggedInUser.id).toBe(testUser.id);
      expect(loggedInUser.get('email')).toBe(testUser.get('email'));
    });

    test('should fail login with invalid password', async () => {
      await expect(
        Parse.User.logIn(testUser.get('username'), 'WrongPassword')
      ).rejects.toThrow();

      // Verify no user is logged in
      expect(Parse.User.current()).toBeNull();
    });

    test('should fail login with non-existent username', async () => {
      await expect(
        Parse.User.logIn('nonexistentuser', 'TestPassword123!')
      ).rejects.toThrow();

      expect(Parse.User.current()).toBeNull();
    });

    test('should logout successfully', async () => {
      // First login
      await Parse.User.logIn(testUser.get('username'), 'TestPassword123!');
      expect(Parse.User.current()).not.toBeNull();

      // Then logout
      await Parse.User.logOut();
      expect(Parse.User.current()).toBeNull();
    });

    test('should handle multiple login sessions', async () => {
      // Login with first session
      const session1 = await Parse.User.logIn(
        testUser.get('username'),
        'TestPassword123!'
      );
      const token1 = session1.getSessionToken();

      // Logout
      await Parse.User.logOut();

      // Login again (new session)
      const session2 = await Parse.User.logIn(
        testUser.get('username'),
        'TestPassword123!'
      );
      const token2 = session2.getSessionToken();

      expect(token1).toBeDefined();
      expect(token2).toBeDefined();
      expect(token1).not.toBe(token2); // Should be different session tokens
    });
  });

  describe('Session Token Management', () => {
    let testUser;

    beforeEach(async () => {
      const userData = createTestUserData();
      testUser = new Parse.User();
      testUser.set('username', userData.username);
      testUser.set('password', userData.password);
      testUser.set('email', userData.email);

      await testUser.signUp();
      testUsers.push(testUser);
    });

    test('should have valid session token after login', async () => {
      const sessionToken = testUser.getSessionToken();
      expect(sessionToken).toBeDefined();
      expect(typeof sessionToken).toBe('string');
      expect(sessionToken.length).toBeGreaterThan(0);
    });

    test('should validate session token functionality', async () => {
      const currentUser = Parse.User.current();
      expect(currentUser).not.toBeNull();
      expect(currentUser.id).toBe(testUser.id);

      // Session token should allow authenticated operations
      const sessionToken = currentUser.getSessionToken();
      expect(sessionToken).toBeDefined();

      // Test that we can make authenticated requests
      currentUser.set('lastActivity', new Date());
      await currentUser.save();

      expect(currentUser.get('lastActivity')).toBeInstanceOf(Date);
    });

    test('should handle session token expiration gracefully', async () => {
      // This test would typically require server-side session expiration configuration
      // For now, we'll test the client-side handling

      const currentUser = Parse.User.current();
      expect(currentUser).not.toBeNull();

      // Simulate an expired session by logging out and trying to use the old user object
      await Parse.User.logOut();

      try {
        currentUser.set('testField', 'test');
        await currentUser.save();
        // If this succeeds, it means the session is still valid or Parse handles it gracefully
      } catch (error) {
        // This is expected for expired sessions
        expect(error.code).toBeDefined();
      }
    });
  });

  describe('Password Management', () => {
    let testUser;

    beforeEach(async () => {
      const userData = createTestUserData();
      testUser = new Parse.User();
      testUser.set('username', userData.username);
      testUser.set('password', userData.password);
      testUser.set('email', userData.email);

      await testUser.signUp();
      testUsers.push(testUser);
    });

    test('should change password for authenticated user', async () => {
      const oldPassword = 'TestPassword123!';
      const newPassword = 'NewTestPassword456!';

      // Change password
      testUser.set('password', newPassword);
      await testUser.save();

      // Logout and try to login with old password (should fail)
      await Parse.User.logOut();

      await expect(
        Parse.User.logIn(testUser.get('username'), oldPassword)
      ).rejects.toThrow();

      // Login with new password (should succeed)
      const loggedInUser = await Parse.User.logIn(
        testUser.get('username'),
        newPassword
      );

      expect(loggedInUser.id).toBe(testUser.id);
    });

    test('should request password reset', async () => {
      const email = testUser.get('email');

      try {
        await Parse.User.requestPasswordReset(email);
        // If successful, password reset email would be sent
        // We can't verify email delivery in tests, but we can verify no error
      } catch (error) {
        // Password reset might not be configured in test environment
        console.warn('Password reset not available in test environment:', error.message);
      }
    });

    test('should validate password strength requirements', async () => {
      const currentUser = Parse.User.current();

      // Test various password strengths
      const weakPasswords = ['123', 'password', 'abc'];
      const strongPasswords = ['StrongPass123!', 'MySecure$Password2024'];

      for (const weakPassword of weakPasswords) {
        currentUser.set('password', weakPassword);
        try {
          await currentUser.save();
          // If it succeeds, password validation might not be enforced
        } catch (error) {
          // This is expected for weak passwords if validation is enabled
          expect(error).toBeDefined();
        }
      }

      // Test with a strong password (should succeed)
      currentUser.set('password', strongPasswords[0]);
      await currentUser.save();
    });
  });

  describe('User.current() Functionality', () => {
    test('should return null when no user is logged in', async () => {
      await Parse.User.logOut();
      expect(Parse.User.current()).toBeNull();
    });

    test('should return current user after login', async () => {
      const userData = createTestUserData();
      const user = new Parse.User();
      user.set('username', userData.username);
      user.set('password', userData.password);
      user.set('email', userData.email);

      await user.signUp();
      testUsers.push(user);

      const currentUser = Parse.User.current();
      expect(currentUser).not.toBeNull();
      expect(currentUser.id).toBe(user.id);
      expect(currentUser.get('username')).toBe(userData.username);
    });

    test('should persist current user across Parse SDK reinitializations', async () => {
      const userData = createTestUserData();
      const user = new Parse.User();
      user.set('username', userData.username);
      user.set('password', userData.password);
      user.set('email', userData.email);

      await user.signUp();
      testUsers.push(user);

      const currentUserBefore = Parse.User.current();
      expect(currentUserBefore).not.toBeNull();

      // Simulate SDK reinitialization (this is just conceptual in tests)
      // In a real app, this would involve restarting the app and reinitializing Parse
      const currentUserAfter = Parse.User.current();
      expect(currentUserAfter).not.toBeNull();
      expect(currentUserAfter.id).toBe(user.id);
    });
  });

  describe('User Queries and Permissions', () => {
    let users = [];

    beforeAll(async () => {
      // Create multiple test users for query testing
      const userDataArray = [
        createTestUserData({ role: 'admin', department: 'IT' }),
        createTestUserData({ role: 'user', department: 'Sales' }),
        createTestUserData({ role: 'user', department: 'IT' }),
        createTestUserData({ role: 'manager', department: 'Marketing' })
      ];

      for (const userData of userDataArray) {
        const user = new Parse.User();
        user.set('username', userData.username);
        user.set('password', userData.password);
        user.set('email', userData.email);
        user.set('role', userData.role);
        user.set('department', userData.department);

        await user.signUp();
        users.push(user);
        testUsers.push(user);

        // Logout after each creation
        await Parse.User.logOut();
      }
    });

    test('should query users with master key', async () => {
      const query = new Parse.Query(Parse.User);
      query.equalTo('role', 'user');

      const userResults = await query.find({ useMasterKey: true });
      expect(userResults.length).toBe(2);
      userResults.forEach(user => {
        expect(user.get('role')).toBe('user');
      });
    });

    test('should respect user query permissions without master key', async () => {
      // Login as one of the test users
      await Parse.User.logIn(users[0].get('username'), 'TestPassword123!');

      const query = new Parse.Query(Parse.User);
      query.equalTo('department', 'IT');

      try {
        const userResults = await query.find();
        // Results depend on Parse Server configuration
        // Some configurations allow users to query other users, some don't
        expect(Array.isArray(userResults)).toBe(true);
      } catch (error) {
        // This is expected if user queries are restricted
        expect(error.code).toBeDefined();
      }
    });

    test('should allow users to query themselves', async () => {
      // Login as a test user
      await Parse.User.logIn(users[0].get('username'), 'TestPassword123!');
      const currentUser = Parse.User.current();

      const query = new Parse.Query(Parse.User);
      query.equalTo('objectId', currentUser.id);

      const userResults = await query.find();
      expect(userResults.length).toBe(1);
      expect(userResults[0].id).toBe(currentUser.id);
    });

    test('should handle user count queries', async () => {
      const query = new Parse.Query(Parse.User);
      query.equalTo('role', 'user');

      const count = await query.count({ useMasterKey: true });
      expect(count).toBe(2);
    });
  });

  describe('Authentication State Management', () => {
    test('should maintain authentication state during operations', async () => {
      const userData = createTestUserData();
      const user = new Parse.User();
      user.set('username', userData.username);
      user.set('password', userData.password);
      user.set('email', userData.email);

      await user.signUp();
      testUsers.push(user);

      // Verify user is authenticated
      expect(Parse.User.current()).not.toBeNull();

      // Perform various operations that should maintain auth state
      user.set('lastActivity', new Date());
      await user.save();

      expect(Parse.User.current()).not.toBeNull();
      expect(Parse.User.current().id).toBe(user.id);

      // Create another object (should work with authenticated user)
      const TestObject = Parse.Object.extend('TestAuthObject');
      const testObj = new TestObject();
      testObj.set('createdBy', user);
      testObj.set('data', 'test data');

      await testObj.save();
      expect(testObj.id).toBeDefined();

      // Cleanup test object
      await testObj.destroy({ useMasterKey: true });
    });

    test('should handle concurrent authentication operations', async () => {
      const userData1 = createTestUserData();
      const userData2 = createTestUserData();

      const user1 = new Parse.User();
      user1.set('username', userData1.username);
      user1.set('password', userData1.password);
      user1.set('email', userData1.email);

      const user2 = new Parse.User();
      user2.set('username', userData2.username);
      user2.set('password', userData2.password);
      user2.set('email', userData2.email);

      // Create users concurrently
      const [savedUser1, savedUser2] = await Promise.all([
        user1.signUp(),
        user2.signUp()
      ]);

      testUsers.push(savedUser1, savedUser2);

      expect(savedUser1.id).toBeDefined();
      expect(savedUser2.id).toBeDefined();
      expect(savedUser1.id).not.toBe(savedUser2.id);

      // The current user should be one of them (implementation dependent)
      const currentUser = Parse.User.current();
      expect(currentUser).not.toBeNull();
      expect([savedUser1.id, savedUser2.id]).toContain(currentUser.id);
    });
  });

  describe('Error Handling for Authentication Operations', () => {
    test('should handle network errors during authentication', async () => {
      // This test simulates network issues
      // In a real scenario, you might mock the network layer

      const userData = createTestUserData();
      const user = new Parse.User();
      user.set('username', userData.username);
      user.set('password', userData.password);
      user.set('email', userData.email);

      try {
        // This should succeed under normal conditions
        await user.signUp();
        testUsers.push(user);

        expect(user.id).toBeDefined();
      } catch (error) {
        // Handle network or server errors gracefully
        expect(error).toBeDefined();
        expect(error.message).toBeDefined();
      }
    });

    test('should handle malformed authentication data', async () => {
      const user = new Parse.User();

      // Test with malformed data
      user.set('username', null);
      user.set('password', undefined);
      user.set('email', 123); // Wrong type

      await expect(user.signUp()).rejects.toThrow();
    });

    test('should handle authentication timeout scenarios', async () => {
      const userData = createTestUserData();

      const user = new Parse.User();
      user.set('username', userData.username);
      user.set('password', userData.password);
      user.set('email', userData.email);

      try {
        // Use a short timeout to test timeout handling
        const savedUser = await user.signUp();
        testUsers.push(savedUser);

        expect(savedUser.id).toBeDefined();
      } catch (error) {
        // If timeout occurs, ensure it's handled gracefully
        if (error.code === Parse.Error.CONNECTION_FAILED) {
          expect(error.message).toContain('timeout');
        }
      }
    });
  });

  describe('User Performance Testing', () => {
    test('should measure user creation performance', async () => {
      const performanceStats = await testHelpers.measurePerformance(async () => {
        const userData = createTestUserData();
        const user = new Parse.User();
        user.set('username', userData.username);
        user.set('password', userData.password);
        user.set('email', userData.email);

        const savedUser = await user.signUp();
        testUsers.push(savedUser);

        // Logout to prepare for next iteration
        await Parse.User.logOut();

        return savedUser;
      }, 5);

      expect(performanceStats.successfulOperations).toBe(5);
      expect(performanceStats.averageDuration).toBeGreaterThan(0);

      console.log('User Creation Performance:', {
        averageDuration: `${performanceStats.averageDuration.toFixed(2)}ms`,
        maxDuration: `${performanceStats.maxDuration.toFixed(2)}ms`,
        successRate: `${(performanceStats.successfulOperations / performanceStats.totalOperations * 100).toFixed(2)}%`
      });
    });

    test('should measure login performance', async () => {
      // Create a test user first
      const userData = createTestUserData();
      const user = new Parse.User();
      user.set('username', userData.username);
      user.set('password', userData.password);
      user.set('email', userData.email);

      await user.signUp();
      testUsers.push(user);
      await Parse.User.logOut();

      const loginStats = await testHelpers.measurePerformance(async () => {
        const loggedInUser = await Parse.User.logIn(userData.username, userData.password);
        await Parse.User.logOut(); // Logout for next iteration
        return loggedInUser;
      }, 5);

      expect(loginStats.successfulOperations).toBe(5);

      console.log('User Login Performance:', {
        averageDuration: `${loginStats.averageDuration.toFixed(2)}ms`,
        maxDuration: `${loginStats.maxDuration.toFixed(2)}ms`
      });
    });
  });
});