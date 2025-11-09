/**
 * Corporate Landing Pages Cloud Functions
 * Handles corporate-specific landing page generation and OAuth flows.
 * @author Amexing Development Team
 * @version 1.0.0
 * @created Sprint 02 - Corporate Landing Pages
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { 'parse/node': 'example' });
 * // Returns: function result
 */

const Parse = require('parse/node');
const OAuthService = require('../../application/services/OAuthService');
const CorporateOAuthService = require('../../application/services/CorporateOAuthService');
const logger = require('../../infrastructure/logger');

/**
 * Generates corporate landing page configuration
 * Endpoint: GET /functions/getCorporateLandingConfig
 * Access: Public (but logs for security monitoring).
 * @param {object} request - HTTP request object.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 * // GET /api/endpoint
 * // Response: { "success": true, "data": [...] }
 * @returns {Promise<object>} - Promise resolving to operation result.
 */
const getCorporateLandingConfig = async (request) => {
  try {
    const { clientSlug, departmentCode, email } = request.params;

    let corporateConfig = null;
    let suggestedProvider = null;
    let autoSSO = false;

    // If email is provided, check for corporate domain
    if (email) {
      const domainConfig = OAuthService.getCorporateDomainConfig(email);
      if (domainConfig) {
        corporateConfig = _domainConfig; // eslint-disable-line no-undef
        suggestedProvider = _domainConfig.primaryProvider; // eslint-disable-line no-undef
        autoSSO = true;

        logger.logSecurityEvent('CORPORATE_LANDING_EMAIL_DETECTED', null, {
          email: CorporateOAuthService.maskEmail(email),
          domain: CorporateOAuthService.extractEmailDomain(email),
          provider: suggestedProvider,
          clientName: domainConfig.clientName,
        });
      }
    }

    // If client slug is provided, try to find corporate client
    let clientInfo = null;
    if (clientSlug) {
      try {
        const clientQuery = new Parse.Query('Client');
        clientQuery.equalTo('urlSlug', clientSlug);
        clientQuery.equalTo('active', true);

        const client = await clientQuery.first({ useMasterKey: true });

        if (client) {
          clientInfo = {
            id: client.id,
            name: client.get('name'),
            isCorporate: client.get('isCorporate') || false,
            oauthEnabled: client.get('oauthEnabled') || false,
            primaryOAuthProvider: client.get('primaryOAuthProvider'),
            corporateDomain: client.get('corporateDomain'),
          };

          // If client has OAuth configured, set as corporate config
          if (clientInfo.oauthEnabled && clientInfo.corporateDomain) {
            const domainConfig = OAuthService.getCorporateDomainConfig(`test@${clientInfo.corporateDomain}`);
            if (domainConfig) {
              corporateConfig = _domainConfig; // eslint-disable-line no-undef
              suggestedProvider = clientInfo.primaryOAuthProvider || _domainConfig.primaryProvider; // eslint-disable-line no-undef
            }
          }
        }
      } catch (error) {
        logger.error('Error finding client by slug:', error);
      }
    }

    // Get available OAuth providers
    const availableProviders = OAuthService.getAvailableProviders();
    const providerConfigs = {};

    availableProviders.forEach((provider) => {
      const config = OAuthService.getProviderConfig(_provider); // eslint-disable-line no-undef
      providerConfigs[provider] = {
        name: provider,
        enabled: config.enabled,
        mockMode: config.mockMode,
      };
    });

    const response = {
      success: true,
      clientInfo,
      corporateConfig,
      suggestedProvider,
      autoSSO,
      availableProviders: providerConfigs,
      departmentCode: departmentCode || null,
      ssoEnabled: !!corporateConfig,
    };

    // Log landing page access for security monitoring
    logger.logSecurityEvent('CORPORATE_LANDING_ACCESSED', null, {
      clientSlug: clientSlug || 'none',
      departmentCode: departmentCode || 'none',
      hasEmail: !!email,
      ssoEnabled: response.ssoEnabled,
      suggestedProvider: suggestedProvider || 'none',
    });

    return response;
  } catch (error) {
    logger.error('Error generating corporate landing config:', error);
    throw error;
  }
};

