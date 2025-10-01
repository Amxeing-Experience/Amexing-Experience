const DashboardController = require('./DashboardController');

/**
 * RoleBasedController - Liskov Substitution Principle (LSP) & Interface Segregation Principle (ISP)
 * Child classes can be substituted for parent class
 * Provides role-specific interfaces without forcing unnecessary implementations.
 */
class RoleBasedController extends DashboardController {
  constructor(role) {
    super();
    this.role = role;
    this.permissions = this.getDefaultPermissions();
  }

  /**
   * Get default permissions for the role.
   * @example
   * // GET endpoint example
   * const result = await RoleBasedController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {*} - Operation result.
   */
  getDefaultPermissions() {
    const permissionMap = {
      superadmin: ['*'], // All permissions
      admin: [
        'view_all_clients',
        'manage_clients',
        'view_all_users',
        'manage_bookings',
        'view_reports',
        'manage_fleet',
        'manage_drivers',
      ],
      client: [
        'view_own_company',
        'manage_departments',
        'manage_employees',
        'view_company_reports',
        'manage_budgets',
        'approve_bookings',
      ],
      department_manager: [
        'view_department',
        'manage_team',
        'approve_team_bookings',
        'view_department_budget',
        'allocate_budget',
        'view_department_reports',
      ],
      employee: [
        'view_own_profile',
        'create_booking',
        'view_own_bookings',
        'view_own_budget',
        'submit_feedback',
      ],
      driver: [
        'view_own_profile',
        'view_assigned_trips',
        'update_trip_status',
        'view_earnings',
        'manage_vehicle',
      ],
      guest: ['view_event_info', 'view_transport_details'],
    };

    return permissionMap[this.role] || [];
  }

  /**
   * Check if user has required role.
   * @param {*} requiredRole - RequiredRole parameter.
   * @example
   * // Usage example
   * const result = await requireRole({ requiredRole: 'example' });
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {*} - Operation result.
   */
  requireRole(requiredRole) {
    return (req, res, next) => {
      // Redirect to login if user not authenticated
      if (!req.user) {
        return this.redirectWithMessage(
          res,
          '/login',
          'Please login to continue',
          'error'
        );
      }

      const roleHierarchy = {
        superadmin: 7,
        admin: 6,
        client: 5,
        department_manager: 4,
        employee: 3,
        driver: 2,
        guest: 1,
      };

      // eslint-disable-next-line security/detect-object-injection
      const userLevel = roleHierarchy[req.user.role] || 0;
      const requiredLevel = roleHierarchy[requiredRole] || 0;

      // Check if user has sufficient permissions
      if (userLevel < requiredLevel) {
        return this.handleError(
          res,
          new Error('Insufficient permissions'),
          403
        );
      }

      next();
    };
  }

  /**
   * Get role-specific view path.
   * @param {*} viewName - ViewName parameter.
   * @example
   * // GET endpoint example
   * const result = await RoleBasedController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {*} - Operation result.
   */
  getRoleViewPath(viewName) {
    return `dashboards/${this.role}/${viewName}`;
  }

  /**
   * Render role-specific view.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @param {*} viewName - ViewName parameter.
   * @param {object} data - Data object.
   * @example
   * // Usage example
   * const result = await renderRoleView({ viewName: 'example', data: 'example' });
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async renderRoleView(req, res, viewName, data = {}) {
    const viewPath = this.getRoleViewPath(viewName);
    const roleData = {
      ...data,
      userRole: this.role,
      permissions: this.permissions,
    };

    return this.renderDashboard(req, res, viewPath, roleData);
  }

  /**
   * Get role-specific menu items.
   * @example
   * // GET endpoint example
   * const result = await RoleBasedController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {Array} - Array of results Operation result.
   */
  getRoleMenuItems() {
    // This will be overridden by specific role controllers
    return [];
  }

  /**
   * Get role-specific dashboard widgets.
   * @param {string} userId - User unique identifier.
   * @param {*} userId - _userId parameter.
   * @param _userId
   * @example
   * // GET endpoint example
   * const result = await RoleBasedController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async getRoleWidgets(_userId) {
    // This will be overridden by specific role controllers
    return [];
  }

  /**
   * Apply role-specific data filters.
   * @param {object} query - Query parameters object.
   * @param {*} user - User parameter.
   * @param {*} user - _user parameter.
   * @param _user
   * @example
   * // Usage example
   * const result = await applyRoleFilters({ query: 'example', _user: 'example' });
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {*} - Operation result.
   */
  applyRoleFilters(query, _user) {
    // This will be overridden by specific role controllers
    return query;
  }

  /**
   * Get role-specific notifications.
   * @param {string} userId - User unique identifier.
   * @param {*} userId - _userId parameter.
   * @param _userId
   * @example
   * // GET endpoint example
   * const result = await RoleBasedController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async getRoleNotifications(_userId) {
    // This will be overridden by specific role controllers
    return [];
  }

  /**
   * Validate role-specific actions.
   * @param {string} action - Action identifier.
   * @param {*} user - User parameter.
   * @param {*} user - _user parameter.
   * @param _user
   * @example
   * // Validation utility usage
   * const isValid = validateFunction(input);
   * // Returns: boolean
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {boolean} - Boolean result Operation result.
   */
  validateRoleAction(action, _user) {
    if (this.permissions.includes('*')) {
      return true;
    }

    return this.permissions.includes(action);
  }

  /**
   * Get role dashboard route.
   * @example
   * // GET endpoint example
   * const result = await RoleBasedController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {*} - Operation result.
   */
  getRoleDashboardRoute() {
    return `/dashboard/${this.role}`;
  }

  /**
   * Handle role-specific redirects.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await handleRoleRedirect(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {void} - No return value Operation result.
   */
  handleRoleRedirect(req, res) {
    const dashboardRoute = this.getRoleDashboardRoute();
    return res.redirect(dashboardRoute);
  }

  /**
   * Log role-specific activity.
   * @param {string} userId - User unique identifier.
   * @param {string} action - Action identifier.
   * @param {*} details - Details parameter.
   * @example
   * // Usage example
   * const result = await logRoleActivity({ userId: 'example' , action: 'example', details: 'example' });
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async logRoleActivity(userId, action, details = {}) {
    const activityData = {
      ...details,
      role: this.role,
      timestamp: new Date(),
    };

    return this.logActivity(userId, action, activityData);
  }

  /**
   * Get role-specific settings.
   * @example
   * // GET endpoint example
   * const result = await RoleBasedController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {*} - Operation result.
   */
  getRoleSettings() {
    const settingsMap = {
      superadmin: {
        showSystemStats: true,
        showAllClients: true,
        canModifySystem: true,
        canViewAuditLogs: true,
      },
      admin: {
        showOperationalStats: true,
        showClientManagement: true,
        canManageFleet: true,
        canViewReports: true,
      },
      client: {
        showCompanyStats: true,
        showDepartments: true,
        canManageBudgets: true,
        canApproveBookings: true,
      },
      department_manager: {
        showDepartmentStats: true,
        showTeamManagement: true,
        canAllocateBudget: true,
        canApproveTeamBookings: true,
      },
      employee: {
        showPersonalStats: true,
        canCreateBookings: true,
        canViewBudget: true,
        canSubmitFeedback: true,
      },
      driver: {
        showTripStats: true,
        showEarnings: true,
        canUpdateTripStatus: true,
        canManageVehicle: true,
      },
      guest: {
        showEventInfo: true,
        showTransportInfo: true,
        canViewOnly: true,
      },
    };

    return settingsMap[this.role] || {};
  }
}

module.exports = RoleBasedController;
