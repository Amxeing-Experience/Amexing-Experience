/**
 * Amexing Web Application - Main server entry point and configuration.
 * Initializes Express application with Parse Server, security middleware, routing,
 * and comprehensive application infrastructure for the Amexing platform.
 *
 * This is the primary entry point for the Amexing web application, orchestrating
 * the initialization of all core components including Parse Server, security
 * middleware, authentication systems, and routing configuration.
 *
 * Features:
 * - Express.js application server with comprehensive middleware stack
 * - Parse Server integration for backend-as-a-service functionality
 * - Parse Dashboard for administrative interface (development/optional)
 * - Multi-layered security middleware with PCI DSS compliance
 * - OAuth authentication system with multiple provider support
 * - Comprehensive routing system (web, API, auth, docs)
 * - Static file serving with production optimizations
 * - Error handling and logging infrastructure
 * - Health check and monitoring endpoints
 * - Graceful shutdown and process management
 * - Environment-specific configuration loading
 * - Production and development mode optimizations.
 * @file Main application server and initialization.
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // Start the application
 * npm start
 *
 * // Development mode with hot reloading
 * npm run dev
 *
 * // Production deployment
 * NODE_ENV=production npm start
 *
 * // Environment variables
 * PORT=3000 NODE_ENV=production npm start
 */

require('dotenv').config({
  path: `./environments/.env.${process.env.NODE_ENV || 'development'}`,
});

const express = require('express');
const path = require('path');
const { ParseServer } = require('parse-server');
const ParseDashboard = require('parse-dashboard');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');

const logger = require('./infrastructure/logger');
const securityMiddleware = require('./infrastructure/security/securityMiddleware');
const parseServerConfig = require('../config/parse-server');
const parseDashboardConfig = require('../config/parse-dashboard');
const webRoutes = require('./presentation/routes/webRoutes');
const apiRoutes = require('./presentation/routes/apiRoutes');
const authRoutes = require('./presentation/routes/authRoutes');
const docsRoutes = require('./presentation/routes/docsRoutes');
const errorHandler = require('./application/middleware/errorHandler');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 1337;
const DASHBOARD_PORT = process.env.DASHBOARD_PORT || 4040;

// Trust proxy in production
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// View engine setup
app.set('views', path.join(__dirname, 'presentation', 'views'));
app.set('view engine', 'ejs');

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(methodOverride('_method'));

// Compression middleware
app.use(compression());

// Static files
app.use(
  '/public',
  express.static(path.join(__dirname, 'presentation', 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  })
);

// Initialize Parse Server
const parseServer = new ParseServer(parseServerConfig);

// Start Parse Server (graceful failure in development)
(async () => {
  try {
    await parseServer.start();
    logger.info('Parse Server initialized successfully');

    // Initialize Parse SDK for internal use (health checks, etc.)
    const Parse = require('parse/node');
    Parse.initialize(
      parseServerConfig.appId,
      null,
      parseServerConfig.masterKey
    );
    Parse.serverURL = parseServerConfig.serverURL;

    logger.info('Parse SDK initialized for internal operations');
  } catch (error) {
    logger.error('Failed to initialize Parse Server:', error);

    if (process.env.NODE_ENV === 'production') {
      logger.error('Exiting in production due to Parse Server failure');
      process.exit(1);
    } else {
      logger.warn(
        'Continuing in development mode without Parse Server (database may be unavailable)'
      );
      // Don't exit in development, allow app to start for other endpoints
    }
  }
})();

// Mount Parse Server
app.use('/parse', parseServer.app);

