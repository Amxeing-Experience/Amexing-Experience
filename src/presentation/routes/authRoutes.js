/**
 * Authentication Routes - Handles all authentication-related endpoints
 * Integrates with AmexingUser model and authentication services.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 0.1.0
 * @example
 * // Usage example
 * const result = await require({ 'parse/node': 'example' });
 * // Returns: operation result
 */

const Parse = require('parse/node');
const express = require('express');
const rateLimit = require('express-rate-limit');
// bcrypt is handled by AmexingUser model, not needed here
const AuthenticationService = require('../../application/services/AuthenticationService');
// const OAuthService = require('../../application/services/OAuthService'); // Unused import
const jwtMiddleware = require('../../application/middleware/jwtMiddleware');
const dashboardAuthMiddleware = require('../../application/middleware/dashboardAuthMiddleware');
const logger = require('../../infrastructure/logger');
const authController = require('../../application/controllers/authController');

const router = express.Router();

/**
 * Retry logic for Parse Cloud Function calls with exponential backoff.
 * Helps prevent errors when cloud functions are not yet initialized during server startup.
 * @function callCloudFunctionWithRetry
 * @param {string} functionName - Name of the Parse Cloud Function to call.
 * @param {object} params - Parameters to pass to the cloud function.
 * @param {object} options - Additional Parse Cloud options (e.g., sessionToken).
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3).
 * @param {number} baseDelay - Base delay in milliseconds for exponential backoff (default: 100).
 * @returns {Promise<any>} - Result from the cloud function.
 * @throws {Error} - Throws error if all retries fail.
 * @private
 * @example
 * // Usage example documented above
 */
async function callCloudFunctionWithRetry(functionName, params = {}, options = {}, maxRetries = 3, baseDelay = 100) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Attempt to call the cloud function
      const result = await Parse.Cloud.run(functionName, params, options);
      return result;
    } catch (error) {
      lastError = error;

      // Check if error is "Invalid function" (code 141) - function not yet loaded
      const isInvalidFunction = error.code === 141 || error.message?.includes('Invalid function');

      // Only retry for "Invalid function" errors on first few attempts
      if (isInvalidFunction && attempt < maxRetries - 1) {
        const delay = baseDelay * 2 ** attempt; // Exponential backoff

        logger.warn(`Cloud function ${functionName} not ready, retrying in ${delay}ms`, {
          attempt: attempt + 1,
          maxRetries,
          error: error.message,
        });

        // Wait before retrying
        await new Promise((resolve) => {
          setTimeout(resolve, delay);
        });
        // continue is not needed here, the for loop will continue naturally
      } else {
        // For other errors or last attempt, throw immediately
        throw error;
      }
    }
  }

  // All retries exhausted
  logger.error(`Cloud function ${functionName} failed after ${maxRetries} attempts`, {
    error: lastError.message,
    code: lastError.code,
  });

  throw lastError;
}

