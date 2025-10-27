/**
 * Authentication Test Helper
 *
 * Simplifica la autenticación de usuarios seeded en tests de integración.
 * Proporciona utilities para:
 * - Login con usuarios de prueba
 * - Generación de JWT tokens
 * - Creación de agents autenticados para supertest
 * - Extracción de CSRF tokens
 *
 * Trabaja en conjunto con TestDatabaseSeeder para usar usuarios pre-seeded.
 *
 * @author Amexing Development Team
 * @version 1.0.0
 */

const request = require('supertest');
const Parse = require('parse/node');
const TestDatabaseSeeder = require('./testDatabaseSeeder');

/**
 * Authentication Test Helper Class
 */
class AuthTestHelper {
  /**
   * Test user credentials (seeded by TestDatabaseSeeder)
   */
  static TEST_USERS = TestDatabaseSeeder.getTestUserCredentials();

  /**
   * Login a test user and return JWT token
   *
   * @param {string} role - Role name (superadmin, admin, client, etc.)
   * @param {object} app - Express app instance (optional, for HTTP login)
   * @returns {Promise<string>} JWT access token
   */
  static async loginAs(role, app = null) {
    const credentials = this.TEST_USERS[role];

    if (!credentials) {
      throw new Error(`Invalid role: ${role}. Available roles: ${Object.keys(this.TEST_USERS).join(', ')}`);
    }

    try {
      // If app provided, use HTTP login (simulates real flow)
      if (app) {
        return await this.loginViaHTTP(app, credentials);
      }

      // Otherwise, use Parse SDK login (faster for unit tests)
      return await this.loginViaParse(credentials);
    } catch (error) {
      throw new Error(`Failed to login as ${role}: ${error.message}`);
    }
  }

  /**
   * Login via HTTP API (simulates real authentication flow)
   * Uses POST /auth/login endpoint directly
   *
   * @param {object} app - Express app instance
   * @param {object} credentials - User credentials
   * @returns {Promise<string>} JWT access token
   */
  static async loginViaHTTP(app, credentials) {
    try {
      // Call login API endpoint directly (no CSRF needed for API calls)
      const loginResponse = await request(app)
        .post('/auth/login')
        .set('Accept', 'application/json')
        .send({
          identifier: credentials.email,
          password: credentials.password
        });

      if (loginResponse.status !== 200 || !loginResponse.body.success) {
        throw new Error(`Login failed: ${loginResponse.body?.error || 'Unknown error'}`);
      }

      // Extract JWT token from response
      return this.extractTokenFromResponse(loginResponse);
    } catch (error) {
      throw new Error(`HTTP login failed: ${error.message}`);
    }
  }

  /**
   * Extract JWT token from HTTP response
   * Tries cookie first, then response body
   *
   * @param {object} response - Supertest response object
   * @returns {string} JWT access token
   */
  static extractTokenFromResponse(response) {
    // Try to get from cookie first
    const cookies = response.headers['set-cookie'];
    if (cookies) {
      const tokenCookie = cookies.find(c => c.includes('accessToken='));
      if (tokenCookie) {
        const match = tokenCookie.match(/accessToken=([^;]+)/);
        if (match) return match[1];
      }
    }

    // Fallback: get from body (if API returns it)
    if (response.body?.tokens?.accessToken) {
      return response.body.tokens.accessToken;
    }

    // Last resort: user is logged in, generate token manually
    if (response.body?.user) {
      return this.generateTokenForUser(response.body.user);
    }

    throw new Error('Could not extract token from response');
  }

  /**
   * Validate user password (compatible with both AmexingUser instances and Parse.Object)
   *
   * This method handles both cases:
   * 1. AmexingUser instances with validatePassword() method (when registerSubclass is enabled)
   * 2. Generic Parse.Object instances without validatePassword() (when registerSubclass is disabled)
   *
   * @param {Parse.Object} user - User object (AmexingUser or Parse.Object)
   * @param {string} password - Plain text password to validate
   * @returns {Promise<boolean>} True if password is valid
   */
  static async validateUserPassword(user, password) {
    try {
      // If user has validatePassword method (AmexingUser instance), use it
      if (user.validatePassword && typeof user.validatePassword === 'function') {
        return await user.validatePassword(password);
      }

      // Fallback: user is generic Parse.Object without validatePassword method
      // Use bcrypt directly to compare with passwordHash
      const bcrypt = require('bcrypt');
      const passwordHash = user.get('passwordHash');

      if (!passwordHash) {
        return false;
      }

      return await bcrypt.compare(password, passwordHash);
    } catch (error) {
      throw new Error(`Password validation failed: ${error.message}`);
    }
  }

