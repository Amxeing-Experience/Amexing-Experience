/* eslint-disable max-lines */
/**
 * OAuth Service - Handles OAuth 2.0 authentication with multiple providers
 * Production implementation with Google, Microsoft, and Apple OAuth integration.
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 2024-09-12
 * @since 2.0.0
 */

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
 * @class OAuthService
 * @example
 * const oauthService = new OAuthService();
 * const authUrl = oauthService.getAuthorizationUrl('google', 'state123');
 */
class OAuthService {
  constructor() {
    this.mockMode = process.env.OAUTH_MOCK_MODE === 'true';
    this.providers = this.initializeProviders();
  }

  /**
   * Initializes OAuth providers configuration.
   * @returns {object} Providers configuration.
   * @example
   * const service = new OAuthService();
   * const providers = service.initializeProviders();
   */
  initializeProviders() {
    return {
      google: {
        clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
        enabled: process.env.GOOGLE_OAUTH_ENABLED === 'true',
        mockMode: process.env.GOOGLE_OAUTH_MOCK_MODE === 'true',
        scopes: ['openid', 'profile', 'email'],
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
      },
      microsoft: {
        clientId: process.env.MICROSOFT_OAUTH_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET,
        redirectUri: process.env.MICROSOFT_OAUTH_REDIRECT_URI,
        tenantId: process.env.MICROSOFT_OAUTH_TENANT_ID,
        enabled: process.env.MICROSOFT_OAUTH_ENABLED === 'true',
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
        enabled: process.env.APPLE_OAUTH_ENABLED === 'true',
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
   * @param {string} state - State parameter for CSRF protection.
   * @returns {Promise<string>} Authorization URL.
   * @example
   * const service = new OAuthService();
   * const authUrl = await service.generateAuthorizationUrl('google', 'state123');
   */
  async generateAuthorizationUrl(provider, state = null) {
    try {
      const providerConfig = this.providers[provider];

      if (!providerConfig) {
        throw new Parse.Error(Parse.Error.INVALID_REQUEST, `Unsupported provider: ${provider}`);
      }

      // In mock mode, return mock URL
      if (this.mockMode || providerConfig.mockMode) {
        return this.generateMockAuthUrl(provider, state);
      }

      // Generate state if not provided
      let stateValue = state;
      if (!stateValue) {
        stateValue = crypto.randomBytes(32).toString('hex');
      }

      // Store state for verification (in production, use Redis or database)
      await this.storeOAuthState(stateValue, { provider, timestamp: Date.now() });

      const params = new URLSearchParams({
        client_id: providerConfig.clientId,
        redirect_uri: providerConfig.redirectUri,
        response_type: 'code',
        scope: providerConfig.scopes.join(' '),
        state: stateValue,
      });

      // Provider-specific parameters
      if (provider === 'microsoft' && providerConfig.tenantId) {
        params.append('tenant', providerConfig.tenantId);
      }

      if (provider === 'apple') {
        params.append('response_mode', 'form_post');
      }

      const authUrl = `${providerConfig.authUrl}?${params.toString()}`;

      logger.logSecurityEvent('OAUTH_AUTH_URL_GENERATED', {
        provider,
        state: `${stateValue.substring(0, 8)}***`,
      });

      return authUrl;
    } catch (error) {
      logger.error(`OAuth authorization URL generation error for ${provider}:`, error);
      throw error;
    }
  }

  /**
   * Handles OAuth callback and exchanges code for tokens.
   * @param {string} provider - Provider name.
   * @param {string} code - Authorization code.
   * @param {string} state - State parameter.
   * @returns {Promise<object>} Authentication result.
   * @example
   * const service = new OAuthService();
   * const result = await service.handleCallback('google', 'auth_code_123', 'state123');
   */
  async handleCallback(provider, code, state) {
    try {
      const providerConfig = this.providers[provider];

      if (!providerConfig) {
        throw new Parse.Error(Parse.Error.INVALID_REQUEST, `Unsupported provider: ${provider}`);
      }

      // Verify state parameter
      const stateData = await this.verifyOAuthState(state);
      if (!stateData || stateData.provider !== provider) {
        throw new Parse.Error(Parse.Error.INVALID_REQUEST, 'Invalid state parameter');
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
          const { userInfo: appleUserInfo } = tokens;
          userInfo = appleUserInfo;
        } else {
          // For other providers, get user info via API
          userInfo = await this.getUserInfo(provider, tokens.access_token);
        }
      }

      // Find or create user
      const authResult = await this.findOrCreateUser(provider, userInfo);

      logger.logSecurityEvent('OAUTH_LOGIN_SUCCESS', {
        provider,
        userId: authResult.user.id,
        email: this.maskEmail(userInfo.email),
      });

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
   * Links OAuth account to existing user.
   * @param {string} userId - Existing user ID.
   * @param {string} provider - Provider name.
   * @param {object} oauthData - OAuth account data.
   * @returns {Promise<object>} Link result.
   * @example
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
      user.addOAuthAccount({
        provider,
        providerId: oauthData.id,
        email: oauthData.email,
        name: oauthData.name,
        profileData: oauthData,
      });

      await user.save(null, { useMasterKey: true });

      logger.logSecurityEvent('OAUTH_ACCOUNT_LINKED', {
        userId,
        provider,
        email: this.maskEmail(oauthData.email),
      });

      return {
        success: true,
        message: 'OAuth account linked successfully',
        user: user.toSafeJSON(),
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
   * @returns {Promise<object>} Unlink result.
   * @example
   * const service = new OAuthService();
   * const result = await service.unlinkOAuthAccount('user123', 'google');
   */
  async unlinkOAuthAccount(userId, provider) {
    try {
      const user = await AuthenticationService.findUserById(userId);

      if (!user) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found');
      }

      const oauthAccount = user.getOAuthAccount(provider);
      if (!oauthAccount) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'OAuth account not found');
      }

      // Remove OAuth account
      user.removeOAuthAccount(provider, oauthAccount.providerId);
      await user.save(null, { useMasterKey: true });

      logger.logSecurityEvent('OAUTH_ACCOUNT_UNLINKED', {
        userId,
        provider,
      });

      return {
        success: true,
        message: 'OAuth account unlinked successfully',
        user: user.toSafeJSON(),
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
   * @param {string} state - State parameter.
   * @returns {string} Mock authorization URL.
   * @example
   * const service = new OAuthService();
   * const mockUrl = service.generateMockAuthUrl('google', 'state123');
   */
  generateMockAuthUrl(provider, state) {
    const mockCode = `mock_${provider}_${crypto.randomBytes(16).toString('hex')}`;
    return `http://localhost:1337/auth/${provider}/mock?code=${mockCode}&state=${state}`;
  }

  /**
   * Gets mock user info for testing.
   * @param {string} provider - Provider name.
   * @param {string} _code - Authorization code (unused in mock).
   * @returns {object} Mock user info.
   * @example
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
      verified_email: true,
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
          is_private_email: false,
        };

      default:
        return baseUser;
    }
  }

  /**
   * Exchanges authorization code for access tokens (real implementation).
   * @param {string} provider - Provider name.
   * @param {string} code - Authorization code.
   * @param {string} _state - State parameter (unused in current implementation).
   * @returns {Promise<object>} Token response.
   * @example
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
        access_token: `mock_access_token_${provider}`,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: `mock_refresh_token_${provider}`,
        scope: providerConfig.scopes.join(' '),
      };
    }

    // Real token exchange implementation
    try {
      const tokenData = await this.performTokenExchange(provider, code, providerConfig);

      logger.logSecurityEvent('OAUTH_TOKEN_EXCHANGE_SUCCESS', null, {
        provider,
        hasRefreshToken: !!tokenData.refresh_token,
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
   * Performs the actual HTTP token exchange with the provider.
   * @param {string} provider - Provider name.
   * @param {string} code - Authorization code
   * @param {object} config - Provider configuration
   * @returns {Promise<object>} Token data
   * @example
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
      });
      throw new Error(`HTTP ${response.status}: ${errorData}`);
    }

    const tokenData = await response.json();

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
   * @returns {Promise<string>} JWT client assertion.
   * @example
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
   * @param {string} accessToken - Access token.
   * @returns {Promise<object>} User information.
   * @example
   * const service = new OAuthService();
   * const userInfo = await service.getUserInfo('google', 'access_token_123');
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
          throw new Error(`Google API error: ${response.status}`);
        }

        userInfo = await response.json();
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
      throw new Parse.Error(
        Parse.Error.OTHER_CAUSE,
        `Failed to get user information from ${provider}`
      );
    }
  }

  /**
   * Finds or creates user from OAuth data.
   * @param {string} provider - Provider name.
   * @param {object} userInfo - OAuth user information.
   * @returns {Promise<object>} Authentication result.
   * @example
   * const service = new OAuthService();
   * const result = await service.findOrCreateUser('google', userInfo);
   */
  async findOrCreateUser(provider, userInfo) {
    try {
      // Check if this is a corporate user first
      const corporateResult = await CorporateOAuthService.mapCorporateUser(userInfo, provider);

      if (corporateResult.isCorporateUser) {
        // Corporate user handling - generate tokens for corporate user
        const tokens = await AuthenticationService.generateTokens(corporateResult.user);

        logger.logSecurityEvent('CORPORATE_OAUTH_LOGIN_SUCCESS', corporateResult.user.id, {
          provider,
          clientId: corporateResult.client?.id,
          clientName: corporateResult.client?.get('name'),
          email: this.maskEmail(userInfo.email),
        });

        return {
          success: true,
          user: corporateResult.user.toSafeJSON(),
          tokens,
          isNewUser: !corporateResult.user.existed(),
          isCorporateUser: true,
          client: corporateResult.client ? {
            id: corporateResult.client.id,
            name: corporateResult.client.get('name'),
            type: corporateResult.client.get('type'),
          } : null,
          message: corporateResult.user.existed()
            ? 'Corporate OAuth login successful'
            : 'Corporate OAuth account created and login successful',
        };
      }

      // Regular OAuth user handling (non-corporate)
      // Try to find existing user by OAuth ID
      let user = await this.findUserByOAuth(provider, userInfo.id);

      if (user) {
        // Update OAuth data
        user.addOAuthAccount({
          provider,
          providerId: userInfo.id,
          email: userInfo.email,
          name: userInfo.name,
          profileData: userInfo,
        });

        await user.recordSuccessfulLogin(`oauth_${provider}`);

        const tokens = await AuthenticationService.generateTokens(user);

        return {
          success: true,
          user: user.toSafeJSON(),
          tokens,
          isNewUser: false,
          isCorporateUser: false,
          message: 'OAuth login successful',
        };
      }

      // Try to find user by email
      user = await AuthenticationService.findUserByEmail(userInfo.email);

      if (user) {
        // Link OAuth account to existing user
        user.addOAuthAccount({
          provider,
          providerId: userInfo.id,
          email: userInfo.email,
          name: userInfo.name,
          profileData: userInfo,
        });

        await user.recordSuccessfulLogin(`oauth_${provider}`);
        await user.save(null, { useMasterKey: true });

        const tokens = await AuthenticationService.generateTokens(user);

        return {
          success: true,
          user: user.toSafeJSON(),
          tokens,
          isNewUser: false,
          isCorporateUser: false,
          linkedAccount: true,
          message: 'OAuth account linked and login successful',
        };
      }

      // Create new user from OAuth data
      user = AmexingUser.create({
        username: this.generateUsernameFromEmail(userInfo.email),
        email: userInfo.email,
        firstName: userInfo.given_name || userInfo.name?.split(' ')[0] || 'User',
        lastName: userInfo.family_name
          || userInfo.name?.split(' ').slice(1).join(' ') || '',
        role: this.determineUserRole(userInfo),
        primaryOAuthProvider: provider,
      });

      // Add OAuth account
      user.addOAuthAccount({
        provider,
        providerId: userInfo.id,
        email: userInfo.email,
        name: userInfo.name,
        profileData: userInfo,
      });

      // Set email as verified if provider confirms it
      if (userInfo.verified_email || userInfo.email_verified) {
        user.set('emailVerified', true);
      }

      const savedUser = await user.save(null, { useMasterKey: true });
      await savedUser.recordSuccessfulLogin(`oauth_${provider}`);

      const tokens = await AuthenticationService.generateTokens(savedUser);

      return {
        success: true,
        user: savedUser.toSafeJSON(),
        tokens,
        isNewUser: true,
        message: 'Account created and OAuth login successful',
      };
    } catch (error) {
      logger.error('Find or create OAuth user error:', error);
      throw error;
    }
  }

  /**
   * Finds user by OAuth provider and ID.
   * @param {string} provider - Provider name.
   * @param {string} providerId - Provider user ID.
   * @returns {Promise<AmexingUser|null>} User object or null.
   * @example
   * const service = new OAuthService();
   * const user = await service.findUserByOAuth('google', 'provider_user_123');
   */
  async findUserByOAuth(provider, providerId) {
    const query = new Parse.Query(AmexingUser);
    query.contains('oauthAccounts', {
      provider,
      providerId,
    });

    return query.first({ useMasterKey: true });
  }

  /**
   * Generates username from email.
   * @param {string} email - Email address.
   * @returns {string} Generated username.
   * @example
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
   * @returns {string} User role.
   * @example
   * const service = new OAuthService();
   * const role = service.determineUserRole(userInfo);
   */
  determineUserRole(userInfo) {
    // Corporate domains get different default roles
    if (userInfo.email) {
      const domain = userInfo.email.split('@')[1];

      // Educational institutions
      if (domain === 'utq.edu.mx') {
        return 'employee';
      }

      // Corporate clients
      if (domain === 'nuba.com.mx') {
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
   * @returns {Promise<void>} Completes when state is stored
   * @example
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
      expiresAt: Date.now() + (10 * 60 * 1000), // 10 minutes
    });
  }

  /**
   * Verifies OAuth state parameter.
   * @param {string} state - State parameter.
   * @returns {Promise<object | null>} State data or null.
   * @example
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
   * @returns {string} Masked email.
   * @example
   * const service = new OAuthService();
   * const masked = service.maskEmail('user@example.com'); // Returns 'use***@example.com'
   */
  maskEmail(email) {
    if (!email) return '';
    const [local, domain] = email.split('@');
    return `${local.substring(0, 3)}***@${domain}`;
  }

  /**
   * Parses Apple ID token to extract user information.
   * @param {string} idToken - Apple ID token JWT.
   * @returns {Promise<object>} User information from ID token.
   * @example
   * const service = new OAuthService();
   * const userInfo = await service.parseAppleIdToken(idTokenJWT);
   */
  async parseAppleIdToken(idToken) {
    try {
      // Apple ID tokens are JWTs that contain user information
      const jwtLib = require('jsonwebtoken');

      // Note: In production, we should verify with Apple's public keys
      // For now, we'll decode and validate basic structure only
      // TODO: Implement proper JWT verification with Apple's public keys
      const decoded = jwtLib.decode(idToken, { complete: true, json: true });

      // Basic validation - check if token has required structure
      if (!decoded || !decoded.header || !decoded.payload) {
        throw new Error('Invalid JWT token structure');
      }

      // Additional validation - check issuer
      if (decoded.payload.iss !== 'https://appleid.apple.com') {
        throw new Error('Invalid token issuer');
      }

      // Check if token is expired
      const now = Math.floor(Date.now() / 1000);
      if (decoded.payload.exp && decoded.payload.exp < now) {
        throw new Error('Token has expired');
      }

      const { payload } = decoded;

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

      // Validate token claims
      if (payload.iss !== 'https://appleid.apple.com') {
        throw new Error('Invalid Apple ID token issuer');
      }

      if (payload.exp && payload.exp < Date.now() / 1000) {
        throw new Error('Apple ID token has expired');
      }

      logger.logSecurityEvent('APPLE_ID_TOKEN_PARSED', null, {
        userId: userInfo.sub,
        email: this.maskEmail(userInfo.email),
        emailVerified: userInfo.email_verified,
        hasName: !!userInfo.name,
      });

      return userInfo;
    } catch (error) {
      logger.error('Error parsing Apple ID token:', error);
      throw new Parse.Error(
        Parse.Error.OTHER_CAUSE,
        `Failed to parse Apple ID token: ${error.message}`
      );
    }
  }

  /**
   * Validates Microsoft Azure AD access token.
   * @param {string} accessToken - Microsoft access token.
   * @returns {Promise<object>} Token validation result.
   * @example
   * const service = new OAuthService();
   * const validation = await service.validateMicrosoftToken('access_token_123');
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
      throw new Parse.Error(
        Parse.Error.INVALID_SESSION_TOKEN,
        'Microsoft token validation failed'
      );
    }
  }

  /**
   * Gets Microsoft user profile with extended directory information.
   * @param {string} accessToken - Microsoft access token.
   * @returns {Promise<object>} Extended user profile.
   * @example
   * const service = new OAuthService();
   * const profile = await service.getMicrosoftUserProfile('access_token_123');
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
        const directoryResponse = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName,givenName,surname,jobTitle,department,companyName,officeLocation', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

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
   * @returns {Array} Available providers.
   * @example
   * const service = new OAuthService();
   * const providers = service.getAvailableProviders();
   */
  getAvailableProviders() {
    return Object.keys(this.providers).filter((provider) => this.providers[provider].enabled || this.mockMode);
  }

  /**
   * Gets provider configuration (safe for client).
   * @param {string} provider - Provider name.
   * @returns {object} Safe provider config.
   * @example
   * const service = new OAuthService();
   * const config = service.getProviderConfig('google');
   */
  getProviderConfig(provider) {
    const config = this.providers[provider];
    if (!config) {
      return null;
    }

    return {
      name: provider,
      enabled: config.enabled || this.mockMode,
      mockMode: config.mockMode || this.mockMode,
      scopes: config.scopes,
    };
  }

  /**
   * Gets available corporate domains for SSO.
   * @returns {Array} List of corporate domain configurations.
   * @example
   * const service = new OAuthService();
   * const domains = service.getAvailableCorporateDomains();
   */
  getAvailableCorporateDomains() {
    return CorporateOAuthService.getAvailableCorporateDomains();
  }

  /**
   * Checks if an email domain is configured for corporate SSO.
   * @param {string} email - Email address to check.
   * @returns {object | null} Corporate configuration if found.
   * @example
   * const service = new OAuthService();
   * const config = service.getCorporateDomainConfig('user@company.com');
   */
  getCorporateDomainConfig(email) {
    const domain = CorporateOAuthService.extractEmailDomain(email);
    const corporateDomains = CorporateOAuthService.getAvailableCorporateDomains();

    return corporateDomains.find((config) => config.domain === domain) || null;
  }

  /**
   * Adds new corporate domain configuration.
   * @param {string} domain - Email domain
   * @param {object} config - Corporate configuration
   * @returns {object} Added domain configuration
   * @example
   * const service = new OAuthService();
   * const result = service.addCorporateDomain('company.com', corporateConfig);
   */
  addCorporateDomain(domain, config) {
    return CorporateOAuthService.addCorporateDomain(domain, config);
  }
}

module.exports = new OAuthService();
