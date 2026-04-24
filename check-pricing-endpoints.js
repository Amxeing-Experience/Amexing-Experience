/**
 * Check what prices are actually returned by both systems
 * This will help us understand which Services each system is selecting
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

async function checkPricingEndpoints() {
  try {
    console.log('🔍 Checking pricing inconsistencies...\n');

    // Get Premium rate and SEDAN vehicle
    const premiumRate = await new Parse.Query('Rate').equalTo('name', 'Premium').first({ useMasterKey: true });
    const sedanVehicle = await new Parse.Query('VehicleType').equalTo('name', 'SEDAN').first({ useMasterKey: true });
    
    console.log(`Premium Rate: ${premiumRate.get('name')} (${premiumRate.id})`);
    console.log(`SEDAN Vehicle: ${sedanVehicle.get('name')} (${sedanVehicle.id})`);
    
    // Find all León Airport POIs
    const leonQuery = new Parse.Query('POI');
    leonQuery.contains('name', 'BJX');
    leonQuery.contains('name', 'Leon');
    leonQuery.equalTo('exists', true);
    const leonPois = await leonQuery.find({ useMasterKey: true });
    
    console.log(`\n📍 Found ${leonPois.length} León Airport POIs`);
    
    // Find all San Miguel POIs
    const smaQuery = new Parse.Query('POI');
    smaQuery.contains('name', 'San Miguel');
    smaQuery.contains('name', 'Allende');
    smaQuery.equalTo('exists', true); 
    const smaPois = await smaQuery.find({ useMasterKey: true });
    
    console.log(`📍 Found ${smaPois.length} San Miguel de Allende POIs`);
    
    // Find all Premium SEDAN services between any SMA and León combination
    const allServices = [];
    
    for (const smaPoi of smaPois) {
      for (const leonPoi of leonPois) {
        // SMA to León
        const smaToLeonQuery = new Parse.Query('Service');
        smaToLeonQuery.equalTo('originPOI', smaPoi);
        smaToLeonQuery.equalTo('destinationPOI', leonPoi);
        smaToLeonQuery.equalTo('rate', premiumRate);
        smaToLeonQuery.equalTo('vehicleType', sedanVehicle);
        smaToLeonQuery.equalTo('exists', true);
        smaToLeonQuery.include(['originPOI', 'destinationPOI', 'rate', 'vehicleType']);
        
        const services1 = await smaToLeonQuery.find({ useMasterKey: true });
        allServices.push(...services1.map(s => ({ service: s, direction: 'SMA → León' })));
        
        // León to SMA
        const leonToSmaQuery = new Parse.Query('Service');
        leonToSmaQuery.equalTo('originPOI', leonPoi);
        leonToSmaQuery.equalTo('destinationPOI', smaPoi);
        leonToSmaQuery.equalTo('rate', premiumRate);
        leonToSmaQuery.equalTo('vehicleType', sedanVehicle);
        leonToSmaQuery.equalTo('exists', true);
        leonToSmaQuery.include(['originPOI', 'destinationPOI', 'rate', 'vehicleType']);
        
        const services2 = await leonToSmaQuery.find({ useMasterKey: true });
        allServices.push(...services2.map(s => ({ service: s, direction: 'León → SMA' })));
      }
    }
    
    console.log(`\n🎯 Found ${allServices.length} Premium SEDAN services for SMA ↔ León routes:`);
    console.log('='.repeat(100));
    
    const priceGroups = {};
    
    allServices.forEach(({ service, direction }, index) => {
      const price = service.get('price');
      const origin = service.get('originPOI');
      const dest = service.get('destinationPOI');
      
      if (!priceGroups[price]) {
        priceGroups[price] = [];
      }
      
      priceGroups[price].push({
        serviceId: service.id,
        direction,
        originId: origin?.id,
        originName: origin?.get('name'),
        destId: dest?.id,
        destName: dest?.get('name'),
        price: price,
        active: service.get('active'),
        exists: service.get('exists')
      });
      
      console.log(`${index + 1}. Service ${service.id} (${direction})`);
      console.log(`   Origin: ${origin?.get('name')} (${origin?.id})`);
      console.log(`   Dest:   ${dest?.get('name')} (${dest?.id})`);
      console.log(`   Price:  ${price} MXN`);
      console.log(`   Active: ${service.get('active')}, Exists: ${service.get('exists')}`);
      console.log('');
    });
    
    console.log('\n📊 Price Summary:');
    console.log('='.repeat(50));
    
    Object.keys(priceGroups).sort((a, b) => parseFloat(a) - parseFloat(b)).forEach(price => {
      const services = priceGroups[price];
      console.log(`💰 Price ${price} MXN: ${services.length} services`);
      
      // Show unique POI combinations for this price
      const combinations = new Set();
      services.forEach(s => {
        combinations.add(`${s.originName} → ${s.destName}`);
      });
      
      combinations.forEach(combo => {
        console.log(`   ${combo}`);
      });
      console.log('');
    });
    
    // Calculate expected prices with surcharge
    console.log('\n🧮 Expected Prices with 21.09% Surcharge:');
    console.log('='.repeat(60));
    
    Object.keys(priceGroups).sort((a, b) => parseFloat(a) - parseFloat(b)).forEach(basePrice => {
      const base = parseFloat(basePrice);
      const withSurcharge = base * 1.2109;
      console.log(`Base: ${base} MXN → With Surcharge: ${withSurcharge.toFixed(2)} MXN`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

checkPricingEndpoints();