/**
 * UserManagementService Integration Tests
 * End-to-end tests for UserManagementService with real Parse Server and MongoDB
 * Tests permission validation, role hierarchy, and data persistence
 *
 * @author Amexing Development Team
 * @version 1.0.0
 */

const Parse = require('parse/node');
const UserManagementService = require('../../../src/application/services/UserManagementService');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('UserManagementService Integration Tests', () => {
  let userService;
  let superadminUser;
  let adminUser;
  let employeeUser;
  let testEmployee;

  beforeAll(async () => {
    // Initialize Parse SDK
    Parse.initialize('test-app-id', null, 'test-master-key');
    Parse.serverURL = 'http://localhost:1339/parse';
    Parse.masterKey = 'test-master-key';

    // Initialize service
    userService = new UserManagementService();

    // Get seeded users for testing
    const superadminCreds = AuthTestHelper.getCredentials('superadmin');
    const adminCreds = AuthTestHelper.getCredentials('admin');
    const employeeCreds = AuthTestHelper.getCredentials('employee');

    const superadminQuery = new Parse.Query('AmexingUser');
    superadminQuery.equalTo('email', superadminCreds.email);
    superadminUser = await superadminQuery.first({ useMasterKey: true });
    // Add role property for service compatibility
    superadminUser.role = 'superadmin';

    const adminQuery = new Parse.Query('AmexingUser');
    adminQuery.equalTo('email', adminCreds.email);
    adminUser = await adminQuery.first({ useMasterKey: true });
    // Add role property for service compatibility
    adminUser.role = 'admin';

    const employeeQuery = new Parse.Query('AmexingUser');
    employeeQuery.equalTo('email', employeeCreds.email);
    employeeUser = await employeeQuery.first({ useMasterKey: true });
    // Add role property for service compatibility
    employeeUser.role = 'employee';

    // Create test employee for manipulation
    testEmployee = new Parse.Object('AmexingUser');
    testEmployee.set('username', `test-service-${Date.now()}@amexing.test`);
    testEmployee.set('email', `test-service-${Date.now()}@amexing.test`);
    testEmployee.set('password', 'TestPass123!');
    testEmployee.set('firstName', 'Service');
    testEmployee.set('lastName', 'Test');
    testEmployee.set('role', 'employee_amexing');
    testEmployee.set('active', true);
    testEmployee.set('exists', true);
    await testEmployee.save(null, { useMasterKey: true });
    // Add role property for service compatibility
    testEmployee.role = 'employee_amexing';
  }, 30000);

  afterAll(async () => {
    // Clean up test employee
    if (testEmployee) {
      try {
        await testEmployee.destroy({ useMasterKey: true });
      } catch (error) {
        // Employee might already be deleted
      }
    }
  });

  describe('toggleUserStatus', () => {
    beforeEach(async () => {
      // Reset test employee to active state
      testEmployee.set('active', true);
      testEmployee.set('exists', true);
      await testEmployee.save(null, { useMasterKey: true });
      // Ensure role property is set for service compatibility (lost after save/fetch)
      testEmployee.role = 'employee_amexing';
    });

    it('should toggle user status with admin permissions', async () => {
      // Admin has role property (enriched by controller)
      adminUser.role = 'admin';

      const result = await userService.toggleUserStatus(
        adminUser,
        testEmployee.id,
        false, // Deactivate
        'Integration test'
      );

      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();

      // Verify in database
      await testEmployee.fetch({ useMasterKey: true });
      expect(testEmployee.get('active')).toBe(false);
      expect(testEmployee.get('exists')).toBe(true); // Should not be soft deleted
    });

    it('should toggle user status with superadmin permissions', async () => {
      superadminUser.role = 'superadmin';

      const result = await userService.toggleUserStatus(
        superadminUser,
        testEmployee.id,
        false,
        'Integration test'
      );

      expect(result.success).toBe(true);

      await testEmployee.fetch({ useMasterKey: true });
      expect(testEmployee.get('active')).toBe(false);
    });

    it('should allow employee to toggle another employee (same level)', async () => {
      // Note: employee (level 3) can modify employee_amexing (level 3) - same hierarchy level
      employeeUser.role = 'employee';

      const result = await userService.toggleUserStatus(
        employeeUser,
        testEmployee.id,
        false,
        'Integration test'
      );

      // Employees of same level CAN modify each other according to role hierarchy
      expect(result.success).toBe(true);

      // Verify status changed
      await testEmployee.fetch({ useMasterKey: true });
      expect(testEmployee.get('active')).toBe(false);
    });

    it('should handle activation of inactive user', async () => {
      // Deactivate first
      testEmployee.set('active', false);
      await testEmployee.save(null, { useMasterKey: true });

      adminUser.role = 'admin';

      const result = await userService.toggleUserStatus(
        adminUser,
        testEmployee.id,
        true, // Activate
        'Integration test'
      );

      expect(result.success).toBe(true);

      await testEmployee.fetch({ useMasterKey: true });
      expect(testEmployee.get('active')).toBe(true);
    });

    it('should throw error for non-existent user', async () => {
      adminUser.role = 'admin';

      // Service throws error when user not found (Parse.Object.get throws)
      await expect(
        userService.toggleUserStatus(
          adminUser,
          'nonexistent123',
          false,
          'Integration test'
        )
      ).rejects.toThrow();
    });

    it('should maintain exists: true during toggle', async () => {
      adminUser.role = 'admin';

      // Toggle to inactive
      await userService.toggleUserStatus(adminUser, testEmployee.id, false, 'Test');

      await testEmployee.fetch({ useMasterKey: true });
      expect(testEmployee.get('active')).toBe(false);
      expect(testEmployee.get('exists')).toBe(true); // Must remain true

      // Toggle back to active
      await userService.toggleUserStatus(adminUser, testEmployee.id, true, 'Test');

      await testEmployee.fetch({ useMasterKey: true });
      expect(testEmployee.get('active')).toBe(true);
      expect(testEmployee.get('exists')).toBe(true);
    });
  });

  describe('canModifyUser', () => {
    it('should allow admin to modify employee', async () => {
      adminUser.role = 'admin';

      const canModify = userService.canModifyUser(adminUser, testEmployee);

      expect(canModify).toBe(true);
    });

    it('should allow superadmin to modify admin', async () => {
      superadminUser.role = 'superadmin';

      const canModify = userService.canModifyUser(superadminUser, adminUser);

      expect(canModify).toBe(true);
    });

    it('should deny employee to modify admin', async () => {
      employeeUser.role = 'employee';

      const canModify = userService.canModifyUser(employeeUser, adminUser);

      expect(canModify).toBe(false);
    });

    it('should allow employee to modify another employee (same level)', async () => {
      // employee (level 3) can modify employee_amexing (level 3) - same hierarchy level
      employeeUser.role = 'employee';

      const canModify = userService.canModifyUser(employeeUser, testEmployee);

      // Employees of same level CAN modify each other according to role hierarchy
      expect(canModify).toBe(true);
    });

    it('should deny admin to modify superadmin', async () => {
      adminUser.role = 'admin';

      const canModify = userService.canModifyUser(adminUser, superadminUser);

      expect(canModify).toBe(false);
    });

    it('should handle currentUser without role property', async () => {
      // Simulate middleware scenario where role is in .get() method
      const userWithoutRoleProperty = {
        id: adminUser.id,
        get: (field) => {
          if (field === 'role') return 'admin';
          return null;
        },
      };

      const canModify = userService.canModifyUser(userWithoutRoleProperty, testEmployee);

      expect(canModify).toBe(true);
    });

    it('should use role property if available', async () => {
      adminUser.role = 'admin';

      const canModify = userService.canModifyUser(adminUser, testEmployee);

      expect(canModify).toBe(true);
    });
  });

  describe('deactivateUser', () => {
    beforeEach(async () => {
      // Reset test employee
      testEmployee.set('active', true);
      testEmployee.set('exists', true);
      testEmployee.unset('deletedAt');
      testEmployee.unset('deletedBy');
      await testEmployee.save(null, { useMasterKey: true });
      // Ensure role property is set for service compatibility (lost after save/fetch)
      testEmployee.role = 'employee_amexing';
    });

    it('should soft delete user with admin', async () => {
      adminUser.role = 'admin';

      const result = await userService.deactivateUser(
        testEmployee.id,
        adminUser,
        'Integration test deactivation'
      );

      expect(result).toBe(true);

      // Verify soft delete
      await testEmployee.fetch({ useMasterKey: true });
      expect(testEmployee.get('active')).toBe(false);
      expect(testEmployee.get('exists')).toBe(false);
      expect(testEmployee.get('deletedAt')).toBeDefined();
      expect(testEmployee.get('deletedBy')).toBeDefined();
    });

    it('should not physically delete from database', async () => {
      adminUser.role = 'admin';

      await userService.deactivateUser(testEmployee.id, adminUser, 'Test');

      // Verify record still exists
      const query = new Parse.Query('AmexingUser');
      const deletedUser = await query.get(testEmployee.id, { useMasterKey: true });

      expect(deletedUser).toBeDefined();
      expect(deletedUser.get('exists')).toBe(false);
    });

    it('should allow employee to deactivate another employee (same level)', async () => {
      // employee (level 3) can deactivate employee_amexing (level 3) - same hierarchy level
      employeeUser.role = 'employee';

      const result = await userService.deactivateUser(testEmployee.id, employeeUser, 'Test');

      // Employees of same level CAN deactivate each other according to role hierarchy
      expect(result).toBe(true);

      // Verify user was deactivated
      await testEmployee.fetch({ useMasterKey: true });
      expect(testEmployee.get('active')).toBe(false);
      expect(testEmployee.get('exists')).toBe(false);
    });

    it('should prevent self-deactivation', async () => {
      adminUser.role = 'admin';

      await expect(
        userService.deactivateUser(adminUser.id, adminUser, 'Test')
      ).rejects.toThrow('Cannot deactivate your own account');
    });
  });

  describe('reactivateUser', () => {
    beforeEach(async () => {
      // Soft delete test employee first
      testEmployee.set('active', false);
      testEmployee.set('exists', false);
      testEmployee.set('deletedAt', new Date());
      await testEmployee.save(null, { useMasterKey: true });
      // Ensure role property is set for service compatibility
      testEmployee.role = 'employee_amexing';
    });

    it('should reactivate soft deleted user with admin', async () => {
      adminUser.role = 'admin';

      const result = await userService.reactivateUser(
        testEmployee.id,
        adminUser,
        'Integration test reactivation'
      );

      expect(result).toBe(true);

      // Verify reactivation
      await testEmployee.fetch({ useMasterKey: true });
      expect(testEmployee.get('active')).toBe(true);
      expect(testEmployee.get('exists')).toBe(true);
    });

    it('should allow employee to reactivate another employee (same level)', async () => {
      // employee (level 3) can reactivate employee_amexing (level 3) - same hierarchy level
      employeeUser.role = 'employee';

      const result = await userService.reactivateUser(testEmployee.id, employeeUser, 'Test');

      // Employees of same level CAN reactivate each other according to role hierarchy
      expect(result).toBe(true);

      // Verify user was reactivated
      await testEmployee.fetch({ useMasterKey: true });
      expect(testEmployee.get('active')).toBe(true);
      expect(testEmployee.get('exists')).toBe(true);
    });

    it('should throw error when trying to reactivate already active user', async () => {
      // First reactivate from soft-deleted state
      adminUser.role = 'admin';
      await userService.reactivateUser(testEmployee.id, adminUser, 'Test 1');

      // Verify user is now active (exists: true, active: true)
      await testEmployee.fetch({ useMasterKey: true });
      expect(testEmployee.get('active')).toBe(true);
      expect(testEmployee.get('exists')).toBe(true);

      // Try to reactivate again - should fail because user is not in soft-deleted state
      // reactivateUser only works on users with exists: false
      await expect(
        userService.reactivateUser(testEmployee.id, adminUser, 'Test 2')
      ).rejects.toThrow('Object not found');
    });
  });

  describe('Role Hierarchy Validation', () => {
    it('should respect role hierarchy in modification', async () => {
      const hierarchy = {
        superadmin: 7,
        admin: 6,
        client: 5,
        department_manager: 4,
        employee: 3,
        employee_amexing: 3,
        driver: 2,
        guest: 1,
      };

      // Superadmin can modify admin
      superadminUser.role = 'superadmin';
      expect(userService.canModifyUser(superadminUser, adminUser)).toBe(true);

      // Admin can modify employee
      adminUser.role = 'admin';
      expect(userService.canModifyUser(adminUser, testEmployee)).toBe(true);

      // Employee cannot modify admin
      employeeUser.role = 'employee';
      expect(userService.canModifyUser(employeeUser, adminUser)).toBe(false);

      // Verify hierarchy levels are correct
      expect(hierarchy.superadmin).toBeGreaterThan(hierarchy.admin);
      expect(hierarchy.admin).toBeGreaterThan(hierarchy.employee);
    });

    it('should prevent modification of higher role levels', async () => {
      // Admin (level 6) trying to modify superadmin (level 7)
      adminUser.role = 'admin';

      const canModify = userService.canModifyUser(adminUser, superadminUser);

      expect(canModify).toBe(false);
    });

    it('should allow modification of same role level', async () => {
      // Admin (level 6) can modify another admin (level 6)
      const anotherAdmin = new Parse.Object('AmexingUser');
      anotherAdmin.set('role', 'admin');

      adminUser.role = 'admin';

      const canModify = userService.canModifyUser(adminUser, anotherAdmin);

      expect(canModify).toBe(true);
    });
  });

  describe('Data Persistence Verification', () => {
    it('should persist status changes across multiple queries', async () => {
      adminUser.role = 'admin';

      // Toggle off
      await userService.toggleUserStatus(adminUser, testEmployee.id, false, 'Test');

      // Query 1
      const query1 = new Parse.Query('AmexingUser');
      const user1 = await query1.get(testEmployee.id, { useMasterKey: true });
      expect(user1.get('active')).toBe(false);

      // Query 2
      const query2 = new Parse.Query('AmexingUser');
      const user2 = await query2.get(testEmployee.id, { useMasterKey: true });
      expect(user2.get('active')).toBe(false);

      // Toggle on
      await userService.toggleUserStatus(adminUser, testEmployee.id, true, 'Test');

      // Query 3
      const query3 = new Parse.Query('AmexingUser');
      const user3 = await query3.get(testEmployee.id, { useMasterKey: true });
      expect(user3.get('active')).toBe(true);
    });

    it('should persist soft delete state', async () => {
      adminUser.role = 'admin';

      await userService.deactivateUser(testEmployee.id, adminUser, 'Test');

      // Multiple queries should all see soft deleted state
      for (let i = 0; i < 3; i++) {
        const query = new Parse.Query('AmexingUser');
        const user = await query.get(testEmployee.id, { useMasterKey: true });
        expect(user.get('exists')).toBe(false);
        expect(user.get('active')).toBe(false);
      }
    });
  });
});
