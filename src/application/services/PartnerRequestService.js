const Parse = require('parse/node');
const crypto = require('crypto');
const logger = require('../../infrastructure/logger');

/**
 * Partner Request Service - Handles business logic for partner (collaborator) access requests.
 * Processes the "Solicitud de Acceso para Colaboradores" form, stores submissions as
 * PartnerRequest objects with a pending status, and sends notification emails to the
 * configured operations recipient using the existing EmailService (MailerSend).
 *
 * Workflow: pending -> approved | rejected (managed later from the admin dashboard).
 *
 * @class PartnerRequestService
 * @author Created by Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * const partnerRequestService = new PartnerRequestService();
 * const result = await partnerRequestService.processPartnerRequest({
 *   firstName: 'Jane',
 *   lastName: 'Smith',
 *   email: 'jane@example.com',
 *   phone: '+52 415 000 0000',
 *   preferredLanguage: 'es',
 *   collaboratorType: 'wedding_planner',
 * });
 */
class PartnerRequestService {
  /**
   * Initializes the service with a lazily-loaded EmailService reference.
   * @example
   * const partnerRequestService = new PartnerRequestService();
   */
  constructor() {
    this.emailService = null;
  }

  /**
   * Lazy-loads EmailService to avoid circular dependencies.
   * @private
   * @returns {object} EmailService instance.
   */
  getEmailService() {
    if (!this.emailService) {
      this.emailService = require('./EmailService');
    }
    return this.emailService;
  }

  /**
   * Human readable labels for the collaborator types used in emails.
   * @private
   * @param {string} type - Collaborator type key.
   * @param {string} [other] - Free text when type is "other".
   * @returns {string} Display label.
   */
  static collaboratorTypeLabel(type, other) {
    const labels = {
      travel_agent: 'Agente de viajes',
      wedding_planner: 'Wedding planner',
      concierge: 'Concierge',
      dmc: 'DMC',
      airbnb_villa_owner: 'Propietario / administrador de Airbnb o villa',
      company: 'Empresa',
      other: 'Otro',
    };
    const base = labels[type] || type || 'No especificado';
    if (type === 'other' && other) {
      return `${base}: ${other}`;
    }
    return base;
  }

