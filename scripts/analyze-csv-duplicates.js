#!/usr/bin/env node

/**
 * CSV Duplicates Analysis Script
 * Analyzes the services CSV file to identify bidirectional duplicate pairs
 * and generates a detailed report for deduplication strategy
 *
 * Usage:
 *   node scripts/analyze-csv-duplicates.js
 *
 * Output:
 *   - Console report with statistics
 *   - JSON file: docs/tarifario/duplicate-analysis-report.json
 *
 * @author Amexing Development Team
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, '../docs/tarifario/Estructura_Tarifario.csv');
const REPORT_PATH = path.join(__dirname, '../docs/tarifario/duplicate-analysis-report.json');

/**
 * Parse CSV file and return array of service objects
 */
function parseCSV() {
  const content = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = content.split('\n').filter(line => line.trim());

  // Skip header row and parse data
  const services = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    // Simple CSV parsing (handles quoted fields)
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const char = line[j];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current.trim()); // Add last field

    // Skip empty lines
    if (fields.length < 6) continue;

    services.push({
      tarifa: fields[0]?.trim(),
      tipoTraslado: fields[1]?.trim(),
      origen: fields[2]?.trim(),
      destino: fields[3]?.trim(),
      tipoVehiculo: fields[4]?.trim(),
      precio: parseFloat(fields[5]),
      notas: fields[6]?.trim() || '',
    });
  }

  return services;
}

/**
 * Generate a unique key for a service pair (order-independent)
 */
function generatePairKey(service1, service2) {
  const locations = [service1.origen, service1.destino].sort();
  return `${service1.tarifa}|${service1.tipoTraslado}|${locations[0]}|${locations[1]}|${service1.tipoVehiculo}`;
}

/**
 * Generate a unique key for a single service (order-dependent)
 */
function generateServiceKey(service) {
  return `${service.tarifa}|${service.tipoTraslado}|${service.origen}|${service.destino}|${service.tipoVehiculo}`;
}

/**
 * Find bidirectional duplicate pairs
 */
function findDuplicatePairs(services) {
  const pairs = [];
  const processedKeys = new Set();

  for (let i = 0; i < services.length; i++) {
    const service1 = services[i];

    // Skip Local transfers (no origin)
    if (service1.tipoTraslado === 'Local' || !service1.origen) {
      continue;
    }

    const key1 = generateServiceKey(service1);

    // Skip if already processed
    if (processedKeys.has(key1)) {
      continue;
    }

    // Look for reverse pair
    for (let j = i + 1; j < services.length; j++) {
      const service2 = services[j];

      // Check if it's a reverse pair
      if (
        service1.tarifa === service2.tarifa &&
        service1.tipoTraslado === service2.tipoTraslado &&
        service1.origen === service2.destino &&
        service1.destino === service2.origen &&
        service1.tipoVehiculo === service2.tipoVehiculo
      ) {
        const key2 = generateServiceKey(service2);
        const pairKey = generatePairKey(service1, service2);

        const priceDifference = Math.abs(service1.precio - service2.precio);
        const pricesMatch = priceDifference < 1; // Tolerance of $1

        pairs.push({
          pairKey,
          service1: {
            ...service1,
            rowNumber: i + 2, // +2 because of header row and 0-index
          },
          service2: {
            ...service2,
            rowNumber: j + 2,
          },
          pricesMatch,
          priceDifference,
          shouldKeep: determineWhichToKeep(service1, service2),
        });

        processedKeys.add(key1);
        processedKeys.add(key2);
        break;
      }
    }
  }

  return pairs;
}

/**
 * Determine which service to keep based on business rules
 */
function determineWhichToKeep(service1, service2) {
  // Rule for Airport services: Keep Airport → City
  if (service1.tipoTraslado === 'Aeropuerto' || service1.tipoTraslado === 'aeropuerto') {
    const service1HasAirportAsOrigin = service1.origen.includes('Aeropuerto') ||
                                       service1.origen.match(/\([A-Z]{3}\)/);
    const service2HasAirportAsOrigin = service2.origen.includes('Aeropuerto') ||
                                       service2.origen.match(/\([A-Z]{3}\)/);

    if (service1HasAirportAsOrigin && !service2HasAirportAsOrigin) {
      return 'service1'; // Keep Airport → City
    } else if (!service1HasAirportAsOrigin && service2HasAirportAsOrigin) {
      return 'service2'; // Keep Airport → City
    }
  }

  // Rule for Point-to-Point: Keep alphabetically first origin
  if (service1.origen < service2.origen) {
    return 'service1';
  } else {
    return 'service2';
  }
}

