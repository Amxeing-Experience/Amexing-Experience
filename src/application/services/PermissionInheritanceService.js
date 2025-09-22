/**
 * Permission Inheritance Service - Manages permission inheritance from OAuth groups
 * Implements OAUTH-3-01, OAUTH-3-02, OAUTH-3-03 user stories.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const OAuthPermissionService = require('./OAuthPermissionService');
const CorporateOAuthService = require('./CorporateOAuthService');
const AmexingUser = require('../../domain/models/AmexingUser');
const logger = require('../../infrastructure/logger');

/**
 * Permission Inheritance Service - Manages complex permission inheritance workflows.
 * Handles the inheritance of permissions from OAuth groups, corporate configurations,
 * department assignments, and custom permission overrides with conflict resolution.
 *
 * This service orchestrates the complete permission inheritance process, including
 * OAuth group permissions, corporate policy enforcement, department-specific rules,
 * and individual permission overrides with proper precedence and audit trails.
 *
 * Features:
 * - OAuth group permission inheritance
 * - Corporate policy and configuration enforcement
 * - Department-specific permission assignment
 * - Permission override and conflict resolution
 * - Hierarchical permission inheritance
 * - Comprehensive audit logging
 * - Permission validation and cleanup
 * - Dynamic permission updates.
 * @class PermissionInheritanceService
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Initialize inheritance service
 * const inheritanceService = new PermissionInheritanceService();
 *
 * // Process complete permission inheritance for corporate user
 * const oauthProfile = {
 *   groups: ['azure_user_admin', 'dept_sistemas'],
 *   roles: ['manager'],
 *   department: 'IT'
 * };
 * const result = await inheritanceService.processCompleteInheritance(
 *   user, oauthProfile, 'microsoft', corporateConfig
 * );
 *
 * // Apply permission overrides
 * const overrides = [{
 *   type: 'grant',
 *   permission: 'emergency_access',
 *   reason: 'Incident response team member'
 * }];
 * await inheritanceService.applyPermissionOverrides(user, overrides);
 *
 * // Validate inherited permissions
 * const validation = await inheritanceService.validateInheritedPermissions(user);
 */
class PermissionInheritanceService {
  constructor() {
    // Override types and their priority
    this.overrideTypes = {
      grant: 1, // Grant additional permission
      revoke: 2, // Revoke inherited permission
      elevate: 3, // Temporary elevation
      restrict: 4, // Restrict inherited permission
    };
  }

  /**
   * Processes complete permission inheritance for a corporate user.
   * @param {AmexingUser} user - User to process.
   * @param {object} oauthProfile - OAuth profile with groups.
   * @param {string} provider - OAuth provider.
   * @param {object} corporateConfig - Corporate configuration.
   * @returns {Promise<object>} Complete inheritance result.
   * @example
   * const service = new PermissionInheritanceService();
   * const result = await service.processCompleteInheritance(user, oauthProfile, 'microsoft', corporateConfig);
   */
  async processCompleteInheritance(user, oauthProfile, provider, corporateConfig) {
    try {
      const userId = user.id;

      logger.logSecurityEvent('PERMISSION_INHERITANCE_STARTED', userId, {
        provider,
        corporateClient: corporateConfig?.clientName,
        email: OAuthPermissionService.maskEmail(user.get('email')),
      });

      // Step 1: Inherit permissions from OAuth groups
      const oauthInheritance = await OAuthPermissionService.inheritPermissionsFromOAuth(user, oauthProfile, provider);

      // Step 2: Add department-specific permissions
      const departmentPermissions = await this.addDepartmentPermissions(user, oauthProfile, corporateConfig);

      // Step 3: Apply any individual overrides
      const overrides = await this.applyIndividualOverrides(user);

      // Step 4: Validate permission hierarchy and conflicts
      const finalPermissions = await this.validateAndResolvePermissions(
        user,
        oauthInheritance.inheritedPermissions,
        departmentPermissions,
        overrides
      );

      // Step 5: Create comprehensive inheritance record
      const masterRecord = await this.createMasterInheritanceRecord({
        userId,
        oauthInheritance,
        departmentPermissions,
        overrides,
        finalPermissions,
        provider,
        corporateConfig,
      });

      logger.logSecurityEvent('PERMISSION_INHERITANCE_COMPLETED', userId, {
        totalPermissions: finalPermissions.length,
        oauthPermissions: oauthInheritance.inheritedPermissions.length,
        departmentPermissions: departmentPermissions.length,
        overrides: overrides.length,
        masterRecordId: masterRecord.id,
      });

      return {
        success: true,
        userId,
        finalPermissions,
        oauthInheritance,
        departmentPermissions,
        overrides,
        masterRecordId: masterRecord.id,
      };
    } catch (error) {
      logger.error('Error processing complete permission inheritance:', error);
      throw error;
    }
  }

