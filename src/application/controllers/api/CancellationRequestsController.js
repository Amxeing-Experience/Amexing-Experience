/**
 * CancellationRequestsController - RESTful API for Quote Cancellation Request Management.
 * Handles cancellation requests for quotes with business rules for 24-hour policy.
 *
 * Business Rules:
 * - Cancellation 24+ hours before event: Direct quote cancellation
 * - Cancellation <24 hours before event: Create cancellation request for approval.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE)
 * - SuperAdmin/Admin/employee_amexing access control
 * - Automatic 24-hour rule enforcement
 * - Comprehensive security, validation, and audit logging.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const CancellationRequest = require('../../../domain/models/CancellationRequest');
const Quote = require('../../../domain/models/Quote');
const logger = require('../../../infrastructure/logger');
const { logReadAccess, logBulkReadAccess } = require('../../utils/auditHelper');

/**
 * CancellationRequestsController class implementing RESTful API for cancellation request management.
 */
class CancellationRequestsController {
  constructor() {
    this.maxPageSize = 100;
    this.defaultPageSize = 25;
  }

  /**
   * GET /api/cancellation-requests - Get cancellation requests with filtering and pagination.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getCancellationRequests(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Parse and validate query parameters
      const options = this.parseQueryParams(req.query);

      // Get cancellation requests
      const result = await this.getCancellationRequestsData(currentUser, options);

      // PCI DSS Audit: Log bulk READ access
      if (result.requests && result.requests.length > 0) {
        await logBulkReadAccess(req, result.requests, 'CancellationRequest', options);
      }

      // Add metadata for frontend consumption
      const response = {
        ...result,
        requestMetadata: {
          endpoint: 'getCancellationRequests',
          requestedBy: currentUser.id,
          requestedRole: req.userRole,
          timestamp: new Date(),
          queryParams: options,
        },
      };

      this.sendSuccess(res, response, 'Cancellation requests retrieved successfully');
    } catch (error) {
      logger.error('Error in CancellationRequestsController.getCancellationRequests', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        userRole: req.userRole,
        queryParams: req.query,
      });

      this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to retrieve cancellation requests',
        500
      );
    }
  }

  /**
   * GET /api/cancellation-requests/:id - Get single cancellation request by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getCancellationRequestById(req, res) {
    try {
      const currentUser = req.user;
      const requestId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!requestId) {
        return this.sendError(res, 'Cancellation request ID is required', 400);
      }

      // Get cancellation request
      const request = await this.getCancellationRequestByIdData(requestId);

      if (!request) {
        return this.sendError(res, 'Cancellation request not found', 404);
      }

      // PCI DSS Audit: Log individual READ access
      await logReadAccess(req, request, 'CancellationRequest');

      this.sendSuccess(res, { request }, 'Cancellation request retrieved successfully');
    } catch (error) {
      logger.error('Error in CancellationRequestsController.getCancellationRequestById', {
        error: error.message,
        requestId: req.params.id,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * POST /api/cancellation-requests - Create new cancellation request or cancel quote directly.
   * Implements 24-hour business rule:
   * - If >24h before event: Cancel quote immediately
   * - If <24h before event: Create cancellation request.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async createCancellationRequest(req, res) {
    try {
      const currentUser = req.user;
      const requestData = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Validate request data
      const validationError = this.validateCancellationRequestData(requestData);
      if (validationError) {
        return this.sendError(res, validationError, 400);
      }

      // Get quote to determine event date and validate status
      const quote = await Quote.findByFolio(requestData.quoteFolio);
      if (!quote) {
        return this.sendError(res, 'Quote not found', 404);
      }

      // Check if quote is in approved status
      if (quote.getStatus() !== 'scheduled') {
        return this.sendError(res, 'Only approved quotes can be cancelled', 400);
      }

      // Calculate event date from quote serviceItems
      const eventDate = this.getEventDateFromQuote(quote);
      // If no event date can be determined, cancel immediately without approval
      if (!eventDate) {
        const result = await this.cancelQuoteDirectly(quote, currentUser, requestData.reason);

        logger.info('Quote cancelled directly (no event date found)', {
          quoteId: quote.id,
          quoteFolio: quote.getFolio(),
          cancelledBy: currentUser.id,
          reason: requestData.reason,
          note: 'No event date found in quote service items - cancelled immediately',
        });

        return this.sendSuccess(res, result, 'Quote cancelled successfully (no event date found)', 200);
      }

      // Calculate hours before event
      const hoursBeforeEvent = CancellationRequest.calculateHoursBeforeEvent(eventDate);

      // Apply business rule: 24-hour policy
      if (hoursBeforeEvent >= 24) {
        // Direct cancellation - update quote status
        const result = await this.cancelQuoteDirectly(quote, currentUser, requestData.reason);

        logger.info('Quote cancelled directly (24+ hours before event)', {
          quoteId: quote.id,
          quoteFolio: quote.getFolio(),
          hoursBeforeEvent,
          cancelledBy: currentUser.id,
          reason: requestData.reason,
        });

        return this.sendSuccess(res, result, 'Quote cancelled successfully', 200);
      }
      // Create cancellation request for approval
      const result = await this.createCancellationRequestForApproval(
        quote,
        currentUser,
        requestData,
        hoursBeforeEvent,
        eventDate
      );

      logger.info('Cancellation request created (less than 24 hours before event)', {
        requestId: result.request.id,
        quoteId: quote.id,
        quoteFolio: quote.getFolio(),
        hoursBeforeEvent,
        requestedBy: currentUser.id,
        reason: requestData.reason,
      });

      return this.sendSuccess(res, result, 'Cancellation request created successfully', 201);
    } catch (error) {
      logger.error('Error in CancellationRequestsController.createCancellationRequest', {
        error: error.message,
        stack: error.stack,
        currentUser: req.user?.id,
        requestData: { ...req.body, reason: req.body.reason ? '[REASON_PROVIDED]' : null },
      });

      this.sendError(res, error.message, 500);
    }
  }

  /**
   * PUT /api/cancellation-requests/:id/review - Review cancellation request (approve/reject).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async reviewCancellationRequest(req, res) {
    try {
      const currentUser = req.user;
      const requestId = req.params.id;
      const reviewData = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Validate user role (only superadmin and admin can review)
      const currentUserRole = req.userRole || currentUser.role || currentUser.get?.('role');
      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return this.sendError(res, 'Access denied. Only SuperAdmin or Admin can review cancellation requests.', 403);
      }

      // Validate review data
      const validationResult = this.validateReviewData(reviewData);
      if (validationResult.error) {
        return this.sendError(res, validationResult.error, 400);
      }

      // Use normalized review data
      const normalizedReviewData = validationResult.data;

      // Get cancellation request
      const request = await this.getCancellationRequestByIdData(requestId);
      if (!request) {
        return this.sendError(res, 'Cancellation request not found', 404);
      }

      if (request.getStatus() !== 'pending') {
        return this.sendError(res, 'Cancellation request has already been reviewed', 400);
      }

      // Process review
      const result = await this.processCancellationRequestReview(request, currentUser, normalizedReviewData);

      logger.info('Cancellation request reviewed', {
        requestId: request.id,
        quoteId: request.get('quote')?.id,
        decision: normalizedReviewData.decision,
        reviewedBy: currentUser.id,
        reviewComments: normalizedReviewData.comments ? '[COMMENTS_PROVIDED]' : null,
      });

      this.sendSuccess(res, result, `Cancellation request ${normalizedReviewData.decision} successfully`);
    } catch (error) {
      logger.error('Error in CancellationRequestsController.reviewCancellationRequest', {
        error: error.message,
        requestId: req.params.id,
        currentUser: req.user?.id,
      });

      this.sendError(res, error.message, 500);
    }
  }

  // ===== HELPER METHODS =====

  /**
   * Parse and validate query parameters (supports both DataTables and custom formats).
   * @param {object} query - Query parameters from request.
   * @returns {object} - Parsed options object.
   * @example
   */
  parseQueryParams(query) {
    // Handle DataTables server-side processing parameters
    let page; let
      limit;

    if (query.start !== undefined && query.length !== undefined) {
      // DataTables format
      const start = parseInt(query.start, 10) || 0;
      limit = parseInt(query.length, 10) || this.defaultPageSize;
      page = Math.floor(start / limit) + 1;
    } else {
      // Custom format
      page = parseInt(query.page, 10) || 1;
      limit = parseInt(query.limit, 10) || this.defaultPageSize;
    }

    if (limit > this.maxPageSize) {
      limit = this.maxPageSize;
    }

    const filters = {};
    if (query.status) {
      filters.status = query.status;
    }
    if (query.type) {
      filters.type = query.type;
    }
    if (query.priority) {
      filters.priority = query.priority;
    }
    if (query.quoteFolio) {
      filters.quoteFolio = query.quoteFolio;
    }

    // Handle DataTables search
    if (query['search[value]']) {
      filters.search = query['search[value]'];
    }

    const sort = {
      field: query.sortField || 'createdAt',
      direction: query.sortDirection || 'desc',
    };

    return {
      page,
      limit,
      filters,
      sort,
      draw: parseInt(query.draw, 10) || 1, // For DataTables
    };
  }

