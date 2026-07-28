const express = require('express');

const router = express.Router();
const rateLimit = require('express-rate-limit');

// Import middleware
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

// Import controller
const SettingsController = require('../../../application/controllers/api/SettingsController');

const settingsController = new SettingsController();

// Rate limiting - more restrictive for write operations
const readRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute for read operations
  message: { success: false, error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const writeRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute for write operations
  message: { success: false, error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Settings API Routes.
 *
 * All routes require JWT authentication
 * Read operations: Admin level (level 6+)
 * Write operations: Admin level (level 6+)
 * Provides endpoints for:
 * - Cash rounding setting management
 * - Pricing settings retrieval.
 *
 * Created by Denisse Maldonado.
 */

// Apply JWT authentication to all routes
router.use(jwtMiddleware.authenticateToken);

// Add route-level logging middleware
router.use((req, res, next) => {
  console.log(`🔧 Settings API Route: ${req.method} ${req.originalUrl}`, {
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
    userAgent: req.get('User-Agent'),
    headers: {
      authorization: req.get('Authorization') ? 'Bearer ***' : 'No auth header',
      contentType: req.get('Content-Type'),
    },
    body: req.method === 'PUT' || req.method === 'POST' ? req.body : undefined,
  });
  next();
});

// GET /api/settings/cash-rounding - Get cash rounding setting
router.get(
  '/cash-rounding',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => {
    console.log('🔧 GET /cash-rounding - Calling controller...');
    settingsController.getCashRoundingSetting(req, res);
  }
);

// PUT /api/settings/cash-rounding - Update cash rounding setting
router.put(
  '/cash-rounding',
  writeRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => {
    console.log('🔧 PUT /cash-rounding - Calling controller...', { enabled: req.body.enabled });
    settingsController.updateCashRoundingSetting(req, res);
  }
);

// GET /api/settings/active-gateway - Get active payment gateway toggle (MXN)
router.get(
  '/active-gateway',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Treasury-global lever: admin level and above
  (req, res) => settingsController.getActivePaymentGateway(req, res)
);

// PUT /api/settings/active-gateway - Update active payment gateway toggle (MXN)
router.put(
  '/active-gateway',
  writeRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Treasury-global lever: admin level and above
  (req, res) => settingsController.updateActivePaymentGateway(req, res)
);

// GET /api/settings/pricing - Get all pricing-related settings
router.get(
  '/pricing',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => settingsController.getPricingSettings(req, res)
);

// Error handling middleware for this router
router.use((error, req, res, _next) => {
  console.error('Settings API Error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error in settings API',
  });
});

module.exports = router;
