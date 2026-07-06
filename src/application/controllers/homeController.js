const logger = require('../../infrastructure/logger');
const tripAdvisorService = require('../services/tripAdvisorService');
const POIService = require('../services/POIService');
const FleetService = require('../services/FleetService');

// Instancias únicas para el render público (resuelven destinos/flota + presigned URLs).
const poiService = new POIService();
const fleetService = new FleetService();

/**
 * Home Controller - Handles public web pages and landing page functionality.
 * Manages the main website interface including home, about, and informational pages
 * with proper session handling and responsive rendering.
 *
 * This controller provides the public-facing web interface for the Amexing platform,
 * handling the presentation layer for marketing content, feature showcases, and
 * general information pages with user session awareness.
 *
 * Features:
 * - Home page with feature highlights and platform overview
 * - About page with platform description and compliance information
 * - Session-aware user interface (logged in vs anonymous)
 * - Responsive page rendering with EJS templates
 * - Error handling with graceful fallbacks
 * - Security compliance information display
 * - Platform feature and technology showcasing.
 * @class HomeController
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Initialize home controller (singleton pattern)
 * const homeController = require('./homeController');
 *
 * // Express route integration
 * router.get('/', homeController.index.bind(homeController));
 * router.get('/about', homeController.about.bind(homeController));
 *
 * // Example page data structure
 * // Homepage: { title: 'AmexingWeb', features: ['PCI DSS Compliant', 'Secure Payment'], user: userSession }
 * // About: { title: 'About AmexingWeb', description: 'Secure e-commerce platform...', user: userSession }
 */
class HomeController {
  async index(req, res, next) {
    try {
      // Use req.language if set by route, otherwise use i18n detected language
      const currentLang = req.language || req.i18n?.language || 'es';

      // Fetch testimonials from TripAdvisor service
      let testimonials = [];
      try {
        testimonials = await tripAdvisorService.getTopReviews(15, currentLang);
      } catch (error) {
        logger.error('Error fetching testimonials for landing page:', error);
        // Will use fallback testimonials from the service
      }

      const data = {
        title: req.t ? req.t('pages:home.title') : 'Amexing Experience',
        user: req.session?.user || null,
        currentPage: 'home',
        seo: {
          description: req.t ? req.t('pages:home.description') : 'Premium transportation experience',
          keywords: req.t ? req.t('pages:home.keywords') : 'premium transport, San Miguel de Allende',
          author: 'Amexing Experience',
        },
        company: this.getCompanyData(),
        testimonials, // Add testimonials to the data
        req,
        t: req.t || ((key) => key),
        currentLang,
      };

      res.render('landing', data);
    } catch (error) {
      logger.error('Error rendering landing page:', error);
      next(error);
    }
  }

  /**
   * Renders the about page in Spanish (Nosotros).
   * Displays information about Amexing Experience company, history, and values.
   * @param req
   * @param res
   * @param next
   * @example
   */
  async nosotros(req, res, next) {
    try {
      const currentLang = req.language || req.language || 'es';

      const data = {
        title: req.t ? req.t('pages:about.title') : 'About - Amexing Experience',
        user: req.session?.user || null,
        currentPage: 'about',
        seo: {
          description: req.t ? req.t('pages:about.description') : '30 years of experience',
          keywords: req.t ? req.t('pages:about.keywords') : 'about us, amexing experience',
          author: 'Amexing Experience',
        },
        company: this.getCompanyData(),
        req,
        t: req.t || ((key) => key),
        currentLang,
      };

      res.render('nosotros', data);
    } catch (error) {
      logger.error('Error rendering nosotros page:', error);
      next(error);
    }
  }

