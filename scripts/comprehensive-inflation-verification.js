#!/usr/bin/env node

/**
 * Comprehensive Inflation Verification and Testing Tool
 * Verifies inflation batches, handles different statuses, and can create test scenarios
 * Created by Denisse Maldonado
 */

require('dotenv').config({ path: './environments/.env.development' });
const Parse = require('parse/node');

// Initialize Parse with user-specified credentials
Parse.initialize('CrTRTaJpoJFNt8PJ', undefined, 'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP');
Parse.serverURL = 'http://localhost:1337/parse';

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function formatDate(date) {
    if (!date) return 'N/A';
    return date.toISOString();
}

function formatPrice(price) {
    if (typeof price === 'number') {
        return price.toFixed(2);
    }
    return price || 'N/A';
}

async function showUsage() {
    log('\n📖 COMPREHENSIVE INFLATION VERIFICATION TOOL', 'bright');
    log('='.repeat(60), 'blue');
    log('Usage:', 'cyan');
    log('  node scripts/comprehensive-inflation-verification.js [command] [options]', 'blue');
    log('', 'reset');
    log('Commands:', 'cyan');
    log('  list                        - List all inflation batches', 'blue');
    log('  verify [batch_id]           - Verify specific batch', 'blue');
    log('  test-inflation [percentage] - Create test data and run inflation', 'blue');
    log('  cleanup                     - Clean up test data', 'blue');
    log('', 'reset');
    log('Examples:', 'cyan');
    log('  node scripts/comprehensive-inflation-verification.js list', 'blue');
    log('  node scripts/comprehensive-inflation-verification.js verify pCGu6lhp6K', 'blue');
    log('  node scripts/comprehensive-inflation-verification.js test-inflation 5', 'blue');
    log('='.repeat(60), 'blue');
}

async function listAllInflationBatches() {
    log('\n🔍 LISTING ALL INFLATION BATCHES', 'cyan');
    log('='.repeat(50), 'blue');

    try {
        const InflationHistory = Parse.Object.extend('InflationHistory');
        const query = new Parse.Query(InflationHistory);
        query.descending('createdAt');
        query.limit(20);
        
        const batches = await query.find({ useMasterKey: true });
        
        if (batches.length === 0) {
            log('❌ No inflation history records found in database', 'red');
            return [];
        }
        
        log(`📊 Found ${batches.length} inflation history records:`, 'blue');
        
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const batchId = batch.get('batchId') || batch.id;
            const status = batch.get('status');
            const percentage = batch.get('percentage');
            const processedCount = batch.get('processed_count') || 0;
            const errorCount = batch.get('error_count') || 0;
            const createdAt = batch.get('createdAt');
            const completedAt = batch.get('completedAt');
            
            const statusColor = status === 'COMPLETED' ? 'green' : 
                               status === 'REVERTED' ? 'yellow' :
                               status === 'FAILED' ? 'red' : 'blue';
            
            log(`\n📋 ${i + 1}. Batch: ${batchId}`, 'bright');
            log(`   Status: ${status}`, statusColor);
            log(`   Percentage: ${percentage}%`, 'blue');
            log(`   Processed: ${processedCount} records`, 'blue');
            log(`   Errors: ${errorCount}`, errorCount === 0 ? 'green' : 'red');
            log(`   Created: ${formatDate(createdAt)}`, 'blue');
            if (completedAt) {
                log(`   Completed: ${formatDate(completedAt)}`, 'blue');
            }
            
            // Check for inflated records
            if (processedCount > 0) {
                const priceTables = ['RatePrices', 'ClientPrices', 'TourPrices'];
                let totalInflatedRecords = 0;
                
                for (const tableName of priceTables) {
                    const ClassObj = Parse.Object.extend(tableName);
                    const recordQuery = new Parse.Query(ClassObj);
                    recordQuery.equalTo('inflation_batch_id', batchId);
                    const count = await recordQuery.count({ useMasterKey: true });
                    totalInflatedRecords += count;
                }
                
                log(`   Current inflated records: ${totalInflatedRecords}`, 
                    totalInflatedRecords > 0 ? 'green' : 'yellow');
            }
        }
        
        return batches;
    } catch (error) {
        log(`❌ Failed to list batches: ${error.message}`, 'red');
        return [];
    }
}