  /**
   * Adds department-specific permissions based on user's department
   * Implements OAUTH-3-02: Permisos Específicos por Departamento via OAuth.
   * @param {AmexingUser} user - User object.
   * @param {object} oauthProfile - OAuth profile.
   * @param {object} corporateConfig - Corporate configuration.
   * @returns {Promise<Array>} Department permissions.
   * @example
   * const service = new PermissionInheritanceService();
   * const deptPerms = await service.addDepartmentPermissions(user, oauthProfile, corporateConfig);
   */
  async addDepartmentPermissions(user, oauthProfile, corporateConfig) {
    try {
      const userId = user.id;
      let departmentPermissions = [];

      // Get user's department from employee record
      const employeeQuery = new Parse.Query('ClientEmployee');
      employeeQuery.equalTo('userId', userId);
      employeeQuery.equalTo('active', true);
      employeeQuery.include('departmentId');

      const employee = await employeeQuery.first({ useMasterKey: true });

      if (employee && employee.get('departmentId')) {
        const departmentId = employee.get('departmentId');

        // Get department-specific permissions
        departmentPermissions = await OAuthPermissionService.getDepartmentPermissions(userId, departmentId);

        // Also check for OAuth profile department information
        const oauthDepartment = await this.extractDepartmentFromOAuth(oauthProfile, corporateConfig);
        if (oauthDepartment && oauthDepartment !== departmentId) {
          const additionalPerms = await OAuthPermissionService.getDepartmentPermissions(userId, oauthDepartment);
          departmentPermissions = [...new Set([...departmentPermissions, ...additionalPerms])];
        }

        // Create department permission record
        await this.createDepartmentPermissionRecord({
          userId,
          departmentId,
          oauthDepartment,
          permissions: departmentPermissions,
          source: 'department_inheritance',
        });

        logger.logSecurityEvent('DEPARTMENT_PERMISSIONS_INHERITED', userId, {
          departmentId,
          oauthDepartment,
          permissionCount: departmentPermissions.length,
          permissions: departmentPermissions,
        });
      }

      return departmentPermissions;
    } catch (error) {
      logger.error('Error adding department permissions:', error);
      return [];
    }
  }

  /**
   * Extracts department information from OAuth profile.
   * @param {object} oauthProfile - OAuth profile.
   * @param {object} corporateConfig - Corporate configuration.
   * @returns {Promise<string|null>} Department ID or null.
   * @example
   * const service = new PermissionInheritanceService();
   * const deptId = await service.extractDepartmentFromOAuth(oauthProfile, corporateConfig);
   */
  async extractDepartmentFromOAuth(oauthProfile, corporateConfig) {
    if (!corporateConfig || !corporateConfig.departmentMapping) {
      return null;
    }

    // Use the existing department mapping from CorporateOAuthService
    return CorporateOAuthService.mapDepartmentFromOAuth(oauthProfile, corporateConfig);
  }

  /**
   * Applies individual permission overrides for a user
   * Implements OAUTH-3-03: Override Permisos Individuales Manteniendo OAuth.
   * @param {AmexingUser} user - User object.
   * @returns {Promise<Array>} Applied overrides.
   * @example
   * const service = new PermissionInheritanceService();
   * const overrides = await service.applyIndividualOverrides(user);
   */
  async applyIndividualOverrides(user) {
    try {
      const userId = user.id;

      // Query for active permission overrides
      const overrideQuery = new Parse.Query('PermissionOverride');
      overrideQuery.equalTo('userId', userId);
      overrideQuery.equalTo('active', true);
      overrideQuery.descending('priority');

      const overrides = await overrideQuery.find({ useMasterKey: true });

      const appliedOverrides = [];

      for (const override of overrides) {
        const overrideData = {
          id: override.id,
          type: override.get('overrideType'),
          permission: override.get('permission'),
          reason: override.get('reason'),
          grantedBy: override.get('grantedBy'),
          expiresAt: override.get('expiresAt'),
          context: override.get('context'),
          priority: override.get('priority'),
        };

        // Check if override is still valid
        if (overrideData.expiresAt && overrideData.expiresAt < new Date()) {
          // Override expired, deactivate it
          override.set('active', false);
          override.set('deactivatedAt', new Date());
          override.set('deactivationReason', 'expired');
          await override.save(null, { useMasterKey: true });

          logger.logSecurityEvent('PERMISSION_OVERRIDE_EXPIRED', userId, {
            overrideId: override.id,
            permission: overrideData.permission,
            type: overrideData.type,
          });
          // Skip expired override
          // continue; // Replaced with conditional logic
        } else {
          appliedOverrides.push(overrideData);
        }
      }

      if (appliedOverrides.length > 0) {
        logger.logSecurityEvent('PERMISSION_OVERRIDES_APPLIED', userId, {
          overrideCount: appliedOverrides.length,
          overrides: appliedOverrides.map((o) => ({
            type: o.type,
            permission: o.permission,
            priority: o.priority,
          })),
        });
      }

      return appliedOverrides;
    } catch (error) {
      logger.error('Error applying individual permission overrides:', error);
      return [];
    }
  }

