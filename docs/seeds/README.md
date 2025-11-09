# Database Seeds System

Sistema profesional de seeds para población inicial de datos en AmexingWeb, con gestión de dependencias y tracking de ejecución.

## Tabla de Contenidos

- [Visión General](#visión-general)
- [Comandos Disponibles](#comandos-disponibles)
- [Seeds Disponibles](#seeds-disponibles)
- [Manifest Configuration](#manifest-configuration)
- [Crear un Nuevo Seed](#crear-un-nuevo-seed)
- [Estructura de un Seed](#estructura-de-un-seed)
- [Dependencias y Orden](#dependencias-y-orden)
- [Idempotencia](#idempotencia)
- [Mejores Prácticas](#mejores-prácticas)
- [Troubleshooting](#troubleshooting)

## Visión General

El sistema de seeds proporciona:

- ✅ **Población automatizada**: Datos iniciales con un comando
- ✅ **Gestión de dependencias**: Orden de ejecución garantizado
- ✅ **Idempotencia**: Seguro ejecutar múltiples veces
- ✅ **Environment-aware**: Seeds específicos por entorno
- ✅ **Statistics tracking**: Conteo de created/skipped/errors
- ✅ **Manifest-based**: Configuración centralizada
- ✅ **Audit trail completo**: Logging con Winston para compliance

### Arquitectura

```
scripts/
├── global/
│   └── seeds/
│       ├── seed-runner.js           # Orchestrador principal
│       └── seed-tracker.js          # Gestión de estado en MongoDB
└── seeds/                           # Archivos de seed + manifest
    ├── manifest.json                # Configuración de seeds
    ├── 001-seed-service-types.js    # 3 tipos de servicio
    ├── 002-seed-pois-local.js       # 45 destinos locales
    ├── 003-seed-pois-aeropuerto.js  # 10 aeropuertos
    └── 004-seed-pois-ciudades.js    # 18 ciudades
```

### Estado en MongoDB

Los seeds se trackean en la colección `_seeds`:

```javascript
{
  name: "001-seed-service-types",
  version: "1.0.0",
  executedAt: ISODate("2024-10-25T..."),
  environment: "development",
  status: "completed", // pending, running, completed, failed
  idempotent: true,
  statistics: {
    created: 3,
    skipped: 0,
    errors: 0
  }
}
```

## Comandos Disponibles

### Ejecutar Seeds

```bash
# Ejecutar todos los seeds pendientes según manifest
yarn seed

# Ver el estado de todos los seeds
yarn seed:status

# Preview sin ejecutar (dry-run)
yarn seed:dry-run

# Ejecutar con logging detallado
yarn seed --verbose
```

### Gestión de Tracking (Solo Development/Staging)

```bash
# Reset del tracking (NO elimina datos de BD)
yarn seed:reset

# Reset de un seed específico
yarn seed:reset --seed=001-seed-service-types
```

### Ejecutar Seed Específico

```bash
# Ejecutar solo un seed específico
yarn seed --seed=001-seed-service-types
```

## Seeds Disponibles

### 001-seed-service-types

**Datos**: 3 tipos de servicio
**Archivo origen**: Hardcoded en el seed
**Dependencias**: Ninguna
**Idempotente**: ✅ Sí

Seeds:
- Aeropuerto
- Punto a Punto
- Local

```bash
yarn seed --seed=001-seed-service-types
```

### 002-seed-pois-local

**Datos**: 45 destinos locales
**Archivo origen**: `docs/tarifario/datos_local.txt`
**Dependencias**: 001-seed-service-types (requiere tipo "Local")
**Idempotente**: ✅ Sí

Ejemplos de destinos:
- Tequisquiapan
- Bernal
- San Miguel de Allende
- ...y 42 más

```bash
yarn seed --seed=002-seed-pois-local
```

### 003-seed-pois-aeropuerto

**Datos**: 10 aeropuertos
**Archivo origen**: `docs/tarifario/datos_aeropuerto.txt`
**Dependencias**: 001-seed-service-types (requiere tipo "Aeropuerto")
**Idempotente**: ✅ Sí

Aeropuertos incluidos:
- (AGU) Aeropuerto Internacional de Aguascalientes
- (AIFA) Aeropuerto Internacional Felipe Angeles
- (BJX) Aeropuerto Internacional de Leon
- (GDL) Aeropuerto Internacional de Guadalajara
- (MEX) Aeropuerto Internacional Benito Juarez
- ...y 5 más

```bash
yarn seed --seed=003-seed-pois-aeropuerto
```

### 004-seed-pois-ciudades

**Datos**: 18 ciudades
**Archivo origen**: `docs/tarifario/datos_ciudades.txt`
**Dependencias**: 001-seed-service-types (requiere tipo "Punto a Punto")
**Idempotente**: ✅ Sí

Ciudades incluidas:
- Aguascalientes
- San Miguel de Allende
- León
- Ciudad de México (Norte & Zona Centro)
- Ciudad de México (Sur & Zona de Santa Fé)
- Guadalajara
- Querétaro
- ...y 11 más

```bash
yarn seed --seed=004-seed-pois-ciudades
```

## Manifest Configuration

### Archivo: `scripts/seeds/manifest.json`

El manifest define el orden y configuración de todos los seeds:

```json
{
  "version": "1.0.0",
  "description": "Seed manifest for AmexingWeb database initialization",
  "seeds": [
    {
      "name": "001-seed-service-types",
      "file": "001-seed-service-types.js",
      "description": "Seed initial service types",
      "version": "1.0.0",
      "enabled": true,
      "environments": ["development", "staging", "production"],
      "dependencies": [],
      "idempotent": true,
      "order": 1
    }
  ]
}
```

### Campos del Manifest

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `name` | String | Nombre único del seed (debe coincidir con el nombre del archivo sin .js) |
| `file` | String | Nombre del archivo (ej: `001-seed-service-types.js`) |
| `description` | String | Descripción corta del seed |
| `version` | String | Versión del seed (semver) |
| `enabled` | Boolean | Si está habilitado para ejecución |
| `environments` | Array | Entornos donde se ejecuta: `["development", "staging", "production"]` |
| `dependencies` | Array | Seeds que deben ejecutarse antes (ej: `["001-seed-service-types"]`) |
| `idempotent` | Boolean | Si se puede ejecutar múltiples veces de forma segura |
| `order` | Number | Orden de ejecución (1, 2, 3, ...) |

### Deshabilitar un Seed

Para deshabilitar temporalmente un seed sin eliminarlo:

```json
{
  "name": "003-seed-pois-aeropuerto",
  "enabled": false,  // ← Cambia a false
  ...
}
```

### Seeds Solo para Development

```json
{
  "name": "999-seed-test-data",
  "environments": ["development"],  // ← Solo dev
  ...
}
```

## Crear un Nuevo Seed

### 1. Crear el Archivo

Crea un nuevo archivo en `scripts/seeds/` siguiendo la convención de nombres:

```
005-nombre-descriptivo.js
```

### 2. Implementar el Seed

```javascript
/**
 * Seed 005 - Vehicle Types
 *
 * Seeds the initial vehicle types for the system.
 *
 * Dependencies:
 * - None
 *
 * @version 1.0.0
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

const SEED_NAME = '005-seed-vehicle-types';
const VERSION = '1.0.0';

/**
 * Vehicle types to seed
 */
const VEHICLE_TYPES = [
  { name: 'Sedan', capacity: 4 },
  { name: 'SUV', capacity: 6 },
  { name: 'Van', capacity: 8 },
];

/**
 * Check if a vehicle type exists by name
 */
async function vehicleTypeExists(name) {
  const VehicleTypeClass = Parse.Object.extend('VehicleType');
  const query = new Parse.Query(VehicleTypeClass);
  query.matches('name', `^${name}$`, 'i');
  query.equalTo('exists', true);
  query.limit(1);

  const count = await query.count({ useMasterKey: true });
  return count > 0;
}

/**
 * Create a vehicle type
 */
async function createVehicleType(data) {
  const VehicleTypeClass = Parse.Object.extend('VehicleType');
  const vehicleType = new VehicleTypeClass();

  vehicleType.set('name', data.name);
  vehicleType.set('capacity', data.capacity);
  vehicleType.set('active', true);
  vehicleType.set('exists', true);

  return await vehicleType.save(null, { useMasterKey: true });
}

/**
 * Run the seed
 */
async function run() {
  const startTime = Date.now();
  const statistics = {
    created: 0,
    skipped: 0,
    errors: 0,
  };

  logger.info(`[${SEED_NAME}] Starting seed execution...`);

  try {
    for (const typeData of VEHICLE_TYPES) {
      try {
        const exists = await vehicleTypeExists(typeData.name);

        if (exists) {
          logger.info(`[${SEED_NAME}] Vehicle type exists, skipping`, {
            name: typeData.name,
          });
          statistics.skipped++;
          continue;
        }

        await createVehicleType(typeData);
        statistics.created++;

        logger.info(`[${SEED_NAME}] Vehicle type created`, {
          name: typeData.name,
        });
      } catch (error) {
        statistics.errors++;
        logger.error(`[${SEED_NAME}] Failed to seed vehicle type`, {
          name: typeData.name,
          error: error.message,
        });
      }
    }

    const duration = Date.now() - startTime;

    logger.info(`[${SEED_NAME}] Seed completed`, {
      duration: `${duration}ms`,
      statistics,
    });

    return {
      success: true,
      duration,
      statistics,
      metadata: {
        totalTypes: VEHICLE_TYPES.length,
      },
    };
  } catch (error) {
    logger.error(`[${SEED_NAME}] Seed failed`, {
      error: error.message,
      stack: error.stack,
    });

    throw new Error(`Seed failed: ${error.message}`);
  }
}

module.exports = {
  version: VERSION,
  description: 'Seed initial vehicle types',
  run,
};
```

### 3. Agregar al Manifest

Edita `scripts/seeds/manifest.json`:

```json
{
  "seeds": [
    // ... seeds existentes ...
    {
      "name": "005-seed-vehicle-types",
      "file": "005-seed-vehicle-types.js",
      "description": "Seed initial vehicle types",
      "version": "1.0.0",
      "enabled": true,
      "environments": ["development", "staging", "production"],
      "dependencies": [],
      "idempotent": true,
      "order": 5
    }
  ]
}
```

### 4. Probar el Seed

```bash
# Preview
yarn seed:dry-run

# Ejecutar
yarn seed

# Verificar
yarn seed:status
```

## Estructura de un Seed

### Función Requerida: `run()`

```javascript
async function run() {
  const startTime = Date.now();
  const statistics = {
    created: 0,    // Registros creados
    skipped: 0,    // Registros que ya existían
    errors: 0,     // Errores encontrados
  };

  try {
    // IMPLEMENTACIÓN DEL SEED
    // ...

    const duration = Date.now() - startTime;

    return {
      success: true,
      duration,
      statistics,
      metadata: {
        // Información adicional opcional
      },
    };
  } catch (error) {
    throw new Error(`Seed failed: ${error.message}`);
  }
}
```

### Metadata Exportada

```javascript
module.exports = {
  version: '1.0.0',
  description: 'Brief description',
  run,
};
```

### Logging Requerido

```javascript
// Al inicio
logger.info(`[${SEED_NAME}] Starting seed execution...`);

// Por cada operación
logger.info(`[${SEED_NAME}] Record created`, { id, name });
logger.info(`[${SEED_NAME}] Record skipped`, { name });
logger.error(`[${SEED_NAME}] Failed to create`, { error });

// Al finalizar
logger.info(`[${SEED_NAME}] Seed completed`, { duration, statistics });
```

## Dependencias y Orden

### Declarar Dependencias

```json
{
  "name": "002-seed-pois-local",
  "dependencies": ["001-seed-service-types"],
  ...
}
```

Esto garantiza que:
1. `001-seed-service-types` se ejecuta primero
2. Si `001` falla, `002` no se ejecuta
3. Si `001` ya se ejecutó, `002` puede ejecutarse

### Múltiples Dependencias

```json
{
  "name": "010-seed-rates",
  "dependencies": [
    "001-seed-service-types",
    "005-seed-vehicle-types",
    "002-seed-pois-local"
  ],
  ...
}
```

### Resolución de Dependencias

El seed runner:
1. Lee el manifest
2. Construye un grafo de dependencias
3. Ordena según `order` y dependencias
4. Detecta dependencias circulares
5. Ejecuta secuencialmente

### Dependencias Circulares

❌ **No permitido**:

```json
// A depende de B
{ "name": "A", "dependencies": ["B"] }

// B depende de A
{ "name": "B", "dependencies": ["A"] }
```

**Error**: `Circular dependency detected`

## Idempotencia

### ¿Qué es Idempotencia?

Un seed es **idempotente** si ejecutarlo múltiples veces produce el mismo resultado que ejecutarlo una vez.

### Implementar Idempotencia

✅ **Patrón correcto** - Verificar antes de crear:

```javascript
async function run() {
  const statistics = { created: 0, skipped: 0, errors: 0 };

  for (const item of items) {
    // 1. Verificar si existe
    const exists = await recordExists(item.name);

    if (exists) {
      // 2. Skip si existe
      statistics.skipped++;
      continue;
    }

    // 3. Crear solo si no existe
    await createRecord(item);
    statistics.created++;
  }

  return { success: true, statistics };
}
```

❌ **Patrón incorrecto** - Crear sin verificar:

```javascript
async function run() {
  for (const item of items) {
    // ¡Esto duplicará registros!
    await createRecord(item);
  }
}
```

### Función Helper para Verificación

```javascript
async function recordExists(name) {
  const TableClass = Parse.Object.extend('TableName');
  const query = new Parse.Query(TableClass);
  query.matches('name', `^${name}$`, 'i'); // Case insensitive
  query.equalTo('exists', true);
  query.limit(1);

  const count = await query.count({ useMasterKey: true });
  return count > 0;
}
```

### Seeds No Idempotentes

Si un seed **NO es idempotente**, márcalo en el manifest:

```json
{
  "name": "999-generate-test-data",
  "idempotent": false,  // ← Importante!
  ...
}
```

El sistema ejecutará estos seeds **solo una vez**.

## Mejores Prácticas

### 1. Naming Conventions

✅ **Correcto**:
- `001-seed-service-types.js`
- `002-seed-pois-local.js`
- `010-seed-rates.js`

❌ **Incorrecto**:
- `seedServiceTypes.js` (falta número)
- `001_seed_service_types.js` (guión bajo en lugar de guión)
- `1-seed.js` (número sin padding)

### 2. Usar Parse.Object.extend

```javascript
// ✅ CORRECTO
const ServiceTypeClass = Parse.Object.extend('ServiceType');
const serviceType = new ServiceTypeClass();
serviceType.set('name', 'Aeropuerto');
serviceType.set('active', true);
await serviceType.save(null, { useMasterKey: true });

// ❌ INCORRECTO (problemas con BaseModel)
const serviceType = new ServiceType();
serviceType.setName('Aeropuerto');
await serviceType.save();
```

### 3. Manejo de Errores

```javascript
for (const item of items) {
  try {
    await createRecord(item);
    statistics.created++;
  } catch (error) {
    // NO lanzar error, solo contar
    statistics.errors++;
    logger.error(`[${SEED_NAME}] Failed to create`, {
      item,
      error: error.message,
    });
  }
}

// Retornar success incluso con errores
return {
  success: true,  // ← Importante
  statistics,
};
```

### 4. Leer Datos de Archivos

```javascript
const fs = require('fs');
const path = require('path');

function loadDataFromFile() {
  const filePath = path.join(__dirname, '../../docs/data.txt');
  const content = fs.readFileSync(filePath, 'utf-8');

  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}
```

### 5. Validation Antes de Seed

```javascript
async function run() {
  // Verificar que dependencias existen
  const ServiceTypeClass = Parse.Object.extend('ServiceType');
  const query = new Parse.Query(ServiceTypeClass);
  const serviceTypes = await query.find({ useMasterKey: true });

  if (serviceTypes.length === 0) {
    throw new Error('ServiceType table is empty. Run 001-seed-service-types first.');
  }

  // Continuar con seed...
}
```

### 6. Statistics Completas

```javascript
return {
  success: true,
  duration,
  statistics: {
    created: 10,
    skipped: 35,
    errors: 0,
  },
  metadata: {
    totalItems: 45,
    dataFile: 'datos_local.txt',
    serviceType: 'Local',
  },
};
```

## Troubleshooting

### Seed No se Ejecuta

**Verificar**:

1. ¿Está habilitado en manifest?
```json
"enabled": true
```

2. ¿Está en el entorno correcto?
```json
"environments": ["development"] // ← Check NODE_ENV
```

3. ¿Ya se ejecutó?
```bash
yarn seed:status
```

**Solución**: Reset tracking si necesitas re-ejecutar:
```bash
yarn seed:reset --seed=001-seed-service-types
yarn seed
```

### Error: "Dependency not found"

**Causa**: Seed tiene dependencia que no existe o no se ejecutó

**Verificar**:
```bash
yarn seed:status
```

**Solución**: Ejecutar seed de dependencia primero:
```bash
yarn seed --seed=001-seed-service-types
yarn seed
```

### Error: "Circular dependency detected"

**Causa**: Seeds con dependencias circulares

**Ejemplo**:
- A depende de B
- B depende de A

**Solución**: Rediseñar dependencias para ser acíclicas

### Seed Crea Duplicados

**Causa**: Seed no es idempotente

**Solución**: Agregar verificación de existencia:

```javascript
const exists = await recordExists(name);
if (exists) {
  statistics.skipped++;
  continue;
}
```

### Reset Tracking en Development

```bash
# Reset específico
yarn seed:reset --seed=002-seed-pois-local

# Reset todo (CUIDADO)
yarn seed:reset
```

**IMPORTANTE**: Reset elimina el tracking, **NO los datos**.

### Verificar Datos Creados

```javascript
// En MongoDB shell o Compass
db.ServiceType.find({ exists: true })
db.POI.find({ exists: true }).count()
```

## Integración con Migrations

### Orden Recomendado

1. **Migrations**: Crear estructura de tablas
2. **Seeds**: Poblar datos iniciales

Ejemplo:

```bash
# 1. Migrations - Estructura
yarn migrate  # Ejecuta 005-create-service-types-table

# 2. Seeds - Datos
yarn seed     # Ejecuta 001-seed-service-types
```

### Dependencias Implícitas

Seeds dependen de que las migraciones hayan creado las tablas:

```
Migration 005-create-service-types-table
    ↓
Seed 001-seed-service-types
    ↓
Seed 002-seed-pois-local
Seed 003-seed-pois-aeropuerto
Seed 004-seed-pois-ciudades
```

## Scripts de Apoyo

### Ver Estado en MongoDB

```javascript
// Seeds ejecutados
db._seeds.find().sort({ executedAt: -1 })

// Statistics
db._seeds.aggregate([
  {
    $group: {
      _id: null,
      totalCreated: { $sum: "$statistics.created" },
      totalSkipped: { $sum: "$statistics.skipped" },
      totalErrors: { $sum: "$statistics.errors" }
    }
  }
])
```

### Limpiar Tracking

```javascript
// Eliminar tracking de un seed
db._seeds.deleteOne({ name: "001-seed-service-types" })

// Eliminar todo (CUIDADO - solo dev)
db._seeds.deleteMany({})
```

## Compliance y Seguridad

### PCI DSS Requirements

El sistema de seeds cumple con:

- ✅ **Complete audit trail**: Logging con Winston
- ✅ **State tracking**: Historial en MongoDB
- ✅ **Idempotent operations**: Previene duplicación
- ✅ **Environment awareness**: Control por entorno
- ✅ **Error handling**: Failures no detienen sistema

### Production Safeguards

En producción, el sistema:

- Requiere confirmación: `Type "EXECUTE SEEDS" to confirm`
- Valida manifest antes de ejecutar
- Verifica dependencias
- Loguea todas las operaciones

### Datos Sensibles

❌ **NUNCA** incluir en seeds:
- Contraseñas en texto plano
- Tokens de API
- Datos de tarjetas de crédito
- Información personal identificable (PII)

## Recursos Adicionales

- [Migrations System](../migrations/README.md)
- [Parse Server Docs](https://docs.parseplatform.org/)
- [CLAUDE.md](../../CLAUDE.md) - Guía de desarrollo
- [Winston Logging](../../src/infrastructure/logger.js)

---

**Última actualización**: 2024-10-25
**Versión del sistema**: 1.0.0
**Autor**: Amexing Development Team
