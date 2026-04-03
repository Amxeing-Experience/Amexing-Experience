/**
 * QuoteReminderService - Business logic for quote reminder management.
 *
 * Handles the creation, scheduling, and sending of quote reminders for quotes
 * with "COTIZADO" status. Integrates with EmailService for sending reminders
 * and manages the complete reminder lifecycle.
 *
 * Created by Denisse Maldonado.
 */

const QuoteReminder = require('../../domain/models/QuoteReminder');
const emailService = require('./EmailService');
const logger = require('../../infrastructure/logger');

/**
 * Service for managing quote reminder business logic.
 * @class QuoteReminderService
 * @author Denisse Maldonado
 * @since 1.0.0
 */
class QuoteReminderService {
  constructor() {
    this.emailService = emailService;
  }

  /**
   * Create initial reminder for a quote when status becomes "quoted".
   * @param {object} quote - Quote Parse object.
   * @param {object} options - Reminder options.
   * @returns {Promise<QuoteReminder>} Created reminder.
   * @example
   * const reminder = await reminderService.createInitialReminder(quote, {
   *   initialDelay: 5,
   *   maxReminders: 6
   * });
   */
  async createInitialReminder(quote, options = {}) {
    try {
      // Check if reminder already exists for this quote
      const existingReminders = await QuoteReminder.findByQuote(quote);

      if (existingReminders.length > 0) {
        logger.info('Reminder already exists for quote', { quoteId: quote.id });
        return existingReminders[0];
      }

      // Create new reminder
      const reminderData = {
        quote,
        reminderType: 'initial',
        initialDelay: options.initialDelay || 5,
        maxReminders: options.maxReminders || 6,
        reminderInterval: options.reminderInterval || 5,
        notes: `Reminder created for quote ${quote.get('folio')}`,
      };

      const reminder = QuoteReminder.create(reminderData);
      await reminder.save(null, { useMasterKey: true });

      logger.info('Initial reminder created', {
        reminderId: reminder.id,
        quoteId: quote.id,
        nextReminderDate: reminder.getNextReminderDate(),
      });

      return reminder;
    } catch (error) {
      logger.error('Error creating initial reminder:', {
        error: error.message,
        quoteId: quote?.id,
      });
      throw error;
    }
  }

  /**
   * Cancel all active reminders for a quote.
   * Called when quote status changes away from "quoted".
   * @param {object} quote - Quote Parse object.
   * @param {string} reason - Cancellation reason.
   * @returns {Promise<number>} Number of reminders cancelled.
   * @example
   * const cancelled = await reminderService.cancelRemindersForQuote(quote, 'Status changed to SOLICITADO');
   */
  async cancelRemindersForQuote(quote, reason = 'Quote status changed') {
    try {
      const activeReminders = await QuoteReminder.findByQuote(quote);

      for (const reminder of activeReminders) {
        reminder.cancel(reason);
        await reminder.save(null, { useMasterKey: true });
      }

      logger.info('Cancelled reminders for quote', {
        quoteId: quote.id,
        remindersCount: activeReminders.length,
        reason,
      });

      return activeReminders.length;
    } catch (error) {
      logger.error('Error cancelling reminders for quote:', {
        error: error.message,
        quoteId: quote?.id,
      });
      throw error;
    }
  }

  /**
   * Process all due reminders and send emails.
   * Called by background job to check and send pending reminders.
   * @returns {Promise<object>} Processing results.
   * @example
   * const results = await reminderService.processDueReminders();
   */
  async processDueReminders() {
    const results = {
      processed: 0,
      sent: 0,
      failed: 0,
      errors: [],
    };

    try {
      const dueReminders = await QuoteReminder.findDueReminders();
      results.processed = dueReminders.length;

      logger.info(`Processing ${dueReminders.length} due reminders`);

      for (const reminder of dueReminders) {
        try {
          await this.sendReminderEmail(reminder);
          results.sent++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            reminderId: reminder.id,
            error: error.message,
          });
          logger.error('Failed to send reminder email:', {
            reminderId: reminder.id,
            error: error.message,
          });
        }
      }

