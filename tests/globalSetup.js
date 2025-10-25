/**
 * Jest Global Setup
 * Runs once before all tests
 *
 * This setup:
 * 1. Starts MongoDB Memory Server
 * 2. Initializes Parse Server with Memory DB
 * 3. Seeds complete RBAC system (roles, permissions, users)
 * 4. Verifies seed data integrity
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const Parse = require('parse/node');
const TestDatabaseSeeder = require('./helpers/testDatabaseSeeder');

/**
 * Initialize Parse Server instance
 */
async function initializeParseServer(uri) {
  try {
    const { ParseServer } = require('parse-server');
    const express = require('express');
    const http = require('http');

    // Parse Server configuration
    const parseConfig = {
      databaseURI: uri,
      appId: 'test-app-id',
      masterKey: 'test-master-key',
      serverURL: 'http://localhost:1339/parse',
      silent: true,
      logLevel: 'error',
      maxUploadSize: '1mb',
    };

    // Create Express app
    const app = express();

    // Initialize Parse Server
    const parseServer = new ParseServer(parseConfig);
    await parseServer.start();

    // Mount Parse Server API
    app.use('/parse', parseServer.app);

    // Start HTTP server
    const httpServer = http.createServer(app);

    await new Promise((resolve, reject) => {
      httpServer.listen(1339, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    // Store server instances globally for teardown
    global.__PARSE_SERVER__ = parseServer;
    global.__HTTP_SERVER__ = httpServer;

    // Initialize Parse SDK
    Parse.initialize('test-app-id', null, 'test-master-key');
    Parse.serverURL = 'http://localhost:1339/parse';

    console.log('   ✅ Parse Server started');
    console.log(`   ℹ️  Server URL: ${Parse.serverURL}`);

    // Wait for Parse Server to be fully ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    return true;
  } catch (error) {
    console.error('   ❌ Failed to initialize Parse Server:', error.message);
    throw error;
  }
}

module.exports = async () => {
  console.log('\n🚀 Starting Global Test Setup...\n');

  try {
    // ALWAYS use Memory Server for tests (even if TEST_DATABASE_URI is set)
    console.log('📦 Starting MongoDB Memory Server...');

    const mongod = new MongoMemoryServer({
      instance: {
        dbName: 'AmexingTEST',
        port: 27018, // Different port to avoid conflicts
      },
    });

    await mongod.start();
    const uri = mongod.getUri();

    // Store MongoDB instance and URI in global for cleanup
    global.__MONGOD__ = mongod;
    global.__MONGO_URI__ = uri;

    // Set database URI for tests (override any existing configuration)
    process.env.TEST_DATABASE_URI = uri;
    process.env.DATABASE_URI = uri;

    console.log('   ✅ MongoDB Memory Server started');
    console.log(`   ℹ️  URI: ${uri}`);

    // Initialize Parse Server with Memory DB
    console.log('\n🔧 Initializing Parse Server...');
    await initializeParseServer(uri);

    // Seed Database with complete RBAC system
    console.log('\n🌱 Seeding Test Database...');
    const seeder = new TestDatabaseSeeder();
    await seeder.seedCompleteSystem();

    console.log('\n✅ Global Test Setup Complete\n');
    console.log('=' .repeat(60));
    console.log('Test environment ready with:');
    console.log('  - MongoDB Memory Server (in-memory)');
    console.log('  - Parse Server configured');
    console.log('  - Complete RBAC system (8 roles + permissions)');
    console.log('  - Test users for all roles');
    console.log('=' .repeat(60) + '\n');
  } catch (error) {
    console.error('\n❌ Global Test Setup Failed:', error.message);
    console.error(error.stack);

    // Cleanup if setup failed
    if (global.__MONGOD__) {
      try {
        await global.__MONGOD__.stop();
      } catch (cleanupError) {
        console.error('   ❌ Failed to cleanup MongoDB:', cleanupError.message);
      }
    }

    process.exit(1);
  }
};