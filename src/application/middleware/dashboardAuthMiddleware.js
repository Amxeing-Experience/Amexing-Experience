const jwt = require('jsonwebtoken');
const logger = require('../../infrastructure/logger');

/**
 * Simplified Dashboard Authentication Middleware
 * Lightweight authentication for EJS dashboard views with role-based routing.
 */
class DashboardAuthMiddleware {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    this.roleHierarchy = {
      superadmin: 7,
      admin: 6,
      client: 5,
      department_manager: 4,
      employee: 3,
      driver: 2,
      guest: 1,
    };

    // Define role-based dashboard access permissions
    this.dashboardPermissions = {
      superadmin: [
        'superadmin',
        'admin',
        'client',
        'department_manager',
        'employee',
        'driver',
        'guest',
      ],
      admin: ['admin', 'client', 'department_manager', 'employee', 'driver'],
      client: ['client', 'department_manager', 'employee'],
      department_manager: ['department_manager', 'employee'],
      employee: ['employee'],
      driver: ['driver'],
      guest: ['guest'],
    };
  }

  /**
   * Simple authentication middleware for dashboard routes with guard conditions.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @param {Function} next - Next middleware function.
   * @example
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {void} - No return value Operation result.
   */
  requireAuth = (req, res, next) => {
    // Skip authentication for logout requests
    if (req.isLogout) {
      return next();
    }

    // Guard condition: prevent circular redirects to login
    const currentPath = req.path;
    if (
      currentPath === '/login'
      || currentPath.startsWith('/auth/')
      || currentPath === '/logout'
    ) {
      return next();
    }

    const accessToken = req.cookies?.accessToken;
    const sessionToken = req.cookies?.sessionToken;

    if (!accessToken && !sessionToken) {
      return res.redirect(
        `/login?returnTo=${encodeURIComponent(req.originalUrl)}`
      );
    }

    // Extract user info from JWT token if available
    let user = {
      id: 'unknown',
      username: 'unknown',
      role: 'guest',
      name: 'Unknown User',
      isActive: true,
    };

    if (accessToken) {
      try {
        const decoded = jwt.verify(accessToken, this.jwtSecret);
        user = {
          id: decoded.userId || 'unknown',
          username: decoded.username || 'unknown',
          role: decoded.role || 'guest',
          name: decoded.username || 'Unknown User',
          isActive: true,
        };
      } catch (error) {
        logger.warn('Invalid JWT token:', error.message);
      }
    }

    // Attach user to request and locals for EJS templates
    req.user = user;
    res.locals.user = user;
    res.locals.userRole = user.role;
    res.locals.userName = user.name || user.username;
    res.locals.userId = user.id;
    res.locals.accessToken = accessToken; // Pass token to templates

    next();
  };

  /**
   * Role-based access control middleware with redirect prevention.
   * @param {*} requiredRole - RequiredRole parameter.
   * @example
   * // app.use(middlewareName);
   * // Middleware protects routes with validation/authentication
   * @returns {void} - No return value Operation result.
   */
  requireRole = (requiredRole) => (req, res, next) => {
    // Guard condition: prevent redirects during logout
    if (req.isLogout) {
      return next();
    }

    const currentPath = req.path;

    // Guard condition: skip role checks for auth routes
    if (
      currentPath === '/login'
      || currentPath.startsWith('/auth/')
      || currentPath === '/logout'
    ) {
      return next();
    }

    if (!req.user) {
      return res.redirect(
        `/login?returnTo=${encodeURIComponent(req.originalUrl)}`
      );
    }

    const userRole = req.user.role;
    const userLevel = this.roleHierarchy[userRole] || 0;
    const requiredLevel = this.roleHierarchy[requiredRole] || 0;

    if (userLevel < requiredLevel) {
      logger.warn('Dashboard access denied - insufficient role:', {
        userId: req.user.id,
        userRole,
        requiredRole,
        url: req.originalUrl,
      });

      // Instead of error page, redirect to user's own dashboard to prevent loops
      return res.redirect(`/dashboard/${userRole}`);
    }

    next();
  };

  /**
   * Dashboard-specific role validation with redirect loop prevention.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @param {Function} next - Next middleware function.
   * @example
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {void} - No return value Operation result.
   */
  requireDashboardAccess = (req, res, next) => {
    if (!req.user) {
      return res.redirect(
        `/login?returnTo=${encodeURIComponent(req.originalUrl)}`
      );
    }

    // Extract requested dashboard role from URL
    const urlParts = req.path.split('/');
    const requestedDashboard = urlParts[2]; // /dashboard/{role}/...

    if (!requestedDashboard) {
      // Root dashboard access - redirect to user's default dashboard
      return res.redirect(`/dashboard/${req.user.role}`);
    }

    const userRole = req.user.role;
    const allowedDashboards = this.dashboardPermissions[userRole] || [];

    // Check if the requested dashboard is valid
    if (
      !Object.prototype.hasOwnProperty.call(
        this.roleHierarchy,
        requestedDashboard
      )
    ) {
      logger.warn(
        'Invalid dashboard requested - redirecting to user dashboard:',
        {
          userId: req.user.id,
          userRole,
          requestedDashboard,
        }
      );
      return res.redirect(`/dashboard/${userRole}`);
    }

    // Allow access if user has permission OR if it's their own dashboard
    if (
      allowedDashboards.includes(requestedDashboard)
      || requestedDashboard === userRole
    ) {
      next();
    } else {
      logger.warn('Dashboard access denied - redirecting to user dashboard:', {
        userId: req.user.id,
        userRole,
        requestedDashboard,
        allowedDashboards,
      });
      return res.redirect(`/dashboard/${userRole}`);
    }
  };

  /**
   * Optional middleware - inject user context even if not authenticated.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @param {Function} next - Next middleware function.
   * @example
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {*} - Operation result.
   */
  injectUserContext = (req, res, next) => {
    const accessToken = req.cookies?.accessToken;

    if (accessToken) {
      try {
        const decoded = jwt.verify(accessToken, this.jwtSecret);
        const user = {
          id: decoded.userId || 'unknown',
          username: decoded.username || 'unknown',
          role: decoded.role || 'guest',
          name: decoded.username || 'Unknown User',
          isActive: true,
        };

        req.user = user;
        res.locals.user = user;
        res.locals.userRole = user.role;
        res.locals.userName = user.name || user.username;
        res.locals.userId = user.id;
        res.locals.isAuthenticated = true;
      } catch (error) {
        res.locals.isAuthenticated = false;
        res.locals.user = null;
      }
    } else {
      res.locals.isAuthenticated = false;
      res.locals.user = null;
    }

    next();
  };

  /**
   * Logout middleware - clear all authentication tokens.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @param {Function} next - Next middleware function.
   * @example
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {*} - Operation result.
   */
  logout = async (req, res, next) => {
    // Clear authentication cookies with proper options
    res.clearCookie('accessToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });
    res.clearCookie('sessionToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    // Clear user from request/locals immediately
    req.user = null;
    res.locals.user = null;
    res.locals.isAuthenticated = false;

    // Mark this request as a logout to prevent redirects
    req.isLogout = true;

    // Regenerate session instead of destroying to prevent race condition
    if (req.session) {
      req.session.regenerate(async (err) => {
        if (err) {
          logger.error('Session regeneration failed during logout:', err);
          // Fallback: destroy and continue
          return req.session.destroy(() => next());
        }

        // Initialize CSRF secret for new session
        try {
          const uidSafe = require('uid-safe');
          req.session.csrfSecret = await uidSafe(32);
          logger.debug('New CSRF secret generated after logout', {
            sessionID: req.session.id,
          });
        } catch (csrfErr) {
          logger.error('CSRF secret generation failed during logout:', csrfErr);
        }

        next();
      });
    } else {
      next();
    }
  };

  /**
   * Redirect authenticated users away from auth pages with improved guards.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @param {Function} next - Next middleware function.
   * @example
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {void} - No return value Operation result.
   */
  redirectIfAuthenticated = (req, res, next) => {
    // Skip redirect check if this is a logout request
    if (req.isLogout) {
      return next();
    }

    // Guard condition: only apply to login/register pages
    const currentPath = req.path;
    if (
      currentPath !== '/login'
      && currentPath !== '/register'
      && !currentPath.startsWith('/auth/')
    ) {
      return next();
    }

    const accessToken = req.cookies?.accessToken;
    const sessionToken = req.cookies?.sessionToken;

    // If no tokens present, allow access to auth pages
    if (!accessToken && !sessionToken) {
      return next();
    }

    // Simple JWT validation without database calls
    if (accessToken) {
      try {
        const decoded = jwt.verify(accessToken, this.jwtSecret);
        if (decoded && decoded.role) {
          const returnTo = req.query.returnTo || `/dashboard/${decoded.role}`;
          logger.info('Redirecting authenticated user from auth page:', {
            from: currentPath,
            to: returnTo,
            userRole: decoded.role,
          });
          return res.redirect(returnTo);
        }
      } catch (error) {
        // Invalid token, clear it and allow access to auth pages
        res.clearCookie('accessToken');
        return next();
      }
    }

    // If sessionToken exists but no valid JWT, allow access to auth pages
    next();
  };
}

module.exports = new DashboardAuthMiddleware();
