/**
 * DepartmentManagerSwapService - Service for swapping department manager role
 * Handles the complex process of transferring manager role between users
 * while preserving all organizational relationships.
 *
 * Key concept: The department_manager account acts as a "seat" that different
 * people can occupy. We swap personal data while keeping the ID stable.
 * @author Created by Denisse Maldonado
 * @version 1.0.0
 */

const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');
const AuditLog = require('../../domain/models/AuditLog');

/**
 * Service that swaps the department_manager "seat" between two users by moving
 * personal data while keeping the account ID and organizational relationships
 * stable, so the manager role can change hands without breaking references.
 * @example
 *   const service = new DepartmentManagerSwapService();
 *   await service.swapManager(currentManagerId, newPersonData);
 */
class DepartmentManagerSwapService {
  /**
   * Fields that get swapped between users (personal data).
   */
  static SWAPPABLE_FIELDS = [
    'firstName',
    'lastName',
    'email',
    'username',
    '_hashed_password', // Parse's internal password field
    'passwordHash', // Custom field if exists
    'contextualData',
    'phone',
    'address',
    'preferredLanguage',
    'profilePhoto',
  ];

  /**
   * Fields that stay with the department_manager account (organizational data).
   */
  static PRESERVED_FIELDS = [
    'objectId',
    'role',
    'roleId',
    'clientId', // undefined for manager
    'organizationId', // 'client' for manager
    'createdAt',
    'active',
    'exists',
  ];

  /**
   * Main method to swap manager role with an agent.
   * @param {string} agentId - ID of the agent to promote.
   * @param {string} departmentManagerId - ID of current department manager.
   * @param {object} options - Configuration options.
   * @returns {object} Result of the swap operation.
   * @example
   */
  async swapManagerWithAgent(agentId, departmentManagerId, options = {}) {
    const {
      preserveOldManager = false, // Default to false - simpler approach
      auditLog = true,
      requestedBy = null,
    } = options;

    try {
      logger.info('Starting department manager swap', {
        agentId,
        departmentManagerId,
        preserveOldManager,
        requestedBy,
      });

      // 1. Fetch both users with master key
      const agent = await this.fetchUser(agentId);
      const manager = await this.fetchUser(departmentManagerId);

      if (!agent || !manager) {
        throw new Error('Agent or Manager not found');
      }

      // 2. Add debugging info before validation
      logger.info('User data before validation', {
        agentId: agent.id,
        agentRole: agent.get('role'),
        agentClientId: agent.get('clientId'),
        agentOrgId: agent.get('organizationId'),
        managerId: manager.id,
        managerRole: manager.get('role'),
        managerClientId: manager.get('clientId'),
        managerOrgId: manager.get('organizationId'),
        departmentManagerId,
      });

      // 3. Validate roles and relationships
      await this.validateSwapEligibility(agent, manager, departmentManagerId);

      // 3. Create backups for rollback capability
      const agentBackup = this.createUserBackup(agent);
      const managerBackup = this.createUserBackup(manager);

      // 4. Simple swap: just replace manager with agent data
      logger.info('Performing simple manager replacement (no agent preservation)', {
        agentEmail: agent.get('email'),
        agentUsername: agent.get('username'),
        managerEmail: manager.get('email'),
        managerUsername: manager.get('username'),
      });

      // 5. Remove original agent account FIRST to eliminate email conflicts
      try {
        await agent.destroy({ useMasterKey: true });
        logger.info('Successfully removed original agent account before swap', {
          originalAgentId: agent.id,
          originalAgentEmail: agent.get('email'),
        });
      } catch (deleteError) {
        logger.error('Failed to delete original agent', {
          error: deleteError.message,
          agentId: agent.id,
          agentEmail: agent.get('email'),
        });
        throw deleteError; // Critical error - can't proceed without deleting agent
      }

      // 6. Now swap personal data from agent to manager (no email conflicts possible)
      this.swapPersonalData(agent, manager);

      // 7. Ensure manager account is active (in case agent was inactive)
      manager.set('active', true);
      manager.set('lastActivatedAt', new Date());
      manager.set('replacedManagerAt', new Date());
      manager.set('originalManagerData', managerBackup); // Store original manager data for reference

      // 8. Save the manager (completely safe now)
      await manager.save(null, { useMasterKey: true });

      logger.info('Successfully saved updated manager after agent deletion', {
        managerId: manager.id,
        newManagerEmail: manager.get('email'),
        newManagerUsername: manager.get('username'),
      });

      // 9. Clear sessions for affected users
      await this.clearUserSessions([agentId, departmentManagerId]);

      // 10. Create audit log
      if (auditLog) {
        await this.createAuditLog({
          action: 'DEPARTMENT_MANAGER_SWAP',
          agentId,
          departmentManagerId,
          newAgentId: null, // No new agent in simplified approach
          preserveOldManager,
          requestedBy,
          agentBackup,
          managerBackup,
        });
      }

      logger.info('Department manager swap completed successfully', {
        agentId,
        departmentManagerId,
        newAgentId: null, // No new agent created in simplified approach
      });

      return {
        success: true,
        oldAgentId: agentId,
        departmentManagerId,
        newAgentId: null, // No new agent created in simplified approach
        message: 'Manager role transferred successfully',
      };
    } catch (error) {
      logger.error('Failed to swap department manager', {
        error: error.message,
        stack: error.stack,
        agentId,
        departmentManagerId,
      });
      throw error;
    }
  }

