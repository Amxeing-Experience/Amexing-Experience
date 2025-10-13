/**
 * Clients API Routes - RESTful endpoints for client management
 * Provides Ajax-ready API endpoints for managing client organization users (department_manager role).
 * Restricted to SuperAdmin, Admin, and employee_amexing with specific permission.
 *
 * Features:
 * - RESTful API design
 * - SuperAdmin/Admin/employee_amexing (with permission) access control
 * - Manages: department_manager role users only
 * - Rate limiting and security headers
 * - Comprehensive error handling.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 0.1.0
 * @example
 * // Usage example
 * router.use('/clients', clientsRoutes);
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const ClientsController = require('../../../application/controllers/api/ClientsController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');
const logger = require('../../../infrastructure/logger');

const router = express.Router();
const clientsController = new ClientsController();

// Rate limiting for client management operations
const clientApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error:
      'Too many client management requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// More restrictive rate limiting for write operations
const writeOperationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit write operations
  message: {
    success: false,
    error:
      'Too many client modification requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Custom middleware to validate access to client management endpoints.
 * Allows: superadmin, admin, or employee_amexing with 'clients.view' permission.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {Function} next - Next middleware function.
 * @returns {Promise<void>}
 * @example
 */
async function validateClientAccess(req, res, next) {
  try {
    const { user } = req;
    const { userRole } = req;

    if (!user || !userRole) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        timestamp: new Date().toISOString(),
      });
    }

    // SuperAdmin and Admin have direct access
    if (['superadmin', 'admin'].includes(userRole)) {
      logger.info('Client access granted (admin level)', {
        userId: user.id,
        userRole,
        endpoint: req.originalUrl,
      });
      return next();
    }

    // employee_amexing requires specific permission
    if (userRole === 'employee_amexing') {
      // Check if user has 'clients.view' permission
      const hasPermission = await user.hasPermission('clients.view');

      if (hasPermission) {
        logger.info('Client access granted (permission-based)', {
          userId: user.id,
          userRole,
          permission: 'clients.view',
          endpoint: req.originalUrl,
        });
        return next();
      }

      // Log permission denial
      logger.warn('Client access denied - missing permission', {
        userId: user.id,
        userRole,
        requiredPermission: 'clients.view',
        endpoint: req.originalUrl,
        ip: req.ip,
      });

      return res.status(403).json({
        success: false,
        error: 'Access denied. Missing required permission: clients.view',
        timestamp: new Date().toISOString(),
      });
    }

    // All other roles are denied
    logger.warn('Client access denied - insufficient role', {
      userId: user.id,
      userRole,
      endpoint: req.originalUrl,
      ip: req.ip,
    });

    return res.status(403).json({
      success: false,
      error: 'Access denied. Insufficient permissions.',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error in validateClientAccess middleware', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      endpoint: req.originalUrl,
    });

    return res.status(500).json({
      success: false,
      error: 'Internal server error during permission validation',
      timestamp: new Date().toISOString(),
    });
  }
}

// Apply rate limiting and authentication to all routes
router.use(clientApiLimiter);
router.use(jwtMiddleware.authenticateToken);
router.use(validateClientAccess);

