/**
 * QuoteOwnershipService - Business logic for quote ownership management.
 * Handles ownership transfers, validation, and related operations.
 *
 * Features:
 * - Transfer ownership between users
 * - Validate ownership permissions
 * - Track ownership history
 * - Handle ownership-related business rules
 * - Audit all ownership changes.
 *
 * Created by Denisse Maldonado.
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const Quote = require('../../domain/models/Quote');
const QuoteOwnership = require('../../domain/models/QuoteOwnership');
const QuoteAccess = require('../../domain/models/QuoteAccess');
const QuoteEdit = require('../../domain/models/QuoteEdit');
const AmexingUser = require('../../domain/models/AmexingUser');
const logger = require('../../infrastructure/logger');
const AuditLog = require('../../domain/models/AuditLog');

/**
 * Service class for managing quote ownership.
 */
class QuoteOwnershipService {
  constructor() {
    this.Quote = Quote;
    this.QuoteOwnership = QuoteOwnership;
    this.QuoteAccess = QuoteAccess;
    this.QuoteEdit = QuoteEdit;
    this.AmexingUser = AmexingUser;
  }

  /**
   * Initialize ownership for a new quote.
   * @param {string} quoteId - Quote ID.
   * @param {string} ownerId - Owner user ID.
   * @returns {Promise<object>} Ownership record.
   * @example
   */
  async initializeOwnership(quoteId, ownerId) {
    try {
      // Get quote and owner objects
      const quote = await this.getQuoteById(quoteId);
      const owner = await this.getUserById(ownerId);

      if (!quote) {
        throw new Error('Quote not found');
      }

      if (!owner) {
        throw new Error('Owner user not found');
      }

      // Create initial ownership record
      const ownership = await QuoteOwnership.createInitialOwnership(quote, owner);

      // Update quote with owner reference
      quote.setOwner(owner);
      quote.setCreatedBy(owner);
      await quote.save(null, { useMasterKey: true });

      // Record edit for ownership initialization
      await QuoteEdit.recordEdit(
        quote,
        owner,
        QuoteEdit.EDIT_TYPES.CREATE,
        { owner: ownerId },
        {
          description: 'Quote created with initial ownership',
          autoApprove: true,
        }
      );

      // Audit log
      await this.createAuditLog({
        action: 'quote.ownership.initialized',
        objectClass: 'Quote',
        objectId: quoteId,
        userId: ownerId,
        details: {
          ownerId,
          ownershipId: ownership.id,
        },
      });

      logger.info('Initialized quote ownership', {
        quoteId,
        ownerId,
        ownershipId: ownership.id,
      });

      return this.formatOwnershipResponse(ownership);
    } catch (error) {
      logger.error('Failed to initialize ownership', {
        error: error.message,
        quoteId,
        ownerId,
      });
      throw error;
    }
  }

