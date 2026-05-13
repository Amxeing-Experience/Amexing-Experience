const express = require('express');

const router = express.Router();
const rateLimit = require('express-rate-limit');

// Import middleware
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

// Import controller
const greeterRateController = require('../../../application/controllers/api/GreeterRateController');

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
 * Greeter Rate API Routes.
 *
 * All routes require JWT authentication
 * Read operations: Department Manager level (level 4+)
 * Write operations: Admin level (level 6+)
 * Provides endpoints for:
 * - DataTables server-side processing
 * - CRUD operations for greeter rates
 * - Current rate retrieval with auto-creation
 * - Formula configuration and simulation.
 *
 * Created by Denisse Maldonado.
 */

// Apply JWT authentication to all routes
router.use(jwtMiddleware.authenticateToken);

// GET /api/greeter-rate/current - Get current active greeter rate
router.get(
  '/current',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(2), // Driver level and above (includes client, department_manager, admin, superadmin)
  (req, res) => greeterRateController.getCurrent(req, res)
);

// GET /api/greeter-rate/history - DataTables endpoint for history
router.get(
  '/history',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => greeterRateController.getHistory(req, res)
);

// GET /api/greeter-rate/formula - Get current formula configuration
// MUST be defined before /:id route to avoid matching "formula" as an ID
router.get(
  '/formula',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => greeterRateController.getFormulaConfiguration(req, res)
);

// GET /api/greeter-rate/:id - Get specific greeter rate by ID
router.get(
  '/:id',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => greeterRateController.getById(req, res)
);

// PUT /api/greeter-rate/formula - Update formula configuration
router.put(
  '/formula',
  writeRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => greeterRateController.updateFormulaConfiguration(req, res)
);

// POST /api/greeter-rate/simulate - Simulate formula calculation
router.post(
  '/simulate',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => greeterRateController.simulateCalculation(req, res)
);

// POST /api/greeter-rate - Create new greeter rate (replaces active one)
router.post(
  '/',
  writeRateLimit,
  jwtMiddleware.requireRoleLevel(6), // Admin level and above
  (req, res) => greeterRateController.create(req, res)
);

// Error handling middleware for this router
router.use((error, req, res, _next) => {
  const logger = require('../../../infrastructure/logger');
  logger.error('GreeterRate API Error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error in greeter rate API',
  });
});

module.exports = router;
