/**
 * Seed 024 - Disposable Prices (A Disposición)
 *
 * Creates initial pricing for hourly vehicle rental services (A Disposición).
 * Establishes base pricing structure for all vehicle types across all rates.
 *
 * Price Structure:
 * - Base hourly rental prices for each vehicle type
 * - Rate markups applied consistently
 * - History tracking enabled with effective dates
 * - Default 500 MXN base rate with vehicle-specific adjustments
 *
 * @author Created by Denisse Maldonado
 * @version 1.0.0
 * @since 2024-12-17
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');
const SeedTrackerClass = require('../global/seeds/seed-tracker');
const DisposablePrices = require('../../src/domain/models/DisposablePrices');

// Create SeedTracker instance
const seedTracker = new SeedTrackerClass();

// Seed configuration
const SEED_NAME = '024-seed-disposable-prices';
const VERSION = '1.0.0';

/**
 * Base hourly rental prices for each vehicle type (in MXN)
 * These are competitive hourly rates for A Disposición services
 */
const BASE_HOURLY_PRICES = {
  'SEDAN': 450,           // Standard sedan hourly rate
  'VAN': 650,             // Van (7-8 passengers)
  'SUBURBAN': 850,        // SUV/Suburban (up to 6 passengers)
  'SPRINTER': 1200,       // Large van (15+ passengers) 
  'MODEL 3': 750,         // Tesla Model 3 (premium electric)
  'MODEL Y': 950,         // Tesla Model Y (premium electric SUV)
  // Fallback for any other vehicle types
  'DEFAULT': 500
};

/**
 * Rate markups for A Disposición services
 * Should be consistent with other pricing in the system
 */
const RATE_MARKUPS = {
  'First Class': 1.01,     // 1% markup
  'Económico': 1.05,        // 5% markup  
  'Green Class': 1.10,      // 10% markup
  'Premium': 1.20           // 20% markup
};

/**
 * Generate disposable pricing data for all combinations
 */
function generateDisposablePricingData(rates, vehicleTypes) {
  const pricingData = [];
  const now = new Date();

  for (const rate of rates) {
    for (const vehicleType of vehicleTypes) {
      const vehicleCode = vehicleType.get('code') || vehicleType.get('name') || 'DEFAULT';
      const basePrice = BASE_HOURLY_PRICES[vehicleCode] || BASE_HOURLY_PRICES['DEFAULT'];
      const markup = RATE_MARKUPS[rate.get('name')] || 1.0;
      const finalHourlyPrice = Math.round(basePrice * markup);

      pricingData.push({
        vehicleTypeId: vehicleType.id,
        rateId: rate.id,
        hourlyPrice: finalHourlyPrice,
        currency: 'MXN',
        effectiveDate: now,
        // endDate stays null for current prices
        active: true,
        exists: true,
        vehicleCode: vehicleCode,
        rateName: rate.get('name')
      });
    }
  }

  return pricingData;
}

/**
 * Main seed function for DisposablePrices
 */
async function seedDisposablePrices() {
  const startTime = Date.now();

  try {
    logger.info(`[${SEED_NAME}] Starting Disposable Prices (A Disposición) seed...`);

    // Check if seed was already executed
    const isExecuted = await seedTracker.isExecuted(SEED_NAME);
    if (isExecuted && process.env.FORCE_SEED !== 'true') {
      logger.info(`[${SEED_NAME}] Seed already executed, skipping...`);
      return {
        success: true,
        message: 'Seed already executed',
        data: { created: 0, skipped: true }
      };
    }

    // Fetch all active rates
    const rateQuery = new Parse.Query('Rate');
    rateQuery.equalTo('exists', true);
    rateQuery.equalTo('active', true);
    const rates = await rateQuery.find({ useMasterKey: true });

    if (rates.length === 0) {
      throw new Error('No rates found. Please run rate seeds first.');
    }

    logger.info(`[${SEED_NAME}] Found ${rates.length} rates`);

    // Fetch all active vehicle types
    const vehicleQuery = new Parse.Query('VehicleType');
    vehicleQuery.equalTo('exists', true);
    vehicleQuery.equalTo('active', true);
    const vehicleTypes = await vehicleQuery.find({ useMasterKey: true });

    if (vehicleTypes.length === 0) {
      throw new Error('No vehicle types found. Please run vehicle type seeds first.');
    }

    logger.info(`[${SEED_NAME}] Found ${vehicleTypes.length} vehicle types`);

    // Check if disposable prices already exist
    const existingQuery = new Parse.Query('DisposablePrices');
    existingQuery.equalTo('exists', true);
    const existingCount = await existingQuery.count({ useMasterKey: true });
    const existingPrices = { length: existingCount }; // Mock for compatibility
    
    if (existingPrices.length > 0) {
      logger.warn(`[${SEED_NAME}] Found ${existingPrices.length} existing disposable prices. Skipping to avoid duplicates.`);

      // Record seed execution
      await seedTracker.recordExecution({
        name: SEED_NAME,
        version: VERSION,
        status: 'completed',
        statistics: {
          created: 0,
          skipped: existingPrices.length,
          errors: 0
        }
      });

      return {
        success: true,
        message: `Skipped - ${existingPrices.length} disposable prices already exist`,
        data: { created: 0, skipped: existingPrices.length }
      };
    }

    // Generate pricing data
    const pricingData = generateDisposablePricingData(rates, vehicleTypes);
    logger.info(`[${SEED_NAME}] Generated ${pricingData.length} disposable price records`);

    // Create disposable price records using Parse objects directly
    const DisposablePricesClass = Parse.Object.extend('DisposablePrices');
    const priceObjects = pricingData.map(data => {
      const price = new DisposablePricesClass();

      // Set vehicle type pointer
      price.set('vehicleType', {
        __type: 'Pointer',
        className: 'VehicleType',
        objectId: data.vehicleTypeId
      });

      // Set rate pointer  
      price.set('rate', {
        __type: 'Pointer',
        className: 'Rate',
        objectId: data.rateId
      });

      // Set all other fields
      price.set('hourlyPrice', data.hourlyPrice);
      price.set('currency', data.currency);
      price.set('effectiveDate', data.effectiveDate);
      price.set('active', data.active);
      price.set('exists', data.exists);

      return price;
    });

    // Save in batches of 50
    const batchSize = 50;
    let totalCreated = 0;

    for (let i = 0; i < priceObjects.length; i += batchSize) {
      const batch = priceObjects.slice(i, i + batchSize);
      await Parse.Object.saveAll(batch, { useMasterKey: true });
      totalCreated += batch.length;
      logger.info(`[${SEED_NAME}] Created ${totalCreated}/${priceObjects.length} disposable prices`);
    }

    // Generate summary by rate and vehicle type
    const summary = {};
    for (const rate of rates) {
      const ratePrices = pricingData.filter(p => p.rateId === rate.id);
      summary[rate.get('name')] = ratePrices.map(p => {
        const vehicle = vehicleTypes.find(v => v.id === p.vehicleTypeId);
        const vehicleCode = vehicle.get('code') || vehicle.get('name');
        return `${vehicleCode}: $${p.hourlyPrice}/hr`;
      });
    }

    logger.info(`[${SEED_NAME}] Disposable prices summary:`, summary);

    // Record seed execution
    await seedTracker.recordExecution({
      name: SEED_NAME,
      version: VERSION,
      status: 'completed',
      statistics: {
        created: totalCreated,
        skipped: 0,
        errors: 0,
        rates: rates.length,
        vehicleTypes: vehicleTypes.length,
        summary
      }
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`[${SEED_NAME}] ✅ Successfully created ${totalCreated} disposable prices in ${duration}s`);

    return {
      success: true,
      message: `Created ${totalCreated} disposable prices`,
      data: {
        created: totalCreated,
        duration: `${duration}s`,
        summary
      }
    };

  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.error(`[${SEED_NAME}] ❌ Error seeding disposable prices:`, error);

    return {
      success: false,
      message: error.message,
      error: error.toString(),
      duration: `${duration}s`
    };
  }
}

// Export for use in seed runner
module.exports = seedDisposablePrices;

// Allow direct execution for testing
if (require.main === module) {
  // Initialize Parse for direct execution
  Parse.initialize(
    process.env.PARSE_APP_ID || 'amexing-app-id',
    null,
    process.env.PARSE_MASTER_KEY
  );
  Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';
  
  seedDisposablePrices()
    .then(result => {
      console.log('Seed result:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Seed error:', error);
      process.exit(1);
    });
}