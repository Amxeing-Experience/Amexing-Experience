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
const jwt = require('jsonwebtoken');
// bcrypt is handled by AmexingUser model, not needed here
// const AuthenticationService = require('../../application/services/AuthenticationService'); // Unused import
// const OAuthService = require('../../application/services/OAuthService'); // Unused import
const jwtMiddleware = require('../../application/middleware/jwtMiddleware');
const logger = require('../../infrastructure/logger');

const router = express.Router();

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
// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { identifier, password, returnTo } = req.body;

    // Validate required fields
    // Check if identifier or password is missing
    if (!identifier || !password) {
      // Check if client expects HTML response
      if (req.accepts('html')) {
        return res.redirect(
          `/login?error=${encodeURIComponent('Email and password are required')}`
        );
      }
      return res.status(400).json({
        success: false,
        error: 'Email and password are required',
      });
    }

    // Use Parse authentication with fallback to direct auth, but standardize on JWT tokens
    let authenticatedUser = null;

    try {
      // Try to authenticate with Parse first
      const parseUser = await Parse.User.logIn(identifier, password);

      // Check if Parse authentication was successful
      if (parseUser) {
        // Get role name from the new Role relationship for Parse User too
        let roleName = 'guest';
        const roleId = parseUser.get('roleId');
        // Check if user has a role ID
        if (roleId) {
          try {
            const roleQuery = new Parse.Query('Role');
            roleQuery.equalTo('objectId', roleId);
            const roleObject = await roleQuery.first({ useMasterKey: true });
            // Check if role object was found
            if (roleObject) {
              roleName = roleObject.get('name');
            }
          } catch (roleError) {
            logger.warn(
              'Failed to fetch role for Parse user, defaulting to guest',
              {
                userId: parseUser.id,
                roleId,
                error: roleError.message,
              }
            );
            // Fall back to old role field if new relationship fails
            roleName = parseUser.get('role') || 'guest';
          }
        } else {
          // Fall back to old role field if no roleId
          roleName = parseUser.get('role') || 'guest';
        }

        // Convert Parse user to standardized user object for JWT
        authenticatedUser = {
          id: parseUser.id,
          username: parseUser.get('username'),
          email: parseUser.get('email'),
          role: roleName,
          roleId,
          organizationId: parseUser.get('organizationId'),
          name: parseUser.get('displayName') || parseUser.get('username'),
        };

        logger.info('Parse authentication successful', {
          userId: authenticatedUser.id,
          role: authenticatedUser.role,
        });
      }
    } catch (parseError) {
      logger.warn(
        'Parse authentication failed, falling back to Parse Object auth:',
        parseError.message
      );
      // Fallback to Parse Object authentication using AmexingUser model
      const AmexingUser = require('../../domain/models/AmexingUser');

      try {
        // Query AmexingUser using Parse SDK - email only lookup
        const query = new Parse.Query(AmexingUser);
        query.equalTo('email', identifier.toLowerCase().trim());
        const user = await query.first({ useMasterKey: true });

        // Check if user was not found
        if (!user) {
          // Check if client expects HTML response
          if (req.accepts('html')) {
            return res.redirect(
              `/login?error=${encodeURIComponent('Invalid email or password')}`
            );
          }
          return res.status(401).json({
            success: false,
            error: 'Invalid email or password',
          });
        }

        // Verify password using AmexingUser model method
        const passwordMatch = await user.validatePassword(password);

        // Check if password does not match
        if (!passwordMatch) {
          // Record failed login attempt
          await user.recordFailedLogin();

          // Check if client expects HTML response
          if (req.accepts('html')) {
            return res.redirect(
              `/login?error=${encodeURIComponent('Invalid email or password')}`
            );
          }
          return res.status(401).json({
            success: false,
            error: 'Invalid email or password',
          });
        }

        // Check if account is locked
        if (user.isAccountLocked()) {
          // Check if client expects HTML response
          if (req.accepts('html')) {
            return res.redirect(
              `/login?error=${encodeURIComponent('Account is temporarily locked')}`
            );
          }
          return res.status(401).json({
            success: false,
            error: 'Account is temporarily locked',
          });
        }

        // Get role name from the new Role relationship
        let roleName = 'guest';
        const roleId = user.get('roleId');
        // Check if user has a role ID
        if (roleId) {
          try {
            const roleQuery = new Parse.Query('Role');
            roleQuery.equalTo('objectId', roleId);
            const roleObject = await roleQuery.first({ useMasterKey: true });
            // Check if role object was found
            if (roleObject) {
              roleName = roleObject.get('name');
            }
          } catch (roleError) {
            logger.warn('Failed to fetch role for user, defaulting to guest', {
              userId: user.id,
              roleId,
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
          roleId,
          organizationId: user.get('organizationId'),
          name: user.getDisplayName(),
        };

        // Record successful login
        await user.recordSuccessfulLogin('password');

        logger.info('Parse Object authentication successful', {
          userId: authenticatedUser.id,
          role: authenticatedUser.role,
        });
      } catch (fallbackError) {
        logger.error('Parse Object authentication failed:', fallbackError);
        throw fallbackError;
      }
    }

    // Create standardized JWT token for authenticated user
    // Check if user was successfully authenticated
    if (authenticatedUser) {
      const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
      const accessToken = jwt.sign(
        {
          userId: authenticatedUser.id,
          username: authenticatedUser.username,
          email: authenticatedUser.email,
          role: authenticatedUser.role,
          roleId: authenticatedUser.roleId,
          organizationId: authenticatedUser.organizationId,
          name: authenticatedUser.name,
          iat: Math.floor(Date.now() / 1000),
        },
        jwtSecret,
        { expiresIn: '8h' }
      );

      // Set secure HTTP-only cookie for JWT token
      res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 8 * 60 * 60 * 1000, // 8 hours
      });

      logger.info('JWT token created for user', {
        userId: authenticatedUser.id,
        role: authenticatedUser.role,
      });

      // Handle different response types
      // Check if client expects HTML response
      if (req.accepts('html')) {
        // For web form submissions, redirect to role-specific dashboard
        const redirectUrl = returnTo || `/dashboard/${authenticatedUser.role}`;
        logger.info('Redirecting user to dashboard', {
          from: '/auth/login',
          to: redirectUrl,
          role: authenticatedUser.role,
        });
        return res.redirect(redirectUrl);
      }

      // For API calls, return JSON
      return res.json({
        success: true,
        user: {
          id: authenticatedUser.id,
          username: authenticatedUser.username,
          role: authenticatedUser.role,
          name: authenticatedUser.name,
        },
        message: 'Login successful',
      });
    }

    // If we reach here, authentication failed
    // Check if client expects HTML response
    if (req.accepts('html')) {
      return res.redirect(
        `/login?error=${encodeURIComponent('Authentication failed')}`
      );
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
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    });

    res.cookie('refreshToken', result.tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Handle different response types for registration
    // Check if client expects HTML response
    if (req.accepts('html')) {
      // For web form submissions, redirect to role-specific dashboard
      const userRole = result.user?.role || 'user';
      return res.redirect(`/dashboard/${userRole}`);
    }

    // For API calls, return JSON
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
    const { refreshToken } = req.cookies;

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
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    });

    res.cookie('refreshToken', result.tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

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
// Password reset request (apply stricter rate limiting)
router.post('/forgot-password', strictAuthRateLimit, async (req, res) => {
  try {
    const { email } = req.body;

    // Check if email is missing
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required',
      });
    }

    const result = await Parse.Cloud.run('initiatePasswordReset', { email });

    res.json(result);
  } catch (error) {
    logger.error('Forgot password route error:', error);
    res.status(500).json({
      success: false,
      error: 'Password reset request failed',
    });
  }
});

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

    // Check if token or password is missing
    if (!token || !password) {
      return res.status(400).json({
        success: false,
        error: 'Token and password are required',
      });
    }

    // Check if passwords do not match
    // eslint-disable-next-line security/detect-possible-timing-attacks
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'Passwords do not match',
      });
    }

    const result = await Parse.Cloud.run('resetPassword', {
      resetToken: token,
      newPassword: password,
    });

    res.json(result);
  } catch (error) {
    logger.error('Reset password route error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Password reset failed',
    });
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
router.post(
  '/change-password',
  jwtMiddleware.authenticateToken,
  async (req, res) => {
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

      const result = await Parse.Cloud.run(
        'changePassword',
        {
          currentPassword,
          newPassword,
        },
        {
          user: { id: user.id },
        }
      );

      res.json(result);
    } catch (error) {
      logger.error('Change password route error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Password change failed',
      });
    }
  }
);

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
    const result = await Parse.Cloud.run('getOAuthProviders');
    res.json(result);
  } catch (error) {
    logger.error('OAuth providers route error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get OAuth providers',
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
    const { _provider } = req.params;
    const state = req.query.state || 'default';

    const result = await Parse.Cloud.run('generateOAuthUrl', {
      provider: _provider,
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
  try {
    const { provider: _provider } = req.params;
    const { code, state, error } = req.query;

    // Check if OAuth callback has error
    if (error) {
      logger.error('OAuth callback error:', error);
      return res.redirect(
        `/login?error=${encodeURIComponent('OAuth authentication was cancelled')}`
      );
    }

    // Check if authorization code is missing
    if (!code) {
      return res.redirect(
        `/login?error=${encodeURIComponent('OAuth authentication failed')}`
      );
    }

    const result = await Parse.Cloud.run('handleOAuthCallback', {
      provider: _provider,
      code,
      state,
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

    // Redirect to role-specific dashboard or intended destination
    let userRole = 'guest';
    // Check if user and role are present
    if (result.user && result.user.role) {
      userRole = result.user.role;
    }

    const redirectUrl = req.session.returnTo || `/dashboard/${userRole}`;
    delete req.session.returnTo;
    res.redirect(redirectUrl);
  } catch (error) {
    logger.error('OAuth callback route error:', error);
    res.redirect(
      `/login?error=${encodeURIComponent(error.message || 'OAuth authentication failed')}`
    );
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
router.post(
  '/oauth/:provider/link',
  jwtMiddleware.authenticateToken,
  async (req, res) => {
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
  }
);

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
router.delete(
  '/oauth/:provider/unlink',
  jwtMiddleware.authenticateToken,
  async (req, res) => {
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
  }
);

module.exports = router;
