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
 * @since 2025-10-16
 * @example
 * // Usage example:
 * const controller = new AuditLogController();
 * await controller.getAuditLogs(req, res);
 */

const AuditLog = require('../../../domain/models/AuditLog');
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
   *
   * Query Parameters:
   * - page: Page number (default: 1)
   * - limit: Items per page (default: 50, max: 1000)
   * - userId: Filter by user ID
   * - username: Filter by username (partial match)
   * - action: Filter by action (CREATE, UPDATE, DELETE, etc.)
   * - entityType: Filter by entity type (Client, Employee, etc.)
   * - entityId: Filter by entity ID
   * - startDate: Filter by start date (ISO format)
   * - endDate: Filter by end date (ISO format)
   * - sortField: Field to sort by (default: timestamp)
   * - sortDirection: Sort direction (asc/desc, default: desc).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // GET /api/audit/logs?action=UPDATE&startDate=2025-10-01&limit=100
   */
  async getAuditLogs(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Only admin and superadmin can view audit logs
      const { userRole } = req;
      if (userRole !== 'admin' && userRole !== 'superadmin') {
        return this.sendError(res, 'Insufficient permissions', 403);
      }

      // Parse query parameters
      const {
        page = 1,
        limit = this.defaultPageSize,
        userId,
        username,
        action,
        entityType,
        entityId,
        startDate,
        endDate,
        sortField = 'timestamp',
        sortDirection = 'desc',
      } = req.query;

      // Validate and sanitize pagination
      const validatedPage = Math.max(1, parseInt(page, 10) || 1);
      const validatedLimit = Math.min(this.maxPageSize, Math.max(1, parseInt(limit, 10) || this.defaultPageSize));
      const skip = (validatedPage - 1) * validatedLimit;

      // Build query
      const Parse = require('parse/node');
      const query = new Parse.Query(AuditLog);

      // Apply filters
      if (userId) {
        query.equalTo('userId', userId);
      }

      if (username) {
        query.contains('username', username);
      }

      if (action) {
        query.equalTo('action', action.toUpperCase());
      }

      if (entityType) {
        query.equalTo('entityType', entityType);
      }

      if (entityId) {
        query.equalTo('entityId', entityId);
      }

      if (startDate) {
        try {
          const start = new Date(startDate);
          query.greaterThanOrEqualTo('timestamp', start);
        } catch (error) {
          return this.sendError(res, 'Invalid startDate format', 400);
        }
      }

      if (endDate) {
        try {
          const end = new Date(endDate);
          query.lessThanOrEqualTo('timestamp', end);
        } catch (error) {
          return this.sendError(res, 'Invalid endDate format', 400);
        }
      }

      // Apply sorting
      if (sortDirection === 'asc') {
        query.ascending(sortField);
      } else {
        query.descending(sortField);
      }

      // Apply pagination
      query.skip(skip);
      query.limit(validatedLimit);

      // Execute query
      const [logs, totalCount] = await Promise.all([
        query.find({ useMasterKey: true }),
        query.count({ useMasterKey: true }),
      ]);

      // Format logs for frontend
      const formattedLogs = logs.map((log) => ({
        id: log.id,
        userId: log.get('userId'),
        username: log.get('username'),
        action: log.get('action'),
        entityType: log.get('entityType'),
        entityId: log.get('entityId'),
        changes: log.get('changes'),
        metadata: log.get('metadata'),
        timestamp: log.get('timestamp'),
        createdAt: log.get('createdAt'),
      }));

      // Calculate pagination metadata
      const totalPages = Math.ceil(totalCount / validatedLimit);

      const response = {
        data: formattedLogs,
        pagination: {
          total: totalCount,
          page: validatedPage,
          limit: validatedLimit,
          totalPages,
          hasNext: validatedPage < totalPages,
          hasPrev: validatedPage > 1,
        },
        filters: {
          userId,
          username,
          action,
          entityType,
          entityId,
          startDate,
          endDate,
        },
      };

      this.sendSuccess(res, response, 'Audit logs retrieved successfully');
    } catch (error) {
      logger.error('Error in AuditLogController.getAuditLogs', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        userRole: req.userRole,
        queryParams: req.query,
      });

      this.sendError(
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
   * // GET /api/audit/user/abc123?limit=100
   */
  async getUserAuditLogs(req, res) {
    try {
      const currentUser = req.user;
      const targetUserId = req.params.userId;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Only admin and superadmin can view audit logs
      const { userRole } = req;
      if (userRole !== 'admin' && userRole !== 'superadmin') {
        return this.sendError(res, 'Insufficient permissions', 403);
      }

      if (!targetUserId) {
        return this.sendError(res, 'User ID is required', 400);
      }

      const limit = Math.min(this.maxPageSize, parseInt(req.query.limit, 10) || this.defaultPageSize);

      const logs = await AuditLog.queryByUser(targetUserId, limit);

      const formattedLogs = logs.map((log) => ({
        id: log.id,
        userId: log.get('userId'),
        username: log.get('username'),
        action: log.get('action'),
        entityType: log.get('entityType'),
        entityId: log.get('entityId'),
        changes: log.get('changes'),
        metadata: log.get('metadata'),
        timestamp: log.get('timestamp'),
      }));

      this.sendSuccess(
        res,
        {
          userId: targetUserId,
          logs: formattedLogs,
          total: logs.length,
        },
        'User audit logs retrieved successfully'
      );
    } catch (error) {
      logger.error('Error in AuditLogController.getUserAuditLogs', {
        error: error.message,
        targetUserId: req.params.userId,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * GET /api/audit/entity/:entityType/:entityId - Get audit logs for specific entity.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // GET /api/audit/entity/Client/xyz789
   */
  async getEntityAuditLogs(req, res) {
    try {
      const currentUser = req.user;
      const { entityType, entityId } = req.params;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Only admin and superadmin can view audit logs
      const { userRole } = req;
      if (userRole !== 'admin' && userRole !== 'superadmin') {
        return this.sendError(res, 'Insufficient permissions', 403);
      }

      if (!entityType) {
        return this.sendError(res, 'Entity type is required', 400);
      }

      const limit = Math.min(this.maxPageSize, parseInt(req.query.limit, 10) || this.defaultPageSize);

      const logs = await AuditLog.queryByEntity(entityType, entityId, limit);

      const formattedLogs = logs.map((log) => ({
        id: log.id,
        userId: log.get('userId'),
        username: log.get('username'),
        action: log.get('action'),
        entityType: log.get('entityType'),
        entityId: log.get('entityId'),
        changes: log.get('changes'),
        metadata: log.get('metadata'),
        timestamp: log.get('timestamp'),
      }));

      this.sendSuccess(
        res,
        {
          entityType,
          entityId: entityId || 'all',
          logs: formattedLogs,
          total: logs.length,
        },
        'Entity audit logs retrieved successfully'
      );
    } catch (error) {
      logger.error('Error in AuditLogController.getEntityAuditLogs', {
        error: error.message,
        entityType: req.params.entityType,
        entityId: req.params.entityId,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * GET /api/audit/statistics - Get audit log statistics.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // GET /api/audit/statistics?startDate=2025-10-01&endDate=2025-10-31
   */
  async getStatistics(req, res) {
    try {
      const currentUser = req.user;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Only admin and superadmin can view audit logs
      const { userRole } = req;
      if (userRole !== 'admin' && userRole !== 'superadmin') {
        return this.sendError(res, 'Insufficient permissions', 403);
      }

      const {
        startDate, endDate, userId, entityType,
      } = req.query;

      const filters = {};

      if (userId) filters.userId = userId;
      if (entityType) filters.entityType = entityType;

      if (startDate) {
        try {
          filters.startDate = new Date(startDate);
        } catch (error) {
          return this.sendError(res, 'Invalid startDate format', 400);
        }
      }

      if (endDate) {
        try {
          filters.endDate = new Date(endDate);
        } catch (error) {
          return this.sendError(res, 'Invalid endDate format', 400);
        }
      }

      const statistics = await AuditLog.getStatistics(filters);

      this.sendSuccess(res, statistics, 'Statistics retrieved successfully');
    } catch (error) {
      logger.error('Error in AuditLogController.getStatistics', {
        error: error.message,
        currentUser: req.user?.id,
        queryParams: req.query,
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * Helper method to send successful response.
   * @param {object} res - Express response object.
   * @param {object} data - Response data.
   * @param {string} [message] - Success message.
   * @returns {void}
   * @example
   */
  sendSuccess(res, data, message = 'Success') {
    res.status(200).json({
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Helper method to send error response.
   * @param {object} res - Express response object.
   * @param {string} message - Error message.
   * @param {number} [statusCode] - HTTP status code.
   * @returns {void}
   * @example
   */
  sendError(res, message, statusCode = 500) {
    res.status(statusCode).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  }
}

module.exports = AuditLogController;
