/**
 * Seed Tours from CSV
 *
 * This script imports tours from Estructura_Tarifario_Tours.csv and creates them in the database.
 * It performs comprehensive validation before inserting any data.
 *
 * CSV Structure:
 * - Tarifa: Rate name (must match existing Rate)
 * - Destino: Destination POI name (must exist with serviceType="Tours")
 * - Tipo de Vehículo: Vehicle type code (SEDAN, SUBURBAN, MODEL 3, MODEL Y)
 * - Precio: Price (decimal)
 * - Duración: Duration in HOURS (converted to minutes for database)
 * - Min: Minimum passengers (optional)
 * - Max: Maximum passengers (optional)
 *
 * Key Transformations:
 * - Duration: HOURS → MINUTES (e.g., 2 hours → 120 minutes)
 * - Passenger range: Empty strings → null in database
 * - POI matching: Uses composite key "name|Tours" for serviceType filtering
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2025-01-11
 */

const Parse = require('parse/node');
const fs = require('fs');
const path = require('path');

const VERSION = '1.0.0';

// CSV file path
const CSV_PATH = path.join(__dirname, '../../docs/tarifario/Estructura_Tarifario_Tours.csv');

/**
 * Parse CSV file
 */
function parseCSV(filePath) {
  console.log(`\n📄 Reading CSV file: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(line => line.trim());

  // Remove header
  const header = lines.shift();
  console.log(`   Header: ${header}`);
  console.log(`   Total rows: ${lines.length}`);

  // Parse rows
  const rows = lines.map((line, index) => {
    // Handle quoted fields with commas
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
      lineNumber: index + 2, // +2 because header is line 1, and array is 0-indexed
      tarifa: fields[0] || '',
      destino: fields[1] || '',
      tipoVehiculo: fields[2] || '',
      precio: fields[3] || '',
      duracion: fields[4] || '',
      min: fields[5] || '',
      max: fields[6] || ''
    };
  });

  return rows;
}

/**
 * Load all reference data from database
 */
async function loadReferenceData() {
  console.log('\n🔄 Loading reference data from database...');

  // Load Rates
  const ratesQuery = new Parse.Query('Rate');
  ratesQuery.equalTo('exists', true);
  const rates = await ratesQuery.find({ useMasterKey: true });
  const ratesMap = {};
  rates.forEach(rate => {
    ratesMap[rate.get('name')] = rate;
  });
  console.log(`   ✅ Loaded ${rates.length} rates`);

  // Load POIs with serviceType "Tours"
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
  console.log(`   ✅ Loaded ${pois.length} POIs`);

  // Count Tours POIs specifically
  const toursPOIs = pois.filter(poi => {
    const serviceType = poi.get('serviceType');
    return serviceType && serviceType.get('name') === 'Tours';
  });
  console.log(`   ℹ️  Tours POIs: ${toursPOIs.length}`);

  // Load VehicleTypes
  const vehicleTypesQuery = new Parse.Query('VehicleType');
  vehicleTypesQuery.equalTo('exists', true);
  const vehicleTypes = await vehicleTypesQuery.find({ useMasterKey: true });
  const vehicleTypesMap = {};
  vehicleTypes.forEach(vt => {
    vehicleTypesMap[vt.get('code')] = vt;
  });
  console.log(`   ✅ Loaded ${vehicleTypes.length} vehicle types`);

  return { ratesMap, poisMap, vehicleTypesMap };
}

/**
 * Validate CSV data against database
 */
function validateData(rows, { ratesMap, poisMap, vehicleTypesMap }) {
  console.log('\n🔍 Validating CSV data...');

  const errors = [];
  const warnings = [];
  const stats = {
    missingRates: new Set(),
    missingDestinations: new Set(),
    missingVehicleTypes: new Set(),
    invalidPrices: [],
    invalidDurations: [],
    invalidPassengerRanges: []
  };

  rows.forEach(row => {
    const { lineNumber, tarifa, destino, tipoVehiculo, precio, duracion, min, max } = row;

    // Validate Rate
    if (!ratesMap[tarifa]) {
      stats.missingRates.add(tarifa);
      errors.push(`Line ${lineNumber}: Rate "${tarifa}" not found in database`);
    }

    // Validate Destination (required, must be Tours type)
    if (!destino) {
      errors.push(`Line ${lineNumber}: Destination is required but empty`);
    } else {
      const destinationKey = `${destino}|Tours`;
      if (!poisMap[destinationKey]) {
        stats.missingDestinations.add(destino);
        errors.push(`Line ${lineNumber}: Destination POI "${destino}" with type "Tours" not found in database`);
      }
    }

    // Validate VehicleType
    if (!vehicleTypesMap[tipoVehiculo]) {
      stats.missingVehicleTypes.add(tipoVehiculo);
      errors.push(`Line ${lineNumber}: Vehicle type "${tipoVehiculo}" not found in database`);
    }

    // Validate Price
    const priceFloat = parseFloat(precio);
    if (isNaN(priceFloat) || priceFloat <= 0) {
      stats.invalidPrices.push({ lineNumber, precio });
      errors.push(`Line ${lineNumber}: Invalid price "${precio}"`);
    }

    // Validate Duration (required, must be positive number)
    const duracionInt = parseInt(duracion, 10);
    if (isNaN(duracionInt) || duracionInt <= 0) {
      stats.invalidDurations.push({ lineNumber, duracion });
      errors.push(`Line ${lineNumber}: Invalid duration "${duracion}" (must be positive integer hours)`);
    }

    // Validate Passenger Range (optional, but min <= max if both present)
    if (min && min.trim() !== '' && max && max.trim() !== '') {
      const minInt = parseInt(min, 10);
      const maxInt = parseInt(max, 10);

      if (!isNaN(minInt) && !isNaN(maxInt) && minInt > maxInt) {
        stats.invalidPassengerRanges.push({ lineNumber, min, max });
        warnings.push(`Line ${lineNumber}: Min passengers (${min}) greater than max passengers (${max})`);
      }
    }
  });

  // Report statistics
  console.log('\n📊 Validation Statistics:');
  console.log(`   Total rows: ${rows.length}`);
  console.log(`   Missing rates: ${stats.missingRates.size}`);
  if (stats.missingRates.size > 0) {
    console.log(`     - ${Array.from(stats.missingRates).join(', ')}`);
  }
  console.log(`   Missing destinations (Tours type): ${stats.missingDestinations.size}`);
  if (stats.missingDestinations.size > 0) {
    console.log(`     - ${Array.from(stats.missingDestinations).join(', ')}`);
  }
  console.log(`   Missing vehicle types: ${stats.missingVehicleTypes.size}`);
  if (stats.missingVehicleTypes.size > 0) {
    console.log(`     - ${Array.from(stats.missingVehicleTypes).join(', ')}`);
  }
  console.log(`   Invalid prices: ${stats.invalidPrices.length}`);
  console.log(`   Invalid durations: ${stats.invalidDurations.length}`);
  console.log(`   Invalid passenger ranges: ${stats.invalidPassengerRanges.length}`);

  return { errors, warnings, stats };
}

/**
 * Import tours from CSV with batch processing
 */
async function importTours(rows, { ratesMap, poisMap, vehicleTypesMap }) {
  console.log('\n🚀 Importing tours...');

  let created = 0;
  let skipped = 0;
  let failed = 0;
  const BATCH_SIZE = 500;
  let touresToSave = [];

  for (const row of rows) {
    try {
      const {
        lineNumber,
        tarifa,
        destino,
        tipoVehiculo,
        precio,
        duracion,
        min,
        max
      } = row;

      // Get references using composite key (name|Tours)
      const rate = ratesMap[tarifa];
      const destinationKey = `${destino}|Tours`;
      const destinationPOI = poisMap[destinationKey];
      const vehicleType = vehicleTypesMap[tipoVehiculo];

      // Skip if any required reference is missing
      if (!rate || !destinationPOI || !vehicleType) {
        skipped++;
        continue;
      }

      // Convert duration from hours to minutes
      const durationHours = parseInt(duracion, 10);
      if (isNaN(durationHours) || durationHours <= 0) {
        skipped++;
        continue;
      }
      const durationMinutes = durationHours * 60;

      // Parse passenger range (optional)
      let minPassengers = null;
      let maxPassengers = null;

      if (min && min.trim() !== '') {
        const minInt = parseInt(min, 10);
        if (!isNaN(minInt) && minInt > 0) {
          minPassengers = minInt;
        }
      }

      if (max && max.trim() !== '') {
        const maxInt = parseInt(max, 10);
        if (!isNaN(maxInt) && maxInt > 0) {
          maxPassengers = maxInt;
        }
      }

      // Check if tour already exists (avoid duplicates)
      const existingQuery = new Parse.Query('Tours');
      existingQuery.equalTo('destinationPOI', destinationPOI);
      existingQuery.equalTo('vehicleType', vehicleType);
      existingQuery.equalTo('rate', rate);
      existingQuery.equalTo('time', durationMinutes);
      existingQuery.equalTo('exists', true);

      const existing = await existingQuery.first({ useMasterKey: true });

      if (existing) {
        skipped++;
        continue;
      }

      // Create tour
      const Tour = Parse.Object.extend('Tours');
      const tour = new Tour();

      tour.set('destinationPOI', destinationPOI);
      tour.set('time', durationMinutes);
      tour.set('vehicleType', vehicleType);
      tour.set('rate', rate);
      tour.set('price', parseFloat(precio));

      // Set passenger range (optional fields)
      if (minPassengers !== null) {
        tour.set('minPassengers', minPassengers);
      }
      if (maxPassengers !== null) {
        tour.set('maxPassengers', maxPassengers);
      }

      tour.set('active', true);
      tour.set('exists', true);

      // Set ACL
      const acl = new Parse.ACL();
      acl.setPublicReadAccess(true);
      acl.setRoleWriteAccess('admin', true);
      acl.setRoleWriteAccess('superadmin', true);
      tour.setACL(acl);

      touresToSave.push(tour);

      // Save in batches of 500
      if (touresToSave.length >= BATCH_SIZE) {
        await Parse.Object.saveAll(touresToSave, { useMasterKey: true });
        created += touresToSave.length;
        console.log(`   ✅ Saved batch: ${created} tours created so far...`);
        touresToSave = [];
      }

    } catch (error) {
      console.error(`   ❌ Line ${row.lineNumber}: Error creating tour:`, error.message);
      failed++;
    }
  }

  // Save remaining tours
  if (touresToSave.length > 0) {
    await Parse.Object.saveAll(touresToSave, { useMasterKey: true });
    created += touresToSave.length;
    console.log(`   ✅ Saved final batch: ${touresToSave.length} tours`);
  }

  console.log(`\n📊 Import complete:`);
  console.log(`   Created: ${created}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Failed: ${failed}`);

  return { created, skipped, errors: failed };
}

/**
 * Run seed
 */
async function run() {
  console.log('🚀 Starting Tours Import from CSV...');

  try {
    // Parse CSV
    const rows = parseCSV(CSV_PATH);

    // Load reference data
    const refData = await loadReferenceData();

    // Validate data
    const { errors, warnings, stats } = validateData(rows, refData);

    // Report validation results
    if (errors.length > 0) {
      console.log('\n❌ VALIDATION ERRORS:');
      console.log('='.repeat(60));
      errors.slice(0, 20).forEach(error => console.log(`  ${error}`));
      if (errors.length > 20) {
        console.log(`  ... and ${errors.length - 20} more errors`);
      }
      console.log('='.repeat(60));
      throw new Error('Validation failed. Please fix errors before importing.');
    }

    if (warnings.length > 0) {
      console.log('\n⚠️  VALIDATION WARNINGS:');
      warnings.forEach(warning => console.log(`  ${warning}`));
    }

    console.log('\n✅ Validation passed!');

    // Import tours
    const result = await importTours(rows, refData);

    console.log('\n✅ Tours seed completed successfully!');

    return result;

  } catch (error) {
    console.error('\n❌ Tours seed failed:', error.message);
    throw error;
  }
}

module.exports = {
  version: VERSION,
  description: 'Import tours from Estructura_Tarifario_Tours.csv with duration and passenger range',
  run,
};
