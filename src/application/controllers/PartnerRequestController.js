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
      collaboratorTypeRaw: type || null,
      collaboratorTypeOther: request.get('collaboratorTypeOther') || null,
      website: request.get('website'),
      professionalAffiliation: request.get('professionalAffiliation'),
      howDidYouHear: request.get('howDidYouHear'),
      comments: request.get('comments'),
      status: request.get('status'),
      submittedAt: request.get('submittedAt'),
      convertedClientId: request.get('convertedClientId') || null,
      convertedAt: request.get('convertedAt') || null,
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

  /**
   * Admin API: list partner requests (JSON) with status filter, search and pagination.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async apiList(req, res) {
    try {
      const status = (req.query.status || '').trim();
      const search = (req.query.search || '').trim();
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
      const { items, total, pendingCount } = await this.service.listRequests({
        status, search, page, limit,
      });

      // Marca qué correos ya existen como usuario (para avisar antes de convertir).
      // Una sola query batch en vez de N.
      const emails = items
        .map((r) => (r.get('email') || '').trim().toLowerCase())
        .filter(Boolean);
      const existing = new Set();
      if (emails.length) {
        const Parse = require('parse/node');
        const emailQuery = new Parse.Query(Parse.Object.extend('AmexingUser'));
        emailQuery.containedIn('email', emails);
        emailQuery.select('email');
        emailQuery.limit(1000);
        const users = await emailQuery.find({ useMasterKey: true }).catch(() => []);
        users.forEach((u) => existing.add((u.get('email') || '').trim().toLowerCase()));
      }

      return res.json({
        success: true,
        data: items.map((r) => ({
          ...PartnerRequestController.toView(r),
          reviewedAt: r.get('reviewedAt') || null,
          emailExists: existing.has((r.get('email') || '').trim().toLowerCase()),
        })),
        pagination: { page, limit, total },
        pendingCount,
      });
    } catch (error) {
      logger.error('Error listing partner requests (admin)', { error: error.message });
      return res.status(500).json({ success: false, error: 'Error al listar solicitudes' });
    }
  }

  /**
   * Admin API: resolve a partner request (approve/reject). Only pending ones.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @param {string} action - 'approve' or 'reject'.
   * @returns {Promise<void>}
   * @example
   */
  async apiResolve(req, res, action) {
    try {
      const { id } = req.params;
      const request = await this.service.getRequestById(id);
      if (!request || request.get('exists') === false) {
        return res.status(404).json({ success: false, error: 'Solicitud no encontrada' });
      }
      if (request.get('status') && request.get('status') !== 'pending') {
        return res.status(409).json({ success: false, error: 'La solicitud ya fue resuelta' });
      }
      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      const updated = await this.service.updateStatus(id, newStatus);
      logger.info('Partner request resolved from admin panel', { id, status: newStatus });
      return res.json({ success: true, data: PartnerRequestController.toView(updated) });
    } catch (error) {
      logger.error('Error resolving partner request (admin)', { error: error.message });
      return res.status(500).json({ success: false, error: 'Error al actualizar la solicitud' });
    }
  }

  /**
   * Admin API: mark a request as converted (status 'approved' + link al cliente creado).
   * Se invoca DESPUÉS de crear el cliente desde el alta (Opción A). No falla si ya
   * estaba convertida; solo rechaza si la solicitud fue previamente 'rejected'.
   * @param {object} req - Express request (body: { clientId }).
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async apiConvert(req, res) {
    try {
      const { id } = req.params;
      const clientId = (req.body && req.body.clientId) || null;
      const request = await this.service.getRequestById(id);
      if (!request || request.get('exists') === false) {
        return res.status(404).json({ success: false, error: 'Solicitud no encontrada' });
      }
      if (request.get('status') === 'rejected') {
        return res.status(409).json({ success: false, error: 'La solicitud fue rechazada' });
      }
      const updated = await this.service.markConverted(id, clientId);
      logger.info('Partner request converted from admin panel', { id, clientId });
      return res.json({ success: true, data: PartnerRequestController.toView(updated) });
    } catch (error) {
      logger.error('Error converting partner request (admin)', { error: error.message });
      return res.status(500).json({ success: false, error: 'Error al convertir la solicitud' });
    }
  }

  /**
   * Admin API: reject a partner request.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async apiReject(req, res) {
    return this.apiResolve(req, res, 'reject');
  }
}

module.exports = new PartnerRequestController();
