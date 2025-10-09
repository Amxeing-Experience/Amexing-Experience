/**
 * Amexing Users API Routes - RESTful endpoints for Amexing internal user management
 * Provides Ajax-ready API endpoints for managing Amexing organization users only.
 * Restricted to SuperAdmin and Admin roles.
 *
 * Features:
 * - RESTful API design
 * - SuperAdmin/Admin only access control
 * - Manages: superadmin, admin, employee_amexing roles
 * - Rate limiting and security headers
 * - Comprehensive error handling.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 0.1.0
 * @example
 * // Usage example
 * router.use('/amexingusers', amexingUsersRoutes);
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const AmexingUsersController = require('../../../application/controllers/api/AmexingUsersController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');
const logger = require('../../../infrastructure/logger');

const router = express.Router();
const amexingUsersController = new AmexingUsersController();

// Rate limiting for Amexing user management operations
const amexingUserApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error:
      'Too many Amexing user management requests from this IP, please try again later.',
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
      'Too many user modification requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting and authentication to all routes
router.use(amexingUserApiLimiter);
router.use(jwtMiddleware.authenticateToken);

// Apply role level restriction: Only SuperAdmin (7) and Admin (6) can access
router.use(jwtMiddleware.requireRoleLevel(6));

/**
 * @swagger
 * /api/amexingusers:
 *   get:
 *     tags:
 *       - Amexing User Management
 *     summary: Get list of Amexing internal users
 *     description: |
 *       Retrieve paginated list of Amexing organization users (superadmin, admin, employee_amexing).
 *
 *       **Access Control:**
 *       - Requires role level 6+ (Admin or SuperAdmin)
 *       - SuperAdmin: See all Amexing users
 *       - Admin: See admin and employee_amexing (excludes superadmin)
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
 *         description: Amexing users retrieved successfully
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
  await amexingUsersController.getAmexingUsers(req, res);
});

/**
 * @swagger
 * /api/amexingusers/{id}:
 *   get:
 *     tags:
 *       - Amexing User Management
 *     summary: Get Amexing user by ID
 *     description: |
 *       Retrieve detailed Amexing user information by user ID.
 *
 *       **Access Control:**
 *       - Requires role level 6+ (Admin or SuperAdmin)
 *       - User must belong to Amexing organization
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
 *         description: User ObjectId
 *         example: "abc123def456"
 *     responses:
 *       200:
 *         description: User retrieved successfully
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
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                 message:
 *                   type: string
 *                   example: "User retrieved successfully"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/:id', async (req, res) => {
  await amexingUsersController.getAmexingUserById(req, res);
});

/**
 * @swagger
 * /api/amexingusers:
 *   post:
 *     tags:
 *       - Amexing User Management
 *     summary: Create new Amexing internal user
 *     description: |
 *       Create a new Amexing organization user account.
 *
 *       **Allowed Roles:**
 *       - admin (any Admin/SuperAdmin can create)
 *       - employee_amexing (any Admin/SuperAdmin can create)
 *       - superadmin (only SuperAdmin can create)
 *
 *       **Access:** Requires role level 6+ (Admin or SuperAdmin)
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
 *               - role
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
 *                 example: "john.doe@amexing.com"
 *               role:
 *                 type: string
 *                 enum: [admin, employee_amexing, superadmin]
 *                 example: "admin"
 *               password:
 *                 type: string
 *                 description: Optional - auto-generated if not provided
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.post('/', writeOperationsLimiter, async (req, res) => {
  await amexingUsersController.createAmexingUser(req, res);
});

/**
 * @swagger
 * /api/amexingusers/{id}:
 *   put:
 *     tags:
 *       - Amexing User Management
 *     summary: Update Amexing user
 *     description: |
 *       Update Amexing user information.
 *
 *       **Access:** Requires role level 6+ (Admin or SuperAdmin)
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
 *               active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: User updated successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.put('/:id', writeOperationsLimiter, async (req, res) => {
  await amexingUsersController.updateAmexingUser(req, res);
});

/**
 * @swagger
 * /api/amexingusers/{id}:
 *   delete:
 *     tags:
 *       - Amexing User Management
 *     summary: Deactivate Amexing user (soft delete)
 *     description: |
 *       Sets user exists=false (soft delete).
 *
 *       **Access:** Requires role level 6+ (Admin or SuperAdmin)
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
 *         description: User deactivated successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.delete('/:id', writeOperationsLimiter, async (req, res) => {
  await amexingUsersController.deactivateAmexingUser(req, res);
});

/**
 * @swagger
 * /api/amexingusers/{id}/toggle-status:
 *   patch:
 *     tags:
 *       - Amexing User Management
 *     summary: Toggle Amexing user active status
 *     description: |
 *       Switch between active/inactive status.
 *
 *       **Access:** Requires role level 6+ (Admin or SuperAdmin)
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
  await amexingUsersController.toggleAmexingUserStatus(req, res);
});

/**
 * Error handling middleware for this router.
 * @param {Error} error - Error object.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {Function} _next - Next middleware function.
 */
router.use((error, req, res, _next) => {
  logger.error('Amexing Users API Error:', {
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
