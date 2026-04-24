/**
 * Debug script to check León Airport route pricing in database
 * This will help identify the price discrepancy between quotes (1486) and traslados ($1,858)
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

async function debugLeonAirportPricing() {
  try {
    console.log('🔍 Debugging León Airport route pricing...\n');

    // 1. Find León Airport POI
    const poisQuery = new Parse.Query('POI');
    poisQuery.contains('name', 'Leon');
    poisQuery.contains('name', 'Aeropuerto');
    const leonPois = await poisQuery.find({ useMasterKey: true });
    
    console.log('📍 León Airport POIs found:');
    leonPois.forEach(poi => {
      console.log(`  - ${poi.get('name')} (ID: ${poi.id})`);
    });

    // 2. Find San Miguel de Allende POI  
    const smaQuery = new Parse.Query('POI');
    smaQuery.contains('name', 'San Miguel');
    smaQuery.contains('name', 'Allende');
    const smaPois = await smaQuery.find({ useMasterKey: true });
    
    console.log('\n📍 San Miguel de Allende POIs found:');
    smaPois.forEach(poi => {
      console.log(`  - ${poi.get('name')} (ID: ${poi.id})`);
    });

    // 3. Get Premium rate
    const ratesQuery = new Parse.Query('Rate');
    ratesQuery.equalTo('name', 'Premium');
    const premiumRate = await ratesQuery.first({ useMasterKey: true });
    
    if (premiumRate) {
      console.log(`\n💰 Premium Rate found: ${premiumRate.get('name')} (ID: ${premiumRate.id})`);
    }

    // 4. Get SEDAN vehicle type
    const vehicleQuery = new Parse.Query('VehicleType');
    vehicleQuery.equalTo('name', 'SEDAN');
    const sedanVehicle = await vehicleQuery.first({ useMasterKey: true });
    
    if (sedanVehicle) {
      console.log(`🚗 SEDAN Vehicle found: ${sedanVehicle.get('name')} (ID: ${sedanVehicle.id})`);
    }

    // 5. Find Services between San Miguel and León Airport
    if (leonPois.length > 0 && smaPois.length > 0) {
      const leonPoi = leonPois[0];
      const smaPoi = smaPois[0];

      console.log('\n🔄 Searching for Services...');
      
      // Query services from San Miguel to León Airport
      const servicesQuery = new Parse.Query('Service');
      servicesQuery.equalTo('originPOI', smaPoi);
      servicesQuery.equalTo('destinationPOI', leonPoi);
      servicesQuery.equalTo('exists', true);
      servicesQuery.include(['rate', 'vehicleType', 'originPOI', 'destinationPOI']);
      
      const services = await servicesQuery.find({ useMasterKey: true });
      
      console.log(`Found ${services.length} services from San Miguel to León Airport:`);
      
      services.forEach(service => {
        const rate = service.get('rate');
        const vehicle = service.get('vehicleType');
        const price = service.get('price');
        
        console.log(`  📋 Service (ID: ${service.id}):`);
        console.log(`      Rate: ${rate?.get('name') || 'Unknown'}`);
        console.log(`      Vehicle: ${vehicle?.get('name') || 'Unknown'}`);
        console.log(`      Price: ${price} MXN`);
        console.log(`      Active: ${service.get('active')}`);
        console.log(`      Exists: ${service.get('exists')}`);
        console.log(`      Created: ${service.get('createdAt')}`);
        console.log('');
      });
    }

    // 6. Check total Services and RatePrices count
    console.log('\n📊 Database Statistics:');
    const totalServicesQuery = new Parse.Query('Service');
    const totalServices = await totalServicesQuery.count({ useMasterKey: true });
    console.log(`  Total Services in database: ${totalServices}`);
    
    const totalRatePriceQuery = new Parse.Query('RatePrice');
    const totalRatePrice = await totalRatePriceQuery.count({ useMasterKey: true });
    console.log(`  Total RatePrice (singular) in database: ${totalRatePrice}`);
    
    const totalRatePricesQuery = new Parse.Query('RatePrices');
    const totalRatePrices = await totalRatePricesQuery.count({ useMasterKey: true });
    console.log(`  Total RatePrices (plural) in database: ${totalRatePrices}`);

    // 7. Check if there are any Services between the multiple León POIs
    console.log('\n🔍 Checking all León POI combinations...');
    
    let foundAnyService = false;
    
    for (const leonPoi of leonPois) {
      for (const smaPoi of smaPois) {
        // Try both directions
        const smaToLeonQuery = new Parse.Query('Service');
        smaToLeonQuery.equalTo('originPOI', smaPoi);
        smaToLeonQuery.equalTo('destinationPOI', leonPoi);
        smaToLeonQuery.equalTo('exists', true);
        smaToLeonQuery.include(['rate', 'vehicleType']);
        
        const smaToLeonServices = await smaToLeonQuery.find({ useMasterKey: true });
        
        const leonToSmaQuery = new Parse.Query('Service');
        leonToSmaQuery.equalTo('originPOI', leonPoi);
        leonToSmaQuery.equalTo('destinationPOI', smaPoi);
        leonToSmaQuery.equalTo('exists', true);
        leonToSmaQuery.include(['rate', 'vehicleType']);
        
        const leonToSmaServices = await leonToSmaQuery.find({ useMasterKey: true });
        
        if (smaToLeonServices.length > 0 || leonToSmaServices.length > 0) {
          foundAnyService = true;
          console.log(`\n  ✅ Found services between:`);
          console.log(`     ${smaPoi.get('name')} (${smaPoi.id})`);
          console.log(`     ${leonPoi.get('name')} (${leonPoi.id})`);
          
          [...smaToLeonServices, ...leonToSmaServices].forEach(service => {
            const rate = service.get('rate');
            const vehicle = service.get('vehicleType');
            const price = service.get('price');
            const origin = service.get('originPOI');
            const dest = service.get('destinationPOI');
            
            console.log(`      📋 Service (ID: ${service.id}):`);
            console.log(`          Route: ${origin?.get('name')} → ${dest?.get('name')}`);
            console.log(`          Rate: ${rate?.get('name') || 'Unknown'}`);
            console.log(`          Vehicle: ${vehicle?.get('name') || 'Unknown'}`);
            console.log(`          Price: ${price} MXN`);
          });
        }
      }
    }
    
    if (!foundAnyService) {
      console.log('  ❌ No Services found between any León and San Miguel POI combinations');
    }
    
    // 8. Now check RatePrices (plural) for León routes
    console.log('\n💰 Checking RatePrices (plural) for León routes...');
    console.log('='.repeat(80));
    
    const ratePricesQuery = new Parse.Query('RatePrices');
    ratePricesQuery.include(['service', 'service.originPOI', 'service.destinationPOI', 'rate', 'vehicleType']);
    ratePricesQuery.limit(2000); // Get all records
    
    const allRatePrices = await ratePricesQuery.find({ useMasterKey: true });
    
    const leonRatePrices = allRatePrices.filter(rp => {
      const service = rp.get('service');
      if (!service) return false;
      const destPoi = service.get('destinationPOI');
      const originPoi = service.get('originPOI');
      return (
        (destPoi?.get('name') || '').includes('Leon') ||
        (destPoi?.get('name') || '').includes('León') ||
        (originPoi?.get('name') || '').includes('Leon') ||
        (originPoi?.get('name') || '').includes('León')
      );
    });

    console.log(`Found ${leonRatePrices.length} RatePrices records for León routes:`);
    
    // Group by Premium SEDAN specifically
    const premiumSedanLeonPrices = leonRatePrices.filter(rp => {
      const rate = rp.get('rate');
      const vehicle = rp.get('vehicleType');
      return rate?.get('name') === 'Premium' && vehicle?.get('name') === 'SEDAN';
    });
    
    console.log(`\n🎯 Premium SEDAN León RatePrices (${premiumSedanLeonPrices.length} records):`);
    premiumSedanLeonPrices.forEach(rp => {
      const service = rp.get('service');
      const price = rp.get('price');
      
      const origin = service?.get('originPOI')?.get('name') || 'Unknown';
      const destination = service?.get('destinationPOI')?.get('name') || 'Unknown';
      
      console.log(`  💰 RatePrices ID: ${rp.id}`);
      console.log(`      Route: ${origin} → ${destination}`);
      console.log(`      Price: ${price} MXN`);
      console.log(`      Service ID: ${service?.id}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run the debug script
debugLeonAirportPricing();