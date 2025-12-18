/**
 * Migration - Complete Sync of All Rates Prices from Service Table
 *
 * This migration handles: Full synchronization of all rate prices from Service table
 *
 * Database Changes:
 * - Processes ALL RatePrices for ALL rates
 * - Updates prices with actual data from Service table
 * - Handles all rate types: Green Class, Premium, Económico, First Class
 *
 * Dependencies:
 * - Service table must exist with price data
 * - Services table must exist
 * - RatePrices table must exist
 *
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 2024-12-11
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

// Configuration
const MIGRATION_NAME = 'sync-all-rates-prices-complete';
const VERSION = '1.0.0';

/**
 * Apply migration (forward)
 *
 * This function will:
 * 1. Query ALL RatePrices records for ALL rates
 * 2. For each RatePrice, find matching Service record by rate and route
 * 3. Update RatePrice with actual price from Service table
 *
 * @returns {Promise<object>} Migration result with statistics
 */
async function up() {
  const startTime = Date.now();
  const stats = {
    tablesCreated: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    indexesCreated: 0,
    pricesMatched: 0,
    pricesNotFound: 0,
    rateStats: {}
  };

  try {
    logger.info(`[${MIGRATION_NAME}] Starting comprehensive migration for all rates...`);

    // ==========================================
    // STEP 1: GET ALL RATES
    // ==========================================
    const RateClass = Parse.Object.extend('Rate');
    const rateQuery = new Parse.Query(RateClass);
    rateQuery.equalTo('exists', true);
    const allRates = await rateQuery.find({ useMasterKey: true });
    
    logger.info(`[${MIGRATION_NAME}] Processing ${allRates.length} rates`);

    // ==========================================
    // STEP 2: PROCESS EACH RATE SEPARATELY
    // ==========================================
    for (const rate of allRates) {
      const rateName = rate.get('name');
      logger.info(`[${MIGRATION_NAME}] Processing rate: ${rateName}`);
      
      stats.rateStats[rateName] = {
        processed: 0,
        updated: 0,
        notFound: 0,
        skipped: 0
      };

      // Query RatePrices for this specific rate
      const RatePricesClass = Parse.Object.extend('RatePrices');
      const ratePricesQuery = new Parse.Query(RatePricesClass);
      ratePricesQuery.equalTo('exists', true);
      ratePricesQuery.equalTo('ratePtr', rate);
      ratePricesQuery.include('servicePtr');
      ratePricesQuery.include('servicePtr.originPOI');
      ratePricesQuery.include('servicePtr.destinationPOI');
      ratePricesQuery.include('servicePtr.vehicleType');
      
      // Process in batches to handle large datasets
      let skip = 0;
      const limit = 500;
      let hasMore = true;

      while (hasMore) {
        ratePricesQuery.skip(skip);
        ratePricesQuery.limit(limit);
        const ratePrices = await ratePricesQuery.find({ useMasterKey: true });

        if (ratePrices.length === 0) {
          hasMore = false;
        } else {
          logger.info(`[${MIGRATION_NAME}] Processing batch: ${skip + 1}-${skip + ratePrices.length} for rate ${rateName}`);

          // ==========================================
          // STEP 3: PROCESS EACH RATE PRICE
          // ==========================================
          for (const ratePrice of ratePrices) {
            stats.rateStats[rateName].processed++;
            
            try {
              const service = ratePrice.get('servicePtr');
              
              if (!service) {
                logger.warn(`[${MIGRATION_NAME}] Skipping RatePrice with missing service`, {
                  ratePriceId: ratePrice.id,
                  rateName: rateName,
                });
                stats.rateStats[rateName].skipped++;
                continue;
              }

              const originPOI = service.get('originPOI');
              const destinationPOI = service.get('destinationPOI');
              const vehicleType = service.get('vehicleType');

              if (!originPOI || !destinationPOI || !vehicleType) {
                logger.warn(`[${MIGRATION_NAME}] Skipping RatePrice with incomplete service data`, {
                  ratePriceId: ratePrice.id,
                  serviceId: service.id,
                  rateName: rateName,
                });
                stats.rateStats[rateName].skipped++;
                continue;
              }

              // ==========================================
              // STEP 4: FIND MATCHING SERVICE RECORD
              // ==========================================
              const ServiceClass = Parse.Object.extend('Service');
              const serviceQuery = new Parse.Query(ServiceClass);
              serviceQuery.equalTo('exists', true);
              serviceQuery.equalTo('rate', rate);
              serviceQuery.equalTo('originPOI', originPOI);
              serviceQuery.equalTo('destinationPOI', destinationPOI);
              serviceQuery.equalTo('vehicleType', vehicleType);

              const matchingService = await serviceQuery.first({ useMasterKey: true });

              if (matchingService && matchingService.get('price')) {
                // ==========================================
                // STEP 5: UPDATE RATE PRICE WITH ACTUAL PRICE
                // ==========================================
                const actualPrice = matchingService.get('price');
                const oldPrice = ratePrice.get('price');
                
                ratePrice.set('price', actualPrice);
                
                await ratePrice.save(null, { useMasterKey: true });
                stats.recordsUpdated++;
                stats.pricesMatched++;
                stats.rateStats[rateName].updated++;

                logger.info(`[${MIGRATION_NAME}] Updated price for ${rateName}`, {
                  ratePriceId: ratePrice.id,
                  origin: originPOI.get('name'),
                  destination: destinationPOI.get('name'),
                  vehicle: vehicleType.get('name'),
                  oldPrice: oldPrice,
                  newPrice: actualPrice,
                });
              } else {
                stats.pricesNotFound++;
                stats.rateStats[rateName].notFound++;
                logger.debug(`[${MIGRATION_NAME}] No matching Service found for ${rateName}`, {
                  ratePriceId: ratePrice.id,
                  origin: originPOI?.get('name') || 'N/A',
                  destination: destinationPOI?.get('name') || 'N/A',
                  vehicle: vehicleType?.get('name') || 'N/A',
                });
              }
            } catch (error) {
              logger.error(`[${MIGRATION_NAME}] Error processing RatePrice for ${rateName}`, {
                ratePriceId: ratePrice.id,
                error: error.message,
              });
              stats.rateStats[rateName].skipped++;
            }
          }

          skip += ratePrices.length;

          // If we got less than the limit, we've reached the end
          if (ratePrices.length < limit) {
            hasMore = false;
          }
        }
      }

      logger.info(`[${MIGRATION_NAME}] Completed rate ${rateName}:`, stats.rateStats[rateName]);
    }

    const duration = Date.now() - startTime;
    logger.info(`[${MIGRATION_NAME}] Migration completed successfully`, {
      duration: `${duration}ms`,
      stats,
    });

    return {
      success: true,
      duration,
      stats,
      message: `Migration ${MIGRATION_NAME} completed successfully`,
    };
  } catch (error) {
    logger.error(`[${MIGRATION_NAME}] Migration failed`, {
      error: error.message,
      stack: error.stack,
    });

    throw new Error(`Migration failed: ${error.message}`);
  }
}

