/**
 * Migration script to copy DisposablePrices from staging to production
 * Maps rates and vehicleTypes between environments
 * Created by Denisse Maldonado
 */

const Parse = require('parse/node');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');

// Load staging environment (current local)
require('dotenv').config({
  path: path.join(__dirname, '../environments/.env.development')
});

// Store staging config
const STAGING_CONFIG = {
  appId: process.env.PARSE_APP_ID || 'quotes',
  masterKey: process.env.PARSE_MASTER_KEY || 'quotesmasterkey',
  serverURL: process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse',
};

// Load production environment
require('dotenv').config({
  path: path.join(__dirname, '../environments/.env.production'),
  override: true
});

// For production - from .env.production file or command line
// Allow overriding the production URL via command line argument
const prodUrlArg = args.find(arg => arg.startsWith('--prod-url='));
const prodUrl = prodUrlArg ? prodUrlArg.split('=')[1] : process.env.PARSE_SERVER_URL;

const PRODUCTION_CONFIG = {
  appId: process.env.PARSE_APP_ID || 'quotes-prod',
  masterKey: process.env.PARSE_MASTER_KEY || 'NEEDS_TO_BE_SET',
  serverURL: prodUrl || 'https://amexing-quotes-production-2f91d0f326e9.herokuapp.com/parse',
};

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Initialize Parse for different environments
function initializeParse(config) {
  Parse.initialize(config.appId, null, config.masterKey);
  Parse.serverURL = config.serverURL;
  Parse.masterKey = config.masterKey;
}

// Get all rates from an environment
async function getRates() {
  const query = new Parse.Query('Rate');
  query.equalTo('exists', true);
  query.limit(1000);
  const rates = await query.find({ useMasterKey: true });
  
  const rateMap = new Map();
  rates.forEach(rate => {
    rateMap.set(rate.get('name'), rate.id);
  });
  
  return rateMap;
}

// Get all vehicle types from an environment
async function getVehicleTypes() {
  const query = new Parse.Query('VehicleType');
  query.equalTo('exists', true);
  query.limit(1000);
  const vehicleTypes = await query.find({ useMasterKey: true });
  
  const vehicleMap = new Map();
  vehicleTypes.forEach(vehicle => {
    vehicleMap.set(vehicle.get('name'), vehicle.id);
  });
  
  return vehicleMap;
}

// Get all DisposablePrices from staging
async function getDisposablePrices() {
  const query = new Parse.Query('DisposablePrices');
  query.include(['vehicleType', 'rate']);
  query.limit(1000);
  return await query.find({ useMasterKey: true });
}

