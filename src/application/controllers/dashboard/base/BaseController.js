const logger = require('../../../../infrastructure/logger');

/**
 * BaseController - Single Responsibility Principle (SRP)
 * This class has a single responsibility: handling basic controller operations.
 */
class BaseController {
  constructor() {
    this.viewsPath = 'dashboards/';
  }

  /**
   * Render a view with common data and layout.
   * @param res
   * @param view
   * @param data
   * @example
   */
  async render(res, view, data = {}) {
    try {
      const defaultData = {
        title: data.title || 'Dashboard',
        ...data,
      };

      // Check if this is a dashboard view that needs layout
      if (view.startsWith('dashboards/')) {
        // Render the content view first
        const contentHtml = await new Promise((resolve, reject) => {
          res.app.render(view, defaultData, (err, html) => {
            if (err) reject(err);
            else resolve(html);
          });
        });

        // Then render with layout
        const layoutData = {
          ...defaultData,
          body: contentHtml,
        };

        return res.render('layouts/dashboard', layoutData);
      }
      // Regular view without layout
      return res.render(view, defaultData);
    } catch (error) {
      logger.error('Render error:', error);
      return this.handleError(res, error);
    }
  }

  /**
   * Send JSON response.
   * @param res
   * @param data
   * @param statusCode
   * @example
   */
  json(res, data, statusCode = 200) {
    return res.status(statusCode).json(data);
  }

  /**
   * Handle errors consistently.
   * @param res
   * @param error
   * @param statusCode
   * @example
   */
  handleError(res, error, statusCode = 500) {
    logger.error('Controller Error:', error);

    if (res.headersSent) {
      return;
    }

    const errorResponse = {
      success: false,
      message: error.message || 'An unexpected error occurred',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
    };

    return this.json(res, errorResponse, statusCode);
  }

  /**
   * Redirect with flash message.
   * @param res
   * @param url
   * @param message
   * @param type
   * @example
   */
  redirectWithMessage(res, url, message, type = 'info') {
    if (res.locals.flash) {
      res.locals.flash(type, message);
    }
    return res.redirect(url);
  }

  /**
   * Validate required fields.
   * @param data
   * @param requiredFields
   * @example
   */
  validateRequired(data, requiredFields) {
    const missing = [];

    requiredFields.forEach((field) => {
      if (!data[field]) {
        missing.push(field);
      }
    });

    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }

    return true;
  }

  /**
   * Get pagination parameters.
   * @param query
   * @example
   */
  getPaginationParams(query) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const skip = (page - 1) * limit;

    return {
      page,
      limit,
      skip,
      sort: query.sort || '-createdAt',
    };
  }

  /**
   * Format date for display.
   * @param date
   * @example
   */
  formatDate(date) {
    if (!date) return '';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  /**
   * Format currency.
   * @param amount
   * @example
   */
  formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount || 0);
  }
}

module.exports = BaseController;
