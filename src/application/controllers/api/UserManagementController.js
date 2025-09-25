/**
 * UserManagementController - RESTful API for User Management Operations
 * Provides Ajax-ready endpoints for user CRUD operations with role-based access control.
 * Implements comprehensive security, validation, and audit logging.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE)
 * - Role-based access control and filtering
 * - AI agent compliant data operations
 * - Performance optimized with pagination and caching
 * - Comprehensive error handling and validation
 * - Security middleware integration.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Usage example
 * const result = await require({ '../../services/UserManagementService': 'example' });
 * // Returns: operation result
 */

const UserManagementService = require('../../services/UserManagementService');
const logger = require('../../../infrastructure/logger');

/**
 * UserManagementController class implementing RESTful API for user management.
 * Follows REST conventions and provides comprehensive error handling.
 */
class UserManagementController {
  constructor() {
    this.userService = new UserManagementService();
    this.maxPageSize = 100;
    this.defaultPageSize = 25;
  }

  /**
   * GET /api/users - Get users with filtering, pagination, and role-based access.
   *
   * Query Parameters:
   * - page: Page number (default: 1)
   * - limit: Items per page (default: 25, max: 100)
   * - role: Filter by role
   * - active: Filter by active status (true/false)
   * - search: Search term for email, firstName, lastName
   * - clientId: Filter by client (for superadmin/admin)
   * - departmentId: Filter by department
   * - sortField: Field to sort by (default: lastName)
   * - sortDirection: Sort direction (asc/desc, default: asc).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} - Promise that resolves when users are retrieved.
   * @example
   * // GET endpoint example
   * const result = await UserManagementController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // GET /api/endpoint
   * // Response: { "success": true, "data": [...] }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * // Get users with pagination
   * GET /api/users?page=1&limit=10&role=employee
   */
  async getUsers(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Parse and validate query parameters
      const options = this.parseUserQueryParams(req.query);

      // Validate permissions for the requested operation
      if (!this.canViewUsers(currentUser, options.targetRole)) {
        return this.sendError(res, 'Insufficient permissions to view users', 403);
      }

      // Get users from service
      const result = await this.userService.getUsers(currentUser, options);

      // Add metadata for frontend consumption
      const response = {
        ...result,
        requestMetadata: {
          endpoint: 'getUsers',
          requestedBy: currentUser.id,
          requestedRole: currentUser.role,
          timestamp: new Date(),
          queryParams: options,
        },
      };

      this.sendSuccess(res, response, 'Users retrieved successfully');
    } catch (error) {
      logger.error('Error in UserManagementController.getUsers', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        queryParams: req.query,
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * GET /api/users/:id - Get specific user by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} - Promise that resolves when user is retrieved.
   * @example
   * // GET endpoint example
   * const result = await UserManagementController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // GET /api/endpoint
   * // Response: { "success": true, "data": [...] }
   * // GET /api/users?page=1&limit=10
   * // Response: { "users": [...], "pagination": {...} }
   * // Get specific user by ID
   * GET /api/users/12345
   */
  async getUserById(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const userId = req.params.id;
      if (!userId) {
        return this.sendError(res, 'User ID is required', 400);
      }

      // Get user from service
      const user = await this.userService.getUserById(currentUser, userId);

      if (!user) {
        return this.sendError(res, 'User not found or access denied', 404);
      }

      this.sendSuccess(res, { user }, 'User retrieved successfully');
    } catch (error) {
      logger.error('Error in UserManagementController.getUserById', {
        error: error.message,
        userId: req.user?.id,
        targetUserId: req.params.id,
      });

      if (error.message.includes('Insufficient permissions')) {
        this.sendError(res, error.message, 403);
      } else {
        this.sendError(res, 'Failed to retrieve user', 500);
      }
    }
  }

