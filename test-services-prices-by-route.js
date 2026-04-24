/**
 * Test Services prices-by-route API Fix
 * Verify that the ServicesController.getPricesByRoute now returns correct León Airport pricing
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

async function testServicesPricesByRoute() {
  try {
    console.log('🧪 Testing /api/services/prices-by-route API Fix...\n');

    // 1. Get Premium rate ID
    const rateQuery = new Parse.Query('Rate');
    rateQuery.equalTo('name', 'Premium');
    const premiumRate = await rateQuery.first({ useMasterKey: true });
    
    if (!premiumRate) {
      console.log('❌ Premium rate not found');
      return;
    }

    console.log(`✅ Found Premium rate: ${premiumRate.get('name')} (${premiumRate.id})\n`);

    // 1.5. Use master key for API authentication (simplified for testing)
    console.log('🔐 Using master key for authentication...');

    // 2. Test León Airport route specifically
    console.log('🛬 Testing León Airport route...');
    const airportParams = new URLSearchParams({
      originPOI: 'San Miguel de Allende',
      destinationPOI: '(BJX) Aeropuerto Internacional de Leon',
      rateId: premiumRate.id
    });
    const airportApiUrl = `/api/services/prices-by-route?${airportParams.toString()}`;
    
    const airportResponse = await callAPI(airportApiUrl);
    
    if (!airportResponse.success) {
      console.log('❌ León Airport API failed:', airportResponse.error);
      return;
    }

    console.log('📦 León Airport API Response:');
    console.log(`   Vehicles returned: ${airportResponse.data.vehicles.length}`);
    
    const airportSedanVehicle = airportResponse.data.vehicles.find(v => v.vehicleType === 'SEDAN');
    if (airportSedanVehicle) {
      const airportSedanPrice = airportSedanVehicle.basePrice;
      if (airportSedanPrice === 1858) {
        console.log(`   ✅ CORRECT! León Airport SEDAN: ${airportSedanPrice} MXN`);
      } else if (airportSedanPrice === 1486) {
        console.log(`   ❌ WRONG! León Airport SEDAN: ${airportSedanPrice} MXN (should be 1858)`);
      } else {
        console.log(`   ⚠️  UNEXPECTED! León Airport SEDAN: ${airportSedanPrice} MXN`);
      }
    } else {
      console.log('   ⚠️  No SEDAN vehicle found for León Airport route');
    }

    // 3. Test León City route for comparison
    console.log('\n🏙️  Testing León City route...');
    const cityParams = new URLSearchParams({
      originPOI: 'San Miguel de Allende',
      destinationPOI: 'León',
      rateId: premiumRate.id
    });
    const cityApiUrl = `/api/services/prices-by-route?${cityParams.toString()}`;
    
    const cityResponse = await callAPI(cityApiUrl);
    
    if (!cityResponse.success) {
      console.log('❌ León City API failed:', cityResponse.error);
      return;
    }

    console.log('📦 León City API Response:');
    console.log(`   Vehicles returned: ${cityResponse.data.vehicles.length}`);
    
    const citySedanVehicle = cityResponse.data.vehicles.find(v => v.vehicleType === 'SEDAN');
    if (citySedanVehicle) {
      const citySedanPrice = citySedanVehicle.basePrice;
      if (citySedanPrice === 1486) {
        console.log(`   ✅ CORRECT! León City SEDAN: ${citySedanPrice} MXN`);
      } else if (citySedanPrice === 1858) {
        console.log(`   ❌ WRONG! León City SEDAN: ${citySedanPrice} MXN (should be 1486)`);
      } else {
        console.log(`   ⚠️  UNEXPECTED! León City SEDAN: ${citySedanPrice} MXN`);
      }
    } else {
      console.log('   ⚠️  No SEDAN vehicle found for León City route');
    }

    // 4. Summary
    console.log('\n' + '='.repeat(60));
    console.log('🧪 TEST SUMMARY');
    console.log('='.repeat(60));
    
    const hasCorrectAirportPricing = airportSedanVehicle && airportSedanVehicle.basePrice === 1858;
    const hasCorrectCityPricing = citySedanVehicle && citySedanVehicle.basePrice === 1486;
    
    if (hasCorrectAirportPricing && hasCorrectCityPricing) {
      console.log('✅ SUCCESS: Both León Airport (1858) and León City (1486) show correct pricing!');
      console.log('✅ The ServicesController fix is working correctly!');
      console.log('✅ Quotes frontend should now display correct pricing');
    } else if (hasCorrectAirportPricing) {
      console.log('✅ PARTIAL SUCCESS: León Airport pricing is correct (1858)');
      console.log('⚠️  León City pricing needs verification');
    } else {
      console.log('❌ FAILED: León Airport pricing is still incorrect');
      console.log('❌ The fix needs more investigation');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function getAdminSessionToken() {
  try {
    // Login as superadmin to get session token
    const superadminUser = await Parse.User.logIn('superadmin@amexing.com', 'AmexingBosses2023$%');
    return superadminUser.getSessionToken();
  } catch (error) {
    console.error('Failed to get admin session token:', error.message);
    return null;
  }
}

async function callAPI(url) {
  const http = require('http');
  const options = {
    hostname: 'localhost',
    port: 1337,
    path: url,
    method: 'GET',
    headers: {
      'X-Parse-Application-Id': process.env.PARSE_APP_ID,
      'X-Parse-Master-Key': process.env.PARSE_MASTER_KEY,
    },
  };

  return new Promise((resolve, reject) => {
    const httpReq = http.request(options, (httpRes) => {
      let data = '';
      httpRes.on('data', (chunk) => {
        data += chunk;
      });
      httpRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (error) {
          reject(new Error(`JSON parse error: ${error.message}`));
        }
      });
    });

    httpReq.on('error', (error) => {
      reject(new Error(`HTTP request error: ${error.message}`));
    });

    httpReq.end();
  });
}

testServicesPricesByRoute();