// Rate limiting for auth endpoints
const authRateLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 50,
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const strictAuthRateLimit = rateLimit({
  windowMs: 300000, // 5 minutes
  max: 10,
  message: 'Too many password reset attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting
router.use(authRateLimit);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: User login with credentials
 *     description: |
 *       Authenticate user with email/username and password.
 *       Returns JWT token in response and sets HTTP-only cookie.
 *
 *       **Security Features:**
 *       - Rate limited: 50 requests per 15 minutes
 *       - Account lockout after 5 failed attempts
 *       - Secure password validation
 *       - JWT token lifetime: 8 hours
 *
 *       **Response Behavior:**
 *       - HTML clients: Redirects to role-specific dashboard
 *       - API clients: Returns JSON with user data
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *         application/x-www-form-urlencoded:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful
 *         headers:
 *           Set-Cookie:
 *             description: JWT access token (HTTP-only, Secure, SameSite=strict)
 *             schema:
 *               type: string
 *               example: "accessToken=eyJhbGc...; HttpOnly; Secure; SameSite=strict; Max-Age=28800"
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       302:
 *         description: Redirect to dashboard (for HTML clients)
 *         headers:
 *           Location:
 *             description: Redirect URL based on user role
 *             schema:
 *               type: string
 *               example: "/dashboard/employee"
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Invalid credentials or account locked
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
// Get JWT credentials for authenticated session
router.get('/credentials', dashboardAuthMiddleware.requireAuth, authController.getCredentials);

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { identifier, password, returnTo } = req.body;

    // Validate required fields
    // Check if identifier or password is missing
    if (!identifier || !password) {
      // Check if client expects HTML response
      if (req.accepts('html')) {
        return res.redirect(`/login?error=${encodeURIComponent('Email and password are required')}`);
      }
      return res.status(400).json({
        success: false,
        error: 'Email and password are required',
      });
    }

    // Use AmexingUser authentication directly
    let authenticatedUser = null;

    // Skip Parse.User.logIn - use only AmexingUser authentication
    try {
      // Force immediate fallback to AmexingUser by throwing error
      throw new Error('Using AmexingUser authentication only');
    } catch (parseError) {
      // Use AmexingUser authentication directly
      const AmexingUser = require('../../domain/models/AmexingUser');

      try {
        // Query AmexingUser using Parse SDK - email lookup with active/exists filter
        const query = new Parse.Query(AmexingUser);
        query.equalTo('email', identifier.toLowerCase().trim());
        query.equalTo('active', true);
        query.equalTo('exists', true);
        const user = await query.first({ useMasterKey: true });

        // Check if user was not found
        if (!user) {
          // Check if client expects HTML response
          if (req.accepts('html')) {
            return res.redirect(`/login?error=${encodeURIComponent('Invalid email or password')}`);
          }
          return res.status(401).json({
            success: false,
            error: 'Invalid email or password',
          });
        }

        // Verify password using bcrypt directly (registerSubclass is disabled)
        const bcrypt = require('bcrypt');
        const passwordHash = user.get('password');

        if (!passwordHash) {
          logger.error('No password hash found for user', { userId: user.id });
          // Check if client expects HTML response
          if (req.accepts('html')) {
            return res.redirect(`/login?error=${encodeURIComponent('Invalid email or password')}`);
          }
          return res.status(401).json({
            success: false,
            error: 'Invalid email or password',
          });
        }

        const passwordMatch = await bcrypt.compare(password, passwordHash);

        // Check if password does not match
        if (!passwordMatch) {
          // Record failed login attempt - use method if available, otherwise skip
          if (typeof user.recordFailedLogin === 'function') {
            await user.recordFailedLogin();
          } else {
            logger.warn('recordFailedLogin method not available, skipping', { userId: user.id });
          }

          // Check if client expects HTML response
          if (req.accepts('html')) {
            return res.redirect(`/login?error=${encodeURIComponent('Invalid email or password')}`);
          }
          return res.status(401).json({
            success: false,
            error: 'Invalid email or password',
          });
        }

        // Check if account is locked - use method if available, otherwise check field directly
        const isLocked = typeof user.isAccountLocked === 'function' ? user.isAccountLocked() : user.get('accountLocked') === true;

        if (isLocked) {
          // Check if client expects HTML response
          if (req.accepts('html')) {
            return res.redirect(`/login?error=${encodeURIComponent('Account is temporarily locked')}`);
          }
          return res.status(401).json({
            success: false,
            error: 'Account is temporarily locked',
          });
        }

        // Check if user is active and exists (not deleted)
        const isActive = user.get('active');
        const exists = user.get('exists');

        if (isActive === false) {
          logger.warn('Login attempt with deactivated account', {
            userId: user.id,
            email: user.get('email'),
          });
          // Check if client expects HTML response
          if (req.accepts('html')) {
            return res.redirect(`/login?error=${encodeURIComponent('Your account has been deactivated')}`);
          }
          return res.status(401).json({
            success: false,
            error: 'Your account has been deactivated',
          });
        }

        if (exists === false) {
          logger.warn('Login attempt with deleted account', {
            userId: user.id,
            email: user.get('email'),
          });
          // Check if client expects HTML response
          if (req.accepts('html')) {
            return res.redirect(`/login?error=${encodeURIComponent('Account not found')}`);
          }
          return res.status(401).json({
            success: false,
            error: 'Account not found',
          });
        }

        // Get role name from the new Role relationship
        let roleName = 'guest';
        const rolePointer = user.get('roleId');
        // Check if user has a role ID (could be Pointer or string)
        if (rolePointer) {
          try {
            // Handle both Pointer objects and string IDs
            let roleId;
            if (typeof rolePointer === 'string') {
              roleId = rolePointer;
            } else if (rolePointer.id) {
              roleId = rolePointer.id;
            }

            if (roleId) {
              const roleQuery = new Parse.Query('Role');
              const roleObject = await roleQuery.get(roleId, {
                useMasterKey: true,
              });
              // Check if role object was found
              if (roleObject) {
                roleName = roleObject.get('name');
              }
            }
          } catch (roleError) {
            logger.warn('Failed to fetch role for user, defaulting to guest', {
              userId: user.id,
              rolePointer: typeof rolePointer === 'string' ? rolePointer : rolePointer?.id,
              error: roleError.message,
            });
            // Fall back to old role field if new relationship fails
            roleName = user.get('role') || 'guest';
          }
        } else {
          // Fall back to old role field if no roleId
          roleName = user.get('role') || 'guest';
        }

        // Convert Parse Object user to standardized user object
        authenticatedUser = {
          id: user.id,
          username: user.get('username'),
          email: user.get('email'),
          role: roleName,
          roleId: rolePointer,
          clientId: user.get('clientId'),
          // Tipo de cliente directo (direct_client/wedding_planner/concierge/home_owner). Decide
          // capacidades del end_client (ver/crear cotizaciones, tarifario). null para otros roles.
          clientCategory: user.get('clientCategory') || null,
          organizationId: user.get('organizationId'),
          name:
            typeof user.getDisplayName === 'function'
              ? user.getDisplayName()
              : user.get('displayName') || `${user.get('firstName')} ${user.get('lastName')}` || user.get('username'),
        };

        // Record successful login - manually update lastLoginAt since this is a raw Parse object
        if (typeof user.recordSuccessfulLogin === 'function') {
          await user.recordSuccessfulLogin('password');
        } else {
          // Manually update lastLoginAt for raw Parse objects
          const now = new Date();
          user.set('loginAttempts', 0);
          user.set('lockedUntil', null);
          user.set('lastLoginAt', now);
          user.set('lastAuthMethod', 'password');
          await user.save(null, { useMasterKey: true });

          logger.info('lastLoginAt updated manually for raw Parse object', {
            userId: user.id,
            lastLoginAt: now.toISOString(),
          });
        }

        logger.info('AmexingUser authentication successful', {
          userId: authenticatedUser.id,
          role: authenticatedUser.role,
        });
      } catch (fallbackError) {
        logger.error('AmexingUser authentication failed:', fallbackError);
        throw fallbackError;
      }
    }

    // Create standardized JWT token for authenticated user
    // Check if user was successfully authenticated
    if (authenticatedUser) {
      const jwt = require('jsonwebtoken');
      const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';

      // Create access token with already-resolved role from authenticatedUser
      const accessToken = jwt.sign(
        {
          userId: authenticatedUser.id,
          username: authenticatedUser.username,
          email: authenticatedUser.email,
          role: authenticatedUser.role,
          roleId: authenticatedUser.roleId,
          clientId: authenticatedUser.clientId,
          clientCategory: authenticatedUser.clientCategory,
          organizationId: authenticatedUser.organizationId,
          iat: Math.floor(Date.now() / 1000),
        },
        jwtSecret,
        { expiresIn: '8h' }
      );

      // Create refresh token
      const refreshToken = jwt.sign(
        {
          userId: authenticatedUser.id,
          username: authenticatedUser.username,
          email: authenticatedUser.email,
          role: authenticatedUser.role,
          roleId: authenticatedUser.roleId,
          clientId: authenticatedUser.clientId,
          clientCategory: authenticatedUser.clientCategory,
          organizationId: authenticatedUser.organizationId,
          iat: Math.floor(Date.now() / 1000),
          type: 'refresh',
        },
        jwtSecret,
        { expiresIn: '7d' }
      );

      // Set secure HTTP-only cookies for both tokens
      res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 8 * 60 * 60 * 1000, // 8 hours
      });

      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      // Also set a non-httpOnly cookie for client-side JavaScript access
      // This is less secure but necessary for client-side API calls
      res.cookie('clientAccessToken', accessToken, {
        httpOnly: false, // Allow JavaScript access
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 8 * 60 * 60 * 1000, // 8 hours
      });

      logger.info('JWT tokens created for user', {
        userId: authenticatedUser.id,
        role: authenticatedUser.role,
      });

      // Handle different response types
      // Check if client expects HTML response
      if (req.accepts('html')) {
        // For web form submissions, redirect to role-specific dashboard
        // Admin users land on their dashboard (tablero de control)
        let redirectUrl = returnTo;
        if (!redirectUrl) {
          if (authenticatedUser.role === 'admin') {
            redirectUrl = '/dashboard/admin';
          } else {
            redirectUrl = `/dashboard/${authenticatedUser.role}`;
          }
        }
        logger.info('Redirecting user to dashboard', {
          from: '/auth/login',
          to: redirectUrl,
          role: authenticatedUser.role,
        });
        return res.redirect(redirectUrl);
      }

      // Detect mobile client via X-Client-Type header
      const isMobileClient = req.headers['x-client-type'] === 'mobile';

      // For mobile apps: return tokens in response body
      if (isMobileClient) {
        return res.json({
          success: true,
          user: {
            id: authenticatedUser.id,
            username: authenticatedUser.username,
            role: authenticatedUser.role,
            name: authenticatedUser.name,
          },
          tokens: {
            accessToken,
            refreshToken,
            tokenType: 'Bearer',
            expiresIn: '8h',
          },
          message: 'Login successful',
        });
      }

      // For web API calls: return JSON with token for localStorage
      return res.json({
        success: true,
        user: {
          id: authenticatedUser.id,
          username: authenticatedUser.username,
          role: authenticatedUser.role,
          name: authenticatedUser.name,
        },
        accessToken, // Include token for localStorage storage
        message: 'Login successful',
      });
    }

    // If we reach here, authentication failed
    // Check if client expects HTML response
    if (req.accepts('html')) {
      return res.redirect(`/login?error=${encodeURIComponent('Authentication failed')}`);
    }

    res.status(401).json({
      success: false,
      error: 'Authentication failed',
    });
  } catch (error) {
    logger.error('Login route error:', error);

    // Check if client expects HTML response
    if (req.accepts('html')) {
      const errorMessage = error.message || 'Login failed';
      return res.redirect(`/login?error=${encodeURIComponent(errorMessage)}`);
    }

    res.status(400).json({
      success: false,
      error: error.message || 'Login failed',
    });
  }
});

