/**
 * UserManagementService - AI Agent Compatible User CRUD Operations
 * Implements SOLID principles and follows AI agent data lifecycle rules.
 *
 * Features:
 * - Role-based user access filtering
 * - AI agent compliant data lifecycle management (active/exists pattern)
 * - Comprehensive audit logging
 * - Performance optimized queries with pagination
 * - Security validation and input sanitization.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // User management service usage
 * const result = await usermanagementservice.require(userId, data);
 * // Returns: { success: true, user: {...} }
 */

const Parse = require('parse/node');
const AmexingUser = require('../../domain/models/AmexingUser');
const BaseModel = require('../../domain/models/BaseModel');
const logger = require('../../infrastructure/logger');
const RoleAuthorizationService = require('./RoleAuthorizationService');
const { extractUserContext, saveWithContext } = require('../utils/parseQueryHelper');

/**
 * UserManagementService class implementing comprehensive user management
 * with AI agent compliance and role-based access control.
 *
 * Follows SOLID Principles:
 * - Single Responsibility: Manages user operations only
 * - Open/Closed: Extensible through role-specific filtering strategies
 * - Liskov Substitution: Can be substituted with role-specific implementations
 * - Interface Segregation: Provides specific interfaces for different operations
 * - Dependency Inversion: Depends on BaseModel abstractions.
 */
class UserManagementService {
  constructor() {
    this.className = 'AmexingUser';
    this.authService = new RoleAuthorizationService();
    this.allowedRoles = [
      'superadmin',
      'admin',
      'client',
      'department_manager',
      'employee',
      'employee_amexing',
      'driver',
      'guest',
      'employee_amexing',
    ];
    this.roleHierarchy = {
      superadmin: 7,
      admin: 6,
      client: 5,
      department_manager: 4,
      employee: 3,
      employee_amexing: 3,
      driver: 2,
      guest: 1,
    };
  }

