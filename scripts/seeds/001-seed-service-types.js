/**
 * Seed 001 - Service Types
 *
 * Seeds the initial 3 service types for the Amexing system:
 * - Aeropuerto (Airport transfers)
 * - Punto a Punto (Point to point transfers)
 * - Local (Local destinations)
 *
 * This seed is idempotent and can be run multiple times safely.
 * Existing records will be skipped.
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-10-25
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

// Seed configuration
const SEED_NAME = '001-seed-service-types';
const VERSION = '1.0.0';

/**
 * Default service types to seed
 */
const DEFAULT_SERVICE_TYPES = [
  {
    name: 'Aeropuerto',
    description: 'Traslados desde/hacia aeropuertos',
  },
  {
    name: 'Punto a Punto',
    description: 'Traslados directos entre dos ubicaciones',
  },
  {
    name: 'Local',
    description: 'Traslados a destinos locales y puntos de interés',
  },
];

/**
 * Check if a service type exists by name (case insensitive)
 * @param {string} name - Service type name
 * @returns {Promise<boolean>} True if exists
 */
async function serviceTypeExists(name) {
  try {
    const ServiceTypeClass = Parse.Object.extend('ServiceType');
    const query = new Parse.Query(ServiceTypeClass);
    query.matches('name', `^${name}$`, 'i'); // Case insensitive exact match
    query.equalTo('exists', true);
    query.limit(1);

    const count = await query.count({ useMasterKey: true });
    return count > 0;
  } catch (error) {
    logger.error(`[${SEED_NAME}] Error checking service type existence`, {
      name,
      error: error.message,
    });
    return false;
  }
}

/**
 * Create a single service type
 * @param {object} typeData - Service type data
 * @returns {Promise<object>} Created service type
 */
async function createServiceType(typeData) {
  try {
    // IMPORTANT: Use Parse.Object.extend instead of ServiceType class
    // The registered ServiceType class (BaseModel subclass) has issues with set() + save()
    // Using Parse.Object.extend directly works correctly
    const ServiceTypeClass = Parse.Object.extend('ServiceType');
    const serviceType = new ServiceTypeClass();

    serviceType.set('name', typeData.name);
    serviceType.set('active', true);
    serviceType.set('exists', true);

    const saved = await serviceType.save(null, { useMasterKey: true });

    logger.info(`[${SEED_NAME}] Service type created`, {
      id: saved.id,
      name: typeData.name,
    });

    return saved;
  } catch (error) {
    logger.error(`[${SEED_NAME}] Error creating service type`, {
      typeData,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Run the seed
 * @returns {Promise<object>} Seed result with statistics
 */
async function run() {
  const startTime = Date.now();
  const statistics = {
    created: 0,
    skipped: 0,
    errors: 0,
  };

  logger.info(`[${SEED_NAME}] Starting seed execution...`);

  try {
    for (const typeData of DEFAULT_SERVICE_TYPES) {
      try {
        // Check if service type already exists
        const exists = await serviceTypeExists(typeData.name);

        if (exists) {
          logger.info(`[${SEED_NAME}] Service type already exists, skipping`, {
            name: typeData.name,
          });
          statistics.skipped++;
          continue;
        }

        // Create service type
        await createServiceType(typeData);
        statistics.created++;
      } catch (error) {
        statistics.errors++;
        logger.error(`[${SEED_NAME}] Failed to seed service type`, {
          name: typeData.name,
          error: error.message,
        });
      }
    }

    const duration = Date.now() - startTime;

    logger.info(`[${SEED_NAME}] Seed completed successfully`, {
      duration: `${duration}ms`,
      statistics,
    });

    return {
      success: true,
      duration,
      statistics,
      metadata: {
        totalTypes: DEFAULT_SERVICE_TYPES.length,
        typesSeeded: DEFAULT_SERVICE_TYPES.map(t => t.name),
      },
    };
  } catch (error) {
    logger.error(`[${SEED_NAME}] Seed failed`, {
      error: error.message,
      stack: error.stack,
    });

    throw new Error(`Seed failed: ${error.message}`);
  }
}

// Export seed module
module.exports = {
  version: VERSION,
  description: 'Seed initial service types (Aeropuerto, Punto a Punto, Local)',
  run,
};
