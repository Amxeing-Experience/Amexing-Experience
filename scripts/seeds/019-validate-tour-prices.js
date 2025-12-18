/**
 * Seed 019 - Validate TourPrices after price update.
 *
 * This validation seed checks that TourPrices have been successfully updated
 * with actual prices from Tours table and provides a summary report.
 *
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 2024-12-15
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

// Seed configuration
const SEED_NAME = '019-validate-tour-prices';
const VERSION = '1.0.0';

/**
 * Run the validation
 * @returns {Promise<object>} Validation result with statistics
 */
async function run() {
  const startTime = Date.now();

  logger.info(`🔍 Starting ${SEED_NAME} v${VERSION}`);

  try {
    // Get all TourPrices entries
    const TourPricesClass = Parse.Object.extend('TourPrices');
    const query = new Parse.Query(TourPricesClass);
    query.equalTo('exists', true);
    query.include(['ratePtr', 'tourPtr', 'vehicleType', 'tourPtr.destinationPOI']);
    query.limit(1000);
    
    const tourPrices = await query.find({ useMasterKey: true });
    logger.info(`✅ Found ${tourPrices.length} TourPrices entries`);

    // Analyze pricing data
    const stats = {
      totalEntries: tourPrices.length,
      placeholderPrices: 0,
      updatedPrices: 0,
      rateBreakdown: {},
      priceDistribution: {
        '1000': 0,  // Original First Class placeholder
        '1200': 0,  // Original Green Class placeholder  
        '1500': 0,  // Original Premium placeholder
        'updated': 0
      }
    };

    const examples = [];

    tourPrices.forEach(tourPrice => {
      const rate = tourPrice.get('ratePtr');
      const tour = tourPrice.get('tourPtr');
      const vehicleType = tourPrice.get('vehicleType');
      const price = tourPrice.get('price');
      
      const rateName = rate ? rate.get('name') : 'Unknown';
      const destinationName = tour && tour.get('destinationPOI') ? 
        tour.get('destinationPOI').get('name') : 'Unknown';
      const vehicleName = vehicleType ? vehicleType.get('name') : 'Unknown';

      // Initialize rate breakdown
      if (!stats.rateBreakdown[rateName]) {
        stats.rateBreakdown[rateName] = {
          total: 0,
          updated: 0,
          placeholder: 0,
          minPrice: Infinity,
          maxPrice: 0
        };
      }

      const rateStats = stats.rateBreakdown[rateName];
      rateStats.total++;

      // Track pricing status
      if (price === 1000 || price === 1200 || price === 1500) {
        stats.placeholderPrices++;
        rateStats.placeholder++;
        stats.priceDistribution[price.toString()]++;
      } else {
        stats.updatedPrices++;
        rateStats.updated++;
        stats.priceDistribution.updated++;
        
        // Store examples of updated prices
        if (examples.length < 10) {
          examples.push({
            destination: destinationName,
            vehicle: vehicleName,
            rate: rateName,
            price
          });
        }
      }

      // Track price range for each rate
      if (price < rateStats.minPrice) rateStats.minPrice = price;
      if (price > rateStats.maxPrice) rateStats.maxPrice = price;
    });

    // Fix infinite min prices
    Object.values(stats.rateBreakdown).forEach(rateStats => {
      if (rateStats.minPrice === Infinity) rateStats.minPrice = 0;
    });

    const duration = Date.now() - startTime;

    // Log detailed results
    logger.info('📊 TourPrices Validation Summary:');
    logger.info(`Total entries: ${stats.totalEntries}`);
    logger.info(`Updated prices: ${stats.updatedPrices} (${((stats.updatedPrices / stats.totalEntries) * 100).toFixed(1)}%)`);
    logger.info(`Placeholder prices: ${stats.placeholderPrices} (${((stats.placeholderPrices / stats.totalEntries) * 100).toFixed(1)}%)`);

    // Log rate breakdown
    logger.info('📋 Breakdown by Rate:');
    Object.entries(stats.rateBreakdown).forEach(([rateName, rateStats]) => {
      const updateRate = ((rateStats.updated / rateStats.total) * 100).toFixed(1);
      logger.info(`${rateName}: ${rateStats.updated}/${rateStats.total} updated (${updateRate}%) | Price range: $${rateStats.minPrice}-$${rateStats.maxPrice} MXN`);
    });

    // Log examples of updated prices
    if (examples.length > 0) {
      logger.info('💰 Sample updated prices:');
      examples.slice(0, 5).forEach((example, index) => {
        logger.info(`${index + 1}. ${example.destination} | ${example.vehicle} | ${example.rate} | $${example.price} MXN`);
      });
    }

    logger.info(`✅ Validation ${SEED_NAME} completed successfully`, {
      duration: `${duration}ms`,
      statistics: stats
    });

    return {
      success: true,
      duration,
      statistics: stats,
      metadata: {
        updateSuccessRate: ((stats.updatedPrices / stats.totalEntries) * 100).toFixed(1) + '%',
        totalValidated: stats.totalEntries
      }
    };

  } catch (error) {
    logger.error(`❌ Validation ${SEED_NAME} failed:`, error.message);
    throw new Error(`Validation failed: ${error.message}`);
  }
}

// Export for use by seed runner
module.exports = {
  version: VERSION,
  description: 'Validate TourPrices after price update to ensure actual prices from Tours table were applied',
  run,
};