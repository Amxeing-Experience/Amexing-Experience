const express = require('express');

const router = express.Router();
const rateLimit = require('express-rate-limit');

// Import middleware
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

// Import controller
const driverTourRateController = require('../../../application/controllers/api/DriverTourRateController');

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
 * Driver Tour Rate API Routes.
 *
 * All routes require JWT authentication
 * Read operations: Department Manager level (level 4+)
 * Write operations: Admin level (level 6+)
 * Provides endpoints for:
 * - DataTables server-side processing
 * - CRUD operations for driver tour rates
 * - Current rate retrieval.
 *
 * Created by Denisse Maldonado.
 */

// Apply JWT authentication to all routes
router.use(jwtMiddleware.authenticateToken);

// GET /api/driver-tour-rate/current - Get current active driver tour rate
router.get(
  '/current',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(2), // Driver level and above (includes client, department_manager, admin, superadmin)
  (req, res) => driverTourRateController.getCurrent(req, res)
);

// GET /api/driver-tour-rate/history - DataTables endpoint for history
router.get(
  '/history',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => driverTourRateController.getHistory(req, res)
);

// GET /api/driver-tour-rate/:id - Get specific driver tour rate by ID
router.get(
  '/:id',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => driverTourRateController.getById(req, res)
);

// POST /api/driver-tour-rate - Create new driver tour rate (replaces active one)
router.post(
  '/',
  writeRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => driverTourRateController.create(req, res)
);

// Error handling middleware for this router
router.use((error, req, res, _next) => {
  const logger = require('../../../infrastructure/logger');
  logger.error('DriverTourRate API Error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error in driver tour rate API',
  });
});

module.exports = router;
