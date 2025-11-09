/**
 * Cloud Functions Test Setup
 * Loads and registers cloud functions for testing
 */

const Parse = require('parse/node');

// Load cloud function modules
const helloWorldFunction = require('../../../src/cloud/functions/helloWorld');
const testFunction = require('../../../src/cloud/functions/test');

/**
 * Register cloud functions for testing
 * This simulates the cloud function registration that happens in main.js
 */
function registerCloudFunctionsForTesting() {
  // Only register if Parse.Cloud is available and not already registered
  if (typeof Parse.Cloud !== 'undefined' && typeof Parse.Cloud.define === 'function') {
    try {
      // Register basic test functions
      Parse.Cloud.define('hello', helloWorldFunction);
      Parse.Cloud.define('test', testFunction);

      console.log('✅ Basic cloud functions registered for testing');
      return true;
    } catch (error) {
      console.warn('⚠️  Cloud function registration failed:', error.message);
      return false;
    }
  } else {
    console.warn('⚠️  Parse.Cloud not available for function registration');
    return false;
  }
}

/**
 * Check if cloud functions are properly registered
 */
async function validateCloudFunctionRegistration() {
  try {
    // Test basic function calls
    const helloResult = await Parse.Cloud.run('hello', {});
    const testResult = await Parse.Cloud.run('test', { validation: true });

    if (helloResult && testResult) {
      console.log('✅ Cloud function validation successful');
      return true;
    } else {
      console.warn('⚠️  Cloud function validation failed - functions not responding correctly');
      return false;
    }
  } catch (error) {
    console.warn('⚠️  Cloud function validation failed:', error.message);
    return false;
  }
}

/**
 * Mock cloud functions for testing when server functions are not available
 */
function mockCloudFunctions() {
  // Mock Parse.Cloud.run for basic functions
  const originalRun = Parse.Cloud.run;

  Parse.Cloud.run = async function(functionName, params = {}) {
    switch (functionName) {
      case 'hello':
        return await helloWorldFunction({ params: params || {}, user: null, headers: {} });

      case 'test':
        return await testFunction({ params: params || {} });

      default:
        // For other functions, throw an error indicating they're not available
        throw new Parse.Error(Parse.Error.INVALID_FUNCTION_NAME, `Cloud function ${functionName} not available in test environment`);
    }
  };

  console.log('✅ Cloud functions mocked for testing');
  return originalRun;
}

module.exports = {
  registerCloudFunctionsForTesting,
  validateCloudFunctionRegistration,
  mockCloudFunctions
};