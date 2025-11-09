/**
 * RoleAuthorizationService - Centralized Role-Based Authorization Service
 * Provides a single source of truth for role validation and authorization logic.
 *
 * Implements SOLID principles:
 * - Single Responsibility: Only handles role-based authorization
 * - Open/Closed: Extensible through configuration
 * - Liskov Substitution: Consistent interface for all authorization checks
 * - Interface Segregation: Focused methods for specific authorization needs
 * - Dependency Inversion: Depends on abstractions (Role model) not concretions.
 *
 * Features:
 * - Safe extraction of user roles from Parse objects or plain objects
 * - Hierarchical role validation
 * - Organization-based access control
 * - Comprehensive audit logging
 * - Cache-friendly design.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 0.1.0
 * @example
 * const authService = new RoleAuthorizationService();
 * const hasAccess = await authService.validateRoleAccess(currentUser, ['superadmin', 'admin']);
 */

const logger = require('../../infrastructure/logger');

/**
 * RoleAuthorizationService class - Centralized authorization logic.
 */
class RoleAuthorizationService {
  constructor() {
    // Role hierarchy levels (higher number = more privileges)
    this.roleHierarchy = {
      superadmin: 7,
      admin: 6,
      client: 5,
      department_manager: 4,
      employee: 3,
      employee_amexing: 3,
      driver: 2,
      guest: 1,
    };

    // Organization types
    this.organizationTypes = {
      AMEXING: 'amexing',
      CLIENT: 'client',
      EXTERNAL: 'external',
    };

    // Role to organization mapping
    this.roleOrganizations = {
      superadmin: 'amexing',
      admin: 'amexing',
      employee_amexing: 'amexing',
      client: 'client',
      department_manager: 'client',
      employee: 'client',
      driver: 'amexing',
      guest: 'external',
    };
  }

  /**
   * Safely extracts role name from user object (Parse or plain object).
   * Handles multiple data structures for maximum compatibility.
   * @param {object} user - User object (Parse object, plain object, or Express req).
   * @param {string} explicitRole - Optional explicit role to use (e.g., from req.userRole).
   * @returns {string} - Role name or 'guest' if not found.
   * @example
   * const role = authService.extractUserRole(currentUser);
   * // Returns: 'superadmin'
   *
   * // With explicit role from middleware
   * const role = authService.extractUserRole(req.user, req.userRole);
   * // Returns: role from JWT token
   */
  extractUserRole(user, explicitRole = null) {
    // If explicit role provided, use it (e.g., from JWT middleware)
    if (explicitRole) {
      logger.debug('RoleAuthorizationService: Using explicit role', {
        explicitRole,
        userId: user?.id || user?.objectId || 'unknown',
      });
      return explicitRole;
    }

    if (!user) {
      logger.warn('RoleAuthorizationService: User object is null or undefined');
      return 'guest';
    }

    // Try different ways to extract role
    let role = null;

    // 1. Direct property access (plain object)
    if (user.role) {
      ({ role } = user);
    } else if (typeof user.get === 'function') {
      // 2. Parse object .get() method
      role = user.get('role');
    } else if (user.attributes && user.attributes.role) {
      // 3. Nested in attributes (some Parse objects)
      ({ role } = user.attributes);
    }

    // If still no role found, default to guest
    if (!role) {
      logger.warn('RoleAuthorizationService: No role found for user', {
        userId: user.id || user.objectId || 'unknown',
        userKeys: Object.keys(user),
        hasGetMethod: typeof user.get === 'function',
      });
      return 'guest';
    }

    // Normalize role (handle Role objects with .get('name'))
    if (typeof role === 'object' && role.get) {
      role = role.get('name');
    } else if (typeof role === 'object' && role.name) {
      role = role.name;
    }

    return role;
  }

