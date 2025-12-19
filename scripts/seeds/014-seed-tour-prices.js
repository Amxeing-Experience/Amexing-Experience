/**
 * Seed 014 - TourPrices (Tour Rate-Specific Pricing).
 *
 * Creates the TourPrices table with pricing for each rate-tour combination.
 * Uses actual pricing data from the original Tours table when available,
 * falls back to default pricing structure for new combinations.
 *
 * Data Structure:
 * - ratePtr: Pointer to Rate object (required)
 * - tourPtr: Pointer to Tour object (required)
 * - price: Price amount (decimal, required)
 * - currency: Currency code (default: 'MXN')
 * - active: Pricing availability (boolean)
 * - exists: Logical deletion flag (boolean)..
 *
 * Business Logic:
 * - Every Tour gets pricing for every Rate (complete matrix)
 * - Pricing sourced from original Tours table when exact match exists
 * - Default pricing applied when no exact match found
 * - Supports all tour types (destination POI + vehicle + duration combinations).
 *
 * Configuration:
 * - Idempotent: true - Can be run multiple times safely, skips existing combinations
 * - Dependencies: 013-seed-tour-catalog
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');
const SeedTracker = require('../global/seeds/seed-tracker');

// Seed configuration
const SEED_NAME = '014-seed-tour-prices';
const VERSION = '1.0.0';

/**
 * Default pricing structure by rate (fallback when no Tours match found).
 */
const DEFAULT_TOUR_PRICES = {
  'Green Class': { price: 2500, currency: 'MXN' },
  Premium: { price: 3000, currency: 'MXN' },
  Executive: { price: 3500, currency: 'MXN' },
  Económico: { price: 2000, currency: 'MXN' },
  'First Class': { price: 2200, currency: 'MXN' },
};

/**
 * Main seed execution function..
 * @returns {Promise<object>} Execution result with statistics
 * @example
 * const result = await seed();
 */
