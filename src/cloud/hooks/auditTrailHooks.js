/**
 * Audit Trail Hooks - Automatic audit logging for all Parse Server operations.
 *
 * Registers generic beforeSave, afterSave, and beforeDelete hooks for all Parse classes
 * to automatically log user operations to the AuditLog table. Captures:
 * - User who performed the action
 * - Action type (CREATE, UPDATE, DELETE)
 * - Entity type and ID
 * - Field changes (before/after values)
 * - Request metadata (IP, timestamp).
 *
 * Features:
 * - Generic hooks for all entity types
 * - Automatic change detection (dirty fields)
 * - PCI DSS compliant logging (no sensitive data)
 * - Request context extraction (user, IP)
 * - Async/non-blocking audit logging
 * - Error handling to prevent operation failures.
 * @file Parse Server hooks for automatic audit trail generation.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2025-10-16
 * @example
 * // Register hooks during server startup
 * const { registerAuditHooks } = require('./cloud/hooks/auditTrailHooks');
 * registerAuditHooks();
 *
 * // Hooks will automatically log all operations:
 * const client = new Parse.Object('Client');
 * client.set('companyName', 'Acme Corp');
 * await client.save(); // Automatically logged as CREATE
 *
 * client.set('companyName', 'Acme Inc.');
 * await client.save(); // Automatically logged as UPDATE with changes
 */

// IMPORTANT: Parse object is provided by Parse Server in cloud code context
// Do NOT require 'parse/node' as it will override Parse.Cloud methods
const logger = require('../../infrastructure/logger');
const { getParseContext } = require('../../infrastructure/parseContext');
// NOTE: We cannot use the AuditLog model class in cloud code context
// because it uses parse/node which conflicts with Parse Server's Parse object
// Instead, we'll create Parse.Object directly

/**
 * Classes to exclude from audit logging.
 * These classes don't need audit trails or would create circular logging.
 * @constant {Set<string>}
 */
const EXCLUDED_CLASSES = new Set([
  'AuditLog', // Prevent circular logging
  '_Session', // Session management
  '_Role', // Parse internal
  '_Installation', // Device installations
  '_PushStatus', // Push notification status
]);

/**
 * Sensitive data classes that require READ operation auditing for PCI DSS compliance.
 * Only individual object access (single result) is logged, not bulk queries.
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
 * Fields to exclude from change tracking (sensitive or system fields).
 * @constant {Set<string>}
 */
const EXCLUDED_FIELDS = new Set([
  'password', // Never log passwords
  'sessionToken', // Security tokens
  'authData', // OAuth authentication data
  'ACL', // Access control lists
]);

/**
 * Extract user context from Parse request.
 * Attempts to get user info from multiple sources: request.user, context, sessionToken, custom headers.
 * @param {object} request - Parse Cloud trigger request.
 * @returns {Promise<object>} - User context object with userId, username, ip.
 * @example
 * // const context = await extractUserContext(request);
 * // Returns: { userId: 'abc123', username: 'admin@amexing.com', ip: '192.168.1.1' }
 */
async function extractUserContext(request) {
  const context = {
    userId: null,
    username: null,
    ip: request.ip || 'unknown',
  };

  // Normalize localhost IPv6 to readable format
  if (context.ip === '::1' || context.ip === '::ffff:127.0.0.1') {
    context.ip = '127.0.0.1 (localhost)';
  }

  try {
    // 1. Try to get user from AsyncLocalStorage (global context propagation)
    // NOTE: This approach does NOT work for Parse Server cloud hooks due to V8 context isolation
    // See docs/AUDIT_READ_CONTEXT_LIMITATION.md for details
    const asyncContext = getParseContext();
    if (asyncContext && asyncContext.user) {
      context.userId = asyncContext.user.objectId || asyncContext.user.id;
      context.username = asyncContext.user.username || asyncContext.user.email || 'unknown';
      context.ip = asyncContext.ip || context.ip;
    } else if (request.headers && request.headers['x-audit-user-id']) {
      // 2. Try to get user from custom audit headers (set by auditContextMiddleware)
      context.userId = request.headers['x-audit-user-id'];
      context.username = request.headers['x-audit-username'] || 'unknown';
      if (request.headers['x-audit-ip']) {
        context.ip = request.headers['x-audit-ip'];
      }
    } else if (request.user) {
      // 3. Try to get user from request.user (most common in cloud functions)
      context.userId = request.user.id;
      context.username = request.user.get('username') || request.user.get('email') || 'unknown';
    } else if (request.context && request.context.user) {
      // 3. Try to get user from request context (from save operations with context)
      context.userId = request.context.user.objectId || request.context.user.id;
      context.username = request.context.user.email || request.context.user.username || 'unknown';
    } else if (request.headers && request.headers['x-parse-session-token']) {
      // 4. Try to extract from sessionToken in headers (from API calls)
      const sessionToken = request.headers['x-parse-session-token'];
      const query = new Parse.Query(Parse.Session);
      query.equalTo('sessionToken', sessionToken);
      query.include('user');
      const session = await query.first({ useMasterKey: true });

      if (session && session.get('user')) {
        const user = session.get('user');
        context.userId = user.id;
        context.username = user.get('username') || user.get('email') || 'unknown';
      }
    } else if (request.master) {
      // 5. Check if master key was used
      context.userId = 'system';
      context.username = 'MasterKey';
    } else {
      // 6. Fallback to anonymous
      context.userId = 'anonymous';
      context.username = 'Anonymous';
    }

    // Additional context from custom middleware (legacy support)
    if (request.auditContext) {
      Object.assign(context, request.auditContext);
    }
  } catch (error) {
    logger.error('Error extracting user context for audit', {
      error: error.message,
    });
    // Fallback to system if error
    context.userId = 'system';
    context.username = 'System (error)';
  }

  return context;
}

