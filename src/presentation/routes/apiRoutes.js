const express = require('express');
const rateLimit = require('express-rate-limit');
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

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Logout user session (API/Mobile)
 *     description: |
 *       Clears authentication cookies and terminates user session.
 *       This endpoint is designed for API clients (mobile apps) that don't use CSRF tokens.
 *
 *       **No CSRF Required** - Uses Bearer token authentication
 *       **Rate Limited:** 200 requests per 15 minutes
 *
 *       **Security:**
 *       - Clears both access and refresh tokens
 *       - Invalidates HTTP-only cookies
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Logged out successfully
 *       401:
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Logout failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/auth/logout', jwtMiddleware.authenticateToken, async (req, res) => {
  try {
    // Log the logout event
    logger.logSecurityEvent('USER_LOGOUT', {
      userId: req.userId,
      userRole: req.userRole,
      ip: req.ip,
    });

    // Clear authentication cookies
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    logger.error('API logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed',
    });
  }
});

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

// Form Builder API routes (before JWT middleware to allow public endpoints)
const formRoutes = require('./api/formRoutes');

router.use('/forms', formRoutes);

// Debug routes (before JWT middleware for troubleshooting)
const DebugController = require('../../application/controllers/api/DebugController');

router.post('/debug/load-vehicle-images-call', DebugController.logLoadVehicleImagesCall);

// Contact form endpoint (public, no authentication required)
/**
 * @swagger
 * /api/contact:
 *   post:
 *     tags:
 *       - Contact
 *     summary: Submit contact form
 *     description: |
 *       Submit contact form with user information and message.
 *       Sends email notification to configured recipients.
 *
 *       **Public Endpoint** - No authentication required
 *       **Rate Limited:** 10 requests per hour per IP
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - message
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 100
 *                 description: Full name
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email address
 *               phone:
 *                 type: string
 *                 maxLength: 20
 *                 description: Phone number (optional)
 *               company:
 *                 type: string
 *                 maxLength: 100
 *                 description: Company name (optional)
 *               subject:
 *                 type: string
 *                 maxLength: 200
 *                 description: Message subject (optional)
 *               message:
 *                 type: string
 *                 minLength: 10
 *                 maxLength: 2000
 *                 description: Message content
 *     responses:
 *       200:
 *         description: Contact form submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Server error
 */
// Create specific rate limiter for contact form
const contactRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 submissions per hour per IP
  message: 'Too many contact form submissions. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Contact form rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      message: 'Too many contact form submissions. Please try again later.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000),
    });
  },
});

router.post('/contact', contactRateLimiter, apiController.submitContactForm);

// Rate limiter for partner (collaborator) access requests
const partnerRequestRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 submissions per hour per IP
  message: 'Demasiadas solicitudes. Inténtalo de nuevo más tarde.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Partner request rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      message: 'Demasiadas solicitudes. Inténtalo de nuevo más tarde.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000),
    });
  },
});

router.post('/partner-request', partnerRequestRateLimiter, apiController.submitPartnerRequest);

// PUBLIC ROUTES - No authentication required (must be before router.use(authenticateToken))

/**
 * Public optimized vehicle images route for browser image requests
 * GET /api/vehicles/optimized/:vehicleId/:imageName
 * Serves images with format negotiation based on Accept header (AVIF/WebP/JPEG)
 * Must be public because browsers can't send Authorization headers with <img> requests.
 *
 * NOTE: this must stay consistent with ImageOptimizationService's `enableOptimization`
 * gate (`ENABLE_IMAGE_OPTIMIZATION !== 'false'`). If the service emits optimized-route
 * URLs but this route isn't mounted, every optimized image 404s. Enabled unless the
 * env var is explicitly set to 'false'.
 */
if (process.env.ENABLE_IMAGE_OPTIMIZATION !== 'false') {
  try {
    const { serveOptimizedImageRoute } = require('../../application/middleware/imageFormatNegotiation');
    router.get('/vehicles/optimized/:vehicleId/:imageName', serveOptimizedImageRoute);
    console.log('✅ Public optimized vehicle images route enabled at /api/vehicles/optimized/:vehicleId/:imageName');
  } catch (error) {
    console.warn('⚠️ Public optimized vehicle images route not enabled:', error.message);
  }
}

