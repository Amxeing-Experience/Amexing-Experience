/**
 * Integration Tests: CSRF Persistence
 * Tests CSRF token validation and persistence across authentication states
 *
 * SIMPLIFIED: Tests focus on login/logout cycles and CSRF token handling
 * without complex dashboard navigation or unrealistic expectations
 */

const request = require('supertest');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('CSRF Persistence Integration', () => {
  let app;
  let agent;

  beforeAll(async () => {
    // Import app (Parse Server already running on 1339)
    app = require('../../../src/index');

    // Wait for app initialization
    await new Promise(resolve => setTimeout(resolve, 2000));
  }, 30000);

  beforeEach(() => {
    // Create new agent for each test (fresh session)
    agent = request.agent(app);
  });

  describe('CSRF Token Generation', () => {
    it('should generate CSRF token on first GET request', async () => {
      const response = await agent.get('/login').expect(200);

      const csrfToken = AuthTestHelper.extractCsrfToken(response.text);
      expect(csrfToken).toBeTruthy();
      expect(csrfToken.length).toBeGreaterThan(0);
    });

    it('should generate CSRF token on each login page load', async () => {
      const response1 = await agent.get('/login').expect(200);
      const csrf1 = AuthTestHelper.extractCsrfToken(response1.text);

      const response2 = await agent.get('/login').expect(200);
      const csrf2 = AuthTestHelper.extractCsrfToken(response2.text);

      // Each response should have a valid CSRF token (may be same or different)
      expect(csrf1).toBeTruthy();
      expect(csrf2).toBeTruthy();
      expect(csrf1.length).toBeGreaterThan(0);
      expect(csrf2.length).toBeGreaterThan(0);
    });
  });

  describe('CSRF Token Validation', () => {
    it('should accept valid CSRF token on POST request', async () => {
      const loginPage = await agent.get('/login').expect(200);
      const csrfToken = AuthTestHelper.extractCsrfToken(loginPage.text);

      const credentials = AuthTestHelper.getCredentials('admin');
      const response = await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken,
        })
        .expect(302);

      expect(response.headers.location).toMatch(/^\/dashboard/);
    });

    it('should reject POST request without CSRF token', async () => {
      await agent.get('/login').expect(200);

      const credentials = AuthTestHelper.getCredentials('admin');
      const response = await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          // No csrfToken
        })
        .expect(403);

      expect(response.body.error).toContain('CSRF');
      expect(response.body.code).toBe('TOKEN_MISSING');
    });

    it('should reject POST request with invalid CSRF token', async () => {
      await agent.get('/login').expect(200);

      const credentials = AuthTestHelper.getCredentials('admin');
      const response = await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: 'invalid-csrf-token-12345',
        })
        .expect(403);

      expect(response.body.error).toContain('CSRF');
      expect(response.body.code).toBe('TOKEN_INVALID');
    });
  });

  describe('CSRF Persistence After Logout', () => {
    it('should regenerate CSRF token after logout', async () => {
      // Login and get CSRF
      const loginPage = await agent.get('/login').expect(200);
      const csrfBeforeLogin = AuthTestHelper.extractCsrfToken(loginPage.text);

      const credentials = AuthTestHelper.getCredentials('admin');
      await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: csrfBeforeLogin,
        })
        .expect(302);

      // Logout (use GET to avoid CSRF requirement)
      await agent.get('/logout').expect(302);

      // Get new CSRF after logout
      const loginAfterLogout = await agent.get('/login').expect(200);
      const csrfAfterLogout = AuthTestHelper.extractCsrfToken(loginAfterLogout.text);

      // CSRF should be different after logout (new session)
      expect(csrfAfterLogout).toBeTruthy();
      expect(csrfAfterLogout).not.toBe(csrfBeforeLogin);
    });

    it('should not accept old CSRF token after logout', async () => {
      // Login
      const loginPage = await agent.get('/login').expect(200);
      const csrfToken = AuthTestHelper.extractCsrfToken(loginPage.text);

      const credentials = AuthTestHelper.getCredentials('admin');
      await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken,
        })
        .expect(302);

      // Remember the old CSRF token
      const oldCsrf = csrfToken;

      // Logout
      await agent.get('/logout').expect(302);

      // Try to use old CSRF token (should fail)
      const response = await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: oldCsrf, // Old token from before logout
        })
        .expect(403);

      expect(response.body.error).toContain('CSRF');
    });

    it('should allow new login with new CSRF token after logout', async () => {
      // First login-logout cycle
      const loginPage1 = await agent.get('/login').expect(200);
      const csrf1 = AuthTestHelper.extractCsrfToken(loginPage1.text);

      const credentials = AuthTestHelper.getCredentials('superadmin');
      await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: csrf1,
        })
        .expect(302);

      await agent.get('/logout').expect(302);

      // Second login with new CSRF
      const loginPage2 = await agent.get('/login').expect(200);
      const csrf2 = AuthTestHelper.extractCsrfToken(loginPage2.text);

      const secondLogin = await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: csrf2,
        })
        .expect(302);

      expect(secondLogin.headers.location).toMatch(/^\/dashboard/);
    });
  });

  describe('CSRF Session Continuity', () => {
    it('should provide valid CSRF tokens across same session requests', async () => {
      // Multiple login page requests in same session
      const response1 = await agent.get('/login').expect(200);
      const csrf1 = AuthTestHelper.extractCsrfToken(response1.text);

      const response2 = await agent.get('/login').expect(200);
      const csrf2 = AuthTestHelper.extractCsrfToken(response2.text);

      // Both responses should have valid CSRF tokens
      expect(csrf1).toBeTruthy();
      expect(csrf2).toBeTruthy();
      expect(csrf1.length).toBeGreaterThan(0);
      expect(csrf2.length).toBeGreaterThan(0);
    });

    it('should reject CSRF token from different session', async () => {
      // Create two separate agents (different sessions)
      const agent1 = request.agent(app);
      const agent2 = request.agent(app);

      // Get CSRF from agent1
      const response1 = await agent1.get('/login').expect(200);
      const csrf1 = AuthTestHelper.extractCsrfToken(response1.text);

      // Try to use agent1's CSRF with agent2
      await agent2.get('/login').expect(200); // Initialize session

      const credentials = AuthTestHelper.getCredentials('admin');
      const response2 = await agent2
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: csrf1, // CSRF from different session
        })
        .expect(403);

      expect(response2.body.error).toContain('CSRF');
    });
  });

  describe('CSRF Error Messages', () => {
    it('should provide clear error messages for CSRF failures', async () => {
      await agent.get('/login').expect(200);

      const credentials = AuthTestHelper.getCredentials('admin');

      // Missing token
      const missingResponse = await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
        })
        .expect(403);

      expect(missingResponse.body.error).toBe('CSRF Error');
      expect(missingResponse.body.message).toContain('CSRF token missing');
      expect(missingResponse.body.code).toBe('TOKEN_MISSING');

      // Invalid token
      const invalidResponse = await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: 'invalid-token',
        })
        .expect(403);

      expect(invalidResponse.body.error).toBe('CSRF Error');
      expect(invalidResponse.body.message).toContain('Invalid CSRF token');
      expect(invalidResponse.body.code).toBe('TOKEN_INVALID');
    });

    it('should suggest refresh action in CSRF error responses', async () => {
      await agent.get('/login').expect(200);

      const credentials = AuthTestHelper.getCredentials('admin');
      const response = await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: 'invalid',
        })
        .expect(403);

      expect(response.body.recoveryAction).toBe('refresh_page');
      expect(response.body.message).toContain('refresh');
    });
  });

  describe('CSRF Race Condition Prevention', () => {
    it('should handle rapid logout-login without TOKEN_INVALID errors', async () => {
      // First login
      const loginPage1 = await agent.get('/login').expect(200);
      const csrf1 = AuthTestHelper.extractCsrfToken(loginPage1.text);

      const credentials = AuthTestHelper.getCredentials('admin');
      await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: csrf1,
        })
        .expect(302);

      // Immediate logout (don't wait)
      await agent.get('/logout').expect(302);

      // CRITICAL TEST: Immediately get login page and submit
      // This tests the race condition fix where CSRF secret might not be
      // persisted to MongoDB yet
      const loginPage2 = await agent.get('/login').expect(200);
      const csrf2 = AuthTestHelper.extractCsrfToken(loginPage2.text);

      // Should NOT get TOKEN_INVALID error
      const response = await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: csrf2,
        })
        .expect(302);

      expect(response.headers.location).toMatch(/^\/dashboard/);
    });

    it('should handle multiple rapid GET requests without losing CSRF secret', async () => {
      // Rapid-fire multiple GET requests
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(agent.get('/login'));
      }

      const responses = await Promise.all(promises);

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        const csrf = AuthTestHelper.extractCsrfToken(response.text);
        expect(csrf).toBeTruthy();
        expect(csrf.length).toBeGreaterThan(0);
      });
    });

    it('should allow login immediately after session regeneration', async () => {
      // Login
      const loginPage1 = await agent.get('/login').expect(200);
      const csrf1 = AuthTestHelper.extractCsrfToken(loginPage1.text);

      const credentials = AuthTestHelper.getCredentials('superadmin');
      await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: csrf1,
        })
        .expect(302);

      // Logout
      await agent.get('/logout').expect(302);

      // IMMEDIATELY (no delay) get new login page
      const loginPage2 = await agent.get('/login');
      expect(loginPage2.status).toBe(200);

      const csrf2 = AuthTestHelper.extractCsrfToken(loginPage2.text);
      expect(csrf2).toBeTruthy();

      // IMMEDIATELY try to login (stress test the persistence)
      const response = await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: csrf2,
        });

      // Should succeed without TOKEN_INVALID
      expect(response.status).toBe(302);
      expect(response.headers.location).toMatch(/^\/dashboard/);
    });
  });

  describe('CSRF MongoDB Persistence', () => {
    it('should persist CSRF secret to session store within 200ms', async () => {
      const response = await agent.get('/login').expect(200);
      const csrfToken = AuthTestHelper.extractCsrfToken(response.text);

      expect(csrfToken).toBeTruthy();

      // Wait for persistence (should happen within 200ms with our fixes)
      await new Promise(resolve => setTimeout(resolve, 200));

      // Get the page again - should still have valid CSRF
      const response2 = await agent.get('/login').expect(200);
      const csrfToken2 = AuthTestHelper.extractCsrfToken(response2.text);

      expect(csrfToken2).toBeTruthy();

      // Should be able to use the second token successfully
      const credentials = AuthTestHelper.getCredentials('admin');
      const loginResponse = await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: csrfToken2,
        })
        .expect(302);

      expect(loginResponse.headers.location).toMatch(/^\/dashboard/);
    });

    it('should not lose CSRF secret across multiple page loads', async () => {
      // Load login page 5 times
      const tokens = [];
      for (let i = 0; i < 5; i++) {
        const response = await agent.get('/login').expect(200);
        const token = AuthTestHelper.extractCsrfToken(response.text);
        tokens.push(token);
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // All tokens should be valid (non-empty)
      tokens.forEach(token => {
        expect(token).toBeTruthy();
        expect(token.length).toBeGreaterThan(0);
      });

      // Use the last token to login (should work)
      const credentials = AuthTestHelper.getCredentials('admin');
      const response = await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: tokens[tokens.length - 1],
        })
        .expect(302);

      expect(response.headers.location).toMatch(/^\/dashboard/);
    });
  });
});
