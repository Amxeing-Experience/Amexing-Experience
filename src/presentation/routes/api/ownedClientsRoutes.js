/**
 * Owned Clients API Routes - RESTful endpoints for hierarchical client management
 * Allows department_manager and client roles to manage their own clients.
 * Provides ownership-based filtering and access control.
 *
 * Features:
 * - RESTful API design
 * - Ownership-based access control
 * - Department managers and clients can manage their own client entities
 * - Rate limiting and security headers
 * - Comprehensive error handling.
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const OwnedClientsController = require('../../../application/controllers/api/OwnedClientsController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');
const logger = require('../../../infrastructure/logger');

const router = express.Router();
const ownedClientsController = new OwnedClientsController();

// Rate limiting for client management operations
const clientApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: 'Too many client management requests from this IP, please try again later.',
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
    error: 'Too many client modification requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting and authentication to all routes
router.use(clientApiLimiter);
router.use(jwtMiddleware.authenticateToken);

/**
 * GET /api/owned-clients - Get clients owned by current user.
 * Allows department_manager and client roles to see their owned clients.
 * Admins can see all clients or filter by ownership.
 */
router.get('/', async (req, res) => {
  await ownedClientsController.getOwnedClients(req, res);
});

/**
 * GET /api/owned-clients/active - Get active owned clients for dropdowns.
 * Used in forms requiring client selection.
 */
router.get('/active', async (req, res) => {
  await ownedClientsController.getActiveOwnedClients(req, res);
});

/**
 * GET /api/owned-clients/:id - Get a specific owned client by ID.
 * Used for editing forms requiring client details.
 */
router.get('/:id', async (req, res) => {
  await ownedClientsController.getOwnedClientById(req, res);
});

/**
 * POST /api/owned-clients - Create a new owned client.
 * Creates a client with ownership assigned to the current user.
 */
router.post('/', writeOperationsLimiter, async (req, res) => {
  await ownedClientsController.createOwnedClient(req, res);
});

/**
 * POST /api/owned-clients/quick - Create a quick client (minimal info).
 * Used for rapid client creation during quote creation.
 */
router.post('/quick', writeOperationsLimiter, async (req, res) => {
  await ownedClientsController.createQuickOwnedClient(req, res);
});

/**
 * PUT /api/owned-clients/:id - Update an owned client.
 * Only the owner or admins can update.
 */
router.put('/:id', writeOperationsLimiter, async (req, res) => {
  await ownedClientsController.updateOwnedClient(req, res);
});

/**
 * DELETE /api/owned-clients/:id - Soft delete an owned client.
 * Only the owner or admins can delete.
 */
router.delete('/:id', writeOperationsLimiter, async (req, res) => {
  await ownedClientsController.deleteOwnedClient(req, res);
});

/**
 * Error handling middleware for this router.
 * @param {Error} error - Error object.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {Function} _next - Next middleware function.
 */
router.use((error, req, res, _next) => {
  logger.error('Owned Clients API Error:', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    userId: req.user?.id,
    timestamp: new Date(),
  });

  // Don't expose internal errors to client
  res.status(error.status || 500).json({
    success: false,
    error: error.status === 500 ? 'Internal server error' : error.message,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
