/**
 * Seed 012 - RatePrices (Updated Database Structure).
 *
 * Creates the RatePrices table using the current database schema with vehicle-specific pricing.
 * Populates RatePrices for all rate categories with their respective vehicle types:
 * - Premium: SEDAN, SUBURBAN, SPRINTER
 * - Económico: SEDAN, VAN
 * - Green Class: MODEL 3, MODEL Y
 * - First Class: SEDAN, SUBURBAN
 *
 * Data Structure (Current Schema):
 * - originPOI: Origin POI object (can be null)
 * - destinationPOI: Destination POI object (required)
 * - rate: Rate object (required)
 * - vehicleType: VehicleType object (required)
 * - service: Services object reference (required)
 * - price: Price amount from Service table (required)
 * - active: Pricing availability (boolean)
 * - exists: Logical deletion flag (boolean)
 *
 * Business Logic:
 * - Creates RatePrices based on Services table and rate-vehicle combinations
 * - Pricing sourced from Service table with exact matching
 * - Supports services without originPOI (airport returns, local services)
 * - Uses proven population methodology
 *
 * Configuration:
 * - Idempotent: true - Can be run multiple times safely
 * - Dependencies: 005-seed-rates, 006-seed-vehicle-types, 011-seed-services-catalog
 * @author Denisse Maldonado
 * @version 2.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

// Parse Server configuration for standalone execution
if (!Parse.applicationId) {
  Parse.initialize(
    process.env.PARSE_APP_ID || 'CrTRTaJpoJFNt8PJ',
    null,
    process.env.PARSE_MASTER_KEY || 'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP'
  );
  Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';
}

// Seed configuration
const SEED_NAME = '012-seed-rate-prices';
const VERSION = '2.0.0';

/**
 * Rate to vehicle type mapping (based on current database structure).
 */
const RATE_VEHICLE_MAP = {
  'Premium': ['SEDAN', 'SUBURBAN', 'SPRINTER'],
  'Económico': ['SEDAN', 'VAN'],
  'Green Class': ['MODEL 3', 'MODEL Y'],
  'First Class': ['SEDAN', 'SUBURBAN'],
};

/**
 * Helper function to populate RatePrices for a specific rate.
 */
async function populateRateSpecificPrices(rate, vehicleTypes, services, stats) {
  const rateName = rate.get('name');
  const vehicleCodes = RATE_VEHICLE_MAP[rateName] || [];
  
  if (vehicleCodes.length === 0) {
    logger.warn(`No vehicle types configured for rate: ${rateName}`);
    return;
  }
  
  // Filter vehicle types to only those configured for this rate
  const rateVehicleTypes = vehicleTypes.filter(vt => 
    vehicleCodes.includes(vt.get('code'))
  );
  
  console.log(`Creating RatePrices for ${rateName} with vehicles: ${rateVehicleTypes.map(vt => vt.get('code')).join(', ')}`);
  
  // Get Service records for price matching
  const ServiceClass = Parse.Object.extend('Service');
  const serviceQuery = new Parse.Query(ServiceClass);
  serviceQuery.equalTo('rate', rate);
  serviceQuery.equalTo('exists', true);
  serviceQuery.include(['vehicleType', 'destinationPOI', 'originPOI']);
  serviceQuery.limit(1000);
  
  const serviceRecords = await serviceQuery.find({ useMasterKey: true });
  
  // Build price lookup map
  const servicePriceMap = new Map();
  serviceRecords.forEach(service => {
    const vehicleType = service.get('vehicleType');
    const destinationPOI = service.get('destinationPOI');
    const originPOI = service.get('originPOI');
    const price = service.get('price');
    
    if (vehicleType && destinationPOI && price) {
      const vehicleCode = vehicleType.get('code');
      const destinationId = destinationPOI.id;
      const originId = originPOI ? originPOI.id : 'NULL';
      const lookupKey = `${originId}-${destinationId}-${vehicleCode}`;
      servicePriceMap.set(lookupKey, price);
    }
  });
  
  let ratePricesToSave = [];
  const batchSize = 100;
  
  for (const service of services) {
    const originPOI = service.get('originPOI');
    const destinationPOI = service.get('destinationPOI');
    
    for (const vehicleType of rateVehicleTypes) {
      try {
        // Check if RatePrice already exists
        const RatePricesClass = Parse.Object.extend('RatePrices');
        const existingQuery = new Parse.Query(RatePricesClass);
        if (originPOI) {
          existingQuery.equalTo('originPOI', originPOI);
        } else {
          existingQuery.doesNotExist('originPOI');
        }
        existingQuery.equalTo('destinationPOI', destinationPOI);
        existingQuery.equalTo('rate', rate);
        existingQuery.equalTo('vehicleType', vehicleType);
        existingQuery.equalTo('exists', true);
        
        const existing = await existingQuery.first({ useMasterKey: true });
        if (existing) {
          stats.skipped += 1;
          continue;
        }
        
        // Find matching price from Service table
        const vehicleCode = vehicleType.get('code');
        const destinationId = destinationPOI.id;
        const originId = originPOI ? originPOI.id : 'NULL';
        const lookupKey = `${originId}-${destinationId}-${vehicleCode}`;
        
        const matchedPrice = servicePriceMap.get(lookupKey);
        
        if (matchedPrice) {
          // Create new RatePrice with matched price
          const ratePrice = new RatePricesClass();
          
          if (originPOI) {
            ratePrice.set('originPOI', originPOI);
          }
          ratePrice.set('destinationPOI', destinationPOI);
          ratePrice.set('rate', rate);
          ratePrice.set('vehicleType', vehicleType);
          ratePrice.set('service', service);
          ratePrice.set('price', matchedPrice);
          ratePrice.set('active', true);
          ratePrice.set('exists', true);
          
          // Set ACL
          const acl = new Parse.ACL();
          acl.setPublicReadAccess(true);
          acl.setRoleWriteAccess('admin', true);
          acl.setRoleWriteAccess('superadmin', true);
          ratePrice.setACL(acl);
          
          ratePricesToSave.push(ratePrice);
          stats.priceMatches += 1;
          
          // Save in batches
          if (ratePricesToSave.length >= batchSize) {
            await Parse.Object.saveAll(ratePricesToSave, { useMasterKey: true });
            stats.created += ratePricesToSave.length;
            console.log(`💾 Batch saved: ${stats.created} RatePrices created so far...`);
            ratePricesToSave = [];
          }
        } else {
          stats.errors += 1;
          console.warn(`No price found for ${rateName} ${vehicleCode} route: ${originId}-${destinationId}`);
        }
      } catch (error) {
        stats.errors += 1;
        console.error(`Error creating RatePrice: ${error.message}`);
      }
    }
  }
  
  // Save remaining RatePrices
  if (ratePricesToSave.length > 0) {
    await Parse.Object.saveAll(ratePricesToSave, { useMasterKey: true });
    stats.created += ratePricesToSave.length;
    console.log(`💾 Final batch saved: ${ratePricesToSave.length} RatePrices`);
  }
}