  /**
   * Renders the services page (Servicios).
   * Displays all service offerings and experiences available.
   * @param req
   * @param res
   * @param next
   * @example
   */
  async servicios(req, res, next) {
    try {
      const currentLang = req.language || req.language || 'es';

      const data = {
        title: req.t ? req.t('pages:services.title') : 'Services - Amexing Experience',
        user: req.session?.user || null,
        currentPage: 'services',
        seo: {
          description: req.t ? req.t('pages:services.description') : 'Premium transportation services',
          keywords: req.t ? req.t('pages:services.keywords') : 'services, premium transport',
          author: 'Amexing Experience',
        },
        company: this.getCompanyData(),
        req,
        t: req.t || ((key) => key),
        currentLang,
      };

      res.render('servicios', data);
    } catch (error) {
      logger.error('Error rendering servicios page:', error);
      next(error);
    }
  }

  /**
   * Renders a provisional Services subpage (Transporte, Tours, Experiencias, Bodas y Eventos).
   * The view name is injected so a single handler serves every subpage.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @param {Function} next - Express next middleware.
   * @param {string} view - View path to render (e.g. 'servicios/transporte').
   * @param {string} pageTitle - Title shown in the browser tab.
   * @returns {Promise<void>} Resolves once the view is rendered.
   * @example
   * homeController.servicePage(req, res, next, 'servicios/tours', 'Tours');
   */
  async servicePage(req, res, next, view, pageTitle) {
    try {
      const currentLang = req.language || 'es';
      // t fijado al idioma resuelto: req.t queda atado al idioma detectado por
      // el middleware, antes del changeLanguage de las rutas /en, así que en
      // esas rutas devolvía español. getFixedT(currentLang) lo corrige.
      const t = req.i18n && typeof req.i18n.getFixedT === 'function'
        ? req.i18n.getFixedT(currentLang)
        : req.t || ((key) => key);

      const data = {
        title: `${pageTitle} - Amexing Experience`,
        user: req.session?.user || null,
        currentPage: 'services',
        seo: {
          description: t('pages:services.description'),
          keywords: t('pages:services.keywords'),
          author: 'Amexing Experience',
        },
        company: this.getCompanyData(),
        req,
        t,
        currentLang,
      };

      // Tours: el strip horizontal muestra los DESTINOS tipo Tours activos (con su imagen)
      // en vez de categorías fijas. Se resuelve server-side (página pública, sin auth).
      if (view === 'servicios/tours') {
        data.tourDestinos = await poiService.getActivePOIsWithImages('Tours');
      }

      res.render(view, data);
    } catch (error) {
      logger.error(`Error rendering service subpage (${view}):`, error);
      next(error);
    }
  }

  /**
   * Renders the FAQ page (Preguntas Frecuentes) at /recursos/faq.
   * Two-level accordion: categories -> questions -> answers.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @param {Function} next - Express next middleware.
   * @returns {Promise<void>} Resolves once the view is rendered.
   * @example
   * router.get('/recursos/faq', homeController.recursosFaq.bind(homeController));
   */
  async recursosFaq(req, res, next) {
    try {
      const currentLang = req.language || 'es';

      const data = {
        title: `${currentLang === 'en' ? 'FAQ' : 'Preguntas Frecuentes'} - Amexing Experience`,
        user: req.session?.user || null,
        currentPage: 'faq',
        seo: {
          description: 'Preguntas frecuentes sobre los servicios de Amexing Experience.',
          keywords: 'faq, preguntas frecuentes, ayuda, amexing',
          author: 'Amexing Experience',
        },
        company: this.getCompanyData(),
        req,
        t: req.t || ((key) => key),
        currentLang,
      };

      res.render('recursos/faq', data);
    } catch (error) {
      logger.error('Error rendering FAQ page:', error);
      next(error);
    }
  }

