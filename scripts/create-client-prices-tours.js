/**
 * Script: Create Client Prices for All Tours
 * Creates ClientPrices records for a specific client with all Tours and available TourPrices
 * Supports version history (valid_until field for historical prices)
 * 
 * Usage:
 * node scripts/create-client-prices-tours.js
 * NODE_ENV=production node scripts/create-client-prices-tours.js
 * 
 * Features:
 * - Creates prices for ALL Tours in the database
 * - Creates prices for ALL TourPrices combinations (Tour/Rate/VehicleType)
 * - Supports price versioning (historical tracking)
 * - Handles existing prices by versioning them
 * - Configurable markup percentage
 * - Works in both development and production environments
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
 * Get all active Tours
 */
async function getAllTours() {
  const TourClass = Parse.Object.extend('Tour');
  const query = new Parse.Query(TourClass);
  query.equalTo('exists', true);
  query.equalTo('active', true);
  query.include(['destinationPOI']);
  query.limit(1000);
  
  return await query.find({ useMasterKey: true });
}

/**
 * Get all active TourPrices
 */
async function getAllTourPrices() {
  const TourPricesClass = Parse.Object.extend('TourPrices');
  const query = new Parse.Query(TourPricesClass);
  query.equalTo('exists', true);
  query.equalTo('active', true);
  query.doesNotExist('valid_until'); // Current prices only
  query.include(['tourPtr', 'ratePtr', 'vehicleType']);
  query.limit(10000);
  
  return await query.find({ useMasterKey: true });
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
 * Create or update ClientPrice for Tour with versioning
 */
async function createTourClientPrice(client, tourPrice, markupPercentage) {
  const ClientPricesClass = Parse.Object.extend('ClientPrices');
  
  const tour = tourPrice.get('tourPtr');
  const rate = tourPrice.get('ratePtr'); 
  const vehicleType = tourPrice.get('vehicleType');
  
  if (!tour || !rate || !vehicleType) {
    return { created: false, skipped: true, reason: 'missing_pointers' };
  }
  
  // Check if price already exists (current version)
  const existingQuery = new Parse.Query(ClientPricesClass);
  existingQuery.equalTo('clientPtr', client);
  existingQuery.equalTo('itemType', 'TOUR'); // Use singular to match ToursController
  existingQuery.equalTo('itemId', tour.id);
  existingQuery.equalTo('ratePtr', rate);
  existingQuery.equalTo('vehiclePtr', vehicleType);
  existingQuery.equalTo('exists', true);
  existingQuery.doesNotExist('valid_until'); // Current price (no expiration)
  
  const existing = await existingQuery.first({ useMasterKey: true });
  
  // Get base price from TourPrices
  const basePrice = tourPrice.get('price');
  
  if (!basePrice || basePrice <= 0) {
    return { created: false, skipped: true, reason: 'invalid_base_price' };
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
  newPrice.set('itemType', 'TOUR'); // Use singular to match ToursController
  newPrice.set('itemId', tour.id);
  newPrice.set('ratePtr', rate);
  newPrice.set('vehiclePtr', vehicleType);
  newPrice.set('precio', markedUpPrice);
  newPrice.set('basePrice', basePrice);
  newPrice.set('currency', tourPrice.get('currency') || 'MXN');
  newPrice.set('active', true);
  newPrice.set('exists', true);
  // Don't set valid_until for current prices - Parse treats unset differently than null
  newPrice.set('createdBy', 'bulk_tours_script');
  newPrice.set('notes', `Tour price created with ${markupPercentage}% markup from base price`);
  
  await newPrice.save(null, { useMasterKey: true });
  
  return { 
    created: true, 
    versioned: existing ? true : false,
    basePrice,
    markedUpPrice,
    tour: tour.id,
    rate: rate.get('name'),
    vehicle: vehicleType.get('name')
  };
}

/**
 * Main function to create tour client prices
 */
async function main() {
  try {
    console.log('🚀 Tour Client Prices Bulk Creation Script');
    console.log('==========================================\n');
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Parse Server: ${Parse.serverURL}\n`);
    
    // 1. Get client information
    const clientIdentifier = await askQuestion('Enter client email or company name: ');
    console.log('🔍 Searching for client...');
    
    const client = await findClient(clientIdentifier.trim());
    if (!client) {
      console.log('❌ Client not found');
      rl.close();
      return;
    }
    
    const companyName = client.get('contextualData')?.companyName || 'Unknown';
    console.log(`✅ Found client: ${client.get('email')} - ${companyName}\n`);
    
    // 2. Get markup percentage
    const markupInput = await askQuestion(`Enter markup percentage (default ${DEFAULT_MARKUP_PERCENTAGE}%): `);
    const markupPercentage = parseFloat(markupInput.trim()) || DEFAULT_MARKUP_PERCENTAGE;
    console.log(`📊 Using ${markupPercentage}% markup\n`);
    
    // 3. Check existing tour prices for this client
    const ClientPricesClass = Parse.Object.extend('ClientPrices');
    const existingQuery = new Parse.Query(ClientPricesClass);
    existingQuery.equalTo('clientPtr', client);
    existingQuery.equalTo('itemType', 'TOUR'); // Use singular to match ToursController
    existingQuery.equalTo('exists', true);
    const existingCount = await existingQuery.count({ useMasterKey: true });
    
    if (existingCount > 0) {
      console.log(`⚠️  Client already has ${existingCount} existing tour prices`);
      const continueAnswer = await askQuestion('Continue? This will version existing prices and create new ones (y/N): ');
      if (!continueAnswer.toLowerCase().startsWith('y')) {
        console.log('❌ Operation cancelled');
        rl.close();
        return;
      }
    }
    
    // 4. Load tour data
    console.log('📋 Loading tour data...');
    
    const tours = await getAllTours();
    console.log(`✅ Found ${tours.length} active tours`);
    
    const tourPrices = await getAllTourPrices();
    console.log(`✅ Found ${tourPrices.length} active tour prices\n`);
    
    if (tourPrices.length === 0) {
      console.log('❌ No tour prices found. Cannot create client prices without base prices.');
      rl.close();
      return;
    }
    
    // 5. Confirm and proceed
    console.log(`📊 Ready to create client prices for ${tourPrices.length} tour price combinations`);
    const confirmAnswer = await askQuestion('Proceed? (y/N): ');
    if (!confirmAnswer.toLowerCase().startsWith('y')) {
      console.log('❌ Operation cancelled');
      rl.close();
      return;
    }
    
    console.log('\n🔄 Creating client prices...\n');
    
    // 6. Process tour prices in batches
    const stats = {
      created: 0,
      versioned: 0,
      skipped: 0,
      errors: 0,
      samples: []
    };
    
    let processed = 0;
    for (let i = 0; i < tourPrices.length; i += BATCH_SIZE) {
      const batch = tourPrices.slice(i, i + BATCH_SIZE);
      
      for (const tourPrice of batch) {
        try {
          processed++;
          
          if (processed % 10 === 0) {
            console.log(`Progress: ${processed}/${tourPrices.length} (Created: ${stats.created}, Versioned: ${stats.versioned}, Skipped: ${stats.skipped})`);
          }
          
          const result = await createTourClientPrice(client, tourPrice, markupPercentage);
          
          if (result.created) {
            stats.created++;
            if (result.versioned) stats.versioned++;
            
            // Save sample for display
            if (stats.samples.length < 5) {
              const tour = tourPrice.get('tourPtr');
              const destination = tour.get('destinationPOI')?.get('name') || 'N/A';
              stats.samples.push({
                destination,
                rate: result.rate,
                vehicle: result.vehicle,
                basePrice: result.basePrice,
                markedUpPrice: result.markedUpPrice,
                increase: result.markedUpPrice - result.basePrice
              });
            }
          } else {
            stats.skipped++;
          }
          
        } catch (error) {
          stats.errors++;
          console.error(`❌ Error processing tour price: ${error.message}`);
        }
      }
    }
    
    // 7. Display results
    console.log('\n✅ Tour client prices creation completed!\n');
    console.log('📊 Results:');
    console.log(`   Prices created: ${stats.created}`);
    console.log(`   Prices versioned: ${stats.versioned}`);
    console.log(`   Skipped: ${stats.skipped}`);
    console.log(`   Errors: ${stats.errors}`);
    
    if (stats.samples.length > 0) {
      console.log('\n📝 Sample Prices Created:');
      stats.samples.forEach(sample => {
        console.log(`\n   Destination: ${sample.destination}`);
        console.log(`   Rate: ${sample.rate}, Vehicle: ${sample.vehicle}`);
        console.log(`   Base Price: $${sample.basePrice} MXN`);
        console.log(`   Client Price: $${sample.markedUpPrice} MXN`);
        console.log(`   Increase: $${sample.increase} MXN (+${markupPercentage}%)`);
      });
    }
    
    // 8. Final verification
    console.log('\n📋 Final Verification:');
    
    const finalQuery = new Parse.Query(ClientPricesClass);
    finalQuery.equalTo('clientPtr', client);
    finalQuery.equalTo('itemType', 'TOUR'); // Use singular to match ToursController
    finalQuery.equalTo('exists', true);
    finalQuery.doesNotExist('valid_until'); // Current prices only
    const finalCount = await finalQuery.count({ useMasterKey: true });
    
    console.log(`   Total current tour prices for client: ${finalCount}`);
    
    const historyQuery = new Parse.Query(ClientPricesClass);
    historyQuery.equalTo('clientPtr', client);
    historyQuery.equalTo('itemType', 'TOUR'); // Use singular to match ToursController
    historyQuery.equalTo('exists', true);
    historyQuery.exists('valid_until'); // Historical prices
    const historyCount = await historyQuery.count({ useMasterKey: true });
    
    console.log(`   Total historical tour prices: ${historyCount}`);
    
    console.log('\n💡 Notes:');
    console.log('   - Tour prices support versioning (old prices preserved with valid_until date)');
    console.log('   - ItemType set to "TOUR" (singular) to match ToursController');
    console.log('   - Prices applied markup to base TourPrices');
    
  } catch (error) {
    console.error('❌ Script failed:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    rl.close();
  }
}

// Run the script
main().then(() => {
  console.log('\n✨ Script finished successfully!');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});