/**
 * @swagger
 * /auth/register:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Register new user account
 *     description: |
 *       Create a new user account with email verification.
 *       Returns JWT tokens and automatically logs in the user.
 *
 *       **Security Features:**
 *       - Rate limited: 50 requests per 15 minutes
 *       - Password strength validation
 *       - Email uniqueness check
 *       - Automatic email verification flow
 *
 *       **Default Role:** user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *         application/x-www-form-urlencoded:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: Registration successful
 *         headers:
 *           Set-Cookie:
 *             description: JWT tokens set as HTTP-only cookies
 *             schema:
 *               type: string
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RegisterResponse'
 *       302:
 *         description: Redirect to dashboard (for HTML clients)
 *       400:
 *         description: Validation error or registration failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
// Register endpoint
router.post('/register', async (req, res) => {
  try {
    const {
      username, email, password, confirmPassword, firstName, lastName,
    } = req.body;

    // Validate required fields
    // Check if any required field is missing
    if (!username || !email || !password || !firstName || !lastName) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required',
      });
    }

    // Validate password confirmation
    // Check if passwords do not match
    // eslint-disable-next-line security/detect-possible-timing-attacks
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'Passwords do not match',
      });
    }

    // Attempt registration
    const result = await Parse.Cloud.run('registerUser', {
      username,
      email,
      password,
      firstName,
      lastName,
      role: 'user',
    });

    // Set secure HTTP-only cookies for tokens
    res.cookie('accessToken', result.tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Match session cookie configuration
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    });

    res.cookie('refreshToken', result.tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Match session cookie configuration
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Also set a non-httpOnly cookie for client-side JavaScript access
    res.cookie('clientAccessToken', result.tokens.accessToken, {
      httpOnly: false, // Allow JavaScript access
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    });

    // Handle different response types for registration
    // Check if client expects HTML response
    if (req.accepts('html')) {
      // For web form submissions, redirect to role-specific dashboard
      const userRole = result.user?.role || 'user';
      return res.redirect(`/dashboard/${userRole}`);
    }

    // Detect mobile client via X-Client-Type header
    const isMobileClient = req.headers['x-client-type'] === 'mobile';

    // For mobile apps: return tokens in response body
    if (isMobileClient) {
      return res.status(201).json({
        success: true,
        user: result.user,
        tokens: {
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          tokenType: 'Bearer',
          expiresIn: result.tokens.expiresIn,
        },
        message: result.message,
      });
    }

    // For web API calls: return JSON without tokens (cookies only)
    res.status(201).json({
      success: true,
      user: result.user,
      message: result.message,
    });
  } catch (error) {
    logger.error('Registration route error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Registration failed',
    });
  }
});

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Logout user session
 *     description: |
 *       Clears authentication cookies and terminates user session.
 *
 *       **Security:**
 *       - Clears both access and refresh tokens
 *       - Invalidates HTTP-only cookies
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       500:
 *         description: Logout failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// Logout endpoint
router.post('/logout', async (req, res) => {
  try {
    // Clear authentication cookies
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    logger.error('Logout route error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed',
    });
  }
});

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Refresh JWT access token
 *     description: |
 *       Renew access token using refresh token before expiration.
 *
 *       **Token Lifetimes:**
 *       - Access Token: 8 hours
 *       - Refresh Token: 7 days
 *
 *       **Security:**
 *       - Requires valid refresh token in cookie
 *       - Issues new access and refresh tokens
 *       - PCI DSS compliant token rotation
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Token refresh successful
 *         headers:
 *           Set-Cookie:
 *             description: New JWT tokens
 *             schema:
 *               type: string
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenRefreshResponse'
 *       401:
 *         description: Refresh token required or invalid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// Token refresh endpoint
router.post('/refresh', async (req, res) => {
  try {
    // Get refreshToken from Authorization header OR from cookie
    const { authorization: authHeader } = req.headers;
    const { refreshToken: cookieRefreshToken } = req.cookies;

    // First try from Authorization header (for mobile apps)
    // If not in header, fall back to cookie (for web)
    let refreshToken = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      refreshToken = authHeader.substring(7);
    } else if (cookieRefreshToken) {
      refreshToken = cookieRefreshToken;
    }

    // Check if refresh token is missing
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'Refresh token required',
      });
    }

    const result = await Parse.Cloud.run('refreshToken', { refreshToken });

    // Set new tokens in cookies
    res.cookie('accessToken', result.tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Match session cookie configuration
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    });

    res.cookie('refreshToken', result.tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Match session cookie configuration
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Detect mobile client via X-Client-Type header
    const isMobileClient = req.headers['x-client-type'] === 'mobile';

    // For mobile apps: return tokens in response body
    if (isMobileClient) {
      return res.json({
        success: true,
        user: result.user,
        tokens: {
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          tokenType: 'Bearer',
          expiresIn: result.tokens.expiresIn,
        },
      });
    }

    // For web: return JSON without tokens (cookies only)
    res.json({
      success: true,
      user: result.user,
    });
  } catch (error) {
    logger.error('Token refresh route error:', error);
    res.clearCookie('refreshToken');
    res.status(401).json({
      success: false,
      error: 'Token refresh failed',
    });
  }
});

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Request password reset
 *     description: |
 *       Initiate password reset process by sending reset token via email.
 *
 *       **Security Features:**
 *       - Strict rate limiting: 10 requests per 5 minutes
 *       - Time-limited reset tokens
 *       - Email verification required
 *       - No user enumeration (always returns success)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ForgotPasswordRequest'
 *     responses:
 *       200:
 *         description: Password reset email sent (or user not found)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Email is required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 *       500:
 *         description: Password reset request failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// Password reset request (API endpoint - use for AJAX requests)
// For form submissions, use the web route at /forgot-password in webRoutes.js
// TEMPORARILY DISABLED to avoid route conflicts
/*
router.post('/forgot-password', strictAuthRateLimit, async (req, res) => {
  console.log('🚨 DEBUG: authRoutes /forgot-password API endpoint called');
  console.log('🚨 DEBUG: This should NOT be called for form submissions');
  try {
    const { email } = req.body;

    // Check if email is missing
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required',
      });
    }

    // Use the new requestPasswordReset cloud function
    const result = await Parse.Cloud.run('requestPasswordReset', { email });

    res.json(result);
  } catch (error) {
    logger.error('Forgot password API route error:', error);
    res.status(500).json({
      success: false,
      error: 'Password reset request failed',
    });
  }
});
*/

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Complete password reset
 *     description: |
 *       Complete password reset process using token from email.
 *
 *       **Security Features:**
 *       - Strict rate limiting: 10 requests per 5 minutes
 *       - Token validation and expiration check
 *       - Password strength validation
 *       - Single-use tokens
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ResetPasswordRequest'
 *     responses:
 *       200:
 *         description: Password reset successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Validation error or password reset failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