  /**
   * Renders the fleet page (Nuestra Flota).
   * Displays vehicle fleet information and specifications.
   * @param req
   * @param res
   * @param next
   * @example
   */
  async fleet(req, res, next) {
    try {
      const currentLang = req.language || 'es';
      // t fijado al idioma resuelto (req.t queda atado al idioma del middleware
      // antes del changeLanguage de /en/our-fleet).
      const t = req.i18n && typeof req.i18n.getFixedT === 'function'
        ? req.i18n.getFixedT(currentLang)
        : req.t || ((key) => key);

      const data = {
        title: t('pages:fleet.title'),
        user: req.session?.user || null,
        currentPage: 'fleet',
        seo: {
          description: t('pages:fleet.description'),
          keywords: t('pages:fleet.keywords'),
          author: 'Amexing Experience',
        },
        company: this.getCompanyData(),
        req,
        t,
        currentLang,
      };

      // Flota real agrupada por categoría (VehicleType) con sus imágenes, server-side.
      // La vista cae a su placeholder si viene vacío.
      data.fleetByCategory = await fleetService.getActiveFleetByCategory();

      res.render('nuestra-flota', data);
    } catch (error) {
      logger.error('Error rendering fleet page:', error);
      next(error);
    }
  }

  /**
   * Renders the contact page (Contacto).
   * Displays contact information and booking functionality.
   * @param req
   * @param res
   * @param next
   * @example
   */
  async contacto(req, res, next) {
    try {
      const currentLang = req.language || req.language || 'es';

      const data = {
        title: req.t ? req.t('pages:contact.title') : 'Contact - Amexing Experience',
        user: req.session?.user || null,
        currentPage: 'contact',
        seo: {
          description: req.t ? req.t('pages:contact.description') : 'Contact Amexing Experience',
          keywords: req.t ? req.t('pages:contact.keywords') : 'contact, bookings, san miguel de allende',
          author: 'Amexing Experience',
        },
        company: this.getCompanyData(),
        req,
        t: req.t || ((key) => key),
        currentLang,
      };

      res.render('contacto', data);
    } catch (error) {
      logger.error('Error rendering contacto page:', error);
      next(error);
    }
  }

  /**
   * Returns standardized company data for all pages.
   * @example
   */
  getCompanyData() {
    return {
      name: 'AMEXING',
      tagline: 'Experience',
      fullName: 'Amexing Experience',
      description: 'Transporte premium y experiencias de lujo en San Miguel de Allende',
      phone: '+52 (415) 152-7890',
      email: 'info@amexing.com',
      whatsapp: '+52 1 415 153 3818',
      address: 'San Miguel de Allende, Guanajuato, México',
      founded: '1994',
      certifications: ['SECTUR', 'AMESTUR', 'EarthCheck'],
    };
  }

  /**
   * Renders the about page with platform information and user context.
   * Displays comprehensive information about the AmexingWeb platform including
   * security features, PCI DSS compliance, and platform capabilities.
   * @function about
   * @param {object} req - Express request object with optional user session.
   * @param {object} res - Express response object.
   * @param {Function} next - Express next middleware function for error handling.
   * @returns {Promise<void>} - Renders about page template.
   * @example
   * // Usage example
   * const result = await about(parameters);
   * // Returns: operation result
   * // GET /api/endpoint
   * // Response: { "success": true, "data": [...] }
   * // GET /about
   * // Renders about page with platform information and user context
   */
  async about(req, res, next) {
    try {
      const currentLang = req.language || req.language || 'es';

      const data = {
        title: req.t ? req.t('pages:about.title') : 'About - Amexing Experience',
        user: req.session?.user || null,
        currentPage: 'about',
        seo: {
          description: req.t ? req.t('pages:about.description') : '30 years of experience',
          keywords: req.t ? req.t('pages:about.keywords') : 'about us, amexing experience',
          author: 'Amexing Experience',
        },
        company: this.getCompanyData(),
        req,
        t: req.t || ((key) => key),
        currentLang,
        description:
          'AmexingWeb is a secure e-commerce platform built with Parse Server and designed for PCI DSS compliance.',
      };

      res.render('about', data);
    } catch (error) {
      logger.error('Error rendering about page:', error);
      next(error);
    }
  }
}

module.exports = new HomeController();
