const express = require('express');
const logger = require('../../infrastructure/logger');

const router = express.Router();
const apiController = require('../../application/controllers/apiController');
// const authMiddleware = require('../../application/middleware/authMiddleware'); // Unused import
const jwtMiddleware = require('../../application/middleware/jwtMiddleware');
const validationMiddleware = require('../../application/middleware/validationMiddleware');
const securityMiddleware = require('../../infrastructure/security/securityMiddleware');

// Apply API rate limiter to all API routes
router.use(securityMiddleware.getApiRateLimiter());

/**
 * @swagger
 * /api/status:
 *   get:
 *     tags:
 *       - System
 *     summary: Get API status
 *     description: |
 *       Check API health and service availability.
 *
 *       **Public Endpoint** - No authentication required
 *       **Rate Limited:** 100 requests per 15 minutes
 *
 *       **Health Checks:**
 *       - API server status
 *       - Database connectivity
 *       - Parse Server status
 *     responses:
 *       200:
 *         description: API is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SystemStatus'
 *       503:
 *         description: Service unavailable
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SystemStatus'
 */
router.get('/status', apiController.getStatus);

/**
 * @swagger
 * /api/version:
 *   get:
 *     tags:
 *       - System
 *     summary: Get API version information
 *     description: |
 *       Retrieve API version and environment information.
 *
 *       **Public Endpoint** - No authentication required
 *       **Rate Limited:** 100 requests per 15 minutes
 *     responses:
 *       200:
 *         description: Version information retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VersionInfo'
 */
router.get('/version', apiController.getVersion);

// CSP Report endpoint
router.post(
  '/csp-report',
  express.json({
    type: ['application/csp-report', 'application/json'],
    limit: '1mb',
  }),
  (req, res) => {
    try {
      if (req.body && Object.keys(req.body).length > 0) {
        logger.warn('CSP Violation Report:', JSON.stringify(req.body, null, 2));
      }
      res.status(204).end();
    } catch (error) {
      logger.warn('CSP Report parsing error:', error);
      res.status(204).end();
    }
  }
);

// Enable test endpoint in development and test environments only
if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
  router.post('/test-csrf', (req, res) => {
    res.json({
      success: true,
      message: 'CSRF token validated successfully',
      data: req.body,
    });
  });
}

// Protected API endpoints - use JWT authentication for API routes
router.use(jwtMiddleware.authenticateToken);

// User Management API routes
const userManagementRoutes = require('./api/userManagementRoutes');
// Notifications API controller
const NotificationsController = require('../../application/controllers/api/NotificationsController');

router.use('/users', userManagementRoutes);

/**
 * @swagger
 * /api/notifications:
 *   get:
 *     tags:
 *       - Notifications
 *     summary: Get user notifications
 *     description: |
 *       Retrieve notifications for authenticated user.
 *
 *       **Access:** Requires 'notifications.read' permission
 *       **Rate Limited:** 100 requests per 15 minutes
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Notifications retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/NotificationsResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get(
  '/notifications',
  jwtMiddleware.requirePermission('notifications.read'),
  NotificationsController.getNotifications
);

/**
 * @swagger
 * /api/notifications/{notificationId}/read:
 *   patch:
 *     tags:
 *       - Notifications
 *     summary: Mark notification as read
 *     description: |
 *       Mark a specific notification as read.
 *
 *       **Access:** Requires 'notifications.update' permission
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema:
 *           type: string
 *         description: Notification ID
 *     responses:
 *       200:
 *         description: Notification marked as read
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.patch(
  '/notifications/:notificationId/read',
  jwtMiddleware.requirePermission('notifications.update'),
  NotificationsController.markAsRead
);

/**
 * @swagger
 * /api/notifications/mark-all-read:
 *   patch:
 *     tags:
 *       - Notifications
 *     summary: Mark all notifications as read
 *     description: |
 *       Mark all user notifications as read.
 *
 *       **Access:** Requires 'notifications.update' permission
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.patch(
  '/notifications/mark-all-read',
  jwtMiddleware.requirePermission('notifications.update'),
  NotificationsController.markAllAsRead
);

/**
 * @swagger
 * /api/user/profile:
 *   get:
 *     tags:
 *       - Profile
 *     summary: Get current user profile
 *     description: |
 *       Retrieve authenticated user's profile information.
 *
 *       **Access:** Requires 'profile.read' permission (all authenticated users)
 *       **Rate Limited:** 100 requests per 15 minutes
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProfileResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *   put:
 *     tags:
 *       - Profile
 *     summary: Update current user profile
 *     description: |
 *       Update authenticated user's profile information.
 *
 *       **Updatable Fields:**
 *       - firstName, lastName
 *       - Email (requires re-verification)
 *       - Phone
 *       - Preferences
 *
 *       **Access:** Requires 'profile.update' permission
 *       **Rate Limited:** 100 requests per 15 minutes
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProfileUpdateRequest'
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProfileResponse'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
// User endpoints - profile access
router.get(
  '/user/profile',
  jwtMiddleware.requirePermission('profile.read'),
  apiController.getUserProfile
);
router.put(
  '/user/profile',
  validationMiddleware.validateUpdateProfile,
  jwtMiddleware.requirePermission('profile.update'),
  apiController.updateUserProfile
);

// Example data endpoint - basic access
router.get(
  '/data',
  jwtMiddleware.requireRoleLevel(1), // Any authenticated user
  apiController.getData
);

module.exports = router;
