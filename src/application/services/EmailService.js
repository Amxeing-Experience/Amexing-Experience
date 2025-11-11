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
   * Send email using MailerSend.
   * @param {object} emailData - Email configuration.
   * @param {string} emailData.to - Recipient email address.
   * @param {string} emailData.toName - Recipient name (optional).
   * @param {string} emailData.subject - Email subject.
   * @param {string} emailData.text - Plain text content (optional).
   * @param {string} emailData.html - HTML content.
   * @param {string} emailData.from - Sender email (optional, uses default).
   * @param {string} emailData.fromName - Sender name (optional, uses default).
   * @param {Array} emailData.tags - Email tags for tracking (optional).
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

      // Log success (without sensitive data)
      logger.info('Email sent successfully', {
        messageId: result.body?.message_id || 'unknown',
        to: this.maskEmail(to),
        subject,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        messageId: result.body?.message_id,
        data: result.body,
      };
    } catch (error) {
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
   * Send welcome email to new users.
   * @param {object} userData - User data.
   * @param {string} userData.email - User email.
   * @param {string} userData.name - User name.
   * @param {string} userData.role - User role (optional).
   * @returns {Promise<object>} Send result.
   * @example
   */
  async sendWelcomeEmail(userData) {
    const { email, name, role } = userData;

    const emailData = {
      to: email,
      toName: name,
      subject: 'Welcome to Amexing System',
      html: this.generateWelcomeEmailHTML(name, role),
      text: this.generateWelcomeEmailText(name, role),
      tags: ['welcome', 'onboarding'],
    };

    return this.sendEmail(emailData);
  }

  /**
   * Send password reset email.
   * @param {object} resetData - Reset data.
   * @param {string} resetData.email - User email.
   * @param {string} resetData.name - User name.
   * @param {string} resetData.resetToken - Password reset token.
   * @param {string} resetData.resetUrl - Reset URL.
   * @returns {Promise<object>} Send result.
   * @example
   */
  async sendPasswordResetEmail(resetData) {
    const {
      email, name, resetUrl,
    } = resetData;

    const emailData = {
      to: email,
      toName: name,
      subject: 'Password Reset Request - Amexing System',
      html: this.generatePasswordResetEmailHTML(name, resetUrl),
      text: this.generatePasswordResetEmailText(name, resetUrl),
      tags: ['password-reset', 'security'],
    };

    return this.sendEmail(emailData);
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
    if (!email || typeof email !== 'string') return 'invalid-email';

    const [localPart, domain] = email.split('@');
    if (!localPart || !domain) return 'invalid-email';

    const maskedLocal = localPart.length > 2
      ? localPart[0] + '*'.repeat(localPart.length - 2) + localPart[localPart.length - 1]
      : '*'.repeat(localPart.length);

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
}

module.exports = new EmailService();
