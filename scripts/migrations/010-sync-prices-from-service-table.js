/**
 * Migration - Sync Prices from Service Table to RatePrices
 *
 * This migration handles: Updating RatePrices table with actual prices from Service table
 *
 * Database Changes:
 * - Matches Services with Service records by route (origin, destination, vehicle)
 * - Updates RatePrices with actual prices from Service table instead of default values
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
const MIGRATION_NAME = 'sync-prices-from-service-table';
const VERSION = '1.0.0';

/**
 * Apply migration (forward)
 *
 * This function will:
 * 1. Query all RatePrices records
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
  };

  try {
    logger.info(`[${MIGRATION_NAME}] Starting migration...`);

    // ==========================================
    // STEP 1: GET ALL RATE PRICES
    // ==========================================
    const RatePricesClass = Parse.Object.extend('RatePrices');
    const ratePricesQuery = new Parse.Query(RatePricesClass);
    ratePricesQuery.equalTo('exists', true);
    ratePricesQuery.include('ratePtr');
    ratePricesQuery.include('servicePtr');
    ratePricesQuery.include('servicePtr.originPOI');
    ratePricesQuery.include('servicePtr.destinationPOI');
    ratePricesQuery.include('servicePtr.vehicleType');
    ratePricesQuery.limit(1000);

    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      ratePricesQuery.skip(skip);
      const ratePrices = await ratePricesQuery.find({ useMasterKey: true });

      if (ratePrices.length === 0) {
        hasMore = false;
      } else {
        // ==========================================
        // STEP 2: PROCESS EACH RATE PRICE
        // ==========================================
        for (const ratePrice of ratePrices) {
          try {
            const rate = ratePrice.get('ratePtr');
            const service = ratePrice.get('servicePtr');
            
            if (!rate || !service) {
              logger.warn(`[${MIGRATION_NAME}] Skipping RatePrice with missing rate or service`, {
                ratePriceId: ratePrice.id,
              });
              continue;
            }

            const originPOI = service.get('originPOI');
            const destinationPOI = service.get('destinationPOI');
            const vehicleType = service.get('vehicleType');

            if (!originPOI || !destinationPOI || !vehicleType) {
              logger.warn(`[${MIGRATION_NAME}] Skipping RatePrice with incomplete service data`, {
                ratePriceId: ratePrice.id,
                serviceId: service.id,
              });
              continue;
            }

            // ==========================================
            // STEP 3: FIND MATCHING SERVICE RECORD
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
              // STEP 4: UPDATE RATE PRICE WITH ACTUAL PRICE
              // ==========================================
              const actualPrice = matchingService.get('price');
              ratePrice.set('price', actualPrice);
              
              await ratePrice.save(null, { useMasterKey: true });
              stats.recordsUpdated++;
              stats.pricesMatched++;

              logger.info(`[${MIGRATION_NAME}] Updated price`, {
                ratePriceId: ratePrice.id,
                rate: rate.get('name'),
                origin: originPOI.get('name'),
                destination: destinationPOI.get('name'),
                vehicle: vehicleType.get('name'),
                oldPrice: 'default',
                newPrice: actualPrice,
              });
            } else {
              stats.pricesNotFound++;
              logger.warn(`[${MIGRATION_NAME}] No matching Service found`, {
                ratePriceId: ratePrice.id,
                rate: rate.get('name'),
                origin: originPOI?.get('name') || 'N/A',
                destination: destinationPOI?.get('name') || 'N/A',
                vehicle: vehicleType?.get('name') || 'N/A',
              });
            }
          } catch (error) {
            logger.error(`[${MIGRATION_NAME}] Error processing RatePrice`, {
              ratePriceId: ratePrice.id,
              error: error.message,
            });
          }
        }

        skip += ratePrices.length;

        // If we got less than the limit, we've reached the end
        if (ratePrices.length < 1000) {
          hasMore = false;
        }
      }
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
    };

    const RatePricesClass = Parse.Object.extend('RatePrices');
    const query = new Parse.Query(RatePricesClass);
    query.include('ratePtr');
    query.limit(1000);

    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      query.skip(skip);
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

        if (ratePrices.length < 1000) {
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
  description: 'Sync prices from Service table to RatePrices table',
  up,
  down,
};