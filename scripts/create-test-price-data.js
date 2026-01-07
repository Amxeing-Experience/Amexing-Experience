/**
 * Script to create 5 test registers in TourPrices and ClientPrices tables
 * 
 * This script creates sample data for testing purposes following
 * the database schema and existing patterns.
 * 
 * Created by Denisse Maldonado
 * @version 1.0.0
 */

const Parse = require('parse/node');
const path = require('path');

// Parse Server configuration
require('dotenv').config({ path: path.join(__dirname, '../environments/.env.development') });
Parse.initialize(
  process.env.PARSE_APP_ID || 'CrTRTaJpoJFNt8PJ',
  null,
  process.env.PARSE_MASTER_KEY || 'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP'
);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

/**
 * Create 5 test TourPrices records
 */
async function createTourPricesTestData() {
  console.log('🌱 Creating 5 test TourPrices records...');
  
  try {
    // Get required entities
    const rates = await new Parse.Query('Rate').equalTo('exists', true).limit(3).find({ useMasterKey: true });
    const tours = await new Parse.Query('Tour').equalTo('exists', true).include('destinationPOI').include('vehicleType').limit(3).find({ useMasterKey: true });
    const vehicleTypes = await new Parse.Query('VehicleType').equalTo('exists', true).limit(2).find({ useMasterKey: true });
    
    if (rates.length === 0 || tours.length === 0 || vehicleTypes.length === 0) {
      throw new Error('Not enough base data found. Need Rates, Tours and VehicleTypes in database.');
    }
    
    const testData = [
      {
        rate: rates[0],
        tour: tours[0],
        vehicleType: vehicleTypes[0],
        price: 2500,
        currency: 'MXN'
      },
      {
        rate: rates[1] || rates[0],
        tour: tours[0],
        vehicleType: vehicleTypes[1] || vehicleTypes[0],
        price: 3000,
        currency: 'MXN'
      },
      {
        rate: rates[0],
        tour: tours[1] || tours[0],
        vehicleType: vehicleTypes[0],
        price: 2200,
        currency: 'MXN'
      },
      {
        rate: rates[2] || rates[0],
        tour: tours[1] || tours[0],
        vehicleType: vehicleTypes[1] || vehicleTypes[0],
        price: 3500,
        currency: 'MXN'
      },
      {
        rate: rates[1] || rates[0],
        tour: tours[2] || tours[0],
        vehicleType: vehicleTypes[0],
        price: 2800,
        currency: 'MXN'
      }
    ];
    
    const created = [];
    
    for (let i = 0; i < testData.length; i++) {
      const data = testData[i];
      
      // Check if already exists
      const existingQuery = new Parse.Query('TourPrices');
      existingQuery.equalTo('ratePtr', data.rate);
      existingQuery.equalTo('tourPtr', data.tour);
      existingQuery.equalTo('vehicleType', data.vehicleType);
      existingQuery.equalTo('exists', true);
      
      const existing = await existingQuery.first({ useMasterKey: true });
      if (existing) {
        console.log(`  ⚠️  TourPrice ${i + 1} already exists, skipping...`);
        continue;
      }
      
      // Create new TourPrices record
      const tourPrice = new Parse.Object('TourPrices');
      tourPrice.set('ratePtr', data.rate);
      tourPrice.set('tourPtr', data.tour);
      tourPrice.set('vehicleType', data.vehicleType);
      tourPrice.set('price', data.price);
      tourPrice.set('currency', data.currency);
      tourPrice.set('active', true);
      tourPrice.set('exists', true);
      
      await tourPrice.save(null, { useMasterKey: true });
      created.push(tourPrice);
      
      const rateName = data.rate.get('name') || 'Unknown Rate';
      const tourName = data.tour.get('name') || `Tour to ${data.tour.get('destinationPOI')?.get('name') || 'Unknown'}`;
      const vehicleName = data.vehicleType.get('name') || 'Unknown Vehicle';
      
      console.log(`  ✅ Created TourPrice ${i + 1}: ${tourName} | ${vehicleName} | ${rateName} | $${data.price} ${data.currency}`);
    }
    
    console.log(`✅ TourPrices: ${created.length} records created\n`);
    return created;
    
  } catch (error) {
    console.error('❌ Error creating TourPrices test data:', error.message);
    throw error;
  }
}

/**
 * Create 5 test ClientPrices records
 */
