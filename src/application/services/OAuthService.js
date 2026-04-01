/* eslint-disable max-lines */
/* eslint-disable brace-style */
/**
 * OAuth Service - Handles OAuth 2.0 authentication with multiple providers
 * Production implementation with Google, Microsoft, and Apple OAuth integration.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2.0.0
 * @example
 * // OAuth service usage
 * const result = await ooauthservice.require(_provider, authCode);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 */

const Parse = require('parse/node');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const AmexingUser = require('../../domain/models/AmexingUser');
const AuthenticationService = require('./AuthenticationService');
const CorporateOAuthService = require('./CorporateOAuthService');
const logger = require('../../infrastructure/logger');

/**
 * OAuth Service - Handles OAuth 2.0 authentication with multiple providers.
 * Provides secure authentication flows for Google, Microsoft, and Apple OAuth integration.
 * Supports both production and mock modes for testing environments.
 *
 * Features:
 * - Multi-provider OAuth support (Google, Microsoft, Apple)
 * - Corporate domain mapping and SSO
 * - Mock mode for testing environments
 * - CSRF protection with state parameters
 * - Automatic user creation and linking
 * - PCI DSS compliant token handling.
 * @class OAuthService
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2.0.0
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Example usage:
 * // const result = await methodName(params);
 * // console.log(result);
 * const oauthService = new OAuthService();
 * const authUrl = await oauthService.generateAuthorizationUrl('google', 'state123');
 * const result = await oauthService.handleCallback('google', 'auth_code', 'state123');
 */
class OAuthService {
  constructor() {
    this.mockMode = process.env.OAUTH_MOCK_MODE === 'true';
    this.providers = this.initializeProviders();
    this.initialized = false;
    this.corporateService = new CorporateOAuthService();
  }

  /**
   * Ensures providers are initialized with current environment variables.
   * @private
   */
  ensureInitialized() {
    // Always reinitialize providers to ensure latest env vars are loaded
    // This is important for development when env vars change
    this.mockMode = process.env.OAUTH_MOCK_MODE === 'true';
    this.providers = this.initializeProviders();
    this.initialized = true;
  }

  /**
   * Reinitialize providers configuration - useful for testing and development.
   */
  reinitialize() {
    this.providers = this.initializeProviders();
    return this;
  }

  /**
   * Initializes OAuth providers configuration.
   * @returns {object} - Operation result Providers configuration.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.initializeProviders(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const provider = new OAuthProvider("google", config);
   * // const authUrl = await _provider.getAuthorizationUrl(options);
   * const service = new OAuthService();
   * const providers = service.initializeProviders();
   */
  initializeProviders() {
    // Updated configuration - Apple and Microsoft disabled
    return {
      google: {
        clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
        enabled: process.env.GOOGLE_OAUTH_ENABLED === 'true',
        mockMode: process.env.GOOGLE_OAUTH_MOCK_MODE === 'true',
        scopes: process.env.GOOGLE_OAUTH_SCOPES ? process.env.GOOGLE_OAUTH_SCOPES.split(',') : ['openid', 'profile', 'email'],
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
      },
      microsoft: {
        clientId: process.env.MICROSOFT_OAUTH_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET,
        redirectUri: process.env.MICROSOFT_OAUTH_REDIRECT_URI,
        tenantId: process.env.MICROSOFT_OAUTH_TENANT_ID,
        enabled: false, // Disabled - removed from login form
        mockMode: process.env.MICROSOFT_OAUTH_MOCK_MODE === 'true',
        scopes: ['openid', 'profile', 'email'],
        authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
      },
      apple: {
        clientId: process.env.APPLE_OAUTH_CLIENT_ID,
        teamId: process.env.APPLE_OAUTH_TEAM_ID,
        keyId: process.env.APPLE_OAUTH_KEY_ID,
        redirectUri: process.env.APPLE_OAUTH_REDIRECT_URI,
        enabled: false, // Disabled - removed from login form
        mockMode: process.env.APPLE_OAUTH_MOCK_MODE === 'true',
        scopes: ['name', 'email'],
        authUrl: 'https://appleid.apple.com/auth/authorize',
        tokenUrl: 'https://appleid.apple.com/auth/token',
      },
    };
  }

  /**
   * Generates OAuth authorization URL.
   * @param {string} provider - Provider name (google, microsoft, apple).
   * @param _provider
   * @param providerName
   * @param {string} state - State parameter for CSRF protection.
   * @returns {Promise<string>} - Authorization URL.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.generateAuthorizationUrl(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const provider = new OAuthProvider("google", config);
   * // const authUrl = await _provider.getAuthorizationUrl(options);
   * const service = new OAuthService();
   * const authUrl = await service.generateAuthorizationUrl('google', 'state123');
   */
  async generateAuthorizationUrl(providerName, state = null) {
    try {
      this.ensureInitialized();
      const providerConfig = this.providers[providerName];

      if (!providerConfig) {
        throw new Parse.Error(Parse.Error.INVALID_REQUEST, `Unsupported provider: ${providerName}`);
      }

      // In mock mode, return mock URL
      if (this.mockMode || providerConfig.mockMode) {
        return this.generateMockAuthUrl(providerName, state);
      }

      // Generate state if not provided
      let stateValue = state;
      if (!stateValue) {
        stateValue = crypto.randomBytes(32).toString('hex');
      }

      // Store state for verification (in production, use Redis or database)
      await this.storeOAuthState(stateValue, {
        provider: providerName,
        timestamp: Date.now(),
      });

      const params = new URLSearchParams({
        client_id: providerConfig.clientId,
        redirect_uri: providerConfig.redirectUri,
        response_type: 'code',
        scope: providerConfig.scopes.join(' '),
        state: stateValue,
      });

      // Provider-specific parameters
      if (providerName === 'google') {
        // Force Google to show account selection screen even if user is logged in
        params.append('prompt', 'select_account');
      }

      if (providerName === 'microsoft' && providerConfig.tenantId) {
        params.append('tenant', providerConfig.tenantId);
      }

      if (providerName === 'apple') {
        params.append('response_mode', 'form_post');
      }

      const authUrl = `${providerConfig.authUrl}?${params.toString()}`;

      logger.logSecurityEvent('OAUTH_AUTH_URL_GENERATED', {
        provider: providerName,
        state: `${stateValue.substring(0, 8)}***`,
      });

      return authUrl;
    } catch (error) {
      logger.error(`OAuth authorization URL generation error for ${providerName}:`, error);
      throw error;
    }
  }