  /**
   * Transfer ownership of a quote to another user.
   * @param {string} quoteId - Quote ID.
   * @param {string} newOwnerId - New owner user ID.
   * @param {string} transferredById - User initiating the transfer.
   * @param {string} reason - Transfer reason.
   * @returns {Promise<object>} New ownership record.
   * @example
   */
  async transferOwnership(quoteId, newOwnerId, transferredById, reason = '') {
    try {
      // Validate permissions
      const canTransfer = await this.canTransferOwnership(quoteId, transferredById);
      if (!canTransfer) {
        throw new Error('User does not have permission to transfer ownership');
      }

      // Get entities
      const quote = await this.getQuoteById(quoteId);
      let currentOwnership = await QuoteOwnership.getCurrentOwnership(quote);
      let currentOwner;

      if (!currentOwnership) {
        // No formal ownership yet, check if we have createdBy
        const createdBy = quote.getCreatedBy();
        if (!createdBy) {
          throw new Error('No ownership and no createdBy found for quote');
        }

        logger.info('Creating initial ownership from createdBy for transfer', {
          quoteId,
          createdById: createdBy.id,
          newOwnerId,
        });

        // Create initial ownership record for createdBy user
        currentOwnership = await QuoteOwnership.createInitialOwnership(quote, createdBy);
        currentOwner = createdBy;
      } else {
        currentOwner = currentOwnership.getOwner();
      }
      const newOwner = await this.getUserById(newOwnerId);
      const transferredBy = await this.getUserById(transferredById);

      if (!newOwner) {
        throw new Error('New owner user not found');
      }

      // Perform ownership transfer
      const newOwnership = await QuoteOwnership.transferOwnership(
        quote,
        currentOwner,
        newOwner,
        reason,
        transferredBy
      );

      // Update quote
      quote.setOwner(newOwner);
      quote.setLastEditedBy(transferredBy);
      quote.setLastEditedAt(new Date());
      quote.incrementVersion();
      await quote.save(null, { useMasterKey: true });

      // Record edit for ownership transfer
      await QuoteEdit.recordEdit(
        quote,
        transferredBy,
        QuoteEdit.EDIT_TYPES.UPDATE,
        {
          owner: newOwnerId,
          previousOwner: currentOwner.id,
        },
        {
          previousValues: { owner: currentOwner.id },
          newValues: { owner: newOwnerId },
          description: `Ownership transferred: ${reason}`,
          autoApprove: true,
        }
      );

      // Grant editor access to previous owner
      await QuoteAccess.grantAccess(
        quote,
        currentOwner,
        QuoteAccess.ROLES.EDITOR,
        transferredBy,
        {
          reason: 'Previous owner - automatic editor access',
        }
      );

      // Update collaborators list
      const collaborators = quote.getCollaborators();
      if (!collaborators.includes(currentOwner.id)) {
        collaborators.push(currentOwner.id);
        quote.setCollaborators(collaborators);
        await quote.save(null, { useMasterKey: true });
      }

      // Audit log
      await this.createAuditLog({
        action: 'quote.ownership.transferred',
        objectClass: 'Quote',
        objectId: quoteId,
        userId: transferredById,
        details: {
          fromOwnerId: currentOwner.id,
          toOwnerId: newOwnerId,
          reason,
          ownershipId: newOwnership.id,
        },
      });

      logger.info('Transferred quote ownership', {
        quoteId,
        fromOwnerId: currentOwner.id,
        toOwnerId: newOwnerId,
        transferredById,
        reason,
      });

      return this.formatOwnershipResponse(newOwnership);
    } catch (error) {
      logger.error('Failed to transfer ownership', {
        error: error.message,
        quoteId,
        newOwnerId,
        transferredById,
      });
      throw error;
    }
  }

