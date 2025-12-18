/**
 * Jest Global Teardown
 * Runs once after all tests
 *
 * This teardown:
 * 1. Cleans up MongoDB Memory Server
 * 2. Closes Parse Server connections
 * 3. Performs garbage collection
 * 4. Reports teardown statistics
 */

const Parse = require('parse/node');

module.exports = async () => {
  console.log('\n🧹 Starting Global Test Teardown...\n');

  const stats = {
    mongodbStopped: false,
    parseDisconnected: false,
    errors: []
  };

  // Don't let teardown warnings fail Jest
  let hasNonCriticalWarnings = false;

  try {
    // Close HTTP Server
    if (global.__HTTP_SERVER__) {
      try {
        console.log('   🌐 Stopping HTTP Server...');
        await new Promise((resolve) => {
          global.__HTTP_SERVER__.close(() => resolve());
        });
        delete global.__HTTP_SERVER__;
        console.log('   ✅ HTTP Server stopped');
      } catch (error) {
        console.warn('   ⚠️  HTTP Server stop warning:', error.message);
        stats.errors.push(`HTTP stop: ${error.message}`);
      }
    }

    // Close Parse Server
    if (global.__PARSE_SERVER__) {
      try {
        console.log('   🔌 Stopping Parse Server...');
        if (global.__PARSE_SERVER__ && typeof global.__PARSE_SERVER__.handleShutdown === 'function') {
          await global.__PARSE_SERVER__.handleShutdown();
        }
        delete global.__PARSE_SERVER__;
        stats.parseDisconnected = true;
        console.log('   ✅ Parse Server stopped');
      } catch (error) {
        // Don't treat teardown warnings as failures - just log them
        console.warn('   ⚠️  Parse Server stop warning:', error.message);
        stats.errors.push(`Parse stop: ${error.message}`);
        // Still mark as disconnected since we tried
        stats.parseDisconnected = true;
        // Mark as non-critical warning
        if (error.message.includes('Cannot read properties of undefined')) {
          hasNonCriticalWarnings = true;
        }
      }
    }

    // Parse SDK cleanup
    try {
      await Parse.User.logOut().catch(() => {});
    } catch (error) {
      // Ignore logout errors
    }

    // Stop in-memory MongoDB if it was started
    if (global.__MONGOD__) {
      try {
        console.log('   📦 Stopping MongoDB Memory Server...');
        await global.__MONGOD__.stop();
        stats.mongodbStopped = true;
        console.log('   ✅ MongoDB Memory Server stopped');
      } catch (error) {
        console.error('   ❌ Error stopping MongoDB:', error.message);
        stats.errors.push(`MongoDB stop: ${error.message}`);
      }
    } else {
      console.log('   ℹ️  No MongoDB instance to stop');
    }

    // Clear global references
    if (global.__MONGOD__) {
      delete global.__MONGOD__;
    }
    if (global.__MONGO_URI__) {
      delete global.__MONGO_URI__;
    }

    // Force cleanup any remaining timers/handles
    if (global.gc) {
      console.log('   🗑️  Running garbage collection...');
      global.gc();
    }

    // Report teardown statistics
    console.log('\n✅ Global Test Teardown Complete\n');
    console.log('='.repeat(60));
    console.log('Teardown Summary:');
    console.log(`  - MongoDB stopped: ${stats.mongodbStopped ? 'Yes' : 'No'}`);
    console.log(`  - Parse disconnected: ${stats.parseDisconnected ? 'Yes' : 'No'}`);
    if (stats.errors.length > 0) {
      console.log(`  - Warnings: ${stats.errors.length}`);
      stats.errors.forEach(err => console.log(`    ⚠️  ${err}`));
    }
    console.log('='.repeat(60) + '\n');
    
    // Don't fail Jest for non-critical teardown warnings
    if (hasNonCriticalWarnings && stats.errors.length > 0) {
      // All errors are non-critical warnings, don't fail
      const allNonCritical = stats.errors.every(err => 
        err.includes('Cannot read properties of undefined') || 
        err.includes('Parse stop:')
      );
      if (allNonCritical) {
        console.log('ℹ️  Teardown completed with non-critical warnings (not failing Jest)');
        return; // Don't throw
      }
    }
  } catch (error) {
    console.error('\n❌ Global Test Teardown Failed:', error.message);
    console.error(error.stack);
    // Only throw if it's a critical error, not teardown warnings
    if (!error.message.includes('Cannot read properties of undefined')) {
      throw error;
    }
  }
};