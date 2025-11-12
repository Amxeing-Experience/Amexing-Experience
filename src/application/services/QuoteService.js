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
 * @since 1.0.0
 * @example
 * const service = new QuoteService();
 * const result = await service.updateQuoteStatus(currentUser, quoteId, 'sent');
 */

const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');
const PDFReceiptService = require('./PDFReceiptService');
const Invoice = require('../../domain/models/Invoice');

/**
 * QuoteService class implementing Quote business logic.
 */
class QuoteService {
  constructor() {
    this.className = 'Quote';
    this.allowedRoles = ['superadmin', 'admin', 'department_manager'];
    this.validStatuses = ['requested', 'hold', 'scheduled', 'rejected'];
    this.pdfService = new PDFReceiptService();
  }

  /**
   * Update Quote status.
   *
   * Business Rules:
   * - Only SuperAdmin and Admin can update status
   * - Status must be one of: requested, hold, scheduled, rejected
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

      // Check if quote is in 'scheduled' status - prevent status changes
      const currentStatus = quote.get('status');
      if (currentStatus === 'scheduled' && updates.status && updates.status !== 'scheduled') {
        throw new Error('Cannot change status from scheduled. Use specific scheduled quote actions instead.');
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

      // Validate user permissions (superadmin, admin, and department_manager)
      if (!['superadmin', 'admin', 'department_manager'].includes(role)) {
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

  /**
   * Generate receipt for scheduled quote.
   *
   * Business Rules:
   * - Only department_manager, admin, and superadmin can generate receipts
   * - Quote must be in 'scheduled' status
   * - Creates a receipt record and maintains audit trail.
   * @param {object} currentUser - User performing the action.
   * @param {string} quoteId - Quote ID to generate receipt for.
   * @param {string} userRole - User role (optional).
   * @param includePaymentInfoOverride
   * @param paymentInfoId
   * @returns {Promise<object>} Result with success status and receipt data.
   * @throws {Error} If validation fails or quote is not in scheduled status.
   * @example
   * const result = await service.generateReceipt(currentUser, 'abc123', 'department_manager');
   */
  async generateReceipt(
    currentUser,
    quoteId,
    userRole = null,
    includePaymentInfoOverride = null,
    paymentInfoId = null
  ) {
    try {
      // Validate user authentication
      if (!currentUser) {
        throw new Error('User authentication required');
      }

      // Get user role
      const role = userRole || currentUser.get('role');

      // Validate user permissions
      if (!this.allowedRoles.includes(role)) {
        throw new Error(`Unauthorized: Role '${role}' cannot generate receipts`);
      }

      // Validate Quote ID
      if (!quoteId) {
        throw new Error('Quote ID is required');
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

      // Validate quote is in scheduled status
      const currentStatus = quote.get('status');
      if (currentStatus !== 'scheduled') {
        throw new Error('Quote must be in scheduled status to generate receipt');
      }

      // Get service items if they exist
      const serviceItemsRaw = quote.get('serviceItems') || {};

      // Extract service items and totals from the quote data
      let serviceItems = [];
      if (Array.isArray(serviceItemsRaw.days)) {
        serviceItems = serviceItemsRaw.days;
      } else if (Array.isArray(serviceItemsRaw)) {
        serviceItems = serviceItemsRaw;
      }

      // Log service items for receipt generation
      logger.info('Generating receipt for quote with service items', {
        quoteId: quote.id,
        quoteFolio: quote.get('folio'),
        itemCount: serviceItems.length,
        hasServiceItems: serviceItems.length > 0,
      });

      // Use the quote's stored totals directly (these are the official quote totals)
      const subtotal = serviceItemsRaw.subtotal || 0;
      const iva = serviceItemsRaw.iva || 0;
      const total = serviceItemsRaw.total || 0;

      // Determine whether to include payment info and get specific payment data
      // For admin role: use the override if provided, otherwise default to true
      // For other roles: follow the standard rule
      let includePaymentInfo;
      let selectedPaymentInfo = null;

      if (role === 'admin' && includePaymentInfoOverride !== null && includePaymentInfoOverride !== undefined) {
        // Admin can override the payment info inclusion
        includePaymentInfo = includePaymentInfoOverride;

        // If admin wants to include payment info and provided a specific ID, get that payment info
        if (includePaymentInfo && paymentInfoId) {
          try {
            const PaymentInfo = require('../../domain/models/PaymentInfo');
            selectedPaymentInfo = await PaymentInfo.getPaymentInfoById(paymentInfoId);
            logger.info('Using specific payment info for receipt generation', {
              paymentInfoId,
              paymentInfoName: selectedPaymentInfo.name,
              quoteId,
              userRole: role,
            });
          } catch (error) {
            logger.warn('Could not load specific payment info, using default', {
              paymentInfoId,
              error: error.message,
              quoteId,
            });
            // Fall back to default payment info
            try {
              const PaymentInfo = require('../../domain/models/PaymentInfo');
              selectedPaymentInfo = await PaymentInfo.getDefaultPaymentInfo();
            } catch (fallbackError) {
              logger.error('Could not load default payment info either', {
                fallbackError: fallbackError.message,
                quoteId,
              });
              selectedPaymentInfo = null;
            }
          }
        }
      } else {
        // Default behavior: only admin and superadmin roles should see payment info
        includePaymentInfo = role === 'admin' || role === 'superadmin';

        // For non-admin users or when no specific payment info requested, use default
        if (includePaymentInfo) {
          try {
            const PaymentInfo = require('../../domain/models/PaymentInfo');
            selectedPaymentInfo = await PaymentInfo.getDefaultPaymentInfo();
          } catch (error) {
            logger.warn('Could not load default payment info', {
              error: error.message,
              quoteId,
              userRole: role,
            });
            selectedPaymentInfo = null;
          }
        }
      }

      // Prepare quote data for PDF generation
      const quoteData = {
        quote: {
          id: quote.id,
          folio: quote.get('folio'),
          validUntil: quote.get('validUntil'),
        },
        client: {
          firstName: quote.get('client')?.get('firstName') || '',
          lastName: quote.get('client')?.get('lastName') || '',
          fullName: quote.get('client')?.get('fullName') || quote.get('contactPerson') || 'N/A',
          email: quote.get('client')?.get('email') || quote.get('contactEmail') || '',
          phone: quote.get('contactPhone') || quote.get('client')?.get('phone') || '',
        },
        serviceItems: serviceItems.map((item) => ({
          dayNumber: item.dayNumber,
          concept: item.concept,
          vehicleType: item.vehicleType,
          hours: item.hours,
          total: item.dayTotal || item.total || 0, // Use dayTotal first, then total, then 0 as fallback
          notes: item.notes,
        })),
        totals: {
          subtotal,
          iva,
          total,
        },
        includePaymentInfo, // Pass the flag to PDF service
        selectedPaymentInfo, // Pass the specific payment info data
      };

      // Generate PDF receipt
      const pdfBuffer = await this.pdfService.generateReceipt(quoteData);

      const receiptId = `REC-${quote.get('folio')}-${Date.now()}`;

      // Audit logging
      logger.info('Receipt generated for scheduled quote', {
        quoteId: quote.id,
        quoteFolio: quote.get('folio'),
        receiptId,
        generatedBy: currentUser.id,
        generatedByRole: role,
        pdfSize: pdfBuffer.length,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        message: 'Recibo generado exitosamente',
        data: {
          quoteId: quote.id,
          folio: quote.get('folio'),
          receiptId,
          pdfBuffer,
          filename: `Receipt-${quote.get('folio')}.pdf`,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      logger.error('Error generating receipt for scheduled quote', {
        quoteId,
        error: error.message,
        stack: error.stack,
        userId: currentUser?.id,
      });

      throw error;
    }
  }

  /**
   * Request invoice for scheduled quote.
   *
   * Business Rules:
   * - Only department_manager, admin, and superadmin can request invoices
   * - Quote must be in 'scheduled' status
   * - Creates an invoice request record and maintains audit trail.
   * @param {object} currentUser - User performing the action.
   * @param {string} quoteId - Quote ID to request invoice for.
   * @param {string} userRole - User role (optional).
   * @returns {Promise<object>} Result with success status and invoice request data.
   * @throws {Error} If validation fails or quote is not in scheduled status.
   * @example
   * const result = await service.requestInvoice(currentUser, 'abc123', 'department_manager');
   */
  async requestInvoice(currentUser, quoteId, userRole = null) {
    try {
      // Validate user authentication
      if (!currentUser) {
        throw new Error('User authentication required');
      }

      // Get user role
      const role = userRole || currentUser.get('role');

      // Validate user permissions
      if (!this.allowedRoles.includes(role)) {
        throw new Error(`Unauthorized: Role '${role}' cannot request invoices`);
      }

      // Validate Quote ID
      if (!quoteId) {
        throw new Error('Quote ID is required');
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

      // Validate quote is in scheduled status
      const currentStatus = quote.get('status');
      if (currentStatus !== 'scheduled') {
        throw new Error('Quote must be in scheduled status to request invoice');
      }

      // Check if there's already a pending invoice request for this quote
      const hasPendingRequest = await Invoice.hasPendingRequest(quote);
      if (hasPendingRequest) {
        throw new Error('There is already a pending invoice request for this quote');
      }

      // Create invoice request record
      const invoice = await Invoice.createRequest(quote, currentUser);

      // Update quote to track invoice request
      quote.set('invoiceRequested', true);
      quote.set('invoiceRequestDate', new Date());
      quote.set('invoiceRequestedBy', currentUser);
      await quote.save(null, { useMasterKey: true });

      // Audit logging
      logger.info('Invoice request created for scheduled quote', {
        quoteId: quote.id,
        quoteFolio: quote.get('folio'),
        invoiceId: invoice.id,
        requestedBy: currentUser.id,
        requestedByRole: role,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        message: 'Solicitud de factura enviada exitosamente',
        data: {
          quoteId: quote.id,
          folio: quote.get('folio'),
          invoiceRequestId: invoice.id,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      logger.error('Error requesting invoice for scheduled quote', {
        quoteId,
        error: error.message,
        stack: error.stack,
        userId: currentUser?.id,
      });

      throw error;
    }
  }

  /**
   * Check if a quote has a pending invoice request.
   * @param {string} quoteId - Quote ID to check.
   * @returns {Promise<boolean>} True if quote has pending invoice request.
   * @example
   * const hasPending = await service.hasPendingInvoiceRequest('abc123');
   */
  async hasPendingInvoiceRequest(quoteId) {
    try {
      if (!quoteId) {
        return false;
      }

      return await Invoice.hasPendingRequest(quoteId);
    } catch (error) {
      logger.error('Error checking pending invoice request', {
        quoteId,
        error: error.message,
        stack: error.stack,
      });
      return false; // Default to false on error to avoid blocking UI
    }
  }

  /**
   * Cancel reservation for scheduled quote.
   *
   * Business Rules:
   * - Only department_manager, admin, and superadmin can cancel reservations
   * - Quote must be in 'scheduled' status
   * - Changes quote status to 'rejected'
   * - Creates audit trail for the cancellation.
   * @param {object} currentUser - User performing the action.
   * @param {string} quoteId - Quote ID to cancel reservation for.
   * @param {string} reason - Reason for cancellation.
   * @param {string} userRole - User role (optional).
   * @returns {Promise<object>} Result with success status and updated quote data.
   * @throws {Error} If validation fails or quote is not in scheduled status.
   * @example
   * const result = await service.cancelReservation(currentUser, 'abc123', 'Client requested cancellation', 'department_manager');
   */
  async cancelReservation(currentUser, quoteId, reason = '', userRole = null) {
    try {
      // Validate user authentication
      if (!currentUser) {
        throw new Error('User authentication required');
      }

      // Get user role
      const role = userRole || currentUser.get('role');

      // Validate user permissions
      if (!this.allowedRoles.includes(role)) {
        throw new Error(`Unauthorized: Role '${role}' cannot cancel reservations`);
      }

      // Validate Quote ID
      if (!quoteId) {
        throw new Error('Quote ID is required');
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

      // Validate quote is in scheduled status
      const currentStatus = quote.get('status');
      if (currentStatus !== 'scheduled') {
        throw new Error('Quote must be in scheduled status to cancel reservation');
      }

      // Change status to 'rejected'
      quote.set('status', 'rejected');
      await quote.save(null, { useMasterKey: true });

      // Audit logging
      logger.info('Reservation cancelled for quote', {
        quoteId: quote.id,
        quoteFolio: quote.get('folio'),
        previousStatus: 'scheduled',
        newStatus: 'rejected',
        cancelledBy: currentUser.id,
        cancelledByRole: role,
        reason: reason || 'No reason provided',
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        message: 'Reserva cancelada exitosamente',
        data: {
          id: quote.id,
          folio: quote.get('folio'),
          status: quote.get('status'),
          updatedAt: quote.updatedAt,
        },
      };
    } catch (error) {
      logger.error('Error cancelling reservation for quote', {
        quoteId,
        error: error.message,
        stack: error.stack,
        userId: currentUser?.id,
        reason,
      });

      throw error;
    }
  }
}

module.exports = QuoteService;