  /**
   * Processes a partner access request: stores it and sends a notification email.
   * @function processPartnerRequest
   * @param {object} formData - Partner request data.
   * @returns {Promise<object>} Result object with success status and details.
   */
  async processPartnerRequest(formData) {
    try {
      const submission = await this.storePartnerRequest(formData);

      const emailResult = await this.sendPartnerNotification(formData, submission.id);

      // Send a confirmation copy to the applicant (does not block the flow)
      const applicantResult = await this.sendApplicantConfirmation(formData, submission.id);

      logger.info('Partner request processed successfully', {
        submissionId: submission.id,
        email: formData.email,
        collaboratorType: formData.collaboratorType,
        emailSent: emailResult.success,
        applicantEmailSent: applicantResult.success,
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
      logger.error('Error processing partner request:', {
        error: error.message,
        stack: error.stack,
        formData: {
          email: formData.email,
          collaboratorType: formData.collaboratorType,
          ip: formData.ip,
        },
      });

      return {
        success: false,
        error: error.message || 'Failed to process partner request',
      };
    }
  }

  /**
   * Stores the partner request in Parse as a PartnerRequest object.
   * @function storePartnerRequest
   * @param {object} formData - Partner request data to store.
   * @returns {Promise<object>} Saved Parse object with generated ID.
   */
  async storePartnerRequest(formData) {
    try {
      const PartnerRequest = Parse.Object.extend('PartnerRequest');
      const request = new PartnerRequest();

      // Contact data
      request.set('firstName', formData.firstName);
      request.set('lastName', formData.lastName);
      request.set('email', formData.email);
      request.set('phone', formData.phone);
      request.set('preferredLanguage', formData.preferredLanguage || null);

      // Profile
      request.set('collaboratorType', formData.collaboratorType);
      request.set('collaboratorTypeOther', formData.collaboratorTypeOther || null);
      request.set('website', formData.website || null);
      request.set('professionalAffiliation', formData.professionalAffiliation || null);

      // Additional info
      request.set('howDidYouHear', formData.howDidYouHear || null);
      request.set('comments', formData.comments || null);

      // Metadata
      request.set('ip', formData.ip || null);
      request.set('userAgent', formData.userAgent || null);
      request.set('submittedAt', formData.timestamp || new Date());

      // Approval workflow
      request.set('status', 'pending'); // pending, approved, rejected
      request.set('source', 'website');

      // Standard fields for logical deletion and activation
      request.set('active', true);
      request.set('exists', true);

      const saved = await request.save(null, { useMasterKey: true });

      logger.info('Partner request stored in database', {
        submissionId: saved.id,
        email: formData.email,
      });

      return saved;
    } catch (error) {
      logger.error('Error storing partner request:', {
        error: error.message,
        stack: error.stack,
        email: formData.email,
      });
      throw new Error('Failed to store partner request');
    }
  }

  /**
   * Sends an email notification about a new partner request to the operations recipient.
   * @function sendPartnerNotification
   * @param {object} formData - Partner request data for email content.
   * @param {string} submissionId - Database submission ID for reference.
   * @returns {Promise<object>} Email send result.
   */
  async sendPartnerNotification(formData, submissionId) {
    try {
      const emailService = this.getEmailService();

      if (!emailService.isAvailable()) {
        logger.warn('Email service not available for partner request notification', {
          submissionId,
          email: formData.email,
        });
        return { success: false, error: 'Email service not configured' };
      }

      // Environment-specific recipient (overridable via env var)
      const defaultRecipient = process.env.NODE_ENV === 'production'
        ? 'contact@amexingexperience.com'
        : 'denisse@meeplab.com';
      const recipient = process.env.PARTNER_REQUEST_RECIPIENT || defaultRecipient;

      const fullName = `${formData.firstName} ${formData.lastName}`.trim();
      const subject = `Nueva Solicitud de Colaborador: ${fullName}`;

      const htmlContent = this.generateNotificationHTML(formData, submissionId);
      const textContent = this.generateNotificationText(formData, submissionId);

      const result = await emailService.sendEmail({
        to: recipient,
        subject,
        html: htmlContent,
        text: textContent,
        tags: ['partner-request', 'notification', process.env.NODE_ENV || 'development'],
        notificationType: 'partner_request',
        metadata: {
          submissionId,
          senderEmail: formData.email,
          senderName: fullName,
          collaboratorType: formData.collaboratorType,
          submittedAt: formData.timestamp || new Date(),
        },
      });

      logger.info('Partner request notification email sent', {
        submissionId,
        recipient: emailService.maskEmail(recipient),
        senderEmail: emailService.maskEmail(formData.email),
        success: result.success,
        messageId: result.messageId,
      });

      return result;
    } catch (error) {
      logger.error('Error sending partner request notification email:', {
        error: error.message,
        stack: error.stack,
        submissionId,
        email: formData.email,
      });
      return { success: false, error: 'Failed to send notification email' };
    }
  }

  /**
   * Sends a confirmation copy to the applicant's email, in their preferred language.
   * Never blocks the main flow; failures are logged and returned as { success: false }.
   * @function sendApplicantConfirmation
   * @param {object} formData - Partner request data.
   * @param {string} submissionId - Database submission ID.
   * @returns {Promise<object>} Email send result.
   */
  async sendApplicantConfirmation(formData, submissionId) {
    try {
      const emailService = this.getEmailService();

      if (!emailService.isAvailable()) {
        logger.warn('Email service not available for applicant confirmation', {
          submissionId,
          email: formData.email,
        });
        return { success: false, error: 'Email service not configured' };
      }

      if (!formData.email) {
        return { success: false, error: 'No applicant email' };
      }

      const isEn = formData.preferredLanguage === 'en';
      const subject = isEn
        ? 'We received your access request - Amexing CRM'
        : 'Recibimos tu solicitud de acceso - Amexing CRM';

      const htmlContent = this.generateApplicantConfirmationHTML(formData, isEn);
      const textContent = this.generateApplicantConfirmationText(formData, isEn);

      const result = await emailService.sendEmail({
        to: formData.email,
        subject,
        html: htmlContent,
        text: textContent,
        tags: ['partner-request', 'applicant-confirmation', process.env.NODE_ENV || 'development'],
        notificationType: 'partner_request_confirmation',
        metadata: {
          submissionId,
          recipientEmail: formData.email,
          language: isEn ? 'en' : 'es',
        },
      });

      logger.info('Partner request applicant confirmation sent', {
        submissionId,
        recipient: emailService.maskEmail(formData.email),
        success: result.success,
        messageId: result.messageId,
      });

      return result;
    } catch (error) {
      logger.error('Error sending applicant confirmation email:', {
        error: error.message,
        stack: error.stack,
        submissionId,
        email: formData.email,
      });
      return { success: false, error: 'Failed to send applicant confirmation' };
    }
  }

  /**
   * Builds the HTML confirmation email shown to the applicant.
   * @param {object} formData - Partner request data.
   * @param {boolean} isEn - Whether to render the English version.
   * @returns {string} HTML email content.
   */
  generateApplicantConfirmationHTML(formData, isEn) {
    const firstName = formData.firstName || '';
    const typeLabel = PartnerRequestService.collaboratorTypeLabel(
      formData.collaboratorType,
      formData.collaboratorTypeOther
    );
    const c = isEn ? {
      heading: 'Request received',
      greeting: `Hi ${firstName},`.trim(),
      intro: 'Thank you for your interest in becoming an Amexing CRM partner. We have received your access request and our team will review it shortly.',
      summaryTitle: 'Summary of your request',
      nameLabel: 'Name',
      emailLabel: 'Email',
      typeLabel: 'Type of collaborator',
      reviewNote: 'Access is subject to individual review and approval. We will contact you at this email address with the outcome.',
      footer: 'This is an automated confirmation from Amexing CRM. Please do not reply to this message.',
    } : {
      heading: 'Solicitud recibida',
      greeting: `Hola ${firstName},`.trim(),
      intro: 'Gracias por tu interés en ser colaborador de Amexing CRM. Recibimos tu solicitud de acceso y nuestro equipo la revisará en breve.',
      summaryTitle: 'Resumen de tu solicitud',
      nameLabel: 'Nombre',
      emailLabel: 'Correo',
      typeLabel: 'Tipo de colaborador',
      reviewNote: 'El acceso está sujeto a revisión y aprobación individual. Te contactaremos a este correo con la respuesta.',
      footer: 'Esta es una confirmación automática de Amexing CRM. Por favor no respondas a este mensaje.',
    };
    const fullName = `${formData.firstName || ''} ${formData.lastName || ''}`.trim();

    return `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      <div style="background: linear-gradient(135deg, #969B81 0%, #7f846a 100%); padding: 30px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 600;">${c.heading}</h1>
        <p style="color: #ffffff; margin: 10px 0 0 0; opacity: 0.9; font-size: 16px;">Amexing CRM</p>
      </div>

      <div style="padding: 40px 30px; color: #555; line-height: 1.6;">
        <p style="margin: 0 0 16px 0; font-size: 16px;">${c.greeting}</p>
        <p style="margin: 0 0 24px 0;">${c.intro}</p>

        <div style="background: #f8f9fa; border-left: 4px solid #969B81; padding: 20px; margin-bottom: 24px; border-radius: 0 8px 8px 0;">
          <h2 style="color: #2c3e50; margin: 0 0 15px 0; font-size: 18px;">${c.summaryTitle}</h2>
          <p style="margin: 8px 0;"><strong>${c.nameLabel}:</strong> ${fullName}</p>
          <p style="margin: 8px 0;"><strong>${c.emailLabel}:</strong> ${formData.email}</p>
          <p style="margin: 8px 0;"><strong>${c.typeLabel}:</strong> ${typeLabel}</p>
        </div>

        <p style="margin: 0; color: #777; font-size: 14px;">${c.reviewNote}</p>
      </div>

      <div style="background: #2c3e50; padding: 20px; text-align: center;">
        <p style="color: #ffffff; margin: 0; font-size: 13px; opacity: 0.8;">${c.footer}</p>
      </div>
    </div>
    `;
  }

  /**
   * Builds the plain text confirmation email shown to the applicant.
   * @param {object} formData - Partner request data.
   * @param {boolean} isEn - Whether to render the English version.
   * @returns {string} Plain text email content.
   */
  generateApplicantConfirmationText(formData, isEn) {
    const firstName = formData.firstName || '';
    const fullName = `${formData.firstName || ''} ${formData.lastName || ''}`.trim();
    const typeLabel = PartnerRequestService.collaboratorTypeLabel(
      formData.collaboratorType,
      formData.collaboratorTypeOther
    );

    if (isEn) {
      return `
Request received - Amexing CRM

Hi ${firstName},

Thank you for your interest in becoming an Amexing CRM partner. We have received your access request and our team will review it shortly.

SUMMARY OF YOUR REQUEST:
• Name: ${fullName}
• Email: ${formData.email}
• Type of collaborator: ${typeLabel}

Access is subject to individual review and approval. We will contact you at this email address with the outcome.

This is an automated confirmation from Amexing CRM. Please do not reply to this message.
      `.trim();
    }

    return `
Solicitud recibida - Amexing CRM

Hola ${firstName},

Gracias por tu interés en ser colaborador de Amexing CRM. Recibimos tu solicitud de acceso y nuestro equipo la revisará en breve.

RESUMEN DE TU SOLICITUD:
• Nombre: ${fullName}
• Correo: ${formData.email}
• Tipo de colaborador: ${typeLabel}

El acceso está sujeto a revisión y aprobación individual. Te contactaremos a este correo con la respuesta.

Esta es una confirmación automática de Amexing CRM. Por favor no respondas a este mensaje.
    `.trim();
  }

  /**
   * Generates HTML email content for the partner request notification.
   * @function generateNotificationHTML
   * @param {object} formData - Partner request data.
   * @param {string} submissionId - Database submission ID.
   * @returns {string} Formatted HTML email content.
   */
  generateNotificationHTML(formData, submissionId) {
    const submissionTime = (formData.timestamp || new Date()).toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City',
      dateStyle: 'full',
      timeStyle: 'medium',
    });
    const fullName = `${formData.firstName} ${formData.lastName}`.trim();
    const typeLabel = PartnerRequestService.collaboratorTypeLabel(
      formData.collaboratorType,
      formData.collaboratorTypeOther
    );
    const languageLabel = formData.preferredLanguage === 'en' ? 'Inglés' : 'Español';
    const reviewUrl = PartnerRequestService.buildReviewUrl(submissionId);
    /**
     * Renders a label/value paragraph row, or an empty string when value is falsy.
     * @param {string} label - Field label.
     * @param {string} value - Field value.
     * @returns {string} HTML paragraph or empty string.
     * @example
     * row('Correo', 'a@b.com');
     */
    const row = (label, value) => (value
      ? `<p style="margin: 8px 0;"><strong>${label}:</strong> ${value}</p>` : '');

    return `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      <div style="background: linear-gradient(135deg, #969B81 0%, #7f846a 100%); padding: 30px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 600;">
          Nueva Solicitud de Colaborador
        </h1>
        <p style="color: #ffffff; margin: 10px 0 0 0; opacity: 0.9; font-size: 16px;">Amexing CRM</p>
      </div>

      <div style="padding: 40px 30px;">
        <div style="background: #f8f9fa; border-left: 4px solid #969B81; padding: 20px; margin-bottom: 25px; border-radius: 0 8px 8px 0;">
          <h2 style="color: #2c3e50; margin: 0 0 15px 0; font-size: 18px;">Datos de Contacto</h2>
          <div style="color: #555; line-height: 1.6;">
            ${row('Nombre', fullName)}
            <p style="margin: 8px 0;"><strong>Correo:</strong> <a href="mailto:${formData.email}" style="color: #7f846a; text-decoration: none;">${formData.email}</a></p>
            <p style="margin: 8px 0;"><strong>Teléfono:</strong> <a href="tel:${formData.phone}" style="color: #7f846a; text-decoration: none;">${formData.phone}</a></p>
            ${row('Idioma de preferencia', languageLabel)}
          </div>
        </div>

        <div style="background: #f8f9fa; border-left: 4px solid #969B81; padding: 20px; margin-bottom: 25px; border-radius: 0 8px 8px 0;">
          <h2 style="color: #2c3e50; margin: 0 0 15px 0; font-size: 18px;">Perfil</h2>
          <div style="color: #555; line-height: 1.6;">
            ${row('Tipo de colaborador', typeLabel)}
            ${row('Redes sociales o sitio web', formData.website)}
            ${row('Afiliación profesional (IATA/CLIA)', formData.professionalAffiliation)}
          </div>
        </div>

        ${(formData.howDidYouHear || formData.comments) ? `
        <div style="background: #f8f9fa; border-left: 4px solid #969B81; padding: 20px; margin-bottom: 25px; border-radius: 0 8px 8px 0;">
          <h2 style="color: #2c3e50; margin: 0 0 15px 0; font-size: 18px;">Información Adicional</h2>
          <div style="color: #555; line-height: 1.6;">
            ${row('¿Cómo se enteraron de nosotros?', formData.howDidYouHear)}
            ${formData.comments ? `<p style="margin: 8px 0;"><strong>Comentarios:</strong></p><div style="white-space: pre-wrap; background: #ffffff; padding: 15px; border-radius: 6px; border: 1px solid #e9ecef;">${formData.comments}</div>` : ''}
          </div>
        </div>` : ''}

        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
          <h3 style="color: #2c3e50; margin: 0 0 15px 0; font-size: 16px;">Detalles de la Solicitud</h3>
          <div style="color: #666; font-size: 14px; line-height: 1.5;">
            <p style="margin: 5px 0;"><strong>Estado:</strong> Pendiente de aprobación</p>
            <p style="margin: 5px 0;"><strong>Fecha y Hora:</strong> ${submissionTime}</p>
          </div>
        </div>

        <!-- Approve / Reject -->
        <div style="text-align: center; margin: 10px 0 5px 0;">
          <p style="color: #555; font-size: 14px; margin-bottom: 18px;">Revisa y resuelve esta solicitud:</p>
          <a href="${reviewUrl}"
             style="background: #969B81; color: #ffffff; padding: 14px 36px; text-decoration: none; border-radius: 50px; font-weight: 600; display: inline-block; font-size: 15px;">
            Aprobar o Rechazar
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 16px;">
            Se abrirá una página segura para confirmar tu decisión.
          </p>
        </div>
      </div>

      <div style="background: #2c3e50; padding: 20px; text-align: center;">
        <p style="color: #ffffff; margin: 0; font-size: 14px; opacity: 0.8;">
          Enviado automáticamente desde el formulario de solicitud de acceso de Amexing CRM
        </p>
      </div>
    </div>
    `;
  }

