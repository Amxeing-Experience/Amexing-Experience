/**
 * Payment Info API Routes
 * Manages payment information for receipts (Admin/SuperAdmin only).
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const PaymentInfoController = require('../../../application/controllers/api/PaymentInfoController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();

/**
 * Rate limiter for read operations (GET)
 * 100 requests per 15 minutes per IP.
 */
const readOperationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: 'Demasiadas solicitudes, por favor intente nuevamente más tarde',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for write operations (POST, PUT, DELETE)
 * 30 requests per 15 minutes per IP.
 */
const writeOperationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 30 requests per windowMs
  message: {
    success: false,
    error: 'Demasiadas solicitudes, por favor intente nuevamente más tarde',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply JWT authentication to all routes
router.use(jwtMiddleware.authenticateToken);

/**
 * GET /api/payment-info - Get all payment info options.
 * Admin and SuperAdmin only.
 */
router.get(
  '/',
  readOperationsLimiter,
  jwtMiddleware.requireRoleLevel(6), // Admin level
  PaymentInfoController.getAll
);

/**
 * GET /api/payment-info/default - Get default payment info.
 * Admin and SuperAdmin only.
 */
router.get(
  '/default',
  readOperationsLimiter,
  jwtMiddleware.requireRoleLevel(6), // Admin level
  PaymentInfoController.getDefault
);

/**
 * GET /api/payment-info/:id - Get payment info by ID.
 * Admin and SuperAdmin only.
 */
router.get(
  '/:id',
  readOperationsLimiter,
  jwtMiddleware.requireRoleLevel(6), // Admin level
  PaymentInfoController.getById
);

/**
 * POST /api/payment-info - Create new payment info.
 * Admin and SuperAdmin only.
 */
router.post(
  '/',
  writeOperationsLimiter,
  jwtMiddleware.requireRoleLevel(6), // Admin level
  PaymentInfoController.create
);

/**
 * PUT /api/payment-info/:id - Update payment info.
 * Admin and SuperAdmin only.
 */
router.put(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.requireRoleLevel(6), // Admin level
  PaymentInfoController.update
);

/**
 * POST /api/payment-info/:id/set-default - Set payment info as default.
 * Admin and SuperAdmin only.
 */
router.post(
  '/:id/set-default',
  writeOperationsLimiter,
  jwtMiddleware.requireRoleLevel(6), // Admin level
  PaymentInfoController.setAsDefault
);

/**
 * DELETE /api/payment-info/:id - Delete payment info.
 * Admin and SuperAdmin only.
 */
router.delete(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.requireRoleLevel(6), // Admin level
  PaymentInfoController.delete
);

module.exports = router;
