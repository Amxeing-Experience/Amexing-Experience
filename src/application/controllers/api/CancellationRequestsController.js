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
      const validationError = this.validateReviewData(reviewData);
      if (validationError) {
        return this.sendError(res, validationError, 400);
      }

      // Get cancellation request
      const request = await this.getCancellationRequestByIdData(requestId);
      if (!request) {
        return this.sendError(res, 'Cancellation request not found', 404);
      }

      if (request.getStatus() !== 'pending') {
        return this.sendError(res, 'Cancellation request has already been reviewed', 400);
      }

      // Process review
      const result = await this.processCancellationRequestReview(request, currentUser, reviewData);

      logger.info('Cancellation request reviewed', {
        requestId: request.id,
        quoteId: request.get('quote')?.id,
        decision: reviewData.decision,
        reviewedBy: currentUser.id,
        reviewComments: reviewData.comments ? '[COMMENTS_PROVIDED]' : null,
      });

      this.sendSuccess(res, result, `Cancellation request ${reviewData.decision} successfully`);
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
   * Parse and validate query parameters.
   * @param {object} query - Query parameters from request.
   * @returns {object} - Parsed options object.
   * @example
   */
  parseQueryParams(query) {
    const page = parseInt(query.page, 10) || 1;
    let limit = parseInt(query.limit, 10) || this.defaultPageSize;

    if (limit > this.maxPageSize) {
      limit = this.maxPageSize;
    }

    const filters = {};
    if (query.status) {
      filters.status = query.status;
    }
    if (query.priority) {
      filters.priority = query.priority;
    }
    if (query.quoteFolio) {
      filters.quoteFolio = query.quoteFolio;
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
      page, limit, filters, sort,
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
    if (filters.priority) {
      query.equalTo('priority', filters.priority);
    }

    // Apply sorting
    if (sort.direction === 'desc') {
      query.descending(sort.field);
    } else {
      query.ascending(sort.field);
    }

    try {
      const [results, total] = await Promise.all([
        query.find({ useMasterKey: true }),
        query.count({ useMasterKey: true }),
      ]);

      return {
        requests: results,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
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
   * Validate review data.
   * @param {object} reviewData - Review data to validate.
   * @returns {string|null} - Error message or null if valid.
   * @example
   */
  validateReviewData(reviewData) {
    if (!reviewData.decision) {
      return 'Review decision is required';
    }

    const validDecisions = ['approved', 'rejected'];
    if (!validDecisions.includes(reviewData.decision)) {
      return `Invalid decision. Must be one of: ${validDecisions.join(', ')}`;
    }

    if (reviewData.decision === 'rejected' && (!reviewData.comments || !reviewData.comments.trim())) {
      return 'Comments are required when rejecting a cancellation request';
    }

    return null;
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

    return {
      quote,
      cancellationType: 'direct',
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
    request.set('quote', quote);
    request.set('requestedBy', currentUser);
    request.set('reason', requestData.reason.trim());
    request.set('status', 'pending');
    request.set('priority', requestData.priority || 'normal');
    request.set('hoursBeforeEvent', hoursBeforeEvent);
    request.set('eventDate', eventDate);
    request.set('active', true);
    request.set('exists', true);

    await request.save(null, { useMasterKey: true });

    return {
      request,
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

    // If approved, cancel the quote
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
}

module.exports = CancellationRequestsController;
