#!/usr/bin/env node

/**
 * Migration Script 001: Create Advanced RBAC System
 *
 * This migration creates the new Role-Based Access Control system:
 * - Creates Role, Permission, and DelegatedPermission models
 * - Populates system roles and permissions
 * - Migrates existing users from role string to roleId
 * - Maintains backward compatibility during transition
 *
 * CRITICAL SAFETY FEATURES:
 * - Backup creation before migration
 * - Rollback capability
 * - Non-destructive approach (keeps old role field temporarily)
 * - Comprehensive error handling and logging
 *
 * Usage:
 *   node scripts/migrations/001-create-rbac-system.js [--rollback] [--dry-run]
 *
 * Options:
 *   --dry-run: Show what would be done without making changes
 *   --rollback: Reverse the migration (restore from backup)
 *   --force: Skip confirmation prompts (use with caution)
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-09-24
 */

require('dotenv').config({
  path: `./environments/.env.${process.env.NODE_ENV || 'development'}`,
});

const Parse = require('parse/node');
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

// Import models
const Role = require('../../src/domain/models/Role');
const Permission = require('../../src/domain/models/Permission');
const DelegatedPermission = require('../../src/domain/models/DelegatedPermission');
const AmexingUser = require('../../src/domain/models/AmexingUser');

// Migration configuration
const MIGRATION_CONFIG = {
  name: '001-create-rbac-system',
  version: '1.0.0',
  description: 'Create advanced RBAC system with roles, permissions, and delegation',
  backupDir: './backups/migrations',
  logFile: './logs/migration-001.log'
};

// Command line options
const options = {
  dryRun: process.argv.includes('--dry-run'),
  rollback: process.argv.includes('--rollback'),
  force: process.argv.includes('--force'),
  verbose: process.argv.includes('--verbose')
};

/**
 * Logger utility for migration tracking
 */
class MigrationLogger {
  constructor(logFile) {
    this.logFile = logFile;
    this.logs = [];
  }

  log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      data: Object.keys(data).length > 0 ? data : undefined
    };

    this.logs.push(logEntry);

    if (options.verbose || level === 'error') {
      console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
      if (Object.keys(data).length > 0) {
        console.log('  Data:', JSON.stringify(data, null, 2));
      }
    }
  }

  async save() {
    try {
      const logDir = path.dirname(this.logFile);
      await fs.mkdir(logDir, { recursive: true });
      await fs.writeFile(this.logFile, JSON.stringify(this.logs, null, 2));
      console.log(`Migration log saved to: ${this.logFile}`);
    } catch (error) {
      console.error('Failed to save migration log:', error.message);
    }
  }

  error(message, data = {}) { this.log('error', message, data); }
  warn(message, data = {}) { this.log('warn', message, data); }
  info(message, data = {}) { this.log('info', message, data); }
  success(message, data = {}) { this.log('success', message, data); }
}

const logger = new MigrationLogger(MIGRATION_CONFIG.logFile);

/**
 * Initialize Parse Server connection
 */
async function initializeParse() {
  try {
    Parse.initialize(process.env.PARSE_APP_ID, process.env.PARSE_JS_KEY, process.env.PARSE_MASTER_KEY);
    Parse.serverURL = process.env.PARSE_SERVER_URL;

    // Test connection
    await Parse.User.current();
    logger.success('Parse Server connection established');
    return true;
  } catch (error) {
    logger.error('Parse Server connection failed', { error: error.message });
    return false;
  }
}

/**
 * Create backup of current data
 */