// Mount Parse Dashboard (separate app for security)
if (
  process.env.NODE_ENV !== 'production'
  || process.env.ENABLE_DASHBOARD === 'true'
) {
  try {
    const dashboardApp = express();

    // Apply security middleware to dashboard
    dashboardApp.use(securityMiddleware.getHelmetConfig());
    dashboardApp.use(securityMiddleware.getStrictRateLimiter());

    // Initialize and mount dashboard with error handling
    const dashboard = new ParseDashboard(parseDashboardConfig, {
      allowInsecureHTTP: process.env.NODE_ENV === 'development',
      dev: process.env.NODE_ENV === 'development',
      trustProxy: process.env.NODE_ENV === 'production',
    });

    dashboardApp.use('/', dashboard);

    // Start dashboard server
    dashboardApp.listen(DASHBOARD_PORT, () => {
      logger.info(
        `Parse Dashboard running on http://localhost:${DASHBOARD_PORT}`
      );
    });
  } catch (error) {
    logger.error('Failed to start Parse Dashboard:', error.message);
    if (process.env.NODE_ENV === 'development') {
      logger.warn('Continuing without Parse Dashboard in development mode');
    }
  }
}

// Alternative: Use separate dashboard command to avoid conflict
logger.info('Parse Dashboard disabled in main app. Use "yarn dashboard" to run separately if needed.');

// Session middleware
app.use(securityMiddleware.getSessionConfig());

// Apply security middleware (Helmet, CSRF, and other security configurations)
// Note: CSRF protection is included in securityMiddleware.getAllMiddleware()
const securityMiddlewares = securityMiddleware.getAllMiddleware();
securityMiddlewares.forEach((middleware) => {
  app.use(middleware);
});

// API Routes
app.use('/api', apiRoutes);

// Authentication Routes
app.use('/auth', authRoutes);

// Documentation Routes
app.use('/', docsRoutes);

// Web Routes
app.use('/', webRoutes);

/**
 * Retrieves database connection metrics for health monitoring and diagnostics.
 * Performs a direct MongoDB connection test with timeout controls to assess
 * database availability, response time, and connection health for monitoring.
 * @function getDatabaseMetrics
 * @returns {Promise<object>} Database metrics object with connection status, response time, and error details.
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // Get database health metrics
 * const metrics = await getDatabaseMetrics();
 * console.log('DB Connected:', metrics.connected);
 * console.log('Response Time:', metrics.responseTime, 'ms');
 * if (metrics.error) {
 *   console.error('DB Error:', metrics.error);
 * }
 */
const getDatabaseMetrics = async () => {
  const dbMetrics = {
    connected: false,
    responseTime: null,
    error: null,
  };

  try {
    const startTime = Date.now();
    const { MongoClient } = require('mongodb');

    // Use the same connection string as in the environment
    const connectionString = process.env.DATABASE_URI || 'mongodb://localhost:27017/amexingdb';

    const client = new MongoClient(connectionString, {
      connectTimeoutMS: 3000,
      serverSelectionTimeoutMS: 3000,
      maxPoolSize: 1, // Minimal pool for health checks
    });

    await client.connect();

    // Simple ping to verify connection
    await client.db().admin().ping();

    const responseTime = Date.now() - startTime;
    dbMetrics.connected = true;
    dbMetrics.responseTime = responseTime;

    await client.close();
  } catch (error) {
    dbMetrics.connected = false;
    dbMetrics.error = error.message;
    logger.debug('Database health check failed:', error.message);
  }

  return dbMetrics;
};

// Health check endpoint
app.get('/health', async (req, res) => {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0',
    database: {
      connected: false,
      responseTime: null,
      error: null,
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      external: Math.round(process.memoryUsage().external / 1024 / 1024),
    },
    system: {
      platform: process.platform,
      nodeVersion: process.version,
      pid: process.pid,
    },
  };

  // Test database connectivity (graceful failure)
  try {
    const dbMetrics = await getDatabaseMetrics();
    healthCheck.database.connected = dbMetrics.connected;
    healthCheck.database.responseTime = dbMetrics.responseTime;

    if (dbMetrics.error) {
      healthCheck.database.error = dbMetrics.error;
    }

    if (dbMetrics.connected) {
      logger.debug(
        `Database health check passed in ${dbMetrics.responseTime}ms`
      );
    }
  } catch (error) {
    healthCheck.database.connected = false;
    healthCheck.database.error = error.message;

    logger.warn(
      'Database health check failed (continuing gracefully):',
      error.message
    );

    // Don't fail the health check completely if database is unavailable
    // This allows the app to start without MongoDB for development
    if (process.env.NODE_ENV === 'production') {
      healthCheck.status = 'unhealthy';
      return res.status(503).json(healthCheck);
    }
    // In development, just log the warning but keep status healthy
    healthCheck.status = 'healthy (db unavailable)';
  }

  res.json(healthCheck);
});