/**
 * Revert migration (backward)
 *
 * This function will:
 * 1. Reset all RatePrices to default pricing structure
 *
 * @returns {Promise<object>} Rollback result with statistics
 */
async function down() {
  const startTime = Date.now();
  const stats = {
    tablesDeleted: 0,
    recordsDeleted: 0,
    recordsUpdated: 0,
    indexesRemoved: 0,
  };

  try {
    logger.warn(`[${MIGRATION_NAME}] Starting rollback...`);

    // ==========================================
    // STEP 1: RESET ALL RATE PRICES TO DEFAULTS
    // ==========================================
    const defaultPrices = {
      'Green Class': { basePrice: 1000, currency: 'MXN' },
      'Premium': { basePrice: 1500, currency: 'MXN' },
      'Executive': { basePrice: 2000, currency: 'MXN' },
      'Económico': { basePrice: 1200, currency: 'MXN' },
      'First Class': { basePrice: 1200, currency: 'MXN' },
    };

    const RatePricesClass = Parse.Object.extend('RatePrices');
    const query = new Parse.Query(RatePricesClass);
    query.include('ratePtr');
    
    let skip = 0;
    const limit = 500;
    let hasMore = true;

    while (hasMore) {
      query.skip(skip);
      query.limit(limit);
      const ratePrices = await query.find({ useMasterKey: true });

      if (ratePrices.length === 0) {
        hasMore = false;
      } else {
        for (const ratePrice of ratePrices) {
          try {
            const rate = ratePrice.get('ratePtr');
            const rateName = rate?.get('name');
            const priceConfig = defaultPrices[rateName] || { basePrice: 1200, currency: 'MXN' };
            
            ratePrice.set('price', priceConfig.basePrice);
            await ratePrice.save(null, { useMasterKey: true });
            stats.recordsUpdated++;
          } catch (error) {
            logger.error(`[${MIGRATION_NAME}] Error resetting RatePrice`, {
              ratePriceId: ratePrice.id,
              error: error.message,
            });
          }
        }

        skip += ratePrices.length;

        if (ratePrices.length < limit) {
          hasMore = false;
        }
      }
    }

    const duration = Date.now() - startTime;
    logger.warn(`[${MIGRATION_NAME}] Rollback completed successfully`, {
      duration: `${duration}ms`,
      stats,
    });

    return {
      success: true,
      duration,
      stats,
      message: `Rollback of ${MIGRATION_NAME} completed successfully`,
    };
  } catch (error) {
    logger.error(`[${MIGRATION_NAME}] Rollback failed`, {
      error: error.message,
      stack: error.stack,
    });

    throw new Error(`Rollback failed: ${error.message}`);
  }
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  version: VERSION,
  description: 'Complete sync of all rate prices from Service table',
  up,
  down,
};