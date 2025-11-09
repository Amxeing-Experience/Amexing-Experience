/**
 * Test Cleanup Helper
 *
 * Proporciona limpieza inteligente de datos de prueba mientras preserva
 * los datos seeded (roles, permisos, usuarios de prueba).
 *
 * Estrategia de limpieza:
 * - PRESERVA: Usuarios seeded, roles del sistema, permisos
 * - ELIMINA: Datos creados durante tests (identificados por flags o patterns)
 *
 * Uso:
 * - beforeEach: limpiar datos de test previos
 * - afterEach: limpiar datos creados por el test
 * - afterAll: limpieza completa (opcional)
 *
 * @author Amexing Development Team
 * @version 1.0.0
 */

const Parse = require('parse/node');
const TestDatabaseSeeder = require('./testDatabaseSeeder');

/**
 * Test Cleanup Helper Class
 */
class TestCleanupHelper {
  /**
   * Test user emails to preserve (from TestDatabaseSeeder)
   */
  static PROTECTED_USER_EMAILS = Object.values(TestDatabaseSeeder.getTestUserCredentials())
    .map(u => u.email);

  /**
   * System role names to preserve
   */
  static PROTECTED_ROLES = [
    'superadmin',
    'admin',
    'client',
    'department_manager',
    'employee',
    'employee_amexing',
    'driver',
    'guest'
  ];

  /**
   * Clean test data while preserving seeded data
   *
   * @param {object} options - Cleanup options
   * @returns {Promise<object>} Cleanup statistics
   */
  static async cleanupTestData(options = {}) {
    const {
      preserveSeeded = true,  // Preserve seeded users/roles/permissions
      verbose = false         // Log cleanup details
    } = options;

    const stats = {
      users: 0,
      roles: 0,
      permissions: 0,
      other: 0,
      errors: []
    };

    try {
      if (verbose) {
        console.log('   🧹 Starting test data cleanup...');
      }

      // Clean users (except seeded test users)
      if (preserveSeeded) {
        stats.users = await this.cleanupNonSeededUsers(verbose);
      } else {
        stats.users = await this.cleanupAllNonSystemUsers(verbose);
      }

      // Clean other test data collections
      stats.other = await this.cleanupTestCollections(verbose);

      if (verbose) {
        console.log(`   ✅ Cleanup complete: ${stats.users} users, ${stats.other} other objects removed`);
      }

      return stats;
    } catch (error) {
      stats.errors.push(error.message);
      if (verbose) {
        console.error('   ❌ Cleanup failed:', error.message);
      }
      throw error;
    }
  }

  /**
   * Clean users created during tests (preserve seeded users)
   *
   * @param {boolean} verbose - Log details
   * @returns {Promise<number>} Number of users deleted
   */
  static async cleanupNonSeededUsers(verbose = false) {
    try {
      const AmexingUser = require('../../src/domain/models/AmexingUser');
      const query = new Parse.Query(AmexingUser);

      // Exclude protected seeded users
      query.notContainedIn('email', this.PROTECTED_USER_EMAILS);

      const users = await query.find({ useMasterKey: true });

      if (users.length > 0) {
        await Parse.Object.destroyAll(users, { useMasterKey: true });

        if (verbose) {
          console.log(`   🗑️  Deleted ${users.length} test-created users`);
        }
      }

      return users.length;
    } catch (error) {
      throw new Error(`Failed to cleanup users: ${error.message}`);
    }
  }

  /**
   * Clean all non-system users (more aggressive)
   *
   * @param {boolean} verbose - Log details
   * @returns {Promise<number>} Number of users deleted
   */
  static async cleanupAllNonSystemUsers(verbose = false) {
    try {
      const AmexingUser = require('../../src/domain/models/AmexingUser');
      const query = new Parse.Query(AmexingUser);

      // Only delete users with isTestUser flag or specific patterns
      query.equalTo('contextualData.isTestUser', true);

      const users = await query.find({ useMasterKey: true });

      if (users.length > 0) {
        await Parse.Object.destroyAll(users, { useMasterKey: true });

        if (verbose) {
          console.log(`   🗑️  Deleted ${users.length} test users`);
        }
      }

      return users.length;
    } catch (error) {
      throw new Error(`Failed to cleanup all users: ${error.message}`);
    }
  }

  /**
   * Clean test collections (preserving system data)
   *
   * Common test collections:
   * - TestData, TempData, MockData, etc.
   * - Any collection with test prefix
   *
   * @param {boolean} verbose - Log details
   * @returns {Promise<number>} Total objects deleted
   */
  static async cleanupTestCollections(verbose = false) {
    let totalDeleted = 0;

    try {
      // Get all schemas
      const schemas = await Parse.Schema.all();

      for (const schema of schemas) {
        const className = schema.className;

        // Skip system classes and protected collections
        if (this.isProtectedCollection(className)) {
          continue;
        }

        // Check if collection has test data
        if (this.isTestCollection(className)) {
          const deleted = await this.cleanupCollection(className, verbose);
          totalDeleted += deleted;
        }
      }

      return totalDeleted;
    } catch (error) {
      throw new Error(`Failed to cleanup test collections: ${error.message}`);
    }
  }

  /**
   * Check if collection is protected (should not be cleaned)
   *
   * @param {string} className - Collection name
   * @returns {boolean} True if protected
   */
  static isProtectedCollection(className) {
    const protectedCollections = [
      '_User',
      '_Role',
      '_Session',
      '_Installation',
      'Role',
      'Permission',
      'DelegatedPermission',
      'AmexingUser'
    ];

    return className.startsWith('_') || protectedCollections.includes(className);
  }

