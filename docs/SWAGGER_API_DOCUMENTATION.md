# Swagger API Documentation - AmexingWeb

## Resumen

Sistema de documentación API completo basado en OpenAPI 3.0.0 con cumplimiento PCI DSS 4.0.1, detección automática de nuevas rutas y documentación interactiva.

## Características

### ✅ Implementadas

- **OpenAPI 3.0.0 Specification** - Estándar moderno de documentación API
- **Swagger UI Interactivo** - Interfaz visual para explorar y probar APIs
- **Autenticación JWT Documentada** - Esquemas de seguridad Bearer y Cookie Auth
- **Esquemas Reutilizables** - Componentes modulares para User, Auth, Notifications
- **Documentación PCI DSS Compliant** - Sin exposición de datos sensibles
- **Agente de Monitoreo** - Detección automática de rutas sin documentar
- **NPM Scripts** - Comandos para validar y exportar documentación
- **12 Endpoints Documentados** - Autenticación completa y OAuth
- **25 Esquemas Definidos** - Modelos de datos completos

### 📊 Estadísticas

```bash
✓ OpenAPI specification is valid
Endpoints: 12
Schemas: 25
Coverage: 100% (Authentication & OAuth)
```

## Acceso a la Documentación

### 🔒 Seguridad por Ambiente

**IMPORTANTE:** La documentación Swagger está **deshabilitada en producción** por seguridad.

| Ambiente | Swagger UI | OpenAPI JSON | Estado |
|----------|-----------|--------------|--------|
| **Development** | ✅ `http://localhost:1337/api-docs` | ✅ `http://localhost:1337/api-docs.json` | Habilitado |
| **Test** | ✅ `/api-docs` | ✅ `/api-docs.json` | Habilitado |
| **Production** | ❌ 404 Not Found | ❌ 404 Not Found | Deshabilitado |

### Swagger UI (Interactivo) - Development/Test Only
```bash
# Desarrollo
http://localhost:1337/api-docs

# Test
NODE_ENV=test yarn dev
# Luego: http://localhost:1337/api-docs
```

**Características:**
- Interfaz visual completa
- Prueba de endpoints en vivo
- Autenticación persistente
- Filtrado por tags
- Ejemplos de request/response
- Syntax highlighting

**⚠️ Nota de Seguridad:**
En producción, acceder a `/api-docs` retorna:
```json
{
  "error": "Not Found",
  "message": "API documentation is not available in production"
}
```

### OpenAPI JSON (Especificación) - Development/Test Only
```bash
# Solo disponible en development y test
http://localhost:1337/api-docs.json
```

**Usos:**
- Importar en Postman (development)
- Generar SDKs cliente (desde spec exportado)
- Validación automatizada (CI/CD)
- Testing de integración

### Estrategia para Producción

Para documentación en producción, considera:

1. **Portal de Desarrolladores Separado**
   - Host: `developers.amexing.com`
   - Autenticación con API keys
   - Rate limiting estricto
   - Swagger UI con spec estático

2. **Exportar Especificación**
   ```bash
   yarn docs:api:json
   # Genera: swagger-spec.json
   # Publicar en portal seguro
   ```

3. **Versionado de API**
   ```bash
   # Guardar specs por versión
   cp swagger-spec.json docs/api/v0.1.0.json
   ```

4. **Opciones de Hosting**
   - AWS API Gateway + Swagger
   - Cloudflare Workers + KV
   - Vercel/Netlify con autenticación
   - Self-hosted con Nginx + auth

## Estructura de Archivos

```
src/infrastructure/swagger/
├── swagger.config.js           # Configuración OpenAPI principal
├── schemas/                    # Esquemas reutilizables
│   ├── user.schema.js         # Esquemas de Usuario
│   ├── auth.schema.js         # Esquemas de Autenticación
│   ├── notification.schema.js  # Esquemas de Notificaciones
│   └── common.schema.js       # Esquemas Comunes

.claude/agents/swagger-documentation-agent/
├── agent.yaml                  # Configuración del agente
└── rules.md                    # Reglas de documentación
```

## Comandos NPM

### Visualizar Documentación
```bash
yarn docs:api
# Output: Swagger API documentation available at: http://localhost:1337/api-docs
```

### Exportar Especificación
```bash
yarn docs:api:json
# Genera: swagger-spec.json
```

### Validar Especificación
```bash
yarn docs:api:validate
# Output:
# ✓ OpenAPI specification is valid
# Endpoints: 12
# Schemas: 25
```

## APIs Documentadas