async function createBackup() {
  try {
    logger.info('Creating data backup before migration...');

    const backupData = {
      timestamp: new Date().toISOString(),
      migration: MIGRATION_CONFIG.name,
      users: [],
      metadata: {
        userCount: 0,
        roleDistribution: {}
      }
    };

    // Backup all users
    const userQuery = new Parse.Query('AmexingUser');
    userQuery.limit(1000);
    const users = await userQuery.find({ useMasterKey: true });

    const roleDistribution = {};
    for (const user of users) {
      const userData = {
        objectId: user.id,
        username: user.get('username'),
        email: user.get('email'),
        role: user.get('role'), // Old role field
        firstName: user.get('firstName'),
        lastName: user.get('lastName'),
        active: user.get('active'),
        exists: user.get('exists'),
        clientId: user.get('clientId'),
        departmentId: user.get('departmentId'),
        createdAt: user.get('createdAt'),
        updatedAt: user.get('updatedAt')
      };

      backupData.users.push(userData);

      // Count role distribution
      const role = userData.role || 'undefined';
      roleDistribution[role] = (roleDistribution[role] || 0) + 1;
    }

    backupData.metadata.userCount = users.length;
    backupData.metadata.roleDistribution = roleDistribution;

    // Save backup
    const backupDir = MIGRATION_CONFIG.backupDir;
    await fs.mkdir(backupDir, { recursive: true });

    const backupFile = path.join(backupDir, `backup-${MIGRATION_CONFIG.name}-${Date.now()}.json`);
    await fs.writeFile(backupFile, JSON.stringify(backupData, null, 2));

    logger.success('Backup created successfully', {
      file: backupFile,
      userCount: backupData.metadata.userCount,
      roleDistribution: backupData.metadata.roleDistribution
    });

    return backupFile;
  } catch (error) {
    logger.error('Failed to create backup', { error: error.message });
    throw error;
  }
}

/**
 * Create system roles
 */
async function createSystemRoles() {
  try {
    logger.info('Creating system roles...');

    const systemRoles = Role.getSystemRoles();
    const createdRoles = {};

    for (const roleData of systemRoles) {
      logger.info(`Creating role: ${roleData.name}`);

      // Check if role already exists
      const existingQuery = new Parse.Query('Role');
      existingQuery.equalTo('name', roleData.name);
      const existing = await existingQuery.first({ useMasterKey: true });

      if (existing) {
        logger.warn(`Role ${roleData.name} already exists, skipping`);
        createdRoles[roleData.name] = existing;
        continue;
      }

      if (options.dryRun) {
        logger.info(`[DRY RUN] Would create role: ${roleData.name}`);
        continue;
      }

      // Create role
      const role = Role.create(roleData);
      await role.save(null, { useMasterKey: true });

      createdRoles[roleData.name] = role;
      logger.success(`Role created: ${roleData.name} (ID: ${role.id})`);
    }

    logger.success(`System roles creation completed`, {
      total: systemRoles.length,
      created: Object.keys(createdRoles).length
    });

    return createdRoles;
  } catch (error) {
    logger.error('Failed to create system roles', { error: error.message });
    throw error;
  }
}

/**
 * Create system permissions
 */
async function createSystemPermissions() {
  try {
    logger.info('Creating system permissions...');

    const systemPermissions = Permission.getSystemPermissions();
    const createdPermissions = {};

    for (const permissionData of systemPermissions) {
      logger.info(`Creating permission: ${permissionData.name}`);

      // Check if permission already exists
      const existingQuery = new Parse.Query('Permission');
      existingQuery.equalTo('name', permissionData.name);
      const existing = await existingQuery.first({ useMasterKey: true });

      if (existing) {
        logger.warn(`Permission ${permissionData.name} already exists, skipping`);
        createdPermissions[permissionData.name] = existing;
        continue;
      }

      if (options.dryRun) {
        logger.info(`[DRY RUN] Would create permission: ${permissionData.name}`);
        continue;
      }

      // Create permission
      const permission = Permission.create(permissionData);
      await permission.save(null, { useMasterKey: true });

      createdPermissions[permissionData.name] = permission;
      logger.success(`Permission created: ${permissionData.name} (ID: ${permission.id})`);
    }

    logger.success('System permissions creation completed', {
      total: systemPermissions.length,
      created: Object.keys(createdPermissions).length
    });

    return createdPermissions;
  } catch (error) {
    logger.error('Failed to create system permissions', { error: error.message });
    throw error;
  }
}

/**
 * Migrate users from role string to roleId
 */
