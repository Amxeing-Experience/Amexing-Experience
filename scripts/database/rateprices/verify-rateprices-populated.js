/**
 * Verify RatePrices table population
 */

const Parse = require('parse/node');

// Parse Server configuration
Parse.initialize('CrTRTaJpoJFNt8PJ', null, 'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP');
Parse.serverURL = 'http://localhost:1337/parse';

async function verifyRatePrices() {
  try {
    console.log('🔍 Verifying RatePrices population...');
    
    // Query all RatePrices records
    const query = new Parse.Query('RatePrices');
    query.include(['rate', 'vehicleType', 'originPOI', 'destinationPOI', 'service']);
    query.limit(1000);
    
    const results = await query.find({ useMasterKey: true });
    
    console.log(`📊 Total RatePrices records found: ${results.length}`);
    
    if (results.length === 0) {
      console.log('❌ No RatePrices records found');
      return;
    }

    // Analyze the data
    const rateStats = {};
    const vehicleStats = {};
    const priceStats = {};
    
    results.forEach(record => {
      const rate = record.get('rate');
      const vehicleType = record.get('vehicleType');
      const price = record.get('price');
      const active = record.get('active');
      const exists = record.get('exists');
      
      // Rate statistics
      const rateName = rate ? rate.get('name') : 'Unknown';
      rateStats[rateName] = (rateStats[rateName] || 0) + 1;
      
      // Vehicle type statistics
      const vehicleName = vehicleType ? vehicleType.get('code') : 'Unknown';
      vehicleStats[vehicleName] = (vehicleStats[vehicleName] || 0) + 1;
      
      // Price statistics
      const priceValue = price || 0;
      if (!priceStats[vehicleName]) {
        priceStats[vehicleName] = [];
      }
      priceStats[vehicleName].push(priceValue);
    });

    console.log('\n📋 Analysis Results:');
    console.log('\n🎯 Rate Distribution:');
    Object.entries(rateStats).forEach(([rate, count]) => {
      console.log(`   ${rate}: ${count} records`);
    });
    
    console.log('\n🚗 Vehicle Type Distribution:');
    Object.entries(vehicleStats).forEach(([vehicle, count]) => {
      console.log(`   ${vehicle}: ${count} records`);
    });
    
    console.log('\n💰 Price Analysis:');
    Object.entries(priceStats).forEach(([vehicle, prices]) => {
      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      console.log(`   ${vehicle}: Average $${avgPrice.toFixed(2)}, Range $${minPrice}-$${maxPrice}`);
    });
    
    console.log('\n📦 Sample Records (first 5):');
    results.slice(0, 5).forEach((record, index) => {
      const rate = record.get('rate');
      const vehicleType = record.get('vehicleType');
      const originPOI = record.get('originPOI');
      const destinationPOI = record.get('destinationPOI');
      const price = record.get('price');
      
      console.log(`   ${index + 1}. ${vehicleType?.get('code')} | ${rate?.get('name')} | $${price}`);
      console.log(`      Route: ${originPOI?.get('name') || 'No Origin'} → ${destinationPOI?.get('name')}`);
    });
    
    // Verify expected totals
    const expectedTotal = 69 * 3; // 69 services × 3 vehicle types
    console.log(`\n✅ Verification Complete:`);
    console.log(`   Expected: ${expectedTotal} records (69 services × 3 vehicle types)`);
    console.log(`   Found: ${results.length} records`);
    console.log(`   Status: ${results.length === expectedTotal ? '✅ CORRECT' : '⚠️  MISMATCH'}`);
    
  } catch (error) {
    console.error('❌ Error verifying RatePrices:', error.message);
  }
}

// Run verification
verifyRatePrices().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Verification failed:', error);
  process.exit(1);
});