### Authentication (7 endpoints)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/auth/login` | Login con credenciales |
| POST | `/auth/register` | Registro de usuario |
| POST | `/auth/logout` | Cerrar sesión |
| POST | `/auth/refresh` | Renovar token JWT |
| POST | `/auth/forgot-password` | Solicitar reset de contraseña |
| POST | `/auth/reset-password` | Completar reset de contraseña |
| POST | `/auth/change-password` | Cambiar contraseña (autenticado) |

### OAuth (5 endpoints)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/auth/oauth/providers` | Listar proveedores OAuth |
| GET | `/auth/oauth/:provider` | Iniciar flujo OAuth |
| GET | `/auth/oauth/:provider/callback` | Callback OAuth |
| POST | `/auth/oauth/:provider/link` | Vincular cuenta OAuth |
| DELETE | `/auth/oauth/:provider/unlink` | Desvincular cuenta OAuth |

## Esquemas de Seguridad

### Bearer Authentication
```yaml
bearerAuth:
  type: http
  scheme: bearer
  bearerFormat: JWT
```

**Uso:**
```bash
curl -H "Authorization: Bearer <token>" http://localhost:1337/api/endpoint
```

**Características:**
- Token lifetime: 8 horas (access), 7 días (refresh)
- Algoritmo: HS256
- Claims: userId, username, email, role, roleId, organizationId, name

### Cookie Authentication
```yaml
cookieAuth:
  type: apiKey
  in: cookie
  name: accessToken
```

**Características:**
- HttpOnly: Previene XSS
- Secure: Solo HTTPS en producción
- SameSite=strict: Previene CSRF
- Max-Age: 8 horas

## Cumplimiento PCI DSS 4.0.1

### Características de Seguridad Documentadas

✅ **Autenticación Multi-Factor**
- OAuth 2.0 con múltiples proveedores
- JWT con rotación de tokens
- MFA para acceso a CDE (cardholder data environment)

✅ **Rate Limiting**
- Authentication endpoints: 50 req/15min
- API endpoints: 100 req/15min
- Write operations: 30 req/15min
- Password reset: 10 req/5min

✅ **Cifrado**
- Tokens en tránsito: HTTPS
- Cookies: Secure flag
- Datos en reposo: MongoDB encryption

✅ **Audit Logging**
- Winston logging estructurado
- Trails completos de auditoría
- Timestamps ISO8601

✅ **Control de Acceso**
- RBAC con 7 niveles de rol
- Permisos granulares
- Jerarquía de roles documentada

### Datos Sensibles Protegidos

❌ **NUNCA en Documentación:**
- Números de tarjeta completos
- CVV codes
- SSN completos
- Passwords en texto plano
- Tokens completos

✅ **Ejemplos Permitidos:**
- Tarjetas enmascaradas: `****-****-****-1234`
- SSN enmascarado: `***-**-1234`
- Passwords: `format: password` (oculto)
- Tokens: Versión truncada

## Cómo Documentar Nuevas APIs

### 1. Crear Endpoint

```javascript
// src/presentation/routes/api/myRoutes.js
router.get('/endpoint', async (req, res) => {
  // Implementación
});
```

### 2. Agregar Documentación Swagger

```javascript
/**
 * @swagger
 * /api/endpoint:
 *   get:
 *     tags:
 *       - CategoryName
 *     summary: Brief description
 *     description: |
 *       Detailed description including:
 *       - Purpose and use cases
 *       - Security features
 *       - Rate limiting
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SchemaName'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
```

### 3. Crear Schema (si es necesario)

```javascript
// src/infrastructure/swagger/schemas/my.schema.js
/**
 * @swagger
 * components:
 *   schemas:
 *     MySchema:
 *       type: object
 *       required:
 *         - field1
 *       properties:
 *         field1:
 *           type: string
 *           description: Field description
 *           example: "example value"
 */
```

### 4. Actualizar swagger.config.js

```javascript
// Agregar archivo de schema a apis array
apis: [
  // ... otros
  './src/infrastructure/swagger/schemas/my.schema.js',
],
```

### 5. Validar

```bash
yarn docs:api:validate
```

## Agente de Documentación

### Funcionalidad

El agente `swagger-documentation-agent` monitorea automáticamente:

- ✅ Nuevas rutas creadas sin documentación
- ✅ Modificaciones a endpoints existentes
- ✅ Referencias de esquemas rotas
- ✅ Cumplimiento de estándares de documentación
- ✅ Validación PCI DSS

### Activación