/**
 * Public employee photo route for browser image requests
 * GET /api/employees/photo/:employeeId
 * Serves employee profile photos without requiring authentication
 * Must be public because browsers can't send Authorization headers with <img> requests.
 */
try {
  const { serveEmployeePhotoRoute } = require('../../application/middleware/employeePhotoRoute');
  router.get('/employees/photo/:employeeId', serveEmployeePhotoRoute);
  console.log('✅ Public employee photo route enabled at /api/employees/photo/:employeeId');
} catch (error) {
  console.warn('⚠️ Public employee photo route not enabled:', error.message);
}

// Protected API endpoints - use JWT authentication for API routes
router.use(jwtMiddleware.authenticateToken);

// User Management API routes
const userManagementRoutes = require('./api/userManagementRoutes');
const amexingUsersRoutes = require('./api/amexingUsersRoutes');
const clientsRoutes = require('./api/clientsRoutes');
const agentsRoutes = require('./api/agentsRoutes');
const ownedClientsRoutes = require('./api/ownedClientsRoutes');
const employeesRoutes = require('./api/employeesRoutes');
const rolesRoutes = require('./api/rolesRoutes');
// Vehicle Management API routes
const vehicleTypesRoutes = require('./api/vehicleTypesRoutes');
const vehiclesRoutes = require('./api/vehiclesRoutes');
const vehicleImagesRoutes = require('./api/vehicleImagesRoutes');
const poisRoutes = require('./api/poisRoutes');
const serviceTypesRoutes = require('./api/serviceTypesRoutes');
const experienceCategoriesRoutes = require('./api/experienceCategoriesRoutes');
const servicesRoutes = require('./api/servicesRoutes');
const servicesNewRoutes = require('./api/servicesNewRoutes');
const ratesRoutes = require('./api/ratesRoutes');
// Greeter Services Management API routes
const greeterRoutes = require('./api/greeterRoutes');
// Experience Management API routes
const experiencesRoutes = require('./api/experiencesRoutes');
const experienceImagesRoutes = require('./api/experienceImagesRoutes');
const providerExperienciasRoutes = require('./api/providerExperienciasRoutes');
// Tours Management API routes
const toursRoutes = require('./api/toursRoutes');
const tourPricesRoutes = require('./api/tourPricesRoutes');
const clientPricesRoutes = require('./api/clientPricesRoutes');
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
const billingProfileRoutes = require('./api/billingProfileRoutes');
// Price Adjustments API routes
const priceAdjustmentsRoutes = require('./api/priceAdjustmentsRoutes');
// Exchange Rate API routes
const exchangeRateRoutes = require('./api/exchangeRateRoutes');
const inflationRateRoutes = require('./api/inflationRateRoutes');
const agencyRateRoutes = require('./api/agencyRateRoutes');
const transferRateRoutes = require('./api/transferRateRoutes');
const driverTourRateRoutes = require('./api/driverTourRateRoutes');
const guideTransportRateRoutes = require('./api/guideTransportRateRoutes');
const greeterRateRoutes = require('./api/greeterRateRoutes');
const vehicleRatePricesRoutes = require('./api/vehicleRatePricesRoutes');
const disposablePricesRoutes = require('./api/disposablePricesRoutes');
const settingsRoutes = require('./api/settingsRoutes');
// Notifications API controller
const NotificationsController = require('../../application/controllers/api/NotificationsController');