  /**
   * Validates if user has one of the required roles.
   * @param {object} user - User object.
   * @param {string|Array<string>} requiredRoles - Required role(s).
   * @param {object} options - Additional options.
   * @returns {boolean} - True if user has required role.
   * @throws {Error} - If throwError is true and validation fails.
   * @example
   * const hasAccess = authService.validateRoleAccess(user, ['superadmin', 'admin']);
   * // Returns: true or false
   *
   * // With explicit role from JWT middleware
   * const hasAccess = authService.validateRoleAccess(user, ['admin'], {
   *   explicitRole: req.userRole
   * });
   */
  validateRoleAccess(user, requiredRoles, options = {}) {
    const { throwError = false, context = 'unknown', explicitRole = null } = options;

    // Extract user role
    const userRole = this.extractUserRole(user, explicitRole);

    // Normalize requiredRoles to array
    const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];

    // Check if user has required role
    const hasAccess = roles.includes(userRole);

    // Log validation result
    logger.debug('RoleAuthorizationService: Role validation', {
      userId: user?.id || user?.objectId || 'unknown',
      userRole,
      requiredRoles: roles,
      hasAccess,
      context,
    });

    // Throw error if required
    if (!hasAccess && throwError) {
      const error = new Error(`Insufficient permissions. Required: ${roles.join(', ')}, Current: ${userRole}`);
      error.code = 'INSUFFICIENT_PERMISSIONS';
      error.userRole = userRole;
      error.requiredRoles = roles;

      logger.warn('RoleAuthorizationService: Access denied', {
        userId: user?.id || user?.objectId || 'unknown',
        userRole,
        requiredRoles: roles,
        context,
      });

      throw error;
    }

