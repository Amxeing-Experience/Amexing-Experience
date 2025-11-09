/**
 * QuoteService - Business logic for Quote Management.
 *
 * Implements SOLID principles and follows consistent data lifecycle rules.
 * Provides centralized business logic for Quote operations including
 * update, status changes, soft delete, and comprehensive audit logging.
 *
 * Features:
 * - Role-based access control
 * - Data lifecycle management (active/exists pattern)
 * - Comprehensive audit logging
 * - Input validation and sanitization
 * - Error handling with detailed logging.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-01-15
 * @example
 * const service = new QuoteService();
 * const result = await service.updateQuoteStatus(currentUser, quoteId, 'sent');
 */

const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');

/**
 * QuoteService class implementing Quote business logic.
 */
class QuoteService {
  constructor() {
    this.className = 'Quote';
    this.allowedRoles = ['superadmin', 'admin'];
    this.validStatuses = ['draft', 'sent', 'accepted', 'rejected'];
  }

  /**
   * Update Quote status.
   *
   * Business Rules:
   * - Only SuperAdmin and Admin can update status
   * - Status must be one of: draft, sent, accepted, rejected
   * - Maintains exists: true
   * - Updates updatedAt timestamp
   * - Logs activity for audit trail.
   * @param {object} currentUser - User performing the action.
   * @param {string} quoteId - Quote ID to update.
   * @param {string} newStatus - New status value.
   * @param {string} reason - Reason for status change (for audit logging).
   * @param {string} userRole - User role (optional).
   * @returns {Promise<object>} Result with success status and Quote data.
   * @throws {Error} If validation fails or database operation fails.
   * @example
   * const result = await service.updateQuoteStatus(currentUser, 'abc123', 'sent', 'Quote sent to client');
   */
  async updateQuoteStatus(currentUser, quoteId, newStatus, reason = '', userRole = null) {
    try {
      // Validate user authentication
      if (!currentUser) {
        throw new Error('User authentication required');
      }

      // Get user role
      const role = userRole || currentUser.get('role');

      // Validate user permissions
      if (!this.allowedRoles.includes(role)) {
        throw new Error(`Unauthorized: Role '${role}' cannot update Quote status`);
      }

      // Validate Quote ID
      if (!quoteId) {
        throw new Error('Quote ID is required');
      }

      // Validate status
      if (!this.validStatuses.includes(newStatus)) {
        throw new Error(`Invalid status. Must be one of: ${this.validStatuses.join(', ')}`);
      }

      // Fetch Quote
      const query = new Parse.Query('Quote');
      query.equalTo('exists', true);
      query.include('client');
      query.include('rate');
      const quote = await query.get(quoteId, { useMasterKey: true });

      if (!quote) {
        throw new Error('Quote not found');
      }

      const previousStatus = quote.get('status');

      // Update status
      quote.set('status', newStatus);
      await quote.save(null, { useMasterKey: true });

      // Audit logging
      logger.info('Quote status updated successfully', {
        quoteId: quote.id,
        quoteFolio: quote.get('folio'),
        previousStatus,
        newStatus,
        reason,
        performedBy: {
          userId: currentUser.id,
          userRole: role,
          username: currentUser.get('username'),
        },
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        quote: {
          id: quote.id,
          folio: quote.get('folio'),
          status: newStatus,
        },
        previousStatus,
        newStatus,
      };
    } catch (error) {
      logger.error('Error updating Quote status', {
        quoteId,
        newStatus,
        error: error.message,
        stack: error.stack,
        userId: currentUser?.id,
      });

      throw error;
    }
  }

  /**
   * Update Quote data.
   *
   * Business Rules:
   * - Only SuperAdmin and Admin can update
   * - Validates all updated fields
   * - Maintains exists: true
   * - Updates updatedAt timestamp
   * - Logs activity for audit trail.
   * @param {object} currentUser - User performing the action.
   * @param {string} quoteId - Quote ID to update.
   * @param {object} updates - Object with fields to update.
   * @param {string} reason - Reason for update (for audit logging).
   * @param {string} userRole - User role (optional).
   * @returns {Promise<object>} Result with success status and Quote data.
   * @throws {Error} If validation fails or database operation fails.
   * @example
   * const result = await service.updateQuote(currentUser, 'abc123', { numberOfPeople: 5 }, 'Updated party size');
   */
  async updateQuote(currentUser, quoteId, updates, reason = '', userRole = null) {
    try {
      // Validate user authentication
      if (!currentUser) {
        throw new Error('User authentication required');
      }

      // Get user role
      const role = userRole || currentUser.get('role');

      // Validate user permissions
      if (!this.allowedRoles.includes(role)) {
        throw new Error(`Unauthorized: Role '${role}' cannot update Quotes`);
      }

      // Validate Quote ID
      if (!quoteId) {
        throw new Error('Quote ID is required');
      }

      // Validate updates object
      if (!updates || typeof updates !== 'object') {
        throw new Error('Updates object is required');
      }

      // Fetch Quote
      const query = new Parse.Query('Quote');
      query.equalTo('exists', true);
      query.include('client');
      query.include('rate');
      const quote = await query.get(quoteId, { useMasterKey: true });

      if (!quote) {
        throw new Error('Quote not found');
      }

      // Apply updates
      const allowedFields = [
        'status',
        'numberOfPeople',
        'contactPerson',
        'contactEmail',
        'contactPhone',
        'notes',
        'validUntil',
      ];

      const appliedUpdates = {};
      Object.keys(updates).forEach((key) => {
        if (allowedFields.includes(key)) {
          // Validate status if being updated
          if (key === 'status' && !this.validStatuses.includes(updates[key])) {
            throw new Error(`Invalid status. Must be one of: ${this.validStatuses.join(', ')}`);
          }

          quote.set(key, updates[key]);
          appliedUpdates[key] = updates[key];
        }
      });

      await quote.save(null, { useMasterKey: true });

      // Audit logging
      logger.info('Quote updated successfully', {
        quoteId: quote.id,
        quoteFolio: quote.get('folio'),
        updates: appliedUpdates,
        reason,
        performedBy: {
          userId: currentUser.id,
          userRole: role,
          username: currentUser.get('username'),
        },
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        quote: {
          id: quote.id,
          folio: quote.get('folio'),
          ...appliedUpdates,
        },
      };
    } catch (error) {
      logger.error('Error updating Quote', {
        quoteId,
        updates,
        error: error.message,
        stack: error.stack,
        userId: currentUser?.id,
      });

      throw error;
    }
  }

  /**
   * Soft delete Quote (set exists = false).
   *
   * Business Rules:
   * - Only SuperAdmin and Admin can delete
   * - Sets exists: false (maintains record for audit trail)
   * - Sets active: false as well
   * - Cannot be undone through normal UI
   * - Logs deletion for audit trail.
   * @param {object} currentUser - User performing the action.
   * @param {string} quoteId - Quote ID to delete.
   * @param {string} reason - Reason for deletion (for audit logging).
   * @param {string} userRole - User role (optional).
   * @returns {Promise<object>} Result with success status.
   * @throws {Error} If validation fails or Quote cannot be deleted.
   * @example
   * const result = await service.softDeleteQuote(currentUser, 'abc123', 'Quote cancelled by client');
   */
  async softDeleteQuote(currentUser, quoteId, reason = '', userRole = null) {
    try {
      // Validate user authentication
      if (!currentUser) {
        throw new Error('User authentication required');
      }

      // Get user role
      const role = userRole || currentUser.get('role');

      // Validate user permissions (only superadmin and admin)
      if (!['superadmin', 'admin'].includes(role)) {
        throw new Error(`Unauthorized: Role '${role}' cannot delete Quotes`);
      }

      // Validate Quote ID
      if (!quoteId) {
        throw new Error('Quote ID is required');
      }

      // Fetch Quote
      const query = new Parse.Query('Quote');
      query.equalTo('exists', true);
      const quote = await query.get(quoteId, { useMasterKey: true });

      if (!quote) {
        throw new Error('Quote not found');
      }

      // Soft delete: set exists = false and active = false
      quote.set('exists', false);
      quote.set('active', false);
      await quote.save(null, { useMasterKey: true });

      // Audit logging
      logger.info('Quote soft deleted successfully', {
        quoteId: quote.id,
        quoteFolio: quote.get('folio'),
        reason,
        performedBy: {
          userId: currentUser.id,
          userRole: role,
          username: currentUser.get('username'),
        },
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        message: 'Quote deleted successfully',
      };
    } catch (error) {
      logger.error('Error soft deleting Quote', {
        quoteId,
        error: error.message,
        stack: error.stack,
        userId: currentUser?.id,
      });

      throw error;
    }
  }
}

module.exports = QuoteService;
