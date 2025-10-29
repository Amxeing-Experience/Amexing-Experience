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
const { logReadAccess, logBulkReadAccess } = require('../../utils/auditHelper');

/**
 * ClientsController class implementing RESTful API for client management.
 * Follows REST conventions and provides comprehensive error handling.
 */
/* eslint-disable max-lines */
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

      // PCI DSS Audit: Log bulk READ access to client data
      if (result.users && result.users.length > 0) {
        await logBulkReadAccess(req, result.users, 'Client', options);
      }

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
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to retrieve clients',
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
        return this.sendError(res, 'User is not a client (department_manager)', 403);
      }

      // PCI DSS Audit: Log individual READ access to client data
      await logReadAccess(req, user, 'Client');

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
  /* eslint-disable max-lines-per-function */
  async createClient(req, res) {
    try {
      const currentUser = req.user;
      const clientData = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Validate user role (only superadmin and admin can create clients)
      const currentUserRole = req.userRole || currentUser.role || currentUser.get?.('role');
      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return this.sendError(res, 'Access denied. Only SuperAdmin or Admin can create clients.', 403);
      }

      // Validate required fields
      const missingFields = [];
      if (!clientData.firstName?.trim()) missingFields.push('firstName');
      if (!clientData.lastName?.trim()) missingFields.push('lastName');
      if (!clientData.email?.trim()) missingFields.push('email');
      if (!clientData.companyName?.trim()) missingFields.push('companyName');

      if (missingFields.length > 0) {
        return this.sendError(res, `Campos requeridos faltantes: ${missingFields.join(', ')}`, 400);
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
      const result = await this.userService.createUser(clientData, userWithRole);

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
          message: 'Cliente creado exitosamente. Se ha generado una contraseña temporal.',
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
      const currentUserRole = req.userRole || currentUser.role || currentUser.get?.('role');
      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return this.sendError(res, 'Access denied. Only SuperAdmin or Admin can modify clients.', 403);
      }

      // Prevent role change - clients must remain department_manager
      if (updateData.role && updateData.role !== this.clientRole) {
        return this.sendError(res, `Cannot change client role. Must be ${this.clientRole}`, 400);
      }

      // Update user using service
      const result = await this.userService.updateUser(clientId, updateData, currentUser);

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
      const currentUserRole = req.userRole || currentUser.role || currentUser.get?.('role');
      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return this.sendError(res, 'Access denied. Only SuperAdmin or Admin can delete clients.', 403);
      }

      // Deactivate client using service
      const result = await this.userService.deactivateUser(clientId, currentUser);

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
      const currentUserRole = req.userRole || currentUser.role || currentUser.get?.('role');
      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return this.sendError(res, 'Access denied. Only SuperAdmin or Admin can modify client status.', 403);
      }

      // Toggle status using service
      const result = await this.userService.toggleUserStatus(
        currentUser,
        clientId,
        active,
        'Status changed via clients dashboard'
      );

      this.sendSuccess(res, result, `Client ${active ? 'activated' : 'deactivated'} successfully`);
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
   * @example parseQueryParams({ page: '1', limit: '10', active: 'true' });
   */
  /* eslint-disable max-lines-per-function */
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
    for (let i = 0; i < 8; i += 1) {
      password += allChars[Math.floor(Math.random() * allChars.length)];
    }

    // Shuffle the password to avoid predictable patterns
    password = password
      .split('')
      .sort(() => Math.random() - 0.5)
      .join('');

    return password;
  }

  /**
   * GET /api/clients/active - Get active clients for dropdown/selector.
   * Returns simplified client data formatted for Tom Select component.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/clients/active
   * Response: {success: true, data: [{value: 'id', label: 'Company Name', email: 'email@domain.com', contactPerson: 'John Doe', phone: '+52...'}]}
   */
  async getActiveClients(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Get all active clients with role department_manager
      const options = {
        targetRole: this.clientRole,
        active: true,
        exists: true,
        limit: 1000, // Get all for selector
        page: 1,
        sortField: 'lastName',
        sortDirection: 'asc',
      };

      const result = await this.userService.getUsers(currentUser, options);

      // Transform to Tom Select format
      const clients = result.users.map((user) => {
        const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;
        const companyName = user.contextualData?.companyName?.trim();

        // Format: "Nombre Apellido (Empresa)" or just "Nombre Apellido"
        const label = companyName ? `${fullName} (${companyName})` : fullName;

        return {
          value: user.id,
          label,
          email: user.email,
          contactPerson: fullName,
          phone: user.phone || '',
        };
      });

      logger.info('Active clients retrieved for selector', {
        count: clients.length,
        requestedBy: currentUser.id,
      });

      this.sendSuccess(res, clients, 'Active clients retrieved successfully');
    } catch (error) {
      logger.error('Error in ClientsController.getActiveClients', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to retrieve active clients',
        500
      );
    }
  }

  /**
   * POST /api/clients/quick - Quick client creation for quotes.
   * Creates a minimal client with basic information for immediate use in quotes.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * POST /api/clients/quick
   * Body: {firstName: 'John', lastName: 'Doe', email: 'john@example.com', companyName: 'ACME Corp', phone: '+52...'}
   */
  async createQuickClient(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const {
        firstName, lastName, email, companyName, phone,
      } = req.body;

      // Validation
      if (!firstName || !firstName.trim()) {
        return this.sendError(res, 'First name is required', 400);
      }

      if (!lastName || !lastName.trim()) {
        return this.sendError(res, 'Last name is required', 400);
      }

      // Email is optional for now, but if provided must be valid
      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return this.sendError(res, 'Invalid email format', 400);
        }
      }

      // Generate a temporary email if none provided
      // Use crypto.randomUUID() for better uniqueness than timestamp
      const uniqueId = email ? null : require('crypto').randomUUID().substring(0, 8);
      const userEmail = email || `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${uniqueId}@temp.amexing.com`;

      // Debug logging for email generation
      console.log('[DEBUG] createQuickClient - Generated email:', userEmail);

      // Prepare client data
      const clientData = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: userEmail,
        phone: phone?.trim() || '',
        role: this.clientRole, // For validation
        roleId: this.clientRole, // Will be converted to Pointer later
        organizationId: 'client',
        password: this.generateSecurePassword(),
        active: true,
        exists: true, // MANDATORY: Required for all database records (CLAUDE.md standard)
        contextualData: {
          companyName: companyName?.trim() || '',
          quickCreated: true,
          createdFrom: 'quote',
          createdBy: currentUser.id,
        },
        createdBy: currentUser.id, // Pass user ID as string for Pointer creation
        modifiedBy: currentUser.id, // Pass user ID as string for Pointer creation
      };

      // For quick client creation, we need to bypass permission checks in the service
      // Create a mock user object with superadmin role for permission validation
      const enrichedUser = {
        id: currentUser.id,
        email: currentUser.email || 'system@amexing.com',
        role: 'superadmin', // Use superadmin to bypass permission checks
        firstName: 'System',
        lastName: 'User',
      };

      // Create client using service
      // Note: createUser(userData, createdBy) - parameters in correct order
      // Pass enrichedUser for permission checks only (actual createdBy is in clientData)
      const newClient = await this.userService.createUser(clientData, enrichedUser);

      // Prepare display label
      const fullName = `${firstName} ${lastName}`;
      const displayCompany = clientData.contextualData.companyName?.trim();

      // Format: "Nombre Apellido (Empresa)" or just "Nombre Apellido"
      const label = displayCompany ? `${fullName} (${displayCompany})` : fullName;

      logger.info('Quick client created successfully', {
        clientId: newClient.id,
        email: newClient.email,
        companyName: displayCompany,
        createdBy: enrichedUser.id,
      });

      const response = {
        value: newClient.id,
        label,
        email: newClient.email,
        contactPerson: fullName,
        phone: clientData.phone,
      };

      res.status(201).json({
        success: true,
        data: response,
        message: 'Quick client created successfully',
      });
    } catch (error) {
      // Debug logging for error details
      console.log('[DEBUG] createQuickClient error:', {
        message: error.message,
        code: error.code,
        stack: error.stack,
      });

      logger.error('Error in ClientsController.createQuickClient', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        body: req.body,
      });

      // Handle duplicate email error
      if (error.message && error.message.includes('email')) {
        return this.sendError(res, 'Email already exists', 409);
      }

      this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to create quick client',
        500
      );
    }
  }
}

module.exports = ClientsController;