    return hasAccess;
  }

  /**
   * Validates if user has minimum role level in hierarchy.
   * @param {object} user - User object.
   * @param {number} minimumLevel - Minimum required level (1-7).
   * @param {object} options - Additional options.
   * @returns {boolean} - True if user meets minimum level.
   * @example
   * const hasAccess = authService.hasMinimumRoleLevel(user, 6); // Admin level or higher
   * // Returns: true or false
   */
  hasMinimumRoleLevel(user, minimumLevel, options = {}) {
    const { throwError = false, context = 'unknown' } = options;

    const userRole = this.extractUserRole(user);
    const userLevel = this.roleHierarchy[userRole] || 0;

    const hasAccess = userLevel >= minimumLevel;

    logger.debug('RoleAuthorizationService: Level validation', {
      userId: user?.id || user?.objectId || 'unknown',
      userRole,
      userLevel,
      minimumLevel,
      hasAccess,
      context,
    });

    if (!hasAccess && throwError) {
      const error = new Error(
        `Insufficient role level. Required: ${minimumLevel}, Current: ${userLevel} (${userRole})`
      );
      error.code = 'INSUFFICIENT_ROLE_LEVEL';
      error.userLevel = userLevel;
      error.minimumLevel = minimumLevel;

      logger.warn('RoleAuthorizationService: Level access denied', {
        userId: user?.id || user?.objectId || 'unknown',
        userRole,
        userLevel,
        minimumLevel,
        context,
      });

      throw error;
    }

    return hasAccess;
  }

  /**
   * Validates if user belongs to specific organization.
   * @param {object} user - User object.
   * @param {string} organization - Required organization ('amexing', 'client', 'external').
   * @param {object} options - Additional options.
   * @returns {boolean} - True if user belongs to organization.
   * @example
   * const hasAccess = authService.validateOrganizationAccess(user, 'amexing');
   * // Returns: true or false
   */
  validateOrganizationAccess(user, organization, options = {}) {
    const { throwError = false, context = 'unknown' } = options;

    const userRole = this.extractUserRole(user);
    const userOrganization = this.roleOrganizations[userRole];

    const hasAccess = userOrganization === organization;

    logger.debug('RoleAuthorizationService: Organization validation', {
      userId: user?.id || user?.objectId || 'unknown',
      userRole,
      userOrganization,
      requiredOrganization: organization,
      hasAccess,
      context,
    });

    if (!hasAccess && throwError) {
      const error = new Error(`Organization access denied. Required: ${organization}, Current: ${userOrganization}`);
      error.code = 'ORGANIZATION_ACCESS_DENIED';
      error.userOrganization = userOrganization;
      error.requiredOrganization = organization;

      logger.warn('RoleAuthorizationService: Organization access denied', {
        userId: user?.id || user?.objectId || 'unknown',
        userRole,
        userOrganization,
        requiredOrganization: organization,
        context,
      });

      throw error;
    }

    return hasAccess;
  }

  /**
   * Gets roles that belong to specific organization.
   * @param {string} organization - Organization type ('amexing', 'client', 'external').
   * @returns {Array<string>} - Array of role names.
   * @example
   * const amexingRoles = authService.getRolesByOrganization('amexing');
   * // Returns: ['superadmin', 'admin', 'employee_amexing', 'driver']
   */
  getRolesByOrganization(organization) {
    return Object.keys(this.roleOrganizations).filter((role) => this.roleOrganizations[role] === organization);
  }

  /**
   * Gets user's role level in hierarchy.
   * @param {object} user - User object.
   * @returns {number} - Role level (1-7).
   * @example
   * const level = authService.getUserRoleLevel(user);
   * // Returns: 6 (for admin)
   */
  getUserRoleLevel(user) {
    const userRole = this.extractUserRole(user);
    return this.roleHierarchy[userRole] || 0;
  }

  /**
   * Gets user's organization.
   * @param {object} user - User object.
   * @returns {string} - Organization type.
   * @example
   * const org = authService.getUserOrganization(user);
   * // Returns: 'amexing'
   */
  getUserOrganization(user) {
    const userRole = this.extractUserRole(user);
    return this.roleOrganizations[userRole] || 'external';
  }

  /**
   * Checks if user can manage target user based on hierarchy.
   * @param {object} currentUser - Current user object.
   * @param {object} targetUser - Target user object.
   * @returns {boolean} - True if current user can manage target.
   * @example
   * const canManage = authService.canManageUser(admin, employee);
   * // Returns: true
   */
  canManageUser(currentUser, targetUser) {
    const currentLevel = this.getUserRoleLevel(currentUser);
    const targetRole = this.extractUserRole(targetUser);
    const targetLevel = this.roleHierarchy[targetRole] || 0;

    return currentLevel > targetLevel;
  }

  /**
   * Validates multiple authorization rules at once.
   * Useful for complex authorization scenarios.
   * @param {object} user - User object.
   * @param {object} rules - Authorization rules.
   * @param {object} options - Additional options.
   * @returns {boolean} - True if all rules pass.
   * @example
   * const hasAccess = authService.validateMultiple(user, {
   *   roles: ['superadmin', 'admin'],
   *   minimumLevel: 6,
   *   organization: 'amexing'
   * });
   */
  validateMultiple(user, rules = {}, options = {}) {
    const { roles, minimumLevel, organization } = rules;
    const { throwError = false, context = 'unknown' } = options;

    let passed = true;
    const failures = [];

    // Check roles
    if (roles && !this.validateRoleAccess(user, roles)) {
      passed = false;
      failures.push(`role not in ${roles.join(', ')}`);
    }

    // Check minimum level
    if (minimumLevel && !this.hasMinimumRoleLevel(user, minimumLevel)) {
      passed = false;
      failures.push(`level below ${minimumLevel}`);
    }

    // Check organization
    if (organization && !this.validateOrganizationAccess(user, organization)) {
      passed = false;
      failures.push(`not in ${organization} organization`);
    }

    if (!passed && throwError) {
      const error = new Error(`Multiple authorization rules failed: ${failures.join(', ')}`);
      error.code = 'MULTIPLE_AUTHORIZATION_FAILED';
      error.failures = failures;

      logger.warn('RoleAuthorizationService: Multiple rules failed', {
        userId: user?.id || user?.objectId || 'unknown',
        rules,
        failures,
        context,
      });

      throw error;
    }

    return passed;
  }
}

module.exports = RoleAuthorizationService;
