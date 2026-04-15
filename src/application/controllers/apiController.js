const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');
const FileStorageService = require('../services/FileStorageService');

/**
 * API Controller - Handles REST API endpoints for status, user profiles, and system information.
 * Provides JSON API endpoints for client applications, mobile apps, and third-party integrations
 * with proper authentication, authorization, and error handling.
 *
 * This controller manages core API functionality including system status monitoring,
 * user profile management, version information, and authenticated API operations
 * with comprehensive security and logging.
 *
 * Features:
 * - System status and health monitoring endpoints
 * - Version and environment information
 * - User profile management (get, update)
 * - Authentication and authorization validation
 * - Comprehensive error handling with proper HTTP codes
 * - Security logging and audit trails
 * - JSON response formatting with consistent structure.
 * @class ApiController
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Initialize API controller
 * const apiController = new ApiController();
 *
 * // Express route integration
 * router.get('/api/status', apiController.getStatus.bind(apiController));
 * router.get('/api/version', apiController.getVersion.bind(apiController));
 * router.get('/api/user/profile', authenticateMiddleware, apiController.getUserProfile.bind(apiController));
 * router.put('/api/user/profile', authenticateMiddleware, apiController.updateUserProfile.bind(apiController));
 *
 * // Example API responses
 * // GET /api/status -> { status: 'operational', timestamp: '2025-01-15T10:30:00Z', environment: 'production' }
 * // GET /api/user/profile -> { id: 'user123', username: 'john_doe', email: 'john@example.com', ... }
 */
class ApiController {
  /**
   * Retrieves system operational status and environment information.
   * Provides real-time status information for monitoring systems, health checks,
   * and client applications to verify API availability and system state.
   * @function getStatus
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} - JSON response with system status and timestamp.
   * @example
   * // GET endpoint example
   * const result = await ApiController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // GET /api/endpoint
   * // Response: { "success": true, "data": [...] }
   * // GET /api/status
   * // Response: { status: 'operational', timestamp: '2025-01-15T10:30:00Z', environment: 'production' }
   */
  async getStatus(req, res) {
    res.json({
      status: 'operational',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
    });
  }

  /**
   * Retrieves API version information and system details.
   * Provides version metadata for client compatibility checks, debugging,
   * and system integration validation with Parse Server and Node.js versions.
   * @function getVersion
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} - JSON response with version information.
   * @example
   * // GET endpoint example
   * const result = await ApiController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // GET /api/endpoint
   * // Response: { "success": true, "data": [...] }
   * // GET /api/version
   * // Response: { version: '1.0.0', parseVersion: '5.0.0', nodeVersion: 'v18.0.0', api: {...} }
   */
  async getVersion(req, res) {
    res.json({
      version: '1.0.0',
      parseVersion: Parse.VERSION,
      nodeVersion: process.version,
      api: {
        name: 'AmexingWeb API',
        description: 'PCI DSS compliant e-commerce API',
      },
    });
  }

