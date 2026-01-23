const Parse = require('parse/node');

Parse.initialize(
  'CrTRTaJpoJFNt8PJ',
  null,
  'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP'
);

Parse.serverURL = 'http://localhost:1337/parse';

async function listPOIs() {
  console.log('\n🔍 Listing all POIs...\n');

  try {
    const poiQuery = new Parse.Query('POI');
    poiQuery.equalTo('exists', true);
    poiQuery.include('serviceType');
    poiQuery.limit(1000);
    const pois = await poiQuery.find({ useMasterKey: true });

    console.log('📊 Found ' + pois.length + ' POIs:\n');

    pois.forEach((poi, index) => {
      const serviceType = poi.get('serviceType');
      console.log((index + 1) + '. ' + poi.get('name'));
      console.log('   ID: ' + poi.id);
      console.log('   Service Type: ' + (serviceType ? serviceType.get('name') : 'NO SERVICE TYPE'));
      console.log('   Active: ' + poi.get('active'));
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

listPOIs()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
