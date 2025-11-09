/**
 * Common Schema Definitions for OpenAPI/Swagger
 * Reusable schema components for common API patterns.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 0.1.0
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     SuccessResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Operation successful"
 *         timestamp:
 *           type: string
 *           format: date-time
 *           example: "2024-10-01T12:00:00.000Z"
 *
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         error:
 *           type: string
 *           example: "Error message"
 *         timestamp:
 *           type: string
 *           format: date-time
 *           example: "2024-10-01T12:00:00.000Z"
 *
 *     PaginationInfo:
 *       type: object
 *       properties:
 *         currentPage:
 *           type: integer
 *           description: Current page number
 *           example: 1
 *         totalPages:
 *           type: integer
 *           description: Total number of pages
 *           example: 10
 *         totalItems:
 *           type: integer
 *           description: Total number of items
 *           example: 250
 *         pageSize:
 *           type: integer
 *           description: Number of items per page
 *           example: 25
 *         hasNextPage:
 *           type: boolean
 *           description: Whether there is a next page
 *           example: true
 *         hasPreviousPage:
 *           type: boolean
 *           description: Whether there is a previous page
 *           example: false
 *
 *     SystemStatus:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 *           enum: [healthy, degraded, down]
 *           example: "healthy"
 *         timestamp:
 *           type: string
 *           format: date-time
 *           example: "2024-10-01T12:00:00.000Z"
 *         services:
 *           type: object
 *           properties:
 *             database:
 *               type: string
 *               enum: [connected, disconnected]
 *               example: "connected"
 *             parseServer:
 *               type: string
 *               enum: [running, stopped]
 *               example: "running"
 *
 *     VersionInfo:
 *       type: object
 *       properties:
 *         version:
 *           type: string
 *           description: API version
 *           example: 0.1.0
 *         environment:
 *           type: string
 *           enum: [development, staging, production]
 *           example: "development"
 *         nodeVersion:
 *           type: string
 *           example: 20.0.0
 *
 *     ProfileUpdateRequest:
 *       type: object
 *       properties:
 *         firstName:
 *           type: string
 *           description: Update first name
 *           example: "John"
 *         lastName:
 *           type: string
 *           description: Update last name
 *           example: "Doe"
 *         email:
 *           type: string
 *           format: email
 *           description: Update email (requires verification)
 *           example: "john.doe@amexing.com"
 *         phone:
 *           type: string
 *           description: Update phone number
 *           example: "+1234567890"
 *         preferences:
 *           type: object
 *           description: User preferences
 *           additionalProperties: true
 *
 *     ProfileResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: object
 *           properties:
 *             user:
 *               $ref: '#/components/schemas/User'
 *         timestamp:
 *           type: string
 *           format: date-time
 *           example: "2024-10-01T12:00:00.000Z"
 */

module.exports = {};
