/* eslint-disable no-continue, security/detect-non-literal-regexp, no-return-await */
/**
 * Seed 021 - RatePrices (CSV-based Self-Contained).
 *
 * Creates the RatePrices table using pricing data from Estructura_Tarifario.csv.
 * Populates RatePrices for all rate categories with their respective vehicle types:
 * - Premium: SEDAN, SUBURBAN, SPRINTER (207 records = 69 routes × 3)
 * - Económico: SEDAN, VAN (138 records = 69 routes × 2)
 * - Green Class: MODEL 3, MODEL Y (138 records = 69 routes × 2)
 * - First Class: SEDAN, SUBURBAN (138 records = 69 routes × 2)
 * Total: 621 RatePrices.
 *
 * Data Structure:
 * - service: Services object reference (required)
 * - rate: Rate object (required)
 * - vehicleType: VehicleType object (required)
 * - price: Price amount from CSV (required)
 * - active: Pricing availability (boolean)
 * - exists: Logical deletion flag (boolean).
 *
 * Business Logic:
 * - Creates RatePrices based on Services table (69 routes) and CSV pricing
 * - Matches CSV rows to Services by origin+destination POI names
 * - Supports services without originPOI (airport returns, local services)
 * - Idempotent: skips existing combinations.
 *
 * Configuration:
 * - Idempotent: true - Can be run multiple times safely
 * - Dependencies: 005-seed-rates, 006-seed-vehicle-types, 020-seed-services-catalog
 * - Data Source: docs/tarifario/Estructura_Tarifario.csv (837 price records).
 * @author Denisse Maldonado
 * @version 3.0.0 - CSV-based (self-contained)
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
const SEED_NAME = '021-seed-rate-prices';
const VERSION = '3.0.0';

// CSV file path
const CSV_PATH = path.join(__dirname, '../../docs/tarifario/Estructura_Tarifario.csv');

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
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
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

  result.push(current);
  return result;
}

/**
 * Read and parse pricing CSV.
 * @example
 */
function readPricingCSV() {
  console.log(`📄 Reading pricing data from ${CSV_PATH}...`);

  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`Pricing CSV not found at: ${CSV_PATH}`);
  }

  const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = csvContent.split('\n').filter((line) => line.trim());

  if (lines.length === 0) {
    throw new Error('Pricing CSV is empty');
  }

  // Parse header
  const headers = parseCSVLine(lines[0]);
  console.log(`   Found ${lines.length - 1} pricing records in CSV`);

  // Parse data rows
  const priceRecords = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const record = {};

    headers.forEach((header, index) => {
      record[header] = values[index] || '';
    });

    priceRecords.push(record);
  }

  return priceRecords;
}

/**
 * Find Service by POI names.
 * @param originName
 * @param destinationName
 * @example
 */
async function findServiceByPOINames(originName, destinationName) {
  const ServicesClass = Parse.Object.extend('Services');
  const query = new Parse.Query(ServicesClass);
  query.equalTo('exists', true);
  query.include(['originPOI', 'destinationPOI']);
  query.limit(1000);

  const services = await query.find({ useMasterKey: true });

  // Find matching service
  for (const service of services) {
    const originPOI = service.get('originPOI');
    const destinationPOI = service.get('destinationPOI');

    if (!destinationPOI) continue;

    const destName = destinationPOI.get('name');
    const originPOIName = originPOI ? originPOI.get('name') : null;

    // Match destination (required)
    const destMatch = destName && destName.trim().toLowerCase() === destinationName.trim().toLowerCase();

    // Match origin (can be null)
    let originMatch = false;
    if (!originName && !originPOIName) {
      originMatch = true; // Both null
    } else if (originName && originPOIName) {
      originMatch = originPOIName.trim().toLowerCase() === originName.trim().toLowerCase();
    }

    if (destMatch && originMatch) {
      return service;
    }
  }

  return null;
}

/**
 * Find Rate by name.
 * @param rateName
 * @example
 */
async function findRateByName(rateName) {
  const RateClass = Parse.Object.extend('Rate');
  const query = new Parse.Query(RateClass);
  query.matches('name', new RegExp(`^${rateName.trim()}$`, 'i'));
  query.equalTo('exists', true);

  return await query.first({ useMasterKey: true });
}

