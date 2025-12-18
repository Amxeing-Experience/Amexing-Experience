/**
 * Update RatePrices table with correct prices from Service table
 * 
 * Matches records based on:
 * - rate (Premium)
 * - vehicleType (SEDAN, SUBURBAN, SPRINTER)  
 * - destinationPOI
 * - originPOI (optional)
 * 
 * Updates the price field in RatePrices with the correct price from Service table.
 */

const Parse = require('parse/node');

// Parse Server configuration
Parse.initialize('CrTRTaJpoJFNt8PJ', null, 'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP');
Parse.serverURL = 'http://localhost:1337/parse';

async function updateRatePricesFromServices() {
  try {
    console.log('🚀 Starting RatePrices price update from Service table...');
    
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

    // Step 2: Get all RatePrices records that need updating
    console.log('📦 Loading RatePrices records...');
    const ratePricesQuery = new Parse.Query('RatePrices');
    ratePricesQuery.equalTo('rate', premiumRate);
    ratePricesQuery.equalTo('exists', true);
    ratePricesQuery.include(['vehicleType', 'destinationPOI', 'originPOI']);
    ratePricesQuery.limit(1000);
    
    const ratePricesRecords = await ratePricesQuery.find({ useMasterKey: true });
    console.log(`✅ Found ${ratePricesRecords.length} RatePrices records to update`);

    // Step 3: Get all Premium Service records for price lookup
    console.log('💰 Loading Premium Service records for price matching...');
    const serviceQuery = new Parse.Query('Service');
    serviceQuery.equalTo('rate', premiumRate);
    serviceQuery.equalTo('exists', true);
    serviceQuery.include(['vehicleType', 'destinationPOI', 'originPOI']);
    serviceQuery.limit(1000);
    
    const serviceRecords = await serviceQuery.find({ useMasterKey: true });
    console.log(`✅ Found ${serviceRecords.length} Service records with Premium rate`);

    // Step 4: Create lookup map for faster matching
    console.log('🔍 Creating Service price lookup map...');
    const servicePriceMap = new Map();
    
    serviceRecords.forEach(service => {
      const vehicleType = service.get('vehicleType');
      const destinationPOI = service.get('destinationPOI');
      const originPOI = service.get('originPOI');
      const price = service.get('price');
      
      if (vehicleType && destinationPOI && price) {
        const vehicleCode = vehicleType.get('code');
        const destinationId = destinationPOI.id;
        const originId = originPOI ? originPOI.id : 'NULL';
        
        // Create unique key for matching
        const lookupKey = `${originId}-${destinationId}-${vehicleCode}`;
        servicePriceMap.set(lookupKey, price);
      }
    });
    
    console.log(`✅ Created lookup map with ${servicePriceMap.size} price entries`);

    // Step 5: Update RatePrices records
    console.log('🔄 Updating RatePrices records with correct prices...');
    let updated = 0;
    let notFound = 0;
    let ratePricesToUpdate = [];
    const batchSize = 100;

    for (const ratePrice of ratePricesRecords) {
      try {
        const vehicleType = ratePrice.get('vehicleType');
        const destinationPOI = ratePrice.get('destinationPOI');
        const originPOI = ratePrice.get('originPOI');
        
        if (vehicleType && destinationPOI) {
          const vehicleCode = vehicleType.get('code');
          const destinationId = destinationPOI.id;
          const originId = originPOI ? originPOI.id : 'NULL';
          
          // Create lookup key
          const lookupKey = `${originId}-${destinationId}-${vehicleCode}`;
          
          // Find matching price in Service table
          const correctPrice = servicePriceMap.get(lookupKey);
          
          if (correctPrice !== undefined) {
            // Update price if different
            const currentPrice = ratePrice.get('price');
            if (currentPrice !== correctPrice) {
              ratePrice.set('price', correctPrice);
              ratePricesToUpdate.push(ratePrice);
              updated++;
            }
          } else {
            console.warn(`⚠️  No matching Service found for: ${vehicleCode} to ${destinationPOI.get('name')} from ${originPOI ? originPOI.get('name') : 'NULL'}`);
            notFound++;
          }
        }

        // Save in batches
        if (ratePricesToUpdate.length >= batchSize) {
          await Parse.Object.saveAll(ratePricesToUpdate, { useMasterKey: true });
          console.log(`💾 Batch saved: ${ratePricesToUpdate.length} RatePrices updated...`);
          ratePricesToUpdate = [];
        }

      } catch (error) {
        console.error(`❌ Error updating RatePrice ${ratePrice.id}:`, error.message);
      }
    }

    // Save remaining RatePrices
    if (ratePricesToUpdate.length > 0) {
      await Parse.Object.saveAll(ratePricesToUpdate, { useMasterKey: true });
      console.log(`💾 Final batch saved: ${ratePricesToUpdate.length} RatePrices`);
    }

    console.log('\n📊 RatePrices price update completed:');
    console.log(`   ✅ Updated: ${updated}`);
    console.log(`   ⚠️  Not found in Service table: ${notFound}`);
    console.log(`   📦 Total RatePrices processed: ${ratePricesRecords.length}`);
    console.log(`   🔍 Service records available: ${serviceRecords.length}`);
    
  } catch (error) {
    console.error('❌ Error updating RatePrices:', error.message);
    throw error;
  }
}

// Run the update
updateRatePricesFromServices().then(() => {
  console.log('✅ RatePrices price update completed successfully');
  process.exit(0);
}).catch(error => {
  console.error('💥 Update failed:', error);
  process.exit(1);
});