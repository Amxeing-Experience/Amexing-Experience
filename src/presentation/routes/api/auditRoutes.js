/**
 * Audit API Routes - RESTful endpoints for audit log management.
 * Provides Ajax-ready API endpoints for querying audit trail data for compliance and security.
 * Restricted to SuperAdmin and Admin roles only.
 *
 * Features:
 * - RESTful API design (read-only)
 * - SuperAdmin/Admin access control
 * - Rate limiting and security headers
 * - Comprehensive filtering and pagination
 * - Statistics and summary endpoints.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2025-10-16
 * @example
 * // Usage example
 * router.use('/audit', auditRoutes);
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const AuditLogController = require('../../../application/controllers/api/AuditLogController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();
const auditController = new AuditLogController();

// Rate limiting for audit log queries
const auditApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 requests per windowMs (read-heavy operations)
  message: {
    success: false,
    error: 'Too many audit log requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Custom middleware to validate access to audit log endpoints.
 * Allows: superadmin and admin only.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {Function} next - Next middleware function.
 * @returns {void}
 * @example
 */
function validateAuditAccess(req, res, next) {
  const { userRole } = req;

  if (!userRole) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      timestamp: new Date().toISOString(),
    });
  }

  // Only admin and superadmin can access audit logs
  if (userRole !== 'admin' && userRole !== 'superadmin') {
    return res.status(403).json({
      success: false,
      error: 'Insufficient permissions - admin or superadmin role required',
      timestamp: new Date().toISOString(),
    });
  }

  next();
}

// Apply authentication middleware to all routes
router.use(jwtMiddleware.authenticateToken);

// Apply audit access validation to all routes
router.use(validateAuditAccess);

// Apply rate limiting to all routes
router.use(auditApiLimiter);

// ============================================================
// AUDIT LOG ROUTES (GET-only, read-only operations)
// ============================================================

/**
 * GET /api/audit/logs - Get audit logs with filtering and pagination.
 * Query parameters:
 * - page {number} - Page number (default: 1)
 * - limit {number} - Items per page (default: 50, max: 1000)
 * - userId {string} - Filter by user ID
 * - username {string} - Filter by username (partial match)
 * - action {string} - Filter by action (CREATE, UPDATE, DELETE, etc.)
 * - entityType {string} - Filter by entity type
 * - entityId {string} - Filter by entity ID
 * - startDate {string} - Filter by start date (ISO format)
 * - endDate {string} - Filter by end date (ISO format)
 * - sortField {string} - Field to sort by (default: timestamp)
 * - sortDirection {string} - Sort direction (asc/desc, default: desc).
 */
router.get('/logs', (req, res) => auditController.getAuditLogs(req, res));

/**
 * GET /api/audit/user/:userId - Get audit logs for specific user.
 * @param {string} userId - User ID to query.
 * Query parameters:
 * - limit {number} - Items limit (default: 50, max: 1000).
 */
router.get('/user/:userId', (req, res) => auditController.getUserAuditLogs(req, res));

/**
 * GET /api/audit/entity/:entityType/:entityId? - Get audit logs for specific entity.
 * @param {string} entityType - Entity type (Client, Employee, etc.).
 * @param {string} entityId - Optional entity ID.
 * Query parameters:
 * - limit {number} - Items limit (default: 50, max: 1000).
 */
router.get('/entity/:entityType/:entityId?', (req, res) => auditController.getEntityAuditLogs(req, res));

/**
 * GET /api/audit/statistics - Get audit log statistics.
 * Query parameters:
 * - startDate {string} - Filter by start date (ISO format)
 * - endDate {string} - Filter by end date (ISO format)
 * - userId {string} - Filter by user ID
 * - entityType {string} - Filter by entity type.
 */
router.get('/statistics', (req, res) => auditController.getStatistics(req, res));

module.exports = router;