async function createClientPricesTestData() {
  console.log('🌱 Creating 5 test ClientPrices records...');
  
  try {
    // Get required entities
    const rates = await new Parse.Query('Rate').equalTo('exists', true).limit(3).find({ useMasterKey: true });
    const services = await new Parse.Query('Services').equalTo('exists', true).include(['originPOI', 'destinationPOI']).limit(3).find({ useMasterKey: true });
    const vehicleTypes = await new Parse.Query('VehicleType').equalTo('exists', true).limit(2).find({ useMasterKey: true });
    const clients = await new Parse.Query('AmexingUser').equalTo('exists', true).limit(2).find({ useMasterKey: true });
    
    if (rates.length === 0 || services.length === 0 || vehicleTypes.length === 0 || clients.length === 0) {
      throw new Error('Not enough base data found. Need Rates, Services, VehicleTypes and AmexingUser records in database.');
    }
    
    const testData = [
      {
        client: clients[0],
        rate: rates[0],
        vehicleType: vehicleTypes[0],
        service: services[0],
        precio: 1800,
        basePrice: 2500,
        currency: 'MXN'
      },
      {
        client: clients[0],
        rate: rates[1] || rates[0],
        vehicleType: vehicleTypes[1] || vehicleTypes[0],
        service: services[0],
        precio: 2200,
        basePrice: 3000,
        currency: 'MXN'
      },
      {
        client: clients[1] || clients[0],
        rate: rates[0],
        vehicleType: vehicleTypes[0],
        service: services[1] || services[0],
        precio: 1650,
        basePrice: 2200,
        currency: 'MXN'
      },
      {
        client: clients[1] || clients[0],
        rate: rates[2] || rates[0],
        vehicleType: vehicleTypes[1] || vehicleTypes[0],
        service: services[1] || services[0],
        precio: 2800,
        basePrice: 3500,
        currency: 'MXN'
      },
      {
        client: clients[0],
        rate: rates[1] || rates[0],
        vehicleType: vehicleTypes[0],
        service: services[2] || services[0],
        precio: 2100,
        basePrice: 2800,
        currency: 'MXN'
      }
    ];
    
    const created = [];
    
    for (let i = 0; i < testData.length; i++) {
      const data = testData[i];
      
      // Check if already exists
      const existingQuery = new Parse.Query('ClientPrices');
      existingQuery.equalTo('clientPtr', data.client);
      existingQuery.equalTo('itemType', 'SERVICES');
      existingQuery.equalTo('itemId', data.service.id);
      existingQuery.equalTo('ratePtr', data.rate);
      existingQuery.equalTo('vehiclePtr', data.vehicleType);
      existingQuery.equalTo('exists', true);
      existingQuery.doesNotExist('valid_until');
      
      const existing = await existingQuery.first({ useMasterKey: true });
      if (existing) {
        console.log(`  ⚠️  ClientPrice ${i + 1} already exists, skipping...`);
        continue;
      }
      
      // Create new ClientPrices record
      const clientPrice = new Parse.Object('ClientPrices');
      clientPrice.set('clientPtr', data.client);
      clientPrice.set('ratePtr', data.rate);
      clientPrice.set('vehiclePtr', data.vehicleType);
      clientPrice.set('itemType', 'SERVICES');
      clientPrice.set('itemId', data.service.id);
      clientPrice.set('precio', data.precio);
      clientPrice.set('basePrice', data.basePrice);
      clientPrice.set('currency', data.currency);
      clientPrice.set('active', true);
      clientPrice.set('exists', true);
      clientPrice.set('valid_until', null);
      clientPrice.set('createdBy', 'test-script');
      clientPrice.set('notes', 'Test data created by script');
      
      await clientPrice.save(null, { useMasterKey: true });
      created.push(clientPrice);
      
      const clientEmail = data.client.get('email') || 'Unknown Client';
      const rateName = data.rate.get('name') || 'Unknown Rate';
      const vehicleName = data.vehicleType.get('name') || 'Unknown Vehicle';
      const serviceName = `${data.service.get('originPOI')?.get('name') || 'Origin'} → ${data.service.get('destinationPOI')?.get('name') || 'Destination'}`;
      const discount = Math.round(((data.basePrice - data.precio) / data.basePrice) * 100);
      
      console.log(`  ✅ Created ClientPrice ${i + 1}: ${clientEmail} | ${serviceName} | ${vehicleName} | ${rateName} | $${data.precio} MXN (${discount}% discount)`);
    }
    
    console.log(`✅ ClientPrices: ${created.length} records created\n`);
    return created;
    
  } catch (error) {
    console.error('❌ Error creating ClientPrices test data:', error.message);
    throw error;
  }
}

/**
 * Main execution function
 */
async function main() {
  const startTime = Date.now();
  console.log('🚀 Creating test data for TourPrices and ClientPrices tables...\n');
  
  try {
    // Create TourPrices test data
    await createTourPricesTestData();
    
    // Create ClientPrices test data
    await createClientPricesTestData();
    
    const duration = Date.now() - startTime;
    console.log(`✅ Test data creation completed successfully!`);
    console.log(`⏱️  Total duration: ${duration}ms`);
    
  } catch (error) {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { main, createTourPricesTestData, createClientPricesTestData };