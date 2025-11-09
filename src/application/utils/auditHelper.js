/**
 * Audit Helper - Manual audit logging utilities for READ operations.
 *
 * Provides helper functions for explicit audit logging with correct user attribution.
 * Used as workaround for Parse Server cloud hooks limitation (see docs/AUDIT_READ_CONTEXT_LIMITATION.md).
 * @file Audit logging helper functions.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2025-10-16
 * @example
 * // In controller:
 * const { logReadAccess } = require('../utils/auditHelper');
 *
 * const user = await query.get(userId);
 * await logReadAccess(req, user, 'AmexingUser');
 */

const logger = require('../../infrastructure/logger');

/**
 * Sensitive data classes that require READ operation auditing for PCI DSS compliance.
 * @constant {Set<string>}
 */
const AUDIT_READ_CLASSES = new Set([
  'AmexingUser', // User account data
  'Client', // Corporate client data
  'Employee', // Employee personal data
  'Driver', // Driver personal data
  'Payment', // Payment/transaction data (when implemented)
  'Transaction', // Financial transaction data (when implemented)
  'AuditLog', // Access to audit logs themselves
]);

/**
 * Extract entity name from Parse Object for better readability.
 * Tries common name fields to get a human-readable identifier.
 * @param {Parse.Object} entity - Parse Object.
 * @returns {string} - Human-readable entity name or className.
 * @example
 * // extractEntityName(userObject) => "admin@dev.amexing.com"
 */
function extractEntityName(entity) {
  const { className } = entity;

  // Try common name fields
  const nameFields = ['name', 'title', 'username', 'email', 'licensePlate', 'brand', 'companyName'];
  let entityName = null;

  for (const field of nameFields) {
    const value = entity.get ? entity.get(field) : entity[field];
    if (value) {
      entityName = value;
      break;
    }
  }

  // Return just the name if found, otherwise className
  if (entityName) {
    return entityName;
  }
  return className;
}

/**
 * Log READ access to sensitive data with correct user attribution.
 * Creates audit log entry for individual object access (PCI DSS Requirement 10.2.1).
 * @param {object} req - Express request object with authenticated user.
 * @param {Parse.Object|object} entity - Parse Object or plain object being accessed.
 * @param {string} className - Parse class name (e.g., 'AmexingUser', 'Client').
 * @returns {Promise<void>} - Promise resolving when audit log is created.
 * @throws {Error} - If user is not authenticated or entity is invalid.
 * @example
 * // In controller:
 * const user = await query.get(userId);
 * await logReadAccess(req, user, 'AmexingUser');
 */
async function logReadAccess(req, entity, className) {
  try {
    // Validate user authentication
    if (!req.user || !req.user.id) {
      logger.warn('Attempted READ audit without authenticated user', {
        className,
        entityId: entity?.id || entity?.objectId,
        path: req.path,
      });
      throw new Error('User authentication required for audit logging');
    }

    // Validate entity
    if (!entity) {
      logger.warn('Attempted READ audit with null entity', {
        className,
        userId: req.user.id,
        path: req.path,
      });
      throw new Error('Entity required for audit logging');
    }

    // Only audit sensitive classes
    if (!AUDIT_READ_CLASSES.has(className)) {
      logger.debug('Skipping READ audit for non-sensitive class', {
        className,
        userId: req.user.id,
      });
      return;
    }

    // Extract entity details
    const entityId = entity.id || entity.objectId;
    const entityName = extractEntityName(entity);

    // Create audit log entry using Parse.Object directly
    const Parse = require('parse/node');
    const AuditLog = Parse.Object.extend('AuditLog');
    const log = new AuditLog();

    // Set required fields
    log.set('userId', req.user.id);
    log.set('username', req.user.email || req.user.username || req.user.get?.('email') || 'unknown');
    log.set('action', 'READ');
    log.set('entityType', className);
    log.set('timestamp', new Date());

    // Set optional fields
    if (entityId) log.set('entityId', entityId);
    if (entityName) log.set('entityName', entityName);

    log.set('changes', {
      accessed: true,
      endpoint: req.path,
    });

    log.set('metadata', {
      ip: req.ip || req.connection?.remoteAddress || 'unknown',
      method: 'READ',
      endpoint: req.path,
      userAgent: req.headers?.['user-agent'] || 'unknown',
      timestamp: new Date(),
    });

    // Audit logs are always active and exist
    log.set('active', true);
    log.set('exists', true);

    // Save with master key (audit logs require system-level permissions)
    await log.save(null, { useMasterKey: true });

    logger.info('READ audit log created', {
      action: 'READ',
      entityType: className,
      entityId,
      entityName,
      userId: req.user.id,
      username: req.user.email || req.user.username,
      endpoint: req.path,
    });
  } catch (error) {
    // Log error but don't fail the operation
    logger.error('Failed to create READ audit log entry', {
      error: error.message,
      stack: error.stack,
      className,
      userId: req.user?.id,
      path: req.path,
    });
    // Don't throw - audit logging failure shouldn't break the request
  }
}

