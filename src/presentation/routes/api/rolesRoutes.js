/**
 * Roles API Routes
 * RESTful API endpoints for system role management.
 * Restricted to SuperAdmin role only.
 *
 * Security:
 * - JWT authentication required
 * - SuperAdmin role validation
 * - Audit logging enabled
 * - Limited write operations (displayName only).
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 0.1.0
 */

const express = require('express');

const router = express.Router();
const RolesController = require('../../../application/controllers/api/RolesController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const rolesController = new RolesController();

/**
 * Middleware to verify SuperAdmin role.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {Function} next - Next middleware function.
 * @returns {Promise<void>}
 * @example
 * // Usage example documented above
 */
async function requireSuperAdmin(req, res, next) {
  try {
    const userRole = req.userRole || req.user?.get?.('role') || req.user?.role;

    if (!userRole) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        timestamp: new Date().toISOString(),
      });
    }

    // Verify SuperAdmin role (simple string comparison)
    if (userRole !== 'superadmin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. SuperAdmin role required.',
        timestamp: new Date().toISOString(),
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Authorization check failed',
      timestamp: new Date().toISOString(),
    });
  }
}

// Apply JWT authentication to all routes (required even though apiRoutes.js has it)
router.use(jwtMiddleware.authenticateToken);

// Apply SuperAdmin role check to all routes
router.use(requireSuperAdmin);

/**
 * GET /api/roles
 * Get all system roles with filtering and pagination.
 * Query params: page, limit, active, scope, organization, sortField, sortDirection.
 * @returns {object} - List of roles with pagination metadata.
 */
router.get('/', (req, res) => rolesController.getRoles(req, res));

/**
 * GET /api/roles/:id
 * Get single role by ID.
 * @param {string} id - Role ID.
 * @returns {object} - Role details.
 */
router.get('/:id', (req, res) => rolesController.getRoleById(req, res));

/**
 * PUT /api/roles/:id
 * Update role displayName (SuperAdmin only).
 * Only allows updating the displayName field for security.
 * @param {string} id - Role ID.
 * @param {object} body - { displayName: string }.
 * @returns {object} - Updated role details.
 */
router.put('/:id', (req, res) => rolesController.updateRole(req, res));

module.exports = router;
