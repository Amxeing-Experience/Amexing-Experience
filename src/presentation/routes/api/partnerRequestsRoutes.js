/**
 * Partner Requests (admin) API Routes.
 *
 * Gestión de solicitudes de nuevos colaboradores/partners desde el panel admin.
 * Montado en `/api/partner-requests`. Solo Admin (nivel 6+).
 *   GET    /api/partner-requests            → lista + conteo de pendientes
 *   POST   /api/partner-requests/:id/convert   (marca aprobada + enlaza al cliente creado)
 *   POST   /api/partner-requests/:id/reject
 *
 * (La creación pública vive en POST /api/partner-request — singular — vía ApiController.)
 *
 * Created by Denisse Maldonado
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const partnerRequestController = require('../../../application/controllers/PartnerRequestController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();

const writeOperationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: {
    success: false,
    error: 'Too many modification requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get(
  '/',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6),
  (req, res) => partnerRequestController.apiList(req, res)
);

router.post(
  '/:id/convert',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6),
  (req, res) => partnerRequestController.apiConvert(req, res)
);

router.post(
  '/:id/reject',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6),
  (req, res) => partnerRequestController.apiReject(req, res)
);

module.exports = router;
