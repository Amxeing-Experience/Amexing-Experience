#!/usr/bin/env node

/**
 * Verify Inflation Batch and Revert Readiness
 * Verifies a specific inflation batch was applied correctly and is ready for revert testing
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

async function verifyInflationBatchRevertReady() {
    // Allow batch ID to be passed as command line argument
    const batchId = process.argv[2] || 'INFLATION_1767751450054_m4q6njojg';
    
    log('\n' + '='.repeat(80), 'bright');
    log('INFLATION BATCH VERIFICATION AND REVERT READINESS CHECK', 'bright');
    log('='.repeat(80), 'bright');
    log(`Target Batch ID: ${batchId}`, 'cyan');
    log('='.repeat(80), 'bright');

    try {
        // Step 0: List all available inflation batches first
        log('\n🔍 STEP 0: Listing all available inflation batches...', 'cyan');
        log('-'.repeat(50), 'blue');
        
        const InflationHistory = Parse.Object.extend('InflationHistory');
        const allBatchesQuery = new Parse.Query(InflationHistory);
        allBatchesQuery.descending('createdAt');
        allBatchesQuery.limit(10);
        
        const allBatches = await allBatchesQuery.find({ useMasterKey: true });
        
        if (allBatches.length === 0) {
            log('❌ No inflation history records found in database', 'red');
            return false;
        }
        
        log(`📊 Found ${allBatches.length} inflation history records:`, 'blue');
        for (let i = 0; i < allBatches.length; i++) {
            const batch = allBatches[i];
            const id = batch.get('batchId') || batch.id || 'undefined';
            const status = batch.get('status');
            const percentage = batch.get('percentage');
            const processedCount = batch.get('processed_count') || 0;
            const createdAt = batch.get('createdAt');
            
            log(`   ${i + 1}. Batch: ${id}`, 'blue');
            log(`      Status: ${status}, Percentage: ${percentage}%, Processed: ${processedCount}`, 'blue');
            log(`      Created: ${formatDate(createdAt)}`, 'blue');
        }
        
        // Step 1: Check InflationHistory record
        log('\n🔍 STEP 1: Checking specific InflationHistory record...', 'cyan');
        log('-'.repeat(50), 'blue');
        
        // Try multiple ways to find the record
        let historyRecord = null;
        
        // Method 1: Search by batchId field
        const historyQuery1 = new Parse.Query(InflationHistory);
        historyQuery1.equalTo('batchId', batchId);
        historyRecord = await historyQuery1.first({ useMasterKey: true });
        
        // Method 2: If not found, search by objectId
        if (!historyRecord && batchId.length > 8) {
            try {
                const historyQuery2 = new Parse.Query(InflationHistory);
                historyRecord = await historyQuery2.get(batchId, { useMasterKey: true });
                log(`📋 Found record by objectId instead of batchId`, 'yellow');
            } catch (e) {
                // Ignore, will try other methods
            }
        }
        
        // Method 3: Search in recent records that might match
        if (!historyRecord) {
            for (const batch of allBatches) {
                const storedBatchId = batch.get('batchId');
                const objectId = batch.id;
                if (storedBatchId === batchId || objectId === batchId) {
                    historyRecord = batch;
                    log(`📋 Found record in recent batches list`, 'yellow');
                    break;
                }
            }
        }
        
        if (!historyRecord) {
            log(`❌ ERROR: InflationHistory record for batch ${batchId} not found`, 'red');
            log(`📋 Available batch IDs to try:`, 'yellow');
            for (const batch of allBatches) {
                const id = batch.get('batchId') || batch.id;
                log(`   - ${id}`, 'yellow');
            }
            log(`\n💡 Try running: node scripts/verify-inflation-batch-revert-ready.js <batch_id>`, 'cyan');
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
        
        log(`✅ InflationHistory record found`, 'green');
        log(`   Status: ${status}`, status === 'COMPLETED' ? 'green' : 'red');
        log(`   Percentage: ${percentage}%`, 'blue');
        log(`   Records Processed: ${processedCount}`, processedCount > 0 ? 'green' : 'red');
        log(`   Error Count: ${errorCount}`, errorCount === 0 ? 'green' : 'red');
        log(`   Created At: ${formatDate(createdAt)}`, 'blue');
        log(`   Started At: ${formatDate(startedAt)}`, 'blue');
        log(`   Completed At: ${formatDate(completedAt)}`, 'blue');
        
        if (errorMessage) {
            log(`   Error Message: ${errorMessage}`, 'red');
        }
        
        if (status !== 'COMPLETED') {
            log(`❌ ERROR: Batch status is ${status}, not COMPLETED`, 'red');
            return false;
        }
        
        if (processedCount === 0) {
            log(`❌ ERROR: No records were processed in this batch`, 'red');
            return false;
        }
        
        log(`✅ Batch ${batchId} completed successfully with ${processedCount} records`, 'green');
        
        // Get the actual batch ID we found (might be different from input)
        const actualBatchId = historyRecord.get('batchId') || historyRecord.id;
        
        // Step 2: Find all inflated records across price tables
        log('\n🔍 STEP 2: Finding inflated records across all price tables...', 'cyan');
        log('-'.repeat(50), 'blue');
        log(`Searching for records with batch ID: ${actualBatchId}`, 'blue');
        
        const priceTables = ['RatePrices', 'ClientPrices', 'TourPrices'];
        let totalInflatedRecords = 0;
        let revertReadyCount = 0;
        const tableResults = {};
        
        for (const tableName of priceTables) {
            log(`\n📊 Checking ${tableName}...`, 'yellow');
            
            const ClassObj = Parse.Object.extend(tableName);
            
            // Try multiple search strategies
            let inflatedRecords = [];
            
            // Strategy 1: Search by inflation_batch_id field
            const query1 = new Parse.Query(ClassObj);
            query1.equalTo('inflation_batch_id', actualBatchId);
            query1.limit(1000);
            inflatedRecords = await query1.find({ useMasterKey: true });
            
            // Strategy 2: If no results and we have different batch formats, try the original input too
            if (inflatedRecords.length === 0 && actualBatchId !== batchId) {
                const query2 = new Parse.Query(ClassObj);
                query2.equalTo('inflation_batch_id', batchId);
                query2.limit(1000);
                inflatedRecords = await query2.find({ useMasterKey: true });
                if (inflatedRecords.length > 0) {
                    log(`   Found records using original batch ID: ${batchId}`, 'yellow');
                }
            }
            
            // Strategy 3: If still no results, check for any records with inflation data
            if (inflatedRecords.length === 0) {
                const query3 = new Parse.Query(ClassObj);
                query3.exists('inflation_batch_id');
                query3.exists('inflation_original_data');
                query3.limit(10); // Just a sample
                const anyInflatedRecords = await query3.find({ useMasterKey: true });
                
                if (anyInflatedRecords.length > 0) {
                    log(`   No records found for target batch, but found ${anyInflatedRecords.length} records with inflation data`, 'yellow');
                    log(`   Sample batch IDs in this table:`, 'yellow');
                    const sampleBatchIds = [...new Set(anyInflatedRecords.map(r => r.get('inflation_batch_id')))];
                    for (const id of sampleBatchIds.slice(0, 3)) {
                        log(`     - ${id}`, 'yellow');
                    }
                }
            }
            
            log(`   Found ${inflatedRecords.length} inflated records`, inflatedRecords.length > 0 ? 'green' : 'yellow');
            
            tableResults[tableName] = {
                records: inflatedRecords,
                count: inflatedRecords.length,
                revertReady: 0,
                issues: []
            };
            
            totalInflatedRecords += inflatedRecords.length;
            
            // Check each record for revert readiness
            for (let i = 0; i < inflatedRecords.length; i++) {
                const record = inflatedRecords[i];
                const recordId = record.id;
                
                // Check required fields for revert
                const hasInflationBatchId = record.has('inflation_batch_id');
                const hasOriginalData = record.has('inflation_original_data');
                const hasAppliedAt = record.has('inflation_applied_at');
                
                const isRevertReady = hasInflationBatchId && hasOriginalData && hasAppliedAt;
                
                if (isRevertReady) {
                    revertReadyCount++;
                    tableResults[tableName].revertReady++;
                } else {
                    const missingFields = [];
                    if (!hasInflationBatchId) missingFields.push('inflation_batch_id');
                    if (!hasOriginalData) missingFields.push('inflation_original_data');
                    if (!hasAppliedAt) missingFields.push('inflation_applied_at');
                    
                    tableResults[tableName].issues.push({
                        recordId,
                        missingFields
                    });
                }
                
                // Show details for first few records
                if (i < 3) {
                    log(`\n      Record ${i + 1} (${recordId}):`, 'blue');
                    log(`        ✓ inflation_batch_id: ${hasInflationBatchId ? '✅' : '❌'}`, hasInflationBatchId ? 'green' : 'red');
                    log(`        ✓ inflation_original_data: ${hasOriginalData ? '✅' : '❌'}`, hasOriginalData ? 'green' : 'red');
                    log(`        ✓ inflation_applied_at: ${hasAppliedAt ? '✅' : '❌'}`, hasAppliedAt ? 'green' : 'red');
                    
                    if (hasAppliedAt) {
                        const appliedAt = record.get('inflation_applied_at');
                        log(`        Applied at: ${formatDate(appliedAt)}`, 'blue');
                    }
                    
                    // Show price comparison if original data exists
                    if (hasOriginalData) {
                        const originalData = record.get('inflation_original_data');
                        
                        log(`        Price Comparison:`, 'magenta');
                        
                        // Common price fields to check
                        const priceFields = ['price', 'base_price', 'total_price', 'unit_price'];
                        
                        for (const field of priceFields) {
                            const currentValue = record.get(field);
                            const originalValue = originalData[field];
                            
                            if (currentValue !== undefined && originalValue !== undefined) {
                                const increase = ((currentValue - originalValue) / originalValue * 100).toFixed(2);
                                log(`          ${field}: ${formatPrice(originalValue)} → ${formatPrice(currentValue)} (+${increase}%)`, 'magenta');
                                
                                // Verify the percentage increase matches expected
                                const expectedIncrease = percentage;
                                const actualIncrease = parseFloat(increase);
                                const tolerance = 0.1; // Allow small rounding differences
                                
                                if (Math.abs(actualIncrease - expectedIncrease) > tolerance) {
                                    log(`            ⚠️  Expected ${expectedIncrease}%, got ${actualIncrease}%`, 'yellow');
                                } else {
                                    log(`            ✅ Percentage increase correct`, 'green');
                                }
                            }
                        }
                    }
                    
                    log(`        Revert Ready: ${isRevertReady ? '✅' : '❌'}`, isRevertReady ? 'green' : 'red');
                }
            }
            
            if (inflatedRecords.length > 3) {
                log(`      ... and ${inflatedRecords.length - 3} more records`, 'blue');
            }
        }
        
        // Step 3: Summary and revert readiness assessment
        log('\n🔍 STEP 3: Revert Readiness Summary', 'cyan');
        log('-'.repeat(50), 'blue');
        
        log(`\nTotal inflated records found: ${totalInflatedRecords}`, 'blue');
        log(`Records ready for revert: ${revertReadyCount}`, revertReadyCount === totalInflatedRecords ? 'green' : 'red');
        
        if (processedCount !== totalInflatedRecords) {
            log(`⚠️  WARNING: InflationHistory shows ${processedCount} processed, but found ${totalInflatedRecords} records`, 'yellow');
        }
        
        // Show table breakdown
        for (const [tableName, result] of Object.entries(tableResults)) {
            log(`\n📊 ${tableName}:`, 'yellow');
            log(`   Total records: ${result.count}`, 'blue');
            log(`   Revert ready: ${result.revertReady}`, result.revertReady === result.count ? 'green' : 'red');
            
            if (result.issues.length > 0) {
                log(`   Issues found: ${result.issues.length}`, 'red');
                for (const issue of result.issues.slice(0, 3)) {
                    log(`     Record ${issue.recordId}: Missing ${issue.missingFields.join(', ')}`, 'red');
                }
                if (result.issues.length > 3) {
                    log(`     ... and ${result.issues.length - 3} more issues`, 'red');
                }
            }
        }
        
        // Step 4: Final verification
        log('\n🔍 STEP 4: Final Verification', 'cyan');
        log('-'.repeat(50), 'blue');
        
        const allRevertReady = revertReadyCount === totalInflatedRecords;
        const batchCompleted = status === 'COMPLETED';
        const recordsProcessed = processedCount > 0;
        
        log(`\n📋 Verification Results:`, 'bright');
        log(`   ✓ Batch completed: ${batchCompleted ? '✅' : '❌'}`, batchCompleted ? 'green' : 'red');
        log(`   ✓ Records processed: ${recordsProcessed ? '✅' : '❌'}`, recordsProcessed ? 'green' : 'red');
        log(`   ✓ All records revert ready: ${allRevertReady ? '✅' : '❌'}`, allRevertReady ? 'green' : 'red');
        
        const overallReady = batchCompleted && recordsProcessed && allRevertReady;
        
        log(`\n🎯 OVERALL STATUS: ${overallReady ? 'READY FOR REVERT TESTING' : 'NOT READY FOR REVERT'}`, overallReady ? 'green' : 'red');
        
        if (overallReady) {
            log('\n✅ The inflation batch was applied correctly and all records are ready for revert testing.', 'green');
            log('   You can proceed with revert testing safely.', 'green');
        } else {
            log('\n❌ Issues found that need to be resolved before revert testing:', 'red');
            if (!batchCompleted) log('   - Batch is not in COMPLETED status', 'red');
            if (!recordsProcessed) log('   - No records were processed', 'red');
            if (!allRevertReady) log(`   - ${totalInflatedRecords - revertReadyCount} records are missing revert data`, 'red');
        }
        
        log('\n' + '='.repeat(80), 'bright');
        return overallReady;
        
    } catch (error) {
        log(`❌ Script failed with error: ${error.message}`, 'red');
        console.error(error.stack);
        return false;
    }
}

// Run the verification
verifyInflationBatchRevertReady().then((success) => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});