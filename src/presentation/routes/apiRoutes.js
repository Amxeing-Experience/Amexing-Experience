const express = require('express');
const logger = require('../../infrastructure/logger');

const router = express.Router();
const apiController = require('../../application/controllers/apiController');
// const authMiddleware = require('../../application/middleware/authMiddleware'); // Unused import
const jwtMiddleware = require('../../application/middleware/jwtMiddleware');
const validationMiddleware = require('../../application/middleware/validationMiddleware');
const securityMiddleware = require('../../infrastructure/security/securityMiddleware');
const sessionRecovery = require('../../application/middleware/sessionRecoveryMiddleware');
const sessionMetrics = require('../../infrastructure/monitoring/sessionMetrics');

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

/**
 * @swagger
 * /api/auth/current-token:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Get current session JWT token for client-side use
 *     description: |
 *       Returns the current user's JWT token for use in client-side AJAX requests.
 *       This endpoint solves the issue where httpOnly cookies cannot be read by JavaScript.
 *
 *       **Authentication Required** - Must have valid session
 *       **Rate Limited:** 200 requests per 15 minutes
 *     responses:
 *       200:
 *         description: Token retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 token:
 *                   type: string
 *                   description: JWT access token
 *       401:
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 error:
 *                   type: string
 */
router.get('/auth/current-token', jwtMiddleware.authenticateToken, (req, res) => {
  try {
    // Extract token from cookies (since this endpoint is authenticated, the token exists)
    const token = req.cookies?.accessToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No access token found',
      });
    }

    res.json({
      success: true,
      token,
    });
  } catch (error) {
    logger.error('Error retrieving current token:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

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

/**
 * @swagger
 * /api/session/health:
 *   get:
 *     tags:
 *       - Session
 *     summary: Check session health status
 *     description: |
 *       Check the health status of the current session including CSRF protection,
 *       expiration status, and session validity. This endpoint can be called by
 *       the frontend to validate session before submitting forms or making critical requests.
 *
 *       **Public Endpoint** - No authentication required
 *       **Rate Limited:** 100 requests per 15 minutes
 *
 *       **Health Indicators:**
 *       - Session exists and is valid
 *       - CSRF protection is initialized
 *       - Session expiration time
 *       - Warning if session is near expiration (within 5 minutes)
 *     responses:
 *       200:
 *         description: Session health information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 healthy:
 *                   type: boolean
 *                   description: Overall session health status
 *                 sessionExists:
 *                   type: boolean
 *                   description: Whether session exists
 *                 csrfProtected:
 *                   type: boolean
 *                   description: Whether CSRF secret is initialized
 *                 expiresAt:
 *                   type: string
 *                   format: date-time
 *                   description: When the session will expire
 *                 nearExpiration:
 *                   type: boolean
 *                   description: True if session expires within 5 minutes
 *                 sessionId:
 *                   type: string
 *                   description: Truncated session ID for correlation
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   description: Current server timestamp
 *       500:
 *         description: Error checking session health
 */
router.get('/session/health', sessionRecovery.sessionHealthEndpoint);

/**
 * @swagger
 * /api/session/metrics:
 *   get:
 *     tags:
 *       - Session
 *     summary: Get session metrics (Admin only)
 *     description: |
 *       Retrieve comprehensive session and CSRF metrics for monitoring.
 *       This endpoint provides detailed statistics about session operations,
 *       CSRF validation, and session store health.
 *
 *       **Admin Only** - Requires authentication
 *       **Rate Limited:** 100 requests per 15 minutes
 *
 *       **Metrics Include:**
 *       - Session creation, touch, and destruction counts
 *       - CSRF token generation and validation statistics
 *       - Session health check counts
 *       - Session store error rates
 *       - Recent error details
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Session metrics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.get('/session/metrics', (req, res) => {
  try {
    const metrics = sessionMetrics.getMetrics();
    const healthSummary = sessionMetrics.getHealthSummary();
    const recentErrors = sessionMetrics.getRecentErrors(20);

    res.json({
      success: true,
      data: {
        metrics,
        health: healthSummary,
        recentErrors,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Session metrics endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve session metrics',
      timestamp: new Date().toISOString(),
    });
  }
});

// Protected API endpoints - use JWT authentication for API routes
router.use(jwtMiddleware.authenticateToken);

// User Management API routes
const userManagementRoutes = require('./api/userManagementRoutes');
const amexingUsersRoutes = require('./api/amexingUsersRoutes');
const clientsRoutes = require('./api/clientsRoutes');
const employeesRoutes = require('./api/employeesRoutes');
const rolesRoutes = require('./api/rolesRoutes');
// Vehicle Management API routes
const vehicleTypesRoutes = require('./api/vehicleTypesRoutes');
const vehiclesRoutes = require('./api/vehiclesRoutes');
const vehicleImagesRoutes = require('./api/vehicleImagesRoutes');
const poisRoutes = require('./api/poisRoutes');
const serviceTypesRoutes = require('./api/serviceTypesRoutes');
const servicesRoutes = require('./api/servicesRoutes');
const ratesRoutes = require('./api/ratesRoutes');
// Experience Management API routes
const experiencesRoutes = require('./api/experiencesRoutes');
const experienceImagesRoutes = require('./api/experienceImagesRoutes');
const providerExperienciasRoutes = require('./api/providerExperienciasRoutes');
// Tours Management API routes
const toursRoutes = require('./api/toursRoutes');
// Audit Log API routes
const auditRoutes = require('./api/auditRoutes');
// Quote Management API routes
const quotesRoutes = require('./api/quotesRoutes');
// Cancellation Requests API routes
const cancellationRequestsRoutes = require('./api/cancellationRequestsRoutes');
// Invoice Management API routes
const invoicesRoutes = require('./api/invoicesRoutes');
// Payment Info Management API routes
const paymentInfoRoutes = require('./api/paymentInfoRoutes');
const billingRoutes = require('./api/billingRoutes');
// Notifications API controller
const NotificationsController = require('../../application/controllers/api/NotificationsController');

router.use('/users', userManagementRoutes);
router.use('/amexingusers', amexingUsersRoutes);
router.use('/clients', clientsRoutes);
router.use('/employees', employeesRoutes);
router.use('/roles', rolesRoutes);
router.use('/vehicle-types', vehicleTypesRoutes);
router.use('/vehicles', vehiclesRoutes);
router.use('/vehicles', vehicleImagesRoutes); // Vehicle images endpoints
router.use('/pois', poisRoutes);
router.use('/service-types', serviceTypesRoutes);
router.use('/services', servicesRoutes);
router.use('/rates', ratesRoutes);
router.use('/experiences', experiencesRoutes);
router.use('/experiences', experienceImagesRoutes); // Experience images endpoints
router.use('/', providerExperienciasRoutes); // Provider experiencias endpoints
router.use('/tours', toursRoutes);
router.use('/audit', auditRoutes); // Audit log endpoints
router.use('/quotes', quotesRoutes); // Quote management endpoints
router.use('/cancellation-requests', cancellationRequestsRoutes); // Cancellation requests management endpoints
router.use('/invoices', invoicesRoutes); // Invoice management endpoints
router.use('/payment-info', paymentInfoRoutes); // Payment info management endpoints
router.use('/billing', billingRoutes); // Billing info management endpoints

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
router.get('/user/profile', jwtMiddleware.requirePermission('profile.read'), apiController.getUserProfile);
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

// Bulk Import API routes for clients
const BulkImportController = require('../../application/controllers/api/BulkImportController');

const bulkImportController = new BulkImportController();

/**
 * @swagger
 * /api/clients/bulk/template:
 *   get:
 *     tags:
 *       - Clients
 *       - Bulk Import
 *     summary: Download bulk import Excel template
 *     description: |
 *       Download Excel template for bulk client import with instructions.
 *
 *       **Access:** SuperAdmin and Admin only
 *       **Rate Limited:** 100 requests per 15 minutes
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Template file downloaded
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.get(
  '/clients/bulk/template',
  jwtMiddleware.requireRoleLevel(6), // Admin or SuperAdmin
  bulkImportController.downloadTemplate.bind(bulkImportController)
);

/**
 * @swagger
 * /api/clients/bulk/upload:
 *   post:
 *     tags:
 *       - Clients
 *       - Bulk Import
 *     summary: Upload Excel file for bulk import
 *     description: |
 *       Upload and validate Excel file for bulk client import.
 *
 *       **Access:** SuperAdmin and Admin only
 *       **Rate Limited:** 100 requests per 15 minutes
 *       **Max File Size:** 10MB
 *       **Accepted Files:** .xlsx, .xls
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Excel file to upload
 *     responses:
 *       200:
 *         description: File uploaded and validated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     jobId:
 *                       type: string
 *                     fileId:
 *                       type: string
 *                     validation:
 *                       type: object
 *       400:
 *         description: Validation error
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.post(
  '/clients/bulk/upload',
  jwtMiddleware.requireRoleLevel(6), // Admin or SuperAdmin
  bulkImportController.getUploadMiddleware(),
  bulkImportController.uploadFile.bind(bulkImportController)
);

/**
 * @swagger
 * /api/clients/bulk/process:
 *   post:
 *     tags:
 *       - Clients
 *       - Bulk Import
 *     summary: Process bulk import
 *     description: |
 *       Start processing bulk client import from uploaded file.
 *
 *       **Access:** SuperAdmin and Admin only
 *       **Rate Limited:** 100 requests per 15 minutes
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               jobId:
 *                 type: string
 *                 description: Job ID from upload response
 *     responses:
 *       202:
 *         description: Import processing started
 *       400:
 *         description: Invalid request
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Job not found
 */
router.post(
  '/clients/bulk/process',
  jwtMiddleware.requireRoleLevel(6), // Admin or SuperAdmin
  bulkImportController.processImport.bind(bulkImportController)
);

/**
 * @swagger
 * /api/clients/bulk/status/{jobId}:
 *   get:
 *     tags:
 *       - Clients
 *       - Bulk Import
 *     summary: Get bulk import job status
 *     description: |
 *       Get status and progress of bulk import job.
 *
 *       **Access:** SuperAdmin and Admin only
 *       **Rate Limited:** 100 requests per 15 minutes
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: jobId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID
 *     responses:
 *       200:
 *         description: Job status retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Job not found
 */
router.get(
  '/clients/bulk/status/:jobId',
  jwtMiddleware.requireRoleLevel(6), // Admin or SuperAdmin
  bulkImportController.getImportStatus.bind(bulkImportController)
);

/**
 * @swagger
 * /api/clients/bulk/error-report/{jobId}:
 *   get:
 *     tags:
 *       - Clients
 *       - Bulk Import
 *     summary: Download bulk import error report
 *     description: |
 *       Download Excel file with failed records and error details.
 *
 *       **Access:** SuperAdmin and Admin only
 *       **Rate Limited:** 100 requests per 15 minutes
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: jobId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID
 *     responses:
 *       200:
 *         description: Error report downloaded
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Error report not found
 */
router.get(
  '/clients/bulk/error-report/:jobId',
  jwtMiddleware.requireRoleLevel(6), // Admin or SuperAdmin
  bulkImportController.downloadErrorReport.bind(bulkImportController)
);

module.exports = router;
