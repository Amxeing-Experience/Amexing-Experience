const Parse = require('parse/node');
require('dotenv').config({ path: './environments/.env.development' });

Parse.initialize(process.env.PARSE_APP_ID, null, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

async function checkDriverRole() {
    try {
        console.log('Checking for driver role...\n');
        
        const query = new Parse.Query('Role');
        query.equalTo('name', 'driver');
        query.equalTo('exists', true);
        const role = await query.first({ useMasterKey: true });
        
        if (role) {
            console.log('✅ Rol "driver" encontrado:');
            console.log(JSON.stringify({
                id: role.id,
                name: role.get('name'),
                displayName: role.get('displayName'),
                level: role.get('level'),
                organization: role.get('organization'),
                basePermissions: role.get('basePermissions'),
                isSystemRole: role.get('isSystemRole')
            }, null, 2));
        } else {
            console.log('❌ Rol "driver" NO encontrado');
            console.log('\nVerificando todos los roles del sistema...\n');
            
            const allRolesQuery = new Parse.Query('Role');
            allRolesQuery.equalTo('exists', true);
            allRolesQuery.equalTo('isSystemRole', true);
            const allRoles = await allRolesQuery.find({ useMasterKey: true });
            
            console.log(`Roles del sistema encontrados: ${allRoles.length}`);
            allRoles.forEach(r => {
                console.log(`  - ${r.get('name')} (level: ${r.get('level')})`);
            });
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
    process.exit(0);
}

checkDriverRole();
