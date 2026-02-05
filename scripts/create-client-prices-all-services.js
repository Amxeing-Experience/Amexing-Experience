/**
 * Script: Create Client Prices for All Services
 * Creates ClientPrices records for a specific client with all Services and all available Rates
 * Supports version history (valid_until field for historical prices)
 * 
 * Usage:
 * node scripts/create-client-prices-all-services.js
 * 
 * Features:
 * - Creates prices for ALL Services in the database
 * - Creates prices for ALL Rate/VehicleType combinations
 * - Supports price versioning (historical tracking)
 * - Handles existing prices by versioning them
 * - Configurable default discount percentage
 * 
 * Created by Denisse Maldonado
 */

const Parse = require('parse/node');
const readline = require('readline');
const path = require('path');

// Load environment based on NODE_ENV
const envPath = process.env.NODE_ENV === 'production' 
  ? './environments/.env.production'
  : './environments/.env.development';
require('dotenv').config({ path: envPath });

// Initialize Parse
Parse.initialize(
  process.env.PARSE_APP_ID || 'AMEXING_DEV_APP_ID',
  process.env.PARSE_JAVASCRIPT_KEY,
  process.env.PARSE_MASTER_KEY || 'AMEXING_DEV_MASTER_KEY'
);

// Set Parse Server URL based on environment
const defaultServerURL = process.env.NODE_ENV === 'production' 
  ? 'http://localhost:1338/parse' 
  : 'http://localhost:1337/parse';
Parse.serverURL = process.env.PARSE_SERVER_URL || defaultServerURL;

// Configuration
const DEFAULT_MARKUP_PERCENTAGE = 10; // Default 10% markup for client prices
const BATCH_SIZE = 50; // Process in batches to avoid memory issues

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Prompt for user input
 */
function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Find client by email or company name
 */
async function findClient(identifier) {
  const AmexingUserClass = Parse.Object.extend('AmexingUser');
  
  // Try by email first
  let query = new Parse.Query(AmexingUserClass);
  query.equalTo('email', identifier);
  query.equalTo('exists', true);
  let client = await query.first({ useMasterKey: true });
  
  if (client) return client;
  
  // Try by company name in contextualData
  query = new Parse.Query(AmexingUserClass);
  query.equalTo('contextualData.companyName', identifier);
  query.equalTo('exists', true);
  client = await query.first({ useMasterKey: true });
  
  if (client) return client;
  
  // Try by partial match on company name
  query = new Parse.Query(AmexingUserClass);
  query.matches('contextualData.companyName', new RegExp(identifier, 'i'));
  query.equalTo('exists', true);
  const clients = await query.find({ useMasterKey: true });
  
  if (clients.length === 1) {
    return clients[0];
  } else if (clients.length > 1) {
    console.log('\n🔍 Multiple clients found:');
    clients.forEach((c, i) => {
      const companyName = c.get('contextualData')?.companyName || 'N/A';
      console.log(`   ${i + 1}. ${c.get('email')} - ${companyName}`);
    });
    
    const choice = await askQuestion('Select client number: ');
    const index = parseInt(choice) - 1;
    if (index >= 0 && index < clients.length) {
      return clients[index];
    }
  }
  
  return null;
}

/**
 * Get all active Services
 */
async function getAllServices() {
  const ServicesClass = Parse.Object.extend('Services');
  const query = new Parse.Query(ServicesClass);
  query.equalTo('exists', true);
  query.equalTo('active', true);
  query.include(['originPOI', 'destinationPOI']);
  query.limit(10000); // Adjust if needed
  
  return await query.find({ useMasterKey: true });
}

/**
 * Get all active Rates
 */
async function getAllRates() {
  const RateClass = Parse.Object.extend('Rate');
  const query = new Parse.Query(RateClass);
  query.equalTo('exists', true);
  query.equalTo('active', true);
  query.limit(100);
  
  return await query.find({ useMasterKey: true });
}

/**
 * Get all active VehicleTypes
 */
async function getAllVehicleTypes() {
  const VehicleTypeClass = Parse.Object.extend('VehicleType');
  const query = new Parse.Query(VehicleTypeClass);
  query.equalTo('exists', true);
  query.equalTo('active', true);
  query.limit(100);
  
  return await query.find({ useMasterKey: true });
}

/**
 * Get base price from RatePrices table
 */
async function getBasePrice(serviceId, rateId, vehicleTypeId) {
  const RatePricesClass = Parse.Object.extend('RatePrices');
  const query = new Parse.Query(RatePricesClass);
  
  // Create pointers
  const ServicesClass = Parse.Object.extend('Services');
  const servicePointer = new ServicesClass();
  servicePointer.id = serviceId;
  
  const RateClass = Parse.Object.extend('Rate');
  const ratePointer = new RateClass();
  ratePointer.id = rateId;
  
  const VehicleTypeClass = Parse.Object.extend('VehicleType');
  const vehiclePointer = new VehicleTypeClass();
  vehiclePointer.id = vehicleTypeId;
  
  query.equalTo('servicePtr', servicePointer);
  query.equalTo('ratePtr', ratePointer);
  query.equalTo('vehiclePtr', vehiclePointer);
  query.equalTo('exists', true);
  query.equalTo('active', true);
  
  const ratePrice = await query.first({ useMasterKey: true });
  return ratePrice ? ratePrice.get('precio') : null;
}

