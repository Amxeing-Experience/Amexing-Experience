/**
 * Parse Server Initialization Module
 * Handles Parse Server instantiation, startup, and SDK configuration.
 * Provides centralized Parse Server initialization with error handling and logging.
 * @module infrastructure/server/parseServerInit
 * @author Amexing Development Team
 * @version 1.0.0
 */

const { ParseServer } = require('parse-server');
const Parse = require('parse/node');
const logger = require('../logger');
const parseServerConfig = require('../../../config/parse-server');

/**
 * Initializes Parse Server with comprehensive error handling.
 * Creates a new Parse Server instance, starts it, and configures the Parse SDK
 * for internal operations (health checks, cloud functions, etc.).
 * @async
 * @returns {Promise<ParseServer>} Initialized Parse Server instance.
 * @throws {Error} If Parse Server fails to start in production mode.
 * @example
 * const { initializeParseServer } = require('./parseServerInit');
 *
 * const parseServer = await initializeParseServer();
 * app.use('/parse', parseServer.app);
 */
const initializeParseServer = async () => {
  logger.info('Initializing Parse Server 8.2.4...');

  const parseServer = new ParseServer(parseServerConfig);

  try {
    // Start Parse Server (required in 8.2.4+)
    await parseServer.start();
    logger.info('Parse Server started successfully');

    // Initialize Parse SDK for internal use (health checks, etc.)
    Parse.initialize(parseServerConfig.appId, null, parseServerConfig.masterKey);
    Parse.serverURL = parseServerConfig.serverURL;

    logger.info('Parse SDK configured for internal operations');
    logger.info('Parse Server initialization completed - cloud functions loaded');

    return parseServer;
  } catch (error) {
    logger.error('Failed to start Parse Server:', error.message);
    logger.error('Parse Server error details:', {
      name: error.name,
      code: error.code,
      stack: error.stack,
    });

    if (process.env.NODE_ENV === 'production') {
      logger.error('Exiting in production due to Parse Server failure');
      throw error; // Re-throw to allow process.exit(1) in caller
    } else {
      logger.warn('Continuing in development mode without Parse Server (database may be unavailable)');
      return parseServer; // Return instance even if failed (development only)
    }
  }
};

/**
 * Handles graceful Parse Server shutdown.
 * Closes database connections and cleans up resources.
 * @param {ParseServer} parseServer - Parse Server instance to shutdown.
 * @returns {Promise<void>}
 * @example
 * const { shutdownParseServer } = require('./parseServerInit');
 *
 * process.on('SIGTERM', async () => {
 *   await shutdownParseServer(parseServer);
 *   process.exit(0);
 * });
 */
const shutdownParseServer = async (parseServer) => {
  if (!parseServer) {
    logger.warn('Parse Server instance not available for shutdown');
    return;
  }

  try {
    if (parseServer.handleShutdown) {
      logger.info('Shutting down Parse Server...');
      await parseServer.handleShutdown();
      logger.info('Parse Server shutdown complete');
    }
  } catch (error) {
    // Log but don't throw - Parse Server may have internal shutdown issues
    logger.warn('Parse Server shutdown encountered an error (non-critical):', error.message);
  }
};

module.exports = {
  initializeParseServer,
  shutdownParseServer,
};
