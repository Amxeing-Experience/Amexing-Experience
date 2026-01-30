/**
 * Last Login At Field Update Test
 * Verifies that the lastLoginAt field is properly updated when a user logs in
 * Created by Denisse Maldonado
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
    await new Promise(resolve => setTimeout(resolve, 1000));
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
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Perform login
      const loginResponse = await request(app)
        .post('/login')
        .send({
          username: credentials.email,
          password: credentials.password
        });
      
      // Check login was successful
      expect(loginResponse.status).toBe(302); // Redirect after successful login
      
      // Wait for afterLogin hook to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
      
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
      // Login as admin
      const adminToken = await AuthTestHelper.loginAs('admin', app);
      
      // Access profile page
      const profileResponse = await request(app)
        .get('/dashboard/admin/profile')
        .set('Authorization', `Bearer ${adminToken}`);
      
      expect(profileResponse.status).toBe(200);
      
      // Check that the profile page contains the Last Login section
      const html = profileResponse.text;
      expect(html).toContain('Último acceso');
      
      // Verify it doesn't show "Never" for a user that has logged in
      expect(html).not.toContain('>Never<');
      
      // Should either show a date or "Sin registro"
      const hasDate = html.includes('2026') || html.includes('2025') || html.includes('2024');
      const hasNoRecord = html.includes('Sin registro');
      
      expect(hasDate || hasNoRecord).toBe(true);
      
      console.log('✅ Profile page displays lastLoginAt correctly');
    });
  });
});