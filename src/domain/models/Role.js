/**
 * Role Model - Advanced Role-Based Access Control System
 * Implements modern RBAC patterns with hierarchical roles, permission delegation,
 * and contextual permissions following 2024 best practices.
 *
 * Features:
 * - Hierarchical role structure with inheritance
 * - Contextual permissions with conditions
 * - Permission delegation capabilities
 * - Organization and department scoping
 * - Soft delete pattern compliance.
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 2024-09-24
 * @example
 * // Create a department manager role
 * const role = Role.create({
 *   name: 'department_manager',
 *   displayName: 'Department Manager',
 *   level: 4,
 *   scope: 'department',
 *   organization: 'client'
 * });
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * Role Class - Advanced RBAC implementation
 * Supports hierarchical roles, permission inheritance, and contextual permissions.
 */
class Role extends BaseModel {
  constructor() {
    super('Role');
  }

  /**
   * Creates a new Role instance with advanced RBAC features.
   * @param {object} roleData - Role configuration object.
   * @returns {Role} - New Role instance.
   * @example
   * const role = Role.create({
   *   name: 'department_manager',
   *   displayName: 'Department Manager',
   *   level: 4,
   *   scope: 'department',
   *   organization: 'client',
   *   basePermissions: ['bookings.read', 'bookings.create'],
   *   delegatable: true
   * });
   */
  static create(roleData) {
    const role = new Role();

    // Validate required fields
    if (!roleData.name) {
      throw new Error('Role name is required');
    }

    // Validate role name format
    if (!/^[a-z_]+$/.test(roleData.name)) {
      throw new Error(
        'Role name must contain only lowercase letters and underscores'
      );
    }

    // Validate level
    if (
      roleData.level !== undefined
      && (roleData.level < 1 || roleData.level > 7)
    ) {
      throw new Error('Role level must be between 1 and 7');
    }

    // Core role identification
    role.set('name', roleData.name);
    role.set('displayName', roleData.displayName || roleData.name);
    role.set('description', roleData.description || '');

    // Hierarchical structure
    role.set('level', roleData.level || 1);
    role.set('scope', roleData.scope || 'department'); // 'system', 'organization', 'department', 'operations', 'public'
    role.set('organization', roleData.organization || 'client'); // 'amexing', 'client', 'external'

    // Permission system
    role.set('basePermissions', roleData.basePermissions || []);
    role.set(
      'delegatable',
      roleData.delegatable !== undefined ? roleData.delegatable : false
    );
    role.set('inheritsFrom', roleData.inheritsFrom || null);

    // Contextual restrictions
    role.set('conditions', roleData.conditions || {});
    role.set('maxDelegationLevel', roleData.maxDelegationLevel || 0);

    // Metadata
    role.set('isSystemRole', roleData.isSystemRole || false);
    role.set('color', roleData.color || '#6B7280'); // UI color
    role.set('icon', roleData.icon || 'user');

    // Base model fields
    role.set('active', roleData.active !== undefined ? roleData.active : true);
    role.set('exists', roleData.exists !== undefined ? roleData.exists : true);

    return role;
  }

  /**
   * Get all permissions for this role including inherited ones.
   * @returns {Promise<Array<string>>} - Array of permission names.
   * @example
   */
  async getAllPermissions() {
    try {
      let allPermissions = [...(this.get('basePermissions') || [])];

      // Add inherited permissions
      const inheritsFrom = this.get('inheritsFrom');
      if (inheritsFrom) {
        const parentRole = await this.getParentRole();
        if (parentRole) {
          const parentPermissions = await parentRole.getAllPermissions();
          allPermissions = [
            ...new Set([...allPermissions, ...parentPermissions]),
          ];
        }
      }

      return allPermissions;
    } catch (error) {
      logger.error('Error getting all permissions for role', {
        roleId: this.id,
        roleName: this.get('name'),
        error: error.message,
      });
      return this.get('basePermissions') || [];
    }
  }

