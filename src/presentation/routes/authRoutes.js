/**
 * Authentication Routes - Handles all authentication-related endpoints
 * Integrates with AmexingUser model and authentication services.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-09-12
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
