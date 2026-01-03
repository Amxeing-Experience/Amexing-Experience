const Parse = require('parse/node');

Parse.initialize(
  process.env.PARSE_APP_ID || 'amexing-app-id',
  null,
  process.env.PARSE_MASTER_KEY || 'amexing-master-key'
);

Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

async function checkTours() {
  console.log('\n🔍 Checking Tours for First Class + Cañada de la Virgen...\n');

  try {
    // 1. Find First Class rate
    const rateQuery = new Parse.Query('Rate');
    rateQuery.equalTo('name', 'First Class');
    rateQuery.equalTo('exists', true);
    const rate = await rateQuery.first({ useMasterKey: true });

    if (!rate) {
      console.log('❌ First Class rate not found');
      return;
    }
    console.log('✅ Found rate: ' + rate.get('name') + ' (' + rate.id + ')');

    // 2. Find Cañada de la Virgen POI
    const poiQuery = new Parse.Query('POI');
    poiQuery.equalTo('name', 'Cañada de la Virgen (no incluye entradas)');
    poiQuery.equalTo('exists', true);
    const poi = await poiQuery.first({ useMasterKey: true });

    if (!poi) {
      console.log('❌ Cañada de la Virgen POI not found');
      return;
    }
    console.log('✅ Found POI: ' + poi.get('name') + ' (' + poi.id + ')');

    // 3. Find Tours matching rate + destination
    const toursQuery = new Parse.Query('Tours');
    toursQuery.equalTo('rate', rate);
    toursQuery.equalTo('destinationPOI', poi);
    toursQuery.equalTo('exists', true);
    toursQuery.equalTo('active', true);
    toursQuery.include('vehicleType');
    const tours = await toursQuery.find({ useMasterKey: true });

    console.log('\n📊 Found ' + tours.length + ' tours for First Class + Cañada de la Virgen:\n');

    tours.forEach((tour, index) => {
      const vehicleType = tour.get('vehicleType');
      console.log((index + 1) + '. Tour ID: ' + tour.id);
      console.log('   Vehicle: ' + (vehicleType ? vehicleType.get('name') : 'NO VEHICLE'));
      console.log('   Price: $' + tour.get('price'));
      console.log('   Duration: ' + tour.get('time') + ' minutes');
      console.log('   Active: ' + tour.get('active'));
      console.log('   Exists: ' + tour.get('exists'));
      console.log('   Availability: ' + JSON.stringify(tour.get('availability')));
      console.log('');
    });

    // 4. Check vehicle types
    if (tours.length > 0) {
      console.log('\n🚗 Vehicle Types:\n');
      const vehicleIds = tours.map(t => {
        const vt = t.get('vehicleType');
        return vt ? vt.id : null;
      }).filter(Boolean);
      const uniqueVehicleIds = [...new Set(vehicleIds)];

      for (const vehId of uniqueVehicleIds) {
        const vehQuery = new Parse.Query('VehicleType');
        const vehicle = await vehQuery.get(vehId, { useMasterKey: true });
        console.log('- ' + vehicle.get('name') + ' (capacity: ' + vehicle.get('defaultCapacity') + ')');
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

checkTours()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
