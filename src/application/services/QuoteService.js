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
const Reservation = require('../../domain/models/Reservation');
const ReservationService = require('../../domain/models/ReservationService');

/**
 * QuoteService class implementing Quote business logic.
 */
class QuoteService {
  constructor() {
    this.className = 'Quote';
    this.allowedRoles = ['superadmin', 'admin', 'department_manager', 'client'];
    this.validStatuses = ['quoted', 'requested', 'hold', 'scheduled', 'rejected'];
    this.pdfService = new PDFReceiptService();
  }

  /**
   * Update Quote status.
   *
   * Business Rules:
   * - Status must be one of: quoted, requested, hold, scheduled, rejected
   * - Role-based permissions apply for certain status changes
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
   * const result = await service.updateQuoteStatus(currentUser, 'abc123', 'requested', 'Client requested services');
   */
  async updateQuoteStatus(currentUser, quoteId, newStatus, reason = '', userRole = null) {
    try {
      // Validate user authentication
      if (!currentUser) {
        throw new Error('User authentication required');
      }

      // Get user role
      const role = userRole || currentUser.get('role');

      // Validate user permissions based on status transition
      const adminOnlyStatuses = ['hold', 'scheduled', 'rejected'];

      // Check if user is trying to set an admin-only status
      if (adminOnlyStatuses.includes(newStatus)) {
        // Only admin and superadmin can set these statuses
        if (!['admin', 'superadmin'].includes(role)) {
          throw new Error(`Unauthorized: Only administrators can set status to '${newStatus}'`);
        }
      } else if (newStatus === 'requested') {
        // All allowed roles can change to requested (SOLICITADO)
        if (!this.allowedRoles.includes(role)) {
          throw new Error(`Unauthorized: Role '${role}' cannot update Quote status`);
        }
      } else if (newStatus === 'quoted') {
        // Only admin can revert to quoted status
        if (!['admin', 'superadmin'].includes(role)) {
          throw new Error('Unauthorized: Only administrators can revert status to \'quoted\'');
        }
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

      // If changing to requested (SOLICITADO), auto-create Reservation + ReservationServices
      let reservationData = null;
      if (newStatus === 'requested' && previousStatus !== 'requested') {
        reservationData = await this.createReservationFromQuote(quote, currentUser);
      }

      // Audit logging
      logger.info('Quote status updated successfully', {
        quoteId: quote.id,
        quoteFolio: quote.get('folio'),
        previousStatus,
        newStatus,
        reason,
        reservationCreated: !!reservationData,
        performedBy: {
          userId: currentUser.id,
          userRole: role,
          username: currentUser.get('username'),
        },
        timestamp: new Date().toISOString(),
      });

      const result = {
        success: true,
        quote: {
          id: quote.id,
          folio: quote.get('folio'),
          status: newStatus,
        },
        previousStatus,
        newStatus,
      };

      if (reservationData) {
        result.reservation = reservationData;
      }

      return result;
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

      // Basic permission check
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

      // Check status change permissions
      const currentStatus = quote.get('status') || 'quoted';
      if (updates.status && updates.status !== currentStatus) {
        const adminOnlyStatuses = ['hold', 'scheduled', 'rejected'];

        // Check if user is trying to set an admin-only status
        if (adminOnlyStatuses.includes(updates.status)) {
          if (!['admin', 'superadmin'].includes(role)) {
            throw new Error(`Unauthorized: Only administrators can set status to '${updates.status}'`);
          }
        } else if (updates.status === 'requested') {
          // All allowed roles can change to requested (SOLICITADO)
          // No additional check needed
        } else if (updates.status === 'quoted') {
          // Only admin can revert to quoted status (allow in development for testing)
          if (!['admin', 'superadmin'].includes(role) && process.env.NODE_ENV !== 'development') {
            throw new Error('Unauthorized: Only administrators can revert status to \'quoted\'');
          }
        }
      }

      // Apply updates
      const allowedFields = [
        'status',
        'numberOfPeople',
        'numberOfAdults',
        'numberOfChildren',
        'numberOfInfants',
        'preferredLanguage',
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

      // Handle client field updates - DUAL FIELD ARCHITECTURE
      const clientIdNormalized = updates.client || updates.clientId;
      if (clientIdNormalized) {
        try {
          // 1. Save as companyClientPtr (Client pointer) for new system
          const companyClientPointer = {
            __type: 'Pointer',
            className: 'Client',
            objectId: clientIdNormalized,
          };
          quote.set('companyClientPtr', companyClientPointer);
          appliedUpdates.companyClientPtr = clientIdNormalized;

          logger.info('QuoteService.updateQuote - Setting companyClientPtr', {
            quoteId: quote.id,
            clientId: clientIdNormalized,
            companyClientPointer,
          });

          // 2. Find the AmexingUser who owns this Client for backward compatibility
          const clientQuery = new Parse.Query('Client');
          const clientRecord = await clientQuery.get(clientIdNormalized, { useMasterKey: true });
          const ownedByPointer = clientRecord.get('ownedBy');

          if (ownedByPointer) {
            // Extract the actual ID from the ownedBy pointer
            const ownerId = ownedByPointer.id || ownedByPointer.objectId || ownedByPointer;

            // Role-based logic for client field assignment
            let clientAmexingUserId;
            if (role === 'department_manager') {
              // Department manager: client field should be the department manager themselves
              clientAmexingUserId = currentUser.id;
              logger.info('QuoteService.updateQuote - Department manager: setting client to currentUser', {
                currentUserId: currentUser.id,
                selectedClientId: clientIdNormalized,
              });
            } else {
              // Client role: client field should be the owner of the selected Client
              clientAmexingUserId = ownerId;
              logger.info('QuoteService.updateQuote - Client role: setting client to Client owner', {
                clientId: clientIdNormalized,
                ownerId,
              });
            }

            const amexingUserPointer = {
              __type: 'Pointer',
              className: 'AmexingUser',
              objectId: clientAmexingUserId,
            };
            quote.set('client', amexingUserPointer);
            appliedUpdates.client = clientAmexingUserId;

            logger.info('QuoteService.updateQuote - Setting client (AmexingUser) for backward compatibility', {
              quoteId: quote.id,
              clientCompanyId: clientIdNormalized,
              ownerId,
              amexingUserPointer,
            });
          } else {
            logger.warn('QuoteService.updateQuote - Client record has no ownedBy field', {
              quoteId: quote.id,
              clientId: clientIdNormalized,
            });
          }
        } catch (error) {
          logger.error('QuoteService.updateQuote - Error setting client pointers', {
            error: error.message,
            quoteId: quote.id,
            clientId: clientIdNormalized,
          });
          // Continue without failing the entire update
        }
      }

      await quote.save(null, { useMasterKey: true });

      // If status changed to requested (SOLICITADO), auto-create Reservation
      let reservationData = null;
      if (appliedUpdates.status === 'requested' && currentStatus !== 'requested') {
        reservationData = await this.createReservationFromQuote(quote, currentUser);

        // Send confirmation email with PDF (non-blocking)
        this.sendScheduledConfirmationEmail(quote, currentUser, reservationData)
          .catch((err) => logger.warn('Failed to send request confirmation email', {
            error: err.message,
            quoteId: quote.id,
          }));
      }

      // Audit logging
      logger.info('Quote updated successfully', {
        quoteId: quote.id,
        quoteFolio: quote.get('folio'),
        updates: appliedUpdates,
        reason,
        reservationCreated: !!reservationData,
        performedBy: {
          userId: currentUser.id,
          userRole: role,
          username: currentUser.get('username'),
        },
        timestamp: new Date().toISOString(),
      });

      const result = {
        success: true,
        data: {
          id: quote.id,
          folio: quote.get('folio'),
          status: quote.get('status'),
          ...appliedUpdates,
        },
      };

      if (reservationData) {
        result.data.reservation = reservationData;
      }

      return result;
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

      // Validate user permissions
      if (!['superadmin', 'admin', 'department_manager', 'client'].includes(role)) {
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

      // Cascade cancel associated Reservation + ReservationServices
      const resQuery = new Parse.Query('Reservation');
      resQuery.equalTo('quotePtr', quote);
      resQuery.equalTo('exists', true);
      const reservation = await resQuery.first({ useMasterKey: true });
      if (reservation) {
        reservation.set('status', 'cancelled');
        await reservation.save(null, { useMasterKey: true });

        const svcQuery = new Parse.Query('ReservationService');
        svcQuery.equalTo('reservationPtr', reservation);
        svcQuery.equalTo('active', true);
        svcQuery.equalTo('exists', true);
        svcQuery.limit(1000);
        const services = await svcQuery.find({ useMasterKey: true });
        for (const svc of services) {
          svc.set('status', 'cancelled');
        }
        if (services.length > 0) {
          await Parse.Object.saveAll(services, { useMasterKey: true });
        }
        logger.info('Associated reservation cancelled', {
          reservationId: reservation.id,
          servicesCancelled: services.length,
        });
      }

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

  /**
   * Create Reservation + ReservationService records from a confirmed quote.
   * Idempotent: skips if a reservation already exists for this quote.
   * @param {object} quote - Parse Quote object (with client included).
   * @param {object} currentUser - User who confirmed.
   * @returns {Promise<object|null>} Reservation data or null if already exists.
   * @private
   * @example
   */
  async createReservationFromQuote(quote, currentUser) {
    try {
      // Idempotency check: skip if an active reservation already exists for this quote
      const existingQuery = new Parse.Query('Reservation');
      existingQuery.equalTo('quotePtr', quote);
      existingQuery.equalTo('exists', true);
      const existing = await existingQuery.first({ useMasterKey: true });
      if (existing) {
        // If cancelled, reactivate it and its services
        if (existing.get('status') === 'cancelled') {
          existing.set('status', 'pending');
          await existing.save(null, { useMasterKey: true });

          const svcQuery = new Parse.Query('ReservationService');
          svcQuery.equalTo('reservationPtr', existing);
          svcQuery.equalTo('exists', true);
          svcQuery.equalTo('status', 'cancelled');
          svcQuery.limit(1000);
          const services = await svcQuery.find({ useMasterKey: true });
          for (const svc of services) {
            svc.set('status', 'pending');
          }
          if (services.length > 0) {
            await Parse.Object.saveAll(services, { useMasterKey: true });
          }

          logger.info('Reactivated cancelled reservation for quote', {
            quoteId: quote.id,
            reservationId: existing.id,
            servicesReactivated: services.length,
          });
          return { id: existing.id, folio: existing.get('folio'), servicesCount: services.length };
        }

        logger.info('Reservation already exists for quote, skipping creation', {
          quoteId: quote.id,
          reservationId: existing.id,
        });
        return { id: existing.id, folio: existing.get('folio') };
      }

      // Generate folio: RES-YYYY-NNNN
      const year = new Date().getFullYear();
      const countQuery = new Parse.Query('Reservation');
      countQuery.startsWith('folio', `RES-${year}-`);
      const count = await countQuery.count({ useMasterKey: true });
      const folio = `RES-${year}-${String(count + 1).padStart(4, '0')}`;

      const serviceItems = quote.get('serviceItems') || {};
      const days = serviceItems.days || [];

      // Calculate start/end dates from service days
      let startDate = null;
      let endDate = null;
      for (const day of days) {
        if (day.date) {
          const d = new Date(`${day.date}T12:00:00`);
          if (!startDate || d < startDate) startDate = d;
          if (!endDate || d > endDate) endDate = d;
        }
      }

      // Create Reservation
      const reservation = new Reservation();
      reservation.set('quotePtr', quote);
      reservation.set('folio', folio);
      reservation.set('status', 'pending');
      reservation.set('totalAmount', serviceItems.total || 0);
      reservation.set('servicesSubtotal', serviceItems.total || 0);
      reservation.set('adjustments', []);
      reservation.set('currency', serviceItems.currency || 'MXN');
      reservation.set('paymentType', serviceItems.paymentType || 'efectivo');
      reservation.set('numberOfPeople', quote.get('numberOfPeople') || 1);
      reservation.set('eventType', quote.get('eventType') || '');
      reservation.set('contactPerson', quote.get('contactPerson') || '');
      reservation.set('contactEmail', quote.get('contactEmail') || '');
      reservation.set('contactPhone', quote.get('contactPhone') || '');
      reservation.set('notes', quote.get('notes') || '');
      reservation.set('serviceItemsSnapshot', serviceItems);
      reservation.set('active', true);
      reservation.set('exists', true);

      if (startDate) reservation.set('startDate', startDate);
      if (endDate) reservation.set('endDate', endDate);

      // Set client pointer to the quote's client (AmexingUser)
      const client = quote.get('client');
      if (client) {
        reservation.set('clientPtr', client);
        logger.info('Set clientPtr for reservation from quote client', {
          reservationId: reservation.id,
          clientPtr: client,
          quoteId: quote.id,
          currentUserId: currentUser?.id,
        });
      } else if (currentUser) {
        // Fallback: if quote has no client, use current user
        const userPointer = new Parse.Object('AmexingUser');
        userPointer.id = currentUser.id;
        reservation.set('clientPtr', userPointer);
        logger.info('Set clientPtr for reservation to current user (no quote client)', {
          reservationId: reservation.id,
          clientPtrUserId: currentUser.id,
          quoteId: quote.id,
        });
      }

      // Set created by
      if (currentUser) {
        const userPointer = new Parse.Object('AmexingUser');
        userPointer.id = currentUser.id;
        reservation.set('createdBy', userPointer);
      }

      await reservation.save(null, { useMasterKey: true });

      // Create ReservationService for each subconcept in each day
      const servicesToSave = [];
      for (const day of days) {
        const subconcepts = day.subconcepts || [];
        for (const sub of subconcepts) {
          const resSvc = new ReservationService();
          resSvc.set('reservationPtr', reservation);
          resSvc.set('dayNumber', day.dayNumber || 1);
          resSvc.set('dayTitle', day.concept || day.dayTitle || `Día ${day.dayNumber || 1}`);
          resSvc.set('type', sub.type || 'concepto');
          resSvc.set('concept', sub.concept || sub.name || '');
          resSvc.set('time', sub.time || '');
          resSvc.set('status', 'pending');
          resSvc.set('price', sub.unitPrice || sub.price || 0);
          resSvc.set('total', sub.total || sub.unitPrice || 0);
          resSvc.set('originName', sub.originName || sub.origin || '');
          resSvc.set('destinationName', sub.destinationName || sub.destination || '');
          resSvc.set('vehicleTypeName', sub.vehicleTypeName || sub.vehicleType || '');
          resSvc.set('notes', sub.notes || '');
          resSvc.set('subconcept', sub);
          resSvc.set('active', true);
          resSvc.set('exists', true);

          if (day.date) {
            resSvc.set('serviceDate', new Date(`${day.date}T12:00:00`));
          }

          servicesToSave.push(resSvc);
        }
      }

      if (servicesToSave.length > 0) {
        await Parse.Object.saveAll(servicesToSave, { useMasterKey: true });
      }

      logger.info('Reservation created from quote', {
        quoteId: quote.id,
        quoteFolio: quote.get('folio'),
        reservationId: reservation.id,
        reservationFolio: folio,
        servicesCreated: servicesToSave.length,
      });

      return {
        id: reservation.id,
        folio,
        servicesCount: servicesToSave.length,
      };
    } catch (error) {
      logger.error('Error creating reservation from quote', {
        quoteId: quote.id,
        error: error.message,
        stack: error.stack,
      });
      // Don't throw — the quote status update already succeeded
      return null;
    }
  }

  /**
   * Send confirmation email with PDF when quote is scheduled.
   * @param {object} quote - Parse Quote object.
   * @param {object} currentUser - Parse AmexingUser performing the action.
   * @param {object} reservationData - Created reservation data (optional).
   * @returns {Promise<void>}
   * @example
   */
  async sendScheduledConfirmationEmail(quote, currentUser, reservationData) {
    // eslint-disable-next-line global-require
    const emailService = require('./EmailService');

    if (!emailService.isAvailable()) {
      logger.info('Email service not available, skipping confirmation email', {
        quoteId: quote.id,
      });
      return;
    }

    const recipientEmail = quote.get('contactEmail')
      || currentUser.get('email');
    if (!recipientEmail) {
      logger.warn('No recipient email for quote confirmation', { quoteId: quote.id });
      return;
    }

    const recipientName = quote.get('contactPerson')
      || currentUser.get('fullName')
      || `${currentUser.get('firstName') || ''} ${currentUser.get('lastName') || ''}`.trim()
      || currentUser.get('username');

    // Generate PDF
    let pdfBuffer = null;
    let pdfFilename = null;
    try {
      const receiptResult = await this.generateReceipt(currentUser, quote.id, currentUser.get('role'));
      if (receiptResult?.success && receiptResult.data?.pdfBuffer) {
        ({ pdfBuffer } = receiptResult.data);
        pdfFilename = receiptResult.data.filename;
      }
    } catch (pdfErr) {
      logger.warn('Failed to generate PDF for email attachment', {
        quoteId: quote.id,
        error: pdfErr.message,
      });
    }

    // Build share URL
    const baseUrl = process.env.APP_BASE_URL
      || process.env.EMAIL_BASE_URL
      || `http://localhost:${process.env.PORT || 1337}`;
    const shareUrl = `${baseUrl}/quotes/${quote.get('folio')}`;

    /**
     * Format a date value to es-MX locale string.
     * @param {Date|string|null} d - Date to format.
     * @returns {string|null} Formatted date string or null.
     * @example
     */
    const formatDate = (d) => {
      if (!d) return null;
      const dateObj = d instanceof Date ? d : new Date(d);
      return dateObj.toLocaleDateString('es-MX', {
        day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
      });
    };

    const serviceItems = quote.get('serviceItems') || {};
    const days = serviceItems.days || [];
    let startDate = null;
    let endDate = null;
    for (const day of days) {
      if (day.date) {
        const d = new Date(`${day.date}T12:00:00`);
        if (!startDate || d < new Date(`${startDate}T12:00:00`)) startDate = day.date;
        if (!endDate || d > new Date(`${endDate}T12:00:00`)) endDate = day.date;
      }
    }

    // Determine additional CC emails based on environment
    const additionalCCEmails = [];
    const environment = process.env.NODE_ENV || 'development';

    if (environment === 'production') {
      additionalCCEmails.push('michelle@amexing.com');
      logger.info('Adding production CC email for quote confirmation', {
        quoteId: quote.id,
        ccEmail: 'michelle@amexing.com',
        environment,
      });
    } else if (environment === 'development') {
      additionalCCEmails.push('denisse@meeplab.com');
      logger.info('Adding development CC email for quote confirmation', {
        quoteId: quote.id,
        ccEmail: 'denisse@meeplab.com',
        environment,
      });
    }

    const result = await emailService.sendQuoteConfirmation({
      recipientEmail,
      recipientName,
      folio: quote.get('folio'),
      reservationFolio: reservationData?.folio || null,
      eventType: quote.get('eventType') || '',
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      numberOfPeople: quote.get('numberOfPeople') || 1,
      shareUrl,
      pdfBuffer,
      pdfFilename,
      ccEmails: additionalCCEmails, // Add CC emails based on environment
    });

    logger.info('Quote confirmation email sent', {
      quoteId: quote.id,
      folio: quote.get('folio'),
      success: result?.success,
      recipientEmail: emailService.maskEmail(recipientEmail),
    });
  }

  /**
   * Send quote confirmation email to multiple recipients.
   * Generates PDF once and sends in parallel.
   * @param {Parse.Object} quote
   * @param {Parse.Object} currentUser
   * @param {string[]} recipientEmails
   * @returns {Promise<Array<{email: string, success: boolean, error?: string}>>}
   * @example
   */
  async sendQuoteEmailToMultiple(quote, currentUser, recipientEmails) {
    // eslint-disable-next-line global-require
    const emailService = require('./EmailService');

    if (!emailService.isAvailable()) {
      logger.info('Email service not available, skipping multi-recipient email', {
        quoteId: quote.id,
      });
      return recipientEmails.map((email) => ({
        email: emailService.maskEmail(email),
        success: false,
        error: 'Servicio de correo no disponible',
      }));
    }

    // Generate PDF once
    let pdfBuffer = null;
    let pdfFilename = null;
    try {
      const receiptResult = await this.generateReceipt(currentUser, quote.id, currentUser.get('role'));
      if (receiptResult?.success && receiptResult.data?.pdfBuffer) {
        ({ pdfBuffer } = receiptResult.data);
        pdfFilename = receiptResult.data.filename;
      }
    } catch (pdfErr) {
      logger.warn('Failed to generate PDF for multi-recipient email', {
        quoteId: quote.id,
        error: pdfErr.message,
      });
    }

    // Build share URL
    const baseUrl = process.env.APP_BASE_URL
      || process.env.EMAIL_BASE_URL
      || `http://localhost:${process.env.PORT || 1337}`;
    const shareUrl = `${baseUrl}/quotes/${quote.get('folio')}`;

    /**
     * Format a date value to es-MX locale string.
     * @param {Date|string|null} d - Date to format.
     * @returns {string|null} Formatted date string or null.
     * @example
     */
    const formatDate = (d) => {
      if (!d) return null;
      const dateObj = d instanceof Date ? d : new Date(d);
      return dateObj.toLocaleDateString('es-MX', {
        day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
      });
    };

    const serviceItems = quote.get('serviceItems') || {};
    const days = serviceItems.days || [];
    let startDate = null;
    let endDate = null;
    for (const day of days) {
      if (day.date) {
        const d = new Date(`${day.date}T12:00:00`);
        if (!startDate || d < new Date(`${startDate}T12:00:00`)) startDate = day.date;
        if (!endDate || d > new Date(`${endDate}T12:00:00`)) endDate = day.date;
      }
    }

    const recipientName = quote.get('contactPerson')
      || currentUser.get('fullName')
      || `${currentUser.get('firstName') || ''} ${currentUser.get('lastName') || ''}`.trim()
      || currentUser.get('username');

    // Send to all recipients in parallel
    const settled = await Promise.allSettled(
      recipientEmails.map((email) => emailService.sendQuoteConfirmation({
        recipientEmail: email,
        recipientName,
        folio: quote.get('folio'),
        reservationFolio: null,
        eventType: quote.get('eventType') || '',
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
        numberOfPeople: quote.get('numberOfPeople') || 1,
        shareUrl,
        pdfBuffer,
        pdfFilename,
      }))
    );

    const results = settled.map((result, i) => {
      const masked = emailService.maskEmail(recipientEmails[i]);
      if (result.status === 'fulfilled' && result.value?.success) {
        return { email: masked, success: true };
      }
      const error = result.status === 'rejected'
        ? result.reason?.message
        : result.value?.error || 'Error desconocido';
      return { email: masked, success: false, error };
    });

    logger.info('Quote multi-recipient email results', {
      quoteId: quote.id,
      folio: quote.get('folio'),
      totalSent: results.filter((r) => r.success).length,
      totalFailed: results.filter((r) => !r.success).length,
    });

    return results;
  }
}

module.exports = QuoteService;
