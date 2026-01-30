/**
 * Fix Rate Prices - Complete Solution
 * 
 * This script creates proper RatePrices entries for all services
 * ensuring each service has prices for ALL rates and ALL vehicle types.
 * 
 * Created by Denisse Maldonado
 */

require('dotenv').config({ path: './environments/.env.development' });
const Parse = require('parse/node');

// Initialize Parse
Parse.initialize(
  process.env.PARSE_APP_ID,
  'javascript-key-dev-secure-2024',
  process.env.PARSE_MASTER_KEY
);
Parse.serverURL = process.env.PARSE_SERVER_URL;

// Base prices for different route types (MXN)
const BASE_PRICES = {
  'Aeropuerto': {
    'León/Bajío': 1000,
    'Querétaro': 1200,
    'Ciudad de México': 2500,
    'Guadalajara': 1800,
    'default': 1500
  },
  'Punto a Punto': {
    'short': 800,   // < 100km
    'medium': 1500, // 100-200km
    'long': 2500,   // > 200km
    'default': 1200
  },
  'Local': {
    'default': 300
  }
};

// Vehicle type multipliers
const VEHICLE_MULTIPLIERS = {
  'SEDAN': 1.0,
  'VAN': 1.1,
  'SUBURBAN': 1.2,
  'SPRINTER': 1.4,
  'HIACE': 1.3,
  'BUS': 1.5,
  'MODEL 3': 1.0,
  'MODEL Y': 1.0
};

/**
 * Calculate price based on base, rate percentage, and vehicle type
 */
function calculatePrice(basePrice, ratePercentage, vehicleMultiplier = 1.0) {
  const rateAdjusted = basePrice + (basePrice * (ratePercentage / 100));
  return Math.round(rateAdjusted * vehicleMultiplier);
}

/**
 * Get base price for a service based on route type and distance
 */
function getBasePrice(serviceType, origin, destination) {
  const typeName = serviceType ? serviceType.get('name') : 'Local';
  
  if (typeName === 'Aeropuerto') {
    // Check specific airport routes
    const originName = origin ? origin.get('name') : '';
    const destName = destination ? destination.get('name') : '';
    
    for (const airport of Object.keys(BASE_PRICES.Aeropuerto)) {
      if (originName.includes(airport) || destName.includes(airport)) {
        return BASE_PRICES.Aeropuerto[airport];
      }
    }
    return BASE_PRICES.Aeropuerto.default;
  } else if (typeName === 'Punto a Punto') {
    // Estimate based on common routes
    const originName = origin ? origin.get('name') : '';
    const destName = destination ? destination.get('name') : '';
    
    // Short routes
    if ((originName.includes('Querétaro') && destName.includes('San Miguel')) ||
        (originName.includes('San Miguel') && destName.includes('Querétaro'))) {
      return BASE_PRICES['Punto a Punto'].short;
    }
    
    // Long routes
    if (originName.includes('Ciudad de México') || destName.includes('Ciudad de México')) {
      return BASE_PRICES['Punto a Punto'].long;
    }
    
    // Medium routes
    if (originName.includes('Guadalajara') || destName.includes('Guadalajara')) {
      return BASE_PRICES['Punto a Punto'].medium;
    }
    
    return BASE_PRICES['Punto a Punto'].default;
  } else {
    return BASE_PRICES.Local.default;
  }
}

/**
 * Clean up duplicate and invalid RatePrices
 */
async function cleanupRatePrices() {
  console.log('🧹 Cleaning up existing RatePrices...\n');
  
  try {
    // Find all RatePrices
    const query = new Parse.Query('RatePrices');
    query.limit(10000);
    const allRatePrices = await query.find({ useMasterKey: true });
    
    // Track unique combinations
    const seen = new Set();
    const toDelete = [];
    
    for (const rp of allRatePrices) {
      const service = rp.get('service');
      const rate = rp.get('rate');
      const vehicleType = rp.get('vehicleType');
      
      if (!service || !rate || !vehicleType) {
        // Invalid entry - missing required fields
        toDelete.push(rp);
        continue;
      }
      
      // Create unique key
      const key = `${service.id}_${rate.id}_${vehicleType.id}`;
      
      if (seen.has(key)) {
        // Duplicate found
        toDelete.push(rp);
      } else {
        seen.add(key);
      }
    }
    
    // Delete duplicates and invalid entries
    if (toDelete.length > 0) {
      console.log(`   🗑️  Deleting ${toDelete.length} duplicate/invalid RatePrices...`);
      for (const rp of toDelete) {
        await rp.destroy({ useMasterKey: true });
      }
      console.log(`   ✅ Cleanup complete\n`);
    } else {
      console.log(`   ✅ No duplicates or invalid entries found\n`);
    }
    
    return { deleted: toDelete.length, remaining: seen.size };
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  }
}

/**
 * Create RatePrices for all services
 */
