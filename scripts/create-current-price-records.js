const Parse = require('parse/node');
require('dotenv').config({ path: './environments/.env.development' });

Parse.initialize(process.env.PARSE_APP_ID, process.env.PARSE_JAVASCRIPT_KEY, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

async function createCurrentPriceRecords() {
  try {
    console.log('\n🎯 Creating CURRENT price records for inflation testing...');
    console.log('Note: These records will NOT have valid_until field (current prices)');
    console.log('=========================================================\n');

    // Get reference data
    console.log('📋 Getting reference data...');
    
    const servicesQuery = new Parse.Query('Service');
    servicesQuery.equalTo('active', true);
    servicesQuery.equalTo('exists', true);
    const services = await servicesQuery.find({ useMasterKey: true });
    
    const ratesQuery = new Parse.Query('Rate');
    ratesQuery.equalTo('active', true);
    ratesQuery.equalTo('exists', true);
    const rates = await ratesQuery.find({ useMasterKey: true });
    
    const vehicleTypesQuery = new Parse.Query('VehicleType');
    vehicleTypesQuery.equalTo('active', true);
    vehicleTypesQuery.equalTo('exists', true);
    const vehicleTypes = await vehicleTypesQuery.find({ useMasterKey: true });

    console.log(`Found: ${services.length} services, ${rates.length} rates, ${vehicleTypes.length} vehicle types\n`);

    let totalCreated = 0;

    // Create RatePrices (current, no valid_until)
    console.log('💰 Creating RatePrices (current prices)...');
    for (let i = 0; i < 5; i++) {
      const ratePrice = new Parse.Object('RatePrices');
      ratePrice.set('active', true);
      ratePrice.set('exists', true);
      // Deliberately NOT setting valid_until - these are current prices
      ratePrice.set('service', services[i % services.length]);
      ratePrice.set('rate', rates[i % rates.length]);
      ratePrice.set('vehicle_type', vehicleTypes[i % vehicleTypes.length]);
      ratePrice.set('price', 1000 + (i * 100)); // $1000, $1100, $1200, etc.
      
      await ratePrice.save(null, { useMasterKey: true });
      console.log(`  ✓ Created RatePrice: ID=${ratePrice.id}, Price=$${ratePrice.get('price')}`);
      totalCreated++;
    }

    // Create TourPrices (current, no valid_until)
    console.log('\n🏖️ Creating TourPrices (current prices)...');
    for (let i = 0; i < 5; i++) {
      const tourPrice = new Parse.Object('TourPrices');
      tourPrice.set('active', true);
      tourPrice.set('exists', true);
      // Deliberately NOT setting valid_until - these are current prices
      tourPrice.set('service', services[i % services.length]);
      tourPrice.set('vehicle_type', vehicleTypes[i % vehicleTypes.length]);
      tourPrice.set('price', 2000 + (i * 200)); // $2000, $2200, $2400, etc.
      
      await tourPrice.save(null, { useMasterKey: true });
      console.log(`  ✓ Created TourPrice: ID=${tourPrice.id}, Price=$${tourPrice.get('price')}`);
      totalCreated++;
    }

    // Create ClientPrices (current, no valid_until)
    console.log('\n👥 Creating ClientPrices (current prices)...');
    for (let i = 0; i < 5; i++) {
      const clientPrice = new Parse.Object('ClientPrices');
      clientPrice.set('active', true);
      clientPrice.set('exists', true);
      // Deliberately NOT setting valid_until - these are current prices
      clientPrice.set('service', services[i % services.length]);
      clientPrice.set('rate', rates[i % rates.length]);
      clientPrice.set('vehicle_type', vehicleTypes[i % vehicleTypes.length]);
      clientPrice.set('price', 1500 + (i * 150)); // $1500, $1650, $1800, etc.
      
      await clientPrice.save(null, { useMasterKey: true });
      console.log(`  ✓ Created ClientPrice: ID=${clientPrice.id}, Price=$${clientPrice.get('price')}`);
      totalCreated++;
    }

    console.log('\n🔍 Verification...');
    
    // Verify inflation-ready records
    for (const className of ['RatePrices', 'TourPrices', 'ClientPrices']) {
      const ClassObj = Parse.Object.extend(className);
      const query = new Parse.Query(ClassObj);
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.doesNotExist('valid_until'); // Current prices only
      query.doesNotExist('inflation_batch_id'); // Not yet inflated
      
      const count = await query.count({ useMasterKey: true });
      console.log(`${className}: ${count} current records ready for inflation`);
    }

    console.log('\n========================================================');
    console.log('✅ CURRENT PRICE RECORDS CREATED SUCCESSFULLY!');
    console.log(`📊 Total new current price records: ${totalCreated}`);
    console.log('🎯 These records are ready for inflation testing!');
    console.log('========================================================\n');

  } catch (error) {
    console.error('❌ Error creating current price records:', error);
  }
}

createCurrentPriceRecords();