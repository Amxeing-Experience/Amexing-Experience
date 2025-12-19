const express = require('express');

const router = express.Router();
const rateLimit = require('express-rate-limit');

// Import middleware
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

// Import controller
const inflationRateController = require('../../../application/controllers/api/InflationRateController');

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
 * Inflation Rate API Routes.
 *
 * All routes require JWT authentication and Admin role (level 6+)
 * Provides endpoints for:
 * - DataTables server-side processing
 * - CRUD operations for inflation rates
 * - Current rate retrieval.
 *
 * Created by Denisse Maldonado.
 */

// Apply JWT authentication to all routes
router.use(jwtMiddleware.authenticateToken);

// GET /api/inflation-rate/current - Get current active inflation rate
router.get(
  '/current',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => inflationRateController.getCurrent(req, res)
);

// GET /api/inflation-rate/history - DataTables endpoint for history
router.get(
  '/history',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => inflationRateController.getHistory(req, res)
);

// GET /api/inflation-rate/:id - Get specific inflation rate by ID
router.get(
  '/:id',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => inflationRateController.getById(req, res)
);

// POST /api/inflation-rate - Create new inflation rate (replaces active one)
router.post(
  '/',
  writeRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => inflationRateController.create(req, res)
);

// Error handling middleware for this router
router.use((error, req, res, _next) => {
  console.error('InflationRate API Error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error in inflation rate API',
  });
});

module.exports = router;
