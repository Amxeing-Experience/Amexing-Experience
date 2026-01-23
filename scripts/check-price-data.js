#!/usr/bin/env node

/**
 * Check Price Data Script
 * Verifies what price records exist in the database
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

async function checkPriceData() {
    log('\n' + '='.repeat(60), 'bright');
    log('PRICE DATA VERIFICATION', 'bright');
    log('='.repeat(60), 'bright');

    try {
        const classesToCheck = ['RatePrice', 'TourPrice', 'ClientPrice'];
        
        for (const className of classesToCheck) {
            log(`\n📋 Checking ${className} table...`, 'cyan');
            
            const ClassObj = Parse.Object.extend(className);
            
            // Check all records
            const allQuery = new Parse.Query(ClassObj);
            allQuery.limit(1000);
            const allRecords = await allQuery.find({ useMasterKey: true });
            
            // Check active records
            const activeQuery = new Parse.Query(ClassObj);
            activeQuery.equalTo('active', true);
            activeQuery.equalTo('exists', true);
            activeQuery.limit(1000);
            const activeRecords = await activeQuery.find({ useMasterKey: true });
            
            // Check records without inflation
            const uninflatedQuery = new Parse.Query(ClassObj);
            uninflatedQuery.equalTo('active', true);
            uninflatedQuery.equalTo('exists', true);
            uninflatedQuery.doesNotExist('inflation_batch_id');
            uninflatedQuery.limit(1000);
            const uninflatedRecords = await uninflatedQuery.find({ useMasterKey: true });
            
            log(`  📊 Total records: ${allRecords.length}`, 'yellow');
            log(`  ✅ Active records: ${activeRecords.length}`, 'green');
            log(`  🔄 Ready for inflation: ${uninflatedRecords.length}`, 'blue');
            
            if (uninflatedRecords.length > 0) {
                log(`\n  📝 Sample records ready for inflation:`, 'cyan');
                uninflatedRecords.slice(0, 5).forEach((record, index) => {
                    const name = record.get('name') || record.get('description') || 'Unnamed';
                    const price = record.get('price') || 0;
                    log(`    ${index + 1}. ${name}: $${price}`, 'yellow');
                });
            }
            
            if (allRecords.length === 0) {
                log(`  ⚠️  No records found in ${className} table!`, 'red');
            }
        }
        
        // Also check existing inflation history
        log(`\n📈 Checking InflationHistory table...`, 'cyan');
        const InflationHistory = Parse.Object.extend('InflationHistory');
        const historyQuery = new Parse.Query(InflationHistory);
        historyQuery.descending('createdAt');
        historyQuery.limit(10);
        
        const historyRecords = await historyQuery.find({ useMasterKey: true });
        log(`  📊 Inflation history records: ${historyRecords.length}`, 'yellow');
        
        if (historyRecords.length > 0) {
            log(`\n  📝 Recent inflation attempts:`, 'cyan');
            historyRecords.forEach((record, index) => {
                const status = record.get('status');
                const percentage = record.get('percentage');
                const processed = record.get('processed_count') || 0;
                const createdAt = record.get('createdAt').toLocaleDateString();
                log(`    ${index + 1}. ${createdAt}: ${percentage}% - ${status} (${processed} processed)`, 'yellow');
            });
        }
        
    } catch (error) {
        log(`❌ Error checking price data: ${error.message}`, 'red');
        console.error(error.stack);
    }
}

async function createTestData() {
    log('\n' + '='.repeat(60), 'bright');
    log('CREATING TEST DATA', 'bright');
    log('='.repeat(60), 'bright');

    try {
        const testData = [];
        
        // Create RatePrice test data
        log('\n📦 Creating RatePrice test data...', 'cyan');
        for (let i = 1; i <= 3; i++) {
            const RatePrice = Parse.Object.extend('RatePrice');
            const testRate = new RatePrice();
            testRate.set('name', `Tarifa de Prueba ${i}`);
            testRate.set('description', `Descripción de la tarifa ${i}`);
            testRate.set('price', 100 * i); // $100, $200, $300
            testRate.set('active', true);
            testRate.set('exists', true);
            testRate.set('isTestData', true);
            
            await testRate.save(null, { useMasterKey: true });
            testData.push(testRate.id);
            log(`  ✅ Created: ${testRate.get('name')} - $${testRate.get('price')}`, 'green');
        }
        
        // Create TourPrice test data
        log('\n📦 Creating TourPrice test data...', 'cyan');
        for (let i = 1; i <= 3; i++) {
            const TourPrice = Parse.Object.extend('TourPrice');
            const testTour = new TourPrice();
            testTour.set('name', `Tour de Prueba ${i}`);
            testTour.set('description', `Descripción del tour ${i}`);
            testTour.set('price', 500 * i); // $500, $1000, $1500
            testTour.set('active', true);
            testTour.set('exists', true);
            testTour.set('isTestData', true);
            
            await testTour.save(null, { useMasterKey: true });
            testData.push(testTour.id);
            log(`  ✅ Created: ${testTour.get('name')} - $${testTour.get('price')}`, 'green');
        }
        
        // Create ClientPrice test data
        log('\n📦 Creating ClientPrice test data...', 'cyan');
        for (let i = 1; i <= 3; i++) {
            const ClientPrice = Parse.Object.extend('ClientPrice');
            const testClient = new ClientPrice();
            testClient.set('name', `Precio Cliente ${i}`);
            testClient.set('description', `Precio especial para cliente ${i}`);
            testClient.set('price', 250 * i); // $250, $500, $750
            testClient.set('active', true);
            testClient.set('exists', true);
            testClient.set('isTestData', true);
            
            await testClient.save(null, { useMasterKey: true });
            testData.push(testClient.id);
            log(`  ✅ Created: ${testClient.get('name')} - $${testClient.get('price')}`, 'green');
        }
        
        log(`\n🎉 Successfully created ${testData.length} test records!`, 'green');
        log('You can now test the inflation process with real data.', 'yellow');
        
        return testData;
        
    } catch (error) {
        log(`❌ Error creating test data: ${error.message}`, 'red');
        console.error(error.stack);
        return [];
    }
}

async function cleanupTestData() {
    log('\n' + '='.repeat(60), 'bright');
    log('CLEANING UP TEST DATA', 'bright');
    log('='.repeat(60), 'bright');

    try {
        const classesToClean = ['RatePrice', 'TourPrice', 'ClientPrice'];
        let totalCleaned = 0;
        
        for (const className of classesToClean) {
            const ClassObj = Parse.Object.extend(className);
            const query = new Parse.Query(ClassObj);
            query.equalTo('isTestData', true);
            
            const testRecords = await query.find({ useMasterKey: true });
            
            for (const record of testRecords) {
                await record.destroy({ useMasterKey: true });
                totalCleaned++;
            }
            
            log(`  🧹 Cleaned ${testRecords.length} records from ${className}`, 'yellow');
        }
        
        log(`\n✅ Total cleaned: ${totalCleaned} test records`, 'green');
        
    } catch (error) {
        log(`❌ Error cleaning test data: ${error.message}`, 'red');
        console.error(error.stack);
    }
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--create')) {
        await createTestData();
    } else if (args.includes('--cleanup')) {
        await cleanupTestData();
    } else {
        await checkPriceData();
        
        log('\n' + '='.repeat(60), 'bright');
        log('NEXT STEPS', 'bright');
        log('='.repeat(60), 'bright');
        log('', 'reset');
        log('To create test data for inflation testing:', 'cyan');
        log('  node scripts/check-price-data.js --create', 'yellow');
        log('', 'reset');
        log('To cleanup test data after testing:', 'cyan');
        log('  node scripts/check-price-data.js --cleanup', 'yellow');
        log('', 'reset');
    }
}

// Run the script
main().then(() => {
    process.exit(0);
}).catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});