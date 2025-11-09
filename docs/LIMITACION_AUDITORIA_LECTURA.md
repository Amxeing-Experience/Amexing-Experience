# Limitación en la Auditoría de Operaciones READ

## Resumen Ejecutivo

**Estado Actual**: ❌ **Problema Técnico No Resuelto**

**Problema**: Las operaciones de lectura (READ) en la auditoría muestran "MasterKey/system" en lugar del usuario real (admin@dev.amexing.com)

**Causa Raíz**: Parse Server ejecuta los hooks de cloud code en un **contexto V8 aislado** que no tiene acceso al contexto del usuario autenticado de la capa HTTP

**Impacto en PCI DSS**:
- ✅ CREATE, UPDATE, DELETE: Funcionando correctamente con usuario real
- ❌ READ: Mostrando "MasterKey/system" en lugar del usuario real

## ¿Por Qué Ocurre Este Problema?

### Arquitectura de Parse Server

Parse Server fue diseñado con una arquitectura de seguridad que aísla el cloud code del servidor principal:

```
Solicitud HTTP (con usuario autenticado: admin@dev.amexing.com)
  ↓
Middleware de Express (NodeJS - Contexto Principal)
  ↓
Parse Server Router Interno
  ↓
Ejecución de Query con useMasterKey: true  ← ⚠️ Se pierde el contexto del usuario aquí
  ↓
Cloud Hooks (afterFind, etc.) ← ⚠️ Reciben request SIN información del usuario
  ↓
Logs de auditoría muestran "MasterKey/system"
```

### ¿Qué Intentamos?

Probamos **3 enfoques diferentes**, todos fallaron:

1. **AsyncLocalStorage de Node.js**: No funciona porque Parse Server ejecuta hooks en contexto V8 aislado
2. **Headers HTTP personalizados**: No se propagan a las queries internas de Parse Server
3. **Parámetro context en queries**: Solo funciona para queries directas desde controladores, NO para hooks afterFind

## Soluciones Viables

### Opción 1: API REST Personalizada ⭐ **RECOMENDADA**

Crear endpoints propios que NO usen el REST API interno de Parse Server.

**Ventajas**:
- ✅ Control total sobre el contexto del usuario
- ✅ Auditoría explícita con usuario correcto
- ✅ Funciona de manera confiable
- ✅ Estándar Express que ya conocemos

**Desventajas**:
- ⚠️ Requiere crear endpoints personalizados para cada recurso sensible
- ⚠️ No usa el REST API automático de Parse Server
- ⚠️ Más código que mantener

**Ejemplo de Implementación**:

```javascript
// src/application/controllers/api/UserManagementController.js
router.get('/users/:id', authenticateJWT, async (req, res) => {
  const { id } = req.params;
  const currentUser = req.user; // admin@dev.amexing.com

  try {
    // Query a Parse
    const query = new Parse.Query('AmexingUser');
    const user = await query.get(id, { useMasterKey: true });

    // ✅ AUDITORÍA MANUAL con usuario correcto
    await AuditLog.createEntry({
      userId: currentUser.id,
      username: currentUser.email, // admin@dev.amexing.com
      action: 'READ',
      entityType: 'AmexingUser',
      entityId: user.id,
      entityName: user.get('email'),
      metadata: { ip: req.ip, endpoint: '/api/users/:id' }
    });

    res.json({ success: true, data: user.toJSON() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

### Opción 2: Auditoría Manual Selectiva ⭐ **PRAGMÁTICA**

Desactivar hooks automáticos de READ y agregar auditoría manual solo donde PCI DSS lo requiere.

**Ventajas**:
- ✅ Funciona con la arquitectura actual de Parse Server
- ✅ Control explícito sobre qué se audita
- ✅ Usuario correcto en los logs
- ✅ Cambios mínimos en el código

**Desventajas**:
- ⚠️ Hay que recordar agregar auditoría en cada endpoint sensible
- ⚠️ No es automático
- ⚠️ Riesgo de olvidar algunos puntos de auditoría

**Implementación**:

```javascript
// Eliminar hooks automáticos afterFind
// En src/cloud/hooks/auditTrailHooks.js:
function registerAuditHooks(includedClasses = null) {
  // ... código existente ...

  // ❌ COMENTAR ESTA LÍNEA:
  // registerAuditReadHooks();
}

