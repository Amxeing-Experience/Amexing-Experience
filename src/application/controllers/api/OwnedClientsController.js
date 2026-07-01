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

/**
 * RESTful controller for hierarchical, ownership-scoped client management.
 * Lets department_manager and end_client roles create and manage their own
 * Client entities with ownership-based access control and audit logging.
 * @example
 *   const controller = new OwnedClientsController();
 *   router.get('/owned-clients', (req, res) => controller.list(req, res));
 */
class OwnedClientsController {
  constructor() {
    this.maxPageSize = 100;
    this.defaultPageSize = 25;
  }

  /**
   * Resolve the owning agency id for a client created by a DM or agent.
   * - department_manager: su propio objectId ES la agencia.
   * - client (agente): su organizationId apunta al objectId del DM (la agencia).
   * @param {object} currentUser - The AmexingUser creating/owning the client.
   * @param {string} userRole - Role of currentUser.
   * @returns {string} The agency id (department_manager objectId, o el organizationId del agente).
   */
  getAgencyId(currentUser, userRole) {
    if (userRole === 'department_manager') return currentUser.id;
    return currentUser.get ? currentUser.get('organizationId') : currentUser.organizationId;
  }

  /**
   * Base query for agency-owned clients (AmexingUser end_client, clientCategory
   * 'agency_client'), scoped to the caller's agency via organizationId. Admins/superadmins
   * see all agency clients (no org scope).
   * @param {object} currentUser - The caller.
   * @param {string} userRole - Role of the caller.
   * @returns {Parse.Query} A configured AmexingUser query (exists=true).
   */
  buildAgencyClientQuery(currentUser, userRole) {
    const q = new Parse.Query(Parse.Object.extend('AmexingUser'));
    q.equalTo('role', 'end_client');
    q.equalTo('clientCategory', 'agency_client');
    q.equalTo('exists', true);
    if (userRole === 'department_manager' || userRole === 'client') {
      q.equalTo('organizationId', this.getAgencyId(currentUser, userRole));
    }
    return q;
  }

  /**
   * Create a people-type client as an AmexingUser (role 'end_client') so they can log in.
   * Username derives from email, or a placeholder when none is given; a random password is
   * set (these accounts don't log in until invited). Mirrors the migration script.
   * @param {object} data - Profile fields (firstName, lastName, email, clientCategory, ...).
   * @returns {Promise<AmexingUser>} The saved user.
   * @example
   */
  async createEndClientUser(data) {
    const email = (data.email || '').trim().toLowerCase();
    const username = email || `enduser_${Date.now()}@migrated.amexing`;

    const user = AmexingUser.create({
      username,
      email,
      firstName: data.firstName,
      lastName: data.lastName,
      role: 'end_client',
      // organizationId = la agencia dueña (id del DM) para clientes de agencia;
      // 'amexing' para clientes directos de Amexing.
      organizationId: data.organizationId || 'amexing',
      phone: data.phone,
      notes: data.notes,
      contextualData: {},
      clientCategory: data.clientCategory,
      contactFirstName: data.contactFirstName,
      contactLastName: data.contactLastName,
      emergencyContactName: data.emergencyContactName,
      emergencyContactPhone: data.emergencyContactPhone,
      companyType: data.companyType,
      taxId: data.taxId,
      website: data.website,
      preferredLanguage: data.preferredLanguage,
      accessibilityRequirements: data.accessibilityRequirements,
      allergies: data.allergies,
      dietaryRestrictions: data.dietaryRestrictions,
      address: data.address,
      createdBy: data.createdBy,
    });

    const crypto = require('crypto');
    await user.setPassword(crypto.randomBytes(24).toString('base64'), false);
    user.set('mustChangePassword', true);

    await user.save(null, { useMasterKey: true });
    return user;
  }

