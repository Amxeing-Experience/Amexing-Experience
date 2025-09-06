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

class SecurityMiddleware {
  constructor() {
    this.isDevelopment = process.env.NODE_ENV === 'development';
    this.isProduction = process.env.NODE_ENV === 'production';

    // Initialize CSRF protection
    // eslint-disable-next-line new-cap
    this.csrfProtection = new csrf({
      saltLength: 32,
      secretLength: 64,
    });
  }

  // Helmet configuration for comprehensive security headers
  getHelmetConfig() {
    return helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://fonts.googleapis.com',
          ],
          scriptSrc: ["'self'", this.isDevelopment ? "'unsafe-inline'" : ''],
          imgSrc: ["'self'", 'data:', 'https:'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          connectSrc: ["'self'", 'http://localhost:1337'],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
          sandbox: ['allow-forms', 'allow-scripts', 'allow-same-origin'],
          reportUri: '/api/csp-report',
          upgradeInsecureRequests: this.isProduction ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: !this.isDevelopment,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
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

  // Rate limiting configuration
  getRateLimiter() {
    return rateLimit({
      windowMs:
        parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests:
        process.env.RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS === 'true',
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

  // Strict rate limiter for sensitive endpoints
  getStrictRateLimiter() {
    return rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: 'Too many attempts. Please try again later.',
      skipSuccessfulRequests: false,
    });
  }

  // API rate limiter
  getApiRateLimiter() {
    return rateLimit({
      windowMs: 1 * 60 * 1000,
      max: 30,
      message: 'API rate limit exceeded.',
      standardHeaders: true,
      legacyHeaders: false,
    });
  }

  // MongoDB injection prevention
  getMongoSanitizer() {
    return mongoSanitize({
      replaceWith: '_',
      onSanitize: ({ req, key }) => {
        winston.warn(
          `Attempted NoSQL injection from IP ${req.ip} on field ${key}`
        );
      },
    });
  }

  // XSS protection
  getXssProtection() {
    return xss();
  }

  // HTTP Parameter Pollution prevention
  getHppProtection() {
    return hpp({
      whitelist: ['sort', 'fields', 'page', 'limit'],
    });
  }

  // CORS configuration
  getCorsConfig() {
    const corsOptions = {
      origin: (origin, callback) => {
        const allowedOrigins = (
          process.env.CORS_ORIGIN || 'http://localhost:3000'
        ).split(',');

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
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Parse-Application-Id',
        'X-Parse-Session-Token',
      ],
      exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Per-Page'],
      maxAge: 86400,
      preflightContinue: false,
      optionsSuccessStatus: 204,
    };

    return cors(corsOptions);
  }

  // Session configuration
  // eslint-disable-next-line complexity
  getSessionConfig() {
    return session({
      secret:
        process.env.SESSION_SECRET || 'default-secret-change-in-production',
      name: 'amexing.sid',
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({
        mongoUrl:
          process.env.DATABASE_URI || 'mongodb://localhost:27017/amexingdb',
        collectionName: 'sessions',
        ttl: parseInt(process.env.SESSION_TIMEOUT_MINUTES, 10) * 60 || 900,
        autoRemove: 'native',
        crypto: {
          secret:
            process.env.SESSION_SECRET || 'default-secret-change-in-production',
        },
      }),
      cookie: {
        secure: process.env.NODE_ENV === 'production', // Explicit secure flag for HTTPS
        httpOnly: true,
        maxAge:
          parseInt(process.env.SESSION_TIMEOUT_MINUTES, 10) * 60 * 1000
          || 900000,
        expires: new Date(
          Date.now()
            + (parseInt(process.env.SESSION_TIMEOUT_MINUTES, 10) * 60 * 1000
              || 900000)
        ), // Explicit expires
        path: '/', // Explicit path configuration
        sameSite: this.isProduction ? 'strict' : 'lax',
        domain: this.isProduction ? process.env.COOKIE_DOMAIN : undefined,
      },
      rolling: true,
      unset: 'destroy',
    });
  }

  // Content Type validation middleware
  validateContentType() {
    return (req, res, next) => {
      if (
        req.method === 'POST'
        || req.method === 'PUT'
        || req.method === 'PATCH'
      ) {
        const contentType = req.headers['content-type'];
        if (
          !contentType
          || (!contentType.includes('application/json')
            && !contentType.includes('multipart/form-data'))
        ) {
          return res.status(400).json({
            error: 'Invalid Content-Type',
            message:
              'Content-Type must be application/json or multipart/form-data',
          });
        }
      }
      next();
    };
  }

  // Security headers for API responses
  apiSecurityHeaders() {
    return (req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate'
      );
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
      next();
    };
  }

  // IP whitelist middleware for admin routes
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

  // Request ID middleware for tracking
  requestId() {
    const { v4: uuidv4 } = require('uuid');
    return (req, res, next) => {
      req.id = req.headers['x-request-id'] || uuidv4();
      res.setHeader('X-Request-Id', req.id);
      next();
    };
  }

  // Audit logging middleware
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

  // CSRF protection middleware
  // eslint-disable-next-line max-lines-per-function
  getCsrfProtection() {
    // eslint-disable-next-line complexity,max-lines-per-function
    return async (req, res, next) => {
      try {
        // Skip CSRF for GET, HEAD, OPTIONS requests and API endpoints
        if (
          req.method === 'GET'
          || req.method === 'HEAD'
          || req.method === 'OPTIONS'
          || req.path.startsWith('/api/auth')
        ) {
          // Generate CSRF token for forms if session exists
          if (req.session && (req.method === 'GET' || req.method === 'HEAD')) {
            if (!req.session.csrfSecret) {
              req.session.csrfSecret = await uidSafe(32);
            }
            const token = this.csrfProtection.create(req.session.csrfSecret);
            res.locals.csrfToken = token;
          }
          return next();
        }

        // For state-changing requests, verify CSRF token
        const secret = req.session?.csrfSecret;
        if (!secret) {
          return res.status(403).json({
            error: 'CSRF Error',
            message: 'No CSRF secret found in session',
          });
        }

        const token = req.headers['x-csrf-token']
          || req.body.csrfToken
          || req.query.csrfToken;
        if (!token) {
          return res.status(403).json({
            error: 'CSRF Error',
            message: 'CSRF token missing',
          });
        }

        if (!this.csrfProtection.verify(secret, token)) {
          winston.warn('CSRF token verification failed', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            method: req.method,
            url: req.originalUrl,
          });

          return res.status(403).json({
            error: 'CSRF Error',
            message: 'Invalid CSRF token',
          });
        }

        next();
      } catch (error) {
        winston.error('CSRF middleware error:', error);
        return res.status(500).json({
          error: 'Security Error',
          message: 'CSRF validation failed',
        });
      }
    };
  }

  // Get all security middleware as an array
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
