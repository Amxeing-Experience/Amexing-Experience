/**
 * QuoteCollaborationService - Business logic for quote collaboration management.
 * Handles agent access permissions, role management, and collaborative editing.
 *
 * Features:
 * - Grant/revoke access to agents
 * - Manage editor/viewer roles
 * - Track active collaborators
 * - Handle concurrent editing
 * - Validate access permissions.
 *
 * Created by Denisse Maldonado.
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const Quote = require('../../domain/models/Quote');
const QuoteAccess = require('../../domain/models/QuoteAccess');
const QuoteOwnership = require('../../domain/models/QuoteOwnership');
const QuoteEdit = require('../../domain/models/QuoteEdit');
const AmexingUser = require('../../domain/models/AmexingUser');
const logger = require('../../infrastructure/logger');
const AuditLog = require('../../domain/models/AuditLog');
const { isAgencyOwnerOfQuote } = require('../utils/agencyScope');

/**
 * Service class for managing quote collaboration.
 */
class QuoteCollaborationService {
  constructor() {
    this.Quote = Quote;
    this.QuoteAccess = QuoteAccess;
    this.QuoteOwnership = QuoteOwnership;
    this.QuoteEdit = QuoteEdit;
    this.AmexingUser = AmexingUser;
  }

  /**
   * Grant access to an agent for a quote.
   * @param {string} quoteId - Quote ID.
   * @param {string} agentId - Agent user ID.
   * @param {string} role - Access role (editor/viewer).
   * @param {string} grantedById - User granting access.
   * @param {object} options - Additional options.
   * @returns {Promise<object>} Access record.
   * @example
   */
  async grantAccess(quoteId, agentId, role, grantedById, options = {}) {
    try {
      // Debug logging for service layer
      logger.info('QuoteCollaborationService.grantAccess - Parameters received', {
        quoteId,
        agentId,
        role,
        grantedById,
        options,
        agentIdType: typeof agentId,
        agentIdValue: JSON.stringify(agentId),
      });

      // Validate permission to grant access - pass userRole from options
      const canGrant = await this.canGrantAccess(quoteId, grantedById, options.userRole);
      if (!canGrant) {
        throw new Error('User does not have permission to grant access');
      }

      // Validate role
      if (!Object.values(QuoteAccess.ROLES).includes(role)) {
        throw new Error(`Invalid role: ${role}. Must be 'editor' or 'viewer'`);
      }

      // Get entities
      logger.info('QuoteCollaborationService.grantAccess - Fetching entities', {
        quoteId,
        agentId,
        grantedById,
      });

      const quote = await this.getQuoteById(quoteId);
      const agent = await this.getUserById(agentId);
      const grantedBy = await this.getUserById(grantedById);

      logger.info('QuoteCollaborationService.grantAccess - Entity fetch results', {
        quoteFound: !!quote,
        agentFound: !!agent,
        grantedByFound: !!grantedBy,
        agentId,
      });

      if (!quote) {
        throw new Error('Quote not found');
      }

      if (!agent) {
        logger.error('QuoteCollaborationService.grantAccess - Agent user not found', {
          agentId,
          agentIdType: typeof agentId,
          agentIdLength: agentId?.length,
        });
        throw new Error(`Agent user not found. User ID '${agentId}' does not exist in the database.`);
      }

      if (!grantedBy) {
        throw new Error('Granting user not found');
      }

      // Check if agent is the current owner
      // (ownership supersedes collaboration)
      let isCurrentOwner = false;
      try {
        isCurrentOwner = await QuoteOwnership.isOwner(quote, agent);
      } catch (ownershipCheckError) {
        logger.warn('Could not verify ownership status during access grant', {
          error: ownershipCheckError.message,
          quoteId,
          agentId,
        });
      }

      if (isCurrentOwner) {
        const errorMessage = `Cannot grant collaborator access to the current owner. User '${agent.get('firstName')} ${agent.get('lastName')}' (${agent.get('email')}) is already the owner of this quote.`;
        logger.warn('Attempted to grant access to current owner', {
          quoteId,
          agentId,
          agentName: `${agent.get('firstName')} ${agent.get('lastName')}`,
          agentEmail: agent.get('email'),
        });
        throw new Error(errorMessage);
      }

      // Grant access
      const access = await QuoteAccess.grantAccess(
        quote,
        agent,
        role,
        grantedBy,
        options
      );

      logger.info('QuoteCollaborationService.grantAccess - QuoteAccess.grantAccess completed successfully, proceeding with post-save steps', {
        accessId: access.id,
        quoteId,
        agentId,
      });

      // Update quote collaborators list
      try {
        logger.info('QuoteCollaborationService.grantAccess - Starting collaborators list update', { quoteId, agentId });

        const collaborators = quote.getCollaborators();
        logger.info('QuoteCollaborationService.grantAccess - Current collaborators', {
          collaborators,
          collaboratorsType: typeof collaborators,
          collaboratorsLength: collaborators?.length,
          includesAgent: collaborators?.includes(agentId),
        });

        if (!collaborators.includes(agentId)) {
          collaborators.push(agentId);
          quote.setCollaborators(collaborators);
          logger.info('QuoteCollaborationService.grantAccess - About to save quote with updated collaborators', {
            newCollaborators: collaborators,
          });
          await quote.save(null, { useMasterKey: true });
          logger.info('QuoteCollaborationService.grantAccess - Quote collaborators updated successfully');
        } else {
          logger.info('QuoteCollaborationService.grantAccess - Agent already in collaborators list, skipping update');
        }
      } catch (collaboratorsError) {
        logger.error('QuoteCollaborationService.grantAccess - Failed to update quote collaborators', {
          error: collaboratorsError.message,
          stack: collaboratorsError.stack,
          quoteId,
          agentId,
        });
        throw new Error(`Failed to update quote collaborators: ${collaboratorsError.message}`);
      }

      // Record edit
      try {
        logger.info('QuoteCollaborationService.grantAccess - Starting QuoteEdit.recordEdit', {
          quoteId,
          agentId,
          role,
          quoteObjectId: quote?.id,
          grantedByObjectId: grantedBy?.id,
          grantedByUsername: grantedBy?.get?.('username'),
          agentUsername: agent?.get?.('username'),
          editType: QuoteEdit.EDIT_TYPES.UPDATE,
        });

        // Validate objects before passing to recordEdit
        if (!quote || !quote.id) {
          throw new Error('Quote object is invalid or missing ID');
        }
        if (!grantedBy || !grantedBy.id) {
          throw new Error('GrantedBy user object is invalid or missing ID');
        }
        if (!agent || !agent.get) {
          throw new Error('Agent user object is invalid');
        }

        await QuoteEdit.recordEdit(
          quote,
          grantedBy,
          QuoteEdit.EDIT_TYPES.UPDATE,
          {
            collaboratorAdded: agentId,
            role,
          },
          {
            description: `Added ${role} access for user ${agent.get('username')}`,
            autoApprove: true,
          }
        );

        logger.info('QuoteCollaborationService.grantAccess - QuoteEdit.recordEdit completed successfully');
      } catch (editError) {
        logger.error('QuoteCollaborationService.grantAccess - Failed to record edit', {
          error: editError.message,
          stack: editError.stack,
          quoteId,
          agentId,
          errorCode: editError.code,
          errorName: editError.name,
        });
        throw new Error(`Failed to record edit: ${editError.message}`);
      }

      // Audit log
      try {
        logger.info('QuoteCollaborationService.grantAccess - Starting audit log creation', { quoteId, agentId });

        await this.createAuditLog({
          action: 'quote.access.granted',
          objectClass: 'Quote',
          objectId: quoteId,
          userId: grantedById,
          details: {
            agentId,
            role,
            accessId: access.id,
            expiresAt: options.expiresAt,
          },
        });

        logger.info('QuoteCollaborationService.grantAccess - Audit log created successfully');
      } catch (auditError) {
        logger.error('QuoteCollaborationService.grantAccess - Failed to create audit log', {
          error: auditError.message,
          stack: auditError.stack,
          quoteId,
          agentId,
        });
        throw new Error(`Failed to create audit log: ${auditError.message}`);
      }

      logger.info('Granted quote access', {
        quoteId,
        agentId,
        role,
        grantedById,
        accessId: access.id,
      });

      return this.formatAccessResponse(access);
    } catch (error) {
      logger.error('Failed to grant access', {
        error: error.message,
        quoteId,
        agentId,
        role,
      });
      throw error;
    }
  }