// Password reset completion
router.post('/reset-password', strictAuthRateLimit, async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body;
    const isApiRequest = req.headers['content-type']?.includes('application/json')
                        || req.headers.accept?.includes('application/json');

    // Check if token or password is missing
    if (!token || !password) {
      if (isApiRequest) {
        return res.status(400).json({
          success: false,
          error: 'Token and password are required',
        });
      }
      return res.redirect(`/auth/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent('Token and password are required')}`);
    }

    // Check if passwords do not match
    // eslint-disable-next-line security/detect-possible-timing-attacks
    if (password !== confirmPassword) {
      if (isApiRequest) {
        return res.status(400).json({
          success: false,
          error: 'Passwords do not match',
        });
      }
      return res.redirect(`/auth/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent('Passwords do not match')}`);
    }

    const result = await Parse.Cloud.run('resetPassword', {
      resetToken: token,
      newPassword: password,
    });

    if (isApiRequest) {
      res.json(result);
    } else {
      // Web form submission - redirect to login with success message
      res.redirect('/login?message=password_updated');
    }
  } catch (error) {
    logger.error('Reset password route error:', error);
    const isApiRequest = req.headers['content-type']?.includes('application/json')
                        || req.headers.accept?.includes('application/json');

    if (isApiRequest) {
      res.status(400).json({
        success: false,
        error: error.message || 'Password reset failed',
      });
    } else {
      // Web form submission - redirect back with error
      const { token } = req.body;
      res.redirect(`/auth/reset-password?token=${encodeURIComponent(token || '')}&error=${encodeURIComponent(error.message || 'Password reset failed')}`);
    }
  }
});

