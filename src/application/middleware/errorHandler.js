const logger = require('../../infrastructure/logger');

/**
 * Logs comprehensive error details for debugging, monitoring, and audit purposes.
 * Captures error context including user session, request details, and error stack trace
 * for security and operational monitoring with PCI DSS compliance.
 * @function logError
 * @param {Error} err - The error object containing message and stack trace.
 * @param {object} req - Express request object with user context and request details.
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // Log authentication error with user context
 * const authError = new Error('Invalid credentials');
 * logError(authError, req);
 *
 * // Log API error with detailed context
 * try {
 *   await api.processPayment(data);
 * } catch (error) {
 *   logError(error, req);
 *   res.status(500).json({ error: 'Payment processing failed' });
 * }
 */
function logError(err, req) {
  logger.error('Error Handler:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userId: req.user?.id,
  });
}

/**
 * Handles Parse Server specific errors with comprehensive error code mapping.
 * Provides standardized HTTP status codes and user-friendly error messages
 * for common Parse Server error conditions, supporting authentication,
 * session management, and data validation scenarios.
 * @function handleParseError
 * @param {Error} err - The Parse Server error object containing error code and message.
 * @returns {object|null} Status and message object with HTTP status code and user message, or null if not a Parse error.
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // Handle authentication error
 * const authError = { code: 101, message: 'Invalid username/password.' };
 * const result = handleParseError(authError);
 * // Returns: { status: 400, message: 'Invalid username or password' }
 *
 * // Handle session token error
 * const sessionError = { code: 209, message: 'Invalid session token' };
 * const result = handleParseError(sessionError);
 * // Returns: { status: 401, message: 'Invalid session token' }
 *
 * // Handle non-Parse error
 * const genericError = { message: 'Generic error' };
 * const result = handleParseError(genericError);
 * // Returns: null
 */
function handleParseError(err) {
  if (!err.code || err.code >= 600) {
    return null;
  }

  const parseErrors = {
    101: { status: 400, message: 'Invalid username or password' },
    202: { status: 400, message: 'Username already taken' },
    203: { status: 400, message: 'Email already taken' },
    209: { status: 401, message: 'Invalid session token' },
  };

  return parseErrors[err.code] || { status: 400, message: err.message };
}

/**
 * Handles MongoDB specific errors with comprehensive error classification.
 * Provides standardized HTTP status codes and user-friendly error messages
 * for common MongoDB error conditions, including duplicate key violations,
 * connection failures, and database operational errors with PCI DSS compliance.
 * @function handleMongoError
 * @param {Error} err - The MongoDB error object containing name, code, and message properties.
 * @returns {object|null} Status and message object with HTTP status code and user message, or null if not a MongoDB error.
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // Handle duplicate key error (unique constraint violation)
 * const duplicateError = { name: 'MongoError', code: 11000, message: 'E11000 duplicate key error' };
 * const result = handleMongoError(duplicateError);
 * // Returns: { status: 400, message: 'Duplicate key error' }
 *
 * // Handle general MongoDB error
 * const dbError = { name: 'MongoServerError', code: 2, message: 'BadValue' };
 * const result = handleMongoError(dbError);
 * // Returns: { status: 500, message: 'Database error occurred' }
 *
 * // Handle non-MongoDB error
 * const genericError = { name: 'Error', message: 'Generic error' };
 * const result = handleMongoError(genericError);
 * // Returns: null
 */
function handleMongoError(err) {
  if (err.name !== 'MongoError' && err.name !== 'MongoServerError') {
    return null;
  }

  if (err.code === 11000) {
    return { status: 400, message: 'Duplicate key error' };
  }

  return { status: 500, message: 'Database error occurred' };
}

