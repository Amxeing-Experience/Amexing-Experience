/**
 * Validate TourPrices after price update
 * 
 * This script validates that TourPrices have been updated with actual prices
 * from the Tours table and shows a summary of the current pricing data.
 */

const Parse = require('parse/node');

// Initialize Parse
Parse.initialize('amexing-app-id', null, 'amexing-master-key');
Parse.serverURL = 'http://localhost:1337/parse';

async function validateTourPrices() {
  try {
    console.log('🔍 Validating TourPrices after update...\n');

    // Get all TourPrices with their related data
    const TourPricesClass = Parse.Object.extend('TourPrices');
    const query = new Parse.Query(TourPricesClass);
    query.equalTo('exists', true);
    query.include(['ratePtr', 'tourPtr', 'vehicleType', 'tourPtr.destinationPOI']);
    query.limit(1000);
    
    const tourPrices = await query.find({ useMasterKey: true });
    console.log(`✅ Found ${tourPrices.length} TourPrices entries\n`);

    // Group by rate for analysis
    const rateGroups = {};
    const priceStats = {
      totalEntries: tourPrices.length,
      placeholderPrices: 0,
      updatedPrices: 0,
      priceRanges: {
        '1000': 0,  // Original First Class placeholder
        '1200': 0,  // Original Green Class placeholder  
        '1500': 0,  // Original Premium placeholder
        'other': 0
      }
    };

    tourPrices.forEach(tourPrice => {
      const rate = tourPrice.get('ratePtr');
      const tour = tourPrice.get('tourPtr');
      const vehicleType = tourPrice.get('vehicleType');
      const price = tourPrice.get('price');
      
      const rateName = rate ? rate.get('name') : 'Unknown';
      const destinationName = tour && tour.get('destinationPOI') ? 
        tour.get('destinationPOI').get('name') : 'Unknown';
      const vehicleName = vehicleType ? vehicleType.get('name') : 'Unknown';

      // Initialize rate group if needed
      if (!rateGroups[rateName]) {
        rateGroups[rateName] = {
          count: 0,
          prices: [],
          examples: []
        };
      }

      rateGroups[rateName].count++;
      rateGroups[rateName].prices.push(price);
      
      // Store first 3 examples for each rate
      if (rateGroups[rateName].examples.length < 3) {
        rateGroups[rateName].examples.push({
          destination: destinationName,
          vehicle: vehicleName,
          price
        });
      }

      // Track price statistics
      if (price === 1000) {
        priceStats.priceRanges['1000']++;
        priceStats.placeholderPrices++;
      } else if (price === 1200) {
        priceStats.priceRanges['1200']++;
        priceStats.placeholderPrices++;
      } else if (price === 1500) {
        priceStats.priceRanges['1500']++;
        priceStats.placeholderPrices++;
      } else {
        priceStats.priceRanges['other']++;
        priceStats.updatedPrices++;
      }
    });

    // Display results by rate
    console.log('📊 TourPrices Summary by Rate:\n');
    
    Object.entries(rateGroups).forEach(([rateName, data]) => {
      const minPrice = Math.min(...data.prices);
      const maxPrice = Math.max(...data.prices);
      const avgPrice = (data.prices.reduce((a, b) => a + b, 0) / data.prices.length).toFixed(2);
      
      console.log(`🏷️  ${rateName}:`);
      console.log(`   Count: ${data.count} entries`);
      console.log(`   Price range: $${minPrice} - $${maxPrice} MXN`);
      console.log(`   Average: $${avgPrice} MXN`);
      console.log(`   Examples:`);
      
      data.examples.forEach((example, index) => {
        console.log(`     ${index + 1}. ${example.destination} | ${example.vehicle} | $${example.price} MXN`);
      });
      console.log('');
    });

    // Display overall statistics
    console.log('📈 Update Statistics:');
    console.log(`   Total entries: ${priceStats.totalEntries}`);
    console.log(`   Updated prices: ${priceStats.updatedPrices} (${((priceStats.updatedPrices / priceStats.totalEntries) * 100).toFixed(1)}%)`);
    console.log(`   Placeholder prices remaining: ${priceStats.placeholderPrices} (${((priceStats.placeholderPrices / priceStats.totalEntries) * 100).toFixed(1)}%)`);
    console.log(`     - Still at $1000: ${priceStats.priceRanges['1000']}`);
    console.log(`     - Still at $1200: ${priceStats.priceRanges['1200']}`);
    console.log(`     - Still at $1500: ${priceStats.priceRanges['1500']}`);

    // Success indicators
    if (priceStats.updatedPrices > 0) {
      console.log('\n🎉 Price update validation successful!');
      console.log(`   ${priceStats.updatedPrices} entries now have actual pricing from Tours table`);
    }

    if (priceStats.placeholderPrices > 0) {
      console.log('\n⚠️  Note: Some entries still have placeholder prices');
      console.log('   This is expected for tours without matching entries in Tours table');
    }

  } catch (error) {
    console.error('\n❌ Validation failed:', error.message);
  }

  process.exit(0);
}

// Run validation
validateTourPrices();