/**
 * Script: Deactivate All Vehicle Types
 *
 * This script updates all VehicleType records in the database
 * setting the 'active' field from true to false.
 *
 * Usage: node scripts/deactivate-all-vehicle-types.js
 */

const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '../environments/.env.development'),
});

const Parse = require('parse/node');

// Initialize Parse
Parse.initialize(
  process.env.PARSE_APP_ID || 'amexing-app-id',
  process.env.PARSE_JAVASCRIPT_KEY || 'amexing-js-key',
  process.env.PARSE_MASTER_KEY || 'amexing-master-key'
);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

/**
 * Main function to deactivate all vehicle types
 */
async function deactivateAllVehicleTypes() {
  console.log('\n' + '='.repeat(80));
  console.log('🚗 DEACTIVATE ALL VEHICLE TYPES');
  console.log('='.repeat(80));

  try {
    // Step 1: Get all vehicle types
    console.log('\n📊 Fetching all VehicleType records...');
    const VehicleType = Parse.Object.extend('VehicleType');
    const query = new Parse.Query(VehicleType);
    query.equalTo('exists', true);
    query.equalTo('active', true);

    const vehicleTypes = await query.find({ useMasterKey: true });

    console.log(`✅ Found ${vehicleTypes.length} active vehicle types`);

    if (vehicleTypes.length === 0) {
      console.log('\n⚠️  No active vehicle types found to deactivate');
      console.log('='.repeat(80) + '\n');
      return;
    }

    // Step 2: Display records that will be updated
    console.log('\n📋 Vehicle Types to be deactivated:');
    vehicleTypes.forEach((vt, index) => {
      console.log(`   ${index + 1}. ${vt.get('name')} (${vt.get('code')}) - ID: ${vt.id}`);
    });

    // Step 3: Update all records
    console.log('\n🔄 Updating records...');

    let successCount = 0;
    let errorCount = 0;

    for (const vehicleType of vehicleTypes) {
      try {
        vehicleType.set('active', false);
        await vehicleType.save(null, { useMasterKey: true });
        successCount++;
        console.log(`   ✅ Deactivated: ${vehicleType.get('name')} (${vehicleType.id})`);
      } catch (error) {
        errorCount++;
        console.error(`   ❌ Error deactivating ${vehicleType.get('name')}: ${error.message}`);
      }
    }

    // Step 4: Verification
    console.log('\n🔍 Verifying changes...');
    const verifyQuery = new Parse.Query(VehicleType);
    verifyQuery.equalTo('exists', true);
    verifyQuery.equalTo('active', true);

    const remainingActive = await verifyQuery.find({ useMasterKey: true });

    // Step 5: Summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 SUMMARY');
    console.log('='.repeat(80));
    console.log(`   Total processed: ${vehicleTypes.length}`);
    console.log(`   Successfully deactivated: ${successCount}`);
    console.log(`   Errors: ${errorCount}`);
    console.log(`   Remaining active: ${remainingActive.length}`);

    if (successCount === vehicleTypes.length && remainingActive.length === 0) {
      console.log('\n✅ ALL VEHICLE TYPES SUCCESSFULLY DEACTIVATED!');
    } else if (errorCount > 0) {
      console.log('\n⚠️  COMPLETED WITH ERRORS');
    } else if (remainingActive.length > 0) {
      console.log('\n⚠️  WARNING: Some vehicle types are still active');
      console.log('   Remaining active:');
      remainingActive.forEach((vt) => {
        console.log(`   - ${vt.get('name')} (${vt.id})`);
      });
    }

    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('\n❌ Script error:', error.message);
    console.error(error);
    process.exit(1);
  }

  process.exit(0);
}

// Run the script
deactivateAllVehicleTypes().catch((error) => {
  console.error('\n❌ Unhandled error:', error);
  process.exit(1);
});
