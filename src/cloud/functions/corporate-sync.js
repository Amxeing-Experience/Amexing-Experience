/**
 * Corporate Sync Cloud Functions
 * Provides sync management functionality for corporate OAuth data.
 * @author Amexing Development Team
 * @version 1.0.0
 * @created Sprint 02 - Corporate Sync System
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { 'parse/node': 'example' });
 * // Returns: function result
 */

const Parse = require('parse/node');
const CorporateSyncService = require('../../application/services/CorporateSyncService');
const logger = require('../../infrastructure/logger');

/**
 * Manually triggers sync for a corporate client
 * Endpoint: POST /functions/triggerCorporateSync
 * Access: Requires admin role.
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
const triggerCorporateSync = async (request) => {
  try {
    // Check admin permissions
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const userRole = request.user.get('role');
    if (!['admin', 'superadmin'].includes(userRole)) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Admin access required for corporate sync'
      );
    }

    const { clientId } = request.params;

    if (!clientId) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'clientId parameter required');
    }

    // Trigger sync
    const syncResult = await CorporateSyncService.syncCorporateClient(clientId);

    logger.logSecurityEvent('CORPORATE_SYNC_TRIGGERED', request.user.id, {
      adminUser: request.user.get('username'),
      clientId,
      syncedCount: syncResult.syncedCount,
      errorCount: syncResult.errorCount,
    });

    return {
      success: true,
      syncResult,
      message: `Sync completed for client ${clientId}`,
    };
  } catch (error) {
    logger.error('Error triggering corporate sync:', error);
    throw error;
  }
};

/**
 * Starts periodic sync for a corporate client
 * Endpoint: POST /functions/startPeriodicSync
 * Access: Requires admin role.
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
const startPeriodicSync = async (request) => {
  try {
    // Check admin permissions
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const userRole = request.user.get('role');
    if (!['admin', 'superadmin'].includes(userRole)) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Admin access required for sync management'
      );
    }

    const { clientId, intervalMinutes = 60 } = request.params;

    if (!clientId) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'clientId parameter required');
    }

    // Validate interval
    if (intervalMinutes < 15 || intervalMinutes > 1440) { // 15 minutes to 24 hours
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        'intervalMinutes must be between 15 and 1440'
      );
    }

    // Get client
    const clientQuery = new Parse.Query('Client');
    const client = await clientQuery.get(clientId, { useMasterKey: true });

    if (!client.get('isCorporate') || !client.get('oauthEnabled')) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Client is not configured for corporate OAuth sync'
      );
    }

    // Start periodic sync
    CorporateSyncService.startPeriodicSync(client, intervalMinutes);

    logger.logSecurityEvent('PERIODIC_SYNC_STARTED', request.user.id, {
      adminUser: request.user.get('username'),
      clientId,
      clientName: client.get('name'),
      intervalMinutes,
    });

    return {
      success: true,
      message: `Periodic sync started for client ${client.get('name')}`,
      clientId,
      intervalMinutes,
    };
  } catch (error) {
    logger.error('Error starting periodic sync:', error);
    throw error;
  }
};

/**
 * Stops periodic sync for a corporate client
 * Endpoint: POST /functions/stopPeriodicSync
 * Access: Requires admin role.
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
const stopPeriodicSync = async (request) => {
  try {
    // Check admin permissions
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const userRole = request.user.get('role');
    if (!['admin', 'superadmin'].includes(userRole)) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Admin access required for sync management'
      );
    }

    const { clientId } = request.params;

    if (!clientId) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'clientId parameter required');
    }

    // Stop periodic sync
    CorporateSyncService.stopPeriodicSync(clientId);

    logger.logSecurityEvent('PERIODIC_SYNC_STOPPED', request.user.id, {
      adminUser: request.user.get('username'),
      clientId,
    });

    return {
      success: true,
      message: `Periodic sync stopped for client ${clientId}`,
      clientId,
    };
  } catch (error) {
    logger.error('Error stopping periodic sync:', error);
    throw error;
  }
};

/**
 * Gets sync status for all corporate clients
 * Endpoint: GET /functions/getAllSyncStatuses
 * Access: Requires admin role.
 * @param {object} request - HTTP request object.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 * // GET /api/endpoint
 * // Response: { "success": true, "data": [...] }
 * @returns {Promise<object>} - Promise resolving to operation result.
 */
const getAllSyncStatuses = async (request) => {
  try {
    // Check admin permissions
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const userRole = request.user.get('role');
    if (!['admin', 'superadmin'].includes(userRole)) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Admin access required for sync status'
      );
    }

    // Get all sync statuses
    const statuses = await CorporateSyncService.getAllSyncStatuses();

    logger.logSecurityEvent('SYNC_STATUSES_RETRIEVED', request.user.id, {
      adminUser: request.user.get('username'),
      clientCount: statuses.length,
    });

    return {
      success: true,
      statuses,
      count: statuses.length,
    };
  } catch (error) {
    logger.error('Error getting sync statuses:', error);
    throw error;
  }
};

