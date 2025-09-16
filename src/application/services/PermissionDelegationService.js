/**
 * Permission Delegation Service - Manages manager-employee permission delegation
 * Implements OAUTH-3-04: Delegación entre Gerentes y Empleados
 * Implements OAUTH-3-07: Permisos Temporales Elevados Casos Especiales.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const OAuthPermissionService = require('./OAuthPermissionService');
const PermissionInheritanceService = require('./PermissionInheritanceService');
// const AmexingUser = require('../../domain/models/AmexingUser'); // Reserved for future validation implementation
const logger = require('../../infrastructure/logger');

class PermissionDelegationService {
  constructor() {
    // Delegation types and their rules
    this.delegationTypes = {
      temporary: {
        maxDuration: 24 * 60 * 60 * 1000, // 24 hours
        autoExpire: true,
        requiresApproval: false,
        auditLevel: 'standard',
      },
      project: {
        maxDuration: 30 * 24 * 60 * 60 * 1000, // 30 days
        autoExpire: true,
        requiresApproval: true,
        auditLevel: 'detailed',
      },
      emergency: {
        maxDuration: 4 * 60 * 60 * 1000, // 4 hours
        autoExpire: true,
        requiresApproval: false,
        auditLevel: 'critical',
      },
      coverage: {
        maxDuration: 7 * 24 * 60 * 60 * 1000, // 7 days
        autoExpire: true,
        requiresApproval: true,
        auditLevel: 'detailed',
      },
    };

    // Permission levels that can be delegated
    this.delegatablePermissions = [
      'team_management',
      'employee_access',
      'department_admin',
      'project_management',
      'client_access',
      'report_access',
      'approval_authority',
      'budget_access',
    ];

    // Permissions that cannot be delegated (security critical)
    this.nonDelegatablePermissions = [
      'admin_full',
      'system_admin',
      'user_management',
      'security_config',
      'compliance_admin',
      'audit_full',
    ];
  }

  /**
   * Creates a permission delegation from manager to employee.
   * @param {object} delegationData - Delegation data.
   * @returns {Promise<object>} Delegation result.
   * @example
   * const service = new PermissionDelegationService();
   * const result = await service.createDelegation({
   *   managerId: 'mgr123',
   *   employeeId: 'emp456',
   *   permissions: ['team_management']
   * });
   */
  async createDelegation(delegationData) {
    try {
      const {
        managerId,
        employeeId,
        permissions,
        delegationType,
        duration,
        reason,
        context,
        autoExpire = true,
      } = delegationData;

      // Validate delegation request
      await this.validateDelegationRequest(managerId, employeeId, permissions, delegationType);

      // Calculate expiration time
      const expiresAt = this.calculateExpirationTime(delegationType, duration);

      // Create delegation record
      const delegation = await this.createDelegationRecord({
        managerId,
        employeeId,
        permissions,
        delegationType,
        reason,
        context,
        expiresAt,
        autoExpire,
      });

      // Apply delegated permissions to employee
      await this.applyDelegatedPermissions(employeeId, permissions, delegation.id, expiresAt);

      // Schedule expiration if auto-expire is enabled
      if (autoExpire) {
        await this.scheduleExpiration(delegation.id, expiresAt);
      }

      logger.logSecurityEvent('PERMISSION_DELEGATION_CREATED', managerId, {
        delegationId: delegation.id,
        employeeId,
        permissions,
        delegationType,
        duration: duration || 'default',
        expiresAt: expiresAt.toISOString(),
        reason,
      });

      return {
        success: true,
        delegationId: delegation.id,
        managerId,
        employeeId,
        permissions,
        expiresAt,
        delegationType,
        message: 'Permission delegation created successfully',
      };
    } catch (error) {
      logger.error('Error creating permission delegation:', error);
      throw error;
    }
  }

  /**
   * Validates delegation request.
   * @param {string} managerId - Manager user ID.
   * @param {string} employeeId - Employee user ID.
   * @param {Array} permissions - Permissions to delegate.
   * @param {string} delegationType - Type of delegation.
   * @returns {Promise<void>} Completes when validation passes, throws if fails
   * @example
   * const service = new PermissionDelegationService();
   * await service.validateDelegationRequest('mgr123', 'emp456', ['team_management'], 'temporary');
   */
  async validateDelegationRequest(managerId, employeeId, permissions, delegationType) {
    try {
      // Validate delegation type
      if (!this.delegationTypes[delegationType]) {
        throw new Error(`Invalid delegation type: ${delegationType}`);
      }

      // Validate manager has the permissions to delegate
      // await new Parse.Query(AmexingUser).get(managerId, { useMasterKey: true }); // Manager validation reserved for future implementation

      for (const permission of permissions) {
        // Check if permission is delegatable
        if (this.nonDelegatablePermissions.includes(permission)) {
          throw new Error(`Permission '${permission}' cannot be delegated`);
        }

        if (!this.delegatablePermissions.includes(permission)) {
          throw new Error(`Permission '${permission}' is not in delegatable permissions list`);
        }

        // Check if manager has the permission
        const hasPermission = await OAuthPermissionService.hasPermission(managerId, permission);
        if (!hasPermission) {
          throw new Error(`Manager does not have permission '${permission}' to delegate`);
        }
      }

      // Validate manager-employee relationship
      await this.validateManagerEmployeeRelationship(managerId, employeeId);

      // Check delegation limits
      await this.validateDelegationLimits(managerId, delegationType);
    } catch (error) {
      logger.error('Delegation validation failed:', error);
      throw error;
    }
  }

  /**
   * Validates manager-employee relationship.
   * @param {string} managerId - Manager user ID.
   * @param {string} employeeId - Employee user ID.
   * @returns {Promise<void>} Completes when validation passes, throws if fails
   * @example
   * const service = new PermissionDelegationService();
   * await service.validateManagerEmployeeRelationship('mgr123', 'emp456');
   */
  async validateManagerEmployeeRelationship(managerId, employeeId) {
    try {
      // Check if manager has management authority over employee
      const managerEmployeeQuery = new Parse.Query('ClientEmployee');
      managerEmployeeQuery.equalTo('userId', managerId);
      managerEmployeeQuery.containedIn('accessLevel', ['manager', 'supervisor', 'admin']);
      managerEmployeeQuery.equalTo('active', true);

      const managerRecord = await managerEmployeeQuery.first({ useMasterKey: true });

      if (!managerRecord) {
        throw new Error('User does not have management authority');
      }

      // Check if employee is in the same department/client
      const employeeQuery = new Parse.Query('ClientEmployee');
      employeeQuery.equalTo('userId', employeeId);
      employeeQuery.equalTo('clientId', managerRecord.get('clientId'));
      employeeQuery.equalTo('active', true);

      const employeeRecord = await employeeQuery.first({ useMasterKey: true });

      if (!employeeRecord) {
        throw new Error('Employee not found in manager\'s department/client');
      }

      // Additional check: manager must have higher access level
      const managerLevel = this.getAccessLevelValue(managerRecord.get('accessLevel'));
      const employeeLevel = this.getAccessLevelValue(employeeRecord.get('accessLevel'));

      if (managerLevel <= employeeLevel) {
        throw new Error('Manager must have higher access level than employee');
      }
    } catch (error) {
      logger.error('Manager-employee relationship validation failed:', error);
      throw error;
    }
  }

  /**
   * Gets numeric value for access level comparison.
   * @param {string} accessLevel - Access level string.
   * @returns {number} Numeric value.
   * @example
   * const service = new PermissionDelegationService();
   * const level = service.getAccessLevelValue('manager'); // Returns 5
   */
  getAccessLevelValue(accessLevel) {
    const levels = {
      employee: 1,
      senior: 2,
      lead: 3,
      supervisor: 4,
      manager: 5,
      admin: 6,
    };
    return levels[accessLevel] || 0;
  }

  /**
   * Validates delegation limits for manager.
   * @param {string} managerId - Manager user ID.
   * @param {string} delegationType - Delegation type.
   * @returns {Promise<void>} Completes when validation passes, throws if fails
   * @example
   * const service = new PermissionDelegationService();
   * await service.validateDelegationLimits('mgr123', 'temporary');
   */
  async validateDelegationLimits(managerId, delegationType) {
    try {
      // Check active delegations count
      const activeDelegationsQuery = new Parse.Query('PermissionDelegation');
      activeDelegationsQuery.equalTo('managerId', managerId);
      activeDelegationsQuery.equalTo('active', true);
      activeDelegationsQuery.greaterThan('expiresAt', new Date());

      const activeDelegations = await activeDelegationsQuery.count({ useMasterKey: true });

      // Set limits based on delegation type
      const limits = {
        temporary: 10,
        project: 5,
        emergency: 3,
        coverage: 3,
      };

      const limit = limits[delegationType] || 5;

      if (activeDelegations >= limit) {
        throw new Error(`Maximum active delegations (${limit}) reached for delegation type: ${delegationType}`);
      }
    } catch (error) {
      logger.error('Delegation limits validation failed:', error);
      throw error;
    }
  }

  /**
   * Calculates expiration time for delegation.
   * @param {string} delegationType - Delegation type.
   * @param {number} customDuration - Custom duration in milliseconds (optional).
   * @returns {Date} Expiration date.
   * @example
   * const service = new PermissionDelegationService();
   * const expiration = service.calculateExpirationTime('temporary', 1000 * 60 * 60); // 1 hour
   */
  calculateExpirationTime(delegationType, customDuration) {
    const delegationConfig = this.delegationTypes[delegationType];
    const duration = customDuration || delegationConfig.maxDuration;

    // Don't exceed maximum duration for the type
    const finalDuration = Math.min(duration, delegationConfig.maxDuration);

    return new Date(Date.now() + finalDuration);
  }

  /**
   * Creates delegation record in database.
   * @param {object} data - Delegation data.
   * @returns {Promise<Parse.Object>} Created delegation record.
   * @example
   * const service = new PermissionDelegationService();
   * const delegation = await service.createDelegationRecord(delegationData);
   */
  async createDelegationRecord(data) {
    try {
      const DelegationClass = Parse.Object.extend('PermissionDelegation');
      const delegation = new DelegationClass();

      delegation.set('managerId', data.managerId);
      delegation.set('employeeId', data.employeeId);
      delegation.set('permissions', data.permissions);
      delegation.set('delegationType', data.delegationType);
      delegation.set('reason', data.reason);
      delegation.set('context', data.context);
      delegation.set('expiresAt', data.expiresAt);
      delegation.set('autoExpire', data.autoExpire);
      delegation.set('createdAt', new Date());
      delegation.set('active', true);

      await delegation.save(null, { useMasterKey: true });

      return delegation;
    } catch (error) {
      logger.error('Error creating delegation record:', error);
      throw error;
    }
  }

  /**
   * Applies delegated permissions to employee.
   * @param {string} employeeId - Employee user ID.
   * @param {Array} permissions - Permissions to apply.
   * @param {string} delegationId - Delegation record ID.
   * @param {Date} expiresAt - Expiration date.
   * @returns {Promise<void>} Completes when permissions are applied
   * @example
   * const service = new PermissionDelegationService();
   * await service.applyDelegatedPermissions('emp456', ['team_management'], 'del123', expirationDate);
   */
  async applyDelegatedPermissions(employeeId, permissions, delegationId, expiresAt) {
    try {
      // Create permission overrides for each delegated permission
      for (const permission of permissions) {
        await PermissionInheritanceService.createPermissionOverride({
          userId: employeeId,
          type: 'elevate',
          permission,
          reason: `Delegated permission from delegation ${delegationId}`,
          grantedBy: delegationId,
          context: `delegation_${delegationId}`,
          priority: 90, // High priority for delegations
          expiresAt,
        });
      }

      logger.logSecurityEvent('DELEGATED_PERMISSIONS_APPLIED', employeeId, {
        delegationId,
        permissions,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      logger.error('Error applying delegated permissions:', error);
      throw error;
    }
  }

  /**
   * Schedules delegation expiration.
   * @param {string} delegationId - Delegation record ID.
   * @param {Date} expiresAt - Expiration date.
   * @returns {Promise<void>} Completes when expiration is scheduled
   * @example
   * const service = new PermissionDelegationService();
   * await service.scheduleExpiration('del123', expirationDate);
   */
  async scheduleExpiration(delegationId, expiresAt) {
    try {
      const timeToExpiration = expiresAt.getTime() - Date.now();

      if (timeToExpiration > 0) {
        setTimeout(async () => {
          try {
            await this.expireDelegation(delegationId);
          } catch (error) {
            logger.error('Error in scheduled delegation expiration:', error);
          }
        }, timeToExpiration);
      }
    } catch (error) {
      logger.error('Error scheduling delegation expiration:', error);
    }
  }

  /**
   * Expires a delegation and removes delegated permissions.
   * @param {string} delegationId - Delegation record ID.
   * @returns {Promise<void>} Completes when delegation is expired
   * @example
   * const service = new PermissionDelegationService();
   * await service.expireDelegation('del123');
   */
  async expireDelegation(delegationId) {
    try {
      // Get delegation record
      const delegationQuery = new Parse.Query('PermissionDelegation');
      const delegation = await delegationQuery.get(delegationId, { useMasterKey: true });

      if (!delegation || !delegation.get('active')) {
        return; // Already expired or inactive
      }

      const employeeId = delegation.get('employeeId');
      const permissions = delegation.get('permissions');

      // Deactivate delegation
      delegation.set('active', false);
      delegation.set('expiredAt', new Date());
      delegation.set('expiredBy', 'system_auto');
      await delegation.save(null, { useMasterKey: true });

      // Remove delegated permission overrides
      const overrideQuery = new Parse.Query('PermissionOverride');
      overrideQuery.equalTo('context', `delegation_${delegationId}`);
      overrideQuery.equalTo('active', true);

      const overrides = await overrideQuery.find({ useMasterKey: true });

      for (const override of overrides) {
        override.set('active', false);
        override.set('deactivatedAt', new Date());
        override.set('deactivationReason', 'delegation_expired');
        await override.save(null, { useMasterKey: true });
      }

      logger.logSecurityEvent('PERMISSION_DELEGATION_EXPIRED', employeeId, {
        delegationId,
        managerId: delegation.get('managerId'),
        permissions,
        expiredAt: new Date().toISOString(),
        overridesRemoved: overrides.length,
      });
    } catch (error) {
      logger.error('Error expiring delegation:', error);
      throw error;
    }
  }

  /**
   * Revokes a delegation before expiration.
   * @param {string} delegationId - Delegation record ID.
   * @param {string} revokedBy - User ID who revoked the delegation.
   * @param {string} reason - Reason for revocation.
   * @returns {Promise<object>} Revocation result
   * @example
   * const service = new PermissionDelegationService();
   * const result = await service.revokeDelegation('del123', 'mgr123', 'No longer needed');
   */
  async revokeDelegation(delegationId, revokedBy, reason) {
    try {
      // Get delegation record
      const delegationQuery = new Parse.Query('PermissionDelegation');
      const delegation = await delegationQuery.get(delegationId, { useMasterKey: true });

      if (!delegation || !delegation.get('active')) {
        throw new Error('Delegation not found or already inactive');
      }

      // Validate revocation authority
      const managerId = delegation.get('managerId');
      if (revokedBy !== managerId) {
        // Check if revoker has higher authority
        const hasAuthority = await this.validateRevocationAuthority(revokedBy, managerId);
        if (!hasAuthority) {
          throw new Error('Insufficient authority to revoke this delegation');
        }
      }

      const employeeId = delegation.get('employeeId');
      const permissions = delegation.get('permissions');

      // Deactivate delegation
      delegation.set('active', false);
      delegation.set('revokedAt', new Date());
      delegation.set('revokedBy', revokedBy);
      delegation.set('revocationReason', reason);
      await delegation.save(null, { useMasterKey: true });

      // Remove delegated permission overrides
      const overrideQuery = new Parse.Query('PermissionOverride');
      overrideQuery.equalTo('context', `delegation_${delegationId}`);
      overrideQuery.equalTo('active', true);

      const overrides = await overrideQuery.find({ useMasterKey: true });

      for (const override of overrides) {
        override.set('active', false);
        override.set('deactivatedAt', new Date());
        override.set('deactivationReason', 'delegation_revoked');
        await override.save(null, { useMasterKey: true });
      }

      logger.logSecurityEvent('PERMISSION_DELEGATION_REVOKED', employeeId, {
        delegationId,
        managerId,
        revokedBy,
        permissions,
        reason,
        revokedAt: new Date().toISOString(),
        overridesRemoved: overrides.length,
      });

      return {
        success: true,
        delegationId,
        revokedAt: new Date(),
        overridesRemoved: overrides.length,
      };
    } catch (error) {
      logger.error('Error revoking delegation:', error);
      throw error;
    }
  }

  /**
   * Validates authority to revoke a delegation.
   * @param {string} revokerId - User attempting to revoke.
   * @param {string} managerId - Original manager who created delegation.
   * @returns {Promise<boolean>} True if has authority.
   * @example
   * const service = new PermissionDelegationService();
   * const hasAuthority = await service.validateRevocationAuthority('admin123', 'mgr123');
   */
  async validateRevocationAuthority(revokerId, managerId) {
    try {
      // Check if revoker has admin permissions
      const hasAdminPermission = await OAuthPermissionService.hasPermission(revokerId, 'admin_full');
      if (hasAdminPermission) {
        return true;
      }

      // Check if revoker is superior to the manager
      const revokerEmployee = await this.getEmployeeRecord(revokerId);
      const managerEmployee = await this.getEmployeeRecord(managerId);

      if (revokerEmployee && managerEmployee) {
        const revokerLevel = this.getAccessLevelValue(revokerEmployee.get('accessLevel'));
        const managerLevel = this.getAccessLevelValue(managerEmployee.get('accessLevel'));

        return revokerLevel > managerLevel;
      }

      return false;
    } catch (error) {
      logger.error('Error validating revocation authority:', error);
      return false;
    }
  }

  /**
   * Gets employee record for a user.
   * @param {string} userId - User ID.
   * @returns {Promise<Parse.Object|null>} Employee record.
   * @example
   * const service = new PermissionDelegationService();
   * const employeeRecord = await service.getEmployeeRecord('user123');
   */
  async getEmployeeRecord(userId) {
    try {
      const employeeQuery = new Parse.Query('ClientEmployee');
      employeeQuery.equalTo('userId', userId);
      employeeQuery.equalTo('active', true);

      return await employeeQuery.first({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting employee record:', error);
      return null;
    }
  }

  /**
   * Creates temporary elevated permissions for emergency cases.
   * @param {object} elevationData - Elevation data.
   * @returns {Promise<object>} Elevation result.
   * @example
   * const service = new PermissionDelegationService();
   * const result = await service.createEmergencyElevation({
   *   userId: 'user123',
   *   permissions: ['admin_access'],
   *   reason: 'System emergency'
   * });
   */
  async createEmergencyElevation(elevationData) {
    try {
      const {
        userId,
        permissions,
        reason,
        duration = 4 * 60 * 60 * 1000, // 4 hours default
        elevatedBy,
        context = 'emergency',
      } = elevationData;

      // Validate emergency elevation authority
      const hasAuthority = await this.validateEmergencyAuthority(elevatedBy);
      if (!hasAuthority) {
        throw new Error('Insufficient authority for emergency permission elevation');
      }

      // Calculate expiration time (max 24 hours for emergency)
      const { maxDuration } = this.delegationTypes.emergency;
      const finalDuration = Math.min(duration, maxDuration);
      const expiresAt = new Date(Date.now() + finalDuration);

      // Create permission overrides for emergency elevation
      const overrides = [];
      for (const permission of permissions) {
        const override = await PermissionInheritanceService.createPermissionOverride({
          userId,
          type: 'elevate',
          permission,
          reason: `Emergency elevation: ${reason}`,
          grantedBy: elevatedBy,
          context: `emergency_${Date.now()}`,
          priority: 95, // Highest priority for emergency
          expiresAt,
        });
        overrides.push(override.id);
      }

      logger.logSecurityEvent('EMERGENCY_PERMISSION_ELEVATION', userId, {
        permissions,
        elevatedBy,
        reason,
        duration: finalDuration,
        expiresAt: expiresAt.toISOString(),
        overrideCount: overrides.length,
      });

      return {
        success: true,
        userId,
        permissions,
        expiresAt,
        overrides,
        emergencyContext: context,
      };
    } catch (error) {
      logger.error('Error creating emergency elevation:', error);
      throw error;
    }
  }

  /**
   * Validates authority for emergency permission elevation.
   * @param {string} elevatedBy - User requesting elevation.
   * @returns {Promise<boolean>} True if has authority.
   * @example
   * const service = new PermissionDelegationService();
   * const hasAuthority = await service.validateEmergencyAuthority('admin123');
   */
  async validateEmergencyAuthority(elevatedBy) {
    try {
      // Check for emergency elevation permissions
      const emergencyPermissions = [
        'admin_full',
        'system_admin',
        'emergency_admin',
      ];

      for (const permission of emergencyPermissions) {
        const hasPermission = await OAuthPermissionService.hasPermission(elevatedBy, permission);
        if (hasPermission) {
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Error validating emergency authority:', error);
      return false;
    }
  }

  /**
   * Gets active delegations for a manager.
   * @param {string} managerId - Manager user ID.
   * @returns {Promise<Array>} Active delegations.
   * @example
   * const service = new PermissionDelegationService();
   * const activeDelegations = await service.getActiveDelegations('mgr123');
   */
  async getActiveDelegations(managerId) {
    try {
      const delegationQuery = new Parse.Query('PermissionDelegation');
      delegationQuery.equalTo('managerId', managerId);
      delegationQuery.equalTo('active', true);
      delegationQuery.greaterThan('expiresAt', new Date());
      delegationQuery.include('employeeId');
      delegationQuery.descending('createdAt');

      const delegations = await delegationQuery.find({ useMasterKey: true });

      return delegations.map((delegation) => ({
        id: delegation.id,
        employeeId: delegation.get('employeeId'),
        permissions: delegation.get('permissions'),
        delegationType: delegation.get('delegationType'),
        reason: delegation.get('reason'),
        context: delegation.get('context'),
        createdAt: delegation.get('createdAt'),
        expiresAt: delegation.get('expiresAt'),
        autoExpire: delegation.get('autoExpire'),
      }));
    } catch (error) {
      logger.error('Error getting active delegations:', error);
      return [];
    }
  }

  /**
   * Gets delegated permissions for an employee.
   * @param {string} employeeId - Employee user ID.
   * @returns {Promise<Array>} Delegated permissions.
   * @example
   * const service = new PermissionDelegationService();
   * const delegatedPerms = await service.getDelegatedPermissions('emp456');
   */
  async getDelegatedPermissions(employeeId) {
    try {
      const delegationQuery = new Parse.Query('PermissionDelegation');
      delegationQuery.equalTo('employeeId', employeeId);
      delegationQuery.equalTo('active', true);
      delegationQuery.greaterThan('expiresAt', new Date());
      delegationQuery.include('managerId');
      delegationQuery.descending('createdAt');

      const delegations = await delegationQuery.find({ useMasterKey: true });

      return delegations.map((delegation) => ({
        id: delegation.id,
        managerId: delegation.get('managerId'),
        permissions: delegation.get('permissions'),
        delegationType: delegation.get('delegationType'),
        reason: delegation.get('reason'),
        context: delegation.get('context'),
        createdAt: delegation.get('createdAt'),
        expiresAt: delegation.get('expiresAt'),
      }));
    } catch (error) {
      logger.error('Error getting delegated permissions:', error);
      return [];
    }
  }
}

module.exports = new PermissionDelegationService();
