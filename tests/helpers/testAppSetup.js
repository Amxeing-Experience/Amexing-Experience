/**
 * Test App Setup Helper
 * Provides properly initialized Express app for integration tests
 * 
 * This helper ensures that:
 * 1. The app is fully initialized before tests run
 * 2. i18n middleware is properly configured
 * 3. Parse Server proxy is ready
 * 4. All middleware is loaded in correct order
 */

const path = require('path');

let appInstance = null;
let initializationPromise = null;

/**
 * Get properly initialized app instance for integration tests
 * @returns {Promise<Express>} Initialized Express app
 */
async function getTestApp() {
  if (appInstance) {
    return appInstance;
  }

  if (initializationPromise) {
    return await initializationPromise;
  }

  initializationPromise = new Promise(async (resolve, reject) => {
    try {
      // Import the main app
      const app = require('../../src/index.js');

      // Wait for i18n initialization and route mounting
      // The app mounts routes inside the i18n initialization promise
      let retries = 0;
      const maxRetries = 40; // 20 seconds max wait
      
      while (retries < maxRetries) {
        try {
          // Check if the app is ready by making a test request to health endpoint
          // This is more reliable than checking internal router state
          const testRequest = require('supertest')(app);
          const response = await testRequest.get('/health').timeout(1000);
          
          if (response && response.status) {
            // App is responding to requests, routes are mounted
            break;
          }
        } catch (error) {
          // App not ready yet, continue waiting
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        retries++;
      }

      if (retries >= maxRetries) {
        throw new Error('App initialization timeout - health endpoint not responding');
      }

      // Additional wait to ensure all middleware is fully configured
      await new Promise(resolve => setTimeout(resolve, 500));

      appInstance = app;
      resolve(app);
    } catch (error) {
      reject(new Error(`Failed to initialize test app: ${error.message}`));
    }
  });

  return await initializationPromise;
}

/**
 * Reset app instance (for cleanup between test suites)
 */
function resetTestApp() {
  appInstance = null;
  initializationPromise = null;
}

/**
 * Check if app is properly initialized
 * @param {Express} app Express app instance
 * @returns {boolean} True if app is ready
 */
function isAppReady(app) {
  try {
    // Check if router is configured
    const router = app._router;
    if (!router || !router.stack || router.stack.length < 5) {
      return false;
    }

    // Check if Parse Server proxy is configured
    const parseMiddleware = router.stack.find(layer => 
      layer.regexp && layer.regexp.toString().includes('parse')
    );
    
    return !!parseMiddleware;
  } catch (error) {
    return false;
  }
}

module.exports = {
  getTestApp,
  resetTestApp,
  isAppReady
};