/**
 * Fix SuperAdmin Role Permissions
 *
 * This script updates the SuperAdmin role to include all necessary permissions
 * for managing users and other system resources.
 */

const Parse = require('parse/node');
require('dotenv').config({ path: './environments/.env.development' });

// Initialize Parse
Parse.initialize(process.env.PARSE_APP_ID, 'unused', process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';
Parse.masterKey = process.env.PARSE_MASTER_KEY;

/**
 * SuperAdmin permissions - complete access to all resources
 */
const SUPERADMIN_PERMISSIONS = [
  // User Management
  'users.list',
  'users.read',
  'users.create',
  'users.update',
  'users.delete',
  'users.export',
  'users.import',

  // Role Management
  'roles.list',
  'roles.read',
  'roles.create',
  'roles.update',
  'roles.delete',

  // Department Management
  'departments.list',
  'departments.read',
  'departments.create',
  'departments.update',
  'departments.delete',

  // Client Management
  'clients.list',
  'clients.read',
  'clients.create',
  'clients.update',
  'clients.delete',

  // System Administration
  'system.settings',
  'system.logs',
  'system.audit',
  'system.backup',
  'system.restore',

  // Reports and Analytics
  'reports.view',
  'reports.create',
  'reports.export',
  'analytics.view'
];

async function fixSuperAdminPermissions() {
  try {
    console.log('🔧 Starting SuperAdmin permissions fix...\n');

    // Query for SuperAdmin role
    const roleQuery = new Parse.Query('Role');
    roleQuery.equalTo('name', 'superadmin');

    const superAdminRole = await roleQuery.first({ useMasterKey: true });

    if (!superAdminRole) {
      console.error('❌ SuperAdmin role not found in database');
      process.exit(1);
    }

    console.log(`✅ Found SuperAdmin role: ${superAdminRole.id}`);
    console.log(`   Current level: ${superAdminRole.get('level')}`);

    // Get current permissions (check both fields)
    const currentBasePermissions = superAdminRole.get('basePermissions') || [];
    const currentPermissions = superAdminRole.get('permissions') || [];
    console.log(`\n📋 Current basePermissions (${currentBasePermissions.length}):`);
    console.log(currentBasePermissions);
    console.log(`\n📋 Current permissions (${currentPermissions.length}):`);
    console.log(currentPermissions);

    // Update basePermissions (this is what the Role model uses in getAllPermissions)
    superAdminRole.set('basePermissions', SUPERADMIN_PERMISSIONS);

    // Save with master key
    await superAdminRole.save(null, { useMasterKey: true });

    console.log(`\n✅ Updated SuperAdmin basePermissions (${SUPERADMIN_PERMISSIONS.length}):`);
    console.log(SUPERADMIN_PERMISSIONS);

    // Verify the update
    const verifyQuery = new Parse.Query('Role');
    const verifiedRole = await verifyQuery.get(superAdminRole.id, { useMasterKey: true });
    const verifiedBasePermissions = verifiedRole.get('basePermissions') || [];

    console.log(`\n🔍 Verification - basePermissions count: ${verifiedBasePermissions.length}`);

    if (verifiedBasePermissions.includes('users.list')) {
      console.log('✅ users.list permission confirmed in basePermissions');
    } else {
      console.log('❌ users.list permission NOT found in basePermissions');
    }

    console.log('\n🎉 SuperAdmin permissions fix completed successfully!');

  } catch (error) {
    console.error('❌ Error fixing SuperAdmin permissions:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run the fix
fixSuperAdminPermissions()
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
