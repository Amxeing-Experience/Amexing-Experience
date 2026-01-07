#!/usr/bin/env node

/**
 * Delete Duplicate Records Script
 * Automatically identifies and removes duplicate price records
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

async function deleteDuplicateRecords() {
    log('\n' + '='.repeat(70), 'bright');
    log('DELETE DUPLICATE RECORDS SCRIPT', 'bright');
    log('='.repeat(70), 'bright');

    try {
        log('\n⚠️  WARNING: This script will DELETE duplicate records!', 'red');
        log('Make sure you have a backup before proceeding.', 'yellow');
        
        // Give user a chance to cancel
        log('\nStarting in 5 seconds... Press Ctrl+C to cancel', 'yellow');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Process each class
        const classesToProcess = ['RatePrices', 'TourPrices', 'ClientPrices'];
        let totalDeleted = 0;

        for (const className of classesToProcess) {
            log(`\n🔍 Processing ${className}...`, 'cyan');
            
            const ClassObj = Parse.Object.extend(className);
            
            // Get all active records
            const query = new Parse.Query(ClassObj);
            query.equalTo('active', true);
            query.equalTo('exists', true);
            query.doesNotExist('valid_until');
            query.include('service');
            query.include('rate');
            query.include('vehicleType');
            query.limit(1000);
            
            const activeRecords = await query.find({ useMasterKey: true });
            log(`Found ${activeRecords.length} active ${className} records`, 'yellow');

            // Group by service + rate + vehicleType combination
            const combinations = {};
            const recordsWithoutRelationships = [];

            activeRecords.forEach(record => {
                const service = record.get('service');
                const rate = record.get('rate');
                const vehicleType = record.get('vehicleType');

                // Check for records without proper relationships
                if (!service || !rate || !vehicleType) {
                    recordsWithoutRelationships.push(record);
                    return;
                }

                const key = `${service.id}_${rate.id}_${vehicleType.id}`;
                
                if (!combinations[key]) {
                    combinations[key] = [];
                }
                combinations[key].push(record);
            });

            // Find duplicates
            const duplicateKeys = Object.keys(combinations).filter(key => combinations[key].length > 1);
            
            log(`Found ${duplicateKeys.length} duplicate combinations`, duplicateKeys.length > 0 ? 'red' : 'green');
            log(`Found ${recordsWithoutRelationships.length} records without relationships`, recordsWithoutRelationships.length > 0 ? 'red' : 'green');

            let deletedForClass = 0;

            // Delete duplicate records (keep the newest one)
            for (const key of duplicateKeys) {
                const records = combinations[key];
                
                // Sort by creation date and inflation batch ID (prefer records with inflation_batch_id)
                records.sort((a, b) => {
                    // Prefer records with inflation_batch_id (these are the newer inflated prices)
                    const aHasInflation = !!a.get('inflation_batch_id');
                    const bHasInflation = !!b.get('inflation_batch_id');
                    
                    if (aHasInflation && !bHasInflation) return -1;
                    if (!aHasInflation && bHasInflation) return 1;
                    
                    // If both have or don't have inflation_batch_id, sort by creation date
                    return b.get('createdAt').getTime() - a.get('createdAt').getTime();
                });

                const toKeep = records[0];
                const toDelete = records.slice(1);

                // Get price for display
                let keepPrice = toKeep.get('price');
                if (className === 'ClientPrices') {
                    keepPrice = toKeep.get('precio');
                }

                log(`\n📋 Combination ${key}:`, 'blue');
                log(`  Keeping: ID=${toKeep.id}, Price=${keepPrice}, Created=${toKeep.get('createdAt').toISOString()}, Batch=${toKeep.get('inflation_batch_id') || 'none'}`, 'green');
                
                for (const record of toDelete) {
                    let deletePrice = record.get('price');
                    if (className === 'ClientPrices') {
                        deletePrice = record.get('precio');
                    }
                    
                    log(`  Deleting: ID=${record.id}, Price=${deletePrice}, Created=${record.get('createdAt').toISOString()}, Batch=${record.get('inflation_batch_id') || 'none'}`, 'red');
                    
                    try {
                        await record.destroy({ useMasterKey: true });
                        deletedForClass++;
                        totalDeleted++;
                    } catch (error) {
                        log(`    ❌ Failed to delete record ${record.id}: ${error.message}`, 'red');
                    }
                }
            }

            // Delete records without proper relationships
            if (recordsWithoutRelationships.length > 0) {
                log(`\n🗑️ Deleting ${recordsWithoutRelationships.length} orphaned ${className} records...`, 'yellow');
                
                for (const record of recordsWithoutRelationships) {
                    let price = record.get('price');
                    if (className === 'ClientPrices') {
                        price = record.get('precio');
                    }
                    
                    log(`  Deleting orphaned: ID=${record.id}, Price=${price || 'N/A'}`, 'yellow');
                    
                    try {
                        await record.destroy({ useMasterKey: true });
                        deletedForClass++;
                        totalDeleted++;
                    } catch (error) {
                        log(`    ❌ Failed to delete orphaned record ${record.id}: ${error.message}`, 'red');
                    }
                }
            }

            log(`✅ Deleted ${deletedForClass} duplicate/orphaned records from ${className}`, 'green');
        }

        // Final verification
        log('\n🔍 Final verification...', 'cyan');
        
        for (const className of classesToProcess) {
            const ClassObj = Parse.Object.extend(className);
            const verifyQuery = new Parse.Query(ClassObj);
            verifyQuery.equalTo('active', true);
            verifyQuery.equalTo('exists', true);
            verifyQuery.doesNotExist('valid_until');
            verifyQuery.include('service');
            verifyQuery.include('rate');
            verifyQuery.include('vehicleType');
            
            const remainingRecords = await verifyQuery.find({ useMasterKey: true });
            
            // Check for remaining duplicates
            const verifyGroups = {};
            remainingRecords.forEach(record => {
                const service = record.get('service');
                const rate = record.get('rate');
                const vehicleType = record.get('vehicleType');
                
                if (service && rate && vehicleType) {
                    const key = `${service.id}_${rate.id}_${vehicleType.id}`;
                    if (!verifyGroups[key]) verifyGroups[key] = [];
                    verifyGroups[key].push(record);
                }
            });
            
            const remainingDuplicates = Object.entries(verifyGroups).filter(([key, records]) => records.length > 1);
            
            log(`${className}: ${remainingRecords.length} active records, ${remainingDuplicates.length} remaining duplicates`, 
                remainingDuplicates.length === 0 ? 'green' : 'red');
        }

        log('\n' + '='.repeat(70), 'bright');
        if (totalDeleted > 0) {
            log(`🎉 CLEANUP COMPLETED!`, 'green');
            log(`Total duplicate records deleted: ${totalDeleted}`, 'green');
        } else {
            log(`✅ NO DUPLICATES FOUND!`, 'green');
            log(`Your database is already clean.`, 'green');
        }
        log('='.repeat(70), 'bright');

        return true;
        
    } catch (error) {
        log(`❌ Script failed with error: ${error.message}`, 'red');
        console.error(error.stack);
        return false;
    }
}

// Run the cleanup
deleteDuplicateRecords().then((success) => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});