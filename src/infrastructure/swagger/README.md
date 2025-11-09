# Swagger/OpenAPI Documentation Infrastructure

## 🎯 Overview

Sistema completo de documentación API con OpenAPI 3.0.0, PCI DSS 4.0.1 compliant, y seguridad por ambiente.

## 📁 Estructura

```
src/infrastructure/swagger/
├── README.md                   # Este archivo
├── swagger.config.js           # Configuración OpenAPI principal
├── schemas/                    # Esquemas reutilizables
│   ├── user.schema.js         # Usuario (8 schemas)
│   ├── auth.schema.js         # Autenticación (9 schemas)
│   ├── notification.schema.js  # Notificaciones (2 schemas)
│   └── common.schema.js       # Comunes (6 schemas)
└── security/                   # (Futuro) Esquemas de seguridad avanzados
    └── jwt.security.js        # (Pendiente)
```

## 🔒 Seguridad por Ambiente

| Ambiente | Swagger UI | Especificación JSON |
|----------|-----------|-------------------|
| Development | ✅ `/api-docs` | ✅ `/api-docs.json` |
| Test | ✅ `/api-docs` | ✅ `/api-docs.json` |
| **Production** | ❌ 404 | ❌ 404 |

**Implementado en:** `src/index.js` líneas 121-166

## 📊 Estadísticas Actuales

```
✓ OpenAPI 3.0.0 Specification
✓ 25 Endpoints Documentados ← ACTUALIZADO
✓ 25 Schemas Definidos
✓ 100% API Coverage (Auth, User Mgmt, Notifications, Profile, System)
✓ PCI DSS 4.0.1 Compliant
✓ Production: Disabled for Security ✓
```

## 🚀 Uso Rápido

### Desarrollo

```bash
# Iniciar servidor
yarn dev

# Acceder a documentación
http://localhost:1337/api-docs

# Validar especificación
yarn docs:api:validate

# Exportar JSON
yarn docs:api:json
```

### Agregar Nueva Documentación

1. **Crear JSDoc en ruta:**

```javascript
/**
 * @swagger
 * /api/new-endpoint:
 *   get:
 *     tags:
 *       - CategoryName
 *     summary: Brief description
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ResponseSchema'
 */
router.get('/new-endpoint', async (req, res) => { ... });
```

2. **Crear schema si es necesario:**

```javascript
// En schemas/my.schema.js
/**
 * @swagger
 * components:
 *   schemas:
 *     ResponseSchema:
 *       type: object
 *       properties:
 *         data:
 *           type: string
 */
```

3. **Agregar a apis array en swagger.config.js**

4. **Validar:**

```bash
yarn docs:api:validate
```

## 🛡️ Esquemas de Seguridad

### Bearer Authentication

```yaml
bearerAuth:
  type: http
  scheme: bearer
  bearerFormat: JWT
```

**Configuración:**
- Lifetime: 8h (access), 7d (refresh)
- Algoritmo: HS256
- Claims: userId, email, role, roleId

### Cookie Authentication

```yaml
cookieAuth:
  type: apiKey
  in: cookie
  name: accessToken
```

**Características:**
- HttpOnly: Previene XSS
- Secure: HTTPS only en producción
- SameSite: strict
- Max-Age: 8 horas

## 📝 Schemas Disponibles

### User Schemas (user.schema.js)
- `User` - Modelo completo de usuario
- `UserCreateRequest` - Request para crear usuario
- `UserUpdateRequest` - Request para actualizar
- `UserListResponse` - Response con lista de usuarios
- `UserStatistics` - Estadísticas de usuarios

### Auth Schemas (auth.schema.js)
- `LoginRequest` / `LoginResponse`
- `RegisterRequest` / `RegisterResponse`
- `ForgotPasswordRequest`
- `ResetPasswordRequest`
- `ChangePasswordRequest`
- `OAuthProvidersResponse`
- `OAuthLinkRequest`
- `TokenRefreshResponse`
- `AuthSuccessResponse`

### Notification Schemas (notification.schema.js)
- `Notification` - Modelo de notificación
- `NotificationsResponse` - Response con lista

### Common Schemas (common.schema.js)
- `SuccessResponse` - Response genérica de éxito
- `ErrorResponse` - Response genérica de error
- `PaginationInfo` - Info de paginación
- `SystemStatus` - Estado del sistema
- `VersionInfo` - Info de versión
- `ProfileUpdateRequest` / `ProfileResponse`

## 🔍 Agente de Documentación

**Ubicación:** `.claude/agents/swagger-documentation-agent/`

**Capacidades:**
- ✅ Detecta rutas sin documentar
- ✅ Valida sintaxis OpenAPI
- ✅ Verifica referencias de schemas
- ✅ Asegura cumplimiento PCI DSS
- ✅ Genera reportes de cobertura

