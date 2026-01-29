/**
 * Migration: Add Test Traslados for Development
 * 
 * Creates test traslados (services) with different rates to demonstrate pricing variations.
 * This migration is specifically for development environment testing.
 * 
 * Fields being used:
 * - originPOI: Pointer to POI (origin, can be null for local services)
 * - destinationPOI: Pointer to POI (destination, required)
 * - vehicleType: Pointer to VehicleType (SEDAN, VAN, SUBURBAN, etc.)
 * - rate: Pointer to Rate (First Class 1%, Económico 5%, Green Class 10%, Premium 20%)
 * - price: Number (calculated with rate percentage markup)
 * - note: String (description/notes)
 * - active: Boolean (true = available for booking)
 * - exists: Boolean (true = not deleted)
 * - isRoundTrip: Boolean (false for one-way services)
 * 
 * Created by Denisse Maldonado
 * 
 * @author Amexing Development Team
 * @version 1.0.0
 */

const Parse = require('parse/node');

/**
 * Test routes with base prices
 */
const TEST_ROUTES = [
  {
    origin: 'Querétaro',
    destination: 'San Miguel de Allende',
    serviceType: 'Punto a Punto',
    basePrice: 800,
    vehicles: ['SEDAN', 'VAN'],
    description: 'Popular route for testing rate differences'
  },
  {
    origin: 'Guadalajara', 
    destination: 'San Miguel de Allende',
    serviceType: 'Punto a Punto',
    basePrice: 1500,
    vehicles: ['SEDAN', 'VAN', 'SUBURBAN'],
    description: 'Long distance route showcasing premium pricing'
  },
  {
    origin: null, // Local service
    destination: 'Centro Histórico',
    serviceType: 'Local',
    basePrice: 300,
    vehicles: ['SEDAN', 'VAN'],
    description: 'Local city transfer for rate comparison'
  }
];

/**
 * Calculate price with rate markup
 */
function calculatePrice(basePrice, ratePercentage) {
  return Math.round(basePrice + (basePrice * (ratePercentage / 100)));
}

/**
 * Find POI by name and service type
 */
async function findPOI(name, serviceTypeName) {
  if (!name) return null;
  
  const query = new Parse.Query('POI');
  query.equalTo('name', name);
  query.equalTo('exists', true);
  query.include('serviceType');
  
  const pois = await query.find({ useMasterKey: true });
  
  // Find POI with matching service type
  for (const poi of pois) {
    const serviceType = poi.get('serviceType');
    if (serviceType && serviceType.get('name') === serviceTypeName) {
      return poi;
    }
  }
  
  return null;
}

/**
 * Run migration
 */
