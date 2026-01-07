/**
 * Create test data for inflation functionality
 * Creates sample records in RatePrices, ClientPrices, and TourPrices tables
 * 
 * Created by Denisse Maldonado
 */

const Parse = require('parse/node');
require('dotenv').config({ path: './environments/.env.development' });

// Initialize Parse
Parse.initialize(process.env.PARSE_APP_ID, null, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL;

async function waitForServer() {
  console.log('⏳ Waiting for server to be ready...');
  for (let i = 0; i < 10; i++) {
    try {
      const query = new Parse.Query('_Role');
      query.limit(1);
      await query.find({ useMasterKey: true });
      console.log('✓ Server is ready!\n');
      return;
    } catch (error) {
      if (i === 9) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

async function createTestData() {
  console.log('🚀 Creating test data for inflation testing...\n');
  
  await waitForServer();

  try {
    // Clear existing test data first
    console.log('🧹 Clearing existing test data...');
    
    const classesToClear = ['RatePrices', 'ClientPrices', 'TourPrices'];
    for (const className of classesToClear) {
      const ClassObj = Parse.Object.extend(className);
      const query = new Parse.Query(ClassObj);
      query.limit(1000);
      const records = await query.find({ useMasterKey: true });
      
      if (records.length > 0) {
        await Parse.Object.destroyAll(records, { useMasterKey: true });
        console.log(`  ✓ Cleared ${records.length} records from ${className}`);
      }
    }

    // Get required relationships (Rate and VehicleType)
    console.log('\n🔗 Finding required relationships...');
    
    // Get first available Rate
    const Rates = Parse.Object.extend('Rates');
    const rateQuery = new Parse.Query(Rates);
    rateQuery.equalTo('active', true);
    rateQuery.equalTo('exists', true);
    let rate = await rateQuery.first({ useMasterKey: true });
    
    if (!rate) {
      // Create a default rate if none exists
      console.log('  Creating default rate...');
      rate = new Rates();
      rate.set('name', 'Standard Rate');
      rate.set('description', 'Standard pricing rate');
      rate.set('multiplier', 1.0);
      rate.set('active', true);
      rate.set('exists', true);
      await rate.save(null, { useMasterKey: true });
    }
    console.log(`  ✓ Using rate: ${rate.get('name')}`);
    
    // Get first available VehicleType
    const VehicleTypes = Parse.Object.extend('VehicleTypes');
    const vehicleQuery = new Parse.Query(VehicleTypes);
    vehicleQuery.equalTo('active', true);
    vehicleQuery.equalTo('exists', true);
    let vehicleType = await vehicleQuery.first({ useMasterKey: true });
    
    if (!vehicleType) {
      // Create a default vehicle type if none exists
      console.log('  Creating default vehicle type...');
      vehicleType = new VehicleTypes();
      vehicleType.set('name', 'Standard Vehicle');
      vehicleType.set('description', 'Standard vehicle type');
      vehicleType.set('active', true);
      vehicleType.set('exists', true);
      await vehicleType.save(null, { useMasterKey: true });
    }
    console.log(`  ✓ Using vehicle type: ${vehicleType.get('name')}`);
    
    // Get first available Service (only for RatePrices)
    const Services = Parse.Object.extend('Service');
    const serviceQuery = new Parse.Query(Services);
    serviceQuery.equalTo('active', true);
    serviceQuery.equalTo('exists', true);
    let service = await serviceQuery.first({ useMasterKey: true });
    
    if (!service) {
      // Create a default service if none exists
      console.log('  Creating default service...');
      service = new Services();
      service.set('name', 'Standard Service');
      service.set('description', 'Standard service offering');
      service.set('active', true);
      service.set('exists', true);
      await service.save(null, { useMasterKey: true });
    }
    console.log(`  ✓ Using service: ${service.get('name')}`)

    // Create RatePrices test data
    console.log('\n📊 Creating RatePrices test data...');
    const RatePrices = Parse.Object.extend('RatePrices');
    
    const ratePricesData = [
      { name: 'Standard Rate - Hourly', price: 100.00, description: 'Standard hourly rate', type: 'hourly' },
      { name: 'Premium Rate - Daily', price: 500.00, description: 'Premium daily rate', type: 'daily' },
      { name: 'Budget Rate - Weekly', price: 2000.00, description: 'Budget weekly rate', type: 'weekly' },
      { name: 'Executive Rate - Monthly', price: 8000.00, description: 'Executive monthly rate', type: 'monthly' },
      { name: 'Special Event Rate', price: 1500.00, description: 'Special event pricing', type: 'event' }
    ];

    const ratePrices = [];
    for (const data of ratePricesData) {
      const ratePrice = new RatePrices();
      ratePrice.set('name', data.name);
      ratePrice.set('price', data.price);
      ratePrice.set('description', data.description);
      ratePrice.set('type', data.type);
      ratePrice.set('active', true);
      ratePrice.set('exists', true);
      // Set required relationships
      ratePrice.set('Service', service);
      ratePrice.set('Rates', rate);
      ratePrice.set('VehicleTypes', vehicleType);
      ratePrices.push(ratePrice);
    }
    
    await Parse.Object.saveAll(ratePrices, { useMasterKey: true });
    console.log(`  ✓ Created ${ratePrices.length} RatePrices records`);

    // Create ClientPrices test data
    console.log('\n👤 Creating ClientPrices test data...');
    const ClientPrices = Parse.Object.extend('ClientPrices');
    
    const clientPricesData = [
      { clientName: 'Acme Corp', precio: 150.00, basePrice: 120.00, description: 'Corporate client pricing' },
      { clientName: 'Tech Solutions', precio: 200.00, basePrice: 180.00, description: 'Technology partner pricing' },
      { clientName: 'Global Industries', precio: 300.00, basePrice: 250.00, description: 'Enterprise client pricing' },
      { clientName: 'Small Business LLC', precio: 100.00, basePrice: 80.00, description: 'Small business pricing' },
      { clientName: 'Startup Inc', precio: 75.00, basePrice: 60.00, description: 'Startup special pricing' },
      { clientName: 'Premium Partners', precio: 450.00, basePrice: 400.00, description: 'Premium partner rates' }
    ];

    const clientPrices = [];
    for (const data of clientPricesData) {
      const client = new ClientPrices();
      client.set('clientName', data.clientName);
      client.set('precio', data.precio);
      client.set('basePrice', data.basePrice);
      client.set('description', data.description);
      client.set('active', true);
      client.set('exists', true);
      // Set required relationships (ClientPrices doesn't need Service)
      client.set('Rates', rate);
      client.set('VehicleTypes', vehicleType);
      clientPrices.push(client);
    }
    
    await Parse.Object.saveAll(clientPrices, { useMasterKey: true });
    console.log(`  ✓ Created ${clientPrices.length} ClientPrices records`);

    // Create TourPrices test data
    console.log('\n🗺️ Creating TourPrices test data...');
    const TourPrices = Parse.Object.extend('TourPrices');
    
    const tourPricesData = [
      { tourName: 'City Tour', price: 50.00, duration: 3, description: 'Half-day city tour' },
      { tourName: 'Beach Excursion', price: 120.00, duration: 6, description: 'Full-day beach tour' },
      { tourName: 'Mountain Adventure', price: 200.00, duration: 8, description: 'Mountain hiking tour' },
      { tourName: 'Cultural Experience', price: 80.00, duration: 4, description: 'Cultural sites tour' },
      { tourName: 'Night Tour', price: 60.00, duration: 3, description: 'Evening entertainment tour' },
      { tourName: 'Weekend Package', price: 350.00, duration: 48, description: 'Two-day weekend package' },
      { tourName: 'VIP Private Tour', price: 500.00, duration: 12, description: 'Exclusive VIP experience' }
    ];

    const tourPrices = [];
    for (const data of tourPricesData) {
      const tour = new TourPrices();
      tour.set('tourName', data.tourName);
      tour.set('price', data.price);
      tour.set('duration', data.duration);
      tour.set('description', data.description);
      tour.set('active', true);
      tour.set('exists', true);
      // Set required relationships (TourPrices doesn't need Service)
      tour.set('Rates', rate);
      tour.set('VehicleTypes', vehicleType);
      tourPrices.push(tour);
    }
    
    await Parse.Object.saveAll(tourPrices, { useMasterKey: true });
    console.log(`  ✓ Created ${tourPrices.length} TourPrices records`);

    // Summary
    console.log('\n✅ Test data created successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Summary:');
    console.log(`  • RatePrices: ${ratePrices.length} records`);
    console.log(`  • ClientPrices: ${clientPrices.length} records`);
    console.log(`  • TourPrices: ${tourPrices.length} records`);
    console.log(`  • Total: ${ratePrices.length + clientPrices.length + tourPrices.length} records`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n💡 You can now test the inflation flow:');
    console.log('  1. Go to the Price Settings page');
    console.log('  2. Click "Apply Inflation" and enter a percentage (e.g., 10%)');
    console.log('  3. Check that prices are increased');
    console.log('  4. Click "Revert Inflation" to see available batches');
    console.log('  5. Select a batch to revert the changes');
    
  } catch (error) {
    console.error('❌ Error creating test data:', error);
    process.exit(1);
  }
}

// Run the script
createTestData().then(() => {
  console.log('\n✨ Done!');
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});