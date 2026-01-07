#!/usr/bin/env node

/**
 * Preview Duplicate Records Script
 * Shows what duplicate records would be deleted without actually deleting them
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

async function previewDuplicateRecords() {
    log('\n' + '='.repeat(70), 'bright');
    log('PREVIEW DUPLICATE RECORDS - NO DELETION', 'bright');
    log('='.repeat(70), 'bright');

    try {
        // Process each class
        const classesToProcess = ['RatePrices', 'TourPrices', 'ClientPrices'];
        let totalWouldDelete = 0;

        for (const className of classesToProcess) {
            log(`\n🔍 Analyzing ${className}...`, 'cyan');
            
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
            
            log(`📊 Found ${duplicateKeys.length} duplicate combinations`, duplicateKeys.length > 0 ? 'red' : 'green');
            log(`📊 Found ${recordsWithoutRelationships.length} records without relationships`, recordsWithoutRelationships.length > 0 ? 'red' : 'green');

            let wouldDeleteForClass = 0;

            // Preview duplicate records that would be deleted
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

                log(`\n📋 Duplicate combination ${key}:`, 'blue');
                log(`  WOULD KEEP: ID=${toKeep.id}, Price=${keepPrice}, Created=${toKeep.get('createdAt').toISOString()}, Batch=${toKeep.get('inflation_batch_id') || 'none'}`, 'green');
                
                for (const record of toDelete) {
                    let deletePrice = record.get('price');
                    if (className === 'ClientPrices') {
                        deletePrice = record.get('precio');
                    }
                    
                    log(`  WOULD DELETE: ID=${record.id}, Price=${deletePrice}, Created=${record.get('createdAt').toISOString()}, Batch=${record.get('inflation_batch_id') || 'none'}`, 'red');
                    wouldDeleteForClass++;
                    totalWouldDelete++;
                }
            }

            // Preview records without proper relationships that would be deleted
            if (recordsWithoutRelationships.length > 0) {
                log(`\n🗑️ Orphaned ${className} records that WOULD BE DELETED:`, 'yellow');
                
                for (const record of recordsWithoutRelationships) {
                    let price = record.get('price');
                    if (className === 'ClientPrices') {
                        price = record.get('precio');
                    }
                    
                    log(`  WOULD DELETE orphaned: ID=${record.id}, Price=${price || 'N/A'}`, 'yellow');
                    wouldDeleteForClass++;
                    totalWouldDelete++;
                }
            }

            log(`📊 Would delete ${wouldDeleteForClass} records from ${className}`, wouldDeleteForClass > 0 ? 'yellow' : 'green');
        }

        log('\n' + '='.repeat(70), 'bright');
        if (totalWouldDelete > 0) {
            log(`⚠️  PREVIEW SUMMARY`, 'yellow');
            log(`Total records that WOULD BE DELETED: ${totalWouldDelete}`, 'yellow');
            log(`\nTo actually delete these records, run:`, 'cyan');
            log(`node scripts/delete-duplicate-records.js`, 'cyan');
        } else {
            log(`✅ NO DUPLICATES FOUND!`, 'green');
            log(`Your database is clean - no duplicates to delete.`, 'green');
        }
        log('='.repeat(70), 'bright');

        return true;
        
    } catch (error) {
        log(`❌ Script failed with error: ${error.message}`, 'red');
        console.error(error.stack);
        return false;
    }
}

// Run the preview
previewDuplicateRecords().then((success) => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});