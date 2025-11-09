/**
 * Seed 004 - POIs Ciudades (Punto a Punto)
 *
 * Seeds 18 city destinations from docs/tarifario/datos_ciudades.txt
 * All destinations are assigned to the "Punto a Punto" service type.
 *
 * This seed is idempotent and can be run multiple times safely.
 * Existing records will be skipped.
 *
 * Dependencies:
 * - 001-seed-service-types (requires "Punto a Punto" service type to exist)
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-10-25
 */

const fs = require('fs');
const path = require('path');
const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

// Seed configuration
const SEED_NAME = '004-seed-pois-ciudades';
const VERSION = '1.0.0';
const DATA_FILE = path.join(__dirname, '../../docs/tarifario/datos_ciudades.txt');

/**
 * Load city destinations from text file
 * @returns {Array<string>} Array of city names
 */
function loadCityDestinations() {
  try {
    const fileContent = fs.readFileSync(DATA_FILE, 'utf-8');
    const destinations = fileContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    logger.info(`[${SEED_NAME}] Loaded ${destinations.length} cities from file`, {
      filePath: DATA_FILE,
    });

    return destinations;
  } catch (error) {
    logger.error(`[${SEED_NAME}] Failed to load cities file`, {
      filePath: DATA_FILE,
      error: error.message,
    });
    throw new Error(`Failed to load cities file: ${error.message}`);
  }
}

/**
 * Find the "Punto a Punto" service type
 * @returns {Promise<object>} Punto a Punto service type Parse object
 */
async function findPuntoAPuntoServiceType() {
  try {
    const ServiceTypeClass = Parse.Object.extend('ServiceType');
    const query = new Parse.Query(ServiceTypeClass);
    query.matches('name', '^Punto a Punto$', 'i'); // Case insensitive exact match
    query.equalTo('active', true);
    query.equalTo('exists', true);

    const puntoAPuntoType = await query.first({ useMasterKey: true });

    if (!puntoAPuntoType) {
      throw new Error('Punto a Punto service type not found. Please run 001-seed-service-types first.');
    }

    logger.info(`[${SEED_NAME}] Found Punto a Punto service type`, {
      id: puntoAPuntoType.id,
      name: puntoAPuntoType.get('name'),
    });

    return puntoAPuntoType;
  } catch (error) {
    logger.error(`[${SEED_NAME}] Failed to find Punto a Punto service type`, {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Check if a POI exists by name AND serviceType (case insensitive)
 * @param {string} name - POI name
 * @param {object} serviceType - ServiceType Parse object
 * @returns {Promise<boolean>} True if exists
 */
async function poiExists(name, serviceType) {
  try {
    const POIClass = Parse.Object.extend('POI');
    const query = new Parse.Query(POIClass);
    query.matches('name', `^${name}$`, 'i'); // Case insensitive exact match
    query.equalTo('serviceType', serviceType); // Must match serviceType too
    query.equalTo('exists', true);
    query.limit(1);

    const count = await query.count({ useMasterKey: true });
    return count > 0;
  } catch (error) {
    logger.error(`[${SEED_NAME}] Error checking POI existence`, {
      name,
      error: error.message,
    });
    return false;
  }
}

/**
 * Create a single POI
 * @param {string} name - POI name
 * @param {object} puntoAPuntoType - Punto a Punto service type Parse object
 * @returns {Promise<object>} Created POI
 */
async function createPOI(name, puntoAPuntoType) {
  try {
    // IMPORTANT: Use Parse.Object.extend instead of POI class
    // The registered POI class (BaseModel subclass) has issues with set() + save()
    // Using Parse.Object.extend directly works correctly
    const POIClass = Parse.Object.extend('POI');
    const poi = new POIClass();

    poi.set('name', name);
    poi.set('active', true);
    poi.set('exists', true);
    poi.set('serviceType', puntoAPuntoType); // Set pointer to Punto a Punto service type

    const saved = await poi.save(null, { useMasterKey: true });

    logger.info(`[${SEED_NAME}] POI created`, {
      id: saved.id,
      name,
    });

    return saved;
  } catch (error) {
    logger.error(`[${SEED_NAME}] Error creating POI`, {
      name,
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
    // Step 1: Load destinations from file
    const destinations = loadCityDestinations();

    logger.info(`[${SEED_NAME}] Loaded ${destinations.length} city destinations to seed`);

    // Step 2: Find Punto a Punto service type
    const puntoAPuntoType = await findPuntoAPuntoServiceType();

    // Step 3: Seed each destination
    for (const destinationName of destinations) {
      try {
        // Check if POI already exists with this serviceType
        const exists = await poiExists(destinationName, puntoAPuntoType);

        if (exists) {
          logger.info(`[${SEED_NAME}] POI already exists, skipping`, {
            name: destinationName,
          });
          statistics.skipped++;
          continue;
        }

        // Create POI
        await createPOI(destinationName, puntoAPuntoType);
        statistics.created++;
      } catch (error) {
        statistics.errors++;
        logger.error(`[${SEED_NAME}] Failed to seed POI`, {
          name: destinationName,
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
        totalDestinations: destinations.length,
        dataFile: DATA_FILE,
        serviceType: 'Punto a Punto',
        serviceTypeId: puntoAPuntoType.id,
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
  description: 'Seed 18 city destinations from docs/tarifario/datos_ciudades.txt',
  run,
};
