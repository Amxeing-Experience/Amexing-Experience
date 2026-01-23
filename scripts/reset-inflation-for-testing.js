#!/usr/bin/env node

/**
 * Reset Inflation for Testing Script
 * Removes inflation_batch_id from some records to allow testing inflation again
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

async function resetInflationForTesting() {
    log('\n' + '='.repeat(70), 'bright');
    log('RESET INFLATION FOR TESTING', 'bright');
    log('='.repeat(70), 'bright');

    try {
        log('\n⚠️  WARNING: This script will reset inflation_batch_id for testing!', 'yellow');
        log('This will make some records available for inflation again.', 'yellow');
        
        // Give user a chance to cancel
        log('\nStarting in 3 seconds... Press Ctrl+C to cancel', 'yellow');
        await new Promise(resolve => setTimeout(resolve, 3000));

        const classesToProcess = ['RatePrices', 'TourPrices', 'ClientPrices'];
        let totalReset = 0;

        for (const className of classesToProcess) {
            log(`\n🔍 Processing ${className}...`, 'cyan');
            
            const ClassObj = Parse.Object.extend(className);
            
            // Get inflated records (limit to first 50 for testing)
            const query = new Parse.Query(ClassObj);
            query.equalTo('active', true);
            query.equalTo('exists', true);
            query.doesNotExist('valid_until');
            query.exists('inflation_batch_id');
            query.limit(50); // Only reset 50 records for testing
            
            const inflatedRecords = await query.find({ useMasterKey: true });
            log(`Found ${inflatedRecords.length} inflated ${className} records`, 'yellow');

            if (inflatedRecords.length === 0) {
                log(`No inflated ${className} records to reset`, 'green');
                continue;
            }

            // Reset inflation_batch_id for testing (remove the field)
            let resetForClass = 0;
            
            for (const record of inflatedRecords) {
                try {
                    record.unset('inflation_batch_id');
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

            log(`✅ Reset ${resetForClass} ${className} records for testing`, 'green');
        }

        // Verify reset worked
        log('\n🔍 Verification...', 'cyan');
        
        for (const className of classesToProcess) {
            const ClassObj = Parse.Object.extend(className);
            const verifyQuery = new Parse.Query(ClassObj);
            verifyQuery.equalTo('active', true);
            verifyQuery.equalTo('exists', true);
            verifyQuery.doesNotExist('valid_until');
            verifyQuery.doesNotExist('inflation_batch_id');
            
            const readyForInflation = await verifyQuery.count({ useMasterKey: true });
            log(`${className}: ${readyForInflation} records ready for inflation`, 
                readyForInflation > 0 ? 'green' : 'yellow');
        }

        log('\n' + '='.repeat(70), 'bright');
        if (totalReset > 0) {
            log(`🎉 RESET COMPLETED!`, 'green');
            log(`Total records reset for testing: ${totalReset}`, 'green');
            log(`\nYou can now test inflation again from the UI.`, 'cyan');
            log(`The inflation process should find and process these reset records.`, 'cyan');
        } else {
            log(`ℹ️  NO RECORDS TO RESET`, 'yellow');
            log(`All tables either have no records or no inflated records to reset.`, 'yellow');
        }
        log('='.repeat(70), 'bright');

        return true;
        
    } catch (error) {
        log(`❌ Script failed with error: ${error.message}`, 'red');
        console.error(error.stack);
        return false;
    }
}

// Run the reset
resetInflationForTesting().then((success) => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});