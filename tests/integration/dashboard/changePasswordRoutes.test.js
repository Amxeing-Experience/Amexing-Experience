/**
 * Change Password Routes Integration Tests
 * Tests for dashboard change password routes across all user roles
 * Created by Denisse Maldonado
 */

const request = require('supertest');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('Change Password Routes Integration', () => {
  let app;
  let superadminToken, adminToken, clientToken, departmentManagerToken;
  let employeeToken, driverToken, guestToken;

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Login with all seeded test users
    superadminToken = await AuthTestHelper.loginAs('superadmin', app);
    adminToken = await AuthTestHelper.loginAs('admin', app);
    clientToken = await AuthTestHelper.loginAs('client', app);
    departmentManagerToken = await AuthTestHelper.loginAs('department_manager', app);
    employeeToken = await AuthTestHelper.loginAs('employee', app);
    driverToken = await AuthTestHelper.loginAs('driver', app);
    guestToken = await AuthTestHelper.loginAs('guest', app);
  }, 30000);

  describe('GET /dashboard/{role}/change-password', () => {
    describe('SuperAdmin Role', () => {
      it('should render change password page for superadmin', async () => {
        const response = await request(app)
          .get('/dashboard/superadmin/change-password')
          .set('Authorization', `Bearer ${superadminToken}`)
          .expect(200);

        expect(response.text).toContain('Change Password');
        expect(response.text).toContain('Current Password');
        expect(response.text).toContain('New Password');
        expect(response.text).toContain('Confirm New Password');
        expect(response.text).toContain('Password Requirements');
        expect(response.text).toContain('/dashboard/superadmin/profile');
      });

      it('should include correct breadcrumb for superadmin', async () => {
        const response = await request(app)
          .get('/dashboard/superadmin/change-password')
          .set('Authorization', `Bearer ${superadminToken}`)
          .expect(200);

        expect(response.text).toContain('Profile');
        expect(response.text).toContain('Change Password');
        expect(response.text).toContain('/dashboard/superadmin');
      });

      it('should require authentication for superadmin route', async () => {
        await request(app)
          .get('/dashboard/superadmin/change-password')
          .expect(302); // Redirect to login
      });

      it('should reject other roles accessing superadmin route', async () => {
        await request(app)
          .get('/dashboard/superadmin/change-password')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(403); // Forbidden
      });
    });

    describe('Admin Role', () => {
      it('should render change password page for admin', async () => {
        const response = await request(app)
          .get('/dashboard/admin/change-password')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(response.text).toContain('Change Password');
        expect(response.text).toContain('/dashboard/admin/profile');
      });

      it('should require authentication for admin route', async () => {
        await request(app)
          .get('/dashboard/admin/change-password')
          .expect(302);
      });

      it('should reject unauthorized roles', async () => {
        await request(app)
          .get('/dashboard/admin/change-password')
          .set('Authorization', `Bearer ${guestToken}`)
          .expect(403);
      });
    });

    describe('Client Role', () => {
      it('should render change password page for client', async () => {
        const response = await request(app)
          .get('/dashboard/client/change-password')
          .set('Authorization', `Bearer ${clientToken}`)
          .expect(200);

        expect(response.text).toContain('Change Password');
        expect(response.text).toContain('/dashboard/client/profile');
      });

      it('should require authentication for client route', async () => {
        await request(app)
          .get('/dashboard/client/change-password')
          .expect(302);
      });
    });

    describe('Department Manager Role', () => {
      it('should render change password page for department_manager', async () => {
        const response = await request(app)
          .get('/dashboard/department_manager/change-password')
          .set('Authorization', `Bearer ${departmentManagerToken}`)
          .expect(200);

        expect(response.text).toContain('Change Password');
        expect(response.text).toContain('/dashboard/department_manager/profile');
      });

      it('should require authentication for department_manager route', async () => {
        await request(app)
          .get('/dashboard/department_manager/change-password')
          .expect(302);
      });
    });

    describe('Employee Role', () => {
      it('should render change password page for employee', async () => {
        const response = await request(app)
          .get('/dashboard/employee/change-password')
          .set('Authorization', `Bearer ${employeeToken}`)
          .expect(200);

        expect(response.text).toContain('Change Password');
        expect(response.text).toContain('/dashboard/employee/profile');
      });

      it('should require authentication for employee route', async () => {
        await request(app)
          .get('/dashboard/employee/change-password')
          .expect(302);
      });
    });

    describe('Driver Role', () => {
      it('should render change password page for driver', async () => {
        const response = await request(app)
          .get('/dashboard/driver/change-password')
          .set('Authorization', `Bearer ${driverToken}`)
          .expect(200);

        expect(response.text).toContain('Change Password');
        expect(response.text).toContain('/dashboard/driver/profile');
      });

      it('should require authentication for driver route', async () => {
        await request(app)
          .get('/dashboard/driver/change-password')
          .expect(302);
      });
    });

    describe('Guest Role', () => {
      it('should render change password page for guest', async () => {
        const response = await request(app)
          .get('/dashboard/guest/change-password')
          .set('Authorization', `Bearer ${guestToken}`)
          .expect(200);

        expect(response.text).toContain('Change Password');
        expect(response.text).toContain('/dashboard/guest/profile');
      });

      it('should require authentication for guest route', async () => {
        await request(app)
          .get('/dashboard/guest/change-password')
          .expect(302);
      });
    });
  });

  describe('Change Password Form Features', () => {
    it('should include all required form elements', async () => {
      const response = await request(app)
        .get('/dashboard/admin/change-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.text).toContain('id="changePasswordForm"');
      expect(response.text).toContain('name="currentPassword"');
      expect(response.text).toContain('name="newPassword"');
      expect(response.text).toContain('name="confirmPassword"');
      expect(response.text).toContain('name="_csrf"');
      expect(response.text).toContain('action="/auth/change-password"');
      expect(response.text).toContain('method="POST"');
    });

    it('should include password strength indicator', async () => {
      const response = await request(app)
        .get('/dashboard/admin/change-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.text).toContain('password-strength');
      expect(response.text).toContain('strength-bar');
      expect(response.text).toContain('Password Requirements');
    });

    it('should include password visibility toggles', async () => {
      const response = await request(app)
        .get('/dashboard/admin/change-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.text).toContain('togglePassword');
      expect(response.text).toContain('ti-eye');
    });

    it('should include JavaScript validation', async () => {
      const response = await request(app)
        .get('/dashboard/admin/change-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.text).toContain('validatePassword');
      expect(response.text).toContain('DOMContentLoaded');
      expect(response.text).toContain('addEventListener');
    });
  });

  describe('Security and Accessibility', () => {
    it('should include CSRF protection', async () => {
      const response = await request(app)
        .get('/dashboard/admin/change-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.text).toContain('_csrf');
      expect(response.text).toContain('csrfToken');
    });

    it('should use secure password input types', async () => {
      const response = await request(app)
        .get('/dashboard/admin/change-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.text).toContain('type="password"');
      expect(response.text).toContain('autocomplete="current-password"');
      expect(response.text).toContain('autocomplete="new-password"');
    });

    it('should include accessibility features', async () => {
      const response = await request(app)
        .get('/dashboard/admin/change-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.text).toContain('aria-label');
      expect(response.text).toContain('required');
      expect(response.text).toContain('<label');
    });

    it('should be responsive', async () => {
      const response = await request(app)
        .get('/dashboard/admin/change-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.text).toContain('col-12');
      expect(response.text).toContain('col-lg-8');
      expect(response.text).toContain('container-fluid');
    });
  });

  describe('Route Authorization Matrix', () => {
    const roles = [
      { name: 'superadmin', token: 'superadminToken' },
      { name: 'admin', token: 'adminToken' },
      { name: 'client', token: 'clientToken' },
      { name: 'department_manager', token: 'departmentManagerToken' },
      { name: 'employee', token: 'employeeToken' },
      { name: 'driver', token: 'driverToken' },
      { name: 'guest', token: 'guestToken' }
    ];

    roles.forEach(role => {
      it(`should allow ${role.name} to access their own change password page`, async () => {
        const token = eval(role.token); // Get token from variable name
        await request(app)
          .get(`/dashboard/${role.name}/change-password`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      });

      // Test that other roles cannot access this role's page (except superadmin)
      roles.forEach(otherRole => {
        if (otherRole.name !== role.name && otherRole.name !== 'superadmin') {
          it(`should prevent ${otherRole.name} from accessing ${role.name} change password page`, async () => {
            const token = eval(otherRole.token);
            await request(app)
              .get(`/dashboard/${role.name}/change-password`)
              .set('Authorization', `Bearer ${token}`)
              .expect(403);
          });
        }
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed authorization header', async () => {
      await request(app)
        .get('/dashboard/admin/change-password')
        .set('Authorization', 'Bearer invalid-token')
        .expect(302); // Should redirect to login
    });

    it('should handle missing authorization header', async () => {
      await request(app)
        .get('/dashboard/admin/change-password')
        .expect(302); // Should redirect to login
    });

    it('should handle expired tokens gracefully', async () => {
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.expired.token';
      await request(app)
        .get('/dashboard/admin/change-password')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(302);
    });
  });

  describe('Page Content Validation', () => {
    it('should include proper page titles', async () => {
      const response = await request(app)
        .get('/dashboard/admin/change-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.text).toContain('<title>');
      expect(response.text).toContain('Change Password');
    });

    it('should include navigation elements', async () => {
      const response = await request(app)
        .get('/dashboard/admin/change-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.text).toContain('breadcrumb');
      expect(response.text).toContain('page-breadcrumb');
    });

    it('should maintain consistent styling', async () => {
      const response = await request(app)
        .get('/dashboard/admin/change-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.text).toContain('bootstrap');
      expect(response.text).toContain('form-control');
      expect(response.text).toContain('btn btn-primary');
    });
  });
});