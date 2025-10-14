/**
 * ClientEmployeesController - RESTful API for Client Employee Management.
 * Provides Ajax-ready endpoints for managing employees within a client organization.
 * Supports both 'client' (Agent) and 'employee' roles.
 * Restricted to SuperAdmin and Admin.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE, PATCH)
 * - SuperAdmin/Admin access control
 * - Manages: client (Agent) and employee roles only
 * - Validates employee belongs to parent client
 * - Comprehensive security, validation, and audit logging.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 0.1.0
 * @example
 * Usage example:
 * const controller = new ClientEmployeesController();
 * await controller.getEmployees(req, res);
 */

const UserManagementService = require('../../services/UserManagementService');
const logger = require('../../../infrastructure/logger');

/**
 * ClientEmployeesController class implementing RESTful API for employee management within clients.
 * Follows REST conventions and provides comprehensive error handling.
 */
class ClientEmployeesController {
  constructor() {
    this.userService = new UserManagementService();
    this.maxPageSize = 100;
    this.defaultPageSize = 25;
    this.allowedRoles = ['client', 'employee']; // client = Agent, employee = Employee
  }

  /**
   * GET /api/clients/:clientId/employees - Get employees for specific client with filtering and pagination.
   *
   * Query Parameters:
   * - page: Page number (default: 1)
   * - limit: Items per page (default: 25, max: 100)
   * - active: Filter by active status (true/false)
   * - role: Filter by role (client/employee)
   * - search: Search term for email, firstName, lastName
   * - sortField: Field to sort by (default: lastName)
   * - sortDirection: Sort direction (asc/desc, default: asc).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/clients/abc123/employees?page=1&limit=10&role=employee
   */
  async getEmployees(req, res) {
    try {
      const currentUser = req.user;
      const { clientId } = req.params;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!clientId) {
        return this.sendError(res, 'Client ID is required', 400);
      }

      // Validate client exists and is active
      await this.validateClientExists(clientId);

      // Parse and validate query parameters
      const options = this.parseQueryParams(req.query);

      // Add client filter to get only employees of this client
      options.filters.clientId = clientId;

      // Filter by allowed roles only
      options.filters.roleFilter = this.allowedRoles;

      // Get employees from service
      const result = await this.userService.getUsers(currentUser, options);

      // Add metadata for frontend consumption
      const response = {
        ...result,
        requestMetadata: {
          endpoint: 'getEmployees',
          clientId,
          requestedBy: currentUser.id,
          requestedRole: req.userRole,
          timestamp: new Date(),
          queryParams: options,
        },
      };

      this.sendSuccess(res, response, 'Employees retrieved successfully');
    } catch (error) {
      logger.error('Error in ClientEmployeesController.getEmployees', {
        error: error.message,
        stack: error.stack,
        clientId: req.params.clientId,
        userId: req.user?.id,
        userRole: req.userRole,
        queryParams: req.query,
      });

      this.sendError(
        res,
        process.env.NODE_ENV === 'development'
          ? `Error: ${error.message}`
          : 'Failed to retrieve employees',
        500
      );
    }
  }

  /**
   * GET /api/clients/:clientId/employees/:id - Get single employee by ID.
   * Validates employee belongs to specified client.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/clients/abc123/employees/xyz789
   */
  /* eslint-disable max-lines-per-function */
  async getEmployeeById(req, res) {
    try {
      const currentUser = req.user;
      const { clientId } = req.params;
      const employeeId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!clientId || !employeeId) {
        return this.sendError(
          res,
          'Client ID and Employee ID are required',
          400
        );
      }

      // Validate client exists
      await this.validateClientExists(clientId);

      // Get employee from service
      const employee = await this.userService.getUserById(
        currentUser,
        employeeId
      );

      if (!employee) {
        return this.sendError(res, 'Employee not found', 404);
      }

      // Validate employee belongs to this client
      const employeeClientId = employee.clientId
        || employee.get?.('clientId')
        || employee.organizationId
        || employee.get?.('organizationId');

      if (employeeClientId !== clientId) {
        return this.sendError(
          res,
          'Employee does not belong to specified client',
          403
        );
      }

      // Verify employee has allowed role
      const role = employee.roleId || employee.role;
      const roleName = typeof role === 'string' ? role : role?.name;

      if (!this.allowedRoles.includes(roleName)) {
        return this.sendError(
          res,
          `User is not a valid employee role (allowed: ${this.allowedRoles.join(', ')})`,
          403
        );
      }

      this.sendSuccess(res, { employee }, 'Employee retrieved successfully');
    } catch (error) {
      logger.error('Error in ClientEmployeesController.getEmployeeById', {
        error: error.message,
        clientId: req.params.clientId,
        employeeId: req.params.id,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * POST /api/clients/:clientId/employees - Create new employee for client.
   * Supports both 'client' (Agent) and 'employee' roles.
   * Only SuperAdmin and Admin can create employees.
   * Automatically generates secure password and forces password change on first login.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * POST /api/clients/abc123/employees
   * Body: {
   *   firstName: 'John',
   *   lastName: 'Doe',
   *   email: 'john@agency.com',
   *   role: 'client', // or 'employee'
   *   phone: '+52 999 123 4567',
   *   notes: 'Agent representative'
   * }
   */
  /* eslint-disable max-lines-per-function */
  async createEmployee(req, res) {
    try {
      const currentUser = req.user;
      const { clientId } = req.params;
      const employeeData = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!clientId) {
        return this.sendError(res, 'Client ID is required', 400);
      }

      // Validate user role (only superadmin and admin can create employees)
      const currentUserRole = req.userRole;
      if (
        !currentUserRole
        || !['superadmin', 'admin'].includes(currentUserRole)
      ) {
        return this.sendError(
          res,
          'Access denied. Only SuperAdmin or Admin can create employees.',
          403
        );
      }

      // Validate required fields FIRST (before database queries)
      const requiredFields = ['firstName', 'lastName', 'email', 'role'];
      // eslint-disable-next-line security/detect-object-injection
      const missingFields = requiredFields.filter(
        (field) => !employeeData[field]?.toString().trim()
      );

      if (missingFields.length > 0) {
        return this.sendError(
          res,
          `Campos requeridos faltantes: ${missingFields.join(', ')}`,
          400
        );
      }

      // Validate role is allowed
      if (!this.allowedRoles.includes(employeeData.role)) {
        return this.sendError(
          res,
          `Rol inválido. Roles permitidos: ${this.allowedRoles.join(', ')}`,
          400
        );
      }

      // Email format validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(employeeData.email)) {
        return this.sendError(res, 'Formato de email inválido', 400);
      }

      // Validate client exists and is active (after all input validations)
      await this.validateClientExists(clientId);

      // Generate username from email (lowercase)
      employeeData.username = employeeData.email.toLowerCase();

      // Set client as organization
      employeeData.organizationId = clientId;
      employeeData.clientId = clientId;

      // Find and assign the role
      const Parse = require('parse/node');
      const roleQuery = new Parse.Query('Role');
      roleQuery.equalTo('name', employeeData.role);
      roleQuery.equalTo('active', true);
      roleQuery.equalTo('exists', true);
      const roleObject = await roleQuery.first({ useMasterKey: true });

      if (!roleObject) {
        throw new Error(
          `Role '${employeeData.role}' not found in database. Please ensure roles are properly configured.`
        );
      }

      // Set roleId as Pointer to Role object
      employeeData.roleId = roleObject.id;

      // Generate secure random password
      employeeData.password = this.generateSecurePassword();
      employeeData.mustChangePassword = true;

      // Store additional info in contextualData
      employeeData.contextualData = {
        notes: employeeData.notes || '',
        createdVia: 'admin_panel',
        parentClient: clientId,
      };

      // Add role to currentUser object for service validation
      const userWithRole = currentUser;
      userWithRole.role = currentUserRole;

      // Create employee via UserManagementService
      const result = await this.userService.createUser(
        employeeData,
        userWithRole
      );

      logger.info('Employee created successfully for client', {
        employeeId: result.user?.id,
        clientId,
        email: employeeData.email,
        role: employeeData.role,
        createdBy: currentUser.id,
        createdByRole: currentUserRole,
      });

      // Return success (password NOT included in response)
      this.sendSuccess(
        res,
        {
          employee: result.user,
          message:
            'Empleado creado exitosamente. Se ha generado una contraseña temporal.',
        },
        'Empleado creado exitosamente',
        201
      );
    } catch (error) {
      logger.error('Error in ClientEmployeesController.createEmployee', {
        error: error.message,
        stack: error.stack,
        clientId: req.params.clientId,
        currentUser: req.user?.id,
        employeeData: { ...req.body, password: '[REDACTED]' },
      });

      // Handle specific errors
      if (error.message.includes('already exists')) {
        return this.sendError(res, 'Ya existe un usuario con ese email', 409);
      }

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * PUT /api/clients/:clientId/employees/:id - Update employee.
   * Only SuperAdmin and Admin can update employees.
   * Validates employee belongs to client.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * PUT /api/clients/abc123/employees/xyz789
   * Body: { firstName: 'Jane', active: true }
   */
  async updateEmployee(req, res) {
    try {
      const currentUser = req.user;
      const { clientId } = req.params;
      const employeeId = req.params.id;
      const updateData = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!clientId || !employeeId) {
        return this.sendError(
          res,
          'Client ID and Employee ID are required',
          400
        );
      }

      // Validate user role (only superadmin and admin can update employees)
      const currentUserRole = req.userRole;
      if (
        !currentUserRole
        || !['superadmin', 'admin'].includes(currentUserRole)
      ) {
        return this.sendError(
          res,
          'Access denied. Only SuperAdmin or Admin can modify employees.',
          403
        );
      }

      // Validate client exists
      await this.validateClientExists(clientId);

      // Get employee to verify it belongs to client
      const employee = await this.userService.getUserById(
        currentUser,
        employeeId
      );

      if (!employee) {
        return this.sendError(res, 'Employee not found', 404);
      }

      // Validate employee belongs to this client
      const employeeClientId = employee.clientId
        || employee.get?.('clientId')
        || employee.organizationId
        || employee.get?.('organizationId');

      if (employeeClientId !== clientId) {
        return this.sendError(
          res,
          'Employee does not belong to specified client',
          403
        );
      }

      // Prevent role change to invalid roles
      if (updateData.role && !this.allowedRoles.includes(updateData.role)) {
        return this.sendError(
          res,
          `Cannot change to invalid role. Allowed roles: ${this.allowedRoles.join(', ')}`,
          400
        );
      }

      // Add role to currentUser object for service validation
      const userWithRole = currentUser;
      userWithRole.role = currentUserRole;

      // Update user using service
      const result = await this.userService.updateUser(
        employeeId,
        updateData,
        userWithRole
      );

      this.sendSuccess(res, result, 'Employee updated successfully');
    } catch (error) {
      logger.error('Error in ClientEmployeesController.updateEmployee', {
        error: error.message,
        clientId: req.params.clientId,
        employeeId: req.params.id,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * DELETE /api/clients/:clientId/employees/:id - Deactivate (soft delete) employee.
   * Only SuperAdmin and Admin can delete employees.
   * Validates employee belongs to client.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * DELETE /api/clients/abc123/employees/xyz789
   */
  /* eslint-disable max-lines-per-function */
  async deactivateEmployee(req, res) {
    try {
      const currentUser = req.user;
      const { clientId } = req.params;
      const employeeId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!clientId || !employeeId) {
        return this.sendError(
          res,
          'Client ID and Employee ID are required',
          400
        );
      }

      // Validate user role (only superadmin and admin can delete employees)
      const currentUserRole = req.userRole;
      if (
        !currentUserRole
        || !['superadmin', 'admin'].includes(currentUserRole)
      ) {
        return this.sendError(
          res,
          'Access denied. Only SuperAdmin or Admin can delete employees.',
          403
        );
      }

      // Validate client exists
      await this.validateClientExists(clientId);

      // Add role to currentUser object BEFORE calling service methods
      const userWithRole = currentUser;
      userWithRole.role = currentUserRole;

      // Get employee directly using query that includes inactive users
      // We need to use queryExisting instead of getUserById which only gets active users
      const BaseModel = require('../../../domain/models/BaseModel');
      const employeeQuery = BaseModel.queryExisting('AmexingUser');
      employeeQuery.equalTo('objectId', employeeId);

      const employee = await employeeQuery.first({ useMasterKey: true });

      if (!employee) {
        return this.sendError(res, 'Employee not found', 404);
      }

      // Validate employee belongs to this client
      const employeeClientId = employee.get('clientId') || employee.get('organizationId');

      if (employeeClientId !== clientId) {
        return this.sendError(
          res,
          'Employee does not belong to specified client',
          403
        );
      }

      // Deactivate employee using service
      const result = await this.userService.deactivateUser(
        employeeId,
        userWithRole
      );

      this.sendSuccess(res, result, 'Employee deactivated successfully');
    } catch (error) {
      logger.error('Error in ClientEmployeesController.deactivateEmployee', {
        error: error.message,
        clientId: req.params.clientId,
        employeeId: req.params.id,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * PATCH /api/clients/:clientId/employees/:id/toggle-status - Toggle active/inactive status.
   * Only SuperAdmin and Admin can toggle employee status.
   * Validates employee belongs to client.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * PATCH /api/clients/abc123/employees/xyz789/toggle-status
   * Body: { active: false }
   */
  async toggleEmployeeStatus(req, res) {
    try {
      const currentUser = req.user;
      const { clientId } = req.params;
      const employeeId = req.params.id;
      const { active } = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!clientId || !employeeId) {
        return this.sendError(
          res,
          'Client ID and Employee ID are required',
          400
        );
      }

      if (typeof active !== 'boolean') {
        return this.sendError(res, 'Active status must be a boolean', 400);
      }

      // Validate user role (only superadmin and admin can toggle employee status)
      // The role comes from the JWT middleware in req.userRole
      const currentUserRole = req.userRole;

      if (!currentUserRole) {
        logger.error('Toggle employee status - role not found', {
          userId: currentUser.id,
          hasReqUserRole: !!req.userRole,
        });
        return this.sendError(res, 'User role information not available', 500);
      }

      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return this.sendError(
          res,
          'Access denied. Only SuperAdmin or Admin can modify employee status.',
          403
        );
      }

      // Validate client exists
      await this.validateClientExists(clientId);

      // Add role to currentUser object BEFORE calling service methods
      const userWithRole = currentUser;
      userWithRole.role = currentUserRole;

      // Get employee to verify it belongs to client
      const employee = await this.userService.getUserById(
        userWithRole,
        employeeId
      );

      if (!employee) {
        return this.sendError(res, 'Employee not found', 404);
      }

      // Validate employee belongs to this client
      const employeeClientId = employee.clientId
        || employee.get?.('clientId')
        || employee.organizationId
        || employee.get?.('organizationId');

      if (employeeClientId !== clientId) {
        return this.sendError(
          res,
          'Employee does not belong to specified client',
          403
        );
      }

      // Toggle status using service
      const result = await this.userService.toggleUserStatus(
        userWithRole,
        employeeId,
        active,
        'Status changed via client employees dashboard'
      );

      this.sendSuccess(
        res,
        result,
        `Employee ${active ? 'activated' : 'deactivated'} successfully`
      );
    } catch (error) {
      logger.error('Error in ClientEmployeesController.toggleEmployeeStatus', {
        error: error.message,
        clientId: req.params.clientId,
        employeeId: req.params.id,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  // ===== HELPER METHODS =====

  /**
   * Validate that client exists and is active.
   * @param {string} clientId - Client ID to validate.
   * @throws {Error} - If client not found or inactive.
   * @example validateClientExists('abc123');
   * @returns {Promise<void>}
   */
  async validateClientExists(clientId) {
    const Parse = require('parse/node');

    // Query AmexingUser with the clientId
    const clientQuery = new Parse.Query('AmexingUser');
    clientQuery.equalTo('objectId', clientId);
    clientQuery.equalTo('active', true);
    clientQuery.equalTo('exists', true);

    const client = await clientQuery.first({ useMasterKey: true });

    if (!client) {
      throw new Error('Client not found or inactive');
    }

    // Verify it's actually a client (department_manager role)
    // Get the role - it could be a string or a Pointer
    const clientRoleId = client.get('roleId');
    let roleToCheck = null;

    if (typeof clientRoleId === 'string') {
      roleToCheck = clientRoleId;
    } else if (clientRoleId && clientRoleId.id) {
      roleToCheck = clientRoleId.id;
    } else {
      // Fallback to string role field
      const roleString = client.get('role');
      if (roleString === 'department_manager') {
        return client; // Valid client
      }
    }

    // If we have a roleId, validate it's department_manager
    if (roleToCheck) {
      const roleQuery = new Parse.Query('Role');
      roleQuery.equalTo('name', 'department_manager');
      roleQuery.equalTo('active', true);
      roleQuery.equalTo('exists', true);
      const clientRole = await roleQuery.first({ useMasterKey: true });

      if (!clientRole) {
        throw new Error('department_manager role not found in system');
      }

      if (roleToCheck !== clientRole.id) {
        throw new Error('Specified user is not a client (department_manager)');
      }
    }

    return client;
  }

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

    if (query.emailVerified !== undefined) {
      filters.emailVerified = query.emailVerified === 'true';
    }

    // Role filter (client or employee)
    if (query.role && this.allowedRoles.includes(query.role)) {
      filters.targetRole = query.role;
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
   * @example sendError(res, 'Error message', 500);.
   */
  sendError(res, message, statusCode = 500) {
    res.status(statusCode).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Generate secure random password for new employees.
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
}

module.exports = ClientEmployeesController;