/**
 * Find VehicleType by code.
 * @param vehicleCode
 * @example
 */
async function findVehicleTypeByCode(vehicleCode) {
  const VehicleTypeClass = Parse.Object.extend('VehicleType');
  const query = new Parse.Query(VehicleTypeClass);
  query.matches('code', new RegExp(`^${vehicleCode.trim()}$`, 'i'));
  query.equalTo('exists', true);

  return await query.first({ useMasterKey: true });
}

/**
 * Main seed execution function.
 * @example
 */
async function seed() {
  const startTime = Date.now();
  console.log(`🌱 Starting ${SEED_NAME} v${VERSION}`);

  try {
    const stats = {
      created: 0,
      skipped: 0,
      errors: 0,
      serviceNotFound: 0,
      rateNotFound: 0,
      vehicleNotFound: 0,
    };

    // ==========================================
    // STEP 1: READ CSV DATA
    // ==========================================
    const priceRecords = readPricingCSV();
    console.log(`✅ Loaded ${priceRecords.length} price records from CSV\n`);

    // ==========================================
    // STEP 2: CREATE RATEPRICES FROM CSV
    // ==========================================
    console.log('📦 Creating RatePrices records...');
    const RatePricesClass = Parse.Object.extend('RatePrices');

    for (const record of priceRecords) {
      try {
        // Extract CSV data
        const rateName = record.Tarifa?.trim();
        const originName = record.Origen?.trim();
        const destinationName = record.Destino?.trim();
        const vehicleCode = record['Tipo Vehículo']?.trim();
        const price = parseFloat(record.Precio) || 0;

        if (!rateName || !destinationName || !vehicleCode || !price) {
          console.warn(`   ⚠️  Skipping incomplete record: ${JSON.stringify(record)}`);
          stats.errors++;
          continue;
        }

        // Find Service by POI names
        const service = await findServiceByPOINames(originName, destinationName);
        if (!service) {
          stats.serviceNotFound++;
          stats.errors++;
          continue; // Skip silently (many CSV records won't match the 69 simplified Services)
        }

        // Find Rate
        const rate = await findRateByName(rateName);
        if (!rate) {
          console.warn(`   ⚠️  Rate not found: ${rateName}`);
          stats.rateNotFound++;
          stats.errors++;
          continue;
        }

        // Find VehicleType
        const vehicleType = await findVehicleTypeByCode(vehicleCode);
        if (!vehicleType) {
          console.warn(`   ⚠️  VehicleType not found: ${vehicleCode}`);
          stats.vehicleNotFound++;
          stats.errors++;
          continue;
        }

        // Check if RatePrice already exists (idempotency)
        const existingQuery = new Parse.Query(RatePricesClass);
        existingQuery.equalTo('service', service);
        existingQuery.equalTo('rate', rate);
        existingQuery.equalTo('vehicleType', vehicleType);
        existingQuery.equalTo('exists', true);

        const existing = await existingQuery.first({ useMasterKey: true });
        if (existing) {
          stats.skipped++;
          continue;
        }

        // Create new RatePrice
        const ratePrice = new RatePricesClass();
        ratePrice.set('service', service);
        ratePrice.set('rate', rate);
        ratePrice.set('vehicleType', vehicleType);
        ratePrice.set('price', price);
        ratePrice.set('active', true);
        ratePrice.set('exists', true);

        await ratePrice.save(null, { useMasterKey: true });
        stats.created++;

        if (stats.created % 100 === 0) {
          console.log(`   Progress: ${stats.created} RatePrices created...`);
        }
      } catch (error) {
        stats.errors++;
        console.error('   ❌ Error creating RatePrice:', error.message);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`\n✅ Seed ${SEED_NAME} completed successfully`);
    console.log('📊 Statistics:', stats);
    console.log(`⏱️ Duration: ${duration}ms`);

    // Log warnings if needed
    if (stats.serviceNotFound > 0) {
      console.log(`\nℹ️  ${stats.serviceNotFound} CSV records didn't match any Service (expected - CSV has 837 records, we have 69 unique Services)`);
    }

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
  description: 'Create RatePrices from CSV pricing data (621 rate+vehicle combinations)',
  dependencies: ['005-seed-rates', '006-seed-vehicle-types', '020-seed-services-catalog'],
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
