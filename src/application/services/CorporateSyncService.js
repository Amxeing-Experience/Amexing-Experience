/* eslint-disable max-lines */
/**
 * Corporate Sync Service - Handles periodic synchronization of corporate employee data
 * Implements OAuth-2-05 and OAuth-2-06 user stories for Sprint 2.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2.0.0
 */

const Parse = require('parse/node');
const CorporateOAuthService = require('./CorporateOAuthService');
// const OAuthService = require('./OAuthService'); // TODO: Remove unused import
const AmexingUser = require('../../domain/models/AmexingUser');
const logger = require('../../infrastructure/logger');

class CorporateSyncService {
  constructor() {
    this.syncIntervals = new Map(); // Track running sync intervals
    this.lastSyncTimes = new Map(); // Track last sync times per client
  }

  /**
   * Starts periodic sync for a corporate client.
   * @param {Parse.Object} client - Corporate client object.
   * @param {number} intervalMinutes - Sync interval in minutes (default: 60).
   * @example
   * const syncService = require('./CorporateSyncService');
   * await syncService.startPeriodicSync(clientObject, 30);
   */
  startPeriodicSync(client, intervalMinutes = 60) {
    const clientId = client.id;

    // Stop existing sync if running
    this.stopPeriodicSync(clientId);

    // Start new interval
    const intervalMs = intervalMinutes * 60 * 1000;
    const intervalId = setInterval(async () => {
      try {
        await this.syncCorporateClient(clientId);
      } catch (error) {
        logger.error(`Periodic sync failed for client ${clientId}:`, error);
      }
    }, intervalMs);

    this.syncIntervals.set(clientId, intervalId);

    logger.logSecurityEvent('CORPORATE_SYNC_STARTED', null, {
      clientId,
      clientName: client.get('name'),
      intervalMinutes,
    });
  }

  /**
   * Stops periodic sync for a corporate client.
   * @param {string} clientId - Client ID.
   * @example
   * const syncService = require('./CorporateSyncService');
   * syncService.stopPeriodicSync('clientId123');
   */
  stopPeriodicSync(clientId) {
    const intervalId = this.syncIntervals.get(clientId);
    if (intervalId) {
      clearInterval(intervalId);
      this.syncIntervals.delete(clientId);

      logger.logSecurityEvent('CORPORATE_SYNC_STOPPED', null, {
        clientId,
      });
    }
  }