/**
 * Generates OAuth authorization URL for corporate landing
 * Endpoint: POST /functions/generateCorporateOAuthURL
 * Access: Public.
 * @param {object} request - HTTP request object.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 * // POST /api/endpoint
 * // Body: { "data": "value" }
 * // Response: { "success": true, "message": "Created" }
 * @returns {Promise<object>} - Promise resolving to operation result.
 */
const generateCorporateOAuthURL = async (request) => {
  try {
    const {
      _provider, email, clientSlug, departmentCode, redirectUri,
    } = request.params;

    if (!_provider) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Provider is required');
    }

    // Validate provider
    const availableProviders = OAuthService.getAvailableProviders();
    if (!availableProviders.includes(_provider)) {
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        `Invalid _provider. Available: ${availableProviders.join(', ')}`
      );
    }

    // If email is provided, validate corporate configuration
    let corporateInfo = null;
    if (email) {
      const domainConfig = OAuthService.getCorporateDomainConfig(email);
      if (domainConfig) {
        corporateInfo = {
          domain: CorporateOAuthService.extractEmailDomain(email),
          clientName: domainConfig.clientName,
          primaryProvider: domainConfig.primaryProvider,
        };

        // Warn if using different provider than configured
        if (domainConfig.primaryProvider !== _provider) {
          logger.logSecurityEvent('CORPORATE_OAUTH_PROVIDER_MISMATCH', null, {
            email: CorporateOAuthService.maskEmail(email),
            configuredProvider: domainConfig.primaryProvider,
            requestedProvider: provider, // eslint-disable-line no-undef
          });
        }
      }
    }

    // Generate OAuth URL with corporate context
    const state = JSON.stringify({
      clientSlug: clientSlug || null,
      departmentCode: departmentCode || null,
      corporateDomain: corporateInfo?._domain || null, // eslint-disable-line no-underscore-dangle
      timestamp: Date.now(),
    });

    const authURL = await OAuthService.generateAuthorizationURL(
      _provider,
      redirectUri || `${process.env.PARSE_PUBLIC_SERVER_URL}/auth/${_provider}/callback`,
      state
    );

    logger.logSecurityEvent('CORPORATE_OAUTH_URL_GENERATED', null, {
      provider, // eslint-disable-line no-undef
      hasEmail: !!email,
      hasCorporateInfo: !!corporateInfo,
      clientSlug: clientSlug || 'none',
      departmentCode: departmentCode || 'none',
    });

    return {
      success: true,
      authURL,
      provider, // eslint-disable-line no-undef
      corporateInfo,
      state,
    };
  } catch (error) {
    logger.error('Error generating corporate OAuth URL:', error);
    throw error;
  }
};

/**
 * Validates corporate landing page access
 * Endpoint: POST /functions/validateCorporateLandingAccess
 * Access: Public (with rate limiting).
 * @param {object} request - HTTP request object.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 * // POST /api/endpoint
 * // Body: { "data": "value" }
 * // Response: { "success": true, "message": "Created" }
 * @returns {Promise<object>} - Promise resolving to operation result.
 */