  /**
   * Handles OAuth callback and exchanges code for tokens.
   * @param {string} provider - Provider name.
   * @param _provider
   * @param {string} code - Authorization code.
   * @param {string} state - State parameter.
   * @returns {Promise<object>} - Authentication result.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.handleCallback(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const provider = new OAuthProvider("google", config);
   * // const authUrl = await _provider.getAuthorizationUrl(options);
   * const service = new OAuthService();
   * const result = await service.handleCallback('google', 'auth_code_123', 'state123');
   */
  async handleCallback(provider, code, state) {
    try {
      this.ensureInitialized();
      const providerConfig = this.providers[provider];

      if (!providerConfig) {
        throw new Parse.Error(Parse.Error.INVALID_REQUEST, `Unsupported provider: ${provider}`);
      }

      // Verify state parameter
      const stateData = await this.verifyOAuthState(state);
      if (!stateData || stateData.provider !== provider) {
        // In development mode, be more lenient with state validation
        if (process.env.NODE_ENV === 'development') {
          logger.warn(`OAuth state validation failed for ${provider}, but allowing in development mode. State: ${state}`);
        } else {
          throw new Parse.Error(Parse.Error.INVALID_REQUEST, 'Invalid state parameter');
        }
      }

      let userInfo;

      // In mock mode, return mock user data
      if (this.mockMode || providerConfig.mockMode) {
        userInfo = this.getMockUserInfo(provider, code);
      } else {
        // Exchange code for tokens
        const tokens = await this.exchangeCodeForTokens(provider, code);

        // Get user information
        if (provider === 'apple' && tokens.userInfo) {
          // For Apple, user info comes from the ID token parsed during token exchange
          const { userInfo: _userInfo } = tokens;
          userInfo = _userInfo;
        } else {
          // For other providers, get user info via API
          userInfo = await this.getUserInfo(provider, tokens.access_token);
        }
      }

      // Find or create user
      const authResult = await this.findOrCreateUser(provider, userInfo);

      // Only log success if we have a user (successful login/registration)
      if (authResult.success && authResult.user && authResult.user.id) {
        logger.logSecurityEvent('OAUTH_LOGIN_SUCCESS', {
          provider,
          userId: authResult.user.id,
          email: this.maskEmail(userInfo.email),
        });
      }

      return authResult;
    } catch (error) {
      logger.error(`OAuth callback error for ${provider}:`, error);
      logger.logSecurityEvent('OAUTH_LOGIN_FAILURE', {
        provider,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Confirms OAuth account linking for existing user after user approval.
   * @param {object} oauthInfo - OAuth information from the confirmation flow.
   * @param {object} existingUser - Existing user information.
   * @returns {Promise<object>} - Link result with tokens.
   * @example
   * const result = await service.confirmOAuthLinking(oauthInfo, existingUser);
   */
  async confirmOAuthLinking(oauthInfo, existingUser) {
    try {
      const user = await AuthenticationService.findUserById(existingUser.id);

      if (!user) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found');
      }

      // Validate user is still active and exists
      if (!user.get('active')) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Account is deactivated');
      }

      if (!user.get('exists')) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Account no longer exists');
      }

      // Check if OAuth account is already linked to another user
      const existingOAuthUser = await this.findUserByOAuth(oauthInfo.provider, oauthInfo.providerId);
      if (existingOAuthUser && existingOAuthUser.id !== user.id) {
        throw new Parse.Error(Parse.Error.DUPLICATE_VALUE, 'OAuth account is already linked to another user');
      }

      // Add OAuth account to user
      const existingAccounts = user.get('oauthAccounts') || [];
      const oauthData = {
        provider: oauthInfo.provider,
        providerId: oauthInfo.providerId,
        email: oauthInfo.email,
        name: oauthInfo.name,
        profileData: oauthInfo.profileData,
      };

      // Check if account already exists
      const existingIndex = existingAccounts.findIndex(
        (account) => account.provider === oauthData.provider && account.providerId === oauthData.providerId
      );

      if (existingIndex >= 0) {
        // Update existing account
        existingAccounts[existingIndex] = {
          ...existingAccounts[existingIndex],
          ...oauthData,
          updatedAt: new Date(),
        };
      } else {
        // Add new account
        existingAccounts.push({
          ...oauthData,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      user.set('oauthAccounts', existingAccounts);

      // Set as primary if it's the first OAuth account
      if (!user.get('primaryOAuthProvider')) {
        user.set('primaryOAuthProvider', oauthData.provider);
      }

      // Record successful OAuth login
      user.set('loginAttempts', 0);
      user.set('lockedUntil', null);
      user.set('lastLoginAt', new Date());
      user.set('lastAuthMethod', `oauth_${oauthInfo.provider}`);
      await user.save(null, { useMasterKey: true });

      const tokens = await AuthenticationService.generateTokens(user);

      // Resolve user role for dashboard redirect
      let roleName = 'guest';
      const rolePointer = user.get('roleId');
      if (rolePointer) {
        try {
          const roleObject = await rolePointer.fetch({ useMasterKey: true });
          roleName = roleObject.get('name') || 'guest';
        } catch (error) {
          // Fallback to direct role field if relationship fails
          roleName = user.get('role') || 'guest';
        }
      } else {
        // Fall back to old role field if no roleId
        roleName = user.get('role') || 'guest';
      }

      logger.logSecurityEvent('OAUTH_ACCOUNT_LINKED', {
        userId: user.id,
        provider: oauthInfo.provider,
        email: this.maskEmail(oauthInfo.email),
      });

      return {
        success: true,
        user: {
          id: user.id,
          username: user.get('username'),
          email: user.get('email'),
          firstName: user.get('firstName'),
          lastName: user.get('lastName'),
          role: roleName,
          roleName,
          roleId: user.get('roleId'),
          active: user.get('active'),
          exists: user.get('exists'),
          lastLoginAt: user.get('lastLoginAt'),
          primaryOAuthProvider: user.get('primaryOAuthProvider'),
          hasOAuth: (user.get('oauthAccounts') || []).length > 0,
          createdAt: user.get('createdAt'),
          updatedAt: user.get('updatedAt'),
        },
        tokens,
        linkedAccount: true,
        message: 'OAuth account linked and login successful',
      };
    } catch (error) {
      logger.error('OAuth account linking confirmation error:', error);
      throw error;
    }
  }

  /**
   * Links OAuth account to existing user.
   * @param {string} userId - Existing user ID.
   * @param {string} provider - Provider name.
   * @param _provider
   * @param {object} oauthData - OAuth account data.
   * @returns {Promise<object>} - Link result.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.linkOAuthAccount(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const provider = new OAuthProvider("google", config);
   * // const authUrl = await _provider.getAuthorizationUrl(options);
   * const service = new OAuthService();
   * const result = await service.linkOAuthAccount('user123', 'google', oauthData);
   */
  async linkOAuthAccount(userId, provider, oauthData) {
    try {
      const user = await AuthenticationService.findUserById(userId);

      if (!user) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found');
      }

      // Check if OAuth account is already linked to another user
      const existingUser = await this.findUserByOAuth(provider, oauthData.id);
      if (existingUser && existingUser.id !== userId) {
        throw new Parse.Error(Parse.Error.DUPLICATE_VALUE, 'OAuth account is already linked to another user');
      }

      // Add OAuth account to user
      const existingAccounts = user.get('oauthAccounts') || [];
      const newOAuthData = {
        provider,
        providerId: oauthData.id,
        email: oauthData.email,
        name: oauthData.name,
        profileData: oauthData,
      };

      // Check if account already exists
      const existingIndex = existingAccounts.findIndex(
        (account) => account.provider === newOAuthData.provider && account.providerId === newOAuthData.providerId
      );

      if (existingIndex >= 0) {
        // Update existing account
        existingAccounts[existingIndex] = {
          ...existingAccounts[existingIndex],
          ...newOAuthData,
          updatedAt: new Date(),
        };
      } else {
        // Add new account
        existingAccounts.push({
          ...newOAuthData,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      user.set('oauthAccounts', existingAccounts);

      // Set as primary if it's the first OAuth account
      if (!user.get('primaryOAuthProvider')) {
        user.set('primaryOAuthProvider', newOAuthData.provider);
      }

      await user.save(null, { useMasterKey: true });

      // Resolve user role for dashboard redirect
      let roleName = 'guest';
      const rolePointer = user.get('roleId');
      if (rolePointer) {
        try {
          const roleObject = await rolePointer.fetch({ useMasterKey: true });
          roleName = roleObject.get('name') || 'guest';
        } catch (error) {
          // Fallback to direct role field if relationship fails
          roleName = user.get('role') || 'guest';
        }
      } else {
        // Fall back to old role field if no roleId
        roleName = user.get('role') || 'guest';
      }

      logger.logSecurityEvent('OAUTH_ACCOUNT_LINKED', {
        userId,
        provider,
        email: this.maskEmail(oauthData.email),
      });

      return {
        success: true,
        message: 'OAuth account linked successfully',
        user: {
          id: user.id,
          username: user.get('username'),
          email: user.get('email'),
          firstName: user.get('firstName'),
          lastName: user.get('lastName'),
          role: roleName,
          roleName,
          roleId: user.get('roleId'),
          active: user.get('active'),
          exists: user.get('exists'),
          lastLoginAt: user.get('lastLoginAt'),
          primaryOAuthProvider: user.get('primaryOAuthProvider'),
          hasOAuth: (user.get('oauthAccounts') || []).length > 0,
          createdAt: user.get('createdAt'),
          updatedAt: user.get('updatedAt'),
        },
      };
    } catch (error) {
      logger.error('OAuth account linking error:', error);
      throw error;
    }
  }

  /**
   * Unlinks OAuth account from user.
   * @param {string} userId - User ID.
   * @param {string} provider - Provider name.
   * @param _provider
   * @returns {Promise<object>} - Unlink result.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.unlinkOAuthAccount(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const provider = new OAuthProvider("google", config);
   * // const authUrl = await _provider.getAuthorizationUrl(options);
   * const service = new OAuthService();
   * const result = await service.unlinkOAuthAccount('user123', 'google');
   */
  async unlinkOAuthAccount(userId, provider) {
    try {
      const user = await AuthenticationService.findUserById(userId);

      if (!user) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found');
      }

      const accounts = user.get('oauthAccounts') || [];
      const oauthAccount = accounts.find((account) => account.provider === provider) || null;
      if (!oauthAccount) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'OAuth account not found');
      }

      // Remove OAuth account
      const existingAccounts = user.get('oauthAccounts') || [];
      const filteredAccounts = existingAccounts.filter(
        (account) => !(account.provider === provider && account.providerId === oauthAccount.providerId)
      );

      user.set('oauthAccounts', filteredAccounts);

      // Update primary provider if needed
      if (user.get('primaryOAuthProvider') === provider) {
        user.set('primaryOAuthProvider', filteredAccounts.length > 0 ? filteredAccounts[0].provider : null);
      }
      await user.save(null, { useMasterKey: true });

      // Resolve user role for dashboard redirect
      let roleName = 'guest';
      const rolePointer = user.get('roleId');
      if (rolePointer) {
        try {
          const roleObject = await rolePointer.fetch({ useMasterKey: true });
          roleName = roleObject.get('name') || 'guest';
        } catch (error) {
          // Fallback to direct role field if relationship fails
          roleName = user.get('role') || 'guest';
        }
      } else {
        // Fall back to old role field if no roleId
        roleName = user.get('role') || 'guest';
      }

      logger.logSecurityEvent('OAUTH_ACCOUNT_UNLINKED', {
        userId,
        provider,
      });

      return {
        success: true,
        message: 'OAuth account unlinked successfully',
        user: {
          id: user.id,
          username: user.get('username'),
          email: user.get('email'),
          firstName: user.get('firstName'),
          lastName: user.get('lastName'),
          role: roleName,
          roleName,
          roleId: user.get('roleId'),
          active: user.get('active'),
          exists: user.get('exists'),
          lastLoginAt: user.get('lastLoginAt'),
          primaryOAuthProvider: user.get('primaryOAuthProvider'),
          hasOAuth: (user.get('oauthAccounts') || []).length > 0,
          createdAt: user.get('createdAt'),
          updatedAt: user.get('updatedAt'),
        },
      };
    } catch (error) {
      logger.error('OAuth account unlinking error:', error);
      throw error;
    }
  }

  // Private helper methods

  /**
   * Generates mock authorization URL for testing.
   * @param {string} provider - Provider name.
   * @param _provider
   * @param {string} state - State parameter.
   * @returns {string} - Operation result Mock authorization URL.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.generateMockAuthUrl(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * const service = new OAuthService();
   * const mockUrl = service.generateMockAuthUrl('google', 'state123');
   */
  generateMockAuthUrl(_provider, state) {
    const mockCode = `mock_${_provider}_${crypto.randomBytes(16).toString('hex')}`;
    return `http://localhost:1337/auth/${_provider}/mock?code=${mockCode}&state=${state}`;
  }

  /**
   * Gets mock user info for testing.
   * @param {string} provider - Provider name.
   * @param _provider
   * @param {*} code - Authorization code (unused in mock).
   * @param _code
   * @returns {object} - Operation result Mock user info.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.getMockUserInfo(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * const service = new OAuthService();
   * const userInfo = service.getMockUserInfo('google', 'mock_code');
   */
  getMockUserInfo(provider, _code) {
    const baseUser = {
      id: `mock_${provider}_${crypto.randomBytes(8).toString('hex')}`,
      name: `Test User ${provider}`,
      given_name: 'Test',
      family_name: 'User',
      picture: `https://via.placeholder.com/150?text=${provider}`,
      locale: 'en',
      verifiedemail: true,
    };

    switch (provider) {
      case 'google':
        return {
          ...baseUser,
          email: `test.${provider}@utq.edu.mx`, // Mock corporate domain
          hd: 'utq.edu.mx', // Hosted domain for Google Workspace
        };

      case 'microsoft':
        return {
          ...baseUser,
          email: `test.${provider}@nuba.com.mx`, // Mock corporate domain
          mail: `test.${provider}@nuba.com.mx`,
          userPrincipalName: `test.${provider}@nuba.com.mx`,
          jobTitle: 'Test Employee',
          department: 'IT',
        };

      case 'apple':
        return {
          ...baseUser,
          email: `test.${provider}@icloud.com`,
          email_verified: true,
          is_privateemail: false,
        };

      default:
        return baseUser;
    }
  }

  /**
   * Exchanges authorization code for access tokens (real implementation).
   * @param {string} provider - Provider name.
   * @param _provider
   * @param {string} code - Authorization code.
   * @param {*} state - State parameter (unused in current implementation).
   * @param _state
   * @returns {Promise<object>} - Token response.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.exchangeCodeForTokens(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * const service = new OAuthService();
   * const tokens = await service.exchangeCodeForTokens('google', 'auth_code_123', 'state123');
   */
  async exchangeCodeForTokens(provider, code, _state) {
    const providerConfig = this.providers[provider];

    if (!providerConfig) {
      throw new Parse.Error(Parse.Error.INVALID_REQUEST, `Unsupported provider: ${provider}`);
    }

    // In mock mode, return mock tokens
    if (this.mockMode || providerConfig.mockMode) {
      return {
        accesstoken: `mock_accesstoken_${provider}`,
        token_type: 'Bearer',
        expires_in: 3600,
        refreshtoken: `mock_refreshtoken_${provider}`,
        scope: providerConfig.scopes.join(' '),
      };
    }

    // Real token exchange implementation
    try {
      const tokenData = await this.performTokenExchange(provider, code, providerConfig);

      logger.logSecurityEvent('OAUTH_TOKEN_EXCHANGE_SUCCESS', null, {
        provider,
        hasRefreshToken: !!tokenData.refreshtoken,
      });

      return tokenData;
    } catch (error) {
      logger.error(`OAuth token exchange failed for ${provider}:`, error);
      logger.logSecurityEvent('OAUTH_TOKEN_EXCHANGE_FAILURE', null, {
        provider,
        error: error.message,
      });
      throw new Parse.Error(Parse.Error.OTHER_CAUSE, `Token exchange failed: ${error.message}`);
    }
  }

  /**
   * Performs the actual HTTP token exchange with the _provider.
   * @param {string} provider - Provider name.
   * @param _provider
   * @param {string} code - Authorization code.
   * @param {object} config - Provider configuration.
   * @returns {Promise<object>} - Token data.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.performTokenExchange(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * const service = new OAuthService();
   * const tokenData = await service.performTokenExchange('google', 'auth_code_123', providerConfig);
   */
  async performTokenExchange(provider, code, config) {
    const tokenPayload = {
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    };

    // Debug logging for Google OAuth
    if (provider === 'google') {
      logger.info('Google OAuth token exchange attempt:', {
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        codeLength: code ? code.length : 0,
        codePrefix: code ? `${code.substring(0, 10)}...` : 'null',
        tokenUrl: config.tokenUrl,
      });
    }

    // Initialize configuration
    let configWithTenantUrl = null;

    // Microsoft Azure AD specific configuration
    if (provider === 'microsoft') {
      const tenantId = process.env.MICROSOFT_OAUTH_TENANT_ID || 'common';
      const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
      // Create updated configuration without modifying parameter
      configWithTenantUrl = { ...config, tokenUrl };

      // Add scope for Microsoft
      tokenPayload.scope = config.scopes ? config.scopes.join(' ') : 'openid profile email';
    }

    // Apple requires JWT client assertion instead of client_secret
    if (provider === 'apple') {
      delete tokenPayload.client_secret;
      tokenPayload.client_assertion_type = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
      tokenPayload.client_assertion = await this.createAppleClientAssertion(config);
    }

    const response = await fetch(configWithTenantUrl?.tokenUrl || config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(tokenPayload),
    });

    if (!response.ok) {
      const errorData = await response.text();
      logger.error(`Token exchange failed for ${provider}:`, {
        status: response.status,
        statusText: response.statusText,
        error: errorData,
        tokenUrl: configWithTenantUrl?.tokenUrl || config.tokenUrl,
        requestPayload: {
          client_id: tokenPayload.client_id,
          redirect_uri: tokenPayload.redirect_uri,
          grant_type: tokenPayload.grant_type,
          code_length: tokenPayload.code ? tokenPayload.code.length : 0,
          code_prefix: tokenPayload.code ? `${tokenPayload.code.substring(0, 20)}...` : 'null',
        },
      });
      throw new Error(`HTTP ${response.status}: ${errorData}`);
    }

    const tokenData = await response.json();

    logger.info(`Token exchange successful for ${provider}:`, {
      hasAccessToken: !!tokenData.access_token,
      hasRefreshToken: !!tokenData.refresh_token,
      tokenType: tokenData.token_type,
      expiresIn: tokenData.expires_in,
    });

    // Microsoft-specific token validation
    if (provider === 'microsoft' && tokenData.access_token) {
      await this.validateMicrosoftToken(tokenData.access_token);
    }

    // Apple-specific ID token processing
    if (provider === 'apple' && tokenData.id_token) {
      tokenData.userInfo = await this.parseAppleIdToken(tokenData.id_token);
    }

    return tokenData;
  }

  /**
   * Creates Apple client assertion JWT.
   * @param {object} config - Apple OAuth configuration.
   * @returns {Promise<string>} - JWT client assertion.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.createAppleClientAssertion(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const provider = new OAuthProvider("google", config);
   * // const authUrl = await _provider.getAuthorizationUrl(options);
   * const service = new OAuthService();
   * const assertion = await service.createAppleClientAssertion(appleConfig);
   */
  async createAppleClientAssertion(config) {
    const fs = require('fs').promises;

    try {
      // Read the private key file
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const privateKey = await fs.readFile(process.env.APPLE_OAUTH_PRIVATE_KEY_PATH, 'utf8');

      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: config.teamId,
        iat: now,
        exp: now + 3600, // 1 hour
        aud: 'https://appleid.apple.com',
        sub: config.clientId,
      };

      return jwt.sign(payload, privateKey, {
        algorithm: 'ES256',
        header: {
          alg: 'ES256',
          kid: config.keyId,
        },
      });
    } catch (error) {
      throw new Error(`Failed to create Apple client assertion: ${error.message}`);
    }
  }

  /**
   * Gets user information from provider (real implementation).
   * @param {string} provider - Provider name.
   * @param _provider
   * @param {string} accessToken - Access token.
   * @returns {Promise<object>} - User information.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.getUserInfo(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * const service = new OAuthService();
   * const userInfo = await service.getUserInfo('google', 'accesstoken_123');
   */
  async getUserInfo(provider, accessToken) {
    if (this.mockMode) {
      return this.getMockUserInfo(provider, 'mock_code');
    }

    const config = this.providers[provider];
    if (!config) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, `Unsupported provider: ${provider}`);
    }

