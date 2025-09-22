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
 * @version 2.0.0
 * @since 1.0.0
 * @example
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
        title: 'AmexingWeb - Secure E-Commerce Platform',
        message: 'Welcome to AmexingWeb',
        user: req.session?.user || null,
        features: [
          'PCI DSS 4.0 Compliant',
          'Secure Payment Processing',
          'Parse Server Backend',
          'MongoDB Database',
          'Enhanced Security with Helmet',
        ],
      };

      res.render('index', data);
    } catch (error) {
      logger.error('Error rendering home page:', error);
      next(error);
    }
  }

  /**
   * Renders the about page with platform information and user context.
   * Displays comprehensive information about the AmexingWeb platform including
   * security features, PCI DSS compliance, and platform capabilities.
   * @function about
   * @param {object} req - Express request object with optional user session.
   * @param {object} res - Express response object.
   * @param {Function} next - Express next middleware function for error handling.
   * @returns {Promise<void>} Renders about page template.
   * @example
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