  /**
   * Retrieves authenticated user profile information.
   * Returns user profile data for authenticated requests with proper
   * authorization validation and privacy-conscious data filtering.
   * @function getUserProfile
   * @param {object} req - Express request object with authenticated user.
   * @param {object} res - Express response object.
   * @param {Function} next - Express next middleware function.
   * @returns {Promise<void>} - JSON response with user profile data.
   * @example
   * // GET endpoint example
   * const result = await ApiController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // GET /api/endpoint
   * // Response: { "success": true, "data": [...] }
   * // GET /api/user/profile (with authentication)
   * // Response: { id: 'user123', username: 'john_doe', email: 'john@example.com', emailVerified: true, ... }
   */
  async getUserProfile(req, res, next) {
    try {
      const { user, roleObject, userRole } = req;

      if (!user) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User not authenticated',
        });
      }

      // Build role and permissions info
      const roleInfo = {
        name: userRole || null,
        level: roleObject?.getLevel?.() || null,
        displayName: roleObject?.get?.('displayName') || null,
        scope: roleObject?.get?.('scope') || null,
      };

      // Get permissions from role object
      const permissions = roleObject?.get?.('basePermissions') || [];

      // Get profile picture URL if available
      let profilePicture = null;
      const s3Key = user.get('profilePictureS3Key');
      if (s3Key) {
        try {
          const fileStorageService = new FileStorageService();
          profilePicture = await fileStorageService.getPresignedUrl(s3Key);
        } catch (imgError) {
          logger.warn('Failed to get profile picture URL', {
            userId: user.id,
            error: imgError.message,
          });
        }
      }

      res.json({
        id: user.id,
        username: user.get('username'),
        email: user.get('email'),
        firstName: user.get('firstName') || null,
        lastName: user.get('lastName') || null,
        emailVerified: user.get('emailVerified'),
        profilePicture,
        createdAt: user.get('createdAt'),
        lastLoginAt: user.get('lastLoginAt'),
        role: roleInfo,
        permissions,
      });
    } catch (error) {
      logger.error('Error getting user profile:', error);
      next(error);
    }
  }

  /**
   * Updates authenticated user profile information with validation and audit logging.
   * Processes profile updates for email and username with proper validation,
   * security logging, and email verification reset when email changes.
   * @function updateUserProfile
   * @param {object} req - Express request object with user and profile data in body.
   * @param {object} res - Express response object.
   * @param {Function} next - Express next middleware function.
   * @returns {Promise<void>} - JSON response with updated profile data.
   * @example
   * // POST endpoint example
   * const result = await ApiController.updateUserProfile(req, res);
   * // Body: { data: 'example' }
   * // Returns: { success: true, data: {...} }
   * // PUT /api/endpoint/123
   * // Body: { "field": "updated value" }
   * // Response: { "success": true, "data": {...} }
   * // PUT /api/user/profile (with authentication)
   * // Body: { email: 'newemail@example.com', username: 'newusername' }
   * // Response: { success: true, message: 'Profile updated successfully', user: {...} }
   */
  async updateUserProfile(req, res, next) {
    try {
      const { user } = req;
      const { email, username } = req.body;

      if (!user) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User not authenticated',
        });
      }

      // Update user fields
      if (email && email !== user.get('email')) {
        user.set('email', email);
        user.set('emailVerified', false);
      }

      if (username && username !== user.get('username')) {
        user.set('username', username);
      }

      // Save user
      await user.save(null, { sessionToken: req.sessionToken });

      logger.logSystemChange(user.id, 'PROFILE_UPDATE', null, null);

      res.json({
        success: true,
        message: 'Profile updated successfully',
        user: {
          id: user.id,
          username: user.get('username'),
          email: user.get('email'),
          emailVerified: user.get('emailVerified'),
        },
      });
    } catch (error) {
      logger.error('Error updating user profile:', error);
      next(error);
    }
  }

  /**
   * Retrieves sample data for API demonstration and testing.
   * Provides mock e-commerce data structure for client application development,
   * testing, and API integration validation with consistent response format.
   * @function getData
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} - JSON response with sample data items.
   * @example
   * // GET endpoint example
   * const result = await ApiController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // GET /api/endpoint
   * // Response: { "success": true, "data": [...] }
   * // GET /api/data
   * // Response: { items: [{id: 1, name: 'Item 1', price: 29.99}, ...], total: 3, timestamp: '...' }
   */
  async getData(req, res) {
    try {
      // Example data endpoint
      const data = {
        items: [
          { id: 1, name: 'Item 1', price: 29.99 },
          { id: 2, name: 'Item 2', price: 49.99 },
          { id: 3, name: 'Item 3', price: 19.99 },
        ],
        total: 3,
        timestamp: new Date().toISOString(),
      };

      res.json(data);
    } catch (error) {
      logger.error('Error getting data:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to retrieve data',
      });
    }
  }

  /**
   * Handles contact form submissions and sends notification emails.
   * Validates form data, processes the submission through ContactFormService,
   * and returns appropriate response to the client.
   * @function submitContactForm
   * @param {object} req - Express request object with contact form data in body.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} - JSON response with submission status.
   * @example
   * // POST /api/contact
   * // Body: { name: 'John Doe', email: 'john@example.com', message: 'Hello' }
   * // Response: { success: true, message: 'Contact form submitted successfully' }
   */
  async submitContactForm(req, res) {
    try {
      const {
        name, email, phone, company, subject, message,
      } = req.body;

      // Basic validation
      if (!name || !email || !message) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields',
          message: 'Name, email, and message are required.',
        });
      }

      // Email format validation
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(email)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid email format',
          message: 'Please provide a valid email address.',
        });
      }

      // Length validations
      if (name.length < 2 || name.length > 100) {
        return res.status(400).json({
          success: false,
          error: 'Invalid name length',
          message: 'Name must be between 2 and 100 characters.',
        });
      }

      if (message.length < 10 || message.length > 2000) {
        return res.status(400).json({
          success: false,
          error: 'Invalid message length',
          message: 'Message must be between 10 and 2000 characters.',
        });
      }

      // Import ContactFormService
      const ContactFormService = require('../services/ContactFormService');
      const contactFormService = new ContactFormService();

      // Process the contact form submission
      const result = await contactFormService.processContactForm({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone?.trim() || null,
        company: company?.trim() || null,
        subject: subject?.trim() || null,
        message: message.trim(),
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date(),
      });

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error || 'Failed to process contact form',
          message: 'There was an error processing your contact form. Please try again later.',
        });
      }

      // Log successful submission
      logger.info('Contact form submitted successfully', {
        name,
        email: email.toLowerCase(),
        company: company || null,
        subject: subject || null,
        messageLength: message.length,
        ip: req.ip,
        emailSent: result.emailSent,
        messageId: result.messageId,
      });

      res.json({
        success: true,
        message: 'Thank you for your message! We will get back to you soon.',
      });
    } catch (error) {
      logger.error('Error processing contact form:', {
        error: error.message,
        stack: error.stack,
        body: req.body,
        ip: req.ip,
      });

      res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'There was an error processing your contact form. Please try again later.',
      });
    }
  }
}

module.exports = new ApiController();
