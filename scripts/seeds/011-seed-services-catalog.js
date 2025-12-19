/**
 * Seed 011 - Services Catalog (Simplified Route Services).
 *
 * Creates the Services table from existing Service data, extracting unique route combinations
 * with rate associations. This creates a clean catalog of transportation services.
 *
 * Data Structure:
 * - originPOI: Origin point (can be NULL for airport/local services)
 * - destinationPOI: Destination point (required)
 * - rate: Service rate category (required)
 * - note: Service notes (optional)
 * - active: Service availability (boolean)
 * - exists: Logical deletion flag (boolean)
 *
 * Business Logic:
 * - Services without originPOI are valid (airport return trips, local services, flexible origin)
 * - Each unique combination of origin-destination-rate creates one service
 * - Service type is determined by destinationPOI.serviceType (Aeropuerto, Punto a Punto, Local)
 * - Vehicle type handling moved to separate system for flexibility.
 *
 * Configuration:
 * - Idempotent: true - Can be run multiple times safely, creates unique combinations only
 * - Dependencies: 005-seed-rates, 007-seed-services-from-csv
 * @author Denisse Maldonado
 * @version 2.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');
const SeedTracker = require('../global/seeds/seed-tracker');

// Seed configuration
const SEED_NAME = '011-seed-services-catalog';
const VERSION = '2.0.0';

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
    const stats = { created: 0, skipped: 0, errors: 0 };

    // ==========================================
    // STEP 1: GET ALL VALID SERVICES FROM SERVICE TABLE
    // ==========================================
    logger.info('📋 Loading services from Service table...');

    const ServiceClass = Parse.Object.extend('Service');
    const serviceQuery = new Parse.Query(ServiceClass);
    serviceQuery.equalTo('exists', true);
    serviceQuery.include('originPOI');
    serviceQuery.include('destinationPOI');
    serviceQuery.include('rate');
    serviceQuery.include('destinationPOI.serviceType');
    serviceQuery.limit(1000); // Get all services

    const originalServices = await serviceQuery.find({ useMasterKey: true });
    logger.info(`Found ${originalServices.length} services in Service table`);

    // ==========================================
    // STEP 2: FILTER TO VALID SERVICES
    // ==========================================
    const validServices = [];

    for (const service of originalServices) {
      const destinationPOI = service.get('destinationPOI');
      const rate = service.get('rate');

      // A service is valid if it has destinationPOI + rate (originPOI can be null)
      if (destinationPOI && rate) {
        validServices.push({
          originPOI: service.get('originPOI'), // Can be null
          destinationPOI,
          rate,
          note: service.get('note') || '',
          originalId: service.id,
        });
      }
    }

    logger.info(`Found ${validServices.length} valid services (including those without originPOI)`);

    // ==========================================
    // STEP 3: CREATE UNIQUE ROUTE COMBINATIONS
    // ==========================================
    const ServicesClass = Parse.Object.extend('Services');
    const uniqueRoutes = new Map();
    let duplicates = 0;

    for (const serviceData of validServices) {
      // Create unique key: origin(or null)-destination-rate
      const originKey = serviceData.originPOI ? serviceData.originPOI.id : 'NULL';
      const routeKey = `${originKey}-${serviceData.destinationPOI.id}-${serviceData.rate.id}`;

      if (!uniqueRoutes.has(routeKey)) {
        uniqueRoutes.set(routeKey, serviceData);
      } else {
        duplicates += 1;
      }
    }

    logger.info(`Created ${uniqueRoutes.size} unique route combinations (${duplicates} duplicates merged)`);

    // ==========================================
    // STEP 4: CREATE SERVICES RECORDS
    // ==========================================
    logger.info('📦 Creating Services records...');

    for (const [routeKey, serviceData] of uniqueRoutes) {
      try {
        // Check if service already exists
        const existingQuery = new Parse.Query(ServicesClass);
        if (serviceData.originPOI) {
          existingQuery.equalTo('originPOI', serviceData.originPOI);
        } else {
          existingQuery.doesNotExist('originPOI');
        }
        existingQuery.equalTo('destinationPOI', serviceData.destinationPOI);
        existingQuery.equalTo('rate', serviceData.rate);
        existingQuery.equalTo('exists', true);

        const existingService = await existingQuery.first({ useMasterKey: true });

        if (existingService) {
          stats.skipped += 1;
          // eslint-disable-next-line no-continue
          continue;
        }

        // Create new service
        const newService = new ServicesClass();

        // Set originPOI (can be null for airport/local services)
        if (serviceData.originPOI) {
          newService.set('originPOI', serviceData.originPOI);
        }

        newService.set('destinationPOI', serviceData.destinationPOI);
        newService.set('rate', serviceData.rate);
        newService.set('note', serviceData.note);
        newService.set('active', true);
        newService.set('exists', true);

        await newService.save(null, { useMasterKey: true });
        stats.created += 1;

        if (stats.created % 50 === 0) {
          logger.info(`Progress: ${stats.created}/${uniqueRoutes.size} services created`);
        }
      } catch (error) {
        stats.errors += 1;
        logger.error(`Error creating service ${routeKey}:`, error.message);
      }
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
  description: 'Create Services catalog from Service table (simplified route services with rate associations)',
  dependencies: ['005-seed-rates', '007-seed-services-from-csv'],
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
