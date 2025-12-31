/* eslint-disable no-continue, security/detect-non-literal-regexp, no-return-await, no-param-reassign, no-unused-vars */
/**
 * Seed 022 - Client Prices and Users (CSV-based Self-Contained).
 *
 * Creates ClientPrices records and associated department_manager users from CSV data.
 * CRITICAL: Follows correct process:
 *   1. Create ClientPrices FIRST (with temporary clientIndex)
 *   2. Create users LAST (in AmexingUser, with roleId as Pointer).
 *
 * Data Source: docs/tarifario/ClientPrices.csv (8 sample records from 6 clients).
 *
 * Client Distribution (from CSV):
 * - 1 (Test Department Manager): 2 sample prices
 * - abercrombie (Abercrombie & Kent Mexico): 1 sample price
 * - proserpina (Proserpina): 2 sample prices
 * - Clevia (Clevia): 1 sample price
 * - Godandi&Sons (Godandi & Sons): 1 sample price
 * - Jaunt (Jaunt): 1 sample price
 *
 * User Creation:
 * - Creates users in AmexingUser (NOT _User)
 * - Assigns roleId as Pointer to Role(department_manager + organization='client')
 * - Configures contextualData.companyName.
 *
 * Validation:
 * - Validates all Pointers before creating (Services, Rate, VehicleType)
 * - Prevents broken Pointers
 * - Applies idempotency.
 *
 * Configuration:
 * - Idempotent: true - Can be run multiple times safely
 * - Dependencies: RBAC roles, Services catalog, Rates, VehicleTypes
 * - Data Source: docs/tarifario/ClientPrices.csv (8 sample records).
 * @author Denisse Maldonado
 * @version 2.0.0 - CSV-based (self-contained)
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
const SEED_NAME = '022-seed-client-prices';
const VERSION = '2.0.0';

// CSV file path
const CSV_PATH = path.join(__dirname, '../../docs/tarifario/ClientPrices.csv');

/**
 * Client mapping (clientIndex to user details)
 * Maps CSV clientIndex values to complete user information.
 */
const CLIENT_MAPPING = {
  1: {
    email: 'manager@dev.amexing.com',
    companyName: 'Test Department Manager',
    firstName: 'Department',
    lastName: 'Manager',
  },
  abercrombie: {
    email: 'abercrombie.cliente.d494ab3a@temp.amexing.com',
    companyName: 'Abercrombie & Kent Mexico',
    firstName: 'Abercrombie & Kent Mexico',
    lastName: 'Cliente',
  },
  proserpina: {
    email: 'proserpina.cliente.4e41fdb0@temp.amexing.com',
    companyName: 'Proserpina',
    firstName: 'Proserpina',
    lastName: 'Cliente',
  },
  Clevia: {
    email: 'clevia.cliente.3ce24980@temp.amexing.com',
    companyName: 'Clevia',
    firstName: 'Clevia',
    lastName: 'Cliente',
  },
  'Godandi&Sons': {
    email: 'godandi&sons.cliente.0f002a74@temp.amexing.com',
    companyName: 'Godandi & Sons',
    firstName: 'Godandi&Sons',
    lastName: 'Cliente',
  },
  Jaunt: {
    email: 'jaunt.cliente.0da32f2b@temp.amexing.com',
    companyName: 'Jaunt',
    firstName: 'Jaunt',
    lastName: 'Cliente',
  },
  JourneyMexico: {
    email: 'journeymexico.cliente.3b44d429@temp.amexing.com',
    companyName: 'Journey Mexico',
    firstName: 'Journey Mexico',
    lastName: 'Cliente',
  },
  Wanderer: {
    email: 'wanderer.cliente.dbba9d4d@temp.amexing.com',
    companyName: 'Wanderer',
    firstName: 'Wanderer',
    lastName: 'Cliente',
  },
};

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
 * Read and parse ClientPrices CSV.
 * @example
 */
