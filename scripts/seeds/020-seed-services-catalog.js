/**
 * Seed 020 - Services Catalog (Simplified Route Services).
 *
 * Creates the Services table from CSV file containing 69 unique route combinations
 * WITHOUT rate specificity. This creates a clean base catalog of transportation routes
 * that serve as foundation for client-specific pricing (ClientPrices).
 *
 * Data Structure:
 * - originPOI: Origin point (can be NULL for airport/local services)
 * - destinationPOI: Destination point (required)
 * - note: Service notes (optional)
 * - active: Service availability (boolean)
 * - exists: Logical deletion flag (boolean).
 *
 * Business Logic:
 * - Services without originPOI are valid (airport return trips, local services, flexible origin)
 * - Each unique combination of origin-destination creates ONE service (rate-agnostic)
 * - Results in 69 base services that clients customize via ClientPrices
 * - Service type is determined by destinationPOI.serviceType (Aeropuerto, Punto a Punto, Local)
 * - Vehicle type and rate handling moved to ClientPrices for per-client flexibility.
 *
 * Configuration:
 * - Idempotent: true - Can be run multiple times safely, creates unique combinations only
 * - Dependencies: POI seeds (002, 003, 004), ServiceType seed (001)
 * - Data Source: docs/tarifario/Services_Catalog.csv (69 routes).
 * @author Denisse Maldonado
 * @version 4.0.0 - CSV-based (self-contained)
 * @since 1.0.0
 */

const Parse = require('parse/node');
const fs = require('fs');
const path = require('path');

// Parse Server configuration for standalone execution
if (!Parse.applicationId) {
  require('dotenv').config({ path: path.join(__dirname, '../../environments/.env.development') });
  Parse.initialize(
    process.env.PARSE_APP_ID || 'CrTRTaJpoJFNt8PJ',
    null,
    process.env.PARSE_MASTER_KEY || 'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP'
  );
  Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';
}

// Seed configuration
const SEED_NAME = '020-seed-services-catalog';
const VERSION = '4.0.0';

// CSV file path
const CSV_PATH = path.join(__dirname, '../../docs/tarifario/Services_Catalog.csv');

/**
 * Parse CSV line handling quotes and commas properly.
 * @param line
 * @example
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      // Handle escaped quotes
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current); // Push last field
  return result;
}

/**
 * Read and parse Services Catalog CSV.
 * @example
 */
function readServicesCatalogCSV() {
  console.log(`📄 Reading Services Catalog from ${CSV_PATH}...`);

  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`Services Catalog CSV not found at: ${CSV_PATH}`);
  }

  const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = csvContent.split('\n').filter((line) => line.trim());

  if (lines.length === 0) {
    throw new Error('Services Catalog CSV is empty');
  }

  // Parse header
  const headers = parseCSVLine(lines[0]);
  console.log(`   Found ${lines.length - 1} routes in CSV`);

  // Parse data rows
  const routes = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const route = {};

    headers.forEach((header, index) => {
      route[header] = values[index] || '';
    });

    routes.push(route);
  }

  return routes;
}

/**
 * Find POI by name and service type.
 * @param poiName
 * @param serviceTypeName
 * @example
 */
async function findPOI(poiName, serviceTypeName) {
  if (!poiName) return null;

  const POIClass = Parse.Object.extend('POI');
  const query = new Parse.Query(POIClass);

  // Case-insensitive name match
  const normalizedName = poiName.trim();
  // eslint-disable-next-line security/detect-non-literal-regexp
  query.matches('name', new RegExp(`^${normalizedName}$`, 'i'));
  query.equalTo('exists', true);

  // Include serviceType for verification
  query.include('serviceType');

  const poi = await query.first({ useMasterKey: true });

  if (!poi) {
    console.warn(`   ⚠️  POI not found: ${poiName} (${serviceTypeName})`);
    return null;
  }

  // Verify service type matches
  const poiServiceType = poi.get('serviceType');
  if (poiServiceType && serviceTypeName) {
    const poiServiceTypeName = poiServiceType.get('name');
    if (poiServiceTypeName !== serviceTypeName) {
      console.warn(`   ⚠️  POI service type mismatch for ${poiName}: expected ${serviceTypeName}, got ${poiServiceTypeName}`);
    }
  }

  return poi;
}