async function migrateUsers(createdRoles) {
  try {
    logger.info('Migrating users to new role system...');

    const userQuery = new Parse.Query('AmexingUser');
    userQuery.limit(1000);
    const users = await userQuery.find({ useMasterKey: true });

    const migrationStats = {
      total: users.length,
      migrated: 0,
      skipped: 0,
      errors: 0,
      roleMapping: {}
    };

    // Role mapping for migration
    const roleMapping = {
      'superadmin': 'superadmin',
      'admin': 'admin',
      'client': 'client',
      'manager': 'department_manager', // Fix inconsistency
      'department_manager': 'department_manager',
      'employee': 'employee',
      'driver': 'employee_amexing', // Map driver to employee_amexing
      'guest': 'guest',
      'user': 'guest' // Map generic user to guest
    };

    for (const user of users) {
      const currentRole = user.get('role') || 'guest';
      const targetRoleName = roleMapping[currentRole] || 'guest';

      logger.info(`Migrating user ${user.get('email')}: ${currentRole} -> ${targetRoleName}`);

      // Track migration stats
      migrationStats.roleMapping[currentRole] = (migrationStats.roleMapping[currentRole] || 0) + 1;

      // Check if user already has roleId
      if (user.get('roleId')) {
        logger.warn(`User ${user.get('email')} already has roleId, skipping`);
        migrationStats.skipped++;
        continue;
      }

      if (options.dryRun) {
        logger.info(`[DRY RUN] Would migrate user ${user.get('email')} to role: ${targetRoleName}`);
        continue;
      }

      try {
        // Set new role reference
        const targetRole = createdRoles[targetRoleName];
        if (!targetRole) {
          throw new Error(`Target role ${targetRoleName} not found`);
        }

        user.set('roleId', targetRole);

        // Set organization based on role
        if (targetRoleName === 'employee_amexing' || targetRoleName === 'admin' || targetRoleName === 'superadmin') {
          user.set('organizationId', 'amexing');
        }

        // Keep old role field for backward compatibility (will be removed later)
        // user.set('role', currentRole);

        await user.save(null, { useMasterKey: true });

        migrationStats.migrated++;
        logger.success(`User migrated: ${user.get('email')} -> ${targetRoleName}`);

      } catch (error) {
        migrationStats.errors++;
        logger.error(`Failed to migrate user ${user.get('email')}`, {
          userId: user.id,
          currentRole,
          targetRole: targetRoleName,
          error: error.message
        });
      }
    }

    logger.success('User migration completed', migrationStats);
    return migrationStats;

  } catch (error) {
    logger.error('Failed to migrate users', { error: error.message });
    throw error;
  }
}

/**
 * Validate migration results
 */
async function validateMigration() {
  try {
    logger.info('Validating migration results...');

    const validation = {
      roles: { count: 0, systemRoles: 0 },
      permissions: { count: 0, systemPermissions: 0 },
      users: { total: 0, withRoleId: 0, withoutRoleId: 0 },
      issues: []
    };

    // Count roles
    const roleQuery = new Parse.Query('Role');
    validation.roles.count = await roleQuery.count({ useMasterKey: true });

    const systemRoleQuery = new Parse.Query('Role');
    systemRoleQuery.equalTo('isSystemRole', true);
    validation.roles.systemRoles = await systemRoleQuery.count({ useMasterKey: true });

    // Count permissions
    const permissionQuery = new Parse.Query('Permission');
    validation.permissions.count = await permissionQuery.count({ useMasterKey: true });

    const systemPermissionQuery = new Parse.Query('Permission');
    systemPermissionQuery.equalTo('isSystemPermission', true);
    validation.permissions.systemPermissions = await systemPermissionQuery.count({ useMasterKey: true });

    // Count users
    const userQuery = new Parse.Query('AmexingUser');
    validation.users.total = await userQuery.count({ useMasterKey: true });

    const usersWithRoleQuery = new Parse.Query('AmexingUser');
    usersWithRoleQuery.exists('roleId');
    validation.users.withRoleId = await usersWithRoleQuery.count({ useMasterKey: true });

    validation.users.withoutRoleId = validation.users.total - validation.users.withRoleId;

    // Check for issues
    if (validation.users.withoutRoleId > 0) {
      validation.issues.push(`${validation.users.withoutRoleId} users without roleId`);
    }

    if (validation.roles.systemRoles < 7) {
      validation.issues.push(`Only ${validation.roles.systemRoles} system roles created (expected 7)`);
    }

    logger.success('Migration validation completed', validation);
    return validation;

  } catch (error) {
    logger.error('Migration validation failed', { error: error.message });
    throw error;
  }
}

/**
 * Rollback migration
 */
