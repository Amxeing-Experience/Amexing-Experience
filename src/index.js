/**
 * Amexing Web Application - Main Server Entry Point.
 *
 * This is the primary entry point for the Amexing web application, orchestrating
 * the initialization of all core components including Parse Server, security
 * middleware, authentication systems, and routing configuration.
 * @module index
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
 */

require('dotenv').config({
  path: `./environments/.env.${process.env.NODE_ENV || 'development'}`,
});

const express = require('express');
const path = require('path');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');

// Infrastructure
const swaggerUi = require('swagger-ui-express');
const logger = require('./infrastructure/logger');
const securityMiddleware = require('./infrastructure/security/securityMiddleware');
const {
  initializeParseServer,
  shutdownParseServer,
} = require('./infrastructure/server/parseServerInit');
const {
  configureStaticFiles,
} = require('./infrastructure/server/staticFilesConfig');
const {
  getHealthCheck,
  getMetrics,
} = require('./infrastructure/monitoring/healthCheck');

// Swagger/OpenAPI Documentation
const { swaggerSpec } = require('./infrastructure/swagger/swagger.config');

// Routes
const webRoutes = require('./presentation/routes/webRoutes');
const apiRoutes = require('./presentation/routes/apiRoutes');
const authRoutes = require('./presentation/routes/authRoutes');
const docsRoutes = require('./presentation/routes/docsRoutes');
const dashboardRoutes = require('./presentation/routes/dashboardRoutes');
const atomicRoutes = require('./presentation/routes/atomicRoutes');

// Middleware
const errorHandler = require('./application/middleware/errorHandler');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 1337;

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

// Configure static file serving (centralized configuration)
configureStaticFiles(app);

// Initialize Parse Server (async initialization handled in module)
let parseServer;
initializeParseServer()
  .then((server) => {
    parseServer = server;
  })
  .catch((_error) => {
    if (process.env.NODE_ENV === 'production') {
      logger.error('Fatal: Parse Server failed to initialize in production');
      process.exit(1);
    }
  });

// Mount Parse Server middleware (will be available after initialization)
app.use('/parse', (req, res, next) => {
  if (parseServer && parseServer.app) {
    return parseServer.app(req, res, next);
  }
  res.status(503).json({
    error: 'Service Unavailable',
    message: 'Parse Server is initializing',
  });
});

// Session middleware
app.use(securityMiddleware.getSessionConfig());

// Apply security middleware (Helmet, CSRF, and other security configurations)
// Note: CSRF protection is included in securityMiddleware.getAllMiddleware()
const securityMiddlewares = securityMiddleware.getAllMiddleware();
securityMiddlewares.forEach((middleware) => {
  app.use(middleware);
});

// Swagger API Documentation (Development and Test only)
// SECURITY: Disabled in production - configure proper API documentation strategy for production
if (process.env.NODE_ENV !== 'production') {
  logger.info('Swagger API Documentation enabled at /api-docs (Development/Test only)');

  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'AmexingWeb API Documentation',
      customfavIcon: '/favicon.ico',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
        syntaxHighlight: {
          activate: true,
          theme: 'monokai',
        },
      },
    })
  );

  // OpenAPI specification JSON endpoint (Development/Test only)
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
} else {
  // In production, return 404 for documentation endpoints
  app.use('/api-docs', (req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: 'API documentation is not available in production',
    });
  });

  app.get('/api-docs.json', (req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: 'API documentation is not available in production',
    });
  });
}

// API Routes
app.use('/api', apiRoutes);

// Authentication Routes
app.use('/auth', authRoutes);

// Documentation Routes
app.use('/', docsRoutes);

// Dashboard Routes
app.use('/dashboard', dashboardRoutes);

// Atomic Design Routes
app.use('/atomic', atomicRoutes);

// Web Routes (must be last to avoid route conflicts)
app.use('/', webRoutes);

// Health check endpoint (uses centralized health check module)
app.get('/health', async (req, res) => {
  try {
    const healthCheck = await getHealthCheck();
    const statusCode = healthCheck.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(healthCheck);
  } catch (error) {
    logger.error('Health check error:', error);
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

// Metrics endpoint for monitoring (uses centralized metrics module)
app.get('/metrics', async (req, res) => {
  try {
    const metrics = await getMetrics(parseServer);
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

// Start server only if this file is run directly (not imported for testing)
let server;
if (require.main === module) {
  server = app.listen(PORT, () => {
    logger.info(`AmexingWeb API Server running on http://localhost:${PORT}`);
    logger.info(`Parse Server endpoint: http://localhost:${PORT}/parse`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

    if (process.env.NODE_ENV === 'production') {
      logger.info('Running in PRODUCTION mode with enhanced security');
    }
  });
}

/**
 * Handles graceful application shutdown for clean process termination.
 * @param {string} signal - The signal that triggered the shutdown.
 * @example
 * // Graceful shutdown is triggered automatically on SIGTERM/SIGINT
 * process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
 */
const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  if (server) {
    server.close(async () => {
      logger.info('HTTP server closed');

      // Shutdown Parse Server gracefully
      await shutdownParseServer(parseServer);

      // Exit process
      process.exit(0);
    });
  }

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
