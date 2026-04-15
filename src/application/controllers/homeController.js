const logger = require('../../infrastructure/logger');

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
      const data = {
        title: 'Amexing Experience - Transporte Premium en San Miguel de Allende',
        user: req.session?.user || null,
        currentPage: 'home',
        seo: {
          description: 'Experiencia de transporte premium en San Miguel de Allende con flota Tesla y 30 años de experiencia. Servicios de lujo, tours exclusivos y atención personalizada.',
          keywords: 'transporte premium, San Miguel de Allende, Tesla, tours, experiencias de lujo, transporte ejecutivo',
          author: 'Amexing Experience',
        },
        company: this.getCompanyData(),
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
   */
  async nosotros(req, res, next) {
    try {
      const data = {
        title: 'Nosotros - Amexing Experience',
        user: req.session?.user || null,
        currentPage: 'about',
        seo: {
          description: '30 años de experiencia en transporte premium en San Miguel de Allende. Conoce nuestra historia, misión y valores que nos hacen únicos.',
          keywords: 'nosotros, amexing experience, historia, san miguel de allende, transporte premium',
          author: 'Amexing Experience',
        },
        company: this.getCompanyData(),
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
   */
  async servicios(req, res, next) {
    try {
      const data = {
        title: 'Servicios - Amexing Experience',
        user: req.session?.user || null,
        currentPage: 'services',
        seo: {
          description: 'Servicios de transporte premium, tours exclusivos y experiencias de lujo en San Miguel de Allende. Tesla, tours personalizados y más.',
          keywords: 'servicios, transporte premium, tours, tesla, san miguel de allende, experiencias de lujo',
          author: 'Amexing Experience',
        },
        company: this.getCompanyData(),
      };

      res.render('servicios', data);
    } catch (error) {
      logger.error('Error rendering servicios page:', error);
      next(error);
    }
  }

  /**
   * Renders the fleet page (Nuestra Flota).
   * Displays vehicle fleet information and specifications.
   */
  async fleet(req, res, next) {
    try {
      const data = {
        title: 'Nuestra Flota - Amexing Experience',
        user: req.session?.user || null,
        currentPage: 'fleet',
        seo: {
          description: 'Conoce nuestra flota premium de vehículos Tesla y otros vehículos de lujo para transporte ejecutivo en San Miguel de Allende.',
          keywords: 'flota, tesla, vehículos premium, transporte ejecutivo, san miguel de allende',
          author: 'Amexing Experience',
        },
        company: this.getCompanyData(),
      };

      res.render('nuestra-flota', data);
    } catch (error) {
      logger.error('Error rendering fleet page:', error);
      next(error);
    }
  }

  /**
   * Renders the contact page (Contacto).
   * Displays contact information and booking functionality.
   */
  async contacto(req, res, next) {
    try {
      const data = {
        title: 'Contacto - Amexing Experience',
        user: req.session?.user || null,
        currentPage: 'contact',
        seo: {
          description: 'Contacta con Amexing Experience para reservar tu transporte premium en San Miguel de Allende. WhatsApp, email y reservas online.',
          keywords: 'contacto, reservas, whatsapp, booking, san miguel de allende, transporte premium',
          author: 'Amexing Experience',
        },
        company: this.getCompanyData(),
      };

      res.render('contacto', data);
    } catch (error) {
      logger.error('Error rendering contacto page:', error);
      next(error);
    }
  }

  /**
   * Returns standardized company data for all pages.
   */
  getCompanyData() {
    return {
      name: 'AMEXING',
      tagline: 'Experience',
      fullName: 'Amexing Experience',
      description: 'Transporte premium y experiencias de lujo en San Miguel de Allende',
      phone: '+52 (415) 152-7890',
      email: 'info@amexing.com',
      whatsapp: '+52 415 152 7890',
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
      const data = {
        title: 'About AmexingWeb',
        user: req.session?.user || null,
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
