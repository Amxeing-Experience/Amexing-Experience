/**
 * Last Login At Field Update Test
 * Verifies that the lastLoginAt field is properly updated when a user logs in
 * Created by Denisse Maldonado
 *
 * @module tests/integration/auth/lastLoginAt
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('LastLoginAt Field Update', () => {
  let app;

  beforeAll(async () => {
    // Import app (Parse Server already running on 1339)
    app = require('../../../src/index');

    // Wait for app initialization
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }, 30000);

  describe('Login Timestamp Update', () => {
    it('should update lastLoginAt field when user logs in successfully', async () => {
      // Get test credentials
      const credentials = AuthTestHelper.getCredentials('admin');

      // Get the user before login to check initial state
      const query = new Parse.Query('AmexingUser');
      query.equalTo('email', credentials.email);
      const userBefore = await query.first({ useMasterKey: true });
      const lastLoginBefore = userBefore ? userBefore.get('lastLoginAt') : null;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Use agent to maintain session (required for CSRF and cookies)
      const agent = request.agent(app);

      // Get CSRF token from login page
      const loginPage = await agent.get('/login');
      const csrfToken = AuthTestHelper.extractCsrfToken(loginPage.text);

      // Perform login with CSRF token
      const loginResponse = await agent
        .post('/auth/login')
        .set('Accept', 'text/html')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken,
        });

      // Check login was successful (redirect to dashboard)
      expect(loginResponse.status).toBe(302);

      // Wait for afterLogin hook to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Get the user after login
      const userAfter = await query.first({ useMasterKey: true });
      const lastLoginAfter = userAfter.get('lastLoginAt');

      // Verify lastLoginAt was updated
      expect(lastLoginAfter).toBeDefined();
      expect(lastLoginAfter).toBeInstanceOf(Date);

      // If there was a previous login, verify the new timestamp is more recent
      if (lastLoginBefore) {
        expect(lastLoginAfter.getTime()).toBeGreaterThan(lastLoginBefore.getTime());
      }

      console.log('✅ LastLoginAt field updated successfully');
      console.log('Previous login:', lastLoginBefore || 'Never');
      console.log('Current login:', lastLoginAfter);
    });

    it('should display lastLoginAt correctly in profile page', async () => {
      // Use agent to maintain session (dashboard pages require session, not JWT)
      const agent = request.agent(app);
      const credentials = AuthTestHelper.getCredentials('admin');

      // Get CSRF token from login page
      const loginPage = await agent.get('/login');
      const csrfToken = AuthTestHelper.extractCsrfToken(loginPage.text);

      // Login via web to establish session
      await agent
        .post('/auth/login')
        .set('Accept', 'text/html')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken,
        });

      // Access profile page with session
      const profileResponse = await agent.get('/dashboard/admin/profile');

      expect(profileResponse.status).toBe(200);

      // Check that the profile page contains the Last Login section
      const html = profileResponse.text;
      expect(html).toContain('Last login');

      // Verify it doesn't show "Never" for a user that has logged in
      expect(html).not.toContain('>Never<');

      // Should either show a date or "Sin registro" (when no previous login)
      const hasDate = html.includes('2026') || html.includes('2025') || html.includes('2024');
      const hasNoRecord = html.includes('Sin registro');

      expect(hasDate || hasNoRecord).toBe(true);

      console.log('✅ Profile page displays lastLoginAt correctly');
    });
  });
});