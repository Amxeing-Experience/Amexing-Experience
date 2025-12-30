# Guía Post Git Pull

**¿Acabas de hacer `git pull` y algo no funciona?** Esta guía te ayudará a resolver los problemas más comunes después de actualizar tu código.

## 📋 Tabla de Contenidos

- [Flujo Rápido (4 pasos)](#flujo-rápido-4-pasos)
- [Casos Críticos Recientes](#-casos-críticos-recientes)
- [Problemas Comunes y Soluciones](#-problemas-comunes-y-soluciones)
- [Comandos de Troubleshooting](#-comandos-de-troubleshooting)

## Flujo Rápido (4 Pasos)

### 1. Verificar si necesitas actualizar dependencias

```bash
yarn deps:update-check
```

**Qué hace**: Compara `package.json` y `yarn.lock` con la última versión en Git para detectar cambios en dependencias.

**Resultado**:
- ✅ Sin cambios → Puedes continuar
- ⚠️ Cambios detectados → Ejecuta `yarn install`

### 2. Actualizar dependencias (si es necesario)

```bash
yarn install
```

**Cuándo ejecutar**:
- ✅ Cambios en `package.json` detectados
- ✅ Cambios en `yarn.lock` detectados
- ✅ Nuevas dependencias agregadas
- ✅ Versiones de dependencias actualizadas

### 3. Ejecutar setup completo (si hay cambios críticos)

```bash
yarn after-pull
```

**Qué hace**: Ejecuta automáticamente:
1. `yarn install` - Actualiza dependencias
2. `yarn hooks:install` - Reinstala git hooks
3. `yarn security:all` - Audit de seguridad
4. `yarn test` - Ejecuta tests completos

**Cuándo ejecutar**:
- ✅ Cambios en Parse Server version
- ✅ Cambios en Node.js version requerida
- ✅ Nuevas yarn resolutions de seguridad
- ✅ Cambios en git hooks
- ✅ Actualizaciones de configuración
- ✅ Cambios en scripts de npm

**Tiempo estimado**: 2-3 minutos

### 4. Verificar que todo funciona

```bash
yarn dev
```

**Verificar**:
- ✅ Servidor inicia correctamente en puerto 1337
- ✅ No hay errores en consola
- ✅ Puedes acceder a http://localhost:1337
- ✅ Health endpoint responde: http://localhost:1337/health

## 🚨 Casos Críticos Recientes

### Parse Server 8.4.0-alpha.2

**Problema**: Parse Server 8.4.0 requiere Node.js 20+

**Síntomas**:
```
Error: Parse Server requires Node.js version 20 or higher
Current version: v18.x.x
```

**Solución**:
```bash
# 1. Verificar versión de Node.js
node --version

# 2. Si es menor a 20, actualizar con nvm
nvm install 20
nvm use 20

# 3. Reinstalar dependencias
yarn install

# 4. Verificar
yarn dev
```

**Breaking Changes**:
- Nueva API de cloud functions
- Cambios en manejo de sesiones
- Mejoras en seguridad de queries

**Más info**: Ver [CHANGELOG.md](../CHANGELOG.md) sección v0.5.0

### Node.js 20+ (Requerido)

**Cambio**: Ya no soportamos Node.js 18

**Verificar versión**:
```bash
node --version  # Debe ser v20.0.0 o superior
```

**Actualizar Node.js**:

**Con nvm (recomendado)**:
```bash
# Instalar nvm si no lo tienes
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Instalar Node 20
nvm install 20

# Usar Node 20
nvm use 20

# Hacer Node 20 default
nvm alias default 20
```

**Sin nvm**:
- Descargar desde: https://nodejs.org/ (LTS version 20.x)
- Seguir instrucciones de instalación

**Características nuevas**:
- `--experimental-vm-modules` (ya configurado en scripts)
- Mejor performance de V8
- Soporte nativo para Web Streams

### Express.js 5.1.0 (Breaking Change)

**Cambio Mayor**: De Express 4.x a 5.x

**Breaking Changes principales**:
1. **Async error handling** automático
   ```javascript
   // Antes (Express 4)
   app.get('/route', async (req, res, next) => {
     try {
       const data = await getData();
       res.json(data);
     } catch (err) {
       next(err);  // Requerido
     }
   });

   // Ahora (Express 5)
   app.get('/route', async (req, res) => {
     const data = await getData();  // Errors auto-caught
     res.json(data);
   });
   ```

2. **Promesas en middleware** se manejan automáticamente
3. **req.xhr, req.protocol** behavior changes
4. **Path matching** más estricto

**Migración completa**: [Express 5 Migration Guide](https://expressjs.com/en/guide/migrating-5.html)

**Verificar tu código**:
```bash
# Buscar async/await sin try-catch
grep -r "async.*req.*res" src/application/controllers/

# Ejecutar tests
yarn test
```

### MongoDB 6.3.0

**Sin breaking changes** en esta versión

**Verificar conexión**:
```bash
# En .env.development, asegurar:
DATABASE_URI=mongodb://localhost:27017/AmexingDEV
# O tu MongoDB Atlas URI
```

### Yarn Resolutions (Seguridad)

**Qué son**: Forzamos versiones específicas de dependencias por seguridad

**En package.json**:
```json
"resolutions": {
  "body-parser": ">=1.20.3",
  "undici": ">=5.19.1",
  "crypto-js": ">=4.2.0",
  ...
}
```

**Si hay nuevas resolutions**:
```bash
# Limpiar y reinstalar
yarn cache clean
yarn install
```

## 🔧 Problemas Comunes y Soluciones

### Problema 1: Errores de Parse Server

**Síntomas**:
```
Error: Cannot connect to Parse Server
Error: Invalid Parse App ID
Error: Parse Server not initialized
```

**Soluciones**:

```bash
# 1. Verificar configuración en .env.development
cat environments/.env.development | grep PARSE

# Debe contener:
# PARSE_APP_ID=your_app_id
# PARSE_MASTER_KEY=your_master_key
# PARSE_SERVER_URL=http://localhost:1337/parse

# 2. Verificar MongoDB está corriendo
# Si usas MongoDB local:
brew services list | grep mongodb
# O
sudo systemctl status mongod

# 3. Reiniciar servidor
yarn dev
```

### Problema 2: Git Hooks No Funcionan

**Síntomas**:
- Pre-commit no ejecuta lint
- Pre-push no ejecuta tests
- Commits se hacen sin validaciones

**Soluciones**:

```bash
# 1. Reparar hooks
yarn hooks:repair

# O con más detalle:
yarn hooks:install --force

# 2. Validar instalación
yarn hooks:validate

# Debe mostrar:
# ✓ Pre-commit hook installed
# ✓ Pre-push hook installed
# ✓ Commit-msg hook installed

# 3. Verificar permisos
ls -la .git/hooks/

# Deben ser ejecutables (-rwxr-xr-x)
# Si no lo son:
chmod +x .git/hooks/*

# 4. Test manual
yarn hooks:test
```

### Problema 3: Tests Fallando

**Síntomas**:
```
FAIL tests/integration/...
Error: Cannot find module
Error: Timeout
```

**Soluciones**:

```bash
# 1. Limpiar caché de Jest
yarn cache clean

# 2. Reinstalar node_modules
rm -rf node_modules
yarn install

# 3. Verificar MongoDB Memory Server
yarn test:unit  # Solo unit tests (sin DB)

# Si unit tests pasan pero integration fallan:
yarn test:integration --verbose

# 4. Verificar puerto 1339 (MongoDB Memory Server)
lsof -i :1339

# Si está ocupado, matar proceso:
kill -9 <PID>

# 5. Tests específicos para debugging
yarn test tests/integration/application.startup.test.js
```

### Problema 4: Dependencias Conflictivas

**Síntomas**:
```
error Found incompatible module
warning Pattern ["dependency@version"] is trying to unpack...
```

**Soluciones**:

```bash
# 1. Limpiar completamente
yarn cache clean
rm -rf node_modules
rm yarn.lock

# 2. Reinstalar desde cero
yarn install

# 3. Si persiste, verificar resolutions
cat package.json | grep -A 20 "resolutions"

# 4. Actualización completa
yarn deps:full-update
```

### Problema 5: Puerto 1337 Ocupado

**Síntomas**:
```
Error: listen EADDRINUSE: address already in use :::1337
```

**Soluciones**:

```bash
# 1. Ver qué proceso usa el puerto
lsof -i :1337

# Resultado muestra PID del proceso

# 2. Matar proceso
kill -9 <PID>

# O matar todos los procesos node
pkill -9 node

# 3. Reiniciar
yarn dev

# Alternativa: Usar puerto diferente
PORT=3000 yarn dev
```

### Problema 6: ESLint Errores Después de Pull

**Síntomas**:
```
error  Parsing error: Unexpected token
error  'variable' is not defined
```

**Soluciones**:

```bash
# 1. Auto-fix lo que se pueda
yarn lint:fix

# 2. Verificar configuración ESLint
cat .config/eslint/eslintrc.js

# 3. Si hay nuevas reglas, revisar qué cambió
git diff HEAD~1 .config/eslint/

# 4. Format código
yarn format

# 5. Verificar manualmente errores restantes
yarn lint
```

### Problema 7: Variables de Entorno Missing

**Síntomas**:
```
Error: Missing required environment variable: PARSE_APP_ID
Configuration error: DATABASE_URI is undefined
```

**Soluciones**:

```bash
# 1. Comparar con example
diff environments/.env.development environments/.env.example

# 2. Verificar qué falta
cat environments/.env.development

# 3. Agregar variables faltantes
# Editar environments/.env.development
# Copiar variables de .env.example

# 4. Verificar formato (sin espacios extra)
# Correcto:
PARSE_APP_ID=myappid

# Incorrecto:
PARSE_APP_ID = myappid  # ❌ Espacios
```

## 🔍 Comandos de Troubleshooting

### Verificación Rápida del Sistema

```bash
# Estado general del proyecto
yarn scripts:help

# Verificar versiones
node --version  # Debe ser v20+
yarn --version  # Debe ser v1.22+

# Verificar dependencias
yarn deps:check

# Verificar outdated packages
yarn deps:outdated

# Verificar licencias de dependencias
yarn deps:licenses
```

### Diagnóstico de Hooks

```bash
# Validar hooks
yarn hooks:validate

# Test hooks sin hacer commit
yarn hooks:test

# Ver hooks instalados
ls -la .git/hooks/

# Ver contenido de hook
cat .git/hooks/pre-commit
```

### Diagnóstico de Tests

```bash
# Tests por categoría
yarn test:unit           # Solo unit tests
yarn test:integration    # Solo integration tests
yarn test:security       # Solo security tests

# Tests con más detalle
yarn test --verbose

# Tests de un archivo específico
yarn test tests/integration/auth.test.js

# Tests en watch mode (para debugging)
yarn test:watch
```

### Diagnóstico de Seguridad

```bash
# Audit completo
yarn security:all

# Solo audit de dependencias
yarn security:audit

# Solo análisis estático (Semgrep)
yarn security:semgrep

# Verificar vulnerabilidades específicas
yarn audit --level high
yarn audit --level moderate
```

### Logs y Debugging

```bash
# Ver logs de desarrollo
yarn dev

# Ver logs con debug habilitado
DEBUG=* yarn dev

# Ver logs de Parse Server específicamente
DEBUG=parse-server:* yarn dev

# Si usas PM2 en staging/prod
pm2 logs amexing-web
pm2 logs amexing-web --lines 100
pm2 logs amexing-web --err  # Solo errores
```

## ✅ Checklist de Verificación Post-Pull

Usa esta checklist para asegurar que todo está funcionando correctamente:

### Verificaciones Básicas

- [ ] `node --version` muestra v20.0.0 o superior
- [ ] `yarn --version` muestra 1.22.0 o superior
- [ ] `git status` está limpio (no hay cambios sin committear)
- [ ] `yarn deps:update-check` no muestra cambios pendientes

### Verificaciones de Configuración

- [ ] `environments/.env.development` existe y tiene todas las variables
- [ ] `git config --list` muestra tu email y nombre correctos
- [ ] `.git/hooks/pre-commit` existe y es ejecutable
- [ ] `.git/hooks/pre-push` existe y es ejecutable

### Verificaciones de Funcionalidad

- [ ] `yarn lint` pasa sin errores
- [ ] `yarn test:unit` pasa todos los tests
- [ ] `yarn test:integration` pasa todos los tests
- [ ] `yarn security:audit` no muestra vulnerabilidades críticas

### Verificaciones de Servidor

- [ ] `yarn dev` inicia sin errores
- [ ] http://localhost:1337 carga correctamente
- [ ] http://localhost:1337/health retorna status OK
- [ ] http://localhost:1337/api-docs carga Swagger UI

## 📚 Recursos Adicionales

### Documentación Relacionada

- [CONTRIBUTING.md](../CONTRIBUTING.md) - Guía completa de contribución
- [Troubleshooting Guide](readme/TROUBLESHOOTING.md) - Solución de problemas generales
- [Development Guide](readme/DEVELOPMENT.md) - Workflow de desarrollo
- [Environment Setup](readme/ENVIRONMENT.md) - Configuración de ambientes

### Comandos Útiles

```bash
# Ayuda interactiva
yarn scripts:help

# Buscar comando específico
yarn scripts:help --search "test"

# Ver todos los scripts disponibles
cat package.json | grep "\".*\":" | grep -v "//"
```

### Cuando Nada Funciona

**Último recurso - Fresh Install**:

```bash
# 1. Guardar cambios locales
git stash

# 2. Limpiar completamente
rm -rf node_modules
rm yarn.lock
yarn cache clean

# 3. Reinstalar desde cero
yarn install

# 4. Reinstalar hooks
yarn hooks:install --force

# 5. Verificar todo
yarn test
yarn security:all

# 6. Restaurar cambios
git stash pop

# 7. Reiniciar
yarn dev
```

**Si TODAVÍA no funciona**:
1. Verificar que estás en la rama correcta: `git branch`
2. Verificar que no hay cambios sin committear: `git status`
3. Crear issue en GitHub con:
   - Comando exacto que falla
   - Error completo (stack trace)
   - Output de `node --version`, `yarn --version`
   - Output de `git log -1 --oneline`

## 🆘 Soporte

### Antes de Pedir Ayuda

1. ✅ Ejecuta `yarn after-pull`
2. ✅ Consulta esta guía
3. ✅ Revisa [Troubleshooting Guide](readme/TROUBLESHOOTING.md)
4. ✅ Busca en issues cerrados de GitHub

### Crear Issue

Si nada funciona, crea un issue con este template:

```markdown
**Problema**
Descripción clara del problema

**Comando que falla**
yarn dev

**Error completo**
(Pegar stack trace completo)

**Contexto**
- Node version: (node --version)
- Yarn version: (yarn --version)
- OS: macOS/Linux/Windows
- Rama: (git branch --show-current)
- Último commit: (git log -1 --oneline)

**Ya intenté**
- [ ] yarn after-pull
- [ ] yarn cache clean && yarn install
- [ ] yarn hooks:install --force
- [ ] Consulté POST_PULL_GUIDE.md
```

---

**Última actualización**: 2025-12-29
**Versión**: 1.0.0
**Mantenedores**: AmexingWeb Team

💡 **Tip**: Agrega esta guía a tus bookmarks para acceso rápido después de cada `git pull`
