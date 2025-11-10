/**
 * Vehicle Types API Routes - RESTful endpoints for vehicle type catalog management.
 *
 * Provides Ajax-ready API endpoints for managing vehicle type definitions.
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
 * router.use('/vehicle-types', vehicleTypesRoutes);
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const VehicleTypeController = require('../../../application/controllers/api/VehicleTypeController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();

// Rate limiting for vehicle type operations
const vehicleTypeApiLimiter = rateLimit({
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
router.use(vehicleTypeApiLimiter);

// =================
// PUBLIC/READ ROUTES (require authentication only)
// =================

/**
 * GET /api/vehicle-types - Get vehicle types with DataTables server-side processing.
 *
 * Access: Authenticated users (admin, superadmin)
 * Returns: Paginated list of vehicle types.
 */
router.get(
  '/',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => VehicleTypeController.getVehicleTypes(req, res)
);

/**
 * GET /api/vehicle-types/active - Get active vehicle types for dropdowns.
 *
 * Access: Authenticated users
 * Returns: Simple array of {value, label, capacity, icon} for select options.
 *
 * This endpoint is optimized for dropdown/select elements and returns
 * only active vehicle types in a simplified format.
 */
router.get('/active', jwtMiddleware.authenticateToken, (req, res) => VehicleTypeController.getActiveVehicleTypes(req, res));

/**
 * GET /api/vehicle-types/:id - Get single vehicle type by ID.
 *
 * Access: Authenticated users (admin, superadmin)
 * Returns: Vehicle type details.
 */
router.get(
  '/:id',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => VehicleTypeController.getVehicleTypeById(req, res)
);

// =================
// WRITE ROUTES (require admin/superadmin)
// =================

/**
 * POST /api/vehicle-types - Create new vehicle type.
 *
 * Access: Admin (level 6+)
 * Body: { name, code, description?, icon?, defaultCapacity?, sortOrder? }
 * Returns: Created vehicle type.
 */
router.post(
  '/',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => VehicleTypeController.createVehicleType(req, res)
);

/**
 * PATCH /api/vehicle-types/:id/toggle-status - Toggle active/inactive status.
 *
 * Access: Admin (level 6+)
 * Body: { active: boolean }
 * Returns: Updated vehicle type with new status.
 */
router.patch(
  '/:id/toggle-status',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => VehicleTypeController.toggleVehicleTypeStatus(req, res)
);

/**
 * PUT /api/vehicle-types/:id - Update vehicle type.
 *
 * Access: Admin (level 6+)
 * Body: { name?, code?, description?, icon?, defaultCapacity?, sortOrder?, active? }
 * Returns: Updated vehicle type.
 */
router.put(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => VehicleTypeController.updateVehicleType(req, res)
);

/**
 * DELETE /api/vehicle-types/:id - Soft delete vehicle type.
 *
 * Access: Admin (level 6+) - Changed from SuperAdmin only
 * Returns: Success message.
 *
 * Note: Checks if any vehicles are using this type before deletion.
 */
router.delete(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above (changed from 7)
  (req, res) => VehicleTypeController.deleteVehicleType(req, res)
);

module.exports = router;
