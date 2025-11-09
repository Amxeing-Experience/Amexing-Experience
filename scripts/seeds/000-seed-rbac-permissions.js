/**
 * Seed RBAC Permissions
 *
 * Creates all system permissions required for Role-Based Access Control.
 * Must run AFTER roles are created.
 *
 * Permission categories:
 * - User Management (users.*)
 * - Client Management (clients.*)
 * - Department Management (departments.*)
 * - Event Management (events.*)
 * - Booking Management (bookings.*)
 * - Service Management (services.*)
 * - Pricing Management (pricing.*)
 * - Report Management (reports.*)
 * - System Management (system.*)
 *
 * @idempotent true - Can be run multiple times safely
 * @dependencies 000-seed-rbac-roles
 * @version 1.0.0
 * @since 2024-10-26
 */

const Parse = require('parse/node');
const Permission = require('../../src/domain/models/Permission');

/**
 * Execute seed
 */
async function run() {
  console.log('\n🚀 Starting RBAC Permissions seed...');

  try {
    // Get system permissions definition from Permission model
    const systemPermissions = Permission.getSystemPermissions();
    console.log(`   📋 Found ${systemPermissions.length} system permissions to create`);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const permissionData of systemPermissions) {
      // Check if permission already exists
      const query = new Parse.Query('Permission');
      query.equalTo('name', permissionData.name);
      const existing = await query.first({ useMasterKey: true });

      if (existing) {
        // Update if fields have changed
        let needsUpdate = false;
        const fieldsToCheck = [
          'resource', 'action', 'description', 'scope', 'category', 'isSystemPermission'
        ];

        for (const field of fieldsToCheck) {
          if (permissionData[field] !== undefined && existing.get(field) !== permissionData[field]) {
            existing.set(field, permissionData[field]);
            needsUpdate = true;
          }
        }

        // Update conditions if present
        if (permissionData.conditions) {
          const currentConditions = existing.get('conditions') || {};
          if (JSON.stringify(currentConditions) !== JSON.stringify(permissionData.conditions)) {
            existing.set('conditions', permissionData.conditions);
            needsUpdate = true;
          }
        }

        if (needsUpdate) {
          await existing.save(null, { useMasterKey: true });
          console.log(`   ✏️  Updated: ${permissionData.name} (${permissionData.category})`);
          updated++;
        } else {
          skipped++;
        }
      } else {
        // Create new permission
        const permission = Permission.create(permissionData);
        await permission.save(null, { useMasterKey: true });
        console.log(`   ✅ Created: ${permissionData.name} (${permissionData.category})`);
        created++;
      }
    }

    console.log('\n   📊 RBAC Permissions seed complete:');
    console.log(`      Created: ${created}`);
    console.log(`      Updated: ${updated}`);
    console.log(`      Skipped: ${skipped}`);
    console.log(`      Total: ${created + updated + skipped}`);

    // Group permissions by category for summary
    const categories = {};
    systemPermissions.forEach(p => {
      categories[p.category] = (categories[p.category] || 0) + 1;
    });

    console.log('\n   📂 Permissions by category:');
    Object.entries(categories).forEach(([category, count]) => {
      console.log(`      ${category}: ${count} permissions`);
    });

    return {
      success: true,
      created,
      updated,
      skipped,
    };
  } catch (error) {
    console.error('   ❌ Error seeding RBAC permissions:', error);
    throw error;
  }
}

/**
 * Rollback seed (if needed)
 */
async function rollback() {
  console.log('\n⚠️  Rollback not implemented for RBAC permissions seed');
  console.log('   Permissions are critical system components - manual cleanup required');
  console.log('   DO NOT delete permissions if they are assigned to roles');
  return { success: true, message: 'Manual cleanup required' };
}

module.exports = { run, rollback };
