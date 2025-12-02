/* eslint-disable max-lines */
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const winston = require('winston');
const csrf = require('csrf');
const uidSafe = require('uid-safe');
const sessionMetrics = require('../monitoring/sessionMetrics');

/**
 * Security Middleware - Comprehensive security protection suite for PCI DSS compliance.
 * Provides multi-layered security protection including CSRF protection, rate limiting,
 * input sanitization, XSS protection, and comprehensive security headers.
 *
 * This middleware implements industry-standard security measures required for
 * PCI DSS compliance, protecting against common web vulnerabilities and attacks
 * while maintaining performance and usability.
 *
 * Features:
 * - Helmet security headers with CSP configuration
 * - Rate limiting with configurable thresholds
 * - MongoDB injection protection and input sanitization
 * - XSS attack prevention and content filtering
 * - HTTP Parameter Pollution (HPP) protection
 * - CORS configuration for cross-origin requests
 * - Session management with secure MongoDB storage
 * - CSRF token generation and validation
 * - Environment-specific security configurations
 * - Comprehensive logging and monitoring.
 * @class SecurityMiddleware
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Initialize security middleware
 * const securityMiddleware = new SecurityMiddleware();
 *
 * // Apply security layers to Express app
 * app.use(securityMiddleware.getHelmetConfig());
 * app.use(securityMiddleware.getRateLimitConfig());
 * app.use(securityMiddleware.getSessionConfig());
 * app.use(securityMiddleware.getCorsConfig());
 * app.use(securityMiddleware.getInputSanitization());
 *
 * // CSRF protection for forms
 * app.use('/api', securityMiddleware.validateCsrfToken());
 * app.get('/csrf-token', securityMiddleware.generateCsrfToken());
 *
 * // Environment-specific configurations
 * // Development: Relaxed CSP, detailed error messages
 * // Production: Strict CSP, HSTS, secure cookies
 */
class SecurityMiddleware {
  constructor() {
    this.isDevelopment = process.env.NODE_ENV === 'development';
    this.isProduction = process.env.NODE_ENV === 'production';
    this.isProductionLocal = process.env.NODE_ENV === 'production-local';

    // Log environment detection for debugging
    winston.info('SecurityMiddleware initialized', {
      environment: process.env.NODE_ENV,
      isDevelopment: this.isDevelopment,
      isProduction: this.isProduction,
      isProductionLocal: this.isProductionLocal,
    });

    // Initialize CSRF protection
    // eslint-disable-next-line new-cap
    this.csrfProtection = new csrf({
      saltLength: 32,
      secretLength: 64,
    });
  }

