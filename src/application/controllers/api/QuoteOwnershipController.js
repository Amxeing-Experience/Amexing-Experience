/**
 * QuoteOwnershipController - API endpoints for quote ownership management.
 * Handles ownership transfers, history, and related operations.
 *
 * API Endpoints:
 * - POST /api/quotes/:quoteId/ownership/transfer - Transfer ownership
 * - GET /api/quotes/:quoteId/ownership - Get current ownership
 * - GET /api/quotes/:quoteId/ownership/history - Get ownership history
 * - GET /api/quotes/owned - Get quotes owned by current user.
 *
 * Created by Denisse Maldonado.
 * @version 1.0.0
 * @since 1.0.0
 */

const QuoteOwnershipService = require('../../services/QuoteOwnershipService');
const logger = require('../../../infrastructure/logger');

/**
 * Controller for quote ownership management.
 */
class QuoteOwnershipController {
  constructor() {
    this.ownershipService = new QuoteOwnershipService();

    // Bind methods to maintain context
    this.transferOwnership = this.transferOwnership.bind(this);
    this.getCurrentOwnership = this.getCurrentOwnership.bind(this);
    this.getOwnershipHistory = this.getOwnershipHistory.bind(this);
    this.getOwnedQuotes = this.getOwnedQuotes.bind(this);
    this.initializeOwnership = this.initializeOwnership.bind(this);
    this.getAvailableOwners = this.getAvailableOwners.bind(this);
  }

