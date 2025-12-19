/**
 * Seed ExchangeRate Initial Data
 * 
 * Creates the initial exchange rate record with value 18.50
 * 
 * Created by Denisse Maldonado
 */

const Parse = require('parse/node');
require('dotenv').config({ path: './environments/.env.development' });

// Initialize Parse
Parse.initialize(
  process.env.PARSE_APP_ID,
  process.env.PARSE_JAVASCRIPT_KEY,
  process.env.PARSE_MASTER_KEY
);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

const ExchangeRate = require('../../src/domain/models/ExchangeRate');

/**
 * Seed initial exchange rate data
 */
async function seedExchangeRate() {
  try {
    console.log('🌱 Starting ExchangeRate seeding...');

    // Check if exchange rate already exists
    const existingRate = await ExchangeRate.getCurrentExchangeRate();
    if (existingRate) {
      console.log(`✅ Exchange rate already exists with value: ${existingRate.get('value')}`);
      return;
    }

    // Create initial exchange rate
    const initialRate = await ExchangeRate.createExchangeRate({
      value: 18.50,
      description: 'Initial exchange rate setup',
      createdBy: null // System created
    });

    console.log(`✅ Created initial exchange rate: ${initialRate.get('value')}`);
    console.log(`🆔 Exchange rate ID: ${initialRate.id}`);
    console.log(`📅 Created at: ${initialRate.get('createdAt')}`);

    console.log('🌱 ExchangeRate seeding completed successfully!');

  } catch (error) {
    console.error('❌ Error seeding exchange rate:', error);
    process.exit(1);
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    await seedExchangeRate();
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed script failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { seedExchangeRate };