/**
 * @swagger
 * /auth/change-password:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Change password for authenticated user
 *     description: |
 *       Change password for currently authenticated user.
 *
 *       **Security Features:**
 *       - Requires authentication (JWT token)
 *       - Current password verification
 *       - Password strength validation
 *       - Audit logging
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChangePasswordRequest'
 *     responses:
 *       200:
 *         description: Password changed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Validation error or password change failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
// Change password (for authenticated users)
// Now accepts both JWT tokens and session-based authentication
router.post('/change-password', dashboardAuthMiddleware.requireAuth, async (req, res) => {
  try {
    const { user } = req;

    const { currentPassword, newPassword, confirmPassword } = req.body;

    // Check if current or new password is missing
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required',
      });
    }

    // Check if new passwords do not match
    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'New passwords do not match',
      });
    }

    // Call AuthenticationService directly instead of cloud function
    // since we already have the authenticated user from middleware
    const result = await AuthenticationService.changePassword(user.id, currentPassword, newPassword);

    res.json(result);
  } catch (error) {
    logger.error('Change password route error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Password change failed',
    });
  }
});

/**
 * @swagger
 * /auth/oauth/providers:
 *   get:
 *     tags:
 *       - OAuth
 *     summary: Get list of available OAuth providers
 *     description: |
 *       Retrieve list of configured OAuth 2.0 providers.
 *
 *       **Available Providers:**
 *       - Apple (Sign in with Apple)
 *       - Corporate (Internal company OAuth)
 *     responses:
 *       200:
 *         description: List of OAuth providers
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OAuthProvidersResponse'
 *       500:
 *         description: Failed to get OAuth providers
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// OAuth provider list
router.get('/oauth/providers', async (req, res) => {
  try {
    // Use retry logic for cloud function call
    const result = await callCloudFunctionWithRetry('getOAuthProviders');
    res.json(result);
  } catch (error) {
    logger.error('OAuth providers route error:', error);

    // Check if this is an "Invalid function" error
    const isInvalidFunction = error.code === 141 || error.message?.includes('Invalid function');

    res.status(500).json({
      success: false,
      error: isInvalidFunction
        ? 'OAuth providers service is initializing. Please try again in a moment.'
        : 'Failed to get OAuth providers',
      code: error.code,
      retryable: isInvalidFunction,
    });
  }
});

/**
 * @swagger
 * /auth/oauth/{provider}:
 *   get:
 *     tags:
 *       - OAuth
 *     summary: Initiate OAuth authentication flow
 *     description: |
 *       Redirect user to OAuth provider for authentication.
 *
 *       **Flow:**
 *       1. User clicks "Sign in with Provider"
 *       2. Redirects to provider's auth page
 *       3. User authorizes application
 *       4. Provider redirects to callback URL
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [apple, corporate]
 *         description: OAuth provider ID
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *           default: default
 *         description: State parameter for CSRF protection
 *     responses:
 *       302:
 *         description: Redirect to OAuth provider
 *         headers:
 *           Location:
 *             description: OAuth provider authorization URL
 *             schema:
 *               type: string
 *       302_error:
 *         description: Redirect to login page with error
 */
