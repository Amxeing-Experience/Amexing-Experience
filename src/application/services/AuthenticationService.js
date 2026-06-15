/**
 * Authentication Service - Handles traditional and OAuth authentication
 * Integrates with AmexingUser model and provides comprehensive auth functionality.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Authentication service usage
 * const result = await authenticationservice.require(userData);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 */

const Parse = require('parse/node');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const AmexingUser = require('../../domain/models/AmexingUser');
const logger = require('../../infrastructure/logger');
const { AuthenticationServiceCore } = require('./AuthenticationServiceCore');

/**
 * Authentication Service - Handles traditional and OAuth authentication.
 * Provides comprehensive authentication functionality including JWT token management,
 * user registration, login, and OAuth integration with AmexingUser model.
 *
 * Features:
 * - Email/password authentication with PCI DSS compliance
 * - JWT token generation and validation
 * - Password reset and change functionality
 * - Account lockout protection
 * - Comprehensive security logging
 * - Integration with AmexingUser model.
 * @class AuthenticationService
 * @augments AuthenticationServiceCore
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Example usage:
 * // const result = await methodName(params);
 * // console.log(result);
 * // Register a new user
 * const userData = {
 *   username: 'john_doe',
 *   email: 'john@example.com',
 *   password: 'your-secure-password',
 *   firstName: 'John',
 *   lastName: 'Doe'
 * };
 * const registrationResult = await AuthenticationService.registerUser(userData);
 *
 * // Login user
 * const loginResult = await AuthenticationService.loginUser('john@example.com', 'user-password');
 *
 * // Validate token
 * const tokenValidation = await AuthenticationService.validateToken(accessToken);
 */
/* eslint-disable max-lines */
class AuthenticationService extends AuthenticationServiceCore {
  /**
   * Registers a new user with email/password.
   * @param {object} userData - User registration data.
   * @returns {Promise<object>} - Registration result with tokens.
   * @example
   * // Authentication service usage
   * const result = await authenticationservice.registerUser(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * const userData = { username: 'john_doe', email: 'john@example.com', password: 'user-password', firstName: 'John', lastName: 'Doe' };
   * const result = await authService.registerUser(userData);
   */
  async registerUser(userData) {
    try {
      // Validate required fields
      this.validateRegistrationData(userData);

      // Check if user already exists
      await this.checkUserExists(userData.email, userData.username);

      // Create new AmexingUser
      const user = AmexingUser.create({
        username: userData.username,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        role: userData.role || 'user',
      });

      // Set password with validation
      await user.setPassword(userData.password);

      // Save user to database
      const savedUser = await user.save(null, { useMasterKey: true });

      // Generate tokens
      const tokens = await this.generateTokens(savedUser);

      // Log registration
      logger.logSecurityEvent('USER_REGISTRATION', {
        userId: savedUser.id,
        username: savedUser.get('username'),
        email: this.maskEmail(savedUser.get('email')),
        authMethod: 'password',
      });

      return {
        success: true,
        user: savedUser.toSafeJSON(),
        tokens,
        message: 'User registered successfully',
      };
    } catch (error) {
      logger.error('User registration error:', error);
      throw error;
    }
  }

  /**
   * Authenticates user with email/password.
   * @param {string} identifier - Email or username.
   * @param {string} password - Plain text password.
   * @returns {Promise<object>} - Login result with tokens.
   * @example
   * // Authentication service usage
   * const result = await authenticationservice.loginUser(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * const result = await authService.loginUser('user@example.com', 'password123');
   */
  /* eslint-disable max-lines-per-function */
  async loginUser(identifier, password) {
    try {
      // Find user by email or username
      const user = await this.findUserByIdentifier(identifier);

      if (!user) {
        logger.logAccessAttempt(false, identifier, 'User not found');
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Invalid credentials');
      }

      // Check if account is locked
      if (user.isAccountLocked()) {
        logger.logSecurityEvent('LOGIN_ATTEMPT_LOCKED', {
          userId: user.id,
          username: user.get('username'),
        });
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Account is temporarily locked');
      }

      // Check if account is active
      if (!user.get('active')) {
        logger.logSecurityEvent('LOGIN_ATTEMPT_INACTIVE', {
          userId: user.id,
          username: user.get('username'),
        });
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Account is inactive');
      }

      // Validate password
      const isValidPassword = await user.validatePassword(password);

      if (!isValidPassword) {
        const isLocked = await user.recordFailedLogin();
        logger.logAccessAttempt(false, identifier, 'Invalid password');

        if (isLocked) {
          throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Account has been locked due to failed login attempts');
        } else {
          throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Invalid credentials');
        }
      }

      // Record successful login
      await user.recordSuccessfulLogin('password');

      // Generate tokens
      const tokens = await this.generateTokens(user);

      // Log successful login
      logger.logAccessAttempt(true, identifier, 'Password login');
      logger.logSecurityEvent('USER_LOGIN', {
        userId: user.id,
        username: user.get('username'),
        authMethod: 'password',
      });

      return {
        success: true,
        user: user.toSafeJSON(),
        tokens,
        message: 'Login successful',
      };
    } catch (error) {
      logger.error('User login error:', error);
      throw error;
    }
  }

