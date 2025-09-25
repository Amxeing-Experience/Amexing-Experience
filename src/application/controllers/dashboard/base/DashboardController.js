const BaseController = require('./BaseController');
const logger = require('../../../../infrastructure/logger');

/**
 * DashboardController - Open/Closed Principle (OCP)
 * Open for extension (through inheritance), closed for modification
 * Extends BaseController with dashboard-specific functionality.
 */
class DashboardController extends BaseController {
  constructor() {
    super();
    this.dashboardData = {};
  }

  /**
   * Initialize dashboard-specific middleware.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @param {Function} next - Next middleware function.
   * @example
   * // Usage example
   * const result = await initializeDashboard(parameters);
   * // Returns: operation result
   * // app.use(middlewareName);
   * // Middleware protects routes with validation/authentication
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async initializeDashboard(req, res, next) {
    try {
      // Set common dashboard data
      res.locals.currentPath = req.path;
      res.locals.currentYear = new Date().getFullYear();

      // Add user data if available
      if (req.user) {
        res.locals.user = req.user;
        res.locals.userId = req.user.id;
        res.locals.userName = req.user.name || req.user.username;
        res.locals.userRole = req.user.role;
      }

      next();
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Get dashboard statistics (to be overridden by child classes).
   * @param {string} userId - User unique identifier.
   * @param {*} role - Role parameter.
   * @param {*} userId - _userId parameter.
   * @param {*} role - _role parameter.
   * @param _userId
   * @param _role
   * @example
   * // GET endpoint example
   * const result = await DashboardController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async getDashboardStats(_userId, _role) {
    // Default implementation - can be overridden by specific role controllers
    return {
      totalItems: 0,
      pendingItems: 0,
      completedItems: 0,
      recentActivity: [],
    };
  }

  /**
   * Render dashboard with common structure.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @param {*} view - View parameter.
   * @param {*} additionalData - AdditionalData parameter.
   * @example
   * // Usage example
   * const result = await renderDashboard({ view: 'example', additionalData: 'example' });
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async renderDashboard(req, res, view, additionalData = {}) {
    try {
      const stats = await this.getDashboardStats(req.user?.id, req.user?.role);

      const dashboardData = {
        ...additionalData,
        stats,
        user: req.user || {
          id: '', role: 'guest', email: '', clientId: '', departmentId: '',
        },
        userRole: req.user?.role || 'guest',
        userName: req.user?.name || 'Guest User',
        userId: req.user?.id,
        accessToken: res.locals.accessToken || req.cookies?.accessToken || '',
        breadcrumb: this.buildBreadcrumb(req.path, req.user?.role),
      };

      return await this.render(res, view, dashboardData);
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Build breadcrumb navigation.
   * @param {*} path - Path parameter.
   * @param {*} role - Role parameter.
   * @param {*} role - _role parameter.
   * @param _role
   * @example
   * // Usage example
   * const result = await buildBreadcrumb({ path: 'example', _role: 'example' });
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {object} - Operation result.
   */
  buildBreadcrumb(path, _role) {
    const pathParts = path.split('/').filter((part) => part);
    const breadcrumbItems = [];

    if (pathParts.length < 2) {
      return null;
    }

    // Skip 'dashboard' and role parts, build from the rest
    for (let i = 2; i < pathParts.length; i++) {
      const name = pathParts[i]
        .replace(/-/g, ' ')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (l) => l.toUpperCase());

      breadcrumbItems.push({
        name,
        link: `/${pathParts.slice(0, i + 1).join('/')}`,
        active: i === pathParts.length - 1,
      });
    }

    if (breadcrumbItems.length === 0) {
      return null;
    }

    const lastItem = breadcrumbItems[breadcrumbItems.length - 1];
    return {
      title: lastItem.name,
      items: breadcrumbItems,
    };
  }

  /**
   * Get notifications for dashboard.
   * @param {string} userId - User unique identifier.
   * @param {*} role - Role parameter.
   * @param {*} userId - _userId parameter.
   * @param {*} role - _role parameter.
   * @param _userId
   * @param _role
   * @example
   * // GET endpoint example
   * const result = await DashboardController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async getNotifications(_userId, _role) {
    // Default implementation - can be overridden
    return [];
  }

  /**
   * Get quick actions based on role.
   * @param {*} role - Role parameter.
   * @param {*} role - _role parameter.
   * @param _role
   * @example
   * // GET endpoint example
   * const result = await DashboardController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {Array} - Array of results Operation result.
   */
  getQuickActions(_role) {
    // Default implementation - can be overridden
    return [];
  }

  /**
   * Log dashboard activity.
   * @param {string} userId - User unique identifier.
   * @param {string} action - Action identifier.
   * @param {*} details - Details parameter.
   * @example
   * // Usage example
   * const result = await logActivity({ userId: 'example' , action: 'example', details: 'example' });
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async logActivity(userId, action, details = {}) {
    try {
      // Log to activity tracking system
      logger.info(`Activity: User ${userId} performed ${action}`, details);
      // In production, this would save to database
    } catch (error) {
      logger.error('Failed to log activity:', error);
    }
  }

  /**
   * Check dashboard permissions.
   * @param {*} user - User parameter.
   * @param {*} permission - Permission parameter.
   * @example
   * // Usage example
   * const result = await hasPermission({ user: 'example', permission: 'example' });
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {boolean} - Boolean result Operation result.
   */
  hasPermission(user, permission) {
    if (!user || !user.permissions) {
      return false;
    }

    // Super admin has all permissions
    if (user.role === 'superadmin') {
      return true;
    }

    return user.permissions.includes(permission);
  }

  /**
   * Get filtered data based on user's access level.
   * @param {object} query - Query parameters object.
   * @param {*} user - User parameter.
   * @example
   * // GET endpoint example
   * const result = await DashboardController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async getFilteredData(query, user) {
    const filters = { ...query };

    // Apply role-based filters
    switch (user.role) {
      case 'client':
        filters.clientId = user.clientId;
        break;
      case 'department_manager':
        filters.departmentId = user.departmentId;
        break;
      case 'employee':
        filters.employeeId = user.id;
        break;
      case 'driver':
        filters.driverId = user.id;
        break;
      default:
        // Admin and superadmin see all
        break;
    }

    return filters;
  }
}

module.exports = DashboardController;
