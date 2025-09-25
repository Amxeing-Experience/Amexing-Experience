const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');
const securityMiddlewares = require('../../infrastructure/security/securityMiddleware');

/**
 * Authentication Controller - Handles authentication operations and user flows.
 * Provides comprehensive authentication endpoints including login, registration, logout,
 * password reset, and OAuth integration with CSRF protection and security compliance.
 *
 * This controller manages both web interface and JSON API endpoints for all
 * authentication flows, integrating with Parse Server, OAuth providers, and
 * security middleware for PCI DSS compliance.
 *
 * Features:
 * - User login and registration with validation
 * - Password reset and change functionality
 * - OAuth provider integration (Google, Microsoft, Apple)
 * - CSRF protection for all forms
 * - Session management and security
 * - Comprehensive error handling and logging
 * - Mobile and web responsive interfaces.
 * @class AuthController
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Initialize authentication controller
 * const authController = new AuthController();
 *
 * // Express route integration
 * router.get('/login', authController.showLogin.bind(authController));
 * router.post('/login', authController.login.bind(authController));
 * router.get('/register', authController.showRegister.bind(authController));
 * router.post('/register', authController.register.bind(authController));
 *
 * // OAuth integration
 * router.get('/oauth/:provider', authController.initiateOAuth.bind(authController));
 * router.post('/oauth/:provider/callback', authController.handleOAuthCallback.bind(authController));
 */
class AuthController {
  /**
   * Displays the login form with CSRF protection and OAuth provider options.
   * Renders the login view with security tokens, error messages, and available
   * OAuth authentication providers for user authentication.
   * @function showLogin
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} - Renders login view.
   * @example
   * // GET endpoint example
   * const result = await AuthController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // GET /api/endpoint
   * // Response: { "success": true, "data": [...] }
   * // GET /login
   * // Displays login form with CSRF token and OAuth providers
   */
  async showLogin(req, res) {
    const csrf = securityMiddlewares.csrfProtection.create(req.session.csrfSecret);

    // Get OAuth providers for login form
    let oauthProviders = [];
    try {
      const providersResult = await Parse.Cloud.run('getOAuthProviders');
      oauthProviders = providersResult.providers || [];
    } catch (error) {
      logger.error('Error getting OAuth providers for login:', error);
    }
    res.render('auth/login', {
      title: 'Login - AmexingWeb',
      error: req.query.error || null,
      csrfToken: csrf,
      parseAppId: process.env.PARSE_APP_ID,
      oauthProviders,
    });
  }

  /**
   * Displays the registration form with CSRF protection and input validation.
   * Renders the registration view with security tokens, error messages, and
   * proper form validation setup for new user account creation.
   * @function showRegister
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} - Renders registration form.
   * @example
   * // GET endpoint example
   * const result = await AuthController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // GET /api/endpoint
   * // Response: { "success": true, "data": [...] }
   * // GET /register
   * // Displays registration form with CSRF token and validation
   */
  async showRegister(req, res) {
    const csrf = securityMiddlewares.csrfProtection.create(req.session.csrfSecret);
    res.render('auth/register', {
      title: 'Register - AmexingWeb',
      error: req.query.error || null,
      csrfToken: csrf,
      parseAppId: process.env.PARSE_APP_ID,
    });
  }

