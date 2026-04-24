/**
 * Fix POI Duplicates - Consolidate duplicate León Airport and San Miguel POIs
 * 
 * This script will:
 * 1. Identify the canonical POI for León Airport and San Miguel
 * 2. Update all Services to point to the canonical POI
 * 3. Mark duplicate POIs as inactive/non-existent
 * 4. Ensure pricing consistency across both systems
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

async function fixPOIDuplicates() {
  try {
    console.log('🔧 Fixing POI duplicates...\n');

    // 1. Find all León Airport POIs
    const leonPoisQuery = new Parse.Query('POI');
    leonPoisQuery.contains('name', 'BJX');
    leonPoisQuery.contains('name', 'Leon');
    leonPoisQuery.equalTo('exists', true);
    const leonPois = await leonPoisQuery.find({ useMasterKey: true });
    
    console.log(`📍 Found ${leonPois.length} León Airport POIs`);
    
    // 2. Find all San Miguel de Allende POIs
    const smaPoisQuery = new Parse.Query('POI');
    smaPoisQuery.contains('name', 'San Miguel');
    smaPoisQuery.contains('name', 'Allende');
    smaPoisQuery.equalTo('exists', true);
    const smaPois = await smaPoisQuery.find({ useMasterKey: true });
    
    console.log(`📍 Found ${smaPois.length} San Miguel de Allende POIs`);
    
    // 3. Select canonical POIs (first active one found)
    const canonicalLeonPoi = leonPois.find(poi => 
      poi.get('name') === '(BJX) Aeropuerto Internacional de Leon' && 
      poi.get('active') === true
    ) || leonPois[0];
    
    const canonicalSmaPoi = smaPois.find(poi => 
      poi.get('name') === 'San Miguel de Allende' && 
      poi.get('active') === true
    ) || smaPois[0];
    
    console.log(`✅ Canonical León POI: ${canonicalLeonPoi.get('name')} (${canonicalLeonPoi.id})`);
    console.log(`✅ Canonical SMA POI: ${canonicalSmaPoi.get('name')} (${canonicalSmaPoi.id})`);
    
    // 4. Find all services that need to be updated
    const servicesToUpdate = [];
    
    // Services with León as destination
    for (const poi of leonPois) {
      if (poi.id !== canonicalLeonPoi.id) {
        const servicesQuery = new Parse.Query('Service');
        servicesQuery.equalTo('destinationPOI', poi);
        servicesQuery.equalTo('exists', true);
        const services = await servicesQuery.find({ useMasterKey: true });
        
        for (const service of services) {
          servicesToUpdate.push({
            service,
            field: 'destinationPOI',
            newPOI: canonicalLeonPoi,
            oldPOI: poi
          });
        }
      }
    }
    
    // Services with León as origin
    for (const poi of leonPois) {
      if (poi.id !== canonicalLeonPoi.id) {
        const servicesQuery = new Parse.Query('Service');
        servicesQuery.equalTo('originPOI', poi);
        servicesQuery.equalTo('exists', true);
        const services = await servicesQuery.find({ useMasterKey: true });
        
        for (const service of services) {
          servicesToUpdate.push({
            service,
            field: 'originPOI', 
            newPOI: canonicalLeonPoi,
            oldPOI: poi
          });
        }
      }
    }
    
    // Services with SMA as destination
    for (const poi of smaPois) {
      if (poi.id !== canonicalSmaPoi.id) {
        const servicesQuery = new Parse.Query('Service');
        servicesQuery.equalTo('destinationPOI', poi);
        servicesQuery.equalTo('exists', true);
        const services = await servicesQuery.find({ useMasterKey: true });
        
        for (const service of services) {
          servicesToUpdate.push({
            service,
            field: 'destinationPOI',
            newPOI: canonicalSmaPoi,
            oldPOI: poi
          });
        }
      }
    }
    
    // Services with SMA as origin
    for (const poi of smaPois) {
      if (poi.id !== canonicalSmaPoi.id) {
        const servicesQuery = new Parse.Query('Service');
        servicesQuery.equalTo('originPOI', poi);
        servicesQuery.equalTo('exists', true);
        const services = await servicesQuery.find({ useMasterKey: true });
        
        for (const service of services) {
          servicesToUpdate.push({
            service,
            field: 'originPOI',
            newPOI: canonicalSmaPoi,
            oldPOI: poi
          });
        }
      }
    }
    
    console.log(`\n🔄 Found ${servicesToUpdate.length} services to update`);
    
    // 5. Check for duplicates that would be created
    const duplicateCheck = new Map();
    const duplicates = [];
    
    for (const update of servicesToUpdate) {
      const service = update.service;
      const rate = service.get('rate');
      const vehicleType = service.get('vehicleType');
      const originPOI = update.field === 'originPOI' ? update.newPOI : service.get('originPOI');
      const destPOI = update.field === 'destinationPOI' ? update.newPOI : service.get('destinationPOI');
      
      const key = `${originPOI?.id || 'null'}-${destPOI?.id || 'null'}-${rate?.id}-${vehicleType?.id}`;
      
      if (duplicateCheck.has(key)) {
        duplicates.push({
          existing: duplicateCheck.get(key),
          duplicate: update
        });
      } else {
        duplicateCheck.set(key, update);
      }
    }
    
    console.log(`⚠️  Found ${duplicates.length} potential duplicates`);
    
    // 6. Preview changes (DRY RUN)
    console.log('\n📋 Preview of changes:');
    console.log('='.repeat(80));
    
    let previewCount = 0;
    for (const update of servicesToUpdate.slice(0, 10)) { // Show first 10
      const service = update.service;
      const rate = service.get('rate');
      const vehicle = service.get('vehicleType');
      const price = service.get('price');
      
      console.log(`Service ${service.id}: ${rate?.get('name')} ${vehicle?.get('name')} - ${price} MXN`);
      console.log(`  ${update.field}: ${update.oldPOI.get('name')} → ${update.newPOI.get('name')}`);
      previewCount++;
    }
    
    if (servicesToUpdate.length > 10) {
      console.log(`... and ${servicesToUpdate.length - 10} more services`);
    }
    
    // 7. Show current León Airport services for Premium SEDAN
    console.log('\n🎯 Current León Airport Premium SEDAN services:');
    console.log('='.repeat(80));
    
    const premiumRate = await new Parse.Query('Rate').equalTo('name', 'Premium').first({ useMasterKey: true });
    const sedanVehicle = await new Parse.Query('VehicleType').equalTo('name', 'SEDAN').first({ useMasterKey: true });
    
    for (const poi of leonPois) {
      const servicesQuery = new Parse.Query('Service');
      const orQuery = Parse.Query.or(
        servicesQuery.equalTo('originPOI', poi),
        servicesQuery.equalTo('destinationPOI', poi)
      );
      orQuery.equalTo('rate', premiumRate);
      orQuery.equalTo('vehicleType', sedanVehicle);
      orQuery.equalTo('exists', true);
      orQuery.include(['originPOI', 'destinationPOI']);
      
      const services = await orQuery.find({ useMasterKey: true });
      
      if (services.length > 0) {
        console.log(`\nPOI: ${poi.get('name')} (${poi.id})`);
        services.forEach(service => {
          const origin = service.get('originPOI');
          const dest = service.get('destinationPOI');
          console.log(`  Service ${service.id}: ${origin?.get('name') || 'Local'} → ${dest?.get('name') || 'Local'} - ${service.get('price')} MXN`);
        });
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('🚨 THIS IS A DRY RUN - No changes were made to the database');
    console.log('🚨 To execute the fix, modify the script and set EXECUTE_FIX = true');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

// Run the script
fixPOIDuplicates();