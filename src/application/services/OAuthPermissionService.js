/**
 * OAuth Permission Service - Handles permission inheritance from OAuth providers
 * Implements OAUTH-3-01 through OAUTH-3-07 user stories for Sprint 3.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const AmexingUser = require('../../domain/models/AmexingUser');
const logger = require('../../infrastructure/logger');

class OAuthPermissionService {
  constructor() {
    // Permission mapping from OAuth groups/roles to Amexing permissions
    this.permissionMappings = new Map([
      // Google Workspace Groups
      ['google_admin', ['admin_full', 'user_management', 'system_config']],
      ['google_manager', ['team_management', 'employee_access', 'department_admin']],
      ['google_employee', ['basic_access', 'profile_management']],
      ['google_hr', ['employee_management', 'department_access', 'audit_read']],
      ['google_it', ['system_admin', 'user_support', 'technical_access']],
      ['google_finance', ['financial_access', 'billing_management', 'report_access']],

      // Microsoft Azure AD Groups
      ['azure_global_admin', ['admin_full', 'user_management', 'system_config', 'compliance_admin']],
      ['azure_user_admin', ['user_management', 'employee_access', 'department_admin']],
      ['azure_helpdesk_admin', ['user_support', 'basic_admin', 'password_reset']],
      ['azure_security_admin', ['security_config', 'audit_full', 'compliance_read']],
      ['azure_billing_admin', ['billing_management', 'financial_access', 'subscription_admin']],

      // Department-specific permissions
      ['dept_sistemas', ['technical_access', 'system_support', 'user_support']],
      ['dept_recursos_humanos', ['employee_management', 'hr_access', 'compliance_read']],
      ['dept_finanzas', ['financial_access', 'billing_read', 'report_access']],
      ['dept_operaciones', ['operations_access', 'logistics_management', 'vendor_access']],
      ['dept_eventos', ['event_management', 'client_access', 'booking_admin']],
      ['dept_administracion', ['admin_access', 'document_management', 'general_admin']],
    ]);

    // Permission levels hierarchy
    this.permissionHierarchy = {
      admin_full: 100,
      compliance_admin: 95,
      system_admin: 90,
      department_admin: 80,
      team_management: 70,
      user_management: 65,
      employee_management: 60,
      technical_access: 55,
      financial_access: 50,
      operations_access: 45,
      event_management: 40,
      basic_admin: 35,
      audit_read: 30,
      basic_access: 20,
      profile_management: 10,
    };

    // Context-specific permissions
    this.contextPermissions = new Map();
  }

  /**
   * Inherits permissions from OAuth groups for a user
   * Implements OAUTH-3-01: Herencia Permisos desde Roles OAuth Corporativos.
   * @param {AmexingUser} user - User to assign permissions.
   * @param {object} oauthProfile - OAuth profile with group information.
   * @param {string} provider - OAuth provider (google, microsoft).
   * @returns {Promise<object>} Permission inheritance result.
   * @example
   * const service = new OAuthPermissionService();
   * const result = await service.inheritPermissionsFromOAuth(user, profile, 'microsoft');
   */
  async inheritPermissionsFromOAuth(user, oauthProfile, provider) {
    try {
      const userId = user.id;
      const inheritedPermissions = new Set();
      const sourceGroups = [];

      // Extract groups from OAuth profile based on provider
      const groups = await this.extractGroupsFromProfile(oauthProfile, provider);

      for (const group of groups) {
        const normalizedGroup = this.normalizeGroupName(group, provider);
        const permissions = this.permissionMappings.get(normalizedGroup);

        if (permissions) {
          permissions.forEach((permission) => inheritedPermissions.add(permission));
          sourceGroups.push({
            group: normalizedGroup,
            originalName: group,
            permissions,
          });
        }
      }

      // Store permission inheritance record
      const inheritanceRecord = await this.createPermissionInheritance({
        userId,
        sourceType: 'oauth_group',
        sourceGroups,
        permissions: Array.from(inheritedPermissions),
        provider,
        inheritedAt: new Date(),
      });

      // Apply permissions to user
      await this.applyPermissionsToUser(user, Array.from(inheritedPermissions), 'oauth_inherited');

      logger.logSecurityEvent('OAUTH_PERMISSIONS_INHERITED', userId, {
        provider,
        groupCount: sourceGroups.length,
        permissionCount: inheritedPermissions.size,
        permissions: Array.from(inheritedPermissions),
        email: this.maskEmail(user.get('email')),
      });

      return {
        success: true,
        userId,
        provider,
        inheritedPermissions: Array.from(inheritedPermissions),
        sourceGroups,
        inheritanceId: inheritanceRecord.id,
      };
    } catch (error) {
      logger.error('Error inheriting OAuth permissions:', error);
      throw error;
    }
  }

  /**
   * Extracts groups from OAuth profile based on provider.
   * @param {object} oauthProfile - OAuth profile data.
   * @param {string} provider - OAuth provider.
   * @returns {Promise<Array>} List of group names.
   * @example
   * const service = new OAuthPermissionService();
   * const groups = await service.extractGroupsFromProfile(profile, 'microsoft');
   */
  async extractGroupsFromProfile(oauthProfile, provider) {
    try {
      let groups = [];

      if (provider === 'google') {
        // Google Workspace groups extraction
        if (oauthProfile.groups) {
          groups = oauthProfile.groups.map((group) => group.name || group);
        }

        // Try to get groups from Google Admin SDK if available
        if (oauthProfile.hd && process.env.GOOGLE_ADMIN_SDK_ENABLED === 'true') {
          const adminGroups = await this.getGoogleAdminGroups(oauthProfile.email);
          groups = groups.concat(adminGroups);
        }
      } else if (provider === 'microsoft') {
        // Microsoft Azure AD groups extraction
        if (oauthProfile.groups) {
          const { groups: profileGroups } = oauthProfile;
          groups = profileGroups;
        }

        // Extract from job title and department
        if (oauthProfile.jobTitle) {
          groups.push(oauthProfile.jobTitle);
        }
        if (oauthProfile.department) {
          groups.push(oauthProfile.department);
        }

        // Try to get groups from Microsoft Graph API
        try {
          const graphGroups = await this.getMicrosoftGraphGroups(oauthProfile.access_token);
          groups = groups.concat(graphGroups);
        } catch (graphError) {
          logger.warn('Could not fetch Microsoft Graph groups:', graphError.message);
        }
      }

      return groups.filter((group) => group && typeof group === 'string');
    } catch (error) {
      logger.error('Error extracting groups from OAuth profile:', error);
      return [];
    }
  }

  /**
   * Gets Google Admin SDK groups for a user.
   * @param {string} _email - User email (unused in current implementation).
   * @returns {Promise<Array>} List of Google groups.
   * @example
   * const service = new OAuthPermissionService();
   * const groups = await service.getGoogleAdminGroups('user@company.com');
   */
  async getGoogleAdminGroups(_email) {
    try {
      // This would require Google Admin SDK implementation
      // For now, return empty array - implement when Admin SDK is available
      logger.info('Google Admin SDK groups extraction not implemented yet');
      return [];
    } catch (error) {
      logger.error('Error getting Google Admin groups:', error);
      return [];
    }
  }

  /**
   * Gets Microsoft Graph API groups for a user.
   * @param {string} accessToken - Microsoft access token.
   * @returns {Promise<Array>} List of Microsoft groups.
   * @example
   * const service = new OAuthPermissionService();
   * const groups = await service.getMicrosoftGraphGroups('access_token_123');
   */
  async getMicrosoftGraphGroups(accessToken) {
    try {
      const response = await fetch('https://graph.microsoft.com/v1.0/me/memberOf', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Microsoft Graph API error: ${response.status}`);
      }

      const data = await response.json();
      const groups = data.value
        .filter((item) => item['@odata.type'] === '#microsoft.graph.group')
        .map((group) => group.displayName);

      return groups;
    } catch (error) {
      logger.error('Error getting Microsoft Graph groups:', error);
      return [];
    }
  }

  /**
   * Normalizes group names for permission mapping.
   * @param {string} groupName - Original group name.
   * @param {string} provider - OAuth provider.
   * @returns {string} Normalized group name.
   * @example
   * const service = new OAuthPermissionService();
   * const normalized = service.normalizeGroupName('HR Managers', 'microsoft');
   */
  normalizeGroupName(groupName, provider) {
    if (!groupName) return '';

    const normalized = groupName.toLowerCase().replace(/\s+/g, '_');

    // Add provider prefix for disambiguation
    return `${provider}_${normalized}`;
  }

  /**
   * Creates permission inheritance record.
   * @param {object} inheritanceData - Inheritance data.
   * @returns {Promise<Parse.Object>} Created inheritance record.
   * @example
   * const service = new OAuthPermissionService();
   * const record = await service.createPermissionInheritance(inheritanceData);
   */
  async createPermissionInheritance(inheritanceData) {
    try {
      const PermissionInheritanceClass = Parse.Object.extend('PermissionInheritance');
      const inheritance = new PermissionInheritanceClass();

      inheritance.set('userId', inheritanceData.userId);
      inheritance.set('sourceType', inheritanceData.sourceType);
      inheritance.set('sourceGroups', inheritanceData.sourceGroups);
      inheritance.set('permissions', inheritanceData.permissions);
      inheritance.set('provider', inheritanceData.provider);
      inheritance.set('inheritedAt', inheritanceData.inheritedAt);
      inheritance.set('active', true);

      await inheritance.save(null, { useMasterKey: true });

      return inheritance;
    } catch (error) {
      logger.error('Error creating permission inheritance record:', error);
      throw error;
    }
  }

  /**
   * Applies permissions to a user.
   * @param {AmexingUser} user - User to apply permissions.
   * @param {Array<string>} permissions - Permissions to apply.
   * @param {string} source - Source of permissions.
   * @returns {Promise<void>} Completes when permissions are applied.
   * @example
   * const service = new OAuthPermissionService();
   * await service.applyPermissionsToUser(user, ['admin_access'], 'oauth_group');
   */
  async applyPermissionsToUser(user, permissions, source) {
    try {
      const currentPermissions = user.get('permissions') || [];
      const userPermissions = new Set(currentPermissions);

      // Add new permissions
      permissions.forEach((permission) => userPermissions.add(permission));

      // Update user permissions
      user.set('permissions', Array.from(userPermissions));
      user.set('permissionsSource', source);
      user.set('permissionsUpdatedAt', new Date());

      await user.save(null, { useMasterKey: true });

      logger.logSecurityEvent('USER_PERMISSIONS_APPLIED', user.id, {
        newPermissions: permissions,
        totalPermissions: userPermissions.size,
        source,
      });
    } catch (error) {
      logger.error('Error applying permissions to user:', error);
      throw error;
    }
  }

  /**
   * Gets department-specific permissions for a user
   * Implements OAUTH-3-02: Permisos Específicos por Departamento via OAuth.
   * @param {string} userId - User ID.
   * @param {string} departmentId - Department ID.
   * @returns {Promise<Array>} Department-specific permissions.
   * @example
   * const service = new OAuthPermissionService();
   * const permissions = await service.getDepartmentPermissions('user123', 'hr');
   */
  async getDepartmentPermissions(userId, departmentId) {
    try {
      const departmentPermissions = this.permissionMappings.get(`dept_${departmentId}`);

      if (!departmentPermissions) {
        return [];
      }

      // Log department permission access
      logger.logSecurityEvent('DEPARTMENT_PERMISSIONS_ACCESSED', userId, {
        departmentId,
        permissions: departmentPermissions,
      });

      return departmentPermissions;
    } catch (error) {
      logger.error('Error getting department permissions:', error);
      throw error;
    }
  }

  /**
   * Checks if a user has a specific permission.
   * @param {string} userId - User ID.
   * @param {string} permission - Permission to check.
   * @param {string} context - Optional context (department, project).
   * @returns {Promise<boolean>} True if user has permission.
   * @example
   * const service = new OAuthPermissionService();
   * const hasAccess = await service.hasPermission('user123', 'admin_access', 'department');
   */
  async hasPermission(userId, permission, context = null) {
    try {
      const user = await new Parse.Query(AmexingUser).get(userId, { useMasterKey: true });
      const userPermissions = user.get('permissions') || [];

      // Check direct permission
      if (userPermissions.includes(permission)) {
        return true;
      }

      // Check context-specific permissions
      if (context) {
        const contextPermissions = await this.getContextPermissions(userId, context);
        if (contextPermissions.includes(permission)) {
          return true;
        }
      }

      // Check permission hierarchy (higher level permissions include lower ones)
      const requiredLevel = this.permissionHierarchy[permission] || 0;

      for (const userPerm of userPermissions) {
        const userPermLevel = this.permissionHierarchy[userPerm] || 0;
        if (userPermLevel >= requiredLevel) {
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Error checking user permission:', error);
      return false;
    }
  }

  /**
   * Gets context-specific permissions for a user.
   * @param {string} userId - User ID.
   * @param {string} context - Context (department, project, etc.).
   * @returns {Promise<Array>} Context-specific permissions.
   * @example
   * const service = new OAuthPermissionService();
   * const permissions = await service.getContextPermissions('user123', 'finance_dept');
   */
  async getContextPermissions(userId, context) {
    try {
      const contextQuery = new Parse.Query('PermissionContext');
      contextQuery.equalTo('userId', userId);
      contextQuery.equalTo('context', context);
      contextQuery.equalTo('active', true);

      const contextRecord = await contextQuery.first({ useMasterKey: true });

      return contextRecord ? (contextRecord.get('permissions') || []) : [];
    } catch (error) {
      logger.error('Error getting context permissions:', error);
      return [];
    }
  }

  /**
   * Masks email for logging.
   * @param {string} email - Email address.
   * @returns {string} Masked email.
   * @example
   * const service = new OAuthPermissionService();
   * const masked = service.maskEmail('user@example.com'); // Returns 'use***@example.com'
   */
  maskEmail(email) {
    if (!email) return '';
    const [local, domain] = email.split('@');
    return `${local.substring(0, 3)}***@${domain}`;
  }

  /**
   * Gets all available permissions in the system.
   * @returns {Array} List of all permissions.
   * @example
   * const service = new OAuthPermissionService();
   * const allPermissions = service.getAllAvailablePermissions();
   */
  getAllAvailablePermissions() {
    const allPermissions = new Set();

    // Add permissions from mappings
    for (const permissions of this.permissionMappings.values()) {
      permissions.forEach((permission) => allPermissions.add(permission));
    }

    return Array.from(allPermissions).sort();
  }

  /**
   * Gets permission mappings for a specific provider.
   * @param {string} provider - OAuth provider.
   * @returns {object} Provider-specific permission mappings.
   * @example
   * const service = new OAuthPermissionService();
   * const mappings = service.getProviderPermissionMappings('microsoft');
   */
  getProviderPermissionMappings(provider) {
    const mappings = {};

    for (const [groupName, permissions] of this.permissionMappings) {
      if (groupName.startsWith(`${provider}_`)) {
        mappings[groupName] = permissions;
      }
    }

    return mappings;
  }
}

module.exports = new OAuthPermissionService();