/**
 * Main seed execution function.
 * @returns {Promise<object>} Execution result with statistics
 */
async function seed() {
  const environment = process.env.NODE_ENV || 'development';
  const startTime = Date.now();

  console.log(`🌱 Starting ${SEED_NAME} v${VERSION}`);

  try {
    const stats = {
      created: 0, skipped: 0, errors: 0, priceMatches: 0,
    };

    // ==========================================
    // STEP 1: LOAD SERVICES, RATES, AND VEHICLE TYPES
    // ==========================================
    console.log('📋 Loading Services, Rates, and Vehicle Types...');

    // Get all services from Services table
    const ServicesClass = Parse.Object.extend('Services');
    const servicesQuery = new Parse.Query(ServicesClass);
    servicesQuery.equalTo('exists', true);
    servicesQuery.equalTo('active', true);
    servicesQuery.include(['originPOI', 'destinationPOI']);
    servicesQuery.limit(500);

    const services = await servicesQuery.find({ useMasterKey: true });

    // Get all rates
    const RateClass = Parse.Object.extend('Rate');
    const ratesQuery = new Parse.Query(RateClass);
    ratesQuery.equalTo('exists', true);
    ratesQuery.equalTo('active', true);

    const rates = await ratesQuery.find({ useMasterKey: true });

    // Get all vehicle types
    const VehicleTypeClass = Parse.Object.extend('VehicleType');
    const vehicleTypesQuery = new Parse.Query(VehicleTypeClass);
    vehicleTypesQuery.equalTo('exists', true);

    const vehicleTypes = await vehicleTypesQuery.find({ useMasterKey: true });

    console.log(`Found ${services.length} services, ${rates.length} rates, and ${vehicleTypes.length} vehicle types`);

    // ==========================================
    // STEP 2: POPULATE RATEPRICES BY RATE
    // ==========================================
    console.log('📦 Creating RatePrices records for each rate...');

    for (let rateIndex = 0; rateIndex < rates.length; rateIndex += 1) {
      const rate = rates[rateIndex];
      const rateName = rate.get('name');
      
      console.log(`Processing rate ${rateName} (${rateIndex + 1}/${rates.length})...`);
      
      await populateRateSpecificPrices(rate, vehicleTypes, services, stats);
    }

    const duration = Date.now() - startTime;
    const result = {
      success: true,
      environment,
      stats,
      duration,
    };

    console.log(`✅ Seed ${SEED_NAME} completed successfully`);
    console.log(`📊 Statistics:`, stats);
    console.log(`⏱️ Duration: ${duration}ms`);

    return result;
  } catch (error) {
    console.error(`❌ Seed ${SEED_NAME} failed:`, error.message);
    throw error;
  }
}

// Export for use by seed runner
module.exports = {
  name: SEED_NAME,
  version: VERSION,
  description: 'Create RatePrices with current database schema using vehicle-specific pricing from Service table',
  dependencies: ['005-seed-rates', '006-seed-vehicle-types', '011-seed-services-catalog'],
  seed,
};

// Run directly if called
if (require.main === module) {
  seed().then(() => {
    process.exit(0);
  }).catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
}