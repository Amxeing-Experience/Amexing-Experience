/**
 * Apple OAuth Service - Sprint 04 (Refactored)
 * Backend integration for Apple Sign In with privacy compliance
 * Integrates with department OAuth flows and corporate configurations.
 */

const Parse = require('parse/node');
const { AppleOAuthServiceCore } = require('./AppleOAuthServiceCore');
const logger = require('../../infrastructure/logger');

/**
 * Apple OAuth Service - Handles Apple Sign In authentication flows.
 * Provides secure Apple OAuth integration with privacy compliance features,
 * department-specific flows, and corporate configuration support.
 *
 * Features:
 * - Apple ID Token verification and validation
 * - Privacy-compliant user data handling
 * - Corporate domain mapping and department flows
 * - Enhanced security with nonce validation
 * - Automatic user creation and linking
 * - Comprehensive audit logging.
 * @class AppleOAuthService
 * @augments AppleOAuthServiceCore
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // Initialize Apple OAuth service
 * const appleService = new AppleOAuthService();
 *
 * // Handle Apple OAuth callback
 * const callbackData = {
 *   code: 'authorization_code',
 *   id_token: 'jwt_id_token',
 *   department: 'engineering',
 *   corporateConfigId: 'config123'
 * };
 * const result = await appleService.handleCallback(callbackData);
 *
 * // Initiate Apple OAuth flow
 * const oauthFlow = await appleService.initiateOAuth({
 *   department: 'engineering',
 *   redirectUri: 'https://app.com/auth/callback'
 * });
 */
class AppleOAuthService extends AppleOAuthServiceCore {
  /**
   * Handles Apple OAuth callback with enhanced security.
   * @param {object} callbackData - Callback data from Apple.
   * @returns {Promise<object>} Authentication result.
   * @example Handle Apple OAuth callback
   * const service = new AppleOAuthService();
   * const result = await service.handleCallback(callbackData);
   */
  async handleCallback(callbackData) {
    const {
      code,
      id_token: idToken,
      user: userJsonString,
      error,
      error_description: errorDescription,
      department,
      corporateConfigId,
      nonce: expectedNonce,
    } = callbackData;

    try {
      this.validateCallbackData({
        code, idToken, error, errorDescription,
      });

      const idTokenPayload = await this.verifyIdToken(idToken, expectedNonce);
      const userData = this.parseUserData(userJsonString);
      const tokenData = await this.exchangeCodeForTokens(code);
      const userProfile = this.buildUserProfile(idTokenPayload, userData, tokenData);

      const authResult = await this.processAuthentication(userProfile, {
        department,
        corporateConfigId,
      });

      logger.info(`Apple OAuth callback successful for user: ${authResult.user.id}`);

      return {
        success: true,
        user: authResult.user,
        token: authResult.sessionToken,
        profile: userProfile,
        permissions: authResult.permissions,
        privacyCompliant: true,
        appliedInheritance: authResult.appliedInheritance,
      };
    } catch (callbackError) {
      logger.error('Apple OAuth callback failed:', callbackError);
      throw callbackError;
    }
  }

