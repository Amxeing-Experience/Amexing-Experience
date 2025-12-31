/**
 * Test Database Seeder
 *
 * Inicializa MongoDB Memory Server con datos completos del sistema para tests.
 * Reutiliza la lógica de inicialización de producción para garantizar consistencia.
 *
 * Este seeder:
 * 1. Crea el sistema RBAC completo (8 roles + permisos)
 * 2. Crea un SuperAdmin de prueba
 * 3. Crea usuarios de prueba para TODOS los roles
 * 4. Verifica que el seeding fue exitoso
 *
 * Los datos seeded son utilizados por todos los tests de integración,
 * validando además que el sistema de inicialización funciona correctamente.
 *
 * @author Amexing Development Team
 * @version 1.0.0
 */

const Parse = require('parse/node');
const AmexingUser = require('../../src/domain/models/AmexingUser');
const Role = require('../../src/domain/models/Role');
const Permission = require('../../src/domain/models/Permission');

/**
 * Test Database Seeder Class
 */
class TestDatabaseSeeder {
  constructor() {
    this.logger = {
      info: (msg) => console.log(`   ℹ️  ${msg}`),
      success: (msg) => console.log(`   ✅ ${msg}`),
      error: (msg) => console.error(`   ❌ ${msg}`),
      warn: (msg) => console.warn(`   ⚠️  ${msg}`)
    };

    this.createdRoles = {};
    this.createdPermissions = [];
    this.createdUsers = [];
  }

