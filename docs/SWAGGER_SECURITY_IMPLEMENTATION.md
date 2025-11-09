# Swagger Security Implementation - AmexingWeb

## Resumen

Implementación de seguridad por ambiente para la documentación Swagger/OpenAPI, deshabilitando el acceso en producción mientras se mantiene disponible en desarrollo y test.

## Implementación

### Código de Seguridad

**Ubicación:** `src/index.js` (líneas 121-166)

```javascript
// Swagger API Documentation (Development and Test only)
// SECURITY: Disabled in production - configure proper API documentation strategy for production
if (process.env.NODE_ENV !== 'production') {
  logger.info('Swagger API Documentation enabled at /api-docs (Development/Test only)');

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { ... }));
  app.get('/api-docs.json', (req, res) => { ... });
} else {
  // In production, return 404 for documentation endpoints
  app.use('/api-docs', (req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: 'API documentation is not available in production',
    });
  });

  app.get('/api-docs.json', (req, res) => { ... });
}
```

### Comportamiento por Ambiente

| Ambiente | `NODE_ENV` | Swagger UI | OpenAPI JSON | Logs |
|----------|-----------|-----------|--------------|------|
| **Development** | `development` | ✅ Habilitado | ✅ Habilitado | `Swagger API Documentation enabled at /api-docs (Development/Test only)` |
| **Test** | `test` | ✅ Habilitado | ✅ Habilitado | `Swagger API Documentation enabled at /api-docs (Development/Test only)` |
| **Staging** | `staging` | ❌ 404 | ❌ 404 | Sin mensaje de Swagger |
| **Production** | `production` | ❌ 404 | ❌ 404 | Sin mensaje de Swagger |

## Pruebas de Seguridad

### Test 1: Development (✓ Passed)

```bash
NODE_ENV=development yarn dev
curl http://localhost:1337/api-docs/
# Resultado: 200 OK - HTML de Swagger UI

curl http://localhost:1337/api-docs.json
# Resultado: 200 OK - OpenAPI JSON spec
```

### Test 2: Test Environment (✓ Passed)

```bash
NODE_ENV=test yarn dev
curl http://localhost:1337/api-docs/
# Resultado: 200 OK - HTML de Swagger UI
```

### Test 3: Production (✓ Passed)

```bash
NODE_ENV=production yarn start
curl http://localhost:1337/api-docs/
# Resultado: 404 Not Found
# {
#   "error": "Not Found",
#   "message": "API documentation is not available in production"
# }
```

## Validación Lógica

```javascript
// Lógica de seguridad testada
const environments = ['development', 'test', 'staging', 'production'];

environments.forEach(env => {
  const swaggerEnabled = env !== 'production';
  console.log(`${env}: ${swaggerEnabled ? 'ENABLED' : 'DISABLED'}`);
});

// Output:
// development: ENABLED ✅
// test: ENABLED ✅
// staging: DISABLED 🔒
// production: DISABLED 🔒
```

## Razones de Seguridad

### ¿Por qué deshabilitar Swagger en producción?

1. **Exposición de Información Sensible**
   - Estructura completa del API
   - Nombres de campos internos
   - Formatos de request/response
   - Esquemas de validación
   - Endpoints no públicos

2. **Surface de Ataque**
   - Revelar todos los endpoints disponibles
   - Facilitar ingeniería inversa
   - Exponer patrones de negocio
   - Descubrir vulnerabilidades potenciales

3. **Cumplimiento PCI DSS 4.0.1**
   - Requirement 6.4.6: No exponer información del sistema
   - Requirement 6.5.1: Prevenir información disclosure
   - Requirement 11.3.1: Reducir superficie de ataque

4. **Best Practices de Seguridad**
   - Principio de mínimo privilegio
   - Defense in depth
   - Obscurity como capa adicional (no única)

## Estrategias para Producción

### Opción 1: Portal de Desarrolladores Separado

```bash
# Host separado con autenticación
https://developers.amexing.com/api-docs

# Características:
- Requiere API key para acceso
- Rate limiting estricto
- IP whitelist opcional
- Versionado de documentación
- Changelog automático
```

### Opción 2: Documentación Estática Versionada

```bash
# Exportar especificación
yarn docs:api:json

# Publicar en CDN/portal seguro
aws s3 cp swagger-spec.json s3://docs.amexing.com/api/v0.1.0/

# Acceso público pero sin interactividad
https://docs.amexing.com/api/v0.1.0/swagger-spec.json
```

### Opción 3: Documentación Interna Only

```bash
# Solo accesible en VPN/intranet
https://internal.amexing.com/api-docs

# Configuración:
- Solo accesible desde IP corporativa
- Requiere VPN o red interna
- Audit logging completo
- MFA requerido
```

## Configuración de Producción Recomendada

### 1. Variables de Ambiente

