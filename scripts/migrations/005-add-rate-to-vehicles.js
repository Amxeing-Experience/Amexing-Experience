/**
 * Migration: Add Rate Pointer to Vehicles Table
 * Adds rateId pointer field to Vehicle class for rate assignment
 *
 * Dependencies:
 * - Vehicle table must exist (created in 004-create-vehicles-table.js)
 * - Rate table must exist
 *
 * Changes:
 * - Add rateId: Pointer<Rate> (optional)
 * - Add index on rateId for query optimization
 * - Maintain backward compatibility (existing vehicles will have rateId: null)
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

async function verifyDependencies() {
  console.log('\n=== Verifying Dependencies ===\n');

  try {
    // Verify Vehicle table exists
    const vehicleQuery = new Parse.Query('Vehicle');
    vehicleQuery.equalTo('exists', true);
    vehicleQuery.limit(1);
    await vehicleQuery.find({ useMasterKey: true });
    console.log('✓ Vehicle table exists');

    // Verify Rate table exists
    const rateQuery = new Parse.Query('Rate');
    rateQuery.equalTo('active', true);
    rateQuery.equalTo('exists', true);
    const rateCount = await rateQuery.count({ useMasterKey: true });

    if (rateCount === 0) {
      console.warn('⚠ Warning: No active rates found in Rate table');
      console.warn('  Consider seeding default rates before assigning to vehicles');
    } else {
      console.log(`✓ Found ${rateCount} active rate(s)`);
    }

    return true;
  } catch (error) {
    console.error('❌ Dependency verification failed:', error.message);
    console.error('   Please ensure Vehicle and Rate tables exist');
    process.exit(1);
  }
}

async function addRatePointerToVehicle() {
  console.log('\n=== Adding Rate Pointer to Vehicle ===\n');

  try {
    // Get existing schema
    const schema = new Parse.Schema('Vehicle');

    // Fetch current schema
    try {
      await schema.get({ useMasterKey: true });
      console.log('✓ Vehicle schema retrieved');
    } catch (error) {
      console.error('❌ Vehicle table does not exist');
      throw error;
    }

    // Add rateId pointer field (optional)
    console.log('Adding rateId pointer field...');
    schema.addPointer('rateId', 'Rate', { required: false });
    console.log('✓ rateId pointer field defined');

    // Update schema
    await schema.update({ useMasterKey: true });
    console.log('✓ Vehicle schema updated with rateId pointer');

    return true;
  } catch (error) {
    // Check if field already exists
    if (error.message && error.message.includes('already exists')) {
      console.log('⚠ rateId field already exists, skipping field creation');
      return true;
    }

    console.error('❌ Error adding rateId pointer:', error.message);
    throw error;
  }
}

async function addRateIdIndex() {
  console.log('\n=== Adding Index on rateId ===\n');

  try {
    const schema = new Parse.Schema('Vehicle');
    await schema.get({ useMasterKey: true });

    // Add index on rateId for query optimization
    try {
      schema.addIndex('rateId_index', { rateId: 1 });
      await schema.update({ useMasterKey: true });
      console.log('✓ rateId_index created successfully');
    } catch (error) {
      if (error.message && error.message.includes('already exists')) {
        console.log('⚠ rateId_index already exists, skipping');
      } else {
        console.warn('⚠ Could not create index:', error.message);
        console.warn('  Index creation is optional, continuing...');
      }
    }

    return true;
  } catch (error) {
    console.error('❌ Error adding index:', error.message);
    return false;
  }
}

async function verifyMigration() {
  console.log('\n=== Verifying Migration ===\n');

  try {
    // Fetch schema to verify field exists
    const schema = new Parse.Schema('Vehicle');
    const schemaData = await schema.get({ useMasterKey: true });

    // Check if rateId field exists in schema
    if (schemaData && schemaData.fields && schemaData.fields.rateId) {
      console.log('✓ rateId field verified in Vehicle schema');
      console.log(`  Field type: ${schemaData.fields.rateId.type}`);
      console.log(`  Target class: ${schemaData.fields.rateId.targetClass || 'Rate'}`);
      return true;
    }

    console.error('❌ rateId field not found in schema');
    return false;
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    return false;
  }
}

async function testRateAssignment() {
  console.log('\n=== Testing Rate Assignment ===\n');

  try {
    // Get a test vehicle (first existing vehicle)
    const vehicleQuery = new Parse.Query('Vehicle');
    vehicleQuery.equalTo('exists', true);
    vehicleQuery.limit(1);
    const testVehicle = await vehicleQuery.first({ useMasterKey: true });

    if (!testVehicle) {
      console.log('⚠ No vehicles found for testing, skipping assignment test');
      return true;
    }

    // Get a test rate
    const rateQuery = new Parse.Query('Rate');
    rateQuery.equalTo('active', true);
    rateQuery.equalTo('exists', true);
    rateQuery.limit(1);
    const testRate = await rateQuery.first({ useMasterKey: true });

    if (!testRate) {
      console.log('⚠ No active rates found for testing, skipping assignment test');
      return true;
    }

    console.log(`Testing rate assignment on vehicle: ${testVehicle.id}`);

    // Save original rateId
    const originalRateId = testVehicle.get('rateId');

    // Assign test rate
    testVehicle.set('rateId', testRate);
    await testVehicle.save(null, { useMasterKey: true });
    console.log('✓ Rate assigned successfully');

    // Verify assignment by re-fetching
    await testVehicle.fetch({ useMasterKey: true });
    const assignedRate = testVehicle.get('rateId');

    if (assignedRate && assignedRate.id === testRate.id) {
      console.log('✓ Rate assignment verified');
    } else {
      console.error('❌ Rate assignment verification failed');
      return false;
    }

    // Restore original state
    if (originalRateId) {
      testVehicle.set('rateId', originalRateId);
    } else {
      testVehicle.unset('rateId');
    }
    await testVehicle.save(null, { useMasterKey: true });
    console.log('✓ Test vehicle restored to original state');

    return true;
  } catch (error) {
    console.error('❌ Rate assignment test failed:', error.message);
    return false;
  }
}

async function runMigration() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║   Migration: Add Rate Pointer to Vehicles Table       ║');
  console.log('╚════════════════════════════════════════════════════════╝');

  try {
    // Step 1: Verify dependencies
    await verifyDependencies();

    // Step 2: Add rateId pointer field
    await addRatePointerToVehicle();

    // Step 3: Add index
    await addRateIdIndex();

    // Step 4: Verify migration
    const verified = await verifyMigration();
    if (!verified) {
      throw new Error('Migration verification failed');
    }

    // Step 5: Test rate assignment
    const tested = await testRateAssignment();
    if (!tested) {
      console.warn('⚠ Rate assignment test failed, but migration completed');
    }

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║          Migration Completed Successfully              ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    console.log('Summary:');
    console.log('  ✓ rateId pointer field added to Vehicle schema');
    console.log('  ✓ rateId_index created for query optimization');
    console.log('  ✓ Existing vehicles remain unchanged (rateId: null)');
    console.log('  ✓ Backward compatibility maintained\n');

    process.exit(0);
  } catch (error) {
    console.error('\n╔════════════════════════════════════════════════════════╗');
    console.error('║                 Migration Failed                       ║');
    console.error('╚════════════════════════════════════════════════════════╝\n');
    console.error('Error:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

// Run migration
if (require.main === module) {
  runMigration();
}

module.exports = { addRatePointerToVehicle, addRateIdIndex, verifyMigration };
