#!/usr/bin/env node

/**
 * Analyze Skipped Services from CSV
 *
 * Identifies which CSV records are being skipped during import and why.
 */

require('dotenv').config({
  path: `./environments/.env.${process.env.NODE_ENV || 'development'}`,
});

const fs = require('fs');
const path = require('path');
const Parse = require('parse/node');

// Initialize Parse
Parse.initialize(
  process.env.PARSE_APP_ID,
  null,
  process.env.PARSE_MASTER_KEY
);
Parse.serverURL = process.env.PARSE_SERVER_URL;

const CSV_PATH = path.join(__dirname, '../../docs/tarifario/Estructura_Tarifario.csv');

/**
 * Parse CSV file
 */
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',').map(h => h.trim());

  return lines.slice(1).map((line, index) => {
    const values = line.split(',').map(v => v.trim());
    const row = {};
    headers.forEach((header, i) => {
      row[header] = values[i] || '';
    });
    row.lineNumber = index + 2; // +2 because we skip header and 0-indexed
    return row;
  });
}

async function analyzeSkipped() {
  console.log('\n🔍 Analyzing Skipped Services from CSV\n');
  console.log('═'.repeat(80));

  // Parse CSV
  const rows = parseCSV(CSV_PATH);
  console.log(`📄 Total CSV rows: ${rows.length}`);

  // Load reference data
  console.log('\n🔄 Loading reference data...\n');

  const ratesQuery = new Parse.Query('Rate');
  ratesQuery.equalTo('exists', true);
  ratesQuery.limit(1000);
  const rates = await ratesQuery.find({ useMasterKey: true });
  const ratesMap = {};
  rates.forEach(rate => {
    ratesMap[rate.get('name')] = rate;
  });
  console.log(`   ✅ Loaded ${rates.length} rates: ${Object.keys(ratesMap).join(', ')}`);

  const poisQuery = new Parse.Query('POI');
  poisQuery.equalTo('exists', true);
  poisQuery.include('serviceType');
  poisQuery.limit(1000);
  const pois = await poisQuery.find({ useMasterKey: true });
  const poisMap = {};
  pois.forEach(poi => {
    const serviceType = poi.get('serviceType');
    const serviceTypeName = serviceType ? serviceType.get('name') : 'Unknown';
    const key = `${poi.get('name')}|${serviceTypeName}`;
    poisMap[key] = poi;
  });
  console.log(`   ✅ Loaded ${pois.length} POIs`);

  const vehicleTypesQuery = new Parse.Query('VehicleType');
  vehicleTypesQuery.equalTo('exists', true);
  vehicleTypesQuery.limit(1000);
  const vehicleTypes = await vehicleTypesQuery.find({ useMasterKey: true });
  const vehicleTypesMap = {};
  vehicleTypes.forEach(vt => {
    vehicleTypesMap[vt.get('name')] = vt;
  });
  console.log(`   ✅ Loaded ${vehicleTypes.length} vehicle types: ${Object.keys(vehicleTypesMap).join(', ')}`);

  // Analyze each row
  console.log('\n' + '═'.repeat(80));
  console.log('SKIPPED RECORDS ANALYSIS');
  console.log('═'.repeat(80) + '\n');

  const skippedRecords = [];

  for (const row of rows) {
    const { tarifa, tipoTraslado, origen, destino, tipoVehiculo, precio, notas, lineNumber } = row;

    const rate = ratesMap[tarifa];
    const originKey = origen ? `${origen}|${tipoTraslado}` : null;
    const destinationKey = `${destino}|${tipoTraslado}`;
    const originPOI = originKey ? poisMap[originKey] : null;
    const destinationPOI = poisMap[destinationKey];
    const vehicleType = vehicleTypesMap[tipoVehiculo];

    const reasons = [];
    if (!rate) reasons.push(`Missing Rate: "${tarifa}"`);
    if (!destinationPOI) reasons.push(`Missing Destination POI: "${destino}|${tipoTraslado}"`);
    if (!vehicleType) reasons.push(`Missing Vehicle Type: "${tipoVehiculo}"`);
    if (origen && !originPOI) reasons.push(`Missing Origin POI: "${origen}|${tipoTraslado}"`);

    if (reasons.length > 0) {
      skippedRecords.push({
        lineNumber,
        tarifa,
        tipoTraslado,
        origen,
        destino,
        tipoVehiculo,
        precio,
        reasons
      });
    }
  }

  console.log(`Total Skipped: ${skippedRecords.length} / ${rows.length}\n`);

  if (skippedRecords.length > 0) {
    console.log('Line  | Tarifa        | Traslado      | Origen -> Destino                 | Vehicle  | Reason');
    console.log('─'.repeat(140));

    skippedRecords.forEach(record => {
      const route = record.origen
        ? `${record.origen} -> ${record.destino}`
        : `-> ${record.destino}`;

      console.log(
        `${record.lineNumber.toString().padStart(5)} | ` +
        `${record.tarifa.padEnd(13)} | ` +
        `${record.tipoTraslado.padEnd(13)} | ` +
        `${route.padEnd(33)} | ` +
        `${record.tipoVehiculo.padEnd(8)} | ` +
        `${record.reasons.join('; ')}`
      );
    });
  } else {
    console.log('✅ No records should be skipped - all references found!\n');
  }

  // Group by reason
  console.log('\n' + '═'.repeat(80));
  console.log('SUMMARY BY REASON');
  console.log('═'.repeat(80) + '\n');

  const reasonCounts = {};
  skippedRecords.forEach(record => {
    record.reasons.forEach(reason => {
      const key = reason.split(':')[0];
      reasonCounts[key] = (reasonCounts[key] || 0) + 1;
    });
  });

  Object.entries(reasonCounts).forEach(([reason, count]) => {
    console.log(`   ${reason}: ${count} records`);
  });

  console.log('\n' + '═'.repeat(80));
  console.log(`Expected to import: ${rows.length - skippedRecords.length} services`);
  console.log('═'.repeat(80) + '\n');
}

analyzeSkipped().catch(console.error);
