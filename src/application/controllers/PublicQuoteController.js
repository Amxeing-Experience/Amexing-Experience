/**
 * PublicQuoteController - Handles public quote viewing without authentication.
 * Provides public access to quotes via folio number for client sharing.
 * No authentication required - uses folio as the access key.
 * Security Considerations:
 * - Folio acts as access token (QTE-YYYY-NNNN format).
 * - Only active quotes with exists=true are accessible.
 * - Sensitive internal data filtered before rendering.
 * - Rate limiting applied to prevent abuse.
 * - Audit logging for all public access.
 * @author Amexing Development Team
 * @version 1.0.0
 */

const Quote = require('../../domain/models/Quote');
const logger = require('../../infrastructure/logger');

/**
 * PublicQuoteController class for public quote viewing.
 * @class PublicQuoteController
 */
class PublicQuoteController {
  constructor() {
    // Bind methods to maintain 'this' context
    this.viewPublicQuote = this.viewPublicQuote.bind(this);
    this.preparePublicQuoteData = this.preparePublicQuoteData.bind(this);
  }

  /**
   * View public quote by folio.
   * GET /quotes/:folio.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Renders public quote view or error page.
   * @example
   * // Access public quote
   * GET /quotes/QTE-2025-0004
   */
  async viewPublicQuote(req, res) {
    const { folio } = req.params;

    try {
      const folioValidation = this.validateFolio(folio, req, res);
      if (folioValidation) return folioValidation;

      const quote = await this.fetchQuoteByFolio(folio, req, res);
      if (!quote) return;

      this.logPublicAccess(quote, req);
      const quoteData = this.preparePublicQuoteData(quote);

      return res.render('dashboards/admin/quote-public-simple', {
        quote: quoteData,
        isPublicView: true,
        pageTitle: `Cotización ${folio}`,
      });
    } catch (error) {
      return this.handlePublicQuoteError(error, folio, req, res);
    }
  }

  // ===== HELPER METHODS =====

