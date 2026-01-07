/**
 * Script to check ClientPrices records in detail
 * 
 * This script examines all fields of ClientPrices records
 * to understand their current state
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
 * Check ClientPrices records in detail
 */
async function checkClientPricesDetailed() {
  console.log('🔍 Detailed ClientPrices Analysis...\n');
  
  try {
    // Get all ClientPrices records
    const query = new Parse.Query('ClientPrices');
    query.include(['ratePtr', 'vehiclePtr', 'clientPtr']);
    query.limit(1000);
    
    const records = await query.find({ useMasterKey: true });
    console.log(`📊 Total ClientPrices records: ${records.length}\n`);
    
    if (records.length === 0) {
      console.log('❌ No ClientPrices records found!');
      return;
    }

    // Analyze each record
    records.forEach((record, index) => {
      console.log(`📋 Record ${index + 1} (ID: ${record.id}):`);
      console.log(`   Created: ${record.get('createdAt')}`);
      console.log(`   Updated: ${record.get('updatedAt')}`);
      
      // Check all the fields we care about
      const fields = {
        active: record.get('active'),
        exists: record.get('exists'),
        valid_until: record.get('valid_until'),
        inflation_batch_id: record.get('inflation_batch_id'),
        precio: record.get('precio'),
        basePrice: record.get('basePrice'),
        currency: record.get('currency'),
        itemType: record.get('itemType'),
        itemId: record.get('itemId'),
        notes: record.get('notes')
      };
      
      // Check pointers
      const ratePtr = record.get('ratePtr');
      const vehiclePtr = record.get('vehiclePtr');  
      const clientPtr = record.get('clientPtr');
      
      console.log('   Fields:');
      for (const [key, value] of Object.entries(fields)) {
        console.log(`     ${key}: ${JSON.stringify(value)}`);
      }
      
      console.log('   Pointers:');
      console.log(`     ratePtr: ${ratePtr ? `${ratePtr.id} (${ratePtr.get('name')})` : 'null'}`);
      console.log(`     vehiclePtr: ${vehiclePtr ? `${vehiclePtr.id} (${vehiclePtr.get('name')})` : 'null'}`);
      console.log(`     clientPtr: ${clientPtr ? `${clientPtr.id} (${clientPtr.get('email')})` : 'null'}`);
      
      // Check inflation eligibility for this record
      const hasActiveExists = fields.active === true && fields.exists === true;
      const hasNoValidUntil = fields.valid_until === null || fields.valid_until === undefined;
      const hasNoInflationBatch = fields.inflation_batch_id === null || fields.inflation_batch_id === undefined;
      const hasValidPointers = !!(ratePtr && vehiclePtr);
      const hasValidPrices = (fields.precio && fields.precio > 0) || (fields.basePrice && fields.basePrice > 0);
      
      const isEligible = hasActiveExists && hasNoValidUntil && hasNoInflationBatch && hasValidPointers && hasValidPrices;
      
      console.log('   Inflation Eligibility:');
      console.log(`     active=true & exists=true: ${hasActiveExists ? '✅' : '❌'}`);
      console.log(`     valid_until is null: ${hasNoValidUntil ? '✅' : '❌'}`);
      console.log(`     inflation_batch_id is null: ${hasNoInflationBatch ? '✅' : '❌'}`);
      console.log(`     has valid pointers: ${hasValidPointers ? '✅' : '❌'}`);
      console.log(`     has valid prices: ${hasValidPrices ? '✅' : '❌'}`);
      console.log(`     ELIGIBLE FOR INFLATION: ${isEligible ? '✅ YES' : '❌ NO'}`);
      
      console.log(''); // blank line for readability
    });

    // Summary
    const eligibleCount = records.filter(record => {
      const hasActiveExists = record.get('active') === true && record.get('exists') === true;
      const hasNoValidUntil = record.get('valid_until') === null || record.get('valid_until') === undefined;
      const hasNoInflationBatch = record.get('inflation_batch_id') === null || record.get('inflation_batch_id') === undefined;
      const hasValidPointers = !!(record.get('ratePtr') && record.get('vehiclePtr'));
      const hasValidPrices = (record.get('precio') && record.get('precio') > 0) || (record.get('basePrice') && record.get('basePrice') > 0);
      
      return hasActiveExists && hasNoValidUntil && hasNoInflationBatch && hasValidPointers && hasValidPrices;
    }).length;

    console.log('📊 SUMMARY:');
    console.log(`   Total records: ${records.length}`);
    console.log(`   Eligible for inflation: ${eligibleCount}`);
    
    if (eligibleCount === 0) {
      console.log('\n❌ NO RECORDS ARE ELIGIBLE FOR INFLATION!');
      console.log('   This explains why the inflation process skips ClientPrices.');
    } else {
      console.log(`\n✅ ${eligibleCount} records should be processed during inflation.`);
    }

  } catch (error) {
    console.error('❌ Error checking ClientPrices:', error.message);
    console.error(error.stack);
  }
}

/**
 * Main execution function
 */
async function main() {
  const startTime = Date.now();
  console.log('🚀 Starting detailed ClientPrices analysis...\n');
  
  try {
    await checkClientPricesDetailed();
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ Analysis completed!`);
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

module.exports = { main, checkClientPricesDetailed };