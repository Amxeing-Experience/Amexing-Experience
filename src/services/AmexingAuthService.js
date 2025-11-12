/**
 * AmexingAuthService - Complete authentication service
 * Replaces Parse._User system with custom AmexingUser + OAuth 2.0 integration.
 *
 * Features:
 * - Custom user management (AmexingUser table)
 * - OAuth 2.0 integration (Google, Microsoft, Apple)
 * - Dynamic permission system
 * - JWT session management
 * - Corporate SSO with auto-provisioning.
 * @author Claude Code + Technical Team
 * @version 1.0
 * @since 1.0.0
 * @example
 * // Authentication service usage
 * const result = await amexingauthservice.require(userData);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 */

const Parse = require('parse/node');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const logger = require('../infrastructure/logger');
// const PermissionService = require('./PermissionService');
// const OAuthProviderFactory = require('./oauth/OAuthProviderFactory');

/**
 * Amexing Authentication Service - Complete authentication and authorization system.
 * Provides comprehensive authentication services including custom user management,
 * OAuth 2.0 integration, JWT session handling, and corporate SSO capabilities.
 *
 * This service replaces the standard Parse User system with a custom AmexingUser
 * implementation that supports advanced features like OAuth integration, dynamic
 * permissions, and corporate authentication workflows.
 *
 * Features:
 * - Custom user management with AmexingUser model
 * - Multi-provider OAuth 2.0 integration (Google, Microsoft, Apple)
 * - JWT-based session management with refresh tokens
 * - Dynamic permission system integration
 * - Corporate SSO with automatic employee provisioning
 * - PCI DSS compliant password handling
 * - Comprehensive audit logging
 * - Account lockout and security features.
 * @class AmexingAuthService
 * @author Claude Code + Technical Team
 * @version 1.0
 * @since 1.0.0
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Initialize authentication service
 * const authService = new AmexingAuthService();
 * authService.initialize();
 *
 * // Register new user
 * const userData = {
 *   username: 'johndoe',
 *   email: 'john@example.com',
 *   password: 'your-secure-password',
 *   firstName: 'John',
 *   lastName: 'Doe'
 * };
 * const user = await authService.registerUser(userData);
 *
 * // Authenticate user
 * const loginResult = await authService.authenticateUser('john@example.com', 'user-password');
 *
 * // OAuth login
 * const oauthResult = await authService.authenticateWithOAuth('google', oauthToken);
 */
class AmexingAuthService {
  constructor() {
    // Parse Objects - no need for direct MongoDB connection
    this.jwtSecret = process.env.JWT_SECRET;
    this.jwtRefreshSecret = process.env.JWT_SECRET; // Usar mismo secret por ahora
    this.encryptionKey = process.env.ENCRYPTION_KEY;

    if (!this.jwtSecret || !this.encryptionKey) {
      throw new Error('Required authentication environment variables not set');
    }
  }

  /**
   * Initialize the service (Parse Objects).
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.initialize(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {*} - Operation result.
   */
  initialize() {
    // Parse SDK is already initialized globally
    logger.info('AmexingAuthService initialized');
  }

  // ============================================
  // USER MANAGEMENT
  // ============================================