/**
 * Analyze unpaired services (single direction only)
 */
function findUnpairedServices(services, pairs) {
  const pairedKeys = new Set();

  pairs.forEach(pair => {
    pairedKeys.add(generateServiceKey(pair.service1));
    pairedKeys.add(generateServiceKey(pair.service2));
  });

  return services.filter((service, index) => {
    // Skip Local transfers
    if (service.tipoTraslado === 'Local' || !service.origen) {
      return false;
    }

    const key = generateServiceKey(service);
    return !pairedKeys.has(key);
  });
}

/**
 * Generate statistics and report
 */
function generateReport(services, pairs, unpaired) {
  const report = {
    timestamp: new Date().toISOString(),
    totalServices: services.length,
    statistics: {
      byType: {},
      total: {
        duplicatePairs: pairs.length,
        servicesInPairs: pairs.length * 2,
        unpairedServices: unpaired.length,
        localServices: services.filter(s => s.tipoTraslado === 'Local').length,
      },
      priceDiscrepancies: pairs.filter(p => !p.pricesMatch).length,
      expectedReduction: pairs.length, // One service removed per pair
    },
    duplicatePairs: pairs.map(pair => ({
      pairKey: pair.pairKey,
      type: pair.service1.tipoTraslado,
      rate: pair.service1.tarifa,
      direction1: `${pair.service1.origen} → ${pair.service1.destino}`,
      direction2: `${pair.service2.origen} → ${pair.service2.destino}`,
      vehicleType: pair.service1.tipoVehiculo,
      price1: pair.service1.precio,
      price2: pair.service2.precio,
      pricesMatch: pair.pricesMatch,
      priceDifference: pair.priceDifference,
      shouldKeep: pair.shouldKeep,
      keepDirection: pair.shouldKeep === 'service1'
        ? `${pair.service1.origen} → ${pair.service1.destino}`
        : `${pair.service2.origen} → ${pair.service2.destino}`,
      row1: pair.service1.rowNumber,
      row2: pair.service2.rowNumber,
    })),
    priceDiscrepancies: pairs
      .filter(p => !p.pricesMatch)
      .map(pair => ({
        type: pair.service1.tipoTraslado,
        rate: pair.service1.tarifa,
        direction1: `${pair.service1.origen} → ${pair.service1.destino}`,
        direction2: `${pair.service2.origen} → ${pair.service2.destino}`,
        vehicleType: pair.service1.tipoVehiculo,
        price1: pair.service1.precio,
        price2: pair.service2.precio,
        difference: pair.priceDifference,
        row1: pair.service1.rowNumber,
        row2: pair.service2.rowNumber,
      })),
    unpairedServices: unpaired.map((service, index) => ({
      type: service.tipoTraslado,
      rate: service.tarifa,
      direction: `${service.origen} → ${service.destino}`,
      vehicleType: service.tipoVehiculo,
      price: service.precio,
    })),
  };

  // Calculate by type statistics
  pairs.forEach(pair => {
    const type = pair.service1.tipoTraslado;
    if (!report.statistics.byType[type]) {
      report.statistics.byType[type] = {
        pairs: 0,
        priceDiscrepancies: 0,
      };
    }
    report.statistics.byType[type].pairs++;
    if (!pair.pricesMatch) {
      report.statistics.byType[type].priceDiscrepancies++;
    }
  });

  return report;
}

/**
 * Print console report
 */
