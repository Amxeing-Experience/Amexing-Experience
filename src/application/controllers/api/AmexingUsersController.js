/**
 * AmexingUsersController - RESTful API for Amexing Internal User Management
 * Provides Ajax-ready endpoints for managing Amexing organization users only.
 * Restricted to SuperAdmin and Admin roles.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE)
 * - SuperAdmin/Admin only access control
 * - Manages: superadmin, admin, employee_amexing roles
 * - Comprehensive security, validation, and audit logging.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 0.1.0
 * @example
 * // Usage example
 * const controller = new AmexingUsersController();
 * await controller.getAmexingUsers(req, res);
 */

const UserManagementService = require('../../services/UserManagementService');
const logger = require('../../../infrastructure/logger');

/**
 * AmexingUsersController class implementing RESTful API for Amexing user management.
 * Follows REST conventions and provides comprehensive error handling.
 */
class AmexingUsersController {
  constructor() {
    this.userService = new UserManagementService();
    this.maxPageSize = 100;
    this.defaultPageSize = 25;
    this.allowedRoles = ['superadmin', 'admin', 'employee_amexing'];
  }

  /**
   * GET /api/amexingusers - Get Amexing internal users with filtering and pagination.
   *
   * Query Parameters:
   * - page: Page number (default: 1)
   * - limit: Items per page (default: 25, max: 100)
   * - active: Filter by active status (true/false)
   * - search: Search term for email, firstName, lastName
   * - sortField: Field to sort by (default: lastName)
   * - sortDirection: Sort direction (asc/desc, default: asc).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/amexingusers?page=1&limit=10&active=true
   */
  async getAmexingUsers(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Parse and validate query parameters
      const options = this.parseQueryParams(req.query);

      // Get Amexing users from service (permission validation inside)
      // Pass both user object and explicit role from JWT middleware
      const result = await this.userService.getAmexingUsers(
        currentUser,
        options,
        req.userRole // Pass explicit role from JWT middleware
      );

      // Add metadata for frontend consumption
      const response = {
        ...result,
        requestMetadata: {
          endpoint: 'getAmexingUsers',
          requestedBy: currentUser.id,
          requestedRole: req.userRole,
          timestamp: new Date(),
          queryParams: options,
        },
      };

      this.sendSuccess(res, response, 'Amexing users retrieved successfully');
    } catch (error) {
      logger.error('Error in AmexingUsersController.getAmexingUsers', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        userRole: req.userRole,
        queryParams: req.query,
      });

