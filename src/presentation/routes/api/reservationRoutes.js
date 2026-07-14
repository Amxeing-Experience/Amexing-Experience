/**
 * Reservation API Routes
 * Follows quotesRoutes.js pattern.
 * @author Denisse Maldonado
 * @version 1.0.0
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const ReservationController = require('../../../application/controllers/api/ReservationController');
const PaymentController = require('../../../application/controllers/api/PaymentController');
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

// Payments — nivel 4+ (agencia `department_manager` + agente `client`, además de admin/superadmin), igual
// que el resto de la superficie de reservación (ver/asignar/cancelar). Adjustments siguen admin-only por
// ser acción de pricing de Amexing. Nivel 4 (no 5) para incluir a la agencia — ver "niveles invertidos" en CLAUDE.md.
/**
 * GET /api/reservations/:id/payments — List payments + summary (agencia+ / admin).
 */
router.get(
  '/:id/payments',
  readOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4),
  (req, res) => PaymentController.getPayments(req, res)
);

/**
 * POST /api/reservations/:id/payments — Register a payment (agencia+ / admin).
 */
router.post(
  '/:id/payments',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4),
  (req, res) => PaymentController.addPayment(req, res)
);

/**
 * PUT /api/reservations/:id/payments/:paymentId — Edit a payment (agencia+ / admin).
 */
router.put(
  '/:id/payments/:paymentId',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4),
  (req, res) => PaymentController.updatePayment(req, res)
);

/**
 * DELETE /api/reservations/:id/payments/:paymentId — Delete a payment (agencia+ / admin).
 */
router.delete(
  '/:id/payments/:paymentId',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4),
  (req, res) => PaymentController.deletePayment(req, res)
);

/**
 * POST /api/reservations/:id/payments/:paymentId/receipt — Upload/replace a payment receipt
 * (agencia+ / admin). Separate from create/update so a slow S3 upload never blocks the save.
 */
router.post(
  '/:id/payments/:paymentId/receipt',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4),
  (req, res) => PaymentController.uploadReceipt(req, res)
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
 * PUT /api/reservations/:id/status — Manually set reservation status (confirmed/hold).
 */
router.put(
  '/:id/status',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4),
  (req, res) => ReservationController.setReservationStatus(req, res)
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

/**
 * POST /api/reservations/:id/revert-to-quote — Regresa una reservación a cotización
 * (deshace una conversión hecha por error). SOLO admin/superadmin: acción destructiva.
 */
router.post(
  '/:id/revert-to-quote',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRole(['admin', 'superadmin']),
  (req, res) => ReservationController.revertToQuote(req, res)
);

module.exports = router;
