/**
 * User Management API Routes - RESTful endpoints for user CRUD operations
 * Provides Ajax-ready API endpoints with comprehensive security and validation.
 *
 * Features:
 * - RESTful API design
 * - Role-based access control middleware
 * - Request validation and sanitization
 * - Rate limiting and security headers
 * - Comprehensive error handling
 * - API documentation ready.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-09-22
 * @example
 * // Usage example
 * const result = await require({ 'express': 'example' });
 * // Returns: operation result
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const UserManagementController = require('../../../application/controllers/api/UserManagementController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');
const securityMiddleware = require('../../../infrastructure/security/securityMiddleware');
const logger = require('../../../infrastructure/logger');

const router = express.Router();
const userController = new UserManagementController();

// Rate limiting for user management operations
const userApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: 'Too many user management requests from this IP, please try again later.',
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
    error: 'Too many user modification requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting and authentication to all routes
router.use(userApiLimiter);
router.use(jwtMiddleware.authenticateToken);

/**
 * Get users with filtering, pagination, and role-based access.
 * Route: GET /api/users
 * Access: Private (authenticated users with appropriate permissions).
 * @param {object} req - Express request object with query parameters: page, limit, role, active, search, clientId, departmentId, sortField, sortDirection.
 * @param {object} res - Express response object.
 * @returns {Promise<void>} - Resolves when response is sent.
 * @example
 * // Usage example
 * const result = await get({ '/': 'example', async: 'example' });
 * // Returns: operation result
 * // GET /api/endpoint
 * // Response: { "success": true, "data": [...] }
 * GET /api/users?page=1&limit=10&role=admin&active=true
 */
router.get('/', async (req, res) => {
  await userController.getUsers(req, res);
});

/**
 * Search users with advanced filtering.
 * Route: GET /api/users/search
 * Access: Private (authenticated users with appropriate permissions).
 * @param {object} req - Express request object with query parameters: q (search term), role, active, page, limit, sortField, sortDirection.
 * @param {object} res - Express response object.
 * @returns {Promise<void>} - Resolves when response is sent.
 * @example
 * // Usage example
 * const result = await get({ '/search': 'example', async: 'example' });
 * // Returns: operation result
 * // GET /api/endpoint
 * // Response: { "success": true, "data": [...] }
 * GET /api/users/search?q=john&role=employee&active=true
 */
router.get('/search', async (req, res) => {
  await userController.searchUsers(req, res);
});

/**
 * Get user statistics for dashboard.
 * Route: GET /api/users/statistics
 * Access: Private (superadmin, admin).
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @returns {Promise<void>} - Resolves when response is sent.
 * @example
 * // Usage example
 * const result = await get({ '/statistics': 'example', async: 'example' });
 * // Returns: operation result
 * // GET /api/endpoint
 * // Response: { "success": true, "data": [...] }
 * GET /api/users/statistics
 */
router.get('/statistics', async (req, res) => {
  await userController.getUserStatistics(req, res);
});

/**
 * Get specific user by ID.
 * Route: GET /api/users/:id
 * Access: Private (authenticated users with appropriate permissions).
 * @param {object} req - Express request object with params: {id: User ID}.
 * @param {object} res - Express response object.
 * @returns {Promise<void>} - Resolves when response is sent.
 * @example
 * // Usage example
 * const result = await get({ '/:id': 'example', async: 'example' });
 * // Returns: operation result
 * // GET /api/endpoint
 * // Response: { "success": true, "data": [...] }
 * GET /api/users/abc123
 */
router.get('/:id', async (req, res) => {
  await userController.getUserById(req, res);
});

/**
 * Create new user.
 * Route: POST /api/users
 * Access: Private (superadmin, admin, client - based on role hierarchy).
 * @param {object} req - Express request object with body: {email, firstName, lastName, role, password?, clientId?, departmentId?, emailVerified?}.
 * @param {object} res - Express response object.
 * @returns {Promise<void>} - Resolves when response is sent.
 * @example
 * // Usage example
 * const result = await post({ '/': 'example', writeOperationsLimiter: 'example', securityMiddleware.getCsrfProtection(: 'example' });
 * // Returns: operation result
 * // GET /api/endpoint
 * // Response: { "success": true, "data": [...] }
 * POST /api/users with body: {email: 'user@example.com', firstName: 'John', lastName: 'Doe', role: 'employee'}
 */
router.post('/', writeOperationsLimiter, securityMiddleware.getCsrfProtection(), async (req, res) => {
  await userController.createUser(req, res);
});

/**
 * Update existing user.
 * Route: PUT /api/users/:id
 * Access: Private (authenticated users with appropriate permissions).
 * @param {object} req - Express request object with params: {id: User ID} and body: Partial user data to update.
 * @param {object} res - Express response object.
 * @returns {Promise<void>} - Resolves when response is sent.
 * @example
 * // Usage example
 * const result = await put({ '/:id': 'example', writeOperationsLimiter: 'example', securityMiddleware.getCsrfProtection(: 'example' });
 * // Returns: operation result
 * // POST /api/endpoint
 * // Body: { "data": "value" }
 * // Response: { "success": true, "message": "Created" }
 * PUT /api/users/abc123 with body: {firstName: 'Jane', active: false}
 */
