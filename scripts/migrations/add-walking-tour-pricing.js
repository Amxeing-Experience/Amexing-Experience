/**
 * Migration: Add Walking Tour Pricing Fields
 * Adds group-based pricing fields to Tour table for walking tours
 * 
 * Fields added:
 * - walkingPriceSmall: Number (1-5 pax pricing)
 * - walkingPriceMedium: Number (6-10 pax pricing) 
 * - walkingPriceLarge: Number (11-15 pax pricing)
 * - walkingPriceCurrency: String (default: 'MXN')
 * - walkingRangeSmall: String (1-5 pax)
 * - walkingRangeMedium: String (6-10 pax)
 * - walkingRangeLarge: String (11-15 pax)
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

// Default walking tour pricing structure (in MXN)
const DEFAULT_WALKING_PRICES = {
  small: 1050,   // 1-5 pax
  medium: 2100,  // 6-10 pax (double)
  large: 3150,   // 11-15 pax (triple)
  currency: 'MXN',
  smallRange: '1-5 pax',
  mediumRange: '6-10 pax',
  largeRange: '11-15 pax'
};

async function addWalkingTourPricingFields() {
  try {
    console.log('🚶 Starting walking tour pricing migration...');
    
    // 1. Get all tours (both walking and vehicle)
    console.log('\n1. Fetching all tour records...');
    const allToursQuery = new Parse.Query('Tour');
    allToursQuery.include('destinationPOI');
    allToursQuery.limit(1000); // Adjust if you have more tours
    
    const allTours = await allToursQuery.find({ useMasterKey: true });
    console.log(`   Found ${allTours.length} tours total`);
    
    // 2. Separate walking tours from vehicle tours
    const walkingTours = allTours.filter(tour => tour.get('isWalkingTour') === true);
    const vehicleTours = allTours.filter(tour => tour.get('isWalkingTour') !== true);
    
    console.log(`   - Walking tours: ${walkingTours.length}`);
    console.log(`   - Vehicle tours: ${vehicleTours.length}`);
    
    // 3. Add pricing fields to walking tours
    console.log('\n2. Adding pricing fields to walking tours...');
    
    let walkingUpdated = 0;
    let walkingSkipped = 0;
    
    for (const tour of walkingTours) {
      const destinationName = tour.get('destinationPOI')?.get('name') || 'Unknown';
      
      // Check if pricing fields already exist
      const hasExistingPricing = tour.get('walkingPriceSmall') !== undefined ||
                                tour.get('walkingPriceMedium') !== undefined ||
                                tour.get('walkingPriceLarge') !== undefined ||
                                tour.get('walkingRangeSmall') !== undefined;
      
      if (hasExistingPricing) {
        console.log(`   ⏭️  Skipping ${destinationName} (pricing already exists)`);
        walkingSkipped++;
        continue;
      }
      
      // Set default walking tour pricing and ranges
      tour.set('walkingPriceSmall', DEFAULT_WALKING_PRICES.small);
      tour.set('walkingPriceMedium', DEFAULT_WALKING_PRICES.medium);
      tour.set('walkingPriceLarge', DEFAULT_WALKING_PRICES.large);
      tour.set('walkingPriceCurrency', DEFAULT_WALKING_PRICES.currency);
      tour.set('walkingRangeSmall', DEFAULT_WALKING_PRICES.smallRange);
      tour.set('walkingRangeMedium', DEFAULT_WALKING_PRICES.mediumRange);
      tour.set('walkingRangeLarge', DEFAULT_WALKING_PRICES.largeRange);
      
      try {
        await tour.save(null, { useMasterKey: true });
        console.log(`   ✅ Updated ${destinationName} with walking tour pricing`);
        walkingUpdated++;
      } catch (error) {
        console.error(`   ❌ Failed to update ${destinationName}:`, error.message);
      }
    }
    
    // 4. Set walking pricing fields to null for vehicle tours (for clarity)
    console.log('\n3. Ensuring vehicle tours have null walking pricing...');
    
    let vehicleUpdated = 0;
    let vehicleSkipped = 0;
    
    for (const tour of vehicleTours) {
      const destinationName = tour.get('destinationPOI')?.get('name') || 'Unknown';
      
      // Check if tour already has null pricing fields
      const hasNullPricing = tour.get('walkingPriceSmall') === null &&
                            tour.get('walkingPriceMedium') === null &&
                            tour.get('walkingPriceLarge') === null &&
                            tour.get('walkingRangeSmall') === null;
      
      if (hasNullPricing || (
          tour.get('walkingPriceSmall') === undefined &&
          tour.get('walkingPriceMedium') === undefined &&
          tour.get('walkingPriceLarge') === undefined &&
          tour.get('walkingRangeSmall') === undefined
        )) {
        console.log(`   ⏭️  Skipping ${destinationName} (already correct)`);
        vehicleSkipped++;
        continue;
      }
      
      // Explicitly set to null for vehicle tours
      tour.set('walkingPriceSmall', null);
      tour.set('walkingPriceMedium', null);
      tour.set('walkingPriceLarge', null);
      tour.set('walkingPriceCurrency', null);
      tour.set('walkingRangeSmall', null);
      tour.set('walkingRangeMedium', null);
      tour.set('walkingRangeLarge', null);
      
      try {
        await tour.save(null, { useMasterKey: true });
        console.log(`   ✅ Set ${destinationName} walking prices to null`);
        vehicleUpdated++;
      } catch (error) {
        console.error(`   ❌ Failed to update ${destinationName}:`, error.message);
      }
    }
    
    // 5. Verification
    console.log('\n4. Verification...');
    
    // Re-query to verify changes
    const verificationQuery = new Parse.Query('Tour');
    verificationQuery.include('destinationPOI');
    const verifiedTours = await verificationQuery.find({ useMasterKey: true });
    
    let walkingWithPricing = 0;
    let vehicleWithoutPricing = 0;
    let inconsistencies = 0;
    
    verifiedTours.forEach(tour => {
      const isWalking = tour.get('isWalkingTour') === true;
      const hasWalkingPricing = tour.get('walkingPriceSmall') !== null && 
                               tour.get('walkingPriceSmall') !== undefined;
      
      if (isWalking && hasWalkingPricing) {
        walkingWithPricing++;
      } else if (!isWalking && !hasWalkingPricing) {
        vehicleWithoutPricing++;
      } else {
        inconsistencies++;
        const name = tour.get('destinationPOI')?.get('name') || 'Unknown';
        console.log(`   ⚠️  Inconsistency: ${name} - isWalking: ${isWalking}, hasPricing: ${hasWalkingPricing}`);
      }
    });
    
    console.log(`\n   ✅ Walking tours with pricing: ${walkingWithPricing}`);
    console.log(`   ✅ Vehicle tours without walking pricing: ${vehicleWithoutPricing}`);
    console.log(`   ⚠️  Inconsistencies found: ${inconsistencies}`);
    
    // 6. Summary and next steps
    console.log('\n🎉 Walking tour pricing migration completed!');
    console.log('\n📋 Summary:');
    console.log(`   - Walking tours updated: ${walkingUpdated}`);
    console.log(`   - Walking tours skipped: ${walkingSkipped}`);
    console.log(`   - Vehicle tours updated: ${vehicleUpdated}`);
    console.log(`   - Vehicle tours skipped: ${vehicleSkipped}`);
    console.log(`   - Inconsistencies: ${inconsistencies}`);
    
    if (inconsistencies > 0) {
      console.log('\n🔧 Recommendation: Review inconsistencies above');
    }
    
    console.log('\n📝 Next steps:');
    console.log('   1. Update walking tours component to use new Tour pricing fields');
    console.log('   2. Test walking tour pricing display in frontend');
    console.log('   3. Remove hardcoded pricing from walking-tours-section.ejs');
    
    console.log('\n💡 New Tour schema:');
    console.log('   - walkingPriceSmall: Number (1-5 pax)');
    console.log('   - walkingPriceMedium: Number (6-10 pax)');
    console.log('   - walkingPriceLarge: Number (11-15 pax)');
    console.log('   - walkingPriceCurrency: String ("MXN")');
    console.log('   - walkingRangeSmall: String ("1-5 pax")');
    console.log('   - walkingRangeMedium: String ("6-10 pax")');
    console.log('   - walkingRangeLarge: String ("11-15 pax")');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the migration
addWalkingTourPricingFields().then(() => {
  console.log('\n✨ Migration finished successfully!');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});