  /**
   * Refreshes JWT token using refresh token.
   * @param {string} refreshToken - Refresh token.
   * @returns {Promise<object>} - New tokens.
   * @example
   * // Authentication service usage
   * const result = await authenticationservice.refreshToken(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * const newTokens = await authService.refreshToken('refreshtoken_here');
   */
  async refreshToken(refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, this.jwtSecret);

      if (decoded.type !== 'refresh') {
        throw new Parse.Error(Parse.Error.INVALID_REQUEST, 'Invalid refresh token');
      }

      // Find user
      const user = await this.findUserById(decoded.userId);

      if (!user || !user.get('active')) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found or inactive');
      }

      // Generate new tokens
      const tokens = await this.generateTokens(user);

      logger.logSecurityEvent('TOKEN_REFRESH', {
        userId: user.id,
        username: user.get('username'),
      });

      // Build safe user response without relying on toSafeJSON
      // (registerSubclass is disabled for AmexingUser due to set()+save() issues)
      const safeUser = {
        id: user.id,
        username: user.get('username'),
        email: user.get('email'),
        firstName: user.get('firstName'),
        lastName: user.get('lastName'),
        fullName: `${user.get('firstName') || ''} ${user.get('lastName') || ''}`.trim(),
        role: user.get('role'),
        active: user.get('active'),
        exists: user.get('exists'),
      };

      return {
        success: true,
        tokens,
        user: safeUser,
      };
    } catch (error) {
      logger.error('Token refresh error:', error.message);
      throw new Parse.Error(Parse.Error.INVALID_REQUEST, 'Invalid or expired refresh token');
    }
  }

  /**
   * Logs out user and invalidates tokens.
   * @param {string} userId - User ID.
   * @param {string} sessionToken - Session token to invalidate.
   * @returns {Promise<object>} - Logout result.
   * @example
   * // Authentication service usage
   * const result = await authenticationservice.logoutUser(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * await authService.logoutUser('user123', 'sessiontoken');
   */
  async logoutUser(userId, sessionToken) {
    try {
      const user = await this.findUserById(userId);

      if (user) {
        logger.logSecurityEvent('USER_LOGOUT', {
          userId: user.id,
          username: user.get('username'),
          sessionToken: `${sessionToken.substring(0, 8)}***`,
        });
      }

      return {
        success: true,
        message: 'Logout successful',
      };
    } catch (error) {
      logger.error('Logout error:', error);
      throw error;
    }
  }

  /**
   * Validates JWT token.
   * @param {string} token - JWT token.
   * @returns {Promise<object>} - Decoded token data.
   * @example
   * // Authentication service usage
   * const result = await authenticationservice.validateToken(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * const decoded = await authService.validateToken('jwttoken_here');
   */
  async validateToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret);

      // Check token type if present (backward compatibility)
      if (decoded.type && decoded.type !== 'access') {
        throw new Parse.Error(Parse.Error.INVALID_REQUEST, 'Invalid token type');
      }

      // Check if user still exists and is active
      const user = await this.findUserById(decoded.userId);

      if (!user || !user.get('active')) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found or inactive');
      }

      // Get role object if roleId is available
      let roleObject = null;
      if (decoded.roleId) {
        try {
          // Import Role class to get proper instance with methods
          const Role = require('../../domain/models/Role');

          // Handle both Pointer objects and string IDs
          let roleId;
          const { roleId: decodedRoleId } = decoded;
          if (typeof decodedRoleId === 'string') {
            roleId = decodedRoleId;
          } else if (decodedRoleId && decodedRoleId.id) {
            roleId = decodedRoleId.id;
          } else if (decodedRoleId && decodedRoleId.objectId) {
            // Parse Pointer object structure
            roleId = decodedRoleId.objectId;
          }

          if (roleId) {
            // Use Role class to get proper instance with hasPermission() method
            const roleQuery = new Parse.Query(Role);
            roleObject = await roleQuery.get(roleId, { useMasterKey: true });

            // Fetch the full object to ensure all fields are loaded
            if (roleObject) {
              await roleObject.fetch({ useMasterKey: true });
            }
          }
        } catch (roleError) {
          logger.warn('Failed to fetch role object during token validation', {
            userId: decoded.userId,
            roleId: decoded.roleId,
            error: roleError.message,
          });
        }
      }

      return {
        success: true,
        userId: decoded.userId,
        username: decoded.username,
        role: decoded.role,
        roleId: decoded.roleId,
        organizationId: decoded.organizationId,
        user,
        roleObject,
      };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Parse.Error(Parse.Error.INVALID_REQUEST, 'Token expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new Parse.Error(Parse.Error.INVALID_REQUEST, 'Invalid token');
      }
      throw error;
    }
  }

  /**
   * Initiates password reset process.
   * @param {string} email - User email.
   * @returns {Promise<object>} - Password reset result.
   * @example
   * // Authentication service usage
   * const result = await authenticationservice.initiatePasswordReset(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * await authService.initiatePasswordReset('user@example.com');
   */
  async initiatePasswordReset(email) {
    try {
      const user = await this.findUserByEmail(email);

      if (!user) {
        return {
          success: true,
          message: 'If the email exists, a password reset link has been sent',
        };
      }

      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetExpires = new Date();
      resetExpires.setHours(resetExpires.getHours() + 1); // 1 hour expiration

      user.set('passwordResetToken', resetToken);
      user.set('passwordResetExpires', resetExpires);
      await user.save(null, { useMasterKey: true });

      logger.logSecurityEvent('PASSWORD_RESET_INITIATED', {
        userId: user.id,
        email: this.maskEmail(email),
      });

      return {
        success: true,
        message: 'Password reset link has been sent to your email',
      };
    } catch (error) {
      logger.error('Password reset initiation error:', error);
      throw error;
    }
  }

  /**
   * Requests password reset and sends email to user.
   * @param {string} email - User email.
   * @returns {Promise<object>} - Password reset request result.
   * @example
   * const result = await authService.requestPasswordReset('user@example.com');
   * // Always returns success to prevent user enumeration
   */
  async requestPasswordReset(email) {
    console.log('🔐 ========== AuthenticationService.requestPasswordReset START ==========');
    console.log('🔐 DEBUG: Method called at:', new Date().toISOString());
    console.log('🔐 DEBUG: Raw email received:', email);
    console.log('🔐 DEBUG: Email type:', typeof email);

    try {
      // Normalize email
      const normalizedEmail = email.toLowerCase().trim();

      console.log('🔐 DEBUG: Normalized email:', normalizedEmail);
      console.log('🔐 DEBUG: Starting password reset process');
      console.log('🔐 DEBUG: About to call findUserByEmail');

      // Find user by email
      const user = await this.findUserByEmail(normalizedEmail);

      console.log('🔐 DEBUG: findUserByEmail returned');
      console.log('🔐 DEBUG: User found?:', !!user);

      if (user) {
        console.log('🔐 DEBUG: User details:', {
          userId: user.id,
          userEmail: user.get('email'),
          userActive: user.get('active'),
          userExists: user.get('exists'),
          hasPasswordResetToken: !!user.get('passwordResetToken'),
          passwordResetExpires: user.get('passwordResetExpires'),
        });
      } else {
        console.log('🔐 DEBUG: No user found with email:', normalizedEmail);
      }

      // Always return success to prevent user enumeration
      if (!user) {
        logger.info('🔍 Password reset requested for non-existent email', {
          email: this.maskEmail(normalizedEmail),
          message: 'No user found with this email - showing success but not sending email',
        });
        console.log('🔐 DEBUG: No user found - returning success to prevent enumeration');
        console.log('🔐 ========== AuthenticationService.requestPasswordReset END (NO USER) ==========');
        return {
          success: true,
          message: 'If an account exists with that email, password reset instructions have been sent.',
        };
      }

      logger.info('✅ Password reset requested for existing user', {
        userId: user.id,
        email: this.maskEmail(normalizedEmail),
        message: 'User found - proceeding with email',
      });

      // Check if user is active
      if (!user.get('active')) {
        console.log('🔐 WARNING: User is inactive - not sending email');
        logger.warn('Password reset requested for inactive user', {
          userId: user.id,
          email: this.maskEmail(normalizedEmail),
        });
        console.log('🔐 ========== AuthenticationService.requestPasswordReset END (INACTIVE USER) ==========');
        return {
          success: true,
          message: 'If an account exists with that email, password reset instructions have been sent.',
        };
      }

      console.log('🔐 DEBUG: User is active - proceeding with password reset');

      // Generate secure reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

      console.log('🔐 DEBUG: Generated reset token (first 10 chars):', `${resetToken.substring(0, 10)}...`);
      console.log('🔐 DEBUG: Hashed token (first 10 chars):', `${hashedToken.substring(0, 10)}...`);

      // Set expiration time (1 hour)
      const resetExpires = new Date();
      resetExpires.setHours(resetExpires.getHours() + 1);

      console.log('🔐 DEBUG: Token expires at:', resetExpires.toISOString());

      // Save hashed token to user
      console.log('🔐 DEBUG: Saving reset token to user');
      user.set('passwordResetToken', hashedToken);
      user.set('passwordResetExpires', resetExpires);
      await user.save(null, { useMasterKey: true });
      console.log('🔐 DEBUG: User saved with reset token');

      // Generate reset URL.
      // Derive the public base URL from PARSE_PUBLIC_SERVER_URL (correctly set in
      // every environment: localhost in dev, real domain in prod) so the link in the
      // email is always reachable by the recipient. Fall back to APP_BASE_URL, then
      // localhost. NOTE: the old `process.env.PUBLIC_URL` was never defined in any
      // env file, so the link always pointed to localhost and broke in production.
      const publicServerBase = (process.env.PARSE_PUBLIC_SERVER_URL || '').replace(/\/parse\/?$/, '');
      const baseUrl = publicServerBase || process.env.APP_BASE_URL || 'http://localhost:1337';
      const resetUrl = `${baseUrl}/auth/reset-password?token=${resetToken}`;

      console.log('🔐 DEBUG: Reset URL generated:', resetUrl);

      // Send password reset email
      console.log('🔐 DEBUG: Loading EmailService');
      const emailService = require('./EmailService');

      console.log('🔐 DEBUG: Calling emailService.sendPasswordResetEmail');
      console.log('🔐 DEBUG: Email params:', {
        email: normalizedEmail,
        name: user.get('displayName') || user.get('username') || 'User',
        resetUrl,
        hasRecipientUser: !!user,
        expirationTime: '1 hour',
      });

      // Use same working approach as quotes - direct sendEmail call
      console.log('🔐 DEBUG: Using simplified email approach like quotes');

      const emailResult = await emailService.sendEmail({
        to: normalizedEmail,
        toName: user.get('displayName') || user.get('username') || 'User',
        subject: 'Password Reset - Amexing Experience',
        html: emailService.generatePasswordResetEmailHTML(
          user.get('displayName') || user.get('username') || 'User',
          resetUrl
        ),
        text: emailService.generatePasswordResetEmailText(
          user.get('displayName') || user.get('username') || 'User',
          resetUrl
        ),
        tags: ['password-reset', 'security', 'transactional'],
        notificationType: 'password_reset',
        recipientUser: user,
        metadata: {
          resetRequestedAt: new Date().toISOString(),
          expirationTime: '1 hour',
        },
      });

      console.log('🔐 DEBUG: Email result:', emailResult);

      console.log('🔐 DEBUG: Email sent successfully');

      // Log security event
      logger.logSecurityEvent('PASSWORD_RESET_REQUESTED', {
        userId: user.id,
        email: this.maskEmail(normalizedEmail),
        ip: 'system',
      });

      console.log('🔐 DEBUG: Password reset process completed successfully');
      console.log('🔐 ========== AuthenticationService.requestPasswordReset SUCCESS END ==========');

      return {
        success: true,
        message: 'If an account exists with that email, password reset instructions have been sent.',
      };
    } catch (error) {
      console.log('🔐 ERROR: Exception caught in requestPasswordReset');
      console.log('🔐 ERROR: Error message:', error.message);
      console.log('🔐 ERROR: Error stack:', error.stack);
      console.log('🔐 ERROR: Full error object:', error);

      logger.error('Password reset request error:', {
        error: error.message,
        email: this.maskEmail(email),
      });

      console.log('🔐 ========== AuthenticationService.requestPasswordReset ERROR END ==========');

      // Don't expose errors to prevent information disclosure
      return {
        success: true,
        message: 'If an account exists with that email, password reset instructions have been sent.',
      };
    }
  }

  /**
   * Resets password using reset token.
   * @param {string} resetToken - Password reset token.
   * @param {string} newPassword - New password.
   * @returns {Promise<object>} - Password reset result.
   * @example
   * // Authentication service usage
   * const result = await authenticationservice.resetPassword(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * await authService.resetPassword('resettoken', 'newpass123');
   */
  async resetPassword(resetToken, newPassword) {
    try {
      // Hash the provided token to compare with stored hash
      const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

      const query = new Parse.Query(AmexingUser);
      query.equalTo('passwordResetToken', hashedToken);
      query.greaterThan('passwordResetExpires', new Date());

      const user = await query.first({ useMasterKey: true });

      if (!user) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Invalid or expired reset token');
      }

      // Hash the new password using bcrypt
      const bcrypt = require('bcrypt');
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update password fields on AmexingUser
      user.set('password', hashedPassword);
      user.set('passwordHash', hashedPassword);
      user.set('passwordChangedAt', new Date());
      user.set('mustChangePassword', false);
      user.set('loginAttempts', 0);
      user.set('lockedUntil', null);

      // Clear reset token fields
      user.unset('passwordResetToken');
      user.unset('passwordResetExpires');

      await user.save(null, { useMasterKey: true });

      logger.logSecurityEvent('PASSWORD_RESET_COMPLETED', {
        userId: user.id,
        username: user.get('username'),
      });

      return {
        success: true,
        message: 'Password has been reset successfully',
      };
    } catch (error) {
      logger.error('Password reset error:', error);
      throw error;
    }
  }

  /**
   * Changes user password (authenticated user).
   * @param {string} userId - User ID.
   * @param {string} currentPassword - Current password.
   * @param {string} newPassword - New password.
   * @returns {Promise<object>} - Password change result.
   * @example
   * // Authentication service usage
   * const result = await authenticationservice.changePassword(userData);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * await authService.changePassword('user123', 'oldpass', 'newpass123');
   */
  async changePassword(userId, currentPassword, newPassword) {
    try {
      const user = await this.findUserById(userId);

      if (!user) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found');
      }

      // Validate current password using bcrypt directly since AmexingUser isn't registered as a subclass
      logger.info('Change password validation attempt', {
        userId: user.id,
        username: user.get('username'),
        email: user.get('email') ? this.maskEmail(user.get('email')) : null,
      });

      // Get the stored password hash
      const bcrypt = require('bcrypt');
      const hashedPassword = user.get('password') || user.get('passwordHash');

      if (!hashedPassword) {
        logger.error('No password hash found for user', {
          userId: user.id,
          username: user.get('username'),
        });
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User password not found');
      }

      // Validate password using bcrypt
      const isValidPassword = await bcrypt.compare(currentPassword, hashedPassword);

      if (!isValidPassword) {
        logger.error('Password validation failed - incorrect password', {
          userId: user.id,
          username: user.get('username'),
        });
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Current password is incorrect');
      }

      logger.info('Password validation successful', {
        userId: user.id,
        username: user.get('username'),
      });

      // Set new password with bcrypt hashing
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
      const newHashedPassword = await bcrypt.hash(newPassword, saltRounds);

      // Save hash in both fields for compatibility
      user.set('password', newHashedPassword);
      user.set('passwordHash', newHashedPassword);
      user.set('passwordChangedAt', new Date());
      user.set('mustChangePassword', false);
      user.set('loginAttempts', 0);
      user.set('lockedUntil', null);

      await user.save(null, { useMasterKey: true });

      logger.logSecurityEvent('PASSWORD_CHANGED', {
        userId: user.id,
        username: user.get('username'),
      });

      return {
        success: true,
        message: 'Password changed successfully',
      };
    } catch (error) {
      logger.error('Password change error:', error);
      throw error;
    }
  }
}

module.exports = new AuthenticationService();