// OAuth initiation
router.get('/oauth/:provider', async (req, res) => {
  try {
    const { provider } = req.params;
    const state = req.query.state || 'default';

    const result = await Parse.Cloud.run('generateOAuthUrl', {
      _provider: provider,
      state,
    });

    res.redirect(result.authUrl);
  } catch (error) {
    logger.error('OAuth initiation route error:', error);
    res.redirect(`/login?error=${encodeURIComponent('OAuth login failed')}`);
  }
});

/**
 * @swagger
 * /auth/oauth/{provider}/callback:
 *   get:
 *     tags:
 *       - OAuth
 *     summary: OAuth provider callback handler
 *     description: |
 *       Handle OAuth provider callback after user authorization.
 *
 *       **Flow:**
 *       1. OAuth provider redirects here after user authorizes
 *       2. Validates authorization code
 *       3. Exchanges code for tokens
 *       4. Creates/updates user account
 *       5. Sets JWT cookies
 *       6. Redirects to dashboard
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [apple, corporate]
 *         description: OAuth provider ID
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Authorization code from OAuth provider
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         description: State parameter for CSRF validation
 *       - in: query
 *         name: error
 *         schema:
 *           type: string
 *         description: Error code if authorization failed
 *     responses:
 *       302:
 *         description: Redirect to dashboard on success
 *         headers:
 *           Location:
 *             description: Role-specific dashboard URL
 *             schema:
 *               type: string
 *           Set-Cookie:
 *             description: JWT tokens
 *             schema:
 *               type: string
 *       302_error:
 *         description: Redirect to login page with error
 */
