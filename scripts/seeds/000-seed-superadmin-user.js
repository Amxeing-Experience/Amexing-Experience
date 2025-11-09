/**
 * Seed SuperAdmin User
 *
 * Creates the initial SuperAdmin user from environment variables.
 * This user has full system access and is required to access the system.
 *
 * Environment variables required:
 * - DEV_SUPERADMIN_EMAIL: Email for SuperAdmin user
 * - DEV_SUPERADMIN_PASSWORD: Password for SuperAdmin user
 *
 * User details:
 * - Role: superadmin (level 7)
 * - Organization: amexing
 * - Full system access
 * - Email verified by default
 *
 * @idempotent true - Can be run multiple times safely
 * @dependencies 000-seed-rbac-roles
 * @version 1.0.0
 * @since 2024-10-26
 */

const Parse = require('parse/node');
const AmexingUser = require('../../src/domain/models/AmexingUser');

/**
 * Execute seed
 */
async function run() {
  console.log('\n🚀 Starting SuperAdmin User seed...');

  try {
    // Get SuperAdmin credentials from environment based on NODE_ENV
    const isProduction = process.env.NODE_ENV === 'production';
    const emailKey = isProduction ? 'PROD_SUPERADMIN_EMAIL' : 'DEV_SUPERADMIN_EMAIL';
    const passwordKey = isProduction ? 'PROD_SUPERADMIN_PASSWORD' : 'DEV_SUPERADMIN_PASSWORD';

    const email = process.env[emailKey] || (isProduction ? 'admin@amexing.com' : 'superadmin@dev.amexing.com');
    const password = process.env[passwordKey];

    console.log(`   📧 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   📧 Using email key: ${emailKey}`);
    console.log(`   📧 SuperAdmin email: ${email}`);

    if (!password) {
      throw new Error(`${passwordKey} not set in environment. Cannot create SuperAdmin user without password.`);
    }

    // Get SuperAdmin role
    const roleQuery = new Parse.Query('Role');
    roleQuery.equalTo('name', 'superadmin');
    const superAdminRole = await roleQuery.first({ useMasterKey: true });

    if (!superAdminRole) {
      throw new Error('SuperAdmin role not found. Please run 000-seed-rbac-roles.js first');
    }

    console.log(`   📋 SuperAdmin role found (ID: ${superAdminRole.id})`);

    // Check if SuperAdmin user already exists
    const existingQuery = new Parse.Query('AmexingUser');
    existingQuery.equalTo('email', email);
    const existingUser = await existingQuery.first({ useMasterKey: true });

    if (existingUser) {
      console.log(`   ⚠️  SuperAdmin user already exists: ${email}`);

      // Update to ensure it has the correct role and is active
      let needsUpdate = false;

      if (!existingUser.get('roleId') || existingUser.get('roleId').id !== superAdminRole.id) {
        existingUser.set('roleId', superAdminRole);
        needsUpdate = true;
      }

      if (!existingUser.get('active')) {
        existingUser.set('active', true);
        needsUpdate = true;
      }

      if (!existingUser.get('exists')) {
        existingUser.set('exists', true);
        needsUpdate = true;
      }

      if (!existingUser.get('emailVerified')) {
        existingUser.set('emailVerified', true);
        needsUpdate = true;
      }

      if (existingUser.get('organizationId') !== 'amexing') {
        existingUser.set('organizationId', 'amexing');
        needsUpdate = true;
      }

      if (needsUpdate) {
        await existingUser.save(null, { useMasterKey: true });
        console.log(`   ✏️  Updated existing SuperAdmin user: ${email}`);
        return {
          success: true,
          created: 0,
          updated: 1,
          skipped: 0,
        };
      } else {
        console.log(`   ✅ SuperAdmin user already configured correctly`);
        return {
          success: true,
          created: 0,
          updated: 0,
          skipped: 1,
        };
      }
    }

    // Create new SuperAdmin user
    console.log(`   👤 Creating SuperAdmin user: ${email}`);

    const userConfig = {
      username: email,
      email: email,
      password: password || 'SuperAdmin123!', // Default password for dev (change immediately!)
      firstName: 'Super',
      lastName: 'Administrator',
      roleName: 'superadmin',
      roleId: superAdminRole,
      organizationId: 'amexing',
      active: true,
      exists: true,
      emailVerified: true,
      contextualData: {
        clearanceLevel: 'top_secret',
        canOverrideSystem: true,
        createdBy: 'seed_script'
      }
    };

    // Create user using AmexingUser model
    const user = AmexingUser.create(userConfig);
    await user.setPassword(userConfig.password);

    // Set ACL (before saving)
    const acl = new Parse.ACL();
    acl.setPublicReadAccess(false);
    acl.setRoleReadAccess('superadmin', true);
    acl.setRoleWriteAccess('superadmin', true);
    user.setACL(acl);

    // Save user first to get ID
    await user.save(null, { useMasterKey: true });

    // Now update ACL with user ID
    const updatedAcl = user.getACL();
    updatedAcl.setReadAccess(user.id, true);
    updatedAcl.setWriteAccess(user.id, true);
    user.setACL(updatedAcl);

    // Save again with updated ACL
    await user.save(null, { useMasterKey: true });

    console.log('\n   📊 SuperAdmin User seed complete:');
    console.log(`      ✅ Created: ${email}`);
    console.log(`      🔐 Role: SuperAdmin (Level 7)`);
    console.log(`      🏢 Organization: amexing`);
    console.log(`      ✉️  Email Verified: true`);

    if (!password || password === 'SuperAdmin123!') {
      console.log('\n   ⚠️  WARNING: Using default password!');
      console.log(`      Please set ${passwordKey} in your .env file`);
      console.log('      Default password: SuperAdmin123!');
    } else {
      console.log(`\n   🔐 Password set from environment variable: ${passwordKey}`);
    }

    return {
      success: true,
      created: 1,
      updated: 0,
      skipped: 0,
    };
  } catch (error) {
    console.error('   ❌ Error seeding SuperAdmin user:', error);
    throw error;
  }
}

/**
 * Rollback seed (if needed)
 */
async function rollback() {
  console.log('\n⚠️  Rollback not implemented for SuperAdmin user seed');
  console.log('   SuperAdmin user is critical - manual cleanup required');
  console.log('   DO NOT delete SuperAdmin without creating a replacement first');
  return { success: true, message: 'Manual cleanup required' };
}

module.exports = { run, rollback };
