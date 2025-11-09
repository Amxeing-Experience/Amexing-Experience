/**
 * EmployeesController - RESTful API for Amexing Employee Management.
 * Provides Ajax-ready endpoints for managing Amexing employee users (employee_amexing role).
 * Restricted to SuperAdmin and Admin roles.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE, PATCH)
 * - SuperAdmin/Admin access control
 * - Manages: employee_amexing role users only
 * - Comprehensive security, validation, and audit logging.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 0.1.0
 * @example
 * Usage example:
 * const controller = new EmployeesController();
 * await controller.getEmployees(req, res);
 */

const UserManagementService = require('../../services/UserManagementService');
const logger = require('../../../infrastructure/logger');

/**
 * EmployeesController class implementing RESTful API for employee management.
 * Follows REST conventions and provides comprehensive error handling.
 */
/* eslint-disable max-lines */
class EmployeesController {
  constructor() {
    this.userService = new UserManagementService();
    this.maxPageSize = 100;
    this.defaultPageSize = 25;
    this.employeeRole = 'employee_amexing';
    this.allowedEmployeeRoles = ['employee_amexing', 'driver'];
  }

  /**
   * GET /api/employees - Get employee users (employee_amexing role) with filtering and pagination.
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
   * GET /api/employees?page=1&limit=10&active=true
   */
  async getEmployees(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Parse and validate query parameters
      const options = this.parseQueryParams(req.query);

      // Add role filter to get both employee_amexing and driver users
      options.filters = options.filters || {};
      options.filters.roleNames = ['employee_amexing', 'driver'];

      // Get employee users from service (filters by organization 'amexing' and roles 'employee_amexing' or 'driver')
      // Permission validation is done in middleware
      const result = await this.userService.getUsers(currentUser, options);

      // Add metadata for frontend consumption
      const response = {
        ...result,
        requestMetadata: {
          endpoint: 'getEmployees',
          requestedBy: currentUser.id,
          requestedRole: req.userRole,
          timestamp: new Date(),
          queryParams: options,
        },
      };

      this.sendSuccess(res, response, 'Employees retrieved successfully');
    } catch (error) {
      logger.error('Error in EmployeesController.getEmployees', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        userRole: req.userRole,
        queryParams: req.query,
      });