  /**
   * Get current owner of a quote.
   * @param {string} quoteId - Quote ID.
   * @returns {Promise<object>} Owner information.
   * @example
   */
  async getCurrentOwner(quoteId) {
    try {
      const quote = await this.getQuoteById(quoteId);
      if (!quote) {
        logger.warn('Quote not found in getCurrentOwner', { quoteId });
        // Return placeholder for non-existent quotes to avoid 500 errors
        return {
          id: 'not-found',
          username: '',
          email: '',
          firstName: 'Sin',
          lastName: 'Asignar',
          ownershipStartDate: new Date(),
          ownershipType: 'not-found',
          isPlaceholder: true,
          error: 'Quote not found',
        };
      }

      const ownership = await QuoteOwnership.getCurrentOwnership(quote);

      // If no ownership exists, return createdBy as the default owner
      if (!ownership) {
        const createdBy = quote.getCreatedBy();

        if (!createdBy) {
          logger.warn('Quote has no createdBy field and no ownership', {
            quoteId,
            quoteData: {
              id: quote.id,
              folio: quote.get('folio'),
              createdAt: quote.get('createdAt'),
            },
          });

          // Return unassigned placeholder
          return {
            id: 'unassigned',
            username: '',
            email: '',
            firstName: 'Sin',
            lastName: 'Propietario',
            ownershipStartDate: quote.get('createdAt'),
            ownershipType: 'unassigned',
            isPlaceholder: true,
            needsAssignment: true,
          };
        }

        // Fetch the full createdBy user data
        try {
          await createdBy.fetch({ useMasterKey: true });
        } catch (fetchError) {
          logger.error('Error fetching createdBy user', {
            error: fetchError.message,
            quoteId,
            createdById: createdBy.id,
          });
        }

        logger.info('Using createdBy as default owner for quote', {
          quoteId,
          createdById: createdBy.id,
          createdByName: `${createdBy.get('firstName')} ${createdBy.get('lastName')}`,
        });

        // Return createdBy as the current owner without creating ownership record
        return {
          id: createdBy.id,
          username: createdBy.get('username') || '',
          email: createdBy.get('email') || '',
          firstName: createdBy.get('firstName') || 'Usuario',
          lastName: createdBy.get('lastName') || '',
          ownershipStartDate: quote.get('createdAt'),
          ownershipType: 'created_by',
          isDefaultOwner: true, // Indicates this is from createdBy, not formal ownership
          canTransfer: true, // They can transfer ownership
        };
      }

      const owner = ownership.getOwner();

      if (!owner) {
        logger.error('Ownership exists but owner is null', {
          quoteId,
          ownershipId: ownership.id,
        });
        // Return placeholder instead of null to avoid 500 errors
        return {
          id: 'unknown',
          username: 'Usuario Desconocido',
          email: 'unknown@amexing.com',
          firstName: 'Usuario',
          lastName: 'Desconocido',
          ownershipStartDate: ownership.getOwnershipStartDate() || new Date(),
          ownershipType: 'unknown',
          isPlaceholder: true,
        };
      }

      return {
        id: owner.id,
        username: owner.get('username') || 'Sin nombre de usuario',
        email: owner.get('email') || 'Sin correo',
        firstName: owner.get('firstName') || 'Sin nombre',
        lastName: owner.get('lastName') || '',
        ownershipStartDate: ownership.getOwnershipStartDate() || new Date(),
        ownershipType: ownership.getOwnershipType() || 'initial',
      };
    } catch (error) {
      logger.error('Failed to get current owner', {
        error: error.message,
        quoteId,
        stack: error.stack,
      });
      // Return safe placeholder instead of throwing to avoid 500 errors
      return {
        id: 'pending',
        username: '',
        email: '',
        firstName: 'Sin',
        lastName: 'Asignar',
        ownershipStartDate: new Date(),
        ownershipType: 'error',
        isPlaceholder: true,
        error: error.message,
      };
    }
  }

  /**
   * Get ownership history for a quote.
   * @param {string} quoteId - Quote ID.
   * @param {object} options - Query options.
   * @returns {Promise<Array>} Ownership history.
   * @example
   */
  async getOwnershipHistory(quoteId, options = {}) {
    try {
      const quote = await this.getQuoteById(quoteId);
      const history = await QuoteOwnership.getOwnershipHistory(quote, options);

      return history.map((ownership) => this.formatOwnershipResponse(ownership));
    } catch (error) {
      logger.error('Failed to get ownership history', {
        error: error.message,
        quoteId,
      });
      throw error;
    }
  }

  /**
   * Check if a user owns a quote.
   * @param {string} quoteId - Quote ID.
   * @param {string} userId - User ID.
   * @returns {Promise<boolean>} True if user owns the quote.
   * @example
   */
  async isOwner(quoteId, userId) {
    try {
      const quote = await this.getQuoteById(quoteId);
      return await QuoteOwnership.isOwner(quote, userId);
    } catch (error) {
      logger.error('Failed to check ownership', {
        error: error.message,
        quoteId,
        userId,
      });
      return false;
    }
  }