router.use('/users', userManagementRoutes);
router.use('/profile', require('./api/profileImageRoutes'));
// Profile image endpoints
router.use('/amexingusers', amexingUsersRoutes);
router.use('/clients', clientsRoutes);
router.use('/agents', agentsRoutes);
router.use('/owned-clients', ownedClientsRoutes);
router.use('/employees', employeesRoutes);
router.use('/roles', rolesRoutes);
router.use('/vehicle-types', vehicleTypesRoutes);
router.use('/vehicles', vehiclesRoutes);
router.use('/vehicles', vehicleImagesRoutes); // Vehicle images endpoints
router.use('/pois', poisRoutes);
router.use('/destinos', require('./api/entradasRoutes'));
// Entradas por destino (tarifario)
router.use('/partner-requests', require('./api/partnerRequestsRoutes'));
// Solicitudes de colaboradores (admin)
router.use('/service-types', serviceTypesRoutes);
router.use('/experience-categories', experienceCategoriesRoutes);
router.use('/services', servicesRoutes);
router.use('/services-new', servicesNewRoutes);
router.use('/rates', ratesRoutes);
router.use('/greeter', greeterRoutes);
router.use('/experiences', experiencesRoutes);
router.use('/experiences', experienceImagesRoutes); // Experience images endpoints
router.use('/tours', require('./api/tourImagesRoutes'));
// Tour images endpoints
router.use('/', providerExperienciasRoutes); // Provider experiencias endpoints
router.use('/tours', toursRoutes);
router.use('/tour-prices', tourPricesRoutes); // Tour pricing endpoints
router.use('/client-prices', clientPricesRoutes); // Client pricing endpoints
router.use('/audit', auditRoutes); // Audit log endpoints
router.use('/quotes', quotesRoutes); // Quote management endpoints
router.use('/cancellation-requests', cancellationRequestsRoutes); // Cancellation requests management endpoints
router.use('/invoices', invoicesRoutes); // Invoice management endpoints
router.use('/payment-info', paymentInfoRoutes); // Payment info management endpoints
router.use('/billing', billingRoutes); // Billing info management endpoints
router.use('/billing-profiles', billingProfileRoutes); // Billing profiles management endpoints
router.use('/price-adjustments', priceAdjustmentsRoutes); // Price adjustments management endpoints
router.use('/exchange-rate', exchangeRateRoutes); // Exchange rate management endpoints
router.use('/inflation-rate', inflationRateRoutes); // Inflation rate management endpoints
router.use('/agency-rate', agencyRateRoutes); // Agency rate management endpoints
router.use('/transfer-rate', transferRateRoutes); // Transfer rate management endpoints
router.use('/driver-tour-rate', driverTourRateRoutes); // Driver tour rate management endpoints
router.use('/guide-transport-rate', guideTransportRateRoutes); // Guide transport rate management endpoints
router.use('/greeter-rate', greeterRateRoutes); // Greeter rate management endpoints
router.use('/vehicle-rate-prices', vehicleRatePricesRoutes); // Vehicle rate prices management endpoints
router.use('/disposable-prices', disposablePricesRoutes); // Disposable prices (A Disposición) management endpoints
router.use('/settings', settingsRoutes); // Settings management endpoints
router.use('/reservations', require('./api/reservationRoutes')); // Reservation management endpoints

// Tarifario Export - Department Manager and above
const TarifarioExportController = require('../../application/controllers/api/TarifarioExportController');

const tarifarioExportController = new TarifarioExportController();
router.get('/tarifario/export', jwtMiddleware.requireRoleLevel(4), (req, res) => tarifarioExportController.exportTarifario(req, res));

/**
 * Email Test Endpoint - SuperAdmin Only
 * Sends a test email to verify MailerSend configuration.
 */