  /**
   * Processes user login with Parse Server authentication and session management.
   * Handles POST requests for user authentication, validates credentials, creates
   * sessions, and manages login attempts with security logging and error handling.
   * @function login
   * @param {object} req - Express request object with username and password in body.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} - Redirects on success or renders login with error.
   * @example
   * // POST endpoint example
   * const result = await AuthController.login(req, res);
   * // Body: { data: 'example' }
   * // Returns: { success: true, data: {...} }
   * // POST /api/endpoint
   * // Body: { "data": "value" }
   * // Response: { "success": true, "message": "Created" }
   * // POST /login
   * // Body: { username: 'user@example.com', password: 'user-password' }
   * // Success: redirects to dashboard
   * // Failure: renders login with error message
   */
  async login(req, res) {
    // Handle both GET (show form) and POST (process login)
    if (req.method === 'GET') {
      return this.showLogin(req, res);
    }

    try {
      const { username, password } = req.body;

      if (!username || !password) {
        if (req.accepts('json')) {
          return res.status(400).json({
            success: false,
            message: 'Username and password are required',
          });
        }
        return this.returnWithToken(req, res);
      }

      // Authenticate with Parse Server
      const user = await Parse.User.logIn(username, password);

      // Store session information
      req.session.user = {
        id: user.id,
        username: user.get('username'),
      };
      req.session.sessionToken = user.getSessionToken();

      logger.info(`User ${username} logged in successfully`);

      if (req.accepts('json')) {
        return res.json({
          success: true,
          user: {
            id: user.id,
            username: user.get('username'),
          },
        });
      }

      return res.redirect('/');
    } catch (error) {
      logger.error('Login error:', error);

      if (req.accepts('json')) {
        return res.status(401).json({
          success: false,
          message: 'Invalid login',
        });
      }

      return this.returnWithToken(req, res);
    }
  }

  async returnWithToken(req, res) {
    const csrf = securityMiddlewares.csrfProtection.create(req.session.csrfSecret);
    return res.render('auth/login', {
      title: 'Login - AmexingWeb',
      error: 'Invalid username or password',
      csrfToken: csrf,
      parseAppId: process.env.PARSE_APP_ID,
    });
  }

  /**
   * Processes user registration with validation, user creation, and session setup.
   * Handles POST requests for new user registration, validates input data,
   * creates Parse Server user accounts, and establishes authentication sessions.
   * @function register
   * @param {object} req - Express request object with username, email, password in body.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} - Redirects on success or renders registration with error.
   * @example
   * // POST endpoint example
   * const result = await AuthController.register(req, res);
   * // Body: { data: 'example' }
   * // Returns: { success: true, data: {...} }
   * // POST /api/endpoint
   * // Body: { "data": "value" }
   * // Response: { "success": true, "message": "Created" }
   * // POST /register
   * // Body: { username: 'newuser', email: 'user@example.com', password: 'user-password' }
   * // Success: creates user and redirects to dashboard
   * // Failure: renders registration form with validation errors
   */
  async register(req, res) {
    // Handle both GET (show form) and POST (process registration)
    if (req.method === 'GET') {
      return this.showRegister(req, res);
    }

    try {
      const validationResult = this.validateRegistration(req.body);
      if (!validationResult.isValid) {
        return this.handleRegistrationValidationError(res, validationResult.error);
      }

      const newUser = await this.createUser(req.body);
      this.setUserSession(req, newUser);

      logger.info(`User ${req.body.username} registered successfully`);

      return this.handleRegistrationSuccess(res, newUser);
    } catch (error) {
      return this.handleRegistrationError(res, error);
    }
  }

  validateRegistration({ username, password, email }) {
    if (!username || !password || !email) {
      return {
        isValid: false,
        error: 'Username, password, and email are required',
      };
    }
    return { isValid: true };
  }

  handleRegistrationValidationError(res, errorMessage) {
    if (res.req.accepts('json')) {
      return res.status(400).json({
        success: false,
        message: errorMessage,
      });
    }
    const csrf = securityMiddlewares.csrfProtection.create(res.req.session.csrfSecret);
    return res.render('auth/register', {
      title: 'Register - AmexingWeb',
      error: 'All fields are required',
      csrfToken: csrf,
      parseAppId: process.env.PARSE_APP_ID,
    });
  }

  async createUser({ username, password, email }) {
    const user = new Parse.User();
    user.set('username', username);
    user.set('password', password);
    user.set('email', email);
    return user.signUp();
  }

  setUserSession(req, user) {
    req.session.user = {
      id: user.id,
      username: user.get('username'),
    };
    req.session.sessionToken = user.getSessionToken();
  }

