/**
 * Invoice - Domain model for invoice request management.
 *
 * Manages invoice requests from department managers with quote references.
 *
 * Lifecycle States:
 * - active: true, exists: true = Pending invoice request
 * - active: false, exists: true = Completed/processed invoice
 * - active: false, exists: false = Cancelled/rejected invoice request.
 * @augments BaseModel
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Create new invoice request
 * const invoice = new Invoice();
 * invoice.set('quote', quotePointer);
 * invoice.set('requestedBy', userPointer);
 * invoice.set('status', 'pending');
 * await invoice.save();
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * Invoice class for managing invoice requests.
 * @class Invoice
 * @augments BaseModel
 */
class Invoice extends BaseModel {
  /**
   * Create an Invoice instance.
   * @example
   * // Usage example documented above
   */
  constructor() {
    super('Invoice');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get quote.
   * @returns {object} Quote Parse object.
   * @example
   * const quote = invoice.getQuote();
   */
  getQuote() {
    return this.get('quote');
  }

  /**
   * Set quote.
   * @param {Parse.Object} quote - Quote object.
   * @example
   * invoice.setQuote(quotePointer);
   */
  setQuote(quote) {
    this.set('quote', quote);
  }

  /**
   * Get requested by user.
   * @returns {object} AmexingUser Parse object.
   * @example
   * const user = invoice.getRequestedBy();
   */
  getRequestedBy() {
    return this.get('requestedBy');
  }

  /**
   * Set requested by user.
   * @param {Parse.Object} user - AmexingUser object.
   * @example
   * invoice.setRequestedBy(userPointer);
   */
  setRequestedBy(user) {
    this.set('requestedBy', user);
  }

  /**
   * Get processed by user.
   * @returns {object} AmexingUser Parse object.
   * @example
   * const user = invoice.getProcessedBy();
   */
  getProcessedBy() {
    return this.get('processedBy');
  }

  /**
   * Set processed by user.
   * @param {Parse.Object} user - AmexingUser object.
   * @example
   * invoice.setProcessedBy(userPointer);
   */
  setProcessedBy(user) {
    this.set('processedBy', user);
  }

  /**
   * Get status.
   * @returns {string} Status value.
   * @example
   * const status = invoice.getStatus();
   */
  getStatus() {
    return this.get('status');
  }

  /**
   * Set status.
   * @param {string} status - Status value (pending, completed, cancelled).
   * @example
   * invoice.setStatus('completed');
   */
  setStatus(status) {
    this.set('status', status);
  }

  /**
   * Get request date.
   * @returns {Date} Request date.
   * @example
   * const date = invoice.getRequestDate();
   */
  getRequestDate() {
    return this.get('requestDate');
  }

  /**
   * Set request date.
   * @param {Date} date - Request date.
   * @example
   * invoice.setRequestDate(new Date());
   */
  setRequestDate(date) {
    this.set('requestDate', date);
  }

  /**
   * Get process date.
   * @returns {Date} Process date.
   * @example
   * const date = invoice.getProcessDate();
   */
  getProcessDate() {
    return this.get('processDate');
  }

  /**
   * Set process date.
   * @param {Date} date - Process date.
   * @example
   * invoice.setProcessDate(new Date());
   */
  setProcessDate(date) {
    this.set('processDate', date);
  }

  /**
   * Get notes.
   * @returns {string} Notes value.
   * @example
   * const notes = invoice.getNotes();
   */
  getNotes() {
    return this.get('notes');
  }

  /**
   * Set notes.
   * @param {string} notes - Notes value.
   * @example
   * invoice.setNotes('Additional requirements...');
   */
  setNotes(notes) {
    this.set('notes', notes);
  }

  /**
   * Get invoice number.
   * @returns {string} Invoice number.
   * @example
   * const number = invoice.getInvoiceNumber();
   */
  getInvoiceNumber() {
    return this.get('invoiceNumber');
  }

  /**
   * Set invoice number.
   * @param {string} number - Invoice number.
   * @example
   * invoice.setInvoiceNumber('INV-2025-0001');
   */
  setInvoiceNumber(number) {
    this.set('invoiceNumber', number);
  }

  // =================
  // BUSINESS METHODS
  // =================

  /**
   * Mark invoice request as completed.
   * @param {Parse.User|string} processedBy - User who processed the invoice.
   * @param {string} invoiceNumber - Generated invoice number.
   * @param {string} notes - Optional processing notes.
   * @returns {Promise<Invoice>} Promise resolving to updated invoice.
   * @example
   * await invoice.markCompleted(adminUser, 'INV-2025-0001', 'Processed successfully');
   */
  async markCompleted(processedBy, invoiceNumber, notes = '') {
    this.setStatus('completed');
    this.setProcessedBy(processedBy);
    this.setProcessDate(new Date());
    this.setInvoiceNumber(invoiceNumber);
    if (notes) this.setNotes(notes);

    // Deactivate to mark as completed
    await this.deactivate(processedBy);

    logger.info(`Invoice request completed: ${this.id}`, {
      invoiceId: this.id,
      quoteId: this.get('quote')?.id,
      processedBy: typeof processedBy === 'string' ? processedBy : processedBy?.id,
      invoiceNumber,
    });

    return this;
  }

  /**
   * Mark invoice request as cancelled.
   * @param {Parse.User|string} processedBy - User who cancelled the request.
   * @param {string} reason - Cancellation reason.
   * @returns {Promise<Invoice>} Promise resolving to updated invoice.
   * @example
   * await invoice.markCancelled(adminUser, 'Quote was cancelled');
   */
  async markCancelled(processedBy, reason = '') {
    this.setStatus('cancelled');
    this.setProcessedBy(processedBy);
    this.setProcessDate(new Date());
    if (reason) this.setNotes(reason);

    // Soft delete cancelled requests
    await this.softDelete(processedBy);

    logger.info(`Invoice request cancelled: ${this.id}`, {
      invoiceId: this.id,
      quoteId: this.get('quote')?.id,
      processedBy: typeof processedBy === 'string' ? processedBy : processedBy?.id,
      reason,
    });

    return this;
  }

  // =================
  // STATIC METHODS
  // =================

  /**
   * Get pending invoice requests.
   * @returns {Parse.Query} Query for pending invoices.
   * @example
   * const pendingInvoices = await Invoice.getPendingRequests().find();
   */
  static getPendingRequests() {
    const query = Invoice.queryActive('Invoice');
    query.equalTo('status', 'pending');
    query.include(['quote', 'requestedBy', 'quote.client', 'quote.rate']);
    query.descending('createdAt');
    return query;
  }

  /**
   * Get invoice requests for a specific quote.
   * @param {Parse.Object|string} quote - Quote object or ID.
   * @returns {Parse.Query} Query for invoice requests.
   * @example
   * const invoiceRequests = await Invoice.getByQuote(quoteId).find();
   */
  static getByQuote(quote) {
    const query = Invoice.queryExisting('Invoice');
    if (typeof quote === 'string') {
      const Quote = require('./Quote');
      const quotePointer = new Quote();
      quotePointer.id = quote;
      query.equalTo('quote', quotePointer);
    } else {
      query.equalTo('quote', quote);
    }
    query.include(['requestedBy', 'processedBy']);
    query.descending('createdAt');
    return query;
  }

  /**
   * Check if quote has pending invoice request.
   * @param {Parse.Object|string} quote - Quote object or ID.
   * @returns {Promise<boolean>} True if pending request exists.
   * @example
   * const hasPending = await Invoice.hasPendingRequest(quoteId);
   */
  static async hasPendingRequest(quote) {
    const query = Invoice.queryActive('Invoice');
    query.equalTo('status', 'pending');
    if (typeof quote === 'string') {
      const Quote = require('./Quote');
      const quotePointer = new Quote();
      quotePointer.id = quote;
      query.equalTo('quote', quotePointer);
    } else {
      query.equalTo('quote', quote);
    }
    const count = await query.count({ useMasterKey: true });
    return count > 0;
  }

  /**
   * Create new invoice request.
   * @param {Parse.Object|string} quote - Quote object or ID.
   * @param {Parse.Object|string} requestedBy - User making the request.
   * @param {string} notes - Optional notes.
   * @returns {Promise<Invoice>} New invoice request.
   * @example
   * const invoice = await Invoice.createRequest(quote, user, 'Urgent request');
   */
  static async createRequest(quote, requestedBy, notes = '') {
    const invoice = new Invoice();

    // Set quote reference
    if (typeof quote === 'string') {
      const Quote = require('./Quote');
      const quotePointer = new Quote();
      quotePointer.id = quote;
      invoice.setQuote(quotePointer);
    } else {
      invoice.setQuote(quote);
    }

    // Set requester
    if (typeof requestedBy === 'string') {
      const AmexingUser = require('./AmexingUser');
      const userPointer = new AmexingUser();
      userPointer.id = requestedBy;
      invoice.setRequestedBy(userPointer);
    } else {
      invoice.setRequestedBy(requestedBy);
    }

    // Set initial values
    invoice.setStatus('pending');
    invoice.setRequestDate(new Date());
    if (notes) invoice.setNotes(notes);

    // Set lifecycle flags
    invoice.set('active', true);
    invoice.set('exists', true);

    await invoice.save(null, { useMasterKey: true });

    logger.info(`Invoice request created: ${invoice.id}`, {
      invoiceId: invoice.id,
      quoteId: typeof quote === 'string' ? quote : quote?.id,
      requestedBy: typeof requestedBy === 'string' ? requestedBy : requestedBy?.id,
    });

    return invoice;
  }
}

// Register with Parse
Parse.Object.registerSubclass('Invoice', Invoice);

module.exports = Invoice;
