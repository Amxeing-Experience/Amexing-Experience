/**
 * Authentication Schema Definitions for OpenAPI/Swagger
 * Reusable schema components for authentication and authorization.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 0.1.0
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     LoginRequest:
 *       type: object
 *       required:
 *         - identifier
 *         - password
 *       properties:
 *         identifier:
 *           type: string
 *           description: Email or username
 *           example: "john.doe@amexing.com"
 *         password:
 *           type: string
 *           format: password
 *           description: User password
 *           example: "SecureP@ssw0rd!"
 *         returnTo:
 *           type: string
 *           description: Redirect URL after successful login (for web forms)
 *           example: "/dashboard/employee"
 *
 *     LoginResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Login successful"
 *         user:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *               example: "abc123"
 *             username:
 *               type: string
 *               example: "john.doe"
 *             role:
 *               type: string
 *               example: "employee"
 *             name:
 *               type: string
 *               example: "John Doe"
 *
 *     RegisterRequest:
 *       type: object
 *       required:
 *         - username
 *         - email
 *         - password
 *         - confirmPassword
 *         - firstName
 *         - lastName
 *       properties:
 *         username:
 *           type: string
 *           minLength: 3
 *           description: Unique username
 *           example: "john.doe"
 *         email:
 *           type: string
 *           format: email
 *           description: User email address
 *           example: "john.doe@amexing.com"
 *         password:
 *           type: string
 *           format: password
 *           minLength: 8
 *           description: Password (minimum 8 characters)
 *           example: "SecureP@ssw0rd!"
 *         confirmPassword:
 *           type: string
 *           format: password
 *           description: Password confirmation (must match password)
 *           example: "SecureP@ssw0rd!"
 *         firstName:
 *           type: string
 *           description: User's first name
 *           example: "John"
 *         lastName:
 *           type: string
 *           description: User's last name
 *           example: "Doe"
 *
 *     RegisterResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Registration successful"
 *         user:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *               example: "abc123"
 *             username:
 *               type: string
 *               example: "john.doe"
 *             email:
 *               type: string
 *               example: "john.doe@amexing.com"
 *             role:
 *               type: string
 *               example: "user"
 *
 *     ForgotPasswordRequest:
 *       type: object
 *       required:
 *         - email
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           description: Email address for password reset
 *           example: "john.doe@amexing.com"
 *
 *     ResetPasswordRequest:
 *       type: object
 *       required:
 *         - token
 *         - password
 *         - confirmPassword
 *       properties:
 *         token:
 *           type: string
 *           description: Password reset token (received via email)
 *           example: "reset_token_abc123"
 *         password:
 *           type: string
 *           format: password
 *           minLength: 8
 *           description: New password
 *           example: "NewSecureP@ssw0rd!"
 *         confirmPassword:
 *           type: string
 *           format: password
 *           description: Password confirmation
 *           example: "NewSecureP@ssw0rd!"
 *
 *     ChangePasswordRequest:
 *       type: object
 *       required:
 *         - currentPassword
 *         - newPassword
 *         - confirmPassword
 *       properties:
 *         currentPassword:
 *           type: string
 *           format: password
 *           description: Current password for verification
 *           example: "CurrentP@ssw0rd!"
 *         newPassword:
 *           type: string
 *           format: password
 *           minLength: 8
 *           description: New password
 *           example: "NewSecureP@ssw0rd!"
 *         confirmPassword:
 *           type: string
 *           format: password
 *           description: New password confirmation
 *           example: "NewSecureP@ssw0rd!"
 *
 *     OAuthProvidersResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         providers:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *                 enum: [apple, corporate]
 *                 example: "apple"
 *               name:
 *                 type: string
 *                 example: "Apple"
 *               enabled:
 *                 type: boolean
 *                 example: true
 *               icon:
 *                 type: string
 *                 description: Icon URL or CSS class
 *                 example: "fab fa-apple"
 *
 *     OAuthLinkRequest:
 *       type: object
 *       required:
 *         - oauthData
 *       properties:
 *         oauthData:
 *           type: object
 *           description: OAuth provider-specific data
 *           properties:
 *             accessToken:
 *               type: string
 *               description: OAuth access token
 *               example: "oauth_token_abc123"
 *             refreshToken:
 *               type: string
 *               description: OAuth refresh token (if available)
 *               example: "oauth_refresh_token_xyz789"
 *             expiresIn:
 *               type: integer
 *               description: Token expiration time in seconds
 *               example: 3600
 *
 *     TokenRefreshResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         user:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *               example: "abc123"
 *             username:
 *               type: string
 *               example: "john.doe"
 *             role:
 *               type: string
 *               example: "employee"
 *
 *     AuthSuccessResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Operation successful"
 */

module.exports = {};