router.post('/emails/send-test', jwtMiddleware.requireRoleLevel(7), async (req, res) => {
  try {
    const { email, template } = req.body;

    // Validate email format - Simple and safe email validation
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || typeof email !== 'string' || !emailPattern.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Dirección de email inválida',
      });
    }

    // Validate template selection
    if (!template) {
      return res.status(400).json({
        success: false,
        error: 'Por favor selecciona una plantilla de email',
      });
    }

    // Import email service
    const emailService = require('../../application/services/EmailService');

    // Check if email service is available
    if (!emailService.isAvailable()) {
      return res.status(503).json({
        success: false,
        error:
          'El servicio de email no está configurado. Por favor verifica las variables de entorno MAILERSEND_API_TOKEN y EMAIL_FROM.',
      });
    }

    let result;

    // Send email based on selected template
    switch (template) {
      case 'simple':
        result = await emailService.sendEmail({
          to: email,
          subject: 'Email de Prueba - Amexing Experience',
          html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #5D87FF;">Email de Prueba</h1>
          <p>Este es un email de prueba del sistema Amexing Experience.</p>
          <p>Si recibiste este email, significa que la configuración de MailerSend está funcionando correctamente.</p>
          <hr style="border: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">
            Enviado desde el panel de SuperAdmin por ${req.user.email}<br>
            ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}
          </p>
        </div>
      `,
          text: `Email de Prueba - Amexing Experience\n\nEste es un email de prueba del sistema Amexing Experience.\n\nSi recibiste este email, significa que la configuración de MailerSend está funcionando correctamente.\n\nEnviado por ${req.user.email} el ${new Date().toLocaleString('es-MX')}`,
          tags: ['test', 'manual', 'superadmin', 'simple'],
          notificationType: 'test',
          metadata: {
            sentBy: req.user.id,
            sentByEmail: req.user.email,
            sentAt: new Date().toISOString(),
            template: 'simple',
          },
        });
        break;

      case 'welcome':
        result = await emailService.sendWelcomeEmail({
          email,
          name: 'Usuario de Prueba',
          role: 'SuperAdmin',
          dashboardUrl: `${process.env.APP_BASE_URL}/dashboard/superadmin`,
        });
        break;

      case 'booking_confirmation':
        result = await emailService.sendBookingConfirmation({
          recipientEmail: email,
          recipientName: 'Usuario de Prueba',
          bookingNumber: `TEST-${Date.now()}`,
          serviceType: 'Aeropuerto',
          date: new Date(Date.now() + 86400000).toLocaleDateString('es-MX'),
          time: '10:00 AM',
          location: 'Aeropuerto Internacional de la Ciudad de México',
          metadata: {
            test: true,
            sentBy: req.user.id,
          },
        });
        break;

      case 'password_reset':
        result = await emailService.sendPasswordResetEmail({
          email,
          name: 'Usuario de Prueba',
          resetUrl: `${process.env.APP_BASE_URL}/reset-password?token=test-token-123`,
          expirationTime: '1 hora',
        });
        break;

      default:
        return res.status(400).json({
          success: false,
          error: 'Plantilla no válida',
        });
    }

    // Log the test email send
    logger.info('Test email sent from SuperAdmin dashboard', {
      sentBy: req.user.email,
      recipient: emailService.maskEmail(email),
      template,
      success: result.success,
      messageId: result.messageId,
      error: result.error || null,
    });

    // Return result (include error details if failed)
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Error desconocido al enviar el email',
      });
    }

    res.json(result);
  } catch (error) {
    logger.error('Error sending test email:', {
      error: error.message,
      stack: error.stack,
      user: req.user?.email,
    });

    res.status(500).json({
      success: false,
      error: `Error al enviar el email de prueba: ${error.message}`,
    });
  }
});

/**
 * Email Usage Stats Endpoint - SuperAdmin Only
 * Gets email usage statistics and quotas.
 */
router.get('/emails/usage', jwtMiddleware.requireRoleLevel(7), async (req, res) => {
  try {
    const emailService = require('../../application/services/EmailService');

    // Check if email service is available
    if (!emailService.isAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'El servicio de email no está configurado',
      });
    }

    // Get usage statistics
    const stats = await emailService.getUsageStats();

    if (!stats.success) {
      return res.status(500).json(stats);
    }

    res.json(stats);
  } catch (error) {
    logger.error('Error getting email usage stats:', {
      error: error.message,
      stack: error.stack,
      user: req.user?.email,
    });

    res.status(500).json({
      success: false,
      error: 'Error al obtener estadísticas de uso de email',
    });
  }
});

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

// Client Prices API routes
const ClientPricesController = require('../../application/controllers/api/ClientPricesController');

const clientPricesController = new ClientPricesController();

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

/**
 * @swagger
 * /api/client-prices/bulk-apply:
 *   post:
 *     tags:
 *       - Client Prices
 *     summary: Apply bulk pricing with markup percentage
 *     description: |
 *       Apply pricing with specified markup percentage for a client.
 *       Can be applied to services, tours, or both.
 *       Preserves version history of previous prices.
 *
 *       **Required Role:** Admin or SuperAdmin (level 6+)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clientId
 *               - markupPercentage
 *             properties:
 *               clientId:
 *                 type: string
 *                 description: Client ID to apply pricing to
 *               applyToServices:
 *                 type: boolean
 *                 description: Apply to services
 *                 default: true
 *               applyToTours:
 *                 type: boolean
 *                 description: Apply to tours
 *                 default: true
 *               markupPercentage:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 description: Markup percentage to apply (0-100)
 *     responses:
 *       200:
 *         description: Pricing applied successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 servicesCreated:
 *                   type: number
 *                 servicesUpdated:
 *                   type: number
 *                 toursCreated:
 *                   type: number
 *                 toursUpdated:
 *                   type: number
 *                 totalCreated:
 *                   type: number
 *                 totalUpdated:
 *                   type: number
 *       400:
 *         description: Invalid request parameters
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Client not found
 *       500:
 *         description: Server error
 */
router.post(
  '/client-prices/bulk-apply',
  jwtMiddleware.requireRoleLevel(6), // Admin or SuperAdmin
  clientPricesController.bulkApplyPricing
);

router.post(
  '/client-prices/bulk-apply-with-progress',
  jwtMiddleware.requireRoleLevel(6), // Admin or SuperAdmin
  clientPricesController.bulkApplyPricingWithProgress
);

router.get(
  '/client-prices/progress/:processId',
  clientPricesController.getProgressUpdates // No auth middleware for SSE
);

/**
 * @swagger
 * /api/reviews/tripadvisor:
 *   get:
 *     tags:
 *       - Reviews
 *     summary: Get TripAdvisor reviews
 *     description: |
 *       Fetch customer reviews from TripAdvisor API.
 *
 *       **Public Endpoint** - No authentication required
 *       **Cached** - Results are cached for 1 hour to minimize API calls
 *
 *     parameters:
 *       - in: query
 *         name: language
 *         schema:
 *           type: string
 *           enum: [es, en]
 *           default: es
 *         description: Language for reviews (Spanish or English)
 *       - in: query
 *         name: count
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 10
 *           default: 5
 *         description: Number of reviews to return
 *     responses:
 *       200:
 *         description: Reviews fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 reviews:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       location:
 *                         type: string
 *                       rating:
 *                         type: integer
 *                       text:
 *                         type: string
 *                       timeAgo:
 *                         type: string
 *                       platform:
 *                         type: string
 *                       verified:
 *                         type: boolean
 *       500:
 *         description: Server error
 */
router.get('/reviews/tripadvisor', async (req, res) => {
  try {
    const tripAdvisorService = require('../../application/services/tripAdvisorService');
    const { language = 'es', count = 5 } = req.query;

    const reviews = await tripAdvisorService.getTopReviews(
      parseInt(count, 10),
      language
    );

    res.json({
      success: true,
      reviews,
      cached: tripAdvisorService.cache !== null,
      language,
    });
  } catch (error) {
    logger.error('Error fetching TripAdvisor reviews:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reviews',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * Postal code → state/city lookup for the client address form. Mexico uses the official SEPOMEX
 * dataset bundled in the repo (estado + municipio + colonias); US/CA proxy the free Zippopotam.us
 * API server-side (cached). Limited to MX/US/CA. Authenticated (above).
 */
const postalLookupService = require('../../application/services/postalLookupService');
const sepomexService = require('../../application/services/sepomexService');

router.get('/geo/postal/:country/:code', async (req, res) => {
  try {
    const iso = String(req.params.country || '').toLowerCase();
    if (iso === 'mx') {
      const r = sepomexService.lookup(req.params.code);
      if (!r) return res.status(404).json({ success: false, error: 'Código postal no encontrado' });
      return res.json({
        success: true,
        data: { state: r.estado, city: r.municipio, colonias: r.colonias },
      });
    }
    const result = await postalLookupService.lookup(iso, req.params.code);
    if (!result || (!result.state && !result.city)) {
      return res.status(404).json({ success: false, error: 'Código postal no encontrado' });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Postal lookup endpoint error:', error);
    res.status(500).json({ success: false, error: 'Error al consultar el código postal' });
  }
});

module.exports = router;
