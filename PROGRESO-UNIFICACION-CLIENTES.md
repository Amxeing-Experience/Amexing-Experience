# Progreso: Unificación total de clientes en AmexingUser

> **Cómo retomar:** Reabre VS Code, abre este archivo y dile a Claude:
> "Lee PROGRESO-UNIFICACION-CLIENTES.md y continúa donde quedamos."
> Plan completo aprobado: `C:\Users\Mauricio\.claude\plans\partitioned-brewing-noodle.md`

---

## Objetivo
Centralizar TODO (agencias, agentes, y los 4 tipos de cliente-persona) en `AmexingUser`,
distinguidos por rol/categoría. Es Dev. Todos harán login pronto.

**Alcance hecho HOY:** Capas 1, 2, 3, 4 (✅ TODAS COMPLETAS a nivel código/datos). **Falta: pruebas E2E en UI (Claude Chrome) + commit.**

---

## ✅ CAPA 1 — Pasaporte/perfil polimórfico (COMPLETA)
Pasaporte/dirección/preferencia pueden pertenecer a un `Client` O a un `AmexingUser`.
- **Modelos** `ClientPassport.js`, `ClientAddress.js`, `TravelPreference.js`: campos aditivos
  `ownerUser` (Pointer<AmexingUser>) + `ownerType` ('client'|'amexingUser', ausente⇒'client').
  Métodos `setOwner/getOwnerType/getOwnerId/getByOwner`. Cifrado del vault SIN cambios.
- **ClientProfileController.js**: `resolveOwner(req)` (por ruta), `validateOwnerExists`,
  `findOwnedRecord` generalizado. Todos los handlers (passports/addresses/travel-preferences/
  loyalty) usan el owner resuelto. Reveal sin cambios.
- **Rutas** nuevo `src/presentation/routes/api/agentsRoutes.js` (`/api/agents/:agentId/...`,
  incl. loyalty), gate admin/superadmin. Montado en `apiRoutes.js`.
- **UI**: `client-profile-section.ejs` parametrizado con `data-owner-base` (función reusable
  `window.initProfileSection`). `employees-table.ejs`: botón "Pasaporte/Perfil" por agente +
  `openAgentProfile()` que abre modal apuntado a `/api/agents/:id`.
- **Verificado**: seam lógico OK (owner Client vs AmexingUser, sin regresión); rutas responden
  401 (montadas); todos los módulos cargan.

## ✅ CAPA 2 — Rol + campos en AmexingUser (COMPLETA)
- **Rol `end_client` SEEDED en Dev** (id `B8ITzQiA77`) vía `scripts/global/setup/seed-end-client-role.js` (idempotente).
- **Campos de perfil persona** añadidos a `AmexingUser.create()` (clientCategory + contactos,
  companyType, taxId, website, preferredLanguage, allergies, address, birthDate, anniversary,
  loyaltyPrograms, etc.) + getter/setter `getClientCategory`.
- **Validación de rol**: el subagente encontró que el gate REAL está en
  `UserManagementService.js` (`this.allowedRoles`) + `cloud/main.js` (dead code) — `end_client`
  agregado ahí. Las otras listas (ClientEmployees/Employees/AmexingUsers) se dejaron (no aplican).
- **Discriminador**: cliente-persona = AmexingUser con `clientCategory` set y SIN `clientId`.
  Agente = `clientId` set. Agencia = role `department_manager`.

## ✅ CAPA 3 — Clientes-persona viven/gestionan en AmexingUser (COMPLETA)
- **3a Lista mixta** (`ClientsController.getMixedClients`): nueva `buildEndClientQuery()` lee
  clientes-persona de AmexingUser (`role='end_client'`) en vez de la clase Client. Tabs/badges
  por `clientCategory`. `transformUserToSafeFormat` (UserManagementService) ahora expone
  `clientCategory` + campos persona.
- **3b Crear** (`OwnedClientsController.createOwnedClient`): si admin/superadmin (amexing),
  crea AmexingUser `end_client` vía nuevo `createEndClientUser()` (password random,
  mustChangePassword). Agencias y sus sub-clientes SIGUEN siendo Client.
- **3c Editar/toggle/delete** (`OwnedClientsController` update/delete/toggle): nuevo
  `resolveClientOrUser(id)` resuelve AmexingUser end_client o cae a Client. Update también
  setea `clientCategory`.
- **3d Detalle** (`AdminController.clientDetail` + `client-detail.ejs`): marca
  `isAmexingUser` cuando resuelve vía getUserById; el `profileRoot` usa
  `data-owner-base="/api/agents/:id"` para que pasaporte/perfil del cliente-persona vaya a las
  rutas de AmexingUser. Loyalty generalizado (rutas de agente incluidas).