  /**
   * Get cancellation requests data with filters.
   * @param {object} currentUser - Current user object.
   * @param {object} options - Query options.
   * @returns {Promise<object>} - Paginated results with metadata.
   * @example
   */
  async getCancellationRequestsData(currentUser, options) {
    const {
      page, limit, filters, sort, draw,
    } = options;
    const skip = (page - 1) * limit;

    const query = new Parse.Query('CancellationRequest');
    query.equalTo('exists', true);
    query.limit(limit);
    query.skip(skip);
    query.include('quote');
    query.include('requestedBy');
    query.include('reviewedBy');

    // Apply filters
    if (filters.status) {
      query.equalTo('status', filters.status);
    }
    if (filters.type) {
      query.equalTo('cancellationType', filters.type);
    }
    if (filters.priority) {
      query.equalTo('priority', filters.priority);
    }

    // Apply search if provided
    if (filters.search && filters.search.trim()) {
      const searchTerm = filters.search.trim();
      const orQuery = new Parse.Query('CancellationRequest');
      orQuery.contains('reason', searchTerm);

      const quoteFolioQuery = new Parse.Query('CancellationRequest');
      const quoteQuery = new Parse.Query('Quote');
      quoteQuery.contains('folio', searchTerm);
      quoteFolioQuery.matchesQuery('quote', quoteQuery);

      const reservationFolioQuery = new Parse.Query('CancellationRequest');
      reservationFolioQuery.contains('reservationFolio', searchTerm);

      // eslint-disable-next-line no-underscore-dangle
      query._orQuery([orQuery, quoteFolioQuery, reservationFolioQuery]);
    }

    // Apply sorting
    if (sort.direction === 'desc') {
      query.descending(sort.field);
    } else {
      query.ascending(sort.field);
    }

    try {
      // Get count query for total without filters for DataTables
      const countQuery = new Parse.Query('CancellationRequest');
      countQuery.equalTo('exists', true);

      // Get filtered count query
      const filteredCountQuery = new Parse.Query('CancellationRequest');
      filteredCountQuery.equalTo('exists', true);
      if (filters.status) {
        filteredCountQuery.equalTo('status', filters.status);
      }
      if (filters.type) {
        filteredCountQuery.equalTo('cancellationType', filters.type);
      }
      if (filters.priority) {
        filteredCountQuery.equalTo('priority', filters.priority);
      }
      if (filters.search && filters.search.trim()) {
        const searchTerm = filters.search.trim();
        const orQuery = new Parse.Query('CancellationRequest');
        orQuery.contains('reason', searchTerm);

        const quoteFolioQuery = new Parse.Query('CancellationRequest');
        const quoteQuery = new Parse.Query('Quote');
        quoteQuery.contains('folio', searchTerm);
        quoteFolioQuery.matchesQuery('quote', quoteQuery);

        const reservationFolioQuery = new Parse.Query('CancellationRequest');
        reservationFolioQuery.contains('reservationFolio', searchTerm);

        // eslint-disable-next-line no-underscore-dangle
        filteredCountQuery._orQuery([orQuery, quoteFolioQuery, reservationFolioQuery]);
      }

      const [results, total, filteredTotal] = await Promise.all([
        query.find({ useMasterKey: true }),
        countQuery.count({ useMasterKey: true }),
        filteredCountQuery.count({ useMasterKey: true }),
      ]);

      // Transform data for DataTables
      const transformedData = await this.transformRequestsForDataTables(results);

      return {
        draw,
        recordsTotal: total,
        recordsFiltered: filteredTotal,
        data: transformedData,
        // Keep original format for backward compatibility
        requests: transformedData,
        pagination: {
          page,
          limit,
          total: filteredTotal,
          pages: Math.ceil(filteredTotal / limit),
          hasNext: page < Math.ceil(filteredTotal / limit),
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      logger.error('Error fetching cancellation requests data', {
        error: error.message,
        options,
      });
      throw error;
    }
  }

  /**
   * Get cancellation request by ID with related data.
   * @param {string} requestId - Cancellation request ID.
   * @returns {Promise<object|null>} - CancellationRequest object or null.
   * @example
   */
  async getCancellationRequestByIdData(requestId) {
    const query = new Parse.Query('CancellationRequest');
    query.equalTo('exists', true);
    query.include('quote');
    query.include('requestedBy');
    query.include('reviewedBy');

    try {
      return await query.get(requestId, { useMasterKey: true });
    } catch (error) {
      if (error.code === Parse.Error.OBJECT_NOT_FOUND) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Validate cancellation request data.
   * @param {object} requestData - Request data to validate.
   * @returns {string|null} - Error message or null if valid.
   * @example
   */
  validateCancellationRequestData(requestData) {
    if (!requestData.quoteFolio || !requestData.quoteFolio.trim()) {
      return 'Quote folio is required';
    }

    if (!requestData.reason || !requestData.reason.trim()) {
      return 'Cancellation reason is required';
    }

    if (requestData.reason.trim().length < 10) {
      return 'Cancellation reason must be at least 10 characters';
    }

    const validPriorities = ['normal', 'urgent', 'emergency'];
    if (requestData.priority && !validPriorities.includes(requestData.priority)) {
      return `Invalid priority. Must be one of: ${validPriorities.join(', ')}`;
    }

    return null;
  }

  /**
   * Transform cancellation requests for DataTables display.
   * @param {Array} requests - Array of CancellationRequest Parse objects.
   * @returns {Promise<Array>} - Array of transformed objects.
   * @example
   */
  async transformRequestsForDataTables(requests) {
    const transformed = [];

    for (const request of requests) {
      const quote = request.get('quote');
      const requestedBy = request.get('requestedBy');
      const reviewedBy = request.get('reviewedBy');

      // Get client info from quote
      let clientName = 'N/A';
      if (quote) {
        try {
          const clientObj = quote.get('client');
          if (clientObj) {
            await clientObj.fetch({ useMasterKey: true });
            clientName = clientObj.get('fullName') || clientObj.get('companyName') || 'N/A';
          }
        } catch (error) {
          logger.warn('Could not fetch client for cancellation request', { requestId: request.id, error: error.message });
        }
      }

      // Get user names
      let requestedByName = 'Usuario desconocido';
      if (requestedBy) {
        requestedByName = requestedBy.get('fullName') || requestedBy.get('username') || 'Usuario desconocido';
      }

      let reviewedByName = null;
      if (reviewedBy) {
        reviewedByName = reviewedBy.get('fullName') || reviewedBy.get('username') || 'Usuario desconocido';
      }

      const transformedRequest = {
        id: request.id,
        cancellationType: request.get('cancellationType') || 'quote',
        quoteFolio: quote?.get('folio') || 'N/A',
        reservationFolio: request.get('reservationFolio') || null,
        reservationId: request.get('reservationId') || null,
        clientName,
        reason: request.get('reason'),
        status: request.get('status'),
        priority: request.get('priority') || 'normal',
        hoursBeforeEvent: request.get('hoursBeforeEvent'),
        eventDate: request.get('eventDate'),
        createdAt: request.get('createdAt'),
        updatedAt: request.get('updatedAt'),
        requestedBy: request.get('requestedBy'),
        requestedByName,
        reviewedBy: request.get('reviewedBy'),
        reviewedByName,
        reviewedAt: request.get('reviewedAt'),
        adminComments: request.get('reviewComments'),
        refundAmount: request.get('refundAmount'),
        cancellationFee: request.get('cancellationFee'),
        active: request.get('active'),
        exists: request.get('exists'),
      };

      transformed.push(transformedRequest);
    }

    return transformed;
  }

  /**
   * Validate review data.
   * @param {object} reviewData - Review data to validate.
   * @returns {object|null} - Object with error message or normalized data.
   * @example
   */
  validateReviewData(reviewData) {
    // Support both 'action' (from frontend) and 'decision' (standard) parameters
    const decision = reviewData.action || reviewData.decision;

    if (!decision) {
      return { error: 'Review decision is required' };
    }

    const validDecisions = ['approve', 'approved', 'reject', 'rejected'];
    if (!validDecisions.includes(decision)) {
      return { error: 'Invalid decision. Must be one of: approve, reject' };
    }

    // Create normalized review data without mutating the original
    const normalizedData = { ...reviewData };

    // Normalize decision to standard format
    if (decision === 'approve') {
      normalizedData.decision = 'approved';
    } else if (decision === 'reject') {
      normalizedData.decision = 'rejected';
    } else {
      normalizedData.decision = decision;
    }

    // Comments field could be 'adminComments' or 'comments'
    const comments = reviewData.adminComments || reviewData.comments;
    if (normalizedData.decision === 'rejected' && (!comments || !comments.trim())) {
      return { error: 'Comments are required when rejecting a cancellation request' };
    }

    // Ensure we have the comments in the expected field
    if (comments) {
      normalizedData.comments = comments;
    }

    return { data: normalizedData };
  }

  /**
   * Get event date from quote service items.
   * @param {object} quote - Quote object.
   * @returns {Date|null} - Event start date or null if not found.
   * @example
   */
  getEventDateFromQuote(quote) {
    const serviceItems = quote.getServiceItems();
    if (!serviceItems || !serviceItems.days || serviceItems.days.length === 0) {
      return null;
    }

    // Get the earliest date from service items
    let earliestDate = null;
    for (const day of serviceItems.days) {
      if (day.date) {
        const dayDate = new Date(day.date);
        if (!earliestDate || dayDate < earliestDate) {
          earliestDate = dayDate;
        }
      }
    }

    return earliestDate;
  }

  /**
   * Cancel quote directly (24+ hours before event).
   * @param {object} quote - Quote object.
   * @param {object} currentUser - Current user object.
   * @param {string} reason - Cancellation reason.
   * @returns {Promise<object>} - Result object.
   * @example
   */
  async cancelQuoteDirectly(quote, currentUser, reason) {
    // Update quote status to cancelled
    quote.setStatus('cancelled');
    quote.set('cancelledAt', new Date());
    quote.set('cancelledBy', currentUser);
    quote.set('cancellationReason', reason);
    quote.set('cancellationType', 'direct'); // 24+ hours

    await quote.save(null, { useMasterKey: true });

    // Cascade cancel associated Reservation + ReservationServices
    await this.cascadeCancelReservation(quote);

    return {
      quote,
      cancellationType: 'direct',
      directCancellation: true,
      message: 'Quote cancelled successfully (24+ hours before event)',
    };
  }

  /**
   * Create cancellation request for approval (<24 hours before event).
   * @param {object} quote - Quote object.
   * @param {object} currentUser - Current user object.
   * @param {object} requestData - Request data.
   * @param {number} hoursBeforeEvent - Hours before event.
   * @param {Date} eventDate - Event date.
   * @returns {Promise<object>} - Result object.
   * @example
   */
  async createCancellationRequestForApproval(quote, currentUser, requestData, hoursBeforeEvent, eventDate) {
    const request = new CancellationRequest();

    // Base request data
    const requestFields = {
      quote,
      requestedBy: currentUser,
      reason: requestData.reason.trim(),
      status: 'pending',
      priority: requestData.priority || 'normal',
      hoursBeforeEvent,
      eventDate,
      active: true,
      exists: true,
    };

    // Add reservation traceability if this is a reservation cancellation
    if (requestData.cancellationType === 'reservation') {
      requestFields.cancellationType = 'reservation';
      if (requestData.reservationId) {
        requestFields.reservationId = requestData.reservationId;
      }
      if (requestData.reservationFolio) {
        requestFields.reservationFolio = requestData.reservationFolio;
      }
    } else {
      requestFields.cancellationType = 'quote';
    }

    // Set all fields at once to avoid validate firing before all fields are present
    request.set(requestFields);

    await request.save(null, { useMasterKey: true });

    return {
      request,
      // Expose the id explicitly: a serialized Parse.Object uses `objectId`, not `id`,
      // so the client cannot read `request.id` off the JSON response.
      requestId: request.id,
      cancellationType: 'request',
      hoursBeforeEvent,
      message: 'Cancellation request created for approval (less than 24 hours before event)',
    };
  }

  /**
   * Process cancellation request review.
   * @param {object} request - CancellationRequest object.
   * @param {object} currentUser - Current user object.
   * @param {object} reviewData - Review data.
   * @returns {Promise<object>} - Result object.
   * @example
   */
  async processCancellationRequestReview(request, currentUser, reviewData) {
    const {
      decision, comments, refundAmount, cancellationFee,
    } = reviewData;

    // Update request with review data
    request.setStatus(decision);
    request.setReviewedBy(currentUser);
    request.setReviewedAt(new Date());
    if (comments) request.setReviewComments(comments.trim());
    if (refundAmount !== undefined) request.setRefundAmount(refundAmount);
    if (cancellationFee !== undefined) request.setCancellationFee(cancellationFee);

    await request.save(null, { useMasterKey: true });

    // If approved, cancel the quote and cascade to reservation
    if (decision === 'approved') {
      const quote = request.getQuote();
      if (quote) {
        quote.setStatus('cancelled');
        quote.set('cancelledAt', new Date());
        quote.set('cancelledBy', currentUser);
        quote.set('cancellationReason', request.getReason());
        quote.set('cancellationType', 'approved_request'); // <24 hours, approved
        quote.set('cancellationRequestId', request.id);

        await quote.save(null, { useMasterKey: true });

        // Cascade cancel associated Reservation + ReservationServices
        await this.cascadeCancelReservation(quote);
      }
    }

    return {
      request,
      decision,
      message: `Cancellation request ${decision} successfully`,
    };
  }

  /**
   * Send success response.
   * @param {object} res - Express response object.
   * @param {object} data - Data to send.
   * @param {string} message - Success message.
   * @param {number} statusCode - HTTP status code.
   * @example
   */
  sendSuccess(res, data, message = 'Success', statusCode = 200) {
    res.status(statusCode).json({
      success: true,
      data,
      message,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send error response.
   * @param {object} res - Express response object.
   * @param {string} message - Error message.
   * @param {number} statusCode - HTTP status code.
   * @example
   */
  sendError(res, message, statusCode = 500) {
    res.status(statusCode).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Cascade cancel Reservation + ReservationServices linked to a quote.
   * @param {object} quote - Quote Parse object.
   * @private
   * @example
   */
  async cascadeCancelReservation(quote) {
    try {
      const resQuery = new Parse.Query('Reservation');
      resQuery.equalTo('quotePtr', quote);
      resQuery.equalTo('exists', true);
      resQuery.notEqualTo('status', 'cancelled');
      const reservation = await resQuery.first({ useMasterKey: true });
      if (!reservation) return;

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

      logger.info('Cascade cancelled reservation from quote cancellation', {
        quoteId: quote.id,
        reservationId: reservation.id,
        servicesCancelled: services.length,
      });
    } catch (error) {
      logger.error('Error cascading reservation cancellation', {
        quoteId: quote.id,
        error: error.message,
      });
    }
  }
}

module.exports = CancellationRequestsController;
