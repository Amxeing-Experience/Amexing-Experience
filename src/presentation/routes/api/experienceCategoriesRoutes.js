/**
 * Experience Categories API Routes - RESTful endpoints for experience category catalog.
 *
 * Lectura para usuarios autenticados (nivel 4+); escritura solo Admin/SuperAdmin (nivel 6+).
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Usage
 * router.use('/experience-categories', experienceCategoriesRoutes);
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const ExperienceCategoryController = require('../../../application/controllers/api/ExperienceCategoryController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();

// Rate limiting general (lecturas)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting más estricto para escrituras
const writeOperationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: {
    success: false,
    error: 'Too many modification requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(apiLimiter);

// ===== READ (nivel 4+) =====

/**
 * GET /api/experience-categories - Lista de categorías (con conteo de experiencias).
 */
router.get(
  '/',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4),
  (req, res) => ExperienceCategoryController.getCategories(req, res)
);

/**
 * GET /api/experience-categories/active - Categorías activas (para selects/filtros).
 * Solo requiere estar autenticado (la usan editores y el catálogo).
 */
router.get('/active', jwtMiddleware.authenticateToken, (req, res) => ExperienceCategoryController.getActiveCategories(req, res));

/**
 * GET /api/experience-categories/:id - Categoría por id.
 */
router.get(
  '/:id',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4),
  (req, res) => ExperienceCategoryController.getCategoryById(req, res)
);

// ===== WRITE (nivel 6+) =====

/**
 * POST /api/experience-categories - Crear categoría.
 */
router.post(
  '/',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6),
  (req, res) => ExperienceCategoryController.createCategory(req, res)
);

/**
 * PUT /api/experience-categories/:id - Actualizar categoría (incluye toggle active).
 */
router.put(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6),
  (req, res) => ExperienceCategoryController.updateCategory(req, res)
);

/**
 * DELETE /api/experience-categories/:id - Soft delete.
 */
router.delete(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6),
  (req, res) => ExperienceCategoryController.deleteCategory(req, res)
);

module.exports = router;