  /**
   * POST /api/users - Create new user.
   *
   * Request Body:
   * - email: User email (required)
   * - firstName: First name (required)
   * - lastName: Last name (required)
   * - role: User role (required)
   * - password: Initial password (optional - will be generated if not provided)
   * - clientId: Client assignment (optional)
   * - departmentId: Department assignment (optional)
   * - emailVerified: Email verification status (optional, default: false).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} - Promise that resolves when user is created.
   * @example
   * // POST endpoint example
   * const result = await UserManagementController.createUser(req, res);
   * // Body: { data: 'example' }
   * // Returns: { success: true, data: {...} }
   * // POST /api/endpoint
   * // Body: { "data": "value" }
   * // Response: { "success": true, "message": "Created" }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * // Create new user
   * POST /api/users with body: { email: 'user@example.com', firstName: 'John', lastName: 'Doe', role: 'employee' }
   */
  async createUser(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Validate request body
      const validationErrors = this.validateCreateUserRequest(req.body);
      if (validationErrors.length > 0) {
        return this.sendError(res, `Validation failed: ${validationErrors.join(', ')}`, 400);
      }

      const userData = this.sanitizeUserData(req.body);

      // Generate password if not provided
      if (!userData.password) {
        userData.password = this.generateSecurePassword();
        userData.mustChangePassword = true;
      }

      // Create user through service
      const newUser = await this.userService.createUser(userData, currentUser);

      // Log successful creation
      logger.info('User created via API', {
        newUserId: newUser.id,
        email: userData.email,
        role: userData.role,
        createdBy: currentUser.id,
      });

      // Return user data (excluding password)
      const responseData = {
        user: newUser,
        passwordGenerated: !req.body.password,
        message: !req.body.password
          ? 'User created successfully. Temporary password generated - user must change on first login.'
          : 'User created successfully.',
      };

      this.sendSuccess(res, responseData, 'User created successfully', 201);
    } catch (error) {
      logger.error('Error in UserManagementController.createUser', {
        error: error.message,
        userData: { ...req.body, password: '[REDACTED]' },
        createdBy: req.user?.id,
      });

      if (error.message.includes('Insufficient permissions')) {
        this.sendError(res, error.message, 403);
      } else if (error.message.includes('already exists')) {
        this.sendError(res, error.message, 409);
      } else if (error.message.includes('Validation failed')) {
        this.sendError(res, error.message, 400);
      } else {
        this.sendError(res, 'Failed to create user', 500);
      }
    }
  }

  /**
   * PUT /api/users/:id - Update existing user.
   *
   * Request Body: Partial user data to update
   * - firstName, lastName, role, active, emailVerified, etc.
   * - password: New password (optional)
   * - clientId, departmentId: Organizational assignments (optional).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} - Promise that resolves when user is updated.
   * @example
   * // POST endpoint example
   * const result = await UserManagementController.updateUser(req, res);
   * // Body: { data: 'example' }
   * // Returns: { success: true, data: {...} }
   * // PUT /api/endpoint/123
   * // Body: { "field": "updated value" }
   * // Response: { "success": true, "data": {...} }
   * // PUT /api/users/123
   * // Body: { "firstName": "John", "lastName": "Doe" }
   * // Response: { "success": true, "user": {...} }
   * // Update user
   * PUT /api/users/12345 with body: { firstName: 'Jane', role: 'manager' }
   */
  async updateUser(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const userId = req.params.id;
      if (!userId) {
        return this.sendError(res, 'User ID is required', 400);
      }

      // Validate request body
      const validationErrors = this.validateUpdateUserRequest(req.body);
      if (validationErrors.length > 0) {
        return this.sendError(res, `Validation failed: ${validationErrors.join(', ')}`, 400);
      }

      const updates = this.sanitizeUserData(req.body);

      // Update user through service
      const updatedUser = await this.userService.updateUser(
        userId,
        updates,
        currentUser
      );

      logger.info('User updated via API', {
        updatedUserId: userId,
        fieldsUpdated: Object.keys(updates),
        modifiedBy: currentUser.id,
      });

      this.sendSuccess(res, { user: updatedUser }, 'User updated successfully');
    } catch (error) {
      logger.error('Error in UserManagementController.updateUser', {
        error: error.message,
        userId: req.params.id,
        updates: { ...req.body, password: req.body.password ? '[REDACTED]' : undefined },
        modifiedBy: req.user?.id,
      });

      if (error.message.includes('Insufficient permissions')) {
        this.sendError(res, error.message, 403);
      } else if (error.message.includes('not found')) {
        this.sendError(res, error.message, 404);
      } else if (error.message.includes('Validation failed')) {
        this.sendError(res, error.message, 400);
      } else {
        this.sendError(res, 'Failed to update user', 500);
      }
    }
  }

  /**
   * DELETE /api/users/:id - Deactivate user (soft delete)
   * Note: This performs soft deletion following AI agent rules.
   *
   * Request Body:
   * - reason: Reason for deactivation (optional).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} - Promise that resolves when user is deactivated.
   * @example
   * // POST endpoint example
   * const result = await UserManagementController.deactivateUser(req, res);
   * // Body: { data: 'example' }
   * // Returns: { success: true, data: {...} }
   * // DELETE /api/endpoint/123
   * // Response: { "success": true, "message": "Deleted" }
   * // DELETE /api/users/123
   * // Response: { "success": true, "message": "User deleted" }
   * // Deactivate user
   * DELETE /api/users/12345 with body: { reason: 'Employee resigned' }
   */
  async deactivateUser(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const userId = req.params.id;
      if (!userId) {
        return this.sendError(res, 'User ID is required', 400);
      }

      const reason = req.body.reason || 'Deactivated via API';

      // Deactivate user through service
      const success = await this.userService.deactivateUser(
        userId,
        currentUser,
        reason
      );

      if (success) {
        logger.info('User deactivated via API', {
          deactivatedUserId: userId,
          reason,
          deactivatedBy: currentUser.id,
        });

        this.sendSuccess(res, {
          deactivated: true,
          reason,
        }, 'User deactivated successfully');
      } else {
        this.sendError(res, 'Failed to deactivate user', 500);
      }
    } catch (error) {
      logger.error('Error in UserManagementController.deactivateUser', {
        error: error.message,
        userId: req.params.id,
        reason: req.body.reason,
        deactivatedBy: req.user?.id,
      });

      if (error.message.includes('Insufficient permissions')) {
        this.sendError(res, error.message, 403);
      } else if (error.message.includes('not found')) {
        this.sendError(res, error.message, 404);
      } else if (error.message.includes('Cannot deactivate your own account')) {
        this.sendError(res, error.message, 400);
      } else {
        this.sendError(res, 'Failed to deactivate user', 500);
      }
    }
  }

  /**
   * PUT /api/users/:id/reactivate - Reactivate deactivated user.
   *
   * Request Body:
   * - reason: Reason for reactivation (optional).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // POST endpoint example
   * const result = await UserManagementController.reactivateUser(req, res);
   * // Body: { data: 'example' }
   * // Returns: { success: true, data: {...} }
   * // PUT /api/endpoint/123
   * // Body: { "field": "updated value" }
   * // Response: { "success": true, "data": {...} }
   * // PUT /api/users/123
   * // Body: { "firstName": "John", "lastName": "Doe" }
   * // Response: { "success": true, "user": {...} }
   * // PUT /api/users/123/reactivate
   * // Body: { "reason": "Account review completed" }
   * // Response: { "success": true, "user": {...}, "message": "User reactivated successfully" }
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async reactivateUser(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const userId = req.params.id;
      if (!userId) {
        return this.sendError(res, 'User ID is required', 400);
      }

      const reason = req.body.reason || 'Reactivated via API';

      // Reactivate user through service
      const success = await this.userService.reactivateUser(
        userId,
        currentUser,
        reason
      );

      if (success) {
        logger.info('User reactivated via API', {
          reactivatedUserId: userId,
          reason,
          reactivatedBy: currentUser.id,
        });

        this.sendSuccess(res, {
          reactivated: true,
          reason,
        }, 'User reactivated successfully');
      } else {
        this.sendError(res, 'Failed to reactivate user', 500);
      }
    } catch (error) {
      logger.error('Error in UserManagementController.reactivateUser', {
        error: error.message,
        userId: req.params.id,
        reason: req.body.reason,
        reactivatedBy: req.user?.id,
      });

      if (error.message.includes('Insufficient permissions')) {
        this.sendError(res, error.message, 403);
      } else if (error.message.includes('not found')) {
        this.sendError(res, error.message, 404);
      } else {
        this.sendError(res, 'Failed to reactivate user', 500);
      }
    }
  }

  /**
   * PATCH /api/users/:id/toggle-status - Toggle user active status
   * Changes user active status between true/false while maintaining exists: true.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // POST endpoint example
   * const result = await UserManagementController.toggleUserStatus(req, res);
   * // Body: { data: 'example' }
   * // Returns: { success: true, data: {...} }
   * // PATCH /api/endpoint/123
   * // Body: { "field": "new value" }
   * // Response: { "success": true, "data": {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async toggleUserStatus(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const userId = req.params.id;
      if (!userId) {
        return this.sendError(res, 'User ID is required', 400);
      }

      const { active, reason } = req.body;
      if (typeof active !== 'boolean') {
        return this.sendError(res, 'Active status (boolean) is required', 400);
      }

      const actionReason = reason || `User ${active ? 'activated' : 'deactivated'} via API`;

      // Toggle user status through service
      const result = await this.userService.toggleUserStatus(currentUser, userId, active, actionReason);

      if (result.success) {
        logger.info('User status toggled via API', {
          targetUserId: userId,
          newStatus: active,
          reason: actionReason,
          actionBy: currentUser.id,
        });

        this.sendSuccess(res, {
          user: result.user,
          previousStatus: result.previousStatus,
          newStatus: active,
          reason: actionReason,
        }, `User ${active ? 'activated' : 'deactivated'} successfully`);
      } else {
        this.sendError(res, result.message || 'Failed to toggle user status', 400);
      }
    } catch (error) {
      logger.error('Error in UserManagementController.toggleUserStatus', {
        error: error.message,
        userId: req.params.id,
        targetStatus: req.body.active,
        actionBy: req.user?.id,
      });

      this.sendError(res, 'Internal server error', 500);
    }
  }

  /**
   * PATCH /api/users/:id/archive - Archive user (soft delete)
   * Sets user to active: false, exists: false making them invisible to normal queries.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // POST endpoint example
   * const result = await UserManagementController.archiveUser(req, res);
   * // Body: { data: 'example' }
   * // Returns: { success: true, data: {...} }
   * // PATCH /api/endpoint/123
   * // Body: { "field": "new value" }
   * // Response: { "success": true, "data": {...} }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async archiveUser(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const userId = req.params.id;
      if (!userId) {
        return this.sendError(res, 'User ID is required', 400);
      }

      const reason = req.body.reason || 'User archived via API';

      // Archive user through service
      const result = await this.userService.archiveUser(currentUser, userId, reason);

      if (result.success) {
        logger.info('User archived via API', {
          archivedUserId: userId,
          reason,
          archivedBy: currentUser.id,
        });

        this.sendSuccess(res, {
          user: result.user,
          archived: true,
          reason,
        }, 'User archived successfully');
      } else {
        this.sendError(res, result.message || 'Failed to archive user', 400);
      }
    } catch (error) {
      logger.error('Error in UserManagementController.archiveUser', {
        error: error.message,
        userId: req.params.id,
        reason: req.body.reason,
        archivedBy: req.user?.id,
      });

      this.sendError(res, 'Internal server error', 500);
    }
  }

  /**
   * GET /api/users/statistics - Get user statistics for dashboard.
   *
   * Returns:
   * - totalUsers: Total number of users
   * - activeUsers: Number of active users
   * - newThisMonth: Users created this month
   * - pendingVerification: Users pending email verification
   * - roleDistribution: User count by role
   * - registrationTrends: Monthly registration trends.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // GET endpoint example
   * const result = await UserManagementController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // GET /api/endpoint
   * // Response: { "success": true, "data": [...] }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async getUserStatistics(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Only superadmin and admin can view statistics
      if (!['superadmin', 'admin'].includes(currentUser.role)) {
        return this.sendError(res, 'Insufficient permissions', 403);
      }

      const stats = await this.userService.getUserStatistics(currentUser);
      this.sendSuccess(res, stats, 'Statistics retrieved successfully');
    } catch (error) {
      logger.error('Error in UserManagementController.getUserStatistics', {
        error: error.message,
        userId: req.user?.id,
      });

      this.sendError(res, 'Failed to retrieve statistics', 500);
    }
  }

  /**
   * GET /api/users/search - Search users with advanced filtering.
   *
   * Query Parameters:
   * - q: Search query
   * - role: Filter by role
   * - active: Filter by active status
   * - page, limit: Pagination
   * - sortField, sortDirection: Sorting.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // GET endpoint example
   * const result = await UserManagementController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // GET /api/endpoint
   * // Response: { "success": true, "data": [...] }
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async searchUsers(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const searchParams = this.parseSearchParams(req.query);

      // Perform search through service
      const result = await this.userService.searchUsers(currentUser, searchParams);

      this.sendSuccess(res, result, 'Search completed successfully');
    } catch (error) {
      logger.error('Error in UserManagementController.searchUsers', {
        error: error.message,
        userId: req.user?.id,
        searchParams: req.query,
      });

      this.sendError(res, 'Search failed', 500);
    }
  }

  // ===== HELPER METHODS =====

  /**
   * Parse and validate query parameters for user listing.
   * @param {object} query - Query parameters object.
   * @example
   * // Usage example
   * const result = await parseUserQueryParams({ query: 'example' });
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {object} - Operation result.
   */
  parseUserQueryParams(query) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(
      this.maxPageSize,
      Math.max(1, parseInt(query.limit, 10) || this.defaultPageSize)
    );

    return {
      targetRole: query.role || null,
      page,
      limit,
      filters: {
        active: query.active !== undefined ? query.active === 'true' : null,
        emailVerified: query.emailVerified !== undefined ? query.emailVerified === 'true' : null,
        clientId: query.clientId || null,
        departmentId: query.departmentId || null,
        createdAfter: query.createdAfter || null,
        createdBefore: query.createdBefore || null,
      },
      sort: {
        field: query.sortField || 'lastName',
        direction: query.sortDirection || 'asc',
      },
    };
  }

  /**
   * Parse search parameters.
   * @param {object} query - Query parameters object.
   * @example
   * // Usage example
   * const result = await parseSearchParams({ query: 'example' });
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {object} - Operation result.
   */
  parseSearchParams(query) {
    return {
      query: query.q || '',
      role: query.role || null,
      active: query.active !== undefined ? query.active === 'true' : null,
      page: Math.max(1, parseInt(query.page, 10) || 1),
      limit: Math.min(
        this.maxPageSize,
        Math.max(1, parseInt(query.limit, 10) || this.defaultPageSize)
      ),
      sortField: query.sortField || 'lastName',
      sortDirection: query.sortDirection || 'asc',
    };
  }

  /**
   * Validate create user request data.
   * @param {object} data - Data object.
   * @example
   * // POST endpoint example
   * const result = await UserManagementController.validateCreateUserRequest(req, res);
   * // Body: { data: 'example' }
   * // Returns: { success: true, data: {...} }
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {*} - Operation result.
   */
  validateCreateUserRequest(data) {
    const errors = [];

    if (!data.email || typeof data.email !== 'string' || data.email.trim() === '') {
      errors.push('Email is required');
    }

    if (!data.firstName || typeof data.firstName !== 'string' || data.firstName.trim() === '') {
      errors.push('First name is required');
    }

    if (!data.lastName || typeof data.lastName !== 'string' || data.lastName.trim() === '') {
      errors.push('Last name is required');
    }

    if (!data.role || typeof data.role !== 'string' || data.role.trim() === '') {
      errors.push('Role is required');
    }

    // Email format validation
    if (data.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email.trim())) {
        errors.push('Invalid email format');
      }
    }

    // Role validation
    const allowedRoles = ['superadmin', 'admin', 'client', 'department_manager', 'employee', 'driver', 'guest'];
    if (data.role && !allowedRoles.includes(data.role)) {
      errors.push(`Invalid role. Allowed roles: ${allowedRoles.join(', ')}`);
    }

    return errors;
  }

  /**
   * Validate update user request data.
   * @param {object} data - Data object.
   * @example
   * // PUT endpoint example
   * const result = await Controller.updateMethod(req, res);
   * // Body: { id: '123', updates: {...} }
   * // Returns: { success: true, data: {...} }
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {*} - Operation result.
   */
  validateUpdateUserRequest(data) {
    const errors = [];

    // Email format validation if provided
    if (data.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email.trim())) {
        errors.push('Invalid email format');
      }
    }

    // Role validation if provided
    if (data.role) {
      const allowedRoles = ['superadmin', 'admin', 'client', 'department_manager', 'employee', 'driver', 'guest'];
      if (!allowedRoles.includes(data.role)) {
        errors.push(`Invalid role. Allowed roles: ${allowedRoles.join(', ')}`);
      }
    }

    return errors;
  }

  /**
   * Sanitize user data to prevent injection attacks.
   * @param {object} data - Data object.
   * @example
   * // Usage example
   * const result = await sanitizeUserData({ data: 'example' });
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {*} - Operation result.
   */
  sanitizeUserData(data) {
    const sanitized = {};

    // String fields that should be trimmed
    const stringFields = ['email', 'firstName', 'lastName', 'role', 'clientId', 'departmentId'];
    stringFields.forEach((field) => {
      if (data[field] && typeof data[field] === 'string') {
        sanitized[field] = data[field].trim();
      }
    });

    // Boolean fields
    const booleanFields = ['active', 'emailVerified', 'mustChangePassword'];
    booleanFields.forEach((field) => {
      if (data[field] !== undefined) {
        sanitized[field] = Boolean(data[field]);
      }
    });

    // Password field (handled specially)
    if (data.password && typeof data.password === 'string') {
      sanitized.password = data.password; // Don't trim passwords
    }

    return sanitized;
  }

  /**
   * Check if current user can view users with specified role.
   * @param {object} currentUser - Current authenticated user object.
   * @param {string} targetRole - Target role for authorization check.
   * @example
   * // Usage example
   * const result = await canViewUsers({ currentUser: 'example', targetRole: 'example' });
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {boolean} - Boolean result Operation result.
   */
  canViewUsers(currentUser, targetRole) {
    const roleHierarchy = {
      superadmin: 7,
      admin: 6,
      client: 5,
      department_manager: 4,
      employee: 3,
      driver: 2,
      guest: 1,
    };

    // Role levels available for future permissions logic if needed
    // eslint-disable-next-line no-unused-vars
    const currentLevel = roleHierarchy[currentUser.role] || 0;

    // Superadmin can view everything
    if (currentUser.role === 'superadmin') {
      return true;
    }

    // Admin can view all except superadmin
    if (currentUser.role === 'admin') {
      return !targetRole || targetRole !== 'superadmin';
    }

    // Client can view their own company employees
    if (currentUser.role === 'client') {
      return !targetRole || ['employee', 'department_manager'].includes(targetRole);
    }

    // Department manager can view employees
    if (currentUser.role === 'department_manager') {
      return !targetRole || targetRole === 'employee';
    }

    // Lower roles can only view their own profile
    return false;
  }

  /**
   * Generate secure random password.
   * @example
   * // Usage example
   * const result = await generateSecurePassword({ currentUser: 'example', targetRole: 'example' });
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {*} - Operation result.
   */
  generateSecurePassword() {
    const length = 12;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';

    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }

    return password;
  }

  /**
   * Send successful response.
   * @param {object} res - Express response object.
   * @param {object} data - Data object.
   * @param {string} message - Message string.
   * @param {*} statusCode - StatusCode parameter.
   * @example
   * // Usage example
   * const result = await sendSuccess({ data: 'example', message: 'example', statusCode: 'example' });
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {*} - Operation result.
   */
  sendSuccess(res, data, message = 'Success', statusCode = 200) {
    res.status(statusCode).json({
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send error response.
   * @param {object} res - Express response object.
   * @param {string} message - Message string.
   * @param {*} statusCode - StatusCode parameter.
   * @param {*} details - Details parameter.
   * @example
   * // Usage example
   * const result = await sendError({ message: 'example', statusCode: 'example', details: 'example' });
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {*} - Operation result.
   */
  sendError(res, message, statusCode = 500, details = null) {
    const response = {
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    };

    if (details) {
      response.details = details;
    }

    res.status(statusCode).json(response);
  }
}

module.exports = UserManagementController;
