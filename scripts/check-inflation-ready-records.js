#!/usr/bin/env node

/**
 * Check Inflation Ready Records
 * Shows how many records are available for inflation processing
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

async function checkInflationReadyRecords() {
    log('\n' + '='.repeat(70), 'bright');
    log('INFLATION READY RECORDS CHECK', 'bright');
    log('='.repeat(70), 'bright');

    try {
        const classesToProcess = ['RatePrices', 'TourPrices', 'ClientPrices'];

        for (const className of classesToProcess) {
            log(`\n🔍 Analyzing ${className}...`, 'cyan');
            
            const ClassObj = Parse.Object.extend(className);
            
            // Total active records
            const totalQuery = new Parse.Query(ClassObj);
            totalQuery.equalTo('active', true);
            totalQuery.equalTo('exists', true);
            totalQuery.doesNotExist('valid_until');
            
            const totalCount = await totalQuery.count({ useMasterKey: true });
            log(`Total active ${className} records: ${totalCount}`, 'blue');
            
            // Records ready for inflation (without inflation_batch_id)
            const readyQuery = new Parse.Query(ClassObj);
            readyQuery.equalTo('active', true);
            readyQuery.equalTo('exists', true);
            readyQuery.doesNotExist('valid_until');
            readyQuery.doesNotExist('inflation_batch_id');
            
            const readyCount = await readyQuery.count({ useMasterKey: true });
            log(`Records ready for inflation: ${readyCount}`, readyCount > 0 ? 'green' : 'yellow');
            
            // Already inflated records
            const inflatedQuery = new Parse.Query(ClassObj);
            inflatedQuery.equalTo('active', true);
            inflatedQuery.equalTo('exists', true);
            inflatedQuery.doesNotExist('valid_until');
            inflatedQuery.exists('inflation_batch_id');
            
            const inflatedCount = await inflatedQuery.count({ useMasterKey: true });
            log(`Already inflated records: ${inflatedCount}`, 'blue');
            
            // Historical records
            const historicalQuery = new Parse.Query(ClassObj);
            historicalQuery.equalTo('exists', true);
            historicalQuery.exists('valid_until');
            
            const historicalCount = await historicalQuery.count({ useMasterKey: true });
            log(`Historical records: ${historicalCount}`, 'blue');
            
            if (readyCount > 0) {
                log(`✅ ${className} has records ready for inflation`, 'green');
            } else if (totalCount > 0) {
                log(`⚠️  ${className} has no records ready for inflation (all already inflated)`, 'yellow');
            } else {
                log(`❌ ${className} has no active records at all`, 'red');
            }
        }
        
        log('\n' + '='.repeat(70), 'bright');
        log('SUMMARY', 'bright');
        log('If you see "Records ready for inflation: 0" for all tables,', 'yellow');
        log('it means all existing records have already been inflated.', 'yellow');
        log('This is why the inflation process shows "0 records processed".', 'yellow');
        log('\nTo test inflation again, you can either:', 'cyan');
        log('1. Add new price records without inflation_batch_id', 'cyan');
        log('2. Run the reset script: node scripts/reset-inflation-for-testing.js', 'cyan');
        log('='.repeat(70), 'bright');

        return true;
        
    } catch (error) {
        log(`❌ Script failed with error: ${error.message}`, 'red');
        console.error(error.stack);
        return false;
    }
}

// Run the check
checkInflationReadyRecords().then((success) => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});