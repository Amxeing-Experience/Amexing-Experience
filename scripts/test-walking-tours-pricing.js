/**
 * Test script to verify walking tours pricing functionality
 * Tests the new Tour pricing fields and API integration
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

async function testWalkingToursPricing() {
  try {
    console.log('💰 Testing walking tours pricing functionality...');
    
    // 1. Test direct Tour pricing fields
    console.log('\n1. Testing Tour pricing fields...');
    
    const walkingQuery = new Parse.Query('Tour');
    walkingQuery.equalTo('isWalkingTour', true);
    walkingQuery.equalTo('exists', true);
    walkingQuery.include('destinationPOI');
    
    const walkingTours = await walkingQuery.find({ useMasterKey: true });
    console.log(`   Found ${walkingTours.length} walking tours`);
    
    walkingTours.forEach(tour => {
      const name = tour.get('destinationPOI')?.get('name') || 'Unknown';
      const small = tour.get('walkingPriceSmall');
      const medium = tour.get('walkingPriceMedium');
      const large = tour.get('walkingPriceLarge');
      const currency = tour.get('walkingPriceCurrency');
      
      console.log(`\n   🚶 ${name}:`);
      console.log(`      - Small (1-5 pax): $${small?.toLocaleString() || 'N/A'} ${currency || 'N/A'}`);
      console.log(`      - Medium (6-10 pax): $${medium?.toLocaleString() || 'N/A'} ${currency || 'N/A'}`);
      console.log(`      - Large (11-15 pax): $${large?.toLocaleString() || 'N/A'} ${currency || 'N/A'}`);
      
      // Validate pricing logic
      if (small && medium && large) {
        const expectedMedium = small * 2;
        const expectedLarge = small * 3;
        
        const mediumCorrect = medium === expectedMedium;
        const largeCorrect = large === expectedLarge;
        
        console.log(`      - Pricing logic: ${mediumCorrect && largeCorrect ? '✅ Correct' : '⚠️ Check ratios'}`);
        
        if (!mediumCorrect) {
          console.log(`        * Medium should be $${expectedMedium.toLocaleString()}, got $${medium.toLocaleString()}`);
        }
        if (!largeCorrect) {
          console.log(`        * Large should be $${expectedLarge.toLocaleString()}, got $${large.toLocaleString()}`);
        }
      } else {
        console.log(`      - Status: ❌ Missing pricing fields`);
      }
    });
    
    // 2. Test API integration with new pricing
    console.log('\n2. Testing API integration...');
    
    // Simulate the frontend pricing function
    function testGetWalkingTourPricing(tourData) {
      const defaultPricing = {
        small: '$1,050 MXN',
        medium: '$2,100 MXN',
        large: '$3,150 MXN',
        hasTourPricing: false
      };
      
      // Use Tour's built-in walking pricing fields
      if (tourData.walkingPriceSmall && tourData.walkingPriceMedium && tourData.walkingPriceLarge) {
        const currency = tourData.walkingPriceCurrency || 'MXN';
        
        return {
          small: `$${tourData.walkingPriceSmall.toLocaleString()} ${currency}`,
          medium: `$${tourData.walkingPriceMedium.toLocaleString()} ${currency}`,
          large: `$${tourData.walkingPriceLarge.toLocaleString()} ${currency}`,
          hasTourPricing: true
        };
      }
      
      return defaultPricing;
    }
    
    // Test the pricing logic for each walking tour
    walkingTours.forEach(tour => {
      const name = tour.get('destinationPOI')?.get('name') || 'Unknown';
      
      // Convert to plain object (simulating API response)
      const tourData = {
        walkingPriceSmall: tour.get('walkingPriceSmall'),
        walkingPriceMedium: tour.get('walkingPriceMedium'),
        walkingPriceLarge: tour.get('walkingPriceLarge'),
        walkingPriceCurrency: tour.get('walkingPriceCurrency')
      };
      
      const pricing = testGetWalkingTourPricing(tourData);
      
      console.log(`\n   Frontend pricing test for ${name}:`);
      console.log(`      - Small group: ${pricing.small}`);
      console.log(`      - Medium group: ${pricing.medium}`);
      console.log(`      - Large group: ${pricing.large}`);
      console.log(`      - Using tour pricing: ${pricing.hasTourPricing ? '✅ Yes' : '❌ No (fallback)'}`);
    });
    
    // 3. Test API endpoint response format
    console.log('\n3. Testing API endpoint...');
    
    try {
      // Make a request to the API endpoint to check response format
      const fetch = require('node-fetch');
      const response = await fetch('http://localhost:1337/api/tours?tourType=walking', {
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      
      if (response.ok) {
        const apiData = await response.json();
        console.log(`   ✅ API endpoint responsive`);
        console.log(`   - Tours returned: ${apiData.data?.length || 0}`);
        
        if (apiData.data && apiData.data.length > 0) {
          const sampleTour = apiData.data[0];
          console.log(`   - Sample tour fields:`, Object.keys(sampleTour).join(', '));
          
          // Check if new pricing fields are included
          const hasPricingFields = sampleTour.walkingPriceSmall !== undefined;
          console.log(`   - Has walking price fields: ${hasPricingFields ? '✅ Yes' : '❌ No'}`);
        }
      } else {
        console.log(`   ❌ API endpoint error: ${response.status}`);
      }
    } catch (apiError) {
      console.log(`   ⚠️  API test failed: ${apiError.message}`);
    }
    
    // 4. Summary and recommendations
    console.log('\n💰 Walking tour pricing test completed!');
    console.log('\n📋 Summary:');
    
    const hasPricingTours = walkingTours.filter(tour => 
      tour.get('walkingPriceSmall') && 
      tour.get('walkingPriceMedium') && 
      tour.get('walkingPriceLarge')
    ).length;
    
    console.log(`   - Walking tours with pricing: ${hasPricingTours}/${walkingTours.length}`);
    console.log(`   - Migration status: ${hasPricingTours === walkingTours.length ? '✅ Complete' : '⚠️  Incomplete'}`);
    console.log(`   - Frontend integration: ${hasPricingTours > 0 ? '✅ Ready' : '❌ Needs setup'}`);
    
    if (hasPricingTours < walkingTours.length) {
      console.log('\n🔧 Recommendation: Re-run the add-walking-tour-pricing.js migration script');
    }
    
    if (hasPricingTours > 0) {
      console.log('\n🎉 Next steps:');
      console.log('   1. Deploy changes to production');
      console.log('   2. Run migration script on production server');
      console.log('   3. Verify walking tours display correct pricing');
      console.log('   4. Walking tours will show "Precio oficial" badge');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the test
testWalkingToursPricing().then(() => {
  console.log('\n🎊 Test finished successfully!');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});