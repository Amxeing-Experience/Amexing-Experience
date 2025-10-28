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
 * @version 1.0.0
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
    // Validate required RBAC fields
    if (!userData.roleId && !userData.role) {
      throw new Error('Either role or roleId is required');
    }

    // Validate organization ID format
    if (userData.organizationId && !/^[a-z0-9_-]+$/i.test(userData.organizationId)) {
      throw new Error('Invalid organization ID format');
    }

    // Validate contextual data structure
    if (userData.contextualData && typeof userData.contextualData !== 'object') {
      throw new Error('Contextual data must be an object');
    }

    const user = new AmexingUser();

    // Required fields
    user.set('username', userData.username);
    user.set('email', userData.email);
    user.set('firstName', userData.firstName);
    user.set('lastName', userData.lastName);

    // Role system (new RBAC) - Handle both Pointer objects and string IDs
    if (userData.roleId) {
      // If roleId is a string, create a Pointer object
      if (typeof userData.roleId === 'string') {
        // Create a pointer-like object that Parse Server will understand
        const Role = require('./Role');
        const rolePointer = new Role();
        rolePointer.id = userData.roleId;
        user.set('roleId', rolePointer);
      } else {
        // Already a Pointer object
        user.set('roleId', userData.roleId);
      }
    }
    if (userData.role) {
      // Backward compatibility: set legacy role field when provided
      user.set('role', userData.role);
    }
    user.set('delegatedPermissions', userData.delegatedPermissions || []); // Additional permissions

    // Default values
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

    // Organizational relationships (enhanced)
    user.set('organizationId', userData.organizationId || null); // 'amexing', 'utq', 'nuba', etc.
    user.set('clientId', userData.clientId || null);
    user.set('departmentId', userData.departmentId || null);

    // Contextual data for permissions
    user.set('contextualData', userData.contextualData || {});

    // Audit fields - Handle both User objects and string IDs as Pointers
    if (userData.createdBy) {
      if (typeof userData.createdBy === 'string') {
        // Create a Pointer to AmexingUser
        const createdByPointer = new AmexingUser();
        createdByPointer.id = userData.createdBy;
        user.set('createdBy', createdByPointer);
      } else {
        // Already a User object
        user.set('createdBy', userData.createdBy);
      }
    }
    if (userData.modifiedBy) {
      if (typeof userData.modifiedBy === 'string') {
        // Create a Pointer to AmexingUser
        const modifiedByPointer = new AmexingUser();
        modifiedByPointer.id = userData.modifiedBy;
        user.set('modifiedBy', modifiedByPointer);
      } else {
        // Already a User object
        user.set('modifiedBy', userData.modifiedBy);
      }
    }

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

    // Save hash in both fields for compatibility
    // 'password' is used by authentication system
    // 'passwordHash' kept for backwards compatibility
    this.set('password', hashedPassword);
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
    // Try 'password' field first (used by authentication system)
    // Fall back to 'passwordHash' for backwards compatibility
    const hashedPassword = this.get('password') || this.get('passwordHash');
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
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `Password validation failed: ${errors.join(', ')}`);
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
   * Get the user's role object.
   * @returns {Promise<object|null>} - Role object or null.
   * @example
   * // Usage example documented above
   */
  async getRole() {
    try {
      // Check if we have a cached role from JWT middleware
      if (this._cachedRole) {
        return this._cachedRole;
      }

      const rolePointer = this.get('roleId');
      if (!rolePointer) {
        return null;
      }

      // Check if rolePointer is already a fetched object
      if (rolePointer.get && typeof rolePointer.get === 'function') {
        // Role object is already fetched
        return rolePointer;
      }

      // Handle both string IDs (backward compatibility) and Pointer objects
      let roleId;
      if (typeof rolePointer === 'string') {
        roleId = rolePointer;
      } else if (rolePointer.id) {
        roleId = rolePointer.id;
      } else {
        return null;
      }

      const Role = require('./Role');
      // IMPORTANT: Use new Parse.Query(Role) to get Role class instances
      // NOT BaseModel.queryActive() which returns generic Parse.Objects
      const query = new Parse.Query(Role);
      query.equalTo('active', true);
      query.equalTo('exists', true);

      const roleObject = await query.get(roleId, { useMasterKey: true });

      // If the object is not already a Role instance, wrap it
      if (roleObject && !(roleObject instanceof Role)) {
        // Create a new Role instance from the generic object
        const role = Parse.Object.fromJSON({
          className: 'Role',
          ...roleObject.toJSON(),
        });
        return role;
      }

      return roleObject;
    } catch (error) {
      logger.error('Error fetching user role', {
        userId: this.id,
        roleId: this.get('roleId'),
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get user's role name for backward compatibility.
   * @returns {Promise<string>} - Role name or 'guest'.
   * @example
   * // Usage example documented above
   */
  async getRoleName() {
    try {
      const role = await this.getRole();
      return role ? role.get('name') : 'guest';
    } catch (error) {
      logger.error('Error getting role name', {
        userId: this.id,
        error: error.message,
      });
      return 'guest';
    }
  }

  /**
   * Check if user has specific permission with context.
   * @param {string} permission - Permission to check (e.g., 'bookings.approve').
   * @param {object} context - Context for conditional permissions.
   * @returns {Promise<boolean>} - True if user has permission.
   * @example
   * // Usage example documented above
   */
  async hasPermission(permission, context = {}) {
    try {
      // Get role permissions
      const role = await this.getRole();
      if (!role) {
        return false;
      }

      // Check role permissions based on whether context is provided
      let rolePermission = false;
      if (Object.keys(context).length === 0) {
        // Simple permission check without context
        rolePermission = await role.hasPermission(permission);
      } else {
        // Contextual permission check
        // If context already has all needed data (like departmentId), use as-is
        // Otherwise, combine with user's contextual data
        let finalContext = context;
        const userContextualData = this.get('contextualData') || {};

        // Only merge user contextual data if not already present in request context
        if (Object.keys(userContextualData).length > 0) {
          finalContext = {
            ...userContextualData,
            ...context, // Request context takes precedence
          };
        }

        rolePermission = await role.hasContextualPermission(permission, finalContext);
      }

      if (rolePermission) {
        return true;
      }

      // Check delegated permissions
      const hasDelegatedPermission = await this.hasDelegatedPermission(permission, context);
      return hasDelegatedPermission;
    } catch (error) {
      logger.error('Error checking user permission', {
        userId: this.id,
        permission,
        context,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Check if user has delegated permission.
   * @param {string} permission - Permission to check.
   * @param {object} context - Context for validation.
   * @returns {Promise<boolean>} - True if user has delegated permission.
   * @example
   * // Usage example documented above
   */
  async hasDelegatedPermission(permission, context = {}) {
    try {
      const delegations = await this.getDelegatedPermissions();

      for (const delegation of delegations) {
        const result = delegation.hasPermission(permission, context);
        if (result) {
          // Record usage
          await delegation.recordUsage(permission, context);
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Error checking delegated permissions', {
        userId: this.id,
        permission,
        context,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Get all delegated permissions for this user.
   * @returns {Promise<Array>} - Array of delegated permissions.
   * @example
   * // Usage example documented above
   */
  async getDelegatedPermissions() {
    try {
      const DelegatedPermission = require('./DelegatedPermission');
      const query = BaseModel.queryActive('DelegatedPermission');
      query.equalTo('toUserId', this.id);
      query.equalTo('status', 'active');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting delegated permissions', {
        userId: this.id,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Delegate permissions to other users.
   * @param {Array<object>} delegationsData - Array of delegation data objects.
   * @returns {Promise<Array>} - Array of created delegations.
   * @example
   * // Usage example documented above
   */
  async delegatePermissions(delegationsData) {
    try {
      // Verify current user can delegate these permissions
      const role = await this.getRole();
      if (!role) {
        throw new Error('User role cannot delegate permissions');
      }

      const createdDelegations = [];
      const DelegatedPermission = require('./DelegatedPermission');

      for (const delegationData of delegationsData) {
        // Check if role can delegate this specific permission
        if (!role.canDelegatePermission(delegationData.permission)) {
          throw new Error(`Role cannot delegate permission: ${delegationData.permission}`);
        }

        // Verify permission can be delegated
        const hasPermission = await this.hasPermission(delegationData.permission, delegationData.context || {});
        if (!hasPermission) {
          throw new Error(`Cannot delegate permission ${delegationData.permission} - user doesn't have it`);
        }

        // Validate delegation context constraints (if specified)
        if (delegationData.context && delegationData.context.maxAmount) {
          // Check if user is trying to delegate with higher limits than they have
          const userContextualData = this.get('contextualData') || {};
          if (
            userContextualData.maxApprovalAmount
            && delegationData.context.maxAmount > userContextualData.maxApprovalAmount
          ) {
            throw new Error('Cannot delegate with higher limits than own permissions');
          }
        }

        // Create delegation with fromUserId added
        const delegation = DelegatedPermission.create({
          ...delegationData,
          fromUserId: this.id,
        });

        await delegation.save(null, { useMasterKey: true });
        createdDelegations.push(delegation);

        logger.info('Permission delegated', {
          fromUserId: this.id,
          toUserId: delegationData.toUserId,
          permission: delegationData.permission,
          delegationId: delegation.id,
        });
      }

      return createdDelegations;
    } catch (error) {
      logger.error('Error delegating permissions', {
        fromUserId: this.id,
        delegationsData,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get user's organization object.
   * @returns {Promise<object|null>} - Organization object or null.
   * @example
   * // Usage example documented above
   */
  async getOrganization() {
    try {
      const organizationId = this.get('organizationId');
      if (!organizationId) {
        return null;
      }

      // This would query an Organization model when implemented
      // For now, return a basic structure
      return {
        id: organizationId,
        name: organizationId === 'amexing' ? 'Amexing' : organizationId.toUpperCase(),
        type: organizationId === 'amexing' ? 'internal' : 'client',
      };
    } catch (error) {
      logger.error('Error fetching user organization', {
        userId: this.id,
        organizationId: this.get('organizationId'),
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Check if user can access a specific organization.
   * @param {string} organizationId - Organization ID to check access for.
   * @returns {boolean} - True if user can access the organization.
   * @example
   * // Usage example documented above
   */
  canAccessOrganization(organizationId) {
    const userOrgId = this.get('organizationId');

    // Amexing users can access any organization
    if (userOrgId === 'amexing') {
      return true;
    }

    // Client users can only access their own organization
    return userOrgId === organizationId;
  }

  /**
   * Check if user can manage another user.
   * @param {object} otherUser - User to check management permissions for.
   * @returns {Promise<boolean>} - True if user can manage the other user.
   * @example
   * // Usage example documented above
   */
  async canManage(otherUser) {
    try {
      const currentRole = await this.getRole();
      const otherRole = await otherUser.getRole();

      if (!currentRole || !otherRole) {
        return false;
      }

      // Check if current role can manage the other role
      const canManageRole = currentRole.canManage(otherRole);
      if (!canManageRole) {
        return false;
      }

      // Additional organization checks
      const userOrgId = this.get('organizationId');
      const otherUserOrgId = otherUser.get('organizationId');

      // Amexing users can manage users in any organization
      if (userOrgId === 'amexing') {
        return true;
      }

      // Users can only manage within their own organization
      return userOrgId === otherUserOrgId;
    } catch (error) {
      logger.error('Error checking user management permissions', {
        userId: this.id,
        otherUserId: otherUser.id,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Check if user is higher in hierarchy than another user.
   * @param {object} otherUser - User to compare against.
   * @returns {Promise<boolean>} - True if current user has higher role level.
   * @example
   * // Usage example documented above
   */
  async isHigherThan(otherUser) {
    try {
      const currentRole = await this.getRole();
      const otherRole = await otherUser.getRole();

      if (!currentRole || !otherRole) {
        return false;
      }

      return currentRole.isHigherThan(otherRole);
    } catch (error) {
      logger.error('Error comparing user hierarchy', {
        userId: this.id,
        otherUserId: otherUser.id,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Check if user can access another user's data based on scope.
   * @param {object} targetUser - User whose data is being accessed.
   * @param {string} scope - Access scope ('own', 'department', 'organization', 'system').
   * @returns {Promise<boolean>} - True if access is allowed.
   * @example
   * // Usage example documented above
   */
  async canAccessUserData(targetUser, scope = 'own') {
    try {
      // Same user can always access their own data
      if (this.id === targetUser.id) {
        return true;
      }

      // Check scope-based access
      switch (scope) {
        case 'own':
          return false;

        case 'department':
          return this.get('departmentId') === targetUser.get('departmentId');

        case 'organization':
          return this.get('organizationId') === targetUser.get('organizationId');

        case 'system': {
          const role = await this.getRole();
          return role && role.get('scope') === 'system';
        }

        default:
          return false;
      }
    } catch (error) {
      logger.error('Error checking user data access', {
        userId: this.id,
        targetUserId: targetUser.id,
        scope,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Converts user to safe JSON (excludes sensitive data).
   * @returns {Promise<object>} - Safe user data.
   * @example
   * // Usage example documented above
   */
  async toSafeJSON() {
    try {
      const role = await this.getRole();
      const organization = await this.getOrganization();

      return {
        id: this.id,
        username: this.get('username'),
        email: this.get('email'),
        firstName: this.get('firstName'),
        lastName: this.get('lastName'),
        fullName: this.getFullName(),
        role: role ? role.toSafeJSON() : null,
        roleName: role ? role.get('name') : 'guest', // Backward compatibility
        active: this.get('active'),
        exists: this.get('exists'),
        lifecycleStatus: this.getLifecycleStatus(),
        emailVerified: this.get('emailVerified'),
        lastLoginAt: this.get('lastLoginAt'),
        primaryOAuthProvider: this.get('primaryOAuthProvider'),
        hasOAuth: (this.get('oauthAccounts') || []).length > 0,
        organizationId: this.get('organizationId'),
        organization,
        clientId: this.get('clientId'),
        departmentId: this.get('departmentId'),
        createdAt: this.get('createdAt'),
        updatedAt: this.get('updatedAt'),
        createdBy: this.get('createdBy'),
        modifiedBy: this.get('modifiedBy'),
      };
    } catch (error) {
      logger.error('Error creating safe JSON for user', {
        userId: this.id,
        error: error.message,
      });

      // Return basic safe JSON without role information
      return {
        id: this.id,
        username: this.get('username'),
        email: this.get('email'),
        firstName: this.get('firstName'),
        lastName: this.get('lastName'),
        fullName: this.getFullName(),
        active: this.get('active'),
        exists: this.get('exists'),
        lifecycleStatus: this.getLifecycleStatus(),
        emailVerified: this.get('emailVerified'),
        lastLoginAt: this.get('lastLoginAt'),
        primaryOAuthProvider: this.get('primaryOAuthProvider'),
        hasOAuth: (this.get('oauthAccounts') || []).length > 0,
        organizationId: this.get('organizationId'),
        clientId: this.get('clientId'),
        departmentId: this.get('departmentId'),
        createdAt: this.get('createdAt'),
        updatedAt: this.get('updatedAt'),
        createdBy: this.get('createdBy'),
        modifiedBy: this.get('modifiedBy'),
      };
    }
  }
}

// COMMENTED OUT: registerSubclass causes issues with set() + save() for boolean fields
// The BaseModel inheritance interferes with Parse.Object field updates
// Using Parse.Object.extend('AmexingUser') directly works correctly
// Parse.Object.registerSubclass('AmexingUser', AmexingUser);

module.exports = AmexingUser;
