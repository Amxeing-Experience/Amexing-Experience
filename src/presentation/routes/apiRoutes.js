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

// Public API endpoints
router.get('/status', apiController.getStatus);
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

// Notifications endpoints - require basic user permissions
router.get(
  '/notifications',
  jwtMiddleware.requirePermission('notifications.read'),
  NotificationsController.getNotifications
);
router.patch(
  '/notifications/:notificationId/read',
  jwtMiddleware.requirePermission('notifications.update'),
  NotificationsController.markAsRead
);
router.patch(
  '/notifications/mark-all-read',
  jwtMiddleware.requirePermission('notifications.update'),
  NotificationsController.markAllAsRead
);

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