  /**
   * Initialize ownership for a new quote.
   * POST /api/quotes/:quoteId/ownership/initialize.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async initializeOwnership(req, res) {
    const { quoteId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    try {
      logger.info('Initializing quote ownership', {
        quoteId,
        userId,
        ip: req.ip,
      });

      const ownership = await this.ownershipService.initializeOwnership(
        quoteId,
        userId
      );

      res.status(201).json({
        success: true,
        data: ownership,
        message: 'Ownership initialized successfully',
      });
    } catch (error) {
      logger.error('Failed to initialize ownership', {
        error: error.message,
        quoteId,
        userId,
      });

      res.status(400).json({
        success: false,
        error: error.message || 'Failed to initialize ownership',
      });
    }
  }

  /**
   * Transfer quote ownership.
   * POST /api/quotes/:quoteId/ownership/transfer.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async transferOwnership(req, res) {
    const { quoteId } = req.params;
    const { newOwnerId, reason } = req.body;
    const transferredById = req.user?.id;

    if (!transferredById) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    if (!newOwnerId) {
      return res.status(400).json({
        success: false,
        error: 'New owner ID is required',
      });
    }

    try {
      logger.info('Transfer ownership request', {
        quoteId,
        newOwnerId,
        transferredById,
        reason,
        ip: req.ip,
      });

      const ownership = await this.ownershipService.transferOwnership(
        quoteId,
        newOwnerId,
        transferredById,
        reason
      );

      res.status(200).json({
        success: true,
        data: ownership,
        message: 'Ownership transferred successfully',
      });
    } catch (error) {
      logger.error('Failed to transfer ownership', {
        error: error.message,
        quoteId,
        newOwnerId,
        transferredById,
      });

      const statusCode = error.message.includes('permission') ? 403 : 400;
      res.status(statusCode).json({
        success: false,
        error: error.message || 'Failed to transfer ownership',
      });
    }
  }

  /**
   * Get current quote ownership.
   * GET /api/quotes/:quoteId/ownership.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async getCurrentOwnership(req, res) {
    const { quoteId } = req.params;
    const userId = req.user?.id;

    try {
      logger.info('Get current ownership request', {
        quoteId,
        userId,
        ip: req.ip,
      });

      const owner = await this.ownershipService.getCurrentOwner(quoteId);

      // Service now always returns an object (possibly with isPlaceholder flag)
      res.status(200).json({
        success: true,
        data: owner,
      });
    } catch (error) {
      logger.error('Failed to get current ownership', {
        error: error.message,
        quoteId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve ownership information',
      });
    }
  }

  /**
   * Get ownership history.
   * GET /api/quotes/:quoteId/ownership/history.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async getOwnershipHistory(req, res) {
    const { quoteId } = req.params;
    const { limit = 50, skip = 0 } = req.query;
    const userId = req.user?.id;

    try {
      logger.info('Get ownership history request', {
        quoteId,
        userId,
        limit,
        skip,
        ip: req.ip,
      });

      // Check if user has access to view history
      const hasAccess = await this.ownershipService.isOwner(quoteId, userId);

      if (!hasAccess && userId) {
        // Check if user has any access to the quote
        const CollaborationService = require('../../services/QuoteCollaborationService');
        const collabService = new CollaborationService();
        const userAccess = await collabService.hasAccess(quoteId, userId);

        if (!userAccess) {
          return res.status(403).json({
            success: false,
            error: 'You do not have permission to view ownership history',
          });
        }
      }

      const history = await this.ownershipService.getOwnershipHistory(
        quoteId,
        {
          limit: parseInt(limit, 10),
          skip: parseInt(skip, 10),
        }
      );

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
      logger.error('Failed to get ownership history', {
        error: error.message,
        quoteId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve ownership history',
      });
    }
  }

  /**
   * Get quotes owned by current user.
   * GET /api/quotes/owned.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async getOwnedQuotes(req, res) {
    const userId = req.user?.id;
    const { limit = 50, skip = 0, includeInactive = false } = req.query;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    try {
      logger.info('Get owned quotes request', {
        userId,
        limit,
        skip,
        includeInactive,
        ip: req.ip,
      });

      const quotes = await this.ownershipService.getOwnedQuotes(userId, {
        limit: parseInt(limit, 10),
        skip: parseInt(skip, 10),
        includeInactive: includeInactive === 'true',
      });

      res.status(200).json({
        success: true,
        data: quotes,
        pagination: {
          limit: parseInt(limit, 10),
          skip: parseInt(skip, 10),
          total: quotes.length,
        },
      });
    } catch (error) {
      logger.error('Failed to get owned quotes', {
        error: error.message,
        userId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve owned quotes',
      });
    }
  }

  /**
   * Check if user is owner.
   * GET /api/quotes/:quoteId/ownership/check.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async checkOwnership(req, res) {
    const { quoteId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    try {
      const isOwner = await this.ownershipService.isOwner(quoteId, userId);

      res.status(200).json({
        success: true,
        data: {
          isOwner,
          userId,
          quoteId,
        },
      });
    } catch (error) {
      logger.error('Failed to check ownership', {
        error: error.message,
        quoteId,
        userId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to check ownership',
      });
    }
  }

  /**
   * Get ownership statistics.
   * GET /api/quotes/ownership/stats.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async getOwnershipStats(req, res) {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    try {
      // Get owned quotes count
      const ownedQuotes = await this.ownershipService.getOwnedQuotes(userId, {
        limit: 1000,
      });

      // Get quotes where user has access (as collaborator)
      // This would need a method to get all quotes where user is a collaborator
      // For now, we'll return basic stats

      const stats = {
        ownedQuotes: ownedQuotes.length,
        activeOwnedQuotes: ownedQuotes.filter((q) => q.status !== 'rejected').length,
        recentTransfers: ownedQuotes.filter((q) => {
          const daysSinceOwnership = (new Date() - new Date(q.ownershipStartDate)) / (1000 * 60 * 60 * 24);
          return daysSinceOwnership <= 7;
        }).length,
      };

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error('Failed to get ownership statistics', {
        error: error.message,
        userId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve ownership statistics',
      });
    }
  }

  /**
   * Get available owners for a quote based on department relationships.
   * GET /api/quotes/:quoteId/available-owners.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @example
   */
  async getAvailableOwners(req, res) {
    const { quoteId } = req.params;
    const userId = req.user?.id;
    // Use req.userRole which is set by JWT middleware
    const userRole = req.userRole || req.user?.role || '';

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    // Check permissions - only admins and department managers can transfer ownership
    const canManage = ['admin', 'superadmin', 'department_manager'].includes(userRole);
    if (!canManage) {
      logger.warn('User lacks permission to view available owners', {
        userId,
        userRole,
        quoteId,
      });
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions to view available owners',
      });
    }

    try {
      logger.info('Get available owners request', {
        quoteId,
        userId,
        userRole,
        ip: req.ip,
      });

      const result = await this.ownershipService.getAvailableOwners(quoteId);

      // Check if client selection is required
      if (result.requiresClient) {
        return res.status(400).json({
          success: false,
          error: 'Cliente no seleccionado',
          message: 'Por favor selecciona un cliente antes de gestionar la propiedad',
          requiresClient: true,
        });
      }

      // Handle the users array (could be direct array or result.users)
      const availableOwners = Array.isArray(result) ? result : (result.users || []);

      res.status(200).json({
        success: true,
        data: availableOwners.map((user) => ({
          id: user.id,
          firstName: user.get('firstName'),
          lastName: user.get('lastName'),
          email: user.get('email'),
          role: user.get('role'),
          username: user.get('username'),
          isDepartmentManager: user.get('role') === 'department_manager',
          isClient: user.get('role') === 'client',
          isAdmin: ['admin', 'superadmin'].includes(user.get('role')),
        })),
        total: availableOwners.length,
      });
    } catch (error) {
      logger.error('Failed to get available owners', {
        error: error.message,
        quoteId,
        userId,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve available owners',
      });
    }
  }
}

module.exports = QuoteOwnershipController;
