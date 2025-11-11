/**
 * AuditLogHelper - Utility functions for audit log operations.
 * Extracted from AuditLogController to reduce file size and improve maintainability.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

/**
 * AuditLogHelper class containing utility functions for audit log operations.
 */
class AuditLogHelper {
  /**
   * Validates user permissions for audit log access.
   * @param {string} userRole - User role.
   * @returns {boolean} True if user has permissions.
   * @example
   */
  static validatePermissions(userRole) {
    return userRole === 'SuperAdmin' || userRole === 'Admin';
  }

  /**
   * Parses and validates query parameters for audit log requests.
   * @param {object} query - Request query parameters.
   * @returns {object} Parsed pagination and filters.
   * @example
   */
  static parseAuditLogParams(query) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(query.limit, 10) || 50, 1),
      1000
    );

    const pagination = {
      page,
      limit,
      skip: (page - 1) * limit,
    };

    const filters = {
      userId: query.userId,
      username: query.username ? query.username.trim() : null,
      action: query.action,
      entityType: query.entityType,
      entityId: query.entityId,
      startDate: query.startDate,
      endDate: query.endDate,
      sortField: query.sortField || 'timestamp',
      sortDirection: query.sortDirection === 'asc' ? 'asc' : 'desc',
    };

    return { pagination, filters };
  }

  /**
   * Builds Parse query for audit logs based on filters.
   * @param {object} filters - Filter parameters.
   * @returns {Parse.Query} Configured Parse query.
   * @example
   */
  static buildAuditLogQuery(filters) {
    const AuditLog = require('../../../../domain/models/AuditLog');
    const query = AuditLog.query();

    if (filters.userId) {
      query.equalTo('userId', filters.userId);
    }

    if (filters.username) {
      query.matches('username', filters.username, 'i');
    }

    if (filters.action) {
      query.equalTo('action', filters.action);
    }

    if (filters.entityType) {
      query.equalTo('entityType', filters.entityType);
    }

    if (filters.entityId) {
      query.equalTo('entityId', filters.entityId);
    }

    if (filters.startDate) {
      query.greaterThanOrEqualTo('timestamp', new Date(filters.startDate));
    }

    if (filters.endDate) {
      query.lessThanOrEqualTo('timestamp', new Date(filters.endDate));
    }

    return query;
  }

  /**
   * Validates date filters and returns error response if invalid.
   * @param {object} filters - Filter parameters.
   * @param {object} res - Express response object.
   * @returns {object|null} Error response or null if valid.
   * @example
   */
  static validateDateFilters(filters, res) {
    if (filters.startDate && Number.isNaN(Date.parse(filters.startDate))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid start date format. Use ISO format (YYYY-MM-DD)',
        timestamp: new Date().toISOString(),
      });
    }

    if (filters.endDate && Number.isNaN(Date.parse(filters.endDate))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid end date format. Use ISO format (YYYY-MM-DD)',
        timestamp: new Date().toISOString(),
      });
    }

    if (filters.startDate && filters.endDate) {
      const start = new Date(filters.startDate);
      const end = new Date(filters.endDate);
      if (start > end) {
        return res.status(400).json({
          success: false,
          error: 'Start date cannot be after end date',
          timestamp: new Date().toISOString(),
        });
      }
    }

    return null;
  }

  /**
   * Applies sorting and pagination to Parse query.
   * @param {Parse.Query} query - Parse query object.
   * @param {object} filters - Filter parameters.
   * @param {object} pagination - Pagination parameters.
   * @example
   */
  static applySortingAndPagination(query, filters, pagination) {
    if (filters.sortDirection === 'asc') {
      query.ascending(filters.sortField);
    } else {
      query.descending(filters.sortField);
    }

    query.skip(pagination.skip);
    query.limit(pagination.limit);
  }

  /**
   * Formats audit log data for API response.
   * @param {Array<Parse.Object>} logs - Array of audit log objects.
   * @returns {Array<object>} Formatted audit log data.
   * @example
   */
  static formatAuditLogs(logs) {
    return logs.map((log) => ({
      id: log.id,
      timestamp: log.get('timestamp'),
      userId: log.get('userId'),
      username: log.get('username'),
      userEmail: log.get('userEmail'),
      action: log.get('action'),
      entityType: log.get('entityType'),
      entityId: log.get('entityId'),
      entityName: log.get('entityName'),
      changes: log.get('changes'),
      metadata: log.get('metadata'),
      ipAddress: log.get('ipAddress'),
      userAgent: log.get('userAgent'),
      sessionId: log.get('sessionId'),
    }));
  }

  /**
   * Builds standardized response object for audit log APIs.
   * @param {Array<object>} formattedLogs - Formatted audit log data.
   * @param {number} totalCount - Total count of matching records.
   * @param {object} pagination - Pagination parameters.
   * @param {object} filters - Applied filters.
   * @returns {object} Complete response object.
   * @example
   */
  static buildResponse(formattedLogs, totalCount, pagination, filters) {
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
   * Sends successful API response.
   * @param {object} res - Express response object.
   * @param {object} data - Response data.
   * @param {string} [message] - Success message.
   * @example
   */
  static sendSuccess(res, data, message = 'Success') {
    res.status(200).json({
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Sends error API response.
   * @param {object} res - Express response object.
   * @param {string} message - Error message.
   * @param {number} [statusCode] - HTTP status code.
   * @example
   */
  static sendError(res, message, statusCode = 500) {
    res.status(statusCode).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  }
}

module.exports = AuditLogHelper;
