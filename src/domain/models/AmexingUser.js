/**
 * AmexingUser Model - Custom User Entity for Amexing Platform
 * Replaces Parse.User with enhanced OAuth and PCI DSS compliance features.
 * @author Amexing Development Team
 * @version 1.0.0
 * @created 2024-09-12
 * @example
 * // Model method usage
 * const result = await amexinguser.require({ 'parse/node': 'example' });
 * // Returns: model operation result
 */

const Parse = require('parse/node');
const bcrypt = require('bcrypt');
const logger = require('../../infrastructure/logger');
const BaseModel = require('./BaseModel');

/**
 * AmexingUser Model - Extended Parse User with comprehensive PCI DSS compliance features.
 * Provides secure authentication, password management, OAuth integration, account lockout
 * protection, and comprehensive audit capabilities for the Amexing platform.
 *
 * This model replaces Parse.User with enhanced security features including bcrypt password
 * hashing, failed login attempt tracking, account lockout mechanisms, OAuth account
 * management, and detailed audit logging for PCI DSS compliance.
 *
 * Features:
 * - PCI DSS compliant password hashing with bcrypt
 * - Account lockout protection with configurable thresholds
 * - Multi-provider OAuth account management (Google, Microsoft, Apple)
 * - Failed login attempt tracking and security logging
 * - Password strength validation with customizable requirements
 * - Safe JSON serialization excluding sensitive data
 * - Comprehensive audit trails for security monitoring
 * - Email verification and user activation workflows
 * - Role-based access control integration
 * - Session management and authentication tracking.
 * @class AmexingUser
 * @augments Parse.Object
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Create new user with secure password
 * const userData = {
 *   username: 'john.doe',
 *   email: 'john@example.com',
 *   firstName: 'John',
 *   lastName: 'Doe'
 * };
 * const user = AmexingUser.create(userData);
 * await user.setPassword('user-password');
 * await user.save();
 *
 * // Validate user password
 * const isValid = await user.validatePassword('user-password');
 * if (isValid) {
 *   await user.recordSuccessfulLogin('password');
 * } else {
 *   const isLocked = await user.recordFailedLogin();
 * }
 *
 * // OAuth account management
 * user.addOAuthAccount({
 *   provider: 'google',
 *   providerId: '123456789',
 *   email: 'john@gmail.com',
 *   accessToken: 'oauthtoken'
 * });
 *
 * // Safe user data for API responses
 * const safeUserData = user.toSafeJSON();
 */
class AmexingUser extends BaseModel {
  constructor() {
    super('AmexingUser');
  }

  /**
   * Creates a new AmexingUser instance.
   * @param {object} userData - User data object.
   * @returns {AmexingUser} - Operation result New AmexingUser instance.
   * @example
   * // Create model instance
   * const instance = AmexingUser.create(data);
   * const saved = await instance.save();
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  static create(userData) {
    const user = new AmexingUser();

    // Required fields
    user.set('username', userData.username);
    user.set('email', userData.email);
    user.set('firstName', userData.firstName);
    user.set('lastName', userData.lastName);

    // Default values
    user.set('role', userData.role || 'user');
    user.set('active', userData.active !== undefined ? userData.active : true);
    user.set('exists', userData.exists !== undefined ? userData.exists : true);
    user.set('emailVerified', false);
    user.set('loginAttempts', 0);
    user.set('lockedUntil', null);
    user.set('lastLoginAt', null);
    user.set('passwordChangedAt', new Date());
    user.set('mustChangePassword', false);

    // OAuth fields
    user.set('oauthAccounts', userData.oauthAccounts || []);
    user.set('primaryOAuthProvider', userData.primaryOAuthProvider || null);
    user.set('lastAuthMethod', userData.lastAuthMethod || 'password');

    // Organizational relationships
    user.set('clientId', userData.clientId || null);
    user.set('departmentId', userData.departmentId || null);

    // Audit fields
    user.set('createdBy', userData.createdBy || null);
    user.set('modifiedBy', userData.modifiedBy || null);

    return user;
  }

  /**
   * Sets password with bcrypt hashing and PCI DSS validation.
   * @param {string} password - Plain text password.
   * @param {boolean} validateStrength - Whether to validate password strength.
   * @example
   * // Model method usage
   * const result = await amexinguser.setPassword({ password: 'example', validateStrength: 'example' });
   * // Returns: model operation result
   * // const isValid = validator.validate(data);
   * // Returns: boolean or validation result object
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async setPassword(password, validateStrength = true) {
    if (validateStrength) {
      this.validatePasswordStrength(password);
    }

    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    this.set('passwordHash', hashedPassword);
    this.set('passwordChangedAt', new Date());
    this.set('mustChangePassword', false);
    this.set('loginAttempts', 0);
    this.set('lockedUntil', null);
  }

  /**
   * Validates password against stored hash.
   * @param {string} password - Plain text password.
   * @returns {boolean} - Boolean result True if password matches.
   * @example
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  /**
   * Validates user password against stored hash with bcrypt comparison.
   * Performs secure password verification using bcrypt hashing algorithm
   * for authentication validation with timing attack protection.
   * @function validatePassword
   * @param {string} password - Plain text password to validate.
   * @returns {Promise<boolean>} - True if password matches stored hash, false otherwise.
   * @example
   * // Model method usage
   * const result = await amexinguser.validatePassword({ password: 'example' });
   * // Returns: model operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Validate user password during login
   * const isValid = await user.validatePassword('userPassword123!');
   * if (isValid) {
   *   // Proceed with authentication
   * }
   */
  async validatePassword(password) {
    const hashedPassword = this.get('passwordHash');
    if (!hashedPassword) {
      return false;
    }
    return bcrypt.compare(password, hashedPassword);
  }

