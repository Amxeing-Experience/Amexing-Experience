/**
 * XSS Clean Wrapper.
 *
 * This is a custom implementation that replaces xss-clean
 * to fix compatibility issues with read-only req.query in newer Node.js versions.
 *
 * Created by Denisse Maldonado.
 */

const xss = require('xss');

/**
 * Recursively cleans XSS from values.
 * @param {*} value - The value to clean.
 * @returns {*} Cleaned value.
 * @example
 */
function cleanXSS(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    // Use xss library to clean the string
    return xss(value, {
      whiteList: {},
      stripIgnoreTag: true,
      stripIgnoreTagBody: ['script'],
    });
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(cleanXSS);
  }

  if (typeof value === 'object') {
    const cleaned = {};
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        cleaned[key] = cleanXSS(value[key]);
      }
    }
    return cleaned;
  }

  return value;
}

/**
 * Creates XSS protection middleware.
 * @returns {Function} Express middleware function.
 * @example
 */
function createXssCleanWrapper() {
  return function xssCleanMiddleware(req, res, next) {
    // Clean body
    if (req.body) {
      req.body = cleanXSS(req.body);
    }

    // Clean query parameters
    if (req.query) {
      const cleanedQuery = cleanXSS(req.query);
      // Safely update query object
      Object.keys(req.query).forEach((key) => {
        delete req.query[key];
      });
      Object.keys(cleanedQuery).forEach((key) => {
        Object.assign(req.query, { [key]: cleanedQuery[key] });
      });
    }

    // Clean params
    if (req.params) {
      const cleanedParams = cleanXSS(req.params);
      Object.keys(req.params).forEach((key) => {
        delete req.params[key];
      });
      Object.keys(cleanedParams).forEach((key) => {
        Object.assign(req.params, { [key]: cleanedParams[key] });
      });
    }

    next();
  };
}

module.exports = createXssCleanWrapper;
