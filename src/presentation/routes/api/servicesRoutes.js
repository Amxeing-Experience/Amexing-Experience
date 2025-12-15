/**
 * Service API Routes - RESTful endpoints for transportation service management.
 *
 * Provides Ajax-ready API endpoints for managing service catalog.
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
 * router.use('/services', servicesRoutes);
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const ServicesController = require('../../../application/controllers/api/ServicesController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();

// Rate limiting for service operations
const serviceApiLimiter = rateLimit({
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
router.use(serviceApiLimiter);

// =================
// PUBLIC/READ ROUTES (require authentication only)
// =================

/**
 * GET /api/services - Get services with DataTables server-side processing.
 *
 * Access: Authenticated users (admin, superadmin)
 * Returns: Paginated list of services.
 */
router.get(
  '/',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager and above
  (req, res) => ServicesController.getServices(req, res)
);

/**
 * GET /api/services/active - Get active services for dropdowns.
 *
 * Access: Authenticated users
 * Returns: Simple array of {value, label} for select options.
 *
 * This endpoint is optimized for dropdown/select elements and returns
 * only active services in a simplified format.
 */
router.get('/active', jwtMiddleware.authenticateToken, (req, res) => ServicesController.getActiveServices(req, res));

/**
 * GET /api/services/with-rate-prices - Get services with prices for a specific rate.
 *
 * Access: Authenticated users (department manager and above)
 * Query: rateId (required)
 * Returns: Services with their prices for the specified rate.
 */
router.get(
  '/with-rate-prices',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager and above
  (req, res) => ServicesController.getServicesWithRatePrices(req, res)
);

/**
 * GET /api/services/:id/all-rate-prices - Get all rate prices for a specific service.
 *
 * Access: Authenticated users (department manager and above)
 * Returns: All rate prices for the service.
 */
router.get(
  '/:id/all-rate-prices',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager and above
  (req, res) => ServicesController.getAllRatePricesForService(req, res)
);

/**
 * GET /api/services/:id - Get single service by ID.
 *
 * Access: Authenticated users (admin, superadmin)
 * Returns: Service details.
 */
router.get(
  '/:id',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager and above
  (req, res) => ServicesController.getServiceById(req, res)
);

// =================
// WRITE ROUTES (require admin/superadmin)
// =================

/**
 * POST /api/services - Create new service.
 *
 * Access: Admin (level 6+)
 * Body: { originPOI, destinationPOI, vehicleType, note, price }
 * Returns: Created service.
 */
router.post(
  '/',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => ServicesController.createService(req, res)
);

/**
 * PATCH /api/services/:id/toggle-status - Toggle active/inactive status.
 *
 * Access: Admin (level 6+)
 * Body: { active: boolean }
 * Returns: Updated service with new status.
 */
router.patch(
  '/:id/toggle-status',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => ServicesController.toggleServiceStatus(req, res)
);

/**
 * PUT /api/services/:id - Update service.
 *
 * Access: Admin (level 6+)
 * Body: { originPOI?, destinationPOI?, vehicleType?, note?, price?, active? }
 * Returns: Updated service.
 */
router.put(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => ServicesController.updateService(req, res)
);

/**
 * DELETE /api/services/:id - Soft delete service.
 *
 * Access: Admin (level 6+)
 * Returns: Success message.
 */
router.delete(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => ServicesController.deleteService(req, res)
);

/**
 * POST /api/services/client-prices - Save client-specific prices for a service.
 *
 * Access: Admin (level 6+)
 * Body: { clientId, serviceId, prices: [{ ratePtr, vehiclePtr, precio, basePrice }] }
 * Returns: Success message with saved count.
 */
router.post(
  '/client-prices',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => ServicesController.saveClientPrices(req, res)
);

module.exports = router;