router.put('/:id', writeOperationsLimiter, securityMiddleware.getCsrfProtection(), async (req, res) => {
  await userController.updateUser(req, res);
});

/**
 * Deactivate user (soft delete - follows AI agent rules).
 * Route: DELETE /api/users/:id
 * Access: Private (superadmin, admin, or users managing their subordinates).
 * @param {object} req - Express request object with params: {id: User ID} and body: {reason?: string}.
 * @param {object} res - Express response object.
 * @returns {Promise<void>} - Resolves when response is sent.
 * @example
 * // Usage example
 * const result = await delete({ '/:id': 'example', writeOperationsLimiter: 'example', securityMiddleware.getCsrfProtection(: 'example' });
 * // Returns: operation result
 * // PUT /api/endpoint/123
 * // Body: { "field": "updated value" }
 * // Response: { "success": true, "data": {...} }
 * DELETE /api/users/abc123 with body: {reason: 'Policy violation'}
 */
router.delete('/:id', writeOperationsLimiter, securityMiddleware.getCsrfProtection(), async (req, res) => {
  await userController.deactivateUser(req, res);
});

/**
 * Reactivate deactivated user.
 * Route: PUT /api/users/:id/reactivate
 * Access: Private (superadmin, admin, or users managing their subordinates).
 * @param {object} req - Express request object with params: {id: User ID} and body: {reason?: string}.
 * @param {object} res - Express response object.
 * @returns {Promise<void>} - Resolves when response is sent.
 * @example
 * // Usage example
 * const result = await put({ '/:id/reactivate': 'example', writeOperationsLimiter: 'example', securityMiddleware.getCsrfProtection(: 'example' });
 * // Returns: operation result
 * // PUT /api/endpoint/123
 * // Body: { "field": "updated value" }
 * // Response: { "success": true, "data": {...} }
 * PUT /api/users/abc123/reactivate with body: {reason: 'Appeal approved'}
 */
router.put('/:id/reactivate', writeOperationsLimiter, securityMiddleware.getCsrfProtection(), async (req, res) => {
  await userController.reactivateUser(req, res);
});

/**
 * Toggle user active status (activate/deactivate).
 * Route: PATCH /api/users/:id/toggle-status
 * Access: Private (superadmin, admin, or users managing their subordinates).
 * @param {object} req - Express request object with params: {id: User ID} and body: {active: boolean, reason?: string}.
 * @param {object} res - Express response object.
 * @returns {Promise<void>} - Resolves when response is sent.
 * @example
 * // Usage example
 * const result = await patch({ '/:id/toggle-status': 'example', writeOperationsLimiter: 'example', securityMiddleware.getCsrfProtection(: 'example' });
 * // Returns: operation result
 * // PUT /api/endpoint/123
 * // Body: { "field": "updated value" }
 * // Response: { "success": true, "data": {...} }
 * PATCH /api/users/abc123/toggle-status with body: {active: false, reason: 'Suspension'}
 */
router.patch('/:id/toggle-status', writeOperationsLimiter, securityMiddleware.getCsrfProtection(), async (req, res) => {
  await userController.toggleUserStatus(req, res);
});

/**
 * Archive user (soft delete - sets active: false, exists: false).
 * Route: PATCH /api/users/:id/archive
 * Access: Private (superadmin only).
 * @param {object} req - Express request object with params: {id: User ID} and body: {reason?: string}.
 * @param {object} res - Express response object.
 * @returns {Promise<void>} - Resolves when response is sent.
 * @example
 * // Usage example
 * const result = await patch({ '/:id/archive': 'example', writeOperationsLimiter: 'example', securityMiddleware.getCsrfProtection(: 'example' });
 * // Returns: operation result
 * // PATCH /api/endpoint/123
 * // Body: { "field": "new value" }
 * // Response: { "success": true, "data": {...} }
 * PATCH /api/users/abc123/archive with body: {reason: 'Data retention policy'}
 */
router.patch('/:id/archive', writeOperationsLimiter, securityMiddleware.getCsrfProtection(), async (req, res) => {
  await userController.archiveUser(req, res);
});

/**
 * Error handling middleware for this router.
 * @param {*} next - _next parameter.
 * @param {object} res - Express response object.
 * @param {object} req - Express request object.
 * @param {*} (error - (error parameter.
 * @returns {*} - Operation result.
 * @example
 * // Usage example
 * const result = await use({ (error: 'example', _next: 'example' });
 * // Returns: operation result
 */
router.use((error, req, res, _next) => {
  logger.error('User Management API Error:', {
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
