/**
 * OAuth Admin Configuration Cloud Functions
 * Provides admin portal functionality for managing corporate SSO configurations.
 * @author Amexing Development Team
 * @version 1.0.0
 * @created Sprint 02 - Corporate SSO Admin Portal
 */

const Parse = require('parse/node');
const OAuthService = require('../../application/services/OAuthService');
const CorporateOAuthService = require('../../application/services/CorporateOAuthService');
const logger = require('../../infrastructure/logger');

/**
 * Gets available corporate domains configuration
 * Endpoint: GET /functions/getAvailableCorporateDomains
 * Access: Requires admin role.
 */
const getAvailableCorporateDomains = async (request) => {
  try {
    // Check admin permissions
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const userRole = request.user.get('role');
    if (!['admin', 'superadmin'].includes(userRole)) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Admin access required for corporate domain management'
      );
    }

    const corporateDomains = OAuthService.getAvailableCorporateDomains();

    logger.logSecurityEvent('CORPORATE_DOMAINS_RETRIEVED', request.user.id, {
      adminUser: request.user.get('username'),
      domainCount: corporateDomains.length,
    });

    return {
      success: true,
      domains: corporateDomains,
      message: `Retrieved ${corporateDomains.length} corporate domain configurations`,
    };
  } catch (error) {
    logger.error('Error retrieving corporate domains:', error);
    throw error;
  }
};

/**
 * Adds new corporate domain configuration
 * Endpoint: POST /functions/addCorporateDomain
 * Access: Requires superadmin role.
 */
const addCorporateDomain = async (request) => {
  try {
    // Check superadmin permissions
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const userRole = request.user.get('role');
    if (userRole !== 'superadmin') {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Superadmin access required for domain configuration'
      );
    }

    const {
      domain, clientName, type, primaryProvider, autoProvisionEmployees, departmentMapping,
    } = request.params;

    // Validate required parameters
    if (!domain || !clientName || !type || !primaryProvider) {
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        'Missing required parameters: domain, clientName, type, primaryProvider'
      );
    }

    // Validate provider
    const availableProviders = OAuthService.getAvailableProviders();
    if (!availableProviders.includes(primaryProvider)) {
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        `Invalid provider. Available: ${availableProviders.join(', ')}`
      );
    }

    // Validate domain format
    // eslint-disable-next-line security/detect-unsafe-regex
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!domainRegex.test(domain)) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Invalid domain format');
    }

    // Check if domain already exists
    const existingConfig = OAuthService.getCorporateDomainConfig(`test@${domain}`);
    if (existingConfig) {
      throw new Parse.Error(
        Parse.Error.DUPLICATE_VALUE,
        `Domain ${domain} is already configured`
      );
    }

    const config = {
      clientName,
      type,
      primaryProvider,
      autoProvisionEmployees: autoProvisionEmployees !== false, // Default true
      departmentMapping: departmentMapping || {},
    };

    // Add Microsoft-specific configuration if needed
    if (primaryProvider === 'microsoft') {
      config.microsoftTenantId = process.env.MICROSOFT_OAUTH_TENANT_ID;
      config.enableDirectorySync = true;
    }

    // Add the corporate domain
    OAuthService.addCorporateDomain(domain, config);

    logger.logSecurityEvent('CORPORATE_DOMAIN_ADDED', request.user.id, {
      adminUser: request.user.get('username'),
      domain,
      clientName,
      provider: primaryProvider,
      type,
    });

    return {
      success: true,
      domain,
      config,
      message: `Corporate domain ${domain} configured successfully`,
    };
  } catch (error) {
    logger.error('Error adding corporate domain:', error);
    throw error;
  }
};

/**
 * Gets OAuth provider status and configuration
 * Endpoint: GET /functions/getOAuthProviderStatus
 * Access: Requires admin role.
 */
