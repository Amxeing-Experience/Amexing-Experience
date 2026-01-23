const Parse = require('parse/node');

Parse.initialize(
  'CrTRTaJpoJFNt8PJ',
  null,
  'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP'
);

Parse.serverURL = 'http://localhost:1337/parse';

async function checkTourAvailability() {
  console.log('\n🔍 Checking Tour Availability for Cañada de la Virgen...\n');

  try {
    // Find Cañada de la Virgen POI
    const poiQuery = new Parse.Query('POI');
    poiQuery.equalTo('name', 'Cañada de la Virgen');
    poiQuery.equalTo('exists', true);
    const poi = await poiQuery.first({ useMasterKey: true });

    if (!poi) {
      console.log('❌ Cañada de la Virgen POI not found');
      return;
    }
    console.log('✅ Found POI: ' + poi.get('name') + ' (' + poi.id + ')');

    // Find ALL tours to Cañada (all rates)
    const toursQuery = new Parse.Query('Tours');
    toursQuery.equalTo('destinationPOI', poi);
    toursQuery.equalTo('exists', true);
    toursQuery.equalTo('active', true);
    toursQuery.include(['vehicleType', 'rate']);
    toursQuery.limit(1000);
    const tours = await toursQuery.find({ useMasterKey: true });

    console.log('\n📊 Found ' + tours.length + ' tours to Cañada de la Virgen:\n');

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    tours.forEach((tour, index) => {
      const rate = tour.get('rate');
      const vehicleType = tour.get('vehicleType');
      const availability = tour.get('availability');

      console.log((index + 1) + '. Tour ID: ' + tour.id);
      console.log('   Rate: ' + (rate ? rate.get('name') : 'NO RATE'));
      console.log('   Vehicle: ' + (vehicleType ? vehicleType.get('name') : 'NO VEHICLE'));
      console.log('   Price: $' + tour.get('price'));
      console.log('   Duration: ' + tour.get('time') + ' minutes');
      console.log('   Active: ' + tour.get('active'));
      console.log('   Exists: ' + tour.get('exists'));

      if (availability && Array.isArray(availability)) {
        console.log('   Availability (' + availability.length + ' days):');
        availability.forEach(avail => {
          const dayName = dayNames[avail.day] || 'Unknown';
          console.log('     - ' + dayName + ' (day code: ' + avail.day + ')');
          if (avail.hours) {
            console.log('       Hours: ' + JSON.stringify(avail.hours));
          }
        });
      } else {
        console.log('   Availability: undefined (available all days)');
      }
      console.log('');
    });

    // Test filtering for Monday (day code = 1)
    console.log('\n🔍 Testing filter for Monday (day code = 1):\n');

    const mondayTours = tours.filter(tour => {
      const availability = tour.get('availability');

      if (!availability || !Array.isArray(availability)) {
        console.log('   ✅ Tour ' + tour.id + ' included (no availability field)');
        return true;
      }

      const hasMonday = availability.some(avail => avail.day === 1);
      if (hasMonday) {
        console.log('   ✅ Tour ' + tour.id + ' included (Monday in availability)');
      } else {
        console.log('   ❌ Tour ' + tour.id + ' excluded (Monday NOT in availability)');
      }
      return hasMonday;
    });

    console.log('\n📊 Result: ' + mondayTours.length + ' tours available on Monday');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

checkTourAvailability()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
