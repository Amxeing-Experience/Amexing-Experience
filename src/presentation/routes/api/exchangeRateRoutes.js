const express = require('express');

const router = express.Router();
const rateLimit = require('express-rate-limit');

// Import middleware
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

// Import controller
const exchangeRateController = require('../../../application/controllers/api/ExchangeRateController');

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
 * Exchange Rate API Routes.
 *
 * All routes require JWT authentication
 * Read operations: Department Manager level (level 4+)
 * Write operations: Admin level (level 6+)
 * Provides endpoints for:
 * - DataTables server-side processing
 * - CRUD operations for exchange rates
 * - Current rate retrieval.
 *
 * Created by Denisse Maldonado.
 */

// Apply JWT authentication to all routes
router.use(jwtMiddleware.authenticateToken);

// GET /api/exchange-rate/current - Get current active exchange rate
router.get(
  '/current',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(4), // Department Manager level and above
  (req, res) => exchangeRateController.getCurrent(req, res)
);

// GET /api/exchange-rate/history - DataTables endpoint for history
router.get(
  '/history',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => exchangeRateController.getHistory(req, res)
);

// GET /api/exchange-rate/:id - Get specific exchange rate by ID
router.get(
  '/:id',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => exchangeRateController.getById(req, res)
);

// POST /api/exchange-rate - Create new exchange rate (replaces active one)
router.post(
  '/',
  writeRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => exchangeRateController.create(req, res)
);

// Error handling middleware for this router
router.use((error, req, res, _next) => {
  console.error('ExchangeRate API Error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error in exchange rate API',
  });
});

module.exports = router;