  /**
   * Check if a user can transfer ownership of a quote.
   * @param {string} quoteId - Quote ID.
   * @param {string} userId - User ID.
   * @returns {Promise<boolean>} True if user can transfer ownership.
   * @example
   */
  async canTransferOwnership(quoteId, userId) {
    try {
      // Check if user is the current owner
      const isOwner = await this.isOwner(quoteId, userId);
      if (isOwner) {
        return true;
      }

      // Check if user has admin privileges
      const user = await this.getUserById(userId);
      if (!user) {
        return false;
      }

      const role = user.get('role');
      if (role && (role.get('name') === 'admin' || role.get('name') === 'super_admin')) {
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Failed to check transfer permission', {
        error: error.message,
        quoteId,
        userId,
      });
      return false;
    }
  }

  /**
   * Get quotes owned by a user.
   * @param {string} userId - User ID.
   * @param {object} options - Query options.
   * @returns {Promise<Array>} Array of quotes.
   * @example
   */
  async getOwnedQuotes(userId, options = {}) {
    const { limit = 100, skip = 0, includeInactive = false } = options;

    try {
      const user = await this.getUserById(userId);

      const ownershipQuery = new Parse.Query('QuoteOwnership');
      ownershipQuery.equalTo('owner', user);
      ownershipQuery.equalTo('isCurrent', true);
      ownershipQuery.equalTo('exists', true);
      ownershipQuery.include('quote');
      ownershipQuery.limit(limit);
      ownershipQuery.skip(skip);
      ownershipQuery.descending('ownershipStartDate');

      const ownerships = await ownershipQuery.find({ useMasterKey: true });

      const quotes = [];
      for (const ownership of ownerships) {
        const quote = ownership.getQuote();
        if (!quote) {
          // Skip if no quote
        } else if (!includeInactive && !quote.get('active')) {
          // Skip if inactive and not including inactive
        } else {
          quotes.push({
            id: quote.id,
            folio: quote.get('folio'),
            status: quote.get('status'),
            client: quote.get('client'),
            contactPerson: quote.get('contactPerson'),
            createdAt: quote.createdAt,
            ownershipStartDate: ownership.getOwnershipStartDate(),
            version: quote.get('version'),
            lastEditedAt: quote.get('lastEditedAt'),
            collaboratorCount: (quote.get('collaborators') || []).length,
          });
        }
      }

      logger.info('Retrieved owned quotes', {
        userId,
        count: quotes.length,
      });

      return quotes;
    } catch (error) {
      logger.error('Failed to get owned quotes', {
        error: error.message,
        userId,
      });
      throw error;
    }
  }

  // ================
  // HELPER METHODS
  // ================

  /**
   * Get quote by ID.
   * @param {string} quoteId - Quote ID.
   * @returns {Promise<object>} Quote object.
   * @example
   */
  async getQuoteById(quoteId) {
    const query = new Parse.Query('Quote');
    query.equalTo('exists', true);

    try {
      const quote = await query.get(quoteId, { useMasterKey: true });
      return quote;
    } catch (error) {
      logger.error('Quote not found', { quoteId, error: error.message });
      return null;
    }
  }

  /**
   * Get user by ID.
   * @param {string} userId - User ID.
   * @returns {Promise<object>} User object.
   * @example
   */
  async getUserById(userId) {
    const query = new Parse.Query('AmexingUser');
    query.equalTo('exists', true);
    query.include('role');

    try {
      const user = await query.get(userId, { useMasterKey: true });
      return user;
    } catch (error) {
      logger.error('User not found', { userId, error: error.message });
      return null;
    }
  }

  /**
   * Format ownership response.
   * @param {object} ownership - QuoteOwnership object.
   * @returns {object} Formatted response.
   * @example
   */
  formatOwnershipResponse(ownership) {
    const owner = ownership.getOwner();
    const previousOwner = ownership.getPreviousOwner();

    return {
      id: ownership.id,
      quoteId: ownership.getQuote()?.id,
      owner: owner ? {
        id: owner.id,
        username: owner.get('username'),
        email: owner.get('email'),
        firstName: owner.get('firstName'),
        lastName: owner.get('lastName'),
      } : null,
      previousOwner: previousOwner ? {
        id: previousOwner.id,
        username: previousOwner.get('username'),
        email: previousOwner.get('email'),
        firstName: previousOwner.get('firstName'),
        lastName: previousOwner.get('lastName'),
      } : null,
      ownershipStartDate: ownership.getOwnershipStartDate(),
      ownershipEndDate: ownership.getOwnershipEndDate(),
      ownershipType: ownership.getOwnershipType(),
      transferReason: ownership.getTransferReason(),
      isCurrent: ownership.isCurrent(),
      createdAt: ownership.createdAt,
    };
  }

  /**
   * Create audit log entry.
   * @param {object} data - Audit log data.
   * @returns {Promise<void>}
   */
  /**
   * Get available owners for a quote based on department relationships.
   * For old quotes, uses createdBy user's department relationships.
   * @param {string} quoteId - Quote ID.
   * @returns {Promise<Array>} List of available owner users.
   * @example
   */
  async getAvailableOwners(quoteId) {
    try {
      const quote = await this.getQuoteById(quoteId);
      if (!quote) {
        logger.warn('Quote not found in getAvailableOwners', { quoteId });
        return [];
      }

      // Get the quote's client (which is the department manager)
      const client = quote.getClient();

      if (!client) {
        logger.warn('Quote has no client selected, cannot determine available owners', { quoteId });
        // Return special indicator that client is required
        return { requiresClient: true, users: [] };
      }

      // Fetch the client to ensure we have all their data
      await client.fetch({ useMasterKey: true });

      // The client IS the department manager
      const departmentManagerId = client.id;

      logger.info('Using quote client as department manager for ownership', {
        quoteId,
        clientId: departmentManagerId,
        clientName: `${client.get('firstName')} ${client.get('lastName')}`,
        clientRole: client.get('role'),
      });

      // Build queries for available owners
      const queries = [];

      // 1. Get the department manager themselves (the selected client)
      const managerQuery = new Parse.Query('AmexingUser');
      managerQuery.equalTo('objectId', departmentManagerId);
      queries.push(managerQuery);

      // 2. Get all client role users (agents) related to this department manager
      // These are users with role='client' and clientId=departmentManagerId
      const agentsQuery = new Parse.Query('AmexingUser');
      agentsQuery.equalTo('role', 'client');
      agentsQuery.equalTo('clientId', departmentManagerId);
      queries.push(agentsQuery);

      // 3. Always include admins for oversight
      const adminQuery = new Parse.Query('AmexingUser');
      adminQuery.containedIn('role', ['admin', 'superadmin']);
      queries.push(adminQuery);

      // Combine queries with OR
      const combinedQuery = Parse.Query.or(...queries);
      combinedQuery.equalTo('active', true);
      combinedQuery.equalTo('exists', true);
      combinedQuery.ascending('firstName', 'lastName');
      combinedQuery.limit(1000); // Reasonable limit

      const users = await combinedQuery.find({ useMasterKey: true });

      logger.info('Found available owners for quote', {
        quoteId,
        departmentManagerId,
        userCount: users.length,
      });

      return users;
    } catch (error) {
      logger.error('Failed to get available owners', {
        error: error.message,
        quoteId,
      });
      // Return safe fallback
      return this.getAllDepartmentManagersAndAdmins();
    }
  }

  /**
   * Get all department managers and admin users as fallback.
   * @returns {Promise<Array>} List of manager and admin users.
   * @example
   */
  async getAllDepartmentManagersAndAdmins() {
    try {
      const query = new Parse.Query('AmexingUser');
      query.containedIn('role', ['department_manager', 'admin', 'superadmin']);
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.ascending('firstName', 'lastName');
      query.limit(500);

      const users = await query.find({ useMasterKey: true });

      logger.info('Returning all managers and admins as fallback', {
        userCount: users.length,
      });

      return users;
    } catch (error) {
      logger.error('Failed to get managers and admins', {
        error: error.message,
      });
      return [];
    }
  }

  async createAuditLog(data) {
    try {
      const auditLog = new AuditLog();
      auditLog.set('action', data.action);
      auditLog.set('objectClass', data.objectClass);
      auditLog.set('objectId', data.objectId);
      auditLog.set('userId', data.userId);
      auditLog.set('details', data.details);
      auditLog.set('ipAddress', data.ipAddress || 'system');
      auditLog.set('userAgent', data.userAgent || 'system');
      auditLog.set('active', true);
      auditLog.set('exists', true);

      await auditLog.save(null, { useMasterKey: true });
    } catch (error) {
      logger.error('Failed to create audit log', {
        error: error.message,
        data,
      });
    }
  }
}

module.exports = QuoteOwnershipService;
