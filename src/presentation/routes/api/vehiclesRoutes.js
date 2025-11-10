/**
 * Vehicles API Routes - RESTful endpoints for vehicle fleet management.
 *
 * Provides Ajax-ready API endpoints for managing vehicle inventory.
 * Read operations available to authenticated admins, write operations restricted to Admin/SuperAdmin.
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
 * router.use('/vehicles', vehiclesRoutes);
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const VehicleController = require('../../../application/controllers/api/VehicleController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();

// Rate limiting for vehicle operations
const vehicleApiLimiter = rateLimit({
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
router.use(vehicleApiLimiter);

// =================
// READ ROUTES (require admin authentication)
// =================

/**
 * GET /api/vehicles - Get vehicles with DataTables server-side processing.
 *
 * Access: Department Manager (level 4+), Admin, SuperAdmin
 * Returns: Paginated list of vehicles with VehicleType information.
 */
router.get(
  '/',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager and above
  (req, res) => VehicleController.getVehicles(req, res)
);

/**
 * GET /api/vehicles/:id - Get single vehicle by ID.
 *
 * Access: Department Manager (level 4+), Admin, SuperAdmin
 * Returns: Vehicle details with VehicleType information.
 */
router.get(
  '/:id',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager and above
  (req, res) => VehicleController.getVehicleById(req, res)
);

// =================
// WRITE ROUTES (require admin/superadmin)
// =================

/**
 * POST /api/vehicles - Create new vehicle.
 *
 * Access: Admin (level 6+)
 * Body: { brand, model, year, licensePlate, vehicleTypeId, capacity, color, maintenanceStatus, insuranceExpiry? }
 * Returns: Created vehicle.
 */
router.post(
  '/',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => VehicleController.createVehicle(req, res)
);

/**
 * PUT /api/vehicles/:id - Update vehicle.
 *
 * Access: Admin (level 6+)
 * Body: { brand?, model?, year?, licensePlate?, vehicleTypeId?, capacity?, color?, maintenanceStatus?, insuranceExpiry?, active? }
 * Returns: Updated vehicle.
 */
router.put(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => VehicleController.updateVehicle(req, res)
);

/**
 * DELETE /api/vehicles/:id - Soft delete vehicle.
 *
 * Access: Admin (level 6+) and SuperAdmin
 * Returns: Success message.
 *
 * Note: Checks if vehicle has active bookings before deletion (future validation).
 */
router.delete(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => VehicleController.deleteVehicle(req, res)
);

module.exports = router;