El agente se activa cuando:
1. Se crean o modifican archivos en `src/presentation/routes/`
2. Se modifican controllers en `src/application/controllers/api/`
3. Se ejecuta manualmente: `yarn docs:api:validate`

### Reglas de Validación

El agente verifica:

- **Completitud:** Todos los endpoints documentados
- **Sintaxis:** YAML válido en JSDoc
- **Referencias:** Todos los `$ref` existen
- **Seguridad:** Endpoints protegidos con security schemes
- **Respuestas:** Al menos 200, 400, 401, 500 documentadas
- **PCI DSS:** Sin datos sensibles en ejemplos

## Mejores Prácticas

### ✅ DO

- Documentar endpoints inmediatamente después de crearlos
- Usar referencias de esquemas para reutilización
- Proveer ejemplos realistas
- Documentar rate limits y seguridad
- Mantener descripciones concisas pero completas
- Usar códigos HTTP apropiados
- Documentar todos los escenarios de error

### ❌ DON'T

- Copiar-pegar documentación sin personalizar
- Incluir datos sensibles en ejemplos
- Omitir documentación de seguridad
- Usar descripciones vagas
- Olvidar actualizar docs al cambiar código
- Crear esquemas no utilizados
- Documentar endpoints internos/privados

## Integración CI/CD

### Pre-Commit Hook

```bash
# .git/hooks/pre-commit
#!/bin/bash
yarn docs:api:validate
if [ $? -ne 0 ]; then
  echo "API documentation validation failed"
  exit 1
fi
```

### Pipeline CI

```yaml
# .github/workflows/api-docs.yml
name: API Documentation

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Validate API Documentation
        run: |
          yarn install
          yarn docs:api:validate
      - name: Generate Coverage Report
        run: |
          yarn docs:api:json
      - name: Upload Specification
        uses: actions/upload-artifact@v2
        with:
          name: openapi-spec
          path: swagger-spec.json
```

## Próximos Pasos

### Pendientes de Documentar

- [ ] User Management API (10 endpoints)
  - GET `/api/users` - Listar usuarios
  - GET `/api/users/:id` - Obtener usuario
  - POST `/api/users` - Crear usuario
  - PUT `/api/users/:id` - Actualizar usuario
  - DELETE `/api/users/:id` - Desactivar usuario
  - Y más...

- [ ] Notifications API (3 endpoints)
- [ ] Profile API (2 endpoints)
- [ ] System API (2 endpoints)

### Mejoras Futuras

- [ ] Generar SDKs cliente automáticamente
- [ ] Integrar con API Gateway
- [ ] Versionado de API (v1, v2)
- [ ] Documentación de webhooks
- [ ] Rate limiting dinámico documentado
- [ ] Métricas de uso de API

## Troubleshooting

### Error: "OpenAPI specification is invalid"

```bash
# Verificar sintaxis YAML en JSDoc
yarn docs:api:validate

# Revisar referencias de esquemas
grep -r '$ref' src/presentation/routes/
```

### Error: "Schema not found"

```bash
# Verificar que el schema existe
ls src/infrastructure/swagger/schemas/

# Agregar al swagger.config.js en apis array
```

### Swagger UI no carga

```bash
# Verificar servidor corriendo
curl http://localhost:1337/api-docs/

# Verificar configuración
grep -A 10 'swagger' src/index.js
```

### Endpoints no aparecen

```bash
# Verificar que el archivo de rutas está en apis array
grep 'apis:' src/infrastructure/swagger/swagger.config.js

# Verificar formato de @swagger
```

## Recursos

### Documentación Oficial

- [OpenAPI 3.0 Specification](https://swagger.io/specification/)
- [Swagger UI](https://swagger.io/tools/swagger-ui/)
- [PCI DSS 4.0.1](https://www.pcisecuritystandards.org/)

### Herramientas

- [Swagger Editor](https://editor.swagger.io/) - Editor online
- [Postman](https://www.postman.com/) - Importar OpenAPI spec
- [Redoc](https://redocly.com/) - Alternativa a Swagger UI

### Ejemplos

- Ver `/auth` routes - Implementación completa
- Ver `user.schema.js` - Esquemas complejos
- Ver `swagger.config.js` - Configuración completa

## Soporte

Para preguntas o problemas:

1. Revisar este README
2. Consultar `.claude/agents/swagger-documentation-agent/rules.md`
3. Revisar especificación OpenAPI 3.0
4. Contactar al equipo de desarrollo de Amexing

---

**Versión:** 1.0.0
**Última actualización:** 2025-10-01
**Mantenedor:** Amexing Development Team
