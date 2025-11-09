/**
 * Seed 002 - POIs Local Destinations
 *
 * Seeds 45 local destinations from docs/tarifario/datos_local.txt
 * All destinations are assigned to the "Local" service type.
 *
 * This seed is idempotent and can be run multiple times safely.
 * Existing records will be skipped.
 *
 * Dependencies:
 * - 001-seed-service-types (requires "Local" service type to exist)
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
const SEED_NAME = '002-seed-pois-local';
const VERSION = '1.0.0';
const DATA_FILE = path.join(__dirname, '../../docs/tarifario/datos_local.txt');

/**
 * Load local destinations from text file
 * @returns {Array<string>} Array of destination names
 */
function loadLocalDestinations() {
  try {
    const fileContent = fs.readFileSync(DATA_FILE, 'utf-8');
    const destinations = fileContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    logger.info(`[${SEED_NAME}] Loaded ${destinations.length} destinations from file`, {
      filePath: DATA_FILE,
    });

    return destinations;
  } catch (error) {
    logger.error(`[${SEED_NAME}] Failed to load destinations file`, {
      filePath: DATA_FILE,
      error: error.message,
    });
    throw new Error(`Failed to load destinations file: ${error.message}`);
  }
}

/**
 * Find the "Local" service type
 * @returns {Promise<object>} Local service type Parse object
 */
async function findLocalServiceType() {
  try {
    const ServiceTypeClass = Parse.Object.extend('ServiceType');
    const query = new Parse.Query(ServiceTypeClass);
    query.matches('name', '^Local$', 'i'); // Case insensitive exact match
    query.equalTo('active', true);
    query.equalTo('exists', true);

    const localType = await query.first({ useMasterKey: true });

    if (!localType) {
      throw new Error('Local service type not found. Please run 001-seed-service-types first.');
    }

    logger.info(`[${SEED_NAME}] Found Local service type`, {
      id: localType.id,
      name: localType.get('name'),
    });

    return localType;
  } catch (error) {
    logger.error(`[${SEED_NAME}] Failed to find Local service type`, {
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
 * @param {object} localType - Local service type Parse object
 * @returns {Promise<object>} Created POI
 */
async function createPOI(name, localType) {
  try {
    // IMPORTANT: Use Parse.Object.extend instead of POI class
    // The registered POI class (BaseModel subclass) has issues with set() + save()
    // Using Parse.Object.extend directly works correctly
    const POIClass = Parse.Object.extend('POI');
    const poi = new POIClass();

    poi.set('name', name);
    poi.set('active', true);
    poi.set('exists', true);
    poi.set('serviceType', localType); // Set pointer to Local service type

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
    const destinations = loadLocalDestinations();

    logger.info(`[${SEED_NAME}] Loaded ${destinations.length} local destinations to seed`);

    // Step 2: Find Local service type
    const localType = await findLocalServiceType();

    // Step 3: Seed each destination
    for (const destinationName of destinations) {
      try {
        // Check if POI already exists with this serviceType
        const exists = await poiExists(destinationName, localType);

        if (exists) {
          logger.info(`[${SEED_NAME}] POI already exists, skipping`, {
            name: destinationName,
          });
          statistics.skipped++;
          continue;
        }

        // Create POI
        await createPOI(destinationName, localType);
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
        serviceType: 'Local',
        serviceTypeId: localType.id,
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
  description: 'Seed 45 local destinations from docs/tarifario/datos_local.txt',
  run,
};
