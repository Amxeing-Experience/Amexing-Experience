/**
 * MongoDB Sanitization Wrapper.
 *
 * This is a custom implementation that replaces express-mongo-sanitize
 * to fix compatibility issues with read-only req.query in newer Node.js versions.
 *
 * Created by Denisse Maldonado.
 */

// Winston is imported but not used directly, only passed to onSanitize callback
// const winston = require('winston');

/**
 * Recursively sanitizes an object to prevent NoSQL injection.
 * @param {*} value - The value to sanitize.
 * @param {string} replaceWith - Character to replace prohibited keys with.
 * @param {Array} path - Current path in the object tree.
 * @param {Function} onSanitize - Callback when sanitization occurs.
 * @param {object} req - Express request object for logging.
 * @returns {*} Sanitized value.
 * @example
 */
function sanitizeValue(value, replaceWith, onSanitize, req, path = []) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, replaceWith, onSanitize, req, [...path, index]));
  }

  if (typeof value === 'object') {
    const sanitized = {};
    // Track if any changes were made (for future use)
    // let hasChanges = false;

    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        let sanitizedKey = key;

        // Check for prohibited MongoDB operators
        if (key.startsWith('$') || key.includes('.')) {
          sanitizedKey = key.replace(/^\$+/, replaceWith).replace(/\./g, replaceWith);
          // hasChanges = true;

          if (onSanitize) {
            onSanitize({
              req,
              key: [...path, key].join('.'),
            });
          }
        }

        sanitized[sanitizedKey] = sanitizeValue(
          value[key],
          replaceWith,
          onSanitize,
          req,
          [...path, sanitizedKey]
        );
      }
    }

    return sanitized;
  }

  return value;
}

/**
 * Creates a MongoDB sanitization middleware.
 * @param {object} options - Configuration options.
 * @param {string} options.replaceWith - Character to replace prohibited keys with (default: '_').
 * @param {Function} options.onSanitize - Callback when sanitization occurs.
 * @returns {Function} Express middleware function.
 * @example
 */
function createMongoSanitizeWrapper(options = {}) {
  const { replaceWith = '_', onSanitize } = options;

  return function mongoSanitizeMiddleware(req, res, next) {
    // Sanitize body
    if (req.body) {
      req.body = sanitizeValue(req.body, replaceWith, onSanitize, req, ['body']);
    }

    // Sanitize query parameters
    if (req.query) {
      const sanitizedQuery = sanitizeValue(req.query, replaceWith, onSanitize, req, ['query']);
      // Use Object.assign instead of direct assignment
      Object.keys(sanitizedQuery).forEach((key) => {
        if (!(key in req.query) || req.query[key] !== sanitizedQuery[key]) {
          // Only update changed values
          Object.assign(req.query, { [key]: sanitizedQuery[key] });
        }
      });
      // Remove keys that were sanitized away
      Object.keys(req.query).forEach((key) => {
        if (!(key in sanitizedQuery)) {
          delete req.query[key];
        }
      });
    }

    // Sanitize params
    if (req.params) {
      const sanitizedParams = sanitizeValue(req.params, replaceWith, onSanitize, req, ['params']);
      Object.keys(sanitizedParams).forEach((key) => {
        if (!(key in req.params) || req.params[key] !== sanitizedParams[key]) {
          Object.assign(req.params, { [key]: sanitizedParams[key] });
        }
      });
    }

    next();
  };
}

module.exports = createMongoSanitizeWrapper;
