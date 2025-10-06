/**
 * Notification Schema Definitions for OpenAPI/Swagger
 * Reusable schema components for notification-related API responses.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 0.1.0
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Notification:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Notification unique identifier
 *           example: "notif123"
 *         userId:
 *           type: string
 *           description: Target user ID
 *           example: "user123"
 *         type:
 *           type: string
 *           enum: [info, warning, error, success]
 *           description: Notification type
 *           example: "info"
 *         title:
 *           type: string
 *           description: Notification title
 *           example: "New Message"
 *         message:
 *           type: string
 *           description: Notification content
 *           example: "You have a new message from admin"
 *         read:
 *           type: boolean
 *           description: Whether notification has been read
 *           example: false
 *         data:
 *           type: object
 *           description: Additional notification data
 *           additionalProperties: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Notification creation timestamp
 *           example: "2025-10-01T10:00:00.000Z"
 *
 *     NotificationsResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Notifications retrieved successfully"
 *         data:
 *           type: object
 *           properties:
 *             notifications:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Notification'
 *             unreadCount:
 *               type: integer
 *               description: Number of unread notifications
 *               example: 5
 *             totalCount:
 *               type: integer
 *               description: Total number of notifications
 *               example: 50
 */

module.exports = {};
