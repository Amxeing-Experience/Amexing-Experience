/**
 * Migration script to add isWalkingTour field to Tour class
 * 
 * This script adds the isWalkingTour boolean field to existing tours
 * and automatically sets it to true for tours that appear to be walking tours
 * based on naming conventions.
 * 
 * Created by Denisse Maldonado
 */

const Parse = require('parse/node');

// Load environment based on NODE_ENV
const envPath = process.env.NODE_ENV === 'production' 
  ? './environments/.env.production'
  : './environments/.env.development';
require('dotenv').config({ path: envPath });

// Initialize Parse
Parse.initialize(
  process.env.PARSE_APP_ID || 'AMEXING_DEV_APP_ID',
  process.env.PARSE_JAVASCRIPT_KEY,
  process.env.PARSE_MASTER_KEY || 'AMEXING_DEV_MASTER_KEY'
);
// Set Parse Server URL based on environment
const defaultServerURL = process.env.NODE_ENV === 'production' 
  ? 'http://localhost:1338/parse' 
  : 'http://localhost:1337/parse';
Parse.serverURL = process.env.PARSE_SERVER_URL || defaultServerURL;

async function addWalkingTourField() {
  try {
    console.log('🔄 Starting migration to add isWalkingTour field to Tour class...');
    
    // Get all tours
    const query = new Parse.Query('Tour');
    query.include('destinationPOI');
    query.limit(1000); // Process in batches
    
    let processed = 0;
    let walkingTours = 0;
    let vehicleTours = 0;
    
    const tours = await query.find({ useMasterKey: true });
    
    for (const tour of tours) {
      let needsUpdate = false;
      let isWalking = false;
      
      // Check if isWalkingTour field exists, if not add it
      if (!tour.has('isWalkingTour')) {
        // Determine if this is a walking tour based on destination name
        const destinationPOI = tour.get('destinationPOI');
        const destinationName = destinationPOI ? destinationPOI.get('name') || '' : '';
        const tourNotes = tour.get('notes') || '';
        
        // Check for walking tour indicators
        const walkingKeywords = ['walking', 'walk', 'pie', 'caminata', 'pedestrian', 'foot'];
        const searchText = `${destinationName} ${tourNotes}`.toLowerCase();
        
        isWalking = walkingKeywords.some(keyword => searchText.includes(keyword));
        
        tour.set('isWalkingTour', isWalking);
        needsUpdate = true;
        
        if (isWalking) {
          walkingTours++;
          console.log(`  ✅ Walking tour detected: ${destinationName}`);
        } else {
          vehicleTours++;
        }
      }
      
      if (needsUpdate) {
        await tour.save(null, { useMasterKey: true });
      }
      
      processed++;
      
      if (processed % 10 === 0) {
        console.log(`  Processed ${processed} tours...`);
      }
    }
    
    console.log(`\n✅ Migration complete!`);
    console.log(`📊 Results:`);
    console.log(`  - Total tours processed: ${processed}`);
    console.log(`  - Walking tours identified: ${walkingTours}`);
    console.log(`  - Vehicle tours identified: ${vehicleTours}`);
    console.log(`📝 isWalkingTour field is now available for all Tour records.`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the migration
addWalkingTourField().then(() => {
  console.log('🎉 Migration finished successfully!');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});