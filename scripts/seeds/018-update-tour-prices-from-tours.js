/**
 * Seed 018 - Update TourPrices with actual prices from Tours table.
 *
 * Updates TourPrices placeholder prices with actual pricing data from Tours table.
 * Matches entries based on vehicleType, rate, and destinationPOI.
 *
 * Data Matching Logic:
 * - TourPrices.vehicleType = Tours.vehicleType
 * - TourPrices.ratePtr = Tours.rate
 * - TourPrices.tourPtr.destinationPOI = Tours.destinationPOI
 * 
 * Business Logic:
 * - Replaces placeholder prices (1000, 1200, 1500) with actual prices from Tours
 * - Only updates existing TourPrices entries (no creation)
 * - Preserves currency and other metadata
 * - Reports unmatched entries for analysis
 *
 * Configuration:
 * - Idempotent: true - Can be run multiple times safely
 * - Dependencies: 015-populate-tour-prices-first-class, 016-populate-tour-prices-green-class, 017-populate-tour-prices-premium, 010-seed-tours-from-csv
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 2024-12-15
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

// Seed configuration
const SEED_NAME = '018-update-tour-prices-from-tours';
const VERSION = '1.0.0';

/**
 * Run the seed
 * @returns {Promise<object>} Seed result with statistics
 */
async function run() {
  const startTime = Date.now();
  const stats = {
    total: 0,
    updated: 0,
    noMatch: 0,
    errors: 0,
    priceChanges: []
  };

  logger.info(`🌱 Starting ${SEED_NAME} v${VERSION}`);

  try {
    // ==========================================
    // STEP 1: GET ALL TOUR PRICES TO UPDATE
    // ==========================================
    logger.info('📋 Loading TourPrices entries...');
    
    const TourPricesClass = Parse.Object.extend('TourPrices');
    const tourPricesQuery = new Parse.Query(TourPricesClass);
    tourPricesQuery.equalTo('exists', true);
    tourPricesQuery.include(['ratePtr', 'tourPtr', 'vehicleType', 'tourPtr.destinationPOI']);
    tourPricesQuery.limit(1000);
    
    const tourPrices = await tourPricesQuery.find({ useMasterKey: true });
    logger.info(`✅ Found ${tourPrices.length} TourPrices entries to process`);

    // ==========================================
    // STEP 2: GET ALL TOURS WITH PRICING DATA
    // ==========================================
    logger.info('💰 Loading Tours table with pricing data...');
    
    const ToursClass = Parse.Object.extend('Tours');
    const toursQuery = new Parse.Query(ToursClass);
    toursQuery.equalTo('exists', true);
    toursQuery.include(['destinationPOI', 'vehicleType', 'rate']);
    toursQuery.limit(1000);
    
    const tours = await toursQuery.find({ useMasterKey: true });
    logger.info(`✅ Found ${tours.length} Tours entries with pricing data`);

    // ==========================================
    // STEP 3: CREATE LOOKUP MAP
    // ==========================================
    logger.info('🗂️  Creating price lookup map...');
    
    const priceMap = new Map();
    
    tours.forEach(tour => {
      const destinationPOI = tour.get('destinationPOI');
      const vehicleType = tour.get('vehicleType');
      const rate = tour.get('rate');
      const price = tour.get('price');
      
      if (destinationPOI && vehicleType && rate && price) {
        const key = `${destinationPOI.id}-${vehicleType.id}-${rate.id}`;
        priceMap.set(key, {
          price,
          tourInfo: `${destinationPOI.get('name')} | ${vehicleType.get('name')} | ${rate.get('name')}`
        });
      }
    });
    
    logger.info(`✅ Created lookup map with ${priceMap.size} pricing entries`);

    // ==========================================
    // STEP 4: UPDATE TOUR PRICES
    // ==========================================
    logger.info('🔧 Updating TourPrices with actual prices...');
    
    for (const tourPrice of tourPrices) {
      stats.total++;
      
      try {
        const tour = tourPrice.get('tourPtr');
        const vehicleType = tourPrice.get('vehicleType');
        const rate = tourPrice.get('ratePtr');
        
        if (!tour || !vehicleType || !rate) {
          logger.warn(`Skipping incomplete TourPrice entry ${tourPrice.id}`);
          stats.errors++;
          continue;
        }
        
        const destinationPOI = tour.get('destinationPOI');
        if (!destinationPOI) {
          logger.warn(`Skipping TourPrice ${tourPrice.id} - no destination POI`);
          stats.errors++;
          continue;
        }
        
        // Create lookup key
        const lookupKey = `${destinationPOI.id}-${vehicleType.id}-${rate.id}`;
        const priceData = priceMap.get(lookupKey);
        
        if (priceData) {
          const oldPrice = tourPrice.get('price');
          const actualPrice = priceData.price;
          
          // Only update if price is different
          if (oldPrice !== actualPrice) {
            tourPrice.set('price', actualPrice);
            await tourPrice.save(null, { useMasterKey: true });
            
            const changeInfo = {
              info: priceData.tourInfo,
              oldPrice,
              newPrice: actualPrice
            };
            
            stats.priceChanges.push(changeInfo);
            logger.info(`Updated: ${priceData.tourInfo} | ${oldPrice} → ${actualPrice} MXN`);
          }
          
          stats.updated++;
          
        } else {
          const destinationName = destinationPOI.get('name');
          const vehicleName = vehicleType.get('name');
          const rateName = rate.get('name');
          
          logger.warn(`No matching price: ${destinationName} | ${vehicleName} | ${rateName}`);
          stats.noMatch++;
        }
        
        // Progress indicator
        if (stats.total % 20 === 0) {
          logger.info(`Progress: ${stats.total}/${tourPrices.length} processed`);
        }
        
      } catch (error) {
        stats.errors++;
        logger.error(`Error updating TourPrice ${tourPrice.id}:`, error.message);
      }
    }

    const duration = Date.now() - startTime;

    logger.info(`✅ Seed ${SEED_NAME} completed successfully`, {
      stats: {
        total: stats.total,
        updated: stats.updated,
        noMatch: stats.noMatch,
        errors: stats.errors,
        priceChanges: stats.priceChanges.length
      },
      duration: `${duration}ms`,
    });

    // Log some price change examples
    if (stats.priceChanges.length > 0) {
      logger.info('📋 Sample price updates:');
      stats.priceChanges.slice(0, 5).forEach((change, index) => {
        logger.info(`${index + 1}. ${change.info} | ${change.oldPrice} → ${change.newPrice} MXN`);
      });
    }

    return {
      success: true,
      duration,
      statistics: {
        total: stats.total,
        updated: stats.updated,
        noMatch: stats.noMatch,
        errors: stats.errors
      },
      metadata: {
        priceChanges: stats.priceChanges.length,
        lookupEntries: priceMap.size,
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
  description: 'Update TourPrices with actual prices from Tours table by matching vehicleType, rate, and destinationPOI',
  run,
};