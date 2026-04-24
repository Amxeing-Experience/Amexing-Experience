/**
 * Verify Service Types - Check the two León services to confirm the issue
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

async function verifyServiceTypes() {
  try {
    console.log('🔍 Verifying the two León service types...\n');

    // Check the 1486 service (León city - Punto a Punto)
    console.log('💰 Service with 1486 pricing:');
    const service1486Query = new Parse.Query('Service');
    service1486Query.equalTo('objectId', 'uybmKin6FJ');
    service1486Query.include(['originPOI', 'destinationPOI', 'originPOI.serviceType', 'destinationPOI.serviceType']);
    
    const service1486 = await service1486Query.first({ useMasterKey: true });
    if (service1486) {
      const origin = service1486.get('originPOI');
      const dest = service1486.get('destinationPOI');
      const originServiceType = origin?.get('serviceType');
      const destServiceType = dest?.get('serviceType');
      
      console.log(`  📋 Service ${service1486.id}:`);
      console.log(`      Origin: ${origin?.get('name')} (${origin?.id})`);
      console.log(`      Origin ServiceType: ${originServiceType?.get('name')}`);
      console.log(`      Destination: ${dest?.get('name')} (${dest?.id})`);
      console.log(`      Destination ServiceType: ${destServiceType?.get('name')}`);
      console.log(`      Active: ${service1486.get('active')}`);
      console.log(`      Exists: ${service1486.get('exists')}`);
    }

    // Check the 1858 service (León airport - Aeropuerto)
    console.log('\n💰 Service with 1858 pricing:');
    const service1858Query = new Parse.Query('Service');
    service1858Query.equalTo('objectId', 'DXH0usGFw2');
    service1858Query.include(['originPOI', 'destinationPOI', 'originPOI.serviceType', 'destinationPOI.serviceType']);
    
    const service1858 = await service1858Query.first({ useMasterKey: true });
    if (service1858) {
      const origin = service1858.get('originPOI');
      const dest = service1858.get('destinationPOI');
      const originServiceType = origin?.get('serviceType');
      const destServiceType = dest?.get('serviceType');
      
      console.log(`  📋 Service ${service1858.id}:`);
      console.log(`      Origin: ${origin?.get('name')} (${origin?.id})`);
      console.log(`      Origin ServiceType: ${originServiceType?.get('name')}`);
      console.log(`      Destination: ${dest?.get('name')} (${dest?.id})`);
      console.log(`      Destination ServiceType: ${destServiceType?.get('name')}`);
      console.log(`      Active: ${service1858.get('active')}`);
      console.log(`      Exists: ${service1858.get('exists')}`);
    }

    // Get all ServiceType records to understand the categories
    console.log('\n📊 All ServiceType records:');
    const serviceTypesQuery = new Parse.Query('ServiceType');
    const serviceTypes = await serviceTypesQuery.find({ useMasterKey: true });
    
    serviceTypes.forEach(st => {
      console.log(`  🏷️  ${st.get('name')} (${st.id}) - Active: ${st.get('active')}`);
    });

    // Show the actual RatePrices records for verification
    console.log('\n💰 Verification - RatePrices for León routes:');
    
    // 1486 prices
    const ratePrices1486Query = new Parse.Query('RatePrices');
    ratePrices1486Query.equalTo('service', service1486);
    ratePrices1486Query.equalTo('price', 1486);
    ratePrices1486Query.include(['rate', 'vehicleType']);
    
    const ratePrices1486 = await ratePrices1486Query.find({ useMasterKey: true });
    console.log(`\n1486 MXN RatePrices (${ratePrices1486.length} records):`);
    ratePrices1486.forEach(rp => {
      const rate = rp.get('rate');
      const vehicle = rp.get('vehicleType');
      console.log(`  📋 ${rp.id}: ${rate?.get('name')} ${vehicle?.get('name')}`);
    });

    // 1858 prices  
    const ratePrices1858Query = new Parse.Query('RatePrices');
    ratePrices1858Query.equalTo('service', service1858);
    ratePrices1858Query.equalTo('price', 1858);
    ratePrices1858Query.include(['rate', 'vehicleType']);
    
    const ratePrices1858 = await ratePrices1858Query.find({ useMasterKey: true });
    console.log(`\n1858 MXN RatePrices (${ratePrices1858.length} records):`);
    ratePrices1858.forEach(rp => {
      const rate = rp.get('rate');
      const vehicle = rp.get('vehicleType');
      console.log(`  📋 ${rp.id}: ${rate?.get('name')} ${vehicle?.get('name')}`);
    });

    // Calculate expected prices with surcharge
    console.log('\n🧮 Expected Final Prices (with 21.09% surcharge):');
    console.log(`León City (1486 base): ${(1486 * 1.2109).toFixed(2)} MXN`);
    console.log(`León Airport (1858 base): ${(1858 * 1.2109).toFixed(2)} MXN`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

verifyServiceTypes();