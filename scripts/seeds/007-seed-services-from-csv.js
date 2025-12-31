/**
 * Seed Services from CSV
 *
 * Imports 837 services/traslados from Estructura_Tarifario.csv.
 * Matches POIs by name AND serviceType to ensure correct business logic.
 * Uses batch processing (500 records per batch) for optimal performance.
 *
 * CSV Structure:
 * - Tarifa: Rate name (matches Rate table)
 * - Tipo Traslado: Service type (Aeropuerto, Punto a Punto, Local)
 * - Origen: Origin POI (can be empty for Local type)
 * - Destino: Destination POI (required)
 * - Tipo Vehículo: Vehicle type code (SEDAN, VAN, etc.)
 * - Precio: Price (decimal)
 * - Notas: Notes (optional)
 *
 * Business Rule: POIs with same name but different serviceType are treated as different entities.
 * Example: "San Miguel de Allende" with serviceType="Aeropuerto" vs serviceType="Punto a Punto"
 *
 * @idempotent true - Can be run multiple times safely, skips duplicates
 * @dependencies 001-seed-service-types, 002-seed-pois-local, 003-seed-pois-aeropuerto, 004-seed-pois-ciudades, 005-seed-rates, 006-seed-vehicle-types
 * @version 1.1.0
 * @since 2024-10-26
 */

const Parse = require('parse/node');
const fs = require('fs');
const path = require('path');

// Seed version constant
const VERSION = '1.1.0';

// CSV file path
const CSV_PATH = path.join(__dirname, '../../docs/tarifario/Estructura_Tarifario.csv');
const BATCH_SIZE = 500;

/**
 * Parse CSV file
 */
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(line => line.trim());

  // Remove header
  lines.shift();

  // Parse rows
  const rows = lines.map((line, index) => {
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current.trim());

    return {
      lineNumber: index + 2,
      tarifa: fields[0] || '',
      tipoTraslado: fields[1] || '',
      origen: fields[2] || '',
      destino: fields[3] || '',
      tipoVehiculo: fields[4] || '',
      precio: fields[5] || '',
      notas: fields[6] || ''
    };
  });

  return rows;
}

/**
 * Load reference data from database
 */
async function loadReferenceData() {
  console.log('   🔄 Loading reference data...');

  // Load Rates
  const ratesQuery = new Parse.Query('Rate');
  ratesQuery.equalTo('exists', true);
  const rates = await ratesQuery.find({ useMasterKey: true });
  const ratesMap = {};
  rates.forEach(rate => {
    ratesMap[rate.get('name')] = rate;
  });
  console.log(`      ✅ Loaded ${rates.length} rates`);

  // Load POIs with serviceType
  const poisQuery = new Parse.Query('POI');
  poisQuery.equalTo('exists', true);
  poisQuery.include('serviceType');
  poisQuery.limit(1000);
  const pois = await poisQuery.find({ useMasterKey: true });
  const poisMap = {};
  pois.forEach(poi => {
    const serviceType = poi.get('serviceType');
    const serviceTypeName = serviceType ? serviceType.get('name') : 'Unknown';
    // Map by name|serviceType to differentiate POIs with same name but different types
    const key = `${poi.get('name')}|${serviceTypeName}`;
    poisMap[key] = poi;
  });
  console.log(`      ✅ Loaded ${pois.length} POIs`);

  // Load VehicleTypes
  const vehicleTypesQuery = new Parse.Query('VehicleType');
  vehicleTypesQuery.equalTo('exists', true);
  const vehicleTypes = await vehicleTypesQuery.find({ useMasterKey: true });
  const vehicleTypesMap = {};
  vehicleTypes.forEach(vt => {
    vehicleTypesMap[vt.get('code')] = vt;
  });
  console.log(`      ✅ Loaded ${vehicleTypes.length} vehicle types`);

  return { ratesMap, poisMap, vehicleTypesMap };
}

/**
 * Determine if a service should be skipped (duplicate in bidirectional pair)
 */
