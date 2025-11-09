/**
 * POI API Routes - RESTful endpoints for Point of Interest management.
 *
 * Provides Ajax-ready API endpoints for managing POI definitions.
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
 * @since 2024-01-15
 * @example
 * // Usage
 * router.use('/pois', poisRoutes);
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const POIController = require('../../../application/controllers/api/POIController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();

// Rate limiting for POI operations
const poiApiLimiter = rateLimit({
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
router.use(poiApiLimiter);

// =================
// PUBLIC/READ ROUTES (require authentication only)
// =================

/**
 * GET /api/pois - Get POIs with DataTables server-side processing.
 *
 * Access: Authenticated users (admin, superadmin)
 * Returns: Paginated list of POIs.
 */
router.get(
  '/',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => POIController.getPOIs(req, res)
);

/**
 * GET /api/pois/active - Get active POIs for dropdowns.
 *
 * Access: Authenticated users
 * Returns: Simple array of {value, label} for select options.
 *
 * This endpoint is optimized for dropdown/select elements and returns
 * only active POIs in a simplified format.
 */
router.get('/active', jwtMiddleware.authenticateToken, (req, res) => POIController.getActivePOIs(req, res));

/**
 * GET /api/pois/:id - Get single POI by ID.
 *
 * Access: Authenticated users (admin, superadmin)
 * Returns: POI details.
 */
router.get(
  '/:id',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => POIController.getPOIById(req, res)
);

// =================
// WRITE ROUTES (require admin/superadmin)
// =================

/**
 * POST /api/pois - Create new POI.
 *
 * Access: Admin (level 6+)
 * Body: { name }
 * Returns: Created POI.
 */
router.post(
  '/',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => POIController.createPOI(req, res)
);

/**
 * PATCH /api/pois/:id/toggle-status - Toggle active/inactive status.
 *
 * Access: Admin (level 6+)
 * Body: { active: boolean }
 * Returns: Updated POI with new status.
 */
router.patch(
  '/:id/toggle-status',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => POIController.togglePOIStatus(req, res)
);

/**
 * PUT /api/pois/:id - Update POI.
 *
 * Access: Admin (level 6+)
 * Body: { name?, active? }
 * Returns: Updated POI.
 */
router.put(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => POIController.updatePOI(req, res)
);

/**
 * DELETE /api/pois/:id - Soft delete POI.
 *
 * Access: Admin (level 6+)
 * Returns: Success message.
 */
router.delete(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => POIController.deletePOI(req, res)
);

module.exports = router;