  /**
   * Revoke access for an agent.
   * @param {string} quoteId - Quote ID.
   * @param {string} agentId - Agent user ID.
   * @param {string} revokedById - User revoking access.
   * @param {string} reason - Revocation reason.
   * @param requestUserRole
   * @returns {Promise<boolean>} True if revoked successfully.
   * @example
   */
  async revokeAccess(quoteId, agentId, revokedById, reason = '', requestUserRole = null) {
    try {
      // Validate permission to revoke access - pass userRole from request
      const canRevoke = await this.canRevokeAccess(quoteId, revokedById, requestUserRole);
      if (!canRevoke) {
        throw new Error('User does not have permission to revoke access');
      }

      // Get entities
      const quote = await this.getQuoteById(quoteId);
      const agent = await this.getUserById(agentId);
      const revokedBy = await this.getUserById(revokedById);

      if (!quote || !agent || !revokedBy) {
        throw new Error('Required entities not found');
      }

      // Revoke access
      const revoked = await QuoteAccess.revokeAccess(
        quote,
        agent,
        revokedBy,
        reason
      );

      if (revoked) {
        // Update quote collaborators list
        const collaborators = quote.getCollaborators();
        const index = collaborators.indexOf(agentId);
        if (index > -1) {
          collaborators.splice(index, 1);
          quote.setCollaborators(collaborators);
          await quote.save(null, { useMasterKey: true });
        }

        // Record edit
        await QuoteEdit.recordEdit(
          quote,
          revokedBy,
          QuoteEdit.EDIT_TYPES.UPDATE,
          {
            collaboratorRemoved: agentId,
            reason,
          },
          {
            description: `Revoked access for user ${agent.get('username')}: ${reason}`,
            autoApprove: true,
          }
        );

        // Audit log
        await this.createAuditLog({
          action: 'quote.access.revoked',
          objectClass: 'Quote',
          objectId: quoteId,
          userId: revokedById,
          details: {
            agentId,
            reason,
          },
        });

        logger.info('Revoked quote access', {
          quoteId,
          agentId,
          revokedById,
          reason,
        });
      }

      return revoked;
    } catch (error) {
      logger.error('Failed to revoke access', {
        error: error.message,
        quoteId,
        agentId,
      });
      throw error;
    }
  }

