/**
 * QuoteReminder - Domain model for tracking automated quote reminders.
 *
 * Manages reminder scheduling and tracking for quotes with "COTIZADO" status.
 * Handles automatic reminder creation, email scheduling, and lifecycle management.
 *
 * Lifecycle States:
 * - active: true, exists: true = Active reminder
 * - active: false, exists: true = Paused reminder
 * - active: false, exists: false = Cancelled/Completed reminder (audit trail only).
 * @augments BaseModel
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Create new quote reminder
 * const reminder = QuoteReminder.create({
 *   quote: quotePointer,
 *   reminderType: 'follow_up',
 *   nextReminderDate: new Date(),
 *   reminderCount: 0
 * });
 * await reminder.save();
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * QuoteReminder class for managing quote reminder schedules.
 * @class QuoteReminder
 * @augments BaseModel
 */
class QuoteReminder extends BaseModel {
  /**
   * Create a QuoteReminder instance.
   * @example
   * // Usage example documented above
   */
  constructor() {
    super('QuoteReminder');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get quote reference.
   * @returns {object} Quote Parse object.
   * @example
   * const quote = reminder.getQuote();
   */
  getQuote() {
    return this.get('quote');
  }

  /**
   * Set quote reference.
   * @param {object} quote - Quote Parse object or Pointer.
   * @example
   * reminder.setQuote(quotePointer);
   */
  setQuote(quote) {
    this.set('quote', quote);
  }

  /**
   * Get reminder type.
   * @returns {string} Reminder type (initial, follow_up, final).
   * @example
   * const type = reminder.getReminderType();
   */
  getReminderType() {
    return this.get('reminderType') || 'initial';
  }

  /**
   * Set reminder type.
   * @param {string} reminderType - Type of reminder.
   * @example
   * reminder.setReminderType('follow_up');
   */
  setReminderType(reminderType) {
    this.set('reminderType', reminderType);
  }

  /**
   * Get reminder status.
   * @returns {string} Status (pending, sent, completed, cancelled).
   * @example
   * const status = reminder.getStatus();
   */
  getStatus() {
    return this.get('status') || 'pending';
  }

  /**
   * Set reminder status.
   * @param {string} status - Reminder status.
   * @example
   * reminder.setStatus('sent');
   */
  setStatus(status) {
    this.set('status', status);
  }

  /**
   * Get next reminder date.
   * @returns {Date} Next reminder date.
   * @example
   * const nextDate = reminder.getNextReminderDate();
   */
  getNextReminderDate() {
    return this.get('nextReminderDate');
  }

  /**
   * Set next reminder date.
   * @param {Date} date - Next reminder date.
   * @example
   * reminder.setNextReminderDate(new Date());
   */
  setNextReminderDate(date) {
    this.set('nextReminderDate', date);
  }

  /**
   * Get reminder count.
   * @returns {number} Number of reminders sent.
   * @example
   * const count = reminder.getReminderCount();
   */
  getReminderCount() {
    return this.get('reminderCount') || 0;
  }

  /**
   * Set reminder count.
   * @param {number} count - Number of reminders sent.
   * @example
   * reminder.setReminderCount(3);
   */
  setReminderCount(count) {
    this.set('reminderCount', count);
  }

  /**
   * Get maximum reminders allowed.
   * @returns {number} Maximum reminders (default: 6).
   * @example
   * const max = reminder.getMaxReminders();
   */
  getMaxReminders() {
    return this.get('maxReminders') || 6;
  }

  /**
   * Set maximum reminders allowed.
   * @param {number} maxReminders - Maximum reminders.
   * @example
   * reminder.setMaxReminders(5);
   */
  setMaxReminders(maxReminders) {
    this.set('maxReminders', maxReminders);
  }

  /**
   * Get reminder interval in days.
   * @returns {number} Interval between reminders (default: 5).
   * @example
   * const interval = reminder.getReminderInterval();
   */
  getReminderInterval() {
    return this.get('reminderInterval') || 5;
  }

  /**
   * Set reminder interval in days.
   * @param {number} intervalDays - Days between reminders.
   * @example
   * reminder.setReminderInterval(7);
   */
  setReminderInterval(intervalDays) {
    this.set('reminderInterval', intervalDays);
  }

  /**
   * Get emails sent log.
   * @returns {Array} Array of email send records.
   * @example
   * const emailLog = reminder.getEmailsSent();
   */
  getEmailsSent() {
    return this.get('emailsSent') || [];
  }

  /**
   * Add email sent record.
   * @param {object} emailRecord - Email send record.
   * @example
   * reminder.addEmailSent({
   *   sentAt: new Date(),
   *   emailLogId: 'log123',
   *   recipientEmail: 'client@example.com'
   * });
   */
  addEmailSent(emailRecord) {
    const emails = this.getEmailsSent();
    emails.push({
      sentAt: emailRecord.sentAt || new Date(),
      emailLogId: emailRecord.emailLogId,
      recipientEmail: emailRecord.recipientEmail,
      reminderType: this.getReminderType(),
      reminderCount: this.getReminderCount() + 1,
    });
    this.set('emailsSent', emails);
  }

  /**
   * Get notes/comments.
   * @returns {string} Notes about the reminder.
   * @example
   * const notes = reminder.getNotes();
   */
  getNotes() {
    return this.get('notes') || '';
  }

  /**
   * Set notes/comments.
   * @param {string} notes - Notes about the reminder.
   * @example
   * reminder.setNotes('Client requested extended timeline');
   */
  setNotes(notes) {
    this.set('notes', notes);
  }

  // =================
  // BUSINESS METHODS
  // =================

  /**
   * Check if reminder is due to be sent.
   * @returns {boolean} True if reminder should be sent now.
   * @example
   * if (reminder.isDue()) {
   *   await sendReminderEmail(reminder);
   * }
   */
  isDue() {
    const now = new Date();
    const nextDate = this.getNextReminderDate();

    return this.getStatus() === 'pending'
           && this.get('active') !== false
           && nextDate
           && nextDate <= now;
  }

  /**
   * Check if maximum reminders have been reached.
   * @returns {boolean} True if max reminders reached.
   * @example
   * if (reminder.hasReachedMaxReminders()) {
   *   reminder.setStatus('completed');
   * }
   */
  hasReachedMaxReminders() {
    return this.getReminderCount() >= this.getMaxReminders();
  }

  /**
   * Calculate next reminder date based on interval.
   * @returns {Date} Next reminder date.
   * @example
   * const nextDate = reminder.calculateNextReminderDate();
   */
  calculateNextReminderDate() {
    const intervalDays = this.getReminderInterval();
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + intervalDays);
    return nextDate;
  }

