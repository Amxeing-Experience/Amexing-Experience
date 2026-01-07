const Parse = require('parse/node');
require('dotenv').config({ path: './environments/.env.development' });

Parse.initialize(process.env.PARSE_APP_ID, process.env.PARSE_JAVASCRIPT_KEY, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

async function checkPriceRecords() {
  try {
    console.log('Checking price records for inflation eligibility...\n');

    const tables = [
      'ClientPriceServiceType',
      'ClientPriceBaseAirfare',
      'PriceServiceType',
      'PriceBaseAirfare',
      'PriceExtraServices'
    ];

    for (const tableName of tables) {
      console.log(`\n=== ${tableName} ===`);
      
      const query = new Parse.Query(tableName);
      query.limit(1000);
      const records = await query.find({ useMasterKey: true });
      
      console.log(`Total records: ${records.length}`);
      
      // Count records by criteria
      let activeExists = 0;
      let hasValidUntil = 0;
      let hasInflationBatchId = 0;
      let eligibleForInflation = 0;
      
      records.forEach(record => {
        const isActive = record.get('active') === true;
        const exists = record.get('exists') === true;
        const validUntil = record.get('valid_until');
        const inflationBatchId = record.get('inflation_batch_id');
        
        if (isActive && exists) activeExists++;
        if (validUntil) hasValidUntil++;
        if (inflationBatchId) hasInflationBatchId++;
        
        // Check if eligible (matching cloud function query)
        if (isActive && exists && !validUntil && !inflationBatchId) {
          eligibleForInflation++;
        }
      });
      
      console.log(`- Active & Exists: ${activeExists}`);
      console.log(`- Has valid_until: ${hasValidUntil}`);
      console.log(`- Has inflation_batch_id: ${hasInflationBatchId}`);
      console.log(`- ELIGIBLE for inflation: ${eligibleForInflation}`);
      
      // Show sample record
      if (records.length > 0) {
        const sample = records[0];
        console.log('\nSample record fields:');
        console.log(`  - active: ${sample.get('active')}`);
        console.log(`  - exists: ${sample.get('exists')}`);
        console.log(`  - valid_until: ${sample.get('valid_until')}`);
        console.log(`  - inflation_batch_id: ${sample.get('inflation_batch_id')}`);
        console.log(`  - price/amount: ${sample.get('price') || sample.get('amount')}`);
      }
    }

    console.log('\n\nSUMMARY:');
    console.log('The inflation query looks for records where:');
    console.log('1. active = true');
    console.log('2. exists = true');
    console.log('3. valid_until is NOT set (undefined/null)');
    console.log('4. inflation_batch_id is NOT set (undefined/null)');
    console.log('\nIf records have valid_until or inflation_batch_id, they will be excluded from inflation.');

  } catch (error) {
    console.error('Error checking records:', error);
  }
}

checkPriceRecords();