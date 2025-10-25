# API Reference

## 📖 Complete API Documentation

The complete API reference is available in multiple formats:

### 🌐 Interactive Documentation
- **JSDoc HTML**: [Interactive API Documentation](../api-reference/index.html)
- **OpenAPI Spec**: [API Specification](../api/openapi.yaml)

### 🔗 Direct Links

#### Authentication APIs
- `POST /api/auth/login` - User authentication
- `POST /api/auth/register` - User registration  
- `POST /api/auth/logout` - User logout
- `POST /api/auth/reset-password` - Password reset

#### Core APIs
- `GET /api/status` - Application status
- `GET /api/version` - Application version information
- `GET /health` - Health check endpoint

#### Parse Server APIs
- **Base URL**: `/parse`

### 📋 API Standards

All APIs follow consistent patterns:

#### Response Format
```json
{
  "success": true,
  "data": {},
  "message": "Operation completed successfully"
}
```

#### Error Format
```json
{
  "success": false,
  "error": "Error code",
  "message": "Human readable error message"
}
```

#### Authentication
- **Session-based**: Web application requests
- **Master Key**: Administrative operations
- **API Key**: Third-party integrations

### 🔒 Security (PCI DSS)

All API endpoints implement:
- ✅ Input validation and sanitization
- ✅ Rate limiting
- ✅ CSRF protection
- ✅ Audit logging
- ✅ Secure session management

### 🧪 Testing APIs

```bash
# Health check
curl http://localhost:1337/health

# Application status
curl http://localhost:1337/api/status

# Login (example)
curl -X POST http://localhost:1337/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "demo", "password": "password"}'
```

### 📚 Parse Server Cloud Functions

```bash
# Test cloud function
curl -X POST http://localhost:1337/parse/functions/hello \
  -H "X-Parse-Application-Id: amexing-app-id" \
  -H "Content-Type: application/json" \
  -d '{"name": "Developer"}'
```

For detailed API documentation with request/response examples, see the [Interactive API Documentation](../api-reference/index.html).