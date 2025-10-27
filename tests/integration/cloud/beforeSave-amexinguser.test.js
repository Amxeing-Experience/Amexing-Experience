/**
 * Integration Tests: beforeSave Hook for AmexingUser Email Uniqueness
 *
 * Tests database-level email uniqueness enforcement via Parse Cloud Function hook.
 * Ensures emails are unique across all entry points (API, Parse SDK, Dashboard).
 *
 * Test Coverage:
 * - Duplicate email prevention on create
 * - Duplicate email prevention on update
 * - Case-insensitive email matching
 * - Allow user to keep own email on update
 * - Prevent reuse of soft-deleted user emails
 * - Allow valid new/updated emails
 *
 * @author Amexing Development Team
 * @version 1.0.0
 */

const Parse = require('parse/node');
const TestCleanupHelper = require('../../helpers/testCleanupHelper');

describe('AmexingUser beforeSave Hook - Email Uniqueness', () => {
  let testUsers = [];

  beforeAll(async () => {
    // Initialize Parse SDK with master key
    Parse.initialize('test-app-id', null, 'test-master-key');
    Parse.serverURL = 'http://localhost:1339/parse';
    Parse.masterKey = 'test-master-key';

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 1000));
  }, 30000);

  afterEach(async () => {
    // Cleanup test users created during tests
    try {
      for (const user of testUsers) {
        if (user && user.id) {
          await user.destroy({ useMasterKey: true });
        }
      }
      testUsers = [];

      // Also cleanup any non-seeded users
      await TestCleanupHelper.cleanupNonSeededUsers();
    } catch (error) {
      console.error('Cleanup error:', error.message);
    }
  });

  describe('Duplicate Email Prevention on Create', () => {
    it('should reject creating user with duplicate email', async () => {
      // Create first user
      const AmexingUser = Parse.Object.extend('_User');
      const user1 = new AmexingUser();
      user1.set('username', 'testuser1@example.com');
      user1.set('email', 'testuser1@example.com');
      user1.set('password', 'TestPass123!');
      user1.set('firstName', 'Test');
      user1.set('lastName', 'User1');
      user1.set('active', true);
      user1.set('exists', true);
      user1.set('role', 'employee');

      await user1.save(null, { useMasterKey: true });
      testUsers.push(user1);

      // Attempt to create second user with same email
      const user2 = new AmexingUser();
      user2.set('username', 'testuser2@example.com');
      user2.set('email', 'testuser1@example.com'); // Same email as user1
      user2.set('password', 'TestPass123!');
      user2.set('firstName', 'Test');
      user2.set('lastName', 'User2');
      user2.set('active', true);
      user2.set('exists', true);
      user2.set('role', 'employee');

      // Expect error (Parse Server or our custom hook will prevent this)
      await expect(user2.save(null, { useMasterKey: true })).rejects.toThrow();
    });

    it('should reject duplicate email with case-insensitive matching', async () => {
      // Create first user with mixed case email
      const AmexingUser = Parse.Object.extend('_User');
      const user1 = new AmexingUser();
      user1.set('username', 'testuser3@example.com');
      user1.set('email', 'TestUser@Example.COM');
      user1.set('password', 'TestPass123!');
      user1.set('firstName', 'Test');
      user1.set('lastName', 'User3');
      user1.set('active', true);
      user1.set('exists', true);
      user1.set('role', 'employee');

      await user1.save(null, { useMasterKey: true });
      testUsers.push(user1);

      // Attempt to create with lowercase version of same email
      const user2 = new AmexingUser();
      user2.set('username', 'testuser4@example.com');
      user2.set('email', 'testuser@example.com'); // Lowercase version
      user2.set('password', 'TestPass123!');
      user2.set('firstName', 'Test');
      user2.set('lastName', 'User4');
      user2.set('active', true);
      user2.set('exists', true);
      user2.set('role', 'employee');

      // Expect error (case-insensitive match) - our custom message or Parse Server default
      await expect(user2.save(null, { useMasterKey: true })).rejects.toThrow();
    });

    it('should allow creating user with unique email', async () => {
      // Create user with unique email
      const AmexingUser = Parse.Object.extend('_User');
      const user = new AmexingUser();
      user.set('username', 'uniqueuser@example.com');
      user.set('email', 'uniqueuser@example.com');
      user.set('password', 'TestPass123!');
      user.set('firstName', 'Unique');
      user.set('lastName', 'User');
      user.set('active', true);
      user.set('exists', true);
      user.set('role', 'employee');

      // Should succeed
      await expect(user.save(null, { useMasterKey: true })).resolves.toBeDefined();
      testUsers.push(user);

      expect(user.id).toBeDefined();
      expect(user.get('email')).toBe('uniqueuser@example.com');
    });
  });

  describe('Duplicate Email Prevention on Update', () => {
    it('should reject updating user email to existing email', async () => {
      // Create two users with different emails
      const AmexingUser = Parse.Object.extend('_User');

      const user1 = new AmexingUser();
      user1.set('username', 'updatetest1@example.com');
      user1.set('email', 'updatetest1@example.com');
      user1.set('password', 'TestPass123!');
      user1.set('firstName', 'Update');
      user1.set('lastName', 'Test1');
      user1.set('active', true);
      user1.set('exists', true);
      user1.set('role', 'employee');
      await user1.save(null, { useMasterKey: true });
      testUsers.push(user1);

      const user2 = new AmexingUser();
      user2.set('username', 'updatetest2@example.com');
      user2.set('email', 'updatetest2@example.com');
      user2.set('password', 'TestPass123!');
      user2.set('firstName', 'Update');
      user2.set('lastName', 'Test2');
      user2.set('active', true);
      user2.set('exists', true);
      user2.set('role', 'employee');
      await user2.save(null, { useMasterKey: true });
      testUsers.push(user2);

      // Attempt to update user2's email to user1's email
      user2.set('email', 'updatetest1@example.com');

      // Expect error (Parse Server or our custom hook will prevent this)
      await expect(user2.save(null, { useMasterKey: true })).rejects.toThrow();
    });

    it('should allow user to update without changing email', async () => {
      // Create user
      const AmexingUser = Parse.Object.extend('_User');
      const user = new AmexingUser();
      user.set('username', 'updateown@example.com');
      user.set('email', 'updateown@example.com');
      user.set('password', 'TestPass123!');
      user.set('firstName', 'Update');
      user.set('lastName', 'Own');
      user.set('active', true);
      user.set('exists', true);
      user.set('role', 'employee');
      await user.save(null, { useMasterKey: true });
      testUsers.push(user);

      // Update other field but keep same email
      user.set('firstName', 'Updated');
      // email remains 'updateown@example.com'

      // Should succeed (user keeping own email)
      await expect(user.save(null, { useMasterKey: true })).resolves.toBeDefined();
      expect(user.get('firstName')).toBe('Updated');
    });

    it('should allow user to update to new unique email', async () => {
      // Create user
      const AmexingUser = Parse.Object.extend('_User');
      const user = new AmexingUser();
      user.set('username', 'changeemail@example.com');
      user.set('email', 'changeemail@example.com');
      user.set('password', 'TestPass123!');
      user.set('firstName', 'Change');
      user.set('lastName', 'Email');
      user.set('active', true);
      user.set('exists', true);
      user.set('role', 'employee');
      await user.save(null, { useMasterKey: true });
      testUsers.push(user);

      // Update to new unique email
      user.set('email', 'newemail@example.com');
      user.set('username', 'newemail@example.com');

      // Should succeed
      await expect(user.save(null, { useMasterKey: true })).resolves.toBeDefined();
      expect(user.get('email')).toBe('newemail@example.com');
    });
  });

  describe('Soft-Deleted Users', () => {
    it('should reject email from soft-deleted user (exists: false)', async () => {
      // Create user and soft-delete them
      const AmexingUser = Parse.Object.extend('_User');
      const user1 = new AmexingUser();
      user1.set('username', 'softdeleted@example.com');
      user1.set('email', 'softdeleted@example.com');
      user1.set('password', 'TestPass123!');
      user1.set('firstName', 'Soft');
      user1.set('lastName', 'Deleted');
      user1.set('active', false);
      user1.set('exists', false); // Soft-deleted
      user1.set('role', 'employee');
      await user1.save(null, { useMasterKey: true });
      testUsers.push(user1);

      // Attempt to create new user with same email
      const user2 = new AmexingUser();
      user2.set('username', 'newuser@example.com');
      user2.set('email', 'softdeleted@example.com'); // Email from soft-deleted user
      user2.set('password', 'TestPass123!');
      user2.set('firstName', 'New');
      user2.set('lastName', 'User');
      user2.set('active', true);
      user2.set('exists', true);
      user2.set('role', 'employee');

      // Expect error (email still reserved even if user is soft-deleted)
      await expect(user2.save(null, { useMasterKey: true })).rejects.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle email with whitespace trimming', async () => {
      // Create user with email
      const AmexingUser = Parse.Object.extend('_User');
      const user1 = new AmexingUser();
      user1.set('username', 'whitespace@example.com');
      user1.set('email', 'whitespace@example.com');
      user1.set('password', 'TestPass123!');
      user1.set('firstName', 'White');
      user1.set('lastName', 'Space');
      user1.set('active', true);
      user1.set('exists', true);
      user1.set('role', 'employee');
      await user1.save(null, { useMasterKey: true });
      testUsers.push(user1);

      // Attempt to create with whitespace-padded version
      const user2 = new AmexingUser();
      user2.set('username', 'whitespace2@example.com');
      user2.set('email', '  whitespace@example.com  '); // With whitespace
      user2.set('password', 'TestPass123!');
      user2.set('firstName', 'White2');
      user2.set('lastName', 'Space2');
      user2.set('active', true);
      user2.set('exists', true);
      user2.set('role', 'employee');

      // Expect error (trimmed version matches)
      await expect(user2.save(null, { useMasterKey: true })).rejects.toThrow();
    });

    it('should allow empty email if validation permits (test hook resilience)', async () => {
      // Some systems may allow users without email
      // Hook should handle gracefully without throwing error
      const AmexingUser = Parse.Object.extend('_User');
      const user = new AmexingUser();
      user.set('username', 'noemail_user');
      user.set('password', 'TestPass123!');
      user.set('firstName', 'No');
      user.set('lastName', 'Email');
      user.set('active', true);
      user.set('exists', true);
      user.set('role', 'employee');
      // email not set

      // Should not throw duplicate error (no email to check)
      await expect(user.save(null, { useMasterKey: true })).resolves.toBeDefined();
      testUsers.push(user);
    });
  });
});
