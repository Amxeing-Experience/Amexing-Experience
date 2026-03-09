/* eslint-disable no-unused-vars */
// IMPORTANT: Do NOT require 'parse/node' in cloud code files
// Parse Server provides Parse.Cloud automatically in cloud code context
// Requiring parse/node will override it with SDK version that doesn't have Cloud functions
const logger = require('../infrastructure/logger');

// Import models and services
const AmexingUser = require('../domain/models/AmexingUser');
// Greeter model removed - using Parse.Object.extend directly in controller
const AuthenticationService = require('../application/services/AuthenticationService');
const OAuthService = require('../application/services/OAuthService');

// Import cloud functions
const helloWorldFunction = require('./functions/helloWorld');
const testFunction = require('./functions/test');
const oauthAdminFunctions = require('./functions/oauth-admin');
const corporateLandingFunctions = require('./functions/corporate-landing');
const corporateSyncFunctions = require('./functions/corporate-sync');
const oauthPermissionsFunctions = require('./functions/oauth-permissions');
const departmentOAuthFunctions = require('./functions/department-oauth');
const appleOAuthFunctions = require('./functions/apple-oauth');
const vehicleRatePricesFunctions = require('./functions/vehicle-rate-prices');

// Import audit trail hooks
const { registerAuditHooks } = require('./hooks/auditTrailHooks');

/**
 * Registers all Parse Cloud Functions for the Amexing platform.
 * Centralizes the registration of OAuth authentication, corporate synchronization,
 * department management, and administrative functions with comprehensive error handling
 * and security logging for Parse Server integration.
 *
 * This function orchestrates the registration of all cloud functions including OAuth
 * admin operations, corporate landing configuration, sync management, permission
 * handling, department OAuth flows, and Apple authentication integration.
 * @function registerCloudFunctions
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', parameters);
 * // Returns: function result
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Register all cloud functions during Parse Server initialization
 * registerCloudFunctions();
 *
 * // Cloud functions become available via Parse SDK
 * const result = await Parse.Cloud.run('getAvailableCorporateDomains');
 * const oauthUrl = await Parse.Cloud.run('generateCorporateOAuthURL', { domain: 'example.com' });
 * const syncStatus = await Parse.Cloud.run('triggerCorporateSync', { domain: 'company.com' });
 * @returns {*} - Operation result.
 */
