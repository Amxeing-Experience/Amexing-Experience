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

    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
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
  async validatePassword(password) {
    const hashedPassword = this.get('passwordHash');
    if (!hashedPassword) {
      return false;
    }
    return await bcrypt.compare(password, hashedPassword);
  }

  /**
   * Validates password strength according to PCI DSS requirements.
   * @param {string} password - Plain text password.
   * @throws {Parse.Error} If password doesn't meet requirements.
   * @example
   */
  validatePasswordStrength(password) {
    const minLength = parseInt(process.env.PASSWORD_MIN_LENGTH) || 12;
    const requireUppercase = process.env.PASSWORD_REQUIRE_UPPERCASE === 'true';
    const requireLowercase = process.env.PASSWORD_REQUIRE_LOWERCASE === 'true';
    const requireNumbers = process.env.PASSWORD_REQUIRE_NUMBERS === 'true';
    const requireSpecial = process.env.PASSWORD_REQUIRE_SPECIAL === 'true';

    const errors = [];

    if (password.length < minLength) {
      errors.push(`Password must be at least ${minLength} characters long`);
    }

    if (requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (requireNumbers && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (requireSpecial && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

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
    const maxAttempts = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5;
    const lockoutDuration = parseInt(process.env.ACCOUNT_LOCKOUT_DURATION_MINUTES) || 30;

    let attempts = this.get('loginAttempts') || 0;
    attempts++;
    this.set('loginAttempts', attempts);

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
   * Records a successful login.
   * @param authMethod
   * @example
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
