/**
 * Apple OAuth Service Core - Refactored Sprint 04
 * Core Apple OAuth functionality split into manageable components.
 * Backend integration for Apple Sign In with privacy compliance.
 * @example
 * // OAuth service usage
 * const result = await oappleoauthservicecore.require(_provider, authCode);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 */

const Parse = require('parse/node');
const crypto = require('crypto');
const fs = require('fs');

const logger = require('../../infrastructure/logger');
const { AppleIdTokenValidator } = require('./AppleIdTokenValidator');
const { AppleTokenExchanger } = require('./AppleTokenExchanger');

/**
 * Apple OAuth Service Core - Core functionality for Apple Sign In integration.
 * Provides the foundational components for Apple OAuth authentication including
 * configuration management, private key handling, and core OAuth flow logic.
 *
 * This is the base class that contains shared functionality for Apple OAuth operations.
 * It manages Apple-specific configurations, validates ID tokens, and handles
 * the core authentication flow components.
 *
 * Features:
 * - Apple OAuth configuration validation
 * - Private key management for JWT signing
 * - ID token validation and verification
 * - Token exchange functionality
 * - User data parsing and validation
 * - Error handling and logging.
 * @class AppleOAuthServiceCore
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Extend for specific Apple OAuth functionality
 * class AppleOAuthService extends AppleOAuthServiceCore {
 *   async handleCallback(callbackData) {
 *     return super.processAuthentication(callbackData);
 *   }
 * }
 *
 * // Direct usage for core operations
 * const core = new AppleOAuthServiceCore();
 * const isValid = core.validateConfig();
 * const tokenData = await core.exchangeCodeForTokens(authCode);
 */
class AppleOAuthServiceCore {
  constructor() {
    this.config = {
      teamId: process.env.APPLE_TEAM_ID,
      clientId: process.env.APPLE_CLIENT_ID,
      keyId: process.env.APPLE_KEY_ID,
      privateKeyPath: process.env.APPLE_PRIVATE_KEY_PATH,
      redirectUri:
        process.env.APPLE_REDIRECT_URI
        || `${process.env.PARSE_PUBLIC_SERVER_URL}/auth/oauth/apple/callback`,
      scope: 'email name',
      responseType: 'code idtoken',
      responseMode: 'form_post',
    };

    this.validateConfig();
    this.loadPrivateKey();
    this.initializeHelpers();
  }

  /**
   * Validates Apple OAuth configuration.
   * @example
   * // OAuth service usage
   * const result = await oappleoauthservicecore.validateConfig(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {*} - Operation result.
   */
  validateConfig() {
    const required = ['teamId', 'clientId', 'keyId', 'privateKeyPath'];
    // eslint-disable-next-line security/detect-object-injection
    const missing = required.filter((_key) => !this.config[_key]); // eslint-disable-line no-underscore-dangle

    /**
     * Handles missing configuration with environment-aware behavior.
     * In development: warns and disables service gracefully.
     * In production: throws error to prevent silent failures.
     * @param {*} missing.length > 0 - missing.length > 0 parameter.
     * @returns {*} - Operation result.
     * @example
     * // OAuth service usage
     * const result = await oappleoauthservicecore.if(_provider, authCode);
     * // Returns: { success: true, user: {...}, tokens: {...} }
     */
    if (missing.length > 0) {
      if (process.env.NODE_ENV === 'development') {
        logger.warn(
          `Apple OAuth not configured in development: ${missing.join(', ')}`
        );
        this.disabled = true;
        return;
      }
      throw new Error(
        `Missing Apple OAuth configuration: ${missing.join(', ')}`
      );
    }
  }

