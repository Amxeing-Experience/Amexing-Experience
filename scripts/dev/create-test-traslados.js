/**
 * Create Test Traslados for Development Environment
 * 
 * This script creates additional test traslados (services) with all available rates
 * to ensure you can see pricing differences across different rate tiers.
 * 
 * The system has 4 rates:
 * - First Class (1%)
 * - Económico (5%) 
 * - Green Class (10%)
 * - Premium (20%)
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

// Test traslados data - common routes with base prices
const TEST_TRASLADOS = [
  {
    origin: 'León/Bajío',
    destination: 'San Miguel de Allende',
    basePrice: 1000,
    vehicleTypes: ['SEDAN', 'VAN', 'SUBURBAN'],
    serviceType: 'Punto a Punto'
  },
  {
    origin: 'Querétaro',
    destination: 'San Miguel de Allende', 
    basePrice: 800,
    vehicleTypes: ['SEDAN', 'VAN'],
    serviceType: 'Punto a Punto'
  },
  {
    origin: null, // Local service
    destination: 'San Miguel de Allende',
    basePrice: 300,
    vehicleTypes: ['SEDAN', 'VAN'],
    serviceType: 'Local'
  },
  {
    origin: 'México',
    destination: 'San Miguel de Allende',
    basePrice: 2000,
    vehicleTypes: ['SEDAN', 'VAN', 'SUBURBAN', 'HIACE'],
    serviceType: 'Punto a Punto'
  },
  {
    origin: 'Guadalajara',
    destination: 'San Miguel de Allende',
    basePrice: 1500,
    vehicleTypes: ['SEDAN', 'VAN', 'SUBURBAN'],
    serviceType: 'Punto a Punto'
  }
];

/**
 * Load reference data from database
 */
async function loadReferenceData() {
  console.log('🔄 Loading reference data...');

  try {
    // Load Rates
    const ratesQuery = new Parse.Query('Rate');
    ratesQuery.equalTo('exists', true);
    const rates = await ratesQuery.find({ useMasterKey: true });
    const ratesMap = {};
    rates.forEach(rate => {
      ratesMap[rate.get('name')] = rate;
    });
    console.log(`   ✅ Loaded ${rates.length} rates`);

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
    const poisMap = {};
    pois.forEach(poi => {
      const serviceType = poi.get('serviceType');
      const serviceTypeName = serviceType ? serviceType.get('name') : 'Unknown';
      const key = `${poi.get('name')}|${serviceTypeName}`;
      poisMap[key] = poi;
    });
    console.log(`   ✅ Loaded ${pois.length} POIs`);

    // Load Vehicle Types
    const vehicleTypesQuery = new Parse.Query('VehicleType');
    vehicleTypesQuery.equalTo('exists', true);
    const vehicleTypes = await vehicleTypesQuery.find({ useMasterKey: true });
    const vehicleTypesMap = {};
    vehicleTypes.forEach(vt => {
      vehicleTypesMap[vt.get('code')] = vt;
    });
    console.log(`   ✅ Loaded ${vehicleTypes.length} vehicle types\n`);

    return { ratesMap, serviceTypesMap, poisMap, vehicleTypesMap };
  } catch (error) {
    console.error('❌ Error loading reference data:', error);
    throw error;
  }
}

/**
 * Calculate price with rate percentage
 */
function calculatePriceWithRate(basePrice, ratePercentage) {
  // Rate percentage is added to base price
  return basePrice + (basePrice * (ratePercentage / 100));
}

/**
 * Check if service already exists
 */
async function serviceExists(originPOI, destinationPOI, vehicleType, rate) {
  try {
    const query = new Parse.Query('Service');
    
    if (originPOI) {
      query.equalTo('originPOI', originPOI);
    } else {
      query.doesNotExist('originPOI');
    }
    
    query.equalTo('destinationPOI', destinationPOI);
    query.equalTo('vehicleType', vehicleType);
    query.equalTo('rate', rate);
    query.equalTo('exists', true);
    
    const existing = await query.first({ useMasterKey: true });
    return !!existing;
  } catch (error) {
    console.error('Error checking service existence:', error);
    return false;
  }
}

/**
 * Create test traslados
 */