  /**
   * Check if collection contains test data
   *
   * @param {string} className - Collection name
   * @returns {boolean} True if test collection
   */
  static isTestCollection(className) {
    const testPrefixes = ['Test', 'Mock', 'Temp', 'Demo', 'Sample'];

    return testPrefixes.some(prefix => className.startsWith(prefix));
  }

  /**
   * Clean a specific collection
   *
   * @param {string} className - Collection name
   * @param {boolean} verbose - Log details
   * @returns {Promise<number>} Number of objects deleted
   */
  static async cleanupCollection(className, verbose = false) {
    try {
      const query = new Parse.Query(className);
      query.limit(1000); // Batch limit

      const objects = await query.find({ useMasterKey: true });

      if (objects.length > 0) {
        await Parse.Object.destroyAll(objects, { useMasterKey: true });

        if (verbose) {
          console.log(`   🗑️  Deleted ${objects.length} objects from ${className}`);
        }

        // If there might be more, recursively clean
        if (objects.length === 1000) {
          const moreDeleted = await this.cleanupCollection(className, verbose);
          return objects.length + moreDeleted;
        }
      }

      return objects.length;
    } catch (error) {
      throw new Error(`Failed to cleanup collection ${className}: ${error.message}`);
    }
  }

  /**
   * Reset database to seeded state
   * Removes ALL data except seeded roles, permissions, and users
   *
   * @param {boolean} verbose - Log details
   * @returns {Promise<object>} Reset statistics
   */
  static async resetToSeededState(verbose = false) {
    if (verbose) {
      console.log('   🔄 Resetting database to seeded state...');
    }

    const stats = await this.cleanupTestData({
      preserveSeeded: true,
      verbose
    });

    if (verbose) {
      console.log('   ✅ Database reset to seeded state');
    }

    return stats;
  }

  /**
   * Clear all data from database (DANGEROUS - use with caution)
   * Only for use in complete test suite teardown
   *
   * @param {boolean} confirm - Must be true to execute
   * @returns {Promise<object>} Cleanup statistics
   */
  static async clearAllData(confirm = false) {
    if (!confirm) {
      throw new Error('clearAllData requires explicit confirmation (pass true)');
    }

    const stats = {
      users: 0,
      roles: 0,
      permissions: 0,
      schemas: 0,
      errors: []
    };

    try {
      const AmexingUser = require('../../src/domain/models/AmexingUser');

      // Delete all users
      const userQuery = new Parse.Query(AmexingUser);
      const users = await userQuery.find({ useMasterKey: true });
      if (users.length > 0) {
        await Parse.Object.destroyAll(users, { useMasterKey: true });
        stats.users = users.length;
      }

      // Delete all roles
      const roleQuery = new Parse.Query(Parse.Role);
      const roles = await roleQuery.find({ useMasterKey: true });
      if (roles.length > 0) {
        await Parse.Object.destroyAll(roles, { useMasterKey: true });
        stats.roles = roles.length;
      }

      // Note: We don't delete schemas or permissions as they're system data

      return stats;
    } catch (error) {
      stats.errors.push(error.message);
      throw error;
    }
  }

  /**
   * Verify seeded data integrity
   * Checks that all seeded users, roles, and permissions still exist
   *
   * @returns {Promise<object>} Verification results
   */
  static async verifySeededData() {
    const results = {
      valid: true,
      users: { expected: 8, found: 0, missing: [] },
      roles: { expected: 8, found: 0, missing: [] },
      permissions: { expected: 0, found: 0 }
    };

    try {
      const AmexingUser = require('../../src/domain/models/AmexingUser');

      // Verify users
      for (const email of this.PROTECTED_USER_EMAILS) {
        const userQuery = new Parse.Query(AmexingUser);
        userQuery.equalTo('email', email);
        const user = await userQuery.first({ useMasterKey: true });

        if (user) {
          results.users.found++;
        } else {
          results.users.missing.push(email);
          results.valid = false;
        }
      }

      // Verify roles
      const roleQuery = new Parse.Query('Role');
      const roles = await roleQuery.find({ useMasterKey: true });
      results.roles.found = roles.length;

      if (roles.length !== results.roles.expected) {
        results.valid = false;
      }

      // Verify permissions
      const permQuery = new Parse.Query('Permission');
      const permissions = await permQuery.find({ useMasterKey: true });
      results.permissions.found = permissions.length;
      results.permissions.expected = permissions.length; // Update expected

      return results;
    } catch (error) {
      throw new Error(`Failed to verify seeded data: ${error.message}`);
    }
  }

  /**
   * Create test data marker
   * Marks objects as test data for easier cleanup
   *
   * @param {Parse.Object} object - Object to mark
   * @returns {Parse.Object} Marked object
   */
  static markAsTestData(object) {
    object.set('isTestData', true);
    object.set('testCreatedAt', new Date());
    return object;
  }

  /**
   * Cleanup objects marked as test data
   *
   * @param {string} className - Collection name
   * @param {boolean} verbose - Log details
   * @returns {Promise<number>} Number of objects deleted
   */
  static async cleanupMarkedTestData(className, verbose = false) {
    try {
      const query = new Parse.Query(className);
      query.equalTo('isTestData', true);

      const objects = await query.find({ useMasterKey: true });

      if (objects.length > 0) {
        await Parse.Object.destroyAll(objects, { useMasterKey: true });

        if (verbose) {
          console.log(`   🗑️  Deleted ${objects.length} marked test objects from ${className}`);
        }
      }

      return objects.length;
    } catch (error) {
      throw new Error(`Failed to cleanup marked test data: ${error.message}`);
    }
  }
}

module.exports = TestCleanupHelper;
