#!/usr/bin/env node

/**
 * Test Inflation Direct Call
 * Calls the inflation cloud function directly and monitors detailed output
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

async function testInflationDirect() {
    log('\n' + '='.repeat(70), 'bright');
    log('DIRECT INFLATION TEST', 'bright');
    log('='.repeat(70), 'bright');

    try {
        log('\n🚀 Calling inflation cloud function directly...', 'cyan');
        
        // Call the cloud function directly with master key
        const result = await Parse.Cloud.run('iniciarProcesoInflacion', { 
            percentage: 3.2 
        }, { useMasterKey: true });
        
        log(`📊 Initial response: ${JSON.stringify(result, null, 2)}`, 'blue');
        
        if (result.success && result.batchId) {
            log(`\n🔍 Checking inflation status for batch: ${result.batchId}`, 'cyan');
            
            // Wait a bit for the job to process
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Check the status
            const statusResult = await Parse.Cloud.run('obtenerEstadoInflacion', { 
                batchId: result.batchId 
            }, { useMasterKey: true });
            
            log(`📊 Status result: ${JSON.stringify(statusResult, null, 2)}`, 'blue');
            
            if (statusResult.success) {
                const status = statusResult;
                
                log('\n📈 INFLATION RESULTS:', 'bright');
                log(`Status: ${status.status}`, status.status === 'COMPLETED' ? 'green' : 'yellow');
                log(`Processed: ${status.processed_count || 0}`, status.processed_count > 0 ? 'green' : 'yellow');
                log(`Errors: ${status.error_count || 0}`, status.error_count === 0 ? 'green' : 'red');
                log(`Percentage: ${status.percentage}%`, 'blue');
                
                if (status.error_message) {
                    log(`Error Message: ${status.error_message}`, 'red');
                }
                
                if (status.processed_count === 0) {
                    log('\n🤔 ZERO RECORDS PROCESSED', 'yellow');
                    log('This suggests the job found no records to process.', 'yellow');
                    log('Possible reasons:', 'yellow');
                    log('1. All records already have inflation_batch_id', 'yellow');
                    log('2. Query conditions are too restrictive', 'yellow');
                    log('3. Job logic is not finding the right records', 'yellow');
                }
            }
        }
        
        log('\n' + '='.repeat(70), 'bright');
        return true;
        
    } catch (error) {
        log(`❌ Test failed with error: ${error.message}`, 'red');
        if (error.code) {
            log(`Error code: ${error.code}`, 'red');
        }
        console.error(error.stack);
        return false;
    }
}

// Run the test
testInflationDirect().then((success) => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});