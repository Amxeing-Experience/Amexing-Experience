/**
 * Email Service - MailerSend Integration.
 *
 * PCI DSS compliant email service using MailerSend API
 * Handles transactional emails with proper security measures.
 *
 * Created by Denisse Maldonado.
 */

const {
  MailerSend, EmailParams, Sender, Recipient,
} = require('mailersend');
const logger = require('../../infrastructure/logger');
const TemplateService = require('../../infrastructure/email/TemplateService');

// Lazy load EmailLog to avoid Parse initialization issues in unit tests
let EmailLog;
const getEmailLog = () => {
  if (!EmailLog) {
    // eslint-disable-next-line global-require
    EmailLog = require('../../domain/models/EmailLog');
  }
  return EmailLog;
};

class EmailService {
  constructor() {
    this.mailerSend = null;
    this.isInitialized = false;
    this.init();
  }

  /**
   * Initialize MailerSend client with API token.
   * @example
   */
  init() {
    try {
      const apiToken = process.env.MAILERSEND_API_TOKEN;

      if (!apiToken || apiToken === 'your-mailersend-api-token-change-this') {
        logger.warn('MailerSend API token not configured. Email service will be disabled.');
        return;
      }

      this.mailerSend = new MailerSend({
        apiKey: apiToken,
      });

      this.isInitialized = true;
      logger.info('MailerSend email service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize MailerSend service:', error);
      this.isInitialized = false;
    }
  }

  /**
   * Check if email service is available.
   * @returns {boolean} True if service is initialized and ready.
   * @example
   */
  isAvailable() {
    return this.isInitialized && this.mailerSend !== null;
  }