function shouldSkipDuplicate(row, rows, poisMap) {
  const { tarifa, tipoTraslado, origen, destino, tipoVehiculo, precio } = row;

  // Local services don't have duplicates (no origin)
  if (tipoTraslado === 'Local' || !origen) {
    return false;
  }

  // Find potential reverse pair
  for (const otherRow of rows) {
    if (row.lineNumber === otherRow.lineNumber) continue;

    // Check if it's a reverse pair
    if (
      tarifa === otherRow.tarifa &&
      tipoTraslado === otherRow.tipoTraslado &&
      origen === otherRow.destino &&
      destino === otherRow.origen &&
      tipoVehiculo === otherRow.tipoVehiculo
    ) {
      // Check if prices match (tolerance $1)
      const priceDiff = Math.abs(parseFloat(precio) - parseFloat(otherRow.precio));
      if (priceDiff >= 1) {
        // Prices don't match - import both (not round trip)
        return false;
      }

      // Found reverse pair with matching price - determine which to skip
      if (tipoTraslado === 'Aeropuerto' || tipoTraslado === 'aeropuerto') {
        // For Airport: Keep Airport → City, skip City → Airport
        const originIsAirport = origen.includes('Aeropuerto') || origen.match(/\([A-Z]{3}\)/);
        const destinationIsAirport = destino.includes('Aeropuerto') || destino.match(/\([A-Z]{3}\)/);

        if (!originIsAirport && destinationIsAirport) {
          // This is City → Airport, skip it
          return true;
        }
      } else {
        // For Punto a Punto: Keep alphabetically first origin
        if (origen > destino) {
          // This one should be skipped (other one has alphabetically earlier origin)
          return true;
        }
      }

      return false;
    }
  }

  return false;
}

/**
 * Check if a service is part of a bidirectional pair (round trip)
 */
function isRoundTripService(row, rows) {
  const { tarifa, tipoTraslado, origen, destino, tipoVehiculo, precio } = row;

  // Local services are not round trip (no origin)
  if (tipoTraslado === 'Local' || !origen) {
    return false;
  }

  // Find reverse pair
  for (const otherRow of rows) {
    if (row.lineNumber === otherRow.lineNumber) continue;

    if (
      tarifa === otherRow.tarifa &&
      tipoTraslado === otherRow.tipoTraslado &&
      origen === otherRow.destino &&
      destino === otherRow.origen &&
      tipoVehiculo === otherRow.tipoVehiculo
    ) {
      // Check if prices match
      const priceDiff = Math.abs(parseFloat(precio) - parseFloat(otherRow.precio));
      return priceDiff < 1; // Round trip if prices match
    }
  }

  return false;
}

/**
 * Import services with batch processing and deduplication
 */