  /**
   * Update agent's role for a quote.
   * @param {string} quoteId - Quote ID.
   * @param {string} agentId - Agent user ID.
   * @param {string} newRole - New role (editor/viewer).
   * @param {string} updatedById - User updating the role.
   * @param userRole
   * @returns {Promise<object>} Updated access record.
   * @example
   */
  async updateRole(quoteId, agentId, newRole, updatedById, userRole = null) {
    try {
      // Validate permission
      const canUpdate = await this.canUpdateRole(quoteId, updatedById, userRole);
      if (!canUpdate) {
        throw new Error('User does not have permission to update roles');
      }

      // Validate role
      if (!Object.values(QuoteAccess.ROLES).includes(newRole)) {
        throw new Error(`Invalid role: ${newRole}`);
      }

      // Get entities
      const quote = await this.getQuoteById(quoteId);
      const agent = await this.getUserById(agentId);
      const updatedBy = await this.getUserById(updatedById);

      if (!quote || !agent || !updatedBy) {
        throw new Error('Required entities not found');
      }

      // Get existing access
      const access = await QuoteAccess.getAgentAccess(quote, agent);
      if (!access || !access.isValid()) {
        throw new Error('Agent does not have valid access to this quote');
      }

      const oldRole = access.getRole();
      if (oldRole === newRole) {
        return this.formatAccessResponse(access);
      }

      // Update role
      access.setRole(newRole);
      access.set('lastModifiedBy', updatedBy);
      access.set('lastModifiedAt', new Date());
      await access.save(null, { useMasterKey: true });

      // Record edit
      await QuoteEdit.recordEdit(
        quote,
        updatedBy,
        QuoteEdit.EDIT_TYPES.UPDATE,
        {
          roleChanged: {
            agentId,
            from: oldRole,
            to: newRole,
          },
        },
        {
          description: `Changed role for ${agent.get('username')} from ${oldRole} to ${newRole}`,
          autoApprove: true,
        }
      );

      // Audit log
      await this.createAuditLog({
        action: 'quote.access.role_updated',
        objectClass: 'Quote',
        objectId: quoteId,
        userId: updatedById,
        details: {
          agentId,
          oldRole,
          newRole,
        },
      });

      logger.info('Updated agent role', {
        quoteId,
        agentId,
        oldRole,
        newRole,
        updatedById,
      });

      return this.formatAccessResponse(access);
    } catch (error) {
      logger.error('Failed to update role', {
        error: error.message,
        quoteId,
        agentId,
        newRole,
      });
      throw error;
    }
  }

