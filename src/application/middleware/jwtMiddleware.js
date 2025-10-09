/**
 * JWT Authentication Middleware.
 * Handles JWT token validation and user authentication for API endpoints.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Middleware usage
 * app.use('/path', middlewareFunction);
 * // Processes request before route handler
 */

const expressRateLimit = require('express-rate-limit');
const AuthenticationService = require('../services/AuthenticationService');
const logger = require('../../infrastructure/logger');

/**
 * Middleware to validate JWT tokens from cookies or Authorization header.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {Function} next - Express next function.
 * @returns {Promise<void>} - Promise that resolves when authentication is complete.
 * @throws {Error} Throws error if token validation fails.
 * @example
 * // Middleware usage
 * app.use('/path', middlewareFunction);
 * // Processes request before route handler
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Use as middleware in route
 * app.get('/protected', authenticateToken, (req, res) => {
 *   res.json({ user: req.user });
 * });
 */
const authenticateToken = async (req, res, next) => {
  try {
    // Extract token from cookies (preferred) or Authorization header
    let token = req.cookies?.accessToken;

    logger.debug('JWT Middleware - Cookie token:', { tokenPresent: !!token });

    if (!token) {
      const authHeader = req.headers.authorization;
      logger.debug('JWT Middleware - Auth header:', {
        headerPresent: !!authHeader,
      });
      token = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;
    }

    if (!token) {
      logger.debug('JWT Middleware - No token found, returning 401');
      return res.status(401).json({
        success: false,
        error: 'Access token required',
      });
    }

    logger.debug('JWT Middleware - Token found, validating..');

    // Validate token using AuthenticationService
    const result = await AuthenticationService.validateToken(token);

    logger.debug('JWT Middleware - Validation result:', { success: !!result });

    // Attach user information to request
    req.user = result.user;
    req.userId = result.userId;
    req.userRole = result.role; // Backward compatibility
    req.roleObject = result.roleObject; // New role object

    // Cache the roleObject in the user instance to avoid re-fetching
    if (req.user && req.roleObject) {
      req.user._cachedRole = req.roleObject;
    }

    logger.debug('JWT Middleware - User attached:', {
      userId: req.userId,
      role: req.userRole,
      organizationId: result.user?.organizationId,
    });

    next();
  } catch (error) {
    logger.error('JWT authentication error:', error);

    if (error.message === 'Token expired') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
    }

    return res.status(401).json({
      success: false,
      error: 'Invalid or malformed token',
    });
  }
};

/**
 * Middleware to optionally authenticate user (doesn't fail if no token).
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {Function} next - Express next function.
 * @returns {Promise<void>} - Promise that resolves when optional authentication check is complete.
 * @example
 * // Middleware usage
 * app.use('/path', middlewareFunction);
 * // Processes request before route handler
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Use for routes that work with or without authentication
 * app.get('/content', authenticateOptional, (req, res) => {
 *   const isAuthenticated = !!req.user;
 *   res.json({ authenticated: isAuthenticated, content: getContent(isAuthenticated) });
 * });
 */
const authenticateOptional = async (req, res, next) => {
  try {
    // Extract token from cookies or Authorization header
    let token = req.cookies?.accessToken;

    if (!token) {
      const authHeader = req.headers.authorization;
      token = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;
    }

    if (!token) {
      return next(); // Continue without authentication
    }

    // Validate token using AuthenticationService
    const result = await AuthenticationService.validateToken(token);

    // Attach user information to request
    req.user = result.user;
    req.userId = result.userId;
    req.userRole = result.role; // Backward compatibility
    req.roleObject = result.roleObject; // New role object

    next();
  } catch (error) {
    logger.warn('Optional JWT authentication failed:', error.message);
    // Continue without authentication on error
    next();
  }
};

/**
 * Middleware to check if user has specific role.
 * @param {string|Array<string>} allowedRoles - Single role or array of allowed roles.
 * @returns {Function} - Operation result Express middleware function that validates user roles.
 * @throws {Error} Throws error if user lacks required permissions.
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Require admin role
 * app.delete('/users/:id', authenticateToken, requireRole('admin'), deleteUser);
 *
 * // Allow multiple roles
 * app.get('/reports', authenticateToken, requireRole(['admin', 'manager']), getReports);
 */
const requireRole = (allowedRoles) => {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req, res, next) => {
    if (!req.user || !req.userRole) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    if (!roles.includes(req.userRole)) {
      logger.warn('Insufficient permissions:', {
        userId: req.userId,
        userRole: req.userRole,
        requiredRoles: roles,
      });

      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
      });
    }

    next();
  };
};

/**
 * Middleware to check if user has specific permission with context.
 * @param {string} permission - Permission to check (e.g., 'bookings.approve').
 * @param {object} contextExtractor - Function to extract context from request.
 * @returns {Function} - Express middleware function that validates permissions.
 * @example
 * // Check permission with dynamic context
 * app.patch('/bookings/:id/approve', authenticateToken,
 *   requirePermission('bookings.approve', (req) => ({
 *     amount: req.body.amount,
 *     departmentId: req.user.departmentId,
 *     timestamp: new Date()
 *   })),
 *   approveBooking
 * );
 */
const requirePermission = (permission, contextExtractor = () => ({})) => async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    // Extract context for permission check
    const context = typeof contextExtractor === 'function'
      ? contextExtractor(req)
      : contextExtractor || {};

    // Check if user has permission
    const hasPermission = await req.user.hasPermission(permission, context);

    if (!hasPermission) {
      logger.warn('Permission denied:', {
        userId: req.userId,
        permission,
        context,
        userRole: req.userRole,
      });

      return res.status(403).json({
        success: false,
        error: 'Permission denied',
        permission,
      });
    }

    // Attach permission context to request for use in handlers
    req.permissionContext = context;
    next();
  } catch (error) {
    logger.error('Permission check error:', {
      userId: req.userId,
      permission,
      error: error.message,
    });

    return res.status(500).json({
      success: false,
      error: 'Permission validation failed',
    });
  }
};