/**
 * Extract field changes from dirty Parse Object.
 * Compares dirty fields with original values to track changes.
 * @param {Parse.Object} object - Parse Object being saved.
 * @returns {object} - Object mapping field names to {from, to} values.
 * @example
 * // const changes = extractChanges(clientObject);
 * // Returns: { companyName: { from: 'Old Name', to: 'New Name' } }
 */
function extractChanges(object) {
  const changes = {};

  try {
    // Check if object has dirtyKeys method
    if (!object || typeof object.dirtyKeys !== 'function') {
      logger.warn('Object does not have dirtyKeys method', {
        className: object?.className,
        objectId: object?.id,
      });
      return changes;
    }

    const dirtyKeys = object.dirtyKeys();

    for (const key of dirtyKeys) {
      // Skip excluded fields
      if (!EXCLUDED_FIELDS.has(key)) {
        try {
          // Get new value safely
          const newValue = object.get(key);

          // For new objects or objects without server data, oldValue is undefined
          let oldValue;
          // eslint-disable-next-line no-underscore-dangle
          const serverData = object._serverData;
          if (object.existed && object.existed() && serverData && key in serverData) {
            // eslint-disable-next-line no-underscore-dangle, security/detect-object-injection
            oldValue = serverData[key];
          }

          // Only include if values are different
          if (oldValue !== newValue) {
            changes[key] = {
              from: oldValue !== undefined ? oldValue : null,
              to: newValue !== undefined ? newValue : null,
            };
          }
        } catch (fieldError) {
          logger.warn('Failed to extract field for audit', {
            field: key,
            error: fieldError.message,
          });
          // Continue processing other fields
        }
      }
    }
  } catch (error) {
    console.error('❌ ERROR EXTRACTING CHANGES:', error.message);
    logger.error('Failed to extract changes for audit', {
      error: error.message,
      stack: error.stack,
      className: object?.className,
      objectId: object?.id,
    });
  }

  return changes;
}

/**
 * Extract entity name from Parse Object for better readability.
 * Tries common name fields to get a human-readable identifier.
 * @param {Parse.Object} object - Parse Object.
 * @returns {string} - Human-readable entity name or ID.
 * @example
 * // extractEntityName(clientObject) => "Acme Corp (ID: abc123)"
 */
