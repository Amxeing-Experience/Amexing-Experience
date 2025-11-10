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
 * @since 2024
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

      if (!this.validatePermissions(req.userRole)) {
        return this.sendError(res, 'Insufficient permissions', 403);
      }

      const { pagination, filters } = this.parseAuditLogParams(req.query);
      const query = this.buildAuditLogQuery(filters);
      const dateValidation = this.validateDateFilters(filters, res);
      if (dateValidation) return dateValidation;

      this.applySortingAndPagination(query, filters, pagination);
      const [logs, totalCount] = await this.executeQuery(query);
      const formattedLogs = this.formatAuditLogs(logs);
      const response = this.buildResponse(formattedLogs, totalCount, pagination, filters);

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

  // ===== HELPER METHODS =====

  /**
   * Validate user permissions for audit log access.
   * @param {string} userRole - User role to validate.
   * @returns {boolean} True if user has permissions.
   * @example
   * const hasPermissions = this.validatePermissions('admin');
   */
  validatePermissions(userRole) {
    return userRole === 'admin' || userRole === 'superadmin';
  }

  /**
   * Parse and validate query parameters for audit logs.
   * @param {object} query - Request query parameters.
   * @returns {object} Parsed pagination and filters.
   * @example
   * const { pagination, filters } = this.parseAuditLogParams(req.query);
   */
  parseAuditLogParams(query) {
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
    } = query;

    const validatedPage = Math.max(1, parseInt(page, 10) || 1);
    const validatedLimit = Math.min(this.maxPageSize, Math.max(1, parseInt(limit, 10) || this.defaultPageSize));

    return {
      pagination: {
        page: validatedPage,
        limit: validatedLimit,
        skip: (validatedPage - 1) * validatedLimit,
      },
      filters: {
        userId,
        username,
        action,
        entityType,
        entityId,
        startDate,
        endDate,
        sortField,
        sortDirection,
      },
    };
  }

  /**
   * Build Parse query with basic setup.
   * @param {object} filters - Filter parameters.
   * @returns {object} Parse query object.
   * @example
   * const query = this.buildAuditLogQuery(filters);
   */
  buildAuditLogQuery(filters) {
    const Parse = require('parse/node');
    const query = new Parse.Query(AuditLog);

    if (filters.userId) {
      query.equalTo('userId', filters.userId);
    }
    if (filters.username) {
      query.contains('username', filters.username);
    }
    if (filters.action) {
      query.equalTo('action', filters.action.toUpperCase());
    }
    if (filters.entityType) {
      query.equalTo('entityType', filters.entityType);
    }
    if (filters.entityId) {
      query.equalTo('entityId', filters.entityId);
    }

    return query;
  }

  /**
   * Validate date filters and apply them to query.
   * @param {object} filters - Filter parameters.
   * @param {object} res - Express response object.
   * @returns {object|null} Error response or null if valid.
   * @example
   * const error = this.validateDateFilters(filters, res);
   */
  validateDateFilters(filters, res) {
    if (filters.startDate) {
      try {
        const startDate = new Date(filters.startDate);
        if (Number.isNaN(startDate.getTime())) {
          return this.sendError(res, 'Invalid startDate format', 400);
        }
      } catch {
        return this.sendError(res, 'Invalid startDate format', 400);
      }
    }
    if (filters.endDate) {
      try {
        const endDate = new Date(filters.endDate);
        if (Number.isNaN(endDate.getTime())) {
          return this.sendError(res, 'Invalid endDate format', 400);
        }
      } catch {
        return this.sendError(res, 'Invalid endDate format', 400);
      }
    }
    return null;
  }

  /**
   * Apply sorting and pagination to query.
   * @param {object} query - Parse query object.
   * @param {object} filters - Filter parameters.
   * @param {object} pagination - Pagination parameters.
   * @example
   * this.applySortingAndPagination(query, filters, pagination);
   */
  applySortingAndPagination(query, filters, pagination) {
    if (filters.startDate) {
      query.greaterThanOrEqualTo('timestamp', new Date(filters.startDate));
    }
    if (filters.endDate) {
      query.lessThanOrEqualTo('timestamp', new Date(filters.endDate));
    }

    if (filters.sortDirection === 'asc') {
      query.ascending(filters.sortField);
    } else {
      query.descending(filters.sortField);
    }

    query.skip(pagination.skip);
    query.limit(pagination.limit);
  }

  /**
   * Execute query and get results.
   * @param {object} query - Parse query object.
   * @returns {Promise<Array>} Array of [logs, totalCount].
   * @example
   * const [logs, totalCount] = await this.executeQuery(query);
   */
  async executeQuery(query) {
    return Promise.all([
      query.find({ useMasterKey: true }),
      query.count({ useMasterKey: true }),
    ]);
  }

  /**
   * Format audit logs for frontend response.
   * @param {Array} logs - Raw audit log objects.
   * @returns {Array} Formatted log objects.
   * @example
   * const formatted = this.formatAuditLogs(logs);
   */
  formatAuditLogs(logs) {
    return logs.map((log) => ({
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
  }

  /**
   * Build final response object.
   * @param {Array} formattedLogs - Formatted log data.
   * @param {number} totalCount - Total number of logs.
   * @param {object} pagination - Pagination parameters.
   * @param {object} filters - Applied filters.
   * @returns {object} Complete response object.
   * @example
   * const response = this.buildResponse(logs, count, pagination, filters);
   */
  buildResponse(formattedLogs, totalCount, pagination, filters) {
    const totalPages = Math.ceil(totalCount / pagination.limit);

    return {
      data: formattedLogs,
      pagination: {
        total: totalCount,
        page: pagination.page,
        limit: pagination.limit,
        totalPages,
        hasNext: pagination.page < totalPages,
        hasPrev: pagination.page > 1,
      },
      filters: {
        userId: filters.userId,
        username: filters.username,
        action: filters.action,
        entityType: filters.entityType,
        entityId: filters.entityId,
        startDate: filters.startDate,
        endDate: filters.endDate,
      },
    };
  }

  /**
   * Helper method to send successful response.
   * @param {object} res - Express response object.
   * @param {object} data - Response data.
   * @param {string} [message] - Success message.
   * @returns {void}
   * @example
   * this.sendSuccess(res, { logs: [] }, 'Success');
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
   * this.sendError(res, 'Error message', 400);
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