  /**
   * Get all collaborators for a quote.
   * @param {string} quoteId - Quote ID.
   * @param {object} options - Query options.
   * @returns {Promise<Array>} Array of collaborators.
   * @example
   */
  async getCollaborators(quoteId, options = {}) {
    try {
      const quote = await this.getQuoteById(quoteId);
      if (!quote) {
        throw new Error('Quote not found');
      }

      const rawCollaborators = await QuoteAccess.getQuoteCollaborators(quote, options);

      // Get current owner to filter them out of collaborators
      // (ownership supersedes collaboration)
      let currentOwnerId = null;
      try {
        const ownership = await QuoteOwnership.getCurrentOwnership(quote);
        if (ownership) {
          const owner = ownership.getOwner();
          currentOwnerId = owner ? owner.id : null;
        }
      } catch (ownershipError) {
        logger.warn('Could not determine current owner for collaborator filtering', {
          error: ownershipError.message,
          quoteId,
        });
      }

      // Filter out current owner from collaborators list
      const collaborators = rawCollaborators.filter((access) => {
        const agentId = access.getAgent()?.id;
        if (currentOwnerId && agentId === currentOwnerId) {
          logger.info('Filtered out current owner from collaborators list', {
            quoteId,
            ownerId: currentOwnerId,
            agentId,
          });
          return false;
        }
        return true;
      });

      const result = await Promise.all(
        collaborators.map(async (access) => {
          const formatted = this.formatAccessResponse(access);

          // Add last activity info
          const lastEdit = await this.getLastEditByUser(quoteId, access.getAgent().id);
          if (lastEdit) {
            formatted.lastActivity = {
              type: lastEdit.getEditType(),
              date: lastEdit.getEditedAt(),
              description: lastEdit.getDescription(),
            };
          }

          return formatted;
        })
      );

      logger.info('Retrieved quote collaborators', {
        quoteId,
        rawCount: rawCollaborators.length,
        filteredCount: result.length,
        currentOwnerId,
        ownerFiltered: rawCollaborators.length !== collaborators.length,
      });

      return result;
    } catch (error) {
      logger.error('Failed to get collaborators', {
        error: error.message,
        quoteId,
      });
      throw error;
    }
  }

  /**
   * Check if a user has access to a quote.
   * @param {string} quoteId - Quote ID.
   * @param {string} userId - User ID.
   * @param {string} requiredRole - Required role (null for any role).
   * @returns {Promise<boolean>} True if user has access.
   * @example
   */
  async hasAccess(quoteId, userId, requiredRole = null) {
    try {
      // Check if user is the owner
      const isOwner = await QuoteOwnership.isOwner(quoteId, userId);
      if (isOwner) {
        return true;
      }

      // Check if user has been granted access
      const quote = await this.getQuoteById(quoteId);
      const user = await this.getUserById(userId);

      if (!quote || !user) {
        return false;
      }

      return await QuoteAccess.hasAccess(quote, user, requiredRole);
    } catch (error) {
      logger.error('Failed to check access', {
        error: error.message,
        quoteId,
        userId,
      });
      return false;
    }
  }

