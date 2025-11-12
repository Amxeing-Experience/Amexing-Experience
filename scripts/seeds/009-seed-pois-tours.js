/**
 * Seed POIs for Tours Destinations
 *
 * Creates POI entries for all tour destinations from Estructura_Tarifario_Tours.csv
 * with serviceType="Tours".
 *
 * Destinations created:
 * - San Miguel de Allende
 * - Atotonilco
 * - Dolores Hidalgo
 * - Guanajuato
 * - Mineral de Pozos
 * - Querétaro
 * - Cañada de la Virgen (no incluye entradas)
 * - Walking Tour San Miguel de Allende
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2025-01-11
 */

const Parse = require('parse/node');
const fs = require('fs');
const path = require('path');

const VERSION = '1.0.0';

/**
 * Extract unique destinations from Tours CSV
 */
function getUniqueDestinations() {
  const csvPath = path.join(__dirname, '../../docs/tarifario/Estructura_Tarifario_Tours.csv');

  console.log(`📄 Reading Tours CSV: ${csvPath}`);

  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split('\n').filter(line => line.trim());

  // Remove header and BOM if present
  lines.shift();

  const destinations = new Set();

  lines.forEach(line => {
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

    // CSV structure: Tarifa,Destino,Tipo de Vehículo,Precio,Duración,Min,Max
    const destino = fields[1];
    if (destino) {
      destinations.add(destino);
    }
  });

  return Array.from(destinations).sort();
}

/**
 * Run seed
 */
async function run() {
  console.log('\n🌍 Starting POI seed for Tours destinations...');

  // Get ServiceType "Tours"
  const serviceTypeQuery = new Parse.Query('ServiceType');
  serviceTypeQuery.equalTo('name', 'Tours');
  serviceTypeQuery.equalTo('exists', true);
  const serviceType = await serviceTypeQuery.first({ useMasterKey: true });

  if (!serviceType) {
    throw new Error('ServiceType "Tours" not found. Run seed 001-seed-service-types first.');
  }

  console.log('✅ ServiceType "Tours" found');

  // Get unique destinations from CSV
  const destinations = getUniqueDestinations();
  console.log(`📍 Found ${destinations.length} unique destinations in CSV`);
  destinations.forEach(dest => console.log(`   - ${dest}`));

  let created = 0;
  let skipped = 0;
  let failed = 0;

  // Create POIs
  for (const destinationName of destinations) {
    try {
      // Check if POI already exists with this name and serviceType
      const existingQuery = new Parse.Query('POI');
      existingQuery.equalTo('name', destinationName);
      existingQuery.equalTo('serviceType', serviceType);
      existingQuery.equalTo('exists', true);

      const existing = await existingQuery.first({ useMasterKey: true });

      if (existing) {
        console.log(`   ⏭️  Skipped: "${destinationName}" (already exists)`);
        skipped++;
        continue;
      }

      // Create new POI
      const POI = Parse.Object.extend('POI');
      const poi = new POI();

      poi.set('name', destinationName);
      poi.set('serviceType', serviceType);
      poi.set('active', true);
      poi.set('exists', true);

      // Set ACL
      const acl = new Parse.ACL();
      acl.setPublicReadAccess(true);
      acl.setRoleWriteAccess('admin', true);
      acl.setRoleWriteAccess('superadmin', true);
      poi.setACL(acl);

      await poi.save(null, { useMasterKey: true });

      console.log(`   ✅ Created: "${destinationName}"`);
      created++;

    } catch (error) {
      console.error(`   ❌ Failed to create "${destinationName}":`, error.message);
      failed++;
    }
  }

  console.log('\n📊 POI seed complete:');
  console.log(`   Created: ${created}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Failed: ${failed}`);

  return {
    created,
    skipped,
    errors: failed
  };
}

module.exports = {
  version: VERSION,
  description: 'Seed POIs for Tours destinations from Estructura_Tarifario_Tours.csv',
  run,
};
