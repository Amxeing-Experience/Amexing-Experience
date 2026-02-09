#!/usr/bin/env node

/**
 * Standalone Script - Insert Vehicle Rate Prices to Production
 * 
 * This script directly inserts vehicle rate prices into the production database
 * without using the seed system. It connects to the production Parse Server
 * and creates the pricing records.
 * 
 * Usage: NODE_ENV=production node scripts/production-vehicle-rates.js
 * 
 * Created by Denisse Maldonado
 */

require('dotenv').config({ path: `environments/.env.${process.env.NODE_ENV || 'production'}` });
const Parse = require('parse/node');
const logger = require('../src/infrastructure/logger');

// Initialize Parse
Parse.initialize(
  process.env.PARSE_APP_ID || 'amexing-app-id',
  process.env.PARSE_JAVASCRIPT_KEY,
  process.env.PARSE_MASTER_KEY || 'AmexingMasterKey2024!@#$%^&*()'
);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1338/parse';

// Base hourly prices for each vehicle type (in MXN)
const BASE_PRICES = {
  'SEDAN': 800,
  'VAN': 1200,
  'SUBURBAN': 1500,
  'SPRINTER': 2000,
  'MODEL 3': 1800,
  'MODEL Y': 2200
};

// Rate markups
const RATE_MARKUPS = {
  'First Class': 1.01,     // 1% markup
  'Económico': 1.05,        // 5% markup
  'Green Class': 1.10,      // 10% markup
  'Premium': 1.20           // 20% markup
};

/**
 * Generate pricing data for all combinations
 */
function generatePricingData(rates, vehicleTypes) {
  const pricingData = [];
  const now = new Date();
  
  for (const rate of rates) {
    for (const vehicleType of vehicleTypes) {
      const basePrice = BASE_PRICES[vehicleType.get('code')] || 1000;
      const markup = RATE_MARKUPS[rate.get('name')] || 1.0;
      const finalPrice = Math.round(basePrice * markup);
      
      pricingData.push({
        rateId: rate.id,
        vehicleTypeId: vehicleType.id,
        pricePerHour: finalPrice,
        currency: 'MXN',
        valid_from: now,
        created_by: 'production_script',
        reason_for_change: 'Production data insertion',
        active: true,
        exists: true
      });
    }
  }
  
  return pricingData;
}

/**
 * Main function to insert vehicle rate prices
 */
