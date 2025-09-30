/**
 * Authentication Service Core - Base functionality
 * Core authentication operations split for better maintainability.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Authentication service usage
 * const result = await authenticationservicecore.require(userData);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 */

const Parse = require('parse/node');
const jwt = require('jsonwebtoken');
// const crypto = require('crypto'); // Not used in this file
const AmexingUser = require('../../domain/models/AmexingUser');
const logger = require('../../infrastructure/logger');

/**
 * Authentication Service Core - Base functionality for authentication operations.
 * Provides core authentication utilities including JWT token management, user validation,
 * and common authentication helpers that are shared across different authentication services.
 *
 * This class serves as the foundation for authentication services, containing
 * common functionality for user registration validation, JWT token generation,
 * and user lookup operations.
 *
 * Features:
 * - User registration data validation
 * - JWT token generation and management
 * - User lookup and verification utilities
 * - Email and username validation
 * - Password strength enforcement
 * - Token expiration handling
 * - Common authentication helpers.
 * @class AuthenticationServiceCore
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Extend for specific authentication functionality
 * class AuthenticationService extends AuthenticationServiceCore {
 *   async loginUser(email, password) {
 *     const user = await this.findUserByEmail(email);
 *     const tokens = await this.generateTokens(user);
 *     return { user, tokens };
 *   }
 * }
 *
 * // Direct usage for core operations
 * const core = new AuthenticationServiceCore();
 * core.validateRegistrationData(userData);
 * const tokens = await core.generateTokens(user);
 */
