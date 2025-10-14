/**
 * Employees API Routes - RESTful endpoints for Amexing employee management
 * Provides Ajax-ready API endpoints for managing Amexing employee users only.
 * Restricted to SuperAdmin and Admin roles.
 *
 * Features:
 * - RESTful API design
 * - SuperAdmin/Admin only access control
 * - Manages: employee_amexing role
 * - Rate limiting and security headers
 * - Comprehensive error handling.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 0.1.0
 * @example
 * // Usage example
 * router.use('/employees', employeesRoutes);
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const EmployeesController = require('../../../application/controllers/api/EmployeesController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');
const logger = require('../../../infrastructure/logger');

const router = express.Router();
const employeesController = new EmployeesController();

// Rate limiting for employee management operations
const employeeApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error:
      'Too many employee management requests from this IP, please try again later.',
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
router.use(employeeApiLimiter);
router.use(jwtMiddleware.authenticateToken);

// Apply role level restriction: Only SuperAdmin (7) and Admin (6) can access
router.use(jwtMiddleware.requireRoleLevel(6));

/**
 * @swagger
 * /api/employees:
 *   get:
 *     tags:
 *       - Employee Management
 *     summary: Get list of Amexing employees
 *     description: |
 *       Retrieve paginated list of Amexing employee users (employee_amexing role).
 *
 *       **Access Control:**
 *       - Requires role level 6+ (Admin or SuperAdmin)
 *       - Returns only employee_amexing role users
 *
 *       **Features:**
 *       - Pagination (default: 25 items, max: 100)
 *       - Filter by active status
 *       - Search by name, email
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
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for name, email
 *       - $ref: '#/components/parameters/SortFieldParameter'
 *       - $ref: '#/components/parameters/SortDirectionParameter'
 *     responses:
 *       200:
 *         description: Employees retrieved successfully
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
  await employeesController.getEmployees(req, res);
});

/**
 * @swagger
 * /api/employees/{id}:
 *   get:
 *     tags:
 *       - Employee Management
 *     summary: Get employee by ID
 *     description: |
 *       Retrieve detailed employee information by user ID.
 *
 *       **Access Control:**
 *       - Requires role level 6+ (Admin or SuperAdmin)
 *       - User must have employee_amexing role
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
 *         description: Employee retrieved successfully
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
 *                     employee:
 *                       $ref: '#/components/schemas/User'
 *                 message:
 *                   type: string
 *                   example: "Employee retrieved successfully"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/:id', async (req, res) => {
  await employeesController.getEmployeeById(req, res);
});

/**
 * @swagger
 * /api/employees:
 *   post:
 *     tags:
 *       - Employee Management
 *     summary: Create new Amexing employee
 *     description: |
 *       Create a new Amexing employee user account with employee_amexing role.
 *
 *       **Features:**
 *       - Auto-generates secure password
 *       - Forces password change on first login
 *       - Assigns employee_amexing role automatically
 *       - Sets organizationId to 'amexing'
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
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: "Juan"
 *               lastName:
 *                 type: string
 *                 example: "Pérez"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "juan.perez@amexing.com"
 *               phone:
 *                 type: string
 *                 example: "+52 999 123 4567"
 *               department:
 *                 type: string
 *                 example: "Operations"
 *               position:
 *                 type: string
 *                 example: "Operations Coordinator"
 *               notes:
 *                 type: string
 *                 example: "Responsible for daily operations"
 *     responses:
 *       201:
 *         description: Employee created successfully
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
 *                     employee:
 *                       $ref: '#/components/schemas/User'
 *                     message:
 *                       type: string
 *                       example: "Empleado creado exitosamente. Se ha generado una contraseña temporal."
 *                 message:
 *                   type: string
 *                   example: "Empleado creado exitosamente"
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       409:
 *         description: Conflict - Email already exists
 */
router.post('/', writeOperationsLimiter, async (req, res) => {
  await employeesController.createEmployee(req, res);
});

/**
 * @swagger
 * /api/employees/{id}:
 *   put:
 *     tags:
 *       - Employee Management
 *     summary: Update employee
 *     description: |
 *       Update employee user information.
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
 *               phone:
 *                 type: string
 *               department:
 *                 type: string
 *               position:
 *                 type: string
 *               active:
 *                 type: boolean
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Employee updated successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.put('/:id', writeOperationsLimiter, async (req, res) => {
  await employeesController.updateEmployee(req, res);
});

/**
 * @swagger
 * /api/employees/{id}:
 *   delete:
 *     tags:
 *       - Employee Management
 *     summary: Deactivate employee (soft delete)
 *     description: |
 *       Sets employee exists=false (soft delete).
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
 *         description: Employee deactivated successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.delete('/:id', writeOperationsLimiter, async (req, res) => {
  await employeesController.deactivateEmployee(req, res);
});

/**
 * @swagger
 * /api/employees/{id}/toggle-status:
 *   patch:
 *     tags:
 *       - Employee Management
 *     summary: Toggle employee active status
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
  await employeesController.toggleEmployeeStatus(req, res);
});

/**
 * Error handling middleware for this router.
 * @param {Error} error - Error object.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {Function} _next - Next middleware function.
 */
router.use((error, req, res, _next) => {
  logger.error('Employees API Error:', {
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
