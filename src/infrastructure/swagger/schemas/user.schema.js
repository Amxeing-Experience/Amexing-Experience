/**
 * User Schema Definitions for OpenAPI/Swagger
 * Reusable schema components for user-related API responses and requests.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 0.1.0
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       required:
 *         - id
 *         - email
 *         - firstName
 *         - lastName
 *         - role
 *       properties:
 *         id:
 *           type: string
 *           description: Unique user identifier (Parse ObjectId)
 *           example: "abc123def456"
 *         username:
 *           type: string
 *           description: User's unique username
 *           example: "john.doe"
 *         email:
 *           type: string
 *           format: email
 *           description: User's email address
 *           example: "john.doe@amexing.com"
 *         firstName:
 *           type: string
 *           description: User's first name
 *           example: "John"
 *         lastName:
 *           type: string
 *           description: User's last name
 *           example: "Doe"
 *         displayName:
 *           type: string
 *           description: User's full display name
 *           example: "John Doe"
 *         role:
 *           type: string
 *           enum: [superadmin, admin, client, department_manager, employee, employee_amexing, driver, guest]
 *           description: User's role name
 *           example: "employee"
 *         roleId:
 *           type: string
 *           description: Reference to Role object
 *           example: "role123"
 *         active:
 *           type: boolean
 *           description: Whether user account is active
 *           example: true
 *         exists:
 *           type: boolean
 *           description: Logical deletion flag (false = soft deleted)
 *           example: true
 *         emailVerified:
 *           type: boolean
 *           description: Whether user's email has been verified
 *           example: true
 *         organizationId:
 *           type: string
 *           description: Organization identifier
 *           example: "org123"
 *         clientId:
 *           type: string
 *           description: Client identifier (for client-assigned users)
 *           example: "client123"
 *         departmentId:
 *           type: string
 *           description: Department identifier (for department-assigned users)
 *           example: "dept123"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: User creation timestamp
 *           example: "2025-10-01T10:00:00.000Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 *           example: "2025-10-01T12:00:00.000Z"
 *
 *     UserCreateRequest:
 *       type: object
 *       required:
 *         - email
 *         - firstName
 *         - lastName
 *         - role
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           description: User's email address (must be unique)
 *           example: "new.user@amexing.com"
 *         firstName:
 *           type: string
 *           minLength: 1
 *           description: User's first name
 *           example: "Jane"
 *         lastName:
 *           type: string
 *           minLength: 1
 *           description: User's last name
 *           example: "Smith"
 *         role:
 *           type: string
 *           enum: [admin, client, department_manager, employee, employee_amexing, driver, guest]
 *           description: User's role (superadmin can only be created by another superadmin)
 *           example: "employee"
 *         password:
 *           type: string
 *           minLength: 8
 *           description: Initial password (if not provided, a secure password will be generated)
 *           example: "SecureP@ssw0rd!"
 *         roleId:
 *           type: string
 *           description: Role object ID (alternative to role string)
 *           example: "role123"
 *         clientId:
 *           type: string
 *           description: Assign user to specific client
 *           example: "client123"
 *         departmentId:
 *           type: string
 *           description: Assign user to specific department
 *           example: "dept123"
 *         emailVerified:
 *           type: boolean
 *           description: Set email verification status
 *           example: false
 *           default: false
 *
 *     UserUpdateRequest:
 *       type: object
 *       properties:
 *         firstName:
 *           type: string
 *           description: Update first name
 *           example: "Jane"
 *         lastName:
 *           type: string
 *           description: Update last name
 *           example: "Smith"
 *         email:
 *           type: string
 *           format: email
 *           description: Update email address
 *           example: "updated.email@amexing.com"
 *         role:
 *           type: string
 *           enum: [admin, client, department_manager, employee, employee_amexing, driver, guest]
 *           description: Update user role (requires appropriate permissions)
 *           example: "department_manager"
 *         active:
 *           type: boolean
 *           description: Update active status
 *           example: true
 *         password:
 *           type: string
 *           minLength: 8
 *           description: Update password
 *           example: "NewSecureP@ssw0rd!"
 *         clientId:
 *           type: string
 *           description: Update client assignment
 *           example: "client456"
 *         departmentId:
 *           type: string
 *           description: Update department assignment
 *           example: "dept456"
 *
 *     UserListResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Users retrieved successfully"
 *         data:
 *           type: object
 *           properties:
 *             users:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 *             pagination:
 *               type: object
 *               properties:
 *                 currentPage:
 *                   type: integer
 *                   example: 1
 *                 totalPages:
 *                   type: integer
 *                   example: 5
 *                 totalUsers:
 *                   type: integer
 *                   example: 123
 *                 pageSize:
 *                   type: integer
 *                   example: 25
 *                 hasNextPage:
 *                   type: boolean
 *                   example: true
 *                 hasPreviousPage:
 *                   type: boolean
 *                   example: false
 *             requestMetadata:
 *               type: object
 *               properties:
 *                 endpoint:
 *                   type: string
 *                   example: "getUsers"
 *                 requestedBy:
 *                   type: string
 *                   example: "user123"
 *                 requestedRole:
 *                   type: string
 *                   example: "admin"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2025-10-01T12:00:00.000Z"
 *         timestamp:
 *           type: string
 *           format: date-time
 *           example: "2025-10-01T12:00:00.000Z"
 *
 *     UserStatistics:
 *       type: object
 *       properties:
 *         totalUsers:
 *           type: integer
 *           description: Total number of users in the system
 *           example: 500
 *         activeUsers:
 *           type: integer
 *           description: Number of active users
 *           example: 450
 *         newThisMonth:
 *           type: integer
 *           description: Users created this month
 *           example: 25
 *         pendingVerification:
 *           type: integer
 *           description: Users with unverified emails
 *           example: 10
 *         roleDistribution:
 *           type: object
 *           description: User count by role
 *           additionalProperties:
 *             type: integer
 *           example:
 *             superadmin: 2
 *             admin: 10
 *             department_manager: 15
 *             employee: 400
 *             driver: 50
 *             client: 20
 *             guest: 3
 *         registrationTrends:
 *           type: array
 *           description: Monthly registration trends
 *           items:
 *             type: object
 *             properties:
 *               month:
 *                 type: string
 *                 example: "2025-09"
 *               count:
 *                 type: integer
 *                 example: 35
 */

module.exports = {};
