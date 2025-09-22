/* eslint-disable no-unused-vars */
const Parse = require('parse/node');
const logger = require('../infrastructure/logger');

// Import models and services
const AmexingUser = require('../domain/models/AmexingUser');
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
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // Register all cloud functions during Parse Server initialization
 * registerCloudFunctions();
 *
 * // Cloud functions become available via Parse SDK
 * const result = await Parse.Cloud.run('getAvailableCorporateDomains');
 * const oauthUrl = await Parse.Cloud.run('generateCorporateOAuthURL', { domain: 'example.com' });
 * const syncStatus = await Parse.Cloud.run('triggerCorporateSync', { domain: 'company.com' });
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
    Parse.Cloud.define('getUserById', async (request) => {
      const { params, user } = request;
      const { userId } = params;

      try {
        // Allow superadmin/admin to get any user, others can only get their own
        if (user && (user.get('role') === 'superadmin' || user.get('role') === 'admin' || user.id === userId)) {
          // Try AmexingUser first, then fallback to Parse.User
          const AmexingUserQuery = new Parse.Query('AmexingUser');
          AmexingUserQuery.equalTo('objectId', userId);

          let foundUser = await AmexingUserQuery.first({ useMasterKey: true });

          if (!foundUser) {
            const ParseUserQuery = new Parse.Query(Parse.User);
            ParseUserQuery.equalTo('objectId', userId);
            foundUser = await ParseUserQuery.first({ useMasterKey: true });
          }

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

    Parse.Cloud.define('changePassword', async (request) => {
      const { params, user } = request;
      const { currentPassword, newPassword } = params;

      if (!user) {
        throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Authentication required');
      }

      try {
        const result = await AuthenticationService.changePassword(
          user.id,
          currentPassword,
          newPassword
        );
        return result;
      } catch (error) {
        logger.error('Password change cloud function error:', error);
        throw error;
      }
    });

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
    Parse.Cloud.define('generateOAuthUrl', async (request) => {
      const { params } = request;
      const { provider, state } = params;

      try {
        const authUrl = await OAuthService.generateAuthorizationUrl(provider, state);
        return { authUrl };
      } catch (error) {
        logger.error('OAuth URL generation error:', error);
        throw error;
      }
    });

    Parse.Cloud.define('handleOAuthCallback', async (request) => {
      const { params, ip } = request;
      const { provider, code, state } = params;

      try {
        logger.info(`OAuth ${provider} callback from IP: ${ip}`);

        const result = await OAuthService.handleCallback(provider, code, state);
        return result;
      } catch (error) {
        logger.error('OAuth callback error:', error);
        throw error;
      }
    });

    Parse.Cloud.define('linkOAuthAccount', async (request) => {
      const { params, user } = request;
      const { provider, oauthData } = params;

      if (!user) {
        throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Authentication required');
      }

      try {
        const result = await OAuthService.linkOAuthAccount(user.id, provider, oauthData);
        return result;
      } catch (error) {
        logger.error('OAuth account linking error:', error);
        throw error;
      }
    });

    Parse.Cloud.define('unlinkOAuthAccount', async (request) => {
      const { params, user } = request;
      const { provider } = params;

      if (!user) {
        throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Authentication required');
      }

      try {
        const result = await OAuthService.unlinkOAuthAccount(user.id, provider);
        return result;
      } catch (error) {
        logger.error('OAuth account unlinking error:', error);
        throw error;
      }
    });

    Parse.Cloud.define('getOAuthProviders', async (request) => {
      try {
        const providers = OAuthService.getAvailableProviders();
        const providerConfigs = providers.map((provider) => OAuthService.getProviderConfig(provider));

        return { providers: providerConfigs };
      } catch (error) {
        logger.error('Get OAuth providers error:', error);
        throw error;
      }
    });

    // AmexingUser Triggers
    Parse.Cloud.beforeSave(AmexingUser, async (request) => {
      const { object: user, master } = request;

      // Skip validation for master key requests
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

      // Validate email format
      const email = user.get('email');
      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Invalid email format');
        }
        // Normalize email to lowercase
        user.set('email', email.toLowerCase());
      }

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
        throw new Parse.Error(
          Parse.Error.VALIDATION_ERROR,
          `Invalid role. Must be one of: ${validRoles.join(', ')}`
        );
      }

      // Validate OAuth accounts format
      const oauthAccounts = user.get('oauthAccounts');
      if (oauthAccounts && Array.isArray(oauthAccounts)) {
        for (const account of oauthAccounts) {
          if (!account.provider || !account.providerId) {
            throw new Parse.Error(
              Parse.Error.VALIDATION_ERROR,
              'OAuth accounts must have provider and providerId'
            );
          }
        }
      }
    });

    Parse.Cloud.afterSave(AmexingUser, async (request) => {
      const { object: user } = request;

      if (!user.existed()) {
        logger.info(`New AmexingUser created: ${user.id} (${user.get('username')})`);

        // Initialize any additional setup for new users
        // This could include creating related objects, sending welcome emails, etc.
      }
    });

    Parse.Cloud.beforeDelete(AmexingUser, async (request) => {
      const { object: user, master } = request;

      // Only allow user deletion with master key
      if (!master) {
        throw new Parse.Error(
          Parse.Error.OPERATION_FORBIDDEN,
          'AmexingUser can only be deleted with master key'
        );
      }

      logger.logSecurityEvent('AMEXING_USER_DELETION', {
        userId: user.id,
        username: user.get('username'),
        email: user.get('email') ? `${user.get('email').substring(0, 3)}***` : undefined,
      });
    });

    // Legacy Parse.User triggers (for backward compatibility if needed)
    Parse.Cloud.beforeSave(Parse.User, async (request) => {
      const { object: user, master } = request;

      // Skip validation for master key requests
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

      const email = user.get('email');
      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Invalid email format');
        }
      }
    });

    // After Save Triggers
    Parse.Cloud.afterSave(Parse.User, async (request) => {
      const { object: user } = request;

      if (!user.existed()) {
        logger.info(`New user created: ${user.id}`);

        // Initialize user profile or perform other setup tasks
        // This is where you might create related objects, send welcome emails, etc.
      }
    });

    // Before Delete Triggers
    Parse.Cloud.beforeDelete(Parse.User, async (request) => {
      const { object: user, master } = request;

      // Only allow user deletion with master key
      if (!master) {
        throw new Parse.Error(
          Parse.Error.OPERATION_FORBIDDEN,
          'Users can only be deleted with master key'
        );
      }

      logger.logSecurityEvent('USER_DELETION', {
        userId: user.id,
        username: user.get('username'),
      });
    });

    // After Login Trigger
    Parse.Cloud.afterLogin(async (request) => {
      const { object: user } = request;

      logger.logAccessAttempt(true, user.get('username'), request.ip);

      // Update last login timestamp
      user.set('lastLoginAt', new Date());
      await user.save(null, { useMasterKey: true });
    });

    // After Logout Trigger
    Parse.Cloud.afterLogout(async (request) => {
      const { object: session } = request;

      logger.logSecurityEvent('USER_LOGOUT', {
        sessionToken: `${session.get('sessionToken').substring(0, 8)}***`,
      });
    });

    // Job Functions (Scheduled Tasks)
    Parse.Cloud.job('cleanupExpiredSessions', async (request) => {
      const { message } = request;
      message('Starting expired sessions cleanup...');

      try {
        const Session = Parse.Object.extend('_Session');
        const query = new Parse.Query(Session);
        query.lessThan('expiresAt', new Date());

        const expiredSessions = await query.find({ useMasterKey: true });

        if (expiredSessions.length > 0) {
          await Parse.Object.destroyAll(expiredSessions, { useMasterKey: true });
          message(`Deleted ${expiredSessions.length} expired sessions`);
          logger.info(
            `Cleanup job: Deleted ${expiredSessions.length} expired sessions`
          );
        } else {
          message('No expired sessions found');
        }

        return { success: true, deletedCount: expiredSessions.length };
      } catch (error) {
        logger.error('Error in cleanup job:', error);
        throw error;
      }
    });

    // Security audit job
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
        const unverifiedUsers = await unverifiedQuery.count({ useMasterKey: true });

        const auditResults = {
          totalUsers,
          unverifiedUsers,
          timestamp: new Date().toISOString(),
        };

        logger.logSecurityEvent('SECURITY_AUDIT', auditResults);
        message(
          `Audit complete. Total users: ${totalUsers}, Unverified: ${unverifiedUsers}`
        );

        return auditResults;
      } catch (error) {
        logger.error('Error in security audit:', error);
        throw error;
      }
    });

    logger.info('Cloud Code loaded successfully');
  } catch (error) {
    logger.error('Error registering cloud functions:', error);
  }
}

// The retry mechanism is not needed since Parse Server loads this file directly
// and Parse.Cloud is always available in this context

// Register cloud functions immediately
// Parse Server loads this file and Parse.Cloud is available
registerCloudFunctions();
logger.info('Cloud functions registration initiated');