/**
 * Gets detailed sync history for a corporate client
 * Endpoint: GET /functions/getCorporateSyncHistory
 * Access: Requires admin role.
 * @param {object} request - HTTP request object.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 * // GET /api/endpoint
 * // Response: { "success": true, "data": [...] }
 * @returns {Promise<object>} - Promise resolving to operation result.
 */
const getCorporateSyncHistory = async (request) => {
  try {
    // Check admin permissions
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not authenticated');
    }

    const userRole = request.user.get('role');
    if (!['admin', 'superadmin'].includes(userRole)) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Admin access required for sync history'
      );
    }

    const { clientId, _limit = 50, skip = 0 } = request.params;

    if (!clientId) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'clientId parameter required');
    }

    // Query sync-related audit logs
    const auditQuery = new Parse.Query('AuditLog');
    auditQuery.containedIn('action', [
      'CORPORATE_SYNC_STARTED',
      'CORPORATE_SYNC_COMPLETED',
      'CORPORATE_SYNC_FAILED',
      'PERIODIC_SYNC_STARTED',
      'PERIODIC_SYNC_STOPPED',
    ]);

    // Filter by clientId in the additional data - use escaped string matching
    // Escape clientId to prevent RegExp injection attacks
    const escapedClientId = clientId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const safePattern = `"clientId":"${escapedClientId}"`;

    // Use string contains instead of RegExp to avoid ReDoS
    auditQuery.contains('additionalData', safePattern);
    auditQuery.descending('createdAt');
    auditQuery.limit(Math.min(_limit, 100));
    auditQuery.skip(skip);

    const syncHistory = await auditQuery.find({ useMasterKey: true });

    const history = syncHistory.map((log) => ({
      id: log.id,
      action: log.get('action'),
      timestamp: log.get('createdAt'),
      userId: log.get('userId'),
      additionalData: log.get('additionalData'),
      success: !log.get('action').includes('FAILED'),
    }));

    logger.logSecurityEvent('SYNC_HISTORY_RETRIEVED', request.user.id, {
      adminUser: request.user.get('username'),
      clientId,
      historyCount: history.length,
    });

    return {
      success: true,
      clientId,
      history,
      count: history.length,
    };
  } catch (error) {
    logger.error('Error getting sync history:', error);
    throw error;
  }
};

/**
 * Background job to auto-start syncs for corporate clients
 * This is triggered by Parse Server's job scheduling.
 */
// // TODO: Fix Parse.Cloud.job - temporarily commented to allow server start
// // Parse.Cloud.job('autoStartCorporateSyncs', async (request) => {
// //   try {
// //     const { message } = request;
// //
// //     // Get all corporate clients that should have sync enabled
// //     const clientQuery = new Parse.Query('Client');
// //     clientQuery.equalTo('isCorporate', true);
// //     clientQuery.equalTo('oauthEnabled', true);
// //     clientQuery.equalTo('active', true);
// //     clientQuery.exists('corporateDomain');
// //
// //     const corporateClients = await clientQuery.find({ useMasterKey: true });
// //
// //     let startedCount = 0;
// //
// //     for (const client of corporateClients) {
// //       try {
// //         // Check if sync is already running
// //         const statuses = await CorporateSyncService.getAllSyncStatuses();
// //         const clientStatus = statuses.find((s) => s.clientId === client.id);
// //
// //         if (!clientStatus || !clientStatus.syncActive) {
// //           // Start sync with default 1-hour interval
// //           CorporateSyncService.startPeriodicSync(client, 60);
// //           startedCount++;
// //
// //           message(`Started sync for ${client.get('name')}`);
// //         }
// //       } catch (error) {
// //         message(`Failed to start sync for ${client.get('name')}: ${error.message}`);
// //       }
// //     }
// //
// //     logger.logSecurityEvent('AUTO_SYNC_JOB_COMPLETED', null, {
// //       totalClients: corporateClients.length,
// //       startedCount,
// //     });
// //
// //     message(`Auto-start job completed: ${startedCount}/${corporateClients.length} syncs started`);
// //   } catch (error) {
// //     logger.error('Auto-start corporate syncs job failed:', error);
// //     throw error;
// //   }
// // });

module.exports = {
  triggerCorporateSync,
  startPeriodicSync,
  stopPeriodicSync,
  getAllSyncStatuses,
  getCorporateSyncHistory,
};