async function rollbackMigration(backupFile) {
  try {
    logger.info('Rolling back migration...');

    if (!backupFile || !await fileExists(backupFile)) {
      throw new Error('Backup file not found or not provided');
    }

    const backupData = JSON.parse(await fs.readFile(backupFile, 'utf8'));

    logger.info('Restoring users from backup...', {
      userCount: backupData.metadata.userCount
    });

    if (options.dryRun) {
      logger.info('[DRY RUN] Would restore users from backup');
      return;
    }

    // Restore user data
    for (const userData of backupData.users) {
      try {
        const userQuery = new Parse.Query('AmexingUser');
        const user = await userQuery.get(userData.objectId, { useMasterKey: true });

        // Restore original role field
        user.set('role', userData.role);
        // Remove roleId to revert to old system
        user.unset('roleId');
        user.unset('organizationId');

        await user.save(null, { useMasterKey: true });
        logger.info(`User restored: ${userData.email}`);

      } catch (error) {
        logger.error(`Failed to restore user ${userData.email}`, {
          error: error.message
        });
      }
    }

    // TODO: Remove created roles and permissions (be careful not to affect other data)

    logger.success('Rollback completed successfully');

  } catch (error) {
    logger.error('Rollback failed', { error: error.message });
    throw error;
  }
}

/**
 * Prompt user for confirmation
 */
async function promptConfirmation(message) {
  if (options.force) {
    return true;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Check if file exists
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Main migration execution
 */
async function runMigration() {
  try {
    console.log('🚀 Starting RBAC System Migration');
    console.log('================================');
    console.log(`Migration: ${MIGRATION_CONFIG.name}`);
    console.log(`Version: ${MIGRATION_CONFIG.version}`);
    console.log(`Description: ${MIGRATION_CONFIG.description}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Dry Run: ${options.dryRun ? 'YES' : 'NO'}`);
    console.log(`Rollback: ${options.rollback ? 'YES' : 'NO'}`);
    console.log('');

    // Initialize Parse
    const parseConnected = await initializeParse();
    if (!parseConnected) {
      throw new Error('Cannot connect to Parse Server');
    }

    if (options.rollback) {
      const confirmed = await promptConfirmation(
        '⚠️  This will ROLLBACK the RBAC migration. Are you sure?'
      );

      if (!confirmed) {
        logger.info('Rollback cancelled by user');
        return;
      }

      // Find most recent backup
      const backupDir = MIGRATION_CONFIG.backupDir;
      const backupFiles = await fs.readdir(backupDir).catch(() => []);
      const migrationBackups = backupFiles
        .filter(f => f.includes(MIGRATION_CONFIG.name))
        .sort()
        .reverse();

      if (migrationBackups.length === 0) {
        throw new Error('No backup files found for rollback');
      }

      const backupFile = path.join(backupDir, migrationBackups[0]);
      await rollbackMigration(backupFile);

    } else {
      // Forward migration
      const confirmed = await promptConfirmation(
        '⚠️  This will migrate to the new RBAC system. Continue?'
      );

      if (!confirmed) {
        logger.info('Migration cancelled by user');
        return;
      }

      // Create backup
      const backupFile = await createBackup();

      // Create system roles and permissions
      const createdRoles = await createSystemRoles();
      await createSystemPermissions();

      // Migrate users
      await migrateUsers(createdRoles);

      // Validate results
      await validateMigration();

      console.log('');
      console.log('✅ Migration completed successfully!');
      console.log(`📄 Backup saved: ${backupFile}`);
      console.log(`📋 Log saved: ${MIGRATION_CONFIG.logFile}`);
    }

  } catch (error) {
    logger.error('Migration failed', { error: error.message, stack: error.stack });
    console.error('\n❌ Migration failed:', error.message);
    console.error('Check the migration log for details.');
    process.exit(1);
  }
}

/**
 * Cleanup and finalization
 */
async function cleanup() {
  try {
    await logger.save();
  } catch (error) {
    console.error('Failed to save logs:', error.message);
  }
}

// Main execution
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('\n🎉 Migration process completed');
      return cleanup();
    })
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Migration process failed:', error.message);
      cleanup().finally(() => {
        process.exit(1);
      });
    });
}

module.exports = {
  runMigration,
  rollbackMigration,
  createBackup,
  validateMigration,
  MIGRATION_CONFIG
};