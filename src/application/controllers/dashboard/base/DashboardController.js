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
   * @param req
   * @param res
   * @param next
   * @example
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
   * @param userId
   * @param role
   * @param _userId
   * @param _role
   * @example
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
   * @param req
   * @param res
   * @param view
   * @param additionalData
   * @example
   */
  async renderDashboard(req, res, view, additionalData = {}) {
    try {
      const stats = await this.getDashboardStats(req.user?.id, req.user?.role);

      const dashboardData = {
        ...additionalData,
        stats,
        userRole: req.user?.role || 'guest',
        userName: req.user?.name || 'Guest User',
        userId: req.user?.id,
        breadcrumb: this.buildBreadcrumb(req.path, req.user?.role),
      };

      return await this.render(res, view, dashboardData);
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Build breadcrumb navigation.
   * @param path
   * @param role
   * @param _role
   * @example
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
   * @param userId
   * @param role
   * @param _userId
   * @param _role
   * @example
   */
  async getNotifications(_userId, _role) {
    // Default implementation - can be overridden
    return [];
  }

  /**
   * Get quick actions based on role.
   * @param role
   * @param _role
   * @example
   */
  getQuickActions(_role) {
    // Default implementation - can be overridden
    return [];
  }

  /**
   * Log dashboard activity.
   * @param userId
   * @param action
   * @param details
   * @example
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
   * @param user
   * @param permission
   * @example
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
   * @param query
   * @param user
   * @example
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
