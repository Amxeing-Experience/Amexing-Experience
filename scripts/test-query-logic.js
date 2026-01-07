#!/usr/bin/env node

/**
 * Test Query Logic
 * Tests the exact query used in the inflation job to verify it finds records
 * Created by Denisse Maldonado
 */

require('dotenv').config({ path: './environments/.env.development' });
const Parse = require('parse/node');

// Initialize Parse
Parse.initialize(process.env.PARSE_APP_ID, process.env.PARSE_JAVASCRIPT_KEY, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testQueryLogic() {
    log('\n' + '='.repeat(70), 'bright');
    log('TEST QUERY LOGIC (EXACT INFLATION JOB QUERY)', 'bright');
    log('='.repeat(70), 'bright');

    try {
        const classesToProcess = ['RatePrices', 'TourPrices', 'ClientPrices'];

        for (const className of classesToProcess) {
            log(`\n🔍 Testing ${className}...`, 'cyan');
            
            const ClassObj = Parse.Object.extend(className);
            
            // EXACT SAME QUERY AS THE INFLATION JOB
            const query = new Parse.Query(ClassObj);
            query.equalTo('active', true);
            query.equalTo('exists', true);
            query.doesNotExist('valid_until'); // Don't process historical records
            query.doesNotExist('inflation_batch_id'); // Don't process already inflated records
            query.limit(100);
            
            log(`Query conditions:`, 'yellow');
            log(`  - active: true`, 'yellow');
            log(`  - exists: true`, 'yellow');
            log(`  - valid_until: does not exist`, 'yellow');
            log(`  - inflation_batch_id: does not exist`, 'yellow');
            log(`  - limit: 100`, 'yellow');
            
            // Count matching records
            const totalMatchingRecords = await query.count({ useMasterKey: true });
            log(`📊 Found ${totalMatchingRecords} records`, totalMatchingRecords > 0 ? 'green' : 'red');
            
            if (totalMatchingRecords > 0) {
                // Get first few records to verify they're correct
                const sampleQuery = new Parse.Query(ClassObj);
                sampleQuery.equalTo('active', true);
                sampleQuery.equalTo('exists', true);
                sampleQuery.doesNotExist('valid_until');
                sampleQuery.doesNotExist('inflation_batch_id');
                sampleQuery.limit(3);
                
                const sampleRecords = await sampleQuery.find({ useMasterKey: true });
                log(`✅ Sample records found: ${sampleRecords.length}`, 'green');
                
                for (let i = 0; i < sampleRecords.length; i++) {
                    const record = sampleRecords[i];
                    const price = className === 'ClientPrices' ? record.get('precio') : record.get('price');
                    log(`  Record ${i + 1}: ID=${record.id}, Price=${price}, Active=${record.get('active')}, Exists=${record.get('exists')}`, 'blue');
                    log(`    valid_until: ${record.get('valid_until') || 'undefined'}`, 'blue');
                    log(`    inflation_batch_id: ${record.get('inflation_batch_id') || 'undefined'}`, 'blue');
                }
            } else {
                log(`❌ No records match the inflation job criteria`, 'red');
                
                // Let's debug why
                log(`\n🔍 Debugging why no records found:`, 'yellow');
                
                // Check total active records
                const activeQuery = new Parse.Query(ClassObj);
                activeQuery.equalTo('active', true);
                activeQuery.equalTo('exists', true);
                const activeCount = await activeQuery.count({ useMasterKey: true });
                log(`  Total active records: ${activeCount}`, 'blue');
                
                // Check how many have valid_until
                const historicalQuery = new Parse.Query(ClassObj);
                historicalQuery.equalTo('active', true);
                historicalQuery.equalTo('exists', true);
                historicalQuery.exists('valid_until');
                const historicalCount = await historicalQuery.count({ useMasterKey: true });
                log(`  Historical records (have valid_until): ${historicalCount}`, 'blue');
                
                // Check how many have inflation_batch_id
                const inflatedQuery = new Parse.Query(ClassObj);
                inflatedQuery.equalTo('active', true);
                inflatedQuery.equalTo('exists', true);
                inflatedQuery.doesNotExist('valid_until');
                inflatedQuery.exists('inflation_batch_id');
                const inflatedCount = await inflatedQuery.count({ useMasterKey: true });
                log(`  Already inflated records: ${inflatedCount}`, 'blue');
                
                // Calculate what should be available
                const shouldBeAvailable = activeCount - historicalCount - inflatedCount;
                log(`  Should be available for inflation: ${shouldBeAvailable}`, shouldBeAvailable > 0 ? 'green' : 'red');
            }
        }
        
        log('\n' + '='.repeat(70), 'bright');
        return true;
        
    } catch (error) {
        log(`❌ Test failed with error: ${error.message}`, 'red');
        console.error(error.stack);
        return false;
    }
}

// Run the test
testQueryLogic().then((success) => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});