  /**
   * Get user's access details for a quote.
   * @param {string} quoteId - Quote ID.
   * @param {string} userId - User ID.
   * @returns {Promise<object|null>} Access details or null.
   * @example
   */
  async getUserAccess(quoteId, userId) {
    try {
      const quote = await this.getQuoteById(quoteId);
      if (!quote) {
        logger.warn('Quote not found in getUserAccess', { quoteId, userId });
        // Return viewer access for non-existent quotes to avoid 403 errors
        return {
          role: 'viewer',
          canEdit: false,
          canView: true,
          canManageAccess: false,
          canTransferOwnership: false,
          canApproveEdits: false,
          isPlaceholder: true,
          message: 'Cotización no encontrada',
          error: 'Quote not found',
        };
      }

      // Check if quote has ownership initialized
      const currentOwnership = await QuoteOwnership.getCurrentOwnership(quote);

      // If no ownership exists, auto-initialize it with the quote creator
      if (!currentOwnership) {
        const createdBy = quote.getCreatedBy();
        if (createdBy) {
          logger.info('Auto-initializing ownership for quote without owner', {
            quoteId,
            createdById: createdBy.id,
          });

          await QuoteOwnership.createInitialOwnership(quote, createdBy);

          // Also set the owner field on the quote
          quote.setOwner(createdBy);
          await quote.save(null, { useMasterKey: true });
        } else {
          // If no createdBy, return placeholder access info to avoid errors
          logger.warn('Quote has no createdBy field, returning viewer access', {
            quoteId,
            userId,
          });

          return {
            role: 'viewer',
            canEdit: false,
            canView: true,
            canManageAccess: false,
            canTransferOwnership: false,
            canApproveEdits: false,
            isPlaceholder: true,
          };
        }
      }

      // Now check if user is the owner
      const isOwner = await QuoteOwnership.isOwner(quoteId, userId);
      if (isOwner) {
        return {
          role: 'owner',
          canEdit: true,
          canView: true,
          canManageAccess: true,
          canTransferOwnership: true,
          canApproveEdits: true,
        };
      }

      // Get granted access
      const user = await this.getUserById(userId);

      if (!user) {
        logger.warn('User not found in getUserAccess', { userId });
        return {
          role: 'viewer',
          canEdit: false,
          canView: true,
          canManageAccess: false,
          canTransferOwnership: false,
          canApproveEdits: false,
          isPlaceholder: true,
          message: 'Usuario no encontrado',
        };
      }

      const access = await QuoteAccess.getAgentAccess(quote, user);
      if (!access || !access.isValid()) {
        // User doesn't have explicit access, return viewer role by default
        logger.info('No explicit access found for user, returning viewer access', {
          quoteId,
          userId,
          hasAccess: !!access,
          isValid: access ? access.isValid() : false,
        });
        return {
          role: 'viewer',
          canEdit: false,
          canView: true,
          canManageAccess: false,
          canTransferOwnership: false,
          canApproveEdits: false,
          message: 'Acceso de solo lectura',
        };
      }

      const role = access.getRole();
      return {
        role,
        canEdit: role === QuoteAccess.ROLES.EDITOR,
        canView: true,
        canManageAccess: false,
        canTransferOwnership: false,
        canApproveEdits: false,
        grantedAt: access.getGrantedAt(),
        expiresAt: access.getExpiresAt(),
      };
    } catch (error) {
      logger.error('Failed to get user access', {
        error: error.message,
        quoteId,
        userId,
        stack: error.stack,
      });
      // Return safe viewer access instead of null to avoid 403 errors
      return {
        role: 'viewer',
        canEdit: false,
        canView: true,
        canManageAccess: false,
        canTransferOwnership: false,
        canApproveEdits: false,
        isPlaceholder: true,
        error: error.message,
      };
    }
  }

  /**
   * Record access activity.
   * @param {string} quoteId - Quote ID.
   * @param {string} userId - User ID.
   * @returns {Promise<void>}
   * @example
   */
  async recordAccessActivity(quoteId, userId) {
    try {
      const quote = await this.getQuoteById(quoteId);
      const user = await this.getUserById(userId);

      if (quote && user) {
        await QuoteAccess.updateLastAccessed(quote, user);
      }
    } catch (error) {
      logger.warn('Failed to record access activity', {
        error: error.message,
        quoteId,
        userId,
      });
    }
  }

  // ================
  // PERMISSION CHECKS
  // ================

