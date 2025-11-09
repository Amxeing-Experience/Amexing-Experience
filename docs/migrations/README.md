# Database Migrations System

Sistema profesional de migraciones de base de datos para AmexingWeb, similar a Django, Laravel y Knex.js.

## Tabla de Contenidos

- [Visión General](#visión-general)
- [Comandos Disponibles](#comandos-disponibles)
- [Crear una Nueva Migración](#crear-una-nueva-migración)
- [Estructura de una Migración](#estructura-de-una-migración)
- [Ejecutar Migraciones](#ejecutar-migraciones)
- [Rollback de Migraciones](#rollback-de-migraciones)
- [Mejores Prácticas](#mejores-prácticas)
- [Troubleshooting](#troubleshooting)

## Visión General

El sistema de migraciones proporciona:

- ✅ **Control de versiones de base de datos**: Tracking completo de cambios en la estructura
- ✅ **Ejecución secuencial**: Migraciones en orden numérico garantizado
- ✅ **Rollback support**: Revertir cambios con funciones `down()`
- ✅ **Validación de checksums**: Detecta modificaciones después de ejecución
- ✅ **Lock mechanism**: Previene ejecuciones concurrentes
- ✅ **Production safeguards**: Confirmaciones y dry-run mode
- ✅ **Audit trail completo**: Logging con Winston para compliance PCI DSS

### Arquitectura

```
scripts/
├── global/
│   └── migrations/
│       ├── migration-runner.js      # Orchestrador principal
│       ├── migration-tracker.js     # Gestión de estado en MongoDB
│       ├── create-migration.js      # Generador de migraciones
│       └── templates/
│           └── migration-template.js
└── migrations/                      # Archivos de migración
    ├── 001-create-rbac-system.js
    ├── 002-create-vehicle-types.js
    ├── 005-create-service-types-table.js
    └── 006-create-pois-table.js
```

### Estado en MongoDB

Las migraciones se trackean en la colección `_migrations`:

```javascript
{
  name: "005-create-service-types-table",
  version: "1.0.0",
  executedAt: ISODate("2024-10-25T..."),
  environment: "development",
  status: "completed", // pending, running, completed, failed, rolled_back
  duration: 12500,
  checksum: "sha256hash...",
  rollbackAvailable: true,
  metadata: { tablesCreated: 1, recordsUpdated: 0 }
}
```

## Comandos Disponibles

### Ejecutar Migraciones

```bash
# Ejecutar todas las migraciones pendientes
yarn migrate

# Ver el estado de todas las migraciones
yarn migrate:status

# Preview sin ejecutar (dry-run)
yarn migrate:dry-run

# Ejecutar con logging detallado
yarn migrate --verbose
```

### Rollback

```bash
# Revertir la última migración ejecutada
yarn migrate:rollback

# Preview del rollback sin ejecutar
yarn migrate:rollback --dry-run
```

### Gestión de Tracking (Solo Development)

```bash
# Reset del tracking (NO revierte cambios en BD)
yarn migrate:reset

# Reset + ejecutar todas las migraciones
yarn migrate:fresh
```

### Crear Nueva Migración

```bash
# Crear nueva migración con nombre descriptivo
yarn migrate:create add-rates-table

# Con descripción
yarn migrate:create update-user-schema --description "Add role hierarchy fields"

# Sin prompts interactivos
yarn migrate:create seed-permissions --skip-prompts
```

## Crear una Nueva Migración

### 1. Generar el Archivo

```bash
yarn migrate:create create-rates-table
```

Esto crea: `scripts/migrations/007-create-rates-table.js`

### 2. Implementar la Migración

Edita el archivo generado e implementa las funciones `up()` y `down()`:

```javascript
/**
 * Migration 007 - Create Rates Table
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

const MIGRATION_NAME = '007-create-rates-table';
const VERSION = '1.0.0';

async function up() {
  const startTime = Date.now();
  const stats = {
    tablesCreated: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    indexesCreated: 0,
  };

  try {
    logger.info(`[${MIGRATION_NAME}] Starting migration...`);

    // PASO 1: Crear tabla/colección
    const RateClass = Parse.Object.extend('Rate');
    const testRecord = new RateClass();
    testRecord.set('name', '_migration_test');
    testRecord.set('active', false);
    testRecord.set('exists', false);

    await testRecord.save(null, { useMasterKey: true });
    await testRecord.destroy({ useMasterKey: true });

    stats.tablesCreated++;
    logger.info(`[${MIGRATION_NAME}] Created table: Rate`);

    // PASO 2: Seed datos iniciales (opcional)
    // ...

    const duration = Date.now() - startTime;
    logger.info(`[${MIGRATION_NAME}] Migration completed`, {
      duration: `${duration}ms`,
      stats,
    });

    return {
      success: true,
      duration,
      stats,
      message: `Migration ${MIGRATION_NAME} completed successfully`,
    };
  } catch (error) {
    logger.error(`[${MIGRATION_NAME}] Migration failed`, {
      error: error.message,
    });
    throw new Error(`Migration failed: ${error.message}`);
  }
}

async function down() {
  const startTime = Date.now();
  const stats = {
    tablesDeleted: 0,
    recordsDeleted: 0,
  };

  try {
    logger.warn(`[${MIGRATION_NAME}] Starting rollback...`);

    // PASO 1: Eliminar todos los registros
    const RateClass = Parse.Object.extend('Rate');
    const query = new Parse.Query(RateClass);
    const records = await query.find({ useMasterKey: true });

    for (const record of records) {
      await record.destroy({ useMasterKey: true });
      stats.recordsDeleted++;
    }

    logger.warn(`[${MIGRATION_NAME}] Deleted ${stats.recordsDeleted} records`);

    const duration = Date.now() - startTime;
    return {
      success: true,
      duration,
      stats,
      message: `Rollback of ${MIGRATION_NAME} completed`,
    };
  } catch (error) {
    logger.error(`[${MIGRATION_NAME}] Rollback failed`, {
      error: error.message,
    });
    throw new Error(`Rollback failed: ${error.message}`);
  }
}

module.exports = {
  version: VERSION,
  description: 'Create and initialize Rates table',
  up,
  down,
};
```

### 3. Probar la Migración

```bash
# Preview sin ejecutar
yarn migrate:dry-run

# Ejecutar
yarn migrate

# Verificar estado
yarn migrate:status
```

## Estructura de una Migración

### Funciones Requeridas

#### `up()` - Aplicar Cambios

- Debe ser idempotente (segura para ejecutar múltiples veces)
- Debe retornar objeto con `{ success, duration, stats, message }`
- Debe usar `logger` para audit trail
- Debe manejar errores apropiadamente

#### `down()` - Revertir Cambios

- Debe deshacer todos los cambios de `up()`
- **DESTRUCTIVA** - usar con precaución
- Solo para development/staging normalmente
- Opcional pero altamente recomendada

### Metadata Exportada

```javascript
module.exports = {
  version: '1.0.0',              // Versión de la migración
  description: 'Brief description', // Descripción corta
  up,                             // Función de migración
  down,                           // Función de rollback (opcional)
};
```

## Ejecutar Migraciones

### Flujo de Ejecución

1. **Lock acquisition**: Sistema verifica que no haya otra ejecución en curso
2. **Scan directory**: Lee `/scripts/migrations/` y ordena por número
3. **Checksum validation**: Verifica que migraciones ejecutadas no se modificaron
4. **Pending detection**: Identifica migraciones no ejecutadas
5. **Sequential execution**: Ejecuta una por una, parando en el primer error
6. **State recording**: Guarda resultado en `_migrations` collection
7. **Lock release**: Libera el lock en `finally` block

### Confirmaciones de Producción

En producción, el sistema requiere confirmación explícita:

```
⚠️  PRODUCTION ENVIRONMENT ⚠️

Type "EXECUTE MIGRATE" to confirm:
```

Esto previene ejecuciones accidentales en producción.

### Dry-Run Mode

```bash
yarn migrate:dry-run
```

Muestra qué migraciones se ejecutarían **sin hacer cambios reales**.

Output ejemplo:
```
==================================================
Found 2 Pending Migration(s)
==================================================

1. 005-create-service-types-table
2. 006-create-pois-table

[DRY RUN] Would execute these migrations
```

## Rollback de Migraciones

### ⚠️ ADVERTENCIA: Operación Destructiva

El rollback **elimina datos** mediante la función `down()`. Solo usar en:
- Development environment
- Staging con backups recientes
- Producción con aprobación y backup completo

### Proceso de Rollback

```bash
# Ver última migración ejecutada
yarn migrate:status

# Preview del rollback
yarn migrate:rollback --dry-run

# Ejecutar rollback
yarn migrate:rollback
```

### Confirmación en Producción

```
⚠️  PRODUCTION ENVIRONMENT ⚠️

About to rollback: 006-create-pois-table
This will execute the down() function and may delete data!

Type "EXECUTE ROLLBACK" to confirm:
```

### Cuando NO Hacer Rollback

❌ Si la migración ya se ejecutó en producción hace tiempo
❌ Si otros sistemas dependen de los cambios
❌ Si no hay función `down()` implementada
❌ Si no tienes backup reciente

### Alternativa al Rollback

En lugar de rollback, considera crear una **nueva migración** que deshaga los cambios:

```bash
yarn migrate:create revert-rates-changes
```

## Mejores Prácticas

### Naming Conventions

✅ **Buenas**:
- `add-rates-table`
- `update-user-schema`
- `create-audit-logs`
- `remove-deprecated-fields`

❌ **Malas**:
- `AddRatesTable` (no usar PascalCase)
- `add_rates_table` (usar hyphens, no underscores)
- `migration1` (no descriptivo)
- `changes` (muy genérico)

### Idempotencia

Las migraciones deben ser **idempotentes** - seguras para ejecutar múltiples veces:

```javascript
// ✅ CORRECTO: Verifica antes de crear
const query = new Parse.Query(TableClass);
const exists = await query.first({ useMasterKey: true });

if (!exists) {
  // Crear solo si no existe
  const record = new TableClass();
  // ...
}

// ❌ INCORRECTO: Crea sin verificar
const record = new TableClass();
await record.save(); // Puede duplicar
```

### Testing

Siempre probar migraciones:

```bash
# 1. Dry-run
yarn migrate:dry-run

# 2. Ejecutar en development
yarn migrate

# 3. Verificar estado
yarn migrate:status

# 4. Probar rollback
yarn migrate:rollback

# 5. Re-ejecutar
yarn migrate
```

### Documentation

Documenta tus migraciones:

```javascript
/**
 * Migration 007 - Create Rates Table
 *
 * This migration creates the Rates table for storing service pricing.
 *
 * Database Changes:
 * - Creates Rate collection
 * - Adds initial rate types (Aeropuerto, Local, Punto a Punto)
 * - Creates indexes on serviceType and vehicleType
 *
 * Dependencies:
 * - 005-create-service-types-table
 * - 002-create-vehicle-types
 */
```

### Production Deployment

1. **Test en development** primero
2. **Test en staging** con datos de producción
3. **Backup de producción** antes de ejecutar
4. **Execute durante maintenance window** si es posible
5. **Monitor logs** durante y después de ejecución

## Troubleshooting

### Error: "Another migration is already running"

**Causa**: Existe un lock activo en `_migration_locks`

**Solución**:
```javascript
// En MongoDB shell o Compass:
db._migration_locks.deleteMany({})
```

O esperar 5 minutos (locks staleness timeout).

### Error: "Checksum mismatch detected"

**Causa**: El archivo de migración se modificó después de ejecutarse

**Solución**:
1. Revertir cambios en el archivo
2. O crear una nueva migración con los cambios
3. **NUNCA** modificar migraciones ya ejecutadas

### Error: "Migration failed: ..."

**Causa**: Error durante ejecución de `up()`

**Estado**: La migración queda marcada como `failed` en tracking

**Solución**:
1. Revisar logs para identificar error
2. Corregir el código de la migración
3. Re-ejecutar: `yarn migrate`
4. El sistema reintentará la migración fallida

### Migraciones en Orden Incorrecto

**Causa**: Números de migración incorrectos

**Solución**:
```bash
# Renombrar archivos para corregir orden
mv 008-wrong.js 007-wrong.js
mv 007-correct.js 008-correct.js
```

**IMPORTANTE**: Solo renombrar migraciones que **NO** se han ejecutado.

### Reset Tracking en Development

Si necesitas "empezar de cero" en development:

```bash
# Elimina tracking (NO elimina datos)
yarn migrate:reset

# O reset + re-ejecutar todo
yarn migrate:fresh
```

**⚠️ Producción**: `reset` y `fresh` están **BLOQUEADOS** en producción.

## Integración con Seeds

Las migraciones crean la **estructura** de tablas.
Los seeds pueblan los **datos iniciales**.

Orden recomendado:

1. **Migrations** - Crear estructura (`005-create-service-types-table.js`)
2. **Seeds** - Poblar datos (`001-seed-service-types.js`)

Ver [Seeds Documentation](../seeds/README.md) para más información.

## Scripts de Apoyo

### Ver Estado en MongoDB

```javascript
// Migraciones ejecutadas
db._migrations.find().sort({ executedAt: -1 })

// Migraciones pendientes
// Comparar con archivos en /scripts/migrations/

// Locks activos
db._migration_locks.find()
```

### Limpiar Locks Stale

```javascript
// Eliminar locks más viejos de 5 minutos
const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
db._migration_locks.deleteMany({
  createdAt: { $lt: fiveMinutesAgo }
})
```

## Compliance y Seguridad

### PCI DSS Requirements

El sistema de migraciones cumple con:

- ✅ **Complete audit trail**: Todos los cambios logueados con Winston
- ✅ **State tracking**: Historial completo en MongoDB
- ✅ **Checksum validation**: Integridad de archivos
- ✅ **Production confirmations**: Prevención de cambios accidentales
- ✅ **Environment awareness**: Comportamiento según entorno

### Logging

Todos los eventos se loguean:

```javascript
logger.info('Migration started', { name, environment })
logger.info('Migration completed', { name, duration, stats })
logger.error('Migration failed', { name, error })
logger.warn('Rollback executed', { name, stats })
```

Logs disponibles en: `logs/combined.log` y `logs/error.log`

## Recursos Adicionales

- [Seeds System](../seeds/README.md)
- [Parse Server Docs](https://docs.parseplatform.org/)
- [CLAUDE.md](../../CLAUDE.md) - Guía de desarrollo del proyecto
- [Winston Logging](../../src/infrastructure/logger.js)

---

**Última actualización**: 2024-10-25
**Versión del sistema**: 1.0.0
**Autor**: Amexing Development Team