/**
 * Version existing price (set valid_until to today)
 */
async function versionExistingPrice(existingPrice) {
  const today = new Date();
  today.setHours(23, 59, 59, 999); // End of today
  
  existingPrice.set('valid_until', today);
  existingPrice.set('active', false);
  await existingPrice.save(null, { useMasterKey: true });
}

/**
 * Create or update ClientPrice with versioning
 */
async function createClientPrice(client, service, rate, vehicleType, markupPercentage) {
  const ClientPricesClass = Parse.Object.extend('ClientPrices');
  
  // Check if price already exists (current version)
  const existingQuery = new Parse.Query(ClientPricesClass);
  existingQuery.equalTo('clientPtr', client);
  existingQuery.equalTo('itemType', 'SERVICES');
  existingQuery.equalTo('itemId', service.id);
  existingQuery.equalTo('ratePtr', rate);
  existingQuery.equalTo('vehiclePtr', vehicleType);
  existingQuery.equalTo('exists', true);
  existingQuery.doesNotExist('valid_until'); // Current price (no expiration)
  
  const existing = await existingQuery.first({ useMasterKey: true });
  
  // Get base price from RatePrices
  const basePrice = await getBasePrice(service.id, rate.id, vehicleType.id);
  
  if (!basePrice) {
    // No base price exists for this combination, skip
    return { created: false, skipped: true, reason: 'no_base_price' };
  }
  
  // Calculate marked up price (increase)
  const markedUpPrice = Math.round(basePrice * (1 + markupPercentage / 100));
  
  // If existing price is the same, skip
  if (existing && existing.get('precio') === markedUpPrice) {
    return { created: false, skipped: true, reason: 'same_price' };
  }
  
  // Version existing price if it exists
  if (existing) {
    await versionExistingPrice(existing);
  }
  
  // Create new price record
  const newPrice = new ClientPricesClass();
  newPrice.set('clientPtr', client);
  newPrice.set('itemType', 'SERVICES');
  newPrice.set('itemId', service.id);
  newPrice.set('ratePtr', rate);
  newPrice.set('vehiclePtr', vehicleType);
  newPrice.set('precio', markedUpPrice);
  newPrice.set('basePrice', basePrice);
  newPrice.set('currency', 'MXN');
  newPrice.set('active', true);
  newPrice.set('exists', true);
  // Don't set valid_until for current prices - Parse treats unset differently than null
  newPrice.set('createdBy', 'bulk_price_script');
  newPrice.set('notes', `Created with ${markupPercentage}% markup from base price`);
  
  await newPrice.save(null, { useMasterKey: true });
  
  return { 
    created: true, 
    versioned: existing ? true : false,
    basePrice,
    markedUpPrice 
  };
}

/**
 * Main execution function
 */