async function importServices(rows, { ratesMap, poisMap, vehicleTypesMap }) {
  console.log('   🚀 Importing services with deduplication...');

  let created = 0;
  let skipped = 0;
  let duplicatesSkipped = 0;
  let failed = 0;
  let servicesToSave = [];

  for (const row of rows) {
    try {
      const { tarifa, tipoTraslado, origen, destino, tipoVehiculo, precio, notas } = row;

      // Check if this is a duplicate that should be skipped
      if (shouldSkipDuplicate(row, rows, poisMap)) {
        duplicatesSkipped++;
        continue;
      }

      // Get references using composite key (name|serviceType)
      const rate = ratesMap[tarifa];
      const originKey = origen ? `${origen}|${tipoTraslado}` : null;
      const destinationKey = `${destino}|${tipoTraslado}`;
      const originPOI = originKey ? poisMap[originKey] : null;
      const destinationPOI = poisMap[destinationKey];
      const vehicleType = vehicleTypesMap[tipoVehiculo];

      // Skip if any required reference is missing
      if (!rate || !destinationPOI || !vehicleType) {
        const reasons = [];
        if (!rate) reasons.push(`Rate="${tarifa}"`);
        if (!destinationPOI) reasons.push(`DestinationPOI="${destino}|${tipoTraslado}"`);
        if (!vehicleType) reasons.push(`VehicleType="${tipoVehiculo}"`);

        if (skipped < 35) { // Only log first 35 to avoid spam
          console.log(`      ⚠️  Line ${row.lineNumber} skipped: Missing ${reasons.join(', ')}`);
        }
        skipped++;
        continue;
      }

      // Check if service already exists
      const existingQuery = new Parse.Query('Service');
      if (originPOI) {
        existingQuery.equalTo('originPOI', originPOI);
      } else {
        existingQuery.doesNotExist('originPOI');
      }
      existingQuery.equalTo('destinationPOI', destinationPOI);
      existingQuery.equalTo('vehicleType', vehicleType);
      existingQuery.equalTo('rate', rate);
      existingQuery.equalTo('exists', true);

      const existing = await existingQuery.first({ useMasterKey: true });
      if (existing) {
        skipped++;
        continue;
      }

      // Determine if this is a round trip service
      const isRoundTrip = isRoundTripService(row, rows);

      // Create service
      const Service = Parse.Object.extend('Service');
      const service = new Service();

      if (originPOI) {
        service.set('originPOI', originPOI);
      }
      service.set('destinationPOI', destinationPOI);
      service.set('vehicleType', vehicleType);
      service.set('rate', rate);
      service.set('price', parseFloat(precio));
      service.set('isRoundTrip', isRoundTrip);
      if (notas) {
        service.set('note', notas);
      }
      service.set('active', true);
      service.set('exists', true);

      // Set ACL
      const acl = new Parse.ACL();
      acl.setPublicReadAccess(true);
      acl.setRoleWriteAccess('admin', true);
      acl.setRoleWriteAccess('superadmin', true);
      service.setACL(acl);

      servicesToSave.push(service);

      // Save in batches
      if (servicesToSave.length >= BATCH_SIZE) {
        await Parse.Object.saveAll(servicesToSave, { useMasterKey: true });
        created += servicesToSave.length;
        console.log(`      💾 Batch saved: ${created} services created so far...`);
        servicesToSave = [];
      }

    } catch (error) {
      console.error(`      ❌ Line ${row.lineNumber}: ${error.message}`);
      failed++;
    }
  }

  // Save remaining services
  if (servicesToSave.length > 0) {
    await Parse.Object.saveAll(servicesToSave, { useMasterKey: true });
    created += servicesToSave.length;
    console.log(`      💾 Final batch saved: ${servicesToSave.length} services`);
  }

  console.log(`\n   📊 Deduplication Summary:`);
  console.log(`      ↔️  Bidirectional duplicates skipped: ${duplicatesSkipped}`);

  return { created, skipped, failed, duplicatesSkipped };
}

/**
 * Execute seed
 */
async function run() {
  console.log('\n🚀 Starting Services from CSV seed...');

  try {
    // Parse CSV
    console.log(`   📄 Reading CSV: ${CSV_PATH}`);
    const rows = parseCSV(CSV_PATH);
    console.log(`      Found ${rows.length} rows`);

    // Load reference data
    const referenceData = await loadReferenceData();

    // Import services
    const results = await importServices(rows, referenceData);

    console.log('\n   📊 Services seed complete:');
    console.log(`      Created: ${results.created}`);
    console.log(`      Skipped: ${results.skipped}`);
    console.log(`      Failed: ${results.failed}`);
    console.log(`      Total processed: ${rows.length}`);

    return {
      success: true,
      ...results
    };
  } catch (error) {
    console.error('   ❌ Error seeding services:', error);
    throw error;
  }
}

/**
 * Rollback seed (if needed)
 */
async function rollback() {
  console.log('\n⚠️  Rollback not implemented for services seed');
  console.log('   Services must be manually deleted if rollback is needed');
  return { success: true, message: 'Manual cleanup required' };
}

module.exports = { run, rollback };
