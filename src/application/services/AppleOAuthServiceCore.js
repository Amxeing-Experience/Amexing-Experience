/**
 * Apple OAuth Service Core - Refactored Sprint 04
 * Core Apple OAuth functionality split into manageable components.
 * Backend integration for Apple Sign In with privacy compliance.
 */

const Parse = require('parse/node');
const crypto = require('crypto');
const fs = require('fs');

const logger = require('../../infrastructure/logger');
const { AppleIdTokenValidator } = require('./AppleIdTokenValidator');
const { AppleTokenExchanger } = require('./AppleTokenExchanger');

class AppleOAuthServiceCore {
  constructor() {
    this.config = {
      teamId: process.env.APPLE_TEAM_ID,
      clientId: process.env.APPLE_CLIENT_ID,
      keyId: process.env.APPLE_KEY_ID,
      privateKeyPath: process.env.APPLE_PRIVATE_KEY_PATH,
      redirectUri: process.env.APPLE_REDIRECT_URI || `${process.env.PARSE_PUBLIC_SERVER_URL}/auth/oauth/apple/callback`,
      scope: 'email name',
      responseType: 'code id_token',
      responseMode: 'form_post',
    };

    this.validateConfig();
    this.loadPrivateKey();
    this.initializeHelpers();
  }

  /**
   * Validates Apple OAuth configuration.
   * @example
   */
  validateConfig() {
    const required = ['teamId', 'clientId', 'keyId', 'privateKeyPath'];
    // eslint-disable-next-line security/detect-object-injection
    const missing = required.filter((key) => !this.config[key]);

    if (missing.length > 0) {
      if (process.env.NODE_ENV === 'development') {
        logger.warn(`Apple OAuth not configured in development: ${missing.join(', ')}`);
        this.disabled = true;
        return;
      }
      throw new Error(`Missing Apple OAuth configuration: ${missing.join(', ')}`);
    }
  }

  /**
   * Loads Apple private key from filesystem.
   * @example
   */
  loadPrivateKey() {
    if (this.disabled) {
      return;
    }

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      if (!fs.existsSync(this.config.privateKeyPath)) {
        throw new Error(`Apple private key file not found: ${this.config.privateKeyPath}`);
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
   * @returns {string} Authorization URL.
   * @example
   */
  buildAuthUrl(options = {}) {
    const {
      state,
      nonce,
      responseMode = this.config.responseMode,
    } = options;

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
   * @returns {Promise<object>} OAuth initiation result.
   * @example
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

      logger.info(`Apple OAuth initiated for department: ${department}, IP: ${ip}`);

      return {
        authUrl,
        state,
        nonce,
        expiresIn: 600000, // 10 minutes
        stateData,
      };
    } catch (error) {
      logger.error('Apple OAuth initiation failed:', error);
      throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'Failed to initiate Apple OAuth');
    }
  }

  /**
   * Verifies Apple ID token using token validator.
   * @param {string} idToken - Apple ID token.
   * @param {string} expectedNonce - Expected nonce.
   * @returns {Promise<object>} Token payload.
   * @example
   */
  async verifyIdToken(idToken, expectedNonce) {
    return this.tokenValidator.verifyIdToken(idToken, expectedNonce);
  }

  /**
   * Exchanges authorization code for tokens.
   * @param {string} code - Authorization code.
   * @returns {Promise<object>} Token data.
   * @example
   */
  async exchangeCodeForTokens(code) {
    return this.tokenExchanger.exchangeCodeForTokens(code);
  }

  /**
   * Builds user profile from Apple data.
   * @param {object} idTokenPayload - ID token payload.
   * @param {object} userData - User data from Apple.
   * @param {object} tokenData - Token exchange data.
   * @returns {object} User profile.
   * @example
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
      profile.accessToken = tokenData.access_token;
      profile.refreshToken = tokenData.refresh_token;
      profile.tokenType = tokenData.token_type;
      profile.expiresIn = tokenData.expires_in;
    }

    // Privacy-compliant fields
    profile.isPrivateEmail = idTokenPayload.is_private_email === 'true';
    profile.realUserStatus = idTokenPayload.real_user_status;

    return profile;
  }
}

module.exports = { AppleOAuthServiceCore };
