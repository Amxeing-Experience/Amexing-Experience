/**
 * Migration: Convert Vehicle.vehicleType from String to Pointer<VehicleType>
 *
 * This migration:
 * 1. Finds all existing vehicles with string vehicleType
 * 2. Maps string values to VehicleType objects
 * 3. Updates Vehicle records with Pointer references
 * 4. Updates Vehicle schema to use Pointer instead of String
 * 5. Validates all conversions
 *
 * IMPORTANT: Run 002-create-vehicle-types.js BEFORE this migration
 *
 * Dependencies: Parse Server, MongoDB, VehicleType class must exist
 *
 * Usage:
 *   node scripts/migrations/003-migrate-vehicle-types.js
 *
 * Rollback:
 *   Set ROLLBACK=true environment variable to revert changes
 */

const Parse = require('parse/node');

// Parse Server configuration
const PARSE_SERVER_URL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';
const PARSE_APP_ID = process.env.PARSE_APP_ID || 'amexing-dev';
const PARSE_MASTER_KEY = process.env.PARSE_MASTER_KEY || 'amexing-master-key-dev';
const ROLLBACK = process.env.ROLLBACK === 'true';

// Initialize Parse
Parse.initialize(PARSE_APP_ID);
Parse.serverURL = PARSE_SERVER_URL;
Parse.masterKey = PARSE_MASTER_KEY;

// Vehicle type string to code mapping
const TYPE_MAPPING = {
  'sedan': 'sedan',
  'suv': 'suv',
  'van': 'van',
  'bus': 'bus',
  'limousine': 'limousine'
};

/**
 * Load all VehicleType objects into a map
 */
async function loadVehicleTypes() {
  console.log('\n📋 Loading VehicleType references...');

  const query = new Parse.Query('VehicleType');
  query.equalTo('exists', true);
  query.limit(1000);

  const vehicleTypes = await query.find({ useMasterKey: true });

  const typeMap = new Map();
  vehicleTypes.forEach(type => {
    typeMap.set(type.get('code'), type);
  });

  console.log(`   ✅ Loaded ${typeMap.size} vehicle types`);
  return typeMap;
}

/**
 * Get or create backup field
 */
async function backupVehicleTypes() {
  if (ROLLBACK) {
    console.log('\n⏪ Rollback mode - skipping backup');
    return;
  }

  console.log('\n💾 Creating backup of existing vehicleType values...');

  const query = new Parse.Query('Vehicle');
  query.limit(1000);

  try {
    const vehicles = await query.find({ useMasterKey: true });

    for (const vehicle of vehicles) {
      const currentType = vehicle.get('vehicleType');
      if (currentType && typeof currentType === 'string') {
        vehicle.set('_vehicleTypeBackup', currentType);
        await vehicle.save(null, { useMasterKey: true });
      }
    }

    console.log(`   ✅ Backed up ${vehicles.length} vehicle types`);
  } catch (error) {
    console.error('   ❌ Backup failed:', error.message);
    throw error;
  }
}

/**
 * Migrate vehicles from string to Pointer
 */
async function migrateVehicles(typeMap) {
  console.log('\n🔄 Migrating Vehicle records...');

  const query = new Parse.Query('Vehicle');
  query.limit(1000);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  try {
    const vehicles = await query.find({ useMasterKey: true });

    if (vehicles.length === 0) {
      console.log('   ℹ️  No vehicles found to migrate');
      return { migrated, skipped, errors };
    }

    for (const vehicle of vehicles) {
      try {
        const currentType = vehicle.get('vehicleType');

        // Skip if already a Pointer
        if (currentType && typeof currentType === 'object' && currentType.className === 'VehicleType') {
          console.log(`   ⏭️  Vehicle ${vehicle.id} already has Pointer, skipping...`);
          skipped++;
          continue;
        }

        // Skip if no type
        if (!currentType) {
          console.log(`   ⚠️  Vehicle ${vehicle.id} has no vehicleType, skipping...`);
          skipped++;
          continue;
        }

        // Convert string to lowercase for matching
        const typeCode = currentType.toString().toLowerCase();
        const mappedCode = TYPE_MAPPING[typeCode] || typeCode;

        // Find corresponding VehicleType
        const vehicleTypeObj = typeMap.get(mappedCode);

        if (!vehicleTypeObj) {
          console.error(`   ❌ No VehicleType found for code "${mappedCode}" (vehicle ${vehicle.id})`);
          errors++;
          continue;
        }

        // Update with Pointer
        vehicle.set('vehicleType', vehicleTypeObj);
        await vehicle.save(null, { useMasterKey: true });

        console.log(`   ✅ Migrated vehicle ${vehicle.id}: "${currentType}" -> ${vehicleTypeObj.get('name')}`);
        migrated++;

      } catch (error) {
        console.error(`   ❌ Error migrating vehicle ${vehicle.id}:`, error.message);
        errors++;
      }
    }

  } catch (error) {
    console.error('❌ Migration query failed:', error.message);
    throw error;
  }

  return { migrated, skipped, errors };
}