  /**
   * Loads Apple private key from filesystem with error handling and validation.
   * Reads the private key file for JWT signing in Apple OAuth flow with
   * proper error handling and security validation for key format.
   * @function loadPrivateKey
   * @returns {void} - No return value Loads private key into service instance.
   * @throws {Error} If private key file cannot be read or is invalid.
   * @example
   * // OAuth service usage
   * const result = await oappleoauthservicecore.loadPrivateKey(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Load private key during service initialization
   * appleOAuthService.loadPrivateKey();
   */
  loadPrivateKey() {
    /**
     * Skips key loading if service is disabled due to missing configuration.
     * Prevents errors in development environments with incomplete setup.
     * @param {*} this.disabled - This.disabled parameter.
     * @returns {*} - Operation result.
     * @example
     * // OAuth service usage
     * const result = await oappleoauthservicecore.if(_provider, authCode);
     * // Returns: { success: true, user: {...}, tokens: {...} }
     */
    if (this.disabled) {
      return;
    }

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      if (!fs.existsSync(this.config.privateKeyPath)) {
        throw new Error(
          `Apple private key file not found: ${this.config.privateKeyPath}`
        );
      }

      // eslint-disable-next-line security/detect-non-literal-fs-filename
      this.privateKey = fs.readFileSync(this.config.privateKeyPath, 'utf8');
      logger.info('Apple OAuth private key loaded successfully');
    } catch (error) {
      logger.error('Failed to load Apple OAuth private key:', error);
      throw error;
    }
  }

  /**
   * Initializes helper services.
   * @example
   * // OAuth service usage
   * const result = await oappleoauthservicecore.initializeHelpers(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {*} - Operation result.
   */
  initializeHelpers() {
    if (this.disabled) {
      return;
    }

    this.tokenValidator = new AppleIdTokenValidator(this.config);
    this.tokenExchanger = new AppleTokenExchanger(this.config, this.privateKey);
  }

  /**
   * Builds Apple OAuth authorization URL.
   * @param {object} options - Authorization options.
   * @returns {string} - Operation result Authorization URL.
   * @example
   * // OAuth service usage
   * const result = await oappleoauthservicecore.buildAuthUrl(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  buildAuthUrl(options = {}) {
    const { state, nonce, responseMode = this.config.responseMode } = options;

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: this.config.responseType,
      scope: this.config.scope,
      response_mode: responseMode,
      state: state || crypto.randomBytes(16).toString('hex'),
      nonce: nonce || crypto.randomBytes(16).toString('hex'),
    });

    return `https://appleid.apple.com/auth/authorize?${params.toString()}`;
  }

  /**
   * Initiates Apple OAuth flow.
   * @param {object} options - OAuth initiation options.
   * @returns {Promise<object>} - OAuth initiation result.
   * @example
   * // OAuth service usage
   * const result = await oappleoauthservicecore.initiateOAuth(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  async initiateOAuth(options = {}) {
    const {
      department,
      corporateConfigId,
      redirectUri,
      state: providedState,
      headers = {},
      ip,
    } = options;

    try {
      const state = providedState || crypto.randomBytes(32).toString('hex');
      const nonce = crypto.randomBytes(32).toString('hex');

      // Build authorization URL
      const authUrl = this.buildAuthUrl({
        state,
        nonce,
        responseMode: 'form_post',
      });

      // Store OAuth state with Apple-specific data
      const stateData = {
        provider: 'apple',
        state,
        nonce,
        department,
        corporateConfigId,
        redirectUri: redirectUri || this.config.redirectUri,
        timestamp: new Date(),
        ip,
        userAgent: headers['user-agent'],
      };

      logger.info(
        `Apple OAuth initiated for department: ${department}, IP: ${ip}`
      );

      return {
        authUrl,
        state,
        nonce,
        expiresIn: 600000, // 10 minutes
        stateData,
      };
    } catch (error) {
      logger.error('Apple OAuth initiation failed:', error);
      throw new Parse.Error(
        Parse.Error.INTERNAL_SERVER_ERROR,
        'Failed to initiate Apple OAuth'
      );
    }
  }

  /**
   * Verifies Apple ID token using token validator.
   * @param {string} idToken - Apple ID token.
   * @param {string} expectedNonce - Expected nonce.
   * @returns {Promise<object>} - Token payload.
   * @example
   * // OAuth service usage
   * const result = await oappleoauthservicecore.verifyIdToken(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  async verifyIdToken(idToken, expectedNonce) {
    return this.tokenValidator.verifyIdToken(idToken, expectedNonce);
  }

  /**
   * Exchanges authorization code for tokens.
   * @param {string} code - Authorization code.
   * @returns {Promise<object>} - Token data.
   * @example
   * // OAuth service usage
   * const result = await oappleoauthservicecore.exchangeCodeForTokens(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  async exchangeCodeForTokens(code) {
    return this.tokenExchanger.exchangeCodeForTokens(code);
  }

  /**
   * Builds user profile from Apple data.
   * @param {object} idTokenPayload - ID token payload.
   * @param {object} userData - User data from Apple.
   * @param {object} tokenData - Token exchange data.
   * @returns {object} - Operation result User profile.
   * @example
   * // OAuth service usage
   * const result = await oappleoauthservicecore.buildUserProfile(_provider, authCode);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  buildUserProfile(idTokenPayload, userData, tokenData) {
    const profile = {
      id: idTokenPayload.sub,
      email: idTokenPayload.email,
      emailVerified: idTokenPayload.email_verified === 'true',
      provider: 'apple',
      privacyCompliant: true,
    };

    // Add user data if available (only on first sign-in)
    if (userData && userData.name) {
      profile.name = userData.name;
      profile.firstName = userData.name.firstName;
      profile.lastName = userData.name.lastName;
    }

    // Add token information
    if (tokenData) {
      profile.accessToken = tokenData.accesstoken;
      profile.refreshToken = tokenData.refreshtoken;
      profile.tokenType = tokenData.token_type;
      profile.expiresIn = tokenData.expires_in;
    }

    // Privacy-compliant fields
    profile.isPrivateEmail = idTokenPayload.is_privateemail === 'true';
    profile.realUserStatus = idTokenPayload.real_user_status;

    return profile;
  }
}

module.exports = { AppleOAuthServiceCore };
