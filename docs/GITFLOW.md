# Gitflow Strategy - AmexingWeb

Esta guía documenta la estrategia de ramas y flujo de trabajo de AmexingWeb en detalle técnico.

## Tabla de Contenidos

- [Estrategia de Ramas](#estrategia-de-ramas)
- [Convenciones de Naming](#convenciones-de-naming)
- [Merge Strategies](#merge-strategies)
- [Branch Protection Rules](#branch-protection-rules)
- [Workflows Detallados](#workflows-detallados)
- [Comandos Git Completos](#comandos-git-completos)
- [Casos Especiales](#casos-especiales)

## Estrategia de Ramas

### Ramas Permanentes

#### 1. `main` - Producción

**Propósito**: Código estable en producción

**Características**:
- Solo código probado en staging
- Cada merge tiene un tag de versión (v0.x.x)
- Protegida con branch protection rules
- Deploy manual a producción

**Reglas**:
- ✅ Requiere PR para merge
- ✅ Requiere 1+ aprobaciones
- ✅ Requiere CI/CD passing
- ❌ No permite push directo
- ❌ No permite force push
- ❌ No permite eliminación

**Tags en main**:
```bash
# Listar tags
git tag -l

# Ver tag específico
git show v0.5.0

# Checkout a tag
git checkout v0.5.0
```

#### 2. `development` - Desarrollo Activo

**Propósito**: Rama de integración para desarrollo activo

**Características**:
- Punto de partida para feature branches
- Rama transitoria (sin servidor dedicado aún)
- Validaciones CI/CD obligatorias
- Base para release branches

**Reglas**:
- ✅ Requiere CI/CD passing
- ✅ Permite force push (solo admins)
- ✅ Permite merge commits
- ⚠️ No permite push directo de features (usar PR)

**Estado actual**:
- No hay servidor de development dedicado
- Se usa localmente con `yarn dev`
- Es transitoria hasta crear release

### Ramas Temporales

#### 3. Release Branches (`release-x.y.z`)

**Propósito**: Candidato a producción para testing en staging

**Lifecycle**:
```
Created from: development (cuando está estable)
         ↓
Deploy to: staging (manual)
         ↓
Testing: QA, smoke tests, integration tests
         ↓
PR to: main (después de aprobación)
         ↓
Merge: main recibe el merge
         ↓
Tag: v0.x.x se crea en main
         ↓
Delete: release branch se puede eliminar (opcional)
```

**Naming**: `release-MAJOR.MINOR.PATCH`

Ejemplos:
- `release-0.5.0` - Versión minor
- `release-0.5.1` - Versión patch
- `release-1.0.0` - Versión major

**Creación**:
```bash
# Desde development estable
git checkout development
git pull origin development

# Verificar estabilidad
yarn test && yarn security:all

# Crear release
git checkout -b release-0.6.0

# Actualizar package.json version
# Generar CHANGELOG
yarn changelog:generate

# Commit
git add .
git commit -m "chore(release): prepare v0.6.0"

# Push
git push origin release-0.6.0
```

#### 4. Feature Branches (`feature/*`)

**Propósito**: Desarrollar nuevas funcionalidades

**Lifecycle**:
```
Created from: development
         ↓
Development: TDD workflow (test → code → refactor)
         ↓
PR to: development
         ↓
Review: Code review + CI/CD
         ↓
Merge: Squash and merge (recomendado)
         ↓
Delete: Feature branch eliminada
```

**Naming**: `feature/descripcion-corta`

Ejemplos:
- `feature/apple-login`
- `feature/user-dashboard`
- `feature/payment-integration`

**Creación**:
```bash
# Desde development
git checkout development
git pull origin development

# Crear feature
git checkout -b feature/mi-funcionalidad

# Desarrollo (TDD)
# ... hacer cambios ...

# Commit (conventional commits)
git add .
git commit -m "feat(scope): agregar funcionalidad X"

# Push
git push origin feature/mi-funcionalidad

# Crear PR en GitHub: feature/mi-funcionalidad → development
```

#### 5. Fix Branches (`fix/*`)

**Propósito**: Corregir bugs no urgentes

**Similar a feature branches**:
- Created from: `development`
- Merge to: `development`
- Naming: `fix/descripcion-bug`

Ejemplos:
- `fix/login-validation`
- `fix/email-formatting`
- `fix/api-error-handling`

```bash
git checkout development
git checkout -b fix/corregir-validacion
# ... fix ...
git commit -m "fix(auth): corregir validación de email"
```

#### 6. Hotfix Branches (`hotfix/*`)

**Propósito**: Correcciones urgentes en producción

**Lifecycle**:
```
Created from: main (tag actual)
         ↓
Fix: Corrección urgente
         ↓
PR to: main (prioritario)
         ↓
Merge: main recibe el hotfix
         ↓
Tag: vX.Y.Z+1 (patch version bump)
         ↓
Backport: Merge también a development
         ↓
Delete: Hotfix branch eliminada
```

**Naming**: `hotfix/descripcion-urgente`

Ejemplos:
- `hotfix/security-vulnerability`
- `hotfix/payment-processing`
- `hotfix/data-corruption`

**Creación**:
```bash
# Desde main
git checkout main
git pull origin main

# Crear hotfix
git checkout -b hotfix/security-fix

# Fix urgente
# ... corregir ...

# Commit
git commit -m "fix(security): corregir vulnerabilidad crítica

CVE-2024-XXXXX: descripción del problema
Solución aplicada: ...
Tested: ..."

# Push
git push origin hotfix/security-fix

# PR a main (URGENTE)
# Después de merge, tag: v0.5.1

# Backport a development
git checkout development
git merge main
git push origin development
```

## Convenciones de Naming

### Branch Names

**Formato**: `<type>/<descripcion-corta>`

| Type | Uso | Ejemplo |
|------|-----|---------|
| `feature/` | Nueva funcionalidad | `feature/apple-login` |
| `fix/` | Corrección de bug | `fix/email-validation` |
| `hotfix/` | Corrección urgente en prod | `hotfix/payment-error` |
| `refactor/` | Refactorización | `refactor/auth-service` |
| `docs/` | Documentación | `docs/api-reference` |
| `test/` | Agregar/mejorar tests | `test/integration-auth` |
| `chore/` | Mantenimiento | `chore/update-dependencies` |
| `release/` | Release candidate | `release-0.6.0` |

**Reglas de naming**:
- ✅ Minúsculas
- ✅ Guiones para separar palabras
- ✅ Descriptivo pero conciso
- ✅ Sin caracteres especiales (excepto `/` y `-`)
- ❌ No usar espacios
- ❌ No usar underscores `_`
- ❌ No usar números al inicio

**Ejemplos buenos**:
```
feature/user-profile-page
fix/cors-headers-error
hotfix/database-connection
refactor/clean-architecture
```

**Ejemplos malos**:
```
Feature/User_Profile  ❌ (mayúscula, underscore)
fix/bug               ❌ (muy genérico)
123-feature           ❌ (empieza con número)
feature/fix bug       ❌ (espacio)
```

### Commit Messages

**Formato**: `<type>(<scope>): <description>`

Ver [Conventional Commits](https://www.conventionalcommits.org/)

**Ejemplos**:
```bash
feat(auth): agregar login con Apple
fix(api): corregir validación de email
docs(readme): actualizar guía de instalación
style(controllers): format con prettier
refactor(services): aplicar SOLID principles
test(auth): agregar test para login flow
chore(deps): actualizar parse-server a 8.4.0
perf(api): optimizar query de usuarios
ci(github): agregar workflow de deploy
```

**Breaking Changes**:
```bash
git commit -m "feat(api): cambiar estructura de respuesta

BREAKING CHANGE: El endpoint /api/users ahora retorna { data: [], meta: {} }
en lugar de array directo. Actualizar clientes para usar response.data"
```

### Tag Names

**Formato**: `vMAJOR.MINOR.PATCH`

Siguiendo [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0): Breaking changes, incompatibilidades
- **MINOR** (0.1.0): Nuevas features, compatible hacia atrás
- **PATCH** (0.0.1): Bug fixes, compatible hacia atrás

**Ejemplos**:
```bash
v0.5.0  # Versión minor
v0.5.1  # Versión patch (hotfix)
v1.0.0  # Versión major (breaking changes)
```

**Crear tags**:
```bash
# Tag annotated (recomendado para releases)
git tag -a v0.6.0 -m "Release v0.6.0

Features:
- Apple login integration
- User dashboard
- Payment processing

Fixes:
- Email validation
- CORS headers

Breaking Changes:
- API response format changed"

# Push tag
git push origin v0.6.0

# Listar tags
git tag -l

# Ver detalles de tag
git show v0.6.0

# Checkout a tag
git checkout v0.6.0
```

## Merge Strategies

### Feature → Development: Squash and Merge

**Por qué**: Mantiene historial limpio en development

**Cómo funciona**:
- Todos los commits del feature se combinan en uno
- El commit resultante tiene mensaje descriptivo
- Historial de development es lineal y fácil de seguir

**Ejemplo**:
```bash
# Feature branch tiene:
commit 3: test: agregar tests para login
commit 2: refactor: mejorar validación
commit 1: feat: agregar login con Apple

# Después de squash merge en development:
commit: feat(auth): agregar login con Apple (#123)
```

**En GitHub**: Usar botón "Squash and merge"

**Localmente**:
```bash
git checkout development
git merge --squash feature/apple-login
git commit -m "feat(auth): agregar login con Apple"
```

### Release → Main: Merge Commit

**Por qué**: Preserva historial completo de release

**Cómo funciona**:
- Crea merge commit que une histories
- Facilita rollback si es necesario
- Mantiene trazabilidad de qué entró en cada release

**Ejemplo**:
```bash
# Release branch tiene historial completo
# Main recibe merge commit:
commit: Merge branch 'release-0.6.0' into main
```

**En GitHub**: Usar botón "Create a merge commit"

**Localmente**:
```bash
git checkout main
git merge --no-ff release-0.6.0
git tag -a v0.6.0 -m "Release v0.6.0"
```

### Hotfix → Main y Development: Merge Commit

**Por qué**: Urgente, necesita estar en ambas ramas

**Proceso**:
```bash
# 1. Merge a main
git checkout main
git merge --no-ff hotfix/security-fix
git tag -a v0.5.1 -m "Hotfix v0.5.1: security vulnerability"
git push origin main --tags

# 2. Merge a development
git checkout development
git merge main  # Trae el hotfix
git push origin development
```

## Branch Protection Rules

### Configuración en GitHub

#### Main Branch

```yaml
Branch protection rules:
  - Require pull request before merging: ✅
  - Require approvals: 1 minimum
  - Dismiss stale pull request approvals: ✅
  - Require review from Code Owners: ⚠️ (opcional)
  - Require status checks to pass: ✅
    - lint-and-test
    - security-scan
    - pr-validation
  - Require branches to be up to date: ✅
  - Require conversation resolution: ✅
  - Require signed commits: ⚠️ (recomendado)
  - Include administrators: ✅
  - Restrict who can push: ⚠️ (solo release managers)
  - Allow force pushes: ❌
  - Allow deletions: ❌
```

#### Development Branch

```yaml
Branch protection rules:
  - Require pull request before merging: ✅
  - Require approvals: ⚠️ (opcional, 1 mínimo)
  - Require status checks to pass: ✅
    - lint-and-test
    - security-scan
  - Require branches to be up to date: ⚠️ (opcional)
  - Allow force pushes: ✅ (solo admins)
  - Allow deletions: ❌
```

#### Release Branches

```yaml
Branch protection rules:
  - Require status checks to pass: ✅
  - Allow force pushes: ❌ (después de QA)
  - Allow deletions: ✅ (después de merge a main)
```

### Local Git Hooks

**Pre-commit** (`.git/hooks/pre-commit`):
```bash
#!/bin/sh
yarn lint
yarn format:check
yarn docs:coverage
yarn security:semgrep
```

**Pre-push** (`.git/hooks/pre-push`):
```bash
#!/bin/sh
yarn test
yarn security:all
```

Instalación:
```bash
yarn hooks:install
```

## Workflows Detallados

### Workflow 1: Desarrollo Normal de Feature

```bash
# 1. Actualizar development
git checkout development
git pull origin development

# 2. Crear feature branch
git checkout -b feature/nueva-funcionalidad

# 3. TDD: Write tests first
# Crear test en tests/integration/

# 4. Implement feature
# Crear código en src/

# 5. Refactor
# Mejorar código manteniendo tests verdes

# 6. Commit (pueden ser múltiples)
git add .
git commit -m "feat(scope): agregar funcionalidad X"

# 7. Push
git push origin feature/nueva-funcionalidad

# 8. Create PR en GitHub
# Base: development
# Compare: feature/nueva-funcionalidad

# 9. Code Review
# - CI/CD pasa
# - 1+ aprobación

# 10. Squash and Merge
# En GitHub UI

# 11. Delete feature branch
# Automático en GitHub o manual:
git branch -d feature/nueva-funcionalidad
```

### Workflow 2: Crear Release

```bash
# 1. Verificar development está estable
git checkout development
git pull origin development
yarn test && yarn security:all && yarn quality:all

# 2. Crear release branch
# Versión: MAJOR.MINOR.PATCH (ej: 0.6.0)
git checkout -b release-0.6.0

# 3. Actualizar package.json
# Cambiar "version": "0.6.0"

# 4. Generar CHANGELOG
yarn changelog:generate
# Revisar y editar CHANGELOG.md si es necesario

# 5. Commit preparación
git add package.json CHANGELOG.md
git commit -m "chore(release): prepare v0.6.0

- Update version to 0.6.0
- Generate CHANGELOG
- Ready for staging deployment"

# 6. Push release branch
git push origin release-0.6.0

# 7. Deploy a STAGING (manual)
# En servidor staging:
ssh user@staging
cd /path/to/amexing-web
git fetch origin
git checkout release-0.6.0
git pull origin release-0.6.0
yarn install
yarn migrate
pm2 restart amexing-web

# 8. Testing en staging
# - Smoke tests
# - Integration tests
# - Performance tests
# - QA approval

# 9. Create PR to main
# Base: main
# Compare: release-0.6.0
# Title: "Release v0.6.0"

# 10. Code review y merge
# En GitHub: Create a merge commit

# 11. Tag en main
git checkout main
git pull origin main
git tag -a v0.6.0 -m "Release v0.6.0

Features:
- Feature A
- Feature B

Fixes:
- Fix C

See CHANGELOG.md for complete details"

git push origin v0.6.0

# 12. Deploy a PRODUCTION (manual)
# En servidor producción:
ssh user@production
cd /path/to/amexing-web
git fetch origin
git checkout main
git pull origin main
yarn install
yarn migrate:dry-run
yarn migrate
pm2 restart amexing-web

# 13. Sync development con main
git checkout development
git merge main
git push origin development

# 14. (Opcional) Delete release branch
git push origin --delete release-0.6.0
git branch -d release-0.6.0
```

### Workflow 3: Hotfix Urgente

```bash
# 1. Desde main (producción actual)
git checkout main
git pull origin main

# 2. Crear hotfix branch
git checkout -b hotfix/descripcion-urgente

# 3. Implementar fix
# ... código ...

# 4. Test localmente
yarn test
yarn test:security

# 5. Commit
git commit -m "fix(security): corregir vulnerabilidad crítica

CVE-2024-XXXXX: SQL injection en endpoint /api/users
Solución: Usar parameterized queries
Testing: yarn test:security passing"

# 6. Push
git push origin hotfix/descripcion-urgente

# 7. PR a main (URGENTE - alta prioridad)
# Base: main
# Compare: hotfix/descripcion-urgente

# 8. Fast-track review
# - Security review
# - CI/CD passing
# - Approval

# 9. Merge to main
# En GitHub: Create a merge commit

# 10. Tag (patch version)
git checkout main
git pull origin main
git tag -a v0.5.1 -m "Hotfix v0.5.1: security vulnerability

Fix critical security issue CVE-2024-XXXXX"

git push origin v0.5.1

# 11. Deploy a PRODUCTION (URGENTE)
# En servidor:
ssh user@production
cd /path/to/amexing-web
git fetch origin
git checkout main
git pull origin main
yarn install
pm2 restart amexing-web

# 12. Backport a development
git checkout development
git merge main
git push origin development

# 13. Delete hotfix branch
git branch -d hotfix/descripcion-urgente
git push origin --delete hotfix/descripcion-urgente
```

## Comandos Git Completos

### Gestión de Ramas

```bash
# Listar ramas locales
git branch

# Listar ramas remotas
git branch -r

# Listar todas las ramas
git branch -a

# Crear rama
git branch nombre-rama

# Cambiar a rama
git checkout nombre-rama

# Crear y cambiar (shortcut)
git checkout -b nombre-rama

# Eliminar rama local
git branch -d nombre-rama  # Safe delete
git branch -D nombre-rama  # Force delete

# Eliminar rama remota
git push origin --delete nombre-rama

# Renombrar rama actual
git branch -m nuevo-nombre

# Ver última commit de cada rama
git branch -v

# Ver ramas merged
git branch --merged

# Ver ramas no merged
git branch --no-merged
```

### Gestión de Commits

```bash
# Commit simple
git add .
git commit -m "type(scope): message"

# Commit con body
git commit -m "type(scope): message

Longer explanation of the change.
Can span multiple lines.

Closes #123"

# Amend último commit (antes de push)
git commit --amend -m "new message"

# Ver historial
git log
git log --oneline
git log --graph --oneline --all

# Ver cambios de un commit
git show <commit-hash>

# Ver historial de un archivo
git log -- path/to/file

# Revert un commit (crea nuevo commit)
git revert <commit-hash>

# Cherry-pick un commit
git cherry-pick <commit-hash>
```

### Gestión de Tags

```bash
# Crear tag annotated
git tag -a v0.6.0 -m "Release v0.6.0"

# Crear tag lightweight
git tag v0.6.0

# Listar tags
git tag
git tag -l "v0.5.*"

# Ver tag details
git show v0.6.0

# Push tag
git push origin v0.6.0

# Push todos los tags
git push origin --tags

# Delete tag local
git tag -d v0.6.0

# Delete tag remoto
git push origin --delete v0.6.0

# Checkout a tag
git checkout v0.6.0  # Detached HEAD state
```

### Merge y Rebase

```bash
# Merge simple
git merge nombre-rama

# Merge sin fast-forward (crea merge commit)
git merge --no-ff nombre-rama

# Squash merge
git merge --squash nombre-rama

# Abort merge (si hay conflictos)
git merge --abort

# Rebase (reorganizar commits)
git rebase development

# Rebase interactivo (editar, squash, reorder)
git rebase -i HEAD~5

# Abort rebase
git rebase --abort

# Continue rebase (después de resolver conflictos)
git rebase --continue
```

### Sincronización con Remote

```bash
# Fetch (traer cambios sin merge)
git fetch origin

# Pull (fetch + merge)
git pull origin main

# Pull con rebase
git pull --rebase origin main

# Push
git push origin nombre-rama

# Push forzado (PELIGROSO - solo si sabes lo que haces)
git push --force origin nombre-rama

# Push forzado seguro (verifica que no sobrescribes cambios remotos)
git push --force-with-lease origin nombre-rama

# Ver remote
git remote -v

# Agregar remote
git remote add nombre url

# Cambiar URL de remote
git remote set-url origin nueva-url
```

## Casos Especiales

### Caso 1: Resolver Conflictos de Merge

```bash
# Durante merge, si hay conflictos:
git merge feature/mi-feature

# Git muestra:
# Auto-merging src/file.js
# CONFLICT (content): Merge conflict in src/file.js

# 1. Ver archivos en conflicto
git status

# 2. Abrir archivo y resolver marcadores:
# <<<<<<< HEAD
# código actual
# =======
# código entrante
# >>>>>>> feature/mi-feature

# 3. Editar archivo manualmente
# Eliminar marcadores y dejar código correcto

# 4. Marcar como resuelto
git add src/file.js

# 5. Continuar merge
git commit  # Sin -m, usa mensaje automático

# O abortar si es necesario
git merge --abort
```

### Caso 2: Mover Commits a Otra Rama

```bash
# Olvidaste crear feature branch y committeaste en development

# 1. Crear nueva branch (preserva commits)
git branch feature/mi-feature

# 2. Reset development (sin perder cambios)
git reset --hard origin/development

# 3. Cambiar a nueva branch
git checkout feature/mi-feature

# Ahora los commits están en feature/mi-feature
```

### Caso 3: Deshacer Último Commit (antes de Push)

```bash
# Deshacer commit pero mantener cambios
git reset --soft HEAD~1

# Deshacer commit y cambios (PELIGROSO)
git reset --hard HEAD~1

# Ver qué se perdería antes de hard reset
git diff HEAD~1
```

### Caso 4: Recuperar Cambios Perdidos

```bash
# Ver todos los cambios (incluso después de reset)
git reflog

# Encontrar commit perdido
git reflog  # Busca el hash del commit

# Recuperar commit
git checkout <commit-hash>
git branch recovered-branch  # Crear branch para guardarlo
```

### Caso 5: Limpiar Branches Locales Viejas

```bash
# Ver branches merged
git branch --merged

# Eliminar branches merged (excepto main y development)
git branch --merged | grep -v "\*\|main\|development" | xargs -n 1 git branch -d

# Limpiar references a branches remotas eliminadas
git fetch --prune
```

### Caso 6: Stash Cambios Temporalmente

```bash
# Guardar cambios sin commit
git stash

# Listar stashes
git stash list

# Aplicar último stash
git stash pop

# Aplicar stash específico
git stash apply stash@{0}

# Ver contenido de stash
git stash show -p

# Eliminar stash
git stash drop stash@{0}

# Eliminar todos los stashes
git stash clear
```

## Referencias

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Semantic Versioning](https://semver.org/)
- [Git Flow](https://nvie.com/posts/a-successful-git-branching-model/)
- [GitHub Flow](https://guides.github.com/introduction/flow/)

## Recursos Internos

- [CONTRIBUTING.md](../CONTRIBUTING.md) - Guía de contribución general
- [Deployment Guide](readme/DEPLOYMENT.md) - Proceso de despliegue
- [CLAUDE.md](../CLAUDE.md) - Guía completa de desarrollo

---

**Última actualización**: 2025-12-29
**Versión**: 1.0.0
**Mantenedores**: AmexingWeb Team