async function seed() {
  const tracker = new SeedTracker();
  const environment = process.env.NODE_ENV || 'development';

  logger.info(`🌱 Starting ${SEED_NAME} v${VERSION}`, {
    environment,
    seed: SEED_NAME,
  });

  try {
    // Check if seed already executed
    const existingExecution = await tracker.getSeedExecution(SEED_NAME, environment);
    if (existingExecution && existingExecution.success) {
      logger.info(`✅ Seed ${SEED_NAME} already executed successfully in ${environment}`, {
        lastExecuted: existingExecution.executedAt,
        version: existingExecution.version,
      });
      return existingExecution;
    }

    // Start tracking
    const execution = await tracker.startSeed(SEED_NAME, VERSION, environment);
    const stats = {
      created: 0, skipped: 0, errors: 0, priceMatches: 0, defaultPrices: 0,
    };

    // ==========================================
    // STEP 1: LOAD TOURS AND RATES
    // ==========================================
    logger.info('📋 Loading Tours and Rates...');

    // Get all tours from Tour table
    const TourClass = Parse.Object.extend('Tour');
    const toursQuery = new Parse.Query(TourClass);
    toursQuery.equalTo('exists', true);
    toursQuery.include('destinationPOI');
    toursQuery.include('vehicleType');
    toursQuery.limit(500);

    const tours = await toursQuery.find({ useMasterKey: true });

    // Get all rates
    const RateClass = Parse.Object.extend('Rate');
    const ratesQuery = new Parse.Query(RateClass);
    ratesQuery.equalTo('exists', true);
    ratesQuery.equalTo('active', true);

    const rates = await ratesQuery.find({ useMasterKey: true });

    logger.info(`Found ${tours.length} tours and ${rates.length} rates`);
    logger.info(`Will create ${tours.length * rates.length} tour prices`);

    // ==========================================
    // STEP 2: BUILD PRICE LOOKUP FROM ORIGINAL TOURS TABLE
    // ==========================================
    logger.info('💰 Building price lookup from original Tours table...');

    const ToursClass = Parse.Object.extend('Tours');
    const originalToursQuery = new Parse.Query(ToursClass);
    originalToursQuery.equalTo('exists', true);
    originalToursQuery.include('rate');
    originalToursQuery.include('destinationPOI');
    originalToursQuery.include('vehicleType');
    originalToursQuery.limit(500);

    const originalTours = await originalToursQuery.find({ useMasterKey: true });

    // Create price lookup: rate-destination-vehicle-time -> price
    const priceLookup = new Map();

    for (const tour of originalTours) {
      const rate = tour.get('rate');
      const destinationPOI = tour.get('destinationPOI');
      const vehicleType = tour.get('vehicleType');
      const time = tour.get('time');
      const price = tour.get('price');

      if (rate && destinationPOI && vehicleType && time && price) {
        const lookupKey = `${rate.id}-${destinationPOI.id}-${vehicleType.id}-${time}`;
        priceLookup.set(lookupKey, price);
      }
    }

    logger.info(`Built price lookup with ${priceLookup.size} entries from original Tours table`);

    // ==========================================
    // STEP 3: CREATE TOUR PRICES
    // ==========================================
    logger.info('📦 Creating TourPrices records...');

    const TourPricesClass = Parse.Object.extend('TourPrices');

    for (let rateIndex = 0; rateIndex < rates.length; rateIndex += 1) {
      const rate = rates[rateIndex];
      const rateName = rate.get('name');
      const defaultPrice = DEFAULT_TOUR_PRICES[rateName] || DEFAULT_TOUR_PRICES['First Class'];

      logger.info(`Creating tour prices for ${rateName} (${rateIndex + 1}/${rates.length})...`);

      let rateCreated = 0;
      let rateSkipped = 0;

      for (const tour of tours) {
        try {
          // Check if tour price already exists
          const existingQuery = new Parse.Query(TourPricesClass);
          existingQuery.equalTo('ratePtr', rate);
          existingQuery.equalTo('tourPtr', tour);
          existingQuery.equalTo('exists', true);

          const existingTourPrice = await existingQuery.first({ useMasterKey: true });

          if (existingTourPrice) {
            stats.skipped += 1;
            rateSkipped += 1;
            // eslint-disable-next-line no-continue
            continue;
          }

          // Build lookup key for price matching
          const destinationPOI = tour.get('destinationPOI');
          const vehicleType = tour.get('vehicleType');
          const time = tour.get('time');

          const lookupKey = `${rate.id}-${destinationPOI.id}-${vehicleType.id}-${time}`;

          // Get actual price from lookup or use default
          let actualPrice = priceLookup.get(lookupKey);
          if (actualPrice) {
            stats.priceMatches += 1;
          } else {
            actualPrice = defaultPrice.price;
            stats.defaultPrices += 1;
          }

          // Create new tour price
          const tourPrice = new TourPricesClass();
          tourPrice.set('ratePtr', rate);
          tourPrice.set('tourPtr', tour);
          tourPrice.set('price', actualPrice);
          tourPrice.set('currency', defaultPrice.currency);
          tourPrice.set('active', true);
          tourPrice.set('exists', true);

          await tourPrice.save(null, { useMasterKey: true });

          stats.created += 1;
          rateCreated += 1;
        } catch (error) {
          stats.errors += 1;
          logger.error(`Error creating tour price for ${rateName}:`, error.message);
        }
      }

      logger.info(`  ✅ ${rateName}: created ${rateCreated}, skipped ${rateSkipped}`);
    }

    // Complete tracking
    const result = await tracker.completeSeed(execution.id, stats);

    logger.info(`✅ Seed ${SEED_NAME} completed successfully`, {
      environment,
      stats,
      duration: `${result.duration}ms`,
    });

    return result;
  } catch (error) {
    logger.error(`❌ Seed ${SEED_NAME} failed:`, error.message);
    throw error;
  }
}

// Export for use by seed runner
module.exports = {
  name: SEED_NAME,
  version: VERSION,
  description: 'Create TourPrices with rate-specific pricing for all tours',
  dependencies: ['013-seed-tour-catalog'],
  seed,
};

// Run directly if called
if (require.main === module) {
  seed().then(() => {
    process.exit(0);
  }).catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', error);
    process.exit(1);
  });
}
