#!/usr/bin/env node

/**
 * Fix Duplicate Inflation Records Script
 * Cleans up duplicate records created by multiple inflation processes
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

async function fixDuplicateRecords() {
    log('\n' + '='.repeat(70), 'bright');
    log('FIXING DUPLICATE INFLATION RECORDS', 'bright');
    log('='.repeat(70), 'bright');

    try {
        // Step 1: Identify and clean up historical duplicates
        log('\n🧹 Step 1: Cleaning up historical record duplicates...', 'cyan');
        
        const RatePrice = Parse.Object.extend('RatePrices');
        
        // Get all historical records (active: false, has valid_until)
        const historicalQuery = new Parse.Query(RatePrice);
        historicalQuery.equalTo('active', false);
        historicalQuery.exists('valid_until');
        historicalQuery.include('service');
        historicalQuery.include('rate');
        historicalQuery.include('vehicleType');
        historicalQuery.limit(1000);
        
        const historicalRecords = await historicalQuery.find({ useMasterKey: true });
        log(`Found ${historicalRecords.length} historical records`, 'yellow');
        
        // Group by service + rate + vehicleType to find duplicates
        const historicalGroups = {};
        historicalRecords.forEach(record => {
            const serviceId = record.get('service')?.id || 'no-service';
            const rateId = record.get('rate')?.id || 'no-rate';
            const vehicleId = record.get('vehicleType')?.id || 'no-vehicle';
            const key = `${serviceId}_${rateId}_${vehicleId}`;
            
            if (!historicalGroups[key]) historicalGroups[key] = [];
            historicalGroups[key].push(record);
        });
        
        // Remove duplicates, keeping only the most recent one
        let historicalDeleted = 0;
        for (const [key, records] of Object.entries(historicalGroups)) {
            if (records.length > 1) {
                // Sort by createdAt descending, keep the newest, delete the rest
                records.sort((a, b) => b.get('createdAt').getTime() - a.get('createdAt').getTime());
                const toDelete = records.slice(1); // All except the newest
                
                log(`Removing ${toDelete.length} duplicate historical records for ${key}`, 'yellow');
                
                for (const record of toDelete) {
                    await record.destroy({ useMasterKey: true });
                    historicalDeleted++;
                }
            }
        }
        
        log(`✅ Deleted ${historicalDeleted} duplicate historical records`, 'green');
        
        // Step 2: Fix active records without proper relationships
        log('\n🔧 Step 2: Analyzing active records...', 'cyan');
        
        const activeQuery = new Parse.Query(RatePrice);
        activeQuery.equalTo('active', true);
        activeQuery.equalTo('exists', true);
        activeQuery.doesNotExist('valid_until');
        activeQuery.include('service');
        activeQuery.include('rate');
        activeQuery.include('vehicleType');
        activeQuery.limit(1000);
        
        const activeRecords = await activeQuery.find({ useMasterKey: true });
        log(`Found ${activeRecords.length} active records`, 'yellow');
        
        // Group active records by service + rate + vehicleType
        const activeGroups = {};
        const recordsWithoutRelationships = [];
        
        activeRecords.forEach(record => {
            const service = record.get('service');
            const rate = record.get('rate');
            const vehicleType = record.get('vehicleType');
            
            if (!service || !rate || !vehicleType) {
                recordsWithoutRelationships.push(record);
                return;
            }
            
            const key = `${service.id}_${rate.id}_${vehicleType.id}`;
            
            if (!activeGroups[key]) activeGroups[key] = [];
            activeGroups[key].push(record);
        });
        
        log(`Records without proper relationships: ${recordsWithoutRelationships.length}`, 'red');
        
        // Find active duplicates
        const activeDuplicateGroups = Object.entries(activeGroups).filter(([key, records]) => records.length > 1);
        log(`Active duplicate groups: ${activeDuplicateGroups.length}`, 'yellow');
        
        let activeDeleted = 0;
        for (const [key, records] of activeDuplicateGroups) {
            // Sort by createdAt descending, keep the newest (with inflation_batch_id if available)
            records.sort((a, b) => {
                // Prefer records with inflation_batch_id
                const aHasInflation = !!a.get('inflation_batch_id');
                const bHasInflation = !!b.get('inflation_batch_id');
                
                if (aHasInflation && !bHasInflation) return -1;
                if (!aHasInflation && bHasInflation) return 1;
                
                // Then by creation date
                return b.get('createdAt').getTime() - a.get('createdAt').getTime();
            });
            
            const toKeep = records[0];
            const toDelete = records.slice(1);
            
            log(`Keeping newest for ${key}: price=${toKeep.get('price')}, batch=${toKeep.get('inflation_batch_id') || 'none'}`, 'blue');
            log(`Deleting ${toDelete.length} duplicates`, 'yellow');
            
            for (const record of toDelete) {
                await record.destroy({ useMasterKey: true });
                activeDeleted++;
            }
        }
        
        log(`✅ Deleted ${activeDeleted} duplicate active records`, 'green');
        
        // Step 3: Clean up records without proper relationships
        log('\n🗑️ Step 3: Handling records without proper relationships...', 'cyan');
        
        if (recordsWithoutRelationships.length > 0) {
            log(`Found ${recordsWithoutRelationships.length} records without service/rate/vehicle relationships`, 'red');
            log('These will be deleted as they are likely corrupted from failed inflation processes', 'yellow');
            
            for (const record of recordsWithoutRelationships) {
                const price = record.get('price');
                const batchId = record.get('inflation_batch_id');
                log(`Deleting orphaned record: price=${price}, batch=${batchId || 'none'}`, 'yellow');
                await record.destroy({ useMasterKey: true });
            }
            
            log(`✅ Deleted ${recordsWithoutRelationships.length} orphaned records`, 'green');
        }
        
        // Step 4: Final verification
        log('\n✅ Step 4: Final verification...', 'cyan');
        
        const finalActiveQuery = new Parse.Query(RatePrice);
        finalActiveQuery.equalTo('active', true);
        finalActiveQuery.equalTo('exists', true);
        finalActiveQuery.doesNotExist('valid_until');
        finalActiveQuery.include('service');
        finalActiveQuery.include('rate');
        finalActiveQuery.include('vehicleType');
        
        const finalActiveRecords = await finalActiveQuery.find({ useMasterKey: true });
        
        const finalGroups = {};
        finalActiveRecords.forEach(record => {
            const service = record.get('service');
            const rate = record.get('rate');
            const vehicleType = record.get('vehicleType');
            
            if (service && rate && vehicleType) {
                const key = `${service.id}_${rate.id}_${vehicleType.id}`;
                if (!finalGroups[key]) finalGroups[key] = [];
                finalGroups[key].push(record);
            }
        });
        
        const finalDuplicates = Object.entries(finalGroups).filter(([key, records]) => records.length > 1);
        
        log(`Final active records: ${finalActiveRecords.length}`, 'green');
        log(`Remaining duplicate groups: ${finalDuplicates.length}`, finalDuplicates.length > 0 ? 'red' : 'green');
        
        if (finalDuplicates.length > 0) {
            log('Remaining duplicates:', 'yellow');
            finalDuplicates.slice(0, 3).forEach(([key, records]) => {
                log(`  ${key}: ${records.length} records`, 'yellow');
            });
        }
        
        log('\n' + '='.repeat(70), 'bright');
        log('🎉 CLEANUP COMPLETED!', 'bright');
        log(`Total records deleted: ${historicalDeleted + activeDeleted + recordsWithoutRelationships.length}`, 'green');
        log('='.repeat(70), 'bright');
        
    } catch (error) {
        log(`❌ Error during cleanup: ${error.message}`, 'red');
        console.error(error.stack);
    }
}

// Run the cleanup
fixDuplicateRecords().then(() => {
    process.exit(0);
}).catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});