async function run() {
  console.log('🚀 Adding test traslados for development environment...\n');
  
  let created = 0;
  let skipped = 0;
  let errors = 0;
  
  try {
    // Load reference data
    console.log('📡 Loading reference data...');
    
    // Get all rates
    const ratesQuery = new Parse.Query('Rate');
    ratesQuery.equalTo('exists', true);
    const rates = await ratesQuery.find({ useMasterKey: true });
    const ratesMap = {};
    rates.forEach(rate => {
      ratesMap[rate.get('name')] = rate;
    });
    console.log(`   ✅ Loaded ${rates.length} rates`);
    
    // Get all vehicle types  
    const vehiclesQuery = new Parse.Query('VehicleType');
    vehiclesQuery.equalTo('exists', true);
    const vehicles = await vehiclesQuery.find({ useMasterKey: true });
    const vehiclesMap = {};
    vehicles.forEach(vehicle => {
      vehiclesMap[vehicle.get('code')] = vehicle;
    });
    console.log(`   ✅ Loaded ${vehicles.length} vehicle types\n`);
    
    // Process each test route
    for (const route of TEST_ROUTES) {
      console.log(`🛣️  Processing route: ${route.origin || 'Local'} → ${route.destination}`);
      
      // Find POIs
      const originPOI = await findPOI(route.origin, route.serviceType);
      const destinationPOI = await findPOI(route.destination, route.serviceType);
      
      if (!destinationPOI) {
        console.log(`   ⚠️  Destination POI not found: ${route.destination}`);
        continue;
      }
      
      if (route.origin && !originPOI) {
        console.log(`   ⚠️  Origin POI not found: ${route.origin}`);
        continue;
      }
      
      // Create service for each vehicle type and rate combination
      for (const vehicleCode of route.vehicles) {
        const vehicleType = vehiclesMap[vehicleCode];
        
        if (!vehicleType) {
          console.log(`   ⚠️  Vehicle type not found: ${vehicleCode}`);
          continue;
        }
        
        for (const rateName of Object.keys(ratesMap)) {
          const rate = ratesMap[rateName];
          
          try {
            // Check if service already exists
            const existsQuery = new Parse.Query('Service');
            if (originPOI) {
              existsQuery.equalTo('originPOI', originPOI);
            } else {
              existsQuery.doesNotExist('originPOI');
            }
            existsQuery.equalTo('destinationPOI', destinationPOI);
            existsQuery.equalTo('vehicleType', vehicleType);
            existsQuery.equalTo('rate', rate);
            existsQuery.equalTo('exists', true);
            
            const existing = await existsQuery.first({ useMasterKey: true });
            if (existing) {
              skipped++;
              continue;
            }
            
            // Calculate final price
            const finalPrice = calculatePrice(route.basePrice, rate.get('percentage'));
            
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
            service.set('isRoundTrip', false);
            service.set('note', `Test traslado - ${route.description} - Rate: ${rateName} (${rate.get('percentage')}%)`);
            service.set('active', true);
            service.set('exists', true);
            
            // Set ACL for security
            const acl = new Parse.ACL();
            acl.setPublicReadAccess(true);
            acl.setRoleWriteAccess('admin', true);
            acl.setRoleWriteAccess('superadmin', true);
            service.setACL(acl);
            
            await service.save(null, { useMasterKey: true });
            created++;
            
            console.log(`   ✅ Created: ${vehicleCode} with ${rateName} rate - $${finalPrice.toLocaleString('es-MX')}`);
            
          } catch (error) {
            errors++;
            console.log(`   ❌ Error creating ${vehicleCode} - ${rateName}: ${error.message}`);
          }
        }
      }
      
      console.log(''); // Empty line for readability
    }
    
    console.log('📊 MIGRATION RESULTS:');
    console.log(`   ✅ Created: ${created} new traslados`);
    console.log(`   ⏭️  Skipped: ${skipped} existing traslados`);
    console.log(`   ❌ Errors: ${errors} failed operations`);
    console.log(`   📈 Total processed: ${created + skipped + errors}\n`);
    
    if (created > 0) {
      console.log('🎉 Test traslados created successfully!');
      console.log('   You can now see pricing differences across different rates:');
      console.log('   - First Class (1% markup)');
      console.log('   - Económico (5% markup)');
      console.log('   - Green Class (10% markup)');
      console.log('   - Premium (20% markup)\n');
      console.log('   Check your admin dashboard services section to see the pricing variations.');
    } else {
      console.log('ℹ️  No new traslados needed - all combinations already exist.');
    }
    
    return { created, skipped, errors };
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

/**
 * Rollback function (optional)
 */
async function rollback() {
  console.log('⚠️  Rollback: Removing test traslados...');
  
  try {
    const query = new Parse.Query('Service');
    query.contains('note', 'Test traslado');
    query.equalTo('exists', true);
    query.limit(1000);
    
    const testServices = await query.find({ useMasterKey: true });
    
    for (const service of testServices) {
      service.set('exists', false);
      service.set('active', false);
      await service.save(null, { useMasterKey: true });
    }
    
    console.log(`✅ Removed ${testServices.length} test traslados`);
    return { removed: testServices.length };
    
  } catch (error) {
    console.error('❌ Rollback failed:', error);
    throw error;
  }
}

module.exports = { run, rollback };