/**
 * Middleware to check role level (hierarchical permission).
 * @param {number} minimumLevel - Minimum role level required (1-7).
 * @returns {Function} - Express middleware function that validates role hierarchy.
 * @example
 * // Require manager level or higher (level 4+)
 * app.get('/sensitive-data', authenticateToken, requireRoleLevel(4), getSensitiveData);
 */
const requireRoleLevel = (minimumLevel) => async (req, res, next) => {
  try {
    if (!req.user || !req.roleObject) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const userLevel = req.roleObject.getLevel();

    if (userLevel < minimumLevel) {
      logger.warn('Insufficient role level:', {
        userId: req.userId,
        userLevel,
        requiredLevel: minimumLevel,
        userRole: req.userRole,
      });

      return res.status(403).json({
        success: false,
        error: 'Insufficient role level',
        required: minimumLevel,
        current: userLevel,
      });
    }

    next();
  } catch (error) {
    logger.error('Role level check error:', {
      userId: req.userId,
      minimumLevel,
      error: error.message,
    });

    return res.status(500).json({
      success: false,
      error: 'Role level validation failed',
    });
  }
};

/**
 * Middleware to check organization scope access.
 * @param {string} requiredScope - Required scope ('own', 'client', 'system').
 * @returns {Function} - Express middleware function that validates organization access.
 * @example
 * // Only allow access to own organization data
 * app.get('/organization/:id/data', authenticateToken, requireOrganizationScope('own'), getOrgData);
 */
const requireOrganizationScope = (requiredScope = 'own') => async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const userOrganizationId = req.user.organizationId;
    const targetOrganizationId = req.params.organizationId || req.body.organizationId;

    switch (requiredScope) {
      case 'own':
        if (
          targetOrganizationId
            && userOrganizationId !== targetOrganizationId
        ) {
          return res.status(403).json({
            success: false,
            error: 'Access limited to your own organization',
          });
        }
        break;

      case 'client':
        if (userOrganizationId === 'amexing') {
          // Amexing users can access any client organization
          break;
        }
        if (
          targetOrganizationId
            && userOrganizationId !== targetOrganizationId
        ) {
          return res.status(403).json({
            success: false,
            error: 'Access limited to your own organization',
          });
        }
        break;

      case 'system':
        if (userOrganizationId !== 'amexing') {
          return res.status(403).json({
            success: false,
            error: 'System access required',
          });
        }
        break;

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid scope configuration',
        });
    }

    next();
  } catch (error) {
    logger.error('Organization scope check error:', {
      userId: req.userId,
      requiredScope,
      error: error.message,
    });

    return res.status(500).json({
      success: false,
      error: 'Organization scope validation failed',
    });
  }
};

/**
 * Middleware to refresh expired tokens automatically.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {Function} next - Express next function.
 * @returns {Promise<void>} - Promise that resolves when token refresh attempt is complete.
 * @example
 * // Middleware usage
 * app.use('/path', middlewareFunction);
 * // Processes request before route handler
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Use before authentication middleware to auto-refresh tokens
 * app.use('/api', autoRefreshToken, authenticateToken);
 */
const autoRefreshToken = async (req, res, next) => {
  try {
    const accessToken = req.cookies?.accessToken;
    const refreshToken = req.cookies?.refreshToken;

    if (!accessToken && refreshToken) {
      // Try to refresh the token
      const result = await AuthenticationService.refreshToken(refreshToken);

      // Set new tokens in cookies
      res.cookie('accessToken', result.tokens.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 8 * 60 * 60 * 1000, // 8 hours
      });

      res.cookie('refreshToken', result.tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      // Attach user information to request
      req.user = result.user;
      req.userId = result.user.id;
      req.userRole = result.user.role;
    }

    next();
  } catch (error) {
    logger.error('Auto refresh token error:', error);
    // Clear invalid refresh token
    res.clearCookie('refreshToken');
    next();
  }
};

/**
 * Middleware to extract user information from valid session.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {Function} next - Express next function.
 * @returns {void} - No return value Synchronously extracts user data from session.
 * @example
 * // app.use(middlewareName);
 * // Middleware protects routes with validation/authentication
 * // Use for web routes that rely on session data
 * app.get('/profile', extractUser, (req, res) => {
 *   if (req.user) {
 *     res.render('profile', { user: req.user });
 *   } else {
 *     res.redirect('/login');
 *   }
 * });
 */
const extractUser = (req, res, next) => {
  // Check if user is already authenticated via JWT
  if (req.user) {
    return next();
  }

  // Check session for user information (fallback for web routes)
  if (req.session?.user) {
    req.user = req.session.user;
    req.userId = req.session.user.id;
    req.userRole = req.session.user.role;
  }

  next();
};

/**
 * Rate limiting specifically for authentication endpoints.
 * @example
 * // Middleware usage
 * app.use('/path', middlewareFunction);
 * // Processes request before route handler
 */
const authRateLimit = expressRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs for auth endpoints
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again later',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.user != null,
});

module.exports = {
  authenticateToken,
  authenticateOptional,
  requireRole,
  requirePermission,
  requireRoleLevel,
  requireOrganizationScope,
  autoRefreshToken,
  extractUser,
  authRateLimit,
};
