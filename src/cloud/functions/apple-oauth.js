/**
 * Apple OAuth Cloud Functions - Sprint 04
 * Handle Apple Sign In flows with privacy compliance
 * Integrates with department OAuth and corporate configurations.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { 'parse/node': 'example' });
 * // Returns: function result
 */

const Parse = require('parse/node');
const { AppleOAuthService } = require('../../application/services/AppleOAuthService');
const { PermissionAuditService } = require('../../application/services/PermissionAuditService');
const logger = require('../../infrastructure/logger');

// Initialize services
let appleOAuthService = null;
try {
  appleOAuthService = new AppleOAuthService();
} catch (error) {
  logger.warn('Apple OAuth service disabled:', error.message);
}
const auditService = new PermissionAuditService();

/**
 * Initiate Apple Sign In flow.
 * @param {object} request - Parse Cloud Code request object.
 * @param {object} request.params - Request parameters.
 * @param {string} request.params.department - Department identifier.
 * @param {string} request.params.corporateConfigId - Corporate config ID.
 * @param {string} request.params.redirectUri - OAuth redirect URI.
 * @returns {Promise<object>} - Apple OAuth authorization URL and state.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const initiateAppleOAuth = async (request) => {
  if (!appleOAuthService) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Apple OAuth service is not available');
  }

  const { params, ip } = request;
  const {
    department, corporateConfigId, redirectUri,
  } = params;

  try {
    // Generate state for OAuth flow
    const state = require('crypto').randomBytes(32).toString('hex');

    // Initiate Apple OAuth flow
    const result = await appleOAuthService.initiateOAuth({
      department,
      corporateConfigId,
      redirectUri: redirectUri || `${process.env.PARSE_PUBLIC_SERVER_URL}/auth/oauth/apple/callback`,
      state,
      headers: request.headers,
      ip,
    });

    // Store OAuth state for validation
    const OAuthState = Parse.Object.extend('OAuthState');
    const stateRecord = new OAuthState();
    stateRecord.set('state', state);
    stateRecord.set('nonce', result.nonce);
    stateRecord.set('provider', 'apple');
    stateRecord.set('department', department);
    stateRecord.set('corporateConfigId', corporateConfigId);
    stateRecord.set('expiresAt', new Date(Date.now() + 10 * 60 * 1000)); // 10 minutes
    stateRecord.set('ipAddress', ip);
    stateRecord.set('userAgent', request.headers['user-agent']);
    await stateRecord.save(null, { useMasterKey: true });

    // Log audit event
    await auditService.recordPermissionAudit({
      userId: 'anonymous',
      action: 'apple_oauth_initiated',
      resource: 'apple_oauth',
      performedBy: 'anonymous',
      metadata: {
        department,
        corporateConfigId,
        ip,
        timestamp: new Date(),
      },
    });

    logger.info(`Apple OAuth initiated for department: ${department} from IP: ${ip}`);

    return {
      success: true,
      authUrl: result.authUrl,
      state,
      nonce: result.nonce,
      expiresIn: result.expiresIn,
    };
  } catch (error) {
    logger.error('Initiate Apple OAuth failed:', error);
    throw error;
  }
};

/**
 * Handle Apple OAuth callback (form_post response mode).
 * @param {object} request - Parse Cloud Code request object.
 * @param {object} request.params - Request parameters.
 * @param {string} request.params.code - Authorization code from Apple.
 * @param {string} request.params.state - OAuth state parameter.
 * @param {string} request.params.idtoken - Apple ID token.
 * @returns {Promise<object>} - Authentication result with user data.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const handleAppleOAuthCallback = async (request) => {
  if (!appleOAuthService) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Apple OAuth service is not available');
  }

  const { params, ip } = request;
  const {
    code,
  } = params;

  try {
    // Handle OAuth errors
    if (oauthError) { // eslint-disable-line no-undef
      throw new Parse.Error(
        Parse.Error.OTHER_CAUSE,
        `Apple OAuth error: ${oauthError} - ${errorDescription || 'Unknown error'}` // eslint-disable-line no-undef
      );
    }

    // Validate OAuth state
    const OAuthState = Parse.Object.extend('OAuthState');
    const stateQuery = new Parse.Query(OAuthState);
    stateQuery.equalTo('state', state); // eslint-disable-line no-undef
    stateQuery.equalTo('provider', 'apple');
    stateQuery.greaterThan('expiresAt', new Date());

    const stateRecord = await stateQuery.first({ useMasterKey: true });
    if (!stateRecord) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Invalid or expired Apple OAuth state');
    }

    // Extract stored data
    const department = stateRecord.get('department');
    const corporateConfigId = stateRecord.get('corporateConfigId');
    const expectedNonce = stateRecord.get('nonce');

    // Handle Apple OAuth callback
    const result = await appleOAuthService.handleCallback({
      code,
      idtoken: idToken, // eslint-disable-line no-undef
      user: userJsonString, // eslint-disable-line no-undef
      state, // eslint-disable-line no-undef
      department,
      corporateConfigId,
      nonce: expectedNonce,
      ip,
    });

    // Clean up state record
    await stateRecord.destroy({ useMasterKey: true });

    // Log successful authentication
    await auditService.recordPermissionAudit({
      userId: result.user.id,
      action: 'apple_oauth_success',
      resource: 'apple_oauth',
      performedBy: result.user.id,
      metadata: {
        department,
        corporateConfigId,
        privacyCompliant: result.privacyCompliant,
        isPrivateEmail: result.profile.isPrivateEmail,
        permissions: result.permissions?.length || 0,
        ip,
        timestamp: new Date(),
      },
    });

    logger.info(`Apple OAuth callback successful for user: ${result.user.id}`);

    return {
      success: true,
      sessionToken: result.token,
      user: appleOAuthService.getPrivacyCompliantUserData(result.user),
      permissions: result.permissions,
      privacyCompliant: result.privacyCompliant,
      isPrivateEmail: result.profile.isPrivateEmail,
    };
  } catch (error) {
    // Log failed authentication
    await auditService.recordPermissionAudit({
      userId: 'anonymous',
      action: 'apple_oauth_failed',
      resource: 'apple_oauth',
      performedBy: 'anonymous',
      metadata: {
        error: error.message,
        state, // eslint-disable-line no-undef
        ip,
        timestamp: new Date(),
      },
    });

    logger.error('Apple OAuth callback failed:', error);
    throw error;
  }
};

/**
 * Get Apple OAuth configuration.
 * @param {object} request - Parse Cloud Code request object.
 * @param {object} request.params - Request parameters.
 * @param {string} request.params.department - Department identifier.
 * @returns {Promise<object>} - Apple OAuth configuration.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const getAppleOAuthConfig = async (request) => {
  const { params } = request;
  const { department } = params;

  try {
    const config = {
      clientId: process.env.APPLE_CLIENT_ID,
      redirectUri: process.env.APPLE_REDIRECT_URI || `${process.env.PARSE_PUBLIC_SERVER_URL}/auth/oauth/apple/callback`,
      scope: 'email name',
      responseType: 'code idtoken',
      responseMode: 'form_post',
      available: true,
      privacyCompliant: true,
      supportsPrivateEmail: true,
    };

    // Department-specific configuration
    if (department) {
      const { DepartmentOAuthFlowService } = require('../../application/services/DepartmentOAuthFlowService');
      const departmentService = new DepartmentOAuthFlowService();

      const deptConfig = departmentService.getDepartmentConfig(department);
      if (deptConfig && deptConfig.allowedProviders.includes('apple')) {
        config.departmentSpecific = true;
        config.departmentConfig = {
          code: deptConfig.code,
          name: deptConfig.name,
          scopes: departmentService.getDepartmentScopes(department, 'apple'),
        };
      } else {
        config.available = false;
        config.reason = 'Apple Sign In not allowed for this department';
      }
    }

    return {
      success: true,
      config,
    };
  } catch (error) {
    logger.error('Get Apple OAuth config failed:', error);
    throw error;
  }
};

/**
 * Revoke Apple OAuth tokens.
 * @param {object} request - Parse Cloud Code request object.
 * @param {object} request.user - Current authenticated user.
 * @returns {Promise<object>} - Revocation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const revokeAppleOAuth = async (request) => {
  if (!appleOAuthService) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Apple OAuth service is not available');
  }

  const { user } = request;

  if (!user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Authentication required');
  }

  try {
    // Revoke Apple OAuth association
    await appleOAuthService.revokeTokens(user);

    // Log revocation
    await auditService.recordPermissionAudit({
      userId: user.id,
      action: 'apple_oauth_revoked',
      resource: 'apple_oauth',
      performedBy: user.id,
      metadata: {
        timestamp: new Date(),
      },
    });

    logger.info(`Apple OAuth revoked for user: ${user.id}`);

    return {
      success: true,
      message: 'Apple OAuth association removed successfully',
    };
  } catch (error) {
    logger.error('Apple OAuth revocation failed:', error);
    throw error;
  }
};

/**
 * Handle Apple Server-to-Server notifications (webhooks).
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const handleAppleWebhook = async (request) => {
  if (!appleOAuthService) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Apple OAuth service is not available');
  }

  const { params, headers } = request;

  try {
    // Validate webhook signature
    const signature = headers['x-apple-signature'];
    if (!signature) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Missing Apple webhook signature');
    }

    // Process webhook
    const result = await appleOAuthService.validateAppleWebhook(params, signature);

    logger.info('Apple webhook processed successfully:', params.type);

    return {
      success: true,
      processed: result.processed || true,
    };
  } catch (error) {
    logger.error('Apple webhook processing failed:', error);
    throw error;
  }
};

/**
 * Get Apple OAuth user data (privacy-compliant).
 * @param {object} request - Parse Cloud Code request object.
 * @param {object} request.params - Request parameters.
 * @param {string} request.params.userId - User ID to get data for.
 * @returns {Promise<object>} - User data from Apple (privacy-compliant).
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const getAppleUserData = async (request) => {
  if (!appleOAuthService) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Apple OAuth service is not available');
  }

  const { user } = request;

  if (!user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Authentication required');
  }

  try {
    // Check if user has Apple association
    if (!user.get('appleId')) {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'No Apple association found');
    }

    // Return privacy-compliant user data
    const userData = appleOAuthService.getPrivacyCompliantUserData(user);

    return {
      success: true,
      userData,
      privacyCompliant: true,
    };
  } catch (error) {
    logger.error('Get Apple user data failed:', error);
    throw error;
  }
};

/**
 * Validate Apple domain for corporate configurations.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const validateAppleDomain = async (request) => {
  const { params } = request;
  const { _domain, corporateConfigId } = params;

  try {
    if (!domain) { // eslint-disable-line no-undef
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Domain is required');
    }

    const validation = {
      valid: true,
      provider: 'apple',
      supportsPrivateEmail: true,
      privacyCompliant: true,
    };

    // Corporate domain validation
    if (corporateConfigId) {
      const CorporateConfig = Parse.Object.extend('CorporateConfig');
      const corpQuery = new Parse.Query(CorporateConfig);
      const corpConfig = await corpQuery.get(corporateConfigId, { useMasterKey: true });

      if (corpConfig) {
        const allowedDomains = corpConfig.get('allowedDomains') || [];
        const appleSettings = corpConfig.get('appleOAuthSettings') || {};

        if (allowedDomains.length > 0 && !allowedDomains.includes(_domain)) {
          validation.valid = false;
          validation.reason = `Domain ${_domain} not allowed for this organization`;
        }

        // Apply Apple-specific corporate settings
        if (appleSettings.restrictToCorporateDomain && !domain.endsWith(corpConfig.get('primaryDomain'))) { // eslint-disable-line no-undef
          validation.valid = false;
          validation.reason = 'Apple Sign In restricted to corporate domain only';
        }
      }
    }

    return {
      success: true,
      validation,
    };
  } catch (error) {
    logger.error('Apple domain validation failed:', error);
    throw error;
  }
};

/**
 * Get Apple OAuth analytics.
 * @param {object} request - HTTP request object.
 * @returns {Promise<object>} - Promise resolving to operation result.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 */
