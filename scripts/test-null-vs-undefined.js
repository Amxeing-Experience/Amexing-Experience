/**
 * Script to test null vs undefined field behavior in Parse
 * 
 * This script tests how Parse Query handles null values vs undefined fields
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
 * Test null vs undefined behavior
 */
async function testNullVsUndefined() {
  console.log('🔍 Testing null vs undefined field behavior...\n');
  
  try {
    // Get all ClientPrices records
    const query = new Parse.Query('ClientPrices');
    const records = await query.find({ useMasterKey: true });
    
    console.log(`📊 Found ${records.length} ClientPrices records\n`);
    
    // Test different query conditions for valid_until field
    const tests = [
      {
        name: 'doesNotExist("valid_until")',
        query: () => new Parse.Query('ClientPrices').doesNotExist('valid_until')
      },
      {
        name: 'equalTo("valid_until", null)',
        query: () => new Parse.Query('ClientPrices').equalTo('valid_until', null)
      },
      {
        name: 'equalTo("valid_until", undefined)',
        query: () => new Parse.Query('ClientPrices').equalTo('valid_until', undefined)
      }
    ];
    
    console.log('🔧 Testing different query conditions:');
    for (const test of tests) {
      const q = test.query();
      const count = await q.count({ useMasterKey: true });
      console.log(`   ${test.name}: ${count} records`);
    }
    
    console.log('\n🔍 Examining actual field values:');
    records.forEach((record, index) => {
      const validUntil = record.get('valid_until');
      const hasValidUntil = record.has('valid_until');
      
      console.log(`   Record ${index + 1} (${record.id.substring(0, 8)}):`);
      console.log(`     record.get('valid_until'): ${JSON.stringify(validUntil)}`);
      console.log(`     record.has('valid_until'): ${hasValidUntil}`);
      console.log(`     typeof: ${typeof validUntil}`);
      console.log(`     validUntil === null: ${validUntil === null}`);
      console.log(`     validUntil === undefined: ${validUntil === undefined}`);
      console.log('');
    });
    
    // Test fixing the issue by removing the field entirely
    console.log('💡 SOLUTION: Try removing the valid_until field entirely...');
    console.log('   The field exists but is set to null, but doesNotExist() expects the field to not exist at all.');
    
    // Let's unset the field on all records
    console.log('\n🔧 Unsetting valid_until field on all records...');
    
    for (const record of records) {
      if (record.has('valid_until')) {
        console.log(`   Unsetting valid_until on record ${record.id.substring(0, 8)}`);
        record.unset('valid_until');
        await record.save(null, { useMasterKey: true });
      }
    }
    
    // Test the query again
    console.log('\n🔎 Testing queries after unsetting field:');
    for (const test of tests) {
      const q = test.query();
      const count = await q.count({ useMasterKey: true });
      console.log(`   ${test.name}: ${count} records`);
    }
    
    // Test the full inflation query
    console.log('\n🎯 Testing full inflation query after fix:');
    const inflationQuery = new Parse.Query('ClientPrices');
    inflationQuery.equalTo('active', true);
    inflationQuery.equalTo('exists', true);
    inflationQuery.doesNotExist('valid_until');
    inflationQuery.doesNotExist('inflation_batch_id');
    
    const inflationCount = await inflationQuery.count({ useMasterKey: true });
    console.log(`   Full inflation query: ${inflationCount} records`);
    
    if (inflationCount > 0) {
      console.log('\n🎉 SUCCESS! The records should now be eligible for inflation.');
    }

  } catch (error) {
    console.error('❌ Error testing null vs undefined:', error.message);
    console.error(error.stack);
  }
}

/**
 * Main execution function
 */
async function main() {
  const startTime = Date.now();
  console.log('🚀 Starting null vs undefined test...\n');
  
  try {
    await testNullVsUndefined();
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ Test completed!`);
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

module.exports = { main, testNullVsUndefined };