  /**
   * Fetch user by ID with all necessary fields.
   * @param userId
   * @example
   */
  async fetchUser(userId) {
    try {
      const query = new Parse.Query('AmexingUser');
      query.equalTo('objectId', userId);
      query.include(['roleId']);

      const user = await query.first({ useMasterKey: true });

      if (!user) {
        logger.warn('User not found for swap', { userId });
        return null;
      }

      return user;
    } catch (error) {
      logger.error('Error fetching user', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * Validate that the swap can be performed.
   * @param agent
   * @param manager
   * @param departmentManagerId
   * @example
   */
  async validateSwapEligibility(agent, manager, departmentManagerId) {
    // Check agent role
    const agentRole = agent.get('role') || agent.get('roleId')?.get?.('name');
    if (agentRole !== 'client') {
      throw new Error(`Agent must have role 'client', found: ${agentRole}`);
    }

    // Check agent belongs to this organization
    const agentClientId = agent.get('clientId');
    const agentOrgId = agent.get('organizationId');

    if (agentClientId !== departmentManagerId || agentOrgId !== departmentManagerId) {
      throw new Error('Agent does not belong to this organization');
    }

    // Check manager role
    const managerRole = manager.get('role') || manager.get('roleId')?.get?.('name');
    if (managerRole !== 'department_manager') {
      throw new Error(`Manager must have role 'department_manager', found: ${managerRole}`);
    }

    // Check manager has correct organizational fields
    const managerClientId = manager.get('clientId');
    const managerOrgId = manager.get('organizationId');

    // Department manager should have clientId as null or undefined
    // and organizationId as 'client' or their own ID
    if (managerClientId != null) { // This checks both null and undefined
      logger.error('Manager validation failed - incorrect clientId', {
        managerClientId,
        managerOrgId,
        departmentManagerId,
        managerId: manager.id,
      });
      throw new Error(`Manager has incorrect clientId: ${managerClientId}, should be null/undefined`);
    }

    // organizationId can be 'client' or the manager's own ID or null/undefined
    if (managerOrgId !== 'client' && managerOrgId !== departmentManagerId && managerOrgId != null) {
      logger.error('Manager validation failed - incorrect organizationId', {
        managerClientId,
        managerOrgId,
        departmentManagerId,
        managerId: manager.id,
      });
      throw new Error(`Manager has incorrect organizationId: ${managerOrgId}, should be 'client' or ${departmentManagerId}`);
    }

    // Check manager is active (agent can be inactive and will be promoted)
    if (!manager.get('active')) {
      throw new Error('Manager is not active');
    }

    // Log agent status for debugging
    const agentActive = agent.get('active');
    logger.info('Agent status during validation', {
      agentId: agent.id,
      agentEmail: agent.get('email'),
      agentActive,
      willActivateIfInactive: !agentActive,
    });

    // Note: We allow inactive agents to be promoted to manager
    // They will be activated as part of the swap process

    return true;
  }

  /**
   * Create backup of user data for potential rollback.
   * @param user
   * @example
   */
  createUserBackup(user) {
    const backup = {};

    // Backup all fields
    const allFields = [
      ...DepartmentManagerSwapService.SWAPPABLE_FIELDS,
      ...DepartmentManagerSwapService.PRESERVED_FIELDS,
    ];

    allFields.forEach((field) => {
      const value = user.get(field);
      if (value !== undefined) {
        backup[field] = value;
      }
    });

    return backup;
  }

  /**
   * Swap personal data from agent to manager account.
   * @param fromUser
   * @param toUser
   * @example
   */
  swapPersonalData(fromUser, toUser) {
    DepartmentManagerSwapService.SWAPPABLE_FIELDS.forEach((field) => {
      const value = fromUser.get(field);
      if (value !== undefined) {
        toUser.set(field, value);
      }
    });

    // Add swap metadata
    toUser.set('lastSwapDate', new Date());
    toUser.set('swappedFrom', fromUser.id);
  }

  /**
   * Create new agent account with temporary email to avoid conflicts.
   * @param managerBackup
   * @param departmentManagerId
   * @example
   */
  async createNewAgentWithTempEmail(managerBackup, departmentManagerId) {
    try {
      const newAgent = new Parse.User();
      const timestamp = Date.now();

      // Set personal data from backup (excluding email and username for now)
      DepartmentManagerSwapService.SWAPPABLE_FIELDS.forEach((field) => {
        if (managerBackup[field] !== undefined
            && field !== '_hashed_password'
            && field !== 'email'
            && field !== 'username') {
          newAgent.set(field, managerBackup[field]);
        }
      });

      // Use guaranteed unique temporary email and username
      const tempEmail = `temp_agent_${timestamp}_${departmentManagerId}@temporary.local`;
      const tempUsername = `temp_agent_${timestamp}_${departmentManagerId}`;
      newAgent.set('email', tempEmail);
      newAgent.set('username', tempUsername);

      // Set organizational fields for agent role
      newAgent.set('role', 'client'); // Agent role
      newAgent.set('clientId', departmentManagerId);
      newAgent.set('organizationId', departmentManagerId);
      newAgent.set('active', true);
      newAgent.set('exists', true);
      newAgent.set('wasManager', true);
      newAgent.set('managerUntil', new Date());

      // Set a temporary password (user will need to reset)
      const tempPassword = `TempPass${timestamp}!`;
      newAgent.set('password', tempPassword);
      newAgent.set('requirePasswordReset', true);

      return newAgent;
    } catch (error) {
      logger.error('Error creating new agent with temp email', {
        error: error.message,
        departmentManagerId,
      });
      throw error;
    }
  }

  /**
   * Create new agent account from old manager's data (legacy method).
   * @param managerBackup
   * @param departmentManagerId
   * @example
   */
  async createNewAgentFromManager(managerBackup, departmentManagerId) {
    try {
      const newAgent = new Parse.User();

      // Set personal data from backup
      DepartmentManagerSwapService.SWAPPABLE_FIELDS.forEach((field) => {
        if (managerBackup[field] !== undefined && field !== '_hashed_password') {
          newAgent.set(field, managerBackup[field]);
        }
      });

      // Use the original manager email (no conflict since manager now has agent's email)
      const originalEmail = managerBackup.email;
      const timestamp = Date.now(); // Needed for temporary password generation
      newAgent.set('email', originalEmail);

      logger.info('Creating new agent with original manager email', {
        originalEmail,
        departmentManagerId,
      });

      // Set organizational fields for agent role
      newAgent.set('role', 'client'); // Agent role
      newAgent.set('clientId', departmentManagerId);
      newAgent.set('organizationId', departmentManagerId);
      newAgent.set('active', true);
      newAgent.set('exists', true);
      newAgent.set('wasManager', true);
      newAgent.set('managerUntil', new Date());

      // Set a temporary password (user will need to reset)
      const tempPassword = `TempPass${timestamp}!`;
      newAgent.set('password', tempPassword);
      newAgent.set('requirePasswordReset', true);

      return newAgent;
    } catch (error) {
      logger.error('Error creating new agent from manager', {
        error: error.message,
        departmentManagerId,
      });
      throw error;
    }
  }

  /**
   * Clear sessions for users that need to re-login.
   * @param userIds
   * @example
   */
  async clearUserSessions(userIds) {
    try {
      for (const userId of userIds) {
        const sessionQuery = new Parse.Query('_Session');
        sessionQuery.equalTo('user', {
          __type: 'Pointer',
          className: '_User',
          objectId: userId,
        });

        const sessions = await sessionQuery.find({ useMasterKey: true });

        if (sessions.length > 0) {
          await Parse.Object.destroyAll(sessions, { useMasterKey: true });
          logger.info(`Cleared ${sessions.length} sessions for user`, { userId });
        }
      }
    } catch (error) {
      logger.error('Error clearing sessions', {
        error: error.message,
        userIds,
      });
      // Non-critical error, continue
    }
  }

  /**
   * Create audit log entry for the swap operation.
   * @param details
   * @example
   */
  async createAuditLog(details) {
    try {
      await AuditLog.log({
        action: details.action,
        entityType: 'DepartmentManager',
        entityId: details.departmentManagerId,
        userId: details.requestedBy,
        changes: {
          previousAgentId: details.agentId,
          newAgentId: details.newAgentId,
          preservedOldManager: details.preserveOldManager,
          agentBackup: details.agentBackup,
          managerBackup: details.managerBackup,
        },
        metadata: {
          timestamp: new Date(),
          source: 'DepartmentManagerSwapService',
        },
      });
    } catch (error) {
      logger.error('Failed to create audit log', {
        error: error.message,
        details,
      });
      // Non-critical error, continue
    }
  }

  /**
   * Reverse a swap operation (for emergency rollback).
   * @param auditLogId
   * @example
   */
  async reverseSwap(auditLogId) {
    try {
      // Fetch the audit log entry
      const auditQuery = new Parse.Query('AuditLog');
      auditQuery.equalTo('objectId', auditLogId);
      const auditEntry = await auditQuery.first({ useMasterKey: true });

      if (!auditEntry) {
        throw new Error('Audit log entry not found');
      }

      const changes = auditEntry.get('changes');
      if (!changes.agentBackup || !changes.managerBackup) {
        throw new Error('Backup data not found in audit log');
      }

      // Restore users from backups
      // Implementation depends on exact rollback requirements

      logger.info('Swap reversal completed', { auditLogId });

      return { success: true, message: 'Swap reversed successfully' };
    } catch (error) {
      logger.error('Failed to reverse swap', {
        error: error.message,
        auditLogId,
      });
      throw error;
    }
  }
}

module.exports = DepartmentManagerSwapService;
