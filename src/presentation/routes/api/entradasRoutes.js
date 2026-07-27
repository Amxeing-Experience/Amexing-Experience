/**
 * Entradas API Routes - endpoints anidados de "Entradas" por destino.
 *
 * Montado en `/api/destinos`, expone:
 *   GET    /api/destinos/:destinoId/entradas       (nivel 4+: lectura)
 *   POST   /api/destinos/:destinoId/entradas       (nivel 6+: admin)
 *   PUT    /api/destinos/:destinoId/entradas/:id   (nivel 6+: admin)
 *   DELETE /api/destinos/:destinoId/entradas/:id   (nivel 6+: admin)
 *
 * El destino es un POI existente; la Entrada solo guarda nombre + precio.
 *
 * Created by Denisse Maldonado
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const EntradaController = require('../../../application/controllers/api/EntradaController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();

// Rate limiting para operaciones de escritura
const writeOperationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 60,
  message: {
    success: false,
    error: 'Too many modification requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Índice global de entradas (para búsqueda) — un solo segmento, no choca con /:destinoId/entradas
router.get(
  '/all-entradas',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4),
  (req, res) => EntradaController.listAll(req, res)
);

// Lectura: cualquier usuario autenticado nivel Department Manager y superior
router.get(
  '/:destinoId/entradas',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4),
  (req, res) => EntradaController.listByDestino(req, res)
);

// Escritura: Admin (nivel 6+)
router.post(
  '/:destinoId/entradas',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6),
  (req, res) => EntradaController.create(req, res)
);

router.put(
  '/:destinoId/entradas/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6),
  (req, res) => EntradaController.update(req, res)
);

router.delete(
  '/:destinoId/entradas/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6),
  (req, res) => EntradaController.remove(req, res)
);

module.exports = router;
