/**
 * ClientsController - RESTful API for Client Management.
 * Provides Ajax-ready endpoints for managing client organization users (department_manager role).
 * Restricted to SuperAdmin, Admin, and employee_amexing with specific permission.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE, PATCH)
 * - SuperAdmin/Admin/employee_amexing (with permission) access control
 * - Manages: department_manager role users only
 * - Comprehensive security, validation, and audit logging.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 0.1.0
 * @example
 * Usage example:
 * const controller = new ClientsController();
 * await controller.getClients(req, res);
 */

const UserManagementService = require('../../services/UserManagementService');
const logger = require('../../../infrastructure/logger');

/**
 * ClientsController class implementing RESTful API for client management.
 * Follows REST conventions and provides comprehensive error handling.
 */
class ClientsController {
  constructor() {
    this.userService = new UserManagementService();
    this.maxPageSize = 100;
    this.defaultPageSize = 25;
    this.clientRole = 'department_manager';
  }

  /**
   * GET /api/clients - Get client users (department_manager role) with filtering and pagination.
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
   * GET /api/clients?page=1&limit=10&active=true
   */
  async getClients(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Parse and validate query parameters
      const options = this.parseQueryParams(req.query);

      // Add role filter to specifically get department_manager users
      options.targetRole = this.clientRole;

      // Get client users from service (filters by organization 'client' and role 'department_manager')
      // Permission validation is done in middleware
      const result = await this.userService.getUsers(currentUser, options);

      // Add metadata for frontend consumption
      const response = {
        ...result,
        requestMetadata: {
          endpoint: 'getClients',
          requestedBy: currentUser.id,
          requestedRole: req.userRole,
          timestamp: new Date(),
          queryParams: options,
        },
      };

      this.sendSuccess(res, response, 'Clients retrieved successfully');
    } catch (error) {
      logger.error('Error in ClientsController.getClients', {
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
          : 'Failed to retrieve clients',
        500
      );
    }
  }