  /**
   * Validates password strength according to PCI DSS requirements.
   * @param {string} password - Plain text password.
   * @throws {Parse.Error} If password doesn't meet requirements.
   * @example
   * // Model method usage
   * const result = await amexinguser.validatePasswordStrength({ password: 'example' });
   * // Returns: model operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {*} - Operation result.
   */
  validatePasswordStrength(password) {
    const minLength = parseInt(process.env.PASSWORD_MIN_LENGTH, 10) || 12;
    const requireUppercase = process.env.PASSWORD_REQUIRE_UPPERCASE === 'true';
    const requireLowercase = process.env.PASSWORD_REQUIRE_LOWERCASE === 'true';
    const requireNumbers = process.env.PASSWORD_REQUIRE_NUMBERS === 'true';
    const requireSpecial = process.env.PASSWORD_REQUIRE_SPECIAL === 'true';

    const errors = [];

    /**
     * Validates minimum password length according to PCI DSS requirements.
     * Ensures password meets configured minimum length for security compliance.
     * @param {*} password.length < minLength - password.length < minLength parameter.
     * @returns {*} - Operation result.
     * @example
     * // Model method usage
     * const result = await amexinguser.if({ password.length: 'example' });
     * // Returns: model operation result
     */
    if (password.length < minLength) {
      errors.push(`Password must be at least ${minLength} characters long`);
    }

    /**
     * Validates password contains required uppercase letters for security.
     * Ensures compliance with uppercase letter requirements when enabled.
     * @param {*} requireUppercase && !/[A-Z]/.test(password - requireUppercase && !/[A-Z]/.test(password parameter.
     * @returns {*} - Operation result.
     * @example
     * // Model method usage
     * const result = await amexinguser.if({ requireUppercase: 'example' });
     * // Returns: model operation result
     */
    if (requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    /**
     * Validates password contains required lowercase letters for security.
     * Ensures compliance with lowercase letter requirements when enabled.
     * @param {*} requireLowercase && !/[a-z]/.test(password - requireLowercase && !/[a-z]/.test(password parameter.
     * @returns {*} - Operation result.
     * @example
     * // Model method usage
     * const result = await amexinguser.if({ requireLowercase: 'example' });
     * // Returns: model operation result
     */
    if (requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    /**
     * Validates password contains required numeric characters for security.
     * Ensures compliance with number requirements when enabled.
     * @param {*} requireNumbers && !/\d/.test(password - requireNumbers && !/\d/.test(password parameter.
     * @returns {*} - Operation result.
     * @example
     * // Model method usage
     * const result = await amexinguser.if({ requireNumbers: 'example' });
     * // Returns: model operation result
     */
    if (requireNumbers && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    /**
     * Validates password contains required special characters for security.
     * Ensures compliance with special character requirements when enabled.
     * @param {*} requireSpecial && !/[!@#$%^&*( - requireSpecial && !/[!@#$%^&*( parameter.
     * @returns {*} - Operation result.
     * @example
     * // Model method usage
     * const result = await amexinguser.if({ requireSpecial: 'example' });
     * // Returns: model operation result
     */
    if (requireSpecial && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    /**
     * Throws Parse validation error if any password requirements fail.
     * Aggregates all validation errors into comprehensive error message.
     * @param {*} errors.length > 0 - errors.length > 0 parameter.
     * @returns {*} - Operation result.
     * @example
     * // Model method usage
     * const result = await amexinguser.if({ errors.length: 'example' });
     * // Returns: model operation result
     */
    if (errors.length > 0) {
      throw new Parse.Error(
        Parse.Error.VALIDATION_ERROR,
        `Password validation failed: ${errors.join(', ')}`
      );
    }
  }

  /**
   * Records a failed login attempt.
   * @returns {boolean} - Boolean result True if account is now locked.
   * @example
   * // Model method usage
   * const result = await amexinguser.recordFailedLogin({ errors.length: 'example' });
   * // Returns: model operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  async recordFailedLogin() {
    const maxAttempts = parseInt(process.env.MAX_LOGIN_ATTEMPTS, 10) || 5;
    const lockoutDuration = parseInt(process.env.ACCOUNT_LOCKOUT_DURATION_MINUTES, 10) || 30;

    let attempts = this.get('loginAttempts') || 0;
    attempts += 1;
    this.set('loginAttempts', attempts);

    /**
     * Implements account lockout mechanism when max attempts exceeded.
     * Locks user account for configured duration and logs security event
     * for compliance and monitoring purposes.
     * @param {*} attempts > - attempts > parameter.
     * @returns {boolean} - Boolean result Operation result.
     * @example
     * // Model method usage
     * const result = await amexinguser.if({ attempts: 'example' });
     * // Returns: model operation result
     */
    if (attempts >= maxAttempts) {
      const lockoutTime = new Date();
      lockoutTime.setMinutes(lockoutTime.getMinutes() + lockoutDuration);
      this.set('lockedUntil', lockoutTime);

      logger.logSecurityEvent('ACCOUNT_LOCKED', {
        userId: this.id,
        username: this.get('username'),
        attempts,
        lockoutUntil: lockoutTime.toISOString(),
      });

      return true;
    }

    await this.save(null, { useMasterKey: true });
    return false;
  }

  /**
   * Records successful login with authentication method tracking and security logging.
   * Resets failed login attempts, updates last login timestamp, and logs successful
   * authentication event for audit trail and user activity monitoring.
   * @function recordSuccessfulLogin
   * @param {string} [authMethod] - Authentication method used (password, oauth, etc.).
   * @returns {Promise<void>} - Saves user with updated login information.
   * @example
   * // Model method usage
   * const result = await amexinguser.recordSuccessfulLogin({ authMethod: 'example' });
   * // Returns: model operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Record successful password login
   * await user.recordSuccessfulLogin('password');
   *
   * // Record successful OAuth login
   * await user.recordSuccessfulLogin('google_oauth');
   */
  async recordSuccessfulLogin(authMethod = 'password') {
    this.set('loginAttempts', 0);
    this.set('lockedUntil', null);
    this.set('lastLoginAt', new Date());
    this.set('lastAuthMethod', authMethod);

    await this.save(null, { useMasterKey: true });
  }

  /**
   * Checks if account is currently locked.
   * @returns {boolean} - Boolean result True if account is locked.
   * @example
   * // Model method usage
   * const result = await amexinguser.isAccountLocked({ authMethod: 'example' });
   * // Returns: model operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  isAccountLocked() {
    const lockedUntil = this.get('lockedUntil');
    if (!lockedUntil) {
      return false;
    }
    return new Date() < lockedUntil;
  }

  /**
   * Adds OAuth account information.
   * @param {object} oauthData - OAuth account data.
   * @example
   * // Model method usage
   * const result = await amexinguser.addOAuthAccount({ oauthData: 'example' });
   * // Returns: model operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {*} - Operation result.
   */
  addOAuthAccount(oauthData) {
    const existingAccounts = this.get('oauthAccounts') || [];

    // Check if account already exists
    const existingIndex = existingAccounts.findIndex(
      (account) => account.provider === oauthData.provider && account.providerId === oauthData.providerId
    );

    if (existingIndex >= 0) {
      // Update existing account
      existingAccounts[existingIndex] = {
        ...existingAccounts[existingIndex],
        ...oauthData,
        updatedAt: new Date(),
      };
    } else {
      // Add new account
      existingAccounts.push({
        ...oauthData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    this.set('oauthAccounts', existingAccounts);

    // Set as primary if it's the first OAuth account
    if (!this.get('primaryOAuthProvider')) {
      this.set('primaryOAuthProvider', oauthData.provider);
    }
  }

  /**
   * Removes OAuth account.
   * @param {string} provider - OAuth provider name.
   * @param _provider
   * @param {string} providerId - Provider user ID.
   * @example
   * // Model method usage
   * const result = await amexinguser.removeOAuthAccount({ provider: 'example', providerId: 'example' });
   * // Returns: model operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {*} - Operation result.
   */
  removeOAuthAccount(provider, providerId) {
    const existingAccounts = this.get('oauthAccounts') || [];
    const filteredAccounts = existingAccounts.filter(
      (account) => !(account.provider === provider && account.providerId === providerId)
    );

    this.set('oauthAccounts', filteredAccounts);

    // Update primary provider if needed
    if (this.get('primaryOAuthProvider') === provider) {
      this.set('primaryOAuthProvider', filteredAccounts.length > 0 ? filteredAccounts[0].provider : null);
    }
  }

  /**
   * Gets OAuth account by provider.
   * @param {string} provider - OAuth provider name.
   * @param _provider
   * @returns {object | null} - Operation result OAuth account data or null.
   * @example
   * // Model method usage
   * const result = await amexinguser.getOAuthAccount({ provider: 'example' });
   * // Returns: model operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  getOAuthAccount(provider) {
    const accounts = this.get('oauthAccounts') || [];
    return accounts.find((account) => account.provider === provider) || null;
  }

  /**
   * Checks if user has OAuth account for provider.
   * @param {string} provider - OAuth provider name.
   * @param _provider
   * @returns {boolean} - Boolean result True if user has account for provider.
   * @example
   * // Model method usage
   * const result = await amexinguser.hasOAuthAccount({ provider: 'example' });
   * // Returns: model operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  hasOAuthAccount(_provider) {
    return this.getOAuthAccount(_provider) !== null;
  }

  /**
   * Gets user's full name.
   * @returns {string} - Operation result Full name.
   * @example
   * // Model method usage
   * const result = await amexinguser.getFullName({ provider: 'example' });
   * // Returns: model operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  getFullName() {
    const firstName = this.get('firstName') || '';
    const lastName = this.get('lastName') || '';
    return `${firstName} ${lastName}`.trim();
  }

  /**
   * Gets user's display name (full name or username).
   * @returns {string} - Operation result Display name.
   * @example
   * // Model method usage
   * const result = await amexinguser.getDisplayName({ provider: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  getDisplayName() {
    const fullName = this.getFullName();
    return fullName || this.get('username');
  }

  /**
   * Get the client this user belongs to.
   * Uses AI agent compliant queries.
   * @returns {Promise<object | null>} - Client object or null.
   * @example
   * // Model method usage
   * const result = await amexinguser.getClient({ provider: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async getClient() {
    try {
      if (!this.get('clientId')) {
        return null;
      }

      const Client = require('./Client');
      const query = BaseModel.queryActive('Client');
      query.equalTo('objectId', this.get('clientId'));

      return await query.first({ useMasterKey: true });
    } catch (error) {
      logger.error('Error fetching user client', {
        userId: this.id,
        clientId: this.get('clientId'),
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get the department this user belongs to.
   * Uses AI agent compliant queries.
   * @returns {Promise<object | null>} - Department object or null.
   * @example
   * // Model method usage
   * const result = await amexinguser.getDepartment({ provider: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async getDepartment() {
    try {
      if (!this.get('departmentId')) {
        return null;
      }

      const Department = require('./Department');
      const query = BaseModel.queryActive('Department');
      query.equalTo('objectId', this.get('departmentId'));

      return await query.first({ useMasterKey: true });
    } catch (error) {
      logger.error('Error fetching user department', {
        userId: this.id,
        departmentId: this.get('departmentId'),
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Check if user belongs to a specific client.
   * @param {string} clientId - Client ID to check.
   * @returns {boolean} - Boolean result True if user belongs to client.
   * @example
   * // Model method usage
   * const result = await amexinguser.belongsToClient({ clientId: 'example' });
   * // Returns: model operation result
   * // const isValid = validator.validate(data);
   * // Returns: boolean or validation result object
   */
  belongsToClient(clientId) {
    return this.get('clientId') === clientId;
  }

  /**
   * Check if user belongs to a specific department.
   * @param {string} departmentId - Department ID to check.
   * @returns {boolean} - Boolean result True if user belongs to department.
   * @example
   * // Model method usage
   * const result = await amexinguser.belongsToDepartment({ departmentId: 'example' });
   * // Returns: model operation result
   * // const isValid = validator.validate(data);
   * // Returns: boolean or validation result object
   */
  belongsToDepartment(departmentId) {
    return this.get('departmentId') === departmentId;
  }

  /**
   * Assign user to a client.
   * @param {string} clientId - Client ID to assign to.
   * @param {string} modifiedBy - User ID making the change.
   * @returns {Promise<boolean>} - Success status.
   * @example
   * // Model method usage
   * const result = await amexinguser.assignToClient({ clientId: 'example', modifiedBy: 'example' });
   * // Returns: model operation result
   * // const isValid = validator.validate(data);
   * // Returns: boolean or validation result object
   */
  async assignToClient(clientId, modifiedBy) {
    try {
      this.set('clientId', clientId);
      this.set('modifiedBy', modifiedBy);
      this.set('updatedAt', new Date());

      await this.save(null, { useMasterKey: true });

      logger.info('User assigned to client', {
        userId: this.id,
        clientId,
        modifiedBy,
      });

      return true;
    } catch (error) {
      logger.error('Error assigning user to client', {
        userId: this.id,
        clientId,
        modifiedBy,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Assign user to a department.
   * @param {string} departmentId - Department ID to assign to.
   * @param {string} modifiedBy - User ID making the change.
   * @returns {Promise<boolean>} - Success status.
   * @example
   * // Model method usage
   * const result = await amexinguser.assignToDepartment({ departmentId: 'example', modifiedBy: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async assignToDepartment(departmentId, modifiedBy) {
    try {
      this.set('departmentId', departmentId);
      this.set('modifiedBy', modifiedBy);
      this.set('updatedAt', new Date());

      await this.save(null, { useMasterKey: true });

      logger.info('User assigned to department', {
        userId: this.id,
        departmentId,
        modifiedBy,
      });

      return true;
    } catch (error) {
      logger.error('Error assigning user to department', {
        userId: this.id,
        departmentId,
        modifiedBy,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Converts user to safe JSON (excludes sensitive data).
   * @returns {object} - Operation result Safe user data.
   * @example
   * // Model method usage
   * const result = await amexinguser.toSafeJSON({ departmentId: 'example', modifiedBy: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  toSafeJSON() {
    return {
      id: this.id,
      username: this.get('username'),
      email: this.get('email'),
      firstName: this.get('firstName'),
      lastName: this.get('lastName'),
      fullName: this.getFullName(),
      role: this.get('role'),
      active: this.get('active'),
      exists: this.get('exists'),
      lifecycleStatus: this.getLifecycleStatus(),
      emailVerified: this.get('emailVerified'),
      lastLoginAt: this.get('lastLoginAt'),
      primaryOAuthProvider: this.get('primaryOAuthProvider'),
      hasOAuth: (this.get('oauthAccounts') || []).length > 0,
      clientId: this.get('clientId'),
      departmentId: this.get('departmentId'),
      createdAt: this.get('createdAt'),
      updatedAt: this.get('updatedAt'),
      createdBy: this.get('createdBy'),
      modifiedBy: this.get('modifiedBy'),
    };
  }
}

// Register the subclass
Parse.Object.registerSubclass('AmexingUser', AmexingUser);

module.exports = AmexingUser;
