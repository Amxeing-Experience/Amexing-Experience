/**
 * OAuth Permissions Cloud Functions
 * Provides comprehensive permission management functionality for OAuth system.
 * @author Amexing Development Team
 * @version 1.0.0
 * @created Sprint 03 - OAuth Permission Management
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { 'parse/node': 'example' });
 * // Returns: function result
 */

const Parse = require('parse/node');
const OAuthPermissionService = require('../../application/services/OAuthPermissionService');
const PermissionInheritanceService = require('../../application/services/PermissionInheritanceService');
const PermissionContextService = require('../../application/services/PermissionContextService');
const PermissionDelegationService = require('../../application/services/PermissionDelegationService');
const { PermissionAuditService } = require('../../application/services/PermissionAuditService');
const logger = require('../../infrastructure/logger');

/**
 * Gets user permission inheritance status
 * Endpoint: GET /functions/getUserPermissionInheritance
 * Access: User can view own permissions, admins can view any.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const getUserPermissionInheritance = async (request) => {
  try {
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const { userId = request.user.id } = request.params;

    // Check authorization
    if (userId !== request.user.id) {
      const userRole = request.user.get('role');
      if (!['admin', 'superadmin', 'manager'].includes(userRole)) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, "Cannot view other users' permission inheritance");
      }
    }

    const inheritance = await PermissionInheritanceService.getInheritanceStatus(userId);

    logger.logSecurityEvent('PERMISSION_INHERITANCE_VIEWED', request.user.id, {
      targetUserId: userId,
      viewerRole: request.user.get('role'),
      hasInheritance: inheritance.hasInheritance,
    });

    return {
      success: true,
      userId,
      inheritance,
    };
  } catch (error) {
    logger.error('Error getting user permission inheritance:', error);
    throw error;
  }
};

/**
 * Gets available contexts for a user
 * Endpoint: GET /functions/getAvailableContexts
 * Access: User can view own contexts.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const getAvailableContexts = async (request) => {
  try {
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const { userId = request.user.id } = request.params;

    // Only allow users to view their own contexts unless admin
    if (userId !== request.user.id) {
      const userRole = request.user.get('role');
      if (!['admin', 'superadmin'].includes(userRole)) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, "Cannot view other users' contexts");
      }
    }

    const contexts = await PermissionContextService.getAvailableContexts(userId);

    return {
      success: true,
      userId,
      contexts,
      count: contexts.length,
    };
  } catch (error) {
    logger.error('Error getting available contexts:', error);
    throw error;
  }
};

/**
 * Switches user to a specific permission context
 * Endpoint: POST /functions/switchPermissionContext
 * Access: User can switch own context.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const switchPermissionContext = async (request) => {
  try {
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const { contextId } = request.params;
    const userId = request.user.id;
    const sessionToken = request.user.getSessionToken();

    if (!contextId) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'contextId is required');
    }

    const switchResult = await PermissionContextService.switchToContext(userId, contextId, sessionToken);

    // Record audit event
    await PermissionAuditService.recordPermissionAudit({
      userId,
      action: 'CONTEXT_SWITCHED',
      permission: 'context_switch',
      performedBy: userId,
      reason: `Switched to context: ${contextId}`,
      context: contextId,
      metadata: {
        fromContext: switchResult.previousContext,
        toContext: contextId,
        sessionId: sessionToken,
      },
    });

    return {
      success: true,
      ...switchResult,
    };
  } catch (error) {
    logger.error('Error switching permission context:', error);
    throw error;
  }
};

/**
 * Creates permission delegation from manager to employee
 * Endpoint: POST /functions/createPermissionDelegation
 * Access: Requires manager role or higher.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const createPermissionDelegation = async (request) => {
  try {
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const userRole = request.user.get('role');
    if (!['manager', 'admin', 'superadmin'].includes(userRole)) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Insufficient permissions to create delegation');
    }

    const {
      employeeId, permissions, delegationType, duration, reason, context,
    } = request.params;

    // Validate required parameters
    if (!employeeId || !permissions || !delegationType || !reason) {
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        'Missing required parameters: employeeId, permissions, delegationType, reason'
      );
    }

    const managerId = request.user.id;

    const delegationResult = await PermissionDelegationService.createDelegation({
      managerId,
      employeeId,
      permissions: Array.isArray(permissions) ? permissions : [permissions],
      delegationType,
      duration,
      reason,
      context,
    });

    // Record audit event
    await PermissionAuditService.recordPermissionAudit({
      userId: employeeId,
      action: 'PERMISSION_DELEGATED',
      permission: permissions.join(','),
      performedBy: managerId,
      reason,
      context,
      metadata: {
        delegationType,
        duration,
        delegationId: delegationResult.delegationId,
      },
    });

    return {
      success: true,
      ...delegationResult,
    };
  } catch (error) {
    logger.error('Error creating permission delegation:', error);
    throw error;
  }
};

/**
 * Revokes permission delegation
 * Endpoint: POST /functions/revokePermissionDelegation
 * Access: Original manager or admin.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const revokePermissionDelegation = async (request) => {
  try {
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const { delegationId, reason } = request.params;

    if (!delegationId || !reason) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Missing required parameters: delegationId, reason');
    }

    const revokedBy = request.user.id;

    const revocationResult = await PermissionDelegationService.revokeDelegation(delegationId, revokedBy, reason);

    return {
      success: true,
      ...revocationResult,
      message: 'Permission delegation revoked successfully',
    };
  } catch (error) {
    logger.error('Error revoking permission delegation:', error);
    throw error;
  }
};

/**
 * Creates emergency permission elevation
 * Endpoint: POST /functions/createEmergencyElevation
 * Access: Requires admin role.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const createEmergencyElevation = async (request) => {
  try {
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const userRole = request.user.get('role');
    if (!['admin', 'superadmin'].includes(userRole)) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Admin access required for emergency elevation');
    }

    const {
      userId,
      permissions,
      reason,
      duration = 4 * 60 * 60 * 1000, // 4 hours default
      context = 'emergency',
    } = request.params;

    if (!userId || !permissions || !reason) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Missing required parameters: userId, permissions, reason');
    }

    const elevatedBy = request.user.id;

    const elevationResult = await PermissionDelegationService.createEmergencyElevation({
      userId,
      permissions: Array.isArray(permissions) ? permissions : [permissions],
      reason,
      duration,
      elevatedBy,
      context,
    });

    // Record critical audit event
    await PermissionAuditService.recordPermissionAudit({
      userId,
      action: 'EMERGENCY_PERMISSION',
      permission: permissions.join(','),
      performedBy: elevatedBy,
      reason,
      context,
      severity: 'critical',
      metadata: {
        duration,
        expiresAt: elevationResult.expiresAt,
      },
    });

    return {
      success: true,
      ...elevationResult,
      message: 'Emergency permission elevation created',
    };
  } catch (error) {
    logger.error('Error creating emergency elevation:', error);
    throw error;
  }
};

/**
 * Creates individual permission override
 * Endpoint: POST /functions/createPermissionOverride
 * Access: Requires admin role.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const createPermissionOverride = async (request) => {
  try {
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const userRole = request.user.get('role');
    if (!['admin', 'superadmin'].includes(userRole)) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Admin access required for permission overrides');
    }

    const {
      userId, overrideType, permission, reason, context, expiresAt,
    } = request.params;

    if (!userId || !overrideType || !permission || !reason) {
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        'Missing required parameters: userId, overrideType, permission, reason'
      );
    }

    const grantedBy = request.user.id;

    const override = await PermissionInheritanceService.createPermissionOverride({
      userId,
      type: overrideType,
      permission,
      reason,
      grantedBy,
      context,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });

    // Record audit event
    await PermissionAuditService.recordPermissionAudit({
      userId,
      action: 'OVERRIDE_CREATED',
      permission,
      performedBy: grantedBy,
      reason,
      context,
      metadata: {
        overrideType,
        overrideId: override.id,
        expiresAt,
      },
    });

    return {
      success: true,
      overrideId: override.id,
      userId,
      overrideType,
      permission,
      expiresAt,
      message: 'Permission override created successfully',
    };
  } catch (error) {
    logger.error('Error creating permission override:', error);
    throw error;
  }
};

/**
 * Checks if user has specific permission
 * Endpoint: GET /functions/checkUserPermission
 * Access: User can check own permissions, admins can check any.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const checkUserPermission = async (request) => {
  try {
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const { userId = request.user.id, permission, context } = request.params;

    if (!permission) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'permission parameter is required');
    }

    // Check authorization
    if (userId !== request.user.id) {
      const userRole = request.user.get('role');
      if (!['admin', 'superadmin', 'manager'].includes(userRole)) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, "Cannot check other users' permissions");
      }
    }

    const hasPermission = await OAuthPermissionService.hasPermission(userId, permission, context);

    return {
      success: true,
      userId,
      permission,
      context: context || null,
      hasPermission,
      checkedAt: new Date(),
    };
  } catch (error) {
    logger.error('Error checking user permission:', error);
    throw error;
  }
};

/**
 * Gets active delegations for a manager
 * Endpoint: GET /functions/getActiveDelegations
 * Access: Manager can view own delegations.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const getActiveDelegations = async (request) => {
  try {
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const { managerId = request.user.id } = request.params;

    // Check authorization
    if (managerId !== request.user.id) {
      const userRole = request.user.get('role');
      if (!['admin', 'superadmin'].includes(userRole)) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, "Cannot view other managers' delegations");
      }
    }

    const delegations = await PermissionDelegationService.getActiveDelegations(managerId);

    return {
      success: true,
      managerId,
      delegations,
      count: delegations.length,
    };
  } catch (error) {
    logger.error('Error getting active delegations:', error);
    throw error;
  }
};

/**
 * Gets delegated permissions for an employee
 * Endpoint: GET /functions/getDelegatedPermissions
 * Access: Employee can view own delegated permissions.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const getDelegatedPermissions = async (request) => {
  try {
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const { employeeId = request.user.id } = request.params;

    // Check authorization
    if (employeeId !== request.user.id) {
      const userRole = request.user.get('role');
      if (!['admin', 'superadmin', 'manager'].includes(userRole)) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, "Cannot view other employees' delegated permissions");
      }
    }

    const delegations = await PermissionDelegationService.getDelegatedPermissions(employeeId);

    return {
      success: true,
      employeeId,
      delegations,
      count: delegations.length,
    };
  } catch (error) {
    logger.error('Error getting delegated permissions:', error);
    throw error;
  }
};

/**
 * Gets permission audit report
 * Endpoint: GET /functions/getPermissionAuditReport
 * Access: Requires admin role.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const getPermissionAuditReport = async (request) => {
  try {
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const userRole = request.user.get('role');
    if (!['admin', 'superadmin'].includes(userRole)) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Admin access required for audit reports');
    }

    const {
      startDate,
      endDate,
      userId,
      complianceFramework = 'PCI_DSS',
      includeMetadata = false,
      format = 'summary',
    } = request.params;

    const report = await PermissionAuditService.generateComplianceReport({
      startDate,
      endDate,
      userId,
      complianceFramework,
      includeMetadata,
      format,
    });

    logger.logSecurityEvent('PERMISSION_AUDIT_REPORT_ACCESSED', request.user.id, {
      framework: complianceFramework,
      format,
      recordCount: report.summary.totalRecords,
      requestedBy: request.user.get('username'),
    });

    return {
      success: true,
      report,
    };
  } catch (error) {
    logger.error('Error generating permission audit report:', error);
    throw error;
  }
};

/**
 * Gets permission audit statistics
 * Endpoint: GET /functions/getPermissionAuditStats
 * Access: Requires admin role.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const getPermissionAuditStats = async (request) => {
  try {
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const userRole = request.user.get('role');
    if (!['admin', 'superadmin'].includes(userRole)) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Admin access required for audit statistics');
    }

    const { timeFrame = '30d', complianceFramework = 'PCI_DSS' } = request.params;

    const stats = await PermissionAuditService.getAuditStatistics({
      timeFrame,
      complianceFramework,
    });

    return {
      success: true,
      timeFrame,
      complianceFramework,
      stats,
    };
  } catch (error) {
    logger.error('Error getting permission audit statistics:', error);
    throw error;
  }
};

/**
 * Gets all available permissions in the system
 * Endpoint: GET /functions/getAvailablePermissions
 * Access: Requires manager role or higher.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const getAvailablePermissions = async (request) => {
  try {
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const userRole = request.user.get('role');
    if (!['manager', 'admin', 'superadmin'].includes(userRole)) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Manager access required to view available permissions');
    }

    const { _provider } = request.params;

    let permissions;
    if (_provider) {
      permissions = OAuthPermissionService.getProviderPermissionMappings(_provider);
    } else {
      permissions = OAuthPermissionService.getAllAvailablePermissions();
    }

    return {
      success: true,
      permissions,
      provider: _provider || 'all',
      count: Array.isArray(permissions) ? permissions.length : Object.keys(permissions).length,
    };
  } catch (error) {
    logger.error('Error getting available permissions:', error);
    throw error;
  }
};

module.exports = {
  getUserPermissionInheritance,
  getAvailableContexts,
  switchPermissionContext,
  createPermissionDelegation,
  revokePermissionDelegation,
  createEmergencyElevation,
  createPermissionOverride,
  checkUserPermission,
  getActiveDelegations,
  getDelegatedPermissions,
  getPermissionAuditReport,
  getPermissionAuditStats,
  getAvailablePermissions,
};