  /**
   * Validates callback data from Apple.
   * @param {object} data - Callback data to validate.
   * @param {string} data.code - Authorization code.
   * @param {string} data.idToken - ID token.
   * @param {string} data.error - Error code if present.
   * @param {string} data.errorDescription - Error description if present.
   * @example Validate callback data
   * service.validateCallbackData({ code: 'abc', idToken: 'token' });
   */
  validateCallbackData({
    code, idToken, error, errorDescription,
  }) {
    /**
     * Validates for OAuth error responses from Apple's authorization server.
     * Handles error codes and descriptions returned by Apple during failed authentication.
     */
    if (error) {
      throw new Parse.Error(
        Parse.Error.OTHER_CAUSE,
        `Apple OAuth error: ${error} - ${errorDescription || 'Unknown error'}`
      );
    }

    /**
     * Ensures required authorization data is present for token exchange.
     * Both authorization code and ID token are required for Apple OAuth flow completion.
     */
    if (!code || !idToken) {
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        'Missing authorization code or ID token from Apple'
      );
    }
  }

  /**
   * Parses user data from Apple callback.
   * @param {string} userJsonString - JSON string with user data.
   * @returns {object|null} Parsed user data or null.
   * @example Parse user JSON data
   * const userData = service.parseUserData('{"email":"user@example.com"}');
   */
  parseUserData(userJsonString) {
    if (!userJsonString) return null;

    try {
      return JSON.parse(userJsonString);
    } catch (parseError) {
      logger.warn('Failed to parse Apple user data:', parseError);
      return null;
    }
  }

  /**
   * Processes authentication after successful Apple OAuth.
   * @param {object} userProfile - User profile from Apple.
   * @param {object} context - Authentication context.
   * @returns {Promise<object>} Authentication result.
   * @example Process authentication
   * const result = await service.processAuthentication(userProfile, { department: 'IT' });
   */
  async processAuthentication(userProfile, context) {
    const { department } = context;

    try {
      const user = await this.findOrCreateUser(userProfile);

      // TODO: Implement inheritance service when available
      const inheritanceResult = {
        appliedPermissions: [],
        // inheritanceService not available yet
      };

      if (department) {
        await this.applyDepartmentPermissions(user, department, userProfile);
      }

      const sessionToken = await this.createUserSession(user);

      return {
        user,
        sessionToken,
        permissions: inheritanceResult.appliedPermissions,
        appliedInheritance: inheritanceResult,
      };
    } catch (authError) {
      logger.error('Apple OAuth authentication processing failed:', authError);
      throw authError;
    }
  }

  /**
   * Finds or creates user from Apple profile.
   * @param {object} userProfile - Apple user profile.
   * @returns {Promise<Parse.User>} Parse User object.
   * @example Find or create user
   * const user = await service.findOrCreateUser({ email: 'user@example.com', id: 'apple123' });
   */
  async findOrCreateUser(userProfile) {
    const { email, id: appleId } = userProfile;

    // First, try to find by Apple ID
    let userQuery = new Parse.Query(Parse.User);
    userQuery.equalTo('appleId', appleId);
    let user = await userQuery.first({ useMasterKey: true });

    if (!user && email) {
      userQuery = new Parse.Query(Parse.User);
      userQuery.equalTo('email', email);
      user = await userQuery.first({ useMasterKey: true });

      if (user) {
        user.set('appleId', appleId);
        await user.save(null, { useMasterKey: true });
      }
    }

    if (!user) {
      user = await this.createNewUser(userProfile);
    } else {
      user = await this.updateExistingUser(user);
    }

    return user;
  }

  /**
   * Creates new user from Apple profile.
   * @param {object} userProfile - Apple user profile.
   * @returns {Promise<Parse.User>} New Parse User.
   * @example Create new user
   * const user = await service.createNewUser({ email: 'user@example.com', id: 'apple123' });
   */
  async createNewUser(userProfile) {
    const { email, id: appleId } = userProfile;
    const user = new Parse.User();

    user.set('username', email || `apple_${appleId}`);
    user.set('email', email);
    user.set('appleId', appleId);

    if (userProfile.firstName) user.set('firstName', userProfile.firstName);
    if (userProfile.lastName) user.set('lastName', userProfile.lastName);

    user.set('emailVerified', userProfile.emailVerified);
    user.set('isPrivateEmail', userProfile.isPrivateEmail);
    user.set('oauthProviders', ['apple']);
    user.set('lastProvider', 'apple');

    const crypto = require('crypto');
    const randomPassword = crypto.randomBytes(32).toString('hex');
    user.set('password', randomPassword);

    await user.signUp();
    logger.info(`New Apple user created: ${user.id}`);
    return user;
  }

  /**
   * Updates existing user login info.
   * @param {Parse.User} user - Existing user.
   * @returns {Promise<Parse.User>} Updated user.
   * @example Update existing user
   * const updatedUser = await service.updateExistingUser(user);
   */
  async updateExistingUser(user) {
    user.set('lastProvider', 'apple');
    user.set('lastLogin', new Date());

    const providers = user.get('oauthProviders') || [];
    if (!providers.includes('apple')) {
      providers.push('apple');
      user.set('oauthProviders', providers);
    }

    await user.save(null, { useMasterKey: true });
    logger.info(`Existing user logged in via Apple: ${user.id}`);
    return user;
  }

  /**
   * Gets corporate configuration.
   * @param {string} corporateConfigId - Corporate config ID.
   * @returns {Promise<Parse.Object>} Corporate config.
   * @example Get corporate config
   * const config = await service.getCorporateConfig('config123');
   */
  async getCorporateConfig(corporateConfigId) {
    const CorporateConfig = Parse.Object.extend('CorporateConfig');
    const query = new Parse.Query(CorporateConfig);
    return query.get(corporateConfigId, { useMasterKey: true });
  }

  /**
   * Applies department permissions to user.
   * @param {Parse.User} user - User object.
   * @param {string} department - Department code.
   * @param {object} userProfile - User profile.
   * @example Apply department permissions
   * await service.applyDepartmentPermissions(user, 'IT', userProfile);
   */
  async applyDepartmentPermissions(user, department, userProfile) {
    const { DepartmentOAuthFlowService } = require('./DepartmentOAuthFlowService');
    const departmentService = new DepartmentOAuthFlowService();

    await departmentService.applyDepartmentPermissionInheritance(
      user,
      userProfile,
      { code: department },
      'apple'
    );
  }

  /**
   * Creates user session.
   * @param {Parse.User} user - User object.
   * @returns {Promise<string>} Session token.
   * @example Create user session
   * const token = await service.createUserSession(user);
   */
  async createUserSession(user) {
    const crypto = require('crypto');
    const sessionToken = crypto.randomBytes(32).toString('hex');

    const Session = Parse.Object.extend('_Session');
    const session = new Session();

    session.set('sessionToken', sessionToken);
    session.set('user', user);
    session.set('createdWith', {
      action: 'apple_oauth',
      authProvider: 'apple',
    });
    session.set('expiresAt', new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)); // 1 year

    await session.save(null, { useMasterKey: true });
    return sessionToken;
  }

  /**
   * Revokes Apple OAuth tokens.
   * @param {Parse.User} user - User to revoke tokens for.
   * @returns {Promise<object>} Revocation result.
   * @example Revoke Apple tokens
   * const result = await service.revokeTokens(user);
   */
  async revokeTokens(user) {
    try {
      user.unset('appleId');

      const providers = user.get('oauthProviders') || [];
      const updatedProviders = providers.filter((p) => p !== 'apple');
      user.set('oauthProviders', updatedProviders);

      await user.save(null, { useMasterKey: true });

      logger.info(`Apple OAuth association removed for user: ${user.id}`);
      return { success: true };
    } catch (error) {
      logger.error('Failed to revoke Apple OAuth tokens:', error);
      throw error;
    }
  }

  /**
   * Validates Apple webhook.
   * @param {object} requestBody - Webhook request body.
   * @param {string} _signature - Webhook signature (unused for now).
   * @returns {Promise<object>} Validation result.
   * @example Validate Apple webhook
   * const result = await service.validateAppleWebhook(requestBody, signature);
   */
  async validateAppleWebhook(requestBody, _signature) {
    try {
      logger.info('Apple webhook received:', requestBody.type);

      if (requestBody.type === 'consent-revoked') {
        await this.handleConsentRevoked(requestBody.sub);
      }

      return { success: true };
    } catch (error) {
      logger.error('Apple webhook validation failed:', error);
      throw error;
    }
  }

  /**
   * Handles consent revocation.
   * @param {string} appleId - Apple ID of user.
   * @example Handle consent revoked
   * await service.handleConsentRevoked('apple123');
   */
  async handleConsentRevoked(appleId) {
    const userQuery = new Parse.Query(Parse.User);
    userQuery.equalTo('appleId', appleId);

    const user = await userQuery.first({ useMasterKey: true });
    if (!user) return;

    const providers = user.get('oauthProviders') || [];
    const remainingProviders = providers.filter((p) => p !== 'apple');

    if (remainingProviders.length === 0) {
      await user.destroy({ useMasterKey: true });
      logger.info(`User account deleted due to Apple consent revocation: ${user.id}`);
    } else {
      user.unset('appleId');
      user.unset('isPrivateEmail');
      user.set('oauthProviders', remainingProviders);
      await user.save(null, { useMasterKey: true });
      logger.info(`Apple association removed due to consent revocation: ${user.id}`);
    }
  }

  /**
   * Gets privacy-compliant user data.
   * @param {Parse.User} user - User object.
   * @returns {object} Privacy-compliant user data.
   * @example Get privacy-compliant data
   * const safeData = service.getPrivacyCompliantUserData(user);
   */
  getPrivacyCompliantUserData(user) {
    const userData = {
      id: user.id,
      email: user.get('isPrivateEmail') ? null : user.get('email'),
      firstName: user.get('firstName'),
      lastName: user.get('lastName'),
      isPrivateEmail: user.get('isPrivateEmail'),
      emailVerified: user.get('emailVerified'),
    };

    // Remove null/undefined values with allowlist security
    const allowedKeys = ['id', 'email', 'firstName', 'lastName', 'isPrivateEmail', 'emailVerified'];
    Object.keys(userData).forEach((key) => {
      // eslint-disable-next-line security/detect-object-injection
      if (!allowedKeys.includes(key) || userData[key] == null) {
        // eslint-disable-next-line security/detect-object-injection
        delete userData[key];
      }
    });

    return userData;
  }
}

module.exports = { AppleOAuthService };
