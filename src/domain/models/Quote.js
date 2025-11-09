/**
 * Quote - Domain model for quote/cotización management.
 *
 * Manages quote information with rate and optional client references.
 *
 * Lifecycle States:
 * - active: true, exists: true = Active quote
 * - active: false, exists: true = Inactive quote
 * - active: false, exists: false = Soft deleted (audit trail only).
 * @augments BaseModel
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-01-15
 * @example
 * // Create new quote
 * const quote = new Quote();
 * quote.set('rate', ratePointer);
 * quote.set('client', clientPointer); // Optional
 * quote.set('folio', 'QTE-2025-0001');
 * await quote.save();
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * Quote class for managing quotes.
 * @class Quote
 * @augments BaseModel
 */
class Quote extends BaseModel {
  /**
   * Create a Quote instance.
   * @example
   * // Usage example documented above
   */
  constructor() {
    super('Quote');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get rate.
   * @returns {object} Rate Parse object.
   * @example
   * const rate = quote.getRate();
   */
  getRate() {
    return this.get('rate');
  }

  /**
   * Set rate (required).
   * @param {object} rate - Rate Parse object or Pointer.
   * @example
   * quote.setRate(ratePointer);
   */
  setRate(rate) {
    this.set('rate', rate);
  }

  /**
   * Get client.
   * @returns {object} Client AmexingUser Parse object.
   * @example
   * const client = quote.getClient();
   */
  getClient() {
    return this.get('client');
  }

  /**
   * Set client (optional).
   * @param {object} client - AmexingUser Parse object or Pointer.
   * @example
   * quote.setClient(clientPointer);
   */
  setClient(client) {
    this.set('client', client);
  }

  /**
   * Get folio.
   * @returns {string} Quote folio number.
   * @example
   * const folio = quote.getFolio();
   */
  getFolio() {
    return this.get('folio');
  }

  /**
   * Set folio.
   * @param {string} folio - Unique folio number (QTE-YYYY-0001).
   * @example
   * quote.setFolio('QTE-2025-0001');
   */
  setFolio(folio) {
    this.set('folio', folio);
  }

  /**
   * Get contact person.
   * @returns {string} Contact person name.
   * @example
   * const contactPerson = quote.getContactPerson();
   */
  getContactPerson() {
    return this.get('contactPerson');
  }

  /**
   * Set contact person.
   * @param {string} contactPerson - Contact person name.
   * @example
   * quote.setContactPerson('John Doe');
   */
  setContactPerson(contactPerson) {
    this.set('contactPerson', contactPerson);
  }

  /**
   * Get contact email.
   * @returns {string} Contact email address.
   * @example
   * const contactEmail = quote.getContactEmail();
   */
  getContactEmail() {
    return this.get('contactEmail');
  }

  /**
   * Set contact email.
   * @param {string} contactEmail - Contact email address.
   * @example
   * quote.setContactEmail('john@example.com');
   */
  setContactEmail(contactEmail) {
    this.set('contactEmail', contactEmail);
  }

  /**
   * Get contact phone.
   * @returns {string} Contact phone number.
   * @example
   * const contactPhone = quote.getContactPhone();
   */
  getContactPhone() {
    return this.get('contactPhone');
  }

  /**
   * Set contact phone.
   * @param {string} contactPhone - Contact phone number.
   * @example
   * quote.setContactPhone('+1234567890');
   */
  setContactPhone(contactPhone) {
    this.set('contactPhone', contactPhone);
  }

  /**
   * Get notes.
   * @returns {string} Quote notes.
   * @example
   * const notes = quote.getNotes();
   */
  getNotes() {
    return this.get('notes');
  }

  /**
   * Set notes.
   * @param {string} notes - Additional notes.
   * @example
   * quote.setNotes('Special requirements...');
   */
  setNotes(notes) {
    this.set('notes', notes);
  }

  /**
   * Get status.
   * @returns {string} Quote status (draft, sent, accepted, rejected).
   * @example
   * const status = quote.getStatus();
   */
  getStatus() {
    return this.get('status');
  }

  /**
   * Set status.
   * @param {string} status - Quote status.
   * @example
   * quote.setStatus('sent');
   */
  setStatus(status) {
    this.set('status', status);
  }

  /**
   * Get valid until date.
   * @returns {Date} Quote expiration date.
   * @example
   * const validUntil = quote.getValidUntil();
   */
  getValidUntil() {
    return this.get('validUntil');
  }

  /**
   * Set valid until date.
   * @param {Date} validUntil - Quote expiration date.
   * @example
   * quote.setValidUntil(new Date('2025-12-31'));
   */
  setValidUntil(validUntil) {
    this.set('validUntil', validUntil);
  }

  /**
   * Get number of people.
   * @returns {number} Number of people for the quote.
   * @example
   * const numberOfPeople = quote.getNumberOfPeople();
   */
  getNumberOfPeople() {
    return this.get('numberOfPeople') || 1;
  }

  /**
   * Set number of people.
   * @param {number} numberOfPeople - Number of people for the quote.
   * @example
   * quote.setNumberOfPeople(4);
   */
  setNumberOfPeople(numberOfPeople) {
    this.set('numberOfPeople', numberOfPeople);
  }

  /**
   * Get event type/reason.
   * @returns {string} Event type or reason for the quote.
   * @example
   * const eventType = quote.getEventType();
   */
  getEventType() {
    return this.get('eventType');
  }

  /**
   * Set event type/reason.
   * @param {string} eventType - Event type or reason for the quote.
   * @example
   * quote.setEventType('Despedida de soltera');
   */
  setEventType(eventType) {
    this.set('eventType', eventType);
  }

  /**
   * Get created by user.
   * @returns {object} AmexingUser Parse object who created the quote.
   * @example
   * const creator = quote.getCreatedBy();
   */
  getCreatedBy() {
    return this.get('createdBy');
  }

  /**
   * Set created by user.
   * @param {object} createdBy - AmexingUser Parse object or Pointer.
   * @example
   * quote.setCreatedBy(userPointer);
   */
  setCreatedBy(createdBy) {
    this.set('createdBy', createdBy);
  }

  /**
   * Get service items (itinerary days).
   * @returns {object} Service items object with days array and totals.
   * @example
   * const serviceItems = quote.getServiceItems();
   */
  getServiceItems() {
    return (
      this.get('serviceItems') || {
        days: [],
        subtotal: 0,
        iva: 0,
        total: 0,
      }
    );
  }

  /**
   * Set service items (itinerary days).
   * @param {object} serviceItems - Service items object.
   * @param {Array} serviceItems.days - Array of day objects.
   * @param {number} serviceItems.subtotal - Subtotal amount.
   * @param {number} serviceItems.iva - IVA amount (16%).
   * @param {number} serviceItems.total - Total amount (subtotal + iva).
   * @example
   * quote.setServiceItems({
   *   days: [{dayNumber: 1, concept: 'Transfer', ...}],
   *   subtotal: 1000,
   *   iva: 160,
   *   total: 1160
   * });
   */
  setServiceItems(serviceItems) {
    this.set('serviceItems', serviceItems);
  }

  // ================
  // VALIDATION
  // ================

  /**
   * Validate quote data before save.
   * Overrides BaseModel.validate() to add quote-specific validation.
   * @param {object} attrs - Attributes being set.
   * @returns {Parse.Error|undefined} Returns Parse.Error if validation fails, undefined if valid.
   * @example
   * const error = quote.validate({ rate: null });
   * if (error) console.error('Validation failed:', error.message);
   */
  validate(attrs) {
    // Call parent validation first
    const parentError = super.validate(attrs);
    if (parentError) {
      return parentError;
    }

    // Rate is REQUIRED
    if ('rate' in attrs && !attrs.rate) {
      logger.warn('Quote validation failed: rate is required', {
        quoteId: this.id,
        attrs,
      });
      return new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Rate is required');
    }

    // Client is OPTIONAL - no validation needed
    // Other fields are optional

    return undefined;
  }

  // ================
  // QUERY HELPERS
  // ================

  /**
   * Find all active quotes.
   * @param {object} options - Query options.
   * @param {number} [options.limit] - Maximum results (default: 100).
   * @param {number} [options.skip] - Results to skip (default: 0).
   * @param {string} [options.orderBy] - Sort field (default: '-createdAt').
   * @returns {Promise<Quote[]>} Array of active quotes.
   * @example
   * const activeQuotes = await Quote.findActive({ limit: 10 });
   */
  static async findActive(options = {}) {
    const { limit = 100, skip = 0, orderBy = '-createdAt' } = options;

    const query = new Parse.Query('Quote');
    query.equalTo('active', true);
    query.equalTo('exists', true);
    query.limit(limit);
    query.skip(skip);

    // Handle sorting
    if (orderBy.startsWith('-')) {
      query.descending(orderBy.substring(1));
    } else {
      query.ascending(orderBy);
    }

    try {
      const results = await query.find({ useMasterKey: true });
      logger.info('Found active quotes', {
        count: results.length,
        limit,
        skip,
      });
      return results;
    } catch (error) {
      logger.error('Error finding active quotes', {
        error: error.message,
        options,
      });
      throw error;
    }
  }

  /**
   * Find quote by folio.
   * @param {string} folio - Quote folio number.
   * @returns {Promise<Quote|null>} Quote object or null if not found.
   * @example
   * const quote = await Quote.findByFolio('QTE-2025-0001');
   */
  static async findByFolio(folio) {
    const query = new Parse.Query('Quote');
    query.equalTo('folio', folio);
    query.equalTo('exists', true);

    try {
      const result = await query.first({ useMasterKey: true });
      if (result) {
        logger.info('Found quote by folio', { folio, quoteId: result.id });
      } else {
        logger.warn('Quote not found by folio', { folio });
      }
      return result;
    } catch (error) {
      logger.error('Error finding quote by folio', {
        error: error.message,
        folio,
      });
      throw error;
    }
  }

  /**
   * Find quote by folio for public view (includes rate and client).
   * @param {string} folio - Quote folio number.
   * @returns {Promise<Quote|null>} Quote object with included relations or null if not found.
   * @example
   * const quote = await Quote.findByFolioPublic('QTE-2025-0001');
   */
  static async findByFolioPublic(folio) {
    const query = new Parse.Query('Quote');
    query.equalTo('folio', folio);
    query.equalTo('exists', true);
    query.equalTo('active', true);

    // Include related objects for public view
    query.include('rate');
    query.include('client');

    try {
      const result = await query.first({ useMasterKey: true });
      if (result) {
        logger.info('Found quote by folio (public)', { folio, quoteId: result.id });
      } else {
        logger.warn('Quote not found by folio (public)', { folio });
      }
      return result;
    } catch (error) {
      logger.error('Error finding quote by folio (public)', {
        error: error.message,
        folio,
      });
      throw error;
    }
  }

  /**
   * Get share token.
   * @returns {string} Share token for public access.
   * @example
   * const token = quote.getShareToken();
   */
  getShareToken() {
    return this.get('shareToken');
  }

  /**
   * Set share token.
   * @param {string} token - UUID v4 token for public sharing.
   * @example
   * quote.setShareToken('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
   */
  setShareToken(token) {
    this.set('shareToken', token);
  }

  /**
   * Get share token active status.
   * @returns {boolean} Whether share token is active.
   * @example
   * const isActive = quote.getShareTokenActive();
   */
  getShareTokenActive() {
    return this.get('shareTokenActive');
  }

  /**
   * Set share token active status.
   * @param {boolean} active - Whether share token is active.
   * @example
   * quote.setShareTokenActive(true);
   */
  setShareTokenActive(active) {
    this.set('shareTokenActive', active);
  }
}

// Register the subclass with Parse
Parse.Object.registerSubclass('Quote', Quote);

module.exports = Quote;