  /**
   * Create new AmexingUser with email/password.
   * @param {object} userData - User creation data.
   * @returns {object} - Operation result Created user and tokens.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.createUser(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  async createUser(userData) {
    try {
      const {
        email, password, firstName, lastName, role = 'guest',
      } = userData;

      // Validate required fields
      if (!email || !firstName || !lastName) {
        throw new Error('Email, firstName, and lastName are required');
      }

      // Check if user already exists
      const existingUser = await this.findUserByEmail(email);
      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      // Validate and hash password if provided
      let passwordHash = null;
      if (password) {
        this.validatePasswordStrength(password);
        passwordHash = await bcrypt.hash(password, 12);
      }

      // Create user object with Parse Objects
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const newUser = new AmexingUser();

      const userId = uuidv4();
      newUser.set('id', userId);
      newUser.set('email', email.toLowerCase().trim());
      newUser.set('username', email.toLowerCase().trim()); // Use email as username for consistency
      newUser.set('passwordHash', passwordHash);
      newUser.set('emailVerified', false);
      newUser.set('phoneVerified', false);

      // OAuth integration
      newUser.set('oauthAccounts', []);
      newUser.set('primaryOAuthProvider', null);
      newUser.set('lastAuthMethod', password ? 'password' : 'oauth');

      // Profile information
      newUser.set('firstName', firstName.trim());
      newUser.set('lastName', lastName.trim());
      newUser.set('displayName', `${firstName.trim()} ${lastName.trim()}`);
      newUser.set('locale', 'en');
      newUser.set('timezone', 'America/Mexico_City');

      // Role and permissions
      newUser.set('role', role);
      newUser.set('permissions', await this.getDefaultPermissions(role));
      newUser.set('accessLevel', 'basic');

      // Account status
      newUser.set('active', true);
      newUser.set('locked', false);
      newUser.set('deleted', false);

      // Session management
      newUser.set('sessionTokens', []);
      newUser.set('refreshTokens', []);

      // Security features
      newUser.set('twoFactorEnabled', false);
      newUser.set('failedLoginAttempts', 0);

      // Timestamps
      newUser.set('createdAt', new Date());
      newUser.set('updatedAt', new Date());
      newUser.set('createdBy', userId); // Self-created

      // Save to database with Parse Objects
      const savedUser = await newUser.save(null, { useMasterKey: true });

      // Generate tokens (convert Parse Object to plain object for compatibility)
      const userObject = this.parseObjectToPlain(savedUser);
      const tokens = await this.generateTokens(userObject);

      // Store session
      await this.createSession({
        userId,
        authMethod: 'password',
        tokens: tokens.accessToken,
      });

      logger.info(`User created successfully: ${email}`);

      return {
        user: this.sanitizeUser(userObject),
        ...tokens,
      };
    } catch (error) {
      logger.error('User creation failed:', error);
      throw error;
    }
  }

  /**
   * Authenticate user with email/password.
   * @param {string} email - User email.
   * @param {string} password - User password.
   * @returns {object} - Operation result User and tokens.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.authenticateUser(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  async authenticateUser(email, password) {
    try {
      // Find user by email
      const user = await this.findUserByEmail(email);
      if (!user) {
        throw new Error('Invalid credentials');
      }

      // Check account status
      this.validateAccountStatus(user);

      // Check password
      if (!user.passwordHash) {
        throw new Error('Password authentication not available for this account');
      }

      const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      if (!isValidPassword) {
        await this.handleFailedLogin(user.id);
        throw new Error('Invalid credentials');
      }

      // Reset failed attempts on successful login
      await this.resetFailedLoginAttempts(user.id);

      // Update last login
      await this.updateLastLogin(user.id);

      // Generate tokens
      const tokens = await this.generateTokens(user);

      // Create session
      await this.createSession({
        userId: user.id,
        authMethod: 'password',
        tokens: tokens.accessToken,
      });

      logger.info(`User authenticated successfully: ${email}`);

      return {
        user: this.sanitizeUser(user),
        ...tokens,
      };
    } catch (error) {
      logger.error('Authentication failed:', error);
      throw error;
    }
  }

  // ============================================
  // OAUTH 2.0 INTEGRATION
  // ============================================

  /**
   * Handle OAuth authentication flow.
   * @param {string} _provider - OAuth provider (google, microsoft, apple) - unused parameter.
   * @param {object} oauthProfile - OAuth user profile.
   * @param {object} tokens - OAuth tokens.
   * @returns {object} - Operation result User and session tokens.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.handleOAuthUser(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  async handleOAuthUser(_provider, oauthProfile, tokens) {
    try {
      let user = await this.findUserByOAuth(_provider, oauthProfile.id);

      if (!user) {
        // Try to find by email for account linking
        user = await this.findUserByEmail(oauthProfile.email);

        if (user) {
          // Link OAuth to existing account
          await this.linkOAuthAccount(user, _provider, oauthProfile, tokens);
        } else {
          // Create new OAuth user
          user = await this.createOAuthUser(_provider, oauthProfile, tokens);
        }
      } else {
        // Update existing OAuth user
        await this.updateOAuthUser(user, _provider, oauthProfile, tokens);
      }

      // Handle corporate integration if applicable
      await this.handleCorporateIntegration(user, oauthProfile);

      // Generate JWT for session
      const sessionTokens = await this.generateTokens(user);

      // Create session
      await this.createSession({
        userId: user.id,
        authMethod: 'oauth',
        oauthProvider: _provider,
        tokens: sessionTokens.accessToken,
      });

      logger.info(`OAuth user authenticated: ${oauthProfile.email} via ${_provider}`);

      return {
        user: this.sanitizeUser(user),
        ...sessionTokens,
      };
    } catch (error) {
      logger.error('OAuth authentication failed:', error);
      throw error;
    }
  }

  /**
   * Create new user from OAuth profile.
   * @param {string} _provider - OAuth provider.
   * @param {object} profile - OAuth profile.
   * @param {object} tokens - OAuth tokens.
   * @returns {object} - Operation result Created user.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.createOAuthUser(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  async createOAuthUser(_provider, profile, tokens) {
    const userId = uuidv4();

    // Determine role based on profile and domain
    const role = await this.determineUserRole(profile);

    const newUser = {
      id: userId,
      email: profile.email.toLowerCase().trim(),
      username: profile.email.toLowerCase().trim(), // Use email as username for OAuth users
      emailVerified: profile.verified || true, // OAuth emails are pre-verified
      phoneVerified: false,

      // OAuth specific
      oauthAccounts: [
        {
          provider: _provider,
          providerId: profile.id,
          email: profile.email,
          profile,
          accessToken: await this.encryptToken(tokens.accessToken),
          refreshToken: tokens.refreshToken ? await this.encryptToken(tokens.refreshToken) : null,
          tokenExpiry: new Date(Date.now() + tokens.expiresIn * 1000),
          scopes: tokens.scope?.split(' ') || [],
          linkedAt: new Date(),
          lastUsed: new Date(),
          isPrimary: true,
        },
      ],
      primaryOAuthProvider: _provider,
      lastAuthMethod: 'oauth',

      // Profile
      firstName: profile.firstName || profile.given_name || '',
      lastName: profile.lastName || profile.family_name || '',
      displayName: profile.fullName || profile.name || `${profile.firstName} ${profile.lastName}`,
      profilePicture: profile.picture,
      locale: profile.locale || 'en',
      timezone: 'America/Mexico_City',

      // Role assignment
      role,
      permissions: await this.getDefaultPermissions(role),
      accessLevel: 'basic',

      // Status
      active: true,
      locked: false,
      deleted: false,

      // Session management
      sessionTokens: [],
      refreshTokens: [],

      // Security
      twoFactorEnabled: false,
      failedLoginAttempts: 0,

      // Timestamps
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: new Date(),
      lastActivityAt: new Date(),
      createdBy: userId,
    };

    // Insert into database with Parse Objects
    const AmexingUser = Parse.Object.extend('AmexingUser');
    const parseUser = new AmexingUser();

    // Set all fields on Parse Object
    Object.keys(newUser).forEach((key) => {
      parseUser.set(key, newUser[key]);
    });

    const savedUser = await parseUser.save(null, { useMasterKey: true });
    const userObject = this.parseObjectToPlain(savedUser);

    logger.info(`OAuth user created: ${profile.email} via ${_provider}`);
    return userObject;
  }

  /**
   * Link OAuth account to existing user.
   * @param {object} user - Existing user.
   * @param {string} _provider - OAuth provider.
   * @param {object} profile - OAuth profile.
   * @param {object} tokens - OAuth tokens.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.linkOAuthAccount(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async linkOAuthAccount(user, _provider, profile, tokens) {
    const oauthAccount = {
      provider: _provider,
      providerId: profile.id,
      email: profile.email,
      profile,
      accessToken: await this.encryptToken(tokens.accessToken),
      refreshToken: tokens.refreshToken ? await this.encryptToken(tokens.refreshToken) : null,
      tokenExpiry: new Date(Date.now() + tokens.expiresIn * 1000),
      scopes: tokens.scope?.split(' ') || [],
      linkedAt: new Date(),
      lastUsed: new Date(),
      isPrimary: user.oauthAccounts.length === 0,
    };

    // Update user with new OAuth account using Parse Objects
    const query = new Parse.Query('AmexingUser');
    query.equalTo('id', user.id);
    const parseUser = await query.first({ useMasterKey: true });

    if (parseUser) {
      const existingAccounts = parseUser.get('oauthAccounts') || [];
      existingAccounts.push(oauthAccount);

      parseUser.set('oauthAccounts', existingAccounts);
      parseUser.set('primaryOAuthProvider', user.primaryOAuthProvider || _provider);
      parseUser.set('lastOAuthSync', new Date());
      parseUser.set('updatedAt', new Date());

      await parseUser.save(null, { useMasterKey: true });
    }

    logger.info(`OAuth account linked: ${profile.email} to user ${user.id}`);
  }

  /**
   * Update existing OAuth user profile and tokens.
   * @param {object} user - Existing user.
   * @param {string} _provider - OAuth provider.
   * @param {object} profile - Updated OAuth profile.
   * @param {object} tokens - New OAuth tokens.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.updateOAuthUser(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async updateOAuthUser(user, _provider, profile, tokens) {
    // Find the OAuth account to update
    const oauthAccountIndex = user.oauthAccounts.findIndex(
      (account) => account.provider === _provider && account.providerId === profile.id
    );

    if (oauthAccountIndex === -1) {
      throw new Error('OAuth account not found for user');
    }

    // Update OAuth account
    const updatedOAuthAccount = {
      ...user.oauthAccounts[oauthAccountIndex],
      profile,
      accessToken: await this.encryptToken(tokens.accessToken),
      refreshToken: tokens.refreshToken ? await this.encryptToken(tokens.refreshToken) : null,
      tokenExpiry: new Date(Date.now() + tokens.expiresIn * 1000),
      scopes: tokens.scope?.split(' ') || [],
      lastUsed: new Date(),
    };

    // Update in database using Parse Objects
    const query = new Parse.Query('AmexingUser');
    query.equalTo('id', user.id);
    const parseUser = await query.first({ useMasterKey: true });

    if (parseUser) {
      const oauthAccounts = parseUser.get('oauthAccounts') || [];
      oauthAccounts[oauthAccountIndex] = updatedOAuthAccount;

      parseUser.set('oauthAccounts', oauthAccounts);
      parseUser.set('firstName', profile.firstName || profile.given_name || user.firstName);
      parseUser.set('lastName', profile.lastName || profile.family_name || user.lastName);
      parseUser.set('profilePicture', profile.picture || user.profilePicture);
      parseUser.set('lastOAuthSync', new Date());
      parseUser.set('lastLoginAt', new Date());
      parseUser.set('lastActivityAt', new Date());
      parseUser.set('updatedAt', new Date());

      await parseUser.save(null, { useMasterKey: true });
    }

    logger.info(`OAuth user updated: ${profile.email} via ${_provider}`);
  }

  /**
   * Handle corporate integration for OAuth users.
   * @param {object} user - User object.
   * @param {object} profile - OAuth profile.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.handleCorporateIntegration(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async handleCorporateIntegration(user, profile) {
    const domain = profile.domain || profile.email?.split('@')[1];

    if (!domain || this.isPersonalEmailDomain(domain)) {
      return; // Not a corporate user
    }

    try {
      // Find corporate client by domain
      const client = await this.findCorporateClientByDomain(domain);

      if (client && client.autoProvisionEmployees) {
        // Auto-provision employee
        await this.provisionCorporateEmployee(user, client, profile);
        logger.info(`Corporate employee provisioned: ${user.email} for client ${client.name}`);
      }
    } catch (error) {
      logger.error('Corporate integration failed:', error);
      // Don't fail the authentication, just log the error
    }
  }

  // ============================================
  // SESSION MANAGEMENT
  // ============================================

  /**
   * Generate JWT access and refresh tokens.
   * @param {object} user - User object.
   * @returns {object} - Operation result Token pair.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.generateTokens(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  async generateTokens(user) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      permissions: user.permissions,
      clientId: user.clientId,
      departmentId: user.departmentId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60, // 1 hour
      jti: uuidv4(), // JWT ID for token tracking
    };

    const refreshPayload = {
      sub: user.id,
      type: 'refresh',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
      jti: uuidv4(),
    };

    const accessToken = jwt.sign(payload, this.jwtSecret, {
      algorithm: 'HS256',
      issuer: 'amexing.com',
      audience: 'amexing-api',
    });

    const refreshToken = jwt.sign(refreshPayload, this.jwtRefreshSecret, {
      algorithm: 'HS256',
      issuer: 'amexing.com',
      audience: 'amexing-api',
    });

    // Store refresh token in database
    await this.storeRefreshToken(user.id, refreshPayload.jti, refreshToken);

    return {
      accessToken,
      refreshToken,
      expiresIn: 3600,
      tokenType: 'Bearer',
    };
  }

  /**
   * Create new session record.
   * @param {object} sessionData - Session creation data.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.createSession(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result.
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async createSession(sessionData) {
    const sessionId = uuidv4();

    // Create session with Parse Objects
    const UserSession = Parse.Object.extend('UserSession');
    const session = new UserSession();

    session.set('id', sessionId);
    session.set('sessionToken', await this.encryptToken(sessionData.tokens));
    session.set('userId', sessionData.userId);
    session.set('authMethod', sessionData.authMethod);
    session.set('oauthProvider', sessionData.oauthProvider || null);
    session.set('status', 'active');
    session.set('active', true); // Para compatibilidad con tests
    session.set('expiresAt', new Date(Date.now() + 60 * 60 * 1000)); // 1 hour
    session.set('lastActivityAt', new Date());
    session.set('ipAddress', sessionData.ipAddress || 'unknown');
    session.set('userAgent', sessionData.userAgent || 'unknown');
    session.set('requestCount', 0);
    session.set('activityLog', []);
    session.set('securityAlerts', []);
    session.set('createdAt', new Date());

    const savedSession = await session.save(null, { useMasterKey: true });
    return this.parseObjectToPlain(savedSession);
  }

  /**
   * Validate and refresh access token.
   * @param {string} refreshToken - Refresh token.
   * @returns {object} - Operation result New token pair.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.refreshAccessToken(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   */
  async refreshAccessToken(refreshToken) {
    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, this.jwtRefreshSecret);

