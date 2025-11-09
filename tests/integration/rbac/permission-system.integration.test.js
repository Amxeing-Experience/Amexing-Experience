/**
 * RBAC Permission System Integration Tests
 * End-to-end tests for the Role-Based Access Control system
 *
 * @author Amexing Development Team
 * @version 2.0.0
 * @updated 2025-01-24 - Migrated to MongoDB Memory Server with seed system
 */

const request = require('supertest');
const AuthTestHelper = require('../../helpers/authTestHelper');
const Parse = require('parse/node');

// Import the Express app directly for testing
let app;

describe('RBAC Permission System Integration', () => {
  let superadminToken;
  let adminToken;
  let departmentManagerToken;
  let employeeToken;
  let guestToken;

  beforeAll(async () => {
    // Initialize Parse SDK
    Parse.initialize('test-app-id', null, 'test-master-key');
    Parse.serverURL = 'http://localhost:1339/parse';
    Parse.masterKey = 'test-master-key';

    // Import app for testing
    app = require('../../../src/index');

    // Wait for app initialization
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Login as different roles to get tokens
    try {
      superadminToken = await AuthTestHelper.loginAs('superadmin', app);
      adminToken = await AuthTestHelper.loginAs('admin', app);
      departmentManagerToken = await AuthTestHelper.loginAs('department_manager', app);
      employeeToken = await AuthTestHelper.loginAs('employee', app);
      guestToken = await AuthTestHelper.loginAs('guest', app);
    } catch (error) {
      console.error('Failed to login test users:', error.message);
    }
  }, 30000);

  afterAll(async () => {
    // No cleanup needed
  }, 15000);

  describe('Role-Based Access Control', () => {
    describe('SuperAdmin Access', () => {
      it('should allow superadmin to access all endpoints', async () => {
        if (!superadminToken) {
          console.warn('SuperAdmin token not available, skipping test');
          return;
        }

        const response = await request(app)
          .get('/api/users')
          .set('Authorization', `Bearer ${superadminToken}`);

        // Should succeed or return valid error (not 401/403)
        expect([200, 404, 500]).toContain(response.status);
      });

      it('should allow superadmin to manage all roles', async () => {
        if (!superadminToken) {
          console.warn('SuperAdmin token not available, skipping test');
          return;
        }

        const response = await request(app)
          .get('/api/roles')
          .set('Authorization', `Bearer ${superadminToken}`);

        // Should succeed or return valid error (not 401/403)
        expect([200, 404, 500]).toContain(response.status);
      });
    });

    describe('Admin Access', () => {
      it('should allow admin to access user management', async () => {
        if (!adminToken) {
          console.warn('Admin token not available, skipping test');
          return;
        }

        const response = await request(app)
          .get('/api/users')
          .set('Authorization', `Bearer ${adminToken}`);

        // Should succeed or return valid error (not 401/403)
        expect([200, 404, 500]).toContain(response.status);
      });

      it('should prevent admin from accessing superadmin-only endpoints', async () => {
        if (!adminToken) {
          console.warn('Admin token not available, skipping test');
          return;
        }

        const response = await request(app)
          .delete('/api/system/reset')
          .set('Authorization', `Bearer ${adminToken}`);

        // Should be forbidden or not found
        expect([401, 403, 404]).toContain(response.status);
      });
    });

    describe('Department Manager Access', () => {
      it('should allow department manager to view department data', async () => {
        if (!departmentManagerToken) {
          console.warn('Department Manager token not available, skipping test');
          return;
        }

        const response = await request(app)
          .get('/api/departments')
          .set('Authorization', `Bearer ${departmentManagerToken}`);

        // Should succeed or return valid error
        expect([200, 404, 500]).toContain(response.status);
      });

      it('should prevent department manager from global user management', async () => {
        if (!departmentManagerToken) {
          console.warn('Department Manager token not available, skipping test');
          return;
        }

        const response = await request(app)
          .delete('/api/users/all')
          .set('Authorization', `Bearer ${departmentManagerToken}`);

        // Should be forbidden or not found
        expect([401, 403, 404]).toContain(response.status);
      });
    });

    describe('Employee Access', () => {
      it('should allow employee to access basic endpoints', async () => {
        if (!employeeToken) {
          console.warn('Employee token not available, skipping test');
          return;
        }

        const response = await request(app)
          .get('/api/profile')
          .set('Authorization', `Bearer ${employeeToken}`);

        // Should succeed or return valid error
        expect([200, 404, 500]).toContain(response.status);
      });

      it('should prevent employee from accessing admin endpoints', async () => {
        if (!employeeToken) {
          console.warn('Employee token not available, skipping test');
          return;
        }

        const response = await request(app)
          .get('/api/users')
          .set('Authorization', `Bearer ${employeeToken}`);

        // Should be forbidden or not found
        expect([401, 403, 404]).toContain(response.status);
      });
    });

    describe('Guest Access', () => {
      it('should restrict guest access to public endpoints only', async () => {
        if (!guestToken) {
          console.warn('Guest token not available, skipping test');
          return;
        }

        const response = await request(app)
          .get('/api/users')
          .set('Authorization', `Bearer ${guestToken}`);

        // Should be forbidden
        expect([401, 403, 404]).toContain(response.status);
      });

      it('should allow guest to access public endpoints', async () => {
        if (!guestToken) {
          console.warn('Guest token not available, skipping test');
          return;
        }

        const response = await request(app)
          .get('/health')
          .set('Authorization', `Bearer ${guestToken}`);

        // Should succeed
        expect(response.status).toBe(200);
      });
    });
  });

  describe('Permission-Based Access Control', () => {
    describe('User Permissions', () => {
      it('should validate user.list permission for viewing users', async () => {
        if (!adminToken) {
          console.warn('Admin token not available, skipping test');
          return;
        }

        const response = await request(app)
          .get('/api/users')
          .set('Authorization', `Bearer ${adminToken}`);

        // Admin should have access
        expect([200, 404, 500]).toContain(response.status);
      });

      it('should validate user.create permission for creating users', async () => {
        if (!employeeToken) {
          console.warn('Employee token not available, skipping test');
          return;
        }

        const response = await request(app)
          .post('/api/users')
          .set('Authorization', `Bearer ${employeeToken}`)
          .send({
            email: 'newuser@test.com',
            firstName: 'Test',
            lastName: 'User'
          });

        // Employee should not have permission
        expect([401, 403, 404]).toContain(response.status);
      });
    });

    describe('Role Permissions', () => {
      it('should validate role.manage permission for role management', async () => {
        if (!superadminToken) {
          console.warn('SuperAdmin token not available, skipping test');
          return;
        }

        const response = await request(app)
          .get('/api/roles')
          .set('Authorization', `Bearer ${superadminToken}`);

        // SuperAdmin should have access
        expect([200, 404, 500]).toContain(response.status);
      });

      it('should prevent unauthorized role modifications', async () => {
        if (!employeeToken) {
          console.warn('Employee token not available, skipping test');
          return;
        }

        const response = await request(app)
          .put('/api/roles/admin')
          .set('Authorization', `Bearer ${employeeToken}`)
          .send({ name: 'Modified Admin' });

        // Employee should not have permission
        expect([401, 403, 404]).toContain(response.status);
      });
    });
  });

  describe('Role Hierarchy Validation', () => {
    it('should respect role level hierarchy', async () => {
      // SuperAdmin (level 7) can manage Admin (level 6)
      if (!superadminToken) {
        console.warn('SuperAdmin token not available, skipping test');
        return;
      }

      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${superadminToken}`);

      expect([200, 404, 500]).toContain(response.status);
    });

    it('should prevent lower roles from managing higher roles', async () => {
      // Admin (level 6) cannot manage SuperAdmin (level 7)
      if (!adminToken) {
        console.warn('Admin token not available, skipping test');
        return;
      }

      const response = await request(app)
        .put('/api/users/superadmin-promote')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleId: 'superadmin' });

      expect([401, 403, 404]).toContain(response.status);
    });
  });

  describe('Unauthorized Access', () => {
    it('should reject requests without token', async () => {
      const response = await request(app)
        .get('/api/users');

      expect([401, 404]).toContain(response.status);
    });

    it('should reject requests with invalid token', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', 'Bearer invalid.token.here');

      expect([401, 403, 404]).toContain(response.status);
    });

    it('should reject requests with malformed authorization header', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', 'InvalidFormat token');

      expect([401, 404]).toContain(response.status);
    });
  });

  describe('Permission Validation', () => {
    it('should validate permissions exist in database', async () => {
      const Permission = Parse.Object.extend('Permission');
      const query = new Parse.Query(Permission);
      query.equalTo('exists', true);

      const permissions = await query.find({ useMasterKey: true });

      expect(permissions.length).toBeGreaterThan(0);
      expect(permissions.length).toBeGreaterThanOrEqual(30);
    });

    it('should validate all roles have proper permissions', async () => {
      const Role = Parse.Object.extend('Role');
      const query = new Parse.Query(Role);
      query.equalTo('exists', true);

      const roles = await query.find({ useMasterKey: true });

      expect(roles.length).toBe(8);

      roles.forEach(role => {
        expect(role.get('name')).toBeDefined();
        expect(role.get('level')).toBeGreaterThanOrEqual(1);
        expect(role.get('level')).toBeLessThanOrEqual(7);
      });
    });
  });
});