  /**
   * Schedule next reminder.
   * Updates reminder count and sets next reminder date.
   * @returns {void}
   * @example
   * reminder.scheduleNextReminder();
   * await reminder.save();
   */
  scheduleNextReminder() {
    const currentCount = this.getReminderCount();
    this.setReminderCount(currentCount + 1);

    if (this.hasReachedMaxReminders()) {
      this.setStatus('completed');
      this.setNextReminderDate(null);
    } else {
      this.setNextReminderDate(this.calculateNextReminderDate());
      this.setStatus('pending');
    }
  }

  /**
   * Cancel reminder (soft delete).
   * Sets status to cancelled and deactivates.
   * @param {string} reason - Cancellation reason.
   * @returns {void}
   * @example
   * reminder.cancel('Quote status changed to SOLICITADO');
   * await reminder.save();
   */
  cancel(reason = '') {
    this.setStatus('cancelled');
    this.set('active', false);
    this.setNextReminderDate(null);
    if (reason) {
      this.setNotes(`${this.getNotes()}\nCancelled: ${reason}`);
    }
  }

  /**
   * Complete reminder successfully.
   * Sets status to completed and deactivates.
   * @param {string} completionReason - Completion reason.
   * @returns {void}
   * @example
   * reminder.complete('Maximum reminders sent');
   * await reminder.save();
   */
  complete(completionReason = '') {
    this.setStatus('completed');
    this.set('active', false);
    this.setNextReminderDate(null);
    if (completionReason) {
      this.setNotes(`${this.getNotes()}\nCompleted: ${completionReason}`);
    }
  }

