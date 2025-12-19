/**
 * Populate RatePrices table with First Class rate for SEDAN and SUBURBAN vehicle types
 * 
 * Creates 2 RatePrices entries for each service in Services table with First Class rate:
 * - Sedan with First Class rate
 * - Suburban with First Class rate
 * 
 * This script focuses on database structure only, no UI/UX changes.
 */

const Parse = require('parse/node');

// Parse Server configuration
Parse.initialize('CrTRTaJpoJFNt8PJ', null, 'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP');
Parse.serverURL = 'http://localhost:1337/parse';

async function populateFirstClassRatePrices() {
  try {
    console.log('🚀 Starting First Class RatePrices population...');
    
    // Step 1: Get First Class rate
    console.log('📋 Loading First Class rate...');
    const rateQuery = new Parse.Query('Rate');
    rateQuery.equalTo('name', 'First Class');
    rateQuery.equalTo('exists', true);
    const firstClassRate = await rateQuery.first({ useMasterKey: true });
    
    if (!firstClassRate) {
      throw new Error('First Class rate not found');
    }
    console.log(`✅ First Class rate found: ${firstClassRate.id}`);

    // Step 2: Get vehicle types (SEDAN and SUBURBAN)
    console.log('🚗 Loading luxury vehicle types...');
    const vehicleTypeQuery = new Parse.Query('VehicleType');
    vehicleTypeQuery.equalTo('exists', true);
    vehicleTypeQuery.containedIn('code', ['SEDAN', 'SUBURBAN']);
    const vehicleTypes = await vehicleTypeQuery.find({ useMasterKey: true });
    
    if (vehicleTypes.length !== 2) {
      throw new Error(`Expected 2 vehicle types (SEDAN, SUBURBAN), found ${vehicleTypes.length}`);
    }
    
    const vehicleTypeMap = {};
    vehicleTypes.forEach(vt => {
      vehicleTypeMap[vt.get('code')] = vt;
    });
    console.log(`✅ Vehicle types loaded: ${Object.keys(vehicleTypeMap).join(', ')}`);

    // Step 3: Get all services to determine unique routes for First Class
    console.log('📦 Loading services for First Class rate...');
    const servicesQuery = new Parse.Query('Services');
    servicesQuery.equalTo('exists', true);
    servicesQuery.equalTo('active', true);
    servicesQuery.include(['originPOI', 'destinationPOI', 'rate']);
    servicesQuery.limit(1000);
    const services = await servicesQuery.find({ useMasterKey: true });
    
    console.log(`✅ Found ${services.length} services in Services table`);
    
    // Filter services that should have First Class rate
    // We'll use all services since we want to create First Class pricing for all routes
    const validServices = services.filter(service => {
      const destinationPOI = service.get('destinationPOI');
      return destinationPOI; // Services with destination POI are valid
    });
    
    console.log(`✅ Found ${validServices.length} valid services for First Class rate`);

    // Step 4: Create RatePrices entries
    console.log('💰 Creating First Class RatePrices entries...');
    let created = 0;
    let skipped = 0;
    const batchSize = 100;
    let ratePricesToSave = [];

    for (const service of validServices) {
      const originPOI = service.get('originPOI');
      const destinationPOI = service.get('destinationPOI');

      for (const vehicleCode of ['SEDAN', 'SUBURBAN']) {
        try {
          // Check if RatePrice already exists
          const existingQuery = new Parse.Query('RatePrices');
          if (originPOI) {
            existingQuery.equalTo('originPOI', originPOI);
          } else {
            existingQuery.doesNotExist('originPOI');
          }
          existingQuery.equalTo('destinationPOI', destinationPOI);
          existingQuery.equalTo('rate', firstClassRate);
          existingQuery.equalTo('vehicleType', vehicleTypeMap[vehicleCode]);
          existingQuery.equalTo('exists', true);

          const existing = await existingQuery.first({ useMasterKey: true });
          if (existing) {
            skipped++;
            continue;
          }

          // Create new RatePrice
          const RatePrices = Parse.Object.extend('RatePrices');
          const ratePrice = new RatePrices();

          // Set fields
          if (originPOI) {
            ratePrice.set('originPOI', originPOI);
          }
          ratePrice.set('destinationPOI', destinationPOI);
          ratePrice.set('rate', firstClassRate);
          ratePrice.set('vehicleType', vehicleTypeMap[vehicleCode]);
          ratePrice.set('service', service); // Reference to the original service
          
          // Set default price based on vehicle type (will be updated later with correct prices)
          let defaultPrice = 300;
          switch (vehicleCode) {
            case 'SEDAN':
              defaultPrice = 300;
              break;
            case 'SUBURBAN':
              defaultPrice = 400;
              break;
          }
          ratePrice.set('price', defaultPrice);
          
          ratePrice.set('active', true);
          ratePrice.set('exists', true);

          // Set ACL
          const acl = new Parse.ACL();
          acl.setPublicReadAccess(true);
          acl.setRoleWriteAccess('admin', true);
          acl.setRoleWriteAccess('superadmin', true);
          ratePrice.setACL(acl);

          ratePricesToSave.push(ratePrice);

          // Save in batches
          if (ratePricesToSave.length >= batchSize) {
            await Parse.Object.saveAll(ratePricesToSave, { useMasterKey: true });
            created += ratePricesToSave.length;
            console.log(`💾 Batch saved: ${created} First Class RatePrices created so far...`);
            ratePricesToSave = [];
          }

        } catch (error) {
          console.error(`❌ Error creating First Class RatePrice for service ${service.id} with vehicle ${vehicleCode}:`, error.message);
        }
      }
    }

    // Save remaining RatePrices
    if (ratePricesToSave.length > 0) {
      await Parse.Object.saveAll(ratePricesToSave, { useMasterKey: true });
      created += ratePricesToSave.length;
      console.log(`💾 Final batch saved: ${ratePricesToSave.length} First Class RatePrices`);
    }

    console.log('\\n📊 First Class RatePrices population completed:');
    console.log(`   ✅ Created: ${created}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   📦 Total services processed: ${validServices.length}`);
    console.log(`   🚗 Vehicle types per service: 2 (Sedan, Suburban)`);
    console.log(`   💰 Rate used: First Class`);
    console.log(`   🎯 Expected total: ${validServices.length * 2} records`);
    
  } catch (error) {
    console.error('❌ Error populating First Class RatePrices:', error.message);
    throw error;
  }
}

// Run the population
populateFirstClassRatePrices().then(() => {
  console.log('✅ First Class RatePrices population completed successfully');
  process.exit(0);
}).catch(error => {
  console.error('💥 Population failed:', error);
  process.exit(1);
});