/**
 * Test script to check tour data in database
 * @author Denisse Maldonado
 */

const Parse = require('parse/node');
require('dotenv').config({ path: 'environments/.env.development' });

// Initialize Parse
Parse.initialize(
  process.env.PARSE_APP_ID,
  process.env.PARSE_JAVASCRIPT_KEY,
  process.env.PARSE_MASTER_KEY
);
Parse.serverURL = process.env.PARSE_SERVER_URL;

async function testTourData() {
  try {
    console.log('🔍 Testing Tour data retrieval...\n');
    
    // Query for Atotonilco tour
    const tourQuery = new Parse.Query('Tour');
    tourQuery.include(['destinationPOI']);
    const tours = await tourQuery.find({ useMasterKey: true });
    
    // Find Atotonilco tour
    const atotonilcoTour = tours.find(tour => {
      const poi = tour.get('destinationPOI');
      return poi && poi.get('name') === 'Atotonilco';
    });
    
    if (atotonilcoTour) {
      console.log('✅ Found Atotonilco tour:', atotonilcoTour.id);
      console.log('\n📊 Tour fields:');
      
      // List all fields we're checking
      const fields = [
        'description',
        'price',
        'price_child', 
        'price_no_alcohol',
        'advance_booking_time',
        'min_people',
        'max_people',
        'includes',
        'notincludes',
        'languages',
        'client_booking_notes',
        'availableDays',
        'startTime',
        'endTime'
      ];
      
      fields.forEach(field => {
        const value = atotonilcoTour.get(field);
        const hasValue = value !== undefined && value !== null;
        const displayValue = Array.isArray(value) ? 
          `[${value.join(', ')}]` : 
          (typeof value === 'object' ? JSON.stringify(value) : value);
        
        console.log(`  ${hasValue ? '✓' : '✗'} ${field}: ${hasValue ? displayValue : 'NOT SET'}`);
      });
      
      console.log('\n🔍 Raw object attributes:');
      console.log(JSON.stringify(atotonilcoTour.attributes, null, 2));
      
    } else {
      console.log('❌ Atotonilco tour not found');
      console.log('\n📋 Available tours:');
      tours.forEach(tour => {
        const poi = tour.get('destinationPOI');
        console.log(`  - ${poi?.get('name') || 'Unknown'} (${tour.id})`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testTourData()
  .then(() => {
    console.log('\n✅ Test completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Test failed:', error);
    process.exit(1);
  });