function registerCloudFunctions() {
  try {
    // Register Cloud Functions
    Parse.Cloud.define('hello', helloWorldFunction);
    Parse.Cloud.define('test', testFunction);

    // Register OAuth Admin Functions
    Parse.Cloud.define('getAvailableCorporateDomains', oauthAdminFunctions.getAvailableCorporateDomains);
    Parse.Cloud.define('addCorporateDomain', oauthAdminFunctions.addCorporateDomain);
    Parse.Cloud.define('getOAuthProviderStatus', oauthAdminFunctions.getOAuthProviderStatus);
    Parse.Cloud.define('testCorporateDomain', oauthAdminFunctions.testCorporateDomain);
    Parse.Cloud.define('getOAuthAuditLogs', oauthAdminFunctions.getOAuthAuditLogs);

    // Register Corporate Landing Functions
    Parse.Cloud.define('getCorporateLandingConfig', corporateLandingFunctions.getCorporateLandingConfig);
    Parse.Cloud.define('generateCorporateOAuthURL', corporateLandingFunctions.generateCorporateOAuthURL);
    Parse.Cloud.define('validateCorporateLandingAccess', corporateLandingFunctions.validateCorporateLandingAccess);
    Parse.Cloud.define('getCorporateClientDepartments', corporateLandingFunctions.getCorporateClientDepartments);

    // Register Corporate Sync Functions
    Parse.Cloud.define('triggerCorporateSync', corporateSyncFunctions.triggerCorporateSync);
    Parse.Cloud.define('startPeriodicSync', corporateSyncFunctions.startPeriodicSync);
    Parse.Cloud.define('stopPeriodicSync', corporateSyncFunctions.stopPeriodicSync);
    Parse.Cloud.define('getAllSyncStatuses', corporateSyncFunctions.getAllSyncStatuses);
    Parse.Cloud.define('getCorporateSyncHistory', corporateSyncFunctions.getCorporateSyncHistory);

    // Register OAuth Permissions Functions
    Parse.Cloud.define('getUserPermissionInheritance', oauthPermissionsFunctions.getUserPermissionInheritance);
    Parse.Cloud.define('getAvailableContexts', oauthPermissionsFunctions.getAvailableContexts);
    Parse.Cloud.define('switchPermissionContext', oauthPermissionsFunctions.switchPermissionContext);
    Parse.Cloud.define('createPermissionDelegation', oauthPermissionsFunctions.createPermissionDelegation);
    Parse.Cloud.define('revokePermissionDelegation', oauthPermissionsFunctions.revokePermissionDelegation);
    Parse.Cloud.define('createEmergencyElevation', oauthPermissionsFunctions.createEmergencyElevation);
    Parse.Cloud.define('createPermissionOverride', oauthPermissionsFunctions.createPermissionOverride);
    Parse.Cloud.define('checkUserPermission', oauthPermissionsFunctions.checkUserPermission);
    Parse.Cloud.define('getActiveDelegations', oauthPermissionsFunctions.getActiveDelegations);
    Parse.Cloud.define('getDelegatedPermissions', oauthPermissionsFunctions.getDelegatedPermissions);
    Parse.Cloud.define('getPermissionAuditReport', oauthPermissionsFunctions.getPermissionAuditReport);
    Parse.Cloud.define('getPermissionAuditStats', oauthPermissionsFunctions.getPermissionAuditStats);
    Parse.Cloud.define('getAvailablePermissions', oauthPermissionsFunctions.getAvailablePermissions);

    // Register Department OAuth Functions
    Parse.Cloud.define('getAvailableDepartments', departmentOAuthFunctions.getAvailableDepartments);
    Parse.Cloud.define('initiateDepartmentOAuth', departmentOAuthFunctions.initiateDepartmentOAuth);
    Parse.Cloud.define('handleDepartmentOAuthCallback', departmentOAuthFunctions.handleDepartmentOAuthCallback);
    Parse.Cloud.define('getDepartmentOAuthConfig', departmentOAuthFunctions.getDepartmentOAuthConfig);
    Parse.Cloud.define('switchToDepartmentContext', departmentOAuthFunctions.switchToDepartmentContext);
    Parse.Cloud.define('getDepartmentOAuthProviders', departmentOAuthFunctions.getDepartmentOAuthProviders);
    Parse.Cloud.define('validateDepartmentOAuthAccess', departmentOAuthFunctions.validateDepartmentOAuthAccess);
    Parse.Cloud.define('getDepartmentOAuthAnalytics', departmentOAuthFunctions.getDepartmentOAuthAnalytics);

    // Register Apple OAuth Functions
    Parse.Cloud.define('initiateAppleOAuth', appleOAuthFunctions.initiateAppleOAuth);
    Parse.Cloud.define('handleAppleOAuthCallback', appleOAuthFunctions.handleAppleOAuthCallback);
    Parse.Cloud.define('getAppleOAuthConfig', appleOAuthFunctions.getAppleOAuthConfig);
    Parse.Cloud.define('revokeAppleOAuth', appleOAuthFunctions.revokeAppleOAuth);
    Parse.Cloud.define('handleAppleWebhook', appleOAuthFunctions.handleAppleWebhook);
    Parse.Cloud.define('getAppleUserData', appleOAuthFunctions.getAppleUserData);
    Parse.Cloud.define('validateAppleDomain', appleOAuthFunctions.validateAppleDomain);
    Parse.Cloud.define('getAppleOAuthAnalytics', appleOAuthFunctions.getAppleOAuthAnalytics);

    // Authentication Cloud Functions
    /**
     * Creates a session token for an AmexingUser by user ID.
     * Used for authentication after password validation to establish a Parse session.
     * @function createSessionForUser
     * @param {Parse.Cloud.FunctionRequest} request - The Parse Cloud function request object.
     * @returns {Promise<string>} - Promise resolving to the session token string.
     * @throws {Parse.Error} - Throws error if user not found or session creation fails.
     * @example
     * // Call from authController
     * const sessionToken = await Parse.Cloud.run('createSessionForUser', { userId: 'abc123' });
     */
    Parse.Cloud.define('createSessionForUser', async (request) => {
      const { params } = request;
      const { userId } = params;

      try {
        if (!userId) {
          throw new Parse.Error(Parse.Error.INVALID_QUERY, 'User ID is required');
        }

        // Query AmexingUser to get the user
        const userQuery = new Parse.Query('AmexingUser');
        userQuery.equalTo('objectId', userId);
        userQuery.equalTo('active', true);
        userQuery.equalTo('exists', true);

        const user = await userQuery.first({ useMasterKey: true });

        if (!user) {
          throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found or inactive');
        }

        // Create a new session for this user
        const sessionData = {
          user: {
            __type: 'Pointer',
            className: 'AmexingUser',
            objectId: userId,
          },
          createdWith: {
            action: 'login',
            authProvider: 'password',
          },
          restricted: false,
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
        };

        const Session = Parse.Object.extend('_Session');
        const session = new Session();
        session.set('user', sessionData.user);
        session.set('createdWith', sessionData.createdWith);
        session.set('restricted', sessionData.restricted);
        session.set('expiresAt', sessionData.expiresAt);

        await session.save(null, { useMasterKey: true });

        logger.info('Session created for AmexingUser', {
          userId,
          sessionToken: session.get('sessionToken'),
        });

        return session.get('sessionToken');
      } catch (error) {
        logger.error('Error creating session for user', {
          userId,
          error: error.message,
        });
        throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, `Failed to create session: ${error.message}`);
      }
    });

    /**
     * Retrieves user information by user ID with role-based access control.
     * SuperAdmin and Admin roles can access any user, while other users can only access their own data.
     * @function getUserById
     * @param {Parse.Cloud.FunctionRequest} request - The Parse Cloud function request object.
     * @returns {Promise<object>} - Promise resolving to sanitized user data including id, username, email, role, and timestamps.
     * @example
     * // Call from client
     * const userData = await Parse.Cloud.run('getUserById', { userId: 'abc123' });
     */
    Parse.Cloud.define('getUserById', async (request) => {
      const { params, user } = request;
      const { userId } = params;

      try {
        // Allow superadmin/admin to get any user, others can only get their own
        if (user && (user.get('role') === 'superadmin' || user.get('role') === 'admin' || user.id === userId)) {
          // Query AmexingUser (all users are stored in AmexingUser table)
          const AmexingUserQuery = new Parse.Query('AmexingUser');
          AmexingUserQuery.equalTo('objectId', userId);
          AmexingUserQuery.equalTo('exists', true);

          const foundUser = await AmexingUserQuery.first({ useMasterKey: true });

          if (!foundUser) {
            throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found');
          }

          // Return sanitized user data
          return {
            id: foundUser.id,
            username: foundUser.get('username'),
            email: foundUser.get('email'),
            firstName: foundUser.get('firstName'),
            lastName: foundUser.get('lastName'),
            role: foundUser.get('role') || 'user',
            displayName: foundUser.get('displayName') || `${foundUser.get('firstName')} ${foundUser.get('lastName')}`,
            isActive: foundUser.get('isActive') !== false,
            emailVerified: foundUser.get('emailVerified') === true,
            lastLoginAt: foundUser.get('lastLoginAt'),
            createdAt: foundUser.get('createdAt'),
            updatedAt: foundUser.get('updatedAt'),
          };
        }
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Not authorized to access user data');
      } catch (error) {
        logger.error('Get user by ID error:', error);
        throw error;
      }
    });

    /**
     * Registers a new user account with the provided credentials and profile information.
     * Logs the registration attempt and delegates to AuthenticationService for processing.
     * @function registerUser
     * @param {Parse.Cloud.FunctionRequest} request - The Parse Cloud function request object.
     * @returns {Promise<object>} - Promise resolving to registration result with user data and tokens.
     * @example
     * // Call from client
     * const result = await Parse.Cloud.run('registerUser', {
     *   username: 'johndoe',
     *   email: 'john@example.com',
     *   password: 'user-password',
     *   firstName: 'John',
     *   lastName: 'Doe'
     * });
     */
    Parse.Cloud.define('registerUser', async (request) => {
      const { params, ip } = request;

      try {
        logger.info(`User registration attempt from IP: ${ip}`);

        const result = await AuthenticationService.registerUser(params);

        return result;
      } catch (error) {
        logger.error('Registration cloud function error:', error);
        throw error;
      }
    });

    /**
     * Authenticates a user with username/email and password credentials.
     * Logs the login attempt and delegates to AuthenticationService for validation.
     * @function loginUser
     * @param {Parse.Cloud.FunctionRequest} request - The Parse Cloud function request object.
     * @returns {Promise<object>} - Promise resolving to authentication result with user data and tokens.
     * @example
     * // Call from client
     * const result = await Parse.Cloud.run('loginUser', {
     *   identifier: 'johndoe',
     *   password: 'user-password'
     * });
     */
    Parse.Cloud.define('loginUser', async (request) => {
      const { params, ip } = request;
      const { identifier, password } = params;

      try {
        logger.info(`Login attempt for ${identifier} from IP: ${ip}`);

        const result = await AuthenticationService.loginUser(identifier, password);

        return result;
      } catch (error) {
        logger.error('Login cloud function error:', error);
        throw error;
      }
    });

    /**
     * Refreshes an expired access token using a valid refresh token.
     * Validates the refresh token and issues new access and refresh tokens.
     * @function refreshToken
     * @param {Parse.Cloud.FunctionRequest} request - The Parse Cloud function request object.
     * @returns {Promise<object>} - Promise resolving to new token pair.
     * @example
     * // Call from client
     * const result = await Parse.Cloud.run('refreshToken', {
     *   refreshToken: 'eyJhbGciOiJIUzI1NiIs...'
     * });
     */
    Parse.Cloud.define('refreshToken', async (request) => {
      const { params } = request;
      const { refreshToken } = params;

      try {
        const result = await AuthenticationService.refreshToken(refreshToken);
        return result;
      } catch (error) {
        logger.error('Token refresh cloud function error:', error);
        throw error;
      }
    });

    /**
     * Changes the password for an authenticated user.
     * Requires current password verification before allowing password change.
     * @function changePassword
     * @param {Parse.Cloud.FunctionRequest} request - The Parse Cloud function request object.
     * @returns {Promise<object>} - Promise resolving to password change result.
     * @example
     * // Call from client
     * const result = await Parse.Cloud.run('changePassword', {
     *   currentPassword: 'OldPass123',
     *   newPassword: 'NewPass456'
     * });
     */
    Parse.Cloud.define('changePassword', async (request) => {
      const { params, user } = request;
      const { currentPassword, newPassword } = params;

      if (!user) {
        throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Authentication required');
      }

      try {
        const result = await AuthenticationService.changePassword(user.id, currentPassword, newPassword);
        return result;
      } catch (error) {
        logger.error('Password change cloud function error:', error);
        throw error;
      }
    });

    /**
     * Initiates a password reset process by sending a reset token to the user's email.
     * Generates a secure reset token and sends password reset instructions.
     * @function initiatePasswordReset
     * @param {Parse.Cloud.FunctionRequest} request - The Parse Cloud function request object.
     * @returns {Promise<object>} - Promise resolving to password reset initiation result.
     * @example
     * // Call from client
     * const result = await Parse.Cloud.run('initiatePasswordReset', {
     *   email: 'john@example.com'
     * });
     */
    Parse.Cloud.define('initiatePasswordReset', async (request) => {
      const { params } = request;
      const { email } = params;

      try {
        const result = await AuthenticationService.initiatePasswordReset(email);
        return result;
      } catch (error) {
        logger.error('Password reset initiation error:', error);
        throw error;
      }
    });

    /**
     * Completes the password reset process using a valid reset token.
     * Validates the reset token and updates the user's password.
     * @function resetPassword
     * @param {Parse.Cloud.FunctionRequest} request - The Parse Cloud function request object.
     * @returns {Promise<object>} - Promise resolving to password reset result.
     * @example
     * // Call from client
     * const result = await Parse.Cloud.run('resetPassword', {
     *   resetToken: 'abc123xyz',
     *   newPassword: 'NewSecurePass789'
     * });
     */
    Parse.Cloud.define('resetPassword', async (request) => {
      const { params } = request;
      const { resetToken, newPassword } = params;

      try {
        const result = await AuthenticationService.resetPassword(resetToken, newPassword);
        return result;
      } catch (error) {
        logger.error('Password reset error:', error);
        throw error;
      }
    });

    // OAuth Cloud Functions
    /**
     * Generates an OAuth authorization URL for the specified provider.
     * Creates a secure authorization URL with state parameter for CSRF protection.
     * @function generateOAuthUrl
     * @param {Parse.Cloud.FunctionRequest} request - The Parse Cloud function request object.
     * @returns {Promise<object>} - Promise resolving to object containing the OAuth authorization URL.
     * @example
     * // Call from client
     * const result = await Parse.Cloud.run('generateOAuthUrl', {
     *   _provider: 'google',
     *   state: 'random_state_string'
     * });
     */
    Parse.Cloud.define('generateOAuthUrl', async (request) => {
      const { params } = request;
      const { _provider, state } = params;

      try {
        const authUrl = await OAuthService.generateAuthorizationUrl(_provider, state);
        return { authUrl };
      } catch (error) {
        logger.error('OAuth URL generation error:', error);
        throw error;
      }
    });

    /**
     * Handles the OAuth callback from the provider after user authorization.
     * Exchanges authorization code for tokens and creates or links user account.
     * @function handleOAuthCallback
     * @param {Parse.Cloud.FunctionRequest} request - The Parse Cloud function request object.
     * @returns {Promise<object>} - Promise resolving to authentication result with user data and tokens.
     * @example
     * // Call from client
     * const result = await Parse.Cloud.run('handleOAuthCallback', {
     *   _provider: 'google',
     *   code: 'authorization_code',
     *   state: 'random_state_string'
     * });
     */
    Parse.Cloud.define('handleOAuthCallback', async (request) => {
      const { params, ip } = request;
      const { _provider, code, state } = params;

      try {
        logger.info(`OAuth ${_provider} callback from IP: ${ip}`);

        const result = await OAuthService.handleCallback(_provider, code, state);
        return result;
      } catch (error) {
        logger.error('OAuth callback error:', error);
        throw error;
      }
    });

    /**
     * Links an OAuth account to an existing authenticated user.
     * Requires active user session and adds OAuth provider to user's linked accounts.
     * @function linkOAuthAccount
     * @param {Parse.Cloud.FunctionRequest} request - The Parse Cloud function request object.
     * @returns {Promise<object>} - Promise resolving to OAuth account linking result.
     * @example
     * // Call from client (requires authentication)
     * const result = await Parse.Cloud.run('linkOAuthAccount', {
     *   _provider: 'google',
     *   oauthData: { providerId: '123456', accessToken: 'token' }
     * });
     */
    Parse.Cloud.define('linkOAuthAccount', async (request) => {
      const { params, user } = request;
      const { _provider, oauthData } = params;

      if (!user) {
        throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Authentication required');
      }

      try {
        const result = await OAuthService.linkOAuthAccount(user.id, _provider, oauthData);
        return result;
      } catch (error) {
        logger.error('OAuth account linking error:', error);
        throw error;
      }
    });

    /**
     * Unlinks an OAuth account from the authenticated user.
     * Requires active user session and removes OAuth provider from user's linked accounts.
     * @function unlinkOAuthAccount
     * @param {Parse.Cloud.FunctionRequest} request - The Parse Cloud function request object.
     * @returns {Promise<object>} - Promise resolving to OAuth account unlinking result.
     * @example
     * // Call from client (requires authentication)
     * const result = await Parse.Cloud.run('unlinkOAuthAccount', {
     *   _provider: 'google'
     * });
     */
    Parse.Cloud.define('unlinkOAuthAccount', async (request) => {
      const { params, user } = request;
      const { _provider } = params;

      if (!user) {
        throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Authentication required');
      }

      try {
        const result = await OAuthService.unlinkOAuthAccount(user.id, _provider);
        return result;
      } catch (error) {
        logger.error('OAuth account unlinking error:', error);
        throw error;
      }
    });

    /**
     * Retrieves the list of available OAuth providers and their configurations.
     * Returns provider information including supported authentication methods.
     * @function getOAuthProviders
     * @param {Parse.Cloud.FunctionRequest} request - The Parse Cloud function request object.
     * @returns {Promise<object>} - Promise resolving to object containing array of provider configurations.
     * @example
     * // Call from client
     * const result = await Parse.Cloud.run('getOAuthProviders');
     * // Returns: { providers: [{ name: 'google', ... }, { name: 'apple', ... }] }
     */
    Parse.Cloud.define('getOAuthProviders', async (request) => {
      try {
        const providers = OAuthService.getAvailableProviders();
        const providerConfigs = providers.map((_provider) => OAuthService.getProviderConfig(_provider));

        return { providers: providerConfigs };
      } catch (error) {
        // Check if error is due to OAuthService initialization
        if (error.message && (error.message.includes('not initialized') || error.message.includes('initialization'))) {
          // Use debug logging for initialization-related errors (expected during startup)
          logger.debug('getOAuthProviders called during OAuthService initialization', {
            error: error.message,
            timestamp: new Date().toISOString(),
            phase: 'startup',
          });

          // Return empty providers gracefully during initialization
          return { providers: [] };
        }

        // For other errors, use error logging (unexpected runtime errors)
        logger.error('Get OAuth providers error:', error);
        throw error;
      }
    });

    // AmexingUser Triggers
    /**
     * BeforeSave trigger for AmexingUser that validates and normalizes user data before persistence.
     * Enforces required fields, validates email and username formats, sets lifecycle defaults,
     * and logs security events for user registration and updates.
     * @function beforeSaveAmexingUser
     * @param {Parse.Cloud.TriggerRequest} request - The Parse Cloud trigger request object.
     * @returns {Promise<void>} - Promise that resolves when validation is complete.
     */
    // DISABLED: Email validation moved to audit trail hooks
    /*
    Parse.Cloud.beforeSave('AmexingUser', async (request) => {
      const { object: user, master } = request;

      logger.info('🔍 CUSTOM AmexingUser beforeSave hook triggered!', {
        userId: user.id,
        useMasterKey: master,
        existed: user.existed()
      });

      // EMAIL UNIQUENESS VALIDATION (runs even with masterKey for data integrity)
      const email = user.get('email');
      if (email) {
        // Validate email format first
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Invalid email format');
        }

        // Trim and lowercase email for consistent validation
        const normalizedEmail = email.trim().toLowerCase();
        user.set('email', normalizedEmail);

        // Check if email is being changed
        const isCreating = !user.existed();
        const originalEmail = request.original ? request.original.get('email') : null;
        const isEmailChanged = isCreating || (originalEmail !== normalizedEmail);

        logger.info('AmexingUser email validation check', {
          userId: user.id,
          email: `${normalizedEmail.substring(0, 3)}***`,
          isCreating,
          originalEmail: originalEmail ? `${originalEmail.substring(0, 3)}***` : null,
          isEmailChanged,
          useMasterKey: master
        });

        if (isEmailChanged) {
          // Query for existing users with this email
          const query = new Parse.Query(AmexingUser);
          query.equalTo('email', normalizedEmail);
          query.equalTo('exists', true); // Only check active users
          if (!isCreating && user.id) {
            query.notEqualTo('objectId', user.id);
          }
          query.limit(1);

          const existingUser = await query.first({ useMasterKey: true });

          logger.info('Email uniqueness check result', {
            email: `${normalizedEmail.substring(0, 3)}***`,
            foundExisting: !!existingUser,
            existingUserId: existingUser?.id
          });

          if (existingUser) {
            logger.logSecurityEvent('DUPLICATE_EMAIL_ATTEMPT', {
              email: `${normalizedEmail.substring(0, 3)}***`,
              attemptedUserId: user.id,
              existingUserId: existingUser.id,
              isCreating,
            });
            throw new Parse.Error(
              Parse.Error.DUPLICATE_VALUE,
              'Email address is already registered. Please use a different email or contact support.'
            );
          }
        }
      }

      // Skip remaining validation for master key requests
      if (master) {
        return;
      }

      // Set default values for new users
      if (!user.existed()) {
        // Set createdAt and updatedAt if not set
        if (!user.get('createdAt')) {
          user.set('createdAt', new Date());
        }
        user.set('updatedAt', new Date());

        // Set lifecycle defaults for new users (moved from BaseModel constructor)
        if (user.get('active') === undefined) {
          user.set('active', true);
        }
        if (user.get('exists') === undefined) {
          user.set('exists', true);
        }

        // Log user registration
        logger.logSecurityEvent('AMEXING_USER_REGISTRATION', {
          username: user.get('username'),
          email: user.get('email') ? `${user.get('email').substring(0, 3)}***` : undefined,
          role: user.get('role'),
          authMethod: user.get('primaryOAuthProvider') || 'password',
        });
      } else {
        // Update the updatedAt field
        user.set('updatedAt', new Date());

        logger.logSecurityEvent('AMEXING_USER_UPDATE', {
          userId: user.id,
          username: user.get('username'),
        });
      }

      // Validate required fields
      const requiredFields = ['username', 'email', 'firstName', 'lastName', 'role'];
      for (const field of requiredFields) {
        if (!user.get(field)) {
          throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${field} is required`);
        }
      }

      // Email format validation and normalization is already handled in the EMAIL UNIQUENESS VALIDATION section above

      // Validate username format
      const username = user.get('username');
      if (username) {
        const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
        if (!usernameRegex.test(username)) {
          throw new Parse.Error(
            Parse.Error.VALIDATION_ERROR,
            'Username must be 3-20 characters, alphanumeric and underscores only'
          );
        }
        // Normalize username to lowercase
        user.set('username', username.toLowerCase());
      }

      // Validate role
      const validRoles = ['user', 'client', 'employee', 'admin', 'superadmin'];
      const role = user.get('role');
      if (role && !validRoles.includes(role)) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `Invalid role. Must be one of: ${validRoles.join(', ')}`);
      }

      // Validate OAuth accounts format
      const oauthAccounts = user.get('oauthAccounts');
      if (oauthAccounts && Array.isArray(oauthAccounts)) {
        for (const account of oauthAccounts) {
          if (!account.provider || !account.providerId) {
            throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'OAuth accounts must have provider and providerId');
          }
        }
      }
    });
    */ // END DISABLED AmexingUser beforeSave hook

    /**
     * AfterSave trigger for AmexingUser that performs post-save operations.
     * Logs new user creation and can be extended for additional setup tasks.
     * @function afterSaveAmexingUser
     * @param {Parse.Cloud.TriggerRequest} request - The Parse Cloud trigger request object.
     * @returns {Promise<void>} - Promise that resolves when post-save operations are complete.
     */
    Parse.Cloud.afterSave(AmexingUser, async (request) => {
      const { object: user } = request;

      if (!user.existed()) {
        logger.info(`New AmexingUser created: ${user.id} (${user.get('username')})`);

        // Initialize any additional setup for new users
        // This could include creating related objects, sending welcome emails, etc.
      }
    });

    /**
     * BeforeDelete trigger for AmexingUser that enforces deletion security.
     * Requires master key for deletion and logs security event for audit trail.
     * @function beforeDeleteAmexingUser
     * @param {Parse.Cloud.TriggerRequest} request - The Parse Cloud trigger request object.
     * @returns {Promise<void>} - Promise that resolves when deletion validation is complete.
     */
    Parse.Cloud.beforeDelete(AmexingUser, async (request) => {
      const { object: user, master } = request;

      // Only allow user deletion with master key
      if (!master) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'AmexingUser can only be deleted with master key');
      }

      logger.logSecurityEvent('AMEXING_USER_DELETION', {
        userId: user.id,
        username: user.get('username'),
        email: user.get('email') ? `${user.get('email').substring(0, 3)}***` : undefined,
      });
    });

    // Legacy Parse.User triggers (for backward compatibility if needed)
    /**
     * BeforeSave trigger for legacy Parse.User that provides basic validation.
     * Validates required fields and email format, logs security events for backward compatibility.
     * @function beforeSaveParseUser
     * @param {Parse.Cloud.TriggerRequest} request - The Parse Cloud trigger request object.
     * @returns {Promise<void>} - Promise that resolves when validation is complete.
     */
    // DISABLED: Email validation moved to audit trail hooks
    /*
    Parse.Cloud.beforeSave(Parse.User, async (request) => {
      const { object: user, master } = request;

      // EMAIL UNIQUENESS VALIDATION (runs even with masterKey for data integrity)
      const email = user.get('email');
      if (email) {
        // Trim and lowercase email for consistent validation
        const normalizedEmail = email.trim().toLowerCase();
        user.set('email', normalizedEmail);

        // Check if email is being changed
        const isCreating = !user.existed();
        const isEmailChanged = isCreating || (request.original && request.original.get('email') !== normalizedEmail);

        if (isEmailChanged) {
          // Query for existing users with this email
          const query = new Parse.Query(Parse.User);
          query.equalTo('email', normalizedEmail);
          if (!isCreating && user.id) {
            query.notEqualTo('objectId', user.id);
          }
          query.limit(1);

          const existingUser = await query.first({ useMasterKey: true });
          if (existingUser) {
            logger.warn('Duplicate email attempt detected', {
              attemptedEmail: normalizedEmail,
              existingUserId: existingUser.id,
              attemptedBy: request.user?.id || 'unauthenticated',
              isCreating,
            });

            throw new Parse.Error(
              Parse.Error.DUPLICATE_VALUE,
              'Email address is already registered. Please use a different email or contact support.'
            );
          }
        }
      }

      // Skip remaining validation for master key requests (non-critical validations)
      if (master) {
        return;
      }

      // Log legacy user operations
      if (!user.existed()) {
        logger.logSecurityEvent('LEGACY_USER_REGISTRATION', {
          username: user.get('username'),
          email: user.get('email') ? `${user.get('email').substring(0, 3)}***` : undefined,
        });
      }

      // Basic validation for legacy users
      if (!user.get('username')) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Username is required');
      }

      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Invalid email format');
        }
      }
    });
    */ // END DISABLED Parse.User beforeSave hook

    // After Save Triggers
    /**
     * AfterSave trigger for legacy Parse.User that performs post-save operations.
     * Logs new user creation and can be extended for profile initialization.
     * @function afterSaveParseUser
     * @param {Parse.Cloud.TriggerRequest} request - The Parse Cloud trigger request object.
     * @returns {Promise<void>} - Promise that resolves when post-save operations are complete.
     */
    Parse.Cloud.afterSave(Parse.User, async (request) => {
      const { object: user } = request;

      if (!user.existed()) {
        logger.info(`New user created: ${user.id}`);

        // Initialize user profile or perform other setup tasks
        // This is where you might create related objects, send welcome emails, etc.
      }
    });

    // Before Delete Triggers
    /**
     * BeforeDelete trigger for legacy Parse.User that enforces deletion security.
     * Requires master key for deletion and logs security event for audit trail.
     * @function beforeDeleteParseUser
     * @param {Parse.Cloud.TriggerRequest} request - The Parse Cloud trigger request object.
     * @returns {Promise<void>} - Promise that resolves when deletion validation is complete.
     */
    Parse.Cloud.beforeDelete(Parse.User, async (request) => {
      const { object: user, master } = request;

      // Only allow user deletion with master key
      if (!master) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Users can only be deleted with master key');
      }

      logger.logSecurityEvent('USER_DELETION', {
        userId: user.id,
        username: user.get('username'),
      });
    });

    // After Login Trigger
    /**
     * AfterLogin trigger that logs successful login attempts and updates user metadata.
     * Records access attempt in audit log and updates lastLoginAt timestamp.
     * @function afterLogin
     * @param {Parse.Cloud.TriggerRequest} request - The Parse Cloud trigger request object.
     * @returns {Promise<void>} - Promise that resolves when post-login operations are complete.
     */
    Parse.Cloud.afterLogin(async (request) => {
      const { object: user } = request;

      logger.logAccessAttempt(true, user.get('username'), request.ip);

      // Update last login timestamp
      user.set('lastLoginAt', new Date());
      await user.save(null, { useMasterKey: true });
    });

    // After Logout Trigger
    /**
     * AfterLogout trigger that logs user logout events for security audit.
     * Records session termination in security event log.
     * @function afterLogout
     * @param {Parse.Cloud.TriggerRequest} request - The Parse Cloud trigger request object.
     * @returns {Promise<void>} - Promise that resolves when post-logout operations are complete.
     */
    Parse.Cloud.afterLogout(async (request) => {
      const { object: session } = request;

      logger.logSecurityEvent('USER_LOGOUT', {
        sessionToken: `${session.get('sessionToken').substring(0, 8)}***`,
      });
    });

    // Test Data Creation Function
    /**
     * Cloud function to create test Services data for development.
     * Creates aeropuerto services with various POIs and vehicle types.
     * @function createTestServicesData
     * @param {Parse.Cloud.FunctionRequest} request - The Parse Cloud function request object.
     * @returns {Promise<object>} - Promise resolving to creation result with statistics.
     */
    Parse.Cloud.define('createTestServicesData', async (request) => {
      try {
        logger.info('Creating test Services data...');

        // Check if Services table already has data
        const ServicesClass = Parse.Object.extend('Services');
        const existingQuery = new Parse.Query(ServicesClass);
        existingQuery.equalTo('exists', true);
        const existingCount = await existingQuery.count({ useMasterKey: true });

        if (existingCount > 0) {
          logger.info(`Services table already has ${existingCount} records`);
          return { success: true, message: `Already exists: ${existingCount} services`, created: 0 };
        }

        // Get ServiceType for Aeropuerto
        const ServiceTypeClass = Parse.Object.extend('ServiceType');
        const serviceTypeQuery = new Parse.Query(ServiceTypeClass);
        serviceTypeQuery.equalTo('name', 'Aeropuerto');
        const aeropuertoServiceType = await serviceTypeQuery.first({ useMasterKey: true });

        if (!aeropuertoServiceType) {
          throw new Error('No Aeropuerto ServiceType found');
        }

        // Get aeropuerto POIs
        const POIClass = Parse.Object.extend('POI');
        const poisQuery = new Parse.Query(POIClass);
        poisQuery.equalTo('serviceType', aeropuertoServiceType);
        poisQuery.equalTo('exists', true);
        const aeropuertoPOIs = await poisQuery.find({ useMasterKey: true });

        // Get vehicle types
        const VehicleTypeClass = Parse.Object.extend('VehicleType');
        const vehicleTypesQuery = new Parse.Query(VehicleTypeClass);
        vehicleTypesQuery.equalTo('exists', true);
        const vehicleTypes = await vehicleTypesQuery.find({ useMasterKey: true });

        if (aeropuertoPOIs.length === 0 || vehicleTypes.length === 0) {
          throw new Error(`Insufficient data: POIs=${aeropuertoPOIs.length}, VehicleTypes=${vehicleTypes.length}`);
        }

        logger.info(`Found ${aeropuertoPOIs.length} aeropuerto POIs, ${vehicleTypes.length} vehicle types`);

        // Create test services
        const servicesToCreate = [];
        let count = 0;

        // Create services between different POIs
        for (let i = 0; i < Math.min(3, aeropuertoPOIs.length); i++) {
          for (let j = i + 1; j < Math.min(4, aeropuertoPOIs.length); j++) {
            for (let k = 0; k < Math.min(2, vehicleTypes.length); k++) {
              if (count >= 15) break; // Limit to 15 services

              const service = new ServicesClass();
              service.set('originPOI', aeropuertoPOIs[i]);
              service.set('destinationPOI', aeropuertoPOIs[j]);
              service.set('vehicleType', vehicleTypes[k]);
              service.set(
                'note',
                `Test service ${count + 1}: ${aeropuertoPOIs[i].get('name')} → ${aeropuertoPOIs[j].get('name')}`
              );
              service.set('active', true);
              service.set('exists', true);

              servicesToCreate.push(service);
              count++;
            }
          }
        }

        // Also create some services without originPOI (return trips)
        for (let i = 0; i < Math.min(2, aeropuertoPOIs.length); i++) {
          for (let k = 0; k < Math.min(1, vehicleTypes.length); k++) {
            if (count >= 20) break;

            const service = new ServicesClass();
            // No originPOI for return trips
            service.set('destinationPOI', aeropuertoPOIs[i]);
            service.set('vehicleType', vehicleTypes[k]);
            service.set('note', `Return trip to ${aeropuertoPOIs[i].get('name')}`);
            service.set('active', true);
            service.set('exists', true);

            servicesToCreate.push(service);
            count++;
          }
        }

        // Save all services
        logger.info(`Saving ${servicesToCreate.length} test services...`);
        await Parse.Object.saveAll(servicesToCreate, { useMasterKey: true });

        logger.info(`✅ Created ${servicesToCreate.length} test Services records!`);

        return {
          success: true,
          created: servicesToCreate.length,
          message: `Created ${servicesToCreate.length} test services`,
        };
      } catch (error) {
        logger.error('Error creating test Services data:', error);
        throw new Parse.Error(Parse.Error.SCRIPT_FAILED, `Failed to create test data: ${error.message}`);
      }
    });

    // Job Functions (Scheduled Tasks)
    /**
     * Scheduled job that cleans up expired Parse sessions from the database.
     * Queries for sessions past their expiration date and removes them to maintain database hygiene.
     * @function cleanupExpiredSessions
     * @param {Parse.Cloud.JobRequest} request - The Parse Cloud job request object.
     * @returns {Promise<object>} - Promise resolving to cleanup result with success status and deleted count.
     * @example
     * // Schedule this job in Parse Dashboard or via command line
     * // Returns: { success: true, deletedCount: 42 }
     */
    Parse.Cloud.job('cleanupExpiredSessions', async (request) => {
      const { message } = request;
      message('Starting expired sessions cleanup...');

      try {
        const Session = Parse.Object.extend('_Session');
        const query = new Parse.Query(Session);
        query.lessThan('expiresAt', new Date());

        const expiredSessions = await query.find({ useMasterKey: true });

        if (expiredSessions.length > 0) {
          await Parse.Object.destroyAll(expiredSessions, {
            useMasterKey: true,
          });
          message(`Deleted ${expiredSessions.length} expired sessions`);
          logger.info(`Cleanup job: Deleted ${expiredSessions.length} expired sessions`);
        } else {
          message('No expired sessions found');
        }

        return { success: true, deletedCount: expiredSessions.length };
      } catch (error) {
        logger.error('Error in cleanup job:', error);
        throw error;
      }
    });

    // =================
    // INFLATION MANAGEMENT SYSTEM
    // =================

    // Extract job logic into a separate function for direct calling
    /**
     * Background job to apply inflation to price records.
     * Processes RatePrices, TourPrices, and ClientPrices records in batches.
     * @function aplicarInflacionJob
     * @param {object} request - Job request containing params and message functions.
     * @returns {Promise<object>} - Job result with processing statistics.
     * @example
     */
    const aplicarInflacionJob = async function (request) {
      const { params, message } = request;
      const { percentage, batchId } = params;

      logger.info('Inflation job started', { percentage, batchId });

      if (!percentage || !batchId) {
        throw new Error('Missing required parameters: percentage and batchId');
      }

      message(`Starting inflation application: ${percentage}% (Batch: ${batchId})`);
      logger.info('Inflation job started', { percentage, batchId });

      let totalProcessed = 0;
      let totalErrors = 0;
      let totalSkipped = 0;
      const now = new Date();

      try {
        // Update InflationHistory status to RUNNING
        const InflationHistory = Parse.Object.extend('InflationHistory');
        const historyQuery = new Parse.Query(InflationHistory);
        historyQuery.equalTo('batch_id', batchId);
        const historyRecord = await historyQuery.first({ useMasterKey: true });

        if (!historyRecord) {
          throw new Error(`InflationHistory record not found for batchId: ${batchId}`);
        }

        historyRecord.set('status', 'RUNNING');
        historyRecord.set('startedAt', now);
        await historyRecord.save(null, { useMasterKey: true });

        // IMPROVEMENT 1: Check for existing inflation processes
        logger.info('Checking for existing inflation processes...', { batchId });

        // Check if there are any other running inflation processes
        const runningInflationQuery = new Parse.Query(InflationHistory);
        runningInflationQuery.equalTo('status', 'RUNNING');
        runningInflationQuery.notEqualTo('batch_id', batchId);
        const runningProcesses = await runningInflationQuery.find({ useMasterKey: true });

        if (runningProcesses.length > 0) {
          const errorMessage = `Cannot start inflation: ${runningProcesses.length} other process(es) still running`;
          logger.error(errorMessage, { batchId, runningBatches: runningProcesses.map((p) => p.get('batch_id')) });
          throw new Error(errorMessage);
        }

        // Process each class with correct table names - TESTING: RatePrices + TourPrices
        const classesToProcess = ['RatePrices', 'TourPrices', 'ClientPrices', 'Experience']; // All price tables plus Experience

        for (const className of classesToProcess) {
          try {
            message(`Processing ${className} records...`);
            logger.info(`Inflation job: Starting processing for ${className}`, { batchId, percentage });

            const ClassObj = Parse.Object.extend(className);
            const query = new Parse.Query(ClassObj);
            query.equalTo('active', true);
            query.equalTo('exists', true);
            query.doesNotExist('valid_until'); // Don't process historical records
            // Removed: query.doesNotExist('inflation_batch_id') - Allow re-inflation of current records

            // Include required relations based on table type
            if (className === 'RatePrices') {
              query.include(['service', 'rate', 'vehicleType']);
            } else if (className === 'TourPrices') {
              query.include(['ratePtr', 'vehicleType', 'tourPtr']);
            } else if (className === 'ClientPrices') {
              query.include(['ratePtr', 'vehiclePtr', 'clientPtr']);
            } else if (className === 'Experience') {
              query.include(['experiences', 'tours', 'vehicleType']);
            }
            // Note: Cannot use limit() with eachBatch()
            // query.limit(100);

            // Debug: Check how many records match the query
            const totalMatchingRecords = await query.count({ useMasterKey: true });
            message(`Found ${totalMatchingRecords} ${className} records ready for inflation`);
            logger.info(`Inflation job: Query found ${totalMatchingRecords} records for ${className}`, {
              batchId,
              className,
            });

            if (totalMatchingRecords === 0) {
              message(`No records found for ${className} - skipping`);
              continue; // eslint-disable-line no-continue
            }

            let batchCount = 0;

            // Process batches with proper error handling
            try {
              await query.eachBatch(
                // eslint-disable-next-line no-loop-func
                async (records) => {
                  batchCount++;
                  logger.info(`Processing ${className} batch ${batchCount} with ${records.length} records`, {
                    batchId,
                  });
                  message(`Processing ${className} batch ${batchCount} (${records.length} records)`);

                  const recordsToSave = [];
                  const recordsToUpdate = [];

                  // Process each record in the batch
                  for (const record of records) {
                    try {
                      // Extract relationships based on table type
                      let service;
                      let rate;
                      let vehicleType;

                      if (className === 'RatePrices') {
                        service = record.get('service');
                        rate = record.get('rate');
                        vehicleType = record.get('vehicleType');

                        // Validate required relationships for RatePrices
                        if (!service || !rate || !vehicleType) {
                          logger.warn(`Skipping ${className} record with missing relationships`, {
                            recordId: record.id,
                            className,
                            hasService: !!service,
                            hasRate: !!rate,
                            hasVehicleType: !!vehicleType,
                          });
                          totalSkipped++;
                          continue; // eslint-disable-line no-continue
                        }
                      } else if (className === 'TourPrices') {
                        // TourPrices uses different field names
                        rate = record.get('ratePtr');
                        vehicleType = record.get('vehicleType');
                        service = record.get('tourPtr');

                        // Validate required relationships for TourPrices
                        if (!rate || !vehicleType) {
                          logger.warn(`Skipping ${className} record with missing relationships`, {
                            recordId: record.id,
                            className,
                            hasRate: !!rate,
                            hasVehicleType: !!vehicleType,
                          });
                          totalSkipped++;
                          continue; // eslint-disable-line no-continue
                        }
                      } else if (className === 'ClientPrices') {
                        // ClientPrices uses different field names
                        rate = record.get('ratePtr');
                        vehicleType = record.get('vehiclePtr');
                        service = record.get('clientPtr');

                        // Validate required relationships for ClientPrices
                        if (!rate || !vehicleType) {
                          logger.warn(`Skipping ${className} record with missing relationships`, {
                            recordId: record.id,
                            className,
                            hasRate: !!rate,
                            hasVehicleType: !!vehicleType,
                          });
                          totalSkipped++;
                          continue; // eslint-disable-line no-continue
                        }
                      } else if (className === 'Experience') {
                        // Experience table doesn't require relationship validation
                        // It has name, cost, type, etc. as standalone fields
                        rate = null;
                        vehicleType = null;
                        service = null;
                      }

                      logger.info(`Processing ${className} record with relationships`, {
                        recordId: record.id,
                        className,
                        serviceId: service ? service.id : null,
                        rateId: rate ? rate.id : null,
                        vehicleTypeId: vehicleType ? vehicleType.id : null,
                        batchId,
                      });

                      // Check for duplicates based on table-specific fields
                      const duplicateQuery = new Parse.Query(ClassObj);

                      // Add field constraints based on table type
                      if (className === 'RatePrices') {
                        if (service) duplicateQuery.equalTo('service', service);
                        if (rate) duplicateQuery.equalTo('rate', rate);
                        if (vehicleType) duplicateQuery.equalTo('vehicleType', vehicleType);
                      } else if (className === 'TourPrices') {
                        if (rate) duplicateQuery.equalTo('ratePtr', rate);
                        if (vehicleType) duplicateQuery.equalTo('vehicleType', vehicleType);
                        if (service) duplicateQuery.equalTo('tourPtr', service);
                      } else if (className === 'ClientPrices') {
                        if (rate) duplicateQuery.equalTo('ratePtr', rate);
                        if (vehicleType) duplicateQuery.equalTo('vehiclePtr', vehicleType);
                        if (service) duplicateQuery.equalTo('clientPtr', service);
                      } else if (className === 'Experience') {
                        // For Experience, use name and type as unique identifiers
                        duplicateQuery.equalTo('name', record.get('name'));
                        duplicateQuery.equalTo('type', record.get('type'));
                      }

                      duplicateQuery.equalTo('active', true);
                      duplicateQuery.equalTo('exists', true);
                      duplicateQuery.equalTo('inflation_batch_id', batchId);
                      duplicateQuery.notEqualTo('objectId', record.id);

                      const existingInflated = await duplicateQuery.first({ useMasterKey: true });

                      if (existingInflated) {
                        logger.info(`Skipping duplicate ${className} record - already inflated in this batch`, {
                          recordId: record.id,
                          className,
                          serviceId: service.id,
                          rateId: rate.id,
                          vehicleTypeId: vehicleType.id,
                          existingRecordId: existingInflated.id,
                        });
                        totalSkipped++;
                        continue; // eslint-disable-line no-continue
                      }

                      // Get price fields based on table name
                      const priceFields = [];
                      let hasValidPrice = false;

                      if (className === 'ClientPrices') {
                        // For ClientPrices, inflate both precio and basePrice
                        const precio = record.get('precio') || 0;
                        const basePrice = record.get('basePrice') || 0;

                        if (precio > 0) {
                          priceFields.push({ fieldName: 'precio', currentValue: precio });
                          hasValidPrice = true;
                        }
                        if (basePrice > 0) {
                          priceFields.push({ fieldName: 'basePrice', currentValue: basePrice });
                          hasValidPrice = true;
                        }
                      } else if (className === 'Experience') {
                        // For Experience, inflate cost field
                        const cost = record.get('cost') || 0;
                        if (cost > 0) {
                          priceFields.push({ fieldName: 'cost', currentValue: cost });
                          hasValidPrice = true;
                        }
                      } else {
                        // For RatePrices and TourPrices, only inflate price field
                        const price = record.get('price') || 0;
                        if (price > 0) {
                          priceFields.push({ fieldName: 'price', currentValue: price });
                          hasValidPrice = true;
                        }
                      }

                      if (!hasValidPrice) {
                        logger.warn('Skipping record with invalid prices', {
                          recordId: record.id,
                          className,
                          priceFields: priceFields.map((p) => `${p.fieldName}=${p.currentValue}`),
                        });
                        totalSkipped++;
                        continue; // eslint-disable-line no-continue
                      }

                      // Mark current record as historical
                      record.set('valid_until', now);
                      record.set('active', false);
                      recordsToUpdate.push(record);

                      // Create new record with inflated prices
                      const newRecord = new ClassObj();

                      // Copy all relevant fields except excluded ones
                      const fieldsToExclude = [
                        'objectId',
                        'createdAt',
                        'updatedAt',
                        'valid_until',
                        'inflation_batch_id',
                      ];
                      const attrs = record.attributes;

                      for (const key in attrs) {
                        if (!fieldsToExclude.includes(key)) {
                          newRecord.set(key, attrs[key]);
                        }
                      }

                      // Apply inflation to all price fields and store previous values
                      const inflatedPrices = {};
                      const previousPrices = {};

                      priceFields.forEach((priceField) => {
                        const newPrice = Math.round(priceField.currentValue * (1 + percentage / 100));
                        newRecord.set(priceField.fieldName, newPrice);
                        inflatedPrices[priceField.fieldName] = newPrice;
                        previousPrices[priceField.fieldName] = priceField.currentValue;
                      });

                      // Set inflation metadata
                      newRecord.set('active', true);
                      newRecord.set('exists', true);
                      newRecord.set('inflation_batch_id', batchId);
                      newRecord.set('inflation_percentage', percentage);
                      newRecord.set('previous_prices', previousPrices); // Store all previous prices
                      newRecord.set('inflated_prices', inflatedPrices); // Store all new prices
                      newRecord.set('inflation_applied_at', now);

                      recordsToSave.push(newRecord);
                      totalProcessed++;
                    } catch (recordError) {
                      totalErrors++;
                      logger.error(`Error processing ${className} record`, {
                        recordId: record.id,
                        error: recordError.message,
                        batchId,
                      });
                    }
                  }

                  // IMPROVEMENT 3: Atomic batch processing with better error handling
                  message(`Saving batch: ${recordsToUpdate.length} updates, ${recordsToSave.length} new records`);

                  try {
                    // Save in specific order to maintain consistency:
                    // 1. First mark old records as historical
                    if (recordsToUpdate.length > 0) {
                      logger.info(`Updating ${recordsToUpdate.length} historical records for ${className}`, {
                        batchId,
                      });
                      await Parse.Object.saveAll(recordsToUpdate, { useMasterKey: true });
                    }

                    // 2. Then create new inflated records
                    if (recordsToSave.length > 0) {
                      logger.info(`Creating ${recordsToSave.length} inflated records for ${className}`, { batchId });
                      await Parse.Object.saveAll(recordsToSave, { useMasterKey: true });
                    }

                    // 3. Update progress only after successful save
                    historyRecord.set('processed_count', totalProcessed);
                    historyRecord.set('skipped_count', totalSkipped);
                    historyRecord.set('error_count', totalErrors);
                    await historyRecord.save(null, { useMasterKey: true });

                    message(
                      `${className} batch saved successfully: processed=${totalProcessed}, skipped=${totalSkipped}, errors=${totalErrors}`
                    );
                  } catch (batchError) {
                    // If batch save fails, log detailed error and continue with next batch
                    logger.error(`Failed to save ${className} batch`, {
                      batchId,
                      className,
                      updateCount: recordsToUpdate.length,
                      saveCount: recordsToSave.length,
                      error: batchError.message,
                      stack: batchError.stack,
                    });

                    // Try to recover: mark the batch as having errors but continue
                    totalErrors += recordsToUpdate.length + recordsToSave.length;
                    historyRecord.set('error_count', totalErrors);
                    await historyRecord.save(null, { useMasterKey: true });

                    message(`${className} batch failed - continuing with next batch`);

                    // Don't re-throw - continue processing other batches
                  }
                },
                { useMasterKey: true }
              );
            } catch (eachBatchError) {
              // Handle error in eachBatch processing with detailed logging
              console.error(`❌ DETAILED EACHBATCH ERROR for ${className}:`, eachBatchError);
              console.error('❌ ERROR MESSAGE:', eachBatchError.message);
              console.error('❌ ERROR STACK:', eachBatchError.stack);
              logger.error(`Failed to process batches for ${className}`, {
                batchId,
                className,
                error: eachBatchError.message,
                stack: eachBatchError.stack,
                fullError: String(eachBatchError),
              });
              totalErrors++;
              message(`${className} batch processing failed - continuing with next class`);
            }
          } catch (classError) {
            // Handle error in processing this class
            logger.error(`Error processing class ${className}`, {
              batchId,
              className,
              error: classError.message,
              stack: classError.stack,
            });
            totalErrors++;
            message(`Error processing ${className} - continuing with next class`);
          }
        }

        // Mark job as completed
        historyRecord.set('status', 'COMPLETED');
        historyRecord.set('completedAt', new Date());
        historyRecord.set('processed_count', totalProcessed);
        historyRecord.set('skipped_count', totalSkipped);
        historyRecord.set('error_count', totalErrors);
        await historyRecord.save(null, { useMasterKey: true });

        // Generate appropriate completion message based on results
        let completionMessage;
        if (totalProcessed === 0 && totalSkipped === 0 && totalErrors === 0) {
          completionMessage = 'Proceso de inflación completado exitosamente. 0 registros procesados - No hay precios actuales disponibles para inflación. Los precios ya han sido inflados o no existen registros elegibles.';
        } else if (totalProcessed === 0 && totalSkipped > 0) {
          completionMessage = `Proceso de inflación completado exitosamente. 0 registros procesados - ${totalSkipped} registros omitidos por datos incompletos o ya inflados.`;
        } else if (totalProcessed === 0) {
          completionMessage = 'Proceso de inflación completado exitosamente. 0 registros procesados - No hay registros elegibles para inflación.';
        } else {
          completionMessage = `Proceso de inflación completado exitosamente. ${totalProcessed} registros procesados.${totalSkipped > 0 ? ` ${totalSkipped} registros omitidos.` : ''}${totalErrors > 0 ? ` ${totalErrors} errores.` : ''}`;
        }

        message(completionMessage);
        logger.info('Inflation job completed', {
          batchId,
          percentage,
          totalProcessed,
          totalSkipped,
          totalErrors,
        });

        return {
          success: true,
          batchId,
          totalProcessed,
          totalSkipped,
          totalErrors,
        };

        // End of main try block
      } catch (error) {
        // Mark job as failed
        try {
          const InflationHistory = Parse.Object.extend('InflationHistory');
          const historyQuery = new Parse.Query(InflationHistory);
          historyQuery.equalTo('batch_id', batchId);
          const historyRecord = await historyQuery.first({ useMasterKey: true });

          if (historyRecord) {
            historyRecord.set('status', 'FAILED');
            historyRecord.set('error_message', error.message);
            historyRecord.set('completedAt', new Date());
            await historyRecord.save(null, { useMasterKey: true });
          }
        } catch (updateError) {
          logger.error('Error updating history record on failure', {
            batchId,
            error: updateError.message,
          });
        }

        logger.error('Inflation job failed', { batchId, error: error.message, stack: error.stack });
        throw error;
      }
    };

    // Register the job with Parse Cloud
    Parse.Cloud.job('aplicarInflacion', aplicarInflacionJob);

    /**
     * Cloud function to initiate inflation process.
     * Creates InflationHistory record and starts background job.
     * @function iniciarProcesoInflacion
     * @param {Parse.Cloud.FunctionRequest} request - Function request with percentage parameter.
     * @returns {Promise<object>} - Immediate response with batchId for tracking.
     */
    Parse.Cloud.define('iniciarProcesoInflacion', async (request) => {
      const { percentage } = request.params;
      const { user } = request;
      const isMasterKey = request.master;

      if (!user && !isMasterKey) {
        throw new Error('Authentication required');
      }

      if (!percentage || typeof percentage !== 'number') {
        throw new Error('Valid percentage parameter is required');
      }

      let historyRecord;
      try {
        // Generate unique batch ID
        const batchId = `INFLATION_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create InflationHistory record
        const InflationHistory = Parse.Object.extend('InflationHistory');
        historyRecord = new InflationHistory();
        historyRecord.set('batch_id', batchId);
        historyRecord.set('percentage', percentage);
        historyRecord.set('status', 'PENDING');
        historyRecord.set('createdAt', new Date());
        historyRecord.set('createdBy', user ? user.id : 'SYSTEM');
        historyRecord.set('processed_count', 0);
        historyRecord.set('error_count', 0);

        await historyRecord.save(null, { useMasterKey: true });

        // WORKAROUND: Call job function directly since Parse.Cloud.startJob doesn't work in development
        // Start background job
        try {
          logger.info('Starting inflation job directly (development mode)', { percentage, batchId });

          // Create a mock request object like Parse.Cloud.job would receive
          const mockRequest = {
            params: { percentage, batchId },
            message: (msg) => {
              logger.info('Inflation job message:', msg);
            },
          };

          // Call the job function directly
          setTimeout(async () => {
            try {
              await aplicarInflacionJob(mockRequest);
            } catch (jobError) {
              logger.error('Direct inflation job failed', {
                error: jobError.message,
                stack: jobError.stack,
              });
            }
          }, 100); // Small delay to allow response to be sent
        } catch (directJobError) {
          logger.error('Failed to start direct inflation job', {
            error: directJobError.message,
          });
        }

        logger.info('Inflation process initiated', {
          batchId,
          percentage,
          userId: user ? user.id : 'SYSTEM',
        });

        return {
          success: true,
          batchId,
          message: 'Inflation process started in background',
        };
      } catch (error) {
        // Update history record with error if it was created
        try {
          if (typeof historyRecord !== 'undefined' && historyRecord) {
            historyRecord.set('status', 'FAILED');
            historyRecord.set('error_message', error.message);
            historyRecord.set('completedAt', new Date());
            await historyRecord.save(null, { useMasterKey: true });
          }
        } catch (updateError) {
          console.error('Error updating history record:', updateError.message);
        }

        logger.error('Error initiating inflation process', {
          percentage,
          userId: user ? user.id : 'SYSTEM',
          error: error.message,
        });
        throw error;
      }
    });

    /**
     * Cloud function to revert inflation by batch ID.
     * Removes inflation records and reactivates original prices.
     * @function revertirInflacion
     * @param {Parse.Cloud.FunctionRequest} request - Function request with batchId parameter.
     * @returns {Promise<object>} - Result with count of reverted records.
     */
    Parse.Cloud.define('revertirInflacion', async (request) => {
      let { batchId } = request.params || {};
      const { user } = request;
      const isMasterKey = request.master;

      if (!user && !isMasterKey) {
        throw new Error('Authentication required');
      }

      try {
        // If no batchId provided, find the most recent successful inflation with records processed
        if (!batchId) {
          const InflationHistory = Parse.Object.extend('InflationHistory');
          const historyQuery = new Parse.Query(InflationHistory);
          historyQuery.equalTo('status', 'COMPLETED');
          historyQuery.greaterThan('processed_count', 0); // Only batches that actually processed records
          historyQuery.descending('createdAt');
          historyQuery.limit(1);

          const lastInflation = await historyQuery.first({ useMasterKey: true });
          if (!lastInflation) {
            throw new Error(
              'No inflation history found to revert. No completed inflation processes have records to revert.'
            );
          }

          batchId = lastInflation.get('batch_id');
          const processedCount = lastInflation.get('processed_count');
        }

        let totalReverted = 0;

        // Process each class
        const classesToProcess = ['RatePrices', 'TourPrices', 'ClientPrices', 'Experience'];

        for (const className of classesToProcess) {
          const ClassObj = Parse.Object.extend(className);

          // Find inflation records to delete
          const inflationQuery = new Parse.Query(ClassObj);
          inflationQuery.equalTo('inflation_batch_id', batchId);
          inflationQuery.limit(1000);

          const inflationRecords = await inflationQuery.find({ useMasterKey: true });

          if (inflationRecords.length > 0) {
            // Delete inflation records
            await Parse.Object.destroyAll(inflationRecords, { useMasterKey: true });

            // Reactivate original records (set valid_until back to null)
            const originalQuery = new Parse.Query(ClassObj);
            originalQuery.exists('valid_until');

            // Find records that were made historical during this inflation batch
            if (!batchId || typeof batchId !== 'string' || !batchId.includes('_')) {
              logger.warn(`Invalid batchId format: ${batchId} - skipping historical record reactivation`);
              continue; // eslint-disable-line no-continue
            }
            const validUntilTime = new Date(parseInt(batchId.split('_')[1])); // Extract timestamp from batchId
            originalQuery.greaterThanOrEqualTo('valid_until', new Date(validUntilTime.getTime() - 1000));
            originalQuery.lessThanOrEqualTo('valid_until', new Date(validUntilTime.getTime() + 1000));
            originalQuery.limit(1000);

            const originalRecords = await originalQuery.find({ useMasterKey: true });

            // Reactivate original records
            for (const record of originalRecords) {
              record.unset('valid_until');
              record.set('active', true); // Reactivate the record
            }

            if (originalRecords.length > 0) {
              await Parse.Object.saveAll(originalRecords, { useMasterKey: true });
            }

            totalReverted += inflationRecords.length;
          }
        }

        // Update InflationHistory record
        const InflationHistory = Parse.Object.extend('InflationHistory');
        const historyQuery = new Parse.Query(InflationHistory);
        historyQuery.equalTo('batch_id', batchId);
        const historyRecord = await historyQuery.first({ useMasterKey: true });

        if (historyRecord) {
          historyRecord.set('status', 'REVERTED');
          historyRecord.set('revertedAt', new Date());
          historyRecord.set('revertedBy', user ? user.id : 'SYSTEM');
          await historyRecord.save(null, { useMasterKey: true });
        }

        logger.info('Inflation reverted successfully', {
          batchId,
          totalReverted,
          userId: user ? user.id : 'SYSTEM',
        });

        return {
          success: true,
          batchId,
          totalReverted,
          message: `Successfully reverted ${totalReverted} price records`,
        };
      } catch (error) {
        logger.error('Error reverting inflation', {
          batchId,
          userId: user?.id,
          error: error.message,
        });
        throw error;
      }
    });

    /**
     * Cloud function to get inflation process status.
     * @function obtenerEstadoInflacion
     * @param {Parse.Cloud.FunctionRequest} request - Function request with batchId parameter.
     * @returns {Promise<object>} - Current status and progress of inflation process.
     */
    Parse.Cloud.define('obtenerEstadoInflacion', async (request) => {
      const { batchId } = request.params;

      if (!batchId) {
        throw new Error('batchId parameter is required');
      }

      try {
        const InflationHistory = Parse.Object.extend('InflationHistory');
        const query = new Parse.Query(InflationHistory);
        query.equalTo('batch_id', batchId);

        const historyRecord = await query.first({ useMasterKey: true });

        if (!historyRecord) {
          return {
            success: false,
            error: 'Inflation process not found',
          };
        }

        const processedCount = historyRecord.get('processed_count') || 0;
        const errorCount = historyRecord.get('error_count') || 0;
        const skippedCount = historyRecord.get('skipped_count') || 0;
        const status = historyRecord.get('status');

        // Generate descriptive message based on results
        let descriptiveMessage;
        if (status === 'COMPLETED') {
          if (processedCount === 0 && skippedCount === 0 && errorCount === 0) {
            descriptiveMessage = 'No hay precios actuales disponibles para inflación. Los precios ya han sido inflados o no existen registros elegibles.';
          } else if (processedCount === 0 && skippedCount > 0) {
            descriptiveMessage = `${skippedCount} registros omitidos por datos incompletos o ya inflados.`;
          } else if (processedCount === 0) {
            descriptiveMessage = 'No hay registros elegibles para inflación.';
          } else {
            descriptiveMessage = `${processedCount} registros procesados exitosamente.${skippedCount > 0 ? ` ${skippedCount} registros omitidos.` : ''}${errorCount > 0 ? ` ${errorCount} errores.` : ''}`;
          }
        } else if (status === 'FAILED') {
          descriptiveMessage = 'El proceso de inflación falló. Revise los logs para más detalles.';
        } else {
          descriptiveMessage = 'Proceso en curso...';
        }

        return {
          success: true,
          batchId,
          status,
          percentage: historyRecord.get('percentage'),
          processed_count: processedCount,
          error_count: errorCount,
          skipped_count: skippedCount,
          createdAt: historyRecord.get('createdAt'),
          startedAt: historyRecord.get('startedAt'),
          completedAt: historyRecord.get('completedAt'),
          error_message: historyRecord.get('error_message'),
          descriptive_message: descriptiveMessage,
        };
      } catch (error) {
        logger.error('Error getting inflation status', {
          batchId,
          error: error.message,
        });
        throw error;
      }
    });

    // =================
    // DIAGNOSTIC FUNCTIONS
    // =================

    /**
     * Test function to verify background job system is working.
     * @function testBackgroundJobDefinition
     * @returns {Promise<object>} - Simple test result.
     */
    Parse.Cloud.define('testBackgroundJobDefinition', async (request) => {
      try {
        return {
          success: true,
          message: 'Background job definition endpoint is working',
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        logger.error('Test background job definition failed', { error: error.message });
        throw error;
      }
    });

    /**
     * Test function to get Parse Server configuration details.
     * @function getParseServerConfig
     * @returns {Promise<object>} - Configuration information.
     */
    Parse.Cloud.define('getParseServerConfig', async (request) => {
      try {
        const result = {
          success: true,
          serverURL: process.env.PARSE_SERVER_URL,
          appId: process.env.PARSE_APP_ID,
          hasJobsSupport: typeof Parse.Cloud.startJob === 'function',
          hasJobDefine: typeof Parse.Cloud.job === 'function',
          timestamp: new Date().toISOString(),
        };

        return result;
      } catch (error) {
        logger.error('Get Parse Server config failed', { error: error.message });
        throw error;
      }
    });

    /**
     * Cloud function to get available inflation batches that can be reverted.
     * @function obtenerBatchesDisponibles
     * @returns {Promise<object>} - List of available batches for revert.
     */
    Parse.Cloud.define('obtenerBatchesDisponibles', async (request) => {
      try {
        const InflationHistory = Parse.Object.extend('InflationHistory');
        const query = new Parse.Query(InflationHistory);

        // Only get COMPLETED batches (not REVERTED)
        query.equalTo('status', 'COMPLETED');
        query.greaterThan('processed_count', 0); // Only batches that actually processed records
        query.descending('createdAt'); // Most recent first
        query.limit(20); // Limit to last 20 batches

        const batches = await query.find({ useMasterKey: true });

        const availableBatches = batches.map((batch) => ({
          batchId: batch.get('batch_id'),
          percentage: batch.get('percentage'),
          processedCount: batch.get('processed_count'),
          createdAt: batch.get('createdAt'),
          completedAt: batch.get('completedAt'),
          descriptiveMessage:
            batch.get('descriptive_message') || `${batch.get('processed_count')} registros procesados`,
        }));

        return {
          success: true,
          batches: availableBatches,
          total: availableBatches.length,
        };
      } catch (error) {
        logger.error('Error getting available batches:', error);
        throw new Error(`Error getting available batches: ${error.message}`);
      }
    });

    /**
     * Test minimal background job to verify job execution.
     * @function testMinimalJob
     */
    Parse.Cloud.job('testMinimalJob', async (request) => {
      const { params, message } = request;

      try {
        message('Starting minimal test job...');

        // Create a test record to verify job is running
        const TestLog = Parse.Object.extend('TestJobLog');
        const testLog = new TestLog();
        testLog.set('jobName', 'testMinimalJob');
        testLog.set('status', 'RUNNING');
        testLog.set('message', 'Test job executed successfully');
        testLog.set('timestamp', new Date());

        await testLog.save(null, { useMasterKey: true });

        message('Test job completed successfully');

        return { success: true, message: 'Minimal test job completed' };
      } catch (error) {
        logger.error('Minimal test job failed', { error: error.message });
        throw error;
      }
    });

    /**
     * Cloud function to test minimal background job execution.
     * @function testMinimalBackgroundJob
     * @returns {Promise<object>} - Test job initiation result.
     */
    Parse.Cloud.define('testMinimalBackgroundJob', async (request) => {
      try {
        // Start the test job
        Parse.Cloud.startJob('testMinimalJob', {
          testParam: 'minimal test',
        });

        return {
          success: true,
          message: 'Minimal test job started',
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        logger.error('Test minimal background job failed', { error: error.message });
        throw error;
      }
    });

    // Security audit job
    /**
     * Scheduled job that performs security audits on user accounts.
     * Checks for unverified email addresses and generates audit reports for compliance monitoring.
     * @function securityAudit
     * @param {Parse.Cloud.JobRequest} request - The Parse Cloud job request object.
     * @returns {Promise<object>} - Promise resolving to audit results with user statistics and timestamp.
     * @example
     * // Schedule this job in Parse Dashboard or via command line
     * // Returns: { totalUsers: 150, unverifiedUsers: 12, timestamp: '2025-10-01T...' }
     */
    Parse.Cloud.job('securityAudit', async (request) => {
      const { message } = request;
      message('Running security audit...');

      try {
        // Check for users with weak passwords (this is a placeholder)
        const User = Parse.Object.extend('_User');
        const query = new Parse.Query(User);
        const totalUsers = await query.count({ useMasterKey: true });

        // Check for users without email verification
        const unverifiedQuery = new Parse.Query(User);
        unverifiedQuery.equalTo('emailVerified', false);
        const unverifiedUsers = await unverifiedQuery.count({
          useMasterKey: true,
        });

        const auditResults = {
          totalUsers,
          unverifiedUsers,
          timestamp: new Date().toISOString(),
        };

        logger.logSecurityEvent('SECURITY_AUDIT', auditResults);
        message(`Audit complete. Total users: ${totalUsers}, Unverified: ${unverifiedUsers}`);

        return auditResults;
      } catch (error) {
        logger.error('Error in security audit:', error);
        throw error;
      }
    });

    logger.info('Cloud Code loaded successfully');

    // Register audit trail hooks INSIDE registerCloudFunctions to ensure Parse.Cloud is available
    logger.info('Registering audit trail hooks...');
    registerAuditHooks();
    logger.info('✅ Audit trail hooks registered successfully');
    logger.info('✅ Email uniqueness validation enabled for Parse.User (cloud/main.js beforeSave hook)');
  } catch (error) {
    logger.error('Error registering cloud functions:', error);
  }
}

// The retry mechanism is not needed since Parse Server loads this file directly
// and Parse.Cloud is always available in this context

// Register cloud functions immediately
// Parse Server loads this file and Parse.Cloud is available
try {
  logger.info('Starting cloud functions registration (including audit hooks)...');
  registerCloudFunctions();
  logger.info('Cloud functions and audit hooks registration completed successfully');
} catch (error) {
  logger.error('Failed to register cloud functions:', error);
  logger.error('Cloud function registration error details:', {
    name: error.name,
    message: error.message,
    stack: error.stack,
  });
}