  /**
   * Performs one-time sync for a corporate client.
   * @param {string} clientId - Corporate client ID.
   * @returns {Promise<object>} Sync result.
   * @example
   * const syncService = require('./CorporateSyncService');
   * const result = await syncService.syncCorporateClient('clientId123');
   */
  // eslint-disable-next-line max-lines-per-function
  async syncCorporateClient(clientId) {
    try {
      // Get client information
      const clientQuery = new Parse.Query('Client');
      clientQuery.equalTo('objectId', clientId);

      const client = await clientQuery.first({ useMasterKey: true });

      if (!client) {
        throw new Error(`Client ${clientId} not found`);
      }

      if (!client.get('isCorporate') || !client.get('oauthEnabled')) {
        throw new Error(`Client ${clientId} is not configured for OAuth sync`);
      }

      const corporateDomain = client.get('corporateDomain');
      const primaryProvider = client.get('primaryOAuthProvider');

      if (!corporateDomain || !primaryProvider) {
        throw new Error(`Client ${clientId} missing OAuth configuration`);
      }

      logger.logSecurityEvent('CORPORATE_SYNC_STARTED', null, {
        clientId,
        clientName: client.get('name'),
        corporateDomain,
        provider: primaryProvider,
      });

      // Get all employees for this client
      const employeeQuery = new Parse.Query('ClientEmployee');
      employeeQuery.equalTo('clientId', clientId);
      employeeQuery.equalTo('active', true);
      employeeQuery.include('userId');

      const employees = await employeeQuery.find({ useMasterKey: true });

      let syncedCount = 0;
      let errorCount = 0;
      let deactivatedCount = 0;
      const syncErrors = [];

      // Sync each employee
      // Process employees using for...of loop for async operations
      // eslint-disable-next-line no-restricted-syntax
      for (const employee of employees) {
        try {
          const user = employee.get('userId');
          if (user && user.get('isOAuthUser') && user.get('oauthProvider') === primaryProvider) {
            // eslint-disable-next-line no-await-in-loop
            const syncResult = await this.syncEmployeeData(user, employee, client, primaryProvider);

            if (syncResult.success) {
              // eslint-disable-next-line no-plusplus
              syncedCount++;
              // eslint-disable-next-line max-depth
              if (syncResult.deactivated) {
                // eslint-disable-next-line no-plusplus
                deactivatedCount++;
              }
            } else {
              // eslint-disable-next-line no-plusplus
              errorCount++;
              syncErrors.push({
                userId: user.id,
                email: CorporateOAuthService.maskEmail(user.get('email')),
                error: syncResult.error,
              });
            }
          }
        } catch (error) {
          // eslint-disable-next-line no-plusplus
          errorCount++;
          syncErrors.push({
            employeeId: employee.id,
            error: error.message,
          });
        }
      }

      // Update last sync time
      this.lastSyncTimes.set(clientId, new Date());

      const syncResult = {
        success: true,
        clientId,
        syncedCount,
        errorCount,
        deactivatedCount,
        totalEmployees: employees.length,
        lastSyncTime: new Date(),
        errors: syncErrors,
      };

      logger.logSecurityEvent('CORPORATE_SYNC_COMPLETED', null, {
        clientId,
        clientName: client.get('name'),
        syncedCount,
        errorCount,
        deactivatedCount,
        totalEmployees: employees.length,
      });

      return syncResult;
    } catch (error) {
      logger.error(`Corporate sync failed for client ${clientId}:`, error);

      logger.logSecurityEvent('CORPORATE_SYNC_FAILED', null, {
        clientId,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Syncs individual employee data from OAuth provider.
   * @param {AmexingUser} user - User object.
   * @param {Parse.Object} employee - ClientEmployee object.
   * @param {Parse.Object} client - Client object.
   * @param {string} provider - OAuth provider.
   * @returns {Promise<object>} Sync result.
   * @example
   * const syncService = require('./CorporateSyncService');
   * const result = await syncService.syncEmployeeData(user, employee, client, 'microsoft');
   */
  // eslint-disable-next-line max-params, max-lines-per-function
  async syncEmployeeData(user, employee, client, provider) {
    try {
      const oauthProfile = user.get('oauthProfile');
      let refreshedProfile = null;

      // Try to refresh user data from provider (if we have refresh token)
      try {
        if (provider === 'microsoft' && user.get('refreshToken')) {
          // Microsoft refresh token flow
          refreshedProfile = await this.refreshMicrosoftUserData(user.get('refreshToken'));
        } else if (provider === 'google' && user.get('refreshToken')) {
          // Google refresh token flow
          refreshedProfile = await this.refreshGoogleUserData(user.get('refreshToken'));
        }
      } catch (refreshError) {
        // If refresh fails, we'll continue with existing data
        logger.logSecurityEvent('OAUTH_REFRESH_FAILED', user.id, {
          provider,
          error: refreshError.message,
        });
      }

      // Use refreshed profile or existing profile
      const currentProfile = refreshedProfile || JSON.parse(oauthProfile || '{}');

      // Check if user still exists in corporate directory
      let userStillActive = true;
      if (currentProfile.error && currentProfile.error.includes('user not found')) {
        userStillActive = false;
      }

      // Update employee information
      let updated = false;

      // Update department if changed
      const corporateConfig = CorporateOAuthService.corporateDomains.get(
        CorporateOAuthService.extractEmailDomain(user.get('email'))
      );

      if (corporateConfig && refreshedProfile) {
        const newDepartment = await CorporateOAuthService.mapDepartmentFromOAuth(
          refreshedProfile,
          corporateConfig
        );

        if (newDepartment && newDepartment !== employee.get('departmentId')) {
          employee.set('departmentId', newDepartment);
          updated = true;
        }

        // Update access level if changed
        const newAccessLevel = CorporateOAuthService.determineAccessLevel(
          refreshedProfile,
          corporateConfig
        );

        if (newAccessLevel !== employee.get('accessLevel')) {
          employee.set('accessLevel', newAccessLevel);
          updated = true;
        }
      }

      // Update sync timestamp
      employee.set('lastOAuthSync', new Date());
      updated = true;

      // If user is no longer active in directory, deactivate
      if (!userStillActive) {
        employee.set('active', false);
        employee.set('deactivationReason', 'oauth_sync_user_not_found');
        employee.set('deactivatedAt', new Date());
        updated = true;
      }

      if (updated) {
        await employee.save(null, { useMasterKey: true });
      }

      // Update user profile if we got refreshed data
      if (refreshedProfile) {
        user.set('oauthProfile', CorporateOAuthService.encryptOAuthProfile(refreshedProfile));
        user.set('lastOAuthSync', new Date());
        await user.save(null, { useMasterKey: true });
      }

      return {
        success: true,
        updated,
        deactivated: !userStillActive,
        userId: user.id,
      };
    } catch (error) {
      logger.error(`Employee sync failed for user ${user.id}:`, error);

      return {
        success: false,
        error: error.message,
        userId: user.id,
      };
    }
  }

  /**
   * Refreshes Microsoft user data using refresh token.
   * @param {string} refreshToken - Microsoft refresh token.
   * @returns {Promise<object>} Updated user profile.
   * @example
   * const syncService = require('./CorporateSyncService');
   * const profile = await syncService.refreshMicrosoftUserData('refresh_token_here');
   */
  async refreshMicrosoftUserData(refreshToken) {
    try {
      const tenantId = process.env.MICROSOFT_OAUTH_TENANT_ID || 'common';

      // Exchange refresh token for new access token
      const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: process.env.MICROSOFT_OAUTH_CLIENT_ID,
          client_secret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope: 'openid profile email User.Read Directory.Read.All',
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Microsoft token refresh failed: ${tokenResponse.status}`);
      }

      const tokenData = await tokenResponse.json();

      // Get updated user profile
      const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName,givenName,surname,jobTitle,department,companyName,officeLocation', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      });

      if (!profileResponse.ok) {
        throw new Error(`Microsoft profile refresh failed: ${profileResponse.status}`);
      }

      const profileData = await profileResponse.json();

      return {
        ...profileData,
        organizationUnit: profileData.department,
        refreshed: true,
        refreshedAt: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Microsoft refresh failed: ${error.message}`);
    }
  }

  /**
   * Refreshes Google user data using refresh token.
   * @param {string} refreshToken - Google refresh token.
   * @returns {Promise<object>} Updated user profile.
   * @example
   * const syncService = require('./CorporateSyncService');
   * const profile = await syncService.refreshGoogleUserData('refresh_token_here');
   */
  async refreshGoogleUserData(refreshToken) {
    try {
      // Exchange refresh token for new access token
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
          client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Google token refresh failed: ${tokenResponse.status}`);
      }

      const tokenData = await tokenResponse.json();

      // Get updated user profile
      const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      });

      if (!profileResponse.ok) {
        throw new Error(`Google profile refresh failed: ${profileResponse.status}`);
      }

      const profileData = await profileResponse.json();

      return {
        ...profileData,
        refreshed: true,
        refreshedAt: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Google refresh failed: ${error.message}`);
    }
  }

  /**
   * Gets sync status for all corporate clients.
   * @returns {Promise<Array>} Array of sync statuses.
   * @example
   * const syncService = require('./CorporateSyncService');
   * const statuses = await syncService.getAllSyncStatuses();
   */
  async getAllSyncStatuses() {
    try {
      // Get all corporate clients with OAuth enabled
      const clientQuery = new Parse.Query('Client');
      clientQuery.equalTo('isCorporate', true);
      clientQuery.equalTo('oauthEnabled', true);
      clientQuery.equalTo('active', true);

      const clients = await clientQuery.find({ useMasterKey: true });

      const statuses = clients.map((client) => {
        const clientId = client.id;
        return {
          clientId,
          clientName: client.get('name'),
          corporateDomain: client.get('corporateDomain'),
          primaryProvider: client.get('primaryOAuthProvider'),
          syncActive: this.syncIntervals.has(clientId),
          lastSync: this.lastSyncTimes.get(clientId) || null,
        };
      });

      return statuses;
    } catch (error) {
      logger.error('Error getting sync statuses:', error);
      throw error;
    }
  }

  /**
   * Stops all periodic syncs (cleanup method).
   * @example
   * const syncService = require('./CorporateSyncService');
   * syncService.stopAllSyncs();
   */
  stopAllSyncs() {
    for (const [clientId, intervalId] of this.syncIntervals) {
      clearInterval(intervalId);
      logger.logSecurityEvent('CORPORATE_SYNC_STOPPED', null, { clientId });
    }

    this.syncIntervals.clear();
    this.lastSyncTimes.clear();
  }
}

module.exports = new CorporateSyncService();
