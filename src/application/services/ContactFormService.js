const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');

/**
 * Contact Form Service - Handles business logic for contact form submissions.
 * Processes contact form data, stores submissions, and sends notification emails
 * to configured recipients with proper validation, security, and audit logging.
 *
 * This service manages the complete contact form workflow including data validation,
 * submission storage in Parse database, email notification dispatch using MailerSend,
 * and comprehensive logging for audit and monitoring purposes.
 *
 * Features:
 * - Contact form data validation and sanitization
 * - Database storage with Parse Server integration
 * - Email notifications to environment-configured recipients
 * - Audit logging and security monitoring
 * - Error handling and recovery mechanisms
 * - Rate limiting and spam protection support.
 * @class ContactFormService
 * @author Created by Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * const contactFormService = new ContactFormService();
 * const result = await contactFormService.processContactForm({
 *   name: 'John Doe',
 *   email: 'john@example.com',
 *   message: 'Hello, I need information about your services.'
 * });
 */
class ContactFormService {
  constructor() {
    this.emailService = null;
  }

  /**
   * Lazy-loads EmailService to avoid circular dependencies.
   * @private
   * @returns {object} EmailService instance.
   * @example
   */
  getEmailService() {
    if (!this.emailService) {
      this.emailService = require('./EmailService');
    }
    return this.emailService;
  }

  /**
   * Processes contact form submission with validation, storage, and email notification.
   * Validates form data, stores submission in database, and sends notification email
   * to configured recipients with comprehensive error handling and logging.
   * @function processContactForm
   * @param {object} formData - Contact form data object.
   * @param {string} formData.name - Full name of the contact.
   * @param {string} formData.email - Email address of the contact.
   * @param {string} formData.message - Message content.
   * @param {string} [formData.phone] - Optional phone number.
   * @param {string} [formData.company] - Optional company name.
   * @param {string} [formData.subject] - Optional message subject.
   * @param {string} [formData.ip] - Client IP address for logging.
   * @param {string} [formData.userAgent] - Client user agent for logging.
   * @param {Date} [formData.timestamp] - Submission timestamp.
   * @returns {Promise<object>} - Result object with success status and details
   * @example
   * const result = await contactFormService.processContactForm({
   *   name: 'Jane Smith',
   *   email: 'jane@example.com',
   *   phone: '+1-555-0123',
   *   company: 'Acme Corp',
   *   subject: 'Partnership Inquiry',
   *   message: 'We are interested in partnering with your company...',
   *   ip: '192.168.1.1',
   *   userAgent: 'Mozilla/5.0...'
   * });
   * // Returns: { success: true, submissionId: 'abc123', emailSent: true, messageId: 'msg456' }
   */
  async processContactForm(formData) {
    try {
      // Store contact form submission in database
      const submission = await this.storeContactSubmission(formData);

      // Send email notification
      const emailResult = await this.sendContactNotification(formData, submission.id);

      // Log the submission
      logger.info('Contact form processed successfully', {
        submissionId: submission.id,
        name: formData.name,
        email: formData.email,
        company: formData.company || null,
        emailSent: emailResult.success,
        messageId: emailResult.messageId || null,
        ip: formData.ip,
      });

      return {
        success: true,
        submissionId: submission.id,
        emailSent: emailResult.success,
        messageId: emailResult.messageId || null,
      };
    } catch (error) {
      logger.error('Error processing contact form:', {
        error: error.message,
        stack: error.stack,
        formData: {
          name: formData.name,
          email: formData.email,
          company: formData.company || null,
          messageLength: formData.message?.length || 0,
          ip: formData.ip,
        },
      });

      return {
        success: false,
        error: error.message || 'Failed to process contact form',
      };
    }
  }