/**
 * @swagger
 * /api/clients:
 *   get:
 *     tags:
 *       - Client Management
 *     summary: Get list of client users (department_manager role)
 *     description: |
 *       Retrieve paginated list of client organization users with department_manager role.
 *
 *       **Access Control:**
 *       - SuperAdmin: Full access
 *       - Admin: Full access
 *       - employee_amexing: Requires 'clients.view' permission
 *
 *       **Features:**
 *       - Pagination (default: 25 items, max: 100)
 *       - Filter by active status
 *       - Sort by any field
 *       - Rate limited: 100 requests per 15 minutes
 *
 *       **PCI DSS:**
 *       - Audit logged per requirement 10.2.1
 *       - Role-based data filtering
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParameter'
 *       - $ref: '#/components/parameters/LimitParameter'
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *       - in: query
 *         name: emailVerified
 *         schema:
 *           type: boolean
 *         description: Filter by email verification status
 *       - $ref: '#/components/parameters/SortFieldParameter'
 *       - $ref: '#/components/parameters/SortDirectionParameter'
 *     responses:
 *       200:
 *         description: Clients retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserListResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/', async (req, res) => {
  await clientsController.getClients(req, res);
});

/**
 * @swagger
 * /api/clients/{id}:
 *   get:
 *     tags:
 *       - Client Management
 *     summary: Get client by ID
 *     description: |
 *       Retrieve detailed client information by user ID.
 *
 *       **Access Control:**
 *       - SuperAdmin, Admin, or employee_amexing with permission
 *       - User must have department_manager role
 *
 *       **PCI DSS:**
 *       - No sensitive payment data returned
 *       - Audit logged per requirement 10.2.1
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Client User ObjectId
 *         example: "abc123def456"
 *     responses:
 *       200:
 *         description: Client retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     client:
 *                       $ref: '#/components/schemas/User'
 *                 message:
 *                   type: string
 *                   example: "Client retrieved successfully"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/:id', async (req, res) => {
  await clientsController.getClientById(req, res);
});

/**
 * @swagger
 * /api/clients:
 *   post:
 *     tags:
 *       - Client Management
 *     summary: Create new client user (department_manager role)
 *     description: |
 *       Create a new client organization user with department_manager role.
 *
 *       **Access:** Requires SuperAdmin or Admin role
 *       **Rate Limited:** 30 requests per 15 minutes
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
 *               - lastName
 *               - email
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: "John"
 *               lastName:
 *                 type: string
 *                 example: "Doe"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "john.doe@company.com"
 *               companyName:
 *                 type: string
 *                 example: "ACME Corporation"
 *               password:
 *                 type: string
 *                 description: Optional - auto-generated if not provided
 *     responses:
 *       201:
 *         description: Client created successfully
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.post('/', writeOperationsLimiter, async (req, res) => {
  await clientsController.createClient(req, res);
});

/**
 * @swagger
 * /api/clients/{id}:
 *   put:
 *     tags:
 *       - Client Management
 *     summary: Update client user
 *     description: |
 *       Update client user information.
 *
 *       **Access:** Requires SuperAdmin, Admin, or employee_amexing with permission
 *       **Rate Limited:** 30 requests per 15 minutes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               companyName:
 *                 type: string
 *               active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Client updated successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.put('/:id', writeOperationsLimiter, async (req, res) => {
  await clientsController.updateClient(req, res);
});

/**
 * @swagger
 * /api/clients/{id}:
 *   delete:
 *     tags:
 *       - Client Management
 *     summary: Deactivate client user (soft delete)
 *     description: |
 *       Sets user exists=false (soft delete).
 *
 *       **Access:** Requires SuperAdmin, Admin, or employee_amexing with permission
 *       **Rate Limited:** 30 requests per 15 minutes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Client deactivated successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.delete('/:id', writeOperationsLimiter, async (req, res) => {
  await clientsController.deactivateClient(req, res);
});

/**
 * @swagger
 * /api/clients/{id}/toggle-status:
 *   patch:
 *     tags:
 *       - Client Management
 *     summary: Toggle client user active status
 *     description: |
 *       Switch between active/inactive status.
 *
 *       **Access:** Requires SuperAdmin, Admin, or employee_amexing with permission
 *       **Rate Limited:** 30 requests per 15 minutes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - active
 *             properties:
 *               active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Status toggled successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.patch('/:id/toggle-status', writeOperationsLimiter, async (req, res) => {
  await clientsController.toggleClientStatus(req, res);
});

/**
 * Error handling middleware for this router.
 * @param {Error} error - Error object.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {Function} _next - Next middleware function.
 */
router.use((error, req, res, _next) => {
  logger.error('Clients API Error:', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    userId: req.user?.id,
    timestamp: new Date(),
  });

  // Don't expose internal errors to client
  res.status(error.status || 500).json({
    success: false,
    error: error.status === 500 ? 'Internal server error' : error.message,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
module.exports.validateClientAccess = validateClientAccess; // Export for testing