async function insertVehicleRatePrices() {
  const startTime = Date.now();
  
  try {
    console.log('\n========================================');
    console.log('🚀 PRODUCTION Vehicle Rate Prices Insertion');
    console.log('========================================');
    console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
    console.log(`Server: ${Parse.serverURL}`);
    console.log(`Time: ${new Date().toISOString()}\n`);
    
    // Verify we're in production
    if (process.env.NODE_ENV !== 'production') {
      console.log('⚠️  WARNING: Not in production environment!');
      console.log('Run with: NODE_ENV=production node scripts/production-vehicle-rates.js');
      
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      await new Promise((resolve) => {
        rl.question('Do you want to continue anyway? (yes/no): ', (answer) => {
          rl.close();
          if (answer.toLowerCase() !== 'yes') {
            console.log('Aborting...');
            process.exit(0);
          }
          resolve();
        });
      });
    }
    
    // Fetch all rates
    console.log('📊 Fetching rates...');
    const rateQuery = new Parse.Query('Rate');
    rateQuery.equalTo('exists', true);
    rateQuery.equalTo('active', true);
    const rates = await rateQuery.find({ useMasterKey: true });
    
    if (rates.length === 0) {
      throw new Error('❌ No rates found in database. Please ensure rates exist first.');
    }
    
    console.log(`✅ Found ${rates.length} rates:`, rates.map(r => r.get('name')).join(', '));
    
    // Fetch all vehicle types
    console.log('\n🚗 Fetching vehicle types...');
    const vehicleQuery = new Parse.Query('VehicleType');
    vehicleQuery.equalTo('exists', true);
    vehicleQuery.equalTo('active', true);
    const vehicleTypes = await vehicleQuery.find({ useMasterKey: true });
    
    if (vehicleTypes.length === 0) {
      throw new Error('❌ No vehicle types found. Please ensure vehicle types exist first.');
    }
    
    console.log(`✅ Found ${vehicleTypes.length} vehicle types:`, vehicleTypes.map(v => v.get('code')).join(', '));
    
    // Check if prices already exist
    console.log('\n🔍 Checking existing prices...');
    const existingQuery = new Parse.Query('VehicleRatePrices');
    existingQuery.doesNotExist('valid_until');
    existingQuery.equalTo('exists', true);
    const existingCount = await existingQuery.count({ useMasterKey: true });
    
    if (existingCount > 0) {
      console.log(`⚠️  WARNING: Found ${existingCount} existing active prices.`);
      
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      await new Promise((resolve) => {
        rl.question('Do you want to DELETE existing prices and insert new ones? (yes/no): ', async (answer) => {
          rl.close();
          if (answer.toLowerCase() === 'yes') {
            console.log('🗑️  Deleting existing prices...');
            const existingPrices = await existingQuery.find({ useMasterKey: true });
            
            // Mark existing prices as deleted (logical deletion)
            for (const price of existingPrices) {
              price.set('exists', false);
              price.set('valid_until', new Date());
            }
            
            await Parse.Object.saveAll(existingPrices, { useMasterKey: true });
            console.log(`✅ Marked ${existingPrices.length} existing prices as deleted`);
          } else {
            console.log('❌ Aborting to avoid duplicates.');
            process.exit(0);
          }
          resolve();
        });
      });
    }
    
    // Generate pricing data
    console.log('\n💰 Generating pricing data...');
    const pricingData = generatePricingData(rates, vehicleTypes);
    console.log(`✅ Generated ${pricingData.length} price records`);
    
    // Display price summary
    console.log('\n📋 Price Summary:');
    console.log('================');
    for (const rate of rates) {
      console.log(`\n${rate.get('name')}:`);
      for (const vehicleType of vehicleTypes) {
        const price = pricingData.find(p => 
          p.rateId === rate.id && p.vehicleTypeId === vehicleType.id
        );
        if (price) {
          console.log(`  ${vehicleType.get('code')}: $${price.pricePerHour} MXN/hour`);
        }
      }
    }
    
    // Confirm insertion
    console.log('\n⚠️  FINAL CONFIRMATION');
    console.log('=====================');
    console.log(`You are about to insert ${pricingData.length} price records into PRODUCTION.`);
    
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    await new Promise((resolve) => {
      rl.question('Type "CONFIRM" to proceed: ', (answer) => {
        rl.close();
        if (answer !== 'CONFIRM') {
          console.log('❌ Insertion cancelled.');
          process.exit(0);
        }
        resolve();
      });
    });
    
    // Create price records
    console.log('\n📝 Creating price records...');
    const VehicleRatePrices = Parse.Object.extend('VehicleRatePrices');
    const priceObjects = pricingData.map(data => {
      const price = new VehicleRatePrices();
      
      // Set all fields
      Object.keys(data).forEach(key => {
        if (data[key] !== undefined) {
          price.set(key, data[key]);
        }
      });
      
      return price;
    });
    
    // Save in batches of 50
    const batchSize = 50;
    let totalCreated = 0;
    
    for (let i = 0; i < priceObjects.length; i += batchSize) {
      const batch = priceObjects.slice(i, i + batchSize);
      await Parse.Object.saveAll(batch, { useMasterKey: true });
      totalCreated += batch.length;
      
      const progress = Math.round((totalCreated / priceObjects.length) * 100);
      console.log(`⏳ Progress: ${totalCreated}/${priceObjects.length} (${progress}%)`);
    }
    
    // Verify insertion
    console.log('\n✅ Verifying insertion...');
    const verifyQuery = new Parse.Query('VehicleRatePrices');
    verifyQuery.doesNotExist('valid_until');
    verifyQuery.equalTo('exists', true);
    verifyQuery.equalTo('created_by', 'production_script');
    const verifiedCount = await verifyQuery.count({ useMasterKey: true });
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n========================================');
    console.log('✅ SUCCESS!');
    console.log('========================================');
    console.log(`📊 Created: ${totalCreated} price records`);
    console.log(`✓ Verified: ${verifiedCount} records in database`);
    console.log(`⏱️  Duration: ${duration} seconds`);
    console.log(`📅 Timestamp: ${new Date().toISOString()}`);
    console.log('========================================\n');
    
    // Log to application logger
    logger.info('Production vehicle rate prices inserted successfully', {
      created: totalCreated,
      verified: verifiedCount,
      duration: `${duration}s`,
      environment: process.env.NODE_ENV
    });
    
    process.exit(0);
    
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.error('\n========================================');
    console.error('❌ ERROR!');
    console.error('========================================');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error(`Duration: ${duration}s`);
    console.error('========================================\n');
    
    // Log to application logger
    logger.error('Failed to insert production vehicle rate prices', {
      error: error.message,
      stack: error.stack,
      duration: `${duration}s`,
      environment: process.env.NODE_ENV
    });
    
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  insertVehicleRatePrices();
}

module.exports = insertVehicleRatePrices;