/**
 * Permission Model - Granular Permission System
 * Defines granular permissions with contextual conditions and scoping
 * for advanced RBAC implementation.
 *
 * Features:
 * - Resource-action based permissions
 * - Contextual conditions and restrictions
 * - Scoping (own, department, organization, system)
 * - Permission composition and validation
 * - Soft delete pattern compliance.
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 2024-09-24
 * @example
 * // Create a permission for booking approval with conditions
 * const permission = Permission.create({
 *   name: 'bookings.approve',
 *   resource: 'bookings',
 *   action: 'approve',
 *   scope: 'department',
 *   conditions: { maxAmount: 5000 }
 * });
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * Permission Class - Granular permission management
 * Supports resource-action permissions with contextual conditions.
 */
class Permission extends BaseModel {
  constructor() {
    super('Permission');
  }

  /**
   * Creates a new Permission instance.
   * @param {object} permissionData - Permission configuration object.
   * @returns {Permission} - New Permission instance.
   * @example
   * const permission = Permission.create({
   *   name: 'bookings.approve',
   *   resource: 'bookings',
   *   action: 'approve',
   *   scope: 'department',
   *   conditions: { maxAmount: 5000, businessHoursOnly: true },
   *   description: 'Approve bookings up to $5,000 during business hours'
   * });
   */
  static create(permissionData) {
    // Validate required fields
    if (!permissionData.resource || !permissionData.action) {
      throw new Error('Resource and action are required');
    }

    const permission = new Permission();

    // Auto-generate name if not provided
    const name = permissionData.name || `${permissionData.resource}.${permissionData.action}`;

    // Core permission identification
    permission.set('name', name);
    permission.set('resource', permissionData.resource);
    permission.set('action', permissionData.action);
    permission.set('description', permissionData.description || '');

    // Scope and context
    permission.set('scope', permissionData.scope || 'own'); // 'own', 'department', 'organization', 'system'
    permission.set('conditions', permissionData.conditions || {});
    permission.set('context', permissionData.context || {});

    // Permission metadata
    permission.set('category', permissionData.category || 'general');
    permission.set('priority', permissionData.priority || 0);
    permission.set('isSystemPermission', permissionData.isSystemPermission || false);
    permission.set('requiresApproval', permissionData.requiresApproval || false);
    permission.set('delegatable', permissionData.delegatable !== undefined ? permissionData.delegatable : true);

    // Validation rules
    permission.set('validationRules', permissionData.validationRules || {});
    permission.set('prerequisites', permissionData.prerequisites || []);

    // Base model fields
    permission.set('active', permissionData.active !== undefined ? permissionData.active : true);
    permission.set('exists', permissionData.exists !== undefined ? permissionData.exists : true);

    return permission;
  }

