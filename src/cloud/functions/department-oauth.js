/**
 * Department OAuth Cloud Functions - Sprint 04
 * Handle department-specific OAuth flows and integration
 * Integrates with Sprint 03 permission system.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { 'parse/node': 'example' });
 * // Returns: function result
 */

const Parse = require('parse/node');
const {
  DepartmentOAuthFlowService,
} = require('../../application/services/DepartmentOAuthFlowService');
const {
  PermissionAuditService,
} = require('../../application/services/PermissionAuditService');
const logger = require('../../infrastructure/logger');

// Initialize services
const departmentOAuthService = new DepartmentOAuthFlowService();
const auditService = new PermissionAuditService();

/**
 * Get available departments for OAuth.
 * @param {object} request - Parse Cloud Code request object.
 * @param {object} request.user - Current authenticated user.
 * @returns {Promise<object>} - Available departments for user.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const getAvailableDepartments = async (request) => {
  const { user } = request;

  try {
    // Get available departments
    const departments = departmentOAuthService.getAvailableDepartments();

    // Filter based on user context if authenticated
    let filteredDepartments = departments;
    if (user) {
      // User might have restricted department access
      const userDepartments = user.get('departments') || [user.get('department')].filter(Boolean);
      filteredDepartments = departments.filter(
        (dept) => !userDepartments.length || userDepartments.includes(dept.code)
      );
    }

    // Log audit event
    await auditService.recordPermissionAudit({
      userId: user?.id || 'anonymous',
      action: 'departments_list_requested',
      resource: 'department_oauth',
      performedBy: user?.id || 'anonymous',
      metadata: {
        availableDepartments: filteredDepartments.length,
        userDepartments: user?.get('departments'),
        timestamp: new Date(),
      },
    });

    return {
      success: true,
      departments: filteredDepartments,
    };
  } catch (error) {
    logger.error('Get available departments failed:', error);
    throw new Parse.Error(
      Parse.Error.INTERNAL_SERVER_ERROR,
      'Failed to get departments'
    );
  }
};

/**
 * Initiate department-specific OAuth flow.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const initiateDepartmentOAuth = async (request) => {
  const { params, ip } = request;
  const {
    department, _provider, corporateConfigId, redirectUri,
  } = params;

  try {
    // Validate required parameters
    if (!department || !_provider) {
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        'Department and provider are required'
      );
    }

    // Generate state for OAuth flow
    const state = require('crypto').randomBytes(32).toString('hex');

    // Initiate OAuth flow
    const result = await departmentOAuthService.initiateDepartmentOAuth({
      department,
      _provider,
      corporateConfigId,
      redirectUri:
        redirectUri
        || `${process.env.PARSE_PUBLIC_SERVER_URL}/auth/oauth/callback`,
      state,
      headers: request.headers,
      ip,
    });

    // Store OAuth state for validation
    const OAuthState = Parse.Object.extend('OAuthState');
    const stateRecord = new OAuthState();
    stateRecord.set('state', state);
    stateRecord.set('department', department);
    stateRecord.set('provider', _provider);
    stateRecord.set('corporateConfigId', corporateConfigId);
    stateRecord.set('expiresAt', new Date(Date.now() + 10 * 60 * 1000)); // 10 minutes
    stateRecord.set('ipAddress', ip);
    stateRecord.set('userAgent', request.headers['user-agent']);
    await stateRecord.save(null, { useMasterKey: true });

    logger.info(
      `Department OAuth initiated: ${department}/${_provider} from IP: ${ip}`
    );

    return {
      success: true,
      authUrl: result.authUrl,
      state,
      expiresIn: result.expiresIn,
    };
  } catch (error) {
    logger.error('Initiate department OAuth failed:', error);
    throw error;
  }
};

/**
 * Handle department OAuth callback.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const handleDepartmentOAuthCallback = async (request) => {
  const { params, ip } = request;
  const { code, state, error } = params;

  try {
    // Parse state to get department and provider info
    let stateData;
    try {
      stateData = JSON.parse(state);
    } catch {
      // Fallback for simple state values
      stateData = { originalState: state };
    }

    const { _provider, department, originalState } = stateData;

    // Validate OAuth state
    const OAuthState = Parse.Object.extend('OAuthState');
    const stateQuery = new Parse.Query(OAuthState);
    stateQuery.equalTo('state', originalState || state);
    stateQuery.greaterThan('expiresAt', new Date());

    const stateRecord = await stateQuery.first({ useMasterKey: true });
    if (!stateRecord) {
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        'Invalid or expired OAuth state'
      );
    }

    // Use provider from state record if not in parsed data
    const finalProvider = _provider || stateRecord.get('provider');
    const finalDepartment = department || stateRecord.get('department');

    // Handle OAuth callback
    const result = await departmentOAuthService.handleDepartmentOAuthCallback({
      code,
      state: originalState || state,
      provider: finalProvider,
      department: finalDepartment,
      error,
      corporateConfigId: stateRecord.get('corporateConfigId'),
      ip,
    });

    // Clean up state record
    await stateRecord.destroy({ useMasterKey: true });

    logger.info(
      `Department OAuth callback successful: ${finalDepartment}/${finalProvider} for user: ${result.user.id}`
    );

    return result;
  } catch (callbackError) {
    logger.error('Department OAuth callback failed:', callbackError);
    throw callbackError;
  }
};

/**
 * Get department OAuth configuration.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const getDepartmentOAuthConfig = async (request) => {
  const { params, user } = request;
  const { department } = params;

  try {
    if (!department) {
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        'Department is required'
      );
    }

    // Get department configuration
    const deptConfig = departmentOAuthService.getDepartmentConfig(department);
    if (!deptConfig) {
      throw new Parse.Error(
        Parse.Error.OBJECT_NOT_FOUND,
        `Department not found: ${department}`
      );
    }

    // Check if user has access to this department info
    if (user) {
      const userDepartments = user.get('departments') || [user.get('department')].filter(Boolean);
      if (userDepartments.length > 0 && !userDepartments.includes(department)) {
        throw new Parse.Error(
          Parse.Error.OPERATION_FORBIDDEN,
          'Access denied to department configuration'
        );
      }
    }

    // Return public configuration (without sensitive data)
    const publicConfig = {
      code: deptConfig.code,
      name: deptConfig.name,
      allowedProviders: deptConfig.allowedProviders,
      approvalRequired: deptConfig.approvalRequired,
      metadata: deptConfig.metadata,
    };

    // Log audit event
    await auditService.recordPermissionAudit({
      userId: user?.id || 'anonymous',
      action: 'department_config_requested',
      resource: 'department_oauth_config',
      performedBy: user?.id || 'anonymous',
      metadata: {
        department,
        timestamp: new Date(),
      },
    });

    return {
      success: true,
      config: publicConfig,
    };
  } catch (error) {
    logger.error('Get department OAuth config failed:', error);
    throw error;
  }
};

/**
 * Switch user to department context post-OAuth.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const switchToDepartmentContext = async (request) => {
  const { params, user } = request;
  const { department, sessionId } = params;

  if (!user) {
    throw new Parse.Error(
      Parse.Error.INVALID_SESSION_TOKEN,
      'Authentication required'
    );
  }

  try {
    if (!department) {
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        'Department is required'
      );
    }

    // Verify user has access to this department
    const userDepartments = user.get('departments') || [user.get('department')].filter(Boolean);
    if (!userDepartments.includes(department)) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Access denied to department'
      );
    }

    // Switch to department context using Sprint 03 system
    const {
      PermissionContextService,
    } = require('../../application/services/PermissionContextService');
    const contextService = new PermissionContextService();

    const contextId = `dept-${department}`;
    const result = await contextService.switchToContext(
      user.id,
      contextId,
      sessionId
    );

    // Log context switch
    await auditService.recordPermissionAudit({
      userId: user.id,
      sessionId,
      action: 'department_context_switch',
      resource: 'permission_context',
      performedBy: user.id,
      metadata: {
        department,
        contextId,
        previousContext: result.previousContext?.id,
        timestamp: new Date(),
      },
    });

    return {
      success: true,
      contextId,
      permissions: result.appliedPermissions,
      department,
    };
  } catch (error) {
    logger.error('Switch to department context failed:', error);
    throw error;
  }
};

/**
 * Get department OAuth providers with dynamic configuration.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const getDepartmentOAuthProviders = async (request) => {
  const { params } = request;
  const { department } = params;

  try {
    if (!department) {
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        'Department is required'
      );
    }

    // Get department configuration
    const deptConfig = departmentOAuthService.getDepartmentConfig(department);
    if (!deptConfig) {
      throw new Parse.Error(
        Parse.Error.OBJECT_NOT_FOUND,
        `Department not found: ${department}`
      );
    }

    // Get provider configurations
    const providers = await Promise.all(
      deptConfig.allowedProviders.map(async (providerName) => {
        const scopes = departmentOAuthService.getDepartmentScopes(
          department,
          providerName
        );

        return {
          name: providerName,
          displayName: this.getProviderDisplayName(providerName),
          scopes,
          departmentSpecific: true,
          available: true,
        };
      })
    );

    return {
      success: true,
      department: {
        code: deptConfig.code,
        name: deptConfig.name,
      },
      providers,
    };
  } catch (error) {
    logger.error('Get department OAuth providers failed:', error);
    throw error;
  }
};

/**
 * Validate department OAuth access.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const validateDepartmentOAuthAccess = async (request) => {
  const { params, user, ip } = request;
  const { department, _provider, email } = params;

  try {
    if (!department || !_provider) {
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        'Department and provider are required'
      );
    }

    // Get department configuration
    const deptConfig = departmentOAuthService.getDepartmentConfig(department);
    if (!deptConfig) {
      throw new Parse.Error(
        Parse.Error.OBJECT_NOT_FOUND,
        `Department not found: ${department}`
      );
    }

    // Validate provider is allowed for department
    if (!deptConfig.allowedProviders.includes(_provider)) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        `Provider ${_provider} not allowed for department ${department}`
      );
    }

    // Email domain validation if provided
    let emailValidation = { valid: true, reason: null };
    if (email && deptConfig.emailDomain) {
      const emailDomain = email.split('@')[1];
      if (emailDomain !== deptConfig.emailDomain) {
        emailValidation = {
          valid: false,
          reason: `Email domain ${emailDomain} not allowed for department ${department}`,
        };
      }
    }

    // Check approval requirements
    const approvalInfo = {
      required: deptConfig.approvalRequired,
      workflow: deptConfig.approvalWorkflow,
      estimatedTime: deptConfig.approvalRequired ? '1-2 business days' : null,
    };

    // Log validation attempt
    await auditService.recordPermissionAudit({
      userId: user?.id || 'anonymous',
      action: 'department_oauth_validation',
      resource: 'department_oauth_access',
      performedBy: user?.id || 'anonymous',
      metadata: {
        department,
        _provider,
        email: email ? `${email.substring(0, 3)}***` : null,
        valid: emailValidation.valid,
        approvalRequired: deptConfig.approvalRequired,
        ip,
        timestamp: new Date(),
      },
    });

    return {
      success: true,
      valid: emailValidation.valid,
      reason: emailValidation.reason,
      department: {
        code: deptConfig.code,
        name: deptConfig.name,
      },
      provider: {
        name: _provider,
        allowed: true,
      },
      approval: approvalInfo,
    };
  } catch (error) {
    logger.error('Validate department OAuth access failed:', error);
    throw error;
  }
};

/**
 * Get department OAuth analytics (for admins).
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const getDepartmentOAuthAnalytics = async (request) => {
  const { params, user } = request;
  const { department, timeRange = '30d' } = params;

  if (!user) {
    throw new Parse.Error(
      Parse.Error.INVALID_SESSION_TOKEN,
      'Authentication required'
    );
  }

  try {
    // Check if user has analytics access
    const userRole = user.get('role');
    if (!['admin', 'superadmin', 'manager'].includes(userRole)) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Analytics access denied'
      );
    }

    // If department specified, check access
    if (department) {
      const userDepartments = user.get('departments') || [user.get('department')].filter(Boolean);
      if (userRole !== 'superadmin' && !userDepartments.includes(department)) {
        throw new Parse.Error(
          Parse.Error.OPERATION_FORBIDDEN,
          'Department access denied'
        );
      }
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    switch (timeRange) {
      case '7d':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(endDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(endDate.getDate() - 90);
        break;
      default:
        startDate.setDate(endDate.getDate() - 30);
    }

    // Query audit logs for department OAuth activity
    const auditQuery = new Parse.Query('PermissionAudit');
    auditQuery.greaterThanOrEqualTo('timestamp', startDate);
    auditQuery.lessThanOrEqualTo('timestamp', endDate);
    auditQuery.containsAll('action', ['department_oauth']);

    if (department) {
      auditQuery.equalTo('metadata.department', department);
    }

    auditQuery.limit(1000);
    const auditEntries = await auditQuery.find({ useMasterKey: true });

    // Process analytics data
    const analytics = {
      totalLogins: 0,
      successfulLogins: 0,
      failedLogins: 0,
      providerBreakdown: {},
      departmentBreakdown: {},
      dailyActivity: {},
      topUsers: {},
      errors: [],
    };

    auditEntries.forEach((entry) => {
      const metadata = entry.get('metadata') || {};
      const action = entry.get('action');
      const timestamp = entry.get('timestamp');
      const date = timestamp.toISOString().split('T')[0];

      // Count by action type
      if (action.includes('oauth_success')) {
        analytics.successfulLogins++;
      } else if (action.includes('oauth_failed')) {
        analytics.failedLogins++;
      }
      analytics.totalLogins++;

      // Provider breakdown
      if (metadata.provider) {
        analytics.providerBreakdown[metadata.provider] = (analytics.providerBreakdown[metadata.provider] || 0) + 1;
      }

      // Department breakdown
      if (metadata.department) {
        const dept = metadata.department;
        analytics.departmentBreakdown[dept] = (analytics.departmentBreakdown[dept] || 0) + 1;
      }

      // Daily activity
      analytics.dailyActivity[date] = (analytics.dailyActivity[date] || 0) + 1;

      // Top users
      const userId = entry.get('userId');
      if (userId && userId !== 'anonymous') {
        analytics.topUsers[userId] = (analytics.topUsers[userId] || 0) + 1;
      }

      // Collect errors
      if (metadata.error) {
        analytics.errors.push({
          timestamp,
          error: metadata.error,
          department: metadata.department,
          provider: metadata.provider,
        });
      }
    });

    // Convert top users to sorted array
    analytics.topUsers = Object.entries(analytics.topUsers)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([userId, count]) => ({ userId, count }));

    // Log analytics access
    await auditService.recordPermissionAudit({
      userId: user.id,
      action: 'department_oauth_analytics_accessed',
      resource: 'analytics',
      performedBy: user.id,
      metadata: {
        department,
        timeRange,
        recordsAnalyzed: auditEntries.length,
        timestamp: new Date(),
      },
    });

    return {
      success: true,
      timeRange: {
        start: startDate,
        end: endDate,
        range: timeRange,
      },
      analytics,
    };
  } catch (error) {
    logger.error('Get department OAuth analytics failed:', error);
    throw error;
  }
};

/**
 * Helper function to get provider display names.
 * @param {string} provider - OAuth provider name.
 * @param _provider
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { provider: 'example' });
 * // Returns: function result
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * @returns {*} - Operation result.
 */
function getProviderDisplayName(provider) {
  const displayNames = {
    google: 'Google Workspace',
    microsoft: 'Microsoft 365',
    apple: 'Apple ID',
    github: 'GitHub',
  };

  return displayNames[provider] || provider;
}

module.exports = {
  getAvailableDepartments,
  initiateDepartmentOAuth,
  handleDepartmentOAuthCallback,
  getDepartmentOAuthConfig,
  switchToDepartmentContext,
  getDepartmentOAuthProviders,
  validateDepartmentOAuthAccess,
  getDepartmentOAuthAnalytics,
  // Export helper functions for testing
  getProviderDisplayName,
};