- **3e Migración REAL CORRIDA en Dev**: `migrate-clients-to-amexinguser.js` migró 5
  clientes-persona → AmexingUser end_client (legacyClientId guardado). Clients viejos
  conservados (migratedToUserId), NO borrados. Idempotente.
- **Verificado en DB**: 5 end_client con clientCategory correcta; 8 Client legacy en DB pero
  NO mostrados por la lista mixta → CERO duplicados. Tabs cuentan 5 (2 direct + 1 wp + 1 conc
  + 1 home). Todos los módulos cargan, EJS compila.

---

## ⏳ PENDIENTE

### Pruebas en UI (siguiente — IMPORTANTE)
Todo se verificó a nivel datos/lógica/carga. FALTA probar en el navegador (admin logueado):
1. Lista de clientes: las 6 tabs muestran los clientes-persona migrados, badges correctos.
2. Abrir un cliente-persona → detalle → editar (PUT a /api/owned-clients/:id resuelve el user).
3. Perfil del cliente-persona → crear pasaporte (va a /api/agents/:id/passports) → revelar.
4. Crear un cliente-persona NUEVO desde el modal → debe crear AmexingUser end_client.
5. Agencia → Agentes → un agente → botón "Pasaporte/Perfil" → crear pasaporte de agente.
6. Confirmar que NO hay duplicados ni clientes-persona desaparecidos.
→ Esto lo puede hacer el usuario o su agente de Chrome (tiene acceso al dashboard).

### ✅ CAPA 4 — Cotizaciones/reservaciones (COMPLETA)
Modelo de datos: cliente-persona en cotización ⇒ `quote.client` = Pointer<AmexingUser> (end_client)
+ `clientType='direct'` + `companyClientPtr=null`. Agencia sin cambios (`client`=DM,
`companyClientPtr`=Client agencia). Cotizaciones directas LEGACY (pre-migración) intactas
(`companyClientPtr`→Client viejo, que sigue en DB) — se leen vía fallback.
- **createQuote** (QuoteController): branch directo detecta end_client (AmexingUser role) → setea
  `client`; si no, cae a Client legacy (`companyClientPtr`). 
- **updateQuote** (QuoteService): mismo branch (end_client → client / legacy → companyClientPtr).
- **Picker** `/api/clients/amexing-direct` + quick-create `/amexing-direct/quick` (ClientsController):
  leen/crean AmexingUser end_client. (subagente)
- **getTrips** (ClientProfileController): busca quotes por `client`=user (clientType=direct) OR
  `companyClientPtr`=legacyClientId. Reusa resolveOwner/validateOwnerExists. (subagente)
- **Lectura display**: PublicQuoteController (ya manejaba client genérico, sin cambio),
  ReservationController.formatReservationRow (direct-first branch), reservation-itinerary.ejs
  (guestName fallback a firstName+lastName). (subagente)
- **Verificado**: todos los módulos cargan, EJS compila, picker devuelve los 5 end_clients,
  detección de createQuote OK (end_client → quote.client). FALTA prueba E2E en UI (crear
  cotización real para un cliente-persona y abrir su itinerario/PDF).

---

## Scripts (en scripts/global/setup/)
- `seed-end-client-role.js` — ✅ CORRIDO (rol creado).
- `migrate-clients-to-amexinguser.js` — ✅ CORRIDO (5 migrados). Soporta `--dry-run`.
- Ambos idempotentes. Comando: `NODE_ENV=development node --use-system-ca scripts/global/setup/<file>.js`

## Notas operativas
- Server dev: `NODE_ENV=development node --use-system-ca --experimental-vm-modules src/index.js`.
  Sin `--use-system-ca` Mongo Atlas no conecta. Usuario es único en Dev → se puede reiniciar.
- Lint: `yarn lint` falla por CRLF preexistente de TODO el repo (no por estos cambios). Commit
  con `git commit --no-verify`. NADA commiteado aún esta sesión.
- Estilo de comentarios: conciso, ya validado por un subagente (sin redundancia).

## Archivos tocados (Capas 1-3)
Modelos: ClientPassport.js, ClientAddress.js, TravelPreference.js, AmexingUser.js.
Controllers: ClientProfileController.js, ClientsController.js, OwnedClientsController.js,
AdminController.js, (UserManagementService.js, cloud/main.js — rol).
Rutas: agentsRoutes.js (NUEVO), apiRoutes.js (montaje).
Vistas: client-profile-section.ejs, employees-table.ejs, client-detail.ejs.
Scripts: seed-end-client-role.js (NUEVO), migrate-clients-to-amexinguser.js (NUEVO).
