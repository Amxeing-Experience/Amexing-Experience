/**
 * OwnedClientsController - RESTful API for Hierarchical Client Management.
 * Allows department_manager and client roles to manage their own clients.
 * Provides ownership-based filtering and access control.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE)
 * - Ownership-based access control
 * - Department managers and clients can manage their own client entities
 * - Comprehensive security, validation, and audit logging.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const Client = require('../../../domain/models/Client');
const AmexingUser = require('../../../domain/models/AmexingUser');
const logger = require('../../../infrastructure/logger');
const { logBulkReadAccess } = require('../../utils/auditHelper');

class OwnedClientsController {
  constructor() {
    this.maxPageSize = 100;
    this.defaultPageSize = 25;
  }

  /**
   * Create a Parse.Query for Client class safely.
   * @returns {Parse.Query} - Safe Parse.Query instance for Client.
   * @example
   */
  createClientQuery() {
    logger.info('CLAUDE_DEBUG: createClientQuery called');
    logger.info('CLAUDE_DEBUG: Parse object type:', typeof Parse);
    logger.info('CLAUDE_DEBUG: Parse.Query type:', typeof Parse.Query);
    logger.info('CLAUDE_DEBUG: Client class type:', typeof Client);
    logger.info('CLAUDE_DEBUG: Client class name:', Client?.name);

    try {
      // Try using the imported Client class directly first
      logger.info('CLAUDE_DEBUG: Attempting to create query with imported Client class');
      const query = new Parse.Query(Client);
      logger.info('CLAUDE_DEBUG: Success! Created query using imported Client class');
      logger.info('CLAUDE_DEBUG: Query type:', typeof query);
      logger.info('CLAUDE_DEBUG: Query instanceof Parse.Query:', query instanceof Parse.Query);
      return query;
    } catch (directError) {
      logger.error('CLAUDE_DEBUG: Direct Client class failed:', directError.message);

      try {
        // Fallback to string-based approach
        logger.info('CLAUDE_DEBUG: Fallback - trying with \'Client\' string');
        const query = new Parse.Query('Client');
        logger.info('CLAUDE_DEBUG: Success! Created query using \'Client\' string');
        return query;
      } catch (stringError) {
        logger.error('CLAUDE_DEBUG: String approach failed:', stringError.message);

        try {
          // Final fallback to Parse.Object.extend
          logger.info('CLAUDE_DEBUG: Final fallback - Parse.Object.extend(\'Client\')');
          const ClientClass = Parse.Object.extend('Client');
          logger.info('CLAUDE_DEBUG: ClientClass type:', typeof ClientClass);
          const query = new Parse.Query(ClientClass);
          logger.info('CLAUDE_DEBUG: Success! Created query using Parse.Object.extend');
          return query;
        } catch (extendError) {
          logger.error('CLAUDE_DEBUG: All approaches failed!');
          logger.error('CLAUDE_DEBUG: Direct error:', directError);
          logger.error('CLAUDE_DEBUG: String error:', stringError);
          logger.error('CLAUDE_DEBUG: Extend error:', extendError);
          throw extendError;
        }
      }
    }
  }

  /**
   * GET /api/owned-clients - Get clients owned by current user.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getOwnedClients(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const userRole = currentUser.role || currentUser.get('role');

      // Only department_manager and client roles can manage owned clients
      if (!['department_manager', 'client', 'admin', 'superadmin'].includes(userRole)) {
        return this.sendError(res, 'Access denied', 403);
      }

      // Parse query parameters
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(this.maxPageSize, parseInt(req.query.limit, 10) || this.defaultPageSize);
      const skip = (page - 1) * limit;
      const search = req.query.search?.trim() || '';
      const active = req.query.active !== undefined ? req.query.active === 'true' : null;

      // Build hierarchical query based on role and clientId relationships
      let query;

      if (userRole === 'admin' || userRole === 'superadmin') {
        // Admins can see all clients or filter by ownership
        query = this.createClientQuery();
        if (req.query.ownerFilter === 'owned') {
          query.equalTo('ownedBy', currentUser);
        } else if (req.query.ownerFilter === 'admin') {
          query.equalTo('ownerType', 'admin');
        }
      } else {
        // Use hierarchical query for department managers and client users
        query = await this.buildHierarchicalQuery(currentUser, userRole);

        // Apply ownerType filtering for backward compatibility using containedIn
        if (userRole === 'department_manager') {
          // Department managers see clients with their ownerType or client ownerType
          query.containedIn('ownerType', ['department_manager', 'client']);
        } else if (userRole === 'client') {
          // Client users see clients with client or department_manager ownerType
          query.containedIn('ownerType', ['client', 'department_manager']);
        }
      }

      // Active filter
      if (active !== null) {
        query.equalTo('active', active);
      }
      query.equalTo('exists', true);

      // Search filter - temporarily disable to avoid Parse.Query.or issues
      if (search) {
        // For now, just search by name to avoid Parse.Query.or issues
        // TODO: Implement full text search using Parse Server's full text search capability
        query.matches('name', search, 'i');
      }

      // Get total count
      const totalCount = await query.count({ useMasterKey: true });

      // Apply pagination and sorting
      query.skip(skip);
      query.limit(limit);
      query.descending('createdAt');
      query.include('ownedBy');

      // Debug: Check what we're querying for
      logger.info(`Querying for ownedBy=${currentUser.id}, ownerType=${userRole}`);

      // Debug: Show the complete query constraints
      logger.info(`Query constraints: ${JSON.stringify({
        ownedBy: currentUser.id,
        ownerType: userRole,
        active: active !== null ? active : 'not filtered',
        exists: true,
        search: search || 'no search',
      })}`);

      // Debug: Check all clients in database first
      const allClientsQuery = this.createClientQuery();
      allClientsQuery.limit(10);
      const allClients = await allClientsQuery.find({ useMasterKey: true });
      logger.info(`Total clients in database: ${allClients.length}`);
      allClients.forEach((client) => {
        const ownedBy = client.get('ownedBy');
        logger.info(`All Client ${client.id}: name=${client.get('name')}, ownedBy=${ownedBy ? (ownedBy.id || ownedBy) : 'null'}, ownerType=${client.get('ownerType')}, active=${client.get('active')}, exists=${client.get('exists')}`);
      });

      // Execute query
      const clients = await query.find({ useMasterKey: true });

      // Debug: Check what we found and log details
      logger.info(`Found ${clients.length} owned clients for user ${currentUser.id} with role ${userRole}`);
      if (clients.length > 0) {
        clients.forEach((client) => {
          logger.info(`Client ${client.id}: name=${client.get('name')}, ownedBy=${client.get('ownedBy')}, ownerType=${client.get('ownerType')}`);
        });
      }

      // Format response
      const formattedClients = clients.map((client) => ({
        id: client.id,
        name: client.get('name'),
        email: client.get('email'),
        phone: client.get('phone'),
        contactPerson: client.get('contactPerson'),
        companyType: client.get('companyType'),
        active: client.get('active'),
        ownerType: client.get('ownerType'),
        ownedBy: client.get('ownedBy') ? {
          id: client.get('ownedBy').id,
          name: `${client.get('ownedBy').get('firstName')} ${client.get('ownedBy').get('lastName')}`,
          email: client.get('ownedBy').get('email'),
        } : null,
        createdAt: client.get('createdAt'),
        updatedAt: client.get('updatedAt'),
      }));

      // Log bulk read access
      logBulkReadAccess(req, 'Client', clients.length, { ownerFilter: req.query.ownerFilter });

      return res.json({
        success: true,
        data: formattedClients,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit),
        },
      });
    } catch (error) {
      logger.error('Error fetching owned clients:', error);
      return this.sendError(res, 'Failed to fetch clients', 500);
    }
  }

  /**
   * GET /api/owned-clients/active - Get active owned clients for dropdowns.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getActiveOwnedClients(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const userRole = currentUser.role || currentUser.get('role');

      // Build hierarchical query for active clients
      let query;

      if (userRole === 'admin' || userRole === 'superadmin') {
        // Admins see all active clients
        query = this.createClientQuery();
      } else if (userRole === 'department_manager' || userRole === 'client') {
        // Use hierarchical query for department managers and client users
        query = await this.buildHierarchicalQuery(currentUser, userRole);
      } else {
        return res.json({ success: true, data: [] });
      }

      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.ascending('name');
      query.limit(500);

      const clients = await query.find({ useMasterKey: true });

      // Format for dropdown
      const formattedClients = clients.map((client) => ({
        value: client.id,
        label: client.get('name'),
        email: client.get('email'),
        contactPerson: client.get('contactPerson'),
        phone: client.get('phone'),
      }));

      return res.json({
        success: true,
        data: formattedClients,
      });
    } catch (error) {
      logger.error('Error fetching active owned clients:', error);
      return this.sendError(res, 'Failed to fetch active clients', 500);
    }
  }

  /**
   * POST /api/owned-clients - Create a new owned client.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async createOwnedClient(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const userRole = currentUser.role || currentUser.get('role');

      // Only specific roles can create owned clients
      if (!['department_manager', 'client', 'admin', 'superadmin'].includes(userRole)) {
        return this.sendError(res, 'Access denied', 403);
      }

      const {
        name, email, phone, contactPerson, companyType, taxId, website, notes, address,
      } = req.body;

      // Validate required fields
      if (!name) {
        return this.sendError(res, 'Client name is required', 400);
      }

      // Create client with ownership
      const clientData = {
        name,
        email: email || '',
        phone,
        contactPerson,
        companyType,
        taxId,
        website,
        notes,
        address,
        ownedBy: currentUser.id,
        ownerType: userRole === 'admin' || userRole === 'superadmin' ? 'admin' : userRole,
        createdBy: currentUser.id,
      };

      const client = Client.create(clientData);
      await client.save(null, { useMasterKey: true });

      logger.info('Owned client created', {
        clientId: client.id,
        ownerId: currentUser.id,
        ownerType: clientData.ownerType,
      });

      return res.status(201).json({
        success: true,
        message: 'Client created successfully',
        data: {
          id: client.id,
          name: client.get('name'),
          email: client.get('email'),
        },
      });
    } catch (error) {
      logger.error('Error creating owned client:', error);
      return this.sendError(res, 'Failed to create client', 500);
    }
  }

  /**
   * POST /api/owned-clients/quick - Create a quick client (minimal info).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async createQuickOwnedClient(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const userRole = currentUser.role || currentUser.get('role');

      // Only specific roles can create owned clients
      if (!['department_manager', 'client', 'admin', 'superadmin'].includes(userRole)) {
        return this.sendError(res, 'Access denied', 403);
      }

      const {
        firstName, lastName, email, companyName, phone,
      } = req.body;

      // Validate required fields
      if (!firstName || !lastName) {
        return this.sendError(res, 'First name and last name are required', 400);
      }

      const name = companyName || `${firstName} ${lastName}`;

      // Create client with ownership
      const clientData = {
        name,
        email: email || '',
        phone,
        contactPerson: `${firstName} ${lastName}`,
        companyType: companyName ? 'corporate' : 'individual',
        ownedBy: currentUser.id,
        ownerType: userRole === 'admin' || userRole === 'superadmin' ? 'admin' : userRole,
        createdBy: currentUser.id,
      };

      const client = Client.create(clientData);
      await client.save(null, { useMasterKey: true });

      logger.info('Quick owned client created', {
        clientId: client.id,
        ownerId: currentUser.id,
        ownerType: clientData.ownerType,
      });

      return res.status(201).json({
        success: true,
        message: 'Client created successfully',
        data: {
          value: client.id,
          label: client.get('name'),
          email: client.get('email'),
          contactPerson: client.get('contactPerson'),
          phone: client.get('phone'),
        },
      });
    } catch (error) {
      logger.error('Error creating quick owned client:', error);
      return this.sendError(res, 'Failed to create client', 500);
    }
  }

  /**
   * PUT /api/owned-clients/:id - Update an owned client.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async updateOwnedClient(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const { id } = req.params;
      const userRole = currentUser.role || currentUser.get('role');

      // Get the client
      const query = this.createClientQuery();
      const client = await query.get(id, { useMasterKey: true });

      if (!client) {
        return this.sendError(res, 'Client not found', 404);
      }

      // Check ownership
      const ownedBy = client.get('ownedBy');
      const isOwner = ownedBy && ownedBy.id === currentUser.id;
      const isAdmin = ['admin', 'superadmin'].includes(userRole);

      if (!isOwner && !isAdmin) {
        return this.sendError(res, 'Access denied', 403);
      }

      // Update allowed fields
      const {
        name, email, phone, contactPerson, companyType, taxId, website, notes, address, active,
      } = req.body;

      if (name !== undefined) client.set('name', name);
      if (email !== undefined) client.set('email', email);
      if (phone !== undefined) client.set('phone', phone);
      if (contactPerson !== undefined) client.set('contactPerson', contactPerson);
      if (companyType !== undefined) client.set('companyType', companyType);
      if (taxId !== undefined) client.set('taxId', taxId);
      if (website !== undefined) client.set('website', website);
      if (notes !== undefined) client.set('notes', notes);
      if (address !== undefined) client.set('address', address);
      if (active !== undefined) client.set('active', active);

      client.set('modifiedBy', currentUser);
      await client.save(null, { useMasterKey: true });

      logger.info('Owned client updated', {
        clientId: client.id,
        updatedBy: currentUser.id,
      });

      return res.json({
        success: true,
        message: 'Client updated successfully',
        data: {
          id: client.id,
          name: client.get('name'),
          email: client.get('email'),
        },
      });
    } catch (error) {
      logger.error('Error updating owned client:', error);
      return this.sendError(res, 'Failed to update client', 500);
    }
  }

  /**
   * DELETE /api/owned-clients/:id - Soft delete an owned client.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async deleteOwnedClient(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const { id } = req.params;
      const userRole = currentUser.role || currentUser.get('role');

      // Get the client
      const query = this.createClientQuery();
      const client = await query.get(id, { useMasterKey: true });

      if (!client) {
        return this.sendError(res, 'Client not found', 404);
      }

      // Check ownership
      const ownedBy = client.get('ownedBy');
      const isOwner = ownedBy && ownedBy.id === currentUser.id;
      const isAdmin = ['admin', 'superadmin'].includes(userRole);

      if (!isOwner && !isAdmin) {
        return this.sendError(res, 'Access denied', 403);
      }

      // Soft delete
      client.set('active', false);
      client.set('exists', false);
      client.set('modifiedBy', currentUser);
      await client.save(null, { useMasterKey: true });

      logger.info('Owned client soft deleted', {
        clientId: client.id,
        deletedBy: currentUser.id,
      });

      return res.json({
        success: true,
        message: 'Client deleted successfully',
      });
    } catch (error) {
      logger.error('Error deleting owned client:', error);
      return this.sendError(res, 'Failed to delete client', 500);
    }
  }

  /**
   * Build hierarchical query based on user role and clientId relationships.
   * @param {object} currentUser - Current user object.
   * @param {string} userRole - Current user role.
   * @returns {Promise<Parse.Query>} - Query for hierarchical client visibility.
   * @example
   */
  async buildHierarchicalQuery(currentUser, userRole) {
    logger.info(`CLAUDE_FIX: buildHierarchicalQuery called with userRole: ${userRole}, Client class:`, typeof Client);
    logger.info('CLAUDE_FIX: Client class constructor name:', Client?.name);

    const baseQuery = this.createClientQuery();

    if (userRole === 'admin' || userRole === 'superadmin') {
      // Admins see all clients (no hierarchical filtering)
      return baseQuery;
    }

    if (userRole === 'department_manager') {
      // Department managers see:
      // 1. Clients they created themselves
      // 2. Clients created by users who have this department manager as their clientId

      logger.info(`Building hierarchical query for department_manager: ${currentUser.id}`);

      // Find all users who have this department manager as their clientId
      const clientUsersQuery = new Parse.Query(AmexingUser);
      clientUsersQuery.equalTo('clientId', currentUser.id);
      clientUsersQuery.equalTo('active', true);
      clientUsersQuery.equalTo('exists', true);

      const clientUsers = await clientUsersQuery.find({ useMasterKey: true });

      logger.info(`Found ${clientUsers.length} client users under department manager ${currentUser.id}`, {
        clientUsers: clientUsers.map((user) => ({ id: user.id, username: user.get('username'), role: user.get('role') })),
      });

      // Instead of using Parse.Query.or(), use containedIn approach for department managers too
      logger.info('CLAUDE_DEBUG: Creating department manager hierarchical query using ownedBy in array approach');

      const result = this.createClientQuery();

      // Create an array of all users this department manager can see clients from
      const allowedOwners = [currentUser, ...clientUsers];

      logger.info('CLAUDE_DEBUG: Department manager allowed owners:', allowedOwners.map((owner) => ({ id: owner.id, type: owner.className || 'User' })));

      // Use containedIn to match any of the allowed owners
      result.containedIn('ownedBy', allowedOwners);

      logger.info('CLAUDE_DEBUG: Created department manager query with containedIn instead of Parse.Query.or');

      return result;
    } if (userRole === 'client') {
      // Client users see:
      // 1. Clients they created themselves
      // 2. Clients created by their department manager (if they have one)

      const clientId = currentUser.get('clientId');

      logger.info(`Building hierarchical query for client user: ${currentUser.id}, clientId: ${clientId}`);

      if (clientId) {
        // Create department manager pointer
        const departmentManager = new AmexingUser();
        departmentManager.id = clientId;

        // Instead of using Parse.Query.or(), create a direct approach
        // Create a base query and add "in" condition for ownedBy
        logger.info('CLAUDE_DEBUG: Creating hierarchical query using ownedBy in array approach');

        const result = this.createClientQuery();

        // Create an array of users this client can see clients from
        const allowedOwners = [currentUser, departmentManager];

        logger.info('CLAUDE_DEBUG: Allowed owners:', allowedOwners.map((owner) => ({ id: owner.id, type: owner.className || 'User' })));

        // Use containedIn to match any of the allowed owners
        result.containedIn('ownedBy', allowedOwners);

        logger.info('CLAUDE_DEBUG: Created single query with containedIn instead of Parse.Query.or');

        logger.info(`Client user ${currentUser.id} can see clients created by themselves and department manager ${clientId}`);

        return result;
      }
      // No department manager, only see own clients
      logger.info(`Client user ${currentUser.id} has no department manager, only sees own clients`);
      baseQuery.equalTo('ownedBy', currentUser);
      return baseQuery;
    }

    // Default fallback: only see own clients
    logger.info(`Default query for user ${currentUser.id} with role ${userRole}: only own clients`);
    baseQuery.equalTo('ownedBy', currentUser);
    return baseQuery;
  }

  /**
   * Helper method to send error responses.
   * @param {object} res - Express response object.
   * @param {string} message - Error message.
   * @param {number} status - HTTP status code.
   * @example
   */
  sendError(res, message, status = 400) {
    return res.status(status).json({
      success: false,
      error: message,
    });
  }
}

module.exports = OwnedClientsController;
