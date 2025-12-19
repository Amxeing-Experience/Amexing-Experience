/**
 * Seed 017 - Populate TourPrices with Premium rates.
 *
 * Populates TourPrices table with Premium rate entries for all tours,
 * creating separate price entries for SEDAN, SUBURBAN, and SPRINTER vehicle types.
 *
 * Data Structure:
 * - ratePtr: Points to "Premium" rate
 * - tourPtr: Points to each tour in Tour table
 * - vehicleType: SEDAN, SUBURBAN, or SPRINTER vehicle type
 * - price: Default placeholder price (to be updated later)
 * - currency: MXN
 * - active: true
 * - exists: true
 *
 * Business Logic:
 * - For each tour in Tour table, create 3 TourPrices entries:
 *   1. Tour + Premium + SEDAN
 *   2. Tour + Premium + SUBURBAN
 *   3. Tour + Premium + SPRINTER
 * - Uses placeholder prices that can be updated later
 * - Skips existing combinations to maintain idempotency
 *
 * Configuration:
 * - Idempotent: true - Can be run multiple times safely
 * - Dependencies: 013-seed-tour-catalog, 005-seed-rates, 006-seed-vehicle-types
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 2024-12-15
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

// Seed configuration
const SEED_NAME = '017-populate-tour-prices-premium';
const VERSION = '1.0.0';

// Configuration
const PREMIUM_RATE_NAME = 'Premium';
const VEHICLE_TYPES = ['SEDAN', 'SUBURBAN', 'SPRINTER'];
const DEFAULT_PRICE = 1500; // Placeholder price in MXN (highest tier)

/**
 * Run the seed
 * @returns {Promise<object>} Seed result with statistics
 */
async function run() {
  const startTime = Date.now();
  const stats = { created: 0, skipped: 0, errors: 0 };

  logger.info(`🌱 Starting ${SEED_NAME} v${VERSION}`);

  try {
    // ==========================================
    // STEP 1: GET PREMIUM RATE
    // ==========================================
    logger.info('💎 Finding Premium rate...');
    
    const RateClass = Parse.Object.extend('Rate');
    const rateQuery = new Parse.Query(RateClass);
    rateQuery.equalTo('name', PREMIUM_RATE_NAME);
    rateQuery.equalTo('exists', true);
    
    const premiumRate = await rateQuery.first({ useMasterKey: true });
    
    if (!premiumRate) {
      throw new Error(`Rate "${PREMIUM_RATE_NAME}" not found`);
    }
    
    logger.info(`✅ Found Premium rate: ${premiumRate.id}`);

    // ==========================================
    // STEP 2: GET VEHICLE TYPES
    // ==========================================
    logger.info('🚗 Loading Premium vehicle types...');
    
    const VehicleTypeClass = Parse.Object.extend('VehicleType');
    const vehicleQuery = new Parse.Query(VehicleTypeClass);
    vehicleQuery.containedIn('name', VEHICLE_TYPES);
    vehicleQuery.equalTo('exists', true);
    
    const vehicleTypes = await vehicleQuery.find({ useMasterKey: true });
    const vehicleMap = new Map();
    
    vehicleTypes.forEach(vt => {
      vehicleMap.set(vt.get('name'), vt);
    });
    
    // Verify we have the required vehicle types
    for (const vtName of VEHICLE_TYPES) {
      if (!vehicleMap.has(vtName)) {
        throw new Error(`Vehicle type "${vtName}" not found`);
      }
    }
    
    logger.info(`✅ Found ${vehicleTypes.length} Premium vehicle types: ${VEHICLE_TYPES.join(', ')}`);

    // ==========================================
    // STEP 3: GET ALL TOURS
    // ==========================================
    logger.info('📋 Loading tours from Tour table...');
    
    const TourClass = Parse.Object.extend('Tour');
    const tourQuery = new Parse.Query(TourClass);
    tourQuery.equalTo('exists', true);
    tourQuery.equalTo('active', true);
    tourQuery.include(['destinationPOI']);
    
    const tours = await tourQuery.find({ useMasterKey: true });
    
    if (tours.length === 0) {
      logger.warn('No tours found in Tour table');
      return {
        success: true,
        duration: Date.now() - startTime,
        statistics: stats,
      };
    }
    
    logger.info(`📊 Found ${tours.length} tours to process`);

    // ==========================================
    // STEP 4: CREATE TOUR PRICES
    // ==========================================
    logger.info('💰 Creating TourPrices entries for Premium...');
    
    const TourPricesClass = Parse.Object.extend('TourPrices');
    let processedCombinations = 0;
    
    for (const tour of tours) {
      const tourName = tour.get('destinationPOI')?.get('name') || 'Unknown';
      const tourTime = tour.get('time');
      
      for (const vehicleTypeName of VEHICLE_TYPES) {
        const vehicleType = vehicleMap.get(vehicleTypeName);
        
        try {
          // Check if combination already exists
          const existingQuery = new Parse.Query(TourPricesClass);
          existingQuery.equalTo('ratePtr', premiumRate);
          existingQuery.equalTo('tourPtr', tour);
          existingQuery.equalTo('vehicleType', vehicleType);
          existingQuery.equalTo('exists', true);
          
          const existingPrice = await existingQuery.first({ useMasterKey: true });
          
          if (existingPrice) {
            stats.skipped += 1;
            processedCombinations += 1;
            continue;
          }
          
          // Create new tour price
          const tourPrice = new TourPricesClass();
          
          tourPrice.set('ratePtr', premiumRate);
          tourPrice.set('tourPtr', tour);
          tourPrice.set('vehicleType', vehicleType);
          tourPrice.set('price', DEFAULT_PRICE);
          tourPrice.set('currency', 'MXN');
          tourPrice.set('active', true);
          tourPrice.set('exists', true);
          
          await tourPrice.save(null, { useMasterKey: true });
          stats.created += 1;
          processedCombinations += 1;
          
          if (processedCombinations % 10 === 0) {
            logger.info(`Progress: ${processedCombinations}/${tours.length * VEHICLE_TYPES.length} combinations processed`);
          }
          
        } catch (error) {
          stats.errors += 1;
          logger.error(`Error creating Premium price for ${tourName} (${tourTime}min) + ${vehicleTypeName}:`, error.message);
        }
      }
    }

    const duration = Date.now() - startTime;
    const totalExpected = tours.length * VEHICLE_TYPES.length;

    logger.info(`✅ Seed ${SEED_NAME} completed successfully`, {
      stats,
      totalExpected,
      duration: `${duration}ms`,
    });

    return {
      success: true,
      duration,
      statistics: stats,
      metadata: {
        rate: PREMIUM_RATE_NAME,
        vehicleTypes: VEHICLE_TYPES,
        toursProcessed: tours.length,
        totalExpected,
        defaultPrice: DEFAULT_PRICE,
      },
    };
  } catch (error) {
    logger.error(`❌ Seed ${SEED_NAME} failed:`, error.message);
    throw new Error(`Seed failed: ${error.message}`);
  }
}

// Export for use by seed runner
module.exports = {
  version: VERSION,
  description: 'Populate TourPrices with Premium rates for SEDAN, SUBURBAN, and SPRINTER vehicle types',
  run,
};