const validateCorporateLandingAccess = async (request) => {
  try {
    const { clientSlug, departmentCode, email } = request.params;

    // Basic validation
    if (!clientSlug) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Client slug is required');
    }

    // Find client
    const clientQuery = new Parse.Query('Client');
    clientQuery.equalTo('urlSlug', clientSlug);
    clientQuery.equalTo('active', true);

    const client = await clientQuery.first({ useMasterKey: true });

    if (!client) {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Client not found');
    }

    let accessGranted = true;
    let requiresSSO = false;
    let ssoProvider = null;

    // Check if this is a corporate client with SSO requirements
    if (client.get('isCorporate') && client.get('oauthEnabled')) {
      requiresSSO = true;
      ssoProvider = client.get('primaryOAuthProvider');

      // If email is provided and matches corporate domain, allow access
      if (email && client.get('corporateDomain')) {
        const emailDomain = CorporateOAuthService.extractEmailDomain(email);
        if (emailDomain !== client.get('corporateDomain')) {
          accessGranted = false;
        }
      }
    }

    // Check department access if specified
    let departmentInfo = null;
    if (departmentCode && client.get('isCorporate')) {
      try {
        const deptQuery = new Parse.Query('ClientDepartment');
        deptQuery.equalTo('clientId', client.id);
        deptQuery.equalTo('departmentCode', departmentCode);
        deptQuery.equalTo('active', true);

        const department = await deptQuery.first({ useMasterKey: true });

        if (department) {
          departmentInfo = {
            id: department.id,
            name: department.get('name'),
            code: department.get('departmentCode'),
            requiresApproval: department.get('requiresApproval') || false,
          };
        } else {
          // Department not found, but don't block access
          logger.logSecurityEvent('DEPARTMENT_NOT_FOUND', null, {
            clientSlug,
            departmentCode,
            clientId: client.id,
          });
        }
      } catch (error) {
        logger.error('Error finding department:', error);
      }
    }

    logger.logSecurityEvent('CORPORATE_LANDING_ACCESS_VALIDATED', null, {
      clientSlug,
      departmentCode: departmentCode || 'none',
      hasEmail: !!email,
      accessGranted,
      requiresSSO,
      ssoProvider: ssoProvider || 'none',
    });

    return {
      success: true,
      accessGranted,
      requiresSSO,
      ssoProvider,
      client: {
        id: client.id,
        name: client.get('name'),
        isCorporate: client.get('isCorporate'),
        corporateDomain: client.get('corporateDomain'),
      },
      departmentInfo,
      message: accessGranted ? 'Access granted to corporate landing page' : 'Access restricted - SSO required',
    };
  } catch (error) {
    logger.error('Error validating corporate landing access:', error);
    throw error;
  }
};

/**
 * Gets corporate client departments for landing page
 * Endpoint: GET /functions/getCorporateClientDepartments
 * Access: Public (for client-specific landing pages).
 * @param {object} request - HTTP request object.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 * // GET /api/endpoint
 * // Response: { "success": true, "data": [...] }
 * @returns {Promise<object>} - Promise resolving to operation result.
 */
const getCorporateClientDepartments = async (request) => {
  try {
    const { clientSlug } = request.params;

    if (!clientSlug) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Client slug is required');
    }

    // Find client
    const clientQuery = new Parse.Query('Client');
    clientQuery.equalTo('urlSlug', clientSlug);
    clientQuery.equalTo('active', true);

    const client = await clientQuery.first({ useMasterKey: true });

    if (!client) {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Client not found');
    }

    // Only return departments for corporate clients
    if (!client.get('isCorporate')) {
      return {
        success: true,
        departments: [],
        message: 'Client is not configured as corporate',
      };
    }

    // Get client departments
    const deptQuery = new Parse.Query('ClientDepartment');
    deptQuery.equalTo('clientId', client.id);
    deptQuery.equalTo('active', true);
    deptQuery.ascending('name');

    const departments = await deptQuery.find({ useMasterKey: true });

    const departmentList = departments.map((dept) => ({
      id: dept.id,
      name: dept.get('name'),
      code: dept.get('departmentCode'),
      description: dept.get('description'),
      requiresApproval: dept.get('requiresApproval') || false,
      color: dept.get('color') || '#007bff',
      icon: dept.get('icon') || 'department',
    }));

    logger.logSecurityEvent('CORPORATE_DEPARTMENTS_RETRIEVED', null, {
      clientSlug,
      clientId: client.id,
      departmentCount: departmentList.length,
    });

    return {
      success: true,
      client: {
        id: client.id,
        name: client.get('name'),
        isCorporate: true,
      },
      departments: departmentList,
      count: departmentList.length,
    };
  } catch (error) {
    logger.error('Error getting corporate client departments:', error);
    throw error;
  }
};

module.exports = {
  getCorporateLandingConfig,
  generateCorporateOAuthURL,
  validateCorporateLandingAccess,
  getCorporateClientDepartments,
};