  /**
   * Login via Parse SDK (faster, for unit tests)
   * Queries AmexingUser directly and generates JWT token
   *
   * @param {object} credentials - User credentials
   * @returns {Promise<string>} JWT access token
   */
  static async loginViaParse(credentials) {
    try {
      const AmexingUser = require('../../src/domain/models/AmexingUser');

      // Query AmexingUser using email
      const query = new Parse.Query(AmexingUser);
      query.equalTo('email', credentials.email.toLowerCase().trim());
      const user = await query.first({ useMasterKey: true });

      if (!user) {
        throw new Error('User not found');
      }

      // Verify password using wrapper (handles both AmexingUser and Parse.Object)
      const passwordMatch = await this.validateUserPassword(user, credentials.password);
      if (!passwordMatch) {
        throw new Error('Invalid password');
      }

      // Check if user is active and exists
      if (!user.get('active') || !user.get('exists')) {
        throw new Error('User account is not active');
      }

      // Get role name from roleId
      let roleName = 'guest';
      const roleId = user.get('roleId');
      if (roleId) {
        try {
          const roleQuery = new Parse.Query('Role');
          const roleObject = await roleQuery.get(roleId.id || roleId, { useMasterKey: true });
          if (roleObject) {
            roleName = roleObject.get('name');
          }
        } catch (roleError) {
          // Fallback to default if role fetch fails
          roleName = user.get('role') || 'guest';
        }
      }

      // Generate JWT token manually (same as auth endpoint)
      const jwt = require('jsonwebtoken');
      const token = jwt.sign(
        {
          userId: user.id,
          username: user.get('username'),
          email: user.get('email'),
          role: roleName,
          roleId: roleId,
          organizationId: user.get('organizationId'),
          name: user.getDisplayName ? user.getDisplayName() : user.get('firstName') + ' ' + user.get('lastName'),
          iat: Math.floor(Date.now() / 1000),
        },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '8h' }
      );

      return token;
    } catch (error) {
      throw new Error(`Parse login failed: ${error.message}`);
    }
  }

  /**
   * Generate JWT token for a user object (helper method)
   *
   * @param {object} userObject - User data object
   * @returns {string} JWT access token
   */
  static generateTokenForUser(userObject) {
    const jwt = require('jsonwebtoken');

    const token = jwt.sign(
      {
        userId: userObject.id,
        username: userObject.username,
        email: userObject.email || userObject.username,
        role: userObject.role || 'guest',
        name: userObject.name || userObject.username,
        iat: Math.floor(Date.now() / 1000),
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '8h' }
    );

    return token;
  }

  /**
   * Create authenticated supertest agent for a specific role
   *
   * @param {object} app - Express app instance
   * @param {string} role - Role name
   * @returns {Promise<object>} Supertest agent with authentication
   */
  static async createAuthenticatedAgent(app, role) {
    try {
      const token = await this.loginAs(role, app);

      // Create agent and set Authorization header
      const agent = request.agent(app);
      agent.set('Authorization', `Bearer ${token}`);

      return agent;
    } catch (error) {
      throw new Error(`Failed to create authenticated agent: ${error.message}`);
    }
  }

  /**
   * Get user object for a test role
   *
   * @param {string} role - Role name
   * @returns {Promise<Parse.Object>} User object
   */
  static async getUserByRole(role) {
    const credentials = this.TEST_USERS[role];

    if (!credentials) {
      throw new Error(`Invalid role: ${role}`);
    }

    try {
      const AmexingUser = require('../../src/domain/models/AmexingUser');

      const query = new Parse.Query(AmexingUser);
      query.equalTo('email', credentials.email);
      const user = await query.first({ useMasterKey: true });

      if (!user) {
        throw new Error(`User not found for role: ${role}`);
      }

      return user;
    } catch (error) {
      throw new Error(`Failed to get user: ${error.message}`);
    }
  }

  /**
   * Extract CSRF token from HTML response
   *
   * @param {string} html - HTML response text
   * @returns {string|null} - Extracted CSRF token or null
   */
  static extractCsrfToken(html) {
    // Try multiple patterns for CSRF token extraction
    const patterns = [
      /name="csrfToken"\s+value="([^"]+)"/,
      /name="_csrf"\s+value="([^"]+)"/,
      /csrfToken["\s:]+["']([^"']+)["']/
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Extract session ID from response cookies
   *
   * @param {object} res - Supertest response object
   * @returns {string|null} - Extracted session ID or null
   */
  static getSessionId(res) {
    const cookies = res.headers['set-cookie'];
    if (!cookies) return null;

    const cookie = cookies.find(c => c.includes('amexing.sid'));
    if (!cookie) return null;

    const match = cookie.match(/amexing\.sid=([^;]+)/);
    return match ? match[1] : null;
  }

  /**
   * Simulate complete login flow (get CSRF, login, return session)
   *
   * @param {object} agent - Supertest agent
   * @param {string} role - Role name
   * @returns {Promise<object>} Login response
   */
  static async simulateLoginFlow(agent, role) {
    const credentials = this.TEST_USERS[role];

    if (!credentials) {
      throw new Error(`Invalid role: ${role}`);
    }

    try {
      // Get login page to obtain CSRF token
      const loginPage = await agent.get('/login');
      const csrfToken = this.extractCsrfToken(loginPage.text);

      if (!csrfToken) {
        throw new Error('Failed to extract CSRF token from login page');
      }

      // Submit login form with CSRF token
      const loginResponse = await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken
        });

      return loginResponse;
    } catch (error) {
      throw new Error(`Login flow simulation failed: ${error.message}`);
    }
  }

  /**
   * Perform logout
   *
   * @param {object} agent - Supertest agent
   * @returns {Promise<object>} Logout response
   */
  static async performLogout(agent) {
    try {
      return await agent.get('/logout').timeout(15000);
    } catch (error) {
      throw new Error(`Logout failed: ${error.message}`);
    }
  }

  /**
   * Get credentials for a specific role
   *
   * @param {string} role - Role name
   * @returns {object} Credentials object {email, password, role}
   */
  static getCredentials(role) {
    const credentials = this.TEST_USERS[role];

    if (!credentials) {
      throw new Error(`Invalid role: ${role}. Available roles: ${Object.keys(this.TEST_USERS).join(', ')}`);
    }

    return credentials;
  }

  /**
   * Get all available test roles
   *
   * @returns {Array<string>} Array of role names
   */
  static getAvailableRoles() {
    return Object.keys(this.TEST_USERS);
  }

  /**
   * Verify user has specific role
   *
   * @param {string} email - User email
   * @param {string} expectedRole - Expected role name
   * @returns {Promise<boolean>} True if user has role
   */
  static async verifyUserRole(email, expectedRole) {
    try {
      const AmexingUser = require('../../src/domain/models/AmexingUser');

      const query = new Parse.Query(AmexingUser);
      query.equalTo('email', email);
      query.include('roleId');
      const user = await query.first({ useMasterKey: true });

      if (!user) {
        throw new Error(`User not found: ${email}`);
      }

      const roleId = user.get('roleId');
      if (!roleId) {
        throw new Error('User has no role assigned');
      }

      const roleName = roleId.get('name');
      return roleName === expectedRole;
    } catch (error) {
      throw new Error(`Failed to verify user role: ${error.message}`);
    }
  }

  /**
   * Create request with authentication header
   *
   * @param {object} app - Express app instance
   * @param {string} role - Role name
   * @param {string} method - HTTP method (get, post, put, delete, etc.)
   * @param {string} path - Request path
   * @returns {Promise<object>} Supertest request object
   */
  static async createAuthenticatedRequest(app, role, method, path) {
    const token = await this.loginAs(role);

    return request(app)
      [method](path)
      .set('Authorization', `Bearer ${token}`);
  }

  /**
   * Batch login multiple users
   *
   * @param {Array<string>} roles - Array of role names
   * @param {object} app - Express app instance (optional)
   * @returns {Promise<object>} Map of role -> token
   */
  static async batchLogin(roles, app = null) {
    const tokens = {};

    for (const role of roles) {
      try {
        tokens[role] = await this.loginAs(role, app);
      } catch (error) {
        console.error(`Failed to login ${role}:`, error.message);
        tokens[role] = null;
      }
    }

    return tokens;
  }

  /**
   * Helper to create test context with authenticated users
   * Useful for beforeAll setup in test suites
   *
   * @param {object} app - Express app instance
   * @param {Array<string>} roles - Roles to authenticate
   * @returns {Promise<object>} Context object with agents and tokens
   */
  static async createTestContext(app, roles = ['superadmin']) {
    const context = {
      agents: {},
      tokens: {},
      users: {}
    };

    for (const role of roles) {
      try {
        context.tokens[role] = await this.loginAs(role, app);
        context.agents[role] = await this.createAuthenticatedAgent(app, role);
        context.users[role] = await this.getUserByRole(role);
      } catch (error) {
        console.error(`Failed to setup ${role} in test context:`, error.message);
      }
    }

    return context;
  }
}

module.exports = AuthTestHelper;