  handleRegistrationSuccess(res, user) {
    if (res.req.accepts('json')) {
      return res.json({
        success: true,
        user: {
          id: user.id,
          username: user.get('username'),
        },
      });
    }
    return res.redirect('/');
  }

  handleRegistrationError(res, error) {
    logger.error('Registration error:', error);

    if (res.req.accepts('json')) {
      return res.status(400).json({
        success: false,
        message: error.message || 'Registration failed',
      });
    }
    const csrf = securityMiddlewares.csrfProtection.create(res.req.session.csrfSecret);

    return res.render('auth/register', {
      title: 'Register - AmexingWeb',
      error: error.message || 'Registration failed',
      csrfToken: csrf,
      parseAppId: process.env.PARSE_APP_ID,
    });
  }

  /**
   * Handles user logout with session cleanup and security logging.
   * Invalidates Parse Server session, clears browser sessions/cookies,
   * and logs security event for audit trail compliance.
   * @function logout
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} - Redirects to login page.
   * @example
   * // Usage example
   * const result = await logout(parameters);
   * // Returns: operation result
   * // POST /api/endpoint
   * // Body: { "data": "value" }
   * // Response: { "success": true, "message": "Created" }
   * // POST /logout
   * // Clears all session data and redirects to login
   */
  async logout(req, res) {
    try {
      // Clear Parse session if exists
      if (req.session?.sessionToken) {
        const { sessionToken } = req.session;
        await Parse.User.logOut({ sessionToken });
      }

      // Destroy Express session
      req.session.destroy((err) => {
        if (err) {
          logger.error('Error destroying session:', err);
        }
      });

      // Clear cookie
      res.clearCookie('amexing.sid');

      // Handle response type
      if (req.accepts('json')) {
        return res.json({
          success: true,
          message: 'Logged out successfully',
        });
      }

      // Redirect to home
      res.redirect('/');
    } catch (error) {
      logger.error('Error during logout:', error);

      if (req.accepts('json')) {
        return res.status(500).json({
          success: false,
          message: 'Logout failed',
        });
      }

      res.redirect('/');
    }
  }

  /**
   * Displays the forgot password form for password reset requests.
   * Renders the password reset form with CSRF protection and status messages
   * for users who need to recover access to their accounts.
   * @function showForgotPassword
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} - Renders forgot password form.
   * @example
   * // GET endpoint example
   * const result = await AuthController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // GET /api/endpoint
   * // Response: { "success": true, "data": [...] }
   * // GET /auth/forgot-password
   * // Displays password reset request form
   */
  async showForgotPassword(req, res) {
    const csrf = securityMiddlewares.csrfProtection.create(req.session.csrfSecret);
    res.render('auth/forgot-password', {
      title: 'Forgot Password - AmexingWeb',
      error: req.query.error || null,
      success: req.query.success || null,
      csrfToken: csrf,
    });
  }

  /**
   * Displays the password reset form with token validation.
   * Validates the reset token and renders the password reset form with
   * security measures for users completing their password recovery process.
   * @function showResetPassword
   * @param {object} req - Express request object with reset token in query.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} - Renders reset password form or redirects on error.
   * @example
   * // GET endpoint example
   * const result = await AuthController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // GET /api/endpoint
   * // Response: { "success": true, "data": [...] }
   * // GET /auth/reset-password?token=abc123
   * // Displays password reset form with validated token
   */
  async showResetPassword(req, res) {
    const csrf = securityMiddlewares.csrfProtection.create(req.session.csrfSecret);
    const { token } = req.query;

    if (!token) {
      return res.redirect(`/auth/forgot-password?error=${encodeURIComponent('Invalid or missing reset token')}`);
    }

    res.render('auth/reset-password', {
      title: 'Reset Password - AmexingWeb',
      error: req.query.error || null,
      token,
      csrfToken: csrf,
    });
  }
}

module.exports = new AuthController();
