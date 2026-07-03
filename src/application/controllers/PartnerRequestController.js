const logger = require('../../infrastructure/logger');
const PartnerRequestService = require('../services/PartnerRequestService');

/**
 * Partner Request Controller - Renders the email-driven approve/reject flow.
 * Admins arrive here from a signed link inside the notification email. The review
 * page (GET) has no side effects; the decision is applied via a CSRF-protected POST.
 * @class PartnerRequestController
 * @author Created by Denisse Maldonado
 */
class PartnerRequestController {
  constructor() {
    this.service = new PartnerRequestService();
  }

  /**
   * Maps a Parse PartnerRequest into a plain object for the views.
   * @param request
   * @private
   * @example
   */
  static toView(request) {
    const type = request.get('collaboratorType');
    return {
      id: request.id,
      firstName: request.get('firstName'),
      lastName: request.get('lastName'),
      fullName: `${request.get('firstName') || ''} ${request.get('lastName') || ''}`.trim(),
      email: request.get('email'),
      phone: request.get('phone'),
      preferredLanguage: request.get('preferredLanguage') === 'en' ? 'Inglés' : 'Español',
      collaboratorType: PartnerRequestService.collaboratorTypeLabel(
        type,
        request.get('collaboratorTypeOther')
      ),
      website: request.get('website'),
      professionalAffiliation: request.get('professionalAffiliation'),
      howDidYouHear: request.get('howDidYouHear'),
      comments: request.get('comments'),
      status: request.get('status'),
      submittedAt: request.get('submittedAt'),
    };
  }

  /**
   * GET /partner-requests/:id/review?token=...
   * Renders the request summary with Approve/Reject buttons. No side effects.
   * @param req
   * @param res
   * @example
   */
  async showReview(req, res) {
    const { id } = req.params;
    const { token } = req.query;

    if (!PartnerRequestService.verifyActionToken(id, token)) {
      return res.status(403).render('auth/partner-request-result', {
        title: 'Enlace no válido - Amexing CRM',
        outcome: 'invalid',
        request: null,
      });
    }

    const request = await this.service.getRequestById(id);
    if (!request || request.get('exists') === false) {
      return res.status(404).render('auth/partner-request-result', {
        title: 'Solicitud no encontrada - Amexing CRM',
        outcome: 'not_found',
        request: null,
      });
    }

    const view = PartnerRequestController.toView(request);

    // Already resolved → show its current state instead of the action buttons
    if (view.status && view.status !== 'pending') {
      return res.render('auth/partner-request-result', {
        title: 'Solicitud ya resuelta - Amexing CRM',
        outcome: 'already',
        request: view,
      });
    }

    return res.render('auth/partner-request-review', {
      title: 'Revisar Solicitud - Amexing CRM',
      request: view,
      token,
      csrfToken: res.locals.csrfToken,
    });
  }

  /**
   * POST /partner-requests/:id/:action  (action = approve | reject)
   * Applies the decision after validating the signed token.
   * @param req
   * @param res
   * @example
   */
  async handleAction(req, res) {
    const { id, action } = req.params;
    const token = req.body?.token;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).render('auth/partner-request-result', {
        title: 'Acción no válida - Amexing CRM',
        outcome: 'invalid',
        request: null,
      });
    }

    if (!PartnerRequestService.verifyActionToken(id, token)) {
      return res.status(403).render('auth/partner-request-result', {
        title: 'Enlace no válido - Amexing CRM',
        outcome: 'invalid',
        request: null,
      });
    }

    const request = await this.service.getRequestById(id);
    if (!request || request.get('exists') === false) {
      return res.status(404).render('auth/partner-request-result', {
        title: 'Solicitud no encontrada - Amexing CRM',
        outcome: 'not_found',
        request: null,
      });
    }

    // Guard against double submission
    if (request.get('status') && request.get('status') !== 'pending') {
      return res.render('auth/partner-request-result', {
        title: 'Solicitud ya resuelta - Amexing CRM',
        outcome: 'already',
        request: PartnerRequestController.toView(request),
      });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    try {
      const updated = await this.service.updateStatus(id, newStatus);
      logger.info('Partner request resolved from email link', { id, status: newStatus });
      return res.render('auth/partner-request-result', {
        title: 'Solicitud actualizada - Amexing CRM',
        outcome: newStatus,
        request: PartnerRequestController.toView(updated),
      });
    } catch (error) {
      logger.error('Error updating partner request status', {
        id, action, error: error.message,
      });
      return res.status(500).render('auth/partner-request-result', {
        title: 'Error - Amexing CRM',
        outcome: 'error',
        request: null,
      });
    }
  }
}

module.exports = new PartnerRequestController();
