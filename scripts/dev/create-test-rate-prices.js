/**
 * Create Test Rate Prices for Development Environment
 * 
 * This script creates test data in the RatePrices table with different rates
 * to demonstrate pricing variations across rate tiers.
 * 
 * The RatePrices table stores pricing for each combination of:
 * - Service (route)
 * - Rate (First Class, Económico, Green Class, Premium)
 * - Vehicle Type (SEDAN, VAN, SUBURBAN, etc.)
 * 
 * Created by Denisse Maldonado
 * 
 * @author Amexing Development Team
 * @version 1.0.0
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

// Test routes with base prices
const TEST_ROUTES = [
  {
    origin: 'Querétaro',
    destination: 'San Miguel de Allende',
    serviceType: 'Punto a Punto',
    basePrice: 800,
    description: 'Popular short route'
  },
  {
    origin: 'Guadalajara',
    destination: 'San Miguel de Allende',
    serviceType: 'Punto a Punto',
    basePrice: 1500,
    description: 'Long distance route'
  },
  {
    origin: 'León/Bajío',
    destination: 'San Miguel de Allende',
    serviceType: 'Aeropuerto',
    basePrice: 1000,
    description: 'Airport transfer'
  },
  {
    origin: null,
    destination: 'Centro Histórico',
    serviceType: 'Local',
    basePrice: 300,
    description: 'Local city transfer'
  },
  {
    origin: 'Ciudad de México',
    destination: 'San Miguel de Allende',
    serviceType: 'Punto a Punto',
    basePrice: 2000,
    description: 'Capital to San Miguel'
  }
];

// Vehicle type pricing multipliers
const VEHICLE_MULTIPLIERS = {
  'SEDAN': 1.0,
  'VAN': 1.1,
  'SUBURBAN': 1.2,
  'HIACE': 1.3,
  'SPRINTER': 1.4,
  'BUS': 1.5
};

/**
 * Calculate price with rate percentage and vehicle multiplier
 */
function calculatePrice(basePrice, ratePercentage, vehicleMultiplier = 1.0) {
  const rateAdjustedPrice = basePrice + (basePrice * (ratePercentage / 100));
  return Math.round(rateAdjustedPrice * vehicleMultiplier);
}

/**
 * Load reference data from database
 */
async function loadReferenceData() {
  console.log('🔄 Loading reference data...\n');

  try {
    // Load Rates
    const ratesQuery = new Parse.Query('Rate');
    ratesQuery.equalTo('exists', true);
    const rates = await ratesQuery.find({ useMasterKey: true });
    console.log(`   ✅ Loaded ${rates.length} rates: ${rates.map(r => `${r.get('name')} (${r.get('percentage')}%)`).join(', ')}`);

    // Load Vehicle Types
    const vehicleTypesQuery = new Parse.Query('VehicleType');
    vehicleTypesQuery.equalTo('exists', true);
    const vehicleTypes = await vehicleTypesQuery.find({ useMasterKey: true });
    console.log(`   ✅ Loaded ${vehicleTypes.length} vehicle types: ${vehicleTypes.map(v => v.get('code')).join(', ')}`);

    // Load Service Types
    const serviceTypesQuery = new Parse.Query('ServiceType');
    serviceTypesQuery.equalTo('exists', true);
    const serviceTypes = await serviceTypesQuery.find({ useMasterKey: true });
    const serviceTypesMap = {};
    serviceTypes.forEach(st => {
      serviceTypesMap[st.get('name')] = st;
    });
    console.log(`   ✅ Loaded ${serviceTypes.length} service types`);

    // Load POIs
    const poisQuery = new Parse.Query('POI');
    poisQuery.equalTo('exists', true);
    poisQuery.include('serviceType');
    poisQuery.limit(1000);
    const pois = await poisQuery.find({ useMasterKey: true });
    console.log(`   ✅ Loaded ${pois.length} POIs\n`);

    return { rates, vehicleTypes, serviceTypesMap, pois };
  } catch (error) {
    console.error('❌ Error loading reference data:', error);
    throw error;
  }
}

/**
 * Find or create service in Services table
 */
async function findOrCreateService(originPOI, destinationPOI, rate) {
  try {
    // Check if service exists
    const query = new Parse.Query('Services');
    if (originPOI) {
      query.equalTo('originPOI', originPOI);
    } else {
      query.doesNotExist('originPOI');
    }
    query.equalTo('destinationPOI', destinationPOI);
    query.equalTo('rate', rate);
    query.equalTo('exists', true);
    
    let service = await query.first({ useMasterKey: true });
    
    if (!service) {
      // Create new service
      const Services = Parse.Object.extend('Services');
      service = new Services();
      
      if (originPOI) {
        service.set('originPOI', originPOI);
      }
      service.set('destinationPOI', destinationPOI);
      service.set('rate', rate);
      service.set('note', 'Test service for rate pricing demo');
      service.set('active', true);
      service.set('exists', true);
      
      // Set ACL
      const acl = new Parse.ACL();
      acl.setPublicReadAccess(true);
      acl.setRoleWriteAccess('admin', true);
      acl.setRoleWriteAccess('superadmin', true);
      service.setACL(acl);
      
      await service.save(null, { useMasterKey: true });
      console.log(`     📝 Created new service: ${originPOI ? originPOI.get('name') : 'Local'} → ${destinationPOI.get('name')}`);
    }
    
    return service;
  } catch (error) {
    console.error('Error finding/creating service:', error);
    throw error;
  }
}