  /**
   * Get client organization users (client, department_manager, employee, driver, guest).
   * This endpoint is focused on corporate client user management.
   * @param {object} currentUser - User making the request.
   * @param {object} options - Query options.
   * @returns {Promise<object>} - Users data with pagination info.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.getUsers(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   */
  async getUsers(currentUser, options = {}) {
    try {
      const {
        targetRole = null,
        page = 1,
        limit = 25,
        filters = {},
        sort = { field: 'lastName', direction: 'asc' },
      } = options;

      // Query all existing users (exists: true), regardless of active status
      // The active field only controls access, not visibility in admin panel
      const query = BaseModel.queryExisting(this.className);

      // Select only necessary fields for better performance
      query.select(
        'email',
        'username',
        'firstName',
        'lastName',
        'roleId',
        'active',
        'exists',
        'emailVerified',
        'lastLoginAt',
        'loginAttempts',
        'mustChangePassword',
        'primaryOAuthProvider',
        'lastAuthMethod',
        'organizationId',
        'clientId',
        'departmentId',
        'contextualData',
        'createdAt',
        'updatedAt',
        'createdBy',
        'modifiedBy'
      );

      // Include role data from Pointer
      query.include('roleId');

      // Filter by client organization roles (exclude Amexing internal users)
      await this.filterByOrganization(query, 'client');

      // Apply role-based access filtering (targetRole specific filter)
      // Note: Admin already filtered by organization, only apply specific targetRole if provided
      if (targetRole) {
        await this.filterByRoleName(query, targetRole);
      }

      // Apply additional filters
      await this.applyAdvancedFilters(query, filters);

      // Apply sorting
      this.applySorting(query, sort);

      // Calculate pagination
      const skip = (page - 1) * limit;
      query.skip(skip);
      query.limit(limit);

      // Execute queries in parallel for performance
      const [users, totalCount] = await Promise.all([
        query.find({ useMasterKey: true }),
        this.getTotalUserCount(currentUser, targetRole, filters),
      ]);

      logger.info('User query performed', {
        usersFound: users.length,
        totalCount,
        targetRole,
        userSample: users.slice(0, 2).map((u) => ({
          id: u.id,
          username: u.get('username'),
          firstName: u.get('firstName'),
          lastName: u.get('lastName'),
          roleId: u.get('roleId')?.id || 'NO_ROLE_ID',
          hasRoleId: !!u.get('roleId'),
        })),
      });

      // Transform users to safe format
      const safeUsers = users.map((user) => this.transformUserToSafeFormat(user));

      // Log activity for audit compliance
      await this.logUserQueryActivity(currentUser, {
        targetRole,
        page,
        limit,
        totalResults: totalCount,
        filtersApplied: Object.keys(filters).length,
      });

      return {
        users: safeUsers,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit),
          hasNext: page * limit < totalCount,
          hasPrev: page > 1,
        },
        metadata: {
          queriedAt: new Date(),
          requestedBy: currentUser.id,
          appliedRole: targetRole,
          activeFilters: Object.keys(filters),
        },
      };
    } catch (error) {
      logger.error('Error in UserManagementService.getUsers', {
        error: error.message,
        stack: error.stack,
        currentUser: currentUser?.id,
        options,
      });
      throw new Error(`Failed to retrieve users: ${error.message}`);
    }
  }

  /**
   * Get Amexing internal users (superadmin, admin, employee_amexing).
   * Restricted to SuperAdmin and Admin roles only.
   * @param {object} currentUser - User making the request.
   * @param {object} options - Query options.
   * @param explicitRole
   * @returns {Promise<object>} - Amexing users data with pagination info.
   * @example
   * const result = await userManagementService.getAmexingUsers(currentUser, { page: 1, limit: 25 });
   * // Returns: { users: [...], pagination: {...}, metadata: {...} }
   */
  async getAmexingUsers(currentUser, options = {}, explicitRole = null) {
    try {
      const {
        page = 1, limit = 25, filters = {}, sort = { field: 'lastName', direction: 'asc' },
      } = options;

      // Validate authorization using centralized service
      this.authService.validateRoleAccess(currentUser, ['superadmin', 'admin'], {
        throwError: true,
        context: 'getAmexingUsers',
        explicitRole, // Pass explicit role from controller (JWT middleware)
      });

      // Get current user's role for filtering logic
      const currentUserRole = this.authService.extractUserRole(currentUser, explicitRole);

      // Query all existing users from Amexing organization
      const query = BaseModel.queryExisting(this.className);
      query.fromNetwork();
      query.include('roleId');

      // Filter by Amexing organization roles
      await this.filterByOrganization(query, 'amexing');

      // Apply role-based filtering
      if (currentUserRole === 'admin') {
        // Admin cannot see superadmin users
        await this.excludeRoleName(query, 'superadmin');
      }
      // SuperAdmin sees all Amexing users (no exclusion)

      // Apply additional filters
      await this.applyAdvancedFilters(query, filters);

      // Apply sorting
      this.applySorting(query, sort);

      // Calculate pagination
      const skip = (page - 1) * limit;
      query.skip(skip);
      query.limit(limit);

      // Execute queries in parallel for performance
      const [users, totalCount] = await Promise.all([
        query.find({ useMasterKey: true }),
        this.getTotalAmexingUserCount(currentUser, filters),
      ]);

      // Transform users to safe format
      const safeUsers = users.map((user) => this.transformUserToSafeFormat(user));

      // Log activity for audit compliance
      await this.logUserQueryActivity(currentUser, {
        queryType: 'amexing_users',
        page,
        limit,
        totalResults: totalCount,
        filtersApplied: Object.keys(filters).length,
      });

      return {
        users: safeUsers,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit),
          hasNext: page * limit < totalCount,
          hasPrev: page > 1,
        },
        metadata: {
          queriedAt: new Date(),
          requestedBy: currentUser.id,
          organizationType: 'amexing',
          activeFilters: Object.keys(filters),
        },
      };
    } catch (error) {
      logger.error('Error in UserManagementService.getAmexingUsers', {
        error: error.message,
        stack: error.stack,
        currentUser: currentUser?.id,
        options,
      });
      throw new Error(`Failed to retrieve Amexing users: ${error.message}`);
    }
  }

  /**
   * Get a single user by ID with role-based access validation.
   * @param {object} currentUser - User making the request.
   * @param {string} userId - ID of user to retrieve.
   * @returns {Promise<object>} - User data or null if not accessible.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.getUserById(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   */
  async getUserById(currentUser, userId) {
    try {
      // AI Agent Rule: Use queryActive for business operations
      const query = BaseModel.queryActive(this.className);
      query.include('roleId'); // Include role data

      // Pass user context for audit trail
      const context = extractUserContext(currentUser);
      const user = await query.get(userId, { useMasterKey: true, context });

      if (!user) {
        return null;
      }

      // Validate access permissions
      if (!this.canAccessUser(currentUser, user)) {
        throw new Error('Insufficient permissions to access this user');
      }

      // Log access for audit compliance
      await this.logUserAccessActivity(currentUser, userId, 'view');

      return this.transformUserToSafeFormat(user);
    } catch (error) {
      if (error.code === 101) {
        // Parse object not found
        return null;
      }
      logger.error('Error in UserManagementService.getUserById', {
        error: error.message,
        currentUser: currentUser?.id,
        targetUserId: userId,
      });
      throw error;
    }
  }

  /**
   * Create a new user following AI agent lifecycle rules.
   * @param {object} userData - User data to create.
   * @param {object} createdBy - User creating the new user.
   * @returns {Promise<object>} - Created user data.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.createUser(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   */
  async createUser(userData, createdBy) {
    try {
      // Validate permissions
      if (!this.canCreateUser(createdBy, userData.role)) {
        throw new Error('Insufficient permissions to create user with this role');
      }

      // Validate input data
      await this.validateUserData(userData, 'create');

      // Check for existing user with same email
      const existingUser = await this.checkExistingUser(userData.email);
      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      // Prepare user data with AI agent lifecycle fields
      const userDataWithDefaults = {
        ...userData,
        username: userData.email, // Email-primary authentication
        active: true,
        exists: true,
        emailVerified: false,
        loginAttempts: 0,
        // Only set createdBy/modifiedBy if not already provided in userData
        // This allows callers to pass user ID strings that will be converted to Pointers
        createdBy: userData.createdBy || createdBy,
        modifiedBy: userData.modifiedBy || createdBy,
      };

      // Create user using AmexingUser model (follows BaseModel patterns)
      const user = AmexingUser.create(userDataWithDefaults);

      // Set password securely
      if (userData.password) {
        await user.setPassword(userData.password);
      }

      // Save with user context for proper audit trail
      await saveWithContext(user, createdBy);

      // Log creation activity
      await this.logUserCRUDActivity(createdBy, 'create', user.id, {
        role: userData.role,
        email: userData.email,
      });

      logger.info('User created successfully', {
        userId: user.id,
        email: userData.email,
        role: userData.role,
        createdBy: createdBy.id,
      });

      return this.transformUserToSafeFormat(user);
    } catch (error) {
      logger.error('Error in UserManagementService.createUser', {
        error: error.message,
        userData: { ...userData, password: '[REDACTED]' },
        createdBy: createdBy?.id,
      });
      throw error;
    }
  }

  /**
   * Update an existing user following AI agent lifecycle rules.
   * @param {string} userId - ID of user to update.
   * @param {object} updates - Data to update.
   * @param {object} modifiedBy - User making the update.
   * @returns {Promise<object>} - Updated user data.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.updateUser(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   */
  async updateUser(userId, updates, modifiedBy) {
    try {
      // Get existing user using AI agent compliant query
      const query = BaseModel.queryActive(this.className);
      const user = await query.get(userId, {
        useMasterKey: true,
        context: extractUserContext(modifiedBy),
      });

      if (!user) {
        throw new Error('User not found or not accessible');
      }

      // Validate permissions
      if (!this.canModifyUser(modifiedBy, user)) {
        throw new Error('Insufficient permissions to modify this user');
      }

      // Validate update data
      await this.validateUserData(updates, 'update', user);

      // Store original values for audit
      const originalValues = this.extractAuditableFields(user);

      // Apply updates while preserving lifecycle management
      const allowedUpdateFields = [
        'firstName',
        'lastName',
        'role',
        'active',
        'emailVerified',
        'mustChangePassword',
        'oauthAccounts',
        'primaryOAuthProvider',
      ];

      allowedUpdateFields.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(updates, field)) {
          user.set(field, updates[field]);
        }
      });

      // Update modification tracking - Pass User object directly for Pointer creation
      user.set('modifiedBy', modifiedBy);
      user.set('updatedAt', new Date());

      // Handle password update separately if provided
      if (updates.password) {
        await user.setPassword(updates.password);
        user.set('passwordChangedAt', new Date());
      }

      // Save changes with user context for proper audit trail
      await saveWithContext(user, modifiedBy);

      // Log update activity with field changes
      await this.logUserCRUDActivity(modifiedBy, 'update', userId, {
        originalValues,
        newValues: this.extractAuditableFields(user),
        fieldsChanged: Object.keys(updates),
      });

      logger.info('User updated successfully', {
        userId,
        modifiedBy: modifiedBy.id,
        fieldsUpdated: Object.keys(updates),
      });

      return this.transformUserToSafeFormat(user);
    } catch (error) {
      logger.error('Error in UserManagementService.updateUser', {
        error: error.message,
        userId,
        updates: {
          ...updates,
          password: updates.password ? '[REDACTED]' : undefined,
        },
        modifiedBy: modifiedBy?.id,
      });
      throw error;
    }
  }

  /**
   * Deactivate a user (soft delete) following AI agent rules.
   * Never hard deletes - uses BaseModel.deactivate() method.
   * @param {string} userId - ID of user to deactivate.
   * @param {object} deactivatedBy - User performing the deactivation.
   * @param {string} reason - Reason for deactivation.
   * @returns {Promise<boolean>} - Success status.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.deactivateUser(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   */
  async deactivateUser(userId, deactivatedBy, reason = 'Admin action') {
    try {
      // Get user using existing records query (includes archived)
      const query = BaseModel.queryExisting(this.className);
      query.include('roleId'); // Include role data for permission validation
      const user = await query.get(userId, {
        useMasterKey: true,
        context: extractUserContext(deactivatedBy),
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Validate permissions
      if (!this.canDeactivateUser(deactivatedBy, user)) {
        throw new Error('Insufficient permissions to deactivate this user');
      }

      // Prevent self-deactivation
      if (userId === deactivatedBy.id) {
        throw new Error('Cannot deactivate your own account');
      }

      // AI Agent Rule: Soft delete - set active=false and exists=false
      // This is a logical deletion, never hard delete
      // Manual implementation since registerSubclass is commented out
      user.set('active', false);
      user.set('exists', false);
      user.set('deletedAt', new Date());
      user.set('updatedAt', new Date());
      user.set('modifiedBy', deactivatedBy);
      user.set('deletedBy', deactivatedBy);

      await user.save(null, {
        useMasterKey: true,
        context: extractUserContext(deactivatedBy),
      });

      // Log deactivation activity
      await this.logUserCRUDActivity(deactivatedBy, 'deactivate', userId, {
        reason,
        originalRole: user.get('role'),
        originalEmail: user.get('email'),
      });

      logger.info('User deactivated successfully', {
        userId,
        deactivatedBy: deactivatedBy.id,
        reason,
      });

      return true;
    } catch (error) {
      logger.error('Error in UserManagementService.deactivateUser', {
        error: error.message,
        userId,
        deactivatedBy: deactivatedBy?.id,
        reason,
      });
      throw error;
    }
  }

  /**
   * Reactivate a deactivated user following AI agent rules.
   * @param {string} userId - ID of user to reactivate.
   * @param {object} reactivatedBy - User performing the reactivation.
   * @param {string} reason - Reason for reactivation.
   * @returns {Promise<boolean>} - Success status.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.reactivateUser(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   */
  async reactivateUser(userId, reactivatedBy, reason = 'Admin action') {
    try {
      // Query soft deleted users (exists: false)
      const query = BaseModel.querySoftDeleted(this.className);
      const user = await query.get(userId, {
        useMasterKey: true,
        context: extractUserContext(reactivatedBy),
      });

      if (!user) {
        throw new Error('User not found or permanently deleted');
      }

      // Ensure user has role property for permission check (may not be loaded from DB)
      if (!user.role && typeof user.get === 'function') {
        user.role = user.get('role');
      }

      // Validate permissions
      if (!this.canReactivateUser(reactivatedBy, user)) {
        throw new Error('Insufficient permissions to reactivate this user');
      }

      // AI Agent Rule: Activate user - set active=true and exists=true
      // Manual implementation since registerSubclass is commented out
      user.set('active', true);
      user.set('exists', true);
      user.set('updatedAt', new Date());
      user.set('modifiedBy', reactivatedBy);

      await user.save(null, {
        useMasterKey: true,
        context: extractUserContext(reactivatedBy),
      });

      // Log reactivation activity
      await this.logUserCRUDActivity(reactivatedBy, 'reactivate', userId, {
        reason,
        role: user.get('role'),
        email: user.get('email'),
      });

      logger.info('User reactivated successfully', {
        userId,
        reactivatedBy: reactivatedBy.id,
        reason,
      });

      return true;
    } catch (error) {
      logger.error('Error in UserManagementService.reactivateUser', {
        error: error.message,
        userId,
        reactivatedBy: reactivatedBy?.id,
        reason,
      });
      throw error;
    }
  }

  /**
   * Toggle user active status (activate/deactivate) while maintaining exists: true
   * AI Agent Rule: Preserves data lifecycle management by only changing active field.
   * @param {object} currentUser - User performing the action.
   * @param {string} userId - ID of user to toggle.
   * @param {boolean} targetStatus - Target active status (true/false).
   * @param {string} reason - Reason for status change.
   * @returns {Promise<object>} - Result with success status and user data.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.toggleUserStatus(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   */
  async toggleUserStatus(currentUser, userId, targetStatus, reason = 'Status change via API') {
    try {
      // Query active users to get current user data
      const query = BaseModel.queryActive(this.className);
      query.include('roleId'); // Include role data for permission validation
      let user;

      try {
        user = await query.get(userId, {
          useMasterKey: true,
          context: extractUserContext(currentUser),
        });
      } catch (error) {
        // If user not found in active query, try archived query
        const archivedQuery = BaseModel.queryArchived(this.className);
        archivedQuery.include('roleId'); // Include role data for permission validation
        user = await archivedQuery.get(userId, {
          useMasterKey: true,
          context: extractUserContext(currentUser),
        });
      }

      if (!user) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      // Validate permissions based on target status
      const canPerformAction = targetStatus
        ? this.canReactivateUser(currentUser, user)
        : this.canDeactivateUser(currentUser, user);

      if (!canPerformAction) {
        return {
          success: false,
          message: 'Insufficient permissions to change user status',
        };
      }

      const previousStatus = user.get('active');

      // AI Agent Rule: Only change active field, maintain exists: true
      user.set('active', targetStatus);
      user.set('exists', true); // Ensure exists remains true
      user.set('updatedAt', new Date());

      // Save with user context for proper audit trail
      await saveWithContext(user, currentUser);

      // Log activity
      await this.logUserCRUDActivity(currentUser, targetStatus ? 'activate' : 'deactivate', userId, {
        reason,
        role: user.get('role'),
        email: user.get('email'),
        previousStatus,
        newStatus: targetStatus,
      });

      return {
        success: true,
        user: this.transformUserToSafeFormat(user),
        previousStatus,
        newStatus: targetStatus,
      };
    } catch (error) {
      logger.error('Error in UserManagementService.toggleUserStatus', {
        error: error.message,
        userId,
        targetStatus,
        changedBy: currentUser?.id,
        reason,
      });
      throw error;
    }
  }

  /**
   * Archive user (soft delete) by setting active: false, exists: false
   * AI Agent Rule: Makes user invisible to normal queries while preserving data.
   * @param {object} currentUser - User performing the action.
   * @param {string} userId - ID of user to archive.
   * @param {string} reason - Reason for archiving.
   * @returns {Promise<object>} - Result with success status and user data.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.archiveUser(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   */
  async archiveUser(currentUser, userId, reason = 'User archived via API') {
    try {
      // Query active users first, then archived if not found
      const query = BaseModel.queryActive(this.className);
      let user;

      try {
        user = await query.get(userId, {
          useMasterKey: true,
          context: extractUserContext(currentUser),
        });
      } catch (error) {
        // If user not found in active query, try archived query
        const archivedQuery = BaseModel.queryArchived(this.className);
        user = await archivedQuery.get(userId, {
          useMasterKey: true,
          context: extractUserContext(currentUser),
        });
      }

      if (!user) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      // Validate permissions - only superadmin can archive
      if (currentUser.role !== 'superadmin') {
        return {
          success: false,
          message: 'Only superadmin can archive users',
        };
      }

      // Prevent self-archiving
      if (user.id === currentUser.id) {
        return {
          success: false,
          message: 'Cannot archive your own account',
        };
      }

      // AI Agent Rule: Set both active and exists to false for archiving
      user.set('active', false);
      user.set('exists', false);
      user.set('updatedAt', new Date());

      // Save with user context for proper audit trail
      await saveWithContext(user, currentUser);

      // Log archiving activity
      await this.logUserCRUDActivity(currentUser, 'archive', userId, {
        reason,
        role: user.get('role'),
        email: user.get('email'),
        archivedAt: new Date(),
      });

      logger.info('User archived successfully', {
        userId,
        archivedBy: currentUser.id,
        reason,
        role: user.get('role'),
        email: user.get('email'),
      });

      return {
        success: true,
        user: this.transformUserToSafeFormat(user),
        archived: true,
      };
    } catch (error) {
      logger.error('Error in UserManagementService.archiveUser', {
        error: error.message,
        userId,
        archivedBy: currentUser?.id,
        reason,
      });
      throw error;
    }
  }

  /**
   * Search users with advanced filtering and role-based access.
   * @param {object} currentUser - User performing the search.
   * @param {object} searchParams - Search parameters.
   * @param _currentUser
   * @returns {Promise<object>} - Search results with pagination.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.getUserStatistics(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   */
  async getUserStatistics(_currentUser) {
    try {
      // Get total users
      const totalUsersQuery = BaseModel.queryActive(this.className);
      const totalUsers = await totalUsersQuery.count({ useMasterKey: true });

      // Get active users
      const activeUsersQuery = BaseModel.queryActive(this.className);
      activeUsersQuery.equalTo('active', true);
      const activeUsers = await activeUsersQuery.count({ useMasterKey: true });

      // Get users created this month
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const newUsersQuery = BaseModel.queryActive(this.className);
      newUsersQuery.greaterThanOrEqualTo('createdAt', startOfMonth);
      const newThisMonth = await newUsersQuery.count({ useMasterKey: true });

      // Get users pending email verification
      const pendingQuery = BaseModel.queryActive(this.className);
      pendingQuery.equalTo('emailVerified', false);
      const pendingVerification = await pendingQuery.count({
        useMasterKey: true,
      });

      // Get role distribution
      const roles = ['superadmin', 'admin', 'client', 'department_manager', 'employee', 'driver', 'guest'];
      const roleDistribution = {};

      for (const role of roles) {
        const roleQuery = BaseModel.queryActive(this.className);
        roleQuery.equalTo('role', role);
        roleDistribution[role] = await roleQuery.count({ useMasterKey: true });
      }

      // Get registration trends (last 6 months)
      const trends = [];
      const currentDate = new Date();

      for (let i = 5; i >= 0; i--) {
        const monthDate = new Date(currentDate);
        monthDate.setMonth(currentDate.getMonth() - i);

        const startDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
        const endDate = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

        const monthQuery = BaseModel.queryActive(this.className);
        monthQuery.greaterThanOrEqualTo('createdAt', startDate);
        monthQuery.lessThanOrEqualTo('createdAt', endDate);

        const count = await monthQuery.count({ useMasterKey: true });

        trends.push({
          month: startDate.toLocaleDateString('en-US', { month: 'short' }),
          count,
        });
      }

      return {
        totalUsers,
        activeUsers,
        newThisMonth,
        pendingVerification,
        roleDistribution,
        registrationTrends: trends,
      };
    } catch (error) {
      logger.error('Error getting user statistics', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Search users with role-based filtering and pagination
   * Searches users by name or email with optional role/status filters.
   * @param {Parse.User} currentUser - Current authenticated user.
   * @param {object} [searchParams] - Search parameters.
   * @param {string} [searchParams.query] - Search query for name/email.
   * @param {string} [searchParams.role] - Filter by role.
   * @param {boolean} [searchParams.active] - Filter by active status.
   * @param {number} [searchParams.page] - Page number.
   * @param {number} [searchParams.limit] - Results per page.
   * @param {string} [searchParams.sortField] - Sort field.
   * @param {string} [searchParams.sortDirection] - Sort direction.
   * @returns {Promise<object>} Search results with pagination.
   * @example
   */
  async searchUsers(currentUser, searchParams = {}) {
    try {
      const {
        query: searchQuery = '',
        role = null,
        active = null,
        page = 1,
        limit = 25,
        sortField = 'lastName',
        sortDirection = 'asc',
      } = searchParams;

      // AI Agent Rule: Query active users for search operations
      const query = BaseModel.queryActive(this.className);

      // Apply role-based filtering
      await this.applyRoleBasedFiltering(query, currentUser, role);

      // Apply search query across multiple fields
      if (searchQuery.trim()) {
        const searchTerms = searchQuery.trim().toLowerCase();

        // Create compound query for searching across multiple fields
        const emailQuery = new Parse.Query(this.className);
        emailQuery.matches('email', searchTerms, 'i');

        const firstNameQuery = new Parse.Query(this.className);
        firstNameQuery.matches('firstName', searchTerms, 'i');

        const lastNameQuery = new Parse.Query(this.className);
        lastNameQuery.matches('lastName', searchTerms, 'i');

        const compoundQuery = Parse.Query.or(emailQuery, firstNameQuery, lastNameQuery);
        query.matchesQuery('objectId', compoundQuery);
      }

      // Apply active filter if specified
      if (active !== null) {
        query.equalTo('active', active);
      }

      // Apply role filter if specified
      if (role) {
        query.equalTo('role', role);
      }

      // Apply sorting
      if (sortDirection === 'desc') {
        query.descending(sortField);
      } else {
        query.ascending(sortField);
      }

      // Calculate pagination
      const skip = (page - 1) * limit;
      query.skip(skip);
      query.limit(limit);

      // Execute search
      const [users, totalCount] = await Promise.all([
        query.find({ useMasterKey: true }),
        this.getSearchResultCount(currentUser, searchParams),
      ]);

      // Transform results
      const safeUsers = users.map((user) => this.transformUserToSafeFormat(user));

      // Log search activity
      await this.logUserSearchActivity(currentUser, searchParams, totalCount);

      return {
        users: safeUsers,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit),
          hasNext: page * limit < totalCount,
          hasPrev: page > 1,
        },
        searchMetadata: {
          query: searchQuery,
          appliedFilters: { role, active },
          searchedAt: new Date(),
          searchedBy: currentUser.id,
        },
      };
    } catch (error) {
      logger.error('Error in UserManagementService.searchUsers', {
        error: error.message,
        currentUser: currentUser?.id,
        searchParams,
      });
      throw new Error(`Search failed: ${error.message}`);
    }
  }

  // ===== PRIVATE HELPER METHODS =====

  /**
   * Apply role-based filtering to query based on current user's permissions.
   * Implements business rules for user visibility using Parse Pointer relationships.
   * @param {object} query - Query parameters object.
   * @param {object} currentUser - Current authenticated user object.
   * @param {string} targetRole - Target role for authorization check.
   * @param explicitRole
   * @example
   * // User management service usage
   * const result = await usermanagementservice.applyRoleBasedFiltering(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * @returns {Promise<void>} - Operation result.
   */
  async applyRoleBasedFiltering(query, currentUser, targetRole = null, explicitRole = null) {
    // Get current user's role using centralized service
    const currentUserRole = this.authService.extractUserRole(currentUser, explicitRole);

    switch (currentUserRole) {
      case 'superadmin':
        // Superadmin can see all users - no filtering needed
        if (targetRole) {
          await this.filterByRoleName(query, targetRole);
        }
        // If no targetRole specified, superadmin sees ALL users (no additional filters)
        break;

      case 'admin':
        // Admin can see all users except other superadmins
        await this.excludeRoleName(query, 'superadmin');
        if (targetRole && targetRole !== 'superadmin') {
          await this.filterByRoleName(query, targetRole);
        }
        break;

      case 'client': {
        // Client can only see users from their company
        const allowedClientRoles = ['employee', 'department_manager'];
        if (targetRole) {
          if (allowedClientRoles.includes(targetRole)) {
            await this.filterByRoleName(query, targetRole);
          } else {
            // Restrict to no results if requesting unauthorized role
            query.equalTo('objectId', 'non-existent-id');
            return;
          }
        } else {
          await this.filterByRoleNames(query, allowedClientRoles);
        }
        // Add client filter when clientId field is available
        if (currentUser.clientId) {
          query.equalTo('clientId', currentUser.clientId);
        }
        break;
      }

      case 'department_manager':
        // Department manager can only see their department employees
        await this.filterByRoleName(query, 'employee');
        if (currentUser.departmentId) {
          query.equalTo('departmentId', currentUser.departmentId);
        }
        break;

      default:
        // Employee, driver, guest can only see their own profile
        query.equalTo('objectId', currentUser.id);
        break;
    }
  }

  /**
   * Apply advanced filters to the query.
   * @param {object} query - Query parameters object.
   * @param {*} filters - Filters parameter.
   * @param _filters
   * @example
   * // User management service usage
   * const result = await usermanagementservice.applyAdvancedFilters(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * @returns {*} - Operation result.
   */
  async applyAdvancedFilters(query, filters) {
    // Apply filters from request parameters
    if (!filters || typeof filters !== 'object') {
      return;
    }

    for (const [key, value] of Object.entries(filters)) {
      if (value !== null && value !== undefined && value !== '') {
        switch (key) {
          case 'active':
            query.equalTo('active', value);
            break;
          case 'emailVerified':
            query.equalTo('emailVerified', value);
            break;
          case 'role':
            // Support both Pointer and string-based role filtering
            this.filterByRoleName(query, value).catch((error) => {
              logger.warn('Failed to filter by role pointer, using string fallback', {
                role: value,
                error: error.message,
              });
              query.equalTo('role', value);
            });
            break;
          case 'roleNames':
            // Support filtering by multiple roles (async operation)
            await this.filterByRoleNames(query, value).catch((error) => {
              logger.warn('Failed to filter by role names, no results will be returned', {
                roleNames: value,
                error: error.message,
              });
              query.equalTo('objectId', 'non-existent-id');
            });
            break;
          case 'clientId':
            query.equalTo('clientId', value);
            break;
          case 'departmentId':
            query.equalTo('departmentId', value);
            break;
          case 'createdAfter':
            query.greaterThan('createdAt', new Date(value));
            break;
          case 'createdBefore':
            query.lessThan('createdAt', new Date(value));
            break;
          case 'search': {
            // Multi-field search: firstName, lastName, email, companyName
            // Using case-insensitive regex matching with MongoDB $or operator
            const searchTerm = value.trim();

            // Create regex for case-insensitive search
            // eslint-disable-next-line security/detect-non-literal-regexp
            const searchRegex = new RegExp(searchTerm, 'i');

            // Use Parse Server's internal _orQuery to combine multiple field searches
            // This approach works better with existing filters than matchesQuery
            // eslint-disable-next-line no-underscore-dangle
            query._orQuery([
              new Parse.Query(this.className).matches('email', searchRegex),
              new Parse.Query(this.className).matches('firstName', searchRegex),
              new Parse.Query(this.className).matches('lastName', searchRegex),
              new Parse.Query(this.className).matches('contextualData.companyName', searchRegex),
            ]);

            logger.info('Multi-field search applied', {
              searchTerm: value,
              fields: ['email', 'firstName', 'lastName', 'contextualData.companyName'],
            });

            break;
          }
          default:
            // Ignore unknown filter keys
            break;
        }
      }
    }
  }

  /**
   * Apply sorting to the query.
   * @param {object} query - Query parameters object.
   * @param {*} sort - Sort parameter.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.applySorting(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * @returns {*} - Operation result.
   */
  applySorting(query, sort) {
    const { field, direction } = sort;
    const allowedSortFields = [
      'firstName',
      'lastName',
      'email',
      'role',
      'createdAt',
      'updatedAt',
      'lastLoginAt',
      'active',
      'companyName', // Support sorting by company name
    ];

    if (allowedSortFields.includes(field)) {
      // Special handling for nested field companyName
      if (field === 'companyName') {
        // Sort by contextualData.companyName which is a nested field
        const sortField = 'contextualData.companyName';
        if (direction === 'desc') {
          query.descending(sortField);
        } else {
          query.ascending(sortField);
        }
      } else if (direction === 'desc') {
        query.descending(field);
      } else {
        query.ascending(field);
      }
    } else {
      // Default sorting - ascending by company name for clients view
      query.ascending('contextualData.companyName');
      query.addAscending('email');
    }
  }

  /**
   * Get total count of users matching criteria.
   * @param {object} currentUser - Current authenticated user object.
   * @param {string} targetRole - Target role for authorization check.
   * @param {*} filters - Filters parameter.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.getTotalUserCount(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result.
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async getTotalUserCount(currentUser, targetRole, filters) {
    // Apply same filters as main query for consistency
    // Query all existing users (exists: true), regardless of active status
    const countQuery = BaseModel.queryExisting(this.className);

    // CRITICAL: Must match exact same filters as getUsers() method
    // Filter by client organization roles (exclude Amexing internal users)
    await this.filterByOrganization(countQuery, 'client');

    // Apply role-based access filtering (targetRole specific filter)
    // Note: Admin already filtered by organization, only apply specific targetRole if provided
    if (targetRole) {
      await this.filterByRoleName(countQuery, targetRole);
    }

    // Apply additional filters (search, active status, etc.)
    await this.applyAdvancedFilters(countQuery, filters);

    const count = await countQuery.count({ useMasterKey: true });

    logger.info('Total user count calculated', {
      count,
      targetRole,
      organizationFilter: 'client',
      filters,
    });

    return count;
  }

  /**
   * Get total count of Amexing users matching criteria.
   * @param {object} currentUser - Current authenticated user object.
   * @param {*} filters - Filters parameter.
   * @returns {Promise<number>} - Total count of Amexing users.
   * @example
   * const count = await userManagementService.getTotalAmexingUserCount(currentUser, {});
   * // Returns: 5
   */
  async getTotalAmexingUserCount(currentUser, filters) {
    const countQuery = BaseModel.queryExisting(this.className);

    // Filter by Amexing organization
    await this.filterByOrganization(countQuery, 'amexing');

    // Apply role-based filtering using centralized service
    const currentUserRole = this.authService.extractUserRole(currentUser);
    if (currentUserRole === 'admin') {
      await this.excludeRoleName(countQuery, 'superadmin');
    }

    // Apply additional filters
    this.applyAdvancedFilters(countQuery, filters);

    const count = await countQuery.count({ useMasterKey: true });
    return count;
  }

  /**
   * Get count of search results.
   * @param {object} currentUser - Current authenticated user object.
   * @param {*} searchParams - SearchParams parameter.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.getSearchResultCount(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result.
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async getSearchResultCount(currentUser, searchParams) {
    const { query: searchQuery, role, active } = searchParams;

    const countQuery = BaseModel.queryActive(this.className);
    await this.applyRoleBasedFiltering(countQuery, currentUser, role);

    if (searchQuery?.trim()) {
      const searchTerms = searchQuery.trim().toLowerCase();
      const emailQuery = new Parse.Query(this.className);
      emailQuery.matches('email', searchTerms, 'i');

      const firstNameQuery = new Parse.Query(this.className);
      firstNameQuery.matches('firstName', searchTerms, 'i');

      const lastNameQuery = new Parse.Query(this.className);
      lastNameQuery.matches('lastName', searchTerms, 'i');

      const compoundQuery = Parse.Query.or(emailQuery, firstNameQuery, lastNameQuery);
      countQuery.matchesQuery('objectId', compoundQuery);
    }

    if (active !== null) {
      countQuery.equalTo('active', active);
    }

    const count = await countQuery.count({ useMasterKey: true });
    return count;
  }

  /**
   * Transform user object to safe format for API responses.
   * Removes sensitive fields and includes only necessary data.
   * @param {*} user - User parameter.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.transformUserToSafeFormat(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * @returns {object} - Operation result.
   */
  transformUserToSafeFormat(user) {
    // Get role information from Pointer or fallback to string field
    const rolePointer = user.get('roleId');
    let roleName = user.get('role'); // Default to string role
    let roleDisplayName = null; // Display name from Role object
    let roleObjectId = null;

    // Handle rolePointer safely
    if (rolePointer) {
      try {
        // Check if it's a fetched Parse Object with .get() method
        if (rolePointer.get && typeof rolePointer.get === 'function') {
          roleName = rolePointer.get('name') || roleName;
          roleDisplayName = rolePointer.get('displayName') || rolePointer.get('name') || roleName;
          roleObjectId = rolePointer.id;
        } else if (typeof rolePointer === 'string') {
          // It's a string ID, keep the string role name
          roleObjectId = rolePointer;
        } else if (rolePointer.id) {
          // It's a Pointer object but not fetched
          roleObjectId = rolePointer.id;
        }
      } catch (error) {
        logger.warn('Error processing role pointer in transformUserToSafeFormat', {
          userId: user.id,
          error: error.message,
        });
      }
    }

    // Get lifecycle fields with safety defaults
    const active = user.get('active');
    const exists = user.get('exists');

    // Get contextualData for additional user information
    const contextualData = user.get('contextualData') || {};
    const companyName = contextualData.companyName || user.get('companyName') || null;
    const organizationId = user.get('organizationId');
    const clientId = user.get('clientId');
    const departmentId = user.get('departmentId');

    return {
      id: user.id,
      email: user.get('email'),
      username: user.get('username'),
      firstName: user.get('firstName'),
      lastName: user.get('lastName'),
      role: roleName || 'guest',
      roleDisplayName: roleDisplayName || roleName || 'Invitado', // Fallback to roleName or default
      roleId: roleObjectId,
      active: active !== undefined ? active : true,
      exists: exists !== undefined ? exists : true,
      emailVerified: user.get('emailVerified'),
      lastLoginAt: user.get('lastLoginAt'),
      loginAttempts: user.get('loginAttempts'),
      mustChangePassword: user.get('mustChangePassword'),
      primaryOAuthProvider: user.get('primaryOAuthProvider'),
      lastAuthMethod: user.get('lastAuthMethod'),
      createdAt: user.get('createdAt'),
      updatedAt: user.get('updatedAt'),
      createdBy: user.get('createdBy'),
      modifiedBy: user.get('modifiedBy'),
      // Additional fields for client/organizational data
      companyName,
      organizationId,
      organizationName: organizationId, // Alias for compatibility
      clientId,
      departmentId,
      contextualData, // Include full contextual data object
    };
  }

  /**
   * Validate user data for create/update operations.
   * @param {object} userData - User registration/update data.
   * @param {*} operation - Operation parameter.
   * @param {*} existingUser - ExistingUser parameter.
   * @param _existingUser
   * @example
   * // User management service usage
   * const result = await usermanagementservice.validateUserData(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async validateUserData(userData, operation = 'create', _existingUser = null) {
    const errors = [];

    // Required fields validation
    if (operation === 'create') {
      const requiredFields = ['email', 'firstName', 'lastName', 'role'];
      requiredFields.forEach((field) => {
        if (!userData[field] || userData[field].toString().trim() === '') {
          errors.push(`${field} is required`);
        }
      });
    }

    // Email validation
    if (userData.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(userData.email)) {
        errors.push('Invalid email format');
      }
    }

    // Role validation
    if (userData.role && !this.allowedRoles.includes(userData.role)) {
      errors.push(`Invalid role: ${userData.role}`);
    }

    // Password validation (if provided)
    if (userData.password) {
      if (userData.password.length < 8) {
        errors.push('Password must be at least 8 characters long');
      }
    }

    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.join(', ')}`);
    }
  }

  /**
   * Check if user with email already exists.
   * @param {string} email - User email address.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.checkExistingUser(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result.
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async checkExistingUser(email) {
    try {
      const normalizedEmail = email.toLowerCase().trim();
      console.log('[DEBUG] checkExistingUser - Checking email:', normalizedEmail);

      const query = BaseModel.queryExisting(this.className);
      query.equalTo('email', normalizedEmail);
      query.limit(1);

      const existingUser = await query.first({ useMasterKey: true });
      console.log('[DEBUG] checkExistingUser - Found existing user:', existingUser ? existingUser.id : 'null');

      return existingUser || null;
    } catch (error) {
      console.log('[DEBUG] checkExistingUser - Error:', error.message);
      // If error, assume no existing user to proceed safely
      return null;
    }
  }

  /**
   * Extract auditable fields from user for change tracking.
   * @param {*} user - User parameter.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.extractAuditableFields(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * @returns {object} - Operation result.
   */
  extractAuditableFields(user) {
    return {
      email: user.get('email'),
      firstName: user.get('firstName'),
      lastName: user.get('lastName'),
      role: user.get('role'),
      active: user.get('active'),
      emailVerified: user.get('emailVerified'),
      mustChangePassword: user.get('mustChangePassword'),
    };
  }

  // ===== PERMISSION VALIDATION METHODS =====

  /**
   * Check if current user can access target user.
   * @param {object} currentUser - Current authenticated user object.
   * @param {*} targetUser - TargetUser parameter.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.canAccessUser(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * @returns {boolean} - Boolean result Operation result.
   */
  canAccessUser(currentUser, targetUser) {
    const currentLevel = this.roleHierarchy[currentUser.role] || 0;
    const targetLevel = this.roleHierarchy[targetUser.get('role')] || 0;

    // Higher or equal level can access lower level users
    if (currentLevel >= targetLevel) {
      return true;
    }

    // Users can access their own profile
    if (currentUser.id === targetUser.id) {
      return true;
    }

    // Client/Department manager specific rules
    if (currentUser.role === 'client' && targetUser.get('clientId') === currentUser.clientId) {
      return true;
    }

    if (currentUser.role === 'department_manager' && targetUser.get('departmentId') === currentUser.departmentId) {
      return true;
    }

    return false;
  }

  /**
   * Check if current user can create user with target role.
   * @param {object} currentUser - Current authenticated user object.
   * @param {string} targetRole - Target role for authorization check.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.canCreateUser(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * @returns {*} - Operation result.
   */
  canCreateUser(currentUser, targetRole) {
    // Get role from currentUser - prioritize direct property 'role' (set by controller)
    let currentRole = currentUser?.role;
    if (!currentRole && typeof currentUser?.get === 'function') {
      currentRole = currentUser.get('role');
    }

    const currentLevel = this.roleHierarchy[currentRole] || 0;
    const targetLevel = this.roleHierarchy[targetRole] || 0;

    // Debug logging
    logger.info('canCreateUser validation', {
      currentUserId: currentUser?.id || currentUser?.objectId,
      currentRole,
      currentLevel,
      targetRole,
      targetLevel,
      canCreate: currentLevel >= targetLevel,
      hasGetMethod: typeof currentUser?.get === 'function',
      hasRoleProperty: !!currentUser?.role,
    });

    // Can only create users with lower or equal role level
    const canCreate = currentLevel >= targetLevel;

    if (!canCreate) {
      logger.warn('Cannot create user: insufficient role level', {
        currentRole,
        currentLevel,
        targetRole,
        targetLevel,
      });
    }

    return canCreate;
  }

  /**
   * Check if current user can modify target user.
   * @param {object} currentUser - Current authenticated user object.
   * @param {*} targetUser - TargetUser parameter.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.canModifyUser(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * @returns {boolean} - Boolean result Operation result.
   */
  canModifyUser(currentUser, targetUser) {
    // Get role from currentUser - prioritize direct property 'role' (set by controller)
    let currentRole = currentUser?.role;
    if (!currentRole && typeof currentUser?.get === 'function') {
      currentRole = currentUser.get('role');
    }

    // Get role from targetUser - handle Pointer, property, or get() method
    let targetRole = null;
    if (targetUser?.role) {
      targetRole = targetUser.role;
    } else if (typeof targetUser?.get === 'function') {
      // Try to get role from roleId Pointer first
      const rolePointer = targetUser.get('roleId');
      if (rolePointer && typeof rolePointer.get === 'function') {
        targetRole = rolePointer.get('name');
      } else {
        // Fallback to direct role field
        targetRole = targetUser.get('role');
      }
    }

    const currentLevel = this.roleHierarchy[currentRole] || 0;
    const targetLevel = this.roleHierarchy[targetRole] || 0;

    // Debug logging
    logger.info('canModifyUser validation', {
      currentUserId: currentUser?.id || currentUser?.objectId,
      currentRole,
      currentLevel,
      targetUserId: targetUser?.id || targetUser?.objectId,
      targetRole,
      targetLevel,
      canModify: currentLevel >= targetLevel,
      hasGetMethod: typeof currentUser?.get === 'function',
      hasRoleProperty: !!currentUser?.role,
    });

    // Cannot modify users with higher role level
    if (currentLevel < targetLevel) {
      logger.warn('Cannot modify user: higher role level', {
        currentRole,
        currentLevel,
        targetRole,
        targetLevel,
      });
      return false;
    }

    // Cannot modify other superadmins unless you are superadmin
    if (targetRole === 'superadmin' && currentRole !== 'superadmin') {
      logger.warn('Cannot modify superadmin: insufficient role', {
        currentRole,
        targetRole,
      });
      return false;
    }

    return true;
  }

  /**
   * Check if current user can deactivate target user.
   * @param {object} currentUser - Current authenticated user object.
   * @param {*} targetUser - TargetUser parameter.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.canDeactivateUser(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * @returns {*} - Operation result.
   */
  canDeactivateUser(currentUser, targetUser) {
    // Same rules as modify for deactivation
    return this.canModifyUser(currentUser, targetUser);
  }

  /**
   * Check if current user can reactivate target user.
   * @param {object} currentUser - Current authenticated user object.
   * @param {*} targetUser - TargetUser parameter.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.canReactivateUser(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * @returns {*} - Operation result.
   */
  canReactivateUser(currentUser, targetUser) {
    // Same rules as modify for reactivation
    return this.canModifyUser(currentUser, targetUser);
  }

  // ===== LOGGING METHODS FOR AUDIT COMPLIANCE =====

  /**
   * Log user query activity for audit trails.
   * @param {object} currentUser - Current authenticated user object.
   * @param {*} queryDetails - QueryDetails parameter.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.logUserQueryActivity(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result.
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async logUserQueryActivity(currentUser, queryDetails) {
    try {
      logger.info('User query performed', {
        action: 'user_query',
        performedBy: currentUser.id,
        userRole: currentUser.role,
        queryDetails,
        timestamp: new Date(),
      });
    } catch (error) {
      // Don't fail the main operation if logging fails
      logger.error('Failed to log user query activity', {
        error: error.message,
      });
    }
  }

  /**
   * Log user access activity.
   * @param {object} currentUser - Current authenticated user object.
   * @param {*} targetUserId - TargetUserId parameter.
   * @param {string} action - Action identifier.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.logUserAccessActivity(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result.
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async logUserAccessActivity(currentUser, targetUserId, action) {
    try {
      logger.info('User access activity', {
        action: `user_${action}`,
        performedBy: currentUser.id,
        targetUser: targetUserId,
        userRole: currentUser.role,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error('Failed to log user access activity', {
        error: error.message,
      });
    }
  }

  /**
   * Log CRUD operations for audit compliance.
   * @param {*} performedBy - PerformedBy parameter.
   * @param {string} action - Action identifier.
   * @param {*} targetUserId - TargetUserId parameter.
   * @param {*} details - Details parameter.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.logUserCRUDActivity(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result.
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async logUserCRUDActivity(performedBy, action, targetUserId, details = {}) {
    try {
      logger.info('User CRUD operation', {
        action: `user_${action}`,
        performedBy: performedBy.id,
        performedByRole: performedBy.role,
        targetUser: targetUserId,
        details,
        timestamp: new Date(),
        compliance: 'AI_AGENT_LIFECYCLE',
      });
    } catch (error) {
      logger.error('Failed to log CRUD activity', { error: error.message });
    }
  }

  /**
   * Log search operations for audit trails.
   * @param {object} currentUser - Current authenticated user object.
   * @param {*} searchParams - SearchParams parameter.
   * @param {*} resultCount - ResultCount parameter.
   * @example
   * // User management service usage
   * const result = await usermanagementservice.logUserSearchActivity(userId , data);
   * // Returns: { success: true, user: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result.
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async logUserSearchActivity(currentUser, searchParams, resultCount) {
    try {
      logger.info('User search performed', {
        action: 'user_search',
        performedBy: currentUser.id,
        userRole: currentUser.role,
        searchParams: { ...searchParams, password: undefined },
        resultCount,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error('Failed to log search activity', { error: error.message });
    }
  }

  /**
   * Filter query to include only users with specific role.
   * Uses roleId Pointer to Role table.
   * @param {Parse.Query} query - Parse query object.
   * @param {string} roleName - Role name to filter by.
   * @example
   * // Usage example documented above
   */
  async filterByRoleName(query, roleName) {
    try {
      // Query Role table to get role by name
      const roleQuery = new Parse.Query('Role');
      roleQuery.equalTo('name', roleName);
      roleQuery.equalTo('exists', true);
      const role = await roleQuery.first({ useMasterKey: true });

      if (role) {
        // Filter users by roleId Pointer
        query.equalTo('roleId', role);
      } else {
        // If role not found, return no results
        logger.warn('Role not found for filtering', { roleName });
        query.equalTo('objectId', 'non-existent-id');
      }
    } catch (error) {
      logger.error('Failed to filter by role name', {
        error: error.message,
        roleName,
      });
      throw error;
    }
  }

  /**
   * Filter query to exclude users with specific role.
   * Uses roleId Pointer to Role table.
   * @param {Parse.Query} query - Parse query object.
   * @param {string} roleName - Role name to exclude.
   * @example
   * // Usage example documented above
   */
  async excludeRoleName(query, roleName) {
    try {
      // Query Role table to get role by name
      const roleQuery = new Parse.Query('Role');
      roleQuery.equalTo('name', roleName);
      roleQuery.equalTo('exists', true);
      const role = await roleQuery.first({ useMasterKey: true });

      if (role) {
        // Exclude users with this roleId Pointer
        query.notEqualTo('roleId', role);
      }
      // If role not found, no exclusion needed
    } catch (error) {
      logger.error('Failed to exclude role name', {
        error: error.message,
        roleName,
      });
      throw error;
    }
  }

  /**
   * Filter query to include only users with specific roles.
   * Uses roleId Pointer to Role table.
   * @param {Parse.Query} query - Parse query object.
   * @param {string[]} roleNames - Array of role names to filter by.
   * @example
   * // Usage example documented above
   */
  async filterByRoleNames(query, roleNames) {
    try {
      // Query Role table to get roles by names
      const roleQuery = new Parse.Query('Role');
      roleQuery.containedIn('name', roleNames);
      roleQuery.equalTo('exists', true);
      const roles = await roleQuery.find({ useMasterKey: true });

      if (roles && roles.length > 0) {
        // Filter users by roleId Pointers
        query.containedIn('roleId', roles);
      } else {
        // If no roles found, return no results
        logger.warn('No roles found for filtering', { roleNames });
        query.equalTo('objectId', 'non-existent-id');
      }
    } catch (error) {
      logger.error('Failed to filter by role names', {
        error: error.message,
        roleNames,
      });
      throw error;
    }
  }

  /**
   * Get organization role filters for building queries.
   * Returns roles and role names for both new RBAC and legacy formats.
   * @param {string} organizationType - Organization type ('amexing' or 'client').
   * @returns {Promise<{roles: Array, roleNames: Array}>} Role filters.
   * @example
   * // Usage example documented above
   */
  async getOrganizationRoleFilters(organizationType) {
    try {
      // Query Role table to get roles by organization
      const roleQuery = new Parse.Query('Role');
      roleQuery.equalTo('organization', organizationType);
      roleQuery.equalTo('exists', true);

      logger.info('Getting organization role filters', {
        organizationType,
      });

      const roles = await roleQuery.find({ useMasterKey: true });
      const roleNames = roles.map((r) => r.get('name'));

      logger.info('Organization roles retrieved', {
        organizationType,
        rolesCount: roles.length,
        roleNames,
      });

      return {
        roles,
        roleNames,
      };
    } catch (error) {
      logger.error('Failed to get organization role filters', {
        error: error.message,
        stack: error.stack,
        organizationType,
      });
      throw error;
    }
  }

  /**
   * Filter query to include only users with specific organization type.
   * Uses roleId Pointer to filter by role's organization field (new RBAC format).
   * @param {Parse.Query} query - Parse query object.
   * @param {string} organizationType - Organization type ('amexing' or 'client').
   * @example
   * // Usage example documented above
   */
  async filterByOrganization(query, organizationType) {
    try {
      // Query Role table to get roles by organization
      const roleQuery = new Parse.Query('Role');
      roleQuery.equalTo('organization', organizationType);
      roleQuery.equalTo('exists', true);

      logger.info('Filtering by organization', {
        organizationType,
      });

      const roles = await roleQuery.find({ useMasterKey: true });

      logger.info('Roles found for organization', {
        organizationType,
        rolesCount: roles.length,
        roleNames: roles.map((r) => r.get('name')),
        roleIds: roles.map((r) => r.id),
      });

      if (roles && roles.length > 0) {
        // Filter users by roleId Pointers
        query.containedIn('roleId', roles);

        logger.info('Applied roleId filter to query', {
          organizationType,
          rolesCount: roles.length,
        });
      } else {
        // If no roles found, return no results
        logger.warn('No roles found for organization type', {
          organizationType,
        });
        query.equalTo('objectId', 'non-existent-id');
      }
    } catch (error) {
      logger.error('Failed to filter by organization', {
        error: error.message,
        stack: error.stack,
        organizationType,
      });
      throw error;
    }
  }
}

module.exports = UserManagementService;