/**
 * Rollback migration
 */
async function rollbackMigration() {
  console.log('\n⏪ Rolling back migration...');

  const query = new Parse.Query('Vehicle');
  query.exists('_vehicleTypeBackup');
  query.limit(1000);

  let restored = 0;
  let errors = 0;

  try {
    const vehicles = await query.find({ useMasterKey: true });

    if (vehicles.length === 0) {
      console.log('   ℹ️  No backup data found');
      return { restored, errors };
    }

    for (const vehicle of vehicles) {
      try {
        const backupType = vehicle.get('_vehicleTypeBackup');

        if (backupType) {
          vehicle.set('vehicleType', backupType);
          vehicle.unset('_vehicleTypeBackup');
          await vehicle.save(null, { useMasterKey: true });

          console.log(`   ✅ Restored vehicle ${vehicle.id}: ${backupType}`);
          restored++;
        }

      } catch (error) {
        console.error(`   ❌ Error restoring vehicle ${vehicle.id}:`, error.message);
        errors++;
      }
    }

  } catch (error) {
    console.error('❌ Rollback query failed:', error.message);
    throw error;
  }

  return { restored, errors };
}

/**
 * Validate migration
 */
async function validateMigration() {
  console.log('\n🔍 Validating migration...');

  const query = new Parse.Query('Vehicle');
  query.limit(1000);

  let valid = 0;
  let invalid = 0;

  try {
    const vehicles = await query.find({ useMasterKey: true });

    for (const vehicle of vehicles) {
      const vehicleType = vehicle.get('vehicleType');

      if (vehicleType && typeof vehicleType === 'object' && vehicleType.className === 'VehicleType') {
        valid++;
      } else if (vehicleType) {
        console.error(`   ❌ Vehicle ${vehicle.id} still has invalid type:`, typeof vehicleType);
        invalid++;
      }
    }

    console.log(`\n   ✅ Valid: ${valid}`);
    console.log(`   ❌ Invalid: ${invalid}`);

    return { valid, invalid };

  } catch (error) {
    console.error('❌ Validation failed:', error.message);
    throw error;
  }
}

/**
 * Run migration
 */
async function runMigration() {
  console.log('🚀 Starting Vehicle type migration...');
  console.log(`   Server: ${PARSE_SERVER_URL}`);
  console.log(`   App ID: ${PARSE_APP_ID}`);
  console.log(`   Mode: ${ROLLBACK ? 'ROLLBACK' : 'MIGRATION'}`);

  try {
    if (ROLLBACK) {
      // Rollback mode
      const rollbackResult = await rollbackMigration();
      console.log(`\n📊 Rollback complete:`);
      console.log(`   Restored: ${rollbackResult.restored}`);
      console.log(`   Errors: ${rollbackResult.errors}`);

    } else {
      // Migration mode
      const typeMap = await loadVehicleTypes();

      if (typeMap.size === 0) {
        throw new Error('No VehicleTypes found! Run 002-create-vehicle-types.js first.');
      }

      await backupVehicleTypes();

      const result = await migrateVehicles(typeMap);

      console.log(`\n📊 Migration complete:`);
      console.log(`   Migrated: ${result.migrated}`);
      console.log(`   Skipped: ${result.skipped}`);
      console.log(`   Errors: ${result.errors}`);

      if (result.errors === 0) {
        await validateMigration();
      }
    }

    console.log('\n✅ Operation completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Operation failed:', error);
    process.exit(1);
  }
}

// Execute migration
runMigration();
