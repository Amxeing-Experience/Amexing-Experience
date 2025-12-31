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
  const startTime = Date.now();
  console.log(`🌱 Starting ${SEED_NAME} v${VERSION}`);

  try {
    const stats = {
      created: 0, skipped: 0, errors: 0, priceMatches: 0, defaultPrices: 0,
    };

    // ==========================================
    // STEP 1: LOAD TOURS AND RATES
    // ==========================================
    console.log('📋 Loading Tours and Rates...');

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

    console.log(`Found ${tours.length} tours and ${rates.length} rates`);
    console.log(`Will create ${tours.length * rates.length} tour prices`);

    // ==========================================
    // STEP 2: BUILD PRICE LOOKUP FROM ORIGINAL TOURS TABLE
    // ==========================================
    console.log('💰 Building price lookup from original Tours table...');

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

    console.log(`Built price lookup with ${priceLookup.size} entries from original Tours table`);

    // ==========================================
    // STEP 3: CREATE TOUR PRICES
    // ==========================================
    console.log('📦 Creating TourPrices records...');

    const TourPricesClass = Parse.Object.extend('TourPrices');

    for (let rateIndex = 0; rateIndex < rates.length; rateIndex += 1) {
      const rate = rates[rateIndex];
      const rateName = rate.get('name');
      const defaultPrice = DEFAULT_TOUR_PRICES[rateName] || DEFAULT_TOUR_PRICES['First Class'];

      console.log(`Creating tour prices for ${rateName} (${rateIndex + 1}/${rates.length})...`);

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
          console.error(`Error creating tour price for ${rateName}:`, error.message);
        }
      }

      console.log(`  ✅ ${rateName}: created ${rateCreated}, skipped ${rateSkipped}`);
    }

    const duration = Date.now() - startTime;
    console.log(`✅ Seed ${SEED_NAME} completed successfully`);
    console.log(`📊 Statistics:`, stats);
    console.log(`⏱️ Duration: ${duration}ms`);

    return { success: true, stats, duration };
  } catch (error) {
    console.error(`❌ Seed ${SEED_NAME} failed:`, error.message);
    throw error;
  }
}

// Export for use by seed runner
module.exports = {
  name: SEED_NAME,
  version: VERSION,
  description: 'Create TourPrices with rate-specific pricing for all tours',
  dependencies: ['013-seed-tour-catalog'],
  run: seed,
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