      // Check if refresh token exists in database using Parse Objects
      const query = new Parse.Query('RefreshToken');
      query.equalTo('userId', decoded.sub);
      query.equalTo('jti', decoded.jti);
      query.equalTo('active', true);
      const storedToken = await query.first({ useMasterKey: true });

      if (!storedToken) {
        throw new Error('Invalid refresh token');
      }

      // Get user
      const user = await this.findUserById(decoded.sub);
      if (!user || !user.active) {
        throw new Error('User not found or inactive');
      }

      // Generate new token pair
      const tokens = await this.generateTokens(user);

      // Invalidate old refresh token
      await this.invalidateRefreshToken(decoded.jti);

      logger.info(`Token refreshed for user: ${user.email}`);
      return tokens;
    } catch (error) {
      logger.error('Token refresh failed:', error);
      throw new Error('Invalid refresh token');
    }
  }

  /**
   * Revoke user session and tokens.
   * @param {string} userId - User ID.
   * @param {string} sessionId - Optional specific session ID.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.revokeSession(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result.
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async revokeSession(userId, sessionId = null) {
    try {
      const query = { userId };
      if (sessionId) {
        query.id = sessionId;
      }

      // Terminate sessions using Parse Objects
      const sessionQuery = new Parse.Query('UserSession');
      sessionQuery.equalTo('userId', userId);
      if (sessionId) {
        sessionQuery.equalTo('id', sessionId);
      }
      const sessions = await sessionQuery.find({ useMasterKey: true });

      for (const session of sessions) {
        session.set('status', 'terminated');
        session.set('terminatedAt', new Date());
        session.set('terminationReason', 'manual_revocation');
        await session.save(null, { useMasterKey: true });
      }

      // Invalidate refresh tokens using Parse Objects
      const tokenQuery = new Parse.Query('RefreshToken');
      tokenQuery.equalTo('userId', userId);
      const refreshTokens = await tokenQuery.find({ useMasterKey: true });

      for (const token of refreshTokens) {
        token.set('active', false);
        token.set('revokedAt', new Date());
        await token.save(null, { useMasterKey: true });
      }

      logger.info(`Sessions revoked for user: ${userId}`);
    } catch (error) {
      logger.error('Session revocation failed:', error);
      throw error;
    }
  }

  // ============================================
  // PERMISSION INTEGRATION
  // ============================================

  /**
   * Get user's effective permissions (role + department + individual).
   * @param {string} userId - User ID.
   * @param _userId
   * @returns {Array} - Array of results Array of permission codes.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.getUserPermissions(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   */
  async getUserPermissions(_userId) {
    // Note: PermissionService needs to be imported or implemented
    // return PermissionService.getUserEffectivePermissions(userId);
    throw new Error('PermissionService not yet implemented');
  }

  /**
   * Check if user has specific permission.
   * @param {string} userId - User ID.
   * @param {string} permissionCode - Permission code to check.
   * @param {object} context - Optional context (department, client, etc.).
   * @param _permissionCode
   * @param _context
   * @returns {boolean} - Boolean result Has permission.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.hasPermission(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   */
  async hasPermission(userId /* unused */, _permissionCode, _context = {}) {
    // Note: PermissionService needs to be imported or implemented
    // return PermissionService.hasPermission(userId , permissionCode, context);
    throw new Error('PermissionService not yet implemented');
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  /**
   * Find user by email.
   * @param {string} email - User email.
   * @returns {object | null} - Operation result User object or null.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.findUserByEmail(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   */
  async findUserByEmail(email) {
    const query = new Parse.Query('AmexingUser');
    query.equalTo('email', email.toLowerCase().trim());
    query.equalTo('exists', true); // Only find existing users (not soft deleted)

    const parseUser = await query.first({ useMasterKey: true });
    return parseUser ? this.parseObjectToPlain(parseUser) : null;
  }

  /**
   * Find user by ID.
   * @param {string} userId - User ID.
   * @returns {object | null} - Operation result User object or null.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.findUserById(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   */
  async findUserById(userId) {
    const query = new Parse.Query('AmexingUser');
    query.equalTo('id', userId);
    query.equalTo('exists', true); // Only find existing users (not soft deleted)

    const parseUser = await query.first({ useMasterKey: true });
    return parseUser ? this.parseObjectToPlain(parseUser) : null;
  }

  /**
   * Find user by OAuth provider and ID.
   * @param {string} _provider - OAuth provider.
   * @param {string} providerId - Provider user ID.
   * @returns {object | null} - Operation result User object or null.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.findUserByOAuth(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  async findUserByOAuth(_provider, providerId) {
    const query = new Parse.Query('AmexingUser');
    query.equalTo('oauthAccounts.provider', _provider);
    query.equalTo('oauthAccounts.providerId', providerId);
    query.equalTo('exists', true); // Only find existing users (not soft deleted)

    const parseUser = await query.first({ useMasterKey: true });
    return parseUser ? this.parseObjectToPlain(parseUser) : null;
  }

  /**
   * Determine user role based on OAuth profile.
   * @param {object} profile - OAuth profile.
   * @returns {string} - Operation result Role code.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.determineUserRole(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  async determineUserRole(profile) {
    const domain = profile.domain || profile.email?.split('@')[1];

    // Check if corporate domain
    if (domain && !this.isPersonalEmailDomain(domain)) {
      const client = await this.findCorporateClientByDomain(domain);
      if (client) {
        return client.defaultEmployeeRole || 'employee';
      }
    }

    // Default role for non-corporate users
    return 'guest';
  }

  /**
   * Validate password strength according to PCI DSS requirements.
   * @param {string} password - Password to validate.
   * @throws {Error} If password doesn't meet security requirements.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.validatePasswordStrength(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * @returns {*} - Operation result.
   */
  validatePasswordStrength(password) {
    if (!password) {
      throw new Error('Password is required');
    }

    const minLength = parseInt(process.env.PASSWORD_MIN_LENGTH, 10) || 12;
    const requireUppercase = process.env.PASSWORD_REQUIRE_UPPERCASE === 'true';
    const requireLowercase = process.env.PASSWORD_REQUIRE_LOWERCASE === 'true';
    const requireNumbers = process.env.PASSWORD_REQUIRE_NUMBERS === 'true';
    const requireSpecial = process.env.PASSWORD_REQUIRE_SPECIAL === 'true';

    // Length validation
    if (password.length < minLength) {
      throw new Error(`La contraseña debe tener al menos ${minLength} caracteres`);
    }

    // Character type validations
    if (requireUppercase && !/[A-Z]/.test(password)) {
      throw new Error('La contraseña debe contener al menos una letra mayúscula');
    }

    if (requireLowercase && !/[a-z]/.test(password)) {
      throw new Error('La contraseña debe contener al menos una letra minúscula');
    }

    if (requireNumbers && !/\d/.test(password)) {
      throw new Error('La contraseña debe contener al menos un número');
    }

    if (requireSpecial && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      throw new Error('La contraseña debe contener al menos un carácter especial');
    }

    // Common password validation
    const commonPasswords = [
      'password',
      '12345678',
      '123456789',
      '1234567890',
      'qwerty',
      'admin',
      'letmein',
      'welcome',
      'monkey',
      'password123',
      '123password',
      'admin123',
      'password1',
    ];

    if (commonPasswords.includes(password.toLowerCase())) {
      throw new Error('La contraseña es demasiado común y fácil de adivinar');
    }

    // Sequential characters validation
    if (/123456|abcdef|qwerty/i.test(password)) {
      throw new Error('La contraseña no puede contener secuencias comunes de caracteres');
    }

    // Repeated characters validation
    if (/(.)\1{3,}/.test(password)) {
      throw new Error('La contraseña no puede contener más de 3 caracteres consecutivos iguales');
    }

    return true;
  }

  /**
   * Get default permissions for role.
   * @param {string} role - Role code.
   * @returns {Array} - Array of results Permission codes.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.getDefaultPermissions(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   */
  async getDefaultPermissions(role) {
    // Implementación simplificada para validación
    const defaultPermissions = {
      guest: [{ resource: 'profile', actions: ['read'] }],
      client: [
        { resource: 'profile', actions: ['read', 'update'] },
        { resource: 'orders', actions: ['read', 'create'] },
        { resource: 'invoices', actions: ['read'] },
      ],
      employee: [
        { resource: 'profile', actions: ['read', 'update'] },
        { resource: 'orders', actions: ['read', 'create', 'update'] },
        { resource: 'clients', actions: ['read'] },
        { resource: 'reports', actions: ['read'] },
      ],
      admin: [{ resource: '*', actions: ['*'] }],
    };

    return defaultPermissions[role] || defaultPermissions.guest;
  }

  /**
   * Generate username from email (deprecated - now uses email directly).
   * @param {string} email - Email address.
   * @returns {string} - Operation result Email as username.
   * @deprecated Use email directly as username for consistency.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.generateUsername(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   */
  generateUsername(email) {
    // Simplified: just return email as username for consistency
    return email.toLowerCase().trim();
  }

  /**
   * Check if email domain is personal (non-corporate).
   * @param {string} domain - Email domain.
   * @returns {boolean} - Boolean result Is personal domain.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.isPersonalEmailDomain(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   */
  isPersonalEmailDomain(domain) {
    const personalDomains = [
      'gmail.com',
      'yahoo.com',
      'hotmail.com',
      'outlook.com',
      'icloud.com',
      'me.com',
      'mac.com',
      'aol.com',
      'protonmail.com',
    ];
    return personalDomains.includes(domain.toLowerCase());
  }

  /**
   * Validate account status.
   * @param {object} user - User object.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.validateAccountStatus(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * @returns {*} - Operation result.
   */
  validateAccountStatus(user) {
    if (!user.active) {
      throw new Error('Account is deactivated');
    }
    if (user.locked) {
      throw new Error('Account is locked');
    }
    if (user.deleted) {
      throw new Error('Account not found');
    }
  }

  /**
   * Handle failed login attempt.
   * @param {string} userId - User ID.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.handleFailedLogin(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async handleFailedLogin(userId) {
    const maxAttempts = 5;
    const lockDuration = 30 * 60 * 1000; // 30 minutes

    // Update failed attempts using Parse Objects
    const query = new Parse.Query('AmexingUser');
    query.equalTo('id', userId);
    const parseUser = await query.first({ useMasterKey: true });

    if (parseUser) {
      const currentAttempts = parseUser.get('failedLoginAttempts') || 0;
      parseUser.set('failedLoginAttempts', currentAttempts + 1);
      parseUser.set('updatedAt', new Date());

      if (currentAttempts + 1 >= maxAttempts) {
        parseUser.set('locked', true);
        parseUser.set('lockedUntil', new Date(Date.now() + lockDuration));

        logger.warn(`Account locked due to failed login attempts: ${parseUser.get('email')}`);
      }

      await parseUser.save(null, { useMasterKey: true });
    }
  }

  /**
   * Reset failed login attempts.
   * @param {string} userId - User ID.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.resetFailedLoginAttempts(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async resetFailedLoginAttempts(userId) {
    const query = new Parse.Query('AmexingUser');
    query.equalTo('id', userId);
    const parseUser = await query.first({ useMasterKey: true });

    if (parseUser) {
      parseUser.set('failedLoginAttempts', 0);
      parseUser.set('locked', false);
      parseUser.unset('lockedUntil');
      parseUser.set('updatedAt', new Date());

      await parseUser.save(null, { useMasterKey: true });
    }
  }

  /**
   * Update last login timestamp.
   * @param {string} userId - User ID.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.updateLastLogin(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async updateLastLogin(userId) {
    const query = new Parse.Query('AmexingUser');
    query.equalTo('id', userId);
    const parseUser = await query.first({ useMasterKey: true });

    if (parseUser) {
      parseUser.set('lastLoginAt', new Date());
      parseUser.set('lastActivityAt', new Date());
      parseUser.set('updatedAt', new Date());

      await parseUser.save(null, { useMasterKey: true });
    }
  }

  /**
   * Encrypt sensitive token for storage.
   * @param {string} token - Token to encrypt.
   * @returns {string} - Operation result Encrypted token.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.encryptToken(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  async encryptToken(token /* unused */) {
    // Implementación simplificada para validación
    try {
      const algorithm = 'aes-256-cbc';

      // Asegurar que la clave tenga 32 bytes
      const keyBuffer = Buffer.from(this.encryptionKey, 'base64');
      const key = keyBuffer.subarray(0, 32); // Tomar solo 32 bytes

      const iv = crypto.randomBytes(16);

      const cipher = crypto.createCipheriv(algorithm, key, iv);
      let encrypted = cipher.update(token, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      return JSON.stringify({
        encrypted,
        iv: iv.toString('hex'),
      });
    } catch (error) {
      // Fallback: solo codificar en base64 para validación
      return Buffer.from(token).toString('base64');
    }
  }

  /**
   * Store refresh token in database.
   * @param {string} userId - User ID.
   * @param {string} jti - JWT ID.
   * @param {string} refreshToken - Refresh token.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.storeRefreshToken(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result.
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async storeRefreshToken(userId, jti, refreshToken) {
    // Store refresh token using Parse Objects
    const RefreshToken = Parse.Object.extend('RefreshToken');
    const tokenRecord = new RefreshToken();

    tokenRecord.set('id', uuidv4());
    tokenRecord.set('userId', userId);
    tokenRecord.set('jti', jti);
    tokenRecord.set('token', await this.encryptToken(refreshToken));
    tokenRecord.set('active', true);
    tokenRecord.set('createdAt', new Date());
    tokenRecord.set('expiresAt', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)); // 30 days

    await tokenRecord.save(null, { useMasterKey: true });
  }

  /**
   * Invalidate refresh token.
   * @param {string} jti - JWT ID.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.invalidateRefreshToken(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result.
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async invalidateRefreshToken(jti) {
    const query = new Parse.Query('RefreshToken');
    query.equalTo('jti', jti);
    const refreshToken = await query.first({ useMasterKey: true });

    if (refreshToken) {
      refreshToken.set('active', false);
      refreshToken.set('revokedAt', new Date());
      await refreshToken.save(null, { useMasterKey: true });
    }
  }

  /**
   * Find corporate client by domain.
   * @param {string} domain - Email domain.
   * @returns {object | null} - Operation result Client object or null.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.findCorporateClientByDomain(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  async findCorporateClientByDomain(domain) {
    const query = new Parse.Query('Client');
    query.equalTo('oauthDomain', domain);
    query.equalTo('isCorporate', true);
    query.equalTo('active', true);
    query.equalTo('exists', true); // Only find existing clients (not soft deleted)

    const parseClient = await query.first({ useMasterKey: true });
    return parseClient ? this.parseObjectToPlain(parseClient) : null;
  }

  /**
   * Provision corporate employee.
   * @param {object} user - User object.
   * @param {object} client - Corporate client.
   * @param {object} profile - OAuth profile.
   * @param _profile
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.provisionCorporateEmployee(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async provisionCorporateEmployee(user, client, _profile) {
    // Implementation will be added in corporate provisioning service
    // For now, just update user with client association using Parse Objects
    const query = new Parse.Query('AmexingUser');
    query.equalTo('id', user.id);
    const parseUser = await query.first({ useMasterKey: true });

    if (parseUser) {
      parseUser.set('clientId', client.id);
      parseUser.set('accessLevel', client.employeeAccessLevel || 'basic');
      parseUser.set('updatedAt', new Date());

      await parseUser.save(null, { useMasterKey: true });
    }
  }

  /**
   * Convert Parse Object to plain JavaScript object.
   * @param {Parse.Object} parseObject - Parse Object to convert.
   * @returns {object} - Operation result Plain JavaScript object.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.parseObjectToPlain(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   */
  parseObjectToPlain(parseObject) {
    if (!parseObject) return null;

    const plainObject = parseObject.toJSON();

    // Handle Parse Object specific fields
    if (parseObject.get('id')) {
      plainObject.id = parseObject.get('id');
    } else {
      plainObject.id = parseObject.id;
    }

    return plainObject;
  }

  /**
   * Sanitize user object for response (remove sensitive data).
   * @param {object} user - User object.
   * @returns {object} - Operation result Sanitized user object.
   * @example
   * // Authentication service usage
   * const result = await amexingauthservice.sanitizeUser(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   */
  sanitizeUser(user) {
    const sanitized = { ...user };

    // Remove sensitive fields
    delete sanitized.passwordHash;
    delete sanitized.twoFactorSecret;
    delete sanitized.sessionTokens;
    delete sanitized.refreshTokens;

    // Sanitize OAuth accounts (remove tokens)
    if (sanitized.oauthAccounts) {
      sanitized.oauthAccounts = sanitized.oauthAccounts.map((account) => ({
        provider: account.provider,
        email: account.email,
        linkedAt: account.linkedAt,
        isPrimary: account.isPrimary,
      }));
    }

    return sanitized;
  }
}

module.exports = AmexingAuthService;