  // =================
  // STATIC METHODS
  // =================

  /**
   * Create QuoteReminder with proper initialization.
   * @param {object} reminderData - Reminder data.
   * @returns {QuoteReminder} New QuoteReminder instance.
   * @static
   * @example
   * const reminder = QuoteReminder.create({
   *   quote: quotePointer,
   *   reminderType: 'initial'
   * });
   */
  static create(reminderData) {
    if (!reminderData.quote) {
      throw new Error('Quote reference is required');
    }

    const reminder = new QuoteReminder();

    // Set required fields
    reminder.setQuote(reminderData.quote);
    reminder.setReminderType(reminderData.reminderType || 'initial');
    reminder.setStatus('pending');
    reminder.setReminderCount(0);
    reminder.setMaxReminders(reminderData.maxReminders || 6);
    reminder.setReminderInterval(reminderData.reminderInterval || 5);

    // Calculate first reminder date (5 days from now by default)
    const firstReminderDate = new Date();
    firstReminderDate.setDate(firstReminderDate.getDate() + (reminderData.initialDelay || 5));
    reminder.setNextReminderDate(firstReminderDate);

    // Set lifecycle fields
    reminder.set('active', reminderData.active !== false);
    reminder.set('exists', true);

    if (reminderData.notes) {
      reminder.setNotes(reminderData.notes);
    }

    return reminder;
  }

  /**
   * Find active reminders for a quote.
   * @param {object} quote - Quote Parse object or pointer.
   * @returns {Promise<Array>} Array of active reminders.
   * @static
   * @example
   * const reminders = await QuoteReminder.findByQuote(quote);
   */
  static async findByQuote(quote) {
    const query = new Parse.Query(QuoteReminder);
    query.equalTo('quote', quote);
    query.equalTo('active', true);
    query.equalTo('exists', true);
    query.ascending('nextReminderDate');

    try {
      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error finding reminders by quote:', error);
      throw error;
    }
  }

  /**
   * Find due reminders that need to be sent.
   * @returns {Promise<Array>} Array of due reminders.
   * @static
   * @example
   * const dueReminders = await QuoteReminder.findDueReminders();
   */
  static async findDueReminders() {
    const query = new Parse.Query(QuoteReminder);
    query.equalTo('active', true);
    query.equalTo('exists', true);
    query.equalTo('status', 'pending');
    query.lessThanOrEqualTo('nextReminderDate', new Date());
    query.include('quote');
    query.include('quote.client');
    query.ascending('nextReminderDate');
    query.limit(100); // Process in batches

    try {
      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error finding due reminders:', error);
      throw error;
    }
  }

  /**
   * Validate QuoteReminder data.
   * @param {object} attrs - Attributes being set.
   * @returns {Parse.Error|undefined} Returns Parse.Error if validation fails.
   * @static
   * @example
   * const error = QuoteReminder.validate({ quote: null });
   */
  static validate(attrs) {
    const errors = [];

    // Quote reference is required
    if (!attrs.quote) {
      errors.push('Quote reference is required');
    }

    // Reminder type validation
    const allowedTypes = ['initial', 'follow_up', 'final'];
    if (attrs.reminderType && !allowedTypes.includes(attrs.reminderType)) {
      errors.push('Invalid reminder type');
    }

    // Status validation
    const allowedStatuses = ['pending', 'sent', 'completed', 'cancelled'];
    if (attrs.status && !allowedStatuses.includes(attrs.status)) {
      errors.push('Invalid reminder status');
    }

    // Interval validation
    if (attrs.reminderInterval && (attrs.reminderInterval < 1 || attrs.reminderInterval > 30)) {
      errors.push('Reminder interval must be between 1 and 30 days');
    }

    // Max reminders validation
    if (attrs.maxReminders && (attrs.maxReminders < 1 || attrs.maxReminders > 20)) {
      errors.push('Maximum reminders must be between 1 and 20');
    }

    if (errors.length > 0) {
      return new Parse.Error(Parse.Error.VALIDATION_ERROR, errors.join(', '));
    }

    return undefined;
  }
}

module.exports = QuoteReminder;
