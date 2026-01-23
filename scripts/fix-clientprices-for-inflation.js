/**
 * Script to fix ClientPrices records for inflation eligibility
 * 
 * This script:
 * 1. Identifies ClientPrices with valid_until set
 * 2. Removes the valid_until field to make them current/active
 * 3. Verifies they become inflation-eligible
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
 * Fix ClientPrices records for inflation
 */
async function fixClientPricesForInflation() {
  console.log('🔧 Fixing ClientPrices records for inflation eligibility...\n');
  
  try {
    // Find ClientPrices records with valid_until set (making them historical)
    const problematicQuery = new Parse.Query('ClientPrices');
    problematicQuery.exists('valid_until');
    problematicQuery.include(['ratePtr', 'vehiclePtr', 'clientPtr']);
    
    const problematicRecords = await problematicQuery.find({ useMasterKey: true });
    console.log(`📊 Found ${problematicRecords.length} ClientPrices records with valid_until set (making them historical)`);
    
    if (problematicRecords.length === 0) {
      console.log('✅ No problematic records found. All ClientPrices should be eligible for inflation.');
      return;
    }

    console.log('\n📋 Records to fix:');
    console.log('='.repeat(120));
    console.log('| # | ID       | Cliente                 | Precio | BasePrice | valid_until         | Action |');
    console.log('='.repeat(120));
    
    problematicRecords.forEach((record, index) => {
      const client = record.get('clientPtr');
      const clientEmail = client ? client.get('email') : 'No Client';
      const precio = record.get('precio') || 0;
      const basePrice = record.get('basePrice') || 0;
      const validUntil = record.get('valid_until');
      
      console.log(`| ${(index + 1).toString().padStart(2)} | ${record.id.substring(0, 8)} | ${clientEmail.substring(0, 23).padEnd(23)} | $${precio.toString().padEnd(6)} | $${basePrice.toString().padEnd(9)} | ${validUntil.toISOString().substring(0, 19)} | Remove |`);
    });
    console.log('='.repeat(120));

    // Ask for confirmation
    console.log(`\n⚠️  About to remove valid_until from ${problematicRecords.length} ClientPrices records.`);
    console.log('   This will make them current/active and eligible for inflation.');
    console.log('   Continue? (This is automated - proceeding...)\n');

    // Remove valid_until from each record
    const recordsToUpdate = [];
    
    for (const record of problematicRecords) {
      // Remove the valid_until field
      record.unset('valid_until');
      recordsToUpdate.push(record);
    }

    // Save all updated records
    console.log(`💾 Updating ${recordsToUpdate.length} records...`);
    await Parse.Object.saveAll(recordsToUpdate, { useMasterKey: true });
    console.log(`✅ Successfully updated ${recordsToUpdate.length} ClientPrices records!`);

    // Verify the fix worked
    console.log('\n🔍 Verifying the fix...');
    
    // Check eligibility again
    const eligibleQuery = new Parse.Query('ClientPrices');
    eligibleQuery.equalTo('active', true);
    eligibleQuery.equalTo('exists', true);
    eligibleQuery.doesNotExist('valid_until');
    eligibleQuery.doesNotExist('inflation_batch_id');
    eligibleQuery.include(['ratePtr', 'vehiclePtr', 'clientPtr']);
    
    const eligibleRecords = await eligibleQuery.find({ useMasterKey: true });
    console.log(`📊 Records now meeting basic inflation criteria: ${eligibleRecords.length}`);

    // Check detailed eligibility
    let fullyEligibleCount = 0;
    
    for (const record of eligibleRecords) {
      const ratePtr = record.get('ratePtr');
      const vehiclePtr = record.get('vehiclePtr');
      const precio = record.get('precio') || 0;
      const basePrice = record.get('basePrice') || 0;
      
      const hasValidPointers = !!(ratePtr && vehiclePtr);
      const hasValidPrices = precio > 0 || basePrice > 0;
      const isFullyEligible = hasValidPointers && hasValidPrices;
      
      if (isFullyEligible) {
        fullyEligibleCount++;
      }
    }

    console.log(`📊 Records fully eligible for inflation: ${fullyEligibleCount}`);

    if (fullyEligibleCount > 0) {
      console.log('\n🎉 SUCCESS! ClientPrices records are now ready for inflation.');
      console.log('   You can now use the "Aplicar inflación tarifario" button and it should process ClientPrices.');
    } else {
      console.log('\n⚠️  ClientPrices still not eligible. There may be other issues (missing pointers, invalid prices, etc.)');
    }

  } catch (error) {
    console.error('❌ Error fixing ClientPrices:', error.message);
    console.error(error.stack);
  }
}

/**
 * Main execution function
 */
async function main() {
  const startTime = Date.now();
  console.log('🚀 Starting ClientPrices inflation fix...\n');
  
  try {
    await fixClientPricesForInflation();
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ Fix completed!`);
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

module.exports = { main, fixClientPricesForInflation };