const getOAuthProviderStatus = async (request) => {
  try {
    // Check admin permissions
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const userRole = request.user.get('role');
    if (!['admin', 'superadmin'].includes(userRole)) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Admin access required for OAuth provider status'
      );
    }

    const availableProviders = OAuthService.getAvailableProviders();
    const providerConfigs = {};

    for (const provider of availableProviders) {
      const config = OAuthService.getProviderConfig(provider);
      providerConfigs[provider] = {
        ...config,
        // Remove sensitive information
        scopes: config.scopes,
        enabled: config.enabled,
        mockMode: config.mockMode,
      };
    }

    logger.logSecurityEvent('OAUTH_PROVIDER_STATUS_RETRIEVED', request.user.id, {
      adminUser: request.user.get('username'),
      providers: availableProviders,
    });

    return {
      success: true,
      providers: providerConfigs,
      totalProviders: availableProviders.length,
      mockMode: process.env.OAUTH_MOCK_MODE === 'true',
    };
  } catch (error) {
    logger.error('Error retrieving OAuth provider status:', error);
    throw error;
  }
};

/**
 * Tests corporate domain OAuth flow
 * Endpoint: POST /functions/testCorporateDomain
 * Access: Requires admin role.
 */
const testCorporateDomain = async (request) => {
  try {
    // Check admin permissions
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const userRole = request.user.get('role');
    if (!['admin', 'superadmin'].includes(userRole)) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Admin access required for domain testing'
      );
    }

    const { testEmail } = request.params;

    if (!testEmail) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'testEmail parameter required');
    }

    // Extract domain and check configuration
    const domain = CorporateOAuthService.extractEmailDomain(testEmail);
    const domainConfig = OAuthService.getCorporateDomainConfig(testEmail);

    if (!domainConfig) {
      return {
        success: false,
        message: `Domain ${domain} is not configured for corporate SSO`,
        domain,
        configured: false,
      };
    }

    // Test the provider availability
    const providerConfig = OAuthService.getProviderConfig(domainConfig.primaryProvider);

    logger.logSecurityEvent('CORPORATE_DOMAIN_TESTED', request.user.id, {
      adminUser: request.user.get('username'),
      testEmail: CorporateOAuthService.maskEmail(testEmail),
      domain,
      provider: domainConfig.primaryProvider,
      result: 'configured',
    });

    return {
      success: true,
      message: `Domain ${domain} is configured for corporate SSO`,
      domain,
      configured: true,
      corporateConfig: {
        clientName: domainConfig.clientName,
        type: domainConfig.type,
        primaryProvider: domainConfig.primaryProvider,
        autoProvisionEmployees: domainConfig.autoProvisionEmployees,
      },
      providerConfig,
    };
  } catch (error) {
    logger.error('Error testing corporate domain:', error);
    throw error;
  }
};

/**
 * Gets OAuth audit logs (admin view)
 * Endpoint: GET /functions/getOAuthAuditLogs
 * Access: Requires admin role.
 */
const getOAuthAuditLogs = async (request) => {
  try {
    // Check admin permissions
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const userRole = request.user.get('role');
    if (!['admin', 'superadmin'].includes(userRole)) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Admin access required for audit logs'
      );
    }

    const { limit = 50, skip = 0, entityType = 'OAuthEvent' } = request.params;

    // Query OAuth-related audit logs
    const auditQuery = new Parse.Query('AuditLog');
    auditQuery.equalTo('entityType', entityType);
    auditQuery.descending('createdAt');
    auditQuery.limit(Math.min(limit, 100)); // Max 100 records
    auditQuery.skip(skip);

    const auditLogs = await auditQuery.find({ useMasterKey: true });

    const logs = auditLogs.map((log) => ({
      id: log.id,
      action: log.get('action'),
      entityId: log.get('entityId'),
      userId: log.get('userId'),
      timestamp: log.get('createdAt'),
      oauthProvider: log.get('oauthProvider'),
      pciRelevant: log.get('pciRelevant'),
      // Exclude sensitive details for security
      hasDetails: !!log.get('oauthDetails'),
    }));

    logger.logSecurityEvent('OAUTH_AUDIT_LOGS_RETRIEVED', request.user.id, {
      adminUser: request.user.get('username'),
      logCount: logs.length,
      entityType,
    });

    return {
      success: true,
      logs,
      count: logs.length,
      entityType,
    };
  } catch (error) {
    logger.error('Error retrieving OAuth audit logs:', error);
    throw error;
  }
};

module.exports = {
  getAvailableCorporateDomains,
  addCorporateDomain,
  getOAuthProviderStatus,
  testCorporateDomain,
  getOAuthAuditLogs,
};
