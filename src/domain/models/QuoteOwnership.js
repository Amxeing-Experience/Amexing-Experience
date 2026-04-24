/**
 * QuoteOwnership - Domain model for quote ownership tracking.
 * Manages ownership history and transfers for quotes with full audit trail.
 *
 * Features:
 * - Track current and historical ownership
 * - Record ownership transfers with reasons
 * - Maintain audit trail for compliance
 * - Soft delete pattern compliance.
 *
 * Created by Denisse Maldonado.
 * @augments BaseModel
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * QuoteOwnership class for managing quote ownership.
 * @class QuoteOwnership
 * @augments BaseModel
 */
class QuoteOwnership extends BaseModel {
  constructor() {
    super('QuoteOwnership');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get quote reference.
   * @returns {object} Quote Parse object pointer.
   * @example
   */
  getQuote() {
    return this.get('quote');
  }

  /**
   * Set quote reference.
   * @param {object} quote - Quote Parse object or Pointer.
   * @example
   */
  setQuote(quote) {
    this.set('quote', quote);
  }

  /**
   * Get owner reference.
   * @returns {object} AmexingUser Parse object (current owner).
   * @example
   */
  getOwner() {
    return this.get('owner');
  }

  /**
   * Set owner reference.
   * @param {object} owner - AmexingUser Parse object or Pointer.
   * @example
   */
  setOwner(owner) {
    this.set('owner', owner);
  }

  /**
   * Get previous owner reference.
   * @returns {object} AmexingUser Parse object (previous owner).
   * @example
   */
  getPreviousOwner() {
    return this.get('previousOwner');
  }

  /**
   * Set previous owner reference.
   * @param {object} previousOwner - AmexingUser Parse object or Pointer.
   * @example
   */
  setPreviousOwner(previousOwner) {
    this.set('previousOwner', previousOwner);
  }

  /**
   * Get ownership start date.
   * @returns {Date} Date when ownership started.
   * @example
   */
  getOwnershipStartDate() {
    return this.get('ownershipStartDate');
  }

  /**
   * Set ownership start date.
   * @param {Date} date - Ownership start date.
   * @example
   */
  setOwnershipStartDate(date) {
    this.set('ownershipStartDate', date);
  }

  /**
   * Get ownership end date.
   * @returns {Date} Date when ownership ended (null if current).
   * @example
   */
  getOwnershipEndDate() {
    return this.get('ownershipEndDate');
  }

  /**
   * Set ownership end date.
   * @param {Date} date - Ownership end date.
   * @example
   */
  setOwnershipEndDate(date) {
    this.set('ownershipEndDate', date);
  }

  /**
   * Get transfer reason.
   * @returns {string} Reason for ownership transfer.
   * @example
   */
  getTransferReason() {
    return this.get('transferReason');
  }

  /**
   * Set transfer reason.
   * @param {string} reason - Reason for ownership transfer.
   * @example
   */
  setTransferReason(reason) {
    this.set('transferReason', reason);
  }

  /**
   * Get transferred by reference.
   * @returns {object} AmexingUser who initiated the transfer.
   * @example
   */
  getTransferredBy() {
    return this.get('transferredBy');
  }

  /**
   * Set transferred by reference.
   * @param {object} user - AmexingUser Parse object or Pointer.
   * @example
   */
  setTransferredBy(user) {
    this.set('transferredBy', user);
  }

  /**
   * Check if this is the current ownership record.
   * @returns {boolean} True if this is the current ownership.
   * @example
   */
  isCurrent() {
    return this.get('isCurrent') === true;
  }

  /**
   * Set current ownership status.
   * @param {boolean} current - Whether this is the current ownership.
   * @example
   */
  setIsCurrent(current) {
    this.set('isCurrent', current);
  }

  /**
   * Get ownership type.
   * @returns {string} Type of ownership (created, transferred, assigned).
   * @example
   */
  getOwnershipType() {
    return this.get('ownershipType') || 'created';
  }

  /**
   * Set ownership type.
   * @param {string} type - Type of ownership.
   * @example
   */
  setOwnershipType(type) {
    this.set('ownershipType', type);
  }

  // ================
  // VALIDATION
  // ================

  /**
   * Validate ownership data before save.
   * @param {object} attrs - Attributes being set.
   * @returns {Parse.Error|undefined} Returns Parse.Error if validation fails.
   * @example
   */
  validate(attrs) {
    const parentError = super.validate(attrs);
    if (parentError) {
      return parentError;
    }

    // Debug validation
    console.log('=== QUOTE OWNERSHIP VALIDATION ===');
    console.log('attrs.quote:', !!attrs.quote);
    console.log('this.has("quote"):', this.has('quote'));
    console.log('attrs.owner:', !!attrs.owner);
    console.log('attrs.owner type:', typeof attrs.owner);
    console.log('attrs.owner.id:', attrs.owner ? attrs.owner.id : null);
    console.log('attrs.owner.objectId:', attrs.owner ? attrs.owner.objectId : null);
    console.log('this.has("owner"):', this.has('owner'));
    console.log('validation attrs keys:', Object.keys(attrs));

    // Only validate required fields during save operations (when multiple fields are set)
    // Skip validation during individual property setting
    const isSaveOperation = (attrs.quote && attrs.owner && attrs.ownershipStartDate)
                           || (Object.keys(attrs).length >= 3)
                           || (this.has('quote') && this.has('owner') && this.has('ownershipStartDate'));

    console.log('isSaveOperation:', isSaveOperation);
    console.log('=== END VALIDATION DEBUG ===');

    // Only run required field validation during save operations
    if (isSaveOperation) {
      // Quote is required
      if (!attrs.quote && !this.has('quote')) {
        console.log('VALIDATION FAILED: Quote is required');
        return new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Quote is required');
      }

      // Owner is required
      if (!attrs.owner && !this.has('owner')) {
        console.log('VALIDATION FAILED: Owner is required');
        console.log('attrs.owner is falsy:', !attrs.owner);
        console.log('this.has("owner") is falsy:', !this.has('owner'));
        return new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Owner is required');
      }

      // Ownership start date is required
      if (!attrs.ownershipStartDate && !this.has('ownershipStartDate')) {
        console.log('VALIDATION FAILED: Ownership start date is required');
        return new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Ownership start date is required');
      }
    } else {
      console.log('SKIPPING VALIDATION: Not a save operation, individual property setting');
    }

    return undefined;
  }

  // ================
  // STATIC METHODS
  // ================

  /**
   * Create initial ownership record for a new quote.
   * @param {object} quote - Quote Parse object.
   * @param {object} owner - AmexingUser Parse object.
   * @returns {Promise<QuoteOwnership>} Created ownership record.
   * @example
   */
  static async createInitialOwnership(quote, owner) {
    const ownership = new QuoteOwnership();
    ownership.setQuote(quote);
    ownership.setOwner(owner);
    ownership.setOwnershipStartDate(new Date());
    ownership.setIsCurrent(true);
    ownership.setOwnershipType('created');
    ownership.set('active', true);
    ownership.set('exists', true);

    try {
      await ownership.save(null, { useMasterKey: true });
      logger.info('Created initial quote ownership', {
        quoteId: quote.id,
        ownerId: owner.id,
        ownershipId: ownership.id,
      });
      return ownership;
    } catch (error) {
      logger.error('Failed to create initial ownership', {
        error: error.message,
        quoteId: quote.id,
        ownerId: owner.id,
      });
      throw error;
    }
  }

  /**
   * Transfer ownership of a quote.
   * @param {object} quote - Quote Parse object.
   * @param {object} fromOwner - Current owner AmexingUser.
   * @param {object} toOwner - New owner AmexingUser.
   * @param {string} reason - Transfer reason.
   * @param {object} transferredBy - User initiating the transfer.
   * @returns {Promise<QuoteOwnership>} New ownership record.
   * @example
   */
  static async transferOwnership(quote, fromOwner, toOwner, reason, transferredBy) {
    // Find current ownership first
    const currentQuery = new Parse.Query('QuoteOwnership');
    currentQuery.equalTo('quote', quote);
    currentQuery.equalTo('isCurrent', true);
    currentQuery.equalTo('exists', true);

    let currentOwnership = null;
    let originalEndDate = null;
    let originalCurrentFlag = null;
    let newOwnership = null;

    try {
      currentOwnership = await currentQuery.first({ useMasterKey: true });

      // Handle missing ownership records - create initial ownership for fromOwner first
      if (!currentOwnership) {
        logger.info('No current ownership found, creating initial ownership for fromOwner', {
          quoteId: quote.id,
          fromOwnerId: fromOwner.id,
          toOwnerId: toOwner.id,
        });

        // Create initial ownership record for the current owner (fromOwner)
        const initialOwnership = new QuoteOwnership();
        initialOwnership.setQuote(quote);
        initialOwnership.setOwner(fromOwner);
        initialOwnership.setOwnershipStartDate(new Date());
        initialOwnership.setIsCurrent(true);
        initialOwnership.setOwnershipType('initial');
        initialOwnership.set('active', true);
        initialOwnership.set('exists', true);

        await initialOwnership.save(null, { useMasterKey: true });
        currentOwnership = initialOwnership;

        logger.info('Created initial ownership record', {
          quoteId: quote.id,
          initialOwnershipId: currentOwnership.id,
          fromOwnerId: fromOwner.id,
        });
      }

      // Store original values for rollback
      originalEndDate = currentOwnership.getOwnershipEndDate();
      originalCurrentFlag = currentOwnership.isCurrent();

      logger.info('Starting ownership transfer transaction', {
        quoteId: quote.id,
        currentOwnershipId: currentOwnership.id,
        fromOwnerId: fromOwner.id,
        toOwnerId: toOwner.id,
        reason,
        hadInitialOwnership: !!currentOwnership,
      });

      // Step 1: Create new ownership record first (fail fast if validation issues)
      newOwnership = new QuoteOwnership();
      newOwnership.setQuote(quote);
      newOwnership.setOwner(toOwner);
      newOwnership.setPreviousOwner(fromOwner);
      newOwnership.setOwnershipStartDate(new Date());
      newOwnership.setIsCurrent(true);
      newOwnership.setOwnershipType('transferred');
      newOwnership.setTransferReason(reason);
      newOwnership.setTransferredBy(transferredBy);
      newOwnership.set('active', true);
      newOwnership.set('exists', true);

      // Try to save new ownership record
      await newOwnership.save(null, { useMasterKey: true });
      logger.info('New ownership record created', { newOwnershipId: newOwnership.id });

      // Step 2: Update current ownership to end it
      currentOwnership.setOwnershipEndDate(new Date());
      currentOwnership.setIsCurrent(false);
      await currentOwnership.save(null, { useMasterKey: true });
      logger.info('Previous ownership record updated', { currentOwnershipId: currentOwnership.id });

      logger.info('Transferred quote ownership successfully', {
        quoteId: quote.id,
        fromOwnerId: fromOwner.id,
        toOwnerId: toOwner.id,
        reason,
        newOwnershipId: newOwnership.id,
      });

      return newOwnership;
    } catch (error) {
      logger.error('Ownership transfer failed, initiating rollback', {
        error: error.message,
        quoteId: quote.id,
        fromOwnerId: fromOwner?.id,
        toOwnerId: toOwner?.id,
        newOwnershipId: newOwnership?.id,
        currentOwnershipId: currentOwnership?.id,
      });

      // Rollback logic
      try {
        // If new ownership was created, delete it
        if (newOwnership && newOwnership.id) {
          await newOwnership.destroy({ useMasterKey: true });
          logger.info('Rolled back: deleted new ownership record', { newOwnershipId: newOwnership.id });
        }

        // If current ownership was modified, restore original values
        if (currentOwnership && originalEndDate !== undefined && originalCurrentFlag !== undefined) {
          currentOwnership.set('ownershipEndDate', originalEndDate);
          currentOwnership.setIsCurrent(originalCurrentFlag);
          await currentOwnership.save(null, { useMasterKey: true });
          logger.info('Rolled back: restored previous ownership record', { currentOwnershipId: currentOwnership.id });
        }
      } catch (rollbackError) {
        logger.error('Rollback failed - manual intervention required', {
          originalError: error.message,
          rollbackError: rollbackError.message,
          quoteId: quote.id,
          newOwnershipId: newOwnership?.id,
          currentOwnershipId: currentOwnership?.id,
        });
      }

      throw error;
    }
  }

  /**
   * Get current owner of a quote.
   * @param {object|string} quote - Quote object or ID.
   * @returns {Promise<QuoteOwnership|null>} Current ownership record or null.
   * @example
   */
  static async getCurrentOwnership(quote) {
    const query = new Parse.Query('QuoteOwnership');

    let quoteObj = quote;
    if (typeof quote === 'string') {
      const Quote = Parse.Object.extend('Quote');
      quoteObj = Quote.createWithoutData(quote);
    }

    query.equalTo('quote', quoteObj);
    query.equalTo('isCurrent', true);
    query.equalTo('exists', true);
    query.include('owner');

    try {
      const ownership = await query.first({ useMasterKey: true });
      if (ownership) {
        logger.debug('Found current ownership', {
          quoteId: quote.id,
          ownerId: ownership.getOwner()?.id,
        });
      }
      return ownership;
    } catch (error) {
      logger.error('Error finding current ownership', {
        error: error.message,
        quoteId: quote.id,
      });
      throw error;
    }
  }

  /**
   * Get ownership history for a quote.
   * @param {object|string} quote - Quote object or ID.
   * @param {object} options - Query options.
   * @returns {Promise<QuoteOwnership[]>} Array of ownership records.
   * @example
   */
  static async getOwnershipHistory(quote, options = {}) {
    const { limit = 100, skip = 0 } = options;
    const query = new Parse.Query('QuoteOwnership');

    let quoteObj = quote;
    if (typeof quote === 'string') {
      const Quote = Parse.Object.extend('Quote');
      quoteObj = Quote.createWithoutData(quote);
    }

    query.equalTo('quote', quoteObj);
    query.equalTo('exists', true);
    query.include(['owner', 'previousOwner', 'transferredBy']);
    query.descending('ownershipStartDate');
    query.limit(limit);
    query.skip(skip);

    try {
      const history = await query.find({ useMasterKey: true });
      logger.info('Retrieved ownership history', {
        quoteId: quote.id,
        recordCount: history.length,
      });
      return history;
    } catch (error) {
      logger.error('Error retrieving ownership history', {
        error: error.message,
        quoteId: quote.id,
      });
      throw error;
    }
  }

  /**
   * Check if a user owns a quote.
   * @param {object|string} quote - Quote object or ID.
   * @param {object|string} user - AmexingUser object or ID.
   * @returns {Promise<boolean>} True if user owns the quote.
   * @example
   */
  static async isOwner(quote, user) {
    const ownership = await this.getCurrentOwnership(quote);
    if (!ownership) {
      return false;
    }

    const ownerId = ownership.getOwner()?.id;
    const userId = typeof user === 'string' ? user : user.id;

    return ownerId === userId;
  }
}

// Register the subclass with Parse
Parse.Object.registerSubclass('QuoteOwnership', QuoteOwnership);

module.exports = QuoteOwnership;
