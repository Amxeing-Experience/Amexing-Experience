/**
 * Employees API Integration Tests
 * End-to-end tests for /api/employees endpoints with real Parse Server
 * Tests complete CRUD operations, RBAC permissions, and data persistence
 *
 * @author Amexing Development Team
 * @version 1.0.0
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('Employees API Integration Tests', () => {
  let app;
  let superadminToken;
  let adminToken;
  let employeeToken;
  let testEmployeeId;

  beforeAll(async () => {
    // Import app (Parse Server already running on port 1339 via MongoDB Memory Server)
    app = require('../../../src/index');

    // Wait for app initialization
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Login with seeded users using Parse SDK (no HTTP/CSRF needed)
    superadminToken = await AuthTestHelper.loginAs('superadmin');
    adminToken = await AuthTestHelper.loginAs('admin');
    employeeToken = await AuthTestHelper.loginAs('employee');
  }, 30000);

  afterAll(async () => {
    // Clean up test employee if created
    if (testEmployeeId) {
      try {
        const query = new Parse.Query('AmexingUser');
        const employee = await query.get(testEmployeeId, { useMasterKey: true });
        await employee.destroy({ useMasterKey: true });
      } catch (error) {
        // Employee might already be deleted
      }
    }
  });

  describe('GET /api/employees', () => {
    it('should return employees list for superadmin', async () => {
      const response = await request(app)
        .get('/api/employees')
        .set('Authorization', `Bearer ${superadminToken}`)
        .query({ page: 1, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('users');
      expect(response.body.data).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data.users)).toBe(true);
    });

    it('should return employees list for admin', async () => {
      const response = await request(app)
        .get('/api/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 403 for employee role', async () => {
      const response = await request(app)
        .get('/api/employees')
        .set('Authorization', `Bearer ${employeeToken}`)
        .query({ page: 1, limit: 10 });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      // Error message may vary: "Access denied" or "Insufficient role level"
      expect(response.body.error).toMatch(/Access denied|Insufficient role level/i);
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app).get('/api/employees').query({ page: 1, limit: 10 });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should filter by active status', async () => {
      const response = await request(app)
        .get('/api/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 10, active: true });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // All returned users should be active
      const users = response.body.data.users;
      if (users.length > 0) {
        users.forEach((user) => {
          expect(user.active).toBe(true);
        });
      }
    });

    it('should support pagination', async () => {
      const page1Response = await request(app)
        .get('/api/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 2 });

      expect(page1Response.status).toBe(200);
      expect(page1Response.body.data.pagination.page).toBe(1);
      expect(page1Response.body.data.pagination.limit).toBe(2);
    });
  });

  describe('POST /api/employees', () => {
    it('should create employee with superadmin', async () => {
      const employeeData = {
        email: `test-employee-${Date.now()}@amexing.test`,
        password: 'TestPass123!',
        firstName: 'Integration',
        lastName: 'Test',
        role: 'employee_amexing',
      };

      const response = await request(app)
        .post('/api/employees')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(employeeData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.employee).toBeDefined();
      expect(response.body.data.employee).toHaveProperty('id');
      expect(response.body.data.employee.email).toBe(employeeData.email);

      // Store ID for cleanup
      testEmployeeId = response.body.data.employee.id;
    });

    it('should return 400 if required fields missing', async () => {
      const invalidData = {
        email: 'incomplete@test.com',
        // Missing password, firstName, lastName
      };

      const response = await request(app)
        .post('/api/employees')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 403 for employee role', async () => {
      const employeeData = {
        email: 'unauthorized@test.com',
        password: 'TestPass123!',
        firstName: 'Unauthorized',
        lastName: 'Test',
      };

      const response = await request(app)
        .post('/api/employees')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send(employeeData);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /api/employees/:id/toggle-status', () => {
    let employeeToToggle;

    beforeAll(async () => {
      // Get a seeded employee to toggle
      const credentials = AuthTestHelper.getCredentials('employee_amexing');
      const query = new Parse.Query('AmexingUser');
      query.equalTo('email', credentials.email);
      query.equalTo('exists', true);
      employeeToToggle = await query.first({ useMasterKey: true });
    });

    it('should toggle employee status with admin', async () => {
      const originalStatus = employeeToToggle.get('active');
      const newStatus = !originalStatus;

      const response = await request(app)
        .patch(`/api/employees/${employeeToToggle.id}/toggle-status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: newStatus });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain(newStatus ? 'activated' : 'deactivated');

      // Verify in database
      await employeeToToggle.fetch({ useMasterKey: true });
      expect(employeeToToggle.get('active')).toBe(newStatus);

      // Restore original status
      employeeToToggle.set('active', originalStatus);
      await employeeToToggle.save(null, { useMasterKey: true });
    });

    it('should toggle employee status with superadmin', async () => {
      const originalStatus = employeeToToggle.get('active');
      const newStatus = !originalStatus;

      const response = await request(app)
        .patch(`/api/employees/${employeeToToggle.id}/toggle-status`)
        .set('Authorization', `Bearer ${superadminToken}`)
        .send({ active: newStatus });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Restore original status
      employeeToToggle.set('active', originalStatus);
      await employeeToToggle.save(null, { useMasterKey: true });
    });

    it('should return 403 for employee role', async () => {
      const response = await request(app)
        .patch(`/api/employees/${employeeToToggle.id}/toggle-status`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ active: false });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 if active is not boolean', async () => {
      const response = await request(app)
        .patch(`/api/employees/${employeeToToggle.id}/toggle-status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('boolean');
    });

    it('should return error for non-existent employee', async () => {
      const response = await request(app)
        .patch('/api/employees/nonexistent123/toggle-status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false });

      // Service throws error when user not found, resulting in 500
      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });

    it('should persist status change across queries', async () => {
      const originalStatus = employeeToToggle.get('active');
      const newStatus = !originalStatus;

      // Toggle status
      await request(app)
        .patch(`/api/employees/${employeeToToggle.id}/toggle-status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: newStatus });

      // Verify with fresh query
      const verifyQuery = new Parse.Query('AmexingUser');
      const verifiedEmployee = await verifyQuery.get(employeeToToggle.id, { useMasterKey: true });

      expect(verifiedEmployee.get('active')).toBe(newStatus);
      expect(verifiedEmployee.get('exists')).toBe(true); // Should not be deleted

      // Restore
      employeeToToggle.set('active', originalStatus);
      await employeeToToggle.save(null, { useMasterKey: true });
    });
  });

  describe('PUT /api/employees/:id', () => {
    let employeeToUpdate;

    beforeAll(async () => {
      // Get a seeded employee to update
      const credentials = AuthTestHelper.getCredentials('employee_amexing');
      const query = new Parse.Query('AmexingUser');
      query.equalTo('email', credentials.email);
      query.equalTo('exists', true);
      employeeToUpdate = await query.first({ useMasterKey: true });
    });

    it('should update employee with admin', async () => {
      const originalFirstName = employeeToUpdate.get('firstName');
      const updateData = {
        firstName: 'UpdatedName',
        lastName: 'UpdatedLastName',
      };

      const response = await request(app)
        .put(`/api/employees/${employeeToUpdate.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify in database
      await employeeToUpdate.fetch({ useMasterKey: true });
      expect(employeeToUpdate.get('firstName')).toBe('UpdatedName');

      // Restore
      employeeToUpdate.set('firstName', originalFirstName);
      await employeeToUpdate.save(null, { useMasterKey: true });
    });

    it('should prevent role change', async () => {
      const response = await request(app)
        .put(`/api/employees/${employeeToUpdate.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'admin' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Cannot change employee role');
    });

    it('should return 403 for employee role', async () => {
      const response = await request(app)
        .put(`/api/employees/${employeeToUpdate.id}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ firstName: 'Unauthorized' });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /api/employees/:id', () => {
    let employeeToDelete;

    beforeEach(async () => {
      // Create a temporary employee for deletion test
      employeeToDelete = new Parse.Object('AmexingUser');
      employeeToDelete.set('username', `delete-test-${Date.now()}@amexing.test`);
      employeeToDelete.set('email', `delete-test-${Date.now()}@amexing.test`);
      employeeToDelete.set('password', 'TestPass123!');
      employeeToDelete.set('firstName', 'Delete');
      employeeToDelete.set('lastName', 'Test');
      employeeToDelete.set('role', 'employee_amexing');
      employeeToDelete.set('active', true);
      employeeToDelete.set('exists', true);
      await employeeToDelete.save(null, { useMasterKey: true });
    });

    it('should soft delete employee with admin', async () => {
      const response = await request(app)
        .delete(`/api/employees/${employeeToDelete.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify soft delete in database
      await employeeToDelete.fetch({ useMasterKey: true });
      expect(employeeToDelete.get('exists')).toBe(false);
      expect(employeeToDelete.get('active')).toBe(false);
      expect(employeeToDelete.get('deletedAt')).toBeDefined();
    });

    it('should soft delete employee with superadmin', async () => {
      const response = await request(app)
        .delete(`/api/employees/${employeeToDelete.id}`)
        .set('Authorization', `Bearer ${superadminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify soft delete
      await employeeToDelete.fetch({ useMasterKey: true });
      expect(employeeToDelete.get('exists')).toBe(false);
    });

    it('should return 403 for employee role', async () => {
      const response = await request(app)
        .delete(`/api/employees/${employeeToDelete.id}`)
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it('should not physically delete from database', async () => {
      await request(app)
        .delete(`/api/employees/${employeeToDelete.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Verify record still exists in database (soft deleted)
      const query = new Parse.Query('AmexingUser');
      const deletedEmployee = await query.get(employeeToDelete.id, { useMasterKey: true });

      expect(deletedEmployee).toBeDefined();
      expect(deletedEmployee.get('exists')).toBe(false);
    });
  });

  describe('Permission Hierarchy Tests', () => {
    it('should prevent employee from modifying other employees', async () => {
      const credentials = AuthTestHelper.getCredentials('employee_amexing');
      const query = new Parse.Query('AmexingUser');
      query.equalTo('email', credentials.email);
      const targetEmployee = await query.first({ useMasterKey: true });

      const response = await request(app)
        .patch(`/api/employees/${targetEmployee.id}/toggle-status`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ active: false });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it('should allow admin to modify employee_amexing', async () => {
      const credentials = AuthTestHelper.getCredentials('employee_amexing');
      const query = new Parse.Query('AmexingUser');
      query.equalTo('email', credentials.email);
      const targetEmployee = await query.first({ useMasterKey: true });

      const originalStatus = targetEmployee.get('active');
      const newStatus = !originalStatus;

      const response = await request(app)
        .patch(`/api/employees/${targetEmployee.id}/toggle-status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: newStatus });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Restore
      targetEmployee.set('active', originalStatus);
      await targetEmployee.save(null, { useMasterKey: true });
    });
  });
});