  /**
   * Validate folio format.
   * @param {string} folio - Quote folio to validate.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {object|null} Error response or null if valid.
   * @example
   * const error = this.validateFolio('QTE-2024-0001', req, res);
   */
  validateFolio(folio, req, res) {
    const folioRegex = /^QTE-\d{4}-\d{4}$/;
    if (!folioRegex.test(folio)) {
      logger.warn('Invalid folio format for public access', {
        folio,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      return res.status(400).render('errors/error', {
        status: 400,
        title: 'Folio Inválido',
        message: 'El formato del folio no es válido. Debe ser QTE-YYYY-####',
      });
    }
    return null;
  }

  /**
   * Fetch quote by folio with error handling.
   * @param {string} folio - Quote folio to fetch.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object|null>} Quote object or null if error.
   * @example
   * const quote = await this.fetchQuoteByFolio('QTE-2024-0001', req, res);
   */
  async fetchQuoteByFolio(folio, req, res) {
    const quote = await Quote.findByFolioPublic(folio);

    if (!quote) {
      logger.warn('Quote not found for public access', {
        folio,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.status(404).render('errors/404', {
        message: 'Cotización no encontrada',
      });
      return null;
    }

    return quote;
  }

  /**
   * Log public access for audit trail.
   * @param {object} quote - Quote object.
   * @param {object} req - Express request object.
   * @example
   * this.logPublicAccess(quote, req);
   */
  logPublicAccess(quote, req) {
    logger.info('Public quote accessed', {
      quoteId: quote.id,
      folio: quote.getFolio(),
      ip: req.ip,
      userAgent: req.get('user-agent'),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle errors in public quote viewing.
   * @param {Error} error - Error object.
   * @param {string} folio - Quote folio.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {object} Error response.
   * @example
   * return this.handlePublicQuoteError(error, folio, req, res);
   */
  handlePublicQuoteError(error, folio, req, res) {
    logger.error('Error rendering public quote', {
      error: error.message,
      stack: error.stack,
      folio,
      ip: req.ip,
    });

    return res.status(500).render('errors/error', {
      status: 500,
      title: 'Error del Servidor',
      message: 'Error al cargar la cotización. Por favor intente nuevamente.',
      error: process.env.NODE_ENV === 'development' ? error : undefined,
    });
  }

  /**
   * Prepare quote data for public view.
   * Filters sensitive internal data before rendering.
   * @param {Quote} quote - Quote Parse object.
   * @returns {object} Filtered quote data for public display.
   * @example
   * const quoteData = controller.preparePublicQuoteData(quote);
   */
  preparePublicQuoteData(quote) {
    const rate = quote.getRate();
    const client = quote.getClient();
    const serviceItems = quote.getServiceItems() || {};

    return {
      id: quote.id,
      folio: quote.getFolio(),
      status: quote.getStatus(),
      client: this.formatClientData(client),
      contactPerson: quote.getContactPerson() || '',
      contactEmail: quote.getContactEmail() || '',
      contactPhone: quote.getContactPhone() || '',
      numberOfPeople: quote.getNumberOfPeople() || 1,
      eventType: quote.getEventType() || '',
      rate: this.formatRateData(rate),
      serviceItems: this.formatServiceItems(serviceItems),
      createdAt: quote.get('createdAt') || null,
      updatedAt: quote.get('updatedAt') || null,
    };
  }

  /**
   * Format client data for public view.
   * @param {object} client - Client object.
   * @returns {object|null} Formatted client data or null.
   * @example
   * const clientData = this.formatClientData(client);
   */
  formatClientData(client) {
    return client
      ? {
        firstName: client.get('firstName') || '',
        lastName: client.get('lastName') || '',
        email: client.get('email') || '',
        phone: client.get('phone') || '',
        companyName: client.get('contextualData')?.companyName || '',
      }
      : null;
  }

  /**
   * Format rate data for public view.
   * @param {object} rate - Rate object.
   * @returns {object|null} Formatted rate data or null.
   * @example
   * const rateData = this.formatRateData(rate);
   */
  formatRateData(rate) {
    return rate
      ? {
        name: rate.get('name') || '',
        destination: rate.get('destination') || '',
        originCity: rate.get('originCity') || '',
        startDate: rate.get('startDate') || null,
        endDate: rate.get('endDate') || null,
        numberOfDays: rate.get('numberOfDays') || 0,
      }
      : null;
  }

  /**
   * Format service items for public view.
   * @param {object} serviceItems - Service items object.
   * @returns {object} Formatted service items.
   * @example
   * const formattedItems = this.formatServiceItems(serviceItems);
   */
  formatServiceItems(serviceItems) {
    return {
      days: (serviceItems.days || []).map((day) => this.formatDayData(day)),
      subtotal: serviceItems.subtotal || 0,
      iva: serviceItems.iva || 0,
      total: serviceItems.total || 0,
    };
  }

  /**
   * Format day data for public view.
   * @param {object} day - Day object.
   * @returns {object} Formatted day data.
   * @example
   * const dayData = this.formatDayData(day);
   */
  formatDayData(day) {
    return {
      dayNumber: day.dayNumber || 0,
      date: day.date || '',
      city: day.city || '',
      subconcepts: (day.subconcepts || []).map((sub) => this.formatSubconcept(sub)),
    };
  }

  /**
   * Format subconcept data for public view.
   * @param {object} sub - Subconcept object.
   * @returns {object} Formatted subconcept data.
   * @example
   * const subData = this.formatSubconcept(subconcept);
   */
  formatSubconcept(sub) {
    // For tours, prioritize destination name over empty concept
    let concept = sub.concept || '';
    if (sub.type === 'tour' && (!concept || concept.trim() === '')) {
      concept = sub.destinationPOI || sub.destination || 'Tour';
    }

    // For transfers, ensure we have proper service type
    let serviceType = sub.serviceType || '';
    if (sub.type === 'traslado' && (!serviceType || serviceType.trim() === '')) {
      serviceType = 'Traslado';
    } else if (sub.type === 'tour' && (!serviceType || serviceType.trim() === '')) {
      serviceType = 'Tour';
    } else if (sub.type === 'experiencia' && (!serviceType || serviceType.trim() === '')) {
      serviceType = 'Experiencia';
    }

    return {
      id: sub.id || '',
      type: sub.type || '',
      concept,
      serviceType,
      vehicleType: sub.vehicleType || '',
      vehicleTypeId: sub.vehicleTypeId || '',
      vehicleCapacity: sub.vehicleCapacity || null,
      vehicleMultiplier: sub.vehicleMultiplier || 1,
      startTime: sub.startTime || '',
      endTime: sub.endTime || '',
      hours: sub.hours || 0,
      unitPrice: sub.unitPrice || 0,
      isPerPerson: sub.isPerPerson || false,
      numberOfPeople: sub.numberOfPeople || 1,
      total: sub.total || 0,
      destinationPOI: sub.destinationPOI || '',
      destination: sub.destination || '',
      isCashPayment: sub.isCashPayment || false,
      // EXCLUDE: notes (business decision)
    };
  }
}

module.exports = new PublicQuoteController();
