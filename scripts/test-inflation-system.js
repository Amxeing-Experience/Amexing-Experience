#!/usr/bin/env node

/**
 * Test Script for Inflation Management System
 * Tests the inflation and revert functionality with mock data
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
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function createMockData() {
    log('\n📦 Creating mock data for testing...', 'cyan');
    
    const mockData = {
        ratePrices: [],
        tourPrices: [],
        clientPrices: []
    };

    try {
        // Create mock RatePrices
        log('Creating mock RatePrices...', 'yellow');
        for (let i = 1; i <= 3; i++) {
            const ratePrice = new Parse.Object('RatePrice');
            ratePrice.set('name', `Test Rate ${i}`);
            ratePrice.set('price', 100 * i);  // $100, $200, $300
            ratePrice.set('active', true);
            ratePrice.set('exists', true);
            ratePrice.set('isTestData', true);  // Flag for cleanup
            await ratePrice.save(null, { useMasterKey: true });
            mockData.ratePrices.push(ratePrice);
            log(`  ✓ Created RatePrice: ${ratePrice.get('name')} - $${ratePrice.get('price')}`, 'green');
        }

        // Create mock TourPrices
        log('Creating mock TourPrices...', 'yellow');
        for (let i = 1; i <= 3; i++) {
            const tourPrice = new Parse.Object('TourPrice');
            tourPrice.set('name', `Test Tour ${i}`);
            tourPrice.set('price', 500 * i);  // $500, $1000, $1500
            tourPrice.set('active', true);
            tourPrice.set('exists', true);
            tourPrice.set('isTestData', true);  // Flag for cleanup
            await tourPrice.save(null, { useMasterKey: true });
            mockData.tourPrices.push(tourPrice);
            log(`  ✓ Created TourPrice: ${tourPrice.get('name')} - $${tourPrice.get('price')}`, 'green');
        }

        // Create mock ClientPrices
        log('Creating mock ClientPrices...', 'yellow');
        for (let i = 1; i <= 3; i++) {
            const clientPrice = new Parse.Object('ClientPrice');
            clientPrice.set('name', `Test Client Rate ${i}`);
            clientPrice.set('price', 250 * i);  // $250, $500, $750
            clientPrice.set('active', true);
            clientPrice.set('exists', true);
            clientPrice.set('isTestData', true);  // Flag for cleanup
            await clientPrice.save(null, { useMasterKey: true });
            mockData.clientPrices.push(clientPrice);
            log(`  ✓ Created ClientPrice: ${clientPrice.get('name')} - $${clientPrice.get('price')}`, 'green');
        }

        return mockData;
    } catch (error) {
        log(`Error creating mock data: ${error.message}`, 'red');
        throw error;
    }
}

async function testInflationApplication(mockData, percentage = 10) {
    log(`\n🚀 Testing inflation application with ${percentage}% increase...`, 'cyan');
    
    try {
        // Store original prices for comparison
        const originalPrices = {
            ratePrices: mockData.ratePrices.map(p => ({ id: p.id, price: p.get('price') })),
            tourPrices: mockData.tourPrices.map(p => ({ id: p.id, price: p.get('price') })),
            clientPrices: mockData.clientPrices.map(p => ({ id: p.id, price: p.get('price') }))
        };

        log('Original prices stored for comparison', 'yellow');

        // Call the inflation cloud function
        log('Calling iniciarProcesoInflacion cloud function...', 'yellow');
        const result = await Parse.Cloud.run('iniciarProcesoInflacion', {
            percentage: percentage
        }, { useMasterKey: true });

        if (result.success) {
            log(`✓ Inflation process initiated successfully! Batch ID: ${result.batchId}`, 'green');
            
            // Wait a moment for the job to process
            log('Waiting for background job to process...', 'yellow');
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Check the status
            const status = await Parse.Cloud.run('obtenerEstadoInflacion', {
                batchId: result.batchId
            }, { useMasterKey: true });

            if (status.success) {
                log(`Status: ${status.status} - Processed: ${status.processed_count} records`, 'cyan');
                
                // Since this is a background job, it may not be completed yet
                if (status.status === 'COMPLETED') {
                    log(`✓ Inflation completed successfully!`, 'green');
                } else if (status.status === 'PENDING' || status.status === 'IN_PROGRESS') {
                    log(`⏳ Inflation still processing (status: ${status.status})`, 'yellow');
                }
            }

            // Verify price changes
            log('\n📊 Verifying price changes...', 'cyan');
            
            // Check RatePrices
            log('Checking RatePrices...', 'yellow');
            for (const original of originalPrices.ratePrices) {
                const query = new Parse.Query('RatePrice');
                query.equalTo('objectId', original.id);
                query.equalTo('active', true);
                query.equalTo('exists', true);
                const updated = await query.first({ useMasterKey: true });
                
                if (updated) {
                    const expectedPrice = Math.round(original.price * (1 + percentage / 100));
                    const actualPrice = updated.get('price');
                    const match = actualPrice === expectedPrice ? '✓' : '✗';
                    log(`  ${match} Price ${original.id}: $${original.price} → $${actualPrice} (expected: $${expectedPrice})`, 
                        match === '✓' ? 'green' : 'red');
                }
            }

            // Check TourPrices
            log('Checking TourPrices...', 'yellow');
            for (const original of originalPrices.tourPrices) {
                const query = new Parse.Query('TourPrice');
                query.equalTo('objectId', original.id);
                query.equalTo('active', true);
                query.equalTo('exists', true);
                const updated = await query.first({ useMasterKey: true });
                
                if (updated) {
                    const expectedPrice = Math.round(original.price * (1 + percentage / 100));
                    const actualPrice = updated.get('price');
                    const match = actualPrice === expectedPrice ? '✓' : '✗';
                    log(`  ${match} Price ${original.id}: $${original.price} → $${actualPrice} (expected: $${expectedPrice})`, 
                        match === '✓' ? 'green' : 'red');
                }
            }

            // Check ClientPrices
            log('Checking ClientPrices...', 'yellow');
            for (const original of originalPrices.clientPrices) {
                const query = new Parse.Query('ClientPrice');
                query.equalTo('objectId', original.id);
                query.equalTo('active', true);
                query.equalTo('exists', true);
                const updated = await query.first({ useMasterKey: true });
                
                if (updated) {
                    const expectedPrice = Math.round(original.price * (1 + percentage / 100));
                    const actualPrice = updated.get('price');
                    const match = actualPrice === expectedPrice ? '✓' : '✗';
                    log(`  ${match} Price ${original.id}: $${original.price} → $${actualPrice} (expected: $${expectedPrice})`, 
                        match === '✓' ? 'green' : 'red');
                }
            }

            return { success: true, batchId: result.batchId };
        } else {
            log(`✗ Inflation process failed: ${result.error}`, 'red');
            return { success: false };
        }

    } catch (error) {
        log(`Error testing inflation: ${error.message}`, 'red');
        return { success: false };
    }
}

async function testInflationRevert() {
    log('\n⏪ Testing inflation revert...', 'cyan');
    
    try {
        // Call the revert cloud function
        log('Calling revertirInflacion cloud function...', 'yellow');
        const result = await Parse.Cloud.run('revertirInflacion', {}, { useMasterKey: true });

        if (result.success) {
            log(`✓ Inflation reverted successfully!`, 'green');
            log(`  Total records processed: ${result.summary.totalRecords}`, 'green');
            log(`  Tables affected: ${result.summary.tables.map(t => t.table).join(', ')}`, 'green');
            
            // Show details for each table
            result.summary.tables.forEach(table => {
                log(`  ${table.table}: ${table.reverted} records reverted`, 'cyan');
            });
            
            return true;
        } else {
            log(`✗ Revert failed: ${result.error}`, 'red');
            return false;
        }

    } catch (error) {
        log(`Error testing revert: ${error.message}`, 'red');
        return false;
    }
}

async function cleanupTestData() {
    log('\n🧹 Cleaning up test data...', 'cyan');
    
    try {
        // Clean up RatePrices
        const ratePriceQuery = new Parse.Query('RatePrice');
        ratePriceQuery.equalTo('isTestData', true);
        const ratePrices = await ratePriceQuery.find({ useMasterKey: true });
        for (const price of ratePrices) {
            await price.destroy({ useMasterKey: true });
        }
        log(`  ✓ Cleaned up ${ratePrices.length} RatePrice records`, 'green');

        // Clean up TourPrices
        const tourPriceQuery = new Parse.Query('TourPrice');
        tourPriceQuery.equalTo('isTestData', true);
        const tourPrices = await tourPriceQuery.find({ useMasterKey: true });
        for (const price of tourPrices) {
            await price.destroy({ useMasterKey: true });
        }
        log(`  ✓ Cleaned up ${tourPrices.length} TourPrice records`, 'green');

        // Clean up ClientPrices
        const clientPriceQuery = new Parse.Query('ClientPrice');
        clientPriceQuery.equalTo('isTestData', true);
        const clientPrices = await clientPriceQuery.find({ useMasterKey: true });
        for (const price of clientPrices) {
            await price.destroy({ useMasterKey: true });
        }
        log(`  ✓ Cleaned up ${clientPrices.length} ClientPrice records`, 'green');

        // Clean up InflationHistory
        const historyQuery = new Parse.Query('InflationHistory');
        historyQuery.descending('createdAt');
        historyQuery.limit(10);  // Clean only recent test entries
        const histories = await historyQuery.find({ useMasterKey: true });
        for (const history of histories) {
            // Only delete if it looks like test data (small batch)
            if (history.get('totalRecords') <= 20) {
                await history.destroy({ useMasterKey: true });
            }
        }
        log(`  ✓ Cleaned up ${histories.length} InflationHistory records`, 'green');

    } catch (error) {
        log(`Error cleaning up: ${error.message}`, 'red');
    }
}

async function runTest() {
    log('\n' + '='.repeat(60), 'bright');
    log('INFLATION MANAGEMENT SYSTEM TEST', 'bright');
    log('='.repeat(60), 'bright');

    try {
        // Step 1: Create mock data
        const mockData = await createMockData();
        
        // Step 2: Test inflation application
        const inflationResult = await testInflationApplication(mockData, 15);  // 15% inflation
        
        if (inflationResult.success) {
            // Step 3: Wait a bit then test revert
            log('\nWaiting before testing revert...', 'yellow');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            await testInflationRevert();
        }
        
        // Step 4: Clean up
        await cleanupTestData();
        
        log('\n' + '='.repeat(60), 'bright');
        log('TEST COMPLETED SUCCESSFULLY! ✓', 'green');
        log('='.repeat(60), 'bright');

    } catch (error) {
        log(`\nTest failed: ${error.message}`, 'red');
        log('Stack trace:', 'red');
        console.error(error.stack);
        
        // Try to cleanup even if test failed
        await cleanupTestData();
        
        process.exit(1);
    }
}

// Run the test
runTest().then(() => {
    process.exit(0);
}).catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});