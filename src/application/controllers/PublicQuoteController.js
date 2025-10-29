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
 * @since 2024-01-15
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
      // Validate folio format (QTE-YYYY-NNNN)
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

      // Query quote by folio (includes rate and client)
      const quote = await Quote.findByFolioPublic(folio);

      // Validate quote exists and is accessible
      if (!quote) {
        logger.warn('Quote not found for public access', {
          folio,
          ip: req.ip,
          userAgent: req.get('user-agent'),
        });
        return res.status(404).render('errors/404', {
          message: 'Cotización no encontrada',
        });
      }

      // Log public access for audit trail
      logger.info('Public quote accessed', {
        quoteId: quote.id,
        folio: quote.getFolio(),
        ip: req.ip,
        userAgent: req.get('user-agent'),
        timestamp: new Date().toISOString(),
      });

      // Prepare quote data for public view
      const quoteData = this.preparePublicQuoteData(quote);

      // Render public view (standalone, no dashboard)
      return res.render('dashboards/admin/quote-public-simple', {
        quote: quoteData,
        isPublicView: true,
        pageTitle: `Cotización ${folio}`,
      });
    } catch (error) {
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

      // Client information (if available)
      client: client
        ? {
          firstName: client.get('firstName') || '',
          lastName: client.get('lastName') || '',
          email: client.get('email') || '',
          phone: client.get('phone') || '',
          companyName: client.get('contextualData')?.companyName || '',
        }
        : null,

      // Contact information
      contactPerson: quote.getContactPerson() || '',
      contactEmail: quote.getContactEmail() || '',
      contactPhone: quote.getContactPhone() || '',

      // Event details
      numberOfPeople: quote.getNumberOfPeople() || 1,
      eventType: quote.getEventType() || '',

      // Rate information
      rate: rate
        ? {
          name: rate.get('name') || '',
          destination: rate.get('destination') || '',
          originCity: rate.get('originCity') || '',
          startDate: rate.get('startDate') || null,
          endDate: rate.get('endDate') || null,
          numberOfDays: rate.get('numberOfDays') || 0,
        }
        : null,

      // Service items (itinerary) - EXCLUDING notes per business decision
      serviceItems: {
        days: ((serviceItems.days || []).map((day) => ({
          dayNumber: day.dayNumber || 0,
          date: day.date || '',
          city: day.city || '',
          subconcepts: ((day.subconcepts || []).map((sub) => ({
            id: sub.id || '',
            type: sub.type || '',
            concept: sub.concept || '',
            serviceType: sub.serviceType || '',
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
            // EXCLUDE: notes (business decision)
          }))),
        }))),
        subtotal: serviceItems.subtotal || 0,
        iva: serviceItems.iva || 0,
        total: serviceItems.total || 0,
      },

      // Timestamps (for display only, not expiration - business decision)
      createdAt: quote.get('createdAt') || null,
      updatedAt: quote.get('updatedAt') || null,

      // EXCLUDE from public view:
      // - validUntil (expiration date - business decision)
      // - notes (internal notes - business decision)
      // - createdBy (internal user reference)
      // - shareToken (security)
      // - shareTokenActive (internal flag)
    };
  }
}

module.exports = new PublicQuoteController();