// Agregar auditoría manual en controladores:
async getUserById(req, res) {
  const { userId } = req.params;
  const currentUser = req.user;

  try {
    const user = await UserManagementService.getUserById(userId, currentUser);

    // ✅ AUDITORÍA EXPLÍCITA con usuario correcto
    await AuditLog.createEntry({
      userId: currentUser.id,
      username: currentUser.email, // admin@dev.amexing.com
      action: 'READ',
      entityType: 'AmexingUser',
      entityId: user.id,
      entityName: user.get('email'),
      metadata: { ip: req.ip }
    });

    res.json({ success: true, data: user });
  } catch (error) {
    errorHandler(res, error);
  }
}
```

## Plan de Acción Recomendado

### Fase 1: Inmediata (Limpiar Implementación Rota)

1. ✅ **COMPLETADO**: Remover logs de debug de AsyncLocalStorage
2. ⚠️ **PENDIENTE**: Desactivar hooks automáticos de READ (comentar `registerAuditReadHooks()`)

### Fase 2: Corto Plazo (Implementar Auditoría Manual)

1. Agregar auditoría explícita de READ en controladores existentes:
   - UserManagementController
   - ClientController
   - EmployeeController (cuando se implemente)
   - DriverController (cuando se implemente)

2. Crear función helper para auditoría consistente:
```javascript
// src/application/utils/auditHelper.js
async function logReadAccess(req, entity, className) {
  await AuditLog.createEntry({
    userId: req.user.id,
    username: req.user.email,
    action: 'READ',
    entityType: className,
    entityId: entity.id,
    entityName: extractEntityName(entity),
    metadata: { ip: req.ip, endpoint: req.path }
  });
}
```

### Fase 3: Largo Plazo (API REST Personalizada)

1. Crear endpoints REST personalizados para recursos sensibles
2. Deprecar el uso del REST API de Parse Server para datos sensibles
3. Actualizar frontend para usar endpoints personalizados
4. Completar migración

## Estado Actual del Código

### ¿Qué Funciona?

- ✅ Hooks de CREATE/UPDATE/DELETE con usuario correcto
- ✅ Auditoría manual en `UserManagementService` donde se pasa contexto explícitamente
- ✅ Infraestructura de AsyncLocalStorage (lista para usar en futuro si Parse Server lo soporta)

### ¿Qué NO Funciona?

- ❌ Hooks automáticos `afterFind` mostrando usuario real (siempre muestra "MasterKey/system")
- ❌ Propagación automática de contexto de usuario a hooks de Parse Server

### Archivos Afectados

```
src/
├── infrastructure/
│   └── parseContext.js                    # AsyncLocalStorage (no funciona en hooks)
├── application/
│   ├── middleware/
│   │   └── auditContextMiddleware.js      # Headers HTTP (no se propagan)
│   └── utils/
│       └── parseQueryHelper.js            # Helper para contexto (solo directo)
└── cloud/
    └── hooks/
        └── auditTrailHooks.js             # Hooks con limitación técnica

docs/
├── AUDIT_READ_CONTEXT_LIMITATION.md       # Análisis técnico completo (inglés)
└── LIMITACION_AUDITORIA_LECTURA.md        # Este documento (español)
```

## Cumplimiento PCI DSS

### Requisito 10.2.1

> "Registrar acceso individual de usuarios a datos de titulares de tarjeta"

**Estado Actual**:
- ✅ CREATE: Usuario correcto registrado
- ✅ UPDATE: Usuario correcto registrado
- ✅ DELETE: Usuario correcto registrado
- ❌ READ: Muestra "MasterKey/system" en lugar del usuario real

**Para Cumplir**:
Implementar **Opción 1** o **Opción 2** para clases sensibles:
- AmexingUser
- Client
- Employee
- Driver
- Payment (cuando se implemente)
- Transaction (cuando se implemente)

## Lecciones Aprendidas

1. **Parse Server usa contextos aislados**: Los hooks de cloud code no tienen acceso al contexto de middlewares de Express
2. **AsyncLocalStorage no cruza contextos V8**: No se puede usar para integración con Parse Server
3. **El parámetro context solo funciona para queries directas**: No para el routing interno de Parse Server
4. **Los enfoques manuales son más confiables** que hooks automáticos para concerns transversales en Parse Server

## Próximos Pasos

1. ¿Prefieres implementar **Opción 1** (API REST personalizada) o **Opción 2** (auditoría manual selectiva)?
2. Una vez decidido, puedo ayudarte a implementar la solución elegida
3. Documentar la decisión en `/planning/docs/compliance/`
4. Actualizar tests para validar la auditoría correcta

---

**Última Actualización**: 2025-10-16
**Investigado por**: Claude (sesión de debugging de contexto AsyncLocalStorage)
**Documentación Técnica Completa**: [AUDIT_READ_CONTEXT_LIMITATION.md](./AUDIT_READ_CONTEXT_LIMITATION.md)
