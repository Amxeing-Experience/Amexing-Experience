const Joi = require('joi');
const logger = require('../../infrastructure/logger');

/**
 * Validation Middleware - Provides comprehensive request validation using Joi schemas.
 * Validates request data (body, query, params) against predefined schemas with
 * detailed error reporting and security-focused input sanitization.
 *
 * This middleware implements robust input validation to prevent injection attacks,
 * ensure data integrity, and provide clear validation error messages for API consumers.
 * It supports validation of multiple request properties with flexible schema definitions.
 *
 * Features:
 * - Joi schema-based validation for body, query, and params
 * - Input sanitization and unknown property stripping
 * - Detailed validation error reporting with field-specific messages
 * - Security-focused validation property allowlisting
 * - Comprehensive logging of validation failures
 * - PCI DSS compliant input validation
 * - Support for complex nested object validation
 * - Integration with authentication and authorization flows.
 * @class ValidationMiddleware
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Initialize validation middleware
 * const validationMiddleware = new ValidationMiddleware();
 *
 * // Define Joi schemas
 * const userRegistrationSchema = Joi.object({
 *   username: Joi.string().min(3).max(30).required(),
 *   email: Joi.string().email().required(),
 *   password: Joi.string().min(8).required()
 * });
 *
 * // Apply validation to routes
 * router.post('/register',
 *   validationMiddleware.validateRequest(userRegistrationSchema, 'body'),
 *   authController.register
 * );
 *
 * // Query parameter validation
 * const searchSchema = Joi.object({
 *   q: Joi.string().min(1).max(100).required(),
 *   limit: Joi.number().min(1).max(50).default(10)
 * });
 * router.get('/search',
 *   validationMiddleware.validateRequest(searchSchema, 'query'),
 *   searchController.search
 * );
 */
class ValidationMiddleware {
  /**
   * Creates dynamic validation middleware for request data validation.
   * Returns Express middleware function that validates specified request property
   * against Joi schema with comprehensive error handling and security measures.
   * @function validateRequest
   * @param {object} schema - Joi validation schema object.
   * @param {string} [property] - Request property to validate ('body', 'query', 'params').
   * @returns {Function} - Operation result Express middleware function for request validation.
   * @example
   * // Middleware usage
   * app.use('/path', middlewareFunction);
   * // Processes request before route handler
   * // app.use(middlewareName);
   * // Middleware protects routes with validation/authentication
   * // Validate request body
   * const middleware = validationMiddleware.validateRequest(userSchema, 'body');
   * router.post('/users', middleware, userController.create);
   *
   * // Validate query parameters
   * const queryMiddleware = validationMiddleware.validateRequest(searchSchema, 'query');
   * router.get('/search', queryMiddleware, searchController.find);
   */
  validateRequest(schema, property = 'body') {
    return (req, res, next) => {
      // Validate property name to prevent injection
      const allowedProperties = ['body', 'query', 'params'];
      if (!allowedProperties.includes(property)) {
        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'Invalid validation property',
        });
      }

