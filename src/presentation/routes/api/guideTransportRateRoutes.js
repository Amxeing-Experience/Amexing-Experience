const express = require('express');

const router = express.Router();
const rateLimit = require('express-rate-limit');

// Import middleware
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

// Import controller
const guideTransportRateController = require('../../../application/controllers/api/GuideTransportRateController');

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
 * Guide Transport Rate API Routes.
 *
 * All routes require JWT authentication
 * Read operations: Department Manager level (level 4+)
 * Write operations: Admin level (level 6+)
 * Provides endpoints for:
 * - DataTables server-side processing
 * - CRUD operations for guide transport rates
 * - Current rate retrieval with auto-creation.
 *
 * Created by Denisse Maldonado.
 */

// Apply JWT authentication to all routes
router.use(jwtMiddleware.authenticateToken);

// GET /api/guide-transport-rate/current - Get current active guide transport rate
router.get(
  '/current',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(2), // Driver level and above (includes client, department_manager, admin, superadmin)
  (req, res) => guideTransportRateController.getCurrent(req, res)
);

// GET /api/guide-transport-rate/history - DataTables endpoint for history
router.get(
  '/history',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => guideTransportRateController.getHistory(req, res)
);

// GET /api/guide-transport-rate/formula - Get current formula configuration
// MUST be defined before /:id route to avoid matching "formula" as an ID
router.get(
  '/formula',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(2), // Driver level and above (includes client, department_manager, admin, superadmin)
  (req, res) => guideTransportRateController.getFormulaConfiguration(req, res)
);

// GET /api/guide-transport-rate/:id - Get specific guide transport rate by ID
router.get(
  '/:id',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => guideTransportRateController.getById(req, res)
);

// PUT /api/guide-transport-rate/formula - Update formula configuration
router.put(
  '/formula',
  writeRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => guideTransportRateController.updateFormulaConfiguration(req, res)
);

// POST /api/guide-transport-rate/simulate - Simulate formula calculation
router.post(
  '/simulate',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => guideTransportRateController.simulateCalculation(req, res)
);

// POST /api/guide-transport-rate - Create new guide transport rate (replaces active one)
router.post(
  '/',
  writeRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => guideTransportRateController.create(req, res)
);

// Error handling middleware for this router
router.use((error, req, res, _next) => {
  const logger = require('../../../infrastructure/logger');
  logger.error('GuideTransportRate API Error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error in guide transport rate API',
  });
});

module.exports = router;
