/**
 * Reservation API Routes
 * Follows quotesRoutes.js pattern.
 * @author Denisse Maldonado
 * @version 1.0.0
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const ReservationController = require('../../../application/controllers/api/ReservationController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();

const readOperationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 400,
  message: {
    success: false,
    error: 'Demasiadas solicitudes, por favor intente nuevamente más tarde',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const writeOperationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: {
    success: false,
    error: 'Demasiadas solicitudes, por favor intente nuevamente más tarde',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * GET /api/reservations — List reservations (DataTables server-side).
 */
router.get(
  '/',
  readOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4),
  (req, res) => ReservationController.getReservations(req, res)
);

/**
 * GET /api/reservations/:id — Get reservation detail with services.
 */
router.get(
  '/:id',
  readOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4),
  (req, res) => ReservationController.getReservationById(req, res)
);

/**
 * PUT /api/reservations/:id/services/batch-assign — Batch assign employees/vehicle to multiple services.
 */
router.put(
  '/:id/services/batch-assign',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4),
  (req, res) => ReservationController.batchAssignEmployees(req, res)
);

/**
 * PUT /api/reservations/:id/services/:serviceId/assign — Assign employees/vehicle.
 */
router.put(
  '/:id/services/:serviceId/assign',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4),
  (req, res) => ReservationController.assignEmployee(req, res)
);

/**
 * PUT /api/reservations/:id/service-customer — Assign service customer at reservation level.
 */
router.put(
  '/:id/service-customer',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4),
  (req, res) => ReservationController.assignServiceCustomer(req, res)
);

/**
 * POST /api/reservations/:id/adjustments — Add extra charge or discount (admin only).
 */
router.post(
  '/:id/adjustments',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRole(['admin', 'superadmin']),
  (req, res) => ReservationController.addAdjustment(req, res)
);

/**
 * DELETE /api/reservations/:id/adjustments/:adjustmentId — Remove adjustment (admin only).
 */
router.delete(
  '/:id/adjustments/:adjustmentId',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRole(['admin', 'superadmin']),
  (req, res) => ReservationController.removeAdjustment(req, res)
);

/**
 * PATCH /api/reservations/:id/services/:serviceId/status — Update service status.
 */
router.patch(
  '/:id/services/:serviceId/status',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4),
  (req, res) => ReservationController.updateServiceStatus(req, res)
);

/**
 * POST /api/reservations/:id/cancel — Cancel reservation.
 */
router.post(
  '/:id/cancel',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4),
  (req, res) => ReservationController.cancelReservation(req, res)
);

module.exports = router;
