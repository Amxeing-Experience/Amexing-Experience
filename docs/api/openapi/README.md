# AmexingWeb API Documentation (OpenAPI 3.0)

This directory contains the modular OpenAPI 3.0 specification for the AmexingWeb API.

## Commands

```bash
# Bundle all modular files into single spec
yarn docs:api:bundle

# Lint specification for errors
yarn docs:api:lint

# Preview docs with hot reload (port 8080)
yarn docs:api:preview

# Build static HTML documentation
yarn docs:api:build

# Show specification statistics
yarn docs:api:stats
```

## Directory Structure

```
openapi/
├── openapi.json              # Root document with $ref links to all components
├── info.json                 # API metadata (title, version, description)
├── servers.json              # Server URLs (dev, staging, production)
├── tags.json                 # API grouping tags
├── paths/                    # Endpoint definitions
│   ├── auth/                 # Authentication (login, register, OAuth, etc.)
│   ├── api/                  # API resources
│   │   ├── users/           # User management
│   │   ├── roles/           # Role management
│   │   ├── clients/         # Client management
│   │   ├── vehicles/        # Vehicle management
│   │   ├── billing/         # Billing operations
│   │   ├── audit/           # Audit logs
│   │   └── ...              # Other resources
│   └── health/              # Health check endpoints
└── components/
    ├── schemas/             # Data models
    │   ├── auth/           # Authentication schemas
    │   ├── user/           # User schemas
    │   ├── common/         # Common schemas
    │   └── notification/   # Notification schemas
    ├── responses/          # Reusable response templates
    ├── parameters/         # Reusable parameters
    └── securitySchemes/    # Authentication schemes
```

## Adding New Endpoints

### 1. Create Path File

Create a JSON file in the appropriate `paths/` subdirectory:

```json
// paths/api/my-resource/index.json
{
  "get": {
    "tags": ["My Resource"],
    "summary": "List my resources",
    "operationId": "listMyResources",
    "security": [{ "bearerAuth": [] }],
    "responses": {
      "200": {
        "description": "List of resources"
      },
      "401": {
        "$ref": "../../components/responses/UnauthorizedError.json"
      }
    }
  }
}
```

### 2. Add Reference in openapi.json

Add the path reference in `openapi.json`:

```json
{
  "paths": {
    "/api/my-resource": {
      "$ref": "paths/api/my-resource/index.json"
    }
  }
}
```

### 3. Bundle and Verify

```bash
yarn docs:api:bundle
yarn docs:api:lint
```

## File Naming Conventions

### Paths
- Collection endpoints: `index.json` (e.g., `paths/api/users/index.json`)
- Resource by ID: `_id.json` (e.g., `paths/api/users/_id.json`)
- Named actions: `action-name.json` (e.g., `paths/api/users/toggle-status.json`)

### Schemas
- PascalCase: `LoginRequest.json`, `User.json`
- Group by domain: `auth/`, `user/`, `common/`

## Security

All authenticated endpoints must include:

```json
"security": [{ "bearerAuth": [] }]
```

Or for cookie-based auth:

```json
"security": [{ "cookieAuth": [] }]
```

Public endpoints use empty security:

```json
"security": []
```

## Reusable Components

### Response Templates
- `UnauthorizedError.json` - 401 responses
- `ForbiddenError.json` - 403 responses
- `NotFoundError.json` - 404 responses
- `ValidationError.json` - 400/422 responses
- `ServerError.json` - 500 responses

### Common Parameters
- `PageParameter.json` - Pagination page number
- `LimitParameter.json` - Items per page
- `SortFieldParameter.json` - Sort field
- `SortDirectionParameter.json` - asc/desc

## Accessing Documentation

### Development Server

When running `yarn dev`, documentation is available at:

| URL | Description |
|-----|-------------|
| `http://localhost:1337/api-docs` | Complete API documentation |
| `http://localhost:1337/api-docs.json` | Complete OpenAPI spec (JSON) |

### Partial Specs by Access Level

For the **mobile app team** or when you need only specific endpoints:

| URL | Description | Use Case |
|-----|-------------|----------|
| `/api-docs/public` | 🔓 Public API UI | Auth endpoints (login, register, OAuth) |
| `/api-docs/protected` | 🔐 Protected API UI | User features (profile, notifications) |
| `/api-docs/admin` | 🔒 Admin API UI | Management (users, roles, catalogs) |
| `/api-docs/public.json` | Public spec JSON | Copy for mobile integration |
| `/api-docs/protected.json` | Protected spec JSON | Copy for mobile integration |
| `/api-docs/admin.json` | Admin spec JSON | Copy for admin panel integration |

### API Categories

**🔓 Public API** - No authentication required:
- Authentication (login, register, password reset)
- OAuth (Apple, Corporate)
- System (health, status)

**🔐 Protected API** - Requires JWT Bearer token:
- Profile (get/update user profile)
- Notifications (list, mark as read)
- Session (health check)

**🔒 Admin API** - Requires JWT + Admin/SuperAdmin role:
- User Management (CRUD)
- Roles, POIs, Rates
- Service Types, Vehicle Types, Vehicles
- Billing, Audit, Payment Info

### Copying Specs for Mobile Team

```bash
# Download public API spec
curl http://localhost:1337/api-docs/public.json > public-api.json

# Download protected API spec
curl http://localhost:1337/api-docs/protected.json > protected-api.json

# Or open in browser and copy manually
open http://localhost:1337/api-docs/public
```

### Single Endpoint Spec (for LLMs/AI)

**Copy from UI**: Navigate to any endpoint in `/api-docs` and click the **"📋 Copy Spec"** button next to each operation header to copy the JSON spec to clipboard.

**API Endpoint**: Extract specs programmatically:

```bash
# By path and method
curl "http://localhost:1337/api-docs/spec?path=/api/users&method=GET"

# By operationId
curl "http://localhost:1337/api-docs/spec?operationId=authLogin"

# All methods for a path
curl "http://localhost:1337/api-docs/spec?path=/api/users"

# List all available operations
curl "http://localhost:1337/api-docs/spec?list=true"
```

**Query Parameters:**

| Parameter | Example | Description |
|-----------|---------|-------------|
| `path` | `/api/users/profile` | API path to extract |
| `method` | `GET` | HTTP method (optional) |
| `operationId` | `getUserProfile` | Unique operation ID |
| `list` | `true` | List all available operations |

**Example Response:**

```json
{
  "path": "/api/users/profile",
  "method": "GET",
  "operationId": "getUserProfile",
  "tags": ["Profile"],
  "summary": "Get current user profile",
  "security": [{"bearerAuth": []}],
  "responses": { ... }
}
```

## PCI DSS Compliance

- Documentation is **disabled in production** (returns 404)
- Available only in development/test environments
- No sensitive data (tokens, passwords) in examples
- All security schemes properly documented

## Troubleshooting

### Lint Errors

```bash
# Show detailed lint output
yarn docs:api:lint

# Common issues:
# - Missing operationId
# - Missing 2XX response
# - Invalid $ref path
```

### Bundle Issues

```bash
# Verify all $ref paths exist
yarn docs:api:lint

# Check for JSON syntax errors
cat docs/api/openapi-spec.json | jq .
```
