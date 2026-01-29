/**
 * Test script to verify walking tours functionality
 * Tests the walking tours migration and API endpoints
 * 
 * Created by Denisse Maldonado
 */

const Parse = require('parse/node');
require('dotenv').config({ path: './environments/.env.development' });

// Initialize Parse
Parse.initialize(
  process.env.PARSE_APP_ID || 'AMEXING_DEV_APP_ID',
  process.env.PARSE_JAVASCRIPT_KEY,
  process.env.PARSE_MASTER_KEY || 'AMEXING_DEV_MASTER_KEY'
);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

async function testWalkingTours() {
  try {
    console.log('🔍 Testing walking tours functionality...');
    
    // 1. Check if isWalkingTour field exists and is properly set
    console.log('\n1. Checking Tour records...');
    
    const allToursQuery = new Parse.Query('Tour');
    allToursQuery.include('destinationPOI');
    allToursQuery.limit(10); // Just test first 10
    
    const allTours = await allToursQuery.find({ useMasterKey: true });
    console.log(`   Found ${allTours.length} tours total`);
    
    let walkingTourCount = 0;
    let vehicleTourCount = 0;
    let missingFieldCount = 0;
    
    allTours.forEach(tour => {
      const destinationName = tour.get('destinationPOI')?.get('name') || 'Unknown';
      const isWalkingTour = tour.get('isWalkingTour');
      
      if (isWalkingTour === undefined) {
        missingFieldCount++;
        console.log(`   ⚠️  Missing isWalkingTour field: ${destinationName}`);
      } else if (isWalkingTour === true) {
        walkingTourCount++;
        console.log(`   🚶 Walking tour: ${destinationName}`);
      } else {
        vehicleTourCount++;
        console.log(`   🚗 Vehicle tour: ${destinationName}`);
      }
    });
    
    console.log(`\n   Summary:`);
    console.log(`   - Walking tours: ${walkingTourCount}`);
    console.log(`   - Vehicle tours: ${vehicleTourCount}`);
    console.log(`   - Missing isWalkingTour field: ${missingFieldCount}`);
    
    // 2. Test API endpoint filtering
    console.log('\n2. Testing API filtering...');
    
    // Test walking tours filter
    const walkingToursQuery = new Parse.Query('Tour');
    walkingToursQuery.equalTo('isWalkingTour', true);
    walkingToursQuery.equalTo('exists', true);
    const walkingTours = await walkingToursQuery.find({ useMasterKey: true });
    console.log(`   Walking tours via API filter: ${walkingTours.length}`);
    
    // Test vehicle tours filter
    const vehicleToursQuery = new Parse.Query('Tour');
    vehicleToursQuery.notEqualTo('isWalkingTour', true);
    vehicleToursQuery.equalTo('exists', true);
    const vehicleTours = await vehicleToursQuery.find({ useMasterKey: true });
    console.log(`   Vehicle tours via API filter: ${vehicleTours.length}`);
    
    // 3. Test client pricing integration
    console.log('\n3. Testing client pricing integration...');
    
    // Find a sample client
    const clientQuery = new Parse.Query('AmexingUser');
    clientQuery.equalTo('role', 'client');
    clientQuery.equalTo('exists', true);
    clientQuery.limit(1);
    
    const sampleClient = await clientQuery.first({ useMasterKey: true });
    if (sampleClient) {
      console.log(`   Sample client found: ${sampleClient.get('email')}`);
      
      // Check for client prices
      const clientPricesQuery = new Parse.Query('ClientPrices');
      const clientPointer = new (Parse.Object.extend('AmexingUser'))();
      clientPointer.id = sampleClient.id;
      
      clientPricesQuery.equalTo('clientPtr', clientPointer);
      clientPricesQuery.equalTo('itemType', 'TOUR');
      clientPricesQuery.equalTo('exists', true);
      clientPricesQuery.equalTo('active', true);
      
      const clientPrices = await clientPricesQuery.find({ useMasterKey: true });
      console.log(`   Client-specific tour prices: ${clientPrices.length}`);
      
      if (clientPrices.length > 0) {
        const samplePrice = clientPrices[0];
        console.log(`   Sample price: $${samplePrice.get('precio')} for tour ${samplePrice.get('itemId')}`);
      }
    } else {
      console.log('   ⚠️  No client found for pricing test');
    }
    
    // 4. Summary and recommendations
    console.log('\n✅ Walking tours test completed!');
    console.log('\n📋 Summary:');
    console.log(`   - Migration status: ${missingFieldCount === 0 ? '✅ Complete' : '⚠️  Incomplete'}`);
    console.log(`   - API filtering: ${walkingTours.length > 0 ? '✅ Working' : '⚠️  No walking tours found'}`);
    console.log(`   - Client pricing: ${sampleClient ? '✅ Ready' : '⚠️  No test client'}`);
    
    if (missingFieldCount > 0) {
      console.log('\n🔧 Recommendation: Re-run the add-walking-tour-field.js migration script');
    }
    
    if (walkingTours.length === 0) {
      console.log('\n💡 Note: No walking tours found. You may need to manually mark some tours as walking tours');
      console.log('   Or verify that the migration script correctly identified walking tours');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the test
testWalkingTours().then(() => {
  console.log('\n🎉 Test finished successfully!');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});