async function main() {
  try {
    console.log('🚀 Client Prices Bulk Creation Script');
    console.log('=====================================\n');
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Parse Server: ${Parse.serverURL}\n`);
    
    // Get client identifier from user
    const clientIdentifier = await askQuestion('Enter client email or company name: ');
    
    if (!clientIdentifier) {
      console.log('❌ Client identifier is required');
      process.exit(1);
    }
    
    // Find client
    console.log('\n🔍 Searching for client...');
    const client = await findClient(clientIdentifier);
    
    if (!client) {
      console.log('❌ Client not found');
      process.exit(1);
    }
    
    const companyName = client.get('contextualData')?.companyName || 'Unknown';
    console.log(`✅ Found client: ${client.get('email')} - ${companyName}`);
    
    // Get markup percentage
    const markupInput = await askQuestion(`\nEnter markup percentage (default ${DEFAULT_MARKUP_PERCENTAGE}%): `);
    const markupPercentage = markupInput ? parseFloat(markupInput) : DEFAULT_MARKUP_PERCENTAGE;
    
    if (isNaN(markupPercentage) || markupPercentage < 0 || markupPercentage > 200) {
      console.log('❌ Invalid markup percentage');
      process.exit(1);
    }
    
    console.log(`\n📊 Will apply ${markupPercentage}% markup (increase) to all base prices`);
    
    // Confirmation
    const confirm = await askQuestion('\nProceed with creation? (yes/no): ');
    if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
      console.log('❌ Operation cancelled');
      process.exit(0);
    }
    
    // Get all required data
    console.log('\n📋 Loading data...');
    const [services, rates, vehicleTypes] = await Promise.all([
      getAllServices(),
      getAllRates(),
      getAllVehicleTypes()
    ]);
    
    console.log(`   ✅ Found ${services.length} services`);
    console.log(`   ✅ Found ${rates.length} rates`);
    console.log(`   ✅ Found ${vehicleTypes.length} vehicle types`);
    
    const totalCombinations = services.length * rates.length * vehicleTypes.length;
    console.log(`\n📦 Processing ${totalCombinations} potential price combinations...`);
    
    // Statistics
    const stats = {
      created: 0,
      versioned: 0,
      skipped: 0,
      errors: 0,
      noBasePrice: 0,
      samePrice: 0,
      processed: 0
    };
    
    // Process in batches
    let batch = [];
    const startTime = Date.now();
    
    for (const service of services) {
      for (const rate of rates) {
        for (const vehicleType of vehicleTypes) {
          stats.processed++;
          
          // Add to batch
          batch.push({ service, rate, vehicleType });
          
          // Process batch when it reaches the size limit
          if (batch.length >= BATCH_SIZE) {
            const batchPromises = batch.map(async ({ service, rate, vehicleType }) => {
              try {
                const result = await createClientPrice(
                  client,
                  service,
                  rate,
                  vehicleType,
                  markupPercentage
                );
                
                if (result.created) {
                  stats.created++;
                  if (result.versioned) {
                    stats.versioned++;
                  }
                } else if (result.skipped) {
                  stats.skipped++;
                  if (result.reason === 'no_base_price') {
                    stats.noBasePrice++;
                  } else if (result.reason === 'same_price') {
                    stats.samePrice++;
                  }
                }
              } catch (error) {
                stats.errors++;
                console.error(`   ❌ Error: ${error.message}`);
              }
            });
            
            await Promise.all(batchPromises);
            
            // Progress update
            if (stats.processed % 500 === 0) {
              const progress = Math.round((stats.processed / totalCombinations) * 100);
              console.log(`   Progress: ${progress}% (${stats.processed}/${totalCombinations})`);
            }
            
            // Clear batch
            batch = [];
          }
        }
      }
    }
    
    // Process remaining items in batch
    if (batch.length > 0) {
      const batchPromises = batch.map(async ({ service, rate, vehicleType }) => {
        try {
          const result = await createClientPrice(
            client,
            service,
            rate,
            vehicleType,
            discountPercentage
          );
          
          if (result.created) {
            stats.created++;
            if (result.versioned) {
              stats.versioned++;
            }
          } else if (result.skipped) {
            stats.skipped++;
            if (result.reason === 'no_base_price') {
              stats.noBasePrice++;
            } else if (result.reason === 'same_price') {
              stats.samePrice++;
            }
          }
        } catch (error) {
          stats.errors++;
          console.error(`   ❌ Error: ${error.message}`);
        }
      });
      
      await Promise.all(batchPromises);
    }
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    
    // Summary
    console.log('\n🎉 Client Prices creation completed!');
    console.log('\n📋 Summary:');
    console.log(`   Client: ${companyName} (${client.get('email')})`);
    console.log(`   Markup Applied: ${markupPercentage}%`);
    console.log(`   Total Processed: ${stats.processed}`);
    console.log(`   Prices Created: ${stats.created}`);
    console.log(`   Prices Versioned: ${stats.versioned}`);
    console.log(`   Prices Skipped: ${stats.skipped}`);
    console.log(`     - No base price: ${stats.noBasePrice}`);
    console.log(`     - Same price exists: ${stats.samePrice}`);
    console.log(`   Errors: ${stats.errors}`);
    console.log(`   Duration: ${duration} seconds`);
    
    // Verification
    console.log('\n📝 Verification:');
    const ClientPricesClass = Parse.Object.extend('ClientPrices');
    const verifyQuery = new Parse.Query(ClientPricesClass);
    verifyQuery.equalTo('clientPtr', client);
    verifyQuery.equalTo('exists', true);
    verifyQuery.doesNotExist('valid_until'); // Current prices only
    const currentPrices = await verifyQuery.count({ useMasterKey: true });
    
    console.log(`   Current active prices for client: ${currentPrices}`);
    
    const historyQuery = new Parse.Query(ClientPricesClass);
    historyQuery.equalTo('clientPtr', client);
    historyQuery.equalTo('exists', true);
    historyQuery.exists('valid_until'); // Historical prices
    const historicalPrices = await historyQuery.count({ useMasterKey: true });
    
    console.log(`   Historical (versioned) prices: ${historicalPrices}`);
    
    console.log('\n💡 Notes:');
    console.log('   - Prices are created with versioning support');
    console.log('   - Previous prices are preserved with valid_until date');
    console.log('   - Only combinations with base prices in RatePrices are created');
    console.log('   - Use valid_until = null to query current prices');
    console.log('   - Use valid_until != null to query historical prices');
    
    rl.close();
    
  } catch (error) {
    console.error('❌ Script execution failed:', error.message);
    console.error('Stack trace:', error.stack);
    rl.close();
    process.exit(1);
  }
}

// Run the script
main().then(() => {
  console.log('\n✨ Script finished successfully!');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Fatal error:', error);
  rl.close();
  process.exit(1);
});