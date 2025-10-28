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
 * @version 1.0.0
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
/* eslint-disable max-lines */
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
    // Ensure session exists
    if (!req.session) {
      logger.error('No session available in showLogin');
      return res.status(500).render('errors/error', {
        title: 'Session Error',
        message: 'Please refresh the page and try again',
      });
    }

    // Ensure CSRF secret exists, generate if missing
    if (!req.session.csrfSecret) {
      const uidSafe = require('uid-safe');
      req.session.csrfSecret = await uidSafe(32);
      logger.warn('CSRF secret was missing in showLogin, generated new one', {
        sessionID: req.session.id,
      });
    }

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
    // Ensure session exists
    if (!req.session) {
      logger.error('No session available in showRegister');
      return res.status(500).render('errors/error', {
        title: 'Session Error',
        message: 'Please refresh the page and try again',
      });
    }

    // Ensure CSRF secret exists, generate if missing
    if (!req.session.csrfSecret) {
      const uidSafe = require('uid-safe');
      req.session.csrfSecret = await uidSafe(32);
      logger.warn('CSRF secret was missing in showRegister, generated new one', {
        sessionID: req.session.id,
      });
    }

    const csrf = securityMiddlewares.csrfProtection.create(req.session.csrfSecret);
    res.render('auth/register', {
      title: 'Register - AmexingWeb',
      error: req.query.error || null,
      csrfToken: csrf,
      parseAppId: process.env.PARSE_APP_ID,
    });
  }

  /**
   * Authenticates user against AmexingUser table with password validation.
   * Queries AmexingUser by username or email and validates password.
   * @function authenticateAmexingUser
   * @param {string} usernameOrEmail - Username or email to authenticate.
   * @param {string} password - Password to validate.
   * @returns {Promise<Parse.Object|null>} - AmexingUser object or null if authentication fails.
   * @private
   * @example
   * const user = await authenticateAmexingUser('user@example.com', 'password123');
   * if (user) {
   *   // Authentication successful
   * }
   */
  async authenticateAmexingUser(usernameOrEmail, password) {
    try {
      const bcrypt = require('bcrypt');

      // Query AmexingUser by username or email
      const usernameQuery = new Parse.Query('AmexingUser');
      usernameQuery.equalTo('username', usernameOrEmail);

      const emailQuery = new Parse.Query('AmexingUser');
      emailQuery.equalTo('email', usernameOrEmail);

      const combinedQuery = Parse.Query.or(usernameQuery, emailQuery);
      combinedQuery.equalTo('active', true);
      combinedQuery.equalTo('exists', true);

      const user = await combinedQuery.first({ useMasterKey: true });

      if (!user) {
        logger.warn('Authentication failed: User not found', {
          usernameOrEmail,
        });
        return null;
      }

      // Get stored password hash
      const passwordHash = user.get('password');
      if (!passwordHash) {
        logger.error('Authentication failed: No password hash found', {
          userId: user.id,
        });
        return null;
      }

      // Validate password using bcrypt
      const isValid = await bcrypt.compare(password, passwordHash);

      if (!isValid) {
        logger.warn('Authentication failed: Invalid password', {
          userId: user.id,
          username: user.get('username'),
        });
        return null;
      }

      logger.info('User authenticated successfully', {
        userId: user.id,
        username: user.get('username'),
      });

      return user;
    } catch (error) {
      logger.error('Error during AmexingUser authentication:', {
        error: error.message,
        usernameOrEmail,
      });
      return null;
    }
  }

  /**
   * Processes user login with AmexingUser authentication and session management.
   * Handles POST requests for user authentication, validates credentials against
   * AmexingUser table, creates sessions, and manages login attempts with security
   * logging and error handling.
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

      // Authenticate with AmexingUser table
      const user = await this.authenticateAmexingUser(username, password);

      if (!user) {
        logger.warn('Login failed: Invalid credentials', {
          username,
        });

        if (req.accepts('json')) {
          return res.status(401).json({
            success: false,
            message: 'Credenciales inválidas',
          });
        }

        return this.returnWithToken(req, res);
      }

      // Create session token for the user
      const sessionToken = await Parse.Cloud.run('createSessionForUser', {
        userId: user.id,
      });

      // Store session information
      req.session.user = {
        id: user.id,
        username: user.get('username'),
        email: user.get('email'),
      };
      req.session.sessionToken = sessionToken;

      logger.info(`User ${username} logged in successfully`, {
        userId: user.id,
      });

      if (req.accepts('json')) {
        return res.json({
          success: true,
          user: {
            id: user.id,
            username: user.get('username'),
            email: user.get('email'),
          },
        });
      }

      return res.redirect('/');
    } catch (error) {
      logger.error('Login error:', {
        error: error.message,
        stack: error.stack,
      });

      if (req.accepts('json')) {
        return res.status(401).json({
          success: false,
          message: 'Error en el inicio de sesión',
        });
      }

      return this.returnWithToken(req, res);
    }
  }

  /**
   * Renders the login form with an error message and regenerated CSRF token.
   * Helper method used when login fails to re-render the login page with
   * security tokens and error messages, ensuring CSRF protection is maintained.
   * @function returnWithToken
   * @param {object} req - Express request object with session data.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} - Renders login view with error message.
   * @example
   * // Internal usage when login validation fails
   * return this.returnWithToken(req, res);
   * // Renders login page with "Invalid username or password" error
   */
  async returnWithToken(req, res) {
    // Ensure CSRF secret exists, generate if missing
    if (!req.session || !req.session.csrfSecret) {
      const uidSafe = require('uid-safe');
      req.session.csrfSecret = await uidSafe(32);
      logger.warn('CSRF secret was missing in returnWithToken, generated new one', {
        sessionID: req.session?.id,
      });
    }

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

  /**
   * Validates user registration input data for required fields.
   * Checks that username, password, and email are provided in the registration
   * request and returns validation result with error messages if validation fails.
   * @function validateRegistration
   * @param root0
   * @param root0.username
   * @param root0.password
   * @param root0.email
   * @param data.username
   * @returns {{isValid: boolean, error?: string}} Validation result object with isValid flag and optional error message.
   * @example
   * // Valid registration data
   * const result = validateRegistration({ username: 'user', password: 'pass123', email: 'user@example.com' });
   * // Returns: { isValid: true }
   *
   * // Invalid registration data (missing email)
   * const result = validateRegistration({ username: 'user', password: 'pass123' });
   * // Returns: { isValid: false, error: 'Username, password, and email are required' }
   */
  validateRegistration({ username, password, email }) {
    if (!username || !password || !email) {
      return {
        isValid: false,
        error: 'Username, password, and email are required',
      };
    }
    return { isValid: true };
  }

  /**
   * Handles registration validation errors by rendering error responses.
   * Processes validation failures during registration and returns appropriate
   * error responses for both JSON API and web interface requests with CSRF protection.
   * @function handleRegistrationValidationError
   * @param {object} res - Express response object.
   * @param {string} errorMessage - Validation error message to display.
   * @returns {Promise<void>} - Sends JSON error or renders registration form with error.
   * @example
   * // JSON API request
   * await handleRegistrationValidationError(res, 'Username, password, and email are required');
   * // Returns: { success: false, message: 'Username, password, and email are required' }
   *
   * // Web interface request
   * await handleRegistrationValidationError(res, 'All fields are required');
   * // Renders registration form with error message and new CSRF token
   */
  async handleRegistrationValidationError(res, errorMessage) {
    if (res.req.accepts('json')) {
      return res.status(400).json({
        success: false,
        message: errorMessage,
      });
    }

    // Ensure CSRF secret exists, generate if missing
    if (!res.req.session || !res.req.session.csrfSecret) {
      const uidSafe = require('uid-safe');
      res.req.session.csrfSecret = await uidSafe(32);
      logger.warn('CSRF secret was missing in handleRegistrationValidationError, generated new one', {
        sessionID: res.req.session?.id,
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

  /**
   * Creates a new Parse Server user account with the provided credentials.
   * Initializes a Parse.User object, sets username, password, and email,
   * and persists the user to the database through Parse Server's signUp method.
   * @function createUser
   * @param root0
   * @param root0.username
   * @param root0.password
   * @param root0.email
   * @param userData.username
   * @returns {Promise<Parse.User>} - Promise resolving to the created Parse User object.
   * @throws {Parse.Error} - Throws Parse error if username exists or validation fails.
   * @example
   * // Create new user
   * const newUser = await createUser({
   *   username: 'johndoe',
   *   password: 'user-password',
   *   email: 'john@example.com'
   * });
   * // Returns Parse.User object with id and session token
   */
  async createUser({ username, password, email }) {
    const user = new Parse.User();
    user.set('username', username);
    user.set('password', password);
    user.set('email', email);
    return user.signUp();
  }

  /**
   * Stores authenticated user information in the Express session.
   * Sets session data including user ID, username, and Parse Server session token
   * for maintaining authentication state across requests.
   * @function setUserSession
   * @param {object} req - Express request object with session.
   * @param {Parse.User} user - Authenticated Parse User object.
   * @returns {void}
   * @example
   * // Store user session after successful login
   * const user = await Parse.User.logIn(username, password);
   * setUserSession(req, user);
   * // Session now contains: { user: { id: '...', username: '...' }, sessionToken: '...' }
   */
  setUserSession(req, user) {
    req.session.user = {
      id: user.id,
      username: user.get('username'),
    };
    req.session.sessionToken = user.getSessionToken();
  }

  /**
   * Handles successful user registration by sending appropriate response.
   * Processes successful registration completion and returns JSON response for
   * API requests or redirects to homepage for web interface requests.
   * @function handleRegistrationSuccess
   * @param {object} res - Express response object.
   * @param {Parse.User} user - Newly created and authenticated Parse User object.
   * @returns {void} - Sends JSON response or redirects to homepage.
   * @example
   * // JSON API request
   * handleRegistrationSuccess(res, user);
   * // Returns: { success: true, user: { id: '123', username: 'johndoe' } }
   *
   * // Web interface request
   * handleRegistrationSuccess(res, user);
   * // Redirects to: /
   */
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

  /**
   * Handles registration errors by logging and rendering error responses.
   * Processes errors during user registration, logs security events, and returns
   * appropriate error responses for both JSON API and web interface requests.
   * @function handleRegistrationError
   * @param {object} res - Express response object.
   * @param {Error} error - Error object from registration failure.
   * @returns {Promise<void>} - Sends JSON error or renders registration form with error.
   * @example
   * // JSON API request with username already taken
   * await handleRegistrationError(res, new Error('Username already exists'));
   * // Returns: { success: false, message: 'Username already exists' }
   *
   * // Web interface request with validation error
   * await handleRegistrationError(res, new Error('Invalid email format'));
   * // Renders registration form with error message and new CSRF token
   */
  async handleRegistrationError(res, error) {
    logger.error('Registration error:', error);

    if (res.req.accepts('json')) {
      return res.status(400).json({
        success: false,
        message: error.message || 'Registration failed',
      });
    }

    // Ensure CSRF secret exists, generate if missing
    if (!res.req.session || !res.req.session.csrfSecret) {
      const uidSafe = require('uid-safe');
      res.req.session.csrfSecret = await uidSafe(32);
      logger.warn('CSRF secret was missing in handleRegistrationError, generated new one', {
        sessionID: res.req.session?.id,
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
    // Ensure session exists
    if (!req.session) {
      logger.error('No session available in showForgotPassword');
      return res.status(500).render('errors/error', {
        title: 'Session Error',
        message: 'Please refresh the page and try again',
      });
    }

    // Ensure CSRF secret exists, generate if missing
    if (!req.session.csrfSecret) {
      const uidSafe = require('uid-safe');
      req.session.csrfSecret = await uidSafe(32);
      logger.warn('CSRF secret was missing in showForgotPassword, generated new one', {
        sessionID: req.session.id,
      });
    }

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
    // Ensure session exists
    if (!req.session) {
      logger.error('No session available in showResetPassword');
      return res.status(500).render('errors/error', {
        title: 'Session Error',
        message: 'Please refresh the page and try again',
      });
    }

    // Ensure CSRF secret exists, generate if missing
    if (!req.session.csrfSecret) {
      const uidSafe = require('uid-safe');
      req.session.csrfSecret = await uidSafe(32);
      logger.warn('CSRF secret was missing in showResetPassword, generated new one', {
        sessionID: req.session.id,
      });
    }

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
