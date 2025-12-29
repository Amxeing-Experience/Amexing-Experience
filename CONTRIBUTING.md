# Guía de Contribución AmexingWeb

Bienvenido a AmexingWeb. Esta guía te ayudará a entender cómo contribuir al proyecto siguiendo nuestro flujo de trabajo, estándares de calidad y proceso de despliegue.

## 🚀 Inicio Rápido (3 Pasos)

```bash
# 1. Clonar e instalar
git clone <your-repo-url>
cd amexing-web
yarn install

# 2. Configurar ambiente
cp environments/.env.example environments/.env.development
# Editar .env.development con tus credenciales

# 3. Iniciar desarrollo
yarn dev  # http://localhost:1337
```

### ⚠️ Troubleshooting: Si páginas no cargan CSS/JS

**Problema común**: Después de clonar, las páginas cargan pero sin estilos (CSS) o JavaScript.

**Causa**: Los archivos estáticos de `public/` pueden estar faltando si fueron ignorados por `.gitignore`.

**Solución rápida**:
```bash
# Verificar que existan los assets
ls -la public/flexy-bootstrap-lite-1.0.0/
ls -la public/css/
ls -la public/js/

# Si faltan, copiar desde otro ambiente o contactar al equipo
```

**Primera vez?** Lee la sección de [Gitflow Strategy](#-gitflow-strategy) para entender el flujo de ramas.

## 📋 Gitflow Strategy

### Ramas Principales

AmexingWeb usa una estrategia de 3 ramas:

| Rama | Propósito | Deploy | Protección |
|------|-----------|--------|------------|
| **main** | Producción estable (tags: v0.5.0, v0.6.0) | Manual a producción | ✅ Protegida |
| **development** | Desarrollo activo (transitoria) | Local (sin servidor dedicado) | ⚠️ Validaciones CI |
| **release-x.y.z** | Candidato a producción | Manual a staging | ⚠️ Validaciones CI |

### Diagrama Visual del Flujo

```
main (producción) ──v0.5.0─────────────────v0.6.0──►
                     ↑                       ↑
                     │ merge PR              │ merge PR
                     │                       │
release-0.5.0 ───────┘      release-0.6.0 ──┘
(staging)                   (staging)
     ↑                           ↑
     │ git checkout -b           │ git checkout -b
     │                           │
development ─────┴───feature/x───┴───feature/y──►
(transitoria)        (PR)            (PR)
```

**Nota importante**: `development` es una rama transitoria ya que no tenemos servidor de desarrollo dedicado todavía. Se usa como punto de integración antes de crear releases.

## 🔄 Flujo de Trabajo Completo

### 1. Desarrollo de Feature

**Objetivo**: Agregar nueva funcionalidad o fix

```bash
# Asegurar que tienes la última versión de development
git checkout development
git pull origin development

# Crear rama de feature
git checkout -b feature/mi-nueva-funcionalidad

# Desarrollar siguiendo TDD (Test-Driven Development)
# 1. Escribir tests
# 2. Implementar código
# 3. Refactorizar

# Commit siguiendo conventional commits
git add .
git commit -m "feat(scope): descripción corta de la funcionalidad"

# Push a origin
git push origin feature/mi-nueva-funcionalidad
```

**Crear Pull Request**:
1. Ir a GitHub
2. Crear PR desde `feature/mi-nueva-funcionalidad` → `development`
3. Completar template de PR
4. Esperar validaciones CI/CD (lint, tests, security)
5. Code review
6. Merge (squash and merge recomendado)

### 2. Crear Release (Preparar para Staging)

**Cuándo**: Cuando `development` tiene un conjunto estable de features listas para testing

**Quién**: Tech Lead o Release Manager

```bash
# Paso 1: Asegurar development está estable
git checkout development
git pull origin development

# Verificar que todo funciona
yarn test
yarn security:all
yarn quality:all

# Paso 2: Crear rama de release
# Convención: release-MAJOR.MINOR.PATCH
git checkout -b release-0.6.0

# Paso 3: Actualizar versión en package.json
# Editar manualmente "version": "0.6.0"

# Paso 4: Generar CHANGELOG
yarn changelog:generate

# Paso 5: Commit de preparación
git add .
git commit -m "chore(release): prepare v0.6.0

- Update version to 0.6.0
- Generate CHANGELOG for release
- Ready for staging deployment"

# Paso 6: Push release branch
git push origin release-0.6.0
```

**Paso 7: Deploy Manual a Staging**

Ver [Deployment Guide](docs/readme/DEPLOYMENT.md#deploy-a-staging) para pasos detallados.

Resumen:
```bash
# En servidor staging
ssh user@staging-server
cd /path/to/amexing-web
git fetch origin
git checkout release-0.6.0
git pull origin release-0.6.0
yarn install
yarn migrate  # Si hay migraciones
pm2 restart amexing-web
curl http://localhost:1338/health  # Verificar
```

**Testing en Staging**:
- ✅ Smoke tests manuales
- ✅ Validar funcionalidades nuevas
- ✅ Verificar migraciones de DB
- ✅ Performance testing
- ✅ Aprobación de QA

### 3. Deploy a Producción

**Cuándo**: Después de testing exitoso en staging

**Pre-requisitos**:
- ✅ Staging testing completo sin issues críticos
- ✅ Aprobación de QA y Product Owner
- ✅ CHANGELOG actualizado

**Pasos**:

```bash
# Paso 1: Crear Pull Request
# GitHub: release-0.6.0 → main
# Título: "Release v0.6.0"
# Completar template con cambios y testing realizado

# Paso 2: Code Review y Aprobación
# - Al menos 1 aprobación requerida
# - CI/CD debe pasar

# Paso 3: Merge PR
# Usar "Create a merge commit" (NO squash)

# Paso 4: Crear Tag
git checkout main
git pull origin main
git tag -a v0.6.0 -m "Release v0.6.0

Key features:
- Feature A
- Feature B
- Fix C

See CHANGELOG.md for details"

git push origin v0.6.0

# Paso 5: Deploy Manual a Producción
# Ver guía detallada en docs/readme/DEPLOYMENT.md
```

**Resumen deploy a producción**:
```bash
# En servidor producción
ssh user@production-server
cd /path/to/amexing-web
git fetch origin
git checkout main
git pull origin main
yarn install
yarn migrate:dry-run  # PREVIEW migraciones
yarn migrate          # Ejecutar
pm2 restart amexing-web
curl http://localhost:1337/health
pm2 logs amexing-web --lines 100
```

**Paso 6: Sincronizar development con main**

```bash
# Después de deploy exitoso a producción
git checkout development
git merge main  # Traer cambios de producción
git push origin development
```

## 🌍 Ambientes

| Ambiente | Rama Source | Puerto | Base de Datos | Método Deploy |
|----------|-------------|--------|---------------|---------------|
| **Development (Local)** | development | 1337 | AmexingDEV | `yarn dev` |
| **Staging** | release-x.y.z | 1338 | AmexingSTAGING | Manual (PM2) |
| **Production** | main (tagged) | 1337 | AmexingPROD | Manual (PM2) |

**Comandos por ambiente**:
```bash
# Development Local
yarn dev              # Puerto 1337, DB: AmexingDEV

# Production Local (testing)
yarn dev:prod         # Puerto 1338, DB: AmexingPROD

# Staging (en servidor)
yarn pm2:staging      # PM2 con config staging

# Production (en servidor)
yarn prod             # PM2 con config producción
```

## ✅ Checklist Pre-PR

### Obligatorio (Enforced por Git Hooks)

**Pre-commit** (automático al hacer `git commit`):
- ✅ Lint: `yarn lint` debe pasar
- ✅ Format: `yarn format:check` debe pasar
- ✅ Docs: `yarn docs:coverage` debe pasar
- ✅ Security scan: Semgrep static analysis

**Pre-push** (automático al hacer `git push`):
- ✅ Tests: `yarn test` debe pasar (20-30 segundos)
- ✅ Security: `yarn security:all` debe pasar
- ✅ No vulnerabilidades críticas

### Recomendado

- ✅ CHANGELOG actualizado (si es release)
- ✅ README actualizado (si cambia setup o comandos)
- ✅ Tests añadidos para nueva funcionalidad
- ✅ Documentación de API actualizada (si cambia API)
- ✅ Coverage mínimo 80% para nuevos features

### Verificación Manual

```bash
# Antes de crear PR, ejecutar:
yarn quality:all      # Lint + security + deps + docs
yarn test:coverage    # Generar reporte de coverage
yarn test:security    # PCI DSS validation
```

## 🛡️ Estándares de Calidad

### Test-Driven Development (TDD)

**OBLIGATORIO**: Seguir ciclo Red-Green-Refactor

```javascript
// 1. 🔴 RED - Escribir test que falla
describe('Nueva Feature', () => {
  it('should realizar acción esperada', async () => {
    const result = await nuevaFuncion();
    expect(result).toBe(valorEsperado);
  });
});

// 2. 🟢 GREEN - Implementar código mínimo para pasar
function nuevaFuncion() {
  return valorEsperado;
}

// 3. 🔵 REFACTOR - Mejorar código manteniendo tests verdes
function nuevaFuncion() {
  // Código limpio, SOLID, eficiente
  return calcularResultado();
}
```

**Tipos de tests**:
- **Unit Tests**: Funciones puras, utilidades (`tests/unit/`)
- **Integration Tests**: API endpoints, flujos completos (`tests/integration/`)
- **Security Tests**: PCI DSS compliance (`tests/integration/security/`)

```bash
yarn test:unit          # Rápido (sin DB)
yarn test:integration   # MongoDB Memory Server
yarn test:security      # PCI DSS validation
```

### Clean Architecture

**Estructura de capas**:
```
src/
├── presentation/      # EJS templates, routes, public assets
├── application/       # Controllers, middleware, validators
├── domain/           # Business logic, entities
└── infrastructure/   # DB, logging, external services
```

**Reglas**:
- ✅ Dependencies flow inward (presentation → application → domain)
- ✅ Domain layer NO conoce infraestructura
- ✅ Business logic en domain/
- ✅ Validaciones en application/
- ✅ UI en presentation/

### SOLID Principles

- **S**ingle Responsibility: Una clase, una razón para cambiar
- **O**pen/Closed: Abierto a extensión, cerrado a modificación
- **L**iskov Substitution: Subclases deben ser sustituibles
- **I**nterface Segregation: Interfaces específicas, no genéricas
- **D**ependency Inversion: Depender de abstracciones

### Security & Compliance

**PCI DSS Level 1 Compliance**:
- ✅ NUNCA loguear datos sensibles (passwords, tokens, tarjetas)
- ✅ Usar Winston para audit trails
- ✅ Input validation con Joi
- ✅ Output sanitization con xss-clean
- ✅ Rate limiting habilitado
- ✅ HTTPS en producción

```bash
# Validar compliance antes de commit
yarn test:security
yarn security:all
```

### Code Quality Standards

**ESLint + Prettier**:
```bash
yarn lint           # Check errores
yarn lint:fix       # Auto-fix errores
yarn format         # Format con Prettier
```

**Coverage Requirements**:
- Mínimo 80% para nuevos features
- Crítico: 100% para security/authentication
- Aceptable: 60-80% para UI components

```bash
yarn test:coverage  # Generar reporte
```

## 🎯 Conventional Commits

**Formato**: `<type>(<scope>): <description>`

### Types

| Type | Uso | Ejemplo |
|------|-----|---------|
| `feat` | Nueva funcionalidad | `feat(auth): agregar login con Apple` |
| `fix` | Corrección de bug | `fix(api): corregir validación de email` |
| `docs` | Cambios en documentación | `docs(readme): actualizar guía de instalación` |
| `style` | Formato (sin cambio lógico) | `style(controllers): format con prettier` |
| `refactor` | Refactorización | `refactor(services): aplicar SOLID principles` |
| `test` | Agregar/modificar tests | `test(auth): agregar test para login flow` |
| `chore` | Mantenimiento, deps, configs | `chore(deps): actualizar parse-server a 8.4.0` |
| `perf` | Mejoras de performance | `perf(api): optimizar query de usuarios` |
| `ci` | Cambios en CI/CD | `ci(github): agregar workflow de deploy` |

### Scopes Comunes

- `auth`: Authentication/authorization
- `api`: API endpoints
- `ui`: User interface
- `db`: Database/migrations
- `security`: Security features
- `deps`: Dependencies
- `config`: Configuration files

### Ejemplos Completos

```bash
# Feature con breaking change
git commit -m "feat(api): agregar endpoint de búsqueda avanzada

BREAKING CHANGE: el endpoint /api/search ahora requiere autenticación"

# Fix con issue reference
git commit -m "fix(auth): corregir expiración de tokens

Closes #123"

# Multiple scopes
git commit -m "chore(deps,security): actualizar dependencias vulnerables"
```

## 📚 Recursos

### Documentación del Proyecto
- **[CLAUDE.md](CLAUDE.md)** - Guía completa para desarrollo con Claude AI
- **[README.md](README.md)** - Visión general del proyecto
- **[CHANGELOG.md](CHANGELOG.md)** - Historial de cambios

### Guías Técnicas
- **[Development Guide](docs/readme/DEVELOPMENT.md)** - Workflow de desarrollo detallado
- **[Testing Guide](docs/readme/TESTING.md)** - Estrategias de testing y TDD
- **[Deployment Guide](docs/readme/DEPLOYMENT.md)** - Proceso de despliegue paso a paso
- **[Security Guide](docs/project/SECURITY.md)** - PCI DSS compliance y security best practices

### Referencias
- **[Gitflow Details](docs/GITFLOW.md)** - Detalles técnicos de gitflow
- **[Scripts Reference](docs/reference/SCRIPTS.md)** - 58 scripts documentados
- **[API Reference](docs/readme/API_REFERENCE.md)** - Endpoints y Swagger docs
- **[Environment Setup](docs/readme/ENVIRONMENT.md)** - Variables de entorno

### Troubleshooting
- **[Troubleshooting Guide](docs/readme/TROUBLESHOOTING.md)** - Solución de problemas comunes
- **[Post-Pull Guide](docs/POST_PULL_GUIDE.md)** - Qué hacer después de git pull

## 🔄 Comandos Comunes

### Desarrollo Local

```bash
# Servidores
yarn dev                    # Development (1337, AmexingDEV)
yarn dev:prod              # Production local (1338, AmexingPROD)

# Testing
yarn test                  # Tests completos
yarn test:watch            # Watch mode (TDD workflow)
yarn test:unit             # Solo unit tests (rápido)
yarn test:integration      # Solo integration tests
yarn test:security         # PCI DSS validation

# Quality
yarn lint                  # Check lint
yarn lint:fix              # Auto-fix lint errors
yarn format                # Format con Prettier
yarn quality:all           # Análisis completo
```

### Validación Pre-Release

```bash
# Ejecutar antes de crear release
yarn test                  # All tests
yarn test:coverage         # Check coverage
yarn security:all          # Security audit
yarn quality:all           # Quality analysis
yarn docs:coverage         # Documentation check
```

### Release Management

```bash
# Preparar release
yarn changelog:generate    # Generar CHANGELOG
yarn release:prepare      # Dry-run de release

# Después de deploy
yarn after-pull           # Setup post-pull completo
```

### Utilities

```bash
# Ayuda interactiva
yarn scripts:help              # Ver todos los scripts
yarn scripts:help security     # Scripts de seguridad
yarn scripts:help testing      # Scripts de testing

# Troubleshooting
yarn hooks:validate            # Check git hooks
yarn hooks:install --force     # Reparar hooks
yarn deps:update-check         # Check deps updates
```

## 🚨 ¿Problemas Comunes?

### Tests Fallando

```bash
# Limpiar y reinstalar
yarn cache clean
rm -rf node_modules
yarn install

# Verificar MongoDB Memory Server
yarn test:unit          # Si pasan, problema es con integration tests
yarn test:integration   # Verificar MongoDB Memory Server
```

### Git Hooks No Funcionan

```bash
# Reinstalar hooks
yarn hooks:install --force

# Validar instalación
yarn hooks:validate

# Verificar permisos
ls -la .git/hooks/
chmod +x .git/hooks/*
```

### Después de Git Pull

```bash
# Verificar cambios
yarn deps:update-check

# Si hay cambios en deps
yarn install

# Si hay cambios críticos (Parse, Node, etc.)
yarn after-pull
```

### Conflictos de Merge

```bash
# En feature branch
git checkout development
git pull origin development
git checkout feature/mi-feature
git merge development  # Resolver conflictos
git push origin feature/mi-feature
```

## 🤝 Code Review Guidelines

### Como Autor del PR

1. **Descripción clara**: Explicar QUÉ y POR QUÉ
2. **Screenshots**: Si afecta UI
3. **Testing**: Describir cómo probar
4. **Breaking changes**: Destacar si existen
5. **Self-review**: Revisar tu propio código primero

### Como Reviewer

1. **Funcionalidad**: ¿Cumple los requisitos?
2. **Tests**: ¿Tiene tests adecuados?
3. **Security**: ¿Introduce vulnerabilidades?
4. **Performance**: ¿Afecta negativamente?
5. **Code quality**: ¿Sigue SOLID y Clean Architecture?
6. **Documentation**: ¿Está documentado?

### Checklist de Review

- ✅ Tests pasan y coverage adecuado
- ✅ No hay console.log ni debugging code
- ✅ No hay hardcoded secrets o credentials
- ✅ Código sigue ESLint rules
- ✅ Documentación actualizada
- ✅ CHANGELOG actualizado (si aplica)
- ✅ No introduce deuda técnica
- ✅ Security checks pasan

## 📞 Soporte

### Canales de Comunicación

- **Issues**: Para bugs y feature requests
- **Pull Requests**: Para code reviews
- **Discussions**: Para preguntas generales

### Antes de Crear Issue

1. Buscar en issues existentes
2. Consultar [Troubleshooting Guide](docs/readme/TROUBLESHOOTING.md)
3. Verificar con `yarn after-pull`

### Template de Issue

```markdown
**Descripción del problema**
Descripción clara y concisa

**Pasos para reproducir**
1. Ir a '...'
2. Ejecutar '...'
3. Ver error

**Comportamiento esperado**
Qué debería pasar

**Screenshots**
Si aplica

**Ambiente**
- Node version:
- OS:
- Branch:
```

---

## ⚖️ Licencia

MIT License - ver [LICENSE](LICENSE) para detalles.

---

**Última actualización**: 2025-12-29
**Versión del proyecto**: 0.5.0
**Mantenedores**: AmexingWeb Team

¿Dudas? Consulta [CLAUDE.md](CLAUDE.md) para guía completa de desarrollo.
