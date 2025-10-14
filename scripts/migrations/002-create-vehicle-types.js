/**
 * Migration: Create VehicleType table and seed with initial data
 *
 * This migration:
 * 1. Creates the VehicleType Parse Server class
 * 2. Configures class-level permissions (CLP)
 * 3. Creates necessary indexes
 * 4. Seeds initial vehicle types (Sedan, SUV, Van, Bus, Limousine)
 *
 * Dependencies: Parse Server, MongoDB
 *
 * Usage:
 *   node scripts/migrations/002-create-vehicle-types.js
 */

// Load environment variables
require('dotenv').config({ path: require('path').join(__dirname, '../../environments/.env.development') });

const Parse = require('parse/node');
const fs = require('fs');
const path = require('path');

// Parse Server configuration
const PARSE_SERVER_URL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';
const PARSE_APP_ID = process.env.PARSE_APP_ID || 'amexing-dev';
const PARSE_MASTER_KEY = process.env.PARSE_MASTER_KEY;

// Initialize Parse
Parse.initialize(PARSE_APP_ID);
Parse.serverURL = PARSE_SERVER_URL;
Parse.masterKey = PARSE_MASTER_KEY;

/**
 * Create VehicleType class with schema
 */
async function createVehicleTypeClass() {
  console.log('\n📦 Creating VehicleType class...');

  const schema = new Parse.Schema('VehicleType');

  // Define fields
  schema.addString('name', { required: true })
        .addString('code', { required: true })
        .addString('description')
        .addString('icon', { defaultValue: 'car' })
        .addNumber('defaultCapacity', { defaultValue: 4 })
        .addNumber('sortOrder', { defaultValue: 0 })
        .addBoolean('active', { defaultValue: true })
        .addBoolean('exists', { defaultValue: true });

  // Set Class Level Permissions (CLP)
  schema.setCLP({
    find: { '*': true }, // Public read for active types
    get: { '*': true },
    count: { '*': true },
    create: { 'role:admin': true, 'role:superadmin': true },
    update: { 'role:admin': true, 'role:superadmin': true },
    delete: { 'role:superadmin': true },
    addField: { 'role:superadmin': true }
  });

  try {
    await schema.save();
    console.log('✅ VehicleType class created successfully');
  } catch (error) {
    if (error.code === 103) {
      console.log('⚠️  VehicleType class already exists, updating schema...');
      await schema.update();
      console.log('✅ VehicleType class updated successfully');
    } else {
      throw error;
    }
  }
}

/**
 * Create indexes for VehicleType
 */
async function createIndexes() {
  console.log('\n🔍 Creating indexes...');

  try {
    // Get direct MongoDB connection
    const config = {
      databaseURI: process.env.DATABASE_URI || 'mongodb://localhost:27017/amexing-dev'
    };

    const { MongoClient } = require('mongodb');
    const client = new MongoClient(config.databaseURI);

    await client.connect();
    const db = client.db();
    const collection = db.collection('VehicleType');

    // Create indexes
    await collection.createIndex({ code: 1 }, { unique: true, name: 'code_unique' });
    await collection.createIndex({ active: 1, exists: 1 }, { name: 'active_exists' });
    await collection.createIndex({ sortOrder: 1, active: 1 }, { name: 'sort_active' });

    console.log('✅ Indexes created successfully');

    await client.close();
  } catch (error) {
    console.error('❌ Error creating indexes:', error.message);
    // Non-fatal error, continue with seeding
  }
}

/**
 * Seed initial vehicle types
 */
async function seedVehicleTypes() {
  console.log('\n🌱 Seeding vehicle types...');

  // Load seed data
  const seedPath = path.join(__dirname, '../../seeds/vehicleTypes.json');
  const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  let created = 0;
  let existing = 0;

  for (const typeData of seedData) {
    try {
      // Check if type already exists
      const query = new Parse.Query('VehicleType');
      query.equalTo('code', typeData.code);
      const existingType = await query.first({ useMasterKey: true });

      if (existingType) {
        console.log(`   ⚠️  Type "${typeData.name}" (${typeData.code}) already exists, skipping...`);
        existing++;
        continue;
      }

      // Create new vehicle type
      const VehicleType = Parse.Object.extend('VehicleType');
      const vehicleType = new VehicleType();

      vehicleType.set('name', typeData.name);
      vehicleType.set('code', typeData.code);
      vehicleType.set('description', typeData.description);
      vehicleType.set('icon', typeData.icon);
      vehicleType.set('defaultCapacity', typeData.defaultCapacity);
      vehicleType.set('sortOrder', typeData.sortOrder);
      vehicleType.set('active', typeData.active);
      vehicleType.set('exists', typeData.exists);

      // Set ACL
      const acl = new Parse.ACL();
      acl.setPublicReadAccess(true); // Public read for types
      acl.setRoleWriteAccess('admin', true);
      acl.setRoleWriteAccess('superadmin', true);
      vehicleType.setACL(acl);

      await vehicleType.save(null, { useMasterKey: true });

      console.log(`   ✅ Created type: ${typeData.name} (${typeData.code})`);
      created++;

    } catch (error) {
      console.error(`   ❌ Error creating type "${typeData.name}":`, error.message);
    }
  }

  console.log(`\n📊 Seeding complete: ${created} created, ${existing} already existed`);
}

/**
 * Run migration
 */
async function runMigration() {
  console.log('🚀 Starting VehicleType migration...');
  console.log(`   Server: ${PARSE_SERVER_URL}`);
  console.log(`   App ID: ${PARSE_APP_ID}`);

  try {
    await createVehicleTypeClass();
    await createIndexes();
    await seedVehicleTypes();

    console.log('\n✅ Migration completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Execute migration
runMigration();
