/**
 * Migration: Create Vehicles Table
 * Creates Vehicle class with schema, indexes, and class-level permissions
 *
 * Dependencies:
 * - VehicleType table must exist (created in 002-create-vehicle-types.js)
 *
 * Schema:
 * - brand: String (required)
 * - model: String (required)
 * - year: Number (required)
 * - licensePlate: String (required, unique)
 * - vehicleTypeId: Pointer<VehicleType> (required)
 * - capacity: Number (required)
 * - color: String (required)
 * - maintenanceStatus: String (required, enum)
 * - insuranceExpiry: Date (optional)
 * - active: Boolean (default: true)
 * - exists: Boolean (default: true)
 */

const Parse = require('parse/node');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../../environments/.env.development') });

// Parse Server configuration
const PARSE_APP_ID = process.env.PARSE_APP_ID;
const PARSE_MASTER_KEY = process.env.PARSE_MASTER_KEY;
const PARSE_SERVER_URL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

Parse.initialize(PARSE_APP_ID);
Parse.masterKey = PARSE_MASTER_KEY;
Parse.serverURL = PARSE_SERVER_URL;

async function createVehicleClass() {
  console.log('\n=== Creating Vehicle Class ===\n');

  try {
    // Define schema
    const schema = new Parse.Schema('Vehicle');

    // Vehicle Information
    schema.addString('brand', { required: true });
    schema.addString('model', { required: true });
    schema.addNumber('year', { required: true });
    schema.addString('licensePlate', { required: true });
    schema.addPointer('vehicleTypeId', 'VehicleType', { required: true });

    // Specifications
    schema.addNumber('capacity', { required: true });
    schema.addString('color', { required: true });
    schema.addString('maintenanceStatus', { required: true });
    schema.addDate('insuranceExpiry');

    // Status fields
    schema.addBoolean('active', { defaultValue: true });
    schema.addBoolean('exists', { defaultValue: true });

    // Create or update the class
    try {
      await schema.get({ useMasterKey: true });
      console.log('✓ Vehicle class already exists, updating schema...');
      await schema.update({ useMasterKey: true });
      console.log('✓ Vehicle schema updated successfully');
    } catch (error) {
      if (error.code === Parse.Error.INVALID_CLASS_NAME) {
        console.log('Creating new Vehicle class...');
        await schema.save({ useMasterKey: true });
        console.log('✓ Vehicle class created successfully');
      } else {
        throw error;
      }
    }

    // Set Class Level Permissions
    console.log('\nSetting Class Level Permissions...');
    const clp = {
      find: { '*': true }, // Public read for authenticated users via middleware
      count: { '*': true },
      get: { '*': true },
      create: { 'role:Admin': true, 'role:SuperAdmin': true },
      update: { 'role:Admin': true, 'role:SuperAdmin': true },
      delete: { 'role:SuperAdmin': true },
      addField: { 'role:SuperAdmin': true },
      protectedFields: {
        '*': ['exists'] // Protect soft delete flag
      }
    };

    await Parse.Cloud.run('setClassLevelPermissions', {
      className: 'Vehicle',
      permissions: clp
    }, { useMasterKey: true }).catch(() => {
      console.log('⚠ Could not set CLP via Cloud Function, setting directly...');
      return schema.setCLP(clp).update({ useMasterKey: true });
    });

    console.log('✓ Class Level Permissions configured');

    // Create indexes
    console.log('\nCreating indexes...');

    try {
      // Unique index on license plate
      schema.addIndex('licensePlate_unique', { licensePlate: 1 }, { unique: true });
      console.log('✓ licensePlate_unique index added');
    } catch (e) {
      console.log('⚠ licensePlate index might already exist');
    }

    try {
      // Index on vehicleTypeId for joins
      schema.addIndex('vehicleTypeId_index', { vehicleTypeId: 1 });
      console.log('✓ vehicleTypeId_index added');
    } catch (e) {
      console.log('⚠ vehicleTypeId index might already exist');
    }

    try {
      // Index on maintenanceStatus for filtering
      schema.addIndex('maintenanceStatus_index', { maintenanceStatus: 1 });
      console.log('✓ maintenanceStatus_index added');
    } catch (e) {
      console.log('⚠ maintenanceStatus index might already exist');
    }

    try {
      // Index on insuranceExpiry for expiry tracking
      schema.addIndex('insuranceExpiry_index', { insuranceExpiry: 1 });
      console.log('✓ insuranceExpiry_index added');
    } catch (e) {
      console.log('⚠ insuranceExpiry index might already exist');
    }

    try {
      // Compound index for soft delete queries (active + exists)
      schema.addIndex('active_exists_index', { active: 1, exists: 1 });
      console.log('✓ active_exists_index added');
    } catch (e) {
      console.log('⚠ active_exists index might already exist');
    }

    // Save schema with indexes
    await schema.update({ useMasterKey: true });
    console.log('✓ Indexes created successfully');

    console.log('\n✅ Vehicle class setup completed successfully\n');
    return true;

  } catch (error) {
    console.error('❌ Error creating Vehicle class:', error);
    throw error;
  }
}

async function verifyVehicleTypeExists() {
  console.log('\n=== Verifying VehicleType dependency ===\n');

  try {
    const query = new Parse.Query('VehicleType');
    query.equalTo('active', true);
    query.equalTo('exists', true);
    const count = await query.count({ useMasterKey: true });

    if (count === 0) {
      console.error('❌ No active VehicleTypes found. Please run 002-create-vehicle-types.js first.');
      process.exit(1);
    }

    console.log(`✓ Found ${count} active vehicle types`);
    return true;

  } catch (error) {
    console.error('❌ VehicleType table does not exist. Please run 002-create-vehicle-types.js first.');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

async function runMigration() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     Migration: Create Vehicles Table                  ║');
  console.log('╚════════════════════════════════════════════════════════╝');

  try {
    // Verify dependencies
    await verifyVehicleTypeExists();

    // Create Vehicle class
    await createVehicleClass();

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║              Migration Completed Successfully         ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    process.exit(0);

  } catch (error) {
    console.error('\n╔════════════════════════════════════════════════════════╗');
    console.error('║                Migration Failed                        ║');
    console.error('╚════════════════════════════════════════════════════════╝\n');
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run migration
if (require.main === module) {
  runMigration();
}

module.exports = { createVehicleClass, verifyVehicleTypeExists };
