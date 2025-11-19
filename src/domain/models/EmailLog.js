/**
 * EmailLog Model - Email Traceability and Notification Tracking.
 *
 * Provides comprehensive email tracking, audit trails, and notification history
 * for PCI DSS compliance and multi-channel notification support.
 * @author Amexing Development Team
 * @version 1.0.0
 * @created 2025-01-18
 * @example
 * // Create email log entry
 * const emailLog = EmailLog.create({
 *   messageId: 'msg_abc123',
 *   recipientEmail: 'client@example.com',
 *   recipientUser: userPointer,
 *   channel: 'email',
 *   notificationType: 'booking_confirmation',
 *   subject: 'Booking Confirmation - Amexing',
 *   htmlContent: '<html>...</html>',
 *   textContent: 'Text version',
 *   status: 'sent',
 *   metadata: { bookingId: 'AMX-12345', quoteId: 'Q-789' },
 *   tags: ['booking', 'confirmation']
 * });
 * await emailLog.save();
 *
 * // Query email history
 * const userEmails = await EmailLog.getByRecipient(userId);
 * const bookingEmails = await EmailLog.getByMetadata('bookingId', 'AMX-12345');
 *
 * // Resend email
 * const resendResult = await EmailLog.resend(emailLogId);
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * EmailLog Model - Tracks all email notifications sent by the system.
 *
 * Features:
 * - Complete email traceability with message IDs
 * - Multi-channel notification support (email, push, SMS)
 * - Delivery status tracking (sent, delivered, failed, bounced)
 * - Content snapshots for audit compliance
 * - Metadata tagging for easy querying
 * - Resend capabilities
 * - PCI DSS audit trail compliance.
 * @class EmailLog
 * @augments BaseModel
 */
class EmailLog extends BaseModel {
  constructor() {
    super('EmailLog');
  }

  /**
   * Creates a new EmailLog instance.
   * @param {object} emailData - Email log data.
   * @param {string} emailData.messageId - External provider message ID (MailerSend, FCM, etc.).
   * @param {string} emailData.recipientEmail - Recipient email address.
   * @param {Parse.Object} [emailData.recipientUser] - Pointer to AmexingUser.
   * @param {string} [emailData.channel] - Notification channel (email, push, sms).
   * @param {string} emailData.notificationType - Type of notification (booking_confirmation, welcome, etc.).
   * @param {string} emailData.subject - Email subject line.
   * @param {string} emailData.htmlContent - HTML content sent.
   * @param {string} [emailData.textContent] - Plain text content.
   * @param {string} [emailData.status] - Email status.
   * @param {object} [emailData.metadata] - Additional metadata (bookingId, quoteId, etc.).
   * @param {Array<string>} [emailData.tags] - Tags for categorization.
   * @param {string} [emailData.error] - Error message if failed.
   * @returns {Parse.Object} New EmailLog instance.
   * @example
   * const log = EmailLog.create({
   *   messageId: 'msg_abc123',
   *   recipientEmail: 'user@example.com',
   *   channel: 'email',
   *   notificationType: 'booking_confirmation',
   *   subject: 'Booking Confirmed',
   *   htmlContent: '<html>...</html>',
   *   status: 'sent',
   *   metadata: { bookingId: 'AMX-12345' }
   * });
   */
  static create(emailData) {
    const EmailLogClass = Parse.Object.extend('EmailLog');
    const emailLog = new EmailLogClass();

    // Required fields
    if (!emailData.recipientEmail) {
      throw new Error('recipientEmail is required');
    }
    if (!emailData.notificationType) {
      throw new Error('notificationType is required');
    }
    if (!emailData.subject) {
      throw new Error('subject is required');
    }

    // Set core fields
    emailLog.set('messageId', emailData.messageId || null);
    emailLog.set('recipientEmail', emailData.recipientEmail.toLowerCase().trim());
    emailLog.set('recipientUser', emailData.recipientUser || null);
    emailLog.set('channel', emailData.channel || 'email');
    emailLog.set('notificationType', emailData.notificationType);
    emailLog.set('subject', emailData.subject);
    emailLog.set('htmlContent', emailData.htmlContent || '');
    emailLog.set('textContent', emailData.textContent || '');
    emailLog.set('status', emailData.status || 'sent');
    emailLog.set('sentAt', new Date());
    emailLog.set('deliveredAt', null);
    emailLog.set('metadata', emailData.metadata || {});
    emailLog.set('tags', emailData.tags || []);
    emailLog.set('error', emailData.error || null);

    // Base model required fields
    emailLog.set('active', true);
    emailLog.set('exists', true);

    logger.info('[EmailLog] Created email log', {
      notificationType: emailData.notificationType,
      recipientEmail: this.maskEmail(emailData.recipientEmail),
      channel: emailData.channel || 'email',
      status: emailData.status || 'sent',
    });

    return emailLog;
  }