  /**
   * GET /api/clients/:id - Get single client by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/clients/abc123
   */
  async getClientById(req, res) {
    try {
      const currentUser = req.user;
      const clientId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!clientId) {
        return this.sendError(res, 'Client ID is required', 400);
      }

      // Get user from service
      const user = await this.userService.getUserById(currentUser, clientId);

      if (!user) {
        return this.sendError(res, 'Client not found', 404);
      }

      // Verify user is a client (department_manager role)
      const role = user.roleId || user.role;
      const roleName = typeof role === 'string' ? role : role?.name;

      if (roleName !== this.clientRole) {
        return this.sendError(
          res,
          'User is not a client (department_manager)',
          403
        );
      }

      this.sendSuccess(res, { client: user }, 'Client retrieved successfully');
    } catch (error) {
      logger.error('Error in ClientsController.getClientById', {
        error: error.message,
        clientId: req.params.id,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * POST /api/clients - Create new client user (department_manager role).
   * Only SuperAdmin and Admin can create clients.
   * Automatically generates secure password and forces password change on first login.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * POST /api/clients
   * Body: {
   *   firstName: 'John',
   *   lastName: 'Doe',
   *   email: 'john@company.com',
   *   companyName: 'ACME Corp',
   *   phone: '+52 999 123 4567',
   *   taxId: 'ABC123456XXX',
   *   website: 'https://acme.com',
   *   address: { street: 'Main St 123', city: 'Merida', state: 'Yucatan', zipCode: '97000', country: 'Mexico' },
   *   notes: 'Premium client'
   * }
   */
  async createClient(req, res) {
    try {
      const currentUser = req.user;
      const clientData = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Validate user role (only superadmin and admin can create clients)
      const currentUserRole = req.userRole
        || currentUser.role
        || currentUser.get?.('role');
      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return this.sendError(
          res,
          'Access denied. Only SuperAdmin or Admin can create clients.',
          403
        );
      }

      // Validate required fields
      const requiredFields = ['firstName', 'lastName', 'email', 'companyName'];
      const missingFields = requiredFields.filter(
        (field) => !clientData[field]?.trim()
      );

      if (missingFields.length > 0) {
        return this.sendError(
          res,
          `Campos requeridos faltantes: ${missingFields.join(', ')}`,
          400
        );
      }

      // Email format validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(clientData.email)) {
        return this.sendError(res, 'Formato de email inválido', 400);
      }

      // Generate username from email (lowercase)
      clientData.username = clientData.email.toLowerCase();

      // Force client organization
      clientData.organizationId = 'client';

      // Find and assign the department_manager roleId
      const Parse = require('parse/node');
      const roleQuery = new Parse.Query('Role');
      roleQuery.equalTo('name', this.clientRole); // 'department_manager'
      roleQuery.equalTo('active', true);
      roleQuery.equalTo('exists', true);
      const roleObject = await roleQuery.first({ useMasterKey: true });

      if (!roleObject) {
        throw new Error(
          `Role '${this.clientRole}' not found in database. Please ensure roles are properly configured.`
        );
      }

      // Set roleId as Pointer to Role object
      clientData.roleId = roleObject.id;
      // Also set legacy role field for backward compatibility
      clientData.role = this.clientRole;

      // Generate secure random password
      clientData.password = this.generateSecurePassword();
      clientData.mustChangePassword = true;

      // Store company info in contextualData for easy retrieval and filtering
      clientData.contextualData = {
        companyName: clientData.companyName,
        taxId: clientData.taxId || null,
        website: clientData.website || null,
        notes: clientData.notes || '',
        createdVia: 'admin_panel',
      };

      // Add role to currentUser object for service validation
      // This is needed because Parse User doesn't expose .role directly
      const userWithRole = currentUser;
      userWithRole.role = currentUserRole;

      // Create client user via UserManagementService
      const result = await this.userService.createUser(
        clientData,
        userWithRole
      );

      logger.info('Client created successfully', {
        clientId: result.user?.id,
        companyName: clientData.companyName,
        email: clientData.email,
        createdBy: currentUser.id,
        createdByRole: currentUserRole,
      });

      // Return success (password NOT included in response)
      this.sendSuccess(
        res,
        {
          client: result.user,
          message:
            'Cliente creado exitosamente. Se ha generado una contraseña temporal.',
        },
        'Cliente creado exitosamente',
        201
      );
    } catch (error) {
      logger.error('Error in ClientsController.createClient', {
        error: error.message,
        stack: error.stack,
        currentUser: req.user?.id,
        clientData: { ...req.body, password: '[REDACTED]' },
      });

      // Handle specific errors
      if (error.message.includes('already exists')) {
        return this.sendError(res, 'Ya existe un usuario con ese email', 409);
      }

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * PUT /api/clients/:id - Update client user.
   * Only SuperAdmin and Admin can update clients.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * PUT /api/clients/abc123
   * Body: { firstName: 'Jane', active: true, companyName: 'ACME Corporation' }
   */
  async updateClient(req, res) {
    try {
      const currentUser = req.user;
      const clientId = req.params.id;
      const updateData = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!clientId) {
        return this.sendError(res, 'Client ID is required', 400);
      }

      // Validate user role (only superadmin and admin can update clients)
      const currentUserRole = req.userRole
        || currentUser.role
        || currentUser.get?.('role');
      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return this.sendError(
          res,
          'Access denied. Only SuperAdmin or Admin can modify clients.',
          403
        );
      }

      // Prevent role change - clients must remain department_manager
      if (updateData.role && updateData.role !== this.clientRole) {
        return this.sendError(
          res,
          `Cannot change client role. Must be ${this.clientRole}`,
          400
        );
      }

      // Update user using service
      const result = await this.userService.updateUser(
        clientId,
        updateData,
        currentUser
      );

      this.sendSuccess(res, result, 'Client updated successfully');
    } catch (error) {
      logger.error('Error in ClientsController.updateClient', {
        error: error.message,
        clientId: req.params.id,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * DELETE /api/clients/:id - Deactivate (soft delete) client user.
   * Only SuperAdmin and Admin can delete clients.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * DELETE /api/clients/abc123
   */
  async deactivateClient(req, res) {
    try {
      const currentUser = req.user;
      const clientId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!clientId) {
        return this.sendError(res, 'Client ID is required', 400);
      }

      // Validate user role (only superadmin and admin can delete clients)
      const currentUserRole = req.userRole
        || currentUser.role
        || currentUser.get?.('role');
      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return this.sendError(
          res,
          'Access denied. Only SuperAdmin or Admin can delete clients.',
          403
        );
      }

      // Deactivate client using service
      const result = await this.userService.deactivateUser(
        clientId,
        currentUser
      );

      this.sendSuccess(res, result, 'Client deactivated successfully');
    } catch (error) {
      logger.error('Error in ClientsController.deactivateClient', {
        error: error.message,
        clientId: req.params.id,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * PATCH /api/clients/:id/toggle-status - Toggle active/inactive status.
   * Only SuperAdmin and Admin can toggle client status.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * PATCH /api/clients/abc123/toggle-status
   * Body: { active: false }
   */
  async toggleClientStatus(req, res) {
    try {
      const currentUser = req.user;
      const clientId = req.params.id;
      const { active } = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!clientId) {
        return this.sendError(res, 'Client ID is required', 400);
      }

      if (typeof active !== 'boolean') {
        return this.sendError(res, 'Active status must be a boolean', 400);
      }

      // Validate user role (only superadmin and admin can toggle client status)
      const currentUserRole = req.userRole
        || currentUser.role
        || currentUser.get?.('role');
      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return this.sendError(
          res,
          'Access denied. Only SuperAdmin or Admin can modify client status.',
          403
        );
      }

      // Toggle status using service
      const result = await this.userService.toggleUserStatus(
        currentUser,
        clientId,
        active,
        'Status changed via clients dashboard'
      );

      this.sendSuccess(
        res,
        result,
        `Client ${active ? 'activated' : 'deactivated'} successfully`
      );
    } catch (error) {
      logger.error('Error in ClientsController.toggleClientStatus', {
        error: error.message,
        clientId: req.params.id,
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

    // Add search parameter for multi-field search
    if (query.search && query.search.trim()) {
      filters.search = query.search.trim();
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

  /**
   * Generate secure random password for new clients.
   * Creates a 12-character password with guaranteed mixed case, numbers, and symbols.
   * Ensures compliance with Parse Server password validation requirements.
   * @returns {string} - Secure random password.
   * @example
   * const password = this.generateSecurePassword();
   * // Returns something like: "aB3$xY9#mK2!"
   */
  generateSecurePassword() {
    // Character sets for password generation
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    // Using only safe special characters that Parse Server accepts
    const specialChars = '!@#$%^&*';
    const allChars = lowercase + uppercase + numbers + specialChars;

    // Ensure at least one character from each category
    let password = '';
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += specialChars[Math.floor(Math.random() * specialChars.length)];

    // Fill remaining characters (12 total - 4 already added = 8 more)
    for (let i = 0; i < 8; i++) {
      password += allChars[Math.floor(Math.random() * allChars.length)];
    }

    // Shuffle the password to avoid predictable patterns
    password = password
      .split('')
      .sort(() => Math.random() - 0.5)
      .join('');

    return password;
  }
}

module.exports = ClientsController;