/**
 * Retrieves comprehensive system metrics for monitoring and performance analysis.
 * Collects Node.js process information, memory usage, CPU statistics, and platform
 * details for system monitoring, alerting, and performance optimization.
 * @function getSystemMetrics
 * @returns {object} System metrics object containing uptime, memory, CPU, and platform information.
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // Get current system metrics
 * const metrics = getSystemMetrics();
 * console.log('Uptime:', metrics.uptime, 'seconds');
 * console.log('Memory Used:', metrics.memory.heapUsed, 'MB');
 * console.log('Platform:', metrics.platform);
 * console.log('Node Version:', metrics.nodeVersion);
 */
const getSystemMetrics = () => ({
  uptime: process.uptime(),
  platform: process.platform,
  nodeVersion: process.version,
  pid: process.pid,
  environment: process.env.NODE_ENV,
  memory: {
    rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
    heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    external: Math.round(process.memoryUsage().external / 1024 / 1024),
    arrayBuffers: Math.round(process.memoryUsage().arrayBuffers / 1024 / 1024),
  },
  cpu: {
    usage: process.cpuUsage(),
    loadAverage:
      process.platform !== 'win32' ? require('os').loadavg() : [0, 0, 0],
  },
});

// Metrics endpoint for monitoring
app.get('/metrics', async (req, res) => {
  try {
    const metrics = {
      timestamp: new Date().toISOString(),
      system: getSystemMetrics(),
      application: {
        version: process.env.npm_package_version || '1.0.0',
        startTime: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      },
      database: await getDatabaseMetrics(),
    };

    // Add Parse Server specific metrics if available
    if (parseServer && parseServer.adapter) {
      metrics.parseServer = {
        version: require('parse-server/package.json').version,
        appId: process.env.PARSE_APP_ID,
        serverURL: process.env.PARSE_SERVER_URL,
      };
    }

    res.json(metrics);
  } catch (error) {
    logger.error('Error generating metrics:', error);
    res.status(500).json({
      error: 'Failed to generate metrics',
      timestamp: new Date().toISOString(),
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404);

  if (req.accepts('html')) {
    res.render('errors/404', {
      title: 'Page Not Found',
      message: 'The page you are looking for does not exist.',
      url: req.url,
    });
  } else if (req.accepts('json')) {
    res.json({
      error: 'Not Found',
      message: 'The requested resource was not found',
      path: req.url,
    });
  } else {
    res.type('txt').send('Not Found');
  }
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
const server = app.listen(PORT, () => {
  logger.info(`AmexingWeb API Server running on http://localhost:${PORT}`);
  logger.info(`Parse Server endpoint: http://localhost:${PORT}/parse`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

  if (process.env.NODE_ENV === 'production') {
    logger.info('Running in PRODUCTION mode with enhanced security');
  }
});

/**
 * Handles graceful application shutdown for clean process termination.
 * Manages orderly shutdown sequence including server closing, connection cleanup,
 * and resource disposal to prevent data loss and ensure clean termination.
 * @function gracefulShutdown
 * @param {string} signal - The signal that triggered the shutdown (e.g., 'SIGTERM', 'SIGINT', 'SIGUSR2').
 * @returns {Promise<void>} Resolves when shutdown is complete.
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // Triggered automatically by process signals
 * process.on('SIGTERM', gracefulShutdown);
 * process.on('SIGINT', gracefulShutdown);
 *
 * // Manual shutdown call
 * await gracefulShutdown('MANUAL');
 */
const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  server.close(() => {
    logger.info('HTTP server closed');

    // Close database connections
    parseServer.handleShutdown();

    // Exit process
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    logger.error('Forcefully shutting down...');
    process.exit(1);
  }, 10000);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

module.exports = app;