  /**
   * Check if user can grant access.
   * @param {string} quoteId - Quote ID.
   * @param {string} userId - User ID.
   * @param requestUserRole
   * @returns {Promise<boolean>} True if user can grant access.
   * @example
   */
  async canGrantAccess(quoteId, userId, requestUserRole = null) {
    try {
      logger.info('Checking grant access permission', {
        quoteId,
        userId,
        requestUserRole,
      });

      // Check if user is the owner
      const isOwner = await QuoteOwnership.isOwner(quoteId, userId);
      if (isOwner) {
        logger.info('User is owner, granting access', { userId });
        return true;
      }

      // Check if user has admin or department manager privileges
      const user = await this.getUserById(userId);
      if (!user) {
        logger.warn('User not found for grant access check', { userId });
        return false;
      }

      // SOLO Amexing, nunca "cualquiera con rol de agencia".
      //
      // El allowlist anterior incluía 'department_manager' y 'client', comparando SOLO el nombre del
      // rol y sin mirar de qué agencia era la cotización. Con eso, cualquier agente podía concederse
      // acceso a sí mismo sobre CUALQUIER cotización (nada impedía agentId === grantedById), y ese
      // QuoteAccess se traduce en scope sobre la reservación ligada vía
      // ReservationController.getClientEligibleQuoteIds: leer, registrar, editar y borrar los pagos
      // de un cliente de otra agencia.
      //
      // La tercera vía es la agencia sobre lo de SUS agentes: ver agencyScope.isAgencyOwnerOfQuote.
      const dbRole = user.get('role');
      const role = requestUserRole || dbRole;
      const isAmexingStaff = role === 'admin' || role === 'superadmin';

      if (isAmexingStaff) {
        return true;
      }

      if (await isAgencyOwnerOfQuote(user, role, quoteId)) {
        logger.info('Grant access allowed: actor is the agency that owns this agent', { quoteId, userId });
        return true;
      }

      logger.warn('Grant access denied: only the owner, their agency or Amexing staff may share a quote', {
        quoteId, userId, role,
      });
      return false;
    } catch (error) {
      logger.error('Failed to check grant access permission', {
        error: error.message,
        quoteId,
        userId,
      });
      return false;
    }
  }

  /**
   * Check if user can revoke access.
   * @param {string} quoteId - Quote ID.
   * @param {string} userId - User ID.
   * @param requestUserRole
   * @returns {Promise<boolean>} True if user can revoke access.
   * @example
   */
  async canRevokeAccess(quoteId, userId, requestUserRole = null) {
    try {
      // Check if user is the owner
      const isOwner = await QuoteOwnership.isOwner(quoteId, userId);
      if (isOwner) {
        return true;
      }

      // Check if user has admin or department manager privileges
      const user = await this.getUserById(userId);
      if (!user) {
        return false;
      }

      // Mismo criterio que canGrantAccess, y por la misma razón: el allowlist por nombre de rol
      // dejaba que cualquier agente revocara a los colaboradores legítimos de una cotización ajena
      // (denegación de servicio sobre la operación de otra agencia).
      const dbRole = user.get('role');
      const role = requestUserRole || dbRole;
      const isAmexingStaff = role === 'admin' || role === 'superadmin';

      if (isAmexingStaff) {
        return true;
      }

      if (await isAgencyOwnerOfQuote(user, role, quoteId)) {
        return true;
      }

      logger.warn('Revoke access denied: only the owner, their agency or Amexing staff may revoke a share', {
        quoteId, userId, role,
      });
      return false;
    } catch (error) {
      logger.error('Failed to check revoke access permission', {
        error: error.message,
        quoteId,
        userId,
      });
      return false;
    }
  }

