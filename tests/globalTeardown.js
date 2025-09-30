/**
 * Jest Global Teardown
 * Runs once after all tests
 */

module.exports = async () => {
  console.log('Starting global test teardown...');

  // Stop in-memory MongoDB if it was started
  if (global.__MONGOD__) {
    try {
      console.log('Stopping in-memory MongoDB...');
      await global.__MONGOD__.stop();
      console.log('In-memory MongoDB stopped');
    } catch (error) {
      console.warn('Error stopping MongoDB:', error.message);
    }
  }

  // Force cleanup any remaining timers/handles
  if (global.gc) {
    global.gc();
  }

  // Additional cleanup can go here
  console.log('Global test teardown complete');
};