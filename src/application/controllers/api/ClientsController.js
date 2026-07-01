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
   * Requires a secure password to be provided for immediate system access.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * POST /api/clients
   * Body: {
   *   firstName: 'John',
   *   lastName: 'Doe',
   *   email: 'john@company.com',
   *   // password field: string (min 12 chars, upper+lower+digit+special)
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
      if (!clientData.password?.trim()) missingFields.push('password');

      if (missingFields.length > 0) {
        return this.sendError(res, `Campos requeridos faltantes: ${missingFields.join(', ')}`, 400);
      }

      // Email format validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(clientData.email)) {
        return this.sendError(res, 'Formato de email inválido', 400);
      }

      // Password validation
      const password = clientData.password.trim();
      if (password.length < 12) {
        return this.sendError(res, 'La contraseña debe tener al menos 12 caracteres', 400);
      }

      // Validate password complexity (at least one uppercase, one lowercase, one number, one special character)
      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{12,}$/;
      if (!passwordRegex.test(password)) {
        return this.sendError(
          res,
          'La contraseña debe incluir al menos una mayúscula, una minúscula, un número y un carácter especial',
          400
        );
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

      // Use the provided password (already validated above)
      clientData.password = password;
      // Since admin is setting the password directly, client doesn't need to change it immediately
      clientData.mustChangePassword = false;

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
          message: 'Cliente creado exitosamente. Podrá acceder al sistema con la contraseña proporcionada.',
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

      // Prepare the update data structure
      const preparedUpdateData = {
        ...updateData,
      };

      // Handle address data if provided
      if (updateData.address) {
        const processedAddress = this.processAddressData(updateData.address);
        if (processedAddress) {
          preparedUpdateData.address = processedAddress;
        }
      }

      // Handle contextualData fields
      if (
        updateData.companyName !== undefined
        || updateData.taxId !== undefined
        || updateData.website !== undefined
        || updateData.notes !== undefined
      ) {
        // Get the existing user to preserve existing contextualData
        const Parse = require('parse/node');
        const query = new Parse.Query('AmexingUser');
        const existingUser = await query.get(clientId, { useMasterKey: true });
        const existingContextualData = existingUser.get('contextualData') || {};

        preparedUpdateData.contextualData = {
          ...existingContextualData,
          companyName:
            updateData.companyName !== undefined ? updateData.companyName : existingContextualData.companyName,
          taxId: updateData.taxId !== undefined ? updateData.taxId : existingContextualData.taxId,
          website: updateData.website !== undefined ? updateData.website : existingContextualData.website,
          notes: updateData.notes !== undefined ? updateData.notes : existingContextualData.notes,
        };

        // Remove individual fields that are now in contextualData
        delete preparedUpdateData.companyName;
        delete preparedUpdateData.taxId;
        delete preparedUpdateData.website;
        delete preparedUpdateData.notes;
      }

      // Update user using service
      const result = await this.userService.updateUser(clientId, preparedUpdateData, currentUser);

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

      // The auth middleware exposes the role on req.userRole, not always on
      // req.user. Ensure it's present so the service's role-hierarchy check
      // (canModifyUser) can authorize the deactivation instead of treating the
      // admin as role level 0 ("Insufficient permissions").
      if (currentUser && !currentUser.role) {
        currentUser.role = currentUserRole;
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

      // toggleUserStatus returns { success:false, message } on a soft failure (e.g.
      // permission denied) WITHOUT throwing — surface it instead of masking it as a
      // success (that left the agency unchanged while the UI showed "exitoso").
      if (!result || !result.success) {
        return this.sendError(res, result?.message || 'No se pudo cambiar el estado del cliente', 403);
      }

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

  /**
   * Build the AmexingUser query for people-type clients (role 'end_client'), optionally
   * narrowed to a single clientCategory. Shared by the count and fetch passes.
   * @param {object} opts
   * @param {boolean} opts.isCategoryTab - True when filtering one category tab.
   * @param {string} opts.type - The category value when isCategoryTab is true.
   * @param {boolean} opts.includeInactive - Include inactive users when true.
   * @returns {Parse.Query}
   * @example
   */
  buildEndClientQuery({ isCategoryTab, type, includeInactive }) {
    const Parse = require('parse/node');
    // TEMP: hidden per direction; empty this array to re-activate these client types.
    const HIDDEN_CATEGORIES = ['wedding_planner', 'concierge', 'home_owner'];
    const query = new Parse.Query('AmexingUser');
    query.equalTo('role', 'end_client');
    query.equalTo('exists', true);
    // Los clientes de agencia (clientCategory 'agency_client') se gestionan aparte
    // (owned-clients) y NO deben aparecer en el listado/picker de clientes directos Amexing.
    query.notEqualTo('clientCategory', 'agency_client');
    if (isCategoryTab) {
      query.equalTo('clientCategory', type);
    } else if (HIDDEN_CATEGORIES.length) {
      query.notContainedIn('clientCategory', HIDDEN_CATEGORIES);
    }
    if (!includeInactive) {
      query.equalTo('active', true);
    }
    return query;
  }

  /**
   * GET /api/clients/mixed - Get mixed data (agencies and Amexing direct clients).
   * Only for admin/superadmin roles.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/clients/mixed?type=all|agencies|clients&page=1&limit=25
   */
  async getMixedClients(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Only admin/superadmin can access mixed data
      const currentUserRole = req.userRole || currentUser.role || currentUser.get?.('role');
      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return this.sendError(res, 'Access denied. Only Admin or SuperAdmin can access mixed client data.', 403);
      }

      // Parse query parameters
      const Client = require('../../../domain/models/Client');
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(this.maxPageSize, parseInt(req.query.limit, 10) || this.defaultPageSize);
      const skip = (page - 1) * limit;
      // all | agencies | clients (= all direct clients) | a specific clientCategory (wedding_planner, etc.)
      const type = req.query.type || 'all';
      const isCategoryTab = Client.CATEGORIES.includes(type) && type !== 'agency';
      const search = req.query.search?.trim() || '';
      // Admin views can opt in to see inactive clients too (mirrors tours/experiences).
      // Defaults to false so existing consumers keep getting active-only results.
      const includeInactive = req.query.includeInactive === 'true';
      // Sorting (DataTables sends the column's data key + direction). Only allow
      // fields that exist on the formatted rows so the column headers actually sort.
      const allowedSortFields = ['name', 'email', 'active', 'createdAt', 'updatedAt'];
      const sortField = allowedSortFields.includes(req.query.sortField) ? req.query.sortField : 'createdAt';
      const sortDirection = (req.query.sortDirection || 'desc').toLowerCase() === 'asc' ? 1 : -1;

      logger.info('getMixedClients called with filters', {
        type,
        search,
        includeInactive,
        page,
        limit,
        userId: currentUser.id,
      });

      let agencies = [];
      let directClients = [];

      // Get total counts for pagination metadata
      let totalAgenciesCount = 0;
      let totalDirectClientsCount = 0;
      let paginatedData = [];
      // Effective totals AFTER the in-memory search filter (what the table shows).
      let effectiveTotal = 0;
      let agenciesShown = 0;
      let clientsShown = 0;

      if (type === 'all' || type === 'agencies') {
        const agencyOptions = {
          page: 1,
          limit: 1000,
          targetRole: 'department_manager',
          search,
          // Only active agencies unless the caller opts in to inactive ones.
          filters: includeInactive ? {} : { active: true },
        };

        const agencyCountResult = await this.userService.getUsers(currentUser, agencyOptions);
        totalAgenciesCount = agencyCountResult.pagination?.totalCount || 0;
      }

      if (type === 'all' || type === 'clients' || isCategoryTab) {
        // People-type clients now live in AmexingUser (role 'end_client') with a clientCategory.
        const clientCountQuery = this.buildEndClientQuery({ isCategoryTab, type, includeInactive });
        totalDirectClientsCount = await clientCountQuery.count({ useMasterKey: true });
      }

      const totalCount = totalAgenciesCount + totalDirectClientsCount;

      // Only fetch the data we need for this page
      if (totalCount > 0) {
        // For simplicity, we'll load agencies first, then direct clients
        // This approach works for moderate data sizes
        const allData = [];

        // Fetch agencies
        if (type === 'all' || type === 'agencies') {
          const agencyOptions = {
            page: 1,
            limit: totalAgenciesCount, // Get all agencies for now
            targetRole: 'department_manager',
            search,
            // Only active agencies unless the caller opts in to inactive ones.
            filters: includeInactive ? {} : { active: true },
          };

          const agencyResult = await this.userService.getUsers(currentUser, agencyOptions);
          agencies = agencyResult.users || [];

          const formattedAgencies = agencies.map((user) => ({
            id: user.id,
            type: 'agency',
            clientCategory: 'agency',
            name: user.contextualData?.companyName || `${user.firstName} ${user.lastName}`,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.username,
            phone: user.phone,
            companyType: 'travel_agency',
            active: user.active,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            loginEnabled: true,
          }));

          allData.push(...formattedAgencies);
        }

        // Fetch people-type clients (direct_client/wedding_planner/concierge/home_owner) —
        // now AmexingUser records (role 'end_client'), distinguished by clientCategory.
        if (type === 'all' || type === 'clients' || isCategoryTab) {
          const clientQuery = this.buildEndClientQuery({ isCategoryTab, type, includeInactive });

          // Merged, sorted and paginated in memory below, so load ALL matching rows
          // (Parse find() defaults to 100) or rows past 100 would be invisible.
          if (totalDirectClientsCount > 0) {
            clientQuery.limit(totalDirectClientsCount);
          }

          const clientResults = await clientQuery.find({ useMasterKey: true });
          directClients = clientResults.map((user) => ({
            id: user.id,
            type: 'client',
            // People-type users always carry a clientCategory; default for safety.
            clientCategory: user.get('clientCategory') || 'direct_client',
            name: `${user.get('firstName') || ''} ${user.get('lastName') || ''}`.trim() || user.get('name') || user.get('email') || '',
            firstName: user.get('firstName'),
            lastName: user.get('lastName'),
            email: user.get('email') || '',
            phone: user.get('phone'),
            companyType: user.get('companyType'),
            active: user.get('active'),
            createdAt: user.get('createdAt'),
            updatedAt: user.get('updatedAt'),
            loginEnabled: true,
          }));

          allData.push(...directClients);
        }

        // Free-text search across BOTH types in memory. getUsers ignores the
        // search option and direct clients were only matchable by name, so filter
        // the merged set here on name + email + contact name — consistent results
        // in every tab (Todos / Agencias / Clientes).
        let rows = allData;
        if (search) {
          const q = search.toLowerCase();
          rows = allData.filter((r) => [r.name, r.email, r.firstName, r.lastName]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(q));
        }

        effectiveTotal = rows.length;
        agenciesShown = rows.filter((r) => r.type === 'agency').length;
        clientsShown = rows.filter((r) => r.type === 'client').length;

        // Sort combined data by the requested field/direction so the DataTable
        // column headers work (agencies + direct clients are merged, so sorting
        // must happen here on the combined set, not per-query).
        rows.sort((a, b) => {
          let av = a[sortField];
          let bv = b[sortField];
          if (sortField === 'createdAt' || sortField === 'updatedAt') {
            av = av ? new Date(av).getTime() : 0;
            bv = bv ? new Date(bv).getTime() : 0;
          } else if (typeof av === 'boolean' || typeof bv === 'boolean') {
            av = av ? 1 : 0;
            bv = bv ? 1 : 0;
          } else {
            av = (av ?? '').toString().toLowerCase();
            bv = (bv ?? '').toString().toLowerCase();
          }
          if (av < bv) return -1 * sortDirection;
          if (av > bv) return 1 * sortDirection;
          return 0;
        });

        // Apply pagination
        paginatedData = rows.slice(skip, skip + limit);
      }

      return res.json({
        success: true,
        data: {
          users: paginatedData,
        },
        pagination: {
          page,
          limit,
          totalCount: effectiveTotal,
          totalPages: Math.ceil(effectiveTotal / limit),
        },
        summary: {
          totalAgencies: agenciesShown,
          totalDirectClients: clientsShown,
          totalCombined: effectiveTotal,
        },
      });
    } catch (error) {
      logger.error('Error in ClientsController.getMixedClients', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        userRole: req.userRole,
        queryParams: req.query,
      });

      this.sendError(res, 'Failed to retrieve mixed client data', 500);
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
   * GET /api/clients/active - Get active clients for dropdown/selector with search.
   * Returns simplified client data formatted for Tom Select component.
   * Supports server-side search for better performance with large datasets.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/clients/active?search=enterprise
   * Response: {success: true, data: [{value: 'id', label: 'Company Name', email: 'email@domain.com', contactPerson: 'John Doe', phone: '+52...'}]}
   */
  async getActiveClients(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Parse query parameters for search functionality
      const searchTerm = req.query.search?.trim() || '';
      const page = parseInt(req.query.page, 10) || 1;
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, this.maxPageSize);

      // Build options for service call
      const options = {
        targetRole: this.clientRole,
        filters: {
          active: true,
          exists: true,
        },
        limit,
        page,
        sort: {
          field: 'lastName',
          direction: 'asc',
        },
      };

      // Add search filter if provided
      if (searchTerm) {
        options.filters.search = searchTerm;
      }

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
          // Expose companyName separately so the frontend can render it as the primary
          // identifier for agency selection (admins want to see the company, not the
          // department manager's personal name).
          companyName: companyName || '',
          email: user.email,
          contactPerson: fullName,
          phone: user.phone || '',
        };
      });

      logger.info('Active clients retrieved for selector', {
        count: clients.length,
        searchTerm: searchTerm || 'none',
        page,
        limit,
        totalCount: result.pagination?.total || clients.length,
        requestedBy: currentUser.id,
      });

      // Include pagination metadata for frontend
      const response = {
        clients,
        pagination: {
          page,
          limit,
          total: result.pagination?.total || clients.length,
          hasMore: result.pagination?.hasNextPage || false,
        },
        searchTerm,
      };

      this.sendSuccess(res, response, 'Active clients retrieved successfully');
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
   * GET /api/clients/amexing-direct - Get direct Amexing clients for dropdown/selector
   * Returns AmexingUser records with role = "end_client" (people-type clients migrated
   * out of the Client class).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/clients/amexing-direct?search=company
   * Response: {success: true, data: {clients: [...], pagination: {...}}}
   */
  async getAmexingDirectClients(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Only admin/superadmin can access direct Amexing clients
      const currentUserRole = req.userRole || currentUser.role || currentUser.get?.('role');
      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return this.sendError(res, 'Access denied. Only Admin or SuperAdmin can access direct Amexing clients.', 403);
      }

      // Parse query parameters for search functionality
      const searchTerm = req.query.search?.trim() || '';
      const page = parseInt(req.query.page, 10) || 1;
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, this.maxPageSize);
      const skip = (page - 1) * limit;

      // Optional clientCategory filter — when one of the people-type categories is
      // provided, narrow the list to that category; otherwise keep all end_clients.
      const validCategories = ['direct_client', 'wedding_planner', 'concierge', 'home_owner'];
      const clientCategory = req.query.clientCategory?.trim() || '';
      const filterByCategory = validCategories.includes(clientCategory);

      // Query AmexingUser for end_client records (people-type clients)
      const Parse = require('parse/node');
      const AmexingUserClass = Parse.Object.extend('AmexingUser');

      let query;

      // Add search filter if provided
      if (searchTerm) {
        const searchQueries = [];

        // Search in firstName
        const firstNameQuery = new Parse.Query(AmexingUserClass);
        firstNameQuery.matches('firstName', searchTerm, 'i');
        searchQueries.push(firstNameQuery);

        // Search in lastName
        const lastNameQuery = new Parse.Query(AmexingUserClass);
        lastNameQuery.matches('lastName', searchTerm, 'i');
        searchQueries.push(lastNameQuery);

        // Search in name (legacy/optional field)
        const nameQuery = new Parse.Query(AmexingUserClass);
        nameQuery.matches('name', searchTerm, 'i');
        searchQueries.push(nameQuery);

        // Search in email
        const emailQuery = new Parse.Query(AmexingUserClass);
        emailQuery.matches('email', searchTerm, 'i');
        searchQueries.push(emailQuery);

        // Combine search queries with OR
        query = Parse.Query.or(...searchQueries);
        query.equalTo('role', 'end_client');
        query.equalTo('active', true);
        query.equalTo('exists', true);
        // Excluir clientes de agencia del picker de directos Amexing.
        query.notEqualTo('clientCategory', 'agency_client');
      } else {
        // Create basic query without search
        query = new Parse.Query(AmexingUserClass);
        query.equalTo('role', 'end_client');
        query.equalTo('active', true);
        query.equalTo('exists', true);
        // Excluir clientes de agencia del picker de directos Amexing.
        query.notEqualTo('clientCategory', 'agency_client');
      }

      if (filterByCategory) {
        query.equalTo('clientCategory', clientCategory);
      }

      // Get total count for pagination
      const totalCount = await query.count({ useMasterKey: true });

      // Apply pagination
      query.limit(limit);
      query.skip(skip);
      query.ascending('firstName');

      // Fetch users
      const clients = await query.find({ useMasterKey: true });

      // Transform to Tom Select format
      const formattedClients = clients.map((user) => {
        const firstName = user.get('firstName') || '';
        const lastName = user.get('lastName') || '';
        const name = user.get('name') || `${firstName} ${lastName}`.trim();
        const companyName = user.get('companyName') || '';
        const contactPerson = user.get('contactPerson') || '';

        // Build display label - prioritize company name, then constructed name
        let label = companyName || name;
        if (!label) {
          const fullName = contactPerson || `${firstName} ${lastName}`.trim();
          label = fullName || 'Cliente Sin Nombre';
        }

        return {
          value: user.id,
          label,
          email: user.get('email') || '',
          contactPerson: contactPerson || `${firstName} ${lastName}`.trim(),
          phone: user.get('phone') || '',
          firstName,
          lastName,
          companyName,
          preferredLanguage: user.get('preferredLanguage') || 'es',
        };
      });

      logger.info('Direct Amexing clients retrieved for selector', {
        count: formattedClients.length,
        searchTerm: searchTerm || 'none',
        clientCategory: filterByCategory ? clientCategory : 'all',
        page,
        limit,
        totalCount,
        requestedBy: currentUser.id,
      });

      // Include pagination metadata for frontend
      const response = {
        clients: formattedClients,
        pagination: {
          page,
          limit,
          total: totalCount,
          hasMore: skip + limit < totalCount,
        },
        searchTerm,
      };

      this.sendSuccess(res, response, 'Direct Amexing clients retrieved successfully');
    } catch (error) {
      logger.error('Error in ClientsController.getAmexingDirectClients', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to retrieve direct Amexing clients',
        500
      );
    }
  }

  /**
   * GET /api/clients/:clientId/sub-clients - Get sub-clients (Client records owned by this client)
   * Fetches Client records from the Client table where ownedBy points to the specified clientId.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/clients/abc123/sub-clients
   * Response: {success: true, data: {clients: [...], total: 5}}
   */
  /**
   * Base query for an agency's sub-clients (AmexingUser end_client, clientCategory
   * 'agency_client') scoped to the owning agency via organizationId.
   * @param {string} agencyId - The owning agency id (department_manager objectId).
   * @returns {Parse.Query} A configured, active/exists AmexingUser query.
   * @example
   * const q = this.buildAgencySubClientQuery(agencyId);
   */
  buildAgencySubClientQuery(agencyId) {
    const Parse = require('parse/node');
    const q = new Parse.Query('AmexingUser');
    q.equalTo('role', 'end_client');
    q.equalTo('clientCategory', 'agency_client');
    q.equalTo('organizationId', agencyId);
    q.equalTo('active', true);
    q.equalTo('exists', true);
    return q;
  }

  async getSubClients(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const { clientId } = req.params;
      if (!clientId) {
        return this.sendError(res, 'Client ID is required', 400);
      }

      // Parse query parameters for pagination
      const page = parseInt(req.query.page, 10) || 1;
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 100);
      const searchTerm = req.query.search?.trim() || '';

      logger.info('Fetching sub-clients for client', {
        clientId,
        page,
        limit,
        searchTerm,
        requestedBy: currentUser.id,
      });

      // Detect if this is a department_manager requesting sub-clients
      const isDepartmentManager = currentUser.get && currentUser.get('role') === 'department_manager';
      const requestingOwnSubClients = isDepartmentManager && clientId === currentUser.id;
      const requestingClientSubClients = isDepartmentManager && clientId !== currentUser.id;

      console.log('=== SUB-CLIENTS REQUEST CONTEXT ===', {
        isDepartmentManager,
        requestingOwnSubClients,
        requestingClientSubClients,
        clientId,
        currentUserId: currentUser.id,
        userRole: currentUser.get ? currentUser.get('role') : 'unknown',
      });

      logger.info('Request context analysis', {
        isDepartmentManager,
        requestingOwnSubClients,
        requestingClientSubClients,
        clientId,
        currentUserId: currentUser.id,
        userRole: currentUser.get ? currentUser.get('role') : 'unknown',
      });

      // Sub-clients de una agencia: ahora viven en AmexingUser (role 'end_client',
      // clientCategory 'agency_client') con organizationId = id de la agencia (clientId).
      const Parse = require('parse/node');

      let finalQuery;
      if (searchTerm) {
        finalQuery = Parse.Query.or(
          this.buildAgencySubClientQuery(clientId).matches('firstName', searchTerm, 'i'),
          this.buildAgencySubClientQuery(clientId).matches('lastName', searchTerm, 'i'),
          this.buildAgencySubClientQuery(clientId).matches('email', searchTerm, 'i')
        );
      } else {
        finalQuery = this.buildAgencySubClientQuery(clientId);
      }

      const totalCount = await finalQuery.count({ useMasterKey: true });
      finalQuery.limit(limit);
      finalQuery.skip((page - 1) * limit);
      finalQuery.descending('createdAt');
      const clients = await finalQuery.find({ useMasterKey: true });

      logger.info('Sub-clients (agency end_clients) retrieved', {
        clientId, count: clients.length, totalCount, isDepartmentManager,
      });

      // Transform clients to response format
      const clientsData = clients.map((client) => ({
        id: client.id,
        name: `${client.get('firstName') || ''} ${client.get('lastName') || ''}`.trim(),
        email: client.get('email') || '',
        phone: client.get('phone') || '',
        contactPerson: client.get('contactPerson') || '',
        firstName: client.get('firstName') || '',
        lastName: client.get('lastName') || '',
        companyName: client.get('contextualData')?.companyName || client.get('companyName') || '',
        contextualData: client.get('contextualData') || null,
        preferredLanguage: client.get('preferredLanguage') || 'es',
        active: client.get('active'),
        createdAt: client.get('createdAt'),
      }));

      logger.info('Sub-clients retrieved successfully', {
        clientId,
        count: clientsData.length,
        totalCount,
        page,
        limit,
        requestedBy: currentUser.id,
      });

      // Return response
      this.sendSuccess(res, {
        clients: clientsData,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit),
          hasMore: page * limit < totalCount,
        },
      }, 'Sub-clients retrieved successfully');
    } catch (error) {
      logger.error('Error in ClientsController.getSubClients', {
        error: error.message,
        stack: error.stack,
        clientId: req.params.clientId,
        userId: req.user?.id,
      });

      this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to retrieve sub-clients',
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

  /**
   * POST /api/clients/amexing-direct/quick - Create quick direct client.
   * Creates an AmexingUser with role = "end_client" (people-type client) so it can log in.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * POST /api/clients/amexing-direct/quick
   * Body: { firstName: 'John', lastName: 'Doe', email: 'john@example.com' }
   */
  async createQuickDirectClient(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Only admin/superadmin can create direct Amexing clients
      const currentUserRole = req.userRole || currentUser.role || currentUser.get?.('role');
      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return this.sendError(res, 'Access denied. Only Admin or SuperAdmin can create direct Amexing clients.', 403);
      }

      // Get client data from request
      const {
        firstName,
        lastName,
        email,
        phone,
        companyName,
        contactFirstName,
        contactLastName,
        preferredLanguage = 'es',
      } = req.body;

      // Validate required fields
      if (!firstName || !lastName) {
        return this.sendError(res, 'First name and last name are required', 400);
      }

      const AmexingUser = require('../../../domain/models/AmexingUser');

      // Derive username from email, or a placeholder when none is given
      const normalizedEmail = (email || '').trim().toLowerCase();
      const username = normalizedEmail || `enduser_${Date.now()}@migrated.amexing`;

      // Resolve contact person info (use main client when no separate contact is given)
      const contactPerson = contactFirstName || contactLastName
        ? `${contactFirstName || ''} ${contactLastName || ''}`.trim()
        : `${firstName} ${lastName}`;
      const resolvedContactFirstName = contactFirstName || firstName;
      const resolvedContactLastName = contactLastName || lastName;

      // Create the end_client AmexingUser (people-type client)
      const newUser = AmexingUser.create({
        username,
        email: normalizedEmail,
        firstName,
        lastName,
        role: 'end_client',
        organizationId: 'amexing',
        clientCategory: 'direct_client',
        phone,
        companyName,
        contactFirstName: resolvedContactFirstName,
        contactLastName: resolvedContactLastName,
        preferredLanguage,
        active: true,
        exists: true,
        createdBy: currentUser.id,
      });
      newUser.set('contactPerson', contactPerson);

      // Set a random password; these accounts don't log in until invited.
      // setPassword resets mustChangePassword to false, so set it to true afterward.
      const crypto = require('crypto');
      await newUser.setPassword(crypto.randomBytes(24).toString('base64'), false);
      newUser.set('mustChangePassword', true);

      // Save the user
      const savedClient = await newUser.save(null, { useMasterKey: true });

      // Log the creation
      logger.info('Quick direct client created successfully', {
        clientId: savedClient.id,
        firstName,
        lastName,
        companyName,
        email,
        createdBy: currentUser.id,
      });

      // Build display label
      const label = companyName || `${firstName} ${lastName}`;

      // Return in Tom Select format
      const response = {
        value: savedClient.id,
        label,
        email: email || '',
        contactPerson: savedClient.get('contactPerson'),
        phone: phone || '',
        firstName,
        lastName,
        companyName: companyName || '',
        preferredLanguage,
      };

      res.status(201).json({
        success: true,
        data: response,
        message: 'Cliente directo creado exitosamente',
      });
    } catch (error) {
      logger.error('Error in ClientsController.createQuickDirectClient', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        body: req.body,
      });

      this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to create direct client',
        500
      );
    }
  }

  /**
   * POST /api/clients/:id/reset-password - Reset client password.
   * Only SuperAdmin and Admin can reset client passwords.
   * Generates a secure new password and logs the action for audit.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * POST /api/clients/abc123/reset-password
   * Response: { success: true, newCredential: '[auto_generated_value]' }
   */
  async resetClientPassword(req, res) {
    try {
      const currentUser = req.user;
      const clientId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!clientId) {
        return this.sendError(res, 'Client ID is required', 400);
      }

      // Validate user role (only superadmin and admin can reset passwords)
      const currentUserRole = req.userRole || currentUser.role || currentUser.get?.('role');
      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return this.sendError(res, 'Access denied. Only SuperAdmin or Admin can reset client passwords.', 403);
      }

      // Generate new secure password
      const newPassword = this.generateSecurePassword();

      // Reset password using direct bcrypt hashing (like authController does)
      const bcrypt = require('bcrypt');
      const Parse = require('parse/node');

      // Hash the password with bcrypt
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

      // Query AmexingUser to get the user object
      const userQuery = new Parse.Query('AmexingUser');
      const user = await userQuery.get(clientId, { useMasterKey: true });

      if (!user) {
        throw new Error('User not found');
      }

      // Update password fields directly (same way AmexingUser.setPassword does)
      user.set('password', hashedPassword);
      user.set('passwordHash', hashedPassword);
      user.set('passwordChangedAt', new Date());
      user.set('mustChangePassword', false);
      user.set('loginAttempts', 0);
      user.set('lockedUntil', null);

      // Create proper Parse Pointer for modifiedBy
      const modifiedByPointer = {
        __type: 'Pointer',
        className: 'AmexingUser',
        objectId: currentUser.id,
      };
      user.set('modifiedBy', modifiedByPointer);

      // Save the user with master key
      await user.save(null, { useMasterKey: true });

      // Security logging for password reset action
      logger.info('Client password reset by admin', {
        clientId,
        adminId: currentUser.id,
        adminRole: currentUserRole,
        timestamp: new Date().toISOString(),
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      });

      // Return the new password securely
      res.status(200).json({
        success: true,
        password: newPassword,
        message: 'Password reset successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error in ClientsController.resetClientPassword', {
        error: error.message,
        stack: error.stack,
        clientId: req.params.id,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * Helper method to process address data for client updates.
   * @param {object} addressData - The address data to process.
   * @returns {object} - Processed address data.
   * @example
   * const address = { calle: '123 Main St', ciudad: 'Mexico City' };
   * const processed = this.processAddressData(address);
   * // Returns: { calle: '123 Main St', ciudad: 'Mexico City' }
   */
  processAddressData(addressData) {
    if (!addressData || typeof addressData !== 'object') {
      return null;
    }

    const processedAddress = {};
    const addressFields = ['calle', 'ciudad', 'estado', 'codigoPostal', 'pais'];

    addressFields.forEach((field) => {
      if (addressData[field] && addressData[field].trim()) {
        processedAddress[field] = addressData[field].trim();
      }
    });

    return Object.keys(processedAddress).length > 0 ? processedAddress : null;
  }
}

module.exports = ClientsController;
