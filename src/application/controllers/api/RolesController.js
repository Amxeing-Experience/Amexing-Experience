/**
 * RolesController - RESTful API for System Role Management
 * Provides Ajax-ready endpoints for viewing system roles.
 * Restricted to SuperAdmin role only.
 *
 * Features:
 * - Read-only access to system roles
 * - SuperAdmin-only access control
 * - Comprehensive role information including permissions
 * - Security audit logging.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 0.1.0
 * @example
 * // Usage example
 * const controller = new RolesController();
 * await controller.getRoles(req, res);
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');

/**
 * RolesController class implementing RESTful API for role viewing.
 * Read-only operations for security and system stability.
 */
/* eslint-disable max-lines */
class RolesController {
  constructor() {
    this.maxPageSize = 100;
    this.defaultPageSize = 25;
  }

  /**
   * GET /api/roles - Get all system roles with filtering and pagination.
   *
   * Query Parameters:
   * - page: Page number (default: 1)
   * - limit: Items per page (default: 25, max: 100)
   * - active: Filter by active status (true/false)
   * - scope: Filter by scope (system/organization/department/operations/public)
   * - organization: Filter by organization (amexing/client/external)
   * - sortField: Field to sort by (default: level)
   * - sortDirection: Sort direction (asc/desc, default: desc).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/roles?page=1&limit=10&active=true
   */
  /* eslint-disable max-lines-per-function */
  async getRoles(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Verify SuperAdmin role - CRITICAL security check
      const userRole = req.userRole || currentUser.get?.('role') || currentUser.role;
      if (userRole !== 'superadmin') {
        logger.warn('Unauthorized role access attempt to /api/roles', {
          userId: currentUser.id,
          userRole,
          ip: req.ip,
        });
        return this.sendError(
          res,
          'Access denied. SuperAdmin role required.',
          403
        );
      }

      // Parse and validate query parameters
      const options = this.parseQueryParams(req.query);

      // Build Parse query
      const query = new Parse.Query('Role');
      query.equalTo('exists', true);

      // Apply filters
      if (options.filters.active !== undefined) {
        query.equalTo('active', options.filters.active);
      }

      if (options.filters.scope) {
        query.equalTo('scope', options.filters.scope);
      }

      if (options.filters.organization) {
        query.equalTo('organization', options.filters.organization);
      }

      if (options.filters.isSystemRole !== undefined) {
        query.equalTo('isSystemRole', options.filters.isSystemRole);
      }

      // To add a role to a new user
      if (
        userRole === 'superadmin'
        && options.filters.viewUsers !== undefined
      ) {
        query.containedIn('name', ['admin', 'superadmin', 'employee_amexing']);
      }

      // Apply sorting
      const sortField = options.sort.field;
      if (options.sort.direction === 'desc') {
        query.descending(sortField);
      } else {
        query.ascending(sortField);
      }

      // Get total count for pagination
      const totalCount = await query.count({ useMasterKey: true });

      // Apply pagination
      const skip = (options.page - 1) * options.limit;
      query.skip(skip);
      query.limit(options.limit);

      // Execute query
      const rolesData = await query.find({ useMasterKey: true });

      // Transform roles to safe JSON format
      const roles = rolesData.map((role) => ({
        id: role.id,
        name: role.get('name'),
        displayName: role.get('displayName'),
        description: role.get('description'),
        level: role.get('level'),
        scope: role.get('scope'),
        organization: role.get('organization'),
        basePermissions: role.get('basePermissions') || [],
        delegatable: role.get('delegatable'),
        inheritsFrom: role.get('inheritsFrom'),
        maxDelegationLevel: role.get('maxDelegationLevel'),
        conditions: role.get('conditions') || {},
        isSystemRole: role.get('isSystemRole'),
        color: role.get('color'),
        icon: role.get('icon'),
        active: role.get('active'),
        createdAt: role.get('createdAt'),
        updatedAt: role.get('updatedAt'),
      }));

      // Calculate pagination metadata
      const totalPages = Math.ceil(totalCount / options.limit);
      const hasNextPage = options.page < totalPages;
      const hasPrevPage = options.page > 1;

      // Log access for audit trail
      logger.info('Roles retrieved successfully', {
        userId: currentUser.id,
        userRole,
        count: roles.length,
        totalCount,
        page: options.page,
        filters: options.filters,
      });

      // Prepare response
      const response = {
        roles,
        pagination: {
          page: options.page,
          limit: options.limit,
          totalCount,
          totalPages,
          hasNextPage,
          hasPrevPage,
        },
        requestMetadata: {
          endpoint: 'getRoles',
          requestedBy: currentUser.id,
          requestedRole: userRole,
          timestamp: new Date(),
          queryParams: options,
        },
      };

      this.sendSuccess(res, response, 'System roles retrieved successfully');
    } catch (error) {
      logger.error('Error in RolesController.getRoles', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        userRole: req.userRole,
        queryParams: req.query,
      });