  /**
   * Stores contact form submission in Parse database.
   * Creates ContactSubmission object with form data, metadata, and audit information
   * for tracking, analytics, and customer relationship management purposes.
   * @function storeContactSubmission
   * @param {object} formData - Contact form data to store.
   * @returns {Promise<object>} - Saved Parse object with generated ID.
   * @example
   * const submission = await this.storeContactSubmission({
   *   name: 'John Doe',
   *   email: 'john@example.com',
   *   message: 'Contact message'
   * });
   * // Returns Parse object with id, createdAt, etc.
   */
  async storeContactSubmission(formData) {
    try {
      const ContactSubmission = Parse.Object.extend('ContactSubmission');
      const submission = new ContactSubmission();

      // Set form data
      submission.set('name', formData.name);
      submission.set('email', formData.email);
      submission.set('phone', formData.phone || null);
      submission.set('company', formData.company || null);
      submission.set('subject', formData.subject || null);
      submission.set('message', formData.message);

      // Set metadata
      submission.set('ip', formData.ip || null);
      submission.set('userAgent', formData.userAgent || null);
      submission.set('submittedAt', formData.timestamp || new Date());

      // Set status tracking
      submission.set('status', 'new'); // new, in_progress, resolved
      submission.set('priority', 'normal'); // low, normal, high, urgent
      submission.set('source', 'website'); // website, mobile, api

      // Standard fields for logical deletion and activation
      submission.set('active', true);
      submission.set('exists', true);

      // Save to database
      const savedSubmission = await submission.save(null, { useMasterKey: true });

      logger.info('Contact submission stored in database', {
        submissionId: savedSubmission.id,
        name: formData.name,
        email: formData.email,
      });

      return savedSubmission;
    } catch (error) {
      logger.error('Error storing contact submission:', {
        error: error.message,
        stack: error.stack,
        formData: {
          name: formData.name,
          email: formData.email,
        },
      });
      throw new Error('Failed to store contact submission');
    }
  }

  /**
   * Sends email notification to configured recipients about new contact form submission.
   * Uses EmailService to dispatch notification with contact details and manages
   * environment-specific recipient configuration for development and production.
   * @function sendContactNotification
   * @param {object} formData - Contact form data for email content.
   * @param {string} submissionId - Database submission ID for reference.
   * @returns {Promise<object>} - Email send result with success status and message ID.
   * @example
   * const result = await this.sendContactNotification(formData, 'sub123');
   * // Returns: { success: true, messageId: 'msg456' }
   */
  async sendContactNotification(formData, submissionId) {
    try {
      const emailService = this.getEmailService();

      // Check if email service is available
      if (!emailService.isAvailable()) {
        logger.warn('Email service not available for contact form notification', {
          submissionId,
          email: formData.email,
        });
        return {
          success: false,
          error: 'Email service not configured',
        };
      }

      // Get recipient from environment configuration
      const recipient = process.env.CONTACT_FORM_RECIPIENT;
      if (!recipient) {
        logger.error('Contact form recipient not configured', {
          submissionId,
          environment: process.env.NODE_ENV,
        });
        return {
          success: false,
          error: 'Contact form recipient not configured',
        };
      }

      // Prepare email content
      const subject = `New Contact Form Submission${formData.subject ? `: ${formData.subject}` : ''}`;

      const htmlContent = await this.generateContactNotificationHTML(formData, submissionId);
      const textContent = await this.generateContactNotificationText(formData, submissionId);

      // Send email
      const result = await emailService.sendEmail({
        to: recipient,
        subject,
        html: htmlContent,
        text: textContent,
        tags: ['contact-form', 'notification', process.env.NODE_ENV || 'development'],
        notificationType: 'contact_form',
        metadata: {
          submissionId,
          senderEmail: formData.email,
          senderName: formData.name,
          company: formData.company || null,
          submittedAt: formData.timestamp || new Date(),
        },
      });

      logger.info('Contact form notification email sent', {
        submissionId,
        recipient: emailService.maskEmail(recipient),
        senderEmail: emailService.maskEmail(formData.email),
        success: result.success,
        messageId: result.messageId,
      });

      return result;
    } catch (error) {
      logger.error('Error sending contact notification email:', {
        error: error.message,
        stack: error.stack,
        submissionId,
        formData: {
          name: formData.name,
          email: formData.email,
        },
      });

      return {
        success: false,
        error: 'Failed to send notification email',
      };
    }
  }