    try {
      let userInfo;

      if (provider === 'google') {
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(`Google userinfo API error: ${response.status} - ${errorText}`);
          throw new Error(`Google API error: ${response.status} - ${errorText}`);
        }

        userInfo = await response.json();
        logger.info('Google userinfo retrieved successfully:', {
          id: userInfo.id,
          email: this.maskEmail(userInfo.email),
          name: userInfo.name,
        });
      } else if (provider === 'microsoft') {
        // Use specialized Microsoft method for directory information
        userInfo = await this.getMicrosoftUserProfile(accessToken);
      } else if (provider === 'apple') {
        // Apple returns user info in the ID token JWT
        // Access token is used for Apple's API but user info comes from ID token
        throw new Parse.Error(
          Parse.Error.OPERATION_FORBIDDEN,
          'Apple user info should be extracted from ID token during token exchange'
        );
      }

      logger.logSecurityEvent('OAUTH_USER_INFO_RETRIEVED', null, {
        provider,
        userId: userInfo.id || userInfo.sub,
        email: this.maskEmail(userInfo.email),
      });

      return userInfo;
    } catch (error) {
      logger.error(`Error getting user info from ${provider}:`, error);
      throw new Parse.Error(Parse.Error.OTHER_CAUSE, `Failed to get user information from ${provider}`);
    }
  }

  /**
   * Finds or creates user from OAuth data.
   * @param {string} provider - Provider name.
   * @param _provider
   * @param {object} userInfo - OAuth user information.
   * @returns {Promise<object>} - Authentication result.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.findOrCreateUser(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const provider = new OAuthProvider("google", config);
   * // const authUrl = await _provider.getAuthorizationUrl(options);
   * const service = new OAuthService();
   * const result = await service.findOrCreateUser('google', userInfo);
   */
  async findOrCreateUser(provider, userInfo) {
    try {
      // ===== DEBUG LOGGING START =====
      logger.info('🔍 OAuth findOrCreateUser: Starting user lookup process', {
        provider,
        userInfoEmail: userInfo.email,
        userInfoEmailLength: userInfo.email ? userInfo.email.length : 0,
        userInfoEmailTrimmed: userInfo.email ? userInfo.email.trim() : null,
        userInfoEmailLowercase: userInfo.email ? userInfo.email.toLowerCase() : null,
        userInfoId: userInfo.id,
        userInfoName: userInfo.name,
        userInfoKeys: Object.keys(userInfo),
      });
      // ===== DEBUG LOGGING END =====

      // SIMPLIFIED OAUTH FLOW: No special corporate treatment
      // All OAuth logins follow the same consistent flow:
      // 1. Check if user has OAuth account linked → Login
      // 2. Check if user exists by email → Show linking modal
      // 3. User doesn't exist → Redirect to agency request

      logger.info('🔄 OAuth findOrCreateUser: Using unified flow for all domains', {
        provider,
        email: this.maskEmail(userInfo.email),
        flow: 'unified_oauth_flow',
        behavior: 'No corporate special treatment - consistent for all domains',
      });

      // Step 1: Try to find existing user by OAuth ID first
      logger.info('🔍 OAuth findOrCreateUser: Checking for existing OAuth account', {
        provider,
        providerId: userInfo.id,
        searching: 'oauthAccounts array',
      });

      let user = await this.findUserByOAuth(provider, userInfo.id);

      logger.info('🔍 OAuth findOrCreateUser: OAuth account lookup result', {
        provider,
        providerId: userInfo.id,
        userFound: !!user,
        userId: user ? user.id : null,
        userEmail: user ? user.get('email') : null,
        userActive: user ? user.get('active') : null,
        userExists: user ? user.get('exists') : null,
      });

      if (user) {
        // User already has this OAuth account linked
        // Validate user account status
        if (!user.get('active')) {
          // Account is deactivated
          return {
            success: false,
            error: 'account_deactivated',
            redirectUrl: '/auth/request-access?error=account_deactivated&toast=true',
            message: 'Your account is deactivated. Please contact support.',
          };
        }

        if (!user.get('exists')) {
          // Account is soft-deleted
          return {
            success: false,
            error: 'account_not_found',
            redirectUrl: `/auth/request-access?oauth_attempted=${provider}&email=${encodeURIComponent(userInfo.email)}`,
            message: 'Please request agency access to use this account.',
          };
        }

        // Update existing OAuth account with fresh data
        const existingAccounts = user.get('oauthAccounts') || [];
        const accountIndex = existingAccounts.findIndex(
          (account) => account.provider === provider && account.providerId === userInfo.id
        );

        if (accountIndex >= 0) {
          // Update existing account with fresh profile data
          existingAccounts[accountIndex] = {
            ...existingAccounts[accountIndex],
            email: userInfo.email,
            name: userInfo.name,
            profileData: userInfo,
            lastUsed: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          user.set('oauthAccounts', existingAccounts);
        }

        // Record successful login
        user.set('lastLoginAt', new Date());
        user.set('lastAuthMethod', `oauth_${provider}`);
        await user.save(null, { useMasterKey: true });

        const tokens = await AuthenticationService.generateTokens(user);

        // Resolve user role for dashboard redirect
        let roleName = 'guest';
        const rolePointer = user.get('roleId');
        if (rolePointer) {
          try {
            const roleObject = await rolePointer.fetch({ useMasterKey: true });
            roleName = roleObject.get('name') || 'guest';
          } catch (error) {
            // Fallback to direct role field if relationship fails
            roleName = user.get('role') || 'guest';
          }
        } else {
          // Fall back to old role field if no roleId
          roleName = user.get('role') || 'guest';
        }

        return {
          success: true,
          user: {
            id: user.id,
            username: user.get('username'),
            email: user.get('email'),
            firstName: user.get('firstName'),
            lastName: user.get('lastName'),
            role: roleName,
            roleName,
            roleId: user.get('roleId'),
            active: user.get('active'),
            exists: user.get('exists'),
            lastLoginAt: user.get('lastLoginAt'),
            primaryOAuthProvider: user.get('primaryOAuthProvider'),
            hasOAuth: (user.get('oauthAccounts') || []).length > 0,
            createdAt: user.get('createdAt'),
            updatedAt: user.get('updatedAt'),
          },
          tokens,
          isNewUser: false,
          isCorporateUser: false,
          message: 'OAuth login successful',
        };
      }

      // Step 2: Try to find user by email (existing AmexingUser without OAuth link)
      logger.info('🔍 OAuth findOrCreateUser: Checking for existing user by email', {
        provider,
        emailToSearch: userInfo.email,
        emailToSearchTrimmed: userInfo.email ? userInfo.email.trim() : null,
        emailToSearchLowercase: userInfo.email ? userInfo.email.toLowerCase() : null,
        searching: 'AmexingUser table by email',
        queryFilters: 'exists=true, active=true',
      });

      user = await AuthenticationService.findUserByEmail(userInfo.email);

      logger.info('🔍 OAuth findOrCreateUser: Email lookup result - THIS IS THE CRITICAL CHECK', {
        provider,
        emailSearched: userInfo.email,
        userFound: !!user,
        userId: user ? user.id : null,
        userEmail: user ? user.get('email') : null,
        userActive: user ? user.get('active') : null,
        userExists: user ? user.get('exists') : null,
        userRole: user ? user.get('role') : null,
        userCreatedAt: user ? user.get('createdAt') : null,
        willShowLinkingModal: !!user,
        shouldShowAgencyRequest: !user,
      });

      if (user) {
        // Validate user account status before linking
        if (!user.get('active')) {
          // Account is deactivated
          return {
            success: false,
            error: 'account_deactivated',
            redirectUrl: '/auth/request-access?error=account_deactivated&toast=true',
            message: 'Your account is deactivated. Please contact support.',
          };
        }

        if (!user.get('exists')) {
          // Account is soft-deleted
          return {
            success: false,
            error: 'account_not_found',
            redirectUrl: `/auth/request-access?oauth_attempted=${provider}&email=${encodeURIComponent(userInfo.email)}`,
            message: 'Please request agency access to use this account.',
          };
        }

        // Check if user already has this OAuth provider linked
        const oauthAccounts = user.get('oauthAccounts') || [];
        const hasProvider = oauthAccounts.some((account) => account.provider === provider);
        if (hasProvider) {
          // Already linked, proceed with login
          // Record successful login
          user.set('lastLoginAt', new Date());
          user.set('lastAuthMethod', `oauth_${provider}`);
          await user.save(null, { useMasterKey: true });

          const tokens = await AuthenticationService.generateTokens(user);

          return {
            success: true,
            user: user.toJSON(),
            tokens,
            isNewUser: false,
            isCorporateUser: false,
            message: 'OAuth login successful',
          };
        }

        // User exists but doesn't have OAuth linked - require confirmation
        logger.info('🔍 OAuth findOrCreateUser: RETURNING LINKING CONFIRMATION - This is why the modal shows!', {
          provider,
          existingUserId: user.id,
          existingUserEmail: user.get('email'),
          oauthEmail: userInfo.email,
          outcome: 'requiresLinkingConfirmation=true',
          resultingBehavior: 'Will show Vincular cuenta modal',
        });

        return {
          success: false,
          requiresLinkingConfirmation: true,
          existingUser: {
            id: user.id,
            email: user.get('email'),
            name: user.getDisplayName ? user.getDisplayName() : `${user.get('firstName')} ${user.get('lastName')}`,
          },
          oauthInfo: {
            provider,
            email: userInfo.email,
            name: userInfo.name,
            providerId: userInfo.id,
            profileData: userInfo,
          },
          redirectUrl: `/auth/oauth/confirm-link?provider=${provider}&email=${encodeURIComponent(userInfo.email)}`,
          message: 'Please confirm linking your Google account to your existing Amexing account',
        };
      }

      // Step 3: No existing user found - redirect to agency request
      logger.info('🔍 OAuth findOrCreateUser: RETURNING AGENCY REQUEST - This is the correct behavior for non-existent users!', {
        provider,
        searchedEmail: userInfo.email,
        outcome: 'requiresAgencyRequest=true',
        redirectUrl: `/auth/request-access?oauth_attempted=${provider}&email=${encodeURIComponent(userInfo.email)}`,
        resultingBehavior: 'Will redirect to agency request page',
      });

      return {
        success: false,
        error: 'user_not_found',
        requiresAgencyRequest: true,
        redirectUrl: `/auth/request-access?oauth_attempted=${provider}&email=${encodeURIComponent(userInfo.email)}`,
        message: 'Google account detected. Please request agency access to use this login method.',
      };
    } catch (error) {
      logger.error('Find or create OAuth user error:', error);
      throw error;
    }
  }

  /**
   * Finds user by OAuth provider and ID.
   * @param {string} provider - Provider name.
   * @param _provider
   * @param {string} providerId - Provider user ID.
   * @returns {Promise<AmexingUser|null>} - User object or null.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.findUserByOAuth(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const provider = new OAuthProvider("google", config);
   * // const authUrl = await _provider.getAuthorizationUrl(options);
   * const service = new OAuthService();
   * const user = await service.findUserByOAuth('google', 'provider_user_123');
   */
  async findUserByOAuth(provider, providerId) {
    const query = new Parse.Query(AmexingUser);
    query.equalTo('oauthAccounts.provider', provider);
    query.equalTo('oauthAccounts.providerId', providerId);
    query.equalTo('exists', true); // Only find existing users (not soft deleted)

    return query.first({ useMasterKey: true });
  }

  /**
   * Generates username from email.
   * @param {string} email - Email address.
   * @returns {string} - Operation result Generated username.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.generateUsernameFromEmail(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * const service = new OAuthService();
   * const username = service.generateUsernameFromEmail('user@example.com');
   */
  generateUsernameFromEmail(email) {
    const localPart = email.split('@')[0];
    const sanitized = localPart.replace(/[^a-zA-Z0-9]/g, '');
    const random = Math.random().toString(36).substring(2, 6);
    return `${sanitized}_${random}`.substring(0, 20);
  }

  /**
   * Determines user role based on OAuth data.
   * @param {object} userInfo - OAuth user information.
   * @returns {string} - Operation result User role.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.determineUserRole(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const provider = new OAuthProvider("google", config);
   * // const authUrl = await _provider.getAuthorizationUrl(options);
   * const service = new OAuthService();
   * const role = service.determineUserRole(userInfo);
   */
  determineUserRole(userInfo) {
    // Corporate domains get different default roles
    if (userInfo.email) {
      const _domain = userInfo.email.split('@')[1]; // eslint-disable-line no-underscore-dangle

      // Educational institutions
      if (_domain === 'utq.edu.mx') {
        return 'employee';
      }

      // Corporate clients
      if (_domain === 'nuba.com.mx') {
        return 'client';
      }
    }

    // Default role for individuals
    return 'user';
  }

  /**
   * Stores OAuth state for CSRF protection.
   * @param {string} state - State parameter.
   * @param {object} data - State data.
   * @returns {Promise<void>} - Completes when state is stored.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.storeOAuthState(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const provider = new OAuthProvider("google", config);
   * // const authUrl = await _provider.getAuthorizationUrl(options);
   * const service = new OAuthService();
   * await service.storeOAuthState('state123', { provider: 'google' });
   */
  async storeOAuthState(state, data) {
    // In production, store in Redis or database with expiration
    // For now, we'll use a simple in-memory store
    if (!this.stateStore) {
      this.stateStore = new Map();
    }

    this.stateStore.set(state, {
      ...data,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    });
  }

  /**
   * Verifies OAuth state parameter.
   * @param {string} state - State parameter.
   * @returns {Promise<object | null>} - State data or null.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.verifyOAuthState(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const provider = new OAuthProvider("google", config);
   * // const authUrl = await _provider.getAuthorizationUrl(options);
   * const service = new OAuthService();
   * const stateData = await service.verifyOAuthState('state123');
   */
  async verifyOAuthState(state) {
    if (!this.stateStore) {
      return null;
    }

    const stateData = this.stateStore.get(state);

    if (!stateData) {
      return null;
    }

    // Check expiration
    if (Date.now() > stateData.expiresAt) {
      this.stateStore.delete(state);
      return null;
    }

    // Remove used state
    this.stateStore.delete(state);

    return stateData;
  }

  /**
   * Masks email for logging.
   * @param {string} email - Email to mask.
   * @returns {string} - Operation result Masked email.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.maskEmail(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * const service = new OAuthService();
   * const masked = service.maskEmail('user@example.com'); // Returns 'use***@example.com'
   */
  maskEmail(email) {
    if (!email) return '';
    const [local, domain] = email.split('@');
    return `${local.substring(0, 3)}***@${domain}`;
  }

  /**
   * Gets Apple's public key for JWT verification.
   * @param {string} idToken - Apple ID token to get key ID from.
   * @returns {Promise<string>} - Public key in PEM format.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.getApplePublicKey(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @private
   */
  async getApplePublicKey(idToken) {
    try {
      const https = require('https');

      // Extract key ID from JWT header without full decode
      const headerB64 = idToken.split('.')[0];
      if (!headerB64) {
        throw new Error('Invalid JWT format - missing header');
      }

      const header = JSON.parse(Buffer.from(headerB64, 'base64').toString());
      if (!header.kid) {
        throw new Error('Unable to get key ID from token header');
      }

      const keyId = header.kid;

      // Fetch Apple's public keys
      return new Promise((resolve, reject) => {
        https
          .get('https://appleid.apple.com/auth/keys', (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => {
              try {
                const _keys = JSON.parse(data); // eslint-disable-line no-underscore-dangle
                const key = _keys.keys.find((k) => k.kid === keyId);

                if (!key) {
                  throw new Error(`No public key found for key ID: ${keyId}`);
                }

                // Convert JWK to PEM format using crypto
                const nodeCrypto = require('crypto');
                const keyObject = nodeCrypto.createPublicKey({
                  key,
                  format: 'jwk',
                });
                const publicKey = keyObject.export({
                  type: 'spki',
                  format: 'pem',
                });
                resolve(publicKey);
              } catch (error) {
                reject(new Error(`Failed to parse Apple public keys: ${error.message}`));
              }
            });
          })
          .on('error', (error) => {
            reject(new Error(`Failed to fetch Apple public keys: ${error.message}`));
          });
      });
    } catch (error) {
      throw new Error(`Failed to get Apple public key: ${error.message}`);
    }
  }

  /**
   * Parses Apple ID token to extract user information.
   * @param {string} idToken - Apple ID token JWT.
   * @returns {Promise<object>} - User information from ID token.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.parseAppleIdToken(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * const service = new OAuthService();
   * const userInfo = await service.parseAppleIdToken(idTokenJWT);
   */
  async parseAppleIdToken(idToken) {
    try {
      // Apple ID tokens are JWTs that contain user information
      const jwtLib = require('jsonwebtoken');

      // Get Apple's public key for verification
      const publicKey = await this.getApplePublicKey(idToken);

      // Verify JWT signature and validate claims
      const payload = jwtLib.verify(idToken, publicKey, {
        issuer: 'https://appleid.apple.com',
        audience: process.env.APPLE_CLIENT_ID,
        algorithms: ['RS256'],
      });

      // Extract user information from token payload
      const userInfo = {
        sub: payload.sub, // Apple user ID
        email: payload.email,
        email_verified: payload.email_verified,
        name: payload.name ? `${payload.name.firstName || ''} ${payload.name.lastName || ''}`.trim() : null,
        given_name: payload.name?.firstName,
        family_name: payload.name?.lastName,
        iss: payload.iss, // Should be https://appleid.apple.com
        aud: payload.aud, // Should match client ID
        exp: payload.exp,
        iat: payload.iat,
      };

      // Additional validation is performed by jwt.verify() above

      logger.logSecurityEvent('APPLE_ID_TOKEN_PARSED', null, {
        userId: userInfo.sub,
        email: this.maskEmail(userInfo.email),
        emailVerified: userInfo.email_verified,
        hasName: !!userInfo.name,
      });

      return userInfo;
    } catch (error) {
      logger.error('Error parsing Apple ID token:', error);
      throw new Parse.Error(Parse.Error.OTHER_CAUSE, `Failed to parse Apple ID token: ${error.message}`);
    }
  }

  /**
   * Validates Microsoft Azure AD access token.
   * @param {string} accessToken - Microsoft access token.
   * @returns {Promise<object>} - Token validation result.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.validateMicrosoftToken(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * const service = new OAuthService();
   * const validation = await service.validateMicrosoftToken('accesstoken_123');
   */
  async validateMicrosoftToken(accessToken) {
    try {
      const tenantId = process.env.MICROSOFT_OAUTH_TENANT_ID || 'common';

      // Validate token by calling Microsoft Graph API
      const response = await fetch('https://graph.microsoft.com/v1.0/me', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Microsoft token validation failed: ${response.status}`);
      }

      const userData = await response.json();

      logger.logSecurityEvent('MICROSOFT_TOKEN_VALIDATED', null, {
        userId: userData.id,
        displayName: userData.displayName,
        tenantId: userData.mailboxSettings?.timeZone || tenantId,
      });

      return {
        valid: true,
        userData,
        tenantId,
      };
    } catch (error) {
      logger.error('Microsoft token validation error:', error);
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Microsoft token validation failed');
    }
  }

  /**
   * Gets Microsoft user profile with extended directory information.
   * @param {string} accessToken - Microsoft access token.
   * @returns {Promise<object>} - Extended user profile.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.getMicrosoftUserProfile(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * const service = new OAuthService();
   * const profile = await service.getMicrosoftUserProfile('accesstoken_123');
   */
  async getMicrosoftUserProfile(accessToken) {
    try {
      // Get basic profile
      const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!profileResponse.ok) {
        throw new Error(`Failed to get Microsoft profile: ${profileResponse.status}`);
      }

      const profile = await profileResponse.json();

      // Try to get additional directory information if permissions allow
      try {
        const directoryResponse = await fetch(
          'https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName,givenName,surname,jobTitle,department,companyName,officeLocation',
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        if (directoryResponse.ok) {
          const directoryData = await directoryResponse.json();

          return {
            ...profile,
            jobTitle: directoryData.jobTitle,
            department: directoryData.department,
            companyName: directoryData.companyName,
            officeLocation: directoryData.officeLocation,
            organizationUnit: directoryData.department, // Map for compatibility
          };
        }
      } catch (directoryError) {
        logger.info('Directory information not available, using basic profile:', directoryError.message);
      }

      return profile;
    } catch (error) {
      logger.error('Error getting Microsoft user profile:', error);
      throw error;
    }
  }

  /**
   * Gets list of available OAuth providers.
   * @returns {Array} - Array of results Available providers.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.getAvailableProviders(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const provider = new OAuthProvider("google", config);
   * // const authUrl = await _provider.getAuthorizationUrl(options);
   * const service = new OAuthService();
   * const providers = service.getAvailableProviders();
   */
  getAvailableProviders() {
    return Object.keys(this.providers).filter((providerKey) => this.providers[providerKey].enabled || this.mockMode);
  }

  /**
   * Gets provider configuration (safe for client).
   * @param {string} provider - Provider name.
   * @param _provider
   * @param providerName
   * @returns {object} - Operation result Safe provider config.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.getProviderConfig(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * const service = new OAuthService();
   * const config = service.getProviderConfig('google');
   */
  getProviderConfig(providerName) {
    const config = this.providers[providerName];
    if (!config) {
      return null;
    }

    const displayNames = {
      google: 'Google',
      microsoft: 'Microsoft',
      apple: 'Apple',
    };

    return {
      name: providerName,
      displayName: displayNames[providerName] || providerName,
      enabled: config.enabled || this.mockMode,
      mockMode: config.mockMode || this.mockMode,
      scopes: config.scopes,
    };
  }

  /**
   * Gets available corporate domains for SSO.
   * @returns {Array} - Array of results List of corporate domain configurations.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.getAvailableCorporateDomains(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * const service = new OAuthService();
   * const domains = service.getAvailableCorporateDomains();
   */
  getAvailableCorporateDomains() {
    return this.corporateService.getAvailableCorporateDomains();
  }

  /**
   * Checks if an email domain is configured for corporate SSO.
   * @param {string} email - Email address to check.
   * @returns {object | null} - Operation result Corporate configuration if found.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.getCorporateDomainConfig(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * const service = new OAuthService();
   * const config = service.getCorporateDomainConfig('user@company.com');
   */
  getCorporateDomainConfig(email) {
    const _domain = this.corporateService.extractEmailDomain(email); // eslint-disable-line no-underscore-dangle
    const corporateDomains = this.corporateService.getAvailableCorporateDomains();

    return corporateDomains.find((config) => config.domain === _domain) || null;
  }

  /**
   * Adds new corporate domain configuration.
   * @param {string} domain - Email _domain.
   * @param _domain
   * @param {object} config - Corporate configuration.
   * @returns {object} - Operation result Added domain configuration.
   * @example
   * // OAuth service usage
   * const result = await ooauthservice.addCorporateDomain(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * const service = new OAuthService();
   * const result = service.addCorporateDomain('company.com', corporateConfig);
   */
  addCorporateDomain(_domain, config) {
    return this.corporateService.addCorporateDomain(_domain, config);
  }
}

module.exports = new OAuthService();