async function verifyInflationBatch(batchId) {
    log(`\n🔍 VERIFYING INFLATION BATCH: ${batchId}`, 'cyan');
    log('='.repeat(60), 'blue');

    try {
        // Find the inflation history record
        const InflationHistory = Parse.Object.extend('InflationHistory');
        let historyRecord = null;
        
        // Try different search methods
        const query1 = new Parse.Query(InflationHistory);
        query1.equalTo('batchId', batchId);
        historyRecord = await query1.first({ useMasterKey: true });
        
        if (!historyRecord) {
            try {
                historyRecord = await new Parse.Query(InflationHistory).get(batchId, { useMasterKey: true });
            } catch (e) {
                // Ignore
            }
        }
        
        if (!historyRecord) {
            log(`❌ ERROR: Inflation batch ${batchId} not found`, 'red');
            return false;
        }
        
        const status = historyRecord.get('status');
        const percentage = historyRecord.get('percentage');
        const processedCount = historyRecord.get('processed_count') || 0;
        const errorCount = historyRecord.get('error_count') || 0;
        const createdAt = historyRecord.get('createdAt');
        const startedAt = historyRecord.get('startedAt');
        const completedAt = historyRecord.get('completedAt');
        const errorMessage = historyRecord.get('error_message');
        
        log('\n📊 BATCH INFORMATION:', 'bright');
        log(`   Batch ID: ${batchId}`, 'blue');
        log(`   Status: ${status}`, status === 'COMPLETED' ? 'green' : 
                                     status === 'REVERTED' ? 'yellow' : 
                                     status === 'FAILED' ? 'red' : 'blue');
        log(`   Percentage: ${percentage}%`, 'blue');
        log(`   Records Processed: ${processedCount}`, 'blue');
        log(`   Error Count: ${errorCount}`, errorCount === 0 ? 'green' : 'red');
        log(`   Created: ${formatDate(createdAt)}`, 'blue');
        log(`   Started: ${formatDate(startedAt)}`, 'blue');
        log(`   Completed: ${formatDate(completedAt)}`, 'blue');
        
        if (errorMessage) {
            log(`   Error Message: ${errorMessage}`, 'red');
        }
        
        // Check inflated records across all tables
        log('\n🔍 INFLATED RECORDS ANALYSIS:', 'cyan');
        const priceTables = ['RatePrices', 'ClientPrices', 'TourPrices'];
        let totalInflatedRecords = 0;
        let totalRevertReady = 0;
        const actualBatchId = historyRecord.get('batchId') || historyRecord.id;
        
        for (const tableName of priceTables) {
            log(`\n📋 Checking ${tableName}...`, 'yellow');
            
            const ClassObj = Parse.Object.extend(tableName);
            const query = new Parse.Query(ClassObj);
            query.equalTo('inflation_batch_id', actualBatchId);
            query.limit(1000);
            
            const records = await query.find({ useMasterKey: true });
            log(`   Found: ${records.length} records`, records.length > 0 ? 'green' : 'yellow');
            
            totalInflatedRecords += records.length;
            
            // Check first few records for details
            for (let i = 0; i < Math.min(records.length, 3); i++) {
                const record = records[i];
                const hasOriginalData = record.has('inflation_original_data');
                const hasAppliedAt = record.has('inflation_applied_at');
                
                if (hasOriginalData && hasAppliedAt) {
                    totalRevertReady++;
                }
                
                if (i === 0) {
                    log(`   Sample record ${record.id}:`, 'blue');
                    log(`     - Has original data: ${hasOriginalData ? '✅' : '❌'}`, hasOriginalData ? 'green' : 'red');
                    log(`     - Has applied timestamp: ${hasAppliedAt ? '✅' : '❌'}`, hasAppliedAt ? 'green' : 'red');
                    
                    if (hasOriginalData) {
                        const originalData = record.get('inflation_original_data');
                        const priceField = record.get('price') || record.get('base_price') || record.get('total_price');
                        const originalPrice = originalData.price || originalData.base_price || originalData.total_price;
                        
                        if (priceField && originalPrice) {
                            const increase = ((priceField - originalPrice) / originalPrice * 100).toFixed(2);
                            log(`     - Price change: ${formatPrice(originalPrice)} → ${formatPrice(priceField)} (+${increase}%)`, 'magenta');
                        }
                    }
                }
            }
        }
        
        // Summary
        log('\n📊 VERIFICATION SUMMARY:', 'bright');
        log(`   Total inflated records: ${totalInflatedRecords}`, 'blue');
        log(`   History processed count: ${processedCount}`, 'blue');
        log(`   Records with revert data: ${totalRevertReady}`, totalRevertReady === totalInflatedRecords ? 'green' : 'yellow');
        
        if (status === 'COMPLETED') {
            log(`   ✅ Batch completed successfully`, 'green');
        } else if (status === 'REVERTED') {
            log(`   🔄 Batch has been reverted`, 'yellow');
        } else if (status === 'FAILED') {
            log(`   ❌ Batch failed during processing`, 'red');
        }
        
        const isRevertReady = totalInflatedRecords > 0 && totalRevertReady === totalInflatedRecords && status === 'COMPLETED';
        log(`\n🎯 REVERT READINESS: ${isRevertReady ? 'READY' : 'NOT READY'}`, isRevertReady ? 'green' : 'yellow');
        
        return isRevertReady;
        
    } catch (error) {
        log(`❌ Verification failed: ${error.message}`, 'red');
        console.error(error.stack);
        return false;
    }
}

