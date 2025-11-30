/**
 * Provider Experiencias API Routes.
 *
 * RESTful API endpoints for managing provider services (experiencias).
 * All routes require authentication and appropriate role permissions.
 * @module routes/api/providerExperiencias
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const express = require('express');

const router = express.Router();
const controller = require('../../../application/controllers/api/ProviderExperienciaController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

// Apply JWT authentication to all routes
router.use(jwtMiddleware.authenticateToken);

/**
 * GET /api/provider-experiencias/all
 * Get all experiencias from all providers.
 */
router.get('/provider-experiencias/all', (req, res) => controller.getAllProviderExperiencias(req, res));

/**
 * GET /api/providers/:providerId/experiencias
 * Get all experiencias for a specific provider.
 */
router.get('/providers/:providerId/experiencias', (req, res) => controller.getProviderExperiencias(req, res));

/**
 * GET /api/providers/:providerId/experiencias/:id
 * Get a specific experiencia by ID.
 */
router.get('/providers/:providerId/experiencias/:id', (req, res) => controller.getExperienciaById(req, res));

/**
 * POST /api/providers/:providerId/experiencias
 * Create a new experiencia for a provider.
 */
router.post('/providers/:providerId/experiencias', (req, res) => controller.createExperiencia(req, res));

/**
 * PUT /api/providers/:providerId/experiencias/:id
 * Update an existing experiencia.
 */
router.put('/providers/:providerId/experiencias/:id', (req, res) => controller.updateExperiencia(req, res));

/**
 * DELETE /api/providers/:providerId/experiencias/:id
 * Delete an experiencia (soft delete).
 */
router.delete('/providers/:providerId/experiencias/:id', (req, res) => controller.deleteExperiencia(req, res));

/**
 * PUT /api/providers/:providerId/experiencias/reorder
 * Reorder experiencias for a provider.
 */
router.put('/providers/:providerId/experiencias/reorder', (req, res) => controller.reorderExperiencias(req, res));

module.exports = router;
