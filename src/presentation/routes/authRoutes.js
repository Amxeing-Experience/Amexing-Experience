/**
 * Authentication Routes - Handles all authentication-related endpoints
 * Integrates with AmexingUser model and authentication services.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-09-12
 */

const Parse = require('parse/node');
const express = require('express');
const rateLimit = require('express-rate-limit');
// const AuthenticationService = require('../../application/services/AuthenticationService'); // Unused import
// const OAuthService = require('../../application/services/OAuthService'); // Unused import
const jwtMiddleware = require('../../application/middleware/jwtMiddleware');
const logger = require('../../infrastructure/logger');

const router = express.Router();

// Rate limiting for auth endpoints
const authRateLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 50,
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
    const { identifier, password } = req.body;

    // Validate required fields
    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        error: 'Identifier and password are required',
      });
    }

    // Attempt login
    const result = await Parse.Cloud.run('loginUser', {
      identifier,
      password,
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

    res.json({
      success: true,
      user: result.user,
      message: result.message,
    });
  } catch (error) {
    logger.error('Login route error:', error);
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
    if (!username || !email || !password || !firstName || !lastName) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required',
      });
    }

    // Validate password confirmation
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

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        error: 'Token and password are required',
      });
    }

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
router.post('/change-password', jwtMiddleware.authenticateToken, async (req, res) => {
  try {
    const { user } = req;

    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required',
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'New passwords do not match',
      });
    }

    const result = await Parse.Cloud.run('changePassword', {
      currentPassword,
      newPassword,
    }, {
      user: { id: user.id },
    });

    res.json(result);
  } catch (error) {
    logger.error('Change password route error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Password change failed',
    });
  }
});

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
    const { provider } = req.params;
    const state = req.query.state || 'default';

    const result = await Parse.Cloud.run('generateOAuthUrl', {
      provider,
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
    const { provider } = req.params;
    const { code, state, error } = req.query;

    if (error) {
      logger.error('OAuth callback error:', error);
      return res.redirect(`/login?error=${encodeURIComponent('OAuth authentication was cancelled')}`);
    }

    if (!code) {
      return res.redirect(`/login?error=${encodeURIComponent('OAuth authentication failed')}`);
    }

    const result = await Parse.Cloud.run('handleOAuthCallback', {
      provider,
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

    // Redirect to dashboard or intended destination
    const redirectUrl = req.session.returnTo || '/dashboard';
    delete req.session.returnTo;
    res.redirect(redirectUrl);
  } catch (error) {
    logger.error('OAuth callback route error:', error);
    res.redirect(`/login?error=${encodeURIComponent(error.message || 'OAuth authentication failed')}`);
  }
});

// Link OAuth account (for authenticated users)
router.post('/oauth/:provider/link', jwtMiddleware.authenticateToken, async (req, res) => {
  try {
    const { user } = req;

    const { provider } = req.params;
    const { oauthData } = req.body;

    const result = await Parse.Cloud.run('linkOAuthAccount', {
      provider,
      oauthData,
    }, {
      user: { id: user.id },
    });

    res.json(result);
  } catch (error) {
    logger.error('OAuth link route error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'OAuth account linking failed',
    });
  }
});

// Unlink OAuth account (for authenticated users)
router.delete('/oauth/:provider/unlink', jwtMiddleware.authenticateToken, async (req, res) => {
  try {
    const { user } = req;

    const { provider } = req.params;

    const result = await Parse.Cloud.run('unlinkOAuthAccount', {
      provider,
    }, {
      user: { id: user.id },
    });

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