  /**
   * Generates plain text email content for the partner request notification.
   * @function generateNotificationText
   * @param {object} formData - Partner request data.
   * @param {string} submissionId - Database submission ID.
   * @returns {string} Formatted plain text email content.
   */
  generateNotificationText(formData, submissionId) {
    const submissionTime = (formData.timestamp || new Date()).toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City',
      dateStyle: 'full',
      timeStyle: 'medium',
    });
    const fullName = `${formData.firstName} ${formData.lastName}`.trim();
    const typeLabel = PartnerRequestService.collaboratorTypeLabel(
      formData.collaboratorType,
      formData.collaboratorTypeOther
    );
    const languageLabel = formData.preferredLanguage === 'en' ? 'Inglés' : 'Español';

    return `
NUEVA SOLICITUD DE COLABORADOR - AMEXING CRM

═══════════════════════════════════════════

DATOS DE CONTACTO:
• Nombre: ${fullName}
• Correo: ${formData.email}
• Teléfono: ${formData.phone}
• Idioma de preferencia: ${languageLabel}

PERFIL:
• Tipo de colaborador: ${typeLabel}
${formData.website ? `• Redes sociales o sitio web: ${formData.website}` : ''}
${formData.professionalAffiliation ? `• Afiliación profesional (IATA/CLIA): ${formData.professionalAffiliation}` : ''}

INFORMACIÓN ADICIONAL:
${formData.howDidYouHear ? `• ¿Cómo se enteraron de nosotros?: ${formData.howDidYouHear}` : ''}
${formData.comments ? `• Comentarios:\n${formData.comments}` : ''}

DETALLES DE LA SOLICITUD:
• Estado: Pendiente de aprobación
• Fecha y Hora: ${submissionTime}

APROBAR O RECHAZAR:
${PartnerRequestService.buildReviewUrl(submissionId)}

═══════════════════════════════════════════
Enviado automáticamente desde el formulario de solicitud de acceso de Amexing CRM
    `.trim();
  }

  /**
   * Secret used to sign approve/reject action links embedded in admin emails.
   * @private
   * @returns {string} Signing secret.
   */
  static getSigningSecret() {
    return process.env.JWT_SECRET
      || process.env.SESSION_SECRET
      || 'amexing-partner-request-fallback-secret';
  }

  /**
   * Generates an HMAC token that authorizes reviewing/acting on a request from email.
   * @param {string} submissionId - PartnerRequest object id.
   * @returns {string} Hex-encoded HMAC token.
   */
  static generateActionToken(submissionId) {
    return crypto
      .createHmac('sha256', PartnerRequestService.getSigningSecret())
      .update(`partner-request:${submissionId}`)
      .digest('hex');
  }

  /**
   * Verifies an action token using a timing-safe comparison.
   * @param {string} submissionId - PartnerRequest object id.
   * @param {string} token - Token to verify.
   * @returns {boolean} True when the token is valid.
   */
  static verifyActionToken(submissionId, token) {
    if (!token || typeof token !== 'string') return false;
    const expected = PartnerRequestService.generateActionToken(submissionId);
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(token);
    if (expectedBuf.length !== providedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  }

  /**
   * Builds the absolute review URL included in the admin notification email.
   * @param {string} submissionId - PartnerRequest object id.
   * @returns {string} Absolute URL to the review page.
   */
  static buildReviewUrl(submissionId) {
    const baseUrl = (process.env.PUBLIC_URL || 'http://localhost:3337').replace(/\/$/, '');
    const token = PartnerRequestService.generateActionToken(submissionId);
    return `${baseUrl}/partner-requests/${submissionId}/review?token=${token}`;
  }

  /**
   * Fetches a single PartnerRequest by id.
   * @param {string} submissionId - PartnerRequest object id.
   * @returns {Promise<Parse.Object|null>} The request or null if not found.
   */
  async getRequestById(submissionId) {
    try {
      const query = new Parse.Query('PartnerRequest');
      return await query.get(submissionId, { useMasterKey: true });
    } catch (error) {
      logger.warn('Partner request not found', { submissionId, error: error.message });
      return null;
    }
  }

  /**
   * Updates the status of a PartnerRequest (approve/reject workflow).
   * @param {string} submissionId - PartnerRequest object id.
   * @param {string} status - New status: 'approved' or 'rejected'.
   * @returns {Promise<Parse.Object>} The updated request.
   */
  async updateStatus(submissionId, status) {
    // Fetch the full record first so the returned object keeps all fields
    // (name, email, etc.) populated for the confirmation view.
    const query = new Parse.Query('PartnerRequest');
    const request = await query.get(submissionId, { useMasterKey: true });
    request.set('status', status);
    request.set('reviewedAt', new Date());
    const saved = await request.save(null, { useMasterKey: true });
    logger.info('Partner request status updated', { submissionId, status });
    return saved;
  }
}

module.exports = PartnerRequestService;
