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
   * @param {object} res - Express response object.
   * @param {*} view - View parameter.
   * @param {object} data - Data object.
   * @example
   * // Usage example
   * const result = await render({ view: 'example', data: 'example' });
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {Promise<object>} - Promise resolving to operation result.
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
   * @param {object} res - Express response object.
   * @param {object} data - Data object.
   * @param {*} statusCode - StatusCode parameter.
   * @example
   * // Usage example
   * const result = await json({ data: 'example', statusCode: 'example' });
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {void} - No return value Operation result.
   */
  json(res, data, statusCode = 200) {
    return res.status(statusCode).json(data);
  }

  /**
   * Handle errors consistently.
   * @param {object} res - Express response object.
   * @param {Error} error - Error object.
   * @param {*} statusCode - StatusCode parameter.
   * @example
   * // Usage example
   * const result = await handleError({ error: 'example', statusCode: 'example' });
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {*} - Operation result.
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
   * @param {object} res - Express response object.
   * @param {*} url - Url parameter.
   * @param {string} message - Message string.
   * @param {*} type - Type parameter.
   * @example
   * // Usage example
   * const result = await redirectWithMessage({ url: 'example', message: 'example', type: 'example' });
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {void} - No return value Operation result.
   */
  redirectWithMessage(res, url, message, type = 'info') {
    if (res.locals.flash) {
      res.locals.flash(type, message);
    }
    return res.redirect(url);
  }

  /**
   * Validate required fields.
   * @param {object} data - Data object.
   * @param {*} requiredFields - RequiredFields parameter.
   * @example
   * // Validation utility usage
   * const isValid = validateFunction(input);
   * // Returns: boolean
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {boolean} - Boolean result Operation result.
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
   * @param {object} query - Query parameters object.
   * @example
   * // GET endpoint example
   * const result = await BaseController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {object} - Operation result.
   */
  getPaginationParams(query) {
    const page = parseInt(query.page, 10) || 1;
    const limit = parseInt(query.limit, 10) || 10;
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
   * @param {*} date - Date parameter.
   * @example
   * // Transform utility usage
   * const result = transformFunction(data);
   * // Returns: transformed data object
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {object} - Operation result.
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
   * @param {*} amount - Amount parameter.
   * @example
   * // Transform utility usage
   * const result = transformFunction(data);
   * // Returns: transformed data object
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * @returns {object} - Operation result.
   */
  formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount || 0);
  }
}

module.exports = BaseController;
