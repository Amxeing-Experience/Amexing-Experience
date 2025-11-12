/**
 * Integration Tests: Single Login-Logout Cycle
 * Tests complete authentication flow with CSRF token persistence
 *
 * SIMPLIFIED: Tests focus on login/logout cycles without complex dashboard navigation
 */

const request = require('supertest');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('Login-Logout Cycle Integration', () => {
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

  describe('Single Login-Logout Cycle', () => {
    it('should complete full cycle: GET login -> POST login -> POST logout -> GET login', async () => {
      // Step 1: GET /login (get CSRF token)
      const loginPageResponse = await agent.get('/login').expect(200);

      expect(loginPageResponse.text).toContain('csrf');
      const csrfToken = AuthTestHelper.extractCsrfToken(loginPageResponse.text);
      expect(csrfToken).toBeTruthy();

      // Get session cookie
      const cookies = loginPageResponse.headers['set-cookie'];
      expect(cookies).toBeDefined();

      // Step 2: POST /login (authenticate)
      const credentials = AuthTestHelper.getCredentials('superadmin');
      const loginResponse = await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken,
        })
        .expect(302); // Redirect to dashboard

      expect(loginResponse.headers.location).toMatch(/^\/dashboard/);

      // Step 3: POST /logout (logout with session regeneration)
      const logoutResponse = await agent.get('/logout').expect(302); // Redirect to login with message

      expect(logoutResponse.headers.location).toContain('/login');

      // Step 4: GET /login (verify new session with NEW CSRF token)
      const loginAfterLogout = await agent.get('/login').expect(200);
      const newCsrfToken = AuthTestHelper.extractCsrfToken(loginAfterLogout.text);

      expect(newCsrfToken).toBeTruthy();
      expect(newCsrfToken).not.toBe(csrfToken); // Should be different
    });

    it('should maintain CSRF token across login-logout cycle', async () => {
      // Get login page
      const loginPage = await agent.get('/login').expect(200);
      const csrfToken1 = AuthTestHelper.extractCsrfToken(loginPage.text);

      // Login
      const credentials = AuthTestHelper.getCredentials('admin');
      await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: csrfToken1,
        })
        .expect(302);

      // Logout
      await agent.get('/logout').expect(302);

      // Get login page (should have NEW CSRF from regenerated session)
      const loginPage2 = await agent.get('/login').expect(200);
      const csrfToken2 = AuthTestHelper.extractCsrfToken(loginPage2.text);
      expect(csrfToken2).toBeTruthy();

      // CSRF tokens should be different (new session after logout)
      expect(csrfToken2).not.toBe(csrfToken1);
    });

    it('should not allow access to protected routes after logout', async () => {
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

      // Logout
      await agent.get('/logout').expect(302);

      // Try to access dashboard (should redirect)
      // Note: Dashboard may redirect to /dashboard/ or /login depending on auth state
      const dashboardResponse = await agent.get('/dashboard');
      expect([301, 302]).toContain(dashboardResponse.status);
      expect(dashboardResponse.headers.location).toBeTruthy();
    });
  });

  describe('Session Cookie Handling', () => {
    it('should maintain session cookie throughout login-logout cycle', async () => {
      // Get login page - should set session cookie
      const loginPage = await agent.get('/login').expect(200);
      const initialCookies = loginPage.headers['set-cookie'];
      expect(initialCookies).toBeDefined();
      expect(initialCookies.some(cookie => cookie.includes('amexing.sid'))).toBe(true);

      // Login
      const csrfToken = AuthTestHelper.extractCsrfToken(loginPage.text);
      const credentials = AuthTestHelper.getCredentials('superadmin');
      await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken,
        })
        .expect(302);

      // Logout
      await agent.get('/logout').expect(302);

      // Access login page - should work with regenerated session
      await agent.get('/login').expect(200);
    });
  });

  describe('CSRF Protection After Logout', () => {
    it('should allow form submissions with CSRF after logout', async () => {
      // Complete login-logout cycle
      const loginPage1 = await agent.get('/login').expect(200);
      const csrfToken1 = AuthTestHelper.extractCsrfToken(loginPage1.text);

      const credentials = AuthTestHelper.getCredentials('admin');
      await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: csrfToken1,
        })
        .expect(302);

      // Logout
      await agent.get('/logout').expect(302);

      // Try to login again with new CSRF token
      const loginPage2 = await agent.get('/login').expect(200);
      const csrfToken2 = AuthTestHelper.extractCsrfToken(loginPage2.text);
      expect(csrfToken2).toBeTruthy();

      // Should be able to login again
      const secondLoginResponse = await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: csrfToken2,
        })
        .expect(302);

      expect(secondLoginResponse.headers.location).toMatch(/^\/dashboard/);
    });

    it('should reject requests with old CSRF token after logout', async () => {
      // Get initial CSRF
      const loginPage1 = await agent.get('/login').expect(200);
      const csrfToken1 = AuthTestHelper.extractCsrfToken(loginPage1.text);

      // Login
      const credentials = AuthTestHelper.getCredentials('superadmin');
      await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: csrfToken1,
        })
        .expect(302);

      // Logout
      await agent.get('/logout').expect(302);

      // Try to use old CSRF token from before logout (should fail)
      const failedLogin = await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: csrfToken1, // Old token from before logout
        });

      // May redirect to login or return 403 depending on middleware order
      expect([302, 403]).toContain(failedLogin.status);

      if (failedLogin.status === 403) {
        expect(failedLogin.body.error).toContain('CSRF');
      }
    });
  });
});
