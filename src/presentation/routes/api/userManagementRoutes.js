/**
 * User Management API Routes - RESTful endpoints for user CRUD operations
 * Provides Ajax-ready API endpoints with comprehensive security and validation.
 *
 * Features:
 * - RESTful API design
 * - Role-based access control middleware
 * - Request validation and sanitization
 * - Rate limiting and security headers
 * - Comprehensive error handling
 * - API documentation ready.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 0.1.0
 * @example
 * // Usage example
 * const result = await require({ 'express': 'example' });
 * // Returns: operation result
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const UserManagementController = require('../../../application/controllers/api/UserManagementController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');
// securityMiddleware removed - CSRF protection not needed for JWT-authenticated API routes
const logger = require('../../../infrastructure/logger');

const router = express.Router();
const userController = new UserManagementController();

// Rate limiting for user management operations
const userApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: 'Too many user management requests from this IP, please try again later.',
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
    error: 'Too many user modification requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting and authentication to all routes
router.use(userApiLimiter);
router.use(jwtMiddleware.authenticateToken);

/**
 * @swagger
 * /api/users:
 *   get:
 *     tags:
 *       - User Management
 *     summary: Get list of users with filtering and pagination
 *     description: |
 *       Retrieve paginated list of users with advanced filtering options.
 *
 *       **Access Control:**
 *       - Requires authentication (JWT token)
 *       - Requires 'users.list' permission
 *       - SuperAdmin/Admin: See all users
 *       - DepartmentManager: See users in their department
 *       - Others: Limited access based on role
 *
 *       **Features:**
 *       - Pagination (default: 25 items, max: 100)
 *       - Filter by role, status, client, department
 *       - Sort by any field
 *       - Search functionality
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
 *         name: role
 *         schema:
 *           type: string
 *           enum: [superadmin, admin, client, department_manager, employee, employee_amexing, driver, guest]
 *         description: Filter by user role
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
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: string
 *         description: Filter by client (admin only)
 *       - in: query
 *         name: departmentId
 *         schema:
 *           type: string
 *         description: Filter by department
 *       - $ref: '#/components/parameters/SortFieldParameter'
 *       - $ref: '#/components/parameters/SortDirectionParameter'
 *     responses:
 *       200:
 *         description: Users retrieved successfully
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
router.get('/', jwtMiddleware.requirePermission('users.list'), async (req, res) => {
  await userController.getUsers(req, res);
});

/**
 * @swagger
 * /api/users/search:
 *   get:
 *     tags:
 *       - User Management
 *     summary: Search users with advanced filtering
 *     description: |
 *       Search users by email, name, or username with filters.
 *
 *       **Search Capabilities:**
 *       - Email (partial match)
 *       - First name (partial match)
 *       - Last name (partial match)
 *       - Username (partial match)
 *       - Combined with role/status filters
 *
 *       **Access Control:**
 *       - Requires 'users.search' permission
 *       - Results filtered by user's access level
 *
 *       **Rate Limited:** 100 requests per 15 minutes
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search term (min 2 characters)
 *         example: "john"
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *         description: Filter results by role
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *       - $ref: '#/components/parameters/PageParameter'
 *       - $ref: '#/components/parameters/LimitParameter'
 *       - $ref: '#/components/parameters/SortFieldParameter'
 *       - $ref: '#/components/parameters/SortDirectionParameter'
 *     responses:
 *       200:
 *         description: Search results
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
 */
router.get('/search', jwtMiddleware.requirePermission('users.search'), async (req, res) => {
  await userController.searchUsers(req, res);
});