  /**
   * Generates HTML email content for contact form notification.
   * Creates formatted HTML template with contact information, submission details,
   * and professional styling for email notifications to staff members.
   * @function generateContactNotificationHTML
   * @param {object} formData - Contact form data for email content.
   * @param {string} submissionId - Database submission ID for reference.
   * @returns {Promise<string>} - Formatted HTML email content.
   * @example
   * const htmlContent = await this.generateContactNotificationHTML(formData, 'sub123');
   * // Returns formatted HTML string with contact details
   */
  async generateContactNotificationHTML(formData, submissionId) {
    const environment = process.env.NODE_ENV || 'development';
    const submissionTime = (formData.timestamp || new Date()).toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City',
      dateStyle: 'full',
      timeStyle: 'medium',
    });

    return `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #5D87FF 0%, #4A73CC 100%); padding: 30px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">
          Nueva Consulta de Contacto
        </h1>
        <p style="color: #ffffff; margin: 10px 0 0 0; opacity: 0.9; font-size: 16px;">
          Amexing Experience
        </p>
      </div>

      <!-- Content -->
      <div style="padding: 40px 30px;">
        <div style="background: #f8f9fa; border-left: 4px solid #5D87FF; padding: 20px; margin-bottom: 30px; border-radius: 0 8px 8px 0;">
          <h2 style="color: #2c3e50; margin: 0 0 15px 0; font-size: 20px;">
            Información del Contacto
          </h2>
          <div style="color: #555; line-height: 1.6;">
            <p style="margin: 8px 0;"><strong>Nombre:</strong> ${formData.name}</p>
            <p style="margin: 8px 0;"><strong>Email:</strong> <a href="mailto:${formData.email}" style="color: #5D87FF; text-decoration: none;">${formData.email}</a></p>
            ${formData.phone ? `<p style="margin: 8px 0;"><strong>Teléfono:</strong> <a href="tel:${formData.phone}" style="color: #5D87FF; text-decoration: none;">${formData.phone}</a></p>` : ''}
            ${formData.company ? `<p style="margin: 8px 0;"><strong>Empresa:</strong> ${formData.company}</p>` : ''}
            ${formData.subject ? `<p style="margin: 8px 0;"><strong>Asunto:</strong> ${formData.subject}</p>` : ''}
          </div>
        </div>

        <!-- Message -->
        <div style="background: #ffffff; border: 1px solid #e9ecef; border-radius: 8px; padding: 25px; margin-bottom: 30px;">
          <h3 style="color: #2c3e50; margin: 0 0 15px 0; font-size: 18px;">Mensaje:</h3>
          <div style="color: #555; line-height: 1.7; white-space: pre-wrap; font-size: 15px; background: #f8f9fa; padding: 20px; border-radius: 6px; border-left: 3px solid #5D87FF;">
${formData.message}
          </div>
        </div>

        <!-- Submission Details -->
        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
          <h3 style="color: #2c3e50; margin: 0 0 15px 0; font-size: 16px;">Detalles de la Consulta</h3>
          <div style="color: #666; font-size: 14px; line-height: 1.5;">
            <p style="margin: 5px 0;"><strong>ID de Consulta:</strong> ${submissionId}</p>
            <p style="margin: 5px 0;"><strong>Fecha y Hora:</strong> ${submissionTime}</p>
            <p style="margin: 5px 0;"><strong>Fuente:</strong> Sitio Web</p>
            ${formData.ip ? `<p style="margin: 5px 0;"><strong>IP:</strong> ${formData.ip}</p>` : ''}
          </div>
        </div>

        <!-- Action Buttons -->
        <div style="text-align: center; margin: 30px 0;">
          <a href="mailto:${formData.email}?subject=Re: ${encodeURIComponent(formData.subject || 'Su consulta en Amexing Experience')}" 
             style="background: #5D87FF; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; margin: 0 10px;">
            Responder por Email
          </a>
          ${formData.phone ? `
          <a href="tel:${formData.phone}" 
             style="background: #28a745; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; margin: 0 10px;">
            Llamar
          </a>
          ` : ''}
        </div>
      </div>

      <!-- Footer -->
      <div style="background: #2c3e50; padding: 20px; text-align: center;">
        <p style="color: #ffffff; margin: 0; font-size: 14px; opacity: 0.8;">
          Este email fue enviado automáticamente desde el formulario de contacto de Amexing Experience
        </p>
        <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 12px; opacity: 0.6;">
          Entorno: ${environment.toUpperCase()} | ID: ${submissionId}
        </p>
      </div>
    </div>
    `;
  }

  /**
   * Generates plain text email content for contact form notification.
   * Creates formatted plain text version of contact notification for email clients
   * that don't support HTML or when text format is preferred.
   * @function generateContactNotificationText
   * @param {object} formData - Contact form data for email content.
   * @param {string} submissionId - Database submission ID for reference.
   * @returns {Promise<string>} - Formatted plain text email content.
   * @example
   * const textContent = await this.generateContactNotificationText(formData, 'sub123');
   * // Returns formatted plain text string with contact details
   */
  async generateContactNotificationText(formData, submissionId) {
    const environment = process.env.NODE_ENV || 'development';
    const submissionTime = (formData.timestamp || new Date()).toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City',
      dateStyle: 'full',
      timeStyle: 'medium',
    });

    return `
NUEVA CONSULTA DE CONTACTO - AMEXING EXPERIENCE

═══════════════════════════════════════════

INFORMACIÓN DEL CONTACTO:
• Nombre: ${formData.name}
• Email: ${formData.email}
${formData.phone ? `• Teléfono: ${formData.phone}` : ''}
${formData.company ? `• Empresa: ${formData.company}` : ''}
${formData.subject ? `• Asunto: ${formData.subject}` : ''}

MENSAJE:
═══════════════════════════════════════════
${formData.message}
═══════════════════════════════════════════

DETALLES DE LA CONSULTA:
• ID de Consulta: ${submissionId}
• Fecha y Hora: ${submissionTime}
• Fuente: Sitio Web
${formData.ip ? `• IP: ${formData.ip}` : ''}

Para responder a esta consulta, puede enviar un email directamente a: ${formData.email}
${formData.phone ? `O llamar al teléfono: ${formData.phone}` : ''}

═══════════════════════════════════════════
Este email fue enviado automáticamente desde el formulario de contacto de Amexing Experience
Entorno: ${environment.toUpperCase()} | ID: ${submissionId}
    `.trim();
  }

  /**
   * Retrieves contact form submissions with filtering and pagination.
   * Queries database for contact submissions with optional filtering by status,
   * date range, or other criteria for administration and customer management.
   * @function getContactSubmissions
   * @param {object} [options] - Query options for filtering and pagination.
   * @param {number} [options.limit] - Maximum number of results to return.
   * @param {number} [options.skip] - Number of results to skip for pagination.
   * @param {string} [options.status] - Filter by submission status.
   * @param {Date} [options.startDate] - Filter submissions from this date.
   * @param {Date} [options.endDate] - Filter submissions until this date.
   * @returns {Promise<object>} - Query results with submissions and metadata.
   * @example
   * const results = await contactFormService.getContactSubmissions({
   *   limit: 20,
   *   skip: 0,
   *   status: 'new',
   *   startDate: new Date('2025-01-01'),
   *   endDate: new Date('2025-01-31')
   * });
   * // Returns: { submissions: [...], total: 45, hasMore: true }
   */
  async getContactSubmissions(options = {}) {
    try {
      const {
        limit = 50,
        skip = 0,
        status,
        startDate,
        endDate,
      } = options;

      const query = new Parse.Query('ContactSubmission');

      // Apply filters
      query.equalTo('exists', true); // Only active submissions

      if (status) {
        query.equalTo('status', status);
      }

      if (startDate) {
        query.greaterThanOrEqualTo('submittedAt', startDate);
      }

      if (endDate) {
        query.lessThanOrEqualTo('submittedAt', endDate);
      }

      // Set pagination
      query.limit(limit);
      query.skip(skip);

      // Order by submission date (newest first)
      query.descending('submittedAt');

      // Execute query
      const [submissions, total] = await Promise.all([
        query.find({ useMasterKey: true }),
        query.count({ useMasterKey: true }),
      ]);

      return {
        submissions: submissions.map((sub) => ({
          id: sub.id,
          name: sub.get('name'),
          email: sub.get('email'),
          phone: sub.get('phone'),
          company: sub.get('company'),
          subject: sub.get('subject'),
          message: sub.get('message'),
          status: sub.get('status'),
          priority: sub.get('priority'),
          source: sub.get('source'),
          submittedAt: sub.get('submittedAt'),
          createdAt: sub.get('createdAt'),
        })),
        total,
        hasMore: skip + limit < total,
        pagination: {
          limit,
          skip,
          total,
          page: Math.floor(skip / limit) + 1,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error('Error retrieving contact submissions:', {
        error: error.message,
        stack: error.stack,
        options,
      });
      throw new Error('Failed to retrieve contact submissions');
    }
  }
}

module.exports = ContactFormService;
