/**
 * Amexing Web Application - Main Server Entry Point.
 *
 * This is the primary entry point for the Amexing web application, orchestrating
 * the initialization of all core components including Parse Server, security
 * middleware, authentication systems, and routing configuration.
 * @module index
 * @author Amexing Development Team
 * @version 1.0.0
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

console.log('🟡 ========== SERVER STARTING ==========');
console.log('🟡 Time:', new Date().toISOString());
console.log('🟡 Node Version:', process.version);
console.log('🟡 Environment:', process.env.NODE_ENV || 'development');
console.log('🟡 =====================================');

require('dotenv').config({
  path: `./environments/.env.${process.env.NODE_ENV || 'development'}`,
});

const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');
const expressLayouts = require('express-ejs-layouts');

// Infrastructure
const logger = require('./infrastructure/logger');
const securityMiddleware = require('./infrastructure/security/securityMiddleware');
const { initializeParseServer, shutdownParseServer } = require('./infrastructure/server/parseServerInit');
const { configureStaticFiles } = require('./infrastructure/server/staticFilesConfig');
const { getHealthCheck, getMetrics } = require('./infrastructure/monitoring/healthCheck');
const { initI18n, getMiddleware: getI18nMiddleware } = require('./infrastructure/i18n/i18nConfig');

// API Documentation (Redocly)
const { configureRedoclyDocs } = require('./infrastructure/docs/redoclyServer');

// Routes
const webRoutes = require('./presentation/routes/webRoutes');
const apiRoutes = require('./presentation/routes/apiRoutes');
const authRoutes = require('./presentation/routes/authRoutes');
const docsRoutes = require('./presentation/routes/docsRoutes');
const dashboardRoutes = require('./presentation/routes/dashboardRoutes');
const atomicRoutes = require('./presentation/routes/atomicRoutes');
const publicRoutes = require('./presentation/routes/publicRoutes');

// Mounted directly on `app` (not through a router) — see the /api/webhooks/stripe block below.
const StripeWebhookController = require('./application/controllers/api/StripeWebhookController');

// Middleware
const errorHandler = require('./application/middleware/errorHandler');
const sessionRecovery = require('./application/middleware/sessionRecoveryMiddleware');
const auditContextMiddleware = require('./application/middleware/auditContextMiddleware');
const { parseContextMiddleware } = require('./infrastructure/parseContext');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 1337;

// Use the 'extended' query parser (qs) so nested bracket params parse correctly.
// Express 5 defaults to 'simple', which leaves keys like `order[0][column]` flat
// and breaks DataTables server-side processing (sorting/search). 'extended'
// restores the Express 4 behavior our controllers were written against.
app.set('query parser', 'extended');

// Trust proxy for production and staging (behind Nginx)
if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
  app.set('trust proxy', 1);
}

// View engine setup
app.set('views', path.join(__dirname, 'presentation', 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', false); // Disable default layout, pages will specify their own

// VERY FIRST REQUEST LOGGER - Log ALL requests to see what's happening
app.use((req, res, next) => {
  // Log ALL requests first
  console.log('📍 ALL REQUESTS:', req.method, req.url);

  // Then log forgot-password specifically
  if (req.url.includes('forgot-password') || req.path.includes('forgot-password')) {
    console.log('🟢 ========== VERY FIRST: forgot-password request ==========');
    console.log('🟢 Time:', new Date().toISOString());
    console.log('🟢 Method:', req.method);
    console.log('🟢 URL:', req.url);
    console.log('🟢 Path:', req.path);
    console.log('🟢 Original URL:', req.originalUrl);
    console.log('🟢 User Agent:', req.headers['user-agent']);
    console.log('🟢 Content Type:', req.headers['content-type']);
    console.log('🟢 ========================================');
  }
  next();
});

// CSP Report endpoint (must be before body parser to handle application/csp-report)
app.post(
  '/api/csp-report',
  express.json({
    type: ['application/csp-report', 'application/json'],
    limit: '1mb',
  }),
  (req, res) => {
    try {
      if (req.body && Object.keys(req.body).length > 0) {
        logger.warn('CSP Violation Report:', JSON.stringify(req.body, null, 2));
      }
      res.status(204).end();
    } catch (error) {
      logger.warn('CSP Report parsing error:', error);
      res.status(204).end();
    }
  }
);

// Stripe webhook (pasarela de pagos). DELIBERATELY registered HERE, on `app`, in this synchronous
// block — NOT in apiRoutes.js and NOT inside initPromise.then() below — for two reasons:
//   1) Signature verification needs the body as the RAW Buffer Stripe signed. The global
//      express.json({ limit: '250mb' }) a few lines below would consume and parse it first, and
//      stripe.webhooks.constructEvent would then fail EVERY delivery with "invalid signature" —
//      indistinguishable from a wrong secret or an attack. express.raw must win the body.
//   2) The URL starts with /api/ only as a public naming convention (Stripe CLI, docs). It does NOT
//      belong to the /api router: that router applies JWT auth, and this endpoint is authenticated by
//      the Stripe signature instead. Moving it into apiRoutes.js would break both the raw body and the
//      auth model. Please do not "fix" it there.
// The route gets its OWN rate limiter (it inherits none out here): 100 req/min per IP, isolated from
// the reservation limiters so a webhook burst can never lock staff out of the CRM, or vice versa.
const stripeWebhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { success: false, error: 'Demasiadas solicitudes' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.post(
  '/api/webhooks/stripe',
  stripeWebhookLimiter,
  express.raw({ type: 'application/json', limit: '2mb' }),
  (req, res) => StripeWebhookController.handle(req, res)
);

// Client/agent document uploads are base64-in-JSON (≤10MB binary ⇒ ~14MB encoded). Cap the body for
// just these routes BEFORE the 250MB global parser below claims it (express.json skips once the body
// is parsed), so this path can't be abused to buffer huge payloads into memory.
app.use(
  ['/api/clients/:clientId/documents', '/api/agents/:agentId/documents'],
  express.json({ limit: '15mb' })
);

// Body parsing middleware
app.use(express.json({ limit: '250mb' }));
app.use(express.urlencoded({ extended: true, limit: '250mb' }));
app.use(cookieParser());
app.use(methodOverride('_method'));

// DEBUG: Log ALL requests
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/forgot-password') {
    console.log('🔴 ========== APP LEVEL: POST /forgot-password DETECTED ==========');
    console.log('🔴 Time:', new Date().toISOString());
    console.log('🔴 Method:', req.method);
    console.log('🔴 Path:', req.path);
    console.log('🔴 URL:', req.originalUrl);
    console.log('🔴 Body:', JSON.stringify(req.body, null, 2));
    console.log('🔴 Headers:', {
      'content-type': req.headers['content-type'],
      'content-length': req.headers['content-length'],
      referer: req.headers.referer,
    });
    console.log('🔴 Session ID:', req.sessionID || req.session?.id || 'no session');
    console.log('🔴 ========================================');
  }
  next();
});

// Compression middleware
app.use(compression());

// Initialize Parse Server variable (will be set after server initialization)
let parseServer;

// Initialize i18n and mount routes only after it's ready
console.log('🌐 Initializing i18next translations...');
const initPromise = initI18n().then(() => {
  console.log('✅ i18next initialization complete');

  // Apply i18n middleware immediately after initialization
  app.use(getI18nMiddleware());
  console.log('✅ i18n middleware applied before routes');

  // Routes must be mounted AFTER i18n middleware is applied
  // This ensures req.t is available in all route handlers

  // Session health check endpoint (before other routes)
  app.get('/api/session/health', sessionRecovery.sessionHealthEndpoint);

  // Parse context middleware - Global user context propagation for audit trails
  // Uses AsyncLocalStorage to make user context available throughout request lifecycle
  // IMPORTANT: Must be applied BEFORE routes to capture all authenticated requests
  app.use(parseContextMiddleware);

  // Audit context middleware - Propagates authenticated user context to Parse hooks
  // IMPORTANT: Must be applied AFTER authentication middleware but BEFORE routes
  app.use(auditContextMiddleware);

  // Public Routes (no authentication - must be before other routes)
  app.use('/', publicRoutes);

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
}).catch((error) => {
  logger.error('Failed to initialize i18n:', error);
  process.exit(1);
});

// Configure static file serving (centralized configuration)
configureStaticFiles(app);

// Initialize Parse Server (async initialization handled in module)
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
  // In test mode with no local Parse Server, proxy to test server
  if (process.env.NODE_ENV === 'test' && (!parseServer || parseServer === null)) {
    // Proxy to test Parse Server at http://localhost:1339/parse
    const http = require('http');
    const url = require('url');

    const targetUrl = url.parse(process.env.PARSE_SERVER_URL || 'http://localhost:1339/parse');
    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: targetUrl.pathname + (req.url.startsWith('/') ? req.url : `/${req.url}`),
      method: req.method,
      headers: req.headers,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (error) => {
      logger.error('Parse Server proxy error:', error);
      res.status(503).json({
        error: 'Service Unavailable',
        message: 'Test Parse Server is not available',
      });
    });

    if (req.body) {
      proxyReq.write(JSON.stringify(req.body));
    }
    proxyReq.end();
    return;
  }

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

// Session recovery middleware - Auto-recover missing CSRF secrets and detect session issues
// IMPORTANT: Must be applied AFTER session middleware but BEFORE security middleware
app.use(sessionRecovery.autoRecoverSession());
app.use(sessionRecovery.sessionHealthCheck());

// Apply security middleware (Helmet, CSRF, and other security configurations)
// Note: CSRF protection is included in securityMiddleware.getAllMiddleware()
const securityMiddlewares = securityMiddleware.getAllMiddleware();
securityMiddlewares.forEach((middleware) => {
  app.use(middleware);
});

// API Documentation (Redocly - Development and Test only)
// SECURITY: Disabled in production (PCI DSS 4.0.1 compliant)
configureRedoclyDocs(app);

// Routes, error handlers, and endpoints are now mounted inside the i18n initialization promise
// This ensures the i18n middleware is applied before any route handlers execute

// Start server only if this file is run directly (not imported for testing)
let server;
if (require.main === module) {
  // Wait for i18n initialization before starting server
  initPromise.then(() => {
    server = app.listen(PORT, () => {
      logger.info(`AmexingWeb API Server running on http://localhost:${PORT}`);
      logger.info(`Parse Server endpoint: http://localhost:${PORT}/parse`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

      if (process.env.NODE_ENV === 'production') {
        logger.info('Running in PRODUCTION mode with enhanced security');
      }
    });
  }).catch((error) => {
    logger.error('Failed to start server:', error);
    process.exit(1);
  });
}

/**
 * Handles graceful application shutdown for clean process termination.
 * @param {string} signal - The signal that triggered the shutdown.
 * @example
 * // Graceful shutdown is triggered automatically on SIGTERM/SIGINT
 * process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
 */
let isShuttingDown = false;
const gracefulShutdown = async (signal) => {
  // Prevent multiple shutdown attempts
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info(`Received ${signal}, starting graceful shutdown...`);

  // Force exit after 10 seconds
  const forceExitTimer = setTimeout(() => {
    logger.error('Forcefully shutting down...');
    process.exit(1);
  }, 10000);

  try {
    // Close HTTP server first
    if (server) {
      await new Promise((resolve) => {
        server.close(() => {
          logger.info('HTTP server closed');
          resolve();
        });
      });
    }

    // Shutdown Parse Server gracefully
    await shutdownParseServer(parseServer);

    // Clear force exit timer and exit cleanly
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error.message);
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
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
// Force reload comment 1771371745
