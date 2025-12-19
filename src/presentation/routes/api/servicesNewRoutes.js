/**
 * New Services Routes - API endpoints for simplified Services management.
 *
 * Provides RESTful routes for the simplified Services model.
 * All endpoints require authentication and appropriate permissions.
 *
 * Security:
 * - JWT authentication required for all endpoints
 * - Role-based access control (SuperAdmin/Admin for write operations)
 * - Input validation and sanitization
 * - Audit logging for all operations.
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const ServicesController = require('../../../application/controllers/api/ServicesController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();

// Rate limiting for services operations
const servicesApiLimiter = rateLimit({
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
router.use(servicesApiLimiter);

/**
 * GET /api/services-new - Get services with DataTables server-side processing.
 * @description Get services with DataTables server-side processing.
 * Access: Private (Authenticated users).
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 */
router.get(
  '/',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager and above
  (req, res) => {
    console.log('\n⚡ /api/services-new ROUTE CALLED (NEW ROUTE) ⚡');
    console.log(`  ClientId: ${req.query?.clientId}`);
    console.log(`  Timestamp: ${new Date().toISOString()}`);
    return ServicesController.getServices(req, res);
  }
);

/**
 * GET /api/services-new/:id - Get single service by ID.
 * @description Get single service by ID.
 * Access: Private (Authenticated users).
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 */
router.get(
  '/:id',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager and above
  (req, res) => ServicesController.getServiceById(req, res)
);

/**
 * GET /api/services-new/:id/prices - Get service pricing data.
 * @description Get pricing information for all rates available for this service.
 * Access: Private (Authenticated users).
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 */
router.get(
  '/:id/prices',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager and above
  (req, res) => ServicesController.getServicePrices(req, res)
);

/**
 * POST /api/services-new - Create new service.
 * @description Create new service.
 * Access: Private (Admin/SuperAdmin only).
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 */
router.post(
  '/',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => ServicesController.createService(req, res)
);

/**
 * PUT /api/services-new/:id - Update existing service.
 * @description Update existing service.
 * Access: Private (Admin/SuperAdmin only).
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 */
router.put(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => ServicesController.updateService(req, res)
);

/**
 * PATCH /api/services-new/:id/toggle-status - Toggle service active status.
 * @description Toggle service active status.
 * Access: Private (Admin/SuperAdmin only).
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 */
router.patch(
  '/:id/toggle-status',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => ServicesController.toggleServiceStatus(req, res)
);

/**
 * PATCH /api/services-new/:id/rate - Update service rate.
 * @description Update service rate.
 * Access: Private (Admin/SuperAdmin only).
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 */
router.patch(
  '/:id/rate',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => ServicesController.updateServiceRate(req, res)
);

/**
 * DELETE /api/services-new/:id - Soft delete service.
 * @description Soft delete service.
 * Access: Private (Admin/SuperAdmin only).
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 */
router.delete(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => ServicesController.deleteService(req, res)
);

module.exports = router;