      // Send detailed error for debugging
      this.sendError(
        res,
        process.env.NODE_ENV === 'development'
          ? `Error: ${error.message}`
          : 'Failed to retrieve users',
        500
      );
    }
  }

  /**
   * GET /api/amexingusers/:id - Get single Amexing user by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/amexingusers/abc123
   */
  async getAmexingUserById(req, res) {
    try {
      const currentUser = req.user;
      const userId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!userId) {
        return this.sendError(res, 'User ID is required', 400);
      }

      // Get user from service
      const user = await this.userService.getUserById(currentUser, userId);

      if (!user) {
        return this.sendError(res, 'User not found', 404);
      }

      // Verify user is from Amexing organization
      const role = user.roleId || user.role;
      if (
        role
        && !this.allowedRoles.includes(typeof role === 'string' ? role : role.name)
      ) {
        return this.sendError(
          res,
          'User is not an Amexing organization user',
          403
        );
      }

      this.sendSuccess(res, { user }, 'User retrieved successfully');
    } catch (error) {
      logger.error('Error in AmexingUsersController.getAmexingUserById', {
        error: error.message,
        userId: req.params.id,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * POST /api/amexingusers - Create new Amexing internal user.
   * Only allows creation of: admin, employee_amexing roles.
   * SuperAdmin creation requires special authorization.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * POST /api/amexingusers
   * Body: { firstName: 'John', lastName: 'Doe', email: 'john@amexing.com', role: 'admin' }
   */
  async createAmexingUser(req, res) {
    try {
      const currentUser = req.user;
      const userData = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Validate role is allowed for Amexing users
      if (userData.role && !this.allowedRoles.includes(userData.role)) {
        return this.sendError(
          res,
          `Invalid role for Amexing user. Allowed: ${this.allowedRoles.join(', ')}`,
          400
        );
      }

      // Only SuperAdmin can create other SuperAdmins
      const currentUserRole = currentUser.role || currentUser.get?.('role');
      if (userData.role === 'superadmin' && currentUserRole !== 'superadmin') {
        return this.sendError(
          res,
          'Only SuperAdmin can create SuperAdmin users',
          403
        );
      }

      // Create user using service
      const result = await this.userService.createUser(userData, currentUser);

      this.sendSuccess(res, result, 'Amexing user created successfully', 201);
    } catch (error) {
      logger.error('Error in AmexingUsersController.createAmexingUser', {
        error: error.message,
        currentUser: req.user?.id,
        userData: { ...req.body, password: undefined },
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * PUT /api/amexingusers/:id - Update Amexing user.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * PUT /api/amexingusers/abc123
   * Body: { firstName: 'Jane', active: true }
   */
  async updateAmexingUser(req, res) {
    try {
      const currentUser = req.user;
      const userId = req.params.id;
      const updateData = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!userId) {
        return this.sendError(res, 'User ID is required', 400);
      }

      // Validate role if being updated
      if (updateData.role && !this.allowedRoles.includes(updateData.role)) {
        return this.sendError(
          res,
          `Invalid role for Amexing user. Allowed: ${this.allowedRoles.join(', ')}`,
          400
        );
      }

      // Update user using service
      const result = await this.userService.updateUser(
        userId,
        updateData,
        currentUser
      );

      this.sendSuccess(res, result, 'Amexing user updated successfully');
    } catch (error) {
      logger.error('Error in AmexingUsersController.updateAmexingUser', {
        error: error.message,
        userId: req.params.id,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * DELETE /api/amexingusers/:id - Deactivate (soft delete) Amexing user.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * DELETE /api/amexingusers/abc123
   */
  async deactivateAmexingUser(req, res) {
    try {
      const currentUser = req.user;
      const userId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!userId) {
        return this.sendError(res, 'User ID is required', 400);
      }

      // Deactivate user using service
      const result = await this.userService.deactivateUser(userId, currentUser);

      this.sendSuccess(res, result, 'Amexing user deactivated successfully');
    } catch (error) {
      logger.error('Error in AmexingUsersController.deactivateAmexingUser', {
        error: error.message,
        userId: req.params.id,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * PATCH /api/amexingusers/:id/toggle-status - Toggle active/inactive status.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * PATCH /api/amexingusers/abc123/toggle-status
   * Body: { active: false }
   */
  async toggleAmexingUserStatus(req, res) {
    try {
      const currentUser = req.user;
      const userId = req.params.id;
      const { active } = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!userId) {
        return this.sendError(res, 'User ID is required', 400);
      }

      if (typeof active !== 'boolean') {
        return this.sendError(res, 'Active status must be a boolean', 400);
      }

      // Toggle status using service
      const result = await this.userService.toggleUserStatus(
        userId,
        active,
        currentUser
      );

      this.sendSuccess(
        res,
        result,
        `User ${active ? 'activated' : 'deactivated'} successfully`
      );
    } catch (error) {
      logger.error('Error in AmexingUsersController.toggleAmexingUserStatus', {
        error: error.message,
        userId: req.params.id,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  // ===== HELPER METHODS =====

  /**
   * Parse and validate query parameters.
   * @param {object} query - Query parameters from request.
   * @returns {object} - Parsed options object.
   * @example
   */
  parseQueryParams(query) {
    const page = parseInt(query.page, 10) || 1;
    let limit = parseInt(query.limit, 10) || this.defaultPageSize;

    // Enforce max page size
    if (limit > this.maxPageSize) {
      limit = this.maxPageSize;
    }

    const filters = {};
    if (query.active !== undefined) {
      filters.active = query.active === 'true';
    }

    if (query.emailVerified !== undefined) {
      filters.emailVerified = query.emailVerified === 'true';
    }

    const sort = {
      field: query.sortField || 'lastName',
      direction: query.sortDirection || 'asc',
    };

    return {
      page,
      limit,
      filters,
      sort,
    };
  }

  /**
   * Send success response.
   * @param {object} res - Express response object.
   * @param {object} data - Data to send.
   * @param {string} message - Success message.
   * @param {number} statusCode - HTTP status code.
   * @example
   */
  sendSuccess(res, data, message = 'Success', statusCode = 200) {
    res.status(statusCode).json({
      success: true,
      data,
      message,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send error response.
   * @param {object} res - Express response object.
   * @param {string} message - Error message.
   * @param {number} statusCode - HTTP status code.
   * @example
   */
  sendError(res, message, statusCode = 500) {
    res.status(statusCode).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  }
}

module.exports = AmexingUsersController;