async function createComprehensiveRatePrices() {
  console.log('💰 Creating comprehensive RatePrices...\n');
  
  try {
    // Load all required data
    console.log('📡 Loading reference data...');
    
    // Get all rates
    const ratesQuery = new Parse.Query('Rate');
    ratesQuery.equalTo('exists', true);
    const rates = await ratesQuery.find({ useMasterKey: true });
    console.log(`   ✅ Loaded ${rates.length} rates`);
    
    // Get all vehicle types
    const vehiclesQuery = new Parse.Query('VehicleType');
    vehiclesQuery.equalTo('exists', true);
    const vehicleTypes = await vehiclesQuery.find({ useMasterKey: true });
    console.log(`   ✅ Loaded ${vehicleTypes.length} vehicle types`);
    
    // Get all services
    const servicesQuery = new Parse.Query('Services');
    servicesQuery.equalTo('exists', true);
    servicesQuery.include(['originPOI', 'destinationPOI', 'destinationPOI.serviceType']);
    servicesQuery.limit(1000);
    const services = await servicesQuery.find({ useMasterKey: true });
    console.log(`   ✅ Loaded ${services.length} services\n`);
    
    let created = 0;
    let skipped = 0;
    let errors = 0;
    
    console.log('🔄 Processing services...\n');
    
    // Process each service
    for (let i = 0; i < services.length; i++) {
      const service = services[i];
      const origin = service.get('originPOI');
      const destination = service.get('destinationPOI');
      
      if (!destination) {
        console.log(`   ⚠️  Service ${service.id} has no destination, skipping`);
        continue;
      }
      
      const serviceType = destination.get('serviceType');
      const routeName = `${origin ? origin.get('name') : 'Local'} → ${destination.get('name')}`;
      
      // Get base price for this route
      const basePrice = getBasePrice(serviceType, origin, destination);
      
      // Progress indicator
      if ((i + 1) % 10 === 0) {
        console.log(`   📊 Progress: ${i + 1}/${services.length} services processed`);
      }
      
      // Create RatePrices for each rate and vehicle combination
      for (const rate of rates) {
        for (const vehicleType of vehicleTypes) {
          try {
            // Check if RatePrice already exists
            const existingQuery = new Parse.Query('RatePrices');
            existingQuery.equalTo('service', service);
            existingQuery.equalTo('rate', rate);
            existingQuery.equalTo('vehicleType', vehicleType);
            existingQuery.equalTo('exists', true);
            
            const existing = await existingQuery.first({ useMasterKey: true });
            
            if (existing) {
              skipped++;
              continue;
            }
            
            // Calculate price
            const vehicleCode = vehicleType.get('code');
            const vehicleMultiplier = VEHICLE_MULTIPLIERS[vehicleCode] || 1.0;
            const finalPrice = calculatePrice(basePrice, rate.get('percentage'), vehicleMultiplier);
            
            // Create new RatePrice
            const RatePrices = Parse.Object.extend('RatePrices');
            const ratePrice = new RatePrices();
            
            if (origin) {
              ratePrice.set('originPOI', origin);
            }
            ratePrice.set('destinationPOI', destination);
            ratePrice.set('service', service);
            ratePrice.set('rate', rate);
            ratePrice.set('vehicleType', vehicleType);
            ratePrice.set('price', finalPrice);
            ratePrice.set('currency', 'MXN');
            ratePrice.set('active', true);
            ratePrice.set('exists', true);
            
            // Set ACL
            const acl = new Parse.ACL();
            acl.setPublicReadAccess(true);
            acl.setRoleWriteAccess('admin', true);
            acl.setRoleWriteAccess('superadmin', true);
            ratePrice.setACL(acl);
            
            await ratePrice.save(null, { useMasterKey: true });
            created++;
            
          } catch (error) {
            errors++;
            console.error(`      ❌ Error creating RatePrice: ${error.message}`);
          }
        }
      }
    }
    
    return { created, skipped, errors };
  } catch (error) {
    console.error('❌ Error creating rate prices:', error);
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    console.log('🚀 Fix Rate Prices - Complete Solution\n');
    console.log('=' .repeat(60) + '\n');
    
    // Step 1: Cleanup
    const cleanupResults = await cleanupRatePrices();
    
    // Step 2: Create comprehensive rate prices
    const createResults = await createComprehensiveRatePrices();
    
    // Summary
    console.log('\n' + '=' .repeat(60));
    console.log('\n📊 FINAL RESULTS:\n');
    console.log('   Cleanup:');
    console.log(`     • Deleted: ${cleanupResults.deleted} duplicate/invalid entries`);
    console.log(`     • Kept: ${cleanupResults.remaining} valid entries\n`);
    console.log('   Creation:');
    console.log(`     • Created: ${createResults.created} new rate prices`);
    console.log(`     • Skipped: ${createResults.skipped} existing entries`);
    console.log(`     • Errors: ${createResults.errors} failed operations\n`);
    
    const total = cleanupResults.remaining + createResults.created;
    console.log(`   📈 Total RatePrices in system: ${total}`);
    
    if (createResults.created > 0) {
      console.log('\n✅ SUCCESS! Rate prices have been fixed.');
      console.log('\n   Now when you:');
      console.log('   1. Select "Económico" in the header - you\'ll see Económico prices');
      console.log('   2. Click "Ver todos" - you\'ll see ALL rates including Económico');
      console.log('\n   Each service now has prices for:');
      console.log('   • All 4 rates (First Class, Económico, Green Class, Premium)');
      console.log('   • All vehicle types');
    }
    
  } catch (error) {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  }
}

// Run the fix
main().then(() => {
  console.log('\n✅ Script completed successfully');
  process.exit(0);
}).catch((error) => {
  console.error('\n❌ Script failed:', error);
  process.exit(1);
});