class AuthenticationServiceCore {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '8h';
    this.refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
  }

  /**
   * Validates registration data.
   * @param {object} userData - User registration data.
   * @throws {Parse.Error} If validation fails.
   * @example
   * // Authentication service usage
   * const result = await authenticationservicecore.validateRegistrationData(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * const userData = { username: 'john', email: 'john@example.com', password: 'pass123' };
   * authService.validateRegistrationData(userData);
   * @returns {*} - Operation result.
   */
  validateRegistrationData(userData) {
    const required = ['username', 'email', 'password', 'firstName', 'lastName'];

    required.forEach((field) => {
      // eslint-disable-next-line security/detect-object-injection
      if (
        !userData[field]
        || typeof userData[field] !== 'string'
        || userData[field].trim() === ''
      ) {
        throw new Parse.Error(
          Parse.Error.VALIDATION_ERROR,
          `${field} is required`
        );
      }
    });

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userData.email)) {
      throw new Parse.Error(
        Parse.Error.VALIDATION_ERROR,
        'Invalid email format'
      );
    }

    // Validate username format (alphanumeric and underscores only)
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(userData.username)) {
      throw new Parse.Error(
        Parse.Error.VALIDATION_ERROR,
        'Username must be 3-20 characters, alphanumeric and underscores only'
      );
    }
  }

  /**
   * Checks if user already exists.
   * @param {string} email - Email to check.
   * @param email
   * @param {string} username - Username to check.
   * @throws {Parse.Error} If user exists.
   * @example
   * // Authentication service usage
   * const result = await authenticationservicecore.checkUserExists(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * await authService.checkUserExists('john@example.com', 'john_doe');
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async checkUserExists(email, username) {
    // Check email
    const emailQuery = new Parse.Query(AmexingUser);
    emailQuery.equalTo('email', email.toLowerCase());
    const existingEmail = await emailQuery.first({ useMasterKey: true });

    if (existingEmail) {
      throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'Email already exists');
    }

    // Check username
    const usernameQuery = new Parse.Query(AmexingUser);
    usernameQuery.equalTo('username', username.toLowerCase());
    const existingUsername = await usernameQuery.first({ useMasterKey: true });

    if (existingUsername) {
      throw new Parse.Error(
        Parse.Error.USERNAME_TAKEN,
        'Username already exists'
      );
    }
  }

  /**
   * Finds user by email or username.
   * @param {string} identifier - Email or username.
   * @returns {Promise<AmexingUser|null>} - User object or null.
   * @example
   * // Authentication service usage
   * const result = await authenticationservicecore.findUserByIdentifier(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * const user = await authService.findUserByIdentifier('john@example.com');
   */
  async findUserByIdentifier(identifier) {
    const emailQuery = new Parse.Query(AmexingUser);
    emailQuery.equalTo('email', identifier.toLowerCase());

    const usernameQuery = new Parse.Query(AmexingUser);
    usernameQuery.equalTo('username', identifier.toLowerCase());

    const query = Parse.Query.or(emailQuery, usernameQuery);

    return query.first({ useMasterKey: true });
  }

  /**
   * Finds user by email.
   * @param {string} email - User email.
   * @param email
   * @returns {Promise<AmexingUser|null>} - User object or null.
   * @example
   * // Authentication service usage
   * const result = await authenticationservicecore.findUserByEmail(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * const user = await authService.findUserByEmail('john@example.com');
   */
  async findUserByEmail(email) {
    const query = new Parse.Query(AmexingUser);
    query.equalTo('email', email.toLowerCase());
    return query.first({ useMasterKey: true });
  }

  /**
   * Retrieves user by unique identifier with Parse Server query optimization.
   * Performs direct user lookup using Parse Server's get method with master key
   * privileges for administrative operations and user data retrieval.
   * @function findUserById
   * @param {string} userId - Unique Parse Server user identifier.
   * @returns {Promise<AmexingUser|null>} - User object or null if not found.
   * @example
   * // Authentication service usage
   * const result = await authenticationservicecore.findUserById(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Find user by Parse Server ID
   * const user = await authService.findUserById('user123');
   * if (user) {
   *   console.log('User found:', user.get('username'));
   * }
   */
  async findUserById(userId) {
    const query = new Parse.Query(AmexingUser);
    return query.get(userId, { useMasterKey: true });
  }

  /**
   * Generates secure JWT access and refresh token pairs for authenticated sessions.
   * Creates cryptographically signed tokens with appropriate expiration times and
   * user claims for secure session management and API access authorization.
   * @function generateTokens
   * @param {AmexingUser} user - Authenticated Parse Server user object.
   * @returns {Promise<object>} - Token object containing accesstoken, refreshtoken, and metadata.
   * @example
   * // Authentication service usage
   * const result = await authenticationservicecore.generateTokens(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Generate tokens for authenticated user
   * const tokens = await authService.generateTokens(user);
   * console.log('Access Token:', tokens.accesstoken);
   * console.log('Expires In:', tokens.expires_in);
   */
  async generateTokens(user) {
    // Get role name from the new Role relationship (Pointer)
    let roleName = 'guest';
    let roleObjectId = null;
    const rolePointer = user.get('roleId');

    if (rolePointer) {
      try {
        // Check if rolePointer is already a fetched object or just a pointer
        if (rolePointer.get && typeof rolePointer.get === 'function') {
          // Role object is already fetched
          roleName = rolePointer.get('name') || 'guest';
          roleObjectId = rolePointer.id;
        } else if (typeof rolePointer === 'string') {
          // rolePointer is a string ID (backward compatibility)
          const roleQuery = new Parse.Query('Role');
          roleQuery.equalTo('objectId', rolePointer);
          const roleObject = await roleQuery.first({ useMasterKey: true });
          if (roleObject) {
            roleName = roleObject.get('name') || 'guest';
            roleObjectId = roleObject.id;
          }
        } else {
          // rolePointer is a pointer object, fetch it
          const roleQuery = new Parse.Query('Role');
          roleQuery.equalTo('objectId', rolePointer.id);
          const roleObject = await roleQuery.first({ useMasterKey: true });
          if (roleObject) {
            roleName = roleObject.get('name') || 'guest';
            roleObjectId = roleObject.id;
          }
        }
      } catch (roleError) {
        // Fall back to old role field if new relationship fails
        roleName = user.get('role') || 'guest';
        logger.warn(
          'Failed to resolve role from Pointer, falling back to string role',
          {
            userId: user.id,
            error: roleError.message,
          }
        );
      }
    } else {
      // Fall back to old role field if no roleId
      roleName = user.get('role') || 'guest';
    }

    const payload = {
      userId: user.id,
      username: user.get('username'),
      email: user.get('email'),
      role: roleName,
      roleId: roleObjectId,
      organizationId: user.get('organizationId'),
      iat: Math.floor(Date.now() / 1000),
    };

    const accessToken = jwt.sign(
      { ...payload, type: 'access' },
      this.jwtSecret,
      { expiresIn: this.jwtExpiresIn }
    );

    const refreshToken = jwt.sign(
      { ...payload, type: 'refresh' },
      this.jwtSecret,
      { expiresIn: this.refreshExpiresIn }
    );

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.jwtExpiresIn,
    };
  }

  /**
   * Masks email for logging purposes.
   * @param {string} email - Email to mask.
   * @param email
   * @returns {string} - Operation result Masked email.
   * @example
   * // Authentication service usage
   * const result = await authenticationservicecore.maskEmail(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * const masked = authService.maskEmail('john@example.com'); // returns 'joh***@example.com'
   */
  maskEmail(email) {
    if (!email) return '';
    const [local, _domain] = email.split('@');
    return `${local.substring(0, 3)}***@${_domain}`;
  }
}

module.exports = { AuthenticationServiceCore };
