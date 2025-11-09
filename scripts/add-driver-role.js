const Parse = require('parse/node');
const Role = require('../src/domain/models/Role');
require('dotenv').config({ path: './environments/.env.development' });

Parse.initialize(process.env.PARSE_APP_ID, null, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

async function addDriverRole() {
    try {
        console.log('🚀 Adding driver role to RBAC system...\n');

        // Check if driver role already exists
        const existingQuery = new Parse.Query('Role');
        existingQuery.equalTo('name', 'driver');
        const existing = await existingQuery.first({ useMasterKey: true });

        if (existing) {
            console.log('ℹ️  Driver role already exists, updating...');
        }

        // Get driver role definition from model
        const systemRoles = Role.getSystemRoles();
        const driverRole = systemRoles.find(r => r.name === 'driver');

        if (!driverRole) {
            console.error('❌ Driver role not found in Role model definition');
            process.exit(1);
        }

        console.log('Driver role definition:', JSON.stringify(driverRole, null, 2));

        // Create or update the role
        const roleObject = existing || new Parse.Object('Role');

        roleObject.set('name', driverRole.name);
        roleObject.set('displayName', driverRole.displayName);
        roleObject.set('description', driverRole.description);
        roleObject.set('level', driverRole.level);
        roleObject.set('scope', driverRole.scope);
        roleObject.set('organization', driverRole.organization);
        roleObject.set('basePermissions', driverRole.basePermissions);
        roleObject.set('delegatable', driverRole.delegatable);
        roleObject.set('isSystemRole', driverRole.isSystemRole);
        roleObject.set('conditions', driverRole.conditions);
        roleObject.set('color', driverRole.color);
        roleObject.set('icon', driverRole.icon);
        roleObject.set('active', true);
        roleObject.set('exists', true);

        await roleObject.save(null, { useMasterKey: true });

        console.log('\n✅ Driver role added successfully!');
        console.log('Role ID:', roleObject.id);

        // Verify
        const verifyQuery = new Parse.Query('Role');
        verifyQuery.equalTo('name', 'driver');
        const verifiedRole = await verifyQuery.first({ useMasterKey: true });

        if (verifiedRole) {
            console.log('\n✓ Verification passed - driver role is now in database');
        }

    } catch (error) {
        console.error('❌ Error adding driver role:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
    process.exit(0);
}

addDriverRole();
