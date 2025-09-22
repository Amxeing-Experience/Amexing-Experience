const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');

/**
 * Authentication Middleware - Standard Parse Server authentication middleware.
 * Provides traditional Parse User authentication using session tokens with
 * comprehensive validation and user context injection for protected routes.
 *
 * This middleware implements the standard Parse Server authentication flow,
 * validating session tokens and attaching authenticated users to requests
 * for downstream processing.
 *
 * Features:
 * - Parse Server session token validation
 * - Multiple token source support (headers, session, cookies)
 * - User context injection into request objects
 * - Comprehensive error handling with proper HTTP codes
 * - Security logging for authentication attempts
 * - Integration with Parse User model
 * - Session management and validation.
 * @class AuthMiddleware
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // Initialize authentication middleware
 * const authMiddleware = new AuthMiddleware();
 *
 * // Apply to protected routes
 * router.use('/api/protected', authMiddleware.requireAuth.bind(authMiddleware));
 * router.get('/api/user/profile', authMiddleware.requireAuth.bind(authMiddleware), userController.getProfile);
 *
 * // Token sources (in order of preference):
 * // 1. X-Parse-Session-Token header
 * // 2. req.session.sessionToken (Express session)
 * // 3. sessionToken cookie
 */
class AuthMiddleware {
  async requireAuth(req, res, next) {
    try {
      // Check for session token in headers or session
      const sessionToken = req.headers['x-parse-session-token']
        || req.session?.sessionToken
        || req.cookies?.sessionToken;

      if (!sessionToken) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'No session token provided',
        });
      }

      // Verify session with Parse
      const user = await Parse.User.become(sessionToken);

      if (!user) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid session token',
        });
      }

      // Attach user to request
      req.user = user;
      req.sessionToken = sessionToken;

      next();
    } catch (error) {
      logger.error('Authentication error:', error);

      if (error.code === 209) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid or expired session token',
        });
      }

      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Authentication failed',
      });
    }
  }

  /**
   * Optional authentication middleware that attempts authentication without requiring it.
   * Tries to authenticate the user if session token is present, but continues
   * processing even if authentication fails, allowing for optional user context.
   * @function optionalAuth
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @param {Function} next - Express next middleware function.
   * @returns {Promise<void>} Continues to next middleware.
   * @example
   * // Use for endpoints that work with or without authentication
   * router.get('/public-data', authMiddleware.optionalAuth, controller.getData);
   * // req.user will be set if authenticated, null otherwise
   */
  async optionalAuth(req, res, next) {
    try {
      const sessionToken = req.headers['x-parse-session-token']
        || req.session?.sessionToken
        || req.cookies?.sessionToken;

      if (sessionToken) {
        const user = await Parse.User.become(sessionToken);
        req.user = user;
        req.sessionToken = sessionToken;
      }

      next();
    } catch (error) {
      // Continue without authentication
      next();
    }
  }

  /**
   * Creates role-based authorization middleware for protected routes.
   * Returns middleware function that validates user has required role in Parse Server
   * role system, with comprehensive error handling and security logging.
   * @function requireRole
   * @param {string} role - Required role name (e.g., 'admin', 'manager', 'editor').
   * @returns {Function} Express middleware function for role validation.
   * @example
   * // Protect admin routes
   * router.get('/admin', authMiddleware.requireRole('admin'), adminController.dashboard);
   *
   * // Protect manager routes
   * router.post('/users', authMiddleware.requireRole('manager'), userController.create);
   *
   * // Chain with authentication
   * router.use('/protected', authMiddleware.requireAuth, authMiddleware.requireRole('user'));
   */
  requireRole(role) {
    return async (req, res, next) => {
      try {
        if (!req.user) {
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Authentication required',
          });
        }

        // Check if user has required role
        const roleQuery = new Parse.Query(Parse.Role);
        roleQuery.equalTo('name', role);
        roleQuery.equalTo('users', req.user);

        const hasRole = await roleQuery.first({ useMasterKey: true });

        if (!hasRole) {
          logger.logSecurityEvent('UNAUTHORIZED_ACCESS_ATTEMPT', {
            userId: req.user.id,
            requiredRole: role,
            path: req.path,
          });

          return res.status(403).json({
            error: 'Forbidden',
            message: 'Insufficient permissions',
          });
        }

        next();
      } catch (error) {
        logger.error('Role check error:', error);
        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'Authorization failed',
        });
      }
    };
  }
}

module.exports = new AuthMiddleware();