  /**
   * Validates and resolves final permissions with hierarchy and conflicts.
   * @param {AmexingUser} user - User object.
   * @param {Array} oauthPermissions - OAuth inherited permissions.
   * @param {Array} departmentPermissions - Department permissions.
   * @param {Array} overrides - Individual overrides.
   * @returns {Promise<Array>} Final resolved permissions.
   * @example
   * const service = new PermissionInheritanceService();
   * const finalPerms = await service.validateAndResolvePermissions(user, oauthPerms, deptPerms, overrides);
   */
  async validateAndResolvePermissions(user, oauthPermissions, departmentPermissions, overrides) {
    try {
      const userId = user.id;

      // Start with OAuth permissions as base
      const finalPermissions = new Set(oauthPermissions);

      // Add department permissions
      departmentPermissions.forEach((permission) => finalPermissions.add(permission));

      // Apply overrides with priority
      const sortedOverrides = overrides.sort((a, b) => b.priority - a.priority);

      for (const override of sortedOverrides) {
        switch (override.type) {
          case 'grant':
            finalPermissions.add(override.permission);
            break;
          case 'revoke':
            finalPermissions.delete(override.permission);
            break;
          case 'restrict':
            // Restrict overrides revoke permission regardless of other sources
            finalPermissions.delete(override.permission);
            break;
          case 'elevate':
            // Elevate adds temporary high-level permission
            finalPermissions.add(override.permission);
            break;
          default:
            // Unknown override type, skip
            logger.warn(`Unknown override type: ${override.type}`);
            break;
        }
      }

      // Validate permission hierarchy consistency
      const validatedPermissions = this.validatePermissionHierarchy(Array.from(finalPermissions));

      // Update user's permissions
      await OAuthPermissionService.applyPermissionsToUser(user, validatedPermissions, 'oauth_inherited_with_overrides');

      logger.logSecurityEvent('PERMISSIONS_VALIDATED_AND_RESOLVED', userId, {
        basePermissions: oauthPermissions.length,
        departmentPermissions: departmentPermissions.length,
        overrides: overrides.length,
        finalPermissions: validatedPermissions.length,
        permissions: validatedPermissions,
      });

      return validatedPermissions;
    } catch (error) {
      logger.error('Error validating and resolving permissions:', error);
      throw error;
    }
  }

  /**
   * Validates permission hierarchy consistency.
   * @param {Array} permissions - Permissions to validate.
   * @returns {Array} Validated permissions.
   * @example
   * const service = new PermissionInheritanceService();
   * const validatedPerms = service.validatePermissionHierarchy(['admin_full', 'basic_access']);
   */
  validatePermissionHierarchy(permissions) {
    const hierarchy = OAuthPermissionService.permissionHierarchy;
    const validatedPermissions = new Set(permissions);

    // Remove redundant lower-level permissions if higher-level exists
    for (const permission of permissions) {
      const permissionLevel = hierarchy[permission] || 0;

      for (const otherPermission of permissions) {
        if (permission !== otherPermission) {
          const otherLevel = hierarchy[otherPermission] || 0;

          // If we have a higher-level permission, we can remove lower ones that it encompasses
          if (otherLevel > permissionLevel && this.permissionIncludes(otherPermission, permission)) {
            validatedPermissions.delete(permission);
            break;
          }
        }
      }
    }

    return Array.from(validatedPermissions);
  }

  /**
   * Checks if a higher-level permission includes a lower-level one.
   * @param {string} higherPermission - Higher-level permission.
   * @param {string} lowerPermission - Lower-level permission.
   * @returns {boolean} True if higher includes lower.
   * @example
   * const service = new PermissionInheritanceService();
   * const includes = service.permissionIncludes('admin_full', 'basic_access'); // Returns true
   */
  permissionIncludes(higherPermission, lowerPermission) {
    // Define permission inclusion rules
    const inclusionRules = {
      admin_full: ['user_management', 'system_config', 'department_admin', 'team_management'],
      system_admin: ['technical_access', 'user_support'],
      department_admin: ['team_management', 'employee_access'],
      user_management: ['employee_management', 'basic_admin'],
      team_management: ['employee_access', 'basic_access'],
    };

    const includes = inclusionRules[higherPermission] || [];
    return includes.includes(lowerPermission);
  }