/**
 * @swagger
 * /api/users/statistics:
 *   get:
 *     tags:
 *       - User Management
 *     summary: Get user statistics for dashboard
 *     description: |
 *       Retrieve comprehensive user statistics and metrics.
 *
 *       **Statistics Included:**
 *       - Total users count
 *       - Active users count
 *       - New users this month
 *       - Pending email verification
 *       - Role distribution
 *       - Monthly registration trends
 *
 *       **Access:**
 *       - Requires role level 6+ (Admin/SuperAdmin)
 *       - Rate limited: 100 requests per 15 minutes
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/UserStatistics'
 *                 message:
 *                   type: string
 *                   example: "Statistics retrieved successfully"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.get('/statistics', jwtMiddleware.requireRoleLevel(6), async (req, res) => {
  await userController.getUserStatistics(req, res);
});

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     tags:
 *       - User Management
 *     summary: Get user by ID
 *     description: |
 *       Retrieve detailed user information by user ID.
 *
 *       **Access Control:**
 *       - Requires 'users.read' permission
 *       - Users can view their own data
 *       - Admins can view any user in their scope
 *       - Department Managers: Users in their department only
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
router.get('/:id', jwtMiddleware.requirePermission('users.read'), async (req, res) => {
  await userController.getUserById(req, res);
});

/**
 * @swagger
 * /api/users:
 *   post:
 *     tags:
 *       - User Management
 *     summary: Create new user
 *     description: |
 *       Create a new user account with role assignment.
 *
 *       **Access:** Requires 'users.create' permission
 *       **Password:** Auto-generated if not provided
 *       **Rate Limited:** 30 requests per 15 minutes
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserCreateRequest'
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
router.post('/', writeOperationsLimiter, jwtMiddleware.requirePermission('users.create'), async (req, res) => {
  await userController.createUser(req, res);
});

/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     tags:
 *       - User Management
 *     summary: Update user
 *     description: Update user information (requires 'users.update' permission)
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
 *             $ref: '#/components/schemas/UserUpdateRequest'
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
router.put('/:id', writeOperationsLimiter, jwtMiddleware.requirePermission('users.update'), async (req, res) => {
  await userController.updateUser(req, res);
});

/**
 * @swagger
 * /api/users/me/profile:
 *   put:
 *     tags:
 *       - User Management
 *     summary: Update own profile information
 *     description: Allow users to update their own profile data including billing information
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               billingInfo:
 *                 type: object
 *                 description: Billing information for invoices
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.put('/me/profile', writeOperationsLimiter, async (req, res) => {
  await userController.updateOwnProfile(req, res);
});

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     tags:
 *       - User Management
 *     summary: Deactivate user (soft delete)
 *     description: Sets user exists=false (requires 'users.deactivate' permission)
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
router.delete('/:id', writeOperationsLimiter, jwtMiddleware.requirePermission('users.deactivate'), async (req, res) => {
  await userController.deactivateUser(req, res);
});

/**
 * @swagger
 * /api/users/{id}/reactivate:
 *   put:
 *     tags:
 *       - User Management
 *     summary: Reactivate deactivated user
 *     description: Sets exists=true (requires 'users.reactivate' permission)
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
 *         description: User reactivated successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.put(
  '/:id/reactivate',
  writeOperationsLimiter,
  jwtMiddleware.requirePermission('users.reactivate'),
  async (req, res) => {
    await userController.reactivateUser(req, res);
  }
);

/**
 * @swagger
 * /api/users/{id}/toggle-status:
 *   patch:
 *     tags:
 *       - User Management
 *     summary: Toggle user active status
 *     description: Switch between active/inactive (requires 'users.update' permission)
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
router.patch(
  '/:id/toggle-status',
  writeOperationsLimiter,
  jwtMiddleware.requirePermission('users.update'),
  async (req, res) => {
    await userController.toggleUserStatus(req, res);
  }
);

/**
 * @swagger
 * /api/users/{id}/archive:
 *   patch:
 *     tags:
 *       - User Management
 *     summary: Archive user (SuperAdmin only)
 *     description: |
 *       Sets active=false and exists=false (permanent soft delete)
 *       **Access:** Requires role level 7 (SuperAdmin only)
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
 *         description: User archived successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.patch('/:id/archive', writeOperationsLimiter, jwtMiddleware.requireRoleLevel(7), async (req, res) => {
  await userController.archiveUser(req, res);
});

/**
 * Error handling middleware for this router.
 * @param {*} error - Error parameter.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {*} _next - Next middleware function.
 * @returns {*} - Operation result.
 * @example
 * // Usage example
 * router.use((error, req, res, _next) => { ... });
 */
router.use((error, req, res, _next) => {
  logger.error('User Management API Error:', {
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