async function testInflation(percentage = 5) {
    log(`\n🚀 TESTING INFLATION PROCESS (${percentage}%)`, 'cyan');
    log('='.repeat(50), 'blue');
    
    try {
        log('\n1. Creating test data...', 'cyan');
        
        // Create a few test price records
        const testRecords = [];
        const tables = [
            { name: 'RatePrices', count: 2 },
            { name: 'ClientPrices', count: 1 },
            { name: 'TourPrices', count: 1 }
        ];
        
        for (const table of tables) {
            const ClassObj = Parse.Object.extend(table.name);
            
            for (let i = 0; i < table.count; i++) {
                const record = new ClassObj();
                record.set('active', true);
                record.set('exists', true);
                record.set('price', 100 + (i * 10)); // Base prices: 100, 110, etc.
                record.set('name', `Test ${table.name} ${i + 1}`);
                record.set('test_record', true); // Mark as test data for cleanup
                
                await record.save(null, { useMasterKey: true });
                testRecords.push({ table: table.name, id: record.id, price: record.get('price') });
                log(`   Created ${table.name} record: ${record.id} (price: ${record.get('price')})`, 'green');
            }
        }
        
        log(`\n2. Running inflation process (${percentage}%)...`, 'cyan');
        
        // Call the inflation cloud function
        const result = await Parse.Cloud.run('iniciarProcesoInflacion', { 
            percentage: percentage 
        }, { useMasterKey: true });
        
        if (!result.success) {
            log('❌ Inflation process failed to start', 'red');
            return false;
        }
        
        log(`   Inflation started with batch ID: ${result.batchId}`, 'green');
        
        // Wait for the process to complete
        log('\n3. Waiting for inflation to complete...', 'cyan');
        let attempts = 0;
        let statusResult = null;
        
        while (attempts < 10) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            try {
                statusResult = await Parse.Cloud.run('obtenerEstadoInflacion', { 
                    batchId: result.batchId 
                }, { useMasterKey: true });
                
                if (statusResult.status === 'COMPLETED' || statusResult.status === 'FAILED') {
                    break;
                }
            } catch (e) {
                // Continue waiting
            }
            
            attempts++;
            log(`   Waiting... (attempt ${attempts}/10)`, 'yellow');
        }
        
        if (!statusResult || statusResult.status !== 'COMPLETED') {
            log('❌ Inflation process did not complete successfully', 'red');
            return false;
        }
        
        log(`   ✅ Inflation completed! Processed ${statusResult.processed_count} records`, 'green');
        
        // Verify the inflation was applied
        log('\n4. Verifying inflation application...', 'cyan');
        
        for (const testRecord of testRecords) {
            const ClassObj = Parse.Object.extend(testRecord.table);
            const query = new Parse.Query(ClassObj);
            const record = await query.get(testRecord.id, { useMasterKey: true });
            
            const currentPrice = record.get('price');
            const expectedPrice = testRecord.price * (1 + percentage / 100);
            const hasInflationData = record.has('inflation_batch_id') && record.has('inflation_original_data');
            
            log(`   ${testRecord.table} ${testRecord.id}:`, 'blue');
            log(`     Original: ${testRecord.price} → Current: ${currentPrice}`, 'blue');
            log(`     Expected: ${expectedPrice.toFixed(2)}`, 'blue');
            log(`     Has inflation data: ${hasInflationData ? '✅' : '❌'}`, hasInflationData ? 'green' : 'red');
            
            if (Math.abs(currentPrice - expectedPrice) < 0.01 && hasInflationData) {
                log(`     ✅ Correctly inflated and revert-ready`, 'green');
            } else {
                log(`     ❌ Inflation verification failed`, 'red');
            }
        }
        
        log(`\n✅ TEST COMPLETED! Batch ID: ${result.batchId}`, 'green');
        log(`💡 You can now verify this batch with:`, 'cyan');
        log(`   node scripts/comprehensive-inflation-verification.js verify ${result.batchId}`, 'blue');
        
        return result.batchId;
        
    } catch (error) {
        log(`❌ Test inflation failed: ${error.message}`, 'red');
        console.error(error.stack);
        return false;
    }
}