/**
 * Main seed execution function.
 * @returns {Promise<object>} Execution result with statistics.
 * @example
 */
async function seed() {
  const startTime = Date.now();
  console.log(`🌱 Starting ${SEED_NAME} v${VERSION}`);

  try {
    const stats = {
      created: 0, skipped: 0, errors: 0, missingPOIs: 0,
    };

    // ==========================================
    // STEP 1: READ CSV DATA
    // ==========================================
    const routes = readServicesCatalogCSV();
    console.log(`✅ Loaded ${routes.length} routes from CSV`);

    // ==========================================
    // STEP 2: CREATE SERVICES FROM CSV
    // ==========================================
    console.log('\n📦 Creating Services records...');
    const ServicesClass = Parse.Object.extend('Services');

    for (const route of routes) {
      try {
        // Extract route data
        const originPOIName = route.originPOI_name?.trim();
        const originServiceType = route.originPOI_serviceType?.trim();
        const destinationPOIName = route.destinationPOI_name?.trim();
        const destinationServiceType = route.destinationPOI_serviceType?.trim();
        const note = route.note?.trim() || '';

        // Destination POI is required
        if (!destinationPOIName) {
          console.error('   ❌ Missing destination POI in route:', route);
          stats.errors++;
          // eslint-disable-next-line no-continue
          continue;
        }

        // Find POIs
        const originPOI = originPOIName ? await findPOI(originPOIName, originServiceType) : null;
        const destinationPOI = await findPOI(destinationPOIName, destinationServiceType);

        if (!destinationPOI) {
          console.error(`   ❌ Destination POI not found: ${destinationPOIName}`);
          stats.missingPOIs++;
          stats.errors++;
          // eslint-disable-next-line no-continue
          continue;
        }

        // Check if service already exists (idempotency)
        const existingQuery = new Parse.Query(ServicesClass);
        if (originPOI) {
          existingQuery.equalTo('originPOI', originPOI);
        } else {
          existingQuery.doesNotExist('originPOI');
        }
        existingQuery.equalTo('destinationPOI', destinationPOI);
        existingQuery.equalTo('exists', true);

        const existingService = await existingQuery.first({ useMasterKey: true });

        if (existingService) {
          stats.skipped++;
          // eslint-disable-next-line no-continue
          continue;
        }

        // Create new service
        const newService = new ServicesClass();

        if (originPOI) {
          newService.set('originPOI', originPOI);
        }

        newService.set('destinationPOI', destinationPOI);
        newService.set('note', note);
        newService.set('active', true);
        newService.set('exists', true);

        await newService.save(null, { useMasterKey: true });
        stats.created++;

        if (stats.created % 20 === 0) {
          console.log(`   Progress: ${stats.created}/${routes.length} services created`);
        }
      } catch (error) {
        stats.errors++;
        console.error('   ❌ Error creating service:', error.message);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`\n✅ Seed ${SEED_NAME} completed successfully`);
    console.log('📊 Statistics:', stats);
    console.log(`⏱️ Duration: ${duration}ms`);

    return { success: true, stats, duration };
  } catch (error) {
    console.error(`❌ Seed ${SEED_NAME} failed:`, error.message);
    console.error(error.stack);
    throw error;
  }
}

// Export for use by seed runner
module.exports = {
  name: SEED_NAME,
  version: VERSION,
  description: 'Create Services catalog from CSV (69 rate-agnostic base routes for ClientPrices)',
  dependencies: ['001-seed-service-types', '002-seed-pois-local', '003-seed-pois-aeropuerto', '004-seed-pois-ciudades'],
  run: seed,
};

// Run directly if called
if (require.main === module) {
  seed().then(() => {
    process.exit(0);
  }).catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
}