  /**
   * Validates context against permission conditions.
   * @param {object} context - Context to validate.
   * @returns {boolean} - True if context is valid.
   * @example
   */
  validateContext(context = {}) {
    const conditions = this.get('conditions') || {};

    // Check amount conditions
    if (conditions.maxAmount !== undefined) {
      if (!context.amount) {
        return false; // Amount required but not provided
      }
      if (context.amount > conditions.maxAmount) {
        return false;
      }
    }

    // Check business hours
    if (conditions.businessHoursOnly) {
      const timestamp = context.timestamp || new Date();
      const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
      const hour = date.getHours();
      const day = date.getDay();

      if (day === 0 || day === 6 || hour < 9 || hour > 17) {
        return false;
      }
    }

    // Check department scope
    if (conditions.departmentScope === 'own') {
      if (!context.departmentId || !context.userDepartmentId) {
        return false;
      }
      if (context.departmentId !== context.userDepartmentId) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if permission is a system permission.
   * @returns {boolean} - True if system permission.
   * @example
   */
  isSystemPermission() {
    return this.get('isSystemPermission') === true || this.get('category') === 'system';
  }

  /**
   * Check if permission can be delegated.
   * @returns {boolean} - True if delegatable.
   * @example
   */
  isDelegatable() {
    return this.get('delegatable') !== false;
  }

  /**
   * Check if permission inherits from another permission.
   * @param {string} parentPermission - Permission name to check.
   * @returns {boolean} - True if inherits from parent.
   * @example
   */
  inheritsFrom(parentPermission) {
    const name = this.get('name');

    // Check direct match
    if (name === parentPermission) {
      return true;
    }

    // Check wildcard inheritance (e.g., 'users.*' includes 'users.read')
    if (parentPermission.endsWith('.*')) {
      const parentBase = parentPermission.slice(0, -2);
      return name.startsWith(`${parentBase}.`);
    }

    // Check hierarchical inheritance
    const nameParts = name.split('.');
    const parentParts = parentPermission.split('.');

    if (parentParts.length < nameParts.length) {
      return nameParts.slice(0, parentParts.length).join('.') === parentPermission;
    }

    return false;
  }

  /**
   * Validate permission name format.
   * @param {string} name - Permission name.
   * @returns {boolean} - True if valid format.
   * @example
   */
  static isValidPermissionName(name) {
    if (!name || typeof name !== 'string') {
      return false;
    }

    // Must be in resource.action format
    const parts = name.split('.');
    if (parts.length < 2) {
      return false;
    }

    // Each part must be alphanumeric (with underscores allowed)
    const validPartRegex = /^[a-z][a-z0-9_]*$/;
    return parts.every((part) => validPartRegex.test(part));
  }

  /**
   * Validate condition structure.
   * @param {object} conditions - Conditions to validate.
   * @returns {boolean} - True if valid structure.
   * @example
   */
  static validateConditionStructure(conditions) {
    if (!conditions || typeof conditions !== 'object') {
      return false;
    }

    // Check known condition types
    const validConditions = [
      'maxAmount', 'minAmount', 'businessHoursOnly',
      'departmentScope', 'organizationScope', 'timeRestriction',
    ];

    for (const key in conditions) {
      if (!validConditions.includes(key)) {
        return false;
      }
    }

    // Validate specific condition values
    if (conditions.maxAmount !== undefined && typeof conditions.maxAmount !== 'number') {
      return false;
    }

    if (conditions.businessHoursOnly !== undefined && typeof conditions.businessHoursOnly !== 'boolean') {
      return false;
    }

    return true;
  }

  /**
   * Check if current time is during business hours.
   * @param {Date} timestamp - Timestamp to check.
   * @returns {boolean} - True if during business hours.
   * @example
   */
  static isBusinessHours(timestamp = new Date()) {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const hour = date.getHours();
    const day = date.getDay();

    // Monday-Friday, 9 AM - 5 PM
    return day >= 1 && day <= 5 && hour >= 9 && hour < 17;
  }

  /**
   * Create system permissions with proper structure.
   * @param {object} config - Permission configuration.
   * @returns {Permission} - Created permission.
   * @example
   */
  static createSystemPermission(config) {
    return Permission.create({
      ...config,
      isSystemPermission: true,
      delegatable: config.delegatable !== false,
    });
  }

  /**
   * Validates if permission can be executed with given context.
   * @param {object} context - Execution context.
   * @param {object} user - User attempting to execute permission.
   * @returns {Promise<object>} - Validation result { valid: boolean, reason?: string }.
   * @example
   */
  async validateExecution(context = {}, user = null) {
    try {
      const conditions = this.get('conditions') || {};
      const validationRules = this.get('validationRules') || {};

      // Check amount-based conditions
      if (conditions.maxAmount && context.amount) {
        if (context.amount > conditions.maxAmount) {
          return {
            valid: false,
            reason: `Amount ${context.amount} exceeds maximum allowed ${conditions.maxAmount}`,
          };
        }
      }

      // Check time-based conditions
      if (conditions.businessHoursOnly) {
        const now = context.timestamp ? new Date(context.timestamp) : new Date();
        const hour = now.getHours();
        const day = now.getDay();

        if (day === 0 || day === 6 || hour < 9 || hour > 17) {
          return {
            valid: false,
            reason: 'Action only allowed during business hours (9 AM - 5 PM, Monday-Friday)',
          };
        }
      }

      // Check department scope
      if (conditions.departmentScope === 'own' && user && context.departmentId) {
        if (user.get('departmentId') !== context.departmentId) {
          return {
            valid: false,
            reason: 'Action only allowed within your own department',
          };
        }
      }

      // Check organization scope
      if (conditions.organizationScope === 'own' && user && context.organizationId) {
        if (user.get('organizationId') !== context.organizationId) {
          return {
            valid: false,
            reason: 'Action only allowed within your own organization',
          };
        }
      }

      // Check custom validation rules
      if (validationRules.customValidator) {
        const customResult = await this.executeCustomValidator(
          validationRules.customValidator,
          context,
          user
        );
        if (!customResult.valid) {
          return customResult;
        }
      }

      // Check prerequisites
      const prerequisites = this.get('prerequisites') || [];
      if (prerequisites.length > 0) {
        const prerequisiteResult = await this.checkPrerequisites(prerequisites, user);
        if (!prerequisiteResult.valid) {
          return prerequisiteResult;
        }
      }

      return { valid: true };
    } catch (error) {
      logger.error('Error validating permission execution', {
        permissionId: this.id,
        permissionName: this.get('name'),
        context,
        error: error.message,
      });
      return {
        valid: false,
        reason: 'Permission validation failed',
      };
    }
  }

  /**
   * Execute custom validation logic.
   * @param {string} validatorName - Name of the validator function.
   * @param {object} context - Execution context.
   * @param {object} user - User object.
   * @returns {Promise<object>} - Validation result.
   * @example
   */
  async executeCustomValidator(validatorName, context, user) {
    // This would integrate with a custom validation service
    // For now, return valid for basic implementation
    logger.info('Custom validator execution requested', {
      validator: validatorName,
      permission: this.get('name'),
      userId: user?.id,
    });

    return { valid: true };
  }

  /**
   * Check if user meets permission prerequisites.
   * @param {Array<string>} prerequisites - Required permissions.
   * @param {object} user - User object.
   * @returns {Promise<object>} - Check result.
   * @example
   */
  async checkPrerequisites(prerequisites, user) {
    if (!user || !prerequisites.length) {
      return { valid: true };
    }

    // This would check if user has prerequisite permissions
    // Implementation would depend on user's role and delegated permissions
    logger.info('Prerequisites check requested', {
      prerequisites,
      userId: user.id,
      permission: this.get('name'),
    });

    return { valid: true };
  }

  /**
   * Get permission scope level.
   * @returns {number} - Scope level (1=own, 2=department, 3=organization, 4=system).
   * @example
   */
  getScopeLevel() {
    const scopeMap = {
      own: 1,
      department: 2,
      organization: 3,
      system: 4,
    };
    return scopeMap[this.get('scope')] || 1;
  }

  /**
   * Check if this permission is more restrictive than another.
   * @param {Permission} otherPermission - Permission to compare against.
   * @returns {boolean} - True if this permission is more restrictive.
   * @example
   */
  isMoreRestrictiveThan(otherPermission) {
    const thisScope = this.getScopeLevel();
    const otherScope = otherPermission.getScopeLevel();

    if (thisScope < otherScope) {
      return true;
    }

    // Compare conditions if same scope
    if (thisScope === otherScope) {
      const thisConditions = this.get('conditions') || {};
      const otherConditions = otherPermission.get('conditions') || {};

      // Compare amount restrictions
      if (thisConditions.maxAmount && otherConditions.maxAmount) {
        return thisConditions.maxAmount < otherConditions.maxAmount;
      }

      if (thisConditions.maxAmount && !otherConditions.maxAmount) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get safe JSON representation for API responses.
   * @returns {object} - Safe permission data.
   * @example
   */
  toSafeJSON() {
    return {
      id: this.id,
      name: this.get('name'),
      resource: this.get('resource'),
      action: this.get('action'),
      description: this.get('description'),
      scope: this.get('scope'),
      category: this.get('category'),
      conditions: this.get('conditions'),
      requiresApproval: this.get('requiresApproval'),
      isSystemPermission: this.get('isSystemPermission'),
      active: this.get('active'),
      createdAt: this.get('createdAt'),
      updatedAt: this.get('updatedAt'),
    };
  }

  /**
   * Get system permissions configuration.
   * @returns {Array<object>} - System permissions configuration.
   * @example
   */
  static getSystemPermissions() {
    return [
      // User Management
      {
        name: 'users.create',
        resource: 'users',
        action: 'create',
        description: 'Create new users',
        scope: 'organization',
        category: 'user_management',
        isSystemPermission: true,
      },
      {
        name: 'users.read',
        resource: 'users',
        action: 'read',
        description: 'View users',
        scope: 'department',
        category: 'user_management',
        isSystemPermission: true,
      },
      {
        name: 'users.update',
        resource: 'users',
        action: 'update',
        description: 'Update user information',
        scope: 'department',
        category: 'user_management',
        isSystemPermission: true,
      },
      {
        name: 'users.delete',
        resource: 'users',
        action: 'delete',
        description: 'Deactivate users',
        scope: 'organization',
        category: 'user_management',
        isSystemPermission: true,
      },

      // Client Management
      {
        name: 'clients.create',
        resource: 'clients',
        action: 'create',
        description: 'Create new client organizations',
        scope: 'system',
        category: 'client_management',
        isSystemPermission: true,
      },
      {
        name: 'clients.read',
        resource: 'clients',
        action: 'read',
        description: 'View client information',
        scope: 'organization',
        category: 'client_management',
        isSystemPermission: true,
      },
      {
        name: 'clients.update',
        resource: 'clients',
        action: 'update',
        description: 'Update client information',
        scope: 'organization',
        category: 'client_management',
        isSystemPermission: true,
      },

      // Department Management
      {
        name: 'departments.create',
        resource: 'departments',
        action: 'create',
        description: 'Create departments',
        scope: 'organization',
        category: 'department_management',
        isSystemPermission: true,
      },
      {
        name: 'departments.read',
        resource: 'departments',
        action: 'read',
        description: 'View departments',
        scope: 'organization',
        category: 'department_management',
        isSystemPermission: true,
      },
      {
        name: 'departments.update',
        resource: 'departments',
        action: 'update',
        description: 'Update departments',
        scope: 'department',
        category: 'department_management',
        isSystemPermission: true,
      },

      // Booking Management
      {
        name: 'bookings.create',
        resource: 'bookings',
        action: 'create',
        description: 'Create new bookings',
        scope: 'department',
        category: 'booking_management',
        conditions: { maxAmount: 2000, businessHoursOnly: true },
        isSystemPermission: true,
      },
      {
        name: 'bookings.read',
        resource: 'bookings',
        action: 'read',
        description: 'View bookings',
        scope: 'department',
        category: 'booking_management',
        isSystemPermission: true,
      },
      {
        name: 'bookings.update',
        resource: 'bookings',
        action: 'update',
        description: 'Update existing bookings',
        scope: 'department',
        category: 'booking_management',
        isSystemPermission: true,
      },
      {
        name: 'bookings.approve',
        resource: 'bookings',
        action: 'approve',
        description: 'Approve bookings',
        scope: 'department',
        category: 'booking_management',
        conditions: { maxAmount: 10000 },
        requiresApproval: true,
        isSystemPermission: true,
      },
      {
        name: 'bookings.cancel',
        resource: 'bookings',
        action: 'cancel',
        description: 'Cancel bookings',
        scope: 'department',
        category: 'booking_management',
        isSystemPermission: true,
      },

      // Service Management
      {
        name: 'services.read',
        resource: 'services',
        action: 'read',
        description: 'View available services',
        scope: 'department',
        category: 'service_management',
        isSystemPermission: true,
      },
      {
        name: 'services.create',
        resource: 'services',
        action: 'create',
        description: 'Create new services',
        scope: 'system',
        category: 'service_management',
        isSystemPermission: true,
      },
      {
        name: 'services.update',
        resource: 'services',
        action: 'update',
        description: 'Update services',
        scope: 'system',
        category: 'service_management',
        isSystemPermission: true,
      },

      // Pricing Management
      {
        name: 'pricing.read',
        resource: 'pricing',
        action: 'read',
        description: 'View pricing information',
        scope: 'department',
        category: 'pricing_management',
        conditions: { departmentScope: 'own' },
        isSystemPermission: true,
      },
      {
        name: 'pricing.update',
        resource: 'pricing',
        action: 'update',
        description: 'Update pricing',
        scope: 'organization',
        category: 'pricing_management',
        isSystemPermission: true,
      },

      // Reporting
      {
        name: 'reports.read',
        resource: 'reports',
        action: 'read',
        description: 'View reports',
        scope: 'department',
        category: 'reporting',
        isSystemPermission: true,
      },
      {
        name: 'reports.generate',
        resource: 'reports',
        action: 'generate',
        description: 'Generate reports',
        scope: 'organization',
        category: 'reporting',
        isSystemPermission: true,
      },

      // Vehicle Management (Amexing employees only)
      {
        name: 'vehicles.read',
        resource: 'vehicles',
        action: 'read',
        description: 'View vehicles',
        scope: 'system',
        category: 'vehicle_management',
        conditions: { organizationScope: 'amexing' },
        isSystemPermission: true,
      },
      {
        name: 'vehicles.update',
        resource: 'vehicles',
        action: 'update',
        description: 'Update vehicle status',
        scope: 'own',
        category: 'vehicle_management',
        conditions: { operationsOnly: true },
        isSystemPermission: true,
      },

      // Schedule Management
      {
        name: 'schedules.read',
        resource: 'schedules',
        action: 'read',
        description: 'View schedules',
        scope: 'own',
        category: 'schedule_management',
        isSystemPermission: true,
      },
      {
        name: 'schedules.update',
        resource: 'schedules',
        action: 'update',
        description: 'Update schedules',
        scope: 'own',
        category: 'schedule_management',
        isSystemPermission: true,
      },

      // Route Management
      {
        name: 'routes.read',
        resource: 'routes',
        action: 'read',
        description: 'View routes',
        scope: 'system',
        category: 'route_management',
        isSystemPermission: true,
      },

      // Request Management (Guest access)
      {
        name: 'requests.create',
        resource: 'requests',
        action: 'create',
        description: 'Create service requests',
        scope: 'own',
        category: 'request_management',
        isSystemPermission: true,
      },

      // Quote Management
      {
        name: 'quotes.read',
        resource: 'quotes',
        action: 'read',
        description: 'View quotes',
        scope: 'own',
        category: 'quote_management',
        isSystemPermission: true,
      },
    ];
  }
}

// Register the subclass
Parse.Object.registerSubclass('Permission', Permission);

module.exports = Permission;
