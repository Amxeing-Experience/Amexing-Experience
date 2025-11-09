/**
 * Seed System Verification Tests
 *
 * Valida que el sistema de seed (TestDatabaseSeeder) funcione correctamente.
 * Estos tests verifican:
 * 1. Todos los roles del sistema fueron creados
 * 2. Todos los permisos fueron creados
 * 3. SuperAdmin fue creado correctamente
 * 4. Usuarios de prueba para todos los roles existen
 * 5. Autenticación funciona con todos los usuarios seeded
 * 6. Relaciones roleId están correctamente configuradas
 *
 * IMPORTANTE: Estos tests validan la inicialización de producción,
 * ya que usan la misma lógica de seed.
 *
 * @author Amexing Development Team
 * @version 1.0.0
 */

const Parse = require('parse/node');
const AmexingUser = require('../../src/domain/models/AmexingUser');
const Role = require('../../src/domain/models/Role');
const Permission = require('../../src/domain/models/Permission');
const AuthTestHelper = require('../helpers/authTestHelper');
const TestCleanupHelper = require('../helpers/testCleanupHelper');

describe('Seed System Verification', () => {
  // Ensure Parse SDK has master key access for these tests
  beforeAll(() => {
    Parse.initialize('test-app-id', null, 'test-master-key');
    Parse.serverURL = 'http://localhost:1339/parse';
    Parse.masterKey = 'test-master-key';
  });

  describe('RBAC System Seeding', () => {
    describe('System Roles', () => {
      test('should have all 8 system roles created', async () => {
        const query = new Parse.Query(Role);
        const roles = await query.find({ useMasterKey: true });

        expect(roles).toHaveLength(8);
      });

      test('should have roles with correct names', async () => {
        const expectedRoles = [
          'superadmin',
          'admin',
          'client',
          'department_manager',
          'employee',
          'employee_amexing',
          'driver',
          'guest'
        ];

        const query = new Parse.Query(Role);
        const roles = await query.find({ useMasterKey: true });
        const roleNames = roles.map(r => r.get('name')).sort();

        expect(roleNames).toEqual(expectedRoles.sort());
      });

      test('should have roles with correct hierarchy levels', async () => {
        const expectedLevels = {
          guest: 1,
          driver: 2,
          employee: 3,
          employee_amexing: 3,
          department_manager: 4,
          client: 5,
          admin: 6,
          superadmin: 7
        };

        const query = new Parse.Query(Role);
        const roles = await query.find({ useMasterKey: true });

        for (const role of roles) {
          const roleName = role.get('name');
          const level = role.get('level');

          expect(level).toBe(expectedLevels[roleName]);
        }
      });

      test('should have roles marked as system roles', async () => {
        const query = new Parse.Query(Role);
        const roles = await query.find({ useMasterKey: true });

        for (const role of roles) {
          expect(role.get('isSystemRole')).toBe(true);
          expect(role.get('active')).toBe(true);
          expect(role.get('exists')).toBe(true);
        }
      });

      test('should have roles with display names', async () => {
        const query = new Parse.Query(Role);
        const roles = await query.find({ useMasterKey: true });

        for (const role of roles) {
          expect(role.get('displayName')).toBeDefined();
          expect(role.get('displayName')).not.toBe('');
        }
      });
    });

    describe('System Permissions', () => {
      test('should have system permissions created', async () => {
        const query = new Parse.Query(Permission);
        const permissions = await query.find({ useMasterKey: true });

        expect(permissions.length).toBeGreaterThan(0);
      });

      test('should have permissions with required fields', async () => {
        const query = new Parse.Query(Permission);
        const permissions = await query.find({ useMasterKey: true });

        for (const permission of permissions) {
          expect(permission.get('name')).toBeDefined();
          expect(permission.get('description')).toBeDefined();
          expect(permission.get('resource')).toBeDefined();
          expect(permission.get('action')).toBeDefined();
        }
      });
    });
  });

  describe('SuperAdmin Seeding', () => {
    test('should have SuperAdmin user created', async () => {
      const query = new Parse.Query(AmexingUser);
      query.equalTo('email', 'test-superadmin@amexing.test');
      const superadmin = await query.first({ useMasterKey: true });

      expect(superadmin).toBeDefined();
      expect(superadmin).not.toBeNull();
    });

    test('should have SuperAdmin with correct role', async () => {
      const query = new Parse.Query(AmexingUser);
      query.equalTo('email', 'test-superadmin@amexing.test');
      query.include('roleId');
      const superadmin = await query.first({ useMasterKey: true });

      const roleId = superadmin.get('roleId');
      expect(roleId).toBeDefined();
      expect(roleId.get('name')).toBe('superadmin');
    });

    test('should have SuperAdmin with correct attributes', async () => {
      const query = new Parse.Query(AmexingUser);
      query.equalTo('email', 'test-superadmin@amexing.test');
      const superadmin = await query.first({ useMasterKey: true });

      expect(superadmin.get('firstName')).toBe('Test');
      expect(superadmin.get('lastName')).toBe('SuperAdmin');
      expect(superadmin.get('active')).toBe(true);
      expect(superadmin.get('exists')).toBe(true);
      expect(superadmin.get('emailVerified')).toBe(true);
    });

    test('should have SuperAdmin with test context data', async () => {
      const query = new Parse.Query(AmexingUser);
      query.equalTo('email', 'test-superadmin@amexing.test');
      const superadmin = await query.first({ useMasterKey: true });

      const contextualData = superadmin.get('contextualData');
      expect(contextualData).toBeDefined();
      expect(contextualData.isTestUser).toBe(true);
      expect(contextualData.clearanceLevel).toBe('top_secret');
      expect(contextualData.canOverrideSystem).toBe(true);
    });
  });

  describe('Test Users Seeding', () => {
    test('should have test users for all 8 roles', async () => {
      const query = new Parse.Query(AmexingUser);
      const users = await query.find({ useMasterKey: true });

      // Should have exactly 8 users (1 per role)
      expect(users.length).toBe(8);

      // Verify we have one user for each role using AuthTestHelper credentials
      const testUsers = AuthTestHelper.TEST_USERS;
      for (const [roleName, credentials] of Object.entries(testUsers)) {
        const userQuery = new Parse.Query(AmexingUser);
        userQuery.equalTo('email', credentials.email);
        const user = await userQuery.first({ useMasterKey: true });

        expect(user).toBeDefined();
      }
    });

    test('should have test users with correct role assignments', async () => {
      const testUsers = AuthTestHelper.TEST_USERS;

      for (const [roleName, credentials] of Object.entries(testUsers)) {
        const userQuery = new Parse.Query(AmexingUser);
        userQuery.equalTo('email', credentials.email);
        userQuery.include('roleId');
        const user = await userQuery.first({ useMasterKey: true });

        expect(user).toBeDefined();

        const roleId = user.get('roleId');
        expect(roleId).toBeDefined();
        expect(roleId.get('name')).toBe(credentials.role);
      }
    });

    test('should have test users marked as test users', async () => {
      const query = new Parse.Query(AmexingUser);
      const users = await query.find({ useMasterKey: true });

      for (const user of users) {
        const contextualData = user.get('contextualData');
        expect(contextualData).toBeDefined();
        expect(contextualData.isTestUser).toBe(true);
      }
    });

    test('should have test users with standard attributes', async () => {
      const query = new Parse.Query(AmexingUser);
      const users = await query.find({ useMasterKey: true });

      for (const user of users) {
        expect(user.get('active')).toBe(true);
        expect(user.get('exists')).toBe(true);
        expect(user.get('emailVerified')).toBe(true);
        expect(user.get('loginAttempts')).toBe(0);
        expect(user.get('mustChangePassword')).toBe(false);
      }
    });

    test('should have hierarchical users with correct organizational data', async () => {
      // Client user
      const clientQuery = new Parse.Query(AmexingUser);
      clientQuery.equalTo('email', 'test-client@amexing.test');
      const client = await clientQuery.first({ useMasterKey: true });

      expect(client.get('organizationId')).toBeDefined();
      expect(client.get('clientId')).toBeDefined();

      // Department Manager
      const managerQuery = new Parse.Query(AmexingUser);
      managerQuery.equalTo('email', 'test-department-manager@amexing.test');
      const manager = await managerQuery.first({ useMasterKey: true });

      expect(manager.get('organizationId')).toBeDefined();
      expect(manager.get('clientId')).toBeDefined();
      expect(manager.get('departmentId')).toBeDefined();

      // Employee
      const employeeQuery = new Parse.Query(AmexingUser);
      employeeQuery.equalTo('email', 'test-employee@amexing.test');
      const employee = await employeeQuery.first({ useMasterKey: true });

      expect(employee.get('organizationId')).toBeDefined();
      expect(employee.get('clientId')).toBeDefined();
      expect(employee.get('departmentId')).toBeDefined();
    });
  });

  describe('Authentication Verification', () => {
    test('should allow authentication with all test users', async () => {
      const testUsers = AuthTestHelper.TEST_USERS;

      for (const [roleName, credentials] of Object.entries(testUsers)) {
        try {
          // Use AuthTestHelper to login (no app, uses Parse SDK method)
          const token = await AuthTestHelper.loginAs(roleName);
          expect(token).toBeDefined();
          expect(typeof token).toBe('string');
          expect(token.length).toBeGreaterThan(0);
        } catch (error) {
          throw new Error(`Failed to login as ${roleName}: ${error.message}`);
        }
      }
    });

    test('should get valid session tokens for all roles', async () => {
      const testUsers = AuthTestHelper.TEST_USERS;

      for (const [roleName, credentials] of Object.entries(testUsers)) {
        try {
          const token = await AuthTestHelper.loginAs(roleName);
          expect(token).toBeDefined();
          expect(typeof token).toBe('string');
          expect(token.length).toBeGreaterThan(0);
        } catch (error) {
          throw new Error(`Failed to get token for ${roleName}: ${error.message}`);
        }
      }
    });

    test('should verify user roles match credentials', async () => {
      const testUsers = AuthTestHelper.TEST_USERS;

      for (const [roleName, credentials] of Object.entries(testUsers)) {
        const isValid = await AuthTestHelper.verifyUserRole(credentials.email, credentials.role);
        expect(isValid).toBe(true);
      }
    });
  });

  describe('Data Integrity Verification', () => {
    test('should have valid roleId references (no broken pointers)', async () => {
      const query = new Parse.Query(AmexingUser);
      query.include('roleId');
      const users = await query.find({ useMasterKey: true });

      for (const user of users) {
        const roleId = user.get('roleId');
        expect(roleId).toBeDefined();
        expect(roleId.id).toBeDefined();
        expect(roleId.get('name')).toBeDefined();
      }
    });

    test('should have unique email addresses', async () => {
      const query = new Parse.Query(AmexingUser);
      const users = await query.find({ useMasterKey: true });

      const emails = users.map(u => u.get('email'));
      const uniqueEmails = [...new Set(emails)];

      expect(uniqueEmails.length).toBe(emails.length);
    });

    test('should have valid test domain emails', async () => {
      const query = new Parse.Query(AmexingUser);
      const users = await query.find({ useMasterKey: true });

      for (const user of users) {
        const email = user.get('email');
        expect(email).toContain('@amexing.test');
      }
    });

    test('should verify seeded data integrity via TestCleanupHelper', async () => {
      const verification = await TestCleanupHelper.verifySeededData();

      expect(verification.valid).toBe(true);
      expect(verification.users.found).toBe(verification.users.expected);
      expect(verification.users.missing).toHaveLength(0);
      expect(verification.roles.found).toBe(verification.roles.expected);
    });
  });

  describe('AuthTestHelper Integration', () => {
    test('should provide correct credentials for all roles', () => {
      const roles = AuthTestHelper.getAvailableRoles();

      expect(roles).toHaveLength(8);
      expect(roles).toContain('superadmin');
      expect(roles).toContain('admin');
      expect(roles).toContain('client');
      expect(roles).toContain('department_manager');
      expect(roles).toContain('employee');
      expect(roles).toContain('employee_amexing');
      expect(roles).toContain('driver');
      expect(roles).toContain('guest');
    });

    test('should get credentials for each role', () => {
      const roles = AuthTestHelper.getAvailableRoles();

      for (const role of roles) {
        const credentials = AuthTestHelper.getCredentials(role);

        expect(credentials).toBeDefined();
        expect(credentials.email).toBeDefined();
        expect(credentials.password).toBeDefined();
        expect(credentials.role).toBe(role);
      }
    });

    test('should get user objects for all roles', async () => {
      const roles = AuthTestHelper.getAvailableRoles();

      for (const role of roles) {
        const user = await AuthTestHelper.getUserByRole(role);

        expect(user).toBeDefined();
        expect(user.get('email')).toBeDefined();
      }
    });
  });

  describe('System Readiness', () => {
    test('should have complete test environment ready', async () => {
      // Verify roles
      const roleQuery = new Parse.Query(Role);
      const roles = await roleQuery.find({ useMasterKey: true });
      expect(roles.length).toBe(8);

      // Verify permissions
      const permQuery = new Parse.Query(Permission);
      const permissions = await permQuery.find({ useMasterKey: true });
      expect(permissions.length).toBeGreaterThan(0);

      // Verify users
      const userQuery = new Parse.Query(AmexingUser);
      const users = await userQuery.find({ useMasterKey: true });
      expect(users.length).toBe(8);

      // Verify all users can authenticate
      for (const role of AuthTestHelper.getAvailableRoles()) {
        const token = await AuthTestHelper.loginAs(role);
        expect(token).toBeDefined();
      }
    });

    test('should match production seed configuration', async () => {
      // This test ensures our test seed matches production init script
      const query = new Parse.Query(Role);
      query.equalTo('name', 'superadmin');
      const superadminRole = await query.first({ useMasterKey: true });

      expect(superadminRole.get('level')).toBe(7);
      expect(superadminRole.get('displayName')).toBe('Super Administrator');
      expect(superadminRole.get('description')).toContain('Full system access');
    });
  });
});