async function createTestTraslados(referenceData) {
  const { ratesMap, poisMap, vehicleTypesMap } = referenceData;
  
  console.log('🚐 Creating test traslados...\n');
  
  let created = 0;
  let skipped = 0;
  let errors = 0;
  
  // Get all rates for processing
  const rateNames = Object.keys(ratesMap);
  console.log(`   📊 Available rates: ${rateNames.join(', ')}\n`);
  
  for (const trasladoData of TEST_TRASLADOS) {
    console.log(`   🔄 Processing: ${trasladoData.origin || 'Local'} → ${trasladoData.destination}`);
    
    // Get POIs
    const originKey = trasladoData.origin ? `${trasladoData.origin}|${trasladoData.serviceType}` : null;
    const destinationKey = `${trasladoData.destination}|${trasladoData.serviceType}`;
    
    const originPOI = originKey ? poisMap[originKey] : null;
    const destinationPOI = poisMap[destinationKey];
    
    if (!destinationPOI) {
      console.log(`     ⚠️  Destination POI not found: ${destinationKey}`);
      continue;
    }
    
    if (trasladoData.origin && !originPOI) {
      console.log(`     ⚠️  Origin POI not found: ${originKey}`);
      continue;
    }
    
    // Create services for each vehicle type and rate combination
    for (const vehicleCode of trasladoData.vehicleTypes) {
      const vehicleType = vehicleTypesMap[vehicleCode];
      
      if (!vehicleType) {
        console.log(`     ⚠️  Vehicle type not found: ${vehicleCode}`);
        continue;
      }
      
      for (const rateName of rateNames) {
        const rate = ratesMap[rateName];
        
        try {
          // Check if service already exists
          const exists = await serviceExists(originPOI, destinationPOI, vehicleType, rate);
          
          if (exists) {
            skipped++;
            continue;
          }
          
          // Calculate price with rate
          const finalPrice = calculatePriceWithRate(trasladoData.basePrice, rate.get('percentage'));
          
          // Create service
          const Service = Parse.Object.extend('Service');
          const service = new Service();
          
          if (originPOI) {
            service.set('originPOI', originPOI);
          }
          service.set('destinationPOI', destinationPOI);
          service.set('vehicleType', vehicleType);
          service.set('rate', rate);
          service.set('price', finalPrice);
          service.set('active', true);
          service.set('exists', true);
          service.set('note', `Test traslado created for development - Rate: ${rateName} (${rate.get('percentage')}%)`);
          
          // Set ACL
          const acl = new Parse.ACL();
          acl.setPublicReadAccess(true);
          acl.setRoleWriteAccess('admin', true);
          acl.setRoleWriteAccess('superadmin', true);
          service.setACL(acl);
          
          await service.save(null, { useMasterKey: true });
          created++;
          
          console.log(`     ✅ Created: ${vehicleCode} - ${rateName} ($${finalPrice})`);
          
        } catch (error) {
          errors++;
          console.log(`     ❌ Error creating ${vehicleCode} - ${rateName}: ${error.message}`);
        }
      }
    }
    
    console.log(''); // Empty line for readability
  }
  
  return { created, skipped, errors };
}

/**
 * Main execution function
 */
async function createTestData() {
  try {
    console.log('🏗️  Creating Test Traslados for Development\n');
    console.log('   This script creates traslados with all available rates');
    console.log('   so you can see pricing differences in the development environment.\n');
    
    // Load reference data
    const referenceData = await loadReferenceData();
    
    // Create test traslados
    const results = await createTestTraslados(referenceData);
    
    console.log('📊 RESULTS:');
    console.log(`   ✅ Created: ${results.created} new services`);
    console.log(`   ⏭️  Skipped: ${results.skipped} existing services`);
    console.log(`   ❌ Errors: ${results.errors} failed services`);
    console.log(`   📈 Total processed: ${results.created + results.skipped + results.errors}`);
    
    if (results.created > 0) {
      console.log('\n🎉 Test traslados created successfully!');
      console.log('   You can now see different prices for each rate tier in your application.');
      console.log('   Check the services section in your admin dashboard.');
    } else {
      console.log('\n ℹ️  No new traslados were needed - all combinations already exist.');
    }
    
  } catch (error) {
    console.error('\n❌ Error creating test data:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  createTestData()
    .then(() => {
      console.log('\n✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { createTestData };