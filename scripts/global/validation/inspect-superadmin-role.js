/**
 * Inspect SuperAdmin Role
 *
 * This script inspects all fields in the SuperAdmin role to debug permission issues
 */

const Parse = require('parse/node');
require('dotenv').config({ path: './environments/.env.development' });

// Initialize Parse
Parse.initialize(process.env.PARSE_APP_ID, 'unused', process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';
Parse.masterKey = process.env.PARSE_MASTER_KEY;

async function inspectSuperAdminRole() {
  try {
    console.log('🔍 Inspecting SuperAdmin role...\n');

    // Query for SuperAdmin role
    const roleQuery = new Parse.Query('Role');
    roleQuery.equalTo('name', 'superadmin');

    const superAdminRole = await roleQuery.first({ useMasterKey: true });

    if (!superAdminRole) {
      console.error('❌ SuperAdmin role not found in database');
      process.exit(1);
    }

    console.log(`✅ Found SuperAdmin role: ${superAdminRole.id}\n`);

    // Get all attributes
    const attributes = superAdminRole.attributes;
    console.log('📋 All attributes:');
    console.log(JSON.stringify(attributes, null, 2));

    console.log('\n📊 Individual field inspection:');
    console.log('  name:', superAdminRole.get('name'));
    console.log('  displayName:', superAdminRole.get('displayName'));
    console.log('  level:', superAdminRole.get('level'));
    console.log('  basePermissions:', superAdminRole.get('basePermissions'));
    console.log('  permissions:', superAdminRole.get('permissions'));
    console.log('  active:', superAdminRole.get('active'));
    console.log('  exists:', superAdminRole.get('exists'));

    console.log('\n✅ Inspection completed');

  } catch (error) {
    console.error('❌ Error inspecting SuperAdmin role:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run the inspection
inspectSuperAdminRole()
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
