/**
 * Update TourPrices with actual prices from Tours table
 * 
 * This script matches TourPrices entries with Tours table entries based on:
 * - vehicleType
 * - ratePtr (rate)
 * - tourPtr.destinationPOI (destination POI)
 * 
 * Updates the placeholder prices in TourPrices with actual prices from Tours.
 */

const Parse = require('parse/node');

// Initialize Parse
Parse.initialize('amexing-app-id', null, 'amexing-master-key');
Parse.serverURL = 'http://localhost:1337/parse';

async function updateTourPrices() {
  const stats = {
    total: 0,
    updated: 0,
    noMatch: 0,
    errors: 0
  };

  try {
    console.log('🔄 Starting TourPrices update from Tours table...\n');

    // ==========================================
    // STEP 1: GET ALL TOUR PRICES TO UPDATE
    // ==========================================
    console.log('📋 Loading TourPrices entries...');
    
    const TourPricesClass = Parse.Object.extend('TourPrices');
    const tourPricesQuery = new Parse.Query(TourPricesClass);
    tourPricesQuery.equalTo('exists', true);
    tourPricesQuery.include(['ratePtr', 'tourPtr', 'vehicleType', 'tourPtr.destinationPOI']);
    tourPricesQuery.limit(1000);
    
    const tourPrices = await tourPricesQuery.find({ useMasterKey: true });
    console.log(`✅ Found ${tourPrices.length} TourPrices entries to process\n`);

    // ==========================================
    // STEP 2: GET ALL TOURS WITH PRICING DATA
    // ==========================================
    console.log('💰 Loading Tours table with pricing data...');
    
    const ToursClass = Parse.Object.extend('Tours');
    const toursQuery = new Parse.Query(ToursClass);
    toursQuery.equalTo('exists', true);
    toursQuery.include(['destinationPOI', 'vehicleType', 'rate']);
    toursQuery.limit(1000);
    
    const tours = await toursQuery.find({ useMasterKey: true });
    console.log(`✅ Found ${tours.length} Tours entries with pricing data\n`);

    // ==========================================
    // STEP 3: CREATE LOOKUP MAP
    // ==========================================
    console.log('🗂️  Creating price lookup map...');
    
    const priceMap = new Map();
    
    tours.forEach(tour => {
      const destinationPOI = tour.get('destinationPOI');
      const vehicleType = tour.get('vehicleType');
      const rate = tour.get('rate');
      const price = tour.get('price');
      
      if (destinationPOI && vehicleType && rate && price) {
        const key = `${destinationPOI.id}-${vehicleType.id}-${rate.id}`;
        priceMap.set(key, price);
      }
    });
    
    console.log(`✅ Created lookup map with ${priceMap.size} pricing entries\n`);

    // ==========================================
    // STEP 4: UPDATE TOUR PRICES
    // ==========================================
    console.log('🔧 Updating TourPrices with actual prices...');
    
    for (const tourPrice of tourPrices) {
      stats.total++;
      
      try {
        const tour = tourPrice.get('tourPtr');
        const vehicleType = tourPrice.get('vehicleType');
        const rate = tourPrice.get('ratePtr');
        
        if (!tour || !vehicleType || !rate) {
          console.log(`⚠️  Skipping incomplete TourPrice entry ${tourPrice.id}`);
          stats.errors++;
          continue;
        }
        
        const destinationPOI = tour.get('destinationPOI');
        if (!destinationPOI) {
          console.log(`⚠️  Skipping TourPrice ${tourPrice.id} - no destination POI`);
          stats.errors++;
          continue;
        }
        
        // Create lookup key
        const lookupKey = `${destinationPOI.id}-${vehicleType.id}-${rate.id}`;
        const actualPrice = priceMap.get(lookupKey);
        
        if (actualPrice) {
          const oldPrice = tourPrice.get('price');
          
          // Update the price
          tourPrice.set('price', actualPrice);
          await tourPrice.save(null, { useMasterKey: true });
          
          const destinationName = destinationPOI.get('name');
          const vehicleName = vehicleType.get('name');
          const rateName = rate.get('name');
          
          console.log(`✅ Updated: ${destinationName} | ${vehicleName} | ${rateName} | ${oldPrice} → ${actualPrice} MXN`);
          stats.updated++;
          
        } else {
          const destinationName = destinationPOI.get('name');
          const vehicleName = vehicleType.get('name');
          const rateName = rate.get('name');
          
          console.log(`❌ No match: ${destinationName} | ${vehicleName} | ${rateName}`);
          stats.noMatch++;
        }
        
        // Progress indicator
        if (stats.total % 10 === 0) {
          console.log(`   Progress: ${stats.total}/${tourPrices.length} processed`);
        }
        
      } catch (error) {
        console.error(`❌ Error updating TourPrice ${tourPrice.id}:`, error.message);
        stats.errors++;
      }
    }

    // ==========================================
    // STEP 5: SUMMARY
    // ==========================================
    console.log('\n📊 Update Summary:');
    console.log(`   Total processed: ${stats.total}`);
    console.log(`   Successfully updated: ${stats.updated}`);
    console.log(`   No matching price found: ${stats.noMatch}`);
    console.log(`   Errors: ${stats.errors}`);
    
    if (stats.updated > 0) {
      console.log('\n🎉 TourPrices successfully updated with actual pricing data!');
    } else {
      console.log('\n⚠️  No prices were updated. Check data alignment.');
    }

  } catch (error) {
    console.error('\n❌ Script failed:', error.message);
  }

  process.exit(0);
}

// Run the update
updateTourPrices();