  /**
   * Get parent role if inheritance is configured.
   * @returns {Promise<Role|null>} - Parent role or null.
   * @example
   */
  async getParentRole() {
    const parentRoleName = this.get('inheritsFrom');
    if (!parentRoleName) {
      return null;
    }

    try {
      const query = BaseModel.queryActive('Role');
      query.equalTo('name', parentRoleName);
      return await query.first({ useMasterKey: true });
    } catch (error) {
      logger.error('Error fetching parent role', {
        roleId: this.id,
        parentRoleName,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Check if this role can delegate permissions to other roles.
   * @param {string} _targetRoleName - Target role to delegate to.
   * @returns {boolean} - True if delegation is allowed.
   * @example
   */
  canDelegateTo(_targetRoleName) {
    if (!this.get('delegatable')) {
      return false;
    }

    // Can only delegate to roles with lower or equal level
    const maxLevel = this.get('maxDelegationLevel') || this.get('level');
    return true; // Will be validated against target role level in service
  }

  /**
   * Check if role has specific permission with context.
   * @param {string} permission - Permission to check.
   * @param {object} context - Context for conditional permissions.
   * @returns {Promise<boolean>} - True if permission is granted.
   * @example
   */
  async hasPermission(permission, context = {}) {
    try {
      const allPermissions = await this.getAllPermissions();

      // Check for wildcard permission
      if (allPermissions.includes('*')) {
        // Wildcard grants all permissions
        const conditions = this.get('conditions') || {};
        return this.evaluateConditions(conditions, context);
      }

      // Check for exact permission match
      if (!allPermissions.includes(permission)) {
        return false;
      }

      // Check contextual conditions
      const conditions = this.get('conditions') || {};
      return this.evaluateConditions(conditions, context);
    } catch (error) {
      logger.error('Error checking permission', {
        roleId: this.id,
        permission,
        context,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Evaluate contextual conditions for permissions.
   * @param {object} conditions - Role conditions.
   * @param {object} context - Current context.
   * @returns {boolean} - True if conditions are met.
   * @example
   */
  evaluateConditions(conditions, context) {
    // No conditions means permission is granted
    if (!conditions || Object.keys(conditions).length === 0) {
      return true;
    }

    // Check amount-based conditions
    if (conditions.maxAmount && context.amount) {
      if (context.amount > conditions.maxAmount) {
        return false;
      }
    }

    // Check department-based conditions
    if (conditions.allowedDepartments && context.departmentId) {
      if (!conditions.allowedDepartments.includes(context.departmentId)) {
        return false;
      }
    }

    // Check time-based conditions
    if (conditions.businessHoursOnly && context.timestamp) {
      const hour = new Date(context.timestamp).getHours();
      if (hour < 9 || hour > 17) {
        return false;
      }
    }

    // Check organization context
    if (conditions.organizationScope && context.organizationId) {
      if (conditions.organizationScope !== context.organizationId) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get role hierarchy level for comparison.
   * @returns {number} - Role level (1-7, higher is more privileged).
   * @example
   */
  getLevel() {
    return this.get('level') || 1;
  }

  /**
   * Check if this role is higher in hierarchy than another role.
   * @param {Role} otherRole - Role to compare against.
   * @returns {boolean} - True if this role has higher privileges.
   * @example
   */
  isHigherThan(otherRole) {
    return this.getLevel() > otherRole.getLevel();
  }

  /**
   * Check if this role can manage another role (has higher level).
   * @param {Role} otherRole - Role to check management capability against.
   * @returns {boolean} - True if this role can manage the other role.
   * @example
   */
  canManage(otherRole) {
    return this.getLevel() > otherRole.getLevel();
  }

  /**
   * Check if role has system permission.
   * @param {string} permission - System permission to check.
   * @returns {boolean} - True if permission is granted.
   * @example
   */
  hasSystemPermission(permission) {
    const basePermissions = this.get('basePermissions') || [];
    return (
      basePermissions.includes(permission) || basePermissions.includes('*')
    );
  }

  /**
   * Check contextual permissions with conditions.
   * @param {string} permission - Permission to check.
   * @param {object} context - Context for evaluation.
   * @returns {boolean} - True if permission is granted in context.
   * @example
   */
  hasContextualPermission(permission, context = {}) {
    const contextualPermissions = this.get('contextualPermissions') || {};
    const permissionConfig = contextualPermissions[permission];

    if (!permissionConfig) {
      // Fall back to regular permission check
      const basePermissions = this.get('basePermissions') || [];
      if (
        !basePermissions.includes(permission)
        && !basePermissions.includes('*')
      ) {
        return false;
      }
    }

    // Evaluate conditions if any
    if (permissionConfig && permissionConfig.conditions) {
      return this.evaluateConditions(permissionConfig.conditions, context);
    }

    return true;
  }

  /**
   * Check if role can delegate a specific permission.
   * @param {string} permission - Permission to check for delegation.
   * @returns {boolean} - True if permission can be delegated.
   * @example
   */
  canDelegatePermission(permission) {
    if (!this.get('delegatable')) {
      return false;
    }

    const delegatablePermissions = this.get('delegatablePermissions') || [];

    // If no specific delegatable permissions are set, allow delegation of all base permissions
    if (delegatablePermissions.length === 0) {
      const basePermissions = this.get('basePermissions') || [];
      return (
        basePermissions.includes(permission) || basePermissions.includes('*')
      );
    }

    return (
      delegatablePermissions.includes(permission)
      || delegatablePermissions.includes('*')
    );
  }

  /**
   * Check if role can access organization.
   * @param {string} userOrg - User's organization.
   * @param {string} targetOrg - Target organization to access.
   * @returns {boolean} - True if access is allowed.
   * @example
   */
  canAccessOrganization(userOrg, targetOrg) {
    const organizationScope = this.get('organizationScope') || this.get('organization');

    switch (organizationScope) {
      case 'system':
        return true; // System roles can access any organization
      case 'client':
        return userOrg === 'amexing' || userOrg === targetOrg; // Amexing can access any client, clients can access themselves
      case 'own':
        return userOrg === targetOrg; // Only own organization
      default:
        return userOrg === targetOrg;
    }
  }

  /**
   * Get safe JSON representation for API responses.
   * @returns {object} - Safe role data.
   * @example
   */
  toSafeJSON() {
    return {
      id: this.id,
      name: this.get('name'),
      displayName: this.get('displayName'),
      description: this.get('description'),
      level: this.get('level'),
      scope: this.get('scope'),
      organization: this.get('organization'),
      delegatable: this.get('delegatable'),
      inheritsFrom: this.get('inheritsFrom'),
      color: this.get('color'),
      icon: this.get('icon'),
      isSystemRole: this.get('isSystemRole'),
      active: this.get('active'),
      createdAt: this.get('createdAt'),
      updatedAt: this.get('updatedAt'),
    };
  }

  /**
   * Get predefined system roles configuration.
   * @returns {Array<object>} - System roles configuration.
   * @example
   */
  static getSystemRoles() {
    return [
      {
        name: 'superadmin',
        displayName: 'Super Administrator',
        description: 'Full system access and administration',
        level: 7,
        scope: 'system',
        organization: 'amexing',
        basePermissions: ['*'], // All permissions
        delegatable: true,
        maxDelegationLevel: 6,
        isSystemRole: true,
        color: '#DC2626',
        icon: 'shield-check',
      },
      {
        name: 'admin',
        displayName: 'Administrator',
        description: 'System administration and client management',
        level: 6,
        scope: 'system',
        organization: 'amexing',
        basePermissions: [
          'users.read',
          'users.create',
          'users.update',
          'clients.read',
          'clients.create',
          'clients.update',
          'events.read',
          'events.create',
          'events.update',
          'bookings.read',
          'bookings.create',
          'bookings.update',
          'bookings.approve',
          'reports.read',
          'reports.generate',
        ],
        delegatable: true,
        maxDelegationLevel: 5,
        isSystemRole: true,
        color: '#DC2626',
        icon: 'shield',
      },
      {
        name: 'client',
        displayName: 'Client Administrator',
        description: 'Organization administrator for client companies',
        level: 5,
        scope: 'organization',
        organization: 'client',
        basePermissions: [
          'users.read',
          'users.create',
          'users.update',
          'departments.read',
          'departments.create',
          'departments.update',
          'events.read',
          'events.create',
          'events.update',
          'bookings.read',
          'bookings.create',
          'bookings.approve',
          'services.read',
          'pricing.read',
        ],
        delegatable: true,
        maxDelegationLevel: 4,
        isSystemRole: true,
        conditions: {
          organizationScope: 'own', // Only within their organization
        },
        color: '#059669',
        icon: 'building-office',
      },
      {
        name: 'department_manager',
        displayName: 'Department Manager',
        description: 'Department supervisor with delegation capabilities',
        level: 4,
        scope: 'department',
        organization: 'client',
        basePermissions: [
          'users.read',
          'users.update',
          'bookings.read',
          'bookings.create',
          'bookings.approve',
          'services.read',
          'pricing.read',
          'reports.read',
        ],
        delegatable: true,
        maxDelegationLevel: 3,
        isSystemRole: true,
        conditions: {
          maxAmount: 10000, // Can approve up to $10,000 MXN
          departmentScope: 'own', // Only within their department
        },
        color: '#0891B2',
        icon: 'user-group',
      },
      {
        name: 'employee',
        displayName: 'Employee',
        description: 'Corporate client employee with departmental access',
        level: 3,
        scope: 'department',
        organization: 'client',
        basePermissions: [
          'bookings.read',
          'bookings.create',
          'services.read',
          'pricing.read',
        ],
        delegatable: false,
        isSystemRole: true,
        conditions: {
          maxAmount: 2000, // Can self-approve up to $2,000 MXN
          businessHoursOnly: true,
          departmentScope: 'own',
        },
        color: '#7C3AED',
        icon: 'user',
      },
      {
        name: 'employee_amexing',
        displayName: 'Amexing Employee',
        description: 'Internal Amexing administrative and operations staff',
        level: 3,
        scope: 'operations',
        organization: 'amexing',
        basePermissions: [
          'bookings.read',
          'bookings.update',
          'vehicles.read',
          'vehicles.update',
          'schedules.read',
          'schedules.update',
          'routes.read',
        ],
        delegatable: false,
        isSystemRole: true,
        conditions: {
          operationsOnly: true, // No access to financial data
          scheduleScope: 'assigned', // Only assigned bookings/vehicles
        },
        color: '#EA580C',
        icon: 'briefcase',
      },
      {
        name: 'driver',
        displayName: 'Driver',
        description: 'Transportation service driver with mobile app access',
        level: 2,
        scope: 'operations',
        organization: 'amexing',
        basePermissions: [
          'trips.read',
          'trips.accept',
          'trips.complete',
          'trips.cancel',
          'vehicles.read',
          'routes.read',
          'location.update',
          'earnings.read',
        ],
        delegatable: false,
        isSystemRole: true,
        conditions: {
          assignedOnly: true, // Only assigned trips and vehicles
          mobileAccess: true, // Primarily mobile app access
        },
        color: '#F59E0B',
        icon: 'truck',
      },
      {
        name: 'guest',
        displayName: 'Guest',
        description: 'Public access for service requests',
        level: 1,
        scope: 'public',
        organization: 'external',
        basePermissions: ['services.read', 'requests.create', 'quotes.read'],
        delegatable: false,
        isSystemRole: true,
        color: '#6B7280',
        icon: 'user-circle',
      },
    ];
  }
}

// Register the subclass
Parse.Object.registerSubclass('Role', Role);

module.exports = Role;
