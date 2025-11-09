/**
 * Seed RBAC Roles
 *
 * Creates all system roles required for Role-Based Access Control.
 * Must run BEFORE any other seeds that depend on roles or users.
 *
 * Roles created:
 * - SuperAdmin (level 7) - Full system access
 * - Admin (level 6) - System administration
 * - Client (level 5) - Organization admin
 * - Department Manager (level 4) - Department supervisor
 * - Employee (level 3) - Regular employee
 * - Employee Amexing (level 3) - Amexing staff
 * - Guest (level 1) - Public access
 *
 * @idempotent true - Can be run multiple times safely
 * @dependencies None - Must be first seed
 * @version 1.0.0
 * @since 2024-10-26
 */

const Parse = require('parse/node');
const Role = require('../../src/domain/models/Role');

/**
 * Execute seed
 */
async function run() {
  console.log('\n🚀 Starting RBAC Roles seed...');

  try {
    // Get system roles definition from Role model
    const systemRoles = Role.getSystemRoles();
    console.log(`   📋 Found ${systemRoles.length} system roles to create`);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const roleData of systemRoles) {
      // Check if role already exists
      const query = new Parse.Query('Role');
      query.equalTo('name', roleData.name);
      const existing = await query.first({ useMasterKey: true });

      if (existing) {
        // Update if fields have changed
        let needsUpdate = false;
        const fieldsToCheck = [
          'displayName', 'description', 'level', 'scope', 'organization',
          'delegatable', 'maxDelegationLevel', 'isSystemRole', 'color', 'icon'
        ];

        for (const field of fieldsToCheck) {
          if (roleData[field] !== undefined && existing.get(field) !== roleData[field]) {
            existing.set(field, roleData[field]);
            needsUpdate = true;
          }
        }

        // Update arrays (basePermissions, conditions)
        if (roleData.basePermissions) {
          const currentPerms = existing.get('basePermissions') || [];
          if (JSON.stringify(currentPerms) !== JSON.stringify(roleData.basePermissions)) {
            existing.set('basePermissions', roleData.basePermissions);
            needsUpdate = true;
          }
        }

        if (roleData.conditions) {
          const currentConditions = existing.get('conditions') || {};
          if (JSON.stringify(currentConditions) !== JSON.stringify(roleData.conditions)) {
            existing.set('conditions', roleData.conditions);
            needsUpdate = true;
          }
        }

        if (needsUpdate) {
          await existing.save(null, { useMasterKey: true });
          console.log(`   ✏️  Updated: ${roleData.displayName} (${roleData.name}) - Level ${roleData.level}`);
          updated++;
        } else {
          console.log(`   ⚠️  Skipped: ${roleData.displayName} (${roleData.name}) - already exists`);
          skipped++;
        }
      } else {
        // Create new role
        const role = Role.create(roleData);
        await role.save(null, { useMasterKey: true });
        console.log(`   ✅ Created: ${roleData.displayName} (${roleData.name}) - Level ${roleData.level}`);
        created++;
      }
    }

    console.log('\n   📊 RBAC Roles seed complete:');
    console.log(`      Created: ${created}`);
    console.log(`      Updated: ${updated}`);
    console.log(`      Skipped: ${skipped}`);
    console.log(`      Total: ${created + updated + skipped}`);

    return {
      success: true,
      created,
      updated,
      skipped,
    };
  } catch (error) {
    console.error('   ❌ Error seeding RBAC roles:', error);
    throw error;
  }
}

/**
 * Rollback seed (if needed)
 */
async function rollback() {
  console.log('\n⚠️  Rollback not implemented for RBAC roles seed');
  console.log('   Roles are critical system components - manual cleanup required');
  console.log('   DO NOT delete roles if users are assigned to them');
  return { success: true, message: 'Manual cleanup required' };
}

module.exports = { run, rollback };
