/**
 * Populate RatePrices table from Services table
 * 
 * Creates 3 RatePrices entries for each service in Services table:
 * - Sedan with Premium rate
 * - Suburban with Premium rate  
 * - Sprinter with Premium rate
 * 
 * This script focuses on database structure only, no UI/UX changes.
 */

const Parse = require('parse/node');

// Parse Server configuration
Parse.initialize('CrTRTaJpoJFNt8PJ', null, 'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP');
Parse.serverURL = 'http://localhost:1337/parse';

async function populateRatePrices() {
  try {
    console.log('🚀 Starting RatePrices population...');
    
    // Step 1: Get Premium rate
    console.log('📋 Loading Premium rate...');
    const rateQuery = new Parse.Query('Rate');
    rateQuery.equalTo('name', 'Premium');
    rateQuery.equalTo('exists', true);
    const premiumRate = await rateQuery.first({ useMasterKey: true });
    
    if (!premiumRate) {
      throw new Error('Premium rate not found');
    }
    console.log(`✅ Premium rate found: ${premiumRate.id}`);

    // Step 2: Get vehicle types
    console.log('🚗 Loading vehicle types...');
    const vehicleTypeQuery = new Parse.Query('VehicleType');
    vehicleTypeQuery.equalTo('exists', true);
    vehicleTypeQuery.containedIn('code', ['SEDAN', 'SUBURBAN', 'SPRINTER']);
    const vehicleTypes = await vehicleTypeQuery.find({ useMasterKey: true });
    
    if (vehicleTypes.length !== 3) {
      throw new Error(`Expected 3 vehicle types (SEDAN, SUBURBAN, SPRINTER), found ${vehicleTypes.length}`);
    }
    
    const vehicleTypeMap = {};
    vehicleTypes.forEach(vt => {
      vehicleTypeMap[vt.get('code')] = vt;
    });
    console.log(`✅ Vehicle types loaded: ${Object.keys(vehicleTypeMap).join(', ')}`);

    // Step 3: Get all services
    console.log('📦 Loading services...');
    const servicesQuery = new Parse.Query('Services');
    servicesQuery.equalTo('exists', true);
    servicesQuery.equalTo('active', true);
    servicesQuery.include(['originPOI', 'destinationPOI', 'rate']);
    servicesQuery.limit(1000);
    const services = await servicesQuery.find({ useMasterKey: true });
    
    console.log(`✅ Found ${services.length} services`);
    
    if (services.length === 0) {
      throw new Error('No services found in Services table');
    }

    // Step 4: Create RatePrices entries
    console.log('💰 Creating RatePrices entries...');
    let created = 0;
    let skipped = 0;
    const batchSize = 100;
    let ratePricesToSave = [];

    for (const service of services) {
      const originPOI = service.get('originPOI');
      const destinationPOI = service.get('destinationPOI');
      const serviceRate = service.get('rate');

      for (const vehicleCode of ['SEDAN', 'SUBURBAN', 'SPRINTER']) {
        try {
          // Check if RatePrice already exists
          const existingQuery = new Parse.Query('RatePrices');
          if (originPOI) {
            existingQuery.equalTo('originPOI', originPOI);
          } else {
            existingQuery.doesNotExist('originPOI');
          }
          existingQuery.equalTo('destinationPOI', destinationPOI);
          existingQuery.equalTo('rate', premiumRate);
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
          ratePrice.set('rate', premiumRate);
          ratePrice.set('vehicleType', vehicleTypeMap[vehicleCode]);
          ratePrice.set('service', service); // Reference to the original service
          
          // Set default price based on vehicle type (you can adjust these)
          let defaultPrice = 100;
          switch (vehicleCode) {
            case 'SEDAN':
              defaultPrice = 150;
              break;
            case 'SUBURBAN':
              defaultPrice = 200;
              break;
            case 'SPRINTER':
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
            console.log(`💾 Batch saved: ${created} RatePrices created so far...`);
            ratePricesToSave = [];
          }

        } catch (error) {
          console.error(`❌ Error creating RatePrice for service ${service.id} with vehicle ${vehicleCode}:`, error.message);
        }
      }
    }

    // Save remaining RatePrices
    if (ratePricesToSave.length > 0) {
      await Parse.Object.saveAll(ratePricesToSave, { useMasterKey: true });
      created += ratePricesToSave.length;
      console.log(`💾 Final batch saved: ${ratePricesToSave.length} RatePrices`);
    }

    console.log('\n📊 RatePrices population completed:');
    console.log(`   ✅ Created: ${created}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   📦 Total services processed: ${services.length}`);
    console.log(`   🚗 Vehicle types per service: 3 (Sedan, Suburban, Sprinter)`);
    console.log(`   💰 Rate used: Premium`);
    
  } catch (error) {
    console.error('❌ Error populating RatePrices:', error.message);
    throw error;
  }
}

// Run the population
populateRatePrices().then(() => {
  console.log('✅ RatePrices population completed successfully');
  process.exit(0);
}).catch(error => {
  console.error('💥 Population failed:', error);
  process.exit(1);
});