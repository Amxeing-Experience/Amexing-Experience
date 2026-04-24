/**
 * Find Price Discrepancy - Search for 1486 and 1858 prices in RatePrices table
 */

const Parse = require('parse/node');
const path = require('path');

// Initialize Parse
require('dotenv').config({ path: path.join(__dirname, 'environments/.env.development') });
Parse.initialize(
  process.env.PARSE_APP_ID || 'CrTRTaJpoJFNt8PJ',
  null,
  process.env.PARSE_MASTER_KEY || 'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP'
);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

async function findPriceDiscrepancy() {
  try {
    console.log('🔍 Searching for price discrepancy sources...\n');

    // Search for 1486 price in RatePrices
    console.log('💰 Searching for 1486 price in RatePrices...');
    const price1486Query = new Parse.Query('RatePrices');
    price1486Query.equalTo('price', 1486);
    price1486Query.include(['service', 'service.originPOI', 'service.destinationPOI', 'rate', 'vehicleType']);
    
    const ratePrices1486 = await price1486Query.find({ useMasterKey: true });
    console.log(`Found ${ratePrices1486.length} RatePrices with 1486 price:`);
    
    ratePrices1486.forEach(rp => {
      const service = rp.get('service');
      const rate = rp.get('rate');
      const vehicle = rp.get('vehicleType');
      const origin = service?.get('originPOI')?.get('name') || 'Unknown';
      const dest = service?.get('destinationPOI')?.get('name') || 'Unknown';
      
      console.log(`  📋 RatePrices ${rp.id}: ${origin} → ${dest}`);
      console.log(`      Rate: ${rate?.get('name')}, Vehicle: ${vehicle?.get('name')}`);
      console.log(`      Service: ${service?.id}`);
    });

    // Search for 1858 price in RatePrices
    console.log('\n💰 Searching for 1858 price in RatePrices...');
    const price1858Query = new Parse.Query('RatePrices');
    price1858Query.equalTo('price', 1858);
    price1858Query.include(['service', 'service.originPOI', 'service.destinationPOI', 'rate', 'vehicleType']);
    
    const ratePrices1858 = await price1858Query.find({ useMasterKey: true });
    console.log(`Found ${ratePrices1858.length} RatePrices with 1858 price:`);
    
    ratePrices1858.forEach(rp => {
      const service = rp.get('service');
      const rate = rp.get('rate');
      const vehicle = rp.get('vehicleType');
      const origin = service?.get('originPOI')?.get('name') || 'Unknown';
      const dest = service?.get('destinationPOI')?.get('name') || 'Unknown';
      
      console.log(`  📋 RatePrices ${rp.id}: ${origin} → ${dest}`);
      console.log(`      Rate: ${rate?.get('name')}, Vehicle: ${vehicle?.get('name')}`);
      console.log(`      Service: ${service?.id}`);
    });

    // Search for services with 1486 price
    console.log('\n📦 Searching for Services with 1486 price...');
    const service1486Query = new Parse.Query('Service');
    service1486Query.equalTo('price', 1486);
    service1486Query.include(['originPOI', 'destinationPOI', 'rate', 'vehicleType']);
    
    const services1486 = await service1486Query.find({ useMasterKey: true });
    console.log(`Found ${services1486.length} Services with 1486 price:`);
    
    services1486.forEach(service => {
      const rate = service.get('rate');
      const vehicle = service.get('vehicleType');
      const origin = service.get('originPOI')?.get('name') || 'Unknown';
      const dest = service.get('destinationPOI')?.get('name') || 'Unknown';
      
      console.log(`  📋 Service ${service.id}: ${origin} → ${dest}`);
      console.log(`      Rate: ${rate?.get('name')}, Vehicle: ${vehicle?.get('name')}`);
    });

    // Search for services with 1858 price
    console.log('\n📦 Searching for Services with 1858 price...');
    const service1858Query = new Parse.Query('Service');
    service1858Query.equalTo('price', 1858);
    service1858Query.include(['originPOI', 'destinationPOI', 'rate', 'vehicleType']);
    
    const services1858 = await service1858Query.find({ useMasterKey: true });
    console.log(`Found ${services1858.length} Services with 1858 price:`);
    
    services1858.forEach(service => {
      const rate = service.get('rate');
      const vehicle = service.get('vehicleType');
      const origin = service.get('originPOI')?.get('name') || 'Unknown';
      const dest = service.get('destinationPOI')?.get('name') || 'Unknown';
      
      console.log(`  📋 Service ${service.id}: ${origin} → ${dest}`);
      console.log(`      Rate: ${rate?.get('name')}, Vehicle: ${vehicle?.get('name')}`);
    });

    // Look for similar prices that might be close to 1486/1858 due to calculation differences
    console.log('\n🔍 Searching for similar prices (±50 range)...');
    
    const similarQuery1486 = new Parse.Query('RatePrices');
    similarQuery1486.greaterThanOrEqualTo('price', 1436);
    similarQuery1486.lessThanOrEqualTo('price', 1536);
    similarQuery1486.include(['service', 'service.originPOI', 'service.destinationPOI', 'rate', 'vehicleType']);
    
    const similarPrices1486 = await similarQuery1486.find({ useMasterKey: true });
    console.log(`Found ${similarPrices1486.length} RatePrices with prices 1436-1536:`);
    
    similarPrices1486.forEach(rp => {
      const price = rp.get('price');
      const service = rp.get('service');
      const rate = rp.get('rate');
      const vehicle = rp.get('vehicleType');
      const origin = service?.get('originPOI')?.get('name') || 'Unknown';
      const dest = service?.get('destinationPOI')?.get('name') || 'Unknown';
      
      console.log(`  💰 ${price} MXN - RatePrices ${rp.id}: ${origin} → ${dest}`);
      console.log(`      Rate: ${rate?.get('name')}, Vehicle: ${vehicle?.get('name')}`);
    });

    const similarQuery1858 = new Parse.Query('RatePrices');
    similarQuery1858.greaterThanOrEqualTo('price', 1808);
    similarQuery1858.lessThanOrEqualTo('price', 1908);
    similarQuery1858.include(['service', 'service.originPOI', 'service.destinationPOI', 'rate', 'vehicleType']);
    
    const similarPrices1858 = await similarQuery1858.find({ useMasterKey: true });
    console.log(`\nFound ${similarPrices1858.length} RatePrices with prices 1808-1908:`);
    
    similarPrices1858.forEach(rp => {
      const price = rp.get('price');
      const service = rp.get('service');
      const rate = rp.get('rate');
      const vehicle = rp.get('vehicleType');
      const origin = service?.get('originPOI')?.get('name') || 'Unknown';
      const dest = service?.get('destinationPOI')?.get('name') || 'Unknown';
      
      console.log(`  💰 ${price} MXN - RatePrices ${rp.id}: ${origin} → ${dest}`);
      console.log(`      Rate: ${rate?.get('name')}, Vehicle: ${vehicle?.get('name')}`);
    });

    // Check if the prices might be base prices with surcharge calculation
    console.log('\n🧮 Price calculation analysis:');
    console.log('If 1486 is a base price: 1486 × 1.2109 = ' + (1486 * 1.2109).toFixed(2));
    console.log('If 1858 is a base price: 1858 × 1.2109 = ' + (1858 * 1.2109).toFixed(2));
    console.log('If 1858 is with surcharge: 1858 ÷ 1.2109 = ' + (1858 / 1.2109).toFixed(2) + ' (base)');
    console.log('If 1486 is with surcharge: 1486 ÷ 1.2109 = ' + (1486 / 1.2109).toFixed(2) + ' (base)');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

findPriceDiscrepancy();