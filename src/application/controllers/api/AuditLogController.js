/**
 * AuditLogController - RESTful API for Audit Log Management.
 * Provides Ajax-ready endpoints for querying audit trail data for compliance and security.
 * Restricted to SuperAdmin and Admin roles only.
 *
 * Features:
 * - RESTful API design (GET-only, audit logs are read-only)
 * - SuperAdmin/Admin access control only
 * - Comprehensive filtering (user, entity, action, date range)
 * - Statistics and summary endpoints
 * - Export-ready data formatting.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const AuditLogHelper = require('./helpers/AuditLogHelper');
const logger = require('../../../infrastructure/logger');

/**
 * AuditLogController class implementing RESTful API for audit log queries.
 * Follows REST conventions and provides comprehensive error handling.
 */
class AuditLogController {
  constructor() {
    this.maxPageSize = 1000;
    this.defaultPageSize = 50;
  }

  /**
   * GET /api/audit/logs - Get audit logs with filtering and pagination.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // GET /api/audit/logs?action=CREATE&entityType=Quote&limit=50
   * // Returns paginated audit logs with optional filters
   */
  async getAuditLogs(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return AuditLogHelper.sendError(res, 'Authentication required', 401);
      }

      if (!AuditLogHelper.validatePermissions(req.userRole)) {
        return AuditLogHelper.sendError(res, 'Insufficient permissions', 403);
      }

      const { pagination, filters } = AuditLogHelper.parseAuditLogParams(req.query);
      const query = AuditLogHelper.buildAuditLogQuery(filters);
      const dateValidation = AuditLogHelper.validateDateFilters(filters, res);
      if (dateValidation) return dateValidation;

      AuditLogHelper.applySortingAndPagination(query, filters, pagination);
      const [logs, totalCount] = await this.executeQuery(query);
      const formattedLogs = AuditLogHelper.formatAuditLogs(logs);
      const response = AuditLogHelper.buildResponse(formattedLogs, totalCount, pagination, filters);