  /**
   * Send email using MailerSend with email traceability.
   * @param {object} emailData - Email configuration.
   * @param {string} emailData.to - Recipient email address.
   * @param {string} emailData.toName - Recipient name (optional).
   * @param {string} emailData.subject - Email subject.
   * @param {string} emailData.text - Plain text content (optional).
   * @param {string} emailData.html - HTML content.
   * @param {string} emailData.from - Sender email (optional, uses default).
   * @param {string} emailData.fromName - Sender name (optional, uses default).
   * @param {Array} emailData.tags - Email tags for tracking (optional).
   * @param {string} emailData.notificationType - Type of notification (e.g., 'booking_confirmation').
   * @param {object} emailData.recipientUser - Parse.Object AmexingUser pointer (optional).
   * @param {object} emailData.metadata - Additional metadata for tracking (optional).
   * @returns {Promise<object>} Send result.
   * @example
   */
  async sendEmail(emailData) {
    try {
      if (!this.isAvailable()) {
        throw new Error('Email service is not available. Check MailerSend configuration.');
      }

      const {
        to, toName, subject, text, html, from, fromName, tags,
        notificationType, recipientUser, metadata,
      } = emailData;

      // Validate required fields
      if (!to || !subject || (!text && !html)) {
        throw new Error('Missing required email fields: to, subject, and content (text or html)');
      }

      // Create email parameters
      const emailParams = new EmailParams()
        .setFrom(new Sender(
          from || process.env.EMAIL_FROM || 'noreply@amexing.com',
          fromName || process.env.EMAIL_FROM_NAME || 'Amexing System'
        ))
        .setTo([new Recipient(to, toName || '')])
        .setSubject(subject);

      // Set content
      if (html) {
        emailParams.setHtml(html);
      }
      if (text) {
        emailParams.setText(text);
      }

      // Add tags if provided
      if (tags && Array.isArray(tags)) {
        emailParams.setTags(tags);
      }

      // Send email
      const result = await this.mailerSend.email.send(emailParams);
      const messageId = result.body?.message_id || null;

      // Log email to database for traceability
      await this.logEmailSent({
        messageId,
        recipientEmail: to,
        recipientUser,
        notificationType: notificationType || 'generic',
        subject,
        htmlContent: html || '',
        textContent: text || '',
        status: 'sent',
        metadata: metadata || {},
        tags: tags || [],
      });

      // Log success (without sensitive data)
      logger.info('Email sent successfully', {
        messageId,
        to: this.maskEmail(to),
        subject,
        notificationType,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        messageId,
        data: result.body,
      };
    } catch (error) {
      // Log failed email attempt to database
      try {
        await this.logEmailSent({
          messageId: null,
          recipientEmail: emailData.to,
          recipientUser: emailData.recipientUser,
          notificationType: emailData.notificationType || 'generic',
          subject: emailData.subject,
          htmlContent: emailData.html || '',
          textContent: emailData.text || '',
          status: 'failed',
          metadata: emailData.metadata || {},
          tags: emailData.tags || [],
          error: error.message,
        });
      } catch (logError) {
        logger.error('Failed to log email error', {
          error: logError.message,
        });
      }

      // Log error (without sensitive data)
      logger.error('Failed to send email', {
        error: error.message,
        to: emailData.to ? this.maskEmail(emailData.to) : 'unknown',
        subject: emailData.subject || 'unknown',
        timestamp: new Date().toISOString(),
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Log email to EmailLog for traceability.
   * @param {object} logData - Email log data.
   * @returns {Promise<Parse.Object>} Created EmailLog.
   * @private
   * @example
   */
  async logEmailSent(logData) {
    try {
      const emailLog = getEmailLog().create(logData);
      await emailLog.save(null, { useMasterKey: true });

      logger.debug('Email logged successfully', {
        emailLogId: emailLog.id,
        recipientEmail: this.maskEmail(logData.recipientEmail),
        notificationType: logData.notificationType,
        status: logData.status,
      });

      return emailLog;
    } catch (error) {
      logger.error('Failed to log email', {
        error: error.message,
        recipientEmail: this.maskEmail(logData.recipientEmail),
      });
      throw error;
    }
  }

  /**
   * Send welcome email to new users using template.
   * @param {object} userData - User data.
   * @param {string} userData.email - User email.
   * @param {string} userData.name - User name.
   * @param {string} userData.role - User role (optional).
   * @param {object} userData.recipientUser - AmexingUser pointer (optional).
   * @param {string} userData.dashboardUrl - Dashboard URL (optional).
   * @returns {Promise<object>} Send result.
   * @example
   * await emailService.sendWelcomeEmail({
   *   email: 'user@example.com',
   *   name: 'Juan Pérez',
   *   role: 'Client',
   *   dashboardUrl: 'https://amexing.com/dashboard'
   * });
   */
  async sendWelcomeEmail(userData) {
    try {
      const {
        email, name, role, recipientUser, dashboardUrl,
      } = userData;

      // Prepare template variables
      const templateVariables = {
        ...TemplateService.getCommonVariables(),
        NOMBRE_USUARIO: name,
        EMAIL_USUARIO: email,
        TIPO_CUENTA: role || 'Cliente',
        URL_DASHBOARD: dashboardUrl || process.env.APP_BASE_URL || 'http://localhost:1337',
      };

      // Render template
      const { html, text } = TemplateService.render(
        'welcome',
        templateVariables,
        { includeText: true }
      );

      // Send email
      return await this.sendEmail({
        to: email,
        toName: name,
        subject: '¡Bienvenido a Amexing Experience!',
        html,
        text,
        tags: ['welcome', 'onboarding', 'registration'],
        notificationType: 'welcome',
        recipientUser,
        metadata: {
          role,
          registrationDate: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error('Failed to send welcome email', {
        error: error.message,
        email: this.maskEmail(userData.email),
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send password reset email using template.
   * @param {object} resetData - Reset data.
   * @param {string} resetData.email - User email.
   * @param {string} resetData.name - User name.
   * @param {string} resetData.resetUrl - Reset URL.
   * @param {object} resetData.recipientUser - AmexingUser pointer (optional).
   * @param {string} resetData.expirationTime - Token expiration time (default: '1 hora').
   * @returns {Promise<object>} Send result.
   * @example
   * await emailService.sendPasswordResetEmail({
   *   email: 'user@example.com',
   *   name: 'Juan Pérez',
   *   resetUrl: 'https://amexing.com/reset-password?token=abc123',
   *   expirationTime: '1 hora'
   * });
   */
  async sendPasswordResetEmail(resetData) {
    try {
      const {
        email, name, resetUrl, recipientUser, expirationTime,
      } = resetData;

      // Prepare template variables
      const templateVariables = {
        ...TemplateService.getCommonVariables(),
        NOMBRE_USUARIO: name,
        URL_RESET: resetUrl,
        TIEMPO_EXPIRACION: expirationTime || '1 hora',
      };

      // Render template
      const { html, text } = TemplateService.render(
        'password_reset',
        templateVariables,
        { includeText: true }
      );

      // Send email
      return await this.sendEmail({
        to: email,
        toName: name,
        subject: 'Restablecer Contraseña - Amexing Experience',
        html,
        text,
        tags: ['password-reset', 'security', 'transactional'],
        notificationType: 'password_reset',
        recipientUser,
        metadata: {
          resetRequestedAt: new Date().toISOString(),
          expirationTime: expirationTime || '1 hora',
        },
      });
    } catch (error) {
      logger.error('Failed to send password reset email', {
        error: error.message,
        email: this.maskEmail(resetData.email),
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send email verification email.
   * @param {object} verificationData - Verification data.
   * @param {string} verificationData.email - User email.
   * @param {string} verificationData.name - User name.
   * @param {string} verificationData.verificationUrl - Verification URL.
   * @returns {Promise<object>} Send result.
   * @example
   */
  async sendEmailVerification(verificationData) {
    const { email, name, verificationUrl } = verificationData;

    const emailData = {
      to: email,
      toName: name,
      subject: 'Verify Your Email Address - Amexing System',
      html: this.generateEmailVerificationHTML(name, verificationUrl),
      text: this.generateEmailVerificationText(name, verificationUrl),
      tags: ['email-verification', 'security'],
    };

    return this.sendEmail(emailData);
  }

  /**
   * Mask email address for logging (PCI DSS compliance).
   * @param {string} email - Email address.
   * @returns {string} Masked email.
   * @example
   */
  maskEmail(email) {
    if (!email || typeof email !== 'string' || !email.includes('@')) return '***';

    const [localPart, domain] = email.split('@');
    if (!localPart || !domain) return '***';

    // For emails with 3+ characters in local part: first + ** + last
    // For emails with 1-2 characters: *** (no domain shown for short emails)
    const maskedLocal = localPart.length > 2
      ? `${localPart[0]}**${localPart[localPart.length - 1]}`
      : '***';

    return `${maskedLocal}@${domain}`;
  }

  /**
   * Generate welcome email HTML template.
   * @param {string} name - User name.
   * @param {string} role - User role.
   * @returns {string} HTML content.
   * @example
   */
  generateWelcomeEmailHTML(name, role) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Amexing System</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #f8f9fa; padding: 30px; border-radius: 10px;">
          <h1 style="color: #007bff; margin-bottom: 30px;">Welcome to Amexing System</h1>
          
          <p>Dear ${name || 'User'},</p>
          
          <p>Welcome to the Amexing System! We're excited to have you on board.</p>
          
          ${role ? `<p>You have been granted <strong>${role}</strong> access to the system.</p>` : ''}
          
          <p>You can now access the system and start using all the available features.</p>
          
          <div style="margin: 30px 0; padding: 20px; background: #e9f4ff; border-left: 4px solid #007bff; border-radius: 5px;">
            <p style="margin: 0;"><strong>Next Steps:</strong></p>
            <ul style="margin: 10px 0;">
              <li>Complete your profile setup</li>
              <li>Familiarize yourself with the dashboard</li>
              <li>Contact support if you need any assistance</li>
            </ul>
          </div>
          
          <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
          
          <p>Best regards,<br>The Amexing Team</p>
          
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
          <p style="font-size: 12px; color: #666;">
            This is an automated message from Amexing System. Please do not reply to this email.
          </p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate welcome email text template.
   * @param {string} name - User name.
   * @param {string} role - User role.
   * @returns {string} Text content.
   * @example
   */
  generateWelcomeEmailText(name, role) {
    return `
Welcome to Amexing System

Dear ${name || 'User'},

Welcome to the Amexing System! We're excited to have you on board.

${role ? `You have been granted ${role} access to the system.\n` : ''}

You can now access the system and start using all the available features.

Next Steps:
- Complete your profile setup
- Familiarize yourself with the dashboard
- Contact support if you need any assistance

If you have any questions or need assistance, please don't hesitate to contact our support team.

Best regards,
The Amexing Team

---
This is an automated message from Amexing System. Please do not reply to this email.
    `.trim();
  }

  /**
   * Generate password reset email HTML template.
   * @param {string} name - User name.
   * @param {string} resetUrl - Password reset URL.
   * @returns {string} HTML content.
   * @example
   */
  generatePasswordResetEmailHTML(name, resetUrl) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset Request</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #f8f9fa; padding: 30px; border-radius: 10px;">
          <h1 style="color: #dc3545; margin-bottom: 30px;">Password Reset Request</h1>
          
          <p>Dear ${name || 'User'},</p>
          
          <p>We received a request to reset your password for your Amexing System account.</p>
          
          <div style="margin: 30px 0; text-align: center;">
            <a href="${resetUrl}" style="display: inline-block; background: #007bff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
          </div>
          
          <div style="margin: 30px 0; padding: 20px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 5px;">
            <p style="margin: 0;"><strong>Security Notice:</strong></p>
            <ul style="margin: 10px 0;">
              <li>This reset link will expire in 1 hour</li>
              <li>If you didn't request this reset, please ignore this email</li>
              <li>Never share this link with anyone</li>
            </ul>
          </div>
          
          <p>If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="word-break: break-all; background: #f1f1f1; padding: 10px; border-radius: 5px; font-family: monospace;">${resetUrl}</p>
          
          <p>If you didn't request this password reset, please contact our support team immediately.</p>
          
          <p>Best regards,<br>The Amexing Security Team</p>
          
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
          <p style="font-size: 12px; color: #666;">
            This is an automated security message from Amexing System. Please do not reply to this email.
          </p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate password reset email text template.
   * @param {string} name - User name.
   * @param {string} resetUrl - Password reset URL.
   * @returns {string} Text content.
   * @example
   */
  generatePasswordResetEmailText(name, resetUrl) {
    return `
Password Reset Request

Dear ${name || 'User'},

We received a request to reset your password for your Amexing System account.

Please click the following link to reset your password:
${resetUrl}

Security Notice:
- This reset link will expire in 1 hour
- If you didn't request this reset, please ignore this email
- Never share this link with anyone

If you didn't request this password reset, please contact our support team immediately.

Best regards,
The Amexing Security Team

---
This is an automated security message from Amexing System. Please do not reply to this email.
    `.trim();
  }

  /**
   * Generate email verification HTML template.
   * @param {string} name - User name.
   * @param {string} verificationUrl - Email verification URL.
   * @returns {string} HTML content.
   * @example
   */
  generateEmailVerificationHTML(name, verificationUrl) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Email Address</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #f8f9fa; padding: 30px; border-radius: 10px;">
          <h1 style="color: #28a745; margin-bottom: 30px;">Verify Your Email Address</h1>
          
          <p>Dear ${name || 'User'},</p>
          
          <p>Thank you for creating an account with Amexing System. To complete your registration, please verify your email address.</p>
          
          <div style="margin: 30px 0; text-align: center;">
            <a href="${verificationUrl}" style="display: inline-block; background: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Verify Email Address</a>
          </div>
          
          <div style="margin: 30px 0; padding: 20px; background: #d4edda; border-left: 4px solid #28a745; border-radius: 5px;">
            <p style="margin: 0;"><strong>Important:</strong></p>
            <ul style="margin: 10px 0;">
              <li>This verification link will expire in 24 hours</li>
              <li>Your account will have limited access until verified</li>
              <li>Contact support if you need a new verification link</li>
            </ul>
          </div>
          
          <p>If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="word-break: break-all; background: #f1f1f1; padding: 10px; border-radius: 5px; font-family: monospace;">${verificationUrl}</p>
          
          <p>If you didn't create this account, please ignore this email or contact our support team.</p>
          
          <p>Best regards,<br>The Amexing Team</p>
          
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
          <p style="font-size: 12px; color: #666;">
            This is an automated message from Amexing System. Please do not reply to this email.
          </p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate email verification text template.
   * @param {string} name - User name.
   * @param {string} verificationUrl - Email verification URL.
   * @returns {string} Text content.
   * @example
   */
  generateEmailVerificationText(name, verificationUrl) {
    return `
Verify Your Email Address

Dear ${name || 'User'},

Thank you for creating an account with Amexing System. To complete your registration, please verify your email address.

Please click the following link to verify your email:
${verificationUrl}

Important:
- This verification link will expire in 24 hours
- Your account will have limited access until verified
- Contact support if you need a new verification link

If you didn't create this account, please ignore this email or contact our support team.

Best regards,
The Amexing Team

---
This is an automated message from Amexing System. Please do not reply to this email.
    `.trim();
  }

  /**
   * Send booking confirmation email using template.
   * @param {object} bookingData - Booking information.
   * @param {string} bookingData.recipientEmail - Recipient email address.
   * @param {string} bookingData.recipientName - Recipient name.
   * @param {object} bookingData.recipientUser - AmexingUser pointer (optional).
   * @param {string} bookingData.bookingNumber - Booking/reservation number.
   * @param {string} bookingData.serviceType - Type of service.
   * @param {string} bookingData.date - Service date.
   * @param {string} bookingData.time - Service time.
   * @param {string} bookingData.location - Pickup/meeting location.
   * @param {string} bookingData.buttonUrl - Call-to-action button URL (optional).
   * @param {string} bookingData.buttonText - Call-to-action button text (optional).
   * @param {string} bookingData.additionalMessage - Additional message (optional).
   * @param {object} bookingData.metadata - Additional metadata for tracking.
   * @returns {Promise<object>} Send result.
   * @example
   * await emailService.sendBookingConfirmation({
   *   recipientEmail: 'client@example.com',
   *   recipientName: 'Juan Pérez',
   *   bookingNumber: 'AMX-12345',
   *   serviceType: 'Traslado Aeropuerto',
   *   date: '25 de enero, 2025',
   *   time: '10:00 AM',
   *   location: 'Hotel Rosewood',
   *   metadata: { bookingId: 'abc123', quoteId: 'xyz789' }
   * });
   */
  async sendBookingConfirmation(bookingData) {
    try {
      const {
        recipientEmail,
        recipientName,
        recipientUser,
        bookingNumber,
        serviceType,
        date,
        time,
        location,
        buttonUrl,
        buttonText,
        additionalMessage,
        metadata,
      } = bookingData;

      // Prepare template variables
      const templateVariables = {
        ...TemplateService.getCommonVariables(),
        ASUNTO: 'Confirmación de Reserva',
        TITULO_PRINCIPAL: 'Confirmación de Reserva',
        NOMBRE_CLIENTE: recipientName,
        CONTENIDO_MENSAJE: `
          <p>¡Gracias por reservar con Amexing Experience!</p>
          <p>Nos complace confirmar su reserva. A continuación encontrará los detalles de su servicio:</p>
        `,
        NUMERO_RESERVA: bookingNumber,
        TIPO_SERVICIO: serviceType,
        FECHA: date,
        HORA: time,
        LUGAR: location,
        URL_BOTON: buttonUrl || '#',
        TEXTO_BOTON: buttonText || 'Ver Detalles de Reserva',
        MENSAJE_ADICIONAL: additionalMessage || 'Si tiene alguna pregunta o necesita hacer cambios, no dude en contactarnos.',
      };

      // Render template
      const { html, text } = TemplateService.render(
        'booking_confirmation',
        templateVariables,
        { includeText: true }
      );

      // Send email
      return await this.sendEmail({
        to: recipientEmail,
        toName: recipientName,
        subject: `Confirmación de Reserva ${bookingNumber} - Amexing Experience`,
        html,
        text,
        tags: ['booking', 'confirmation', 'transactional'],
        notificationType: 'booking_confirmation',
        recipientUser,
        metadata: {
          ...metadata,
          bookingNumber,
          serviceType,
          date,
          time,
        },
      });
    } catch (error) {
      logger.error('Failed to send booking confirmation email', {
        error: error.message,
        recipientEmail: this.maskEmail(bookingData.recipientEmail),
        bookingNumber: bookingData.bookingNumber,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get email history for a user.
   * @param {string} userId - AmexingUser objectId.
   * @param {object} options - Query options.
   * @returns {Promise<Array>} Email logs.
   * @example
   * const emails = await emailService.getEmailHistory(userId, { limit: 50 });
   */
  async getEmailHistory(userId, options = {}) {
    try {
      return await getEmailLog().getByRecipient(userId, options);
    } catch (error) {
      logger.error('Failed to retrieve email history', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Resend an email from EmailLog.
   * @param {string} emailLogId - EmailLog objectId.
   * @returns {Promise<object>} Send result.
   * @example
   * await emailService.resendEmail('abc123');
   */
  async resendEmail(emailLogId) {
    try {
      const Parse = require('parse/node');
      const query = new Parse.Query('EmailLog');
      const emailLog = await query.get(emailLogId, { useMasterKey: true });

      if (!emailLog) {
        throw new Error('Email log not found');
      }

      // Resend using original data
      return await this.sendEmail({
        to: emailLog.get('recipientEmail'),
        subject: `[Reenvío] ${emailLog.get('subject')}`,
        html: emailLog.get('htmlContent'),
        text: emailLog.get('textContent'),
        tags: ['resend', ...(emailLog.get('tags') || [])],
        notificationType: emailLog.get('notificationType'),
        recipientUser: emailLog.get('recipientUser'),
        metadata: {
          ...emailLog.get('metadata'),
          resendFrom: emailLogId,
          resendAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error('Failed to resend email', {
        emailLogId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = new EmailService();