function readClientPricesCSV() {
  console.log(`📄 Reading ClientPrices from ${CSV_PATH}...`);

  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`ClientPrices CSV not found at: ${CSV_PATH}`);
  }

  const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = csvContent.split('\n').filter((line) => line.trim());

  if (lines.length === 0) {
    throw new Error('ClientPrices CSV is empty');
  }

  // Parse header
  const headers = parseCSVLine(lines[0]);
  console.log(`   Found ${lines.length - 1} ClientPrices in CSV`);

  // Parse data rows
  const clientPrices = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const record = {};

    headers.forEach((header, index) => {
      record[header] = values[index] || '';
    });

    clientPrices.push(record);
  }

  return clientPrices;
}

/**
 * Generate temporary password for client users.
 * @example
 */
function generateTempPassword() {
  return 'TempPassword2025!';
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
 * Find Service by POI names (origin + destination).
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
 * Create or update ClientPrice record (idempotent).
 * @param data
 * @param stats
 * @example
 */
async function createClientPriceIdempotent(data, stats) {
  const ClientPricesClass = Parse.Object.extend('ClientPrices');

  // Find Service by POI names
  const service = await findServiceByPOINames(data.serviceOrigin, data.serviceDestination);
  if (!service) {
    throw new Error(`Service not found for route: ${data.serviceOrigin || 'NULL'} -> ${data.serviceDestination}`);
  }

  const itemId = service.id;

  // Check if already exists
  const existingQuery = new Parse.Query(ClientPricesClass);
  existingQuery.equalTo('clientIndex', String(data.clientIndex)); // Convert to string for schema compatibility
  existingQuery.equalTo('itemType', data.itemType);
  existingQuery.equalTo('itemId', itemId);
  existingQuery.equalTo('exists', true);
  existingQuery.doesNotExist('valid_until'); // Only current prices

  const existing = await existingQuery.first({ useMasterKey: true });

  if (existing) {
    stats.skipped++;
    return { created: false, record: existing };
  }

  // Find Rate and VehicleType
  const rate = await findRateByName(data.rateName);
  if (!rate) {
    throw new Error(`Rate not found: ${data.rateName}`);
  }

  const vehicleType = await findVehicleTypeByCode(data.vehicleCode);
  if (!vehicleType) {
    throw new Error(`VehicleType not found: ${data.vehicleCode}`);
  }

  // Create new ClientPrice
  const clientPrice = new ClientPricesClass();
  clientPrice.set('clientIndex', String(data.clientIndex)); // Convert to string for schema compatibility
  clientPrice.set('itemType', data.itemType);
  clientPrice.set('itemId', itemId);
  clientPrice.set('ratePtr', rate);
  clientPrice.set('vehiclePtr', vehicleType);
  clientPrice.set('precio', data.precio);
  clientPrice.set('basePrice', data.basePrice);
  clientPrice.set('currency', data.currency);
  clientPrice.set('active', true);
  clientPrice.set('exists', true);
  clientPrice.set('valid_until', null);

  await clientPrice.save(null, { useMasterKey: true });
  stats.created++;

  return { created: true, record: clientPrice };
}

/**
 * Create client user in AmexingUser with correct roleId Pointer.
 * @param clientIndex
 * @param clientData
 * @param role
 * @param stats
 * @example
 */
async function createClientUser(clientIndex, clientData, role, stats) {
  const AmexingUserClass = Parse.Object.extend('AmexingUser');

  // Check if user already exists
  const userQuery = new Parse.Query(AmexingUserClass);
  userQuery.equalTo('email', clientData.email);
  const existing = await userQuery.first({ useMasterKey: true });

  if (existing) {
    console.log(`  User ${clientData.email} already exists, updating if needed...`);

    // Update roleId if missing or wrong
    const existingRoleId = existing.get('roleId');
    if (!existingRoleId || (existingRoleId.id !== role.id)) {
      existing.set('roleId', role);
      await existing.save(null, { useMasterKey: true });
      console.log('  ✅ Updated roleId to Pointer');
    }

    // Update contextualData.companyName if missing
    const contextual = existing.get('contextualData') || {};
    if (!contextual.companyName) {
      contextual.companyName = clientData.companyName;
      contextual.clientIndex = clientIndex;
      existing.set('contextualData', contextual);
      await existing.save(null, { useMasterKey: true });
      console.log('  ✅ Updated contextualData.companyName');
    }

    stats.usersUpdated++;
    return { created: false, user: existing };
  }

  // Create new user in AmexingUser
  const user = new AmexingUserClass();
  user.set('username', clientData.email);
  user.set('email', clientData.email);
  user.set('password', generateTempPassword());
  user.set('firstName', clientData.firstName);
  user.set('lastName', clientData.lastName);
  user.set('roleId', role); // CRITICAL: Pointer, not string
  user.set('organizationId', `client-${clientIndex}`);
  user.set('active', true);
  user.set('exists', true);
  user.set('emailVerified', true);
  user.set('contextualData', {
    companyName: clientData.companyName,
    clientIndex,
    isTestUser: clientData.email.includes('@dev.amexing.com'),
  });

  await user.save(null, { useMasterKey: true });
  console.log(`  ✅ Created user ${clientData.email} with roleId Pointer`);
  stats.usersCreated++;

  return { created: true, user };
}

/**
 * Update ClientPrices to reference client user.
 * @param clientIndex
 * @param user
 * @param stats
 * @example
 */
async function updateClientPricesWithUser(clientIndex, user, stats) {
  const ClientPricesClass = Parse.Object.extend('ClientPrices');
  const query = new Parse.Query(ClientPricesClass);
  query.equalTo('clientIndex', clientIndex);
  query.equalTo('exists', true);
  query.doesNotExist('clientPtr'); // Only those without clientPtr

  const clientPrices = await query.find({ useMasterKey: true });

  for (const cp of clientPrices) {
    cp.set('clientPtr', user);
    await cp.save(null, { useMasterKey: true });
    stats.pricesLinked++;
  }

  console.log(`  ✅ Linked ${clientPrices.length} ClientPrices to user`);
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
      usersCreated: 0,
      usersUpdated: 0,
      pricesLinked: 0,
      rateNotFound: 0,
      vehicleNotFound: 0,
      serviceNotFound: 0,
    };

    // ==========================================
    // STEP 1: GET DEPARTMENT_MANAGER ROLE
    // ==========================================
    console.log('\n📋 Step 1: Getting department_manager Role...');

    const RoleClass = Parse.Object.extend('Role');
    const roleQuery = new Parse.Query(RoleClass);
    roleQuery.equalTo('name', 'department_manager');
    roleQuery.equalTo('organization', 'client');
    roleQuery.equalTo('exists', true);

    const role = await roleQuery.first({ useMasterKey: true });
    if (!role) {
      throw new Error('Role department_manager with organization=client not found!');
    }

    console.log(`✅ Found Role: ${role.id} (${role.get('name')} + ${role.get('organization')})`);

    // ==========================================
    // STEP 2: READ CSV DATA
    // ==========================================
    const clientPricesData = readClientPricesCSV();
    console.log(`✅ Loaded ${clientPricesData.length} ClientPrices from CSV\n`);

    // ==========================================
    // STEP 3: CREATE CLIENTPRICES RECORDS
    // ==========================================
    console.log('📦 Creating ClientPrices records...');

    for (const record of clientPricesData) {
      try {
        // Extract CSV data
        const clientIndex = record.clientIndex?.trim();
        const companyName = record.companyName?.trim();
        const itemType = record.itemType?.trim() || 'SERVICES';
        const serviceOrigin = record.service_origin?.trim() || '';
        const serviceDestination = record.service_destination?.trim();
        const rateName = record.rate_name?.trim();
        const vehicleCode = record.vehicle_code?.trim();
        const precio = parseFloat(record.precio) || 0;
        const basePrice = parseFloat(record.basePrice) || precio;
        const currency = record.currency?.trim() || 'MXN';

        if (!clientIndex || !serviceDestination || !rateName || !vehicleCode || !precio) {
          console.warn(`   ⚠️  Skipping incomplete record: ${JSON.stringify(record)}`);
          stats.errors++;
          continue;
        }

        const data = {
          clientIndex,
          itemType,
          serviceOrigin,
          serviceDestination,
          rateName,
          vehicleCode,
          precio,
          basePrice,
          currency,
        };

        await createClientPriceIdempotent(data, stats);

        if (stats.created % 50 === 0 && stats.created > 0) {
          console.log(`   Progress: ${stats.created} ClientPrices created...`);
        }
      } catch (error) {
        const errorMsg = error?.message || String(error);
        if (errorMsg.includes('Rate not found')) {
          stats.rateNotFound++;
        } else if (errorMsg.includes('VehicleType not found')) {
          stats.vehicleNotFound++;
        } else if (errorMsg.includes('Service not found')) {
          stats.serviceNotFound++;
        }
        stats.errors++;
        console.error('   ❌ Error creating ClientPrice:', errorMsg);
      }
    }

    console.log(`✅ ClientPrices: ${stats.created} created, ${stats.skipped} skipped, ${stats.errors} errors`);

    // ==========================================
    // STEP 4: CREATE CLIENT USERS
    // ==========================================
    console.log('\n📋 Step 4: Creating Client Users...');

    // Get unique clientIndexes from CSV
    const uniqueClientIndexes = new Set();
    for (const record of clientPricesData) {
      const clientIndex = record.clientIndex?.trim();
      if (clientIndex) {
        uniqueClientIndexes.add(clientIndex);
      }
    }

    console.log(`Found ${uniqueClientIndexes.size} unique clients in CSV`);

    for (const clientIndex of uniqueClientIndexes) {
      const clientData = CLIENT_MAPPING[clientIndex];

      if (!clientData) {
        console.warn(`No mapping found for clientIndex: ${clientIndex}`);
        continue;
      }

      console.log(`\nProcessing client: ${clientData.companyName}`);

      try {
        // Create or update user
        const { created, user } = await createClientUser(clientIndex, clientData, role, stats);

        // Link ClientPrices to user
        await updateClientPricesWithUser(clientIndex, user, stats);
      } catch (error) {
        console.error(`Error creating user ${clientData.email}: ${error.message}`);
        stats.errors++;
      }
    }

    // ==========================================
    // STEP 5: SUMMARY
    // ==========================================
    const duration = Date.now() - startTime;
    console.log(`\n✅ Seed ${SEED_NAME} completed successfully`);
    console.log('📊 Statistics:');
    console.log(`   ClientPrices created: ${stats.created}`);
    console.log(`   ClientPrices skipped: ${stats.skipped}`);
    console.log(`   Users created: ${stats.usersCreated}`);
    console.log(`   Users updated: ${stats.usersUpdated}`);
    console.log(`   Prices linked: ${stats.pricesLinked}`);
    console.log(`   Errors: ${stats.errors}`);
    if (stats.serviceNotFound > 0) {
      console.log(`   ℹ️  Services not found: ${stats.serviceNotFound}`);
    }
    if (stats.rateNotFound > 0) {
      console.log(`   ℹ️  Rates not found: ${stats.rateNotFound}`);
    }
    if (stats.vehicleNotFound > 0) {
      console.log(`   ℹ️  VehicleTypes not found: ${stats.vehicleNotFound}`);
    }
    console.log(`⏱️  Duration: ${duration}ms`);

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
  description: 'Create ClientPrices (161 records) and client users (8 department_managers) from CSV with correct roleId Pointers',
  dependencies: [
    '000-seed-rbac-roles',
    '020-seed-services-catalog',
    '005-seed-rates',
    '006-seed-vehicle-types',
  ],
  run: seed,
};

// Run directly if called
if (require.main === module) {
  seed()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seed failed:', error);
      process.exit(1);
    });
}