      AuditLogHelper.sendSuccess(res, response, 'Audit logs retrieved successfully');
    } catch (error) {
      logger.error('Error in AuditLogController.getAuditLogs', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        userRole: req.userRole,
        queryParams: req.query,
      });

      AuditLogHelper.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to retrieve audit logs',
        500
      );
    }
  }

  /**
   * GET /api/audit/user/:userId - Get audit logs for specific user.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // GET /api/audit/user/xyz789
   * // Returns audit logs for user with ID xyz789
   */
  async getUserAuditLogs(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return AuditLogHelper.sendError(res, 'Authentication required', 401);
      }

      if (!AuditLogHelper.validatePermissions(req.userRole)) {
        return AuditLogHelper.sendError(res, 'Insufficient permissions', 403);
      }

      const { userId } = req.params;
      if (!userId) {
        return AuditLogHelper.sendError(res, 'User ID is required', 400);
      }

      req.query.userId = userId;
      return this.getAuditLogs(req, res);
    } catch (error) {
      logger.error('Error in AuditLogController.getUserAuditLogs', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        targetUserId: req.params.userId,
      });

      AuditLogHelper.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to retrieve user audit logs',
        500
      );
    }
  }

  /**
   * GET /api/audit/entity/:entityType/:entityId - Get audit logs for specific entity.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // GET /api/audit/entity/Quote/abc123
   * // Returns audit logs for Quote with ID abc123
   */
  async getEntityAuditLogs(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return AuditLogHelper.sendError(res, 'Authentication required', 401);
      }

      if (!AuditLogHelper.validatePermissions(req.userRole)) {
        return AuditLogHelper.sendError(res, 'Insufficient permissions', 403);
      }

      const { entityType, entityId } = req.params;
      if (!entityType || !entityId) {
        return AuditLogHelper.sendError(res, 'Entity type and ID are required', 400);
      }

      req.query.entityType = entityType;
      req.query.entityId = entityId;
      return this.getAuditLogs(req, res);
    } catch (error) {
      logger.error('Error in AuditLogController.getEntityAuditLogs', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        entityType: req.params.entityType,
        entityId: req.params.entityId,
      });

      AuditLogHelper.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to retrieve entity audit logs',
        500
      );
    }
  }

  /**
   * GET /api/audit/statistics - Get audit log statistics and summaries.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // GET /api/audit/statistics
   * // Returns statistics about audit log entries
   */
  async getStatistics(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return AuditLogHelper.sendError(res, 'Authentication required', 401);
      }

      if (!AuditLogHelper.validatePermissions(req.userRole)) {
        return AuditLogHelper.sendError(res, 'Insufficient permissions', 403);
      }

      const { startDate, endDate } = req.query;
      const dateValidation = AuditLogHelper.validateDateFilters({ startDate, endDate }, res);
      if (dateValidation) return dateValidation;

      const baseQuery = AuditLogHelper.buildAuditLogQuery({ startDate, endDate });

      // Get statistics in parallel
      const [totalLogs, uniqueUsers, actionBreakdown, entityTypeBreakdown, recentActivity] = await Promise.all([
        baseQuery.count({ useMasterKey: true }),
        this.getUniqueUsersCount(baseQuery),
        this.getActionBreakdown(baseQuery),
        this.getEntityTypeBreakdown(baseQuery),
        this.getRecentActivity(),
      ]);

      const statistics = {
        totalLogs,
        uniqueUsers,
        actionBreakdown,
        entityTypeBreakdown,
        recentActivity,
        period: {
          startDate: startDate || null,
          endDate: endDate || null,
        },
      };

      AuditLogHelper.sendSuccess(res, statistics, 'Statistics retrieved successfully');
    } catch (error) {
      logger.error('Error in AuditLogController.getStatistics', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      AuditLogHelper.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to retrieve statistics',
        500
      );
    }
  }

  /**
   * Execute query and get results.
   * @param {object} query - Parse query object.
   * @returns {Promise<Array>} Array of [logs, totalCount].
   * @example
   * const [logs, totalCount] = await controller.executeQuery(query);
   */
  async executeQuery(query) {
    return Promise.all([query.find({ useMasterKey: true }), query.count({ useMasterKey: true })]);
  }

  /**
   * Get unique users count from query results.
   * @param {object} baseQuery - Base Parse query.
   * @returns {Promise<number>} Number of unique users.
   * @example
   * const userCount = await controller.getUniqueUsersCount(baseQuery);
   */
  async getUniqueUsersCount(baseQuery) {
    const logs = await baseQuery.find({ useMasterKey: true });
    const uniqueUsers = new Set(logs.map((log) => log.get('userId')));
    return uniqueUsers.size;
  }

  /**
   * Get action breakdown statistics.
   * @param {object} baseQuery - Base Parse query.
   * @returns {Promise<object>} Action breakdown data.
   * @example
   * const breakdown = await controller.getActionBreakdown(baseQuery);
   */
  async getActionBreakdown(baseQuery) {
    const logs = await baseQuery.find({ useMasterKey: true });
    const breakdown = Object.create(null); // Use Object.create(null) to avoid prototype pollution
    logs.forEach((log) => {
      const action = log.get('action');
      // Validate that action is a safe string and not a prototype property
      if (typeof action === 'string' && action && !['__proto__', 'constructor', 'prototype'].includes(action)) {
        breakdown[action] = (breakdown[action] || 0) + 1;
      }
    });
    return breakdown;
  }

  /**
   * Get entity type breakdown statistics.
   * @param {object} baseQuery - Base Parse query.
   * @returns {Promise<object>} Entity type breakdown data.
   * @example
   * const breakdown = await controller.getEntityTypeBreakdown(baseQuery);
   */
  async getEntityTypeBreakdown(baseQuery) {
    const logs = await baseQuery.find({ useMasterKey: true });
    const breakdown = Object.create(null); // Use Object.create(null) to avoid prototype pollution
    logs.forEach((log) => {
      const entityType = log.get('entityType');
      // Validate that entityType is a safe string and not a prototype property
      if (typeof entityType === 'string' && entityType && !['__proto__', 'constructor', 'prototype'].includes(entityType)) {
        breakdown[entityType] = (breakdown[entityType] || 0) + 1;
      }
    });
    return breakdown;
  }

  /**
   * Get recent activity (last 24 hours).
   * @returns {Promise<Array>} Recent activity data.
   * @example
   */
  async getRecentActivity() {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const query = AuditLogHelper.buildAuditLogQuery({});
    query.greaterThan('timestamp', yesterday);
    query.descending('timestamp');
    query.limit(10);

    const logs = await query.find({ useMasterKey: true });
    return AuditLogHelper.formatAuditLogs(logs);
  }
}

module.exports = AuditLogController;