/**
 * Log bulk READ access to sensitive data (list queries).
 * Creates a single audit log entry for list access rather than individual records.
 * @param {object} req - Express request object with authenticated user.
 * @param {Array<Parse.Object>} entities - Array of Parse Objects being accessed.
 * @param {string} className - Parse class name (e.g., 'AmexingUser', 'Client').
 * @param {object} [queryParams] - Query parameters used for filtering.
 * @returns {Promise<void>} - Promise resolving when audit log is created.
 * @example
 * // In controller:
 * const users = await query.find();
 * await logBulkReadAccess(req, users, 'AmexingUser', { active: true });
 */
async function logBulkReadAccess(req, entities, className, queryParams = {}) {
  try {
    // Validate user authentication
    if (!req.user || !req.user.id) {
      logger.warn('Attempted bulk READ audit without authenticated user', {
        className,
        count: entities?.length || 0,
        path: req.path,
      });
      throw new Error('User authentication required for audit logging');
    }

    // Only audit sensitive classes
    if (!AUDIT_READ_CLASSES.has(className)) {
      logger.debug('Skipping bulk READ audit for non-sensitive class', {
        className,
        userId: req.user.id,
      });
      return;
    }

    const count = entities?.length || 0;

    // Create audit log entry using Parse.Object directly
    const Parse = require('parse/node');
    const AuditLog = Parse.Object.extend('AuditLog');
    const log = new AuditLog();

    // Set required fields
    log.set('userId', req.user.id);
    log.set('username', req.user.email || req.user.username || req.user.get?.('email') || 'unknown');
    log.set('action', 'READ_BULK');
    log.set('entityType', className);
    log.set('timestamp', new Date());

    log.set('entityName', `${count} ${className} records`);

    log.set('changes', {
      accessed: true,
      count,
      queryParams,
      endpoint: req.path,
    });

    log.set('metadata', {
      ip: req.ip || req.connection?.remoteAddress || 'unknown',
      method: 'READ_BULK',
      endpoint: req.path,
      count,
      userAgent: req.headers?.['user-agent'] || 'unknown',
      timestamp: new Date(),
    });

    // Audit logs are always active and exist
    log.set('active', true);
    log.set('exists', true);

    // Save with master key (audit logs require system-level permissions)
    await log.save(null, { useMasterKey: true });

    logger.info('Bulk READ audit log created', {
      action: 'READ_BULK',
      entityType: className,
      count,
      userId: req.user.id,
      username: req.user.email || req.user.username,
      endpoint: req.path,
    });
  } catch (error) {
    // Log error but don't fail the operation
    logger.error('Failed to create bulk READ audit log entry', {
      error: error.message,
      stack: error.stack,
      className,
      count: entities?.length || 0,
      userId: req.user?.id,
      path: req.path,
    });
    // Don't throw - audit logging failure shouldn't break the request
  }
}

/**
 * Check if a class requires READ auditing for PCI DSS compliance.
 * @param {string} className - Parse class name.
 * @returns {boolean} - True if class requires READ auditing.
 * @example
 * // if (requiresReadAudit('AmexingUser')) { ... }
 */
function requiresReadAudit(className) {
  return AUDIT_READ_CLASSES.has(className);
}

module.exports = {
  logReadAccess,
  logBulkReadAccess,
  requiresReadAudit,
  extractEntityName,
  AUDIT_READ_CLASSES,
};
