/* eslint-disable prefer-destructuring */
/**
 * Export Seed Data from Development Database to CSV.
 *
 * This script exports data from the development database to CSV files
 * to make seeds self-contained and independent of pre-existing database data.
 *
 * USAGE:
 *   NODE_ENV=development node scripts/utils/export-seed-data.js.
 *
 * EXPORTS:
 *   1. Services Catalog (69 unique routes) → docs/tarifario/Services_Catalog.csv
 *   2. ClientPrices (161 records) → docs/tarifario/ClientPrices.csv.
 *
 * NOTE: Run this from development environment where data already exists.
 */

const Parse = require('parse/node');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../environments/.env.development') });

// Initialize Parse
Parse.initialize(
  process.env.PARSE_APP_ID || 'amexingAppId',
  process.env.PARSE_JS_KEY || 'amexingJSKey',
  process.env.PARSE_MASTER_KEY || 'amexingMasterKey'
);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

/**
 * Export Services Catalog to CSV
 * Extracts 69 unique rate-agnostic routes from Services table.
 * @example
 */
async function exportServicesCatalog() {
  console.log('\n📋 Exporting Services Catalog...');

  const ServicesClass = Parse.Object.extend('Services');
  const query = new Parse.Query(ServicesClass);
  query.equalTo('exists', true);
  query.include(['originPOI', 'originPOI.serviceType', 'destinationPOI', 'destinationPOI.serviceType']);
  query.limit(1000);

  const services = await query.find({ useMasterKey: true });
  console.log(`   Found ${services.length} Services records`);

  // Build CSV content
  const headers = [
    'originPOI_name',
    'originPOI_serviceType',
    'destinationPOI_name',
    'destinationPOI_serviceType',
    'note',
  ];

  const rows = [];

  for (const service of services) {
    const originPOI = service.get('originPOI');
    const destinationPOI = service.get('destinationPOI');

    // Extract service type names
    let originServiceTypeName = '';
    let destServiceTypeName = '';

    if (originPOI) {
      const originServiceType = originPOI.get('serviceType');
      if (originServiceType) {
        originServiceTypeName = originServiceType.get('name') || '';
      }
    }

    if (destinationPOI) {
      const destServiceType = destinationPOI.get('serviceType');
      if (destServiceType) {
        destServiceTypeName = destServiceType.get('name') || '';
      }
    }

    const row = {
      originPOI_name: originPOI ? originPOI.get('name') || '' : '',
      originPOI_serviceType: originServiceTypeName,
      destinationPOI_name: destinationPOI ? destinationPOI.get('name') || '' : '',
      destinationPOI_serviceType: destServiceTypeName,
      note: service.get('note') || '',
    };

    rows.push(row);
  }

  // Write CSV
  const csvContent = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => {
      const value = String(row[h] || '');
      // Escape commas and quotes in CSV
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    }).join(',')),
  ].join('\n');

  const outputPath = path.join(__dirname, '../../docs/tarifario/Services_Catalog.csv');
  fs.writeFileSync(outputPath, csvContent, 'utf8');

  console.log(`   ✅ Exported ${rows.length} routes to ${outputPath}`);
  return rows.length;
}

/**
 * Export ClientPrices to CSV
 * Includes all client-specific pricing data.
 * @example
 */
async function exportClientPrices() {
  console.log('\n📋 Exporting ClientPrices...');

  const ClientPricesClass = Parse.Object.extend('ClientPrices');
  const query = new Parse.Query(ClientPricesClass);
  query.equalTo('exists', true);
  query.include(['clientPtr', 'ratePtr', 'vehiclePtr']);
  query.limit(10000);

  const clientPrices = await query.find({ useMasterKey: true });
  console.log(`   Found ${clientPrices.length} ClientPrices records`);

  // Build CSV content
  const headers = [
    'clientIndex',
    'companyName',
    'itemType',
    'service_origin',
    'service_destination',
    'rate_name',
    'vehicle_code',
    'precio',
    'basePrice',
    'currency',
  ];

  const rows = [];

  for (const cp of clientPrices) {
    const clientPtr = cp.get('clientPtr');
    const ratePtr = cp.get('ratePtr');
    const vehiclePtr = cp.get('vehiclePtr');
    const itemId = cp.get('itemId');

    // Fetch pointers
    if (clientPtr) {
      await clientPtr.fetch({ useMasterKey: true });
    }
    if (ratePtr) {
      await ratePtr.fetch({ useMasterKey: true });
    }
    if (vehiclePtr) {
      await vehiclePtr.fetch({ useMasterKey: true });
    }

    // Fetch Service to get POI names
    let serviceOrigin = '';
    let serviceDestination = '';
    if (itemId) {
      try {
        const ServicesClass = Parse.Object.extend('Services');
        const service = await new Parse.Query(ServicesClass).get(itemId, { useMasterKey: true });

        if (service) {
          const originPOI = service.get('originPOI');
          const destinationPOI = service.get('destinationPOI');

          if (originPOI) {
            await originPOI.fetch({ useMasterKey: true });
            serviceOrigin = originPOI.get('name') || '';
          }
          if (destinationPOI) {
            await destinationPOI.fetch({ useMasterKey: true });
            serviceDestination = destinationPOI.get('name') || '';
          }
        }
      } catch (error) {
        console.warn(`   ⚠️  Could not fetch Service ${itemId}:`, error.message);
      }
    }

    // Get clientIndex - can be in ClientPrices directly or in user's contextualData
    let clientIndex = cp.get('clientIndex');
    const contextualData = clientPtr ? clientPtr.get('contextualData') : null;
    const companyName = contextualData ? contextualData.companyName : '';

    // If clientIndex not in ClientPrices, try to get it from user's contextualData
    if (!clientIndex && contextualData && contextualData.clientIndex) {
      clientIndex = contextualData.clientIndex;
    }

    const row = {
      clientIndex: String(clientIndex || ''),
      companyName: companyName || '',
      itemType: cp.get('itemType') || 'SERVICES',
      service_origin: serviceOrigin,
      service_destination: serviceDestination,
      rate_name: ratePtr ? ratePtr.get('name') || '' : '',
      vehicle_code: vehiclePtr ? vehiclePtr.get('code') || '' : '',
      precio: cp.get('precio') || 0,
      basePrice: cp.get('basePrice') || 0,
      currency: cp.get('currency') || 'MXN',
    };

    rows.push(row);
  }

  // Write CSV
  const csvContent = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => {
      const value = String(row[h] || '');
      // Escape commas and quotes in CSV
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    }).join(',')),
  ].join('\n');

  const outputPath = path.join(__dirname, '../../docs/tarifario/ClientPrices.csv');
  fs.writeFileSync(outputPath, csvContent, 'utf8');

  console.log(`   ✅ Exported ${rows.length} client prices to ${outputPath}`);
  return rows.length;
}

/**
 * Main export function.
 * @example
 */
async function exportSeedData() {
  console.log('🌱 Starting Seed Data Export from Development Database\n');
  console.log(`   Database: ${process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse'}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);

  try {
    // Export Services Catalog
    const servicesCount = await exportServicesCatalog();

    // Export ClientPrices
    const clientPricesCount = await exportClientPrices();

    // Summary
    console.log('\n📊 Export Summary:');
    console.log(`   Services Catalog: ${servicesCount} routes`);
    console.log(`   ClientPrices: ${clientPricesCount} records`);
    console.log('\n✅ Export completed successfully!\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Export failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run export
exportSeedData();
