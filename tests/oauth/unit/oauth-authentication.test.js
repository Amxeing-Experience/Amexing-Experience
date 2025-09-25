/**
 * OAuth Authentication Unit Tests
 * Tests core OAuth authentication functionality
 */

const { setupTests, teardownTests, clearDatabase } = require('../../setup');
const { createTestUser } = require('../../helpers/testUtils');

describe('OAuth Authentication Unit Tests', () => {
  beforeAll(async () => {
    await setupTests();
  });

  afterAll(async () => {
    await teardownTests();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  describe('OAuth Provider Authentication', () => {
    test('should create test user for OAuth testing', async () => {
      // Create test user for OAuth scenarios
      const testUser = await createTestUser({
        username: 'oauthtest',
        email: 'oauth@test.com'
      });

      expect(testUser).toBeDefined();
      expect(testUser.get('email')).toBe('oauth@test.com');
      expect(testUser.get('username')).toBe('oauthtest');
    });

    test('should validate OAuth configuration environment variables', () => {
      // Test that OAuth environment variables are accessible
      const googleClientId = process.env.GOOGLE_CLIENT_ID;
      const microsoftClientId = process.env.MICROSOFT_CLIENT_ID;
      const appleClientId = process.env.APPLE_CLIENT_ID;

      // In test environment, these should be mock values or configured
      expect(typeof googleClientId).toBe('string');
      expect(typeof microsoftClientId).toBe('string');
      expect(typeof appleClientId).toBe('string');
    });
  });
});