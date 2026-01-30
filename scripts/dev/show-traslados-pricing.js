/**
 * Show Traslados Pricing by Rate
 * 
 * This script displays the different pricing for traslados across all rate tiers
 * to verify that you can see pricing differences in the development environment.
 * 
 * Created by Denisse Maldonado
 * 
 * @author Amexing Development Team
 * @version 1.0.0
 */

require('dotenv').config({ path: './environments/.env.development' });
const Parse = require('parse/node');

// Initialize Parse
Parse.initialize(
  process.env.PARSE_APP_ID,
  'javascript-key-dev-secure-2024',
  process.env.PARSE_MASTER_KEY
);
Parse.serverURL = process.env.PARSE_SERVER_URL;

/**
 * Format price to Mexican Peso
 */
function formatPrice(price) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN'
  }).format(price);
}

/**
 * Show pricing by rates
 */
async function showPricing() {
  try {
    console.log('📊 TRASLADOS PRICING BY RATE\n');
    console.log('   This shows the same routes with different pricing based on rate tiers.\n');
    
    // Get all rates
    const ratesQuery = new Parse.Query('Rate');
    ratesQuery.equalTo('exists', true);
    ratesQuery.ascending('percentage');
    const rates = await ratesQuery.find({ useMasterKey: true });
    
    console.log('🎯 AVAILABLE RATES:');
    rates.forEach(rate => {
      console.log(`   - ${rate.get('name')}: ${rate.get('percentage')}% markup`);
    });
    console.log('');
    
    // Group services by route and show pricing for each rate
    const servicesQuery = new Parse.Query('Service');
    servicesQuery.equalTo('exists', true);
    servicesQuery.include('originPOI');
    servicesQuery.include('destinationPOI');
    servicesQuery.include('vehicleType');
    servicesQuery.include('rate');
    servicesQuery.limit(1000);
    const services = await servicesQuery.find({ useMasterKey: true });
    
    // Group by route and vehicle
    const routesMap = {};
    
    services.forEach(service => {
      const origin = service.get('originPOI');
      const destination = service.get('destinationPOI');
      const vehicleType = service.get('vehicleType');
      const rate = service.get('rate');
      
      const originName = origin ? origin.get('name') : 'Local';
      const routeKey = `${originName} → ${destination.get('name')} (${vehicleType.get('code')})`;
      
      if (!routesMap[routeKey]) {
        routesMap[routeKey] = {};
      }
      
      routesMap[routeKey][rate.get('name')] = {
        price: service.get('price'),
        percentage: rate.get('percentage')
      };
    });
    
    // Display results
    console.log('💰 PRICING COMPARISON BY ROUTE:\n');
    
    let routeCount = 0;
    for (const [route, rateData] of Object.entries(routesMap)) {
      // Only show routes that have multiple rates for comparison
      const rateNames = Object.keys(rateData);
      if (rateNames.length <= 1) continue;
      
      routeCount++;
      console.log(`   ${routeCount}. ${route}`);
      
      // Sort by percentage for consistent display
      const sortedRates = rateNames.sort((a, b) => rateData[a].percentage - rateData[b].percentage);
      
      sortedRates.forEach(rateName => {
        const data = rateData[rateName];
        console.log(`      ${rateName.padEnd(15)} ${data.percentage.toString().padEnd(3)}% → ${formatPrice(data.price)}`);
      });
      
      console.log(''); // Empty line for readability
    }
    
    if (routeCount === 0) {
      console.log('   ℹ️  No routes found with multiple rate options.');
      console.log('   Run the create-test-traslados.js script to generate test data.\n');
    }
    
    // Summary statistics
    console.log('📈 SUMMARY:');
    console.log(`   Routes analyzed: ${routeCount}`);
    console.log(`   Total services: ${services.length}`);
    console.log(`   Available rates: ${rates.length}\n`);
    
    if (routeCount > 0) {
      console.log('✅ You can now see pricing differences across rate tiers!');
      console.log('   Use these routes to test your application\'s pricing display.');
    }
    
  } catch (error) {
    console.error('❌ Error showing pricing:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  showPricing()
    .then(() => {
      console.log('\n✅ Pricing display completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { showPricing };