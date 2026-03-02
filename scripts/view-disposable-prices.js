/**
 * Script to view DisposablePrices data from staging
 * Helps verify data before migration
 * Created by Denisse Maldonado
 */

const Parse = require('parse/node');
require('dotenv').config();

// Use local Parse server (connected to staging database)
const STAGING_CONFIG = {
  appId: process.env.PARSE_APP_ID || 'quotes',
  masterKey: process.env.PARSE_MASTER_KEY || 'quotesmasterkey',
  serverURL: process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse',
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

// Initialize Parse
Parse.initialize(STAGING_CONFIG.appId, null, STAGING_CONFIG.masterKey);
Parse.serverURL = STAGING_CONFIG.serverURL;
Parse.masterKey = STAGING_CONFIG.masterKey;

async function viewDisposablePrices() {
  try {
    log('========================================', 'bright');
    log('DisposablePrices Data Viewer', 'cyan');
    log('========================================', 'bright');
    log('\nConnecting to staging environment...', 'yellow');
    
    // Get all DisposablePrices
    const query = new Parse.Query('DisposablePrices');
    query.include(['vehicleType', 'rate']);
    query.limit(1000);
    query.ascending('vehicleType');
    
    const prices = await query.find({ useMasterKey: true });
    
    if (prices.length === 0) {
      log('\n⚠️  No DisposablePrices found in staging', 'yellow');
      return;
    }
    
    log(`\n✓ Found ${prices.length} DisposablePrices in staging\n`, 'green');
    
    // Group by active/inactive
    const activePrices = prices.filter(p => p.get('active') === true);
    const inactivePrices = prices.filter(p => p.get('active') !== true);
    
    log('Active Prices:', 'cyan');
    log('─────────────', 'cyan');
    
    if (activePrices.length > 0) {
      activePrices.forEach(price => {
        const vehicleType = price.get('vehicleType');
        const rate = price.get('rate');
        const vehicleTypeName = vehicleType ? vehicleType.get('name') : 'Unknown';
        const rateName = rate ? rate.get('name') : 'Unknown';
        const hourlyPrice = price.get('hourlyPrice') || 0;
        const currency = price.get('currency') || 'MXN';
        
        log(`  • ${vehicleTypeName} (${rateName}): $${hourlyPrice.toFixed(2)} ${currency}`, 'reset');
      });
    } else {
      log('  No active prices found', 'yellow');
    }
    
    if (inactivePrices.length > 0) {
      log('\nInactive Prices:', 'yellow');
      log('────────────────', 'yellow');
      
      inactivePrices.forEach(price => {
        const vehicleType = price.get('vehicleType');
        const rate = price.get('rate');
        const vehicleTypeName = vehicleType ? vehicleType.get('name') : 'Unknown';
        const rateName = rate ? rate.get('name') : 'Unknown';
        const hourlyPrice = price.get('hourlyPrice') || 0;
        const currency = price.get('currency') || 'MXN';
        
        log(`  • ${vehicleTypeName} (${rateName}): $${hourlyPrice.toFixed(2)} ${currency}`, 'reset');
      });
    }
    
    // Show unique rates and vehicle types
    const uniqueRates = new Set();
    const uniqueVehicleTypes = new Set();
    
    prices.forEach(price => {
      const vehicleType = price.get('vehicleType');
      const rate = price.get('rate');
      
      if (vehicleType) {
        uniqueVehicleTypes.add(vehicleType.get('name'));
      }
      if (rate) {
        uniqueRates.add(rate.get('name'));
      }
    });
    
    log('\n📊 Summary:', 'magenta');
    log('──────────', 'magenta');
    log(`  Total Prices: ${prices.length}`, 'reset');
    log(`  Active: ${activePrices.length}`, 'green');
    log(`  Inactive: ${inactivePrices.length}`, 'yellow');
    log(`  Unique Vehicle Types: ${uniqueVehicleTypes.size}`, 'reset');
    log(`  Unique Rates: ${uniqueRates.size}`, 'reset');
    
    log('\n📝 Required in Production:', 'cyan');
    log('─────────────────────────', 'cyan');
    log('  Vehicle Types:', 'yellow');
    Array.from(uniqueVehicleTypes).sort().forEach(name => {
      log(`    • ${name}`, 'reset');
    });
    
    log('\n  Rates:', 'yellow');
    Array.from(uniqueRates).sort().forEach(name => {
      log(`    • ${name}`, 'reset');
    });
    
    log('\n✨ Data review complete!', 'green');
    
  } catch (error) {
    log(`\n❌ Error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

// Run viewer
viewDisposablePrices()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    log(`\n❌ Fatal error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  });