  /**
   * Resolve an id to either a people-type AmexingUser (role 'end_client') or a legacy Client
   * record. People-type clients now live in AmexingUser; older/agency-owned ones stay Client.
   * @param {string} id - The client or user objectId.
   * @returns {Promise<Parse.Object|null>} The Parse object, or null when not found.
   * @example
   */
  async resolveClientOrUser(id) {
    const userQuery = new Parse.Query('AmexingUser');
    userQuery.equalTo('role', 'end_client');
    const user = await userQuery.get(id, { useMasterKey: true }).catch(() => null);
    if (user) return user;
    return this.createClientQuery().get(id, { useMasterKey: true }).catch(() => null);
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

      const userRole = req.userRole || currentUser.role || currentUser.get?.('role');

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

      // Owned clients now live in AmexingUser (role 'end_client', clientCategory
      // 'agency_client'), scoped to the owning agency via organizationId. createdBy
      // (string id) records who (DM o agente) los dio de alta.
      const AmexingUserCls = Parse.Object.extend('AmexingUser');
      const query = new Parse.Query(AmexingUserCls);
      query.equalTo('role', 'end_client');
      query.equalTo('clientCategory', 'agency_client');
      if (userRole === 'department_manager' || userRole === 'client') {
        const agencyId = this.getAgencyId(currentUser, userRole);
        query.equalTo('organizationId', agencyId);
      }
      // admin/superadmin: ven todos los clientes de agencia (sin filtro de organizationId).

      // Active filter
      if (active !== null) {
        query.equalTo('active', active);
      }
      query.equalTo('exists', true);

      // Search por nombre (firstName) — simple; email queda para búsqueda avanzada.
      if (search) {
        query.matches('firstName', search, 'i');
      }

      // Get total count
      const totalCount = await query.count({ useMasterKey: true });

      // Apply pagination and sorting
      query.skip(skip);
      query.limit(limit);
      query.descending('createdAt');

      const clients = await query.find({ useMasterKey: true });

      // Resolver en lote los creadores (createdBy es un string id).
      const creatorIds = [...new Set(clients.map((c) => c.get('createdBy')).filter(Boolean))];
      const creatorMap = {};
      if (creatorIds.length) {
        const creators = await new Parse.Query(AmexingUserCls)
          .containedIn('objectId', creatorIds).find({ useMasterKey: true });
        creators.forEach((u) => {
          creatorMap[u.id] = {
            id: u.id,
            name: `${u.get('firstName') || ''} ${u.get('lastName') || ''}`.trim(),
            role: u.get('role'),
          };
        });
      }

      logger.info(`Found ${clients.length} owned (agency) clients for user ${currentUser.id} role ${userRole}`);

      // Format response
      const formattedClients = clients.map((client) => {
        const cbId = client.get('createdBy');
        return {
          id: client.id,
          name: `${client.get('firstName') || ''} ${client.get('lastName') || ''}`.trim(),
          firstName: client.get('firstName'),
          lastName: client.get('lastName'),
          email: client.get('email'),
          phone: client.get('phone'),
          contactPerson: client.get('contactPerson'),
          companyType: client.get('companyType'),
          active: client.get('active'),
          clientCategory: client.get('clientCategory'),
          organizationId: client.get('organizationId'),
          // Quién lo creó (DM o agente) — para distinguir clientes por agente.
          createdByUser: creatorMap[cbId] || (cbId ? { id: cbId } : null),
          createdAt: client.get('createdAt'),
          updatedAt: client.get('updatedAt'),
        };
      });

      // Log bulk read access
      logBulkReadAccess(req, 'AmexingUser', clients.length, { clientCategory: 'agency_client' });

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

      const userRole = req.userRole || currentUser.role || currentUser.get?.('role');

      if (!['department_manager', 'client', 'admin', 'superadmin'].includes(userRole)) {
        return res.json({ success: true, data: [] });
      }

      // Agency clients (AmexingUser end_client, agency_client) scoped to the agency.
      const query = this.buildAgencyClientQuery(currentUser, userRole);
      query.equalTo('active', true);
      query.ascending('firstName');
      query.limit(500);

      const clients = await query.find({ useMasterKey: true });

      // Format for dropdown
      const formattedClients = clients.map((client) => ({
        value: client.id,
        label: `${client.get('firstName') || ''} ${client.get('lastName') || ''}`.trim(),
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
   * GET /api/owned-clients/:id - Get a specific owned client by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getOwnedClientById(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const userRole = req.userRole || currentUser.role || currentUser.get?.('role');

      // Only department_manager and client roles can manage owned clients
      if (!['department_manager', 'client', 'admin', 'superadmin'].includes(userRole)) {
        return this.sendError(res, 'Access denied', 403);
      }

      const clientId = req.params.id;
      if (!clientId) {
        return this.sendError(res, 'Client ID is required', 400);
      }

      // Agency client scoped to the caller's agency (AmexingUser end_client, agency_client).
      const query = this.buildAgencyClientQuery(currentUser, userRole);
      query.equalTo('objectId', clientId);

      const client = await query.first({ useMasterKey: true });

      if (!client) {
        return this.sendError(res, 'Client not found or access denied', 404);
      }

      // Format response
      const storedAddress = client.get('address') || {};
      const isAddressObject = typeof storedAddress === 'object' && storedAddress !== null && !Array.isArray(storedAddress);

      const formattedClient = {
        id: client.id,
        firstName: client.get('firstName') || '',
        lastName: client.get('lastName') || '',
        email: client.get('email') || '',
        phone: client.get('phone') || '',
        contactFirstName: client.get('contactFirstName') || '',
        contactLastName: client.get('contactLastName') || '',
        emergencyContactName: client.get('emergencyContactName') || '',
        emergencyContactPhone: client.get('emergencyContactPhone') || '',
        companyType: client.get('companyType') || '',
        taxId: client.get('taxId') || '',
        website: client.get('website') || '',

        // Address fields (extracted from structured object or individual fields)
        streetType: isAddressObject ? (storedAddress.streetType || '') : (client.get('streetType') || ''),
        streetName: isAddressObject ? (storedAddress.streetName || '') : (client.get('streetName') || ''),
        exteriorNumber: isAddressObject ? (storedAddress.exteriorNumber || '') : (client.get('exteriorNumber') || ''),
        interiorNumber: isAddressObject ? (storedAddress.interiorNumber || '') : (client.get('interiorNumber') || ''),
        colonia: isAddressObject ? (storedAddress.colonia || '') : (client.get('colonia') || ''),
        city: isAddressObject ? (storedAddress.city || '') : (client.get('city') || ''),
        state: isAddressObject ? (storedAddress.state || '') : (client.get('state') || ''),
        postalCode: isAddressObject ? (storedAddress.postalCode || '') : (client.get('postalCode') || ''),

        // Legacy address field for backward compatibility
        address: typeof storedAddress === 'string' ? storedAddress : '',

        allergies: client.get('allergies') || '',
        dietaryRestrictions: client.get('dietaryRestrictions') || '',
        preferredLanguage: client.get('preferredLanguage') || '',
        accessibilityRequirements: client.get('accessibilityRequirements') || '',
        notes: client.get('notes') || '',
        active: client.get('active') !== false,

        // Metadata
        createdAt: client.get('createdAt'),
        updatedAt: client.get('updatedAt'),
        ownedBy: client.get('ownedBy'),
        ownerType: client.get('ownerType'),
      };

      return res.json({
        success: true,
        data: formattedClient,
      });
    } catch (error) {
      logger.error('Error fetching owned client by ID:', {
        error: error.message,
        clientId: req.params.id,
        userId: req.user?.id,
      });
      return this.sendError(res, 'Failed to fetch client', 500);
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

      logger.info('createOwnedClient called', {
        hasUser: !!currentUser,
        userId: currentUser?.id,
        userRole: currentUser?.role || currentUser?.get?.('role'),
        requestBody: Object.keys(req.body || {}),
      });

      if (!currentUser) {
        logger.warn('createOwnedClient: No user found in request');
        return this.sendError(res, 'Authentication required', 401);
      }

      const userRole = req.userRole || currentUser.role || currentUser.get?.('role');
      logger.info('User role for createOwnedClient', {
        userRole,
        reqUserRole: req.userRole,
        currentUserRole: currentUser.role,
        getCurrentRole: currentUser.get?.('role'),
        allowedRoles: ['department_manager', 'client', 'admin', 'superadmin'],
      });

      // Only specific roles can create owned clients
      if (!['department_manager', 'client', 'admin', 'superadmin'].includes(userRole)) {
        logger.warn('createOwnedClient: Access denied for role', { userRole });
        return this.sendError(res, 'Access denied', 403);
      }

      const {
        // Name fields (separated)
        firstName, lastName,
        // Contact fields
        email, phone,
        contactFirstName, contactLastName,
        emergencyContactName, emergencyContactPhone,
        // Company fields
        companyType, taxId, website,
        // Address fields (structured)
        streetType, streetName, exteriorNumber, interiorNumber,
        colonia, city, state, postalCode,
        // Special requirements
        preferredLanguage, accessibilityRequirements,
        allergies, dietaryRestrictions,
        notes,
        // Direct-client category (direct_client | wedding_planner | concierge | home_owner)
        clientCategory,
        // Legacy address field for backward compatibility
        address,
      } = req.body;

      // Validate required fields
      if (!firstName || !lastName) {
        return this.sendError(res, 'First name and last name are required', 400);
      }

      // Process allergies and dietary restrictions into arrays
      const processedAllergies = allergies
        ? allergies.split('\n').map((item) => item.trim()).filter((item) => item.length > 0)
        : [];

      const processedDietaryRestrictions = dietaryRestrictions
        ? dietaryRestrictions.split('\n').map((item) => item.trim()).filter((item) => item.length > 0)
        : [];

      // Build structured address object if structured fields are provided
      let structuredAddress = null;
      if (streetType || streetName || exteriorNumber || interiorNumber || colonia || city || state || postalCode) {
        structuredAddress = {
          streetType: streetType || '',
          streetName: streetName || '',
          exteriorNumber: exteriorNumber || '',
          interiorNumber: interiorNumber || '',
          colonia: colonia || '',
          city: city || '',
          state: state || '',
          postalCode: postalCode || '',
        };
      }

      const isAmexingClient = userRole === 'admin' || userRole === 'superadmin';
      const finalCategory = clientCategory || 'direct_client';

      // People-type clients owned by Amexing (admin/superadmin) now live in AmexingUser
      // (role 'end_client') so they can eventually log in. Agency-owned sub-clients stay as
      // Client records (they don't log into the admin portal).
      if (isAmexingClient) {
        const created = await this.createEndClientUser({
          firstName,
          lastName,
          email,
          phone,
          contactFirstName,
          contactLastName,
          emergencyContactName,
          emergencyContactPhone,
          companyType,
          taxId,
          website,
          notes,
          address: structuredAddress || address,
          preferredLanguage,
          accessibilityRequirements,
          allergies: processedAllergies,
          dietaryRestrictions: processedDietaryRestrictions,
          clientCategory: finalCategory,
          createdBy: currentUser.id,
        });
        logger.info('End-client user created', { userId: created.id, category: finalCategory });
        return res.status(201).json({
          success: true,
          message: 'Client created successfully',
          data: { id: created.id, name: created.getFullName(), email: created.get('email') },
        });
      }

      // Agency-owned clients also live in AmexingUser (role 'end_client') now, tagged
      // 'agency_client' and scoped to the owning agency via organizationId. createdBy
      // records WHO (the DM or a specific agent) gave the client de alta.
      const agencyId = this.getAgencyId(currentUser, userRole);
      if (!agencyId) {
        return this.sendError(res, 'No se pudo resolver la agencia del usuario', 400);
      }
      const created = await this.createEndClientUser({
        firstName,
        lastName,
        email,
        phone,
        contactFirstName,
        contactLastName,
        emergencyContactName,
        emergencyContactPhone,
        companyType,
        taxId,
        website,
        notes,
        address: structuredAddress || address,
        preferredLanguage,
        accessibilityRequirements,
        allergies: processedAllergies,
        dietaryRestrictions: processedDietaryRestrictions,
        clientCategory: 'agency_client',
        organizationId: agencyId,
        createdBy: currentUser.id,
      });

      logger.info('Agency owned client created (end_client)', {
        userId: created.id,
        agencyId,
        createdBy: currentUser.id,
        createdByRole: userRole,
      });

      return res.status(201).json({
        success: true,
        message: 'Client created successfully',
        data: {
          id: created.id,
          name: created.getFullName ? created.getFullName() : `${firstName} ${lastName}`.trim(),
          email: created.get('email'),
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

      const userRole = req.userRole || currentUser.role || currentUser.get?.('role');

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

      // Quick create as end_client: admin/superadmin → directo Amexing; DM/agente → cliente de agencia.
      const isAmexing = ['admin', 'superadmin'].includes(userRole);
      const organizationId = isAmexing ? 'amexing' : this.getAgencyId(currentUser, userRole);
      if (!organizationId) {
        return this.sendError(res, 'No se pudo resolver la agencia del usuario', 400);
      }
      const created = await this.createEndClientUser({
        firstName,
        lastName,
        email,
        phone,
        companyType: companyName ? 'corporate' : 'individual',
        clientCategory: isAmexing ? 'direct_client' : 'agency_client',
        organizationId,
        createdBy: currentUser.id,
      });

      logger.info('Quick owned client created (end_client)', {
        userId: created.id,
        organizationId,
        createdBy: currentUser.id,
      });

      return res.status(201).json({
        success: true,
        message: 'Client created successfully',
        data: {
          value: created.id,
          label: companyName || `${firstName} ${lastName}`.trim(),
          email: created.get('email'),
          contactPerson: `${firstName} ${lastName}`.trim(),
          phone: created.get('phone'),
        },
      });
    } catch (error) {
      logger.error('Error creating quick owned client:', error);
      return this.sendError(res, 'Failed to create client', 500);
    }
  }

  /**
   * POST /api/owned-clients/admin-create-subclient - Create sub-client for selected enterprise (admin only).
   * Allows admin to create sub-clients belonging to any enterprise.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * POST /api/owned-clients/admin-create-subclient
   * Body: { firstName: 'John', lastName: 'Doe', enterpriseId: 'abc123' }
   */
  async adminCreateSubClient(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const userRole = req.userRole || currentUser.role || currentUser.get?.('role');

      // Only admin/superadmin can use this endpoint
      if (!['admin', 'superadmin'].includes(userRole)) {
        return this.sendError(res, 'Access denied. Only admin users can create sub-clients for enterprises.', 403);
      }

      const {
        firstName, lastName, email, phone, companyName,
        preferredLanguage = 'es', enterpriseId,
      } = req.body;

      // Validate required fields
      if (!firstName || !lastName || !enterpriseId) {
        return this.sendError(res, 'firstName, lastName, and enterpriseId are required', 400);
      }

      // Validate that the enterprise exists and is an AmexingUser (not a Client)
      const AmexingUserClass = Parse.Object.extend('AmexingUser');
      try {
        const enterpriseQuery = new Parse.Query(AmexingUserClass);
        await enterpriseQuery.get(enterpriseId, { useMasterKey: true });
      } catch (error) {
        return this.sendError(res, 'Enterprise not found or invalid', 404);
      }

      // Create the sub-client as an end_client owned by the selected enterprise/agency.
      const name = `${firstName} ${lastName}`.trim();
      const contactPerson = name; // Use the main client as contact person

      const created = await this.createEndClientUser({
        firstName,
        lastName,
        email,
        phone,
        contactFirstName: firstName,
        contactLastName: lastName,
        companyType: companyName ? 'corporate' : 'individual',
        preferredLanguage,
        clientCategory: 'agency_client',
        organizationId: enterpriseId, // the enterprise/agency owns this client
        createdBy: currentUser.id,
      });

      logger.info('Admin created sub-client (end_client) for enterprise', {
        userId: created.id,
        enterpriseId,
        adminId: currentUser.id,
        clientName: name,
      });

      // Return in Tom Select format
      const response = {
        value: created.id,
        label: companyName || name,
        email: email || '',
        contactPerson,
        phone: phone || '',
        firstName,
        lastName,
        companyName: companyName || '',
        preferredLanguage,
      };

      res.status(201).json({
        success: true,
        data: response,
        message: 'Sub-client created successfully for enterprise',
      });
    } catch (error) {
      logger.error('Error in OwnedClientsController.adminCreateSubClient', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        body: req.body,
      });

      this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to create sub-client',
        500
      );
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
      const userRole = req.userRole || currentUser.role || currentUser.get?.('role');

      // People-type clients now live in AmexingUser (role 'end_client'); fall back to the
      // Client class for legacy/agency-owned records. The field setters below work on either.
      const client = await this.resolveClientOrUser(id);

      if (!client) {
        return this.sendError(res, 'Client not found', 404);
      }

      // Ownership: los clientes de agencia pertenecen a la agencia del que llama
      // (organizationId). Admin/superadmin puede cualquiera. (Fallback a ownedBy legado.)
      const clientOrg = client.get('organizationId');
      const legacyOwnedBy = client.get('ownedBy');
      const isOwner = (clientOrg && clientOrg === this.getAgencyId(currentUser, userRole))
        || (legacyOwnedBy && legacyOwnedBy.id === currentUser.id);
      const isAdmin = ['admin', 'superadmin'].includes(userRole);

      if (!isOwner && !isAdmin) {
        return this.sendError(res, 'Access denied', 403);
      }

      // Update allowed fields
      const {
        // Name fields (separated)
        firstName, lastName,
        // Contact fields
        email, phone,
        contactFirstName, contactLastName,
        emergencyContactName, emergencyContactPhone,
        // Company fields
        companyType, taxId, website,
        // Address fields (structured)
        streetType, streetName, exteriorNumber, interiorNumber,
        colonia, city, state, postalCode,
        // Special requirements
        preferredLanguage, accessibilityRequirements,
        allergies, dietaryRestrictions,
        notes, active,
        // Legacy address field for backward compatibility
        address,
      } = req.body;

      // Combine names for backward compatibility if provided
      let name;
      if (firstName !== undefined || lastName !== undefined) {
        const currentFirst = firstName !== undefined ? firstName : client.get('firstName') || '';
        const currentLast = lastName !== undefined ? lastName : client.get('lastName') || '';
        name = `${currentFirst} ${currentLast}`.trim();
      }

      let contactPerson;
      if (contactFirstName !== undefined || contactLastName !== undefined) {
        const currentContactFirst = contactFirstName !== undefined ? contactFirstName : client.get('contactFirstName') || '';
        const currentContactLast = contactLastName !== undefined ? contactLastName : client.get('contactLastName') || '';
        contactPerson = `${currentContactFirst} ${currentContactLast}`.trim();
      }

      // Process allergies and dietary restrictions into arrays if provided
      let processedAllergies;
      if (allergies !== undefined) {
        if (typeof allergies === 'string') {
          processedAllergies = allergies.split('\n').map((item) => item.trim()).filter((item) => item.length > 0);
        } else {
          processedAllergies = allergies;
        }
      } else {
        processedAllergies = undefined;
      }

      let processedDietaryRestrictions;
      if (dietaryRestrictions !== undefined) {
        if (typeof dietaryRestrictions === 'string') {
          processedDietaryRestrictions = dietaryRestrictions.split('\n').map((item) => item.trim()).filter((item) => item.length > 0);
        } else {
          processedDietaryRestrictions = dietaryRestrictions;
        }
      } else {
        processedDietaryRestrictions = undefined;
      }

      // Build structured address object if structured fields are provided
      let structuredAddress;
      if (streetType !== undefined || streetName !== undefined || exteriorNumber !== undefined
          || interiorNumber !== undefined || colonia !== undefined || city !== undefined
          || state !== undefined || postalCode !== undefined) {
        // Get current address or create new one
        const currentAddress = client.get('address') || {};

        structuredAddress = {
          streetType: streetType !== undefined ? streetType : currentAddress.streetType || '',
          streetName: streetName !== undefined ? streetName : currentAddress.streetName || '',
          exteriorNumber: exteriorNumber !== undefined ? exteriorNumber : currentAddress.exteriorNumber || '',
          interiorNumber: interiorNumber !== undefined ? interiorNumber : currentAddress.interiorNumber || '',
          colonia: colonia !== undefined ? colonia : currentAddress.colonia || '',
          city: city !== undefined ? city : currentAddress.city || '',
          state: state !== undefined ? state : currentAddress.state || '',
          postalCode: postalCode !== undefined ? postalCode : currentAddress.postalCode || '',
        };
      }

      // Update original fields
      if (name !== undefined) client.set('name', name);
      if (email !== undefined) client.set('email', email);
      if (phone !== undefined) client.set('phone', phone);
      if (contactPerson !== undefined) client.set('contactPerson', contactPerson);
      if (companyType !== undefined) client.set('companyType', companyType);
      if (taxId !== undefined) client.set('taxId', taxId);
      if (website !== undefined) client.set('website', website);
      if (notes !== undefined) client.set('notes', notes);
      // Use structured address if provided, otherwise use legacy address
      if (structuredAddress !== undefined) {
        client.set('address', structuredAddress);
      } else if (address !== undefined) {
        client.set('address', address);
      }
      if (active !== undefined) client.set('active', active);

      // Update new separated fields
      if (firstName !== undefined) client.set('firstName', firstName);
      if (lastName !== undefined) client.set('lastName', lastName);
      if (contactFirstName !== undefined) client.set('contactFirstName', contactFirstName);
      if (contactLastName !== undefined) client.set('contactLastName', contactLastName);
      if (emergencyContactName !== undefined) client.set('emergencyContactName', emergencyContactName);
      if (emergencyContactPhone !== undefined) client.set('emergencyContactPhone', emergencyContactPhone);
      if (preferredLanguage !== undefined) client.set('preferredLanguage', preferredLanguage);
      if (accessibilityRequirements !== undefined) client.set('accessibilityRequirements', accessibilityRequirements);
      if (processedAllergies !== undefined) client.set('allergies', processedAllergies);
      if (processedDietaryRestrictions !== undefined) client.set('dietaryRestrictions', processedDietaryRestrictions);
      if (req.body.clientCategory !== undefined) client.set('clientCategory', req.body.clientCategory);

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
      const userRole = req.userRole || currentUser.role || currentUser.get?.('role');

      // Resolve people-type AmexingUser ('end_client') or legacy Client record.
      const client = await this.resolveClientOrUser(id);

      if (!client) {
        return this.sendError(res, 'Client not found', 404);
      }

      // Ownership: los clientes de agencia pertenecen a la agencia del que llama
      // (organizationId). Admin/superadmin puede cualquiera. (Fallback a ownedBy legado.)
      const clientOrg = client.get('organizationId');
      const legacyOwnedBy = client.get('ownedBy');
      const isOwner = (clientOrg && clientOrg === this.getAgencyId(currentUser, userRole))
        || (legacyOwnedBy && legacyOwnedBy.id === currentUser.id);
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
   * PATCH /api/owned-clients/:id/toggle-status - Activate/deactivate an owned client.
   * Only the owner or admins can change the status.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * PATCH /api/owned-clients/abc123/toggle-status
   * Body: { active: false }
   */
  async toggleOwnedClientStatus(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const { id } = req.params;
      const { active } = req.body;

      if (typeof active !== 'boolean') {
        return this.sendError(res, 'Active status must be a boolean', 400);
      }

      const userRole = req.userRole || currentUser.role || currentUser.get?.('role');

      // Resolve people-type AmexingUser ('end_client') or legacy Client record.
      const client = await this.resolveClientOrUser(id);

      if (!client) {
        return this.sendError(res, 'Client not found', 404);
      }

      // Ownership: los clientes de agencia pertenecen a la agencia del que llama
      // (organizationId). Admin/superadmin puede cualquiera. (Fallback a ownedBy legado.)
      const clientOrg = client.get('organizationId');
      const legacyOwnedBy = client.get('ownedBy');
      const isOwner = (clientOrg && clientOrg === this.getAgencyId(currentUser, userRole))
        || (legacyOwnedBy && legacyOwnedBy.id === currentUser.id);
      const isAdmin = ['admin', 'superadmin'].includes(userRole);

      if (!isOwner && !isAdmin) {
        return this.sendError(res, 'Access denied', 403);
      }

      // Update status
      client.set('active', active);
      client.set('modifiedBy', currentUser);
      await client.save(null, { useMasterKey: true });

      logger.info('Owned client status toggled', {
        clientId: client.id,
        active,
        modifiedBy: currentUser.id,
      });

      return res.json({
        success: true,
        message: `Client ${active ? 'activated' : 'deactivated'} successfully`,
        data: { id: client.id, active },
      });
    } catch (error) {
      logger.error('Error toggling owned client status:', error);
      return this.sendError(res, 'Failed to change client status', 500);
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