// OAuth callback
router.get('/oauth/:provider/callback', async (req, res) => {
  const { provider } = req.params; // Move provider outside try block for error handling

  try {
    const { code, state, error } = req.query;

    // Check if OAuth callback has error
    if (error) {
      logger.error('OAuth callback error:', error);
      return res.redirect(`/login?error=${encodeURIComponent('OAuth authentication was cancelled')}`);
    }

    // Check if authorization code is missing
    if (!code) {
      return res.redirect(`/login?error=${encodeURIComponent('OAuth authentication failed')}`);
    }

    const result = await Parse.Cloud.run('handleOAuthCallback', {
      provider,
      code,
      state,
    });

    // Debug logging
    logger.info('OAuth callback result:', {
      hasResult: !!result,
      hasTokens: !!(result && result.tokens),
      hasAccessToken: !!(result && result.tokens && result.tokens.accessToken),
      hasUser: !!(result && result.user),
      userRole: result && result.user ? result.user.role : 'not found',
      resultKeys: result ? Object.keys(result) : [],
    });

    // Check if we have tokens in the result
    if (!result || !result.tokens || !result.tokens.accessToken) {
      logger.error('OAuth callback missing tokens:', {
        provider,
        resultStructure: result ? JSON.stringify(result).substring(0, 200) : 'null',
      });
      throw new Error('OAuth authentication succeeded but tokens were not generated');
    }

    // Set secure HTTP-only cookies for tokens
    logger.info('Setting OAuth cookies:', {
      provider,
      hasAccessToken: !!result.tokens.accessToken,
      hasRefreshToken: !!result.tokens.refreshToken,
      userRole: result.user ? result.user.role : 'unknown',
    });

    res.cookie('accessToken', result.tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Match session cookie configuration
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    });

    res.cookie('refreshToken', result.tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Match session cookie configuration
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Redirect to role-specific dashboard or intended destination
    let userRole = 'guest';
    // Check if user and role are present
    if (result.user && result.user.role) {
      userRole = result.user.role;
    }

    // Admin users land on their dashboard (tablero de control)
    let defaultRedirect;
    if (userRole === 'admin') {
      defaultRedirect = '/dashboard/admin';
    } else {
      defaultRedirect = `/dashboard/${userRole}`;
    }

    const redirectUrl = req.session.returnTo || defaultRedirect;
    delete req.session.returnTo;

    logger.info('OAuth callback redirecting:', {
      provider,
      userRole,
      defaultRedirect,
      sessionReturnTo: req.session.returnTo,
      finalRedirectUrl: redirectUrl,
      userId: result.user ? result.user.id : 'unknown',
    });

    res.redirect(redirectUrl);
  } catch (error) {
    logger.error('OAuth callback route error:', error);

    // Handle our custom error scenarios from the cloud function
    logger.info('OAuth callback error details', {
      errorType: error.constructor.name,
      isParseError: error instanceof Parse.Error,
      errorCode: error.code,
      errorMessage: error.message,
      provider,
    });

    if (error instanceof Parse.Error && error.message) {
      try {
        const errorData = JSON.parse(error.message);

        logger.info('OAuth callback: Parsed error data', {
          errorData,
          provider,
          hasLinkingConfirmation: !!errorData.requiresLinkingConfirmation,
          hasAccountDeactivated: errorData.error === 'account_deactivated',
          hasAgencyRequest: !!errorData.requiresAgencyRequest,
        });

        // Handle deactivated account - redirect to agency request with toast
        if (errorData.error === 'account_deactivated' && errorData.toast) {
          return res.redirect(errorData.redirectUrl);
        }

        // Handle OAuth linking confirmation needed
        if (errorData.requiresLinkingConfirmation) {
          // Store OAuth info in session for the confirmation modal
          const linkingData = {
            existingUser: errorData.existingUser,
            oauthInfo: errorData.oauthInfo,
            provider,
            timestamp: Date.now(),
          };

          req.session.oauthLinkingData = linkingData;

          logger.info('OAuth linking confirmation: Storing session data before redirect', {
            provider,
            sessionId: req.sessionID,
            existingUserEmail: errorData.existingUser?.email,
            oauthEmail: errorData.oauthInfo?.email,
            hasSessionStore: !!req.session.store,
            sessionDataKeys: Object.keys(linkingData),
          });

          // Force session save before redirect to ensure data persistence
          req.session.save((saveErr) => {
            if (saveErr) {
              logger.error('Failed to save OAuth linking session:', {
                error: saveErr.message,
                sessionId: req.sessionID,
                provider,
              });
              return res.redirect(`/login?error=${encodeURIComponent('Session save failed. Please try again.')}`);
            }

            logger.info('OAuth linking confirmation: Session save successful, redirecting', {
              provider,
              sessionId: req.sessionID,
              redirectUrl: `/login?oauth_confirmation=true&provider=${provider}`,
            });

            return res.redirect(`/login?oauth_confirmation=true&provider=${provider}&debug=session_saved`);
          });
          return; // Prevent further execution
        }

        // Handle agency request needed
        if (errorData.requiresAgencyRequest) {
          return res.redirect(errorData.redirectUrl);
        }

        // Generic error with redirect URL
        if (errorData.redirectUrl) {
          return res.redirect(errorData.redirectUrl);
        }
      } catch (parseError) {
        // If we can't parse the error JSON, fall through to generic error handling
        logger.warn('Could not parse OAuth error data:', parseError);
      }
    }

    // Generic error handling
    res.redirect(`/login?error=${encodeURIComponent(error.message || 'OAuth authentication failed')}`);
  }
});

