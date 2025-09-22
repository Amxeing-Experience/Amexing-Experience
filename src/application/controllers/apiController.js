const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');

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
 * @version 2.0.0
 * @since 1.0.0
 * @example
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
   * @returns {Promise<void>} JSON response with system status and timestamp.
   * @example
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
   * @returns {Promise<void>} JSON response with version information.
   * @example
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
   * @returns {Promise<void>} JSON response with user profile data.
   * @example
   * // GET /api/user/profile (with authentication)
   * // Response: { id: 'user123', username: 'john_doe', email: 'john@example.com', emailVerified: true, ... }
   */
  async getUserProfile(req, res, next) {
    try {
      const { user } = req;

      if (!user) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User not authenticated',
        });
      }

      res.json({
        id: user.id,
        username: user.get('username'),
        email: user.get('email'),
        emailVerified: user.get('emailVerified'),
        createdAt: user.get('createdAt'),
        lastLoginAt: user.get('lastLoginAt'),
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
   * @returns {Promise<void>} JSON response with updated profile data.
   * @example
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
   * @returns {Promise<void>} JSON response with sample data items.
   * @example
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
}

module.exports = new ApiController();
