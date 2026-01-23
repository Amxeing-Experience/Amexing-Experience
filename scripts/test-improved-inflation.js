#!/usr/bin/env node

/**
 * Test Improved Inflation Process Script
 * Tests the enhanced inflation system to verify no duplicates are created
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

async function testImprovedInflation() {
    log('\n' + '='.repeat(70), 'bright');
    log('TESTING IMPROVED INFLATION PROCESS', 'bright');
    log('='.repeat(70), 'bright');

    try {
        // Wait for server to be fully ready
        log('\n⏳ Waiting for server to be fully ready...', 'cyan');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Step 1: Check current state before inflation
        log('\n🔍 Step 1: Checking current state before inflation...', 'cyan');
        
        const classesToCheck = ['RatePrices', 'TourPrices', 'ClientPrices'];
        const beforeCounts = {};
        
        for (const className of classesToCheck) {
            const ClassObj = Parse.Object.extend(className);
            const query = new Parse.Query(ClassObj);
            query.equalTo('active', true);
            query.equalTo('exists', true);
            query.doesNotExist('valid_until');
            
            const count = await query.count({ useMasterKey: true });
            beforeCounts[className] = count;
            log(`Active ${className} records: ${count}`, 'yellow');
        }
        
        // Step 2: Test small inflation (2%)
        log('\n💸 Step 2: Testing small inflation (2%)...', 'cyan');
        
        const testPercentage = 2;
        const response = await Parse.Cloud.run('iniciarProcesoInflacion', {
            percentage: testPercentage
        }, { useMasterKey: true });
        
        if (!response.success) {
            throw new Error('Failed to initiate inflation process');
        }
        
        const batchId = response.batchId;
        log(`Inflation initiated with batchId: ${batchId}`, 'green');
        
        // Step 3: Monitor process status
        log('\n⏳ Step 3: Monitoring inflation process...', 'cyan');
        
        let attempts = 0;
        let status = 'PENDING';
        const maxAttempts = 60; // Wait up to 1 minute
        
        while (attempts < maxAttempts && !['COMPLETED', 'FAILED'].includes(status)) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
            
            try {
                const statusResponse = await Parse.Cloud.run('obtenerEstadoInflacion', {
                    batchId
                }, { useMasterKey: true });
                
                if (statusResponse.success) {
                    status = statusResponse.status;
                    const progress = statusResponse.progress || {};
                    log(`Status: ${status} | Processed: ${progress.processed_count || 0} | Skipped: ${progress.skipped_count || 0} | Errors: ${progress.error_count || 0}`, 'blue');
                }
            } catch (error) {
                log(`Status check error: ${error.message}`, 'red');
            }
        }
        
        if (status !== 'COMPLETED') {
            throw new Error(`Inflation process did not complete successfully. Final status: ${status}`);
        }
        
        log('✅ Inflation process completed successfully!', 'green');
        
        // Step 4: Verify no duplicates were created
        log('\n🔎 Step 4: Verifying no duplicates were created...', 'cyan');
        
        let duplicatesFound = false;
        const afterCounts = {};
        
        for (const className of classesToCheck) {
            const ClassObj = Parse.Object.extend(className);
            
            // Count active records after inflation
            const activeQuery = new Parse.Query(ClassObj);
            activeQuery.equalTo('active', true);
            activeQuery.equalTo('exists', true);
            activeQuery.doesNotExist('valid_until');
            
            const activeCount = await activeQuery.count({ useMasterKey: true });
            afterCounts[className] = activeCount;
            
            // Check for duplicates by grouping active records by service+rate+vehicle
            const activeRecords = await activeQuery.find({ useMasterKey: true });
            const combinations = {};
            
            for (const record of activeRecords) {
                const service = record.get('service');
                const rate = record.get('rate');
                const vehicleType = record.get('vehicleType');
                
                if (service && rate && vehicleType) {
                    const key = `${service.id}_${rate.id}_${vehicleType.id}`;
                    
                    if (!combinations[key]) {
                        combinations[key] = [];
                    }
                    combinations[key].push(record);
                }
            }
            
            // Find duplicates
            const duplicateKeys = Object.keys(combinations).filter(key => combinations[key].length > 1);
            
            log(`${className}: Before=${beforeCounts[className]}, After=${activeCount}`, 'yellow');
            
            if (duplicateKeys.length > 0) {
                duplicatesFound = true;
                log(`❌ Found ${duplicateKeys.length} duplicate combinations in ${className}:`, 'red');
                
                duplicateKeys.slice(0, 3).forEach(key => {
                    const records = combinations[key];
                    log(`  Key ${key}: ${records.length} records`, 'red');
                    records.forEach(record => {
                        const price = record.get('price') || record.get('precio') || 'N/A';
                        const batchId = record.get('inflation_batch_id') || 'none';
                        log(`    - ID: ${record.id}, Price: ${price}, Batch: ${batchId}`, 'red');
                    });
                });
            } else {
                log(`✅ No duplicates found in ${className}`, 'green');
            }
        }
        
        // Step 5: Check inflation records were created properly
        log('\n📊 Step 5: Verifying inflation records were created properly...', 'cyan');
        
        for (const className of classesToCheck) {
            const ClassObj = Parse.Object.extend(className);
            const inflatedQuery = new Parse.Query(ClassObj);
            inflatedQuery.equalTo('inflation_batch_id', batchId);
            inflatedQuery.equalTo('active', true);
            inflatedQuery.equalTo('exists', true);
            
            const inflatedCount = await inflatedQuery.count({ useMasterKey: true });
            log(`${className}: ${inflatedCount} records created with inflation batch ID`, 'blue');
        }
        
        // Step 6: Final summary
        log('\n' + '='.repeat(70), 'bright');
        if (duplicatesFound) {
            log('❌ TEST FAILED: DUPLICATES DETECTED!', 'red');
            log('The improved inflation process still has issues.', 'red');
        } else {
            log('✅ TEST PASSED: NO DUPLICATES DETECTED!', 'green');
            log('The improved inflation process is working correctly.', 'green');
        }
        log('='.repeat(70), 'bright');
        
        return !duplicatesFound;
        
    } catch (error) {
        log(`❌ Test failed with error: ${error.message}`, 'red');
        console.error(error.stack);
        return false;
    }
}

// Run the test
testImprovedInflation().then((success) => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});