/**
 * OAuth linking confirmation endpoint
 * Handles user approval/denial for linking OAuth accounts.
 */
router.post('/oauth/confirm-link', async (req, res) => {
  try {
    const { action } = req.body; // 'approve' or 'deny'
    const oauthData = req.session.oauthLinkingData;

    if (!oauthData) {
      return res.redirect(`/login?error=${encodeURIComponent('OAuth linking session expired')}`);
    }

    // Clear session data
    delete req.session.oauthLinkingData;

    if (action === 'deny') {
      // User denied linking - redirect to login with info
      return res.redirect(`/login?info=${encodeURIComponent('OAuth linking cancelled. You can login with your regular credentials.')}`);
    }

    if (action === 'approve') {
      // User approved linking - call cloud function
      const result = await Parse.Cloud.run('confirmOAuthLinking', {
        existingUser: oauthData.existingUser,
        oauthInfo: oauthData.oauthInfo,
      });

      // Set secure HTTP-only cookies for tokens
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

      // Redirect to dashboard
      let userRole = 'guest';
      if (result.user && result.user.role) {
        userRole = result.user.role;
      }

      let defaultRedirect;
      if (userRole === 'admin') {
        defaultRedirect = '/dashboard/admin';
      } else {
        defaultRedirect = `/dashboard/${userRole}`;
      }

      return res.redirect(defaultRedirect);
    }

    // Invalid action
    res.redirect(`/login?error=${encodeURIComponent('Invalid OAuth linking action')}`);
  } catch (error) {
    logger.error('OAuth confirmation route error:', error);
    res.redirect(`/login?error=${encodeURIComponent(error.message || 'OAuth linking confirmation failed')}`);
  }
});

/**
 * @swagger
 * /auth/oauth/{provider}/link:
 *   post:
 *     tags:
 *       - OAuth
 *     summary: Link OAuth account to existing user
 *     description: |
 *       Link an OAuth provider account to the currently authenticated user.
 *
 *       **Use Cases:**
 *       - Enable Sign in with Apple for existing account
 *       - Link corporate OAuth to personal account
 *       - Add alternative login methods
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [apple, corporate]
 *         description: OAuth provider to link
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OAuthLinkRequest'
 *     responses:
 *       200:
 *         description: OAuth account linked successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthSuccessResponse'
 *       400:
 *         description: OAuth account linking failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
// Link OAuth account (for authenticated users)
router.post('/oauth/:provider/link', jwtMiddleware.authenticateToken, async (req, res) => {
  try {
    const { user } = req;

    const { provider: _provider } = req.params;
    const { oauthData } = req.body;

    const result = await Parse.Cloud.run(
      'linkOAuthAccount',
      {
        provider: _provider,
        oauthData,
      },
      {
        user: { id: user.id },
      }
    );

    res.json(result);
  } catch (error) {
    logger.error('OAuth link route error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'OAuth account linking failed',
    });
  }
});

/**
 * @swagger
 * /auth/oauth/{provider}/unlink:
 *   delete:
 *     tags:
 *       - OAuth
 *     summary: Unlink OAuth account from user
 *     description: |
 *       Remove OAuth provider link from the currently authenticated user.
 *
 *       **Security:**
 *       - Ensures user has alternative login method
 *       - Prevents account lockout
 *       - Audit logging
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [apple, corporate]
 *         description: OAuth provider to unlink
 *     responses:
 *       200:
 *         description: OAuth account unlinked successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthSuccessResponse'
 *       400:
 *         description: OAuth account unlinking failed (e.g., last login method)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
// Unlink OAuth account (for authenticated users)
router.delete('/oauth/:provider/unlink', jwtMiddleware.authenticateToken, async (req, res) => {
  try {
    const { user } = req;

    const { provider: _provider } = req.params;

    const result = await Parse.Cloud.run(
      'unlinkOAuthAccount',
      {
        provider: _provider,
      },
      {
        user: { id: user.id },
      }
    );

    res.json(result);
  } catch (error) {
    logger.error('OAuth unlink route error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'OAuth account unlinking failed',
    });
  }
});

module.exports = router;