/**
 * Handles validation errors with comprehensive detail aggregation.
 * Provides standardized HTTP status codes and user-friendly error messages
 * for input validation failures, supporting Joi validation schemas and
 * custom validation scenarios with detailed field-level error reporting.
 * @function handleValidationError
 * @param {Error} err - The validation error object containing name and details array.
 * @returns {object|null} Status and message object with HTTP status code and aggregated validation messages, or null if not a validation error.
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // Handle Joi validation error with multiple field violations
 * const validationError = {
 *   name: 'ValidationError',
 *   details: [
 *     { message: 'Username is required', path: ['username'] },
 *     { message: 'Email must be valid', path: ['email'] }
 *   ]
 * };
 * const result = handleValidationError(validationError);
 * // Returns: { status: 400, message: 'Username is required, Email must be valid' }
 *
 * // Handle validation error without details
 * const genericValidationError = { name: 'ValidationError' };
 * const result = handleValidationError(genericValidationError);
 * // Returns: { status: 400, message: 'Validation error' }
 *
 * // Handle non-validation error
 * const otherError = { name: 'TypeError', message: 'Type error' };
 * const result = handleValidationError(otherError);
 * // Returns: null
 */
function handleValidationError(err) {
  if (err.name !== 'ValidationError') {
    return null;
  }

  const message = err.details
    ? err.details.map((detail) => detail.message).join(', ')
    : 'Validation error';

  return { status: 400, message };
}

/**
 * Determines error status and message using comprehensive error classification.
 * Orchestrates error handling by delegating to specialized error handlers in sequence,
 * providing standardized HTTP status codes and user-friendly error messages for
 * Parse Server, MongoDB, validation, and generic error scenarios.
 * @function getErrorDetails
 * @param {Error} err - The error object containing various error properties (code, name, status, message).
 * @returns {object} Status and message object with HTTP status code and user-friendly error message.
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // Handle Parse Server authentication error
 * const parseError = { code: 101, message: 'Invalid username/password.' };
 * const result = getErrorDetails(parseError);
 * // Returns: { status: 400, message: 'Invalid username or password' }
 *
 * // Handle MongoDB duplicate key error
 * const mongoError = { name: 'MongoError', code: 11000 };
 * const result = getErrorDetails(mongoError);
 * // Returns: { status: 400, message: 'Duplicate key error' }
 *
 * // Handle validation error
 * const validationError = { name: 'ValidationError', details: [{ message: 'Required field' }] };
 * const result = getErrorDetails(validationError);
 * // Returns: { status: 400, message: 'Required field' }
 *
 * // Handle generic error with custom status
 * const customError = { status: 404, message: 'Resource not found' };
 * const result = getErrorDetails(customError);
 * // Returns: { status: 404, message: 'Resource not found' }
 *
 * // Handle generic error without status
 * const genericError = new Error('Something went wrong');
 * const result = getErrorDetails(genericError);
 * // Returns: { status: 500, message: 'Something went wrong' }
 */
function getErrorDetails(err) {
  /**
   * Attempts Parse Server error handling with specific error code mapping.
   * Processes Parse Server specific errors and returns appropriate HTTP status.
   */
  let result = handleParseError(err);
  if (result) {
    return result;
  }

  /**
   * Attempts MongoDB error handling for database operation failures.
   * Handles duplicate key errors and other MongoDB specific error conditions.
   */
  result = handleMongoError(err);
  if (result) {
    return result;
  }

  /**
   * Attempts validation error handling for input validation failures.
   * Processes Joi validation errors and other input validation scenarios.
   */
  result = handleValidationError(err);
  if (result) {
    return result;
  }

  return {
    status: err.status || err.statusCode || 500,
    message: err.message || 'Internal Server Error',
  };
}

/**
 * Main error handler middleware.
 * @param {Error} err - The error object.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {Function} _next - Express next function.
 * @returns {void} No return value.
 * @example
 * // Express error handling middleware
 * app.use(errorHandler);
 */
const errorHandler = (err, req, res, _next) => {
  logError(err, req);
  const { status, message } = getErrorDetails(err);
  const finalMessage = process.env.NODE_ENV === 'production' && status === 500
    ? 'An error occurred processing your request'
    : message;

  res.status(status);

  if (req.path.startsWith('/api') || req.path.startsWith('/parse')) {
    return res.json({
      error: true,
      message: finalMessage,
      status,
      ...(process.env.NODE_ENV === 'development' && {
        stack: err.stack,
        details: err,
      }),
    });
  }

  res.render('errors/error', {
    title: 'Error',
    status,
    message: finalMessage,
    error: process.env.NODE_ENV === 'development' ? err : {},
  });
};

module.exports = errorHandler;
