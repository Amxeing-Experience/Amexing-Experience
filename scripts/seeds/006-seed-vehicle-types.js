/**
 * Seed Vehicle Types
 *
 * Seeds vehicle types from vehicleTypes.json into the database.
 * Creates VehicleType records with proper validation and idempotency.
 *
 * Vehicle types seeded:
 * - SEDAN (capacity: 4)
 * - VAN (capacity: 4)
 * - SUBURBAN (capacity: 4)
 * - SPRINTER (capacity: 4)
 * - MODEL 3 (capacity: 4)
 * - MODEL Y (capacity: 4)
 *
 * @idempotent true - Can be run multiple times safely
 * @dependencies None
 * @version 1.0.0
 * @since 2024-10-26
 */

const Parse = require('parse/node');
const fs = require('fs');
const path = require('path');

/**
 * Execute seed
 */
async function run() {
  console.log('\n🚀 Starting Vehicle Types seed...');

  try {
    // Load vehicle types from JSON
    const vehicleTypesPath = path.join(__dirname, '../../seeds/vehicleTypes.json');
    const vehicleTypesData = JSON.parse(fs.readFileSync(vehicleTypesPath, 'utf8'));

    console.log(`📄 Loaded ${vehicleTypesData.length} vehicle types from JSON`);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const vtData of vehicleTypesData) {
      const { name, code, description, icon, defaultCapacity, sortOrder, active, exists } = vtData;

      // Check if vehicle type already exists by code
      const query = new Parse.Query('VehicleType');
      query.equalTo('code', code);
      query.equalTo('exists', true);

      const existing = await query.first({ useMasterKey: true });

      if (existing) {
        // Update if needed
        let needsUpdate = false;

        if (existing.get('name') !== name) {
          existing.set('name', name);
          needsUpdate = true;
        }
        if (existing.get('description') !== description) {
          existing.set('description', description);
          needsUpdate = true;
        }
        if (existing.get('icon') !== icon) {
          existing.set('icon', icon);
          needsUpdate = true;
        }
        if (existing.get('defaultCapacity') !== defaultCapacity) {
          existing.set('defaultCapacity', defaultCapacity);
          needsUpdate = true;
        }
        if (existing.get('sortOrder') !== sortOrder) {
          existing.set('sortOrder', sortOrder);
          needsUpdate = true;
        }
        if (existing.get('active') !== active) {
          existing.set('active', active);
          needsUpdate = true;
        }

        if (needsUpdate) {
          await existing.save(null, { useMasterKey: true });
          console.log(`   ✏️  Updated: ${name} (${code})`);
          updated++;
        } else {
          console.log(`   ⚠️  Skipped: ${name} (${code}) - already exists`);
          skipped++;
        }
      } else {
        // Create new vehicle type
        const VehicleType = Parse.Object.extend('VehicleType');
        const vehicleType = new VehicleType();

        vehicleType.set('name', name);
        vehicleType.set('code', code);
        vehicleType.set('description', description);
        vehicleType.set('icon', icon);
        vehicleType.set('defaultCapacity', defaultCapacity);
        vehicleType.set('sortOrder', sortOrder);
        vehicleType.set('active', active);
        vehicleType.set('exists', exists);

        // Set ACL
        const acl = new Parse.ACL();
        acl.setPublicReadAccess(true);
        acl.setRoleWriteAccess('admin', true);
        acl.setRoleWriteAccess('superadmin', true);
        vehicleType.setACL(acl);

        await vehicleType.save(null, { useMasterKey: true });
        console.log(`   ✅ Created: ${name} (${code})`);
        created++;
      }
    }

    console.log('\n📊 Vehicle Types seed complete:');
    console.log(`   Created: ${created}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Total: ${created + updated + skipped}`);

    return {
      success: true,
      created,
      updated,
      skipped,
    };
  } catch (error) {
    console.error('❌ Error seeding vehicle types:', error);
    throw error;
  }
}

/**
 * Rollback seed (if needed)
 */
async function rollback() {
  console.log('\n⚠️  Rollback not implemented for vehicle types seed');
  console.log('   Vehicle types are referenced by services - manual cleanup required');
  return { success: true, message: 'Manual cleanup required' };
}

module.exports = { run, rollback };
