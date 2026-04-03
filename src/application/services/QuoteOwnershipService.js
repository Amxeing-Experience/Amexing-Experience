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

      logger.info('Transfer ownership - checking existing ownership', {
        quoteId,
        hasOwnership: !!currentOwnership,
        quoteExists: !!quote,
      });

      if (!currentOwnership) {
        // No formal ownership yet, check if we have createdBy
        const createdBy = quote.getCreatedBy();

        logger.info('No existing ownership, checking createdBy', {
          quoteId,
          hasCreatedBy: !!createdBy,
          createdById: createdBy ? createdBy.id : null,
        });

        if (!createdBy) {
          throw new Error('No ownership and no createdBy found for quote');
        }

        logger.info('Creating initial ownership from createdBy for transfer', {
          quoteId,
          createdById: createdBy.id,
          newOwnerId,
        });

        // Fetch the createdBy user to ensure we have all attributes
        if (createdBy.get && createdBy.id) {
          try {
            await createdBy.fetch({ useMasterKey: true });
          } catch (fetchError) {
            logger.error('Failed to fetch createdBy user', {
              error: fetchError.message,
              createdById: createdBy.id,
              quoteId,
            });
          }
        }

        try {
          // Validate that we have valid objects before creating ownership
          if (!quote || !quote.id) {
            throw new Error('Invalid quote object provided to createInitialOwnership');
          }
          if (!createdBy || !createdBy.id) {
            throw new Error('Invalid createdBy user object provided to createInitialOwnership');
          }

          logger.info('Creating initial ownership with validated objects', {
            quoteId: quote.id,
            createdById: createdBy.id,
            createdByActive: createdBy.get ? createdBy.get('active') : 'unknown',
            createdByExists: createdBy.get ? createdBy.get('exists') : 'unknown',
          });

          // Ensure createdBy has proper Parse pointer structure
          // The issue is that createdBy doesn't have objectId property
          if (createdBy && createdBy.id && !createdBy.objectId) {
            console.log('=== FIXING CREATED BY POINTER ===');
            console.log('createdBy.id before:', createdBy.id);
            console.log('createdBy.objectId before:', createdBy.objectId);

            // Set objectId property to match id
            createdBy.objectId = createdBy.id;

            console.log('createdBy.objectId after:', createdBy.objectId);
            console.log('=== FIXED CREATED BY POINTER ===');
          }

          // Create initial ownership record for createdBy user
          currentOwnership = await QuoteOwnership.createInitialOwnership(quote, createdBy);
          currentOwner = createdBy;

          logger.info('Successfully created initial ownership', {
            quoteId,
            ownershipId: currentOwnership.id,
            currentOwnerId: currentOwner.id,
          });
        } catch (createError) {
          logger.error('Failed to create initial ownership', {
            error: createError.message,
            stack: createError.stack,
            quoteId,
            createdById: createdBy ? createdBy.id : 'null',
            quoteExists: !!quote,
            createdByExists: !!createdBy,
            isOwnerRequiredError: createError.message.includes('Owner is required'),
          });

          // If it's specifically the "Owner is required" validation error,
          // try a more explicit approach
          if (createError.message.includes('Owner is required')) {
            console.log('=== OWNER VALIDATION FAILED DEBUG ===');
            console.log('createdByType:', typeof createdBy);
            console.log('createdById:', createdBy ? createdBy.id : null);
            console.log('createdByClassName:', createdBy ? createdBy.className : null);
            console.log('hasGetMethod:', !!(createdBy && createdBy.get));
            console.log('createdBy instanceof Parse.Object:', createdBy instanceof Parse.Object);
            console.log('createdBy instanceof Parse.User:', createdBy instanceof Parse.User);
            console.log('createdBy has objectId:', !!createdBy.objectId);
            console.log('=== END OWNER DEBUG ===');

            logger.error('Owner validation failed - investigating createdBy user object', {
              createdByType: typeof createdBy,
              createdById: createdBy ? createdBy.id : null,
              createdByClassName: createdBy ? createdBy.className : null,
              hasGetMethod: !!(createdBy && createdBy.get),
              quoteId,
            });
          }

          throw createError;
        }
      } else {
        currentOwner = currentOwnership.getOwner();
        logger.info('Using existing ownership', {
          quoteId,
          ownershipId: currentOwnership.id,
          currentOwnerId: currentOwner ? currentOwner.id : null,
        });
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
      console.log('=== UPDATING QUOTE WITH NEW OWNER ===');
      console.log('Quote ID:', quote.id);
      console.log('Current Owner before update:', quote.getOwner()?.id);
      console.log('New Owner ID:', newOwner.id);

      quote.setOwner(newOwner);
      quote.setLastEditedBy(transferredBy);
      quote.setLastEditedAt(new Date());
      quote.incrementVersion();

      console.log('Quote Owner after setOwner:', quote.getOwner()?.id);
      console.log('About to save quote...');

      await quote.save(null, { useMasterKey: true });

      console.log('Quote saved successfully!');
      console.log('Final verification - Quote Owner after save:', quote.getOwner()?.id);
      console.log('=== QUOTE UPDATE COMPLETED ===');

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

      // Remove new owner from collaborators if they exist there
      // (ownership supersedes collaboration)
      const updatedCollaborators = quote.getCollaborators();
      const newOwnerIndex = updatedCollaborators.indexOf(newOwnerId);
      if (newOwnerIndex > -1) {
        updatedCollaborators.splice(newOwnerIndex, 1);
        quote.setCollaborators(updatedCollaborators);
        await quote.save(null, { useMasterKey: true });

        logger.info('Removed new owner from collaborators list', {
          quoteId,
          newOwnerId,
          removedFromPosition: newOwnerIndex,
        });
      }

      // Revoke any existing QuoteAccess records for the new owner
      // (ownership supersedes collaboration access)
      try {
        const existingAccess = await QuoteAccess.getAgentAccess(quote, newOwner);
        if (existingAccess && existingAccess.isValid()) {
          await QuoteAccess.revokeAccess(
            quote,
            newOwner,
            transferredBy,
            'Ownership supersedes collaboration access'
          );

          logger.info('Revoked existing collaboration access for new owner', {
            quoteId,
            newOwnerId,
            previousRole: existingAccess.getRole(),
          });
        }
      } catch (accessCleanupError) {
        // Log but don't fail the transfer - this is cleanup
        logger.warn('Failed to cleanup existing access for new owner', {
          error: accessCleanupError.message,
          quoteId,
          newOwnerId,
        });
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
        logger.info('User can transfer ownership - is current owner', {
          quoteId,
          userId,
        });
        return true;
      }

      // Check if user has admin privileges
      const user = await this.getUserById(userId);
      if (!user) {
        logger.warn('User not found for transfer permission check', {
          quoteId,
          userId,
        });
        return false;
      }

      // Try multiple approaches to get user role
      const role = user.get('role');
      const displayRole = user.get('displayRole');
      const rolePointer = user.get('roleId');

      logger.info('Checking user role for transfer permission', {
        quoteId,
        userId,
        hasRole: !!role,
        hasDisplayRole: !!displayRole,
        hasRolePointer: !!rolePointer,
      });

      // Handle both string roles (legacy) and role objects (new system)
      let hasAdminRole = false;
      let roleToCheck = null;

      // Priority order: rolePointer (actual role), role field, then displayRole field
      if (rolePointer && typeof rolePointer === 'object') {
        // Try rolePointer object - need to fetch it first if it's just an ID reference
        try {
          let roleObject = rolePointer;

          // The rolePointer is already a Parse Role object but needs to be fetched to get attributes
          if (rolePointer.get && rolePointer.id) {
            try {
              // Fetch the role attributes
              await rolePointer.fetch({ useMasterKey: true });
              roleObject = rolePointer;
            } catch (fetchError) {
              logger.error('Failed to fetch role from rolePointer', {
                error: fetchError.message,
                rolePointerId: rolePointer.id,
                quoteId,
                userId,
              });
              // If fetching fails, try to use the existing roleObject
              roleObject = rolePointer;
            }
          }

          const roleName = roleObject && roleObject.get ? roleObject.get('name') : undefined;
          roleToCheck = roleName;
          hasAdminRole = ['admin', 'superadmin', 'super_admin', 'department_manager'].includes(roleName);

          logger.info('Checked rolePointer object for admin privileges', {
            quoteId,
            userId,
            roleName,
            roleLevel: roleObject && roleObject.get ? roleObject.get('level') : undefined,
            hasAdminRole,
          });
        } catch (fetchError) {
          logger.error('Failed to fetch role from rolePointer', {
            error: fetchError.message,
            rolePointerId: rolePointer.objectId,
            quoteId,
            userId,
          });
        }
      } else if (typeof role === 'string' && role) {
        roleToCheck = role;
        hasAdminRole = ['admin', 'superadmin', 'super_admin'].includes(role);
        logger.info('Checked role field (string) for admin privileges', {
          quoteId,
          userId,
          role,
          hasAdminRole,
        });
      } else if (typeof displayRole === 'string' && displayRole) {
        roleToCheck = displayRole;
        hasAdminRole = ['admin', 'superadmin', 'super_admin'].includes(displayRole);
        logger.info('Checked displayRole field (string) for admin privileges', {
          quoteId,
          userId,
          displayRole,
          hasAdminRole,
        });
      } else if (role && typeof role === 'object' && role.get) {
        // New role system - role is a Parse object
        const roleName = role.get('name');
        roleToCheck = roleName;
        hasAdminRole = ['admin', 'superadmin', 'super_admin'].includes(roleName);
        logger.info('Checked role object for admin privileges', {
          quoteId,
          userId,
          roleName,
          hasAdminRole,
        });
      } else {
        logger.warn('No valid role field found', {
          quoteId,
          userId,
          role,
          roleType: typeof role,
          displayRole,
          displayRoleType: typeof displayRole,
          rolePointer,
          rolePointerType: typeof rolePointer,
          availableFields: Object.keys(user.attributes || {}),
        });
      }

      if (hasAdminRole) {
        logger.info('User can transfer ownership - has admin role', {
          quoteId,
          userId,
          roleToCheck,
        });
        return true;
      }

      logger.info('User cannot transfer ownership - insufficient privileges', {
        quoteId,
        userId,
        roleToCheck,
        hasAdminRole,
      });
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
      // Create subquery to find Role records with admin names
      const adminRoleQuery = new Parse.Query('Role');
      adminRoleQuery.containedIn('name', ['admin', 'superadmin']);

      // Query users who have roleId pointing to admin roles
      const adminQuery = new Parse.Query('AmexingUser');
      adminQuery.matchesQuery('roleId', adminRoleQuery);
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
      // Create separate queries for different role types
      const roleQueries = [];

      // Department manager role (try both approaches)
      const deptMgrRoleQuery = new Parse.Query('Role');
      deptMgrRoleQuery.equalTo('name', 'department_manager');
      const deptMgrQuery = new Parse.Query('AmexingUser');
      deptMgrQuery.matchesQuery('roleId', deptMgrRoleQuery);
      roleQueries.push(deptMgrQuery);

      // Also try string-based dept manager for backward compatibility
      const deptMgrStringQuery = new Parse.Query('AmexingUser');
      deptMgrStringQuery.equalTo('role', 'department_manager');
      roleQueries.push(deptMgrStringQuery);

      // Admin roles (use roleId pointer)
      const adminRoleQuery = new Parse.Query('Role');
      adminRoleQuery.containedIn('name', ['admin', 'superadmin']);
      const adminQuery = new Parse.Query('AmexingUser');
      adminQuery.matchesQuery('roleId', adminRoleQuery);
      roleQueries.push(adminQuery);

      // Combine the queries
      const query = Parse.Query.or(...roleQueries);
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
