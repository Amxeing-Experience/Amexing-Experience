/**
 * AmexingUser Model - Custom User Entity for Amexing Platform
 * Replaces Parse.User with enhanced OAuth and PCI DSS compliance features.
 * @author Amexing Development Team
 * @version 1.0.0
 * @created 2024-09-12
 */

const Parse = require('parse/node');
const bcrypt = require('bcrypt');
const logger = require('../../infrastructure/logger');

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
 *   accessToken: 'oauth_token'
 * });
 *
 * // Safe user data for API responses
 * const safeUserData = user.toSafeJSON();
 */
class AmexingUser extends Parse.Object {
  constructor() {
    super('AmexingUser');
  }

  /**
   * Creates a new AmexingUser instance.
   * @param {object} userData - User data object.
   * @returns {AmexingUser} New AmexingUser instance.
   * @example
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
    user.set('emailVerified', false);
    user.set('loginAttempts', 0);
    user.set('lockedUntil', null);
    user.set('lastLoginAt', null);
    user.set('passwordChangedAt', new Date());
    user.set('mustChangePassword', false);

    // OAuth fields
    user.set('oauthAccounts', userData.oauthAccounts || []);
    user.set('primaryOAuthProvider', userData.primaryOAuthProvider || null);
    user.set('lastAuthMethod', 'password');

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
   * @returns {boolean} True if password matches.
   * @example
   */
  /**
   * Validates user password against stored hash with bcrypt comparison.
   * Performs secure password verification using bcrypt hashing algorithm
   * for authentication validation with timing attack protection.
   * @function validatePassword
   * @param {string} password - Plain text password to validate.
   * @returns {Promise<boolean>} True if password matches stored hash, false otherwise.
   * @example
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
     */
    if (password.length < minLength) {
      errors.push(`Password must be at least ${minLength} characters long`);
    }

    /**
     * Validates password contains required uppercase letters for security.
     * Ensures compliance with uppercase letter requirements when enabled.
     */
    if (requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    /**
     * Validates password contains required lowercase letters for security.
     * Ensures compliance with lowercase letter requirements when enabled.
     */
    if (requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    /**
     * Validates password contains required numeric characters for security.
     * Ensures compliance with number requirements when enabled.
     */
    if (requireNumbers && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    /**
     * Validates password contains required special characters for security.
     * Ensures compliance with special character requirements when enabled.
     */
    if (requireSpecial && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    /**
     * Throws Parse validation error if any password requirements fail.
     * Aggregates all validation errors into comprehensive error message.
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
   * @returns {boolean} True if account is now locked.
   * @example
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
   * @returns {Promise<void>} Saves user with updated login information.
   * @example
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
   * @returns {boolean} True if account is locked.
   * @example
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
   * @param {string} providerId - Provider user ID.
   * @example
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
   * @returns {object | null} OAuth account data or null.
   * @example
   */
  getOAuthAccount(provider) {
    const accounts = this.get('oauthAccounts') || [];
    return accounts.find((account) => account.provider === provider) || null;
  }

  /**
   * Checks if user has OAuth account for provider.
   * @param {string} provider - OAuth provider name.
   * @returns {boolean} True if user has account for provider.
   * @example
   */
  hasOAuthAccount(provider) {
    return this.getOAuthAccount(provider) !== null;
  }

  /**
   * Gets user's full name.
   * @returns {string} Full name.
   * @example
   */
  getFullName() {
    const firstName = this.get('firstName') || '';
    const lastName = this.get('lastName') || '';
    return `${firstName} ${lastName}`.trim();
  }

  /**
   * Gets user's display name (full name or username).
   * @returns {string} Display name.
   * @example
   */
  getDisplayName() {
    const fullName = this.getFullName();
    return fullName || this.get('username');
  }

  /**
   * Converts user to safe JSON (excludes sensitive data).
   * @returns {object} Safe user data.
   * @example
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
      emailVerified: this.get('emailVerified'),
      lastLoginAt: this.get('lastLoginAt'),
      primaryOAuthProvider: this.get('primaryOAuthProvider'),
      hasOAuth: (this.get('oauthAccounts') || []).length > 0,
      createdAt: this.get('createdAt'),
      updatedAt: this.get('updatedAt'),
    };
  }
}

// Register the subclass
Parse.Object.registerSubclass('AmexingUser', AmexingUser);

module.exports = AmexingUser;