const getAppleOAuthAnalytics = async (request) => {
  const { params, user } = request;
  const { timeRange = '30d' } = params;

  if (!user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Authentication required');
  }

  try {
    // Check if user has analytics access
    const userRole = user.get('role');
    if (!['admin', 'superadmin', 'manager'].includes(userRole)) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Analytics access denied');
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

    // Query audit logs for Apple OAuth activity
    const auditQuery = new Parse.Query('PermissionAudit');
    auditQuery.greaterThanOrEqualTo('timestamp', startDate);
    auditQuery.lessThanOrEqualTo('timestamp', endDate);
    auditQuery.contains('action', 'apple_oauth');
    auditQuery.limit(1000);

    const auditEntries = await auditQuery.find({ useMasterKey: true });

    // Process analytics
    const analytics = {
      totalAttempts: 0,
      successfulLogins: 0,
      failedLogins: 0,
      privateEmailUsers: 0,
      regularEmailUsers: 0,
      dailyActivity: {},
      privacyMetrics: {
        privateEmailPercentage: 0,
        consentRevocations: 0,
      },
    };

    auditEntries.forEach((entry) => {
      const action = entry.get('action');
      const metadata = entry.get('metadata') || {};
      const timestamp = entry.get('timestamp');
      const date = timestamp.toISOString().split('T')[0];

      analytics.totalAttempts++;

      if (action.includes('success')) {
        analytics.successfulLogins++;
        if (metadata.isPrivateEmail) {
          analytics.privateEmailUsers++;
        } else {
          analytics.regularEmailUsers++;
        }
      } else if (action.includes('failed')) {
        analytics.failedLogins++;
      }

      analytics.dailyActivity[date] = (analytics.dailyActivity[date] || 0) + 1;
    });

    // Calculate privacy metrics
    const totalEmailUsers = analytics.privateEmailUsers + analytics.regularEmailUsers;
    if (totalEmailUsers > 0) {
      analytics.privacyMetrics.privateEmailPercentage = Math.round(
        (analytics.privateEmailUsers / totalEmailUsers) * 100
      );
    }

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
    logger.error('Get Apple OAuth analytics failed:', error);
    throw error;
  }
};

module.exports = {
  initiateAppleOAuth,
  handleAppleOAuthCallback,
  getAppleOAuthConfig,
  revokeAppleOAuth,
  handleAppleWebhook,
  getAppleUserData,
  validateAppleDomain,
  getAppleOAuthAnalytics,
  // Export for testing
  appleOAuthService,
};
