/**
 * QuoteCollaborationController - API endpoints for quote collaboration management.
 * Handles agent access, roles, and collaborative editing features.
 *
 * API Endpoints:
 * - POST /api/quotes/:quoteId/collaborators - Add collaborator
 * - DELETE /api/quotes/:quoteId/collaborators/:agentId - Remove collaborator
 * - PUT /api/quotes/:quoteId/collaborators/:agentId/role - Update role
 * - GET /api/quotes/:quoteId/collaborators - List collaborators
 * - GET /api/quotes/:quoteId/access - Get current user access.
 *
 * Created by Denisse Maldonado.
 * @version 1.0.0
 * @since 1.0.0
 */

const QuoteCollaborationService = require('../../services/QuoteCollaborationService');
const QuoteVersioningService = require('../../services/QuoteVersioningService');
const logger = require('../../../infrastructure/logger');

/**
 * Controller for quote collaboration management.
 */
class QuoteCollaborationController {
  constructor() {
    this.collaborationService = new QuoteCollaborationService();
    this.versioningService = new QuoteVersioningService();

    // Bind methods to maintain context
    this.addCollaborator = this.addCollaborator.bind(this);
    this.removeCollaborator = this.removeCollaborator.bind(this);
    this.updateCollaboratorRole = this.updateCollaboratorRole.bind(this);
    this.getCollaborators = this.getCollaborators.bind(this);
    this.getCurrentUserAccess = this.getCurrentUserAccess.bind(this);
    this.recordEdit = this.recordEdit.bind(this);
    this.approveEdit = this.approveEdit.bind(this);
    this.rejectEdit = this.rejectEdit.bind(this);
    this.getEditHistory = this.getEditHistory.bind(this);
    this.getPendingEdits = this.getPendingEdits.bind(this);
  }

