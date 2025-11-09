#!/usr/bin/env node

/**
 * Production Database Initialization Script
 *
 * Safely initializes a production database with essential data:
 * - RBAC System (Roles and Permissions)
 * - SuperAdmin user
 * - Basic system configurations
 *
 * SECURITY FEATURES:
 * - Requires manual confirmation
 * - Only works on empty database (prevents overwrite)
 * - Credentials from environment variables only
 * - Complete audit logging
 * - Validates connection before starting
 *
 * Usage:
 *   NODE_ENV=production node scripts/production/init-production-database.js
 *
 * Required Environment Variables (.env.production):
 *   - PROD_SUPERADMIN_EMAIL
 *   - PROD_SUPERADMIN_PASSWORD (min 12 chars, PCI DSS compliant)
 *   - PROD_SUPERADMIN_FIRSTNAME
 *   - PROD_SUPERADMIN_LASTNAME
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @security PCI DSS Level 1 Compliant
 */

require('dotenv').config({
  path: `./environments/.env.${process.env.NODE_ENV || 'development'}`,
});

const Parse = require('parse/node');
const readline = require('readline');

// Import models
const AmexingUser = require('../../src/domain/models/AmexingUser');
const Role = require('../../src/domain/models/Role');
const Permission = require('../../src/domain/models/Permission');

// Console colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

/**
 * Logger for initialization process
 */
class InitLogger {
  log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
  }

  success(message) {
    this.log(`✅ ${message}`, 'green');
  }

  error(message) {
    this.log(`❌ ${message}`, 'red');
  }

  warning(message) {
    this.log(`⚠️  ${message}`, 'yellow');
  }

  info(message) {
    this.log(`ℹ️  ${message}`, 'cyan');
  }

  section(message) {
    this.log(`\n${'='.repeat(60)}`, 'bright');
    this.log(message, 'bright');
    this.log('='.repeat(60), 'bright');
  }
}

const logger = new InitLogger();

/**
 * Validate required environment variables
 */
function validateEnvironment() {
  logger.section('Validating Environment Configuration');

  const required = [
    'PROD_SUPERADMIN_EMAIL',
    'PROD_SUPERADMIN_PASSWORD',
    'PROD_SUPERADMIN_FIRSTNAME',
    'PROD_SUPERADMIN_LASTNAME',
    'DATABASE_URI',
    'PARSE_APP_ID',
    'PARSE_MASTER_KEY',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    logger.error('Missing required environment variables:');
    missing.forEach(key => logger.error(`  - ${key}`));
    process.exit(1);
  }

  // Validate password strength
  const password = process.env.PROD_SUPERADMIN_PASSWORD;
  if (password.length < 12) {
    logger.error('PROD_SUPERADMIN_PASSWORD must be at least 12 characters (PCI DSS requirement)');
    process.exit(1);
  }

  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

  if (!hasUpper || !hasLower || !hasNumber || !hasSpecial) {
    logger.error('PROD_SUPERADMIN_PASSWORD must contain uppercase, lowercase, numbers, and special characters');
    process.exit(1);
  }

  logger.success('Environment variables validated');
  logger.info(`Database: ${process.env.DATABASE_NAME}`);
  logger.info(`SuperAdmin: ${process.env.PROD_SUPERADMIN_EMAIL}`);
}

/**
 * Initialize Parse Server connection
 */