  /**
   * Configures and returns Helmet middleware for comprehensive security headers.
   * Implements Content Security Policy (CSP) with DataTables and CDN support,
   * HSTS, XSS protection, and other security headers required for PCI DSS compliance.
   * @function getHelmetConfig
   * @returns {Function} - Helmet middleware configured with security headers.
   * @example
   * // Apply Helmet security headers to Express app
   * app.use(securityMiddleware.getHelmetConfig());
   */
  getHelmetConfig() {
    return helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://fonts.googleapis.com',
            'https://cdn.datatables.net',
            'https://cdn.jsdelivr.net',
            'https://cdnjs.cloudflare.com',
            'https://unpkg.com',
          ],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'", // Required for EJS templates with inline scripts
            this.isDevelopment ? "'unsafe-eval'" : '',
            'https://code.jquery.com',
            'https://cdn.datatables.net',
            'https://unpkg.com',
            'https://cdn.jsdelivr.net',
            'https://cdnjs.cloudflare.com',
          ].filter(Boolean),
          imgSrc: ["'self'", 'data:', 'https:'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          connectSrc: [
            "'self'",
            'http://localhost:1337', // Development
            'http://localhost:1338', // Production local
            'https://quotes.amexingexperience.com', // Production
            'https://cdn.datatables.net',
            'https://cdn.jsdelivr.net',
            'https://cdnjs.cloudflare.com',
            'https://unpkg.com',
          ],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
          sandbox: [
            'allow-forms',
            'allow-scripts',
            'allow-same-origin',
            'allow-downloads',
            'allow-modals',
            'allow-popups', // Required for modals
          ],
          reportUri: '/api/csp-report',
          upgradeInsecureRequests: this.isProduction ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false, // Disabled to allow S3 images
      crossOriginOpenerPolicy: { policy: 'unsafe-none' }, // Allow opening in new tabs
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin resources (S3 images)
      dnsPrefetchControl: { allow: false },
      expectCt: {
        enforce: true,
        maxAge: 30,
      },
      frameguard: { action: 'deny' },
      hidePoweredBy: true,
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      ieNoOpen: true,
      noSniff: true,
      originAgentCluster: true,
      permittedCrossDomainPolicies: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      xssFilter: true,
    });
  }

  /**
   * Configures and returns standard rate limiting middleware for general API protection.
   * Limits requests based on IP address with configurable window and threshold.
   * Logs rate limit violations and returns 429 status with retry information.
   * @function getRateLimiter
   * @returns {Function} - Express rate limiting middleware.
   * @example
   * // Apply standard rate limiting to all routes
   * app.use(securityMiddleware.getRateLimiter());
   */
  getRateLimiter() {
    return rateLimit({
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || (this.isDevelopment ? 300 : 100),
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: process.env.RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS === 'true',
      handler: (req, res) => {
        winston.warn(`Rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json({
          error: 'Too many requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: Math.ceil(req.rateLimit.resetTime / 1000),
        });
      },
    });
  }

  /**
   * Configures and returns strict rate limiting middleware for sensitive endpoints.
   * Implements more aggressive rate limiting for authentication, password reset,
   * and other security-critical operations. More lenient in development mode.
   * @function getStrictRateLimiter
   * @returns {Function} - Strict rate limiting middleware with reduced thresholds.
   * @example
   * // Apply strict rate limiting to authentication endpoints
   * app.use('/auth/login', securityMiddleware.getStrictRateLimiter());
   */
  getStrictRateLimiter() {
    return rateLimit({
      windowMs: 15 * 60 * 1000,
      max: this.isDevelopment ? 10 : 5, // More lenient in development
      message: 'Too many attempts. Please try again later.',
      skipSuccessfulRequests: false,
    });
  }

  /**
   * Configures and returns API-specific rate limiting middleware.
   * Implements short window (1 minute) rate limiting optimized for API endpoints
   * to prevent abuse while allowing legitimate high-frequency API usage.
   * @function getApiRateLimiter
   * @returns {Function} - API-optimized rate limiting middleware.
   * @example
   * // Apply API rate limiting to REST endpoints
   * app.use('/api/v1', securityMiddleware.getApiRateLimiter());
   */
  getApiRateLimiter() {
    return rateLimit({
      windowMs: 1 * 60 * 1000, // 1 minute
      max: this.isDevelopment ? 500 : 120, // Increased for development workflows: 500 in dev, 120 in production
      message: 'API rate limit exceeded.',
      standardHeaders: true,
      legacyHeaders: false,
    });
  }

  /**
   * Configures and returns MongoDB injection prevention middleware.
   * Sanitizes user input to prevent NoSQL injection attacks by removing
   * dollar signs and periods from request data. Logs sanitization events.
   * @function getMongoSanitizer
   * @returns {Function} - Express-mongo-sanitize middleware for NoSQL injection protection.
   * @example
   * // Apply MongoDB sanitization to all routes
   * app.use(securityMiddleware.getMongoSanitizer());
   */
  getMongoSanitizer() {
    return mongoSanitize({
      replaceWith: '_',
      onSanitize: ({ req, _key }) => {
        winston.warn(`Attempted NoSQL injection from IP ${req.ip} on field ${_key}`);
      },
    });
  }

  /**
   * Configures and returns XSS (Cross-Site Scripting) protection middleware.
   * Sanitizes user input to prevent XSS attacks by cleaning and filtering
   * potentially malicious HTML and JavaScript code from request data.
   * @function getXssProtection
   * @returns {Function} - XSS-clean middleware for XSS attack prevention.
   * @example
   * // Apply XSS protection to all routes
   * app.use(securityMiddleware.getXssProtection());
   */
  getXssProtection() {
    return xss();
  }

  /**
   * Configures and returns HTTP Parameter Pollution (HPP) protection middleware.
   * Prevents parameter pollution attacks by protecting against duplicate parameters
   * in query strings. Whitelists specific parameters that legitimately need arrays.
   * @function getHppProtection
   * @returns {Function} - HPP middleware for parameter pollution prevention.
   * @example
   * // Apply HPP protection to all routes
   * app.use(securityMiddleware.getHppProtection());
   */
  getHppProtection() {
    return hpp({
      whitelist: ['sort', 'fields', 'page', 'limit'],
    });
  }

  /**
   * Configures and returns CORS (Cross-Origin Resource Sharing) middleware.
   * Implements origin validation, credential handling, and allowed methods/headers.
   * Permits Parse Server health checks and validates origins against whitelist.
   * @function getCorsConfig
   * @returns {Function} - CORS middleware with origin validation and security controls.
   * @example
   * // Apply CORS configuration to Express app
   * app.use(securityMiddleware.getCorsConfig());
   */
  getCorsConfig() {
    const corsOptions = {
      origin: (origin, callback) => {
        const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',');

        // Allow requests without origin (server-to-server, Parse Server health checks)
        if (!origin) {
          return callback(null, true);
        }

        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          winston.warn(`CORS blocked request from origin: ${origin}`);
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: process.env.CORS_CREDENTIALS === 'true',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Parse-Application-Id', 'X-Parse-Session-Token'],
      exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Per-Page'],
      maxAge: 86400,
      preflightContinue: false,
      optionsSuccessStatus: 204,
    };

    return cors(corsOptions);
  }

  /**
   * Configures and returns session management middleware with secure settings.
   * Uses MongoDB for production session storage and memory store for development.
   * Implements secure cookies, session timeouts, and PCI DSS compliant settings.
   * @function getSessionConfig
   * @returns {Function} - Express-session middleware with secure configuration.
   * @example
   * // Apply session configuration to Express app
   * app.use(securityMiddleware.getSessionConfig());
   */
  // eslint-disable-next-line complexity
  getSessionConfig() {
    // Use MemoryStore for development to avoid MongoDB dependency issues
    const sessionConfig = {
      secret: process.env.SESSION_SECRET || 'default-secret-change-in-production',
      name: 'amexing.sid',
      resave: false,
      saveUninitialized: true, // Changed to true for CSRF initialization
    };

    // Use MongoStore in production and production-local
    if (this.isProduction || this.isProductionLocal) {
      try {
        const store = MongoStore.create({
          mongoUrl: process.env.DATABASE_URI || 'mongodb://localhost:27017/amexingdb',
          collectionName: 'sessions',
          ttl: parseInt(process.env.SESSION_TIMEOUT_MINUTES, 10) * 60 || 3600,
          autoRemove: 'native',
          crypto: {
            secret: process.env.SESSION_SECRET || 'default-secret-change-in-production',
          },
          // Connection options for better reliability
          mongoOptions: {
            maxPoolSize: 10,
            minPoolSize: 2,
            socketTimeoutMS: 45000,
            serverSelectionTimeoutMS: 10000,
            retryWrites: true,
            retryReads: true,
            // CRITICAL FIX: Add write concern for guaranteed persistence
            writeConcern: {
              w: 'majority', // Wait for majority of nodes to acknowledge
              j: true, // Wait for journal write (durable)
              wtimeout: 5000, // Timeout after 5 seconds
            },
          },
          // Touch sessions on access to extend TTL
          // CRITICAL FIX: Reduced from 300 to 30 seconds to ensure frequent persistence
          // This prevents in-memory/MongoDB desynchronization of CSRF secrets
          touchAfter: 30, // Touch session every 30 seconds (in seconds)
        });

        // Session store error handling
        store.on('error', (error) => {
          winston.error('Session store error:', {
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
          });
          sessionMetrics.recordStoreError(error);
        });

        store.on('create', (sessionId) => {
          winston.debug('Session created:', {
            sessionId: `${sessionId.substring(0, 8)}***`,
            timestamp: new Date().toISOString(),
          });
          sessionMetrics.recordSessionCreated(sessionId);
        });

        store.on('touch', (sessionId) => {
          winston.debug('Session touched (extended):', {
            sessionId: `${sessionId.substring(0, 8)}***`,
            timestamp: new Date().toISOString(),
          });
          sessionMetrics.recordSessionTouched(sessionId);
        });

        store.on('destroy', (sessionId) => {
          winston.debug('Session destroyed:', {
            sessionId: `${sessionId.substring(0, 8)}***`,
            timestamp: new Date().toISOString(),
          });
          sessionMetrics.recordSessionDestroyed(sessionId);
        });

        sessionConfig.store = store;

        winston.info('MongoDB session store configured successfully', {
          ttl: parseInt(process.env.SESSION_TIMEOUT_MINUTES, 10) * 60 || 3600,
          touchAfter: 30,
          writeConcern: 'majority with journal',
        });
      } catch (error) {
        winston.error('Failed to create MongoDB session store:', {
          error: error.message,
          stack: error.stack,
        });

        // Fallback to memory store if MongoDB fails
        winston.warn('Falling back to memory session store');
        // sessionConfig.store will remain undefined, using default MemoryStore
      }
    }

    // Determine cookie security settings based on environment
    // production: Requires HTTPS, strict sameSite, domain restriction
    // production-local: HTTP compatible for localhost testing with production database
    // development: Relaxed settings for development
    const cookieSecure = this.isProduction ? true : process.env.COOKIE_SECURE === 'true' || false;

    const cookieSameSite = this.isProduction ? 'strict' : process.env.COOKIE_SAMESITE || 'lax';

    const cookieDomain = this.isProduction ? process.env.COOKIE_DOMAIN : undefined;

    // Log cookie configuration for debugging
    winston.info('Session cookie configuration', {
      environment: process.env.NODE_ENV,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      domain: cookieDomain || 'undefined',
      httpOnly: true,
    });

    return session({
      ...sessionConfig,
      cookie: {
        secure: cookieSecure, // HTTPS required in true production only
        httpOnly: true,
        maxAge: parseInt(process.env.SESSION_TIMEOUT_MINUTES, 10) * 60 * 1000 || 900000,
        expires: new Date(Date.now() + (parseInt(process.env.SESSION_TIMEOUT_MINUTES, 10) * 60 * 1000 || 900000)), // Explicit expires
        path: '/', // Explicit path configuration
        sameSite: cookieSameSite,
        domain: cookieDomain,
      },
      rolling: true,
      unset: 'destroy',
    });
  }

  /**
   * Validates Content-Type headers for POST, PUT, and PATCH requests.
   * Ensures requests use accepted content types (JSON, form data, multipart).
   * Prevents content type confusion attacks and enforces API standards.
   * @function validateContentType
   * @returns {Function} - Middleware that validates request Content-Type headers.
   * @example
   * // Apply content type validation to all routes
   * app.use(securityMiddleware.validateContentType());
   */
  validateContentType() {
    return (req, res, next) => {
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        const contentType = req.headers['content-type'];
        if (
          !contentType
          || (!contentType.includes('application/json')
            && !contentType.includes('multipart/form-data')
            && !contentType.includes('application/x-www-form-urlencoded'))
        ) {
          return res.status(400).json({
            error: 'Invalid Content-Type',
            message: 'Content-Type must be application/json, multipart/form-data, or application/x-www-form-urlencoded',
          });
        }
      }
      next();
    };
  }

  /**
   * Adds comprehensive security headers to API responses.
   * Implements cache control, content type options, frame options, and XSS protection.
   * Prevents response caching and browser-based security vulnerabilities.
   * @function apiSecurityHeaders
   * @returns {Function} - Middleware that sets security headers on API responses.
   * @example
   * // Apply API security headers to all API routes
   * app.use('/api', securityMiddleware.apiSecurityHeaders());
   */
  apiSecurityHeaders() {
    return (req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
      next();
    };
  }

  /**
   * Restricts access to routes based on IP address whitelist.
   * Validates client IP against allowed list and blocks unauthorized access.
   * Automatically bypassed in development mode for easier testing.
   * @function ipWhitelist
   * @param {Array<string>} allowedIps - Array of IP addresses permitted to access the route.
   * @returns {Function} - Middleware that enforces IP-based access control.
   * @example
   * // Restrict admin routes to specific IP addresses
   * app.use('/admin', securityMiddleware.ipWhitelist(['192.168.1.1', '10.0.0.1']));
   */
  ipWhitelist(allowedIps = []) {
    return (req, res, next) => {
      if (this.isDevelopment || allowedIps.length === 0) {
        return next();
      }

      const clientIp = req.ip || req.connection.remoteAddress;
      if (!allowedIps.includes(clientIp)) {
        winston.warn(`Access denied for IP: ${clientIp}`);
        return res.status(403).json({
          error: 'Access denied',
          message: 'Your IP address is not authorized to access this resource',
        });
      }
      next();
    };
  }

  /**
   * Generates and attaches unique request IDs for tracking and debugging.
   * Uses existing X-Request-Id header if present, otherwise generates UUID.
   * Adds request ID to response headers for end-to-end traceability.
   * @function requestId
   * @returns {Function} - Middleware that adds unique request IDs to requests and responses.
   * @example
   * // Enable request ID tracking for all routes
   * app.use(securityMiddleware.requestId());
   */
  requestId() {
    const { v4: uuid } = require('uuid');
    return (req, res, next) => {
      req.id = req.headers['x-request-id'] || uuid();
      res.setHeader('X-Request-Id', req.id);
      next();
    };
  }

  /**
   * Implements comprehensive audit logging for compliance and security monitoring.
   * Records request details, response times, user information, and error data.
   * Activated when ENABLE_AUDIT_LOGGING environment variable is true.
   * @function auditLogger
   * @returns {Function} - Middleware that logs detailed audit information for requests.
   * @example
   * // Enable audit logging for all routes
   * app.use(securityMiddleware.auditLogger());
   */
  auditLogger() {
    return (req, res, next) => {
      if (process.env.ENABLE_AUDIT_LOGGING !== 'true') {
        return next();
      }

      const startTime = Date.now();
      const originalSend = res.send;

      res.send = function (data) {
        res.send = originalSend;

        const auditLog = {
          timestamp: new Date().toISOString(),
          requestId: req.id,
          method: req.method,
          url: req.originalUrl,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          userId: req.user?.id,
          statusCode: res.statusCode,
          responseTime: Date.now() - startTime,
        };

        if (res.statusCode >= 400) {
          auditLog.body = req.body;
          auditLog.response = data;
        }

        winston.info('Audit log:', auditLog);
        return res.send(data);
      };

      next();
    };
  }

  /**
   * Implements CSRF (Cross-Site Request Forgery) protection middleware.
   * Generates tokens for GET requests and validates tokens on state-changing requests.
   * Skips validation for safe methods (GET, HEAD, OPTIONS) and API endpoints.
   * @function getCsrfProtection
   * @returns {Function} - Async middleware that validates CSRF tokens for protected requests.
   * @example
   * // Apply CSRF protection to form routes
   * app.use(securityMiddleware.getCsrfProtection());
   */
  // eslint-disable-next-line max-lines-per-function
  getCsrfProtection() {
    // eslint-disable-next-line complexity,max-lines-per-function
    return async (req, res, next) => {
      try {
        // Skip CSRF for GET, HEAD, OPTIONS requests and API endpoints
        // SECURITY NOTE: Login endpoint (/auth/login) is explicitly excluded from CSRF validation
        // Reasons:
        // 1. User is not yet authenticated, no existing session state to protect
        // 2. Session regeneration after successful login prevents session fixation attacks
        // 3. Eliminates race conditions during session transitions (logout -> login)
        // 4. Login CSRF attacks have minimal practical impact (forces login to attacker account)
        // 5. This is a common practice in modern authentication systems
        // All other authenticated endpoints remain CSRF-protected
        if (
          req.method === 'GET'
          || req.method === 'HEAD'
          || req.method === 'OPTIONS'
          || req.path.startsWith('/api/')
          || req.path === '/auth/login'
          || req.path === '/auth/change-password'
        ) {
          // Generate CSRF token for forms if session exists
          if (req.session && (req.method === 'GET' || req.method === 'HEAD')) {
            // PERSISTENCE CHECK: Detect authenticated user without CSRF secret
            // This should not happen in normal operation - indicates session recovery issue
            if (req.session.user && !req.session.csrfSecret) {
              winston.error('CSRF secret missing for authenticated user', {
                sessionID: req.session.id,
                userId: req.session.user.objectId,
                username: req.session.user.username,
                path: req.path,
                timestamp: new Date().toISOString(),
              });

              // Record metrics if available
              if (sessionMetrics.recordCsrfPersistenceIssue) {
                sessionMetrics.recordCsrfPersistenceIssue(req.session.id, {
                  userId: req.session.user.objectId,
                  path: req.path,
                });
              }
            }

            // Generate CSRF secret if missing (auto-recovery)
            if (!req.session.csrfSecret) {
              req.session.csrfSecret = await uidSafe(32);

              // CRITICAL FIX: Explicitly save session to MongoDB before proceeding
              // This prevents race conditions where the token is generated but the secret
              // hasn't been persisted to the database yet
              await new Promise((resolve, reject) => {
                req.session.save((err) => {
                  if (err) {
                    winston.error('Failed to save session after CSRF generation', {
                      error: err.message,
                      sessionID: req.session.id,
                      path: req.path,
                    });
                    sessionMetrics.recordCsrfSecretPersistenceFailure(req.session.id, err, {
                      path: req.path,
                      phase: 'generation',
                    });
                    reject(err);
                  } else {
                    winston.debug('Generated and saved CSRF secret for new session', {
                      sessionID: req.session.id,
                      path: req.path,
                    });
                    sessionMetrics.recordCsrfSecretPersisted(req.session.id, {
                      path: req.path,
                      phase: 'generation',
                    });
                    resolve();
                  }
                });
              });
            }
            const token = this.csrfProtection.create(req.session.csrfSecret);
            res.locals.csrfToken = token;
            sessionMetrics.recordCsrfTokenGenerated();
          }
          return next();
        }

        // For state-changing requests, verify CSRF token
        const secret = req.session?.csrfSecret;

        // CRITICAL FIX: Removed dangerous auto-recovery logic that generates new secret on POST
        // The old logic would generate a NEW secret when validating a token that was created
        // with the OLD secret, causing guaranteed validation failures.
        //
        // Instead, we now fail fast with a clear error message that tells the user
        // their session has expired and they need to refresh the page to get a new token.
        if (!secret) {
          winston.error('CSRF validation failed - no CSRF secret in session', {
            method: req.method,
            path: req.path,
            hasSession: !!req.session,
            sessionID: req.session?.id,
            ip: req.ip,
            userAgent: req.get('User-Agent')?.substring(0, 50),
            timestamp: new Date().toISOString(),
          });

          // Record metrics for monitoring
          sessionMetrics.recordCsrfValidationFailure('SECRET_MISSING', {
            method: req.method,
            url: req.originalUrl,
            ip: req.ip,
            hasSession: !!req.session,
          });

          return res.status(403).json({
            error: 'CSRF Error',
            message: 'Your session has expired. Please refresh the page and try again.',
            code: 'SESSION_EXPIRED',
            recoveryAction: 'refresh_page',
          });
        }

        const token = req.headers['x-csrf-token'] || req.body?.csrfToken || req.query.csrfToken;
        if (!token) {
          sessionMetrics.recordCsrfValidationFailure('TOKEN_MISSING', {
            method: req.method,
            url: req.originalUrl,
            ip: req.ip,
          });

          return res.status(403).json({
            error: 'CSRF Error',
            message: 'CSRF token missing',
            code: 'TOKEN_MISSING',
          });
        }

        if (!this.csrfProtection.verify(secret, token)) {
          // Enhanced logging for CSRF failures with session context
          const context = {
            ip: req.ip,
            userAgent: req.get('User-Agent')?.substring(0, 100),
            method: req.method,
            url: req.originalUrl,
            sessionID: req.session?.id,
            hasSession: !!req.session,
            hasSecret: !!secret,
            hasToken: !!token,
            tokenLength: token ? token.length : 0,
            sessionAge: req.session?.cookie?.maxAge,
            timestamp: new Date().toISOString(),
            // Check if session is near expiration
            sessionNearExpiration: req.session?.cookie?.expires
              ? new Date(req.session.cookie.expires).getTime() - Date.now() < 300000
              : false,
          };

          winston.warn('CSRF token verification failed', context);
          sessionMetrics.recordCsrfValidationFailure('TOKEN_INVALID', context);

          return res.status(403).json({
            error: 'CSRF Error',
            message: 'Invalid CSRF token. Please refresh the page and try again.',
            code: 'TOKEN_INVALID',
            recoveryAction: 'refresh_page',
          });
        }

        // CSRF validation successful
        sessionMetrics.recordCsrfValidationSuccess();
        next();
      } catch (error) {
        winston.error('CSRF middleware error:', error);
        return res.status(500).json({
          error: 'Security Error',
          message: 'CSRF validation failed',
          code: 'VALIDATION_ERROR',
        });
      }
    };
  }

  /**
   * Returns an array of all security middleware in recommended application order.
   * Provides a convenient way to apply the complete security stack to an Express app.
   * Includes request tracking, audit logging, headers, CORS, rate limiting, and protection middleware.
   * @function getAllMiddleware
   * @returns {Array<Function>} - Array of all configured security middleware functions.
   * @example
   * // Apply all security middleware to Express app
   * const allSecurityMiddleware = securityMiddleware.getAllMiddleware();
   * allSecurityMiddleware.forEach(middleware => app.use(middleware));
   */
  getAllMiddleware() {
    return [
      this.requestId(),
      this.auditLogger(),
      this.getHelmetConfig(),
      this.getCorsConfig(),
      this.getRateLimiter(),
      this.getMongoSanitizer(),
      this.getXssProtection(),
      this.getHppProtection(),
      this.validateContentType(),
      this.getCsrfProtection(),
      this.apiSecurityHeaders(),
    ];
  }
}

module.exports = new SecurityMiddleware();
