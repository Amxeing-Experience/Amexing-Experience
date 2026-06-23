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
      let currentOwner;

      // Determine current owner (either from ownership record or createdBy)
      const currentOwnership = await QuoteOwnership.getCurrentOwnership(quote);
      if (currentOwnership) {
        currentOwner = currentOwnership.getOwner();
        logger.info('Found existing ownership record', {
          quoteId,
          ownershipId: currentOwnership.id,
          currentOwnerId: currentOwner ? currentOwner.id : null,
        });
      } else {
        // No ownership record - use createdBy as current owner
        currentOwner = quote.getCreatedBy();
        if (!currentOwner) {
          throw new Error('No ownership record and no createdBy found for quote');
        }

        // Fetch the user data
        try {
          await currentOwner.fetch({ useMasterKey: true });
        } catch (fetchError) {
          logger.error('Failed to fetch current owner (createdBy) user', {
            error: fetchError.message,
            ownerId: currentOwner.id,
            quoteId,
          });
        }

        logger.info('Using createdBy as current owner for transfer', {
          quoteId,
          currentOwnerId: currentOwner.id,
          currentOwnerName: `${currentOwner.get('firstName')} ${currentOwner.get('lastName')}`,
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

      // CRITICAL: Validate data consistency after transfer
      logger.info('Starting post-transfer validation', { quoteId, newOwnerId });
      try {
        await this.validateOwnershipConsistency(quoteId, newOwnerId, newOwnership);
      } catch (validationError) {
        logger.error('Ownership validation failed after transfer', {
          error: validationError.message,
          quoteId,
          newOwnerId,
          ownershipId: newOwnership.id,
        });
        // Don't fail the transfer, but log the issue for investigation
        console.warn('⚠️ OWNERSHIP VALIDATION FAILED:', validationError.message);
      }

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

      // Previous owner access is now handled by QuoteOwnership.transferOwnership()
      // which deactivates their collaboration to ensure clean ownership transfers
      console.log('Previous owner collaboration access has been deactivated by ownership transfer');

      // Previous owner is no longer automatically added to collaborators
      // Clean ownership transfers require complete access removal

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

      // If no formal ownership exists, check Quote.owner field first
      if (!ownership) {
        logger.info('No formal QuoteOwnership record found, checking Quote.owner field', {
          quoteId,
          quoteCreatedAt: quote.get('createdAt'),
        });

        // PRIORITY 1: Check Quote.owner field (set during ownership transfers)
        const quoteOwner = quote.getOwner();
        if (quoteOwner) {
          logger.info('Found Quote.owner field, using as current owner', {
            quoteId,
            ownerId: quoteOwner.id,
          });

          // Fetch the full owner user data
          try {
            await quoteOwner.fetch({ useMasterKey: true });

            logger.info('Successfully fetched Quote.owner data', {
              quoteId,
              ownerId: quoteOwner.id,
              ownerName: `${quoteOwner.get('firstName')} ${quoteOwner.get('lastName')}`,
            });

            // Return the Quote.owner as current owner
            return {
              id: quoteOwner.id,
              username: quoteOwner.get('username') || '',
              email: quoteOwner.get('email') || '',
              firstName: quoteOwner.get('firstName') || 'Usuario',
              lastName: quoteOwner.get('lastName') || '',
              ownershipStartDate: quote.get('lastEditedAt') || quote.get('createdAt'), // Use last edit as best guess for ownership date
              ownershipType: 'quote_owner_field',
              isFromQuoteField: true, // Indicates this is from Quote.owner field
              canTransfer: true,
              needsOwnershipRecord: true, // Suggests creating formal ownership record
            };
          } catch (fetchError) {
            logger.error('Error fetching Quote.owner user data', {
              error: fetchError.message,
              quoteId,
              ownerId: quoteOwner.id,
            });

            // Continue to next fallback even if fetch failed
            logger.warn('Quote.owner fetch failed, trying next fallback', { quoteId });
          }
        } else {
          logger.info('No Quote.owner field found, checking createdBy fallback', { quoteId });
        }

        // PRIORITY 2: Fallback to createdBy if Quote.owner doesn't exist or fetch failed
        const createdBy = quote.getCreatedBy();

        if (!createdBy) {
          logger.warn('Quote has no createdBy field and no ownership', {
            quoteId,
            quoteData: {
              id: quote.id,
              folio: quote.get('folio'),
              createdAt: quote.get('createdAt'),
              hasOwnerField: !!quoteOwner,
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

        logger.info('Using createdBy as default owner for quote (final fallback)', {
          quoteId,
          createdById: createdBy.id,
          createdByName: `${createdBy.get('firstName')} ${createdBy.get('lastName')}`,
          hadQuoteOwner: !!quoteOwner,
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

      // Resolve the owner role so the public summary can swap "Atención a" for
      // the contact when the owner is an admin/superadmin. Prefer the direct
      // role field, fall back to displayRole, then the Role pointer name.
      let ownerRole = (owner.get('role') || owner.get('displayRole') || '').toString().toLowerCase();
      if (!ownerRole) {
        const rolePtr = owner.get('roleId');
        if (rolePtr && typeof rolePtr === 'object') {
          try {
            if (typeof rolePtr.fetch === 'function' && !rolePtr.get('name')) {
              await rolePtr.fetch({ useMasterKey: true });
            }
            ownerRole = (rolePtr.get && (rolePtr.get('name') || '')).toString().toLowerCase();
          } catch (e) {
            // role lookup is best-effort
          }
        }
      }

      return {
        id: owner.id,
        username: owner.get('username') || 'Sin nombre de usuario',
        email: owner.get('email') || 'Sin correo',
        firstName: owner.get('firstName') || 'Sin nombre',
        lastName: owner.get('lastName') || '',
        role: ownerRole,
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
          // Allow department_manager and client roles to transfer ownership if they are the owner
          hasAdminRole = ['admin', 'superadmin', 'super_admin', 'department_manager', 'client'].includes(roleName);

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
        hasAdminRole = ['admin', 'superadmin', 'super_admin', 'department_manager', 'client'].includes(role);
        logger.info('Checked role field (string) for admin privileges', {
          quoteId,
          userId,
          role,
          hasAdminRole,
        });
      } else if (typeof displayRole === 'string' && displayRole) {
        roleToCheck = displayRole;
        hasAdminRole = ['admin', 'superadmin', 'super_admin', 'department_manager', 'client'].includes(displayRole);
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
        hasAdminRole = ['admin', 'superadmin', 'super_admin', 'department_manager', 'client'].includes(roleName);
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

      // Get the quote's client company (Client table, not AmexingUser)
      const companyClient = quote.get('companyClientPtr');
      const legacyClient = quote.getClient(); // AmexingUser for backward compatibility
      const clientType = quote.get('clientType'); // Check if this is a direct client quote

      // For direct client quotes (clientType = "direct"), only companyClientPtr is required
      // For agency quotes, either companyClient or legacyClient is required
      const isDirectClient = clientType === 'direct';
      const hasValidClient = companyClient || legacyClient;

      if (!hasValidClient) {
        logger.warn('Quote has no client selected, cannot determine available owners', {
          quoteId,
          isDirectClient,
          hasCompanyClient: !!companyClient,
          hasLegacyClient: !!legacyClient,
        });
        // Return special indicator that client is required
        return { requiresClient: true, users: [] };
      }

      // Log what type of client we're working with
      logger.info('Processing quote client for ownership', {
        quoteId,
        clientType: isDirectClient ? 'direct' : 'agency',
        hasCompanyClient: !!companyClient,
        hasLegacyClient: !!legacyClient,
      });

      let departmentManagerId = null;
      let clientInfo = {};

      // For direct client quotes, we don't need a department manager
      if (isDirectClient) {
        logger.info('Direct client quote - skipping department manager lookup', {
          quoteId,
          clientType: 'direct',
        });
        // Set clientInfo for logging purposes
        if (companyClient) {
          await companyClient.fetch({ useMasterKey: true });
          clientInfo = {
            clientId: companyClient.id,
            clientName: companyClient.get('name') || `${companyClient.get('firstName')} ${companyClient.get('lastName')}`,
            clientType: 'Direct Client',
          };
        }
      } else {
        // For agency quotes, find the department manager
        // Priority 1: Use new companyClientPtr (Client table)
        if (companyClient) {
          await companyClient.fetch({ useMasterKey: true });

          // Find the AmexingUser who owns this Client company
          const ownerQuery = new Parse.Query('AmexingUser');
          ownerQuery.equalTo('ownedClients', companyClient);
          ownerQuery.equalTo('exists', true);
          const ownerUser = await ownerQuery.first({ useMasterKey: true });

          if (ownerUser) {
            departmentManagerId = ownerUser.id;
            clientInfo = {
              clientId: companyClient.id,
              clientName: companyClient.get('name') || `${companyClient.get('firstName')} ${companyClient.get('lastName')}`,
              clientType: 'Client',
              departmentManagerId: ownerUser.id,
              departmentManagerName: `${ownerUser.get('firstName')} ${ownerUser.get('lastName')}`,
            };
          } else {
            logger.warn('No owner found for Client company, falling back to legacy client', {
              quoteId,
              companyClientId: companyClient.id,
              companyClientName: companyClient.get('name'),
            });
          }
        }

        // Priority 2: Fallback to legacy client field (AmexingUser)
        if (!departmentManagerId && legacyClient) {
          await legacyClient.fetch({ useMasterKey: true });
          departmentManagerId = legacyClient.id;
          clientInfo = {
            clientId: legacyClient.id,
            clientName: `${legacyClient.get('firstName')} ${legacyClient.get('lastName')}`,
            clientType: 'AmexingUser',
            departmentManagerId: legacyClient.id,
            departmentManagerName: `${legacyClient.get('firstName')} ${legacyClient.get('lastName')}`,
          };
        }

        // Only require department manager for agency quotes
        if (!departmentManagerId) {
          logger.error('Could not determine department manager from quote client data', {
            quoteId,
            hasCompanyClient: !!companyClient,
            hasLegacyClient: !!legacyClient,
          });
          return { requiresClient: true, users: [] };
        }
      }

      // Handle different logic for direct client vs agency quotes
      let users = [];

      if (isDirectClient) {
        // For direct client quotes, only return admin and superadmin users
        logger.info('Processing direct client quote - only including admin/superadmin users', {
          quoteId,
          clientType: 'direct',
        });

        // Create subquery to find Role records with admin names
        const adminRoleQuery = new Parse.Query('Role');
        adminRoleQuery.containedIn('name', ['admin', 'superadmin']);

        // Query users who have roleId pointing to admin roles
        const adminQuery = new Parse.Query('AmexingUser');
        adminQuery.matchesQuery('roleId', adminRoleQuery);
        adminQuery.equalTo('active', true);
        adminQuery.equalTo('exists', true);
        adminQuery.ascending('firstName', 'lastName');
        adminQuery.include('roleId'); // Include the Role object data
        adminQuery.limit(1000); // Reasonable limit

        users = await adminQuery.find({ useMasterKey: true });

        logger.info('Found admin/superadmin users for direct client quote', {
          quoteId,
          userCount: users.length,
        });
      } else {
        // For agency quotes, use existing logic (department manager + agents + admins)
        logger.info('Processing agency quote - including department manager, agents, and admins', {
          quoteId,
          departmentManagerId,
          ...clientInfo,
        });

        // Build queries for available owners
        const queries = [];

        // 1. Get the department manager themselves (the selected client)
        if (departmentManagerId) {
          const managerQuery = new Parse.Query('AmexingUser');
          managerQuery.equalTo('objectId', departmentManagerId);
          queries.push(managerQuery);

          // 2. Get all client role users (agents) related to this department manager
          // These are users with role='client' and clientId=departmentManagerId
          const agentsQuery = new Parse.Query('AmexingUser');
          agentsQuery.equalTo('role', 'client');
          agentsQuery.equalTo('clientId', departmentManagerId);
          queries.push(agentsQuery);
        }

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
        combinedQuery.include('roleId'); // Include the Role object data
        combinedQuery.limit(1000); // Reasonable limit

        users = await combinedQuery.find({ useMasterKey: true });

        logger.info('Found available owners for agency quote', {
          quoteId,
          departmentManagerId,
          userCount: users.length,
        });
      }

      // Final logging
      logger.info('Available owners query completed', {
        quoteId,
        isDirectClient,
        userCount: users.length,
        departmentManagerId: isDirectClient ? 'N/A (direct client)' : departmentManagerId,
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
      query.include('roleId'); // Include the Role object data
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

  /**
   * Persist an audit log entry for an ownership-related action. Failures are
   * swallowed and logged so auditing never blocks the calling operation.
   * @param {object} data - Audit fields.
   * @param {string} data.action - Action performed (e.g. 'TRANSFER_OWNERSHIP').
   * @param {string} data.objectClass - Parse class name of the affected object.
   * @param {string} data.objectId - Object ID of the affected record.
   * @param {string} data.userId - User who performed the action.
   * @param {object} data.details - Arbitrary action-specific details.
   * @param {string} [data.ipAddress] - Originating IP address (defaults to 'system').
   * @param {string} [data.userAgent] - Originating user agent (defaults to 'system').
   * @returns {Promise<void>}
   * @example
   *   await service.createAuditLog({ action: 'TRANSFER_OWNERSHIP', objectClass: 'Quote', objectId: 'abc', userId: 'u1', details: {} });
   */
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

  /**
   * Validate ownership data consistency after transfer.
   * Ensures both Quote.owner field and QuoteOwnership records are correct.
   * @param {string} quoteId - Quote ID.
   * @param {string} expectedOwnerId - Expected owner user ID.
   * @param {object} newOwnership - Newly created QuoteOwnership record.
   * @returns {Promise<object>} Validation results.
   * @example
   */
  async validateOwnershipConsistency(quoteId, expectedOwnerId, newOwnership) {
    logger.info('Validating ownership consistency', { quoteId, expectedOwnerId });

    const issues = [];
    const validation = {
      quoteId,
      expectedOwnerId,
      timestamp: new Date(),
      isConsistent: true,
      issues: [],
      details: {},
    };

    try {
      // 1. Re-fetch the quote to get fresh data
      const freshQuote = await this.getQuoteById(quoteId);
      if (!freshQuote) {
        throw new Error('Quote not found during validation');
      }

      // 2. Check Quote.owner field
      const quoteOwner = freshQuote.getOwner();
      const quoteOwnerId = quoteOwner?.id;
      validation.details.quoteOwnerId = quoteOwnerId;

      if (!quoteOwnerId) {
        issues.push('Quote.owner field is null after transfer');
        validation.isConsistent = false;
      } else if (quoteOwnerId !== expectedOwnerId) {
        issues.push(`Quote.owner mismatch: expected ${expectedOwnerId}, got ${quoteOwnerId}`);
        validation.isConsistent = false;
      } else {
        logger.info('✅ Quote.owner field validation passed', { quoteId, ownerId: quoteOwnerId });
      }

      // 3. Check QuoteOwnership record
      const currentOwnership = await QuoteOwnership.getCurrentOwnership(freshQuote);
      validation.details.hasOwnershipRecord = !!currentOwnership;
      validation.details.ownershipId = currentOwnership?.id;
      validation.details.ownershipOwnerId = currentOwnership?.getOwner()?.id;

      if (!currentOwnership) {
        issues.push('No current QuoteOwnership record found after transfer');
        validation.isConsistent = false;
      } else if (currentOwnership.id !== newOwnership.id) {
        issues.push(`QuoteOwnership ID mismatch: expected ${newOwnership.id}, got ${currentOwnership.id}`);
        validation.isConsistent = false;
      } else {
        const ownershipOwnerId = currentOwnership.getOwner()?.id;
        if (!ownershipOwnerId) {
          issues.push('QuoteOwnership.owner is null after transfer');
          validation.isConsistent = false;
        } else if (ownershipOwnerId !== expectedOwnerId) {
          issues.push(`QuoteOwnership.owner mismatch: expected ${expectedOwnerId}, got ${ownershipOwnerId}`);
          validation.isConsistent = false;
        } else {
          logger.info('✅ QuoteOwnership record validation passed', {
            quoteId,
            ownerId: ownershipOwnerId,
            ownershipId: currentOwnership.id,
          });
        }
      }

      // 4. Cross-validate both sources
      if (quoteOwnerId && validation.details.ownershipOwnerId && quoteOwnerId !== validation.details.ownershipOwnerId) {
        issues.push(`Ownership mismatch between Quote.owner (${quoteOwnerId}) and QuoteOwnership.owner (${validation.details.ownershipOwnerId})`);
        validation.isConsistent = false;
      }

      validation.issues = issues;

      // 5. Log results
      if (validation.isConsistent) {
        logger.info('🎉 Ownership validation PASSED - Data is consistent', {
          quoteId,
          expectedOwnerId,
          quoteOwnerId,
          ownershipOwnerId: validation.details.ownershipOwnerId,
        });
      } else {
        logger.error('❌ Ownership validation FAILED - Data inconsistency detected', {
          quoteId,
          expectedOwnerId,
          issues,
          details: validation.details,
        });
      }

      return validation;
    } catch (error) {
      logger.error('Ownership validation error', {
        error: error.message,
        quoteId,
        expectedOwnerId,
      });
      throw error;
    }
  }

  /**
   * Recover and repair ownership state for quotes with inconsistent data.
   * Creates formal ownership records for quotes that only have createdBy.
   * @param {string} quoteId - Quote ID to repair.
   * @returns {Promise<object>} Recovery results.
   * @example
   */
  async recoverOwnershipState(quoteId) {
    try {
      const quote = await this.getQuoteById(quoteId);
      if (!quote) {
        throw new Error('Quote not found');
      }

      // Check if formal ownership already exists
      const existingOwnership = await QuoteOwnership.getCurrentOwnership(quote);
      if (existingOwnership) {
        logger.info('Quote already has formal ownership record', {
          quoteId,
          ownershipId: existingOwnership.id,
        });
        return {
          recovered: false,
          reason: 'Already has formal ownership',
          ownershipId: existingOwnership.id,
        };
      }

      // Check if quote has owner field
      const quoteOwner = quote.getOwner();
      const createdBy = quote.getCreatedBy();

      const ownerToUse = quoteOwner || createdBy;
      if (!ownerToUse) {
        throw new Error('No owner or createdBy found for quote');
      }

      // Fetch user data
      await ownerToUse.fetch({ useMasterKey: true });

      // Create formal ownership record
      const recoveredOwnership = await QuoteOwnership.createInitialOwnership(quote, ownerToUse);

      logger.info('Successfully recovered ownership state', {
        quoteId,
        recoveredOwnershipId: recoveredOwnership.id,
        ownerId: ownerToUse.id,
        ownerSource: quoteOwner ? 'quote.owner' : 'quote.createdBy',
      });

      return {
        recovered: true,
        ownershipId: recoveredOwnership.id,
        ownerId: ownerToUse.id,
        ownerSource: quoteOwner ? 'quote.owner' : 'quote.createdBy',
      };
    } catch (error) {
      logger.error('Failed to recover ownership state', {
        error: error.message,
        quoteId,
      });
      throw error;
    }
  }
}

module.exports = QuoteOwnershipService;