      // Send detailed error for debugging
      this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to retrieve employees',
        500
      );
    }
  }

  /**
   * GET /api/employees/:id - Get single employee by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/employees/abc123
   */
  async getEmployeeById(req, res) {
    try {
      const currentUser = req.user;
      const employeeId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!employeeId) {
        return this.sendError(res, 'Employee ID is required', 400);
      }

      // Get user directly from Parse (same pattern as POIController)
      const Parse = require('parse/node');
      const query = new Parse.Query('AmexingUser');
      query.equalTo('exists', true);
      query.include('roleId');

      let user;
      try {
        logger.info('Attempting to fetch employee', { employeeId });
        user = await query.get(employeeId, { useMasterKey: true });
        logger.info('Employee fetched successfully', { employeeId, userId: user.id });
      } catch (parseError) {
        logger.error('Parse error getting employee', {
          employeeId,
          error: parseError.message,
          code: parseError.code,
          stack: parseError.stack,
        });
        return this.sendError(res, `Employee not found: ${parseError.message}`, 404);
      }

      if (!user) {
        return this.sendError(res, 'Employee not found', 404);
      }

      // Get role information with better null handling
      let rolePointer = null;
      let roleString = null;
      let roleName = null;

      try {
        rolePointer = user.get('roleId');
        roleString = user.get('role');

        // Try to get role name from multiple sources
        if (roleString) {
          roleName = roleString;
        } else if (rolePointer && typeof rolePointer.get === 'function') {
          try {
            roleName = rolePointer.get('name');
          } catch (roleError) {
            logger.warn('Error getting role name from pointer', {
              employeeId,
              rolePointerId: rolePointer.id,
              error: roleError.message,
            });
          }
        }
      } catch (roleAccessError) {
        logger.error('Error accessing role information', {
          employeeId,
          error: roleAccessError.message,
        });
      }

      // Log detailed role information for debugging
      logger.info('Getting employee by ID - Role details', {
        employeeId,
        roleString,
        rolePointer: rolePointer ? { id: rolePointer.id, className: rolePointer.className } : null,
        roleName,
        currentUserId: currentUser.id,
      });

      // Format employee data
      let employeeData;
      try {
        employeeData = {
          id: user.id,
          objectId: user.id,
          firstName: user.get('firstName') || '',
          lastName: user.get('lastName') || '',
          email: user.get('email') || '',
          phone: user.get('phone') || '',
          role: roleName,
          roleId: rolePointer
            ? {
              id: rolePointer.id,
              name: roleName,
            }
            : null,
          contextualData: {
            department: user.get('department') || '',
            position: user.get('position') || '',
            notes: user.get('notes') || '',
          },
          active: user.get('active') !== false,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        };
      } catch (dataError) {
        logger.error('Error formatting employee data', {
          employeeId,
          error: dataError.message,
          stack: dataError.stack,
        });
        return this.sendError(res, 'Error formatting employee data', 500);
      }

      // Verify user is an employee (employee_amexing or driver role)
      // Note: SuperAdmin and Admin can edit any employee, permission validation is done in middleware
      if (!roleName || !this.allowedEmployeeRoles.includes(roleName)) {
        logger.warn('User role not allowed', {
          employeeId,
          roleName,
          allowedRoles: this.allowedEmployeeRoles,
        });
        return this.sendError(
          res,
          `User is not an employee (allowed roles: ${this.allowedEmployeeRoles.join(', ')}, found: ${roleName || 'none'})`,
          403
        );
      }

      this.sendSuccess(res, { employee: employeeData }, 'Employee retrieved successfully');
    } catch (error) {
      logger.error('Error in EmployeesController.getEmployeeById', {
        error: error.message,
        stack: error.stack,
        employeeId: req.params.id,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * POST /api/employees - Create new employee user (employee_amexing role).
   * Only SuperAdmin and Admin can create employees.
   * Automatically generates secure password and forces password change on first login.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * POST /api/employees
   * Body: {
   *   firstName: 'John',
   *   lastName: 'Doe',
   *   email: 'john@amexing.com',
   *   phone: '+52 999 123 4567',
   *   department: 'Operations',
   *   notes: 'Operations coordinator'
   * }
   */
  /* eslint-disable max-lines-per-function */
  async createEmployee(req, res) {
    try {
      const currentUser = req.user;
      const employeeData = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Validate user role (only superadmin and admin can create employees)
      const currentUserRole = req.userRole || currentUser.role || currentUser.get?.('role');
      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return this.sendError(res, 'Access denied. Only SuperAdmin or Admin can create employees.', 403);
      }

      // Validate required fields
      const missingFields = [];
      if (!employeeData.firstName?.toString().trim()) missingFields.push('firstName');
      if (!employeeData.lastName?.toString().trim()) missingFields.push('lastName');
      if (!employeeData.email?.toString().trim()) missingFields.push('email');
      if (!employeeData.role?.toString().trim()) missingFields.push('role');

      if (missingFields.length > 0) {
        return this.sendError(res, `Campos requeridos faltantes: ${missingFields.join(', ')}`, 400);
      }

      // Validate role (only employee_amexing and driver are allowed)
      const allowedRoles = ['employee_amexing', 'driver'];
      if (!allowedRoles.includes(employeeData.role)) {
        return this.sendError(res, `Rol inválido. Los roles permitidos son: ${allowedRoles.join(', ')}`, 400);
      }

      // Email format validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(employeeData.email)) {
        return this.sendError(res, 'Formato de email inválido', 400);
      }

      // Generate username from email (lowercase)
      employeeData.username = employeeData.email.toLowerCase();

      // Force Amexing organization
      employeeData.organizationId = 'amexing';

      // Find and assign the roleId based on the provided role
      const Parse = require('parse/node');
      const roleQuery = new Parse.Query('Role');
      roleQuery.equalTo('name', employeeData.role); // Use role from body
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
      // Keep role field as provided

      // Generate secure random password
      employeeData.password = this.generateSecurePassword();
      employeeData.mustChangePassword = true;

      // Store employee info in contextualData for easy retrieval and filtering
      employeeData.contextualData = {
        department: employeeData.department || null,
        position: employeeData.position || null,
        notes: employeeData.notes || '',
        createdVia: 'admin_panel',
      };

      // Add role to currentUser object for service validation
      // This is needed because Parse User doesn't expose .role directly
      const userWithRole = currentUser;
      userWithRole.role = currentUserRole;

      // Create employee user via UserManagementService
      const result = await this.userService.createUser(employeeData, userWithRole);

      logger.info('Employee created successfully', {
        employeeId: result.id,
        email: employeeData.email,
        department: employeeData.department,
        createdBy: currentUser.id,
        createdByRole: currentUserRole,
      });

      // Return success (password NOT included in response)
      // Note: result IS the employee (transformed by transformUserToSafeFormat)
      this.sendSuccess(
        res,
        {
          employee: result,
          message: 'Empleado creado exitosamente. Se ha generado una contraseña temporal.',
        },
        'Empleado creado exitosamente',
        201
      );
    } catch (error) {
      logger.error('Error in EmployeesController.createEmployee', {
        error: error.message,
        stack: error.stack,
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
   * PUT /api/employees/:id - Update employee user.
   * Only SuperAdmin and Admin can update employees.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * PUT /api/employees/abc123
   * Body: { firstName: 'Jane', active: true, department: 'Logistics' }
   */
  async updateEmployee(req, res) {
    try {
      const currentUser = req.user;
      const employeeId = req.params.id;
      const updateData = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!employeeId) {
        return this.sendError(res, 'Employee ID is required', 400);
      }

      // Validate user role (only superadmin and admin can update employees)
      const currentUserRole = req.userRole || currentUser.role || currentUser.get?.('role');
      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return this.sendError(res, 'Access denied. Only SuperAdmin or Admin can modify employees.', 403);
      }

      // Enrich currentUser with role property for service layer compatibility
      if (!currentUser.role && currentUserRole) {
        currentUser.role = currentUserRole;
      }

      // Prevent role change - employees must be either employee_amexing or driver
      const allowedEmployeeRoles = ['employee_amexing', 'driver'];
      if (updateData.role && !allowedEmployeeRoles.includes(updateData.role)) {
        return this.sendError(
          res,
          `Cannot change employee role. Must be one of: ${allowedEmployeeRoles.join(', ')}`,
          400
        );
      }

      // Update user using service
      const result = await this.userService.updateUser(employeeId, updateData, currentUser);

      this.sendSuccess(res, result, 'Employee updated successfully');
    } catch (error) {
      logger.error('Error in EmployeesController.updateEmployee', {
        error: error.message,
        employeeId: req.params.id,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * DELETE /api/employees/:id - Deactivate (soft delete) employee user.
   * Only SuperAdmin and Admin can delete employees.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * DELETE /api/employees/abc123
   */
  async deactivateEmployee(req, res) {
    try {
      const currentUser = req.user;
      const employeeId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!employeeId) {
        return this.sendError(res, 'Employee ID is required', 400);
      }

      // Validate user role (only superadmin and admin can delete employees)
      const currentUserRole = req.userRole || currentUser.role || currentUser.get?.('role');
      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return this.sendError(res, 'Access denied. Only SuperAdmin or Admin can delete employees.', 403);
      }

      // Enrich currentUser with role property for service layer compatibility
      if (!currentUser.role && currentUserRole) {
        currentUser.role = currentUserRole;
      }

      // Deactivate employee using service
      const result = await this.userService.deactivateUser(employeeId, currentUser);

      this.sendSuccess(res, result, 'Employee deactivated successfully');
    } catch (error) {
      logger.error('Error in EmployeesController.deactivateEmployee', {
        error: error.message,
        employeeId: req.params.id,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * PATCH /api/employees/:id/toggle-status - Toggle active/inactive status.
   * Only SuperAdmin and Admin can toggle employee status.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * PATCH /api/employees/abc123/toggle-status
   * Body: { active: false }
   */
  async toggleEmployeeStatus(req, res) {
    try {
      const currentUser = req.user;
      const employeeId = req.params.id;
      const { active } = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!employeeId) {
        return this.sendError(res, 'Employee ID is required', 400);
      }

      if (typeof active !== 'boolean') {
        return this.sendError(res, 'Active status must be a boolean', 400);
      }

      // Validate user role (only superadmin and admin can toggle employee status)
      const currentUserRole = req.userRole || currentUser.role || currentUser.get?.('role');

      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return this.sendError(res, 'Access denied. Only SuperAdmin or Admin can modify employee status.', 403);
      }

      // Enrich currentUser with role property for service layer compatibility
      // The service expects currentUser.role, but Parse objects use .get('role')
      if (!currentUser.role && currentUserRole) {
        currentUser.role = currentUserRole;
      }

      // Toggle status using service
      const result = await this.userService.toggleUserStatus(
        currentUser,
        employeeId,
        active,
        'Status changed via employees dashboard'
      );

      // Check if the operation was successful before responding
      if (!result.success) {
        return this.sendError(res, result.message || 'Failed to toggle employee status', 403);
      }

      this.sendSuccess(res, result, `Employee ${active ? 'activated' : 'deactivated'} successfully`);
    } catch (error) {
      logger.error('Error in EmployeesController.toggleEmployeeStatus', {
        error: error.message,
        employeeId: req.params.id,
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

module.exports = EmployeesController;