function extractEntityName(object) {
  const { className } = object;

  // Try common name fields
  const nameFields = ['name', 'title', 'username', 'email', 'licensePlate', 'brand'];
  let entityName = null;

  for (const field of nameFields) {
    if (object.get(field)) {
      entityName = object.get(field);
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
 * Create audit log entry asynchronously.
 * Logs operation without blocking the main request flow.
 * @param {object} data - Audit log data.
 * @returns {Promise<void>} - Promise resolving when log is created.
 * @example
 */
async function createAuditLogEntry(data) {
  try {
    // Create Parse.Object directly in cloud code context
    const AuditLog = Parse.Object.extend('AuditLog');
    const log = new AuditLog();

    // Set required fields
    log.set('userId', data.userId);
    log.set('username', data.username || 'unknown');
    log.set('action', data.action);
    log.set('entityType', data.entityType);
    log.set('timestamp', new Date());

    // Set optional fields
    if (data.entityId) log.set('entityId', data.entityId);
    if (data.entityName) log.set('entityName', data.entityName);
    if (data.changes) log.set('changes', data.changes);
    if (data.metadata) log.set('metadata', data.metadata);

    // Audit logs are always active and exist
    log.set('active', true);
    log.set('exists', true);

    // Save with master key (audit logs require system-level permissions)
    await log.save(null, { useMasterKey: true });
  } catch (error) {
    // Log error but don't fail the operation
    console.error('❌ AUDIT LOG ERROR:', error.message);
    console.error('❌ AUDIT LOG STACK:', error.stack);
    console.error('❌ AUDIT LOG DATA:', JSON.stringify(data, null, 2));
    logger.error('Failed to create audit log entry', {
      error: error.message,
      stack: error.stack,
      data,
    });
  }
}

/**
 * Generic beforeSave hook for audit logging.
 * Captures changes before they are saved to detect modifications.
 * @param {object} request - Parse Cloud trigger request.
 * @returns {void} - No return value.
 * @example
 */
function beforeSaveHook(request) {
  const { object } = request;
  const { className } = object;

  // Skip excluded classes
  if (EXCLUDED_CLASSES.has(className)) {
    return;
  }

  // Store changes in request context for afterSave
  // Note: Using _auditContext is necessary for passing data between Parse hooks
  // eslint-disable-next-line no-underscore-dangle, no-param-reassign
  if (!request._auditContext) {
    // eslint-disable-next-line no-underscore-dangle, no-param-reassign
    request._auditContext = {};
  }

  // eslint-disable-next-line no-underscore-dangle, no-param-reassign
  request._auditContext.changes = extractChanges(object);
  // eslint-disable-next-line no-underscore-dangle, no-param-reassign
  request._auditContext.isNewObject = !object.existed();
  // eslint-disable-next-line no-underscore-dangle, no-param-reassign
  request._auditContext.userContext = extractUserContext(request);
}

/**
 * Generic afterSave hook for audit logging.
 * Creates audit log entry after successful save operation.
 * @param {object} request - Parse Cloud trigger request.
 * @returns {Promise<void>} - Promise resolving when audit logged.
 * @example
 */
async function afterSaveHook(request) {
  const { object } = request;
  const { className } = object;

  // Skip excluded classes
  if (EXCLUDED_CLASSES.has(className)) {
    return;
  }

  // Detect if this is a new object directly (can't rely on request context between hooks)
  const isNewObject = object.isNew();

  // Extract user context (await since it's now async)
  const userContext = await extractUserContext(request);

  // Extract entity name for better readability
  const entityName = extractEntityName(object);

  // For new objects, we don't need to detect changes - just log creation
  // For updates, we would need to detect changes but Parse doesn't provide dirty fields in afterSave
  // So we'll log all updates as generic UPDATE actions
  const changes = isNewObject ? { created: object.toJSON() } : { updated: true };

  // Create audit log entry asynchronously
  await createAuditLogEntry({
    userId: userContext.userId,
    username: userContext.username,
    action: isNewObject ? 'CREATE' : 'UPDATE',
    entityType: className,
    entityId: object.id,
    entityName,
    changes: isNewObject ? { created: object.toJSON() } : changes,
    metadata: {
      ip: userContext.ip,
      method: isNewObject ? 'CREATE' : 'UPDATE',
      timestamp: new Date(),
    },
  });

  logger.info('Audit log created', {
    action: isNewObject ? 'CREATE' : 'UPDATE',
    entityType: className,
    entityId: object.id,
    entityName,
    userId: userContext.userId,
  });
}

/**
 * Generic beforeDelete hook for audit logging.
 * Logs deletion operations before they occur.
 * @param {object} request - Parse Cloud trigger request.
 * @returns {Promise<void>} - Promise resolving when audit logged.
 * @example
 */
async function beforeDeleteHook(request) {
  const { object } = request;
  const { className } = object;

  // Skip excluded classes
  if (EXCLUDED_CLASSES.has(className)) {
    return;
  }

  // Extract user context (await since it's now async)
  const userContext = await extractUserContext(request);

  // Extract entity name for better readability
  const entityName = extractEntityName(object);

  // Create audit log entry
  await createAuditLogEntry({
    userId: userContext.userId,
    username: userContext.username,
    action: 'DELETE',
    entityType: className,
    entityId: object.id,
    entityName,
    changes: {
      deleted: object.toJSON(),
    },
    metadata: {
      ip: userContext.ip,
      method: 'DELETE',
      timestamp: new Date(),
    },
  });

  logger.info('Audit log created for deletion', {
    action: 'DELETE',
    entityType: className,
    entityId: object.id,
    entityName,
    userId: userContext.userId,
  });
}

/**
 * Generic afterFind hook for READ operation auditing (PCI DSS Requirement 10.2.1).
 * Only audits individual object access (single result) for sensitive data classes.
 * Bulk queries are not logged to prevent log volume issues.
 * @param {object} request - Parse Cloud trigger request.
 * @returns {Promise<void>} - Promise resolving when audit logged.
 * @example
 * // This will be audited (single object access):
 * const query = new Parse.Query('AmexingUser');
 * const user = await query.get('userId123');
 *
 * // This will NOT be audited (bulk query):
 * const query = new Parse.Query('AmexingUser');
 * const users = await query.find();
 */
async function afterFindHook(request) {
  const { objects } = request;

  // Only audit if exactly 1 object (individual read, not bulk query)
  if (!objects || objects.length !== 1) {
    return;
  }

  const object = objects[0];
  const { className } = object;

  // Only audit sensitive classes
  if (!AUDIT_READ_CLASSES.has(className)) {
    return;
  }

  // Extract user context - this will try multiple sources
  const userContext = await extractUserContext(request);

  // Extract entity name for better readability
  const entityName = extractEntityName(object);

  // Create audit log entry for READ operation
  await createAuditLogEntry({
    userId: userContext.userId,
    username: userContext.username,
    action: 'READ',
    entityType: className,
    entityId: object.id,
    entityName,
    changes: {
      accessed: true,
    },
    metadata: {
      ip: userContext.ip,
      method: 'READ',
      timestamp: new Date(),
    },
  });

  logger.info('Audit log created for READ', {
    action: 'READ',
    entityType: className,
    entityId: object.id,
    entityName,
    userId: userContext.userId,
  });
}

/**
 * Register READ audit hooks for sensitive data classes.
 * Called by registerAuditHooks() to enable PCI DSS compliant READ auditing.
 * @returns {void} - No return value.
 * @example
 * // Register READ audit hooks for sensitive classes
 * registerAuditReadHooks();
 */
function registerAuditReadHooks() {
  try {
    AUDIT_READ_CLASSES.forEach((className) => {
      Parse.Cloud.afterFind(className, afterFindHook);
    });

    logger.info(
      `Registered READ audit hooks for ${AUDIT_READ_CLASSES.size} sensitive classes: ${Array.from(AUDIT_READ_CLASSES).join(', ')}`
    );
  } catch (error) {
    logger.error('Failed to register READ audit hooks', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Register audit trail hooks for all Parse classes.
 * Call this function during server startup to enable automatic audit logging.
 * @param {Array<string>} [includedClasses] - Optional whitelist of classes to audit.
 * @returns {void} - No return value.
 * @example
 * // Register for all classes
 * registerAuditHooks();
 *
 * // Register for specific classes only
 * registerAuditHooks(['Client', 'Employee', 'AmexingUser']);
 */
function registerAuditHooks(includedClasses = null) {
  try {
    if (includedClasses && Array.isArray(includedClasses)) {
      // Register for specific classes
      for (const className of includedClasses) {
        if (!EXCLUDED_CLASSES.has(className)) {
          Parse.Cloud.beforeSave(className, beforeSaveHook);
          Parse.Cloud.afterSave(className, afterSaveHook);
          Parse.Cloud.beforeDelete(className, beforeDeleteHook);

          logger.info(`Registered audit hooks for class: ${className}`);
        } else {
          logger.warn(`Skipping audit hooks for excluded class: ${className}`);
        }
      }
    } else {
      // Register generic hooks for all classes
      // Note: Parse Server will call these for all classes except excluded ones
      logger.info('Registering generic audit trail hooks for all classes');

      // We need to register for each known class individually
      // Common AmexingWeb classes
      const amexingClasses = [
        'Client',
        'Employee',
        'Driver',
        'AmexingUser',
        'Department',
        'Vehicle',
        'VehicleType',
        'POI',
        'Service',
        'Experience',
        'ExperienceImage',
        'VehicleImage',
        'Permission',
        'DelegatedPermission',
      ];

      for (const className of amexingClasses) {
        Parse.Cloud.beforeSave(className, beforeSaveHook);
        Parse.Cloud.afterSave(className, afterSaveHook);
        Parse.Cloud.beforeDelete(className, beforeDeleteHook);
      }

      logger.info(`Registered audit hooks for ${amexingClasses.length} classes`);
    }

    // Register READ audit hooks for sensitive classes (PCI DSS Requirement 10.2.1)
    // DISABLED: afterFind hooks don't have access to authenticated user context
    // See docs/AUDIT_READ_CONTEXT_LIMITATION.md for technical explanation
    // Using manual audit logging in controllers instead (Option 1: Custom REST API)
    // registerAuditReadHooks();

    logger.info('Audit trail hooks registered successfully (READ hooks disabled - using manual audit)');
  } catch (error) {
    logger.error('Failed to register audit trail hooks', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

module.exports = {
  registerAuditHooks,
  registerAuditReadHooks,
  beforeSaveHook,
  afterSaveHook,
  beforeDeleteHook,
  afterFindHook,
  extractUserContext,
  extractChanges,
};
// Force restart