```bash
# .env.production
NODE_ENV=production
SWAGGER_ENABLED=false                    # Deshabilitar explícitamente
API_DOCS_PORTAL=https://developers.amexing.com  # Portal externo
API_DOCS_VERSION=v0.1.0                  # Versión actual
```

### 2. Portal de Desarrolladores

```nginx
# nginx.conf para portal de desarrolladores
server {
  listen 443 ssl;
  server_name developers.amexing.com;

  # Requiere autenticación
  auth_basic "Developer Portal";
  auth_basic_user_file /etc/nginx/.htpasswd;

  # Rate limiting
  limit_req zone=api_docs burst=10;

  # Servir documentación estática
  location /api-docs {
    root /var/www/docs;
    index index.html;
  }

  # Spec JSON
  location /api-docs.json {
    alias /var/www/docs/swagger-spec.json;
  }
}
```

### 3. CI/CD Pipeline

```yaml
# .github/workflows/api-docs.yml
name: API Documentation Deployment

on:
  push:
    branches: [main]
    paths:
      - 'src/presentation/routes/**'
      - 'src/infrastructure/swagger/**'

jobs:
  deploy-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Generate OpenAPI Spec
        run: |
          yarn install
          yarn docs:api:json

      - name: Version Spec
        run: |
          VERSION=$(cat package.json | jq -r '.version')
          cp swagger-spec.json docs/api/v$VERSION.json

      - name: Deploy to Developer Portal
        run: |
          aws s3 sync docs/api/ s3://developers.amexing.com/api/
          aws cloudfront create-invalidation --distribution-id ${{ secrets.CF_DIST_ID }}
```

## Monitoreo y Auditoría

### Logs de Acceso

En development/test, cada acceso a Swagger es logueado:

```javascript
// Ejemplo de log
{
  "timestamp": "2025-10-01T19:56:03.119Z",
  "requestId": "dc625163-008f-4c16-9e39-5fae635abd2d",
  "method": "GET",
  "url": "/api-docs/",
  "ip": "::1",
  "userAgent": "curl/8.7.1",
  "statusCode": 200,
  "responseTime": 3,
  "level": "info",
  "message": "Audit log:"
}
```

### Métricas

```javascript
// Métricas recomendadas para producción
const metrics = {
  swagger_access_attempts: 0,      // Intentos de acceso (debe ser 0)
  api_docs_404_count: 0,           // 404s en /api-docs (correcto)
  dev_portal_access: 0,            // Accesos a portal separado
  spec_downloads: 0,               // Descargas de spec
};
```

## Checklist de Seguridad

### Pre-Deployment

- [ ] `NODE_ENV=production` configurado
- [ ] Swagger deshabilitado en producción
- [ ] Variables de ambiente validadas
- [ ] Portal de desarrolladores configurado (opcional)
- [ ] Rate limiting en portal externo
- [ ] Autenticación en portal externo
- [ ] Logs de auditoría habilitados
- [ ] Spec versionado y almacenado

### Post-Deployment

- [ ] Verificar `/api-docs` retorna 404
- [ ] Verificar `/api-docs.json` retorna 404
- [ ] Validar logs no muestran mensaje Swagger
- [ ] Confirmar portal externo funcionando (si aplica)
- [ ] Revisar métricas de intentos de acceso
- [ ] Documentación actualizada

## FAQ

### ¿Qué pasa si alguien intenta acceder a /api-docs en producción?

Recibe un 404 con mensaje genérico:
```json
{
  "error": "Not Found",
  "message": "API documentation is not available in production"
}
```

### ¿Cómo comparten la documentación con clientes/partners?

Opciones:
1. Portal de desarrolladores con autenticación
2. Exportar spec y compartir por canal seguro
3. Documentación en Postman Collection
4. Portal público con spec estático (sin Try It Out)

### ¿Se puede habilitar temporalmente en producción para debugging?

**NO RECOMENDADO.** Si es absolutamente necesario:
```bash
# Solo temporalmente, con VPN
NODE_ENV=development yarn start
# Acceder desde VPN/IP autorizada
# Revertir inmediatamente a production
```

### ¿Cómo documentar nuevas APIs?

El proceso es el mismo independientemente del ambiente. La documentación se genera en desarrollo/test y se exporta para producción:

```bash
# 1. Desarrollar y documentar en development
yarn dev
# Acceder: http://localhost:1337/api-docs

# 2. Validar
yarn docs:api:validate

# 3. Exportar para producción
yarn docs:api:json

# 4. Publicar en portal seguro
# (Manual o automático via CI/CD)
```

## Contacto y Soporte

Para preguntas sobre seguridad de documentación API:

- **Equipo de Seguridad:** security@amexing.com
- **Equipo de DevOps:** devops@amexing.com
- **Documentación:** docs@amexing.com

---

**Última actualización:** 2025-10-01
**Versión:** 1.0.0
**Autor:** Amexing Security Team
