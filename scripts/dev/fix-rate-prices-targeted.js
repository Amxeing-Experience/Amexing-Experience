/**
 * Fix Rate Prices - Targeted Solution
 * 
 * This script creates RatePrices for key services to demonstrate
 * proper multi-rate pricing in the UI.
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

// Key routes to fix (most common/visible)
const TARGET_ROUTES = [
  { origin: 'Querétaro', destination: 'San Miguel de Allende', basePrice: 800 },
  { origin: 'Guadalajara', destination: 'San Miguel de Allende', basePrice: 1500 },
  { origin: 'León/Bajío', destination: 'San Miguel de Allende', basePrice: 1000 },
  { origin: null, destination: 'San Miguel de Allende', basePrice: 300 }, // Local
];

// Vehicle multipliers
const VEHICLE_MULTIPLIERS = {
  'SEDAN': 1.0,
  'VAN': 1.1,
  'SUBURBAN': 1.2,
  'SPRINTER': 1.4,
  'MODEL 3': 1.0,
  'MODEL Y': 1.0
};

function calculatePrice(basePrice, ratePercentage, vehicleMultiplier = 1.0) {
  const rateAdjusted = basePrice + (basePrice * (ratePercentage / 100));
  return Math.round(rateAdjusted * vehicleMultiplier);
}

async function fixTargetedServices() {
  console.log('🎯 Fixing Rate Prices for Key Services\n');
  
  try {
    // Load reference data
    console.log('📡 Loading data...');
    
    // Get all rates
    const ratesQuery = new Parse.Query('Rate');
    ratesQuery.equalTo('exists', true);
    const rates = await ratesQuery.find({ useMasterKey: true });
    console.log(`   ✅ ${rates.length} rates: ${rates.map(r => r.get('name')).join(', ')}`);
    
    // Get vehicle types
    const vehiclesQuery = new Parse.Query('VehicleType');
    vehiclesQuery.equalTo('exists', true);
    const vehicles = await vehiclesQuery.find({ useMasterKey: true });
    console.log(`   ✅ ${vehicles.length} vehicle types\n`);
    
    let totalCreated = 0;
    let totalSkipped = 0;
    
    // Process each target route
    for (const route of TARGET_ROUTES) {
      console.log(`\n🛣️  Route: ${route.origin || 'Local'} → ${route.destination}`);
      
      // Find matching service(s)
      const serviceQuery = new Parse.Query('Services');
      if (route.origin) {
        // Find POI for origin
        const originQuery = new Parse.Query('POI');
        originQuery.contains('name', route.origin);
        originQuery.equalTo('exists', true);
        const originPOI = await originQuery.first({ useMasterKey: true });
        
        if (originPOI) {
          serviceQuery.equalTo('originPOI', originPOI);
        }
      } else {
        serviceQuery.doesNotExist('originPOI');
      }
      
      // Find POI for destination
      const destQuery = new Parse.Query('POI');
      destQuery.contains('name', route.destination);
      destQuery.equalTo('exists', true);
      const destPOI = await destQuery.first({ useMasterKey: true });
      
      if (!destPOI) {
        console.log(`   ⚠️  Destination POI not found: ${route.destination}`);
        continue;
      }
      
      serviceQuery.equalTo('destinationPOI', destPOI);
      serviceQuery.equalTo('exists', true);
      serviceQuery.include(['originPOI', 'destinationPOI']);
      const services = await serviceQuery.find({ useMasterKey: true });
      
      if (services.length === 0) {
        // Create a new service for this route
        console.log(`   📝 Creating new service for route`);
        const Service = Parse.Object.extend('Services');
        const newService = new Service();
        
        if (route.origin) {
          const originQuery = new Parse.Query('POI');
          originQuery.contains('name', route.origin);
          originQuery.equalTo('exists', true);
          const originPOI = await originQuery.first({ useMasterKey: true });
          if (originPOI) {
            newService.set('originPOI', originPOI);
          }
        }
        
        newService.set('destinationPOI', destPOI);
        newService.set('note', 'Test service for rate pricing demonstration');
        newService.set('active', true);
        newService.set('exists', true);
        
        const acl = new Parse.ACL();
        acl.setPublicReadAccess(true);
        acl.setRoleWriteAccess('admin', true);
        acl.setRoleWriteAccess('superadmin', true);
        newService.setACL(acl);
        
        await newService.save(null, { useMasterKey: true });
        services.push(newService);
      }
      
      console.log(`   Found ${services.length} service(s)`);
      
      // Create RatePrices for each service
      for (const service of services) {
        let created = 0;
        let skipped = 0;
        
        for (const rate of rates) {
          for (const vehicle of vehicles) {
            // Check if already exists
            const existQuery = new Parse.Query('RatePrices');
            existQuery.equalTo('service', service);
            existQuery.equalTo('rate', rate);
            existQuery.equalTo('vehicleType', vehicle);
            existQuery.equalTo('exists', true);
            
            const existing = await existQuery.first({ useMasterKey: true });
            if (existing) {
              skipped++;
              continue;
            }
            
            // Calculate price
            const vehicleCode = vehicle.get('code');
            const multiplier = VEHICLE_MULTIPLIERS[vehicleCode] || 1.0;
            const price = calculatePrice(route.basePrice, rate.get('percentage'), multiplier);
            
            // Create RatePrice
            const RatePrices = Parse.Object.extend('RatePrices');
            const ratePrice = new RatePrices();
            
            const origin = service.get('originPOI');
            if (origin) {
              ratePrice.set('originPOI', origin);
            }
            
            ratePrice.set('destinationPOI', service.get('destinationPOI'));
            ratePrice.set('service', service);
            ratePrice.set('rate', rate);
            ratePrice.set('vehicleType', vehicle);
            ratePrice.set('price', price);
            ratePrice.set('currency', 'MXN');
            ratePrice.set('active', true);
            ratePrice.set('exists', true);
            
            const acl = new Parse.ACL();
            acl.setPublicReadAccess(true);
            acl.setRoleWriteAccess('admin', true);
            acl.setRoleWriteAccess('superadmin', true);
            ratePrice.setACL(acl);
            
            await ratePrice.save(null, { useMasterKey: true });
            created++;
          }
        }
        
        console.log(`   ✅ Created ${created} rate prices, skipped ${skipped} existing`);
        totalCreated += created;
        totalSkipped += skipped;
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 SUMMARY:');
    console.log(`   ✅ Created: ${totalCreated} new rate prices`);
    console.log(`   ⏭️  Skipped: ${totalSkipped} existing entries`);
    
    if (totalCreated > 0) {
      console.log('\n🎉 SUCCESS! Key services now have prices for all rates.');
      console.log('\nYou can now test in the UI:');
      console.log('1. Go to http://localhost:1337/dashboard/admin/services');
      console.log('2. Select "Económico" in the header dropdown');
      console.log('3. You\'ll see Económico prices for the services');
      console.log('4. Click "Ver todos" to see prices for ALL rates');
      console.log('\nFixed routes:');
      TARGET_ROUTES.forEach(r => {
        console.log(`   • ${r.origin || 'Local'} → ${r.destination}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

// Run the fix
fixTargetedServices()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });