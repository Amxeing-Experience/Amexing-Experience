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
      employee: ['view_own_profile', 'create_booking', 'view_own_bookings', 'view_own_budget', 'submit_feedback'],
      driver: ['view_own_profile', 'view_assigned_trips', 'update_trip_status', 'view_earnings', 'manage_vehicle'],
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
        return this.redirectWithMessage(res, '/login', 'Please login to continue', 'error');
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
        return this.handleError(res, new Error('Insufficient permissions'), 403);
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
   * Renders the user profile page showing personal information and settings.
   * Generic profile method that can be used by all role-based controllers.
   * @function profile
   * @async
   * @param {object} req - Express request object containing authenticated user information.
   * @param {object} res - Express response object for rendering profile view.
   * @returns {Promise<void>} Renders the profile view.
   * @throws {Error} If user is not authenticated or profile data cannot be retrieved.
   * @example
   */
  async profile(req, res) {
    try {
      // Get basic user data from session/auth middleware
      const basicUserData = req.session?.user || req.user || {};

      // Fetch complete user data from Parse Server database
      let fullUserData = {};
      try {
        const Parse = require('parse/node');

        console.log('=== FETCHING USER FROM DATABASE ===');
        console.log('basicUserData.id:', basicUserData.id);

        // Try both Parse.User and AmexingUser tables
        let parseUser = null;

        // First try Parse.User table
        try {
          const userQuery = new Parse.Query(Parse.User);
          userQuery.equalTo('objectId', basicUserData.id);
          parseUser = await userQuery.first({ useMasterKey: true });
          console.log('Parse.User query result:', parseUser ? 'Found' : 'Not found');
        } catch (error) {
          console.log('Parse.User query error:', error.message);
        }

        // If not found in Parse.User, try AmexingUser table
        if (!parseUser) {
          try {
            const amexingUserQuery = new Parse.Query('AmexingUser');
            amexingUserQuery.equalTo('objectId', basicUserData.id);
            parseUser = await amexingUserQuery.first({ useMasterKey: true });
            console.log('AmexingUser query result:', parseUser ? 'Found' : 'Not found');
          } catch (error) {
            console.log('AmexingUser query error:', error.message);
          }
        }

        if (parseUser) {
          console.log('User createdAt from DB:', parseUser.get('createdAt'));
          console.log('User created_at from DB:', parseUser.get('created_at'));
          console.log('User _created_at from DB:', parseUser.get('_created_at'));

          fullUserData = {
            id: parseUser.id,
            objectId: parseUser.id,
            username: parseUser.get('username'),
            email: parseUser.get('email'),
            firstName: parseUser.get('firstName'),
            lastName: parseUser.get('lastName'),
            fullName: parseUser.get('fullName'),
            phone: parseUser.get('phone'),
            department: parseUser.get('department'),
            employeeId: parseUser.get('employeeId'),
            createdAt: parseUser.get('createdAt') || parseUser.createdAt,
            updatedAt: parseUser.get('updatedAt') || parseUser.updatedAt,
            lastLoginAt: parseUser.get('lastLoginAt'),
            emailVerified: parseUser.get('emailVerified'),
            active: parseUser.get('active'),
            exists: parseUser.get('exists'),
            profilePicture: parseUser.get('profilePicture'),
            role: parseUser.get('role') || basicUserData.role,
            organizationId: parseUser.get('organizationId'),
          };
          console.log('Final fullUserData.createdAt:', fullUserData.createdAt);
        } else {
          console.log('User not found in either table');
        }
        console.log('=====================================');
      } catch (dbError) {
        console.error('Error fetching user from database:', dbError);
        // Fall back to basic user data if database fetch fails
        fullUserData = basicUserData;
      }

      // Prepare user data for the view
      const profileData = {
        id: fullUserData.id || fullUserData.objectId,
        username: fullUserData.username,
        email: fullUserData.email,
        firstName: fullUserData.firstName || fullUserData.first_name || '',
        lastName: fullUserData.lastName || fullUserData.last_name || '',
        fullName: fullUserData.fullName || `${fullUserData.firstName || ''} ${fullUserData.lastName || ''}`.trim(),
        phone: fullUserData.phone || fullUserData.phoneNumber || '',
        department: fullUserData.department || '',
        employeeId: fullUserData.employeeId || fullUserData.employee_id || '',
        createdAt: fullUserData.createdAt,
        lastLoginAt: fullUserData.lastLoginAt || fullUserData.last_login_at,
        emailVerified: fullUserData.emailVerified || fullUserData.email_verified || false,
        active: fullUserData.active !== undefined ? fullUserData.active : true,
        exists: fullUserData.exists !== undefined ? fullUserData.exists : true,
        profilePicture: fullUserData.profilePicture || fullUserData.avatar || '',
        role: fullUserData.role || this.role,
        organizationId: fullUserData.organizationId || fullUserData.organization_id || '',
      };

      await this.renderRoleView(req, res, 'profile', {
        title: 'My Profile',
        userData: profileData,
        breadcrumb: {
          title: 'Profile',
          items: [{ name: 'Profile', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
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
   * @param {string} _userId - User unique identifier (unused parameter).
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
   * @param {*} _user - _user parameter.
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
   * @param {string} _userId - User unique identifier (unused parameter).
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
   * @param {string} _user - User unique identifier (unused parameter).
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

  /**
   * Change password page handler for authenticated users.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // GET endpoint example
   * const result = await RoleBasedController.changePassword(req, res);
   * // Returns: renders change-password view
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {Promise<void>} - Promise resolving to view render.
   */
  async changePassword(req, res) {
    try {
      await this.renderRoleView(req, res, 'change-password', {
        title: 'Change Password',
        csrfToken: res.locals.csrfToken,
        breadcrumb: {
          title: 'Change Password',
          items: [
            { name: 'Profile', href: `${this.getRoleDashboardRoute()}/profile` },
            { name: 'Change Password', active: true },
          ],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }
}

module.exports = RoleBasedController;
