/**
 * Populate RatePrices table with Green Class rate for MODEL 3 and MODEL Y vehicle types
 * 
 * Creates 2 RatePrices entries for each service in Services table with Green Class rate:
 * - Model 3 with Green Class rate
 * - Model Y with Green Class rate
 * 
 * This script focuses on database structure only, no UI/UX changes.
 */

const Parse = require('parse/node');

// Parse Server configuration
Parse.initialize('CrTRTaJpoJFNt8PJ', null, 'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP');
Parse.serverURL = 'http://localhost:1337/parse';

async function populateGreenClassRatePrices() {
  try {
    console.log('🚀 Starting Green Class RatePrices population...');
    
    // Step 1: Get Green Class rate
    console.log('📋 Loading Green Class rate...');
    const rateQuery = new Parse.Query('Rate');
    rateQuery.equalTo('name', 'Green Class');
    rateQuery.equalTo('exists', true);
    const greenClassRate = await rateQuery.first({ useMasterKey: true });
    
    if (!greenClassRate) {
      throw new Error('Green Class rate not found');
    }
    console.log(`✅ Green Class rate found: ${greenClassRate.id}`);

    // Step 2: Get vehicle types (MODEL 3 and MODEL Y)
    console.log('🚗 Loading Tesla vehicle types...');
    const vehicleTypeQuery = new Parse.Query('VehicleType');
    vehicleTypeQuery.equalTo('exists', true);
    vehicleTypeQuery.containedIn('code', ['MODEL 3', 'MODEL Y']);
    const vehicleTypes = await vehicleTypeQuery.find({ useMasterKey: true });
    
    if (vehicleTypes.length !== 2) {
      throw new Error(`Expected 2 vehicle types (MODEL 3, MODEL Y), found ${vehicleTypes.length}`);
    }
    
    const vehicleTypeMap = {};
    vehicleTypes.forEach(vt => {
      vehicleTypeMap[vt.get('code')] = vt;
    });
    console.log(`✅ Vehicle types loaded: ${Object.keys(vehicleTypeMap).join(', ')}`);

    // Step 3: Get all services to determine unique routes for Green Class
    console.log('📦 Loading services for Green Class rate...');
    const servicesQuery = new Parse.Query('Services');
    servicesQuery.equalTo('exists', true);
    servicesQuery.equalTo('active', true);
    servicesQuery.include(['originPOI', 'destinationPOI', 'rate']);
    servicesQuery.limit(1000);
    const services = await servicesQuery.find({ useMasterKey: true });
    
    console.log(`✅ Found ${services.length} services in Services table`);
    
    // Filter services that should have Green Class rate
    // We'll use all services since we want to create Green Class pricing for all routes
    const validServices = services.filter(service => {
      const destinationPOI = service.get('destinationPOI');
      return destinationPOI; // Services with destination POI are valid
    });
    
    console.log(`✅ Found ${validServices.length} valid services for Green Class rate`);

    // Step 4: Create RatePrices entries
    console.log('💰 Creating Green Class RatePrices entries...');
    let created = 0;
    let skipped = 0;
    const batchSize = 100;
    let ratePricesToSave = [];

    for (const service of validServices) {
      const originPOI = service.get('originPOI');
      const destinationPOI = service.get('destinationPOI');

      for (const vehicleCode of ['MODEL 3', 'MODEL Y']) {
        try {
          // Check if RatePrice already exists
          const existingQuery = new Parse.Query('RatePrices');
          if (originPOI) {
            existingQuery.equalTo('originPOI', originPOI);
          } else {
            existingQuery.doesNotExist('originPOI');
          }
          existingQuery.equalTo('destinationPOI', destinationPOI);
          existingQuery.equalTo('rate', greenClassRate);
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
          ratePrice.set('rate', greenClassRate);
          ratePrice.set('vehicleType', vehicleTypeMap[vehicleCode]);
          ratePrice.set('service', service); // Reference to the original service
          
          // Set default price based on vehicle type (will be updated later with correct prices)
          let defaultPrice = 200;
          switch (vehicleCode) {
            case 'MODEL 3':
              defaultPrice = 200;
              break;
            case 'MODEL Y':
              defaultPrice = 250;
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
            console.log(`💾 Batch saved: ${created} Green Class RatePrices created so far...`);
            ratePricesToSave = [];
          }

        } catch (error) {
          console.error(`❌ Error creating Green Class RatePrice for service ${service.id} with vehicle ${vehicleCode}:`, error.message);
        }
      }
    }

    // Save remaining RatePrices
    if (ratePricesToSave.length > 0) {
      await Parse.Object.saveAll(ratePricesToSave, { useMasterKey: true });
      created += ratePricesToSave.length;
      console.log(`💾 Final batch saved: ${ratePricesToSave.length} Green Class RatePrices`);
    }

    console.log('\\n📊 Green Class RatePrices population completed:');
    console.log(`   ✅ Created: ${created}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   📦 Total services processed: ${validServices.length}`);
    console.log(`   🚗 Vehicle types per service: 2 (Model 3, Model Y)`);
    console.log(`   💰 Rate used: Green Class`);
    console.log(`   🎯 Expected total: ${validServices.length * 2} records`);
    
  } catch (error) {
    console.error('❌ Error populating Green Class RatePrices:', error.message);
    throw error;
  }
}

// Run the population
populateGreenClassRatePrices().then(() => {
  console.log('✅ Green Class RatePrices population completed successfully');
  process.exit(0);
}).catch(error => {
  console.error('💥 Population failed:', error);
  process.exit(1);
});