  /**
   * Add a collaborator to a quote.
   * POST /api/quotes/:quoteId/collaborators.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async addCollaborator(req, res) {
    const { quoteId } = req.params;
    const {
      agentId, role, expiresAt, reason,
    } = req.body;
    const grantedById = req.user?.id;
    const userRole = req.userRole || req.user?.role;

    // Debug logging
    logger.info('addCollaborator - Request details', {
      quoteId,
      requestBody: req.body,
      agentId,
      role,
      grantedById,
      userRole,
      bodyKeys: Object.keys(req.body || {}),
    });

    if (!grantedById) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    if (!agentId || !role) {
      logger.warn('addCollaborator - Missing required fields', {
        agentId: !!agentId,
        role: !!role,
        agentIdValue: agentId,
        roleValue: role,
        requestBody: req.body,
      });
      return res.status(400).json({
        success: false,
        error: 'Agent ID and role are required',
      });
    }

    if (!['editor', 'viewer'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Role must be either "editor" or "viewer"',
      });
    }

    try {
      logger.info('Add collaborator request', {
        quoteId,
        agentId,
        role,
        grantedById,
        userRole,
        ip: req.ip,
      });

      const access = await this.collaborationService.grantAccess(
        quoteId,
        agentId,
        role,
        grantedById,
        {
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          reason,
          userRole, // Pass the user role from request
        }
      );

      res.status(201).json({
        success: true,
        data: access,
        message: `Collaborator added as ${role} successfully`,
      });
    } catch (error) {
      logger.error('Failed to add collaborator', {
        error: error.message,
        quoteId,
        agentId,
        role,
      });

      const statusCode = error.message.includes('permission') ? 403 : 400;
      res.status(statusCode).json({
        success: false,
        error: error.message || 'Failed to add collaborator',
      });
    }
  }

  /**
   * Remove a collaborator from a quote.
   * DELETE /api/quotes/:quoteId/collaborators/:agentId.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async removeCollaborator(req, res) {
    const { quoteId, agentId } = req.params;
    const { reason } = req.body;
    const revokedById = req.user?.id;
    const userRole = req.userRole || req.user?.role;

    if (!revokedById) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    try {
      logger.info('Remove collaborator request', {
        quoteId,
        agentId,
        revokedById,
        userRole,
        reason,
        ip: req.ip,
      });

      const revoked = await this.collaborationService.revokeAccess(
        quoteId,
        agentId,
        revokedById,
        reason,
        userRole // Pass the user role from request
      );

      if (revoked) {
        res.status(200).json({
          success: true,
          message: 'Collaborator removed successfully',
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Collaborator not found or already removed',
        });
      }
    } catch (error) {
      logger.error('Failed to remove collaborator', {
        error: error.message,
        quoteId,
        agentId,
      });

      const statusCode = error.message.includes('permission') ? 403 : 400;
      res.status(statusCode).json({
        success: false,
        error: error.message || 'Failed to remove collaborator',
      });
    }
  }

  /**
   * Update collaborator role.
   * PUT /api/quotes/:quoteId/collaborators/:agentId/role.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async updateCollaboratorRole(req, res) {
    const { quoteId, agentId } = req.params;
    const { role } = req.body;
    const updatedById = req.user?.id;
    const userRole = req.userRole || req.user?.role;

    if (!updatedById) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    if (!role || !['editor', 'viewer'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Valid role (editor or viewer) is required',
      });
    }

    try {
      logger.info('Update collaborator role request', {
        quoteId,
        agentId,
        newRole: role,
        updatedById,
        userRole,
        ip: req.ip,
      });

      const access = await this.collaborationService.updateRole(
        quoteId,
        agentId,
        role,
        updatedById,
        userRole // Pass the user role from request
      );

      res.status(200).json({
        success: true,
        data: access,
        message: `Role updated to ${role} successfully`,
      });
    } catch (error) {
      logger.error('Failed to update collaborator role', {
        error: error.message,
        quoteId,
        agentId,
        role,
      });

      const statusCode = error.message.includes('permission') ? 403 : 400;
      res.status(statusCode).json({
        success: false,
        error: error.message || 'Failed to update role',
      });
    }
  }

  /**
   * Get all collaborators for a quote.
   * GET /api/quotes/:quoteId/collaborators.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async getCollaborators(req, res) {
    const { quoteId } = req.params;
    const { includeRevoked = false, role = null } = req.query;
    const userId = req.user?.id;

    try {
      logger.info('Get collaborators request', {
        quoteId,
        userId,
        includeRevoked,
        role,
        ip: req.ip,
      });

      const collaborators = await this.collaborationService.getCollaborators(
        quoteId,
        {
          includeRevoked: includeRevoked === 'true',
          role,
        }
      );

      res.status(200).json({
        success: true,
        data: collaborators,
        total: collaborators.length,
      });
    } catch (error) {
      logger.error('Failed to get collaborators', {
        error: error.message,
        quoteId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve collaborators',
      });
    }
  }

  /**
   * Get current user's access to a quote.
   * GET /api/quotes/:quoteId/access.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async getCurrentUserAccess(req, res) {
    const { quoteId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    try {
      logger.info('Get user access request', {
        quoteId,
        userId,
        ip: req.ip,
      });

      const access = await this.collaborationService.getUserAccess(quoteId, userId);

      if (!access) {
        return res.status(403).json({
          success: false,
          error: 'You do not have access to this quote',
        });
      }

      // Only record access activity if it's not a placeholder
      if (!access.isPlaceholder && !access.error) {
        try {
          await this.collaborationService.recordAccessActivity(quoteId, userId);
        } catch (activityError) {
          // Log but don't fail the request
          logger.warn('Failed to record access activity', {
            error: activityError.message,
            quoteId,
            userId,
          });
        }
      }

      res.status(200).json({
        success: true,
        data: access,
      });
    } catch (error) {
      logger.error('Failed to get user access', {
        error: error.message,
        quoteId,
        userId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve access information',
      });
    }
  }

  /**
   * Record an edit to a quote.
   * POST /api/quotes/:quoteId/edits.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async recordEdit(req, res) {
    const { quoteId } = req.params;
    const { changes, description } = req.body;
    const editorId = req.user?.id;

    if (!editorId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    if (!changes || Object.keys(changes).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Changes are required',
      });
    }

    // SEGURIDAD (mass-assignment): este endpoint HTTP toma `changes` del body tal cual y el servicio hace
    // quote.set(field, value) por cada campo (QuoteVersioningService.applyChanges). Sin filtro, un usuario
    // con permiso de edición podría fijar campos arbitrarios (total/subtotal/iva/serviceItems/paymentType,
    // owner/client y demás pointers de dueño, status/approvalStatus/folio/currency...). El frontend NO usa
    // este POST (solo /edits/pending, /approve, /reject), así que lo restringimos a un allowlist conservador
    // de campos descriptivos/de contacto no sensibles. serviceItems y el método de pago se editan por su
    // endpoint dedicado y validado (PUT /:id/service-items); NO por esta vía genérica. Este allowlist se
    // puede expandir si la edición colaborativa se cablea a la UI a futuro. Se RECHAZA (400) el request
    // completo si trae cualquier campo fuera del allowlist, en vez de stripear en silencio.
    const EDITABLE_FIELDS = ['contactPerson', 'contactEmail', 'contactPhone', 'notes', 'eventType'];
    const disallowedFields = Object.keys(changes).filter(
      (field) => !EDITABLE_FIELDS.includes(field)
    );
    if (disallowedFields.length > 0) {
      // El detalle (qué campos y cuáles se permiten) se queda del lado servidor: devolverlo le entregaba
      // al atacante el mapa exacto de campos que sí pasan el filtro.
      logger.warn('recordEdit: campos fuera del allowlist rechazados', {
        quoteId, userId: editorId, disallowedFields,
      });
      return res.status(400).json({
        success: false,
        error: 'Campo no editable por este endpoint.',
      });
    }

    try {
      logger.info('Record edit request', {
        quoteId,
        editorId,
        changesCount: Object.keys(changes).length,
        ip: req.ip,
      });

      const edit = await this.versioningService.recordEdit(
        quoteId,
        editorId,
        changes,
        { description }
      );

      res.status(201).json({
        success: true,
        data: edit,
        message: edit.approvalStatus === 'auto_approved'
          ? 'Edit applied successfully'
          : 'Edit recorded and pending approval',
      });
    } catch (error) {
      logger.error('Failed to record edit', {
        error: error.message,
        quoteId,
        editorId,
      });

      const statusCode = error.message.includes('permission') ? 403 : 400;
      res.status(statusCode).json({
        success: false,
        error: error.message || 'Failed to record edit',
      });
    }
  }

  /**
   * Approve a pending edit.
   * POST /api/quotes/:quoteId/edits/:editId/approve.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async approveEdit(req, res) {
    const { quoteId, editId } = req.params;
    const { comment } = req.body;
    const approverId = req.user?.id;

    if (!approverId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    try {
      logger.info('Approve edit request', {
        quoteId,
        editId,
        approverId,
        ip: req.ip,
      });

      const edit = await this.versioningService.approveEdit(
        editId,
        approverId,
        comment
      );

      res.status(200).json({
        success: true,
        data: edit,
        message: 'Edit approved and applied successfully',
      });
    } catch (error) {
      logger.error('Failed to approve edit', {
        error: error.message,
        editId,
        approverId,
      });

      const statusCode = error.message.includes('permission') ? 403 : 400;
      res.status(statusCode).json({
        success: false,
        error: error.message || 'Failed to approve edit',
      });
    }
  }

  /**
   * Reject a pending edit.
   * POST /api/quotes/:quoteId/edits/:editId/reject.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async rejectEdit(req, res) {
    const { quoteId, editId } = req.params;
    const { reason } = req.body;
    const rejectorId = req.user?.id;

    if (!rejectorId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    try {
      logger.info('Reject edit request', {
        quoteId,
        editId,
        rejectorId,
        reason,
        ip: req.ip,
      });

      const edit = await this.versioningService.rejectEdit(
        editId,
        rejectorId,
        reason
      );

      res.status(200).json({
        success: true,
        data: edit,
        message: 'Edit rejected successfully',
      });
    } catch (error) {
      logger.error('Failed to reject edit', {
        error: error.message,
        editId,
        rejectorId,
      });

      const statusCode = error.message.includes('permission') ? 403 : 400;
      res.status(statusCode).json({
        success: false,
        error: error.message || 'Failed to reject edit',
      });
    }
  }

  /**
   * Get edit history for a quote.
   * GET /api/quotes/:quoteId/edits.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async getEditHistory(req, res) {
    const { quoteId } = req.params;
    const {
      limit = 50, skip = 0, includeRejected = false, editType, editorId,
    } = req.query;
    const userId = req.user?.id;

    try {
      logger.info('Get edit history request', {
        quoteId,
        userId,
        limit,
        skip,
        ip: req.ip,
      });

      // Check if user has access to view history
      // Allow admins, department managers, and users with any access to view history
      const userRole = req.userRole || req.user?.role || '';
      const isAdmin = userRole === 'admin' || userRole === 'superadmin' || userRole === 'department_manager' || userRole === 'client';

      if (!isAdmin) {
        const hasAccess = await this.collaborationService.hasAccess(quoteId, userId);
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error: 'You do not have permission to view edit history',
          });
        }
      }

      const history = await this.versioningService.getEditHistory(quoteId, {
        limit: parseInt(limit, 10),
        skip: parseInt(skip, 10),
        includeRejected: includeRejected === 'true',
        editType,
        editorId,
      });

      res.status(200).json({
        success: true,
        data: history,
        pagination: {
          limit: parseInt(limit, 10),
          skip: parseInt(skip, 10),
          total: history.length,
        },
      });
    } catch (error) {
      logger.error('Failed to get edit history', {
        error: error.message,
        quoteId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve edit history',
      });
    }
  }

  /**
   * Get pending edits for a quote.
   * GET /api/quotes/:quoteId/edits/pending.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async getPendingEdits(req, res) {
    const { quoteId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    try {
      logger.info('Get pending edits request', {
        quoteId,
        userId,
        ip: req.ip,
      });

      // Check if user is owner or admin (can approve edits)
      const userRole = req.userRole || req.user?.role || '';
      const isAdmin = userRole === 'admin' || userRole === 'superadmin' || userRole === 'department_manager' || userRole === 'client';

      if (!isAdmin) {
        const OwnershipService = require('../../services/QuoteOwnershipService');
        const ownershipService = new OwnershipService();
        const isOwner = await ownershipService.isOwner(quoteId, userId);

        if (!isOwner) {
          return res.status(403).json({
            success: false,
            error: 'Only the owner or admin can view pending edits',
          });
        }
      }

      const pendingEdits = await this.versioningService.getPendingEdits(quoteId);

      res.status(200).json({
        success: true,
        data: pendingEdits,
        total: pendingEdits.length,
      });
    } catch (error) {
      logger.error('Failed to get pending edits', {
        error: error.message,
        quoteId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve pending edits',
      });
    }
  }

  /**
   * Restore a previous version.
   * POST /api/quotes/:quoteId/versions/:version/restore.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async restoreVersion(req, res) {
    const { quoteId, version } = req.params;
    const restoredById = req.user?.id;

    if (!restoredById) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    try {
      logger.info('Restore version request', {
        quoteId,
        version,
        restoredById,
        ip: req.ip,
      });

      const edit = await this.versioningService.restoreVersion(
        quoteId,
        parseInt(version, 10),
        restoredById
      );

      res.status(200).json({
        success: true,
        data: edit,
        message: `Version ${version} restored successfully`,
      });
    } catch (error) {
      logger.error('Failed to restore version', {
        error: error.message,
        quoteId,
        version,
        restoredById,
      });

      const statusCode = error.message.includes('permission') ? 403 : 400;
      res.status(statusCode).json({
        success: false,
        error: error.message || 'Failed to restore version',
      });
    }
  }

  /**
   * Get version diff.
   * GET /api/quotes/:quoteId/versions/diff.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async getVersionDiff(req, res) {
    const { quoteId } = req.params;
    const { from, to } = req.query;
    const userId = req.user?.id;

    if (!from || !to) {
      return res.status(400).json({
        success: false,
        error: 'Both "from" and "to" version numbers are required',
      });
    }

    try {
      logger.info('Get version diff request', {
        quoteId,
        fromVersion: from,
        toVersion: to,
        userId,
        ip: req.ip,
      });

      // Check if user has access
      // Allow admins, department managers, and users with any access to view diffs
      const userRole = req.userRole || req.user?.role || '';
      const isAdmin = userRole === 'admin' || userRole === 'superadmin' || userRole === 'department_manager' || userRole === 'client';

      if (!isAdmin) {
        const hasAccess = await this.collaborationService.hasAccess(quoteId, userId);
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error: 'You do not have access to view version diff',
          });
        }
      }

      const diff = await this.versioningService.getVersionDiff(
        quoteId,
        parseInt(from, 10),
        parseInt(to, 10)
      );

      res.status(200).json({
        success: true,
        data: diff,
      });
    } catch (error) {
      logger.error('Failed to get version diff', {
        error: error.message,
        quoteId,
        from,
        to,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve version diff',
      });
    }
  }
}

module.exports = QuoteCollaborationController;