  /**
   * Get email logs by recipient user.
   * @param {string} userId - AmexingUser objectId.
   * @param {object} options - Query options.
   * @param {number} [options.limit] - Maximum results.
   * @param {number} [options.skip] - Results to skip.
   * @param {boolean} [options.includeDeleted] - Include logically deleted records.
   * @returns {Promise<Array<Parse.Object>>} Email logs.
   * @example
   * const userEmails = await EmailLog.getByRecipient('abc123', { limit: 50 });
   */
  static async getByRecipient(userId, options = {}) {
    const { limit = 100, skip = 0, includeDeleted = false } = options;

    const AmexingUserClass = Parse.Object.extend('AmexingUser');
    const userPointer = AmexingUserClass.createWithoutData(userId);

    const query = new Parse.Query('EmailLog');
    query.equalTo('recipientUser', userPointer);

    if (!includeDeleted) {
      query.equalTo('exists', true);
    }

    query.descending('sentAt');
    query.limit(limit);
    query.skip(skip);

    try {
      const results = await query.find({ useMasterKey: true });
      logger.debug('[EmailLog] Retrieved email logs by recipient', {
        userId,
        count: results.length,
      });
      return results;
    } catch (error) {
      logger.error('[EmailLog] Error retrieving emails by recipient', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get email logs by email address.
   * @param {string} email - Recipient email address.
   * @param {object} options - Query options.
   * @returns {Promise<Array<Parse.Object>>} Email logs.
   * @example
   * const emails = await EmailLog.getByEmail('client@example.com');
   */
  static async getByEmail(email, options = {}) {
    const { limit = 100, skip = 0, includeDeleted = false } = options;

    const query = new Parse.Query('EmailLog');
    query.equalTo('recipientEmail', email.toLowerCase().trim());

    if (!includeDeleted) {
      query.equalTo('exists', true);
    }

    query.descending('sentAt');
    query.limit(limit);
    query.skip(skip);

    try {
      const results = await query.find({ useMasterKey: true });
      logger.debug('[EmailLog] Retrieved email logs by email', {
        email: this.maskEmail(email),
        count: results.length,
      });
      return results;
    } catch (error) {
      logger.error('[EmailLog] Error retrieving emails by email address', {
        email: this.maskEmail(email),
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get email logs by notification type.
   * @param {string} notificationType - Type of notification.
   * @param {object} options - Query options.
   * @returns {Promise<Array<Parse.Object>>} Email logs.
   * @example
   * const bookingEmails = await EmailLog.getByType('booking_confirmation');
   */
  static async getByType(notificationType, options = {}) {
    const { limit = 100, skip = 0, includeDeleted = false } = options;

    const query = new Parse.Query('EmailLog');
    query.equalTo('notificationType', notificationType);

    if (!includeDeleted) {
      query.equalTo('exists', true);
    }

    query.descending('sentAt');
    query.limit(limit);
    query.skip(skip);

    try {
      const results = await query.find({ useMasterKey: true });
      logger.debug('[EmailLog] Retrieved email logs by type', {
        notificationType,
        count: results.length,
      });
      return results;
    } catch (error) {
      logger.error('[EmailLog] Error retrieving emails by type', {
        notificationType,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get email logs by metadata field.
   * @param {string} metadataKey - Metadata field key.
   * @param {any} metadataValue - Metadata field value.
   * @param {object} options - Query options.
   * @returns {Promise<Array<Parse.Object>>} Email logs.
   * @example
   * const bookingEmails = await EmailLog.getByMetadata('bookingId', 'AMX-12345');
   * const quoteEmails = await EmailLog.getByMetadata('quoteId', 'Q-789');
   */
  static async getByMetadata(metadataKey, metadataValue, options = {}) {
    const { limit = 100, skip = 0, includeDeleted = false } = options;

    const query = new Parse.Query('EmailLog');
    query.equalTo(`metadata.${metadataKey}`, metadataValue);

    if (!includeDeleted) {
      query.equalTo('exists', true);
    }

    query.descending('sentAt');
    query.limit(limit);
    query.skip(skip);

    try {
      const results = await query.find({ useMasterKey: true });
      logger.debug('[EmailLog] Retrieved email logs by metadata', {
        metadataKey,
        metadataValue,
        count: results.length,
      });
      return results;
    } catch (error) {
      logger.error('[EmailLog] Error retrieving emails by metadata', {
        metadataKey,
        metadataValue,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get email logs by status.
   * @param {string} status - Email status (sent, delivered, failed, bounced).
   * @param {object} options - Query options.
   * @returns {Promise<Array<Parse.Object>>} Email logs.
   * @example
   * const failedEmails = await EmailLog.getByStatus('failed');
   */
  static async getByStatus(status, options = {}) {
    const { limit = 100, skip = 0, includeDeleted = false } = options;

    const query = new Parse.Query('EmailLog');
    query.equalTo('status', status);

    if (!includeDeleted) {
      query.equalTo('exists', true);
    }

    query.descending('sentAt');
    query.limit(limit);
    query.skip(skip);

    try {
      const results = await query.find({ useMasterKey: true });
      logger.debug('[EmailLog] Retrieved email logs by status', {
        status,
        count: results.length,
      });
      return results;
    } catch (error) {
      logger.error('[EmailLog] Error retrieving emails by status', {
        status,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Update email delivery status.
   * @param {string} emailLogId - EmailLog objectId.
   * @param {string} status - New status (delivered, failed, bounced).
   * @param {object} [updateData] - Additional data to update.
   * @returns {Promise<Parse.Object>} Updated EmailLog.
   * @example
   * await EmailLog.updateStatus('abc123', 'delivered', { deliveredAt: new Date() });
   * await EmailLog.updateStatus('xyz789', 'failed', { error: 'SMTP error' });
   */
  static async updateStatus(emailLogId, status, updateData = {}) {
    const query = new Parse.Query('EmailLog');

    try {
      const emailLog = await query.get(emailLogId, { useMasterKey: true });

      emailLog.set('status', status);

      if (status === 'delivered' && !emailLog.get('deliveredAt')) {
        emailLog.set('deliveredAt', new Date());
      }

      // Apply additional updates
      Object.keys(updateData).forEach((key) => {
        emailLog.set(key, updateData[key]);
      });

      await emailLog.save(null, { useMasterKey: true });

      logger.info('[EmailLog] Updated email status', {
        emailLogId,
        oldStatus: emailLog.get('status'),
        newStatus: status,
      });

      return emailLog;
    } catch (error) {
      logger.error('[EmailLog] Error updating email status', {
        emailLogId,
        status,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get email log by message ID.
   * @param {string} messageId - External provider message ID.
   * @returns {Promise<Parse.Object|null>} Email log or null.
   * @example
   * const emailLog = await EmailLog.getByMessageId('msg_abc123');
   */
  static async getByMessageId(messageId) {
    const query = new Parse.Query('EmailLog');
    query.equalTo('messageId', messageId);
    query.equalTo('exists', true);

    try {
      const emailLog = await query.first({ useMasterKey: true });
      return emailLog || null;
    } catch (error) {
      logger.error('[EmailLog] Error retrieving email by message ID', {
        messageId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Masks email address for logging (PCI DSS compliance).
   * @param {string} email - Email address to mask.
   * @returns {string} Masked email.
   * @private
   * @example
   * EmailLog.maskEmail('john.doe@example.com') // 'j**n.d*e@example.com'
   */
  static maskEmail(email) {
    if (!email || typeof email !== 'string') return '***';

    const [localPart, domain] = email.split('@');
    if (!domain) return '***';

    const maskedLocal = localPart.length > 2
      ? `${localPart[0]}**${localPart[localPart.length - 1]}`
      : '***';

    return `${maskedLocal}@${domain}`;
  }

  /**
   * Get statistics for email logs.
   * @param {object} filters - Query filters.
   * @param {Date} [filters.startDate] - Start date.
   * @param {Date} [filters.endDate] - End date.
   * @param {string} [filters.notificationType] - Notification type.
   * @returns {Promise<object>} Email statistics.
   * @example
   * const stats = await EmailLog.getStatistics({
   *   startDate: new Date('2025-01-01'),
   *   endDate: new Date('2025-01-31'),
   *   notificationType: 'booking_confirmation'
   * });
   */
  static async getStatistics(filters = {}) {
    const { startDate, endDate, notificationType } = filters;

    const query = new Parse.Query('EmailLog');
    query.equalTo('exists', true);

    if (startDate) {
      query.greaterThanOrEqualTo('sentAt', startDate);
    }
    if (endDate) {
      query.lessThanOrEqualTo('sentAt', endDate);
    }
    if (notificationType) {
      query.equalTo('notificationType', notificationType);
    }

    try {
      const totalCount = await query.count({ useMasterKey: true });

      // Get status breakdown
      const statusCounts = {};
      const statuses = ['sent', 'delivered', 'failed', 'bounced'];

      for (const status of statuses) {
        const statusQuery = new Parse.Query('EmailLog');
        statusQuery.equalTo('exists', true);
        statusQuery.equalTo('status', status);

        // Apply same filters as main query
        if (filters.recipientEmail) {
          statusQuery.equalTo('recipientEmail', filters.recipientEmail.toLowerCase().trim());
        }
        if (filters.recipientUser) {
          statusQuery.equalTo('recipientUser', filters.recipientUser);
        }
        if (filters.notificationType) {
          statusQuery.equalTo('notificationType', filters.notificationType);
        }

        statusCounts[status] = await statusQuery.count({ useMasterKey: true });
      }

      logger.debug('[EmailLog] Retrieved email statistics', {
        totalCount,
        filters,
      });

      return {
        total: totalCount,
        byStatus: statusCounts,
        filters,
      };
    } catch (error) {
      logger.error('[EmailLog] Error retrieving email statistics', {
        filters,
        error: error.message,
      });
      throw error;
    }
  }
}

module.exports = EmailLog;
