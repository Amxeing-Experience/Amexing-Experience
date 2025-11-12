/**
 * Rate API Routes - RESTful endpoints for pricing rates management.
 *
 * Provides Ajax-ready API endpoints for managing pricing rates catalog.
 * Read operations available to authenticated users, write operations restricted to Admin/SuperAdmin.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE)
 * - Role-based access control
 * - DataTables server-side integration
 * - Rate limiting and security headers
 * - Comprehensive error handling.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Usage
 * router.use('/rates', ratesRoutes);
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const RateController = require('../../../application/controllers/api/RateController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();

// Rate limiting for Rate operations
const rateApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Higher limit for read-heavy operations
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
  max: 30, // Limit write operations
  message: {
    success: false,
    error: 'Too many modification requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all routes
router.use(rateApiLimiter);

// =================
// PUBLIC/READ ROUTES (require authentication only)
// =================

/**
 * GET /api/rates - Get Rates with DataTables server-side processing.
 *
 * Access: Authenticated users (admin, superadmin)
 * Returns: Paginated list of Rates.
 */
router.get(
  '/',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager and above
  (req, res) => RateController.getRates(req, res)
);

/**
 * GET /api/rates/active - Get active Rates for dropdowns.
 *
 * Access: Authenticated users
 * Returns: Simple array of {value, label, percentage, formattedPercentage} for select options.
 *
 * This endpoint is optimized for dropdown/select elements and returns
 * only active Rates in a simplified format.
 */
router.get('/active', jwtMiddleware.authenticateToken, (req, res) => RateController.getActiveRates(req, res));

/**
 * GET /api/rates/:id - Get single Rate by ID.
 *
 * Access: Authenticated users (admin, superadmin)
 * Returns: Rate details.
 */
router.get(
  '/:id',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager and above
  (req, res) => RateController.getRateById(req, res)
);

// =================
// WRITE ROUTES (require admin/superadmin)
// =================

/**
 * POST /api/rates - Create new Rate.
 *
 * Access: Admin (level 6+)
 * Body: { name, percentage }
 * Returns: Created Rate.
 */
router.post(
  '/',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => RateController.createRate(req, res)
);

/**
 * PATCH /api/rates/:id/toggle-status - Toggle active/inactive status.
 *
 * Access: Admin (level 6+)
 * Body: { active: boolean }
 * Returns: Updated Rate with new status.
 */
router.patch(
  '/:id/toggle-status',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => RateController.toggleRateStatus(req, res)
);

/**
 * PUT /api/rates/:id - Update Rate.
 *
 * Access: Admin (level 6+)
 * Body: { name?, percentage?, active? }
 * Returns: Updated Rate.
 */
router.put(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => RateController.updateRate(req, res)
);

/**
 * DELETE /api/rates/:id - Soft delete Rate.
 *
 * Access: Admin (level 6+)
 * Returns: Success message.
 */
router.delete(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => RateController.deleteRate(req, res)
);

module.exports = router;
