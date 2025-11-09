#!/usr/bin/env node

/**
 * Reset Specific Seeds - Production Utility
 *
 * Allows resetting specific seeds in production to re-run them.
 * Use with caution - this is for fixing seed execution issues.
 *
 * Usage: NODE_ENV=production node scripts/production/reset-specific-seeds.js seed1 seed2
 */

require('dotenv').config({
  path: `./environments/.env.${process.env.NODE_ENV || 'development'}`,
});

const Parse = require('parse/node');

// Initialize Parse
Parse.initialize(
  process.env.PARSE_APP_ID,
  null,
  process.env.PARSE_MASTER_KEY
);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

async function resetSeeds(seedNames) {
  console.log(`\n🔄 Resetting seeds: ${seedNames.join(', ')}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Server URL: ${Parse.serverURL}\n`);

  try {
    const SeedClass = Parse.Object.extend('SeedExecution');
    const query = new Parse.Query(SeedClass);
    query.containedIn('name', seedNames);

    const records = await query.find({ useMasterKey: true });
    console.log(`Found ${records.length} seed execution records to delete\n`);

    for (const record of records) {
      const name = record.get('name');
      await record.destroy({ useMasterKey: true });
      console.log(`✅ Deleted: ${name}`);
    }

    console.log(`\n✅ Successfully reset ${records.length} seeds`);
    console.log('You can now run yarn seed again to re-execute these seeds\n');
  } catch (error) {
    console.error('❌ Error resetting seeds:', error.message);
    process.exit(1);
  }
}

// Get seed names from command line arguments
const seedNames = process.argv.slice(2);

if (seedNames.length === 0) {
  console.error('❌ Error: No seed names provided');
  console.log('\nUsage: node scripts/production/reset-specific-seeds.js seed1 seed2');
  console.log('Example: NODE_ENV=production node scripts/production/reset-specific-seeds.js 005-seed-rates 007-seed-services-from-csv\n');
  process.exit(1);
}

resetSeeds(seedNames);
