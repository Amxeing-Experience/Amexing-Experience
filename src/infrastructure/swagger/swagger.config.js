/**
 * Swagger/OpenAPI 3.0 Configuration for AmexingWeb API
 * PCI DSS 4.0.1 Compliant API Documentation.
 *
 * This configuration defines the OpenAPI 3.0 specification for all API endpoints,
 * including security schemes, server configurations, and documentation metadata.
 *
 * Features:
 * - JWT Bearer authentication with PCI DSS compliant token lifetimes
 * - Comprehensive API documentation with interactive Swagger UI
 * - Reusable schemas and components
 * - Security documentation for all endpoints
 * - Rate limiting and timeout documentation.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 0.1.0
 */

const swaggerJsdoc = require('swagger-jsdoc');

/**
 * OpenAPI 3.0 base configuration.
 * Defines API metadata, servers, security schemes, and documentation paths.
 */
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'AmexingWeb API',
      version: '0.1.0',
      description: `
# AmexingWeb E-Commerce Platform API

PCI DSS Level 1 compliant e-commerce platform with comprehensive security features.

## Features
- **Authentication**: Multi-provider OAuth 2.0 (Username/Password, Apple, Corporate)
- **Security**: JWT Bearer tokens with secure HTTP-only cookies
- **Authorization**: Role-based access control (RBAC) with 7 role levels
- **Data Protection**: Encryption at rest and in transit
- **Audit Logging**: Comprehensive audit trails for all operations

## Security Standards
- PCI DSS 4.0.1 Compliant
- OWASP Top 10 Protection
- Rate Limiting on all endpoints
- CSRF Protection for state-changing operations
- Security Headers (Helmet.js)

## Authentication Flow
1. Obtain JWT token via \`/auth/login\` or OAuth providers
2. Include token in \`Authorization: Bearer <token>\` header
3. Token lifetime: 8 hours (access), 7 days (refresh)
4. Use \`/auth/refresh\` to renew tokens before expiration

## Rate Limiting
- Authentication endpoints: 50 requests / 15 minutes
- API endpoints: 100 requests / 15 minutes
- Write operations: 30 requests / 15 minutes
- Password reset: 10 requests / 5 minutes

## Support
For API support, contact the Amexing Development Team.
      `,
      contact: {
        name: 'Amexing Development Team',
        email: 'dev@amexing.com',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: 'http://localhost:1337',
        description: 'Development server',
      },
      {
        url: 'https://staging-api.amexing.com',
        description: 'Staging server',
      },
      {
        url: 'https://api.amexing.com',
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: `
JWT Bearer token authentication.

**Token Lifetime (PCI DSS Compliant):**
- Access Token: 8 hours
- Refresh Token: 7 days

**How to obtain a token:**
1. Use \`POST /auth/login\` with credentials
2. Or authenticate via OAuth providers
3. Token will be returned in response and set as HTTP-only cookie

**Token includes:**
- userId: User unique identifier
- username: Username
- email: User email
- role: User role (superadmin, admin, client, etc.)
- roleId: Role object ID
- organizationId: Organization identifier
- name: User display name

**Security Features:**
- Tokens are signed with HS256 algorithm
- HTTP-only cookies prevent XSS attacks
- Secure flag in production (HTTPS only)
- SameSite=strict prevents CSRF
          `,
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'accessToken',
          description: `
HTTP-only cookie containing JWT access token.

**Security Features:**
- HttpOnly: Cannot be accessed via JavaScript
- Secure: Only transmitted over HTTPS in production
- SameSite=strict: Prevents CSRF attacks
- Max-Age: 8 hours

This is automatically set by the server upon successful authentication.
          `,
        },
      },
      responses: {
        UnauthorizedError: {
          description: 'Authentication required or token invalid/expired',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: {
                    type: 'boolean',
                    example: false,
                  },
                  error: {
                    type: 'string',
                    example: 'Authentication required',
                  },
                  timestamp: {
                    type: 'string',
                    format: 'date-time',
                    example: '2025-10-01T12:00:00.000Z',
                  },
                },
              },
            },
          },
        },
        ForbiddenError: {
          description: 'Insufficient permissions to access this resource',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: {
                    type: 'boolean',
                    example: false,
                  },
                  error: {
                    type: 'string',
                    example: 'Insufficient permissions',
                  },
                  timestamp: {
                    type: 'string',
                    format: 'date-time',
                    example: '2025-10-01T12:00:00.000Z',
                  },
                },
              },
            },
          },
        },
        NotFoundError: {
          description: 'Resource not found or access denied',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: {
                    type: 'boolean',
                    example: false,
                  },
                  error: {
                    type: 'string',
                    example: 'Resource not found',
                  },
                  timestamp: {
                    type: 'string',
                    format: 'date-time',
                    example: '2025-10-01T12:00:00.000Z',
                  },
                },
              },
            },
          },
        },
        ValidationError: {
          description: 'Request validation failed',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: {
                    type: 'boolean',
                    example: false,
                  },
                  error: {
                    type: 'string',
                    example:
                      'Validation failed: Email is required, Password must be at least 8 characters',
                  },
                  timestamp: {
                    type: 'string',
                    format: 'date-time',
                    example: '2025-10-01T12:00:00.000Z',
                  },
                },
              },
            },
          },
        },
        RateLimitError: {
          description: 'Rate limit exceeded',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: {
                    type: 'boolean',
                    example: false,
                  },
                  error: {
                    type: 'string',
                    example: 'Too many requests, please try again later',
                  },
                  retryAfter: {
                    type: 'string',
                    example: '15 minutes',
                  },
                },
              },
            },
          },
        },
        ServerError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: {
                    type: 'boolean',
                    example: false,
                  },
                  error: {
                    type: 'string',
                    example: 'Internal server error',
                  },
                  timestamp: {
                    type: 'string',
                    format: 'date-time',
                    example: '2025-10-01T12:00:00.000Z',
                  },
                },
              },
            },
          },
        },
      },
      parameters: {
        PageParameter: {
          in: 'query',
          name: 'page',
          schema: {
            type: 'integer',
            minimum: 1,
            default: 1,
          },
          description: 'Page number for pagination',
        },
        LimitParameter: {
          in: 'query',
          name: 'limit',
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 25,
          },
          description: 'Number of items per page (max: 100)',
        },
        SortFieldParameter: {
          in: 'query',
          name: 'sortField',
          schema: {
            type: 'string',
            default: 'lastName',
          },
          description: 'Field to sort by',
        },
        SortDirectionParameter: {
          in: 'query',
          name: 'sortDirection',
          schema: {
            type: 'string',
            enum: ['asc', 'desc'],
            default: 'asc',
          },
          description: 'Sort direction',
        },
      },
    },
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication and authorization endpoints',
      },
      {
        name: 'OAuth',
        description: 'OAuth 2.0 provider integration (Apple, Corporate)',
      },
      {
        name: 'User Management',
        description: 'User CRUD operations with RBAC',
      },
      {
        name: 'Notifications',
        description: 'User notification management',
      },
      {
        name: 'Profile',
        description: 'User profile management',
      },
      {
        name: 'System',
        description: 'System status and health endpoints',
      },
    ],
  },
  apis: [
    './src/presentation/routes/authRoutes.js',
    './src/presentation/routes/apiRoutes.js',
    './src/presentation/routes/api/userManagementRoutes.js',
    './src/application/controllers/api/UserManagementController.js',
    './src/application/controllers/api/NotificationsController.js',
    './src/application/controllers/apiController.js',
    './src/infrastructure/swagger/schemas/**/*.js',
  ],
};

/**
 * Generate OpenAPI specification from JSDoc comments.
 * @returns {object} OpenAPI specification object.
 */
const swaggerSpec = swaggerJsdoc(swaggerOptions);

module.exports = {
  swaggerSpec,
  swaggerOptions,
};