      // Get data to validate based on property
      const dataToValidate = this.getRequestProperty(req, property);
      const { error, value } = schema.validate(dataToValidate, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        logger.warn('Validation error:', {
          path: req.path,
          errors: error.details,
        });

        return res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid request data',
          details: error.details.map((detail) => ({
            field: detail.path.join('.'),
            message: detail.message,
          })),
        });
      }

      // Replace request property with validated value
      this.setRequestProperty(req, property, value);
      next();
    };
  }

  /**
   * Safely retrieves request property data with type validation.
   * Provides secure access to request properties with proper validation
   * to prevent injection attacks and ensure data integrity.
   * @function getRequestProperty
   * @param {object} req - Express request object.
   * @param {string} property - Property name to retrieve ('body', 'query', 'params').
   * @returns {object} - Operation result Request property data or empty object if invalid.
   * @example
   * // Middleware usage
   * app.use('/path', middlewareFunction);
   * // Processes request before route handler
   * // app.use(middlewareName);
   * // Middleware protects routes with validation/authentication
   * // Get request body data
   * const bodyData = this.getRequestProperty(req, 'body');
   */
  getRequestProperty(req, property) {
    switch (property) {
      case 'body':
        return req.body;
      case 'query':
        return req.query;
      case 'params':
        return req.params;
      default:
        return {};
    }
  }

  /**
   * Safely sets validated request property data with security measures.
   * Updates request properties with validated and sanitized data after
   * successful Joi schema validation, preventing data corruption.
   * @function setRequestProperty
   * @param {object} req - Express request object.
   * @param {string} property - Property name to set ('body', 'query', 'params').
   * @param {object} value - Validated data to set.
   * @returns {void} - No return value Updates request object in place.
   * @example
   * // Middleware usage
   * app.use('/path', middlewareFunction);
   * // Processes request before route handler
   * // app.use(middlewareName);
   * // Middleware protects routes with validation/authentication
   * // Set validated body data
   * this.setRequestProperty(req, 'body', validatedData);
   */
  setRequestProperty(req, property, value) {
    switch (property) {
      case 'body':
        req.body = value;
        break;
      case 'query':
        // Use Object.assign to merge with existing query object
        Object.assign(req.query, value);
        break;
      case 'params':
        // Use Object.assign for params as well to be safe
        Object.assign(req.params, value);
        break;
      default:
        // Do nothing for invalid properties
        break;
    }
  }

  /**
   * Validates user profile update data with optional field validation.
   * Ensures profile updates meet security requirements with proper input sanitization
   * and data type validation for user account modifications.
   * @function validateUpdateProfile
   * @param {object} req - Express request object with profile data in body.
   * @param {object} res - Express response object.
   * @param {Function} next - Express next middleware function.
   * @returns {void} - No return value Continues to next middleware or returns validation error.
   * @example
   * // Middleware usage
   * app.use('/path', middlewareFunction);
   * // Processes request before route handler
   * // POST /api/endpoint
   * // Body: { "data": "value" }
   * // Response: { "success": true, "message": "Created" }
   * // POST /profile/update
   * // Body: { username: 'newusername', email: 'new@email.com' }
   */
  validateUpdateProfile(req, res, next) {
    const schema = Joi.object({
      username: Joi.string().alphanum().min(3).max(30)
        .optional(),
      email: Joi.string().email().optional(),
    });

    const validationMiddleware = new ValidationMiddleware();
    return validationMiddleware.validateRequest(schema)(req, res, next);
  }

  /**
   * Validates user registration data with comprehensive security requirements.
   * Enforces password complexity, email format validation, and username constraints
   * with PCI DSS compliant input validation for new user accounts.
   * @function validateRegistration
   * @param {object} req - Express request object with registration data in body.
   * @param {object} res - Express response object.
   * @param {Function} next - Express next middleware function.
   * @returns {void} - No return value Continues to next middleware or returns validation error.
   * @example
   * // Middleware usage
   * app.use('/path', middlewareFunction);
   * // Processes request before route handler
   * // POST /api/endpoint
   * // Body: { "data": "value" }
   * // Response: { "success": true, "message": "Created" }
   * // POST /register
   * // Body: { username: 'user123', email: 'user@example.com', password: 'user-password', confirmPassword: 'user-password' }
   */
  validateRegistration(req, res, next) {
    const schema = Joi.object({
      username: Joi.string().alphanum().min(3).max(30)
        .required(),
      email: Joi.string().email().required(),
      password: Joi.string()
        .min(parseInt(process.env.PASSWORD_MIN_LENGTH, 10) || 12)
        .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])/)
        .required()
        .messages({
          'string.pattern.base':
            'Password must contain at least one lowercase letter, one uppercase letter, one digit, and one special character',
          'string.min': `Password must be at least ${process.env.PASSWORD_MIN_LENGTH || 12} characters long`,
        }),
      confirmPassword: Joi.string().valid(Joi.ref('password')).required().messages({
        'any.only': 'Passwords must match',
      }),
    });

    const validationMiddleware = new ValidationMiddleware();
    return validationMiddleware.validateRequest(schema)(req, res, next);
  }

  /**
   * Validates user login credentials with security requirements.
   * Ensures login requests contain required username and password fields
   * with proper data type validation for authentication processing.
   * @function validateLogin
   * @param {object} req - Express request object with login credentials in body.
   * @param {object} res - Express response object.
   * @param {Function} next - Express next middleware function.
   * @returns {void} - No return value Continues to next middleware or returns validation error.
   * @example
   * // Middleware usage
   * app.use('/path', middlewareFunction);
   * // Processes request before route handler
   * // POST /api/endpoint
   * // Body: { "data": "value" }
   * // Response: { "success": true, "message": "Created" }
   * // POST /login
   * // Body: { username: 'user@example.com', password: 'user-password' }
   */
  validateLogin(req, res, next) {
    const schema = Joi.object({
      username: Joi.string().required(),
      password: Joi.string().required(),
    });

    const validationMiddleware = new ValidationMiddleware();
    return validationMiddleware.validateRequest(schema)(req, res, next);
  }

  /**
   * Validates password reset request with email format verification.
   * Ensures password reset requests contain a valid email address format
   * for sending password recovery instructions to users.
   * @function validatePasswordReset
   * @param {object} req - Express request object with email in body.
   * @param {object} res - Express response object.
   * @param {Function} next - Express next middleware function.
   * @returns {void} - No return value Continues to next middleware or returns validation error.
   * @example
   * // Middleware usage
   * app.use('/path', middlewareFunction);
   * // Processes request before route handler
   * // POST /api/endpoint
   * // Body: { "data": "value" }
   * // Response: { "success": true, "message": "Created" }
   * // POST /auth/forgot-password
   * // Body: { email: 'user@example.com' }
   */
  validatePasswordReset(req, res, next) {
    const schema = Joi.object({
      email: Joi.string().email().required(),
    });

    const validationMiddleware = new ValidationMiddleware();
    return validationMiddleware.validateRequest(schema)(req, res, next);
  }

  /**
   * Validates new password during password reset process with security requirements.
   * Enforces password complexity rules, confirmation matching, and token validation
   * with PCI DSS compliant security standards for password recovery completion.
   * @function validateNewPassword
   * @param {object} req - Express request object with password, confirmPassword, and token in body.
   * @param {object} res - Express response object.
   * @param {Function} next - Express next middleware function.
   * @returns {void} - No return value Continues to next middleware or returns validation error.
   * @example
   * // Middleware usage
   * app.use('/path', middlewareFunction);
   * // Processes request before route handler
   * // POST /api/endpoint
   * // Body: { "data": "value" }
   * // Response: { "success": true, "message": "Created" }
   * // POST /auth/reset-password
   * // Body: { password: 'new-password', confirmPassword: 'new-password', token: 'reset-token-abc123' }
   */
  validateNewPassword(req, res, next) {
    const schema = Joi.object({
      password: Joi.string()
        .min(parseInt(process.env.PASSWORD_MIN_LENGTH, 10) || 12)
        .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])/)
        .required()
        .messages({
          'string.pattern.base':
            'Password must contain at least one lowercase letter, one uppercase letter, one digit, and one special character',
          'string.min': `Password must be at least ${process.env.PASSWORD_MIN_LENGTH || 12} characters long`,
        }),
      confirmPassword: Joi.string().valid(Joi.ref('password')).required().messages({
        'any.only': 'Passwords must match',
      }),
      token: Joi.string().required(),
    });

    const validationMiddleware = new ValidationMiddleware();
    return validationMiddleware.validateRequest(schema)(req, res, next);
  }
}

module.exports = new ValidationMiddleware();
