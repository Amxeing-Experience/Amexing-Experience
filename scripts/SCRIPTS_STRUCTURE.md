# Scripts Structure Guide

Este documento describe la organización y propósito de los scripts en el proyecto Amexing.

## 📁 Estructura General

```
scripts/
├── global/                    # Scripts compartidos y de uso general (SE SUBEN AL REPO)
│   ├── deployment/           # Scripts de despliegue y actualizaciones
│   ├── git-hooks/           # Git hooks del proyecto
│   ├── linting/             # Scripts de corrección de código
│   ├── setup/               # Scripts de configuración inicial
│   └── validation/          # Scripts de validación y testing
├── local/                   # Scripts locales de desarrollo (NO SE SUBEN)
│   ├── database/           # Scripts de base de datos locales
│   ├── development/        # Scripts de desarrollo y debugging
│   └── oauth-testing/      # Testing OAuth en entorno local
├── templates/              # Plantillas para nuevos scripts
└── [archivos individuales] # Scripts de uso específico
```

## 🚫 Scripts Excluidos del Repositorio (.gitignore)

Los siguientes scripts NO se suben al repositorio por contener información sensible o ser específicos del entorno local:

### Carpetas Completas Excluidas
- `scripts/local/` - **Todos los scripts locales**

### Patrones de Archivos Excluidos
- `scripts/oauth-real-*.js` - Scripts con credenciales OAuth reales
- `scripts/*-real-*.js` - Cualquier script con datos reales
- `scripts/seed-test-users.js` - Scripts de semilla con datos de prueba
- `scripts/debug-*.js` - Scripts de debugging
- `scripts/clean-*.js` - Scripts de limpieza

## 📂 Descripción Detallada por Carpeta

### `/global/` (Repositorio)
Scripts que pueden ser compartidos entre desarrolladores y entornos.

#### `/global/deployment/`
- **Propósito**: Scripts de despliegue y mantenimiento
- **Ejemplos**:
  - `deps-update-check.js` - Verificación de dependencias
  - `generate-release-notes.js` - Generación de notas de release

#### `/global/git-hooks/`
- **Propósito**: Hooks de Git del proyecto
- **Archivos**:
  - `commit-msg` - Validación de mensajes de commit
  - `post-merge` - Acciones post-merge
  - `pre-commit` - Validaciones pre-commit
  - `pre-push` - Validaciones pre-push

#### `/global/linting/`
- **Propósito**: Scripts de corrección automática de código
- **Uso**: Corrección de errores ESLint, JSDoc, variables no utilizadas
- **Ejemplos**:
  - `fix-remaining-errors.js` - Corrección de errores generales
  - `add-jsdoc-params.js` - Adición de documentación JSDoc
  - `clean-unused-variables.js` - Limpieza de variables

#### `/global/setup/`
- **Propósito**: Configuración inicial del proyecto
- **Ejemplos**:
  - `after-pull.js` - Acciones post-pull
  - `generate-secrets.js` - Generación de secretos
  - `setup-git-hooks.js` - Configuración de git hooks

#### `/global/validation/`
- **Propósito**: Validaciones del sistema y testing
- **Ejemplos**:
  - `auth-password-validation.js` - Validación de autenticación
  - `pci-dss-report-generator.js` - Reportes de cumplimiento PCI-DSS
  - `test-oauth-endpoints.js` - Testing de endpoints OAuth

### `/local/` (NO Repositorio)
Scripts específicos del entorno de desarrollo local.

#### `/local/database/`
- **Propósito**: Manipulación de base de datos local
- **Contenido**: Scripts de migración, semillas, limpieza local

#### `/local/development/`
- **Propósito**: Scripts de desarrollo y debugging
- **Ejemplos**:
  - `seed-users.js` - Creación de usuarios de prueba
  - `debug-users.js` - Debugging de usuarios
  - `verify-env-vars.js` - Verificación de variables de entorno

#### `/local/oauth-testing/`
- **Propósito**: Testing OAuth con credenciales reales
- **Contenido**: Scripts de testing con APIs reales

### `/templates/`
- **Propósito**: Plantillas para crear nuevos scripts
- **Contenido**: `script-template.js` - Plantilla base

## 🔐 Seguridad y Buenas Prácticas

### Scripts que NO deben subirse:
1. **Scripts con credenciales reales**: Cualquier script que contenga API keys, tokens, o credenciales
2. **Scripts de datos sensibles**: Scripts que manejen datos reales de usuarios
3. **Scripts de debugging**: Scripts temporales para debugging específico
4. **Scripts de entorno local**: Configuraciones específicas del desarrollador

### Scripts que SÍ deben subirse:
1. **Scripts de configuración general**: Setup inicial, git hooks
2. **Scripts de validación**: Testing automatizado, validaciones
3. **Scripts de linting**: Corrección automática de código
4. **Scripts de despliegue**: Procesos de deployment (sin credenciales)

## 📝 Convenciones de Nomenclatura

- `setup-*.js` - Scripts de configuración
- `test-*.js` - Scripts de testing
- `validate-*.js` - Scripts de validación
- `fix-*.js` - Scripts de corrección de código
- `generate-*.js` - Scripts de generación
- `*-real-*.js` - Scripts con datos reales (NO SUBIR)
- `debug-*.js` - Scripts de debugging (NO SUBIR)
- `seed-*.js` - Scripts de semillas (NO SUBIR si contienen datos reales)

## 🚀 Uso Recomendado

1. **Para desarrollo local**: Usar scripts en `/local/`
2. **Para deployment**: Usar scripts en `/global/deployment/`
3. **Para setup inicial**: Ejecutar scripts en `/global/setup/`
4. **Para validaciones**: Usar scripts en `/global/validation/`
5. **Para correcciones de código**: Usar scripts en `/global/linting/`

## ⚠️ Importante

- Siempre revisar que los scripts locales no contengan información sensible antes de moverlos a `/global/`
- Los scripts en `/local/` son ignorados por Git automáticamente
- Usar las plantillas en `/templates/` para crear nuevos scripts
- Seguir las convenciones de nomenclatura para mantener la organización