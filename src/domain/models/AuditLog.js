/**
 * AuditLog Model - Audit trail logging for PCI DSS compliance and security monitoring.
 *
 * Tracks all user operations and data changes across the platform with comprehensive
 * logging of who did what, when, where, and how. Supports compliance requirements
 * for PCI DSS, SOC 2, and other regulatory frameworks requiring audit trails.
 *
 * Data Model:
 * - userId: string - User who performed the action
 * - username: string - Username for quick reference
 * - action: string - Action type (CREATE, READ, UPDATE, DELETE)
 * - entityType: string - Type of entity affected (Client, Employee, etc.)
 * - entityId: string - ID of the affected entity
 * - changes: object - Object containing field changes (before/after values)
 * - metadata: object - Additional context (IP, user agent, session info)
 * - timestamp: Date - When the action occurred
 * - active: boolean - Always true (audit logs never inactive)
 * - exists: boolean - Always true (audit logs never deleted).
 * @file Domain model for audit trail logging and compliance tracking.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Create audit log entry
 * const auditLog = new AuditLog();
 * auditLog.set('userId', 'abc123');
 * auditLog.set('username', 'admin@amexing.com');
 * auditLog.set('action', 'UPDATE');
 * auditLog.set('entityType', 'Client');
 * auditLog.set('entityId', 'xyz789');
 * auditLog.set('changes', {
 *   companyName: { from: 'Old Corp', to: 'New Corp Inc.' },
 *   email: { from: 'old@corp.com', to: 'new@corp.com' }
 * });
 * auditLog.set('metadata', { ip: '192.168.1.100', userAgent: 'Chrome' });
 * await auditLog.save(null, { useMasterKey: true });
 *
 * // Query audit logs
 * const userLogs = await AuditLog.queryByUser('user123', 30);
 * const entityLogs = await AuditLog.queryByEntity('Client', 'xyz789');
 * const recentLogs = await AuditLog.queryRecent(100);
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');

/**
 * AuditLog class for tracking all user operations and data changes.
 * Extends BaseModel to inherit lifecycle management but overrides methods
 * to prevent audit logs from being deactivated or deleted.
 * @class AuditLog
 * @augments BaseModel
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Create audit entry
 * const log = new AuditLog();
 * log.set('userId', 'user123');
 * log.set('action', 'CREATE');
 * log.set('entityType', 'Client');
 * await log.save();
 */
class AuditLog extends BaseModel {
  /**
   * Constructor for AuditLog.
   * Initializes the Parse Object with the AuditLog class name.
   * @example
   * // Constructor usage
   * const auditLog = new AuditLog();
   */
  constructor() {
    super('AuditLog');
  }

  /**
   * Validates audit log data before saving.
   * Ensures all required fields are present and valid.
   * @returns {boolean} - True if valid, throws error otherwise.
   * @throws {Error} If required fields are missing or invalid.
   * @example
   * // Validation
   * const log = new AuditLog();
   * log.set('userId', 'user123');
   * log.validate(); // throws if invalid
   */
  validate() {
    const required = ['userId', 'action', 'entityType', 'timestamp'];

    for (const field of required) {
      if (!this.get(field)) {
        throw new Error(`AuditLog validation failed: ${field} is required`);
      }
    }

    // Validate action type
    const validActions = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'ACCESS'];
    if (!validActions.includes(this.get('action'))) {
      throw new Error(`AuditLog validation failed: action must be one of ${validActions.join(', ')}`);
    }