async function cleanupTestData() {
    log('\n🧹 CLEANING UP TEST DATA', 'cyan');
    log('='.repeat(50), 'blue');
    
    try {
        const tables = ['RatePrices', 'ClientPrices', 'TourPrices'];
        let totalCleaned = 0;
        
        for (const tableName of tables) {
            const ClassObj = Parse.Object.extend(tableName);
            const query = new Parse.Query(ClassObj);
            query.equalTo('test_record', true);
            
            const testRecords = await query.find({ useMasterKey: true });
            
            if (testRecords.length > 0) {
                log(`   Deleting ${testRecords.length} test records from ${tableName}...`, 'blue');
                await Parse.Object.destroyAll(testRecords, { useMasterKey: true });
                totalCleaned += testRecords.length;
            }
        }
        
        log(`\n✅ Cleanup completed! Removed ${totalCleaned} test records`, 'green');
        return true;
        
    } catch (error) {
        log(`❌ Cleanup failed: ${error.message}`, 'red');
        return false;
    }
}

async function main() {
    const command = process.argv[2];
    const arg1 = process.argv[3];
    
    if (!command) {
        await showUsage();
        return;
    }
    
    switch (command) {
        case 'list':
            await listAllInflationBatches();
            break;
            
        case 'verify':
            if (!arg1) {
                log('❌ Error: Please provide a batch ID to verify', 'red');
                log('💡 Use "list" command to see available batches', 'cyan');
                return;
            }
            await verifyInflationBatch(arg1);
            break;
            
        case 'test-inflation':
            const percentage = parseFloat(arg1) || 5;
            await testInflation(percentage);
            break;
            
        case 'cleanup':
            await cleanupTestData();
            break;
            
        default:
            log(`❌ Unknown command: ${command}`, 'red');
            await showUsage();
            break;
    }
}

// Run the main function
main().then(() => {
    process.exit(0);
}).catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});