      logger.info('Reminder processing completed', results);
      return results;
    } catch (error) {
      logger.error('Error processing due reminders:', error);
      throw error;
    }
  }

  /**
   * Send reminder email for a specific reminder.
   * @param {object} reminder - QuoteReminder object.
   * @returns {Promise<object>} Email send result.
   * @example
   * const result = await reminderService.sendReminderEmail(reminder);
   */
  async sendReminderEmail(reminder) {
    try {
      const quote = reminder.get('quote');
      if (!quote) {
        throw new Error('Quote not found for reminder');
      }

      // Fetch quote with client information
      await quote.fetch({ include: ['client'] }, { useMasterKey: true });
      const client = quote.get('client');

      if (!client) {
        throw new Error('Client not found for quote');
      }

      // Determine email template based on reminder count
      const reminderCount = reminder.getReminderCount();
      const templateType = this.getTemplateType(reminderCount);

      // Prepare email data
      const emailData = {
        to: client.get('email'),
        name: `${client.get('firstName')} ${client.get('lastName')}`.trim() || client.get('name'),
        quote: {
          folio: quote.get('folio'),
          status: quote.get('status'),
          createdAt: quote.get('createdAt'),
          total: quote.get('total') || 0,
          currency: quote.get('currency') || 'MXN',
        },
        reminder: {
          type: templateType,
          count: reminderCount + 1,
          maxReminders: reminder.getMaxReminders(),
        },
        company: {
          name: 'Amexing Experience',
          website: 'https://amexing.com',
          phone: '+52 999 123 4567',
          email: 'cotizaciones@amexing.com',
        },
      };

      // Send email using appropriate template
      const emailResult = await this.emailService.sendQuoteReminder(emailData, templateType);

      // Update reminder with email sent record
      reminder.addEmailSent({
        emailLogId: emailResult.id,
        recipientEmail: emailData.to,
        sentAt: new Date(),
      });

      // Schedule next reminder
      reminder.scheduleNextReminder();
      await reminder.save(null, { useMasterKey: true });

      logger.info('Reminder email sent successfully', {
        reminderId: reminder.id,
        quoteId: quote.id,
        emailLogId: emailResult.id,
        templateType,
        nextReminderDate: reminder.getNextReminderDate(),
      });

      return emailResult;
    } catch (error) {
      logger.error('Error sending reminder email:', {
        reminderId: reminder?.id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get appropriate email template type based on reminder count.
   * @param {number} reminderCount - Current reminder count.
   * @returns {string} Template type.
   * @example
   * const templateType = reminderService.getTemplateType(2);
   */
  getTemplateType(reminderCount) {
    if (reminderCount === 0) {
      return 'initial';
    } if (reminderCount < 4) {
      return 'follow_up';
    }
    return 'final';
  }

  /**
   * Get reminder statistics for a specific quote.
   * @param {object} quote - Quote Parse object.
   * @returns {Promise<object>} Reminder statistics.
   * @example
   * const stats = await reminderService.getReminderStats(quote);
   */
  async getReminderStats(quote) {
    try {
      const reminders = await QuoteReminder.findByQuote(quote);

      const stats = {
        totalReminders: reminders.length,
        activeReminders: 0,
        completedReminders: 0,
        cancelledReminders: 0,
        totalEmailsSent: 0,
        lastReminderDate: null,
        nextReminderDate: null,
      };

      for (const reminder of reminders) {
        const status = reminder.getStatus();
        const emailsSent = reminder.getEmailsSent();

        stats.totalEmailsSent += emailsSent.length;

        if (status === 'pending' && reminder.get('active')) {
          stats.activeReminders++;
          const nextDate = reminder.getNextReminderDate();
          if (!stats.nextReminderDate || (nextDate && nextDate < stats.nextReminderDate)) {
            stats.nextReminderDate = nextDate;
          }
        } else if (status === 'completed') {
          stats.completedReminders++;
        } else if (status === 'cancelled') {
          stats.cancelledReminders++;
        }

        if (emailsSent.length > 0) {
          const lastEmail = emailsSent[emailsSent.length - 1];
          if (!stats.lastReminderDate || lastEmail.sentAt > stats.lastReminderDate) {
            stats.lastReminderDate = lastEmail.sentAt;
          }
        }
      }

      return stats;
    } catch (error) {
      logger.error('Error getting reminder stats:', {
        error: error.message,
        quoteId: quote?.id,
      });
      throw error;
    }
  }

  /**
   * Manually trigger reminder for a quote (admin function).
   * @param {object} quote - Quote Parse object.
   * @param {object} options - Manual trigger options.
   * @returns {Promise<object>} Send result.
   * @example
   * const result = await reminderService.sendManualReminder(quote, {
   *   templateType: 'follow_up',
   *   note: 'Manual reminder requested by admin'
   * });
   */
  async sendManualReminder(quote, options = {}) {
    try {
      // Find or create reminder for this quote
      let reminder = (await QuoteReminder.findByQuote(quote))[0];

      if (!reminder) {
        // Create temporary reminder for manual send
        reminder = QuoteReminder.create({
          quote,
          reminderType: options.templateType || 'follow_up',
          maxReminders: 1,
          notes: 'Manual reminder created',
        });
        await reminder.save(null, { useMasterKey: true });
      }

      // Add manual note if provided
      if (options.note) {
        const currentNotes = reminder.getNotes();
        reminder.setNotes(`${currentNotes}\nManual: ${options.note}`);
        await reminder.save(null, { useMasterKey: true });
      }

      // Send the reminder
      const result = await this.sendReminderEmail(reminder);

      logger.info('Manual reminder sent', {
        reminderId: reminder.id,
        quoteId: quote.id,
        templateType: options.templateType,
        adminNote: options.note,
      });

      return result;
    } catch (error) {
      logger.error('Error sending manual reminder:', {
        error: error.message,
        quoteId: quote?.id,
      });
      throw error;
    }
  }

  /**
   * Pause reminders for a quote temporarily.
   * @param {object} quote - Quote Parse object.
   * @param {number} pauseDays - Days to pause (default: 7).
   * @param {string} reason - Pause reason.
   * @returns {Promise<number>} Number of reminders paused.
   * @example
   * await reminderService.pauseReminders(quote, 14, 'Client requested delay');
   */
  async pauseReminders(quote, pauseDays = 7, reason = '') {
    try {
      const activeReminders = await QuoteReminder.findByQuote(quote);

      for (const reminder of activeReminders) {
        if (reminder.getStatus() === 'pending') {
          // Extend next reminder date
          const currentDate = reminder.getNextReminderDate() || new Date();
          const pausedDate = new Date(currentDate);
          pausedDate.setDate(pausedDate.getDate() + pauseDays);

          reminder.setNextReminderDate(pausedDate);
          reminder.setNotes(`${reminder.getNotes()}\nPaused: ${reason} (${pauseDays} days)`);

          await reminder.save(null, { useMasterKey: true });
        }
      }

      logger.info('Reminders paused for quote', {
        quoteId: quote.id,
        pauseDays,
        reason,
        remindersCount: activeReminders.length,
      });

      return activeReminders.length;
    } catch (error) {
      logger.error('Error pausing reminders:', {
        error: error.message,
        quoteId: quote?.id,
      });
      throw error;
    }
  }
}

module.exports = QuoteReminderService;
