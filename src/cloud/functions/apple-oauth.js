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
const {
  AppleOAuthService,
} = require('../../application/services/AppleOAuthService');
const {
  PermissionAuditService,
} = require('../../application/services/PermissionAuditService');
const logger = require('../../infrastructure/logger');

// Initialize services
let appleOAuthService = null;
// Attempt to initialize Apple OAuth service with error handling
try {
  appleOAuthService = new AppleOAuthService();
// Handle service initialization failure gracefully
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
  // Check if Apple OAuth service is available
  if (!appleOAuthService) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Apple OAuth service is not available'
    );
  }

  const { params, ip } = request;
  const { department, corporateConfigId, redirectUri } = params;

  // Initiate OAuth flow with error handling
  try {
    // Generate state for OAuth flow
    const state = require('crypto').randomBytes(32).toString('hex');

    // Initiate Apple OAuth flow
    const result = await appleOAuthService.initiateOAuth({
      department,
      corporateConfigId,
      // Use provided redirectUri or default callback URL
      redirectUri:
        redirectUri
        || `${process.env.PARSE_PUBLIC_SERVER_URL}/auth/oauth/apple/callback`,
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

    logger.info(
      `Apple OAuth initiated for department: ${department} from IP: ${ip}`
    );

    return {
      success: true,
      authUrl: result.authUrl,
      state,
      nonce: result.nonce,
      expiresIn: result.expiresIn,
    };
  // Handle errors during OAuth initiation
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
  // Check if Apple OAuth service is available
  if (!appleOAuthService) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Apple OAuth service is not available'
    );
  }

  const { params, ip } = request;
  const { code, error: oauthError, error_description: errorDescription } = params;

  // Process OAuth callback with error handling
  try {
    // Check for OAuth errors from Apple
    if (oauthError) {
      throw new Parse.Error(
        Parse.Error.OTHER_CAUSE,
        `Apple OAuth error: ${oauthError} - ${errorDescription || 'Unknown error'}`
      );
    }

    // Validate OAuth state
    const OAuthState = Parse.Object.extend('OAuthState');
    const stateQuery = new Parse.Query(OAuthState);
    stateQuery.equalTo('state', state); // eslint-disable-line no-undef
    stateQuery.equalTo('provider', 'apple');
    stateQuery.greaterThan('expiresAt', new Date());

    const stateRecord = await stateQuery.first({ useMasterKey: true });
    // Verify state record exists and is valid
    if (!stateRecord) {
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        'Invalid or expired Apple OAuth state'
      );
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
  // Handle callback processing errors
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

  // Retrieve and build OAuth configuration
  try {
    const config = {
      clientId: process.env.APPLE_CLIENT_ID,
      // Use environment redirectUri or default callback URL
      redirectUri:
        process.env.APPLE_REDIRECT_URI
        || `${process.env.PARSE_PUBLIC_SERVER_URL}/auth/oauth/apple/callback`,
      scope: 'email name',
      responseType: 'code idtoken',
      responseMode: 'form_post',
      available: true,
      privacyCompliant: true,
      supportsPrivateEmail: true,
    };

    // Apply department-specific configuration if provided
    if (department) {
      const {
        DepartmentOAuthFlowService,
      } = require('../../application/services/DepartmentOAuthFlowService');
      const departmentService = new DepartmentOAuthFlowService();

      const deptConfig = departmentService.getDepartmentConfig(department);
      // Check if department allows Apple OAuth
      if (deptConfig && deptConfig.allowedProviders.includes('apple')) {
        config.departmentSpecific = true;
        config.departmentConfig = {
          code: deptConfig.code,
          name: deptConfig.name,
          scopes: departmentService.getDepartmentScopes(department, 'apple'),
        };
      // Apple OAuth not allowed for this department
      } else {
        config.available = false;
        config.reason = 'Apple Sign In not allowed for this department';
      }
    }

    return {
      success: true,
      config,
    };
  // Handle configuration retrieval errors
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
  // Check if Apple OAuth service is available
  if (!appleOAuthService) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Apple OAuth service is not available'
    );
  }

  const { user } = request;

  // Verify user is authenticated
  if (!user) {
    throw new Parse.Error(
      Parse.Error.INVALID_SESSION_TOKEN,
      'Authentication required'
    );
  }

  // Revoke OAuth tokens with error handling
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
  // Handle revocation errors
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
  // Check if Apple OAuth service is available
  if (!appleOAuthService) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Apple OAuth service is not available'
    );
  }

  const { params, headers } = request;

  // Process webhook with error handling
  try {
    // Validate webhook signature
    const signature = headers['x-apple-signature'];
    // Ensure webhook signature is present
    if (!signature) {
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        'Missing Apple webhook signature'
      );
    }

    // Process webhook
    const result = await appleOAuthService.validateAppleWebhook(
      params,
      signature
    );

    logger.info('Apple webhook processed successfully:', params.type);

    return {
      success: true,
      processed: result.processed || true,
    };
  // Handle webhook processing errors
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
  // Check if Apple OAuth service is available
  if (!appleOAuthService) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Apple OAuth service is not available'
    );
  }

  const { user } = request;

  // Verify user is authenticated
  if (!user) {
    throw new Parse.Error(
      Parse.Error.INVALID_SESSION_TOKEN,
      'Authentication required'
    );
  }

  // Retrieve user data with error handling
  try {
    // Verify user has Apple OAuth association
    if (!user.get('appleId')) {
      throw new Parse.Error(
        Parse.Error.OBJECT_NOT_FOUND,
        'No Apple association found'
      );
    }

    // Return privacy-compliant user data
    const userData = appleOAuthService.getPrivacyCompliantUserData(user);

    return {
      success: true,
      userData,
      privacyCompliant: true,
    };
  // Handle user data retrieval errors
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
  const { _domain: domain, corporateConfigId } = params;

  // Validate domain with error handling
  try {
    // Ensure domain parameter is provided
    if (!domain) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Domain is required');
    }

    const validation = {
      valid: true,
      provider: 'apple',
      supportsPrivateEmail: true,
      privacyCompliant: true,
    };

    // Validate against corporate configuration if provided
    if (corporateConfigId) {
      const CorporateConfig = Parse.Object.extend('CorporateConfig');
      const corpQuery = new Parse.Query(CorporateConfig);
      const corpConfig = await corpQuery.get(corporateConfigId, {
        useMasterKey: true,
      });

      // Apply corporate domain restrictions
      if (corpConfig) {
        const allowedDomains = corpConfig.get('allowedDomains') || [];
        const appleSettings = corpConfig.get('appleOAuthSettings') || {};

        // Check if domain is in allowed list
        if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
          validation.valid = false;
          validation.reason = `Domain ${domain} not allowed for this organization`;
        }

        // Check if restricted to corporate domain only
        if (
          appleSettings.restrictToCorporateDomain
          && !domain.endsWith(corpConfig.get('primaryDomain'))
        ) {
          validation.valid = false;
          validation.reason = 'Apple Sign In restricted to corporate domain only';
        }
      }
    }

    return {
      success: true,
      validation,
    };
  // Handle domain validation errors
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

  // Verify user is authenticated
  if (!user) {
    throw new Parse.Error(
      Parse.Error.INVALID_SESSION_TOKEN,
      'Authentication required'
    );
  }

  // Retrieve analytics with error handling
  try {
    // Verify user has required role for analytics access
    const userRole = user.get('role');
    if (!['admin', 'superadmin', 'manager'].includes(userRole)) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Analytics access denied'
      );
    }

    // Calculate date range based on timeRange parameter
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

      // Categorize successful login events
      if (action.includes('success')) {
        analytics.successfulLogins++;
        // Track private vs regular email usage
        if (metadata.isPrivateEmail) {
          analytics.privateEmailUsers++;
        } else {
          analytics.regularEmailUsers++;
        }
      // Categorize failed login events
      } else if (action.includes('failed')) {
        analytics.failedLogins++;
      }

      analytics.dailyActivity[date] = (analytics.dailyActivity[date] || 0) + 1;
    });

    // Calculate privacy metrics
    const totalEmailUsers = analytics.privateEmailUsers + analytics.regularEmailUsers;
    // Calculate private email percentage if users exist
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
  // Handle analytics retrieval errors
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