    return true;
  }

  /**
   * Override: Audit logs cannot be deactivated.
   * @throws {Error} Always throws error as audit logs must remain active.
   * @example
   * // This will throw
   * log.deactivate(); // Error: Audit logs cannot be deactivated
   */
  async deactivate() {
    throw new Error('Audit logs cannot be deactivated for compliance reasons');
  }

  /**
   * Override: Audit logs cannot be soft deleted.
   * @throws {Error} Always throws error as audit logs must be preserved.
   * @example
   * // This will throw
   * log.softDelete(); // Error: Audit logs cannot be deleted
   */
  async softDelete() {
    throw new Error('Audit logs cannot be deleted for compliance reasons');
  }

  /**
   * Query audit logs by user ID.
   * @param {string} userId - User ID to query.
   * @param {number} [limit] - Maximum number of results.
   * @returns {Promise<Array<AuditLog>>} - Promise resolving to array of audit logs.
   * @example
   * // Get user's recent actions
   * const logs = await AuditLog.queryByUser('user123', 50);
   * logs.forEach(log => console.log(log.get('action')));
   */
  static async queryByUser(userId, limit = 100) {
    const query = new Parse.Query(AuditLog);
    query.equalTo('userId', userId);
    query.descending('timestamp');
    query.limit(limit);
    return query.find({ useMasterKey: true });
  }

  /**
   * Query audit logs by entity type and ID.
   * @param {string} entityType - Type of entity (e.g., 'Client', 'Employee').
   * @param {string} [entityId] - Optional entity ID to filter by.
   * @param {number} [limit] - Maximum number of results.
   * @returns {Promise<Array<AuditLog>>} - Promise resolving to array of audit logs.
   * @example
   * // Get all changes to a specific client
   * const logs = await AuditLog.queryByEntity('Client', 'xyz789');
   *
   * // Get all changes to any client
   * const allClientLogs = await AuditLog.queryByEntity('Client');
   */
  static async queryByEntity(entityType, entityId = null, limit = 100) {
    const query = new Parse.Query(AuditLog);
    query.equalTo('entityType', entityType);

    if (entityId) {
      query.equalTo('entityId', entityId);
    }

    query.descending('timestamp');
    query.limit(limit);
    return query.find({ useMasterKey: true });
  }

  /**
   * Query audit logs by action type.
   * @param {string} action - Action type (CREATE, UPDATE, DELETE, etc.).
   * @param {number} [limit] - Maximum number of results.
   * @returns {Promise<Array<AuditLog>>} - Promise resolving to array of audit logs.
   * @example
   * // Get all DELETE operations
   * const deletions = await AuditLog.queryByAction('DELETE');
   */
  static async queryByAction(action, limit = 100) {
    const query = new Parse.Query(AuditLog);
    query.equalTo('action', action);
    query.descending('timestamp');
    query.limit(limit);
    return query.find({ useMasterKey: true });
  }

  /**
   * Query recent audit logs.
   * @param {number} [limit] - Maximum number of results.
   * @returns {Promise<Array<AuditLog>>} - Promise resolving to array of audit logs.
   * @example
   * // Get 50 most recent audit entries
   * const recent = await AuditLog.queryRecent(50);
   */
  static async queryRecent(limit = 100) {
    const query = new Parse.Query(AuditLog);
    query.descending('timestamp');
    query.limit(limit);
    return query.find({ useMasterKey: true });
  }

  /**
   * Query audit logs by date range.
   * @param {Date} startDate - Start of date range.
   * @param {Date} endDate - End of date range.
   * @param {number} [limit] - Maximum number of results.
   * @returns {Promise<Array<AuditLog>>} - Promise resolving to array of audit logs.
   * @example
   * // Get logs from last 7 days
   * const start = new Date();
   * start.setDate(start.getDate() - 7);
   * const logs = await AuditLog.queryByDateRange(start, new Date());
   */
  static async queryByDateRange(startDate, endDate, limit = 1000) {
    const query = new Parse.Query(AuditLog);
    query.greaterThanOrEqualTo('timestamp', startDate);
    query.lessThanOrEqualTo('timestamp', endDate);
    query.descending('timestamp');
    query.limit(limit);
    return query.find({ useMasterKey: true });
  }

  /**
   * Create audit log entry (static helper).
   * @param {object} data - Audit log data.
   * @param {string} data.userId - User who performed action.
   * @param {string} data.username - Username for reference.
   * @param {string} data.action - Action type.
   * @param {string} data.entityType - Entity type affected.
   * @param {string} [data.entityId] - Entity ID affected.
   * @param {object} [data.changes] - Field changes.
   * @param {object} [data.metadata] - Additional metadata.
   * @returns {Promise<AuditLog>} - Promise resolving to saved audit log.
   * @example
   * // Create audit entry
   * await AuditLog.createEntry({
   *   userId: 'user123',
   *   username: 'admin@amexing.com',
   *   action: 'UPDATE',
   *   entityType: 'Client',
   *   entityId: 'xyz789',
   *   changes: { companyName: { from: 'Old', to: 'New' } },
   *   metadata: { ip: '192.168.1.1' }
   * });
   */
  static async createEntry(data) {
    const log = new AuditLog();

    // Set required fields
    log.set('userId', data.userId);
    log.set('username', data.username || 'unknown');
    log.set('action', data.action);
    log.set('entityType', data.entityType);
    log.set('timestamp', new Date());

    // Set optional fields
    if (data.entityId) log.set('entityId', data.entityId);
    if (data.changes) log.set('changes', data.changes);
    if (data.metadata) log.set('metadata', data.metadata);

    // Audit logs are always active and exist
    log.set('active', true);
    log.set('exists', true);

    // Validate before saving
    log.validate();

    return log.save(null, { useMasterKey: true });
  }

  /**
   * Get summary statistics for audit logs.
   * @param {object} [filters] - Optional filters.
   * @param {string} [filters.userId] - Filter by user.
   * @param {string} [filters.entityType] - Filter by entity type.
   * @param {Date} [filters.startDate] - Filter by start date.
   * @param {Date} [filters.endDate] - Filter by end date.
   * @returns {Promise<object>} - Promise resolving to statistics object.
   * @example
   * // Get stats for last month
   * const start = new Date();
   * start.setMonth(start.getMonth() - 1);
   * const stats = await AuditLog.getStatistics({ startDate: start });
   * console.log(stats.total, stats.byAction, stats.byEntity);
   */
  static async getStatistics(filters = {}) {
    const query = new Parse.Query(AuditLog);

    if (filters.userId) query.equalTo('userId', filters.userId);
    if (filters.entityType) query.equalTo('entityType', filters.entityType);
    if (filters.startDate) query.greaterThanOrEqualTo('timestamp', filters.startDate);
    if (filters.endDate) query.lessThanOrEqualTo('timestamp', filters.endDate);

    const total = await query.count({ useMasterKey: true });

    // Get breakdown by action
    const actions = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT'];
    const byAction = {};

    for (const action of actions) {
      const actionQuery = new Parse.Query(AuditLog);
      Object.assign(actionQuery, query); // Copy filters
      actionQuery.equalTo('action', action);
      byAction[action] = await actionQuery.count({ useMasterKey: true });
    }

    return {
      total,
      byAction,
      filters,
    };
  }
}

// Register the subclass with Parse
Parse.Object.registerSubclass('AuditLog', AuditLog);

module.exports = AuditLog;