  /**
   * Seed Complete System
   * Master function that orchestrates all seeding operations
   */
  async seedCompleteSystem() {
    try {
      this.logger.info('Starting complete system seed...');

      // 1. Seed RBAC System (Roles + Permissions)
      await this.seedRBACSystem();

      // 2. Seed SuperAdmin User
      await this.seedSuperAdmin();

      // 3. Seed Test Users (all roles)
      await this.seedTestUsers();

      // 4. Seed Service Data (for pricing tests)
      // NOTE: These seeds are NOT executed by default to keep tests fast
      // They are only executed when testing seed functionality specifically
      // Uncomment to enable full service data seeding:
      // await this.seedServiceData();

      // 5. Verify seeding success
      await this.verifySeedData();

      this.logger.success('Complete system seed finished successfully');
      return {
        roles: this.createdRoles,
        permissions: this.createdPermissions,
        users: this.createdUsers
      };
    } catch (error) {
      this.logger.error(`Seed failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Seed Service Data
   * Executes RBAC seeds + seeds 001-007, 020-022 for service pricing system
   * WARNING: This is slow and should only be used for seed-specific tests
   */
  async seedServiceData() {
    this.logger.info('Seeding service data (this may take a while)...');

    // Import and run each seed directly
    const seeds = [
      // RBAC seeds (required for seed 022 user creation)
      { name: '000-seed-rbac-roles', path: '../../scripts/seeds/000-seed-rbac-roles.js' },
      { name: '000-seed-rbac-permissions', path: '../../scripts/seeds/000-seed-rbac-permissions.js' },
      // Service data seeds
      { name: '001-seed-service-types', path: '../../scripts/seeds/001-seed-service-types.js' },
      { name: '002-seed-pois-local', path: '../../scripts/seeds/002-seed-pois-local.js' },
      { name: '003-seed-pois-aeropuerto', path: '../../scripts/seeds/003-seed-pois-aeropuerto.js' },
      { name: '004-seed-pois-ciudades', path: '../../scripts/seeds/004-seed-pois-ciudades.js' },
      { name: '005-seed-rates', path: '../../scripts/seeds/005-seed-rates.js' },
      { name: '006-seed-vehicle-types', path: '../../scripts/seeds/006-seed-vehicle-types.js' },
      { name: '007-seed-services-from-csv', path: '../../scripts/seeds/007-seed-services-from-csv.js' },
      { name: '020-seed-services-catalog', path: '../../scripts/seeds/020-seed-services-catalog.js' },
      { name: '021-seed-rate-prices', path: '../../scripts/seeds/021-seed-rate-prices.js' },
      { name: '022-seed-client-prices', path: '../../scripts/seeds/022-seed-client-prices.js' }
    ];

    for (const seed of seeds) {
      try {
        this.logger.info(`Running seed: ${seed.name}`);
        const seedModule = require(seed.path);
        if (seedModule && typeof seedModule.run === 'function') {
          await seedModule.run();
        } else {
          this.logger.warn(`Seed ${seed.name} does not export a run() function`);
        }
      } catch (error) {
        this.logger.warn(`Seed ${seed.name} failed: ${error.message}`);
        // Continue with other seeds even if one fails
      }
    }

    this.logger.success('Service data seeded');
  }

  /**
   * Seed RBAC System
   * Creates all system roles and permissions
   */
  async seedRBACSystem() {
    this.logger.info('Seeding RBAC system...');

    // Create permissions first
    await this.createSystemPermissions();

    // Then create roles
    await this.createSystemRoles();

    this.logger.success(`RBAC system seeded: ${Object.keys(this.createdRoles).length} roles, ${this.createdPermissions.length} permissions`);
  }

  /**
   * Create System Permissions
   * Uses Permission.getSystemPermissions() to maintain consistency with production
   */
  async createSystemPermissions() {
    try {
      const systemPermissions = Permission.getSystemPermissions();
      this.logger.info(`Creating ${systemPermissions.length} system permissions...`);

      for (const permConfig of systemPermissions) {
        try {
          const permission = Permission.create(permConfig);
          const savedPermission = await permission.save(null, { useMasterKey: true });
          this.createdPermissions.push(savedPermission);
        } catch (error) {
          // Permission might already exist, log warning but continue
          this.logger.warn(`Permission ${permConfig.name} might already exist: ${error.message}`);
        }
      }

      this.logger.success(`Created ${this.createdPermissions.length} permissions`);
    } catch (error) {
      this.logger.error(`Failed to create permissions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create System Roles
   * Creates all 8 system roles matching production configuration
   */
  async createSystemRoles() {
    const systemRoles = [
      {
        name: 'guest',
        displayName: 'Frequent Client',
        description: 'Public access for service requests',
        level: 1,
        isSystemRole: true,
        active: true,
        exists: true,
      },
      {
        name: 'driver',
        displayName: 'Driver',
        description: 'Transportation service driver with mobile app access',
        level: 2,
        isSystemRole: true,
        active: true,
        exists: true,
      },
      {
        name: 'employee',
        displayName: 'Employee',
        description: 'Corporate client employee with departmental access',
        level: 3,
        isSystemRole: true,
        active: true,
        exists: true,
      },
      {
        name: 'employee_amexing',
        displayName: 'Amexing Employee',
        description: 'Internal Amexing staff (drivers, operators)',
        level: 3,
        isSystemRole: true,
        active: true,
        exists: true,
      },
      {
        name: 'department_manager',
        displayName: 'Agency',
        description: 'Department supervisor with delegation capabilities',
        level: 4,
        isSystemRole: true,
        active: true,
        exists: true,
      },
      {
        name: 'client',
        displayName: 'Agent',
        description: 'Organization administrator for client companies',
        level: 5,
        isSystemRole: true,
        active: true,
        exists: true,
      },
      {
        name: 'admin',
        displayName: 'Administrator',
        description: 'System administration and client management',
        level: 6,
        isSystemRole: true,
        active: true,
        exists: true,
      },
      {
        name: 'superadmin',
        displayName: 'Super Administrator',
        description: 'Full system access and administration',
        level: 7,
        isSystemRole: true,
        active: true,
        exists: true,
      },
    ];

    this.logger.info(`Creating ${systemRoles.length} system roles...`);

    for (const roleData of systemRoles) {
      try {
        const role = new Role();
        Object.keys(roleData).forEach(key => {
          role.set(key, roleData[key]);
        });

        const savedRole = await role.save(null, { useMasterKey: true });
        this.createdRoles[roleData.name] = savedRole;
      } catch (error) {
        this.logger.error(`Failed to create role ${roleData.name}: ${error.message}`);
        throw error;
      }
    }

    this.logger.success(`Created ${Object.keys(this.createdRoles).length} roles`);
  }

  /**
   * Seed SuperAdmin User
   * Creates the SuperAdmin test user
   */
  async seedSuperAdmin() {
    this.logger.info('Creating SuperAdmin test user...');

    try {
      const user = new AmexingUser();

      // Set basic fields
      user.set('username', 'test-superadmin@amexing.test');
      user.set('email', 'test-superadmin@amexing.test');
      user.set('firstName', 'Test');
      user.set('lastName', 'SuperAdmin');
      await user.setPassword('TestSuper2024!');

      // Set roleId as Parse Pointer to Role object
      user.set('roleId', this.createdRoles.superadmin);

      // Set other fields
      user.set('organizationId', 'amexing-test');
      user.set('active', true);
      user.set('exists', true);
      user.set('emailVerified', true);
      user.set('loginAttempts', 0);
      user.set('mustChangePassword', false);

      // Contextual data
      user.set('contextualData', {
        clearanceLevel: 'top_secret',
        canOverrideSystem: true,
        isTestUser: true
      });

      const savedUser = await user.save(null, { useMasterKey: true });
      this.createdUsers.push(savedUser);

      this.logger.success('SuperAdmin test user created');
    } catch (error) {
      this.logger.error(`Failed to create SuperAdmin: ${error.message}`);
      throw error;
    }
  }

  /**
   * Seed Test Users
   * Creates one test user for each role to enable complete testing
   */
  async seedTestUsers() {
    this.logger.info('Creating test users for all roles...');

    const testUserConfigs = [
      {
        username: 'test-admin@amexing.test',
        email: 'test-admin@amexing.test',
        password: 'TestAdmin2024!',
        firstName: 'Test',
        lastName: 'Administrator',
        roleName: 'admin',
        organizationId: 'amexing-test',
        contextualData: {
          regions: ['north', 'south', 'center'],
          specializations: ['client_management', 'operations'],
          isTestUser: true
        }
      },
      {
        username: 'test-client@amexing.test',
        email: 'test-client@amexing.test',
        password: 'TestClient2024!',
        firstName: 'Test',
        lastName: 'Client',
        roleName: 'client',
        organizationId: 'test-org-utq',
        clientId: 'test-client-utq',
        contextualData: {
          budgetLimit: 50000,
          approvalWorkflow: 'standard',
          preferredServices: ['premium', 'executive'],
          isTestUser: true
        }
      },
      {
        username: 'test-department-manager@amexing.test',
        email: 'test-department-manager@amexing.test',
        password: 'TestManager2024!',
        firstName: 'Test',
        lastName: 'Manager',
        roleName: 'department_manager',
        organizationId: 'test-org-nuba',
        clientId: 'test-client-nuba',
        departmentId: 'test-dept-events',
        contextualData: {
          budgetLimit: 15000,
          teamSize: 12,
          canDelegate: true,
          delegationLimit: 10000,
          isTestUser: true
        }
      },
      {
        username: 'test-employee@amexing.test',
        email: 'test-employee@amexing.test',
        password: 'TestEmployee2024!',
        firstName: 'Test',
        lastName: 'Employee',
        roleName: 'employee',
        organizationId: 'test-org-utq',
        clientId: 'test-client-utq',
        departmentId: 'test-dept-education',
        contextualData: {
          budgetLimit: 3000,
          experienceLevel: 'senior',
          specializations: ['conferences', 'academic_events'],
          isTestUser: true
        }
      },
      {
        username: 'test-employee-amexing@amexing.test',
        email: 'test-employee-amexing@amexing.test',
        password: 'TestEmployeeAmx2024!',
        firstName: 'Test',
        lastName: 'AmexingEmployee',
        roleName: 'employee_amexing',
        organizationId: 'amexing-test',
        contextualData: {
          licenseType: 'professional',
          vehicleAssignments: ['luxury-sedan', 'suv'],
          regions: ['queretaro', 'guanajuato'],
          rating: 4.8,
          isTestUser: true
        }
      },
      {
        username: 'test-driver@amexing.test',
        email: 'test-driver@amexing.test',
        password: 'TestDriver2024!',
        firstName: 'Test',
        lastName: 'Driver',
        roleName: 'driver',
        organizationId: 'amexing-test',
        contextualData: {
          licenseNumber: 'TEST-LIC-001',
          vehicleType: 'sedan',
          rating: 4.9,
          isTestUser: true
        }
      },
      {
        username: 'test-guest@amexing.test',
        email: 'test-guest@amexing.test',
        password: 'TestGuest2024!',
        firstName: 'Test',
        lastName: 'Guest',
        roleName: 'guest',
        organizationId: 'public',
        contextualData: {
          frequentTraveler: true,
          preferredServices: ['standard'],
          isTestUser: true
        }
      }
    ];

    for (const config of testUserConfigs) {
      try {
        const user = new AmexingUser();

        // Set basic fields
        user.set('username', config.username);
        user.set('email', config.email);
        user.set('firstName', config.firstName);
        user.set('lastName', config.lastName);
        await user.setPassword(config.password);

        // Set roleId as Parse Pointer
        const role = this.createdRoles[config.roleName];
        if (!role) {
          throw new Error(`Role ${config.roleName} not found`);
        }
        user.set('roleId', role);

        // Set organization and optional fields
        user.set('organizationId', config.organizationId);
        if (config.clientId) user.set('clientId', config.clientId);
        if (config.departmentId) user.set('departmentId', config.departmentId);

        // Set standard fields
        user.set('active', true);
        user.set('exists', true);
        user.set('emailVerified', true);
        user.set('loginAttempts', 0);
        user.set('mustChangePassword', false);

        // Set contextual data
        user.set('contextualData', config.contextualData);

        const savedUser = await user.save(null, { useMasterKey: true });
        this.createdUsers.push(savedUser);

      } catch (error) {
        this.logger.error(`Failed to create test user ${config.email}: ${error.message}`);
        throw error;
      }
    }

    this.logger.success(`Created ${testUserConfigs.length} test users`);
  }

  /**
   * Verify Seed Data
   * Validates that all required data was created successfully
   */
  async verifySeedData() {
    this.logger.info('Verifying seed data...');

    try {
      // Verify roles
      const roleQuery = new Parse.Query(Role);
      const roles = await roleQuery.find({ useMasterKey: true });
      if (roles.length !== 8) {
        throw new Error(`Expected 8 roles, found ${roles.length}`);
      }

      // Verify permissions
      const permQuery = new Parse.Query(Permission);
      const permissions = await permQuery.find({ useMasterKey: true });
      if (permissions.length === 0) {
        throw new Error('No permissions found');
      }

      // Verify users (SuperAdmin + 7 test users = 8 total)
      const userQuery = new Parse.Query(AmexingUser);
      const users = await userQuery.find({ useMasterKey: true });
      if (users.length !== 8) {
        throw new Error(`Expected 8 users, found ${users.length}`);
      }

      // Verify SuperAdmin exists
      const superAdminQuery = new Parse.Query(AmexingUser);
      superAdminQuery.equalTo('email', 'test-superadmin@amexing.test');
      const superAdmin = await superAdminQuery.first({ useMasterKey: true });
      if (!superAdmin) {
        throw new Error('SuperAdmin not found');
      }

      this.logger.success('Seed data verification passed');
      this.logger.info(`  - Roles: ${roles.length}`);
      this.logger.info(`  - Permissions: ${permissions.length}`);
      this.logger.info(`  - Users: ${users.length}`);
    } catch (error) {
      this.logger.error(`Seed verification failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get Test User Credentials
   * Returns credentials for all test users (useful for tests)
   */
  static getTestUserCredentials() {
    return {
      superadmin: {
        email: 'test-superadmin@amexing.test',
        password: 'TestSuper2024!',
        role: 'superadmin'
      },
      admin: {
        email: 'test-admin@amexing.test',
        password: 'TestAdmin2024!',
        role: 'admin'
      },
      client: {
        email: 'test-client@amexing.test',
        password: 'TestClient2024!',
        role: 'client'
      },
      department_manager: {
        email: 'test-department-manager@amexing.test',
        password: 'TestManager2024!',
        role: 'department_manager'
      },
      employee: {
        email: 'test-employee@amexing.test',
        password: 'TestEmployee2024!',
        role: 'employee'
      },
      employee_amexing: {
        email: 'test-employee-amexing@amexing.test',
        password: 'TestEmployeeAmx2024!',
        role: 'employee_amexing'
      },
      driver: {
        email: 'test-driver@amexing.test',
        password: 'TestDriver2024!',
        role: 'driver'
      },
      guest: {
        email: 'test-guest@amexing.test',
        password: 'TestGuest2024!',
        role: 'guest'
      }
    };
  }
}

module.exports = TestDatabaseSeeder;
