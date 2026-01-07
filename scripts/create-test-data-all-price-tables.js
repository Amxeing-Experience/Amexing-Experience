#!/usr/bin/env node

/**
 * Create Test Data for All Price Tables Script
 * Creates active test records in TourPrices and ClientPrices tables for inflation testing
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

async function createTestDataForAllPriceTables() {
    log('\n' + '='.repeat(70), 'bright');
    log('CREATE TEST DATA FOR ALL PRICE TABLES', 'bright');
    log('='.repeat(70), 'bright');

    try {
        log('\n📝 Creating test records in TourPrices and ClientPrices tables...', 'cyan');
        log('This will ensure all price tables have records available for inflation testing.', 'yellow');
        
        // Get some reference data for relationships
        log('\n🔍 Getting reference data...', 'cyan');
        
        // Get some services
        const Service = Parse.Object.extend('Service');
        const serviceQuery = new Parse.Query(Service);
        serviceQuery.equalTo('active', true);
        serviceQuery.limit(10);
        const services = await serviceQuery.find({ useMasterKey: true });
        
        // Get some rates  
        const Rate = Parse.Object.extend('Rate');
        const rateQuery = new Parse.Query(Rate);
        rateQuery.equalTo('active', true);
        rateQuery.limit(10);
        const rates = await rateQuery.find({ useMasterKey: true });
        
        // Get some vehicle types
        const VehicleType = Parse.Object.extend('VehicleType');
        const vehicleQuery = new Parse.Query(VehicleType);
        vehicleQuery.equalTo('active', true);
        vehicleQuery.limit(10);
        const vehicleTypes = await vehicleQuery.find({ useMasterKey: true });

        log(`Found ${services.length} services, ${rates.length} rates, ${vehicleTypes.length} vehicle types`, 'blue');

        if (services.length === 0 || rates.length === 0 || vehicleTypes.length === 0) {
            log('❌ Missing required reference data. Cannot create test records.', 'red');
            return false;
        }

        let totalCreated = 0;

        // CREATE TOUR PRICES
        log('\n🏖️ Creating TourPrices test records...', 'cyan');
        const TourPrices = Parse.Object.extend('TourPrices');
        
        let tourPricesCreated = 0;
        for (let i = 0; i < Math.min(20, services.length * rates.length); i++) {
            try {
                const service = services[i % services.length];
                const rate = rates[i % rates.length];
                const vehicleType = vehicleTypes[i % vehicleTypes.length];
                
                const tourPrice = new TourPrices();
                tourPrice.set('service', service);
                tourPrice.set('rate', rate);
                tourPrice.set('vehicleType', vehicleType);
                tourPrice.set('price', Math.floor(Math.random() * 10000) + 1000); // Random price 1000-11000
                tourPrice.set('active', true);
                tourPrice.set('exists', true);
                // Don't set inflation_batch_id so it's ready for inflation
                
                await tourPrice.save(null, { useMasterKey: true });
                
                log(`  Created TourPrice: ID=${tourPrice.id}, Price=${tourPrice.get('price')}`, 'green');
                tourPricesCreated++;
                totalCreated++;
            } catch (error) {
                log(`  ❌ Failed to create TourPrice record: ${error.message}`, 'red');
            }
        }

        // CREATE CLIENT PRICES  
        log('\n👥 Creating ClientPrices test records...', 'cyan');
        const ClientPrices = Parse.Object.extend('ClientPrices');
        
        let clientPricesCreated = 0;
        for (let i = 0; i < Math.min(20, services.length * rates.length); i++) {
            try {
                const service = services[i % services.length];
                const rate = rates[i % rates.length]; 
                const vehicleType = vehicleTypes[i % vehicleTypes.length];
                
                const clientPrice = new ClientPrices();
                clientPrice.set('service', service);
                clientPrice.set('rate', rate);
                clientPrice.set('vehicleType', vehicleType);
                clientPrice.set('precio', Math.floor(Math.random() * 8000) + 800); // Random price 800-8800 (note: 'precio' field)
                clientPrice.set('active', true);
                clientPrice.set('exists', true);
                // Don't set inflation_batch_id so it's ready for inflation
                
                await clientPrice.save(null, { useMasterKey: true });
                
                log(`  Created ClientPrice: ID=${clientPrice.id}, Price=${clientPrice.get('precio')}`, 'green');
                clientPricesCreated++;
                totalCreated++;
            } catch (error) {
                log(`  ❌ Failed to create ClientPrice record: ${error.message}`, 'red');
            }
        }

        // VERIFICATION
        log('\n🔍 Verification...', 'cyan');
        
        // Check TourPrices
        const tourQuery = new Parse.Query(TourPrices);
        tourQuery.equalTo('active', true);
        tourQuery.equalTo('exists', true);
        tourQuery.doesNotExist('inflation_batch_id');
        const tourReadyCount = await tourQuery.count({ useMasterKey: true });
        
        // Check ClientPrices
        const clientQuery = new Parse.Query(ClientPrices);
        clientQuery.equalTo('active', true);
        clientQuery.equalTo('exists', true);
        clientQuery.doesNotExist('inflation_batch_id');
        const clientReadyCount = await clientQuery.count({ useMasterKey: true });
        
        // Check RatePrices (existing)
        const RatePrices = Parse.Object.extend('RatePrices');
        const rateQuery2 = new Parse.Query(RatePrices);
        rateQuery2.equalTo('active', true);
        rateQuery2.equalTo('exists', true);
        rateQuery2.doesNotExist('inflation_batch_id');
        const rateReadyCount = await rateQuery2.count({ useMasterKey: true });

        log('\n' + '='.repeat(70), 'bright');
        log(`🎉 TEST DATA CREATION COMPLETED!`, 'green');
        log(`TourPrices created: ${tourPricesCreated}`, 'green');
        log(`ClientPrices created: ${clientPricesCreated}`, 'green');
        log(`Total new records: ${totalCreated}`, 'green');
        log('\n📊 CURRENT INFLATION-READY RECORDS:', 'bright');
        log(`RatePrices: ${rateReadyCount} records ready`, rateReadyCount > 0 ? 'green' : 'yellow');
        log(`TourPrices: ${tourReadyCount} records ready`, tourReadyCount > 0 ? 'green' : 'yellow');
        log(`ClientPrices: ${clientReadyCount} records ready`, clientReadyCount > 0 ? 'green' : 'yellow');
        log(`\n✅ ALL PRICE TABLES now have records available for inflation testing!`, 'bright');
        log('='.repeat(70), 'bright');

        return true;
        
    } catch (error) {
        log(`❌ Script failed with error: ${error.message}`, 'red');
        console.error(error.stack);
        return false;
    }
}

// Run the script
createTestDataForAllPriceTables().then((success) => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});