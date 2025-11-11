/**
 * Service Types API Routes - RESTful endpoints for service type catalog management.
 *
 * Provides Ajax-ready API endpoints for managing service type definitions.
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
 * router.use('/service-types', serviceTypesRoutes);
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const ServiceTypeController = require('../../../application/controllers/api/ServiceTypeController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();

// Rate limiting for service type operations
const serviceTypeApiLimiter = rateLimit({
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
router.use(serviceTypeApiLimiter);

// =================
// PUBLIC/READ ROUTES (require authentication only)
// =================

/**
 * GET /api/service-types - Get service types with DataTables server-side processing.
 *
 * Access: Authenticated users (admin, superadmin)
 * Returns: Paginated list of service types.
 */
router.get(
  '/',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager and above
  (req, res) => ServiceTypeController.getServiceTypes(req, res)
);

/**
 * GET /api/service-types/active - Get active service types for dropdowns.
 *
 * Access: Authenticated users
 * Returns: Simple array of {value, label} for select options.
 *
 * This endpoint is optimized for dropdown/select elements and returns
 * only active service types in a simplified format.
 */
router.get('/active', jwtMiddleware.authenticateToken, (req, res) => ServiceTypeController.getActiveServiceTypes(req, res));

/**
 * GET /api/service-types/:id - Get single service type by ID.
 *
 * Access: Authenticated users (admin, superadmin)
 * Returns: Service type details.
 */
router.get(
  '/:id',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager and above
  (req, res) => ServiceTypeController.getServiceTypeById(req, res)
);

// =================
// WRITE ROUTES (require admin/superadmin)
// =================

/**
 * POST /api/service-types - Create new service type.
 *
 * Access: Admin (level 6+)
 * Body: { name }
 * Returns: Created service type.
 */
router.post(
  '/',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => ServiceTypeController.createServiceType(req, res)
);

/**
 * PATCH /api/service-types/:id/toggle-status - Toggle active/inactive status.
 *
 * Access: Admin (level 6+)
 * Body: { active: boolean }
 * Returns: Updated service type with new status.
 */
router.patch(
  '/:id/toggle-status',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => ServiceTypeController.toggleServiceTypeStatus(req, res)
);

/**
 * PUT /api/service-types/:id - Update service type.
 *
 * Access: Admin (level 6+)
 * Body: { name?, active? }
 * Returns: Updated service type.
 */
router.put(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => ServiceTypeController.updateServiceType(req, res)
);

/**
 * DELETE /api/service-types/:id - Soft delete service type.
 *
 * Access: Admin (level 6+)
 * Returns: Success message.
 *
 * Note: Checks if any services are using this type before deletion.
 */
router.delete(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => ServiceTypeController.deleteServiceType(req, res)
);

module.exports = router;
