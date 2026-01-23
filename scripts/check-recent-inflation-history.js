#!/usr/bin/env node

/**
 * Check Recent Inflation History
 * Shows the most recent inflation attempts to debug what happened
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

async function checkRecentInflationHistory() {
    log('\n' + '='.repeat(70), 'bright');
    log('RECENT INFLATION HISTORY CHECK', 'bright');
    log('='.repeat(70), 'bright');

    try {
        const InflationHistory = Parse.Object.extend('InflationHistory');
        const query = new Parse.Query(InflationHistory);
        query.descending('createdAt');
        query.limit(10);
        
        const history = await query.find({ useMasterKey: true });
        
        if (history.length === 0) {
            log('❌ No inflation history records found', 'red');
            return true;
        }
        
        log(`📊 Found ${history.length} recent inflation attempts:`, 'cyan');
        
        for (let i = 0; i < history.length; i++) {
            const record = history[i];
            const batchId = record.get('batchId');
            const percentage = record.get('percentage');
            const status = record.get('status');
            const processedCount = record.get('processed_count') || 0;
            const errorCount = record.get('error_count') || 0;
            const createdAt = record.get('createdAt');
            const startedAt = record.get('startedAt');
            const completedAt = record.get('completedAt');
            const errorMessage = record.get('error_message');
            
            log(`\n📋 Record ${i + 1}:`, 'bright');
            log(`  Batch ID: ${batchId}`, 'blue');
            log(`  Percentage: ${percentage}%`, 'blue');
            log(`  Status: ${status}`, status === 'COMPLETED' ? 'green' : status === 'FAILED' ? 'red' : 'yellow');
            log(`  Processed: ${processedCount} records`, processedCount > 0 ? 'green' : 'yellow');
            log(`  Errors: ${errorCount}`, errorCount === 0 ? 'green' : 'red');
            log(`  Created: ${createdAt?.toISOString()}`, 'blue');
            
            if (startedAt) {
                log(`  Started: ${startedAt.toISOString()}`, 'blue');
            }
            if (completedAt) {
                log(`  Completed: ${completedAt.toISOString()}`, 'blue');
            }
            if (errorMessage) {
                log(`  Error: ${errorMessage}`, 'red');
            }
            
            // Check if this batch created any inflated records
            if (batchId && processedCount === 0) {
                log(`\n🔍 Checking if any records exist with this batch ID...`, 'yellow');
                
                const classesToCheck = ['RatePrices', 'TourPrices', 'ClientPrices'];
                let foundRecords = false;
                
                for (const className of classesToCheck) {
                    const ClassObj = Parse.Object.extend(className);
                    const recordQuery = new Parse.Query(ClassObj);
                    recordQuery.equalTo('inflation_batch_id', batchId);
                    recordQuery.limit(5);
                    
                    const inflatedRecords = await recordQuery.find({ useMasterKey: true });
                    if (inflatedRecords.length > 0) {
                        log(`    ✅ Found ${inflatedRecords.length} ${className} records with batch ID`, 'green');
                        foundRecords = true;
                    }
                }
                
                if (!foundRecords) {
                    log(`    ❌ No records found with batch ID ${batchId}`, 'red');
                    log(`    This confirms 0 records were actually processed`, 'red');
                }
            }
        }
        
        // Show the most recent attempt details
        const mostRecent = history[0];
        if (mostRecent.get('processed_count') === 0) {
            log('\n🤔 MOST RECENT ATTEMPT PROCESSED 0 RECORDS', 'yellow');
            log('This explains why you saw "0 registros procesados"', 'yellow');
            
            const batchId = mostRecent.get('batchId');
            const percentage = mostRecent.get('percentage');
            
            log(`\nDebugging the query that should have found records:`, 'cyan');
            log(`Batch ID: ${batchId}`, 'blue');
            log(`Percentage: ${percentage}%`, 'blue');
            
            // Test the exact query the job would have used
            const RatePrices = Parse.Object.extend('RatePrices');
            const testQuery = new Parse.Query(RatePrices);
            testQuery.equalTo('active', true);
            testQuery.equalTo('exists', true);
            testQuery.doesNotExist('valid_until');
            testQuery.doesNotExist('inflation_batch_id');
            
            const availableCount = await testQuery.count({ useMasterKey: true });
            log(`\nQuery test: Found ${availableCount} RatePrices records that SHOULD be available`, availableCount > 0 ? 'green' : 'red');
            
            if (availableCount > 0) {
                log(`❌ ISSUE CONFIRMED: Query finds ${availableCount} records but job processed 0`, 'red');
                log(`There's a bug in the job logic that prevents processing despite finding records`, 'red');
            }
        }
        
        log('\n' + '='.repeat(70), 'bright');
        return true;
        
    } catch (error) {
        log(`❌ Script failed with error: ${error.message}`, 'red');
        console.error(error.stack);
        return false;
    }
}

// Run the check
checkRecentInflationHistory().then((success) => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});