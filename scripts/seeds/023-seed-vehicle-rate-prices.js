/**
 * Seed 023 - Vehicle Rate Prices
 *
 * Creates initial pricing for all vehicle types across all rates.
 * This establishes the base pricing structure for vehicle hourly rates.
 *
 * Price Structure:
 * - Base prices increase with vehicle size/luxury
 * - Rate percentages apply as markup
 * - History tracking enabled (valid_from/valid_until)
 *
 * @author Created by Denisse Maldonado
 * @version 1.0.0
 * @since 2024-02-05
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');
const SeedTracker = require('../global/seeds/seed-tracker');

// Seed configuration
const SEED_NAME = '023-seed-vehicle-rate-prices';
const VERSION = '1.0.0';

/**
 * Base hourly prices for each vehicle type (in MXN)
 * These are the base prices before rate markup
 */
const BASE_PRICES = {
  'SEDAN': 800,
  'VAN': 1200,
  'SUBURBAN': 1500,
  'SPRINTER': 2000,
  'MODEL 3': 1800,
  'MODEL Y': 2200
};

/**
 * Rate markups (matches existing rates from seed-005)
 */
const RATE_MARKUPS = {
  'First Class': 1.01,     // 1% markup
  'Económico': 1.05,        // 5% markup
  'Green Class': 1.10,      // 10% markup
  'Premium': 1.20           // 20% markup
};

/**
 * Generate pricing data for all combinations
 */
function generatePricingData(rates, vehicleTypes) {
  const pricingData = [];
  const now = new Date();
  
  for (const rate of rates) {
    for (const vehicleType of vehicleTypes) {
      const basePrice = BASE_PRICES[vehicleType.get('code')] || 1000;
      const markup = RATE_MARKUPS[rate.get('name')] || 1.0;
      const finalPrice = Math.round(basePrice * markup);
      
      pricingData.push({
        rateId: rate.id,
        vehicleTypeId: vehicleType.id,
        pricePerHour: finalPrice,
        currency: 'MXN',
        valid_from: now,
        // valid_until remains unset for current prices
        created_by: 'system_seed',
        reason_for_change: 'Initial seed data',
        active: true,
        exists: true
      });
    }
  }
  
  return pricingData;
}

/**
 * Main seed function
 */
async function seedVehicleRatePrices() {
  const startTime = Date.now();
  
  try {
    logger.info(`[${SEED_NAME}] Starting Vehicle Rate Prices seed...`);
    
    // Check if seed was already executed
    const isExecuted = await SeedTracker.isExecuted(SEED_NAME);
    if (isExecuted && process.env.FORCE_SEED !== 'true') {
      logger.info(`[${SEED_NAME}] Seed already executed, skipping...`);
      return {
        success: true,
        message: 'Seed already executed',
        data: { created: 0, skipped: true }
      };
    }
    
    // Fetch all rates
    const rateQuery = new Parse.Query('Rates');
    rateQuery.equalTo('exists', true);
    rateQuery.equalTo('active', true);
    const rates = await rateQuery.find({ useMasterKey: true });
    
    if (rates.length === 0) {
      throw new Error('No rates found. Please run seed-005-rates first.');
    }
    
    logger.info(`[${SEED_NAME}] Found ${rates.length} rates`);
    
    // Fetch all vehicle types
    const vehicleQuery = new Parse.Query('VehicleType');
    vehicleQuery.equalTo('exists', true);
    vehicleQuery.equalTo('active', true);
    const vehicleTypes = await vehicleQuery.find({ useMasterKey: true });
    
    if (vehicleTypes.length === 0) {
      throw new Error('No vehicle types found. Please run seed-006-vehicle-types first.');
    }
    
    logger.info(`[${SEED_NAME}] Found ${vehicleTypes.length} vehicle types`);
    
    // Check if prices already exist
    const existingQuery = new Parse.Query('VehicleRatePrices');
    existingQuery.doesNotExist('valid_until'); // Current prices only
    existingQuery.equalTo('exists', true);
    const existingCount = await existingQuery.count({ useMasterKey: true });
    
    if (existingCount > 0) {
      logger.warn(`[${SEED_NAME}] Found ${existingCount} existing prices. Skipping to avoid duplicates.`);
      
      // Record seed execution
      await SeedTracker.recordExecution(SEED_NAME, VERSION, {
        created: 0,
        skipped: existingCount,
        message: 'Prices already exist'
      });
      
      return {
        success: true,
        message: `Skipped - ${existingCount} prices already exist`,
        data: { created: 0, skipped: existingCount }
      };
    }
    
    // Generate pricing data
    const pricingData = generatePricingData(rates, vehicleTypes);
    logger.info(`[${SEED_NAME}] Generated ${pricingData.length} price records`);
    
    // Create price records
    const VehicleRatePrices = Parse.Object.extend('VehicleRatePrices');
    const priceObjects = pricingData.map(data => {
      const price = new VehicleRatePrices();
      
      // Set all fields
      Object.keys(data).forEach(key => {
        if (data[key] !== undefined && key !== 'valid_until') {
          price.set(key, data[key]);
        }
      });
      
      return price;
    });
    
    // Save in batches of 50
    const batchSize = 50;
    let totalCreated = 0;
    
    for (let i = 0; i < priceObjects.length; i += batchSize) {
      const batch = priceObjects.slice(i, i + batchSize);
      await Parse.Object.saveAll(batch, { useMasterKey: true });
      totalCreated += batch.length;
      logger.info(`[${SEED_NAME}] Created ${totalCreated}/${priceObjects.length} prices`);
    }
    
    // Log summary
    const summary = {};
    for (const rate of rates) {
      const ratePrices = pricingData.filter(p => p.rateId === rate.id);
      summary[rate.get('name')] = ratePrices.map(p => {
        const vehicle = vehicleTypes.find(v => v.id === p.vehicleTypeId);
        return `${vehicle.get('code')}: $${p.pricePerHour}`;
      });
    }
    
    logger.info(`[${SEED_NAME}] Price summary:`, summary);
    
    // Record seed execution
    await SeedTracker.recordExecution(SEED_NAME, VERSION, {
      created: totalCreated,
      rates: rates.length,
      vehicleTypes: vehicleTypes.length,
      summary
    });
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`[${SEED_NAME}] ✅ Successfully created ${totalCreated} vehicle rate prices in ${duration}s`);
    
    return {
      success: true,
      message: `Created ${totalCreated} vehicle rate prices`,
      data: {
        created: totalCreated,
        duration: `${duration}s`,
        summary
      }
    };
    
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.error(`[${SEED_NAME}] ❌ Error seeding vehicle rate prices:`, error);
    
    return {
      success: false,
      message: error.message,
      error: error.toString(),
      duration: `${duration}s`
    };
  }
}

// Export for use in seed runner
module.exports = seedVehicleRatePrices;