// Main migration function
async function migrateDisposablePrices() {
  try {
    log('========================================', 'bright');
    log('DisposablePrices Migration Script', 'cyan');
    log('========================================', 'bright');
    
    if (isDryRun) {
      log('🔍 DRY RUN MODE - No changes will be made', 'yellow');
    }
    
    // Check production credentials
    if (PRODUCTION_CONFIG.masterKey === 'NEEDS_TO_BE_SET') {
      log('\n❌ Error: Production Parse credentials not configured!', 'red');
      log('Please set the following environment variables:', 'yellow');
      log('  PROD_PARSE_APP_ID - Production Parse App ID', 'yellow');
      log('  PROD_PARSE_MASTER_KEY - Production Parse Master Key', 'yellow');
      log('  PROD_PARSE_SERVER_URL - Production Parse Server URL', 'yellow');
      log('\nExample:', 'cyan');
      log('  export PROD_PARSE_MASTER_KEY="your-production-master-key"', 'cyan');
      process.exit(1);
    }
    
    // Step 1: Get staging data
    log('\n📊 Fetching staging data...', 'yellow');
    initializeParse(STAGING_CONFIG);
    
    const stagingRates = await getRates();
    log(`  ✓ Found ${stagingRates.size} rates in staging`, 'green');
    
    const stagingVehicleTypes = await getVehicleTypes();
    log(`  ✓ Found ${stagingVehicleTypes.size} vehicle types in staging`, 'green');
    
    const disposablePrices = await getDisposablePrices();
    log(`  ✓ Found ${disposablePrices.length} DisposablePrices in staging`, 'green');
    
    // Step 2: Get production mappings
    log('\n🎯 Fetching production mappings...', 'yellow');
    log(`  Production URL: ${PRODUCTION_CONFIG.serverURL}`, 'cyan');
    log(`  Production App ID: ${PRODUCTION_CONFIG.appId}`, 'cyan');
    initializeParse(PRODUCTION_CONFIG);
    
    const productionRates = await getRates();
    log(`  ✓ Found ${productionRates.size} rates in production`, 'green');
    
    const productionVehicleTypes = await getVehicleTypes();
    log(`  ✓ Found ${productionVehicleTypes.size} vehicle types in production`, 'green');
    
    // Step 3: Check if DisposablePrices already exist in production
    const existingQuery = new Parse.Query('DisposablePrices');
    existingQuery.limit(1);
    const existingPrices = await existingQuery.find({ useMasterKey: true });
    
    if (existingPrices.length > 0) {
      log('\n⚠️  Warning: DisposablePrices already exist in production!', 'red');
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise(resolve => {
        readline.question('Do you want to continue and add more prices? (yes/no): ', resolve);
      });
      readline.close();
      
      if (answer.toLowerCase() !== 'yes') {
        log('Migration cancelled.', 'yellow');
        return;
      }
    }
    
    // Step 4: Migrate each DisposablePrice
    log('\n🚀 Starting migration...', 'cyan');
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    
    for (const price of disposablePrices) {
      try {
        const vehicleType = price.get('vehicleType');
        const rate = price.get('rate');
        
        if (!vehicleType || !rate) {
          log(`  ⚠️  Skipping price ${price.id} - missing vehicleType or rate`, 'yellow');
          skipCount++;
          continue;
        }
        
        const vehicleTypeName = vehicleType.get('name');
        const rateName = rate.get('name');
        
        // Find corresponding IDs in production
        const prodVehicleTypeId = productionVehicleTypes.get(vehicleTypeName);
        const prodRateId = productionRates.get(rateName);
        
        if (!prodVehicleTypeId) {
          log(`  ⚠️  Skipping - VehicleType "${vehicleTypeName}" not found in production`, 'yellow');
          skipCount++;
          continue;
        }
        
        if (!prodRateId) {
          log(`  ⚠️  Skipping - Rate "${rateName}" not found in production`, 'yellow');
          skipCount++;
          continue;
        }
        
        if (!isDryRun) {
          // Create new DisposablePrice in production
          const DisposablePrices = Parse.Object.extend('DisposablePrices');
          const newPrice = new DisposablePrices();
          
          // Set all fields
          newPrice.set('vehicleType', {
            __type: 'Pointer',
            className: 'VehicleType',
            objectId: prodVehicleTypeId
          });
          
          newPrice.set('rate', {
            __type: 'Pointer',
            className: 'Rate',
            objectId: prodRateId
          });
          
          newPrice.set('hourlyPrice', price.get('hourlyPrice') || 0);
          newPrice.set('currency', price.get('currency') || 'MXN');
          newPrice.set('active', price.get('active') !== false);
          newPrice.set('exists', price.get('exists') !== false);
          
          if (price.get('effectiveDate')) {
            newPrice.set('effectiveDate', price.get('effectiveDate'));
          }
          
          if (price.get('endDate')) {
            newPrice.set('endDate', price.get('endDate'));
          }
          
          await newPrice.save(null, { useMasterKey: true });
          
          log(`  ✓ Migrated: ${vehicleTypeName} - ${rateName} - $${price.get('hourlyPrice')} ${price.get('currency')}`, 'green');
        } else {
          log(`  [DRY RUN] Would migrate: ${vehicleTypeName} - ${rateName} - $${price.get('hourlyPrice')} ${price.get('currency')}`, 'cyan');
        }
        successCount++;
        
      } catch (error) {
        log(`  ✗ Error migrating price ${price.id}: ${error.message}`, 'red');
        errorCount++;
      }
    }
    
    // Step 5: Summary
    log('\n========================================', 'bright');
    log('Migration Complete!', 'cyan');
    log('========================================', 'bright');
    log(`✓ Successfully migrated: ${successCount} prices`, 'green');
    log(`⚠ Skipped: ${skipCount} prices`, 'yellow');
    log(`✗ Errors: ${errorCount} prices`, 'red');
    
  } catch (error) {
    log(`\n❌ Migration failed: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

// Show help if requested
if (args.includes('--help') || args.includes('-h')) {
  log('DisposablePrices Migration Script', 'cyan');
  log('=================================', 'bright');
  log('\nUsage: node scripts/migrate-disposable-prices.js [options]', 'yellow');
  log('\nOptions:', 'yellow');
  log('  --dry-run                 Run in dry-run mode (no changes will be made)', 'reset');
  log('  --verbose                 Show detailed output', 'reset');
  log('  --prod-url=<URL>          Override production Parse server URL', 'reset');
  log('  --help, -h                Show this help message', 'reset');
  log('\nEnvironment Files:', 'yellow');
  log('  Staging:    environments/.env.development', 'reset');
  log('  Production: environments/.env.production', 'reset');
  log('\nExamples:', 'yellow');
  log('  # Dry run to preview changes:', 'reset');
  log('  node scripts/migrate-disposable-prices.js --dry-run', 'cyan');
  log('\n  # Run with custom production URL:', 'reset');
  log('  node scripts/migrate-disposable-prices.js --dry-run --prod-url=https://your-prod.herokuapp.com/parse', 'cyan');
  log('\n  # Execute migration:', 'reset');
  log('  node scripts/migrate-disposable-prices.js', 'cyan');
  process.exit(0);
}

// Run migration
migrateDisposablePrices()
  .then(() => {
    log('\n✨ Migration script completed successfully!', 'green');
    process.exit(0);
  })
  .catch((error) => {
    log(`\n❌ Fatal error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  });