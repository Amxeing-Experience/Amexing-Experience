#!/usr/bin/env node

/**
 * Reset All Records for Inflation Testing Script
 * Removes inflation_batch_id from ALL active records in all price tables
 * This prepares the maximum number of records for inflation testing
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

async function resetAllRecordsForInflationTesting() {
    log('\n' + '='.repeat(70), 'bright');
    log('RESET ALL RECORDS FOR INFLATION TESTING', 'bright');
    log('='.repeat(70), 'bright');

    try {
        log('\n⚠️  WARNING: This script will reset ALL inflation records for testing!', 'yellow');
        log('This will make ALL active records available for inflation again.', 'yellow');
        log('Use this to test the full inflation functionality across all tables.', 'cyan');
        
        // Give user a chance to cancel
        log('\nStarting in 5 seconds... Press Ctrl+C to cancel', 'yellow');
        await new Promise(resolve => setTimeout(resolve, 5000));

        const classesToProcess = ['RatePrices', 'TourPrices', 'ClientPrices'];
        let totalReset = 0;
        let totalActivated = 0;

        for (const className of classesToProcess) {
            log(`\n🔍 Processing ${className}...`, 'cyan');
            
            const ClassObj = Parse.Object.extend(className);
            
            // STEP 1: Reset all inflated records (remove inflation_batch_id)
            const inflatedQuery = new Parse.Query(ClassObj);
            inflatedQuery.equalTo('active', true);
            inflatedQuery.equalTo('exists', true);
            inflatedQuery.doesNotExist('valid_until');
            inflatedQuery.exists('inflation_batch_id');
            inflatedQuery.limit(1000); // Process in batches
            
            const inflatedRecords = await inflatedQuery.find({ useMasterKey: true });
            log(`Found ${inflatedRecords.length} inflated ${className} records`, 'yellow');

            let resetForClass = 0;
            if (inflatedRecords.length > 0) {
                for (const record of inflatedRecords) {
                    try {
                        record.unset('inflation_batch_id');
                        record.unset('inflation_percentage');
                        record.unset('previous_price');
                        record.unset('inflation_applied_at');
                        await record.save(null, { useMasterKey: true });
                        
                        let price = record.get('price');
                        if (className === 'ClientPrices') {
                            price = record.get('precio');
                        }
                        
                        log(`  Reset: ID=${record.id}, Price=${price}`, 'green');
                        resetForClass++;
                        totalReset++;
                    } catch (error) {
                        log(`    ❌ Failed to reset record ${record.id}: ${error.message}`, 'red');
                    }
                }
            }

            // STEP 2: Reactivate historical records to increase test data
            const historicalQuery = new Parse.Query(ClassObj);
            historicalQuery.equalTo('exists', true);
            historicalQuery.exists('valid_until');
            historicalQuery.limit(50); // Only reactivate 50 historical records per table for testing
            
            const historicalRecords = await historicalQuery.find({ useMasterKey: true });
            log(`Found ${historicalRecords.length} historical ${className} records`, 'blue');

            let activatedForClass = 0;
            if (historicalRecords.length > 0) {
                for (const record of historicalRecords) {
                    try {
                        // Reactivate the record
                        record.set('active', true);
                        record.unset('valid_until');
                        record.unset('inflation_batch_id');
                        record.unset('inflation_percentage');
                        record.unset('previous_price');
                        record.unset('inflation_applied_at');
                        await record.save(null, { useMasterKey: true });
                        
                        let price = record.get('price');
                        if (className === 'ClientPrices') {
                            price = record.get('precio');
                        }
                        
                        log(`  Reactivated: ID=${record.id}, Price=${price}`, 'cyan');
                        activatedForClass++;
                        totalActivated++;
                    } catch (error) {
                        log(`    ❌ Failed to reactivate record ${record.id}: ${error.message}`, 'red');
                    }
                }
            }

            log(`✅ ${className}: Reset ${resetForClass} records, Reactivated ${activatedForClass} records`, 'green');
        }

        // STEP 3: Verification
        log('\n🔍 Final verification...', 'cyan');
        
        let totalReadyRecords = 0;
        for (const className of classesToProcess) {
            const ClassObj = Parse.Object.extend(className);
            
            // Count active records ready for inflation
            const readyQuery = new Parse.Query(ClassObj);
            readyQuery.equalTo('active', true);
            readyQuery.equalTo('exists', true);
            readyQuery.doesNotExist('valid_until');
            readyQuery.doesNotExist('inflation_batch_id');
            
            const readyCount = await readyQuery.count({ useMasterKey: true });
            totalReadyRecords += readyCount;
            
            // Count total active records
            const totalQuery = new Parse.Query(ClassObj);
            totalQuery.equalTo('active', true);
            totalQuery.equalTo('exists', true);
            totalQuery.doesNotExist('valid_until');
            
            const totalCount = await totalQuery.count({ useMasterKey: true });
            
            log(`${className}: ${readyCount} ready for inflation (${totalCount} total active)`, 
                readyCount > 0 ? 'green' : 'yellow');
        }

        log('\n' + '='.repeat(70), 'bright');
        log(`🎉 RESET COMPLETED!`, 'green');
        log(`Records reset for testing: ${totalReset}`, 'green');
        log(`Historical records reactivated: ${totalActivated}`, 'cyan');
        log(`Total records now ready for inflation: ${totalReadyRecords}`, 'bright');
        log(`\nYou can now test the full inflation process from the UI.`, 'cyan');
        log(`All price tables should now have records available for inflation.`, 'cyan');
        log('='.repeat(70), 'bright');

        return true;
        
    } catch (error) {
        log(`❌ Script failed with error: ${error.message}`, 'red');
        console.error(error.stack);
        return false;
    }
}

// Run the reset
resetAllRecordsForInflationTesting().then((success) => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});