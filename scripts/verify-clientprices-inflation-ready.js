/**
 * Script to verify ClientPrices records are ready for inflation
 * 
 * This script checks:
 * 1. If ClientPrices records exist
 * 2. If they meet inflation criteria
 * 3. Their current status and field values
 * 
 * Created by Denisse Maldonado
 * @version 1.0.0
 */

const Parse = require('parse/node');
const path = require('path');

// Parse Server configuration
require('dotenv').config({ path: path.join(__dirname, '../environments/.env.development') });
Parse.initialize(
  process.env.PARSE_APP_ID || 'CrTRTaJpoJFNt8PJ',
  null,
  process.env.PARSE_MASTER_KEY || 'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP'
);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

/**
 * Check ClientPrices records and their inflation readiness
 */
async function verifyClientPricesInflationReadiness() {
  console.log('🔍 Verifying ClientPrices inflation readiness...\n');
  
  try {
    // First, check all ClientPrices records
    const allClientPricesQuery = new Parse.Query('ClientPrices');
    allClientPricesQuery.include(['ratePtr', 'vehiclePtr', 'clientPtr']);
    allClientPricesQuery.limit(1000);
    
    const allClientPrices = await allClientPricesQuery.find({ useMasterKey: true });
    console.log(`📊 Total ClientPrices records found: ${allClientPrices.length}`);
    
    if (allClientPrices.length === 0) {
      console.log('❌ No ClientPrices records found in database!');
      return;
    }

    // Display summary of all records
    console.log('\n📋 All ClientPrices Records:');
    console.log('='.repeat(100));
    console.log('| # | ID       | Active | Exists | Valid Until | Inflation Batch | Cliente Email           | Precio | BasePrice |');
    console.log('='.repeat(100));
    
    allClientPrices.forEach((record, index) => {
      const client = record.get('clientPtr');
      const clientEmail = client ? (client.get('email') || 'Unknown') : 'No Client';
      const active = record.get('active');
      const exists = record.get('exists');
      const validUntil = record.get('valid_until');
      const inflationBatchId = record.get('inflation_batch_id');
      const precio = record.get('precio');
      const basePrice = record.get('basePrice');
      
      console.log(`| ${(index + 1).toString().padStart(2)} | ${record.id.substring(0, 8)} | ${active ? '✓' : '✗'}      | ${exists ? '✓' : '✗'}      | ${validUntil ? 'YES' : 'NO'.padEnd(11)} | ${inflationBatchId ? 'YES' : 'NO'.padEnd(15)} | ${clientEmail.substring(0, 23).padEnd(23)} | $${precio || 0}    | $${basePrice || 0}     |`);
    });
    console.log('='.repeat(100));

    // Now check records that should be eligible for inflation
    console.log('\n🎯 Checking Inflation Eligibility Criteria...');
    console.log('\nInflation criteria (from cloud function):');
    console.log('✓ active = true');
    console.log('✓ exists = true'); 
    console.log('✓ valid_until does not exist (null)');
    console.log('✓ inflation_batch_id does not exist (null)');
    console.log('✓ ratePtr exists');
    console.log('✓ vehiclePtr exists');
    console.log('✓ precio > 0 OR basePrice > 0');

    const eligibleQuery = new Parse.Query('ClientPrices');
    eligibleQuery.equalTo('active', true);
    eligibleQuery.equalTo('exists', true);
    eligibleQuery.doesNotExist('valid_until');
    eligibleQuery.doesNotExist('inflation_batch_id');
    eligibleQuery.include(['ratePtr', 'vehiclePtr', 'clientPtr']);
    
    const eligibleRecords = await eligibleQuery.find({ useMasterKey: true });
    console.log(`\n🔎 Records meeting basic criteria: ${eligibleRecords.length}`);

    if (eligibleRecords.length === 0) {
      console.log('\n❌ No records meet the basic inflation criteria!');
      
      // Let's check what's preventing inflation
      console.log('\n🔧 Debugging - Checking each criteria separately:');
      
      // Check active=true
      const activeQuery = new Parse.Query('ClientPrices');
      activeQuery.equalTo('active', true);
      const activeCount = await activeQuery.count({ useMasterKey: true });
      console.log(`   Records with active=true: ${activeCount}`);
      
      // Check exists=true
      const existsQuery = new Parse.Query('ClientPrices');
      existsQuery.equalTo('exists', true);
      const existsCount = await existsQuery.count({ useMasterKey: true });
      console.log(`   Records with exists=true: ${existsCount}`);
      
      // Check no valid_until
      const noValidUntilQuery = new Parse.Query('ClientPrices');
      noValidUntilQuery.doesNotExist('valid_until');
      const noValidUntilCount = await noValidUntilQuery.count({ useMasterKey: true });
      console.log(`   Records without valid_until: ${noValidUntilCount}`);
      
      // Check no inflation_batch_id
      const noBatchIdQuery = new Parse.Query('ClientPrices');
      noBatchIdQuery.doesNotExist('inflation_batch_id');
      const noBatchIdCount = await noBatchIdQuery.count({ useMasterKey: true });
      console.log(`   Records without inflation_batch_id: ${noBatchIdCount}`);
      
      return;
    }

    // Check detailed eligibility for each record
    console.log('\n📊 Detailed Eligibility Check:');
    console.log('='.repeat(120));
    console.log('| # | ID       | RatePtr | VehiclePtr | ClientPtr | Precio | BasePrice | Valid Price? | Eligible |');
    console.log('='.repeat(120));
    
    let fullyEligibleCount = 0;
    
    for (let i = 0; i < eligibleRecords.length; i++) {
      const record = eligibleRecords[i];
      const ratePtr = record.get('ratePtr');
      const vehiclePtr = record.get('vehiclePtr');
      const clientPtr = record.get('clientPtr');
      const precio = record.get('precio') || 0;
      const basePrice = record.get('basePrice') || 0;
      
      const hasValidPointers = !!(ratePtr && vehiclePtr);
      const hasValidPrices = precio > 0 || basePrice > 0;
      const isFullyEligible = hasValidPointers && hasValidPrices;
      
      if (isFullyEligible) {
        fullyEligibleCount++;
      }
      
      console.log(`| ${(i + 1).toString().padStart(2)} | ${record.id.substring(0, 8)} | ${ratePtr ? '✓' : '✗'}.padEnd(7)} | ${vehiclePtr ? '✓' : '✗'}.padEnd(10)} | ${clientPtr ? '✓' : '✗'}.padEnd(9)} | $${precio.toString().padEnd(6)} | $${basePrice.toString().padEnd(9)} | ${hasValidPrices ? '✓' : '✗'}.padEnd(12)} | ${isFullyEligible ? '✅' : '❌'}.padEnd(8)} |`);
    }
    
    console.log('='.repeat(120));
    console.log(`\n🎯 Summary:`);
    console.log(`   Total ClientPrices records: ${allClientPrices.length}`);
    console.log(`   Meeting basic criteria: ${eligibleRecords.length}`);
    console.log(`   Fully eligible for inflation: ${fullyEligibleCount}`);
    
    if (fullyEligibleCount === 0) {
      console.log('\n❌ No ClientPrices records are ready for inflation!');
      console.log('   This explains why inflation is not processing ClientPrices.');
    } else {
      console.log(`\n✅ ${fullyEligibleCount} ClientPrices records should be processed during inflation.`);
    }

    // Check if we have the expected 5 test records we created
    console.log('\n🔍 Checking for our test records...');
    const testRecordsQuery = new Parse.Query('ClientPrices');
    testRecordsQuery.equalTo('notes', 'Test data created by script');
    testRecordsQuery.include(['ratePtr', 'vehiclePtr', 'clientPtr']);
    
    const testRecords = await testRecordsQuery.find({ useMasterKey: true });
    console.log(`   Test records found: ${testRecords.length}`);
    
    if (testRecords.length > 0) {
      console.log('\n📋 Test Records Details:');
      testRecords.forEach((record, index) => {
        const client = record.get('clientPtr');
        const rate = record.get('ratePtr');
        const vehicle = record.get('vehiclePtr');
        
        console.log(`   ${index + 1}. ID: ${record.id}`);
        console.log(`      Client: ${client ? client.get('email') : 'Missing'}`);
        console.log(`      Rate: ${rate ? rate.get('name') : 'Missing'}`);
        console.log(`      Vehicle: ${vehicle ? vehicle.get('name') : 'Missing'}`);
        console.log(`      Precio: $${record.get('precio') || 0}`);
        console.log(`      BasePrice: $${record.get('basePrice') || 0}`);
        console.log(`      Active: ${record.get('active')}`);
        console.log(`      Exists: ${record.get('exists')}`);
        console.log(`      Valid Until: ${record.get('valid_until') || 'null'}`);
        console.log(`      Inflation Batch: ${record.get('inflation_batch_id') || 'null'}`);
        console.log('');
      });
    }

  } catch (error) {
    console.error('❌ Error verifying ClientPrices:', error.message);
    console.error(error.stack);
  }
}

/**
 * Main execution function
 */
async function main() {
  const startTime = Date.now();
  console.log('🚀 Starting ClientPrices inflation readiness verification...\n');
  
  try {
    await verifyClientPricesInflationReadiness();
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ Verification completed!`);
    console.log(`⏱️  Duration: ${duration}ms`);
    
  } catch (error) {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { main, verifyClientPricesInflationReadiness };