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
        // Only admin can revert to quoted status (allow in development for testing)
        if (!['admin', 'superadmin'].includes(role) && process.env.NODE_ENV !== 'development') {
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

      // BEFORE updating status, handle reservation creation to ensure data integrity
      let reservationData = null;

      // If changing to scheduled or hold, ensure reservation exists or create it
      if (newStatus === 'scheduled' || newStatus === 'hold') {
        // Always check for reservation when status is scheduled
        const resQuery = new Parse.Query('Reservation');
        resQuery.equalTo('quotePtr', quote);
        resQuery.equalTo('exists', true);
        const existingReservation = await resQuery.first({ useMasterKey: true });

        if (!existingReservation) {
          logger.info('Creating reservation for transition to scheduled/hold status', {
            quoteId: quote.id,
            quoteFolio: quote.get('folio'),
            previousStatus,
            newStatus,
            reason: `Ensuring reservation exists before ${newStatus} status`,
          });

          try {
            reservationData = await this.createReservationFromQuote(quote, currentUser);

            if (!reservationData) {
              throw new Error('Unable to create reservation. Please verify service items are properly configured.');
            }

            // Update reservation status based on quote status
            if (reservationData.reservation) {
              const { reservation } = reservationData;
              if (newStatus === 'scheduled') {
                reservation.set('status', 'confirmed');
              } else if (newStatus === 'hold') {
                reservation.set('status', 'hold');
              }
              await reservation.save(null, { useMasterKey: true });

              const statusMessage = newStatus === 'scheduled' ? 'confirmed' : 'held';
              logger.info(`Reservation created and ${statusMessage} for ${newStatus} quote`, {
                reservationId: reservation.id,
                quoteId: quote.id,
                quoteFolio: quote.get('folio'),
                reservationStatus: newStatus === 'scheduled' ? 'confirmed' : 'hold',
              });
            }
          } catch (error) {
            logger.error(`Failed to create reservation for ${newStatus} quote`, {
              error: error.message,
              quoteId: quote.id,
              quoteFolio: quote.get('folio'),
              serviceItems: quote.get('serviceItems'),
            });
            throw new Error(`Cannot schedule quote: ${error.message}`);
          }
        } else {
          logger.info('Reservation already exists for scheduled quote', {
            quoteId: quote.id,
            quoteFolio: quote.get('folio'),
            reservationId: existingReservation.id,
          });
        }
      }

      // NOW update status after reservation is confirmed to exist
      quote.set('status', newStatus);
      await quote.save(null, { useMasterKey: true });

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
    // Declare appliedUpdates outside try-catch so it's accessible in catch block
    const appliedUpdates = {};
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
      console.log('📊 updateQuote status check:', {
        quoteId: quote.id,
        currentStatus,
        requestedStatus: updates.status,
        statusInUpdates: 'status' in updates,
        allUpdates: Object.keys(updates),
      });

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
        'contactFirstName',
        'contactLastName',
        'contactEmail',
        'contactPhone',
        'leadGuestFirstName',
        'leadGuestLastName',
        'notes',
        'validUntil',
        'eventType',
        'clientFinalId',
        'clientType',
      ];

      // appliedUpdates is now declared at function scope above
      let personFieldsUpdated = false;

      Object.keys(updates).forEach((key) => {
        if (allowedFields.includes(key)) {
          try {
            // Validate status if being updated
            if (key === 'status' && !this.validStatuses.includes(updates[key])) {
              throw new Error(`Invalid status. Must be one of: ${this.validStatuses.join(', ')}`);
            }

            // Track if any person field is updated
            if (['numberOfAdults', 'numberOfChildren', 'numberOfInfants'].includes(key)) {
              personFieldsUpdated = true;
            }

            // Handle clientFinalId as a string (not a pointer)
            if (key === 'clientFinalId') {
              // Log the value being processed
              logger.debug('Processing clientFinalId', {
                key,
                value: updates[key],
                type: typeof updates[key],
                isUndefined: updates[key] === 'undefined',
              });

              // Only set if value is provided and not undefined
              if (updates[key] && updates[key] !== 'undefined' && updates[key] !== undefined) {
                // Store as string, not pointer
                quote.set(key, updates[key]);
                appliedUpdates[key] = updates[key];
              } else if (updates[key] === null || updates[key] === '') {
                // Clear the field if explicitly set to null or empty string
                quote.unset(key);
                appliedUpdates[key] = null;
              }
            } else if (updates[key] !== undefined) {
              // Skip undefined values for other fields
              // Special handling for status='scheduled' - don't set it yet
              if (key === 'status' && updates[key] === 'scheduled') {
                // Store that we want to change to scheduled, but don't set it on the quote yet
                console.log('🚀 Storing scheduled status in appliedUpdates only');
                appliedUpdates[key] = updates[key];
              } else {
                quote.set(key, updates[key]);
                appliedUpdates[key] = updates[key];
              }
            }
          } catch (fieldError) {
            logger.error('Error processing field in updateQuote', {
              field: key,
              value: updates[key],
              error: fieldError.message,
            });
            throw fieldError;
          }
        }
      });

      // Recalculate numberOfPeople if any individual person field was updated
      if (personFieldsUpdated) {
        const adults = parseInt(quote.get('numberOfAdults') || 0, 10);
        const children = parseInt(quote.get('numberOfChildren') || 0, 10);
        const infants = parseInt(quote.get('numberOfInfants') || 0, 10);
        const calculatedTotal = adults + children + infants;

        quote.set('numberOfPeople', calculatedTotal);
        appliedUpdates.numberOfPeople = calculatedTotal;

        logger.info('QuoteService.updateQuote - Recalculated numberOfPeople', {
          quoteId: quote.id,
          adults,
          children,
          infants,
          total: calculatedTotal,
        });
      }

      // Handle client field updates - DUAL FIELD ARCHITECTURE
      const clientIdNormalized = updates.client || updates.clientId;
      const { clientType } = updates; // Get the clientType from updates

      // Check if this is a direct client update
      const isDirectClient = clientType === 'direct'
                            || (quote.get('clientType') === 'direct');

      // Log client update for debugging
      logger.info('QuoteService.updateQuote - Client update requested', {
        quoteId: quote.id,
        clientIdNormalized,
        clientIdType: typeof clientIdNormalized,
        clientType,
        isDirectClient,
      });

      if (clientIdNormalized) {
        if (isDirectClient) {
          // Handle Direct Client (Client table)
          try {
            console.log('=== DIRECT CLIENT UPDATE ===');
            console.log('Updating quote with Direct Client ID:', clientIdNormalized);

            // Verify the Client exists
            const clientQuery = new Parse.Query('Client');
            const clientObj = await clientQuery.get(clientIdNormalized, { useMasterKey: true });

            console.log('✅ Direct Client found:', {
              id: clientObj.id,
              name: clientObj.get('name'),
              firstName: clientObj.get('firstName'),
              lastName: clientObj.get('lastName'),
              email: clientObj.get('email'),
            });

            // Set companyClientPtr to the Client object
            const clientPointer = {
              __type: 'Pointer',
              className: 'Client',
              objectId: clientIdNormalized,
            };
            quote.set('companyClientPtr', clientPointer);
            quote.set('client', null); // Clear AmexingUser field for direct clients
            quote.set('clientType', 'direct'); // Ensure clientType is set

            appliedUpdates.companyClientPtr = clientIdNormalized;
            appliedUpdates.client = null;
            appliedUpdates.clientType = 'direct';

            console.log('✅ DIRECT CLIENT UPDATE SUCCESSFUL:', {
              quoteId: quote.id,
              clientId: clientIdNormalized,
              clientName: clientObj.get('name') || `${clientObj.get('firstName')} ${clientObj.get('lastName')}`,
              pointer: clientPointer,
            });

            logger.info('QuoteService.updateQuote - Quote updated with Direct Client', {
              quoteId: quote.id,
              clientId: clientIdNormalized,
              clientType: 'direct',
            });
          } catch (clientError) {
            logger.error('QuoteService.updateQuote - Direct Client not found', {
              quoteId: quote.id,
              clientId: clientIdNormalized,
              error: clientError.message,
            });
            throw new Error(`Client not found: ${clientIdNormalized}`);
          }
        } else {
          // Handle Agency Client (AmexingUser table)
          try {
            console.log('=== AMEXING USER CLIENT UPDATE ===');
            console.log('Updating quote with AmexingUser ID:', clientIdNormalized);

            // Verify the AmexingUser exists
            const userQuery = new Parse.Query('AmexingUser');
            let amexingUser;

            try {
              amexingUser = await userQuery.get(clientIdNormalized, { useMasterKey: true });
              console.log('✅ AmexingUser found:', {
                id: amexingUser.id,
                firstName: amexingUser.get('firstName'),
                lastName: amexingUser.get('lastName'),
                email: amexingUser.get('email'),
              });
            } catch (userError) {
              logger.error('QuoteService.updateQuote - AmexingUser not found', {
                quoteId: quote.id,
                amexingUserId: clientIdNormalized,
                error: userError.message,
              });
              throw new Error(`AmexingUser not found: ${clientIdNormalized}`);
            }

            // Set client field to point to the AmexingUser
            const amexingUserPointer = {
              __type: 'Pointer',
              className: 'AmexingUser',
              objectId: clientIdNormalized,
            };
            quote.set('client', amexingUserPointer);
            appliedUpdates.client = clientIdNormalized;

            // Note: Avoiding companyClientPtr due to schema constraints (expects Client class)
            console.log('Skipping companyClientPtr due to schema mismatch - using client field only');

            console.log('✅ CLIENT UPDATE SUCCESSFUL:', {
              quoteId: quote.id,
              amexingUserId: clientIdNormalized,
              amexingUserName: `${amexingUser.get('firstName')} ${amexingUser.get('lastName')}`,
              pointer: amexingUserPointer,
            });

            logger.info('QuoteService.updateQuote - Client updated with AmexingUser', {
              quoteId: quote.id,
              amexingUserId: clientIdNormalized,
              amexingUserEmail: amexingUser.get('email'),
            });
          } catch (error) {
            logger.error('QuoteService.updateQuote - Error setting AmexingUser client', {
              error: error.message,
              quoteId: quote.id,
              amexingUserId: clientIdNormalized,
            });
            throw error; // Don't continue if client update fails
          }
        }
      }

      // If status changed to scheduled (AGENDADO), ensure reservation exists BEFORE saving
      let reservationData = null;

      console.log('🔍 Pre-scheduled check:', {
        quoteId: quote.id,
        currentStatus,
        appliedUpdatesStatus: appliedUpdates.status,
        allAppliedUpdates: Object.keys(appliedUpdates),
        isChangingToScheduled: appliedUpdates.status === 'scheduled',
        isAlreadyScheduled: currentStatus === 'scheduled',
        willCheckReservation: appliedUpdates.status === 'scheduled' || currentStatus === 'scheduled',
      });

      // Check if we need to create a reservation (either changing to scheduled OR already scheduled)
      if (appliedUpdates.status === 'scheduled' || currentStatus === 'scheduled') {
        console.log('🎯 SCHEDULED STATUS LOGIC TRIGGERED', {
          quoteId: quote.id,
          quoteFolio: quote.get('folio'),
          currentStatus,
          newStatus: 'scheduled',
          serviceItems: quote.get('serviceItems'),
        });

        // Check if reservation already exists
        const resQuery = new Parse.Query('Reservation');
        resQuery.equalTo('quotePtr', quote);
        resQuery.equalTo('exists', true);
        const existingReservation = await resQuery.first({ useMasterKey: true });

        if (!existingReservation) {
          logger.info('Creating reservation for quote with scheduled status via updateQuote', {
            quoteId: quote.id,
            quoteFolio: quote.get('folio'),
            previousStatus: currentStatus,
            newStatus: 'scheduled',
            isRepair: currentStatus === 'scheduled',
          });

          try {
            reservationData = await this.createReservationFromQuote(quote, currentUser);

            console.log('📦 createReservationFromQuote result:', {
              quoteId: quote.id,
              reservationData,
              hasReservation: !!reservationData,
              reservationId: reservationData?.reservation?.id,
            });

            if (!reservationData) {
              // Don't set the status to scheduled if we can't create the reservation
              console.log('❌ Reservation creation returned null - throwing error');
              delete appliedUpdates.status;
              throw new Error('Cannot schedule quote: Unable to create reservation. Please verify service items are properly configured.');
            }

            // Update reservation status to confirmed
            if (reservationData.reservation) {
              const { reservation } = reservationData;
              reservation.set('status', 'confirmed');
              await reservation.save(null, { useMasterKey: true });

              logger.info('Reservation created and confirmed for scheduled quote', {
                reservationId: reservation.id,
                quoteId: quote.id,
                quoteFolio: quote.get('folio'),
              });
            }

            // Only set status if it's changing (not already scheduled)
            if (appliedUpdates.status === 'scheduled' && currentStatus !== 'scheduled') {
              quote.set('status', 'scheduled');
            }
          } catch (error) {
            // Don't set the status if reservation creation failed
            delete appliedUpdates.status;

            logger.error('Failed to create reservation for scheduled quote in updateQuote', {
              error: error.message,
              quoteId: quote.id,
              quoteFolio: quote.get('folio'),
              serviceItems: quote.get('serviceItems'),
            });
            throw new Error(`Cannot schedule quote: ${error.message}`);
          }
        } else {
          logger.info('Reservation already exists for quote with scheduled status', {
            quoteId: quote.id,
            quoteFolio: quote.get('folio'),
            reservationId: existingReservation.id,
          });
          // Only set status if it's changing (not already scheduled)
          if (appliedUpdates.status === 'scheduled' && currentStatus !== 'scheduled') {
            quote.set('status', 'scheduled');
          }
        }

        // Send schedule confirmation email only if status actually changed
        if (currentStatus !== 'scheduled') {
          this.sendScheduleConfirmationEmail(quote, currentUser)
            .catch((err) => logger.warn('Failed to send schedule confirmation email', {
              error: err.message,
              quoteId: quote.id,
            }));
        }
      }

      await quote.save(null, { useMasterKey: true });

      console.log('🔍 DEBUGGING: Checking reservation creation conditions', {
        quoteId: quote.id,
        appliedStatus: appliedUpdates.status,
        currentStatus,
        hasReservationData: !!reservationData,
      });

      // Removed automatic reservation creation for 'requested' status
      // Quotes now remain as quotes when status changes to 'requested' (SOLICITADO)

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

      console.log('✅ updateQuote returning result:', {
        quoteId: quote.id,
        status: quote.get('status'),
        appliedStatus: appliedUpdates.status,
        success: result.success,
        hasReservation: !!reservationData,
      });

      return result;
    } catch (error) {
      console.log('❌ updateQuote ERROR:', {
        quoteId,
        errorMessage: error.message,
        updates,
        appliedUpdates,
      });

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
   * Verify and fix scheduled quotes that are missing reservations.
   *
   * This method checks if a scheduled quote has a reservation and creates one if missing.
   * Used to repair data integrity issues where quotes were scheduled without reservations.
   * @param {object} quote - The quote object to verify.
   * @param {object} currentUser - User performing the verification.
   * @returns {Promise<object|null>} Reservation data if created/found, null if not scheduled.
   * @example
   */
  async verifyScheduledQuoteReservation(quote, currentUser) {
    try {
      // Only process scheduled quotes
      if (quote.get('status') !== 'scheduled') {
        return null;
      }

      const quoteFolio = quote.get('folio');

      // Check for existing reservation
      const resQuery = new Parse.Query('Reservation');
      resQuery.equalTo('quotePtr', quote);
      resQuery.equalTo('exists', true);
      const existingReservation = await resQuery.first({ useMasterKey: true });

      if (existingReservation) {
        logger.info('Scheduled quote already has reservation', {
          quoteId: quote.id,
          quoteFolio,
          reservationId: existingReservation.id,
        });
        return { reservation: existingReservation, created: false };
      }

      // No reservation found - attempt to create one
      logger.warn('Scheduled quote missing reservation, attempting to create', {
        quoteId: quote.id,
        quoteFolio,
        serviceItems: quote.get('serviceItems'),
      });

      try {
        const reservationData = await this.createReservationFromQuote(quote, currentUser);

        if (!reservationData) {
          logger.error('Failed to create reservation for scheduled quote - createReservationFromQuote returned null', {
            quoteId: quote.id,
            quoteFolio,
            reason: 'Likely missing or invalid service items',
          });
          return null;
        }

        // Update reservation status to confirmed since quote is scheduled
        if (reservationData.reservation) {
          const { reservation } = reservationData;
          reservation.set('status', 'confirmed');
          await reservation.save(null, { useMasterKey: true });

          logger.info('Successfully created and confirmed missing reservation for scheduled quote', {
            reservationId: reservation.id,
            quoteId: quote.id,
            quoteFolio,
          });

          return { ...reservationData, created: true };
        }

        return reservationData;
      } catch (createError) {
        logger.error('Error creating reservation for scheduled quote', {
          error: createError.message,
          quoteId: quote.id,
          quoteFolio,
          stack: createError.stack,
        });
        throw new Error(`Failed to create reservation: ${createError.message}`);
      }
    } catch (error) {
      logger.error('Error in verifyScheduledQuoteReservation', {
        error: error.message,
        quoteId: quote?.id,
        stack: error.stack,
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

      // Check if reservation exists for this quote
      const resQuery = new Parse.Query('Reservation');
      resQuery.equalTo('quotePtr', quote);
      resQuery.equalTo('exists', true);
      let reservation = await resQuery.first({ useMasterKey: true });

      if (!reservation) {
        // Try to create reservation if missing
        logger.warn('Receipt generation attempted but no reservation found, attempting to create', {
          quoteId: quote.id,
          quoteFolio: quote.get('folio'),
          currentStatus,
        });

        try {
          const reservationData = await this.createReservationFromQuote(quote, currentUser);
          if (reservationData && reservationData.reservation) {
            const { reservation: createdReservation } = reservationData;
            reservation = createdReservation;
            // Update reservation status to confirmed since quote is scheduled
            reservation.set('status', 'confirmed');
            await reservation.save(null, { useMasterKey: true });

            logger.info('Successfully created missing reservation for receipt generation', {
              reservationId: reservation.id,
              quoteId: quote.id,
              quoteFolio: quote.get('folio'),
            });
          } else {
            throw new Error('Failed to create required reservation');
          }
        } catch (createError) {
          logger.error('Failed to create reservation for receipt generation', {
            error: createError.message,
            quoteId: quote.id,
            quoteFolio: quote.get('folio'),
          });
          throw new Error(`Cannot generate receipt: ${createError.message}`);
        }
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
      console.log('🔧 DEBUGGING: createReservationFromQuote called', {
        quoteId: quote.id,
        quoteFolio: quote.get('folio'),
        userRole: currentUser.get('role'),
        serviceItemsExists: !!quote.get('serviceItems'),
        timestamp: new Date().toISOString(),
      });

      logger.info('🔍 Starting reservation creation process', {
        quoteId: quote.id,
        quoteFolio: quote.get('folio'),
        currentUserId: currentUser?.id,
        timestamp: new Date().toISOString(),
      });

      // Validate quote object
      if (!quote || !quote.id) {
        logger.error('❌ Invalid quote object provided for reservation creation', {
          quote,
          hasQuote: !!quote,
          hasQuoteId: !!(quote?.id),
        });
        throw new Error('Invalid quote object provided');
      }

      // Validate and log service items
      const serviceItems = quote.get('serviceItems') || {};
      const days = serviceItems.days || [];

      logger.info('📊 Service items validation', {
        quoteId: quote.id,
        hasServiceItems: !!serviceItems,
        serviceItemsKeys: Object.keys(serviceItems),
        serviceItemsTotal: serviceItems.total,
        hasDays: !!days,
        daysCount: days.length,
        daysStructure: days.map((day) => ({
          dayNumber: day.dayNumber,
          concept: day.concept,
          date: day.date,
          subconceptsCount: (day.subconcepts || []).length,
          subconcepts: (day.subconcepts || []).map((sub) => ({
            type: sub.type,
            concept: sub.concept,
            price: sub.unitPrice || sub.price,
            total: sub.total,
          })),
        })),
        rawServiceItems: JSON.stringify(serviceItems, null, 2),
      });

      // Critical validation: Check if we have service data to create reservation from
      if (!serviceItems || Object.keys(serviceItems).length === 0) {
        logger.warn('⚠️ No service items found in quote - cannot create reservation', {
          quoteId: quote.id,
          quoteFolio: quote.get('folio'),
        });
        return null;
      }

      if (!days || days.length === 0) {
        logger.warn('⚠️ No service days found in quote - cannot create reservation', {
          quoteId: quote.id,
          quoteFolio: quote.get('folio'),
          serviceItems,
        });
        return null;
      }

      // Validate that days have subconcepts
      const totalSubconcepts = days.reduce((total, day) => total + (day.subconcepts || []).length, 0);
      if (totalSubconcepts === 0) {
        logger.warn('⚠️ No subconcepts found in any day - cannot create reservation services', {
          quoteId: quote.id,
          quoteFolio: quote.get('folio'),
          daysCount: days.length,
          days,
        });
        return null;
      }

      logger.info('✅ Service validation passed', {
        quoteId: quote.id,
        totalDays: days.length,
        totalSubconcepts,
        totalAmount: serviceItems.total,
      });

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

          logger.info('♻️ Reactivated cancelled reservation for quote', {
            quoteId: quote.id,
            reservationId: existing.id,
            servicesReactivated: services.length,
          });
          return { id: existing.id, folio: existing.get('folio'), servicesCount: services.length };
        }

        logger.info('🔄 Reservation already exists for quote, skipping creation', {
          quoteId: quote.id,
          reservationId: existing.id,
        });
        return { id: existing.id, folio: existing.get('folio') };
      }

      // Generate new folio format: [SERVICE_MONTH_PREFIX]-[YEAR_2DIGITS][CREATION_MONTH]-[CONSECUTIVE_3DIGITS]
      // Example: MAY-2605-001 = Service in May 2026, created in May, first quote for May
      logger.info('🏷️ Generating reservation folio', { quoteId: quote.id });
      const folio = await this.generateReservationFolio(quote);
      logger.info('✅ Folio generated successfully', { quoteId: quote.id, folio });

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
      // Lead guest names — propagated so the booking dashboard can surface the actual
      // traveler separately from the contact person.
      reservation.set('leadGuestFirstName', quote.get('leadGuestFirstName') || '');
      reservation.set('leadGuestLastName', quote.get('leadGuestLastName') || '');
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

      logger.info('💾 Saving reservation to database', {
        quoteId: quote.id,
        folio,
        totalAmount: serviceItems.total,
        currency: serviceItems.currency,
        hasClient: !!client,
        hasCurrentUser: !!currentUser,
      });

      try {
        await reservation.save(null, { useMasterKey: true });
        logger.info('✅ Reservation saved successfully', {
          quoteId: quote.id,
          reservationId: reservation.id,
          folio,
        });
      } catch (saveError) {
        logger.error('❌ Failed to save reservation', {
          quoteId: quote.id,
          folio,
          error: saveError.message,
          stack: saveError.stack,
          reservationData: {
            totalAmount: serviceItems.total,
            currency: serviceItems.currency,
            numberOfPeople: quote.get('numberOfPeople'),
            hasClient: !!client,
            hasCurrentUser: !!currentUser,
          },
        });
        throw saveError;
      }

      // Create ReservationService for each subconcept in each day
      const servicesToSave = [];
      logger.info('🔧 Creating reservation services', {
        quoteId: quote.id,
        reservationId: reservation.id,
        totalDays: days.length,
      });

      for (const day of days) {
        const subconcepts = day.subconcepts || [];
        logger.info(`📅 Processing day ${day.dayNumber}`, {
          quoteId: quote.id,
          dayNumber: day.dayNumber,
          concept: day.concept,
          date: day.date,
          subconceptsCount: subconcepts.length,
        });

        for (const sub of subconcepts) {
          console.log('🔧 DEBUGGING: Processing subconcept for ReservationService', {
            quoteId: quote.id,
            dayNumber: day.dayNumber,
            subType: sub.type,
            subConcept: sub.concept,
            hasAdditionalVehicle: sub.hasAdditionalVehicle,
            additionalVehicleId: sub.additionalVehicleId,
            additionalVehicleTypeName: sub.additionalVehicleTypeName,
          });

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

          // 🎯 ASSIGNMENT LOGIC: Set assignment requirements based on service type and subconcept data
          const serviceType = sub.type || 'concepto';
          const includeGuide = sub.includeGuide || false;
          const includeGreeter = sub.includeGreeter || false;
          const hasAdditionalVehicle = sub.hasAdditionalVehicle || false;
          const vehicleQuantity = parseInt(sub.quantity) || 1;

          logger.debug('🔧 Processing service assignment requirements', {
            quoteId: quote.id,
            dayNumber: day.dayNumber,
            serviceType,
            concept: sub.concept || sub.name,
            includeGuide,
            includeGreeter,
            hasAdditionalVehicle,
            vehicleQuantity,
            subconceptFields: Object.keys(sub),
          });

          // Service assignment logic based on type and requirements
          if (serviceType === 'transport') {
            // Transport services: Driver always needed, Guide/Greeter optional
            // Assignment requirements come from subconcept fields (includeGuide, includeGreeter, quantity)

            // Set service customer assignment if applicable
            if (sub.assignedServiceCustomer) {
              resSvc.set('assignedServiceCustomer', sub.assignedServiceCustomer);
            }

            // Track additional vehicle requirement - update quantity for assignment slots
            const extrasTransport = Array.isArray(sub.extraAdditionalVehicles) ? sub.extraAdditionalVehicles : [];
            if (hasAdditionalVehicle || extrasTransport.length > 0) {
              // Quantity reflects total vehicles the booking dashboard must assign:
              // 1 main + 1 primary additional (when checkbox is on) + N extras.
              const primaryCount = hasAdditionalVehicle ? 1 : 0;
              sub.quantity = 1 + primaryCount + extrasTransport.length;
              logger.debug('🚗 Transport service vehicle slots', {
                primaryCount,
                extrasCount: extrasTransport.length,
                finalQuantity: sub.quantity,
              });

              // Store primary additional vehicle type information for assignment
              if (sub.additionalVehicleId) {
                resSvc.set('additionalVehicleId', sub.additionalVehicleId);
                logger.debug('📋 Stored additional vehicle ID:', sub.additionalVehicleId);
              }
              if (sub.additionalVehicleTypeName) {
                resSvc.set('additionalVehicleTypeName', sub.additionalVehicleTypeName);
                logger.debug('📋 Stored additional vehicle type name:', sub.additionalVehicleTypeName);
              }
              if (sub.additionalVehicleSegment) {
                resSvc.set('additionalVehicleSegment', sub.additionalVehicleSegment);
                logger.debug('📋 Stored additional vehicle segment:', sub.additionalVehicleSegment);
              }
              if (sub.additionalVehicleSegmentName) {
                resSvc.set('additionalVehicleSegmentName', sub.additionalVehicleSegmentName);
                logger.debug('📋 Stored additional vehicle segment name:', sub.additionalVehicleSegmentName);
              }

              // Seed extraAssignments — one empty slot per extra vehicle so the booking
              // dashboard can render assign UI per row. Driver/vehicle pointers stay null
              // until an operator assigns them.
              if (extrasTransport.length > 0) {
                resSvc.set('extraAssignments', extrasTransport.map((v) => ({
                  vehicleTypeId: v.vehicleId || '',
                  vehicleName: v.vehicleTypeName || '',
                  segmentId: v.segment || '',
                  segmentName: v.segmentName || '',
                  segmentColor: v.segmentColor || '',
                  driverId: null,
                  driverName: '',
                  vehicleId: null,
                  vehicleImageUrl: '',
                })));
                logger.debug('📋 Stored extraAssignments for transport', { count: extrasTransport.length });
              }
            }

            // Map suggested departure times for transport services
            if (sub.flightDepartureTimeSuggested) {
              resSvc.set('flightDepartureTimeSuggested', sub.flightDepartureTimeSuggested);
              logger.debug('📋 Stored flight departure time suggested:', sub.flightDepartureTimeSuggested);
            }
            if (sub.roundTripDepartureTimeSuggestedIda) {
              resSvc.set('roundTripDepartureTimeSuggestedIda', sub.roundTripDepartureTimeSuggestedIda);
              logger.debug('📋 Stored round-trip departure time suggested (ida):', sub.roundTripDepartureTimeSuggestedIda);
            }
            if (sub.roundTripDepartureTimeSuggestedVuelta) {
              resSvc.set('roundTripDepartureTimeSuggestedVuelta', sub.roundTripDepartureTimeSuggestedVuelta);
              logger.debug('📋 Stored round-trip departure time suggested (vuelta):', sub.roundTripDepartureTimeSuggestedVuelta);
            }

            logger.debug('🚛 Transport service assignment setup:', {
              includeGuide,
              includeGreeter,
              hasAdditionalVehicle,
              finalQuantity: sub.quantity,
            });
          } else if (serviceType === 'tour') {
            // Tour services: Guide optional, can have additional vehicles
            // Assignment requirements come from subconcept fields (includeGuide, includeGreeter, quantity)

            // Set service customer assignment if applicable
            if (sub.assignedServiceCustomer) {
              resSvc.set('assignedServiceCustomer', sub.assignedServiceCustomer);
            }

            // Tours may need vehicles if they include transport
            if (sub.requiresTransport || sub.vehicleType || sub.vehicleTypeName) {
              // This tour includes transport, needs driver assignment
              logger.debug('🚗 Tour service includes transport, needs driver assignment');

              // Track additional vehicle requirement for tours
              const extrasTour = Array.isArray(sub.extraAdditionalVehicles) ? sub.extraAdditionalVehicles : [];
              if (hasAdditionalVehicle || extrasTour.length > 0) {
                // Quantity reflects total vehicles to assign: 1 main + 1 primary additional + N extras.
                const primaryCount = hasAdditionalVehicle ? 1 : 0;
                sub.quantity = 1 + primaryCount + extrasTour.length;
                logger.debug('🚗 Tour service vehicle slots', {
                  primaryCount,
                  extrasCount: extrasTour.length,
                  finalQuantity: sub.quantity,
                });

                // Store primary additional vehicle type information for assignment
                if (sub.additionalVehicleId) {
                  resSvc.set('additionalVehicleId', sub.additionalVehicleId);
                  logger.debug('📋 Stored additional vehicle ID for tour:', sub.additionalVehicleId);
                }
                if (sub.additionalVehicleTypeName) {
                  resSvc.set('additionalVehicleTypeName', sub.additionalVehicleTypeName);
                  logger.debug('📋 Stored additional vehicle type name for tour:', sub.additionalVehicleTypeName);
                }
                if (sub.additionalVehicleSegment) {
                  resSvc.set('additionalVehicleSegment', sub.additionalVehicleSegment);
                  logger.debug('📋 Stored additional vehicle segment for tour:', sub.additionalVehicleSegment);
                }
                if (sub.additionalVehicleSegmentName) {
                  resSvc.set('additionalVehicleSegmentName', sub.additionalVehicleSegmentName);
                  logger.debug('📋 Stored additional vehicle segment name for tour:', sub.additionalVehicleSegmentName);
                }

                // Seed extraAssignments for tour — one slot per extra vehicle, awaiting
                // driver/vehicle assignment by an operator.
                if (extrasTour.length > 0) {
                  resSvc.set('extraAssignments', extrasTour.map((v) => ({
                    vehicleTypeId: v.vehicleId || '',
                    vehicleName: v.vehicleTypeName || '',
                    segmentId: v.segment || '',
                    segmentName: v.segmentName || '',
                    segmentColor: v.segmentColor || '',
                    driverId: null,
                    driverName: '',
                    vehicleId: null,
                    vehicleImageUrl: '',
                  })));
                  logger.debug('📋 Stored extraAssignments for tour', { count: extrasTour.length });
                }
              }
            }

            logger.debug('🎭 Tour service assignment setup:', {
              includeGuide,
              includeGreeter,
              hasAdditionalVehicle,
              requiresTransport: sub.requiresTransport || !!(sub.vehicleType || sub.vehicleTypeName),
              finalQuantity: sub.quantity,
            });
          } else if (serviceType === 'a-disposicion') {
            // A-disposición services: Driver always needed, Guide optional
            // Assignment requirements come from subconcept fields (includeGuide, quantity)

            logger.debug('🕐 A-disposición service assignment setup:', {
              includeGuide,
              quantity: sub.quantity,
            });
          } else if (serviceType === 'experience') {
            // Experience services: May need service customer assignment
            if (sub.assignedServiceCustomer) {
              resSvc.set('assignedServiceCustomer', sub.assignedServiceCustomer);
            }
          } else if (serviceType === 'concepto') {
            // Concepto services: Generally no assignments needed
            // May have service customer for specific conceptos
            if (sub.assignedServiceCustomer) {
              resSvc.set('assignedServiceCustomer', sub.assignedServiceCustomer);
            }
          }

          if (day.date) {
            try {
              resSvc.set('serviceDate', new Date(`${day.date}T12:00:00`));
            } catch (dateError) {
              logger.warn('⚠️ Invalid date format for service', {
                quoteId: quote.id,
                dayNumber: day.dayNumber,
                originalDate: day.date,
                error: dateError.message,
              });
            }
          }

          servicesToSave.push(resSvc);
        }
      }

      if (servicesToSave.length > 0) {
        logger.info('💾 Saving reservation services', {
          quoteId: quote.id,
          reservationId: reservation.id,
          servicesCount: servicesToSave.length,
        });

        try {
          await Parse.Object.saveAll(servicesToSave, { useMasterKey: true });
          logger.info('✅ All reservation services saved successfully', {
            quoteId: quote.id,
            reservationId: reservation.id,
            servicesCount: servicesToSave.length,
          });
        } catch (servicesError) {
          logger.error('❌ Failed to save reservation services', {
            quoteId: quote.id,
            reservationId: reservation.id,
            servicesCount: servicesToSave.length,
            error: servicesError.message,
            stack: servicesError.stack,
            firstServiceData: servicesToSave.length > 0 ? {
              dayNumber: servicesToSave[0].get('dayNumber'),
              concept: servicesToSave[0].get('concept'),
              type: servicesToSave[0].get('type'),
              price: servicesToSave[0].get('price'),
            } : null,
          });
          throw servicesError;
        }
      } else {
        logger.warn('⚠️ No services to save - this should not happen after validation', {
          quoteId: quote.id,
          reservationId: reservation.id,
        });
      }

      logger.info('🎉 Reservation created from quote successfully', {
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

  /**
   * Send confirmation email when quote status changes to 'requested'.
   * @param {object} quote - Parse Quote object.
   * @param {object} currentUser - Parse AmexingUser performing the action.
   * @param {object} reservationData - Created reservation data (optional).
   * @returns {Promise<void>}
   * @example
   */
  async sendRequestedConfirmationEmail(quote, currentUser, reservationData) {
    logger.info('📧 STARTING: sendRequestedConfirmationEmail', {
      quoteId: quote.id,
      quoteFolio: quote.get('folio'),
      hasReservationData: !!reservationData,
      reservationId: reservationData?.id,
      reservationFolio: reservationData?.folio,
      userId: currentUser.id,
      userEmail: currentUser.get('email'),
      timestamp: new Date().toISOString(),
    });

    // eslint-disable-next-line global-require
    const emailService = require('./EmailService');

    logger.info('📧 Email service availability check', {
      isAvailable: emailService.isAvailable(),
      quoteId: quote.id,
      timestamp: new Date().toISOString(),
    });

    if (!emailService.isAvailable()) {
      logger.warn('📧 Email service not available, skipping requested confirmation email', {
        quoteId: quote.id,
        emailServiceInitialized: emailService.isInitialized,
        mailersendClient: !!emailService.mailerSend,
        nodeEnv: process.env.NODE_ENV,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const recipientEmail = quote.get('contactEmail')
      || currentUser.get('email');

    logger.info('📧 Recipient email resolution', {
      quoteId: quote.id,
      contactEmail: quote.get('contactEmail'),
      userEmail: currentUser.get('email'),
      resolvedEmail: recipientEmail,
      timestamp: new Date().toISOString(),
    });

    if (!recipientEmail) {
      logger.warn('📧 No recipient email for requested confirmation', {
        quoteId: quote.id,
        contactEmailFromQuote: quote.get('contactEmail'),
        emailFromUser: currentUser.get('email'),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const recipientName = quote.get('contactPerson')
      || currentUser.get('fullName')
      || `${currentUser.get('firstName') || ''} ${currentUser.get('lastName') || ''}`.trim()
      || currentUser.get('username');

    // Build data for email template
    const emailData = {
      recipientName: recipientName || 'Cliente',
      quoteFolio: quote.get('folio'),
      quoteId: quote.id,
      reservationFolio: reservationData?.folio || null,
      status: 'requested',
      contactEmail: recipientEmail,
      eventType: quote.get('eventType') || 'Servicio',
      validUntil: quote.get('validUntil'),
      // Include reservation details if available
      reservationId: reservationData?.id,
      reservationData,
    };

    // Try to send the email using available method
    const result = await emailService.sendQuoteConfirmation(recipientEmail, emailData);

    if (result.success) {
      logger.info('✅ Requested confirmation email sent successfully', {
        quoteId: quote.id,
        quoteFolio: quote.get('folio'),
        reservationFolio: reservationData?.folio,
        recipientEmail,
        recipientName,
      });
    } else {
      logger.error('Failed to send requested confirmation email', {
        quoteId: quote.id,
        quoteFolio: quote.get('folio'),
        recipientEmail,
        error: result.error,
      });
    }
  }

  /**
   * Send schedule confirmation email when quote status changes to 'scheduled'.
   * @param {object} quote - Parse Quote object.
   * @param {object} currentUser - Parse AmexingUser performing the action.
   * @returns {Promise<void>}
   * @example
   */
  async sendScheduleConfirmationEmail(quote, currentUser) {
    // eslint-disable-next-line global-require
    const emailService = require('./EmailService');

    if (!emailService.isAvailable()) {
      logger.info('Email service not available, skipping schedule confirmation email', {
        quoteId: quote.id,
      });
      return;
    }

    const recipientEmail = quote.get('contactEmail')
      || currentUser.get('email');
    if (!recipientEmail) {
      logger.warn('No recipient email for schedule confirmation', { quoteId: quote.id });
      return;
    }

    const recipientName = quote.get('contactPerson')
      || currentUser.get('fullName')
      || `${currentUser.get('firstName') || ''} ${currentUser.get('lastName') || ''}`.trim()
      || currentUser.get('username');

    // Build data for email template
    const emailData = {
      recipientName: recipientName || 'Cliente',
      quoteFolio: quote.get('folio') || quote.id,
      eventType: quote.get('eventType') || 'Evento',
      numberOfPeople: quote.get('numberOfPeople') || 1,
      contactEmail: recipientEmail,
      supportEmail: process.env.SUPPORT_EMAIL || 'soporte@amexing.mx',
      companyName: 'Amexing',
    };

    const result = await emailService.sendScheduleConfirmation(
      recipientEmail,
      recipientName || 'Cliente',
      emailData
    );

    if (result.success) {
      logger.info('Schedule confirmation email sent successfully', {
        quoteId: quote.id,
        quoteFolio: quote.get('folio'),
        recipientEmail,
        recipientName,
      });
    } else {
      logger.error('Failed to send schedule confirmation email', {
        quoteId: quote.id,
        quoteFolio: quote.get('folio'),
        recipientEmail,
        error: result.error,
      });
    }
  }

  /**
   * Get Spanish 3-letter month abbreviation from date.
   * @param {Date} date - Date object.
   * @returns {string} 3-letter Spanish month abbreviation.
   * @private
   * @example
   * const prefix = this.getSpanishMonthPrefix(new Date('2026-04-10'));
   * console.log(prefix); // 'ABR'
   */
  getSpanishMonthPrefix(date) {
    const monthNames = [
      'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN',
      'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC',
    ];
    return monthNames[date.getMonth()];
  }

  /**
   * Get English 3-letter month abbreviation from date.
   * @param {Date} date - Date object.
   * @returns {string} 3-letter English month abbreviation.
   * @private
   * @example
   * const prefix = this.getEnglishMonthPrefix(new Date('2026-05-10'));
   * console.log(prefix); // 'MAY'
   */
  getEnglishMonthPrefix(date) {
    const monthNames = [
      'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
      'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
    ];
    return monthNames[date.getMonth()];
  }

  /**
   * Generate reservation folio based on service date.
   * Format: [SERVICE_MONTH_PREFIX]-[YEAR_2DIGITS][CREATION_MONTH]-[CONSECUTIVE_3DIGITS].
   * Example: MAY-2605-001 = Service in May 2026, created in May, first quote for May.
   * @param {Parse.Object} quote - Quote object with serviceItems.
   * @returns {Promise<string>} Generated folio.
   * @private
   * @example
   * const folio = await this.generateReservationFolio(quote);
   * console.log(folio); // 'MAY-2605-001'
   */
  async generateReservationFolio(quote) {
    try {
      const serviceItems = quote.get('serviceItems') || {};
      const days = serviceItems.days || [];

      // Find the earliest service date (first day of service)
      let earliestServiceDate = null;
      const serviceDays = days.filter((day) => day.date);
      for (const day of serviceDays) {
        const d = new Date(`${day.date}T12:00:00`);
        if (!earliestServiceDate || d < earliestServiceDate) {
          earliestServiceDate = d;
        }
      }

      // Fallback to current date if no service date found
      if (!earliestServiceDate) {
        earliestServiceDate = new Date();
        logger.warn('No service date found in quote, using current date for folio generation', {
          quoteId: quote.id,
        });
      }

      const serviceYear = earliestServiceDate.getFullYear();
      const serviceYear2Digits = String(serviceYear).slice(-2); // Get last 2 digits of year
      const serviceMonthPrefix = this.getEnglishMonthPrefix(earliestServiceDate); // Use English month
      // Use the SERVICE (travel) month, not the creation month, so the folio's
      // numeric block reflects when the trip happens (e.g. August trip → 2608).
      const serviceMonth = String(earliestServiceDate.getMonth() + 1).padStart(2, '0');

      // Get consecutive number for this service month/year combination
      // New format uses hyphens: AUG-2608-XXX
      const prefix = `${serviceMonthPrefix}-${serviceYear2Digits}${serviceMonth}`;
      const countQuery = new Parse.Query('Reservation');
      countQuery.startsWith('folio', prefix);
      countQuery.equalTo('exists', true);
      countQuery.descending('folio');
      countQuery.limit(1);
      countQuery.select('folio');

      const lastReservation = await countQuery.first({ useMasterKey: true });

      let nextNumber = 1;
      if (lastReservation) {
        const lastFolio = lastReservation.get('folio');
        // Extract the last 3 digits after the last hyphen (consecutive number)
        const parts = lastFolio.split('-');
        if (parts.length === 3) {
          const lastNumberStr = parts[2];
          const lastNumber = parseInt(lastNumberStr, 10);
          if (!Number.isNaN(lastNumber)) {
            nextNumber = lastNumber + 1;
          }
        }
      }

      const consecutiveStr = String(nextNumber).padStart(3, '0'); // 3 digits instead of 2
      const folio = `${prefix}-${consecutiveStr}`; // Add hyphen before consecutive

      logger.info('Generated reservation folio', {
        quoteId: quote.id,
        serviceDate: earliestServiceDate.toISOString().split('T')[0],
        serviceMonthPrefix,
        serviceYear,
        serviceYear2Digits,
        serviceMonth,
        consecutiveNumber: nextNumber,
        folio,
      });

      return folio;
    } catch (error) {
      logger.error('Error generating reservation folio', {
        quoteId: quote.id,
        error: error.message,
      });
      // Fallback to timestamp-based folio to ensure uniqueness
      const timestamp = Date.now();
      return `ERR${timestamp}`;
    }
  }
}

module.exports = QuoteService;