      // Send detailed error for debugging in development
      this.sendError(
        res,
        process.env.NODE_ENV === 'development'
          ? `Error: ${error.message}`
          : 'Failed to retrieve roles',
        500
      );
    }
  }

  /**
   * GET /api/roles/:id - Get single role by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/roles/abc123
   */
  /* eslint-disable max-lines-per-function */
  async getRoleById(req, res) {
    try {
      const currentUser = req.user;
      const roleId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Verify SuperAdmin role
      const userRole = req.userRole || currentUser.get?.('role') || currentUser.role;
      if (userRole !== 'superadmin') {
        logger.warn('Unauthorized role access attempt to /api/roles/:id', {
          userId: currentUser.id,
          userRole,
          ip: req.ip,
        });
        return this.sendError(
          res,
          'Access denied. SuperAdmin role required.',
          403
        );
      }

      if (!roleId) {
        return this.sendError(res, 'Role ID is required', 400);
      }

      // Query role
      const query = new Parse.Query('Role');
      query.equalTo('exists', true);
      const role = await query.get(roleId, { useMasterKey: true });

      if (!role) {
        return this.sendError(res, 'Role not found', 404);
      }

      // Transform to safe JSON
      const roleData = {
        id: role.id,
        name: role.get('name'),
        displayName: role.get('displayName'),
        description: role.get('description'),
        level: role.get('level'),
        scope: role.get('scope'),
        organization: role.get('organization'),
        basePermissions: role.get('basePermissions') || [],
        delegatable: role.get('delegatable'),
        inheritsFrom: role.get('inheritsFrom'),
        maxDelegationLevel: role.get('maxDelegationLevel'),
        conditions: role.get('conditions') || {},
        isSystemRole: role.get('isSystemRole'),
        color: role.get('color'),
        icon: role.get('icon'),
        active: role.get('active'),
        createdAt: role.get('createdAt'),
        updatedAt: role.get('updatedAt'),
      };

      logger.info('Role retrieved by ID', {
        userId: currentUser.id,
        roleId,
      });

      this.sendSuccess(res, { role: roleData }, 'Role retrieved successfully');
    } catch (error) {
      logger.error('Error in RolesController.getRoleById', {
        error: error.message,
        roleId: req.params.id,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * PUT /api/roles/:id - Update role displayName and/or description.
   * Only SuperAdmin can update roles, and only displayName and description can be modified.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * PUT /api/roles/abc123
   * Body: { displayName: "New Role Name", description: "New description" }
   */
  /* eslint-disable max-lines-per-function */
  async updateRole(req, res) {
    try {
      const currentUser = req.user;
      const roleId = req.params.id;
      const { displayName, description } = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Verify SuperAdmin role
      const userRole = req.userRole || currentUser.get?.('role') || currentUser.role;
      if (userRole !== 'superadmin') {
        logger.warn('Unauthorized role update attempt', {
          userId: currentUser.id,
          userRole,
          roleId,
          ip: req.ip,
        });
        return this.sendError(
          res,
          'Access denied. SuperAdmin role required.',
          403
        );
      }

      // Validate roleId
      if (!roleId) {
        return this.sendError(res, 'Role ID is required', 400);
      }

      // Validate that at least one field is provided
      if (!displayName && description === undefined) {
        return this.sendError(
          res,
          'At least one field (displayName or description) must be provided',
          400
        );
      }

      // Validate displayName if provided
      let trimmedDisplayName = null;
      if (displayName !== undefined) {
        if (typeof displayName !== 'string' || !displayName.trim()) {
          return this.sendError(res, 'Display name cannot be empty', 400);
        }
        trimmedDisplayName = displayName.trim();

        // Validate displayName length
        if (trimmedDisplayName.length > 100) {
          return this.sendError(
            res,
            'Display name cannot exceed 100 characters',
            400
          );
        }
      }

      // Validate description if provided
      let trimmedDescription = null;
      if (description !== undefined) {
        if (typeof description !== 'string') {
          return this.sendError(res, 'Description must be a string', 400);
        }
        trimmedDescription = description.trim();

        // Validate description length (allow empty, but limit max length)
        if (trimmedDescription.length > 500) {
          return this.sendError(
            res,
            'Description cannot exceed 500 characters',
            400
          );
        }
      }

      // Get current role
      const query = new Parse.Query('Role');
      query.equalTo('exists', true);
      const role = await query.get(roleId, { useMasterKey: true });

      if (!role) {
        return this.sendError(res, 'Role not found', 404);
      }

      const currentDisplayName = role.get('displayName');
      const currentDescription = role.get('description') || '';

      // Track changes
      const changes = {};
      let hasChanges = false;

      // Check displayName changes
      if (
        trimmedDisplayName !== null
        && currentDisplayName !== trimmedDisplayName
      ) {
        changes.displayName = {
          old: currentDisplayName,
          new: trimmedDisplayName,
        };
        role.set('displayName', trimmedDisplayName);
        hasChanges = true;
      }

      // Check description changes
      if (
        trimmedDescription !== null
        && currentDescription !== trimmedDescription
      ) {
        changes.description = {
          old: currentDescription,
          new: trimmedDescription,
        };
        role.set('description', trimmedDescription);
        hasChanges = true;
      }

      // Check if no changes were made
      if (!hasChanges) {
        return this.sendError(
          res,
          'No changes detected. The provided values are the same as current values.',
          400
        );
      }

      // Save changes (security: only displayName and description are modified)
      await role.save(null, { useMasterKey: true });

      // Audit logging
      logger.info('Role updated successfully', {
        roleId,
        roleName: role.get('name'),
        changes,
        updatedBy: currentUser.id,
        updatedByEmail: currentUser.get?.('email') || currentUser.email,
        timestamp: new Date().toISOString(),
      });

      // Return updated role
      const updatedRoleData = {
        id: role.id,
        name: role.get('name'),
        displayName: role.get('displayName'),
        description: role.get('description'),
        level: role.get('level'),
        scope: role.get('scope'),
        organization: role.get('organization'),
        active: role.get('active'),
        updatedAt: role.get('updatedAt'),
      };

      this.sendSuccess(
        res,
        { role: updatedRoleData },
        'Role updated successfully'
      );
    } catch (error) {
      logger.error('Error in RolesController.updateRole', {
        error: error.message,
        stack: error.stack,
        roleId: req.params.id,
        userId: req.user?.id,
      });

      this.sendError(
        res,
        process.env.NODE_ENV === 'development'
          ? `Error: ${error.message}`
          : 'Failed to update role',
        500
      );
    }
  }

  // ===== HELPER METHODS =====

  /**
   * Parse and validate query parameters.
   * @param {object} query - Query parameters from request.
   * @returns {object} - Parsed options object.
   * @example parseQueryParams({ page: '1', limit: '10', active: 'true' });
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

    if (query.viewUsers !== undefined) {
      filters.viewUsers = query.viewUsers === 'true';
    }

    if (query.scope) {
      filters.scope = query.scope;
    }

    if (query.organization) {
      filters.organization = query.organization;
    }

    if (query.isSystemRole !== undefined) {
      filters.isSystemRole = query.isSystemRole === 'true';
    }

    const sort = {
      field: query.sortField || 'level',
      direction: query.sortDirection || 'desc',
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
   * @example sendSuccess(res, data, 'Success', 200);
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
   * @example sendError(res, 'Error message', 500);
   */
  sendError(res, message, statusCode = 500) {
    res.status(statusCode).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  }
}

module.exports = RolesController;
