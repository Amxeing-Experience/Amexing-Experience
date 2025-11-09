/**
 * Integration Tests: Multiple Login-Logout Cycles
 * Tests CSRF token persistence across consecutive login-logout cycles
 *
 * SIMPLIFIED: Tests focus on multiple cycles without complex dashboard navigation
 */

const request = require('supertest');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('Multiple Login-Logout Cycles Integration', () => {
  let app;
  let agent;

  beforeAll(async () => {
    // Import app (Parse Server already running on 1339)
    app = require('../../../src/index');

    // Wait longer for full initialization
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify app is fully ready by checking health endpoint
    let retries = 10;
    while (retries > 0) {
      try {
        await request(app).get('/health').expect(200);
        break;
      } catch (e) {
        retries--;
        if (retries === 0) throw new Error('App failed to initialize after 10 retries');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }, 30000);

  beforeEach(() => {
    // Create new agent for each test (fresh session)
    agent = request.agent(app);
  });

  describe('5 Consecutive Login-Logout Cycles', () => {
    it('should complete 5 login-logout cycles without CSRF errors', async () => {
      const credentials = AuthTestHelper.getCredentials('superadmin');
      const cycleResults = [];

      for (let cycle = 1; cycle <= 5; cycle++) {
        const cycleData = {
          cycle,
          success: false,
          csrfTokens: {},
        };

        try {
          // Step 1: GET /login
          const loginPage = await agent.get('/login').expect(200);
          cycleData.csrfTokens.loginPage = AuthTestHelper.extractCsrfToken(loginPage.text);
          expect(cycleData.csrfTokens.loginPage).toBeTruthy();

          // Step 2: POST /login
          await agent
            .post('/auth/login')
            .send({
              identifier: credentials.email,
              password: credentials.password,
              csrfToken: cycleData.csrfTokens.loginPage,
            })
            .expect(302);

          // Step 3: GET /logout
          await agent.get('/logout').expect(302);

          // Step 4: GET /login (verify new session)
          const loginAfterLogout = await agent.get('/login').expect(200);
          cycleData.csrfTokens.afterLogout = AuthTestHelper.extractCsrfToken(loginAfterLogout.text);
          expect(cycleData.csrfTokens.afterLogout).toBeTruthy();

          cycleData.success = true;
        } catch (error) {
          cycleData.error = error.message;
        }

        cycleResults.push(cycleData);
      }

      // Verify all cycles succeeded
      const failedCycles = cycleResults.filter(c => !c.success);
      expect(failedCycles).toHaveLength(0);

      // Verify CSRF tokens were present in all cycles
      cycleResults.forEach((cycleData) => {
        expect(cycleData.csrfTokens.loginPage).toBeTruthy();
        expect(cycleData.csrfTokens.afterLogout).toBeTruthy();
      });

      console.log(`✓ Completed ${cycleResults.length} login-logout cycles successfully`);
    }, 60000); // Extended timeout for 5 cycles

    it('should maintain different CSRF tokens across cycles', async () => {
      const credentials = AuthTestHelper.getCredentials('admin');
      const csrfTokensPerCycle = [];

      for (let cycle = 1; cycle <= 3; cycle++) {
        // Login
        const loginPage = await agent.get('/login').expect(200);
        const csrfToken = AuthTestHelper.extractCsrfToken(loginPage.text);

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

        // Get post-logout CSRF
        const loginAfterLogout = await agent.get('/login').expect(200);
        const postLogoutCsrf = AuthTestHelper.extractCsrfToken(loginAfterLogout.text);

        csrfTokensPerCycle.push({
          cycle,
          loginCsrf: csrfToken,
          postLogoutCsrf,
        });
      }

      // Verify each cycle has unique CSRF tokens
      for (let i = 0; i < csrfTokensPerCycle.length - 1; i++) {
        const current = csrfTokensPerCycle[i];
        const next = csrfTokensPerCycle[i + 1];

        // Post-logout CSRF from cycle N should differ from login CSRF of cycle N+1
        expect(current.postLogoutCsrf).not.toBe(next.loginCsrf);
      }
    }, 45000);

    it('should handle rapid login-logout cycles', async () => {
      const credentials = AuthTestHelper.getCredentials('admin');

      for (let i = 0; i < 5; i++) {
        // Fast login-logout
        const loginPage = await agent.get('/login').expect(200);
        const csrfToken = AuthTestHelper.extractCsrfToken(loginPage.text);

        await agent
          .post('/auth/login')
          .send({
            identifier: credentials.email,
            password: credentials.password,
            csrfToken,
          })
          .expect(302);

        await agent.get('/logout').expect(302);

        // Delay between cycles to allow logout to complete (logout has internal 100ms delay)
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Final verification - should be able to login again
      const finalLoginPage = await agent.get('/login').expect(200);
      const finalCsrf = AuthTestHelper.extractCsrfToken(finalLoginPage.text);

      const finalLogin = await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: finalCsrf,
        })
        .expect(302);

      expect(finalLogin.headers.location).toMatch(/^\/dashboard/);
    }, 30000);
  });

  describe('Cross-User Multiple Cycles', () => {
    it('should handle cycles with different user roles', async () => {
      const roles = ['superadmin', 'admin', 'client'];

      for (const role of roles) {
        const credentials = AuthTestHelper.getCredentials(role);

        // Login
        const loginPage = await agent.get('/login').expect(200);
        const csrfToken = AuthTestHelper.extractCsrfToken(loginPage.text);

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

        // Verify can access login
        await agent.get('/login').expect(200);
      }

      console.log(`✓ Completed login-logout cycles for ${roles.length} different roles`);
    }, 45000);
  });

  describe('Performance and Timing', () => {
    it('should complete 5 cycles within reasonable time', async () => {
      const credentials = AuthTestHelper.getCredentials('admin');
      const startTime = Date.now();

      for (let i = 0; i < 5; i++) {
        const loginPage = await agent.get('/login').expect(200);
        const csrfToken = AuthTestHelper.extractCsrfToken(loginPage.text);

        await agent
          .post('/auth/login')
          .send({
            identifier: credentials.email,
            password: credentials.password,
            csrfToken,
          })
          .expect(302);

        await agent.get('/logout').expect(302);
      }

      const duration = Date.now() - startTime;

      // Should complete in under 30 seconds
      expect(duration).toBeLessThan(30000);
      console.log(`✓ Completed 5 cycles in ${duration}ms`);
    }, 45000);
  });

  describe('Edge Cases', () => {
    it('should handle logout without prior dashboard access', async () => {
      const credentials = AuthTestHelper.getCredentials('admin');

      for (let i = 0; i < 3; i++) {
        // Login
        const loginPage = await agent.get('/login').expect(200);
        const csrfToken = AuthTestHelper.extractCsrfToken(loginPage.text);

        await agent
          .post('/auth/login')
          .send({
            identifier: credentials.email,
            password: credentials.password,
            csrfToken,
          })
          .expect(302);

        // Logout immediately (without accessing dashboard)
        await agent.get('/logout').expect(302);

        // Should still work
        await agent.get('/login').expect(200);
      }
    }, 30000);
  });
});