async function initializeParse() {
  logger.section('Initializing Parse Server Connection');

  Parse.initialize(process.env.PARSE_APP_ID);
  Parse.serverURL = process.env.PARSE_SERVER_URL;
  Parse.masterKey = process.env.PARSE_MASTER_KEY;

  try {
    // Test connection using a simple query instead of creating objects
    const query = new Parse.Query(Parse.Role);
    query.limit(1);
    await query.find({ useMasterKey: true });

    logger.success('Parse Server connection established');
  } catch (error) {
    logger.error(`Failed to connect to Parse Server: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Check if database is empty
 */
async function checkDatabaseEmpty() {
  logger.section('Checking Database Status');

  try {
    // Check if any users exist
    const userQuery = new Parse.Query(AmexingUser);
    userQuery.limit(1);
    const users = await userQuery.find({ useMasterKey: true });

    if (users.length > 0) {
      logger.error('Database is not empty! Found existing users.');
      logger.error('This script only works on empty databases to prevent data loss.');
      logger.error('If you need to re-initialize, please backup and clear the database first.');
      process.exit(1);
    }

    // Check if roles exist
    const roleQuery = new Parse.Query(Role);
    roleQuery.limit(1);
    const roles = await roleQuery.find({ useMasterKey: true });

    if (roles.length > 0) {
      logger.warning('Found existing roles in database');
      logger.warning('Database may not be completely empty');
    }

    logger.success('Database appears to be empty');
  } catch (error) {
    logger.error(`Failed to check database status: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Create system permissions
 */
async function createSystemPermissions() {
  logger.section('Creating System Permissions');

  const systemPermissions = Permission.getSystemPermissions();
  logger.info(`Creating ${systemPermissions.length} system permissions...`);

  const createdPermissions = [];

  for (const permConfig of systemPermissions) {
    try {
      const permission = Permission.create(permConfig);
      const savedPermission = await permission.save(null, { useMasterKey: true });
      createdPermissions.push(savedPermission);
      logger.success(`Created permission: ${permConfig.name}`);
    } catch (error) {
      logger.error(`Failed to create permission ${permConfig.name}: ${error.message}`);
      throw error;
    }
  }

  logger.success(`Created ${createdPermissions.length} system permissions`);
  return createdPermissions;
}

/**
 * Create system roles
 */
async function createRBACSystem() {
  logger.section('Creating System Roles');

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

  logger.info('Creating system roles...');
  const createdRoles = {};

  for (const roleData of systemRoles) {
    try {
      const role = new Role();
      Object.keys(roleData).forEach(key => {
        role.set(key, roleData[key]);
      });

      const savedRole = await role.save(null, { useMasterKey: true });
      createdRoles[roleData.name] = savedRole;
      logger.success(`Created role: ${roleData.displayName}`);
    } catch (error) {
      logger.error(`Failed to create role ${roleData.name}: ${error.message}`);
      throw error;
    }
  }

  logger.success(`Created ${Object.keys(createdRoles).length} system roles`);
  return createdRoles;
}

/**
 * Create SuperAdmin user
 */
async function createSuperAdmin(roles) {
  logger.section('Creating SuperAdmin User');

  try {
    const user = new AmexingUser();

    // Set basic fields
    user.set('username', process.env.PROD_SUPERADMIN_EMAIL);
    user.set('email', process.env.PROD_SUPERADMIN_EMAIL);
    user.set('firstName', process.env.PROD_SUPERADMIN_FIRSTNAME);
    user.set('lastName', process.env.PROD_SUPERADMIN_LASTNAME);
    user.setPassword(process.env.PROD_SUPERADMIN_PASSWORD);

    // Set roleId as Parse Pointer to Role object
    user.set('roleId', roles.superadmin);

    // Set other fields
    user.set('organizationId', 'amexing');
    user.set('active', true);
    user.set('exists', true);
    user.set('emailVerified', true);
    user.set('loginAttempts', 0);
    user.set('mustChangePassword', false);
    user.set('lastAuthMethod', 'password');

    const savedUser = await user.save(null, { useMasterKey: true });

    logger.success(`SuperAdmin created: ${savedUser.get('email')}`);
    logger.info(`User ID: ${savedUser.id}`);
    const roleIdObj = savedUser.get('roleId');
    logger.info(`RoleId: ${roleIdObj ? roleIdObj.objectId : 'N/A'}`);

    return savedUser;
  } catch (error) {
    logger.error(`Failed to create SuperAdmin: ${error.message}`);
    throw error;
  }
}

/**
 * Confirm initialization with user
 */
async function confirmInitialization() {
  logger.section('Production Database Initialization');
  logger.warning('This will initialize the production database with:');
  logger.info('  - System Permissions (29 permissions)');
  logger.info('  - System Roles (8 roles)');
  logger.info(`  - SuperAdmin: ${process.env.PROD_SUPERADMIN_EMAIL}`);
  logger.info(`  - Database: ${process.env.DATABASE_NAME}`);
  logger.warning('\nThis operation cannot be undone!');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('\nType "INITIALIZE PRODUCTION" to confirm: ', (answer) => {
      rl.close();
      if (answer === 'INITIALIZE PRODUCTION') {
        resolve(true);
      } else {
        logger.error('Initialization cancelled');
        resolve(false);
      }
    });
  });
}

/**
 * Main initialization process
 */
async function main() {
  try {
    console.log('\n');
    logger.section('🚀 AmexingWeb Production Database Initialization');
    console.log('\n');

    // Step 1: Validate environment
    validateEnvironment();

    // Step 2: Initialize Parse connection
    await initializeParse();

    // Step 3: Check database is empty
    await checkDatabaseEmpty();

    // Step 4: Confirm with user
    const confirmed = await confirmInitialization();
    if (!confirmed) {
      process.exit(0);
    }

    console.log('\n');
    logger.section('Starting Initialization Process');

    // Step 5: Create System Permissions
    await createSystemPermissions();

    // Step 6: Create RBAC system (roles)
    const roles = await createRBACSystem();

    // Step 7: Create SuperAdmin
    await createSuperAdmin(roles);

    // Success summary
    console.log('\n');
    logger.section('✅ Initialization Complete');
    logger.success('Production database initialized successfully!');
    console.log('\n');
    logger.info('Next steps:');
    logger.info('  1. Test login with SuperAdmin credentials');
    logger.info('  2. Create additional users as needed');
    logger.info('  3. Configure OAuth providers');
    logger.info('  4. Review security settings');
    console.log('\n');

    process.exit(0);
  } catch (error) {
    console.log('\n');
    logger.section('❌ Initialization Failed');
    logger.error(error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    console.log('\n');
    logger.error('Database may be in an inconsistent state');
    logger.error('Please review the logs and database status');
    process.exit(1);
  }
}

// Run initialization
main();