  /**
   * Check if user can update roles.
   * @param {string} quoteId - Quote ID.
   * @param {string} userId - User ID.
   * @param requestUserRole
   * @returns {Promise<boolean>} True if user can update roles.
   * @example
   */
  async canUpdateRole(quoteId, userId, requestUserRole = null) {
    try {
      // Check if user is the owner
      const isOwner = await QuoteOwnership.isOwner(quoteId, userId);
      if (isOwner) {
        return true;
      }

      // Mismo criterio que canGrantAccess y canRevokeAccess: dueño o staff de Amexing, nunca
      // "cualquiera con rol de agencia". Degradar al colaborador de una cotización ajena era la
      // tercera variante del mismo hueco.
      const user = await this.getUserById(userId);
      if (!user) {
        return false;
      }

      const role = requestUserRole || user.get('role');
      const isAmexingStaff = role === 'admin' || role === 'superadmin';

      if (isAmexingStaff) {
        return true;
      }

      if (await isAgencyOwnerOfQuote(user, role, quoteId)) {
        return true;
      }

      logger.warn('Update collaborator role denied: only the owner, their agency or Amexing staff may change a share', {
        quoteId, userId, role,
      });
      return false;
    } catch (error) {
      logger.error('Failed to check update role permission', {
        error: error.message,
        quoteId,
        userId,
      });
      return false;
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
    logger.info('QuoteCollaborationService.getUserById - Looking up user', {
      userId,
      userIdType: typeof userId,
      userIdLength: userId?.length,
    });

    // Try multiple approaches to find the user
    const query = new Parse.Query('AmexingUser');
    query.equalTo('exists', true);

    try {
      // First try: direct get by objectId
      const user = await query.get(userId, { useMasterKey: true });
      logger.info('QuoteCollaborationService.getUserById - User found via direct get', {
        userId,
        userFound: !!user,
        userName: user?.get?.('username'),
        userEmail: user?.get?.('email'),
      });
      return user;
    } catch (directError) {
      logger.warn('QuoteCollaborationService.getUserById - Direct get failed, trying alternative approach', {
        userId,
        error: directError.message,
        errorCode: directError.code,
      });

      // Second try: query with find (more permissive)
      try {
        const altQuery = new Parse.Query('AmexingUser');
        altQuery.equalTo('objectId', userId);
        altQuery.equalTo('exists', true);
        const users = await altQuery.find({ useMasterKey: true });

        logger.info('QuoteCollaborationService.getUserById - Alternative query results', {
          userId,
          usersFound: users.length,
          firstUser: users[0] ? {
            id: users[0].id,
            username: users[0].get('username'),
            email: users[0].get('email'),
          } : null,
        });

        if (users.length > 0) {
          return users[0];
        }

        // Third try: check if user exists without exists=true filter
        const noFilterQuery = new Parse.Query('AmexingUser');
        noFilterQuery.equalTo('objectId', userId);
        const allUsers = await noFilterQuery.find({ useMasterKey: true });

        logger.info('QuoteCollaborationService.getUserById - Query without exists filter', {
          userId,
          usersFound: allUsers.length,
          firstUser: allUsers[0] ? {
            id: allUsers[0].id,
            username: allUsers[0].get('username'),
            exists: allUsers[0].get('exists'),
            active: allUsers[0].get('active'),
          } : null,
        });

        return null;
      } catch (altError) {
        logger.error('QuoteCollaborationService.getUserById - All lookup methods failed', {
          userId,
          directError: directError.message,
          altError: altError.message,
        });
        return null;
      }
    }
  }

  /**
   * Get last edit by user.
   * @param {string} quoteId - Quote ID.
   * @param {string} userId - User ID.
   * @returns {Promise<object|null>} Last edit or null.
   * @example
   */
  async getLastEditByUser(quoteId, userId) {
    const query = new Parse.Query('QuoteEdit');
    const QuoteObj = Parse.Object.extend('Quote');
    const AmexingUserObj = Parse.Object.extend('AmexingUser');

    query.equalTo('quote', QuoteObj.createWithoutData(quoteId));
    query.equalTo('editor', AmexingUserObj.createWithoutData(userId));
    query.equalTo('exists', true);
    query.descending('editedAt');
    query.limit(1);

    try {
      return await query.first({ useMasterKey: true });
    } catch (error) {
      return null;
    }
  }

  /**
   * Format access response.
   * @param {object} access - QuoteAccess object.
   * @returns {object} Formatted response.
   * @example
   */
  formatAccessResponse(access) {
    const agent = access.getAgent();
    const grantedBy = access.getGrantedBy();

    return {
      id: access.id,
      agent: agent ? {
        id: agent.id,
        username: agent.get('username'),
        email: agent.get('email'),
        firstName: agent.get('firstName'),
        lastName: agent.get('lastName'),
      } : null,
      role: access.getRole(),
      grantedBy: grantedBy ? {
        id: grantedBy.id,
        username: grantedBy.get('username'),
        email: grantedBy.get('email'),
        firstName: grantedBy.get('firstName'),
        lastName: grantedBy.get('lastName'),
      } : null,
      grantedAt: access.getGrantedAt(),
      expiresAt: access.getExpiresAt(),
      accessType: access.getAccessType(),
      lastAccessedAt: access.getLastAccessedAt(),
      isValid: access.isValid(),
      createdAt: access.createdAt,
    };
  }

  /**
   * Create audit log entry.
   * @param {object} data - Audit log data.
   * @returns {Promise<void>}
   * @example
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
}

module.exports = QuoteCollaborationService;
