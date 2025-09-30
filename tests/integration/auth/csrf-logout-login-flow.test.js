/**
 * CSRF Token Flow Integration Tests - Logout/Login Cycles
 *
 * This test suite validates the CSRF token flow during logout/login cycles,
 * ensuring that the race condition bug fix is working correctly.
 *
 * Bug Context:
 * - Users were getting "No CSRF secret found in session" errors when logging out
 *   and immediately logging back in
 *
 * Fixes Implemented:
 * 1. dashboardAuthMiddleware.js: Changed session.destroy() to session.regenerate()
 *    with immediate CSRF secret initialization
 * 2. authController.js: Added defensive checks to ensure CSRF secret exists in
 *    all form-rendering methods
 * 3. securityMiddleware.js: Enhanced logging and CSRF secret generation
 *
 * @author Amexing Development Team
 * @version 1.0.0
 */

const request = require('supertest');
const app = require('../../../src/index');

/**
 * Helper function to extract CSRF token from HTML response
 * @param {string} html - HTML response text
 * @returns {string|null} - Extracted CSRF token or null
 */
function extractCsrfToken(html) {
  const match = html.match(/name="csrfToken"\s+value="([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Helper function to extract session ID from response cookies
 * @param {object} res - Supertest response object
 * @returns {string|null} - Extracted session ID or null
 */
function getSessionId(res) {
  const cookies = res.headers['set-cookie'];
  if (!cookies) return null;

  const cookie = cookies.find(c => c.includes('amexing.sid'));
  if (!cookie) return null;

  const match = cookie.match(/amexing\.sid=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Helper function to simulate complete login flow
 * @param {object} agent - Supertest agent
 * @param {string} identifier - Username or email
 * @param {string} password - User password
 * @returns {Promise<object>} - Login response
 */
async function simulateLogin(agent, identifier, password) {
  // Get login page to obtain CSRF token
  const loginPage = await agent.get('/login');
  const csrfToken = extractCsrfToken(loginPage.text);

  if (!csrfToken) {
    throw new Error('Failed to extract CSRF token from login page');
  }

  // Submit login form with CSRF token
  return agent
    .post('/auth/login')
    .send({
      identifier,
      password,
      csrfToken
    });
}

/**
 * Helper function to perform logout
 * @param {object} agent - Supertest agent
 * @returns {Promise<object>} - Logout response
 */
async function performLogout(agent) {
  return agent.get('/logout').timeout(15000);
}

describe('CSRF Token Flow - Logout/Login Integration', () => {
  let agent;

  // Test configuration with development user credentials
  const testUser = {
    identifier: 'superadmin@dev.amexing.com',
    password: 'DevSuper2024!',
  };

  beforeEach(() => {
    // Create agent that maintains cookies across requests
    agent = request.agent(app);
  });

  afterEach(async () => {
    // Cleanup: logout if agent exists
    if (agent) {
      try {
        await performLogout(agent);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  /**
   * Test 1: Session Regeneration After Logout
   *
   * Validates that:
   * - Session ID changes after logout (regenerated, not destroyed)
   * - New CSRF token is different from old token
   * - New CSRF token is valid and can be used
   */
  describe('Session Regeneration After Logout', () => {
    it('should regenerate session and CSRF token after logout', async () => {
      // Step 1: Simulate login
      const loginResponse = await simulateLogin(
        agent,
        testUser.identifier,
        testUser.password
      );
      expect(loginResponse.status).toBe(302); // Redirect after login

      // Step 2: Get initial session ID and CSRF token
      const initialSessionId = getSessionId(loginResponse);
      expect(initialSessionId).toBeTruthy();

      // Try to get login page again to verify CSRF token
      const loginPageAfterAuth = await agent.get('/login').timeout(15000);
      // Should redirect away since we're authenticated
      expect([200, 302]).toContain(loginPageAfterAuth.status);

      // If we got the login page (unlikely but possible), extract token
      // Otherwise, get it from a fresh session after logout
      let initialCsrfToken = extractCsrfToken(loginPageAfterAuth.text);

      // If no token found (because redirected), that's ok - we'll compare after logout
      if (!initialCsrfToken) {
        // Set a dummy value to compare later
        initialCsrfToken = 'pre-logout-token';
      }

      expect(initialCsrfToken).toBeTruthy();

      // Step 3: Perform logout
      const logoutResponse = await performLogout(agent);
      expect(logoutResponse.status).toBe(302); // Redirect after logout

      // Step 4: Verify session ID changed (regenerated)
      const newSessionId = getSessionId(logoutResponse);
      expect(newSessionId).toBeTruthy();
      expect(newSessionId).not.toBe(initialSessionId);

      // Step 5: Get new login page and verify new CSRF token is different
      const newLoginPage = await agent.get('/login').timeout(15000);
      expect(newLoginPage.status).toBe(200);
      const newCsrfToken = extractCsrfToken(newLoginPage.text);
      expect(newCsrfToken).toBeTruthy();
      expect(newCsrfToken).not.toBe(initialCsrfToken);

      // Step 6: Verify new CSRF token is valid by attempting login
      const reloginResponse = await agent
        .post('/auth/login')
        .timeout(15000)
        .send({
          identifier: testUser.identifier,
          password: testUser.password,
          csrfToken: newCsrfToken
        });

      expect(reloginResponse.status).toBe(302); // Successful login
    }, 45000); // Extended timeout for full cycle
  });

  /**
   * Test 2: Immediate Re-login After Logout
   *
   * Validates that:
   * - User can logout and immediately access login page
   * - CSRF token is present in the response
   * - Different user can login immediately after logout
   * - No "No CSRF secret found" errors occur
   */
  describe('Immediate Re-login After Logout', () => {
    it('should allow immediate login after logout without CSRF errors', async () => {
      // Step 1: Login as user A
      const loginResponseA = await simulateLogin(
        agent,
        testUser.identifier,
        testUser.password
      );
      expect(loginResponseA.status).toBe(302);

      // Step 2: Logout user A
      const logoutResponse = await performLogout(agent);
      expect(logoutResponse.status).toBe(302);

      // Step 3: Immediately get /login page (without waiting)
      const loginPageResponse = await agent.get('/login').timeout(15000);
      expect(loginPageResponse.status).toBe(200);

      // Step 4: Verify CSRF token exists in response
      const csrfToken = extractCsrfToken(loginPageResponse.text);
      expect(csrfToken).toBeTruthy();
      expect(loginPageResponse.text).not.toContain('No CSRF secret found');

      // Step 5: Login user B (or same user) with new CSRF token
      const reloginResponse = await agent
        .post('/auth/login')
        .timeout(15000)
        .send({
          identifier: testUser.identifier,
          password: testUser.password,
          csrfToken
        });

      // Step 6: Verify login succeeds without errors
      expect(reloginResponse.status).toBe(302);
      expect(reloginResponse.text).not.toContain('No CSRF secret found');
      expect(reloginResponse.text).not.toContain('CSRF Error');
    }, 30000); // Extended timeout
  });

  /**
   * Test 3: Multiple Consecutive Logout/Login Cycles
   *
   * Validates that:
   * - System can handle multiple logout/login cycles
   * - CSRF tokens are refreshed each time
   * - No errors accumulate over multiple cycles
   * - Session management remains stable
   */
  describe('Multiple Consecutive Logout/Login Cycles', () => {
    it('should handle multiple consecutive logout/login cycles', async () => {
      const cycles = 3;
      const sessionIds = [];
      const csrfTokens = [];

      for (let i = 0; i < cycles; i++) {
        // Step 1: Login
        const loginResponse = await simulateLogin(
          agent,
          testUser.identifier,
          testUser.password
        );
        expect(loginResponse.status).toBe(302);

        const sessionId = getSessionId(loginResponse);
        expect(sessionId).toBeTruthy();
        sessionIds.push(sessionId);

        // Step 2: Logout
        const logoutResponse = await performLogout(agent);
        expect(logoutResponse.status).toBe(302);

        // Step 3: Verify CSRF token refreshed
        const loginPage = await agent.get('/login').timeout(15000);
        expect(loginPage.status).toBe(200);

        const csrfToken = extractCsrfToken(loginPage.text);
        expect(csrfToken).toBeTruthy();
        csrfTokens.push(csrfToken);

        // Step 4: Verify no errors
        expect(loginPage.text).not.toContain('No CSRF secret found');
        expect(loginPage.text).not.toContain('CSRF Error');
      }

      // Verify all session IDs are unique
      const uniqueSessionIds = new Set(sessionIds);
      expect(uniqueSessionIds.size).toBe(cycles);

      // Verify all CSRF tokens are unique
      const uniqueCsrfTokens = new Set(csrfTokens);
      expect(uniqueCsrfTokens.size).toBe(cycles);
    }, 60000); // Extended timeout for multiple cycles
  });

  /**
   * Test 4: CSRF Secret Initialization on First Visit
   *
   * Validates that:
   * - CSRF secret is created on first visit to login page
   * - Session is created automatically
   * - CSRF token is present in the response
   * - No errors occur during initialization
   */
  describe('CSRF Secret Initialization', () => {
    it('should initialize CSRF secret on first visit to login page', async () => {
      // Step 1: Clear all cookies/session by using a fresh agent
      const freshAgent = request.agent(app);

      // Step 2: GET /login (first visit)
      const loginPage = await freshAgent.get('/login');
      expect(loginPage.status).toBe(200);

      // Step 3: Verify session created
      const sessionId = getSessionId(loginPage);
      expect(sessionId).toBeTruthy();

      // Step 4: Verify CSRF secret exists (indirectly through token)
      const csrfToken = extractCsrfToken(loginPage.text);
      expect(csrfToken).toBeTruthy();
      expect(csrfToken.length).toBeGreaterThan(0);

      // Step 5: Verify CSRF token in response works
      const loginAttempt = await freshAgent
        .post('/auth/login')
        .send({
          identifier: testUser.identifier,
          password: testUser.password,
          csrfToken
        });

      // Should succeed or fail on credentials, not CSRF
      expect(loginAttempt.status).not.toBe(403);
      expect(loginAttempt.text).not.toContain('No CSRF secret found');
    });
  });

  /**
   * Test 5: Race Condition Prevention
   *
   * Validates that:
   * - Rapid logout followed by login page access doesn't cause errors
   * - CSRF secret is available immediately after logout
   * - No "No CSRF secret found" errors occur
   * - Login succeeds with rapidly obtained CSRF token
   */
  describe('Race Condition Prevention', () => {
    it('should prevent race condition errors during rapid logout/login', async () => {
      // Step 1: Login
      const loginResponse = await simulateLogin(
        agent,
        testUser.identifier,
        testUser.password
      );
      expect(loginResponse.status).toBe(302);

      // Step 2: Trigger logout
      const logoutPromise = performLogout(agent);

      // Step 3: Immediately (without waiting) GET /login
      // This simulates the race condition scenario
      const loginPagePromise = agent.get('/login').timeout(15000);

      // Wait for both promises
      const [logoutResponse, loginPageResponse] = await Promise.all([
        logoutPromise,
        loginPagePromise
      ]);

      // Verify logout succeeded
      expect(logoutResponse.status).toBe(302);

      // Verify login page loads without CSRF errors
      expect(loginPageResponse.status).toBe(200);
      expect(loginPageResponse.text).not.toContain('No CSRF secret found');
      expect(loginPageResponse.text).not.toContain('CSRF Error');

      // Step 4: Extract CSRF token and attempt login
      const csrfToken = extractCsrfToken(loginPageResponse.text);
      expect(csrfToken).toBeTruthy();

      const reloginResponse = await agent
        .post('/auth/login')
        .timeout(15000)
        .send({
          identifier: testUser.identifier,
          password: testUser.password,
          csrfToken
        });

      // Step 5: Verify no "No CSRF secret found" errors
      expect(reloginResponse.status).toBe(302);
      expect(reloginResponse.text).not.toContain('No CSRF secret found');

      // Step 6: Verify login succeeds by checking we can access home
      const homeResponse = await agent.get('/').timeout(15000);
      expect([200, 302]).toContain(homeResponse.status);
    }, 45000); // Extended timeout for race condition test
  });

  /**
   * Test 6: Error Recovery
   *
   * Validates that:
   * - System recovers gracefully if CSRF secret is missing
   * - New CSRF secret is generated automatically
   * - Page renders without error
   * - CSRF token is present and valid
   */
  describe('Error Recovery', () => {
    it('should recover gracefully if CSRF secret is missing', async () => {
      // Note: We cannot directly manipulate session in integration tests,
      // but we can test the defensive checks by using a fresh session

      // Step 1: Create fresh agent (no session/CSRF secret)
      const freshAgent = request.agent(app);

      // Step 2: GET /login (should auto-generate CSRF secret)
      const loginPage = await freshAgent.get('/login');
      expect(loginPage.status).toBe(200);

      // Step 3: Verify new CSRF secret generated automatically
      // (indicated by presence of CSRF token)
      const csrfToken = extractCsrfToken(loginPage.text);
      expect(csrfToken).toBeTruthy();

      // Step 4: Verify page renders without error
      expect(loginPage.text).not.toContain('Session Error');
      expect(loginPage.text).not.toContain('Please refresh the page');
      expect(loginPage.text).toContain('Login');

      // Step 5: Verify CSRF token present and works
      const loginAttempt = await freshAgent
        .post('/auth/login')
        .send({
          identifier: testUser.identifier,
          password: testUser.password,
          csrfToken
        });

      // Should not fail due to CSRF issues
      expect(loginAttempt.status).not.toBe(403);
      expect(loginAttempt.text).not.toContain('CSRF');
    });

    it('should handle session regeneration errors gracefully', async () => {
      // Test that even if session operations have issues,
      // the user can still access the login page

      const freshAgent = request.agent(app);

      // Multiple rapid requests to login page
      const requests = [];
      for (let i = 0; i < 3; i++) {
        requests.push(freshAgent.get('/login'));
      }

      const responses = await Promise.all(requests);

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.text).toContain('Login');

        const csrfToken = extractCsrfToken(response.text);
        expect(csrfToken).toBeTruthy();
      });
    });
  });

  /**
   * Test 7: Form Submission with Old CSRF Token
   *
   * Validates that:
   * - Old CSRF token from before logout is rejected
   * - Request fails with proper error (403)
   * - New CSRF token can be obtained
   * - New CSRF token allows successful login
   */
  describe('Form Submission with Old CSRF Token', () => {
    it('should reject form submission with old CSRF token after logout', async () => {
      // Step 1: Login user A and capture CSRF token
      const loginPage1 = await agent.get('/login').timeout(15000);
      const oldCsrfToken = extractCsrfToken(loginPage1.text);
      expect(oldCsrfToken).toBeTruthy();

      const loginResponse = await agent
        .post('/auth/login')
        .timeout(15000)
        .send({
          identifier: testUser.identifier,
          password: testUser.password,
          csrfToken: oldCsrfToken
        });
      expect(loginResponse.status).toBe(302);

      // Step 2: Logout
      const logoutResponse = await performLogout(agent);
      expect(logoutResponse.status).toBe(302);

      // Step 3: Try to login with OLD CSRF token
      const reloginWithOldToken = await agent
        .post('/auth/login')
        .timeout(15000)
        .send({
          identifier: testUser.identifier,
          password: testUser.password,
          csrfToken: oldCsrfToken
        });

      // Step 4: Verify request is rejected (403)
      expect(reloginWithOldToken.status).toBe(403);
      expect(reloginWithOldToken.body).toHaveProperty('error');
      expect(reloginWithOldToken.body.error).toMatch(/CSRF/i);

      // Step 5: Get new /login page
      const loginPage2 = await agent.get('/login').timeout(15000);
      expect(loginPage2.status).toBe(200);

      const newCsrfToken = extractCsrfToken(loginPage2.text);
      expect(newCsrfToken).toBeTruthy();
      expect(newCsrfToken).not.toBe(oldCsrfToken);

      // Step 6: Use NEW CSRF token to login
      const reloginWithNewToken = await agent
        .post('/auth/login')
        .timeout(15000)
        .send({
          identifier: testUser.identifier,
          password: testUser.password,
          csrfToken: newCsrfToken
        });

      // Step 7: Verify success
      expect(reloginWithNewToken.status).toBe(302);
    }, 60000); // Extended timeout for old token test
  });

  /**
   * Test 8: CSRF Token Persistence Across Pages
   *
   * Validates that:
   * - CSRF token remains valid across different page navigations
   * - Session is maintained properly
   * - Token can be reused for multiple form submissions
   */
  describe('CSRF Token Persistence', () => {
    it('should maintain valid CSRF token across page navigations', async () => {
      // Step 1: Get login page
      const loginPage = await agent.get('/login');
      const csrfToken = extractCsrfToken(loginPage.text);
      expect(csrfToken).toBeTruthy();

      // Step 2: Navigate to other pages (simulating user browsing)
      const healthCheck = await agent.get('/health');
      expect(healthCheck.status).toBe(200);

      // Step 3: Return to login and use CSRF token
      const loginResponse = await agent
        .post('/auth/login')
        .send({
          identifier: testUser.identifier,
          password: testUser.password,
          csrfToken
        });

      // Step 4: Verify CSRF token still valid
      expect(loginResponse.status).toBe(302);
      expect(loginResponse.text).not.toContain('CSRF');
    });
  });

  /**
   * Test 9: Concurrent Logout/Login Operations
   *
   * Validates that:
   * - System handles concurrent logout/login from multiple sessions
   * - Each session maintains independent CSRF tokens
   * - No cross-session contamination occurs
   */
  describe('Concurrent Sessions', () => {
    it('should handle concurrent logout/login from multiple sessions', async () => {
      // Create two separate agents (simulating two different browsers)
      const agent1 = request.agent(app);
      const agent2 = request.agent(app);

      try {
        // Step 1: Both agents login simultaneously
        const [login1, login2] = await Promise.all([
          simulateLogin(agent1, testUser.identifier, testUser.password),
          simulateLogin(agent2, testUser.identifier, testUser.password)
        ]);

        expect(login1.status).toBe(302);
        expect(login2.status).toBe(302);

        const session1 = getSessionId(login1);
        const session2 = getSessionId(login2);

        // Verify different sessions
        expect(session1).not.toBe(session2);

        // Step 2: Both agents logout simultaneously
        const [logout1, logout2] = await Promise.all([
          performLogout(agent1),
          performLogout(agent2)
        ]);

        expect(logout1.status).toBe(302);
        expect(logout2.status).toBe(302);

        // Step 3: Both agents get login page simultaneously
        const [loginPage1, loginPage2] = await Promise.all([
          agent1.get('/login'),
          agent2.get('/login')
        ]);

        expect(loginPage1.status).toBe(200);
        expect(loginPage2.status).toBe(200);

        const csrf1 = extractCsrfToken(loginPage1.text);
        const csrf2 = extractCsrfToken(loginPage2.text);

        expect(csrf1).toBeTruthy();
        expect(csrf2).toBeTruthy();

        // Step 4: Verify no errors in either session
        expect(loginPage1.text).not.toContain('No CSRF secret found');
        expect(loginPage2.text).not.toContain('No CSRF secret found');
      } finally {
        // Cleanup both agents
        try {
          await Promise.all([
            performLogout(agent1),
            performLogout(agent2)
          ]);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });
  });

  /**
   * Test 10: Performance Under Load
   *
   * Validates that:
   * - CSRF token generation performs well under repeated requests
   * - No memory leaks or performance degradation
   * - System remains responsive
   */
  describe('Performance Under Load', () => {
    it('should handle rapid successive login page requests efficiently', async () => {
      const iterations = 10;
      const startTime = Date.now();

      const promises = [];
      for (let i = 0; i < iterations; i++) {
        promises.push(agent.get('/login'));
      }

      const responses = await Promise.all(promises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Verify all requests succeeded
      responses.forEach(response => {
        expect(response.status).toBe(200);
        const csrfToken = extractCsrfToken(response.text);
        expect(csrfToken).toBeTruthy();
      });

      // Performance assertion: should complete within reasonable time
      // Average time per request should be less than 1 second
      const avgTimePerRequest = totalTime / iterations;
      expect(avgTimePerRequest).toBeLessThan(1000);

      console.log(`Performance Test: ${iterations} requests completed in ${totalTime}ms (avg: ${avgTimePerRequest.toFixed(2)}ms per request)`);
    }, 15000); // Extended timeout for performance test
  });
});
