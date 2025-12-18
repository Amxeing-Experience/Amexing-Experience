/**
 * CancellationRequest - Domain model for managing quote cancellation requests.
 *
 * Handles cancellation requests when quotes are cancelled within 24 hours of the event.
 * Business Rules:
 * - Cancellation 24+ hours before: Direct cancellation
 * - Cancellation <24 hours before: Create cancellation request for approval.
 *
 * Lifecycle States:
 * - active: true, exists: true = Active cancellation request
 * - active: false, exists: true = Inactive request (resolved)
 * - active: false, exists: false = Soft deleted (audit trail only).
 * @augments BaseModel
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Create cancellation request
 * const request = new CancellationRequest();
 * request.set('quote', quotePointer);
 * request.set('requestedBy', userPointer);
 * request.set('reason', 'Emergencia familiar');
 * await request.save();
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * CancellationRequest class for managing quote cancellation requests.
 * @class CancellationRequest
 * @augments BaseModel
 */
class CancellationRequest extends BaseModel {
  /**
   * Create a CancellationRequest instance.
   * @example
   * const request = new CancellationRequest();
   */
  constructor() {
    super('CancellationRequest');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get quote reference.
   * @returns {object} Quote Parse object.
   * @example
   * const quote = request.getQuote();
   */
  getQuote() {
    return this.get('quote');
  }

  /**
   * Set quote reference.
   * @param {object} quote - Quote Parse object or Pointer.
   * @example
   * request.setQuote(quotePointer);
   */
  setQuote(quote) {
    this.set('quote', quote);
  }

  /**
   * Get user who requested the cancellation.
   * @returns {object} AmexingUser Parse object.
   * @example
   * const user = request.getRequestedBy();
   */
  getRequestedBy() {
    return this.get('requestedBy');
  }

  /**
   * Set user who requested the cancellation.
   * @param {object} requestedBy - AmexingUser Parse object or Pointer.
   * @example
   * request.setRequestedBy(userPointer);
   */
  setRequestedBy(requestedBy) {
    this.set('requestedBy', requestedBy);
  }

  /**
   * Get cancellation reason.
   * @returns {string} Reason for cancellation.
   * @example
   * const reason = request.getReason();
   */
  getReason() {
    return this.get('reason');
  }

  /**
   * Set cancellation reason.
   * @param {string} reason - Reason for requesting cancellation.
   * @example
   * request.setReason('Emergencia familiar');
   */
  setReason(reason) {
    this.set('reason', reason);
  }

  /**
   * Get request status.
   * @returns {string} Request status (pending, approved, rejected).
   * @example
   * const status = request.getStatus();
   */
  getStatus() {
    return this.get('status') || 'pending';
  }

  /**
   * Set request status.
   * @param {string} status - Request status.
   * @example
   * request.setStatus('approved');
   */
  setStatus(status) {
    this.set('status', status);
  }

  /**
   * Get request priority.
   * @returns {string} Priority level (normal, urgent, emergency).
   * @example
   * const priority = request.getPriority();
   */
  getPriority() {
    return this.get('priority') || 'normal';
  }

  /**
   * Set request priority.
   * @param {string} priority - Priority level.
   * @example
   * request.setPriority('urgent');
   */
  setPriority(priority) {
    this.set('priority', priority);
  }

  /**
   * Get hours before event when cancellation was requested.
   * @returns {number} Hours before the event.
   * @example
   * const hours = request.getHoursBeforeEvent();
   */
  getHoursBeforeEvent() {
    return this.get('hoursBeforeEvent');
  }

  /**
   * Set hours before event when cancellation was requested.
   * @param {number} hoursBeforeEvent - Hours before the event.
   * @example
   * request.setHoursBeforeEvent(12);
   */
  setHoursBeforeEvent(hoursBeforeEvent) {
    this.set('hoursBeforeEvent', hoursBeforeEvent);
  }

  /**
   * Get event date (copied from quote for quick reference).
   * @returns {Date} Event start date.
   * @example
   * const eventDate = request.getEventDate();
   */
  getEventDate() {
    return this.get('eventDate');
  }

  /**
   * Set event date.
   * @param {Date} eventDate - Event start date.
   * @example
   * request.setEventDate(new Date('2025-01-15'));
   */
  setEventDate(eventDate) {
    this.set('eventDate', eventDate);
  }

  /**
   * Get user who reviewed the request.
   * @returns {object} AmexingUser Parse object.
   * @example
   * const reviewer = request.getReviewedBy();
   */
  getReviewedBy() {
    return this.get('reviewedBy');
  }

  /**
   * Set user who reviewed the request.
   * @param {object} reviewedBy - AmexingUser Parse object or Pointer.
   * @example
   * request.setReviewedBy(adminPointer);
   */
  setReviewedBy(reviewedBy) {
    this.set('reviewedBy', reviewedBy);
  }

  /**
   * Get review date.
   * @returns {Date} Date when request was reviewed.
   * @example
   * const reviewedAt = request.getReviewedAt();
   */
  getReviewedAt() {
    return this.get('reviewedAt');
  }

  /**
   * Set review date.
   * @param {Date} reviewedAt - Date when request was reviewed.
   * @example
   * request.setReviewedAt(new Date());
   */
  setReviewedAt(reviewedAt) {
    this.set('reviewedAt', reviewedAt);
  }

  /**
   * Get review comments.
   * @returns {string} Comments from reviewer.
   * @example
   * const comments = request.getReviewComments();
   */
  getReviewComments() {
    return this.get('reviewComments');
  }

  /**
   * Set review comments.
   * @param {string} reviewComments - Comments from reviewer.
   * @example
   * request.setReviewComments('Aprobado por fuerza mayor');
   */
  setReviewComments(reviewComments) {
    this.set('reviewComments', reviewComments);
  }

  /**
   * Get refund amount if applicable.
   * @returns {number} Refund amount.
   * @example
   * const refundAmount = request.getRefundAmount();
   */
  getRefundAmount() {
    return this.get('refundAmount') || 0;
  }

  /**
   * Set refund amount.
   * @param {number} refundAmount - Amount to be refunded.
   * @example
   * request.setRefundAmount(500);
   */
  setRefundAmount(refundAmount) {
    this.set('refundAmount', refundAmount);
  }

  /**
   * Get cancellation fee if applicable.
   * @returns {number} Cancellation fee amount.
   * @example
   * const fee = request.getCancellationFee();
   */
  getCancellationFee() {
    return this.get('cancellationFee') || 0;
  }

  /**
   * Set cancellation fee.
   * @param {number} cancellationFee - Fee charged for cancellation.
   * @example
   * request.setCancellationFee(100);
   */
  setCancellationFee(cancellationFee) {
    this.set('cancellationFee', cancellationFee);
  }

  // ================
  // VALIDATION
  // ================

  /**
   * Validate cancellation request data before save.
   * @param {object} attrs - Attributes being set.
   * @returns {Parse.Error|undefined} Returns Parse.Error if validation fails, undefined if valid.
   * @example
   * const error = request.validate({ quote: null });
   * if (error) console.error('Validation failed:', error.message);
   */
  validate(attrs) {
    // Call parent validation first
    const parentError = super.validate(attrs);
    if (parentError) {
      return parentError;
    }

    // Quote is required
    if (!attrs.quote && !this.get('quote')) {
      return new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Quote is required');
    }

    // RequestedBy is required
    if (!attrs.requestedBy && !this.get('requestedBy')) {
      return new Parse.Error(Parse.Error.VALIDATION_ERROR, 'RequestedBy user is required');
    }

    // Reason is required
    if (!attrs.reason && !this.get('reason')) {
      return new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Cancellation reason is required');
    }

    // Valid statuses
    const validStatuses = ['pending', 'approved', 'rejected'];
    const status = attrs.status || this.get('status');
    if (status && !validStatuses.includes(status)) {
      return new Parse.Error(Parse.Error.VALIDATION_ERROR, `Invalid status: ${status}`);
    }

    // Valid priorities
    const validPriorities = ['normal', 'urgent', 'emergency'];
    const priority = attrs.priority || this.get('priority');
    if (priority && !validPriorities.includes(priority)) {
      return new Parse.Error(Parse.Error.VALIDATION_ERROR, `Invalid priority: ${priority}`);
    }

    return undefined;
  }

  // ================
  // QUERY HELPERS
  // ================

  /**
   * Find all pending cancellation requests.
   * @param {object} options - Query options.
   * @param {number} [options.limit] - Maximum results (default: 50).
   * @param {number} [options.skip] - Results to skip (default: 0).
   * @param {string} [options.orderBy] - Sort field (default: '-createdAt').
   * @returns {Promise<CancellationRequest[]>} Array of pending requests.
   * @example
   * const pendingRequests = await CancellationRequest.findPending();
   */
  static async findPending(options = {}) {
    const { limit = 50, skip = 0, orderBy = '-createdAt' } = options;

    const query = new Parse.Query('CancellationRequest');
    query.equalTo('status', 'pending');
    query.equalTo('active', true);
    query.equalTo('exists', true);
    query.limit(limit);
    query.skip(skip);
    query.include('quote');
    query.include('requestedBy');

    // Handle sorting
    if (orderBy.startsWith('-')) {
      query.descending(orderBy.substring(1));
    } else {
      query.ascending(orderBy);
    }

    try {
      const results = await query.find({ useMasterKey: true });
      logger.info('Found pending cancellation requests', {
        count: results.length,
        limit,
        skip,
      });
      return results;
    } catch (error) {
      logger.error('Error finding pending cancellation requests', {
        error: error.message,
        options,
      });
      throw error;
    }
  }

  /**
   * Find cancellation requests by quote.
   * @param {string} quoteId - Quote object ID.
   * @returns {Promise<CancellationRequest[]>} Array of cancellation requests for the quote.
   * @example
   * const requests = await CancellationRequest.findByQuote('abc123');
   */
  static async findByQuote(quoteId) {
    const query = new Parse.Query('CancellationRequest');
    query.equalTo('quote', { __type: 'Pointer', className: 'Quote', objectId: quoteId });
    query.equalTo('exists', true);
    query.include('requestedBy');
    query.include('reviewedBy');
    query.descending('createdAt');

    try {
      const results = await query.find({ useMasterKey: true });
      logger.info('Found cancellation requests by quote', {
        quoteId,
        count: results.length,
      });
      return results;
    } catch (error) {
      logger.error('Error finding cancellation requests by quote', {
        error: error.message,
        quoteId,
      });
      throw error;
    }
  }

  /**
   * Calculate hours between two dates.
   * @param {Date} eventDate - Event date.
   * @param {Date} requestDate - Request date (default: now).
   * @returns {number} Hours between dates.
   * @example
   * const hours = CancellationRequest.calculateHoursBeforeEvent(eventDate);
   */
  static calculateHoursBeforeEvent(eventDate, requestDate = new Date()) {
    const timeDiff = eventDate.getTime() - requestDate.getTime();
    return Math.max(0, Math.floor(timeDiff / (1000 * 60 * 60))); // Convert to hours
  }

  /**
   * Check if cancellation requires approval (less than 24 hours).
   * @param {number} hoursBeforeEvent - Hours before the event.
   * @returns {boolean} True if approval is required.
   * @example
   * const needsApproval = CancellationRequest.requiresApproval(12);
   */
  static requiresApproval(hoursBeforeEvent) {
    return hoursBeforeEvent < 24;
  }
}

// Register the subclass with Parse
Parse.Object.registerSubclass('CancellationRequest', CancellationRequest);

module.exports = CancellationRequest;