/**
 * Create rate prices for test routes
 */
async function createRatePrices(referenceData) {
  const { rates, vehicleTypes, pois } = referenceData;
  
  console.log('💰 Creating Rate Prices...\n');
  
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const route of TEST_ROUTES) {
    console.log(`🛣️  Processing: ${route.origin || 'Local'} → ${route.destination}`);
    console.log(`   ${route.description}`);
    
    // Find POIs
    let originPOI = null;
    let destinationPOI = null;
    
    // Find origin POI if specified
    if (route.origin) {
      originPOI = pois.find(poi => {
        const serviceType = poi.get('serviceType');
        return poi.get('name') === route.origin && 
               serviceType && serviceType.get('name') === route.serviceType;
      });
      
      if (!originPOI) {
        console.log(`   ⚠️  Origin POI not found: ${route.origin} (${route.serviceType})`);
        continue;
      }
    }
    
    // Find destination POI
    destinationPOI = pois.find(poi => {
      const serviceType = poi.get('serviceType');
      return poi.get('name') === route.destination && 
             serviceType && serviceType.get('name') === route.serviceType;
    });
    
    if (!destinationPOI) {
      console.log(`   ⚠️  Destination POI not found: ${route.destination} (${route.serviceType})`);
      continue;
    }
    
    // Process each rate
    for (const rate of rates) {
      console.log(`   \n   📊 Rate: ${rate.get('name')} (${rate.get('percentage')}%)`);
      
      // Find or create service for this route and rate
      const service = await findOrCreateService(originPOI, destinationPOI, rate);
      
      // Create rate prices for each vehicle type
      for (const vehicleType of vehicleTypes) {
        const vehicleCode = vehicleType.get('code');
        const vehicleMultiplier = VEHICLE_MULTIPLIERS[vehicleCode] || 1.0;
        
        try {
          // Check if rate price already exists
          const existingQuery = new Parse.Query('RatePrices');
          existingQuery.equalTo('service', service);
          existingQuery.equalTo('rate', rate);
          existingQuery.equalTo('vehicleType', vehicleType);
          existingQuery.equalTo('exists', true);
          
          let ratePrice = await existingQuery.first({ useMasterKey: true });
          
          // Calculate final price
          const finalPrice = calculatePrice(route.basePrice, rate.get('percentage'), vehicleMultiplier);
          
          if (ratePrice) {
            // Update existing price if different
            const currentPrice = ratePrice.get('price');
            if (Math.abs(currentPrice - finalPrice) > 0.01) {
              ratePrice.set('price', finalPrice);
              await ratePrice.save(null, { useMasterKey: true });
              updated++;
              console.log(`      📝 Updated ${vehicleCode}: $${currentPrice} → $${finalPrice}`);
            } else {
              skipped++;
            }
          } else {
            // Create new rate price
            const RatePrices = Parse.Object.extend('RatePrices');
            ratePrice = new RatePrices();
            
            if (originPOI) {
              ratePrice.set('originPOI', originPOI);
            }
            ratePrice.set('destinationPOI', destinationPOI);
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
            console.log(`      ✅ Created ${vehicleCode}: $${finalPrice.toLocaleString('es-MX')} MXN`);
          }
          
        } catch (error) {
          errors++;
          console.log(`      ❌ Error with ${vehicleCode}: ${error.message}`);
        }
      }
    }
    
    console.log(''); // Empty line for readability
  }
  
  return { created, updated, skipped, errors };
}

/**
 * Main execution function
 */
async function main() {
  try {
    console.log('🏗️  Creating Test Rate Prices for Development\n');
    console.log('   This script populates the RatePrices table with different pricing');
    console.log('   for each combination of service route, rate tier, and vehicle type.\n');
    
    // Load reference data
    const referenceData = await loadReferenceData();
    
    // Create rate prices
    const results = await createRatePrices(referenceData);
    
    console.log('📊 RESULTS:');
    console.log(`   ✅ Created: ${results.created} new rate prices`);
    console.log(`   📝 Updated: ${results.updated} existing prices`);
    console.log(`   ⏭️  Skipped: ${results.skipped} unchanged prices`);
    console.log(`   ❌ Errors: ${results.errors} failed operations`);
    console.log(`   📈 Total processed: ${results.created + results.updated + results.skipped + results.errors}`);
    
    if (results.created > 0 || results.updated > 0) {
      console.log('\n🎉 Rate prices created/updated successfully!');
      console.log('\n   Price variations by rate:');
      console.log('   • First Class: +1% (lowest markup)');
      console.log('   • Económico: +5%');
      console.log('   • Green Class: +10%');
      console.log('   • Premium: +20% (highest markup)');
      console.log('\n   Price variations by vehicle:');
      console.log('   • SEDAN: Base price');
      console.log('   • VAN: +10%');
      console.log('   • SUBURBAN: +20%');
      console.log('   • HIACE: +30%');
      console.log('   • SPRINTER: +40%');
      console.log('   • BUS: +50%');
      console.log('\n   Check your admin dashboard to see the pricing matrix!');
    } else if (results.skipped > 0) {
      console.log('\n ℹ️  All rate prices are already up to date.');
    }
    
  } catch (error) {
    console.error('\n❌ Error creating rate prices:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main()
    .then(() => {
      console.log('\n✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { main };