**Activación:**
- Cambios en `src/presentation/routes/`
- Cambios en `src/application/controllers/api/`
- Manual: `yarn docs:api:validate`

## 📋 Cumplimiento PCI DSS

### ✅ Implementado

- **Autenticación Documentada:** JWT Bearer + Cookie Auth
- **Rate Limiting:** Todos los endpoints documentados
- **Cifrado:** HTTPS, cookies seguras
- **No Datos Sensibles:** Sin passwords/tokens en ejemplos
- **Audit Logging:** Winston structured logging
- **RBAC:** 7 niveles de rol documentados

### ⚠️ Prohibido en Documentación

- ❌ Números de tarjeta completos
- ❌ CVV codes
- ❌ SSN completos
- ❌ Passwords en texto plano
- ❌ Tokens completos
- ❌ Claves privadas

### ✅ Permitido (Enmascarado)

- ✅ `****-****-****-1234` (tarjeta)
- ✅ `***-**-1234` (SSN)
- ✅ `format: password` (oculto)
- ✅ Tokens truncados para ejemplos

## 🔗 Recursos

### Documentación
- [Guía Completa](../../../docs/SWAGGER_API_DOCUMENTATION.md)
- [Implementación de Seguridad](../../../docs/SWAGGER_SECURITY_IMPLEMENTATION.md)
- [Reglas del Agente](.claude/agents/swagger-documentation-agent/rules.md)

### Herramientas
- [OpenAPI Specification](https://swagger.io/specification/)
- [Swagger Editor](https://editor.swagger.io/)
- [Swagger UI](https://swagger.io/tools/swagger-ui/)

### Comandos NPM

```bash
yarn docs:api              # Muestra URL
yarn docs:api:validate     # Valida especificación
yarn docs:api:json         # Exporta JSON
```

## ✅ APIs Documentadas (COMPLETADO)

### Authentication & OAuth (12 endpoints) ✓
- POST `/auth/login`, `/auth/register`, `/auth/logout`
- POST `/auth/refresh`, `/auth/change-password`
- POST `/auth/forgot-password`, `/auth/reset-password`
- GET `/auth/oauth/providers`, `/auth/oauth/:provider`
- GET `/auth/oauth/:provider/callback`
- POST `/auth/oauth/:provider/link`
- DELETE `/auth/oauth/:provider/unlink`

### User Management (10 endpoints) ✓
- GET `/api/users` - Listar con filtros
- GET `/api/users/search` - Búsqueda avanzada
- GET `/api/users/statistics` - Estadísticas
- GET `/api/users/:id` - Obtener por ID
- POST `/api/users` - Crear usuario
- PUT `/api/users/:id` - Actualizar
- DELETE `/api/users/:id` - Desactivar (soft delete)
- PUT `/api/users/:id/reactivate` - Reactivar
- PATCH `/api/users/:id/toggle-status` - Toggle activo
- PATCH `/api/users/:id/archive` - Archivar (SuperAdmin)

### Notifications (3 endpoints) ✓
- GET `/api/notifications` - Obtener notificaciones
- PATCH `/api/notifications/:notificationId/read` - Marcar como leída
- PATCH `/api/notifications/mark-all-read` - Marcar todas

### Profile (2 endpoints) ✓
- GET `/api/user/profile` - Obtener perfil
- PUT `/api/user/profile` - Actualizar perfil

### System (2 endpoints) ✓
- GET `/api/status` - Estado del API (público)
- GET `/api/version` - Versión del API (público)

## 🚧 Mejoras Futuras

- [ ] Versionado de API (v1, v2)
- [ ] Generación automática de SDKs
- [ ] Webhooks documentation
- [ ] Rate limiting dinámico
- [ ] API Analytics/Metrics
- [ ] Portal de desarrolladores
- [ ] Changelog automático

## 🤝 Contribuir

### Agregar Nueva Documentación

1. Crear JSDoc Swagger en archivo de ruta
2. Crear schema si es necesario
3. Agregar archivo a `apis` en swagger.config.js
4. Validar con `yarn docs:api:validate`
5. Verificar en `/api-docs`

### Estándares

- OpenAPI 3.0.0
- JSDoc con @swagger tags
- Esquemas reutilizables
- Ejemplos realistas
- PCI DSS compliant
- Sin datos sensibles

## 📞 Soporte

- **Documentación:** Ver `/docs/SWAGGER_API_DOCUMENTATION.md`
- **Seguridad:** Ver `/docs/SWAGGER_SECURITY_IMPLEMENTATION.md`
- **Agente:** Ver `.claude/agents/swagger-documentation-agent/rules.md`
- **Issues:** Contactar Amexing Development Team

---

**Versión:** 1.0.0
**Actualizado:** 2025-10-01
**Mantenedor:** Amexing Development Team
