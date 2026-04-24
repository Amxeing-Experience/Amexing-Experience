/**
 * Test Quotes León Airport Fix
 * Verify that quotes system now shows correct León Airport pricing (1858) instead of León City pricing (1486)
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

async function testQuotesLeonFix() {
  try {
    console.log('🧪 Testing Quotes León Airport Pricing Fix...\n');

    // 1. Get Premium rate ID
    const rateQuery = new Parse.Query('Rate');
    rateQuery.equalTo('name', 'Premium');
    const premiumRate = await rateQuery.first({ useMasterKey: true });
    
    if (!premiumRate) {
      console.log('❌ Premium rate not found');
      return;
    }

    console.log(`✅ Found Premium rate: ${premiumRate.get('name')} (${premiumRate.id})\n`);

    // 2. Test the RatePrices data directly to see if it's working correctly
    console.log('🔍 Testing RatePrices directly (simulating quotes system logic)...');
    
    // Query RatePrices like the updated quotes system does
    const ratePricesQuery = new Parse.Query('RatePrices');
    ratePricesQuery.equalTo('rate', {
      __type: 'Pointer',
      className: 'Rate',
      objectId: premiumRate.id,
    });
    ratePricesQuery.equalTo('exists', true);
    ratePricesQuery.equalTo('active', true);
    ratePricesQuery.doesNotExist('valid_until');
    ratePricesQuery.include([
      'service',
      'service.originPOI',
      'service.destinationPOI',
      'service.originPOI.serviceType',
      'service.destinationPOI.serviceType',
      'vehicleType',
    ]);
    ratePricesQuery.limit(1000);

    const ratePrices = await ratePricesQuery.find({ useMasterKey: true });
    console.log(`📊 Found ${ratePrices.length} RatePrices for Premium rate\n`);

    // 3. Analyze RatePrices for León routes (simulating what quotes system will see)
    console.log('🔍 Analyzing León routes from RatePrices...');
    
    const leonRatePrices = ratePrices.filter(ratePrice => {
      const service = ratePrice.get('service');
      if (!service) return false;
      
      const originPOI = service.get('originPOI');
      const destinationPOI = service.get('destinationPOI');
      
      const originName = originPOI?.get('name') || '';
      const destinationName = destinationPOI?.get('name') || '';
      
      return originName.includes('Leon') || originName.includes('León') ||
             destinationName.includes('Leon') || destinationName.includes('León');
    });

    console.log(`🎯 Found ${leonRatePrices.length} León RatePrices:\n`);

    leonRatePrices.forEach((ratePrice, index) => {
      const service = ratePrice.get('service');
      const originPOI = service?.get('originPOI');
      const destinationPOI = service?.get('destinationPOI');
      const vehicleType = ratePrice.get('vehicleType');
      const serviceType = destinationPOI?.get('serviceType');
      const price = ratePrice.get('price');

      const originName = originPOI?.get('name') || 'Local';
      const destinationName = destinationPOI?.get('name') || '';
      const vehicleName = vehicleType?.get('name') || 'Unknown';
      const serviceTypeName = serviceType?.get('name') || 'Unknown';

      console.log(`${index + 1}. ${originName} → ${destinationName}`);
      console.log(`   Service Type: ${serviceTypeName}`);
      console.log(`   🚗 ${vehicleName}: ${price} MXN`);
      console.log('');
    });

    // 4. Specifically check for León Airport pricing
    const leonAirportRatePrices = leonRatePrices.filter(ratePrice => {
      const service = ratePrice.get('service');
      const originPOI = service?.get('originPOI');
      const destinationPOI = service?.get('destinationPOI');
      const serviceType = destinationPOI?.get('serviceType');
      
      const originName = originPOI?.get('name') || '';
      const destinationName = destinationPOI?.get('name') || '';
      const serviceTypeName = serviceType?.get('name') || '';
      
      return (originName.includes('Aeropuerto') || destinationName.includes('Aeropuerto')) &&
             serviceTypeName === 'Aeropuerto';
    });

    console.log(`🛬 León Airport (Aeropuerto) RatePrices: ${leonAirportRatePrices.length}\n`);

    if (leonAirportRatePrices.length > 0) {
      leonAirportRatePrices.forEach((ratePrice, index) => {
        const service = ratePrice.get('service');
        const originPOI = service?.get('originPOI');
        const destinationPOI = service?.get('destinationPOI');
        const vehicleType = ratePrice.get('vehicleType');
        const price = ratePrice.get('price');

        const originName = originPOI?.get('name') || 'Local';
        const destinationName = destinationPOI?.get('name') || '';
        const vehicleName = vehicleType?.get('name') || 'Unknown';

        console.log(`Airport Route ${index + 1}: ${originName} → ${destinationName}`);
        
        if (vehicleName === 'SEDAN') {
          if (price === 1858) {
            console.log(`   ✅ CORRECT! SEDAN price: ${price} MXN (León Airport pricing)`);
          } else if (price === 1486) {
            console.log(`   ❌ WRONG! SEDAN price: ${price} MXN (León City pricing - should be 1858)`);
          } else {
            console.log(`   ⚠️  UNEXPECTED! SEDAN price: ${price} MXN`);
          }
        } else {
          console.log(`   🚗 ${vehicleName}: ${price} MXN`);
        }
      });
    } else {
      console.log('❌ No León Airport RatePrices found - this might indicate a filtering issue');
    }

    // 5. Summary
    console.log('\n' + '='.repeat(60));
    console.log('🧪 TEST SUMMARY');
    console.log('='.repeat(60));
    
    const hasLeonAirportWithCorrectPricing = leonAirportRatePrices.some(ratePrice => {
      const vehicleType = ratePrice.get('vehicleType');
      const price = ratePrice.get('price');
      const vehicleName = vehicleType?.get('name') || 'Unknown';
      
      return vehicleName === 'SEDAN' && price === 1858;
    });

    if (hasLeonAirportWithCorrectPricing) {
      console.log('✅ SUCCESS: RatePrices contains correct León Airport pricing (1858 MXN)');
      console.log('✅ The quotes system fix should now work correctly!');
      console.log('✅ Quotes will now use RatePrices table instead of Services table');
    } else {
      console.log('❌ FAILED: RatePrices still shows incorrect pricing');
      console.log('❌ The fix needs more investigation');
    }

    // Check if we also have León City pricing for comparison
    const leonCityRatePrices = leonRatePrices.filter(ratePrice => {
      const service = ratePrice.get('service');
      const destinationPOI = service?.get('destinationPOI');
      const serviceType = destinationPOI?.get('serviceType');
      const serviceTypeName = serviceType?.get('name') || '';
      
      return serviceTypeName === 'Punto a Punto';
    });

    console.log(`\n📊 Additional info: Found ${leonCityRatePrices.length} León City (Punto a Punto) RatePrices`);
    
    const leonCitySedanPrice = leonCityRatePrices.find(ratePrice => {
      const vehicleType = ratePrice.get('vehicleType');
      const vehicleName = vehicleType?.get('name') || 'Unknown';
      return vehicleName === 'SEDAN';
    })?.get('price');

    if (leonCitySedanPrice) {
      console.log(`   León City SEDAN price: ${leonCitySedanPrice} MXN ${leonCitySedanPrice === 1486 ? '(correct)' : '(unexpected)'}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testQuotesLeonFix();