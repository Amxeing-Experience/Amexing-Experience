/**
 * Price Adjustments API Routes - RESTful endpoints for price adjustment management.
 *
 * Provides Ajax-ready API endpoints for managing price adjustment factors.
 * All operations restricted to Admin level and above for security.
 *
 * Features:
 * - RESTful API design (GET, POST)
 * - Role-based access control (Admin level 6+)
 * - Rate limiting and security headers
 * - Historical tracking and current value management
 * - Comprehensive error handling.
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Usage
 * router.use('/price-adjustments', priceAdjustmentsRoutes);
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const PriceAdjustmentsController = require('../../../application/controllers/api/PriceAdjustmentsController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();

// Rate limiting for price adjustment operations
const priceAdjustmentApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Moderate limit for admin operations
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// More restrictive rate limiting for write operations
const writeOperationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Strict limit for modification operations
  message: {
    success: false,
    error: 'Too many modification requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all routes
router.use(priceAdjustmentApiLimiter);

// =================
// READ ROUTES (require admin level)
// =================

/**
 * GET /api/price-adjustments/current - Get all current adjustments.
 *
 * Access: Admin (level 6+)
 * Returns: Current active adjustments for all types.
 */
router.get(
  '/current',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => PriceAdjustmentsController.getAllCurrent(req, res)
);

/**
 * GET /api/price-adjustments/:type - Get adjustment history by type.
 *
 * Access: Admin (level 6+)
 * Returns: Historical list of adjustments for specified type.
 * Types: exchange-rate, inflation, agency, transfer.
 */
router.get(
  '/:type',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => PriceAdjustmentsController.getAdjustmentHistory(req, res)
);

/**
 * GET /api/price-adjustments/:type/current - Get current adjustment by type.
 *
 * Access: Admin (level 6+)
 * Returns: Current active adjustment for specified type.
 */
router.get(
  '/:type/current',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => PriceAdjustmentsController.getCurrentAdjustment(req, res)
);

// =================
// WRITE ROUTES (require admin level)
// =================

/**
 * POST /api/price-adjustments/:type - Create new price adjustment.
 *
 * Access: Admin (level 6+)
 * Body: { value, currency?, effectiveDate, note? }
 * Returns: Created adjustment.
 *
 * This automatically deactivates the previous adjustment and sets the new one as active.
 */
router.post(
  '/:type',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => PriceAdjustmentsController.createAdjustment(req, res)
);

module.exports = router;