function printConsoleReport(report) {
  console.log('\n' + '='.repeat(80));
  console.log('CSV DUPLICATES ANALYSIS REPORT');
  console.log('='.repeat(80));
  console.log(`Generated: ${new Date(report.timestamp).toLocaleString()}`);
  console.log(`CSV File: ${CSV_PATH}\n`);

  console.log('📊 STATISTICS');
  console.log('-'.repeat(80));
  console.log(`Total Services in CSV:          ${report.totalServices}`);
  console.log(`Duplicate Pairs Found:          ${report.statistics.total.duplicatePairs}`);
  console.log(`Services in Pairs:              ${report.statistics.total.servicesInPairs}`);
  console.log(`Unpaired Services:              ${report.statistics.total.unpairedServices}`);
  console.log(`Local Services (No Pairs):      ${report.statistics.total.localServices}`);
  console.log(`Expected Reduction:             ${report.statistics.expectedReduction} services\n`);

  console.log('📉 PROJECTED RESULT AFTER DEDUPLICATION');
  console.log('-'.repeat(80));
  const projected = report.totalServices - report.statistics.expectedReduction;
  const percentage = ((report.statistics.expectedReduction / report.totalServices) * 100).toFixed(1);
  console.log(`Final Service Count:            ${projected}`);
  console.log(`Reduction:                      ${percentage}%\n`);

  console.log('🔢 BY SERVICE TYPE');
  console.log('-'.repeat(80));
  Object.entries(report.statistics.byType).forEach(([type, stats]) => {
    console.log(`${type}:`);
    console.log(`  - Duplicate Pairs: ${stats.pairs}`);
    console.log(`  - Price Discrepancies: ${stats.priceDiscrepancies}`);
  });
  console.log();

  if (report.statistics.priceDiscrepancies > 0) {
    console.log('⚠️  PRICE DISCREPANCIES FOUND');
    console.log('-'.repeat(80));
    console.log(`Total Pairs with Different Prices: ${report.statistics.priceDiscrepancies}\n`);
    console.log('These pairs require manual review:\n');

    report.priceDiscrepancies.forEach((disc, index) => {
      console.log(`${index + 1}. ${disc.type} - ${disc.rate}`);
      console.log(`   Direction 1 (Row ${disc.row1}): ${disc.direction1} = $${disc.price1.toLocaleString()}`);
      console.log(`   Direction 2 (Row ${disc.row2}): ${disc.direction2} = $${disc.price2.toLocaleString()}`);
      console.log(`   Difference: $${disc.difference.toFixed(2)}`);
      console.log(`   Vehicle: ${disc.vehicleType}\n`);
    });
  } else {
    console.log('✅ NO PRICE DISCREPANCIES');
    console.log('-'.repeat(80));
    console.log('All duplicate pairs have matching prices!\n');
  }

  console.log('📁 REPORT SAVED');
  console.log('-'.repeat(80));
  console.log(`JSON Report: ${REPORT_PATH}\n`);

  console.log('✨ NEXT STEPS');
  console.log('-'.repeat(80));
  if (report.statistics.priceDiscrepancies > 0) {
    console.log('1. ⚠️  Review price discrepancies listed above');
    console.log('2. Correct prices in original source if needed');
    console.log('3. Update CSV file');
    console.log('4. Proceed with seed script update\n');
  } else {
    console.log('1. ✅ Review detailed JSON report');
    console.log('2. Update seed script with deduplication logic');
    console.log('3. Run seed to import deduplicated data\n');
  }

  console.log('='.repeat(80) + '\n');
}

/**
 * Main execution
 */
function main() {
  try {
    console.log('\n🔍 Analyzing CSV for duplicate pairs...\n');

    // Parse CSV
    const services = parseCSV();
    console.log(`✅ Parsed ${services.length} services from CSV`);

    // Find duplicate pairs
    const pairs = findDuplicatePairs(services);
    console.log(`✅ Found ${pairs.length} duplicate pairs`);

    // Find unpaired services
    const unpaired = findUnpairedServices(services, pairs);
    console.log(`✅ Found ${unpaired.length} unpaired services`);

    // Generate report
    const report = generateReport(services, pairs, unpaired);

    // Save JSON report
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`✅ Report saved to ${REPORT_PATH}`);

    // Print console report
    printConsoleReport(report);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error analyzing CSV:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { parseCSV, findDuplicatePairs, generateReport };
