const Parse = require('parse/node');

Parse.initialize(
  'CrTRTaJpoJFNt8PJ',
  null,
  'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP'
);

Parse.serverURL = 'http://localhost:1337/parse';

async function testTourAPI() {
  console.log('\n🧪 Testing Tour API Endpoint...\n');

  try {
    // Login to get session token
    const user = await Parse.User.logIn('test-superadmin@amexing.test', 'TestPass123!');
    const sessionToken = user.getSessionToken();
    console.log('✅ Logged in as: ' + user.get('email'));

    // Test parameters
    const rateId = 'ox5gO8c9ok'; // First Class
    const destinationId = 'GrdyQkmsIC'; // Cañada de la Virgen
    const numberOfPeople = 2;
    const dayDate = '2026-01-06'; // Monday, January 6, 2026

    console.log('\n📋 Test Parameters:');
    console.log('   Rate ID: ' + rateId + ' (First Class)');
    console.log('   Destination ID: ' + destinationId + ' (Cañada de la Virgen)');
    console.log('   Number of People: ' + numberOfPeople);
    console.log('   Day Date: ' + dayDate + ' (Monday)');

    // Make API request
    const url = `http://localhost:1337/api/quotes/tours/vehicles-by-rate-destination/${rateId}/${destinationId}?numberOfPeople=${numberOfPeople}&dayDate=${dayDate}`;
    console.log('\n🌐 Making API request to:');
    console.log('   ' + url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + sessionToken,
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();

    console.log('\n📊 API Response:');
    console.log('   Success: ' + result.success);
    console.log('   Vehicles Count: ' + (result.data ? result.data.length : 0));

    if (result.success && result.data && result.data.length > 0) {
      console.log('\n🚗 Available Vehicles:\n');
      result.data.forEach((vehicle, index) => {
        console.log((index + 1) + '. ' + vehicle.vehicleType);
        console.log('   Tour ID: ' + vehicle.tourId);
        console.log('   Capacity: ' + vehicle.capacity + ' passengers');
        console.log('   Base Price: $' + vehicle.basePrice);
        console.log('   Final Price: $' + vehicle.price);
        console.log('   Duration: ' + vehicle.durationHours + ' hours');
        console.log('');
      });
    } else if (result.success && result.data && result.data.length === 0) {
      console.log('\n⚠️  No vehicles found!');
      console.log('   This means the backend filter is working but returning empty results.');
    } else {
      console.log('\n❌ Error in response:');
      console.log('   ' + JSON.stringify(result, null, 2));
    }

    // Test without date filter
    console.log('\n🧪 Testing WITHOUT date filter:');
    const urlNoDate = `http://localhost:1337/api/quotes/tours/vehicles-by-rate-destination/${rateId}/${destinationId}?numberOfPeople=${numberOfPeople}`;
    console.log('   URL: ' + urlNoDate);

    const responseNoDate = await fetch(urlNoDate, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + sessionToken,
        'Content-Type': 'application/json'
      }
    });

    const resultNoDate = await responseNoDate.json();

    console.log('\n📊 API Response (no date filter):');
    console.log('   Success: ' + resultNoDate.success);
    console.log('   Vehicles Count: ' + (resultNoDate.data ? resultNoDate.data.length : 0));

    if (resultNoDate.success && resultNoDate.data) {
      resultNoDate.data.forEach((vehicle, index) => {
        console.log('   ' + (index + 1) + '. ' + vehicle.vehicleType + ' (capacity: ' + vehicle.capacity + ')');
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

testTourAPI()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