  /**
   * Creates comprehensive master inheritance record.
   * @param {object} data - Inheritance data.
   * @returns {Promise<Parse.Object>} Created record.
   * @example
   * const service = new PermissionInheritanceService();
   * const record = await service.createMasterInheritanceRecord(inheritanceData);
   */
  async createMasterInheritanceRecord(data) {
    try {
      const MasterInheritanceClass = Parse.Object.extend('PermissionInheritanceMaster');
      const record = new MasterInheritanceClass();

      record.set('userId', data.userId);
      record.set('provider', data.provider);
      record.set('corporateClient', data.corporateConfig?.clientName);
      record.set('oauthPermissions', data.oauthInheritance.inheritedPermissions);
      record.set('departmentPermissions', data.departmentPermissions);
      record.set('overrides', data.overrides);
      record.set('finalPermissions', data.finalPermissions);
      record.set('processedAt', new Date());
      record.set('active', true);

      await record.save(null, { useMasterKey: true });

      return record;
    } catch (error) {
      logger.error('Error creating master inheritance record:', error);
      throw error;
    }
  }

  /**
   * Creates department permission record.
   * @param {object} data - Department permission data.
   * @returns {Promise<Parse.Object>} Created record.
   * @example
   * const service = new PermissionInheritanceService();
   * const record = await service.createDepartmentPermissionRecord(deptPermissionData);
   */
  async createDepartmentPermissionRecord(data) {
    try {
      const DepartmentPermissionClass = Parse.Object.extend('DepartmentPermission');
      const record = new DepartmentPermissionClass();

      record.set('userId', data.userId);
      record.set('departmentId', data.departmentId);
      record.set('oauthDepartment', data.oauthDepartment);
      record.set('permissions', data.permissions);
      record.set('source', data.source);
      record.set('assignedAt', new Date());
      record.set('active', true);

      await record.save(null, { useMasterKey: true });

      return record;
    } catch (error) {
      logger.error('Error creating department permission record:', error);
      throw error;
    }
  }

  /**
   * Creates individual permission override.
   * @param {object} overrideData - Override data.
   * @returns {Promise<Parse.Object>} Created override.
   * @example
   * const service = new PermissionInheritanceService();
   * const override = await service.createPermissionOverride({
   *   userId: 'user123',
   *   type: 'grant',
   *   permission: 'admin_access'
   * });
   */
  async createPermissionOverride(overrideData) {
    try {
      const PermissionOverrideClass = Parse.Object.extend('PermissionOverride');
      const override = new PermissionOverrideClass();

      override.set('userId', overrideData.userId);
      override.set('overrideType', overrideData.type);
      override.set('permission', overrideData.permission);
      override.set('reason', overrideData.reason);
      override.set('grantedBy', overrideData.grantedBy);
      override.set('context', overrideData.context);
      override.set('priority', overrideData.priority || this.overrideTypes[overrideData.type]);

      if (overrideData.expiresAt) {
        override.set('expiresAt', overrideData.expiresAt);
      }

      override.set('createdAt', new Date());
      override.set('active', true);

      await override.save(null, { useMasterKey: true });

      logger.logSecurityEvent('PERMISSION_OVERRIDE_CREATED', overrideData.userId, {
        overrideId: override.id,
        type: overrideData.type,
        permission: overrideData.permission,
        grantedBy: overrideData.grantedBy,
        reason: overrideData.reason,
      });

      return override;
    } catch (error) {
      logger.error('Error creating permission override:', error);
      throw error;
    }
  }

  /**
   * Gets complete permission inheritance status for a user.
   * @param {string} userId - User ID.
   * @returns {Promise<object>} Complete inheritance status.
   * @example
   * const service = new PermissionInheritanceService();
   * const status = await service.getInheritanceStatus('user123');
   */
  async getInheritanceStatus(userId) {
    try {
      const masterQuery = new Parse.Query('PermissionInheritanceMaster');
      masterQuery.equalTo('userId', userId);
      masterQuery.equalTo('active', true);
      masterQuery.descending('processedAt');

      const masterRecord = await masterQuery.first({ useMasterKey: true });

      if (!masterRecord) {
        return {
          hasInheritance: false,
          message: 'No permission inheritance found for user',
        };
      }

      return {
        hasInheritance: true,
        provider: masterRecord.get('provider'),
        corporateClient: masterRecord.get('corporateClient'),
        oauthPermissions: masterRecord.get('oauthPermissions'),
        departmentPermissions: masterRecord.get('departmentPermissions'),
        overrides: masterRecord.get('overrides'),
        finalPermissions: masterRecord.get('finalPermissions'),
        processedAt: masterRecord.get('processedAt'),
        recordId: masterRecord.id,
      };
    } catch (error) {
      logger.error('Error getting inheritance status:', error);
      throw error;
    }
  }
}

module.exports = { PermissionInheritanceService };
