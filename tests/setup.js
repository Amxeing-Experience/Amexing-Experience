/**
 * Test Setup Configuration
 * Sets up test environment for Parse Server and database testing
 */

const { ParseServer } = require('parse-server');
const Parse = require('parse/node');
const express = require('express');
const http = require('http');

// Test configuration
const testConfig = {
  databaseURI: process.env.TEST_DATABASE_URI || 'mongodb://localhost:27017/AmexingTEST',
  appId: 'test-app-id',
  masterKey: 'test-master-key',
  serverURL: 'http://localhost:1338/parse',
  port: 1338,
  silent: true,
  logLevel: 'error',
  maxUploadSize: '1mb',
};

let parseServer;
let httpServer;

/**
 * Setup test environment before running tests
 */
const setupTests = async () => {
  try {
    // Create Express app for Parse Server
    const app = express();

    // Initialize Parse Server for testing
    parseServer = new ParseServer(testConfig);
    await parseServer.start();

    // Mount Parse Server API
    app.use('/parse', parseServer.app);

    // Start HTTP server
    httpServer = http.createServer(app);

    await new Promise((resolve, reject) => {
      httpServer.listen(testConfig.port, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    // Initialize Parse SDK
    Parse.initialize(testConfig.appId, null, testConfig.masterKey);
    Parse.serverURL = testConfig.serverURL;

    // Wait a bit for Parse Server to be fully ready
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('Test environment setup complete');
    console.log(`Parse Server running at: ${testConfig.serverURL}`);
    return parseServer;
  } catch (error) {
    console.error('Failed to setup test environment:', error);
    throw error;
  }
};

/**
 * Cleanup test environment after tests
 */
const teardownTests = async () => {
  try {
    if (httpServer) {
      await new Promise((resolve) => {
        httpServer.close((error) => {
          if (error) console.warn('HTTP server close error:', error.message);
          resolve();
        });
      });
      httpServer = null;
    }
    if (parseServer) {
      try {
        await parseServer.handleShutdown();
      } catch (error) {
        console.warn('Parse server shutdown error:', error.message);
      }
      parseServer = null;
    }
    console.log('Test environment cleaned up');
  } catch (error) {
    console.error('Failed to cleanup test environment:', error);
  }
};

/**
 * Clear test database
 */
const clearDatabase = async () => {
  try {
    const schemas = await Parse.Schema.all();
    
    for (const schema of schemas) {
      if (schema.className.startsWith('_')) continue; // Skip system classes
      
      const query = new Parse.Query(schema.className);
      const objects = await query.find({ useMasterKey: true });
      
      if (objects.length > 0) {
        await Parse.Object.destroyAll(objects, { useMasterKey: true });
      }
    }
    
    console.log('Test database cleared');
  } catch (error) {
    console.error('Failed to clear test database:', error);
  }
};

module.exports = {
  setupTests,
  teardownTests,
  clearDatabase,
  testConfig,
};