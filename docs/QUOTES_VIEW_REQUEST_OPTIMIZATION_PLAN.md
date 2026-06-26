# Plan de Optimización de Requests — Vista de Servicios de Cotización (Fase 2)

> **Estado:** PLAN (no implementado). Solo análisis + plan de ejecución para otra sesión.
> **Creado por:** Denisse Maldonado
> **Fecha:** 2026-06-23
> **Builds on:** `docs/QUOTES_PERFORMANCE_OPTIMIZATIONS.md` (Fase 1, ene-2026 — creó cache/dedup/API wrapper).

---

## Contexto

La Fase 1 (ene-2026) creó la infraestructura:
- `public/dashboards/admin/sections/quote-services/fetch-with-dedup.js` — deduplica requests idénticos concurrentes.
- `public/dashboards/admin/sections/quote-services/quote-data-cache.js` — cache con TTL e invalidación.
- `public/dashboards/admin/sections/quote-services/quote-services-api.js` — wrapper con cache + dedup + prefetch.

**Problema actual:** `quote-services-v2.js` (ItineraryBuilder, ~7300 líneas) sigue haciendo la mayoría de sus lecturas con `fetch()` crudo y **no usa** esa infraestructura de forma consistente. Además quedan patrones N+1 y refetch de catálogos.

> ⚠️ **Antes de ejecutar:** los números de línea de este plan son aproximados (el archivo cambia seguido). Reconfirmar con grep cada punto antes de tocar. Trabajar en una rama `feature/quotes-perf-2` desde `development`.

---

## Objetivo

Reducir el número de requests (carga inicial y por interacción) **sin cambiar comportamiento visible**, principalmente:
1. Encauzando lecturas de datos de referencia por el cache/dedup ya existente.
2. Eliminando refetch de catálogos ya cargados.
3. Deduplicando `prices-by-route`.
4. Resolviendo el N+1 de precios cliente por experiencia/tour en init.

---

## Fase 0 — Baseline (medir antes de tocar)

**Obligatorio** para poder comparar.

- Abrir la vista `…/quotes/:id?section=services` con DevTools → Network (deshabilitar caché del navegador).
- Registrar en un HAR / captura:
  - **# requests en carga inicial** y tiempo total.
  - **# requests** al: seleccionar segmento de transporte, cambiar origen/destino, agregar un servicio, abrir el modal de servicio, cambiar moneda/forma de pago, guardar.
- Anotar los conteos en este doc (sección "Resultados") para medir cada fase.

**Riesgo:** nulo. **Esfuerzo:** 30 min.

---

## Fase 1 — Encauzar datos de referencia por cache/dedup (alto valor, bajo riesgo)

Datos que **no cambian durante la sesión** y hoy se piden con `fetch()` crudo (a veces con cache-buster `?_t=Date.now()` que anula cualquier dedup):

| Dato | Función (reconfirmar) | Endpoint |
|---|---|---|
| Vehículos | `loadVehicles()` | `/api/vehicles` |
| Rates | `loadAllRates()` | `/api/rates/active` |
| Vehicle types | `loadVehicleTypes()` | `/api/vehicle-types/active` |
| Experiencias (catálogo) | `loadAllExperiences()` | `/api/experiences?...length=1000` |
| Tours (catálogo) | `loadAllTours()` | `/api/tours/all` |
| Tour prices | `loadAllTourPrices()` | `/api/tour-prices?_t=…` |
| Driver/Guide/Greeter rates | `loadDriverTourRate()`, `loadGuideTransportRate()`, formulas | `/api/.../current` y `/formula` |
| Exchange/Transfer/Agency rates | `loadPricingRates()` | `/api/*-rate/current` |
| Segment mappings | `fetchSegmentMappings()` | (reconfirmar) |

**Acción:**
1. Rutear estas lecturas por `quote-services-api.js` (o al menos por `fetchWithDedup` + `quote-data-cache`).
2. **Quitar los `?_t=Date.now()`** en datos de sesión-estática (sí dejarlos solo donde realmente se necesite invalidar).
3. Asegurar que el cache se invalide correctamente cuando cambie algo relevante (p. ej. `numberOfPeople`, cliente) usando `invalidate*` del cache.

**Verificación:** repetir Fase 0; el conteo en carga inicial debe bajar si hubo duplicados; recargar dos veces seguidas no debe re-pedir lo cacheado dentro del TTL.
**Riesgo:** bajo-medio (cuidar invalidación para no servir datos viejos tras cambiar cliente/personas).
**Esfuerzo:** medio.

---

## Fase 2 — No re-pedir catálogos por día — ✅ YA OPTIMIZADO (no-op)

Al revisar el código (2026-06-24) resultó que **ya está hecho** (el análisis inicial lo sobre-estimó):
- `loadDayExperiences(dayId)` (v2.js ~21513): arma el dropdown desde `this.experiencesCache.get('all')` + `this.providerExperiencesCache` (memoria). **Cero fetch.**
- `loadDayTours(dayId)` (v2.js ~21926): usa `this.toursCache.get('all')` y solo llama a `loadAllTours()` **si el cache está vacío** (`if (!this.toursCache.has('all'))`), que en una carga normal ya está poblado por `init`. **Cero refetch en la práctica.**

**Conclusión:** no hay cambios que hacer en esta fase.

---

## Fase 3 — Deduplicar `prices-by-route` — ✅ parcial (in-flight dedup)

**Corrección de la premisa (2026-06-24):** el plan asumía que `prices-by-route` se "re-pide al guardar" para la misma ruta. Al revisar el código eso **no ocurre**: ya hay cache por segmento y los 3 sitios consultan rutas/segmentos **distintos**:
- `handleTransportRateSelection` (~18384): segmento principal → guarda `this.transportPriceData`.
- Vehículo adicional (~19029): segmento adicional → guarda `this.additionalTransportPriceData`.
- Vehículos extra (~14077): **ya reutilizan** `transportPriceData`/`additionalTransportPriceData` y solo hacen fetch si el segmento no está en cache.

**Lo que sí se hizo (seguro):** encauzar los 3 `fetch` por `(window.amxDedupFetch || fetch)` → **dedup in-flight** (colapsa disparos concurrentes idénticos: restauración de edición que setea varios campos, o varias filas extra del mismo segmento). **Sin cache de resultados** → cero riesgo de staleness o de tocar fórmulas/precios.

**No se hizo** (a propósito): un cache de resultados por `origen|destino|rateId|clientId`. No hay evidencia (medición) de re-fetch redundante de la misma ruta en una acción deliberada, y un cache de precios en el path frágil añade riesgo sin beneficio demostrado. Si en una medición por-acción aparece duplicación real, se reconsidera.

**Riesgo:** bajo (solo in-flight, fallback a `fetch`). **Esfuerzo:** bajo.

---

## Fase 4 — Resolver el N+1 de precios cliente en init (alto valor, mayor esfuerzo)

`loadClientSpecificPricing()` recorre experiencias y tours y hace **una llamada por cada uno** (secuencial con `await`):
- `/api/services/:id/all-rate-prices-with-client-prices?clientId=…` (por experiencia)
- `/api/tours/:id/all-rate-prices-with-client-prices?clientId=…` (por tour)

Con ~30 exp + ~20 tours = ~50 requests encadenados en cada carga.

**Opciones (de menor a mayor cambio):**
- **A (rápida):** paralelizar el loop con `Promise.all` (de waterfall a 1 ráfaga). Reduce tiempo, no el #requests.
- **B (mejor):** endpoint **batch** backend, p. ej. `GET /api/services/batch-rate-prices?experienceIds=[…]&tourIds=[…]&clientId=…` que devuelva todo en 1-2 llamadas. Reduce #requests drásticamente.
- **C (lazy):** cargar precios cliente **bajo demanda** (al abrir el modal del servicio / seleccionar el item), no todo en init.

**Recomendado:** B o C. B es 1 endpoint nuevo + cambio de init; C cambia cuándo se cargan (verificar que nada dependa de tenerlos en init).

**Verificación:** carga inicial pasa de ~50 a ~1-2 requests para precios cliente; los precios siguen correctos al cotizar.
**Riesgo:** medio (B toca backend; C cambia timing — revisar dependencias). **Esfuerzo:** medio-alto.

---

## Fase 5 — (Opcional, mayor) Guardado parcial / estado

Hoy cada `saveToBackend()` manda **todo el documento** (todos los días+servicios) a `PUT /api/quotes/:id/service-items`.

**Acción (futuro):** evaluar guardado parcial (por día/servicio) y usar más `quote-services-state.js` (subscribe/notify) como ya sugería la Fase 1. Mayor esfuerzo/riesgo; dejar para el final.

---

## Orden de ejecución sugerido

1. **Fase 0** (medir).
2. **Fase 2** (catálogos por día) — rápido y seguro, primer ahorro visible.
3. **Fase 1** (encauzar a cache/dedup + quitar cache-busters) — gran ahorro.
4. **Fase 3** (dedup prices-by-route).
5. **Fase 4** (N+1 precios cliente) — el de mayor impacto en carga, dejar con tiempo.
6. **Fase 5** (guardado parcial) — opcional.

Hacer **una fase por PR**, midiendo contra el baseline de Fase 0 en cada una.

---

## Definición de "hecho" / métricas

- Carga inicial: reducir # requests y tiempo vs baseline (objetivo realista: −40% a −60% requests al completar Fases 1-4).
- Cero requests duplicados de catálogos/segmentos por una sola acción del usuario.
- Sin regresiones: precios, duración, vehículos, guía/greeter, guardado y sync de reservación siguen correctos.
- `yarn lint` y la suite de tests del pre-push pasan en cada fase.

---

## Riesgos transversales

- **Invalidación de cache:** el mayor riesgo. Al cambiar cliente, # personas, fechas o segmentos, asegurarse de invalidar lo que corresponda (`quote-data-cache` ya tiene `invalidate*`). Probar explícitamente cambiar de cliente y ver que precios cliente se recalculen.
- **Timing en init:** si algo asume que ciertos datos ya están en init (Fase 4-C), validar dependencias antes de hacerlos lazy.
- **No tocar** el path de precio de transporte sin reconfirmar (es frágil y muy usado).

---

## Resultados — Baseline (Fase 0)

> Rama: `feature/quotes-perf-2`. Fecha: 2026-06-24.
> El **baseline estático** sale del código (qué requests dispara cada flujo). Los **números reales** requieren una sesión autenticada en el navegador; usar el medidor de consola de abajo y anotarlos.

### A) Baseline estático — requests EN CARGA INICIAL (`init()`)

Secuencial (bloquea) → luego un `Promise.all` grande → luego rates → luego N+1:

| # | Endpoint | Función | Cuándo |
|---|---|---|---|
| 1 | `GET /api/quotes/:id` | `loadQuoteData()` | secuencial (bloquea el resto) |
| 2 | `GET /api/vehicles` | `loadVehicles()` | paralelo |
| 3 | `GET /api/rates/active` | `loadAllRates()` | paralelo |
| 4 | `GET /api/experiences?...length=1000` | `loadAllExperiences()` | paralelo |
| 5 | `GET /api/tours/all` | `loadAllTours()` | paralelo |
| 6 | `GET /api/tour-prices` (+ fallback `parse/functions/getTourPrices`) | `loadAllTourPrices()` | paralelo |
| 7 | `GET /api/client-prices` (+ fallback `parse/functions/getClientPrices`) | `loadAllClientPrices()` | paralelo |
| 8 | `GET /api/vehicle-types/active` | `loadVehicleTypes()` | paralelo |
| 9 | `GET /api/provider-experiencias/all` | `loadProviderExperiences()` | paralelo |
| 10 | `GET /api/driver-tour-rate/current` | `loadDriverTourRate()` | paralelo |
| 11 | `GET /api/guide-transport-rate/current` | `loadGuideTransportRate()` | paralelo |
| 12 | `GET /api/guide-transport-rate/formula` | `loadGuideFormulaConfiguration()` | paralelo |
| 13 | `GET /api/greeter-rate/formula` | `loadGreeterRateConfiguration()` | paralelo |
| 14 | `GET /api/vehicle-rate-prices/all` | `loadVehicleRatePrices()` | paralelo |
| 15 | `GET /api/exchange-rate/current` | `loadPricingRates()` | paralelo (sub-`Promise.all`) |
| 16 | `GET /api/transfer-rate/current` | `loadPricingRates()` | paralelo |
| 17 | `GET /api/agency-rate/current` | `loadPricingRates()` | paralelo |
| 18..18+N | `GET /api/services/:id/all-rate-prices-with-client-prices` | `loadClientSpecificPricing()` | **N+1, 1 por experiencia (secuencial `await`)** |
| ..+M | `GET /api/tours/:id/all-rate-prices-with-client-prices` | `loadClientSpecificPricing()` | **N+1, 1 por tour (secuencial `await`)** |

**Fijos ≈ 17** + **N+1 = (#experiencias + #tours)**. Con ~30 exp + ~20 tours ⇒ **~67 requests** en carga. El N+1 (filas 18+) es el grueso y es secuencial (waterfall).

### B) Baseline estático — requests POR ACCIÓN

| Acción del usuario | Request(s) | Nota |
|---|---|---|
| Transporte: elegir/cambiar **segmento** | `GET /api/services/prices-by-route` | precios+vehículos de la ruta |
| Transporte: cambiar **origen/destino** | `GET /api/services/route-duration` (+ `prices-by-route` si ya hay segmento) | duración por ruta (nuevo) |
| Transporte: **guardar** servicio | `prices-by-route` otra vez + `PUT .../service-items` | ruta re-consultada al guardar |
| A-disposición: elegir **segmento** | `GET /api/disposable-prices/vehicles-for-rate` | |
| A-disposición: elegir **vehículo/horas** | `GET /api/disposable-prices/price` | cacheado por `vehículo_segmento` |
| Agregar **experiencia/tour a un día** | `loadDayExperiences/loadDayTours` (catálogo de nuevo) | refetch de catálogo ya cargado |
| **Guardar** (cualquier cambio) | `PUT /api/quotes/:id/service-items` | manda **todo** el documento |

### C) Medidor de consola (para los números REALES)

Pegar en la consola del navegador estando en la vista (sesión iniciada). Cuenta requests por endpoint (normaliza ids/queries):

```js
(() => {
  const norm = (u) => { try { u = new URL(u, location.origin).pathname; } catch (e) {}
    return u.replace(/\/[0-9a-zA-Z_-]{8,}(?=\/|$)/g, '/:id'); };
  const counts = {}; const order = [];
  const bump = (u) => { const k = norm(u); if (!(k in counts)) { counts[k] = 0; order.push(k); } counts[k]++; };
  const of = window.fetch;
  window.fetch = function (input) { const u = typeof input === 'string' ? input : input && input.url; if (u) bump(u); return of.apply(this, arguments); };
  const oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) { if (u) bump(u); return oo.apply(this, arguments); };
  window.__reqReset = () => { Object.keys(counts).forEach((k) => delete counts[k]); order.length = 0; console.log('[req-meter] reset'); };
  window.__reqReport = () => { const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.table(order.map((k) => ({ endpoint: k, count: counts[k] }))); console.log('TOTAL:', total); return { total, counts: { ...counts } }; };
  console.log('[req-meter] activo. __reqReport() = resumen, __reqReset() = reiniciar.');
})();
```

**Cómo medir:**
- **Carga inicial:** DevTools → Network, deshabilitar caché, recargar, filtrar `/api/` y leer el conteo (o pegar el snippet apenas cargue y `__reqReport()`).
- **Por acción:** pegar el snippet → `__reqReset()` → hacer UNA acción → `__reqReport()`. Anotar abajo.

### D) Números reales (medidos — cotización `hUGtMzhcDp`, 2026-06-24)

DevTools → Network, filtro `/api/`, caché desactivada.

| Escenario | # requests | Peso | Notas |
|---|---|---|---|
| **Carga inicial** | **25** | **851.6 KB** | El N+1 (`all-rate-prices-with-client-prices`) **NO apareció** en esta carga → es condicional (sin cliente/ítems que lo activen). |
| Elegir segmento transporte | _pend._ | | |
| Cambiar origen/destino | _pend._ | | |
| Agregar experiencia a un día | _pend._ | | |
| Agregar tour a un día | _pend._ | | |
| Guardar | _pend._ | | |

### E) Hallazgos observados (de la captura real)

1. **`GET /api/quotes/:id` se pedía 3 veces** (8.71 KB c/u, ~4–5 s). Iniciadores: `quote-services`, `quote-owners` y la página. → **RESUELTO** con `window.amxDedupFetch` (dedup in-flight, `clone()` por consumidor). Verificado en runtime: ahora **1×** (25 → ~23 requests). El helper se **centralizó** en el `.js` compartido `quote-ownership.js` (lo cargan los 3 roles antes que el resto), así que aplica a **admin, department_manager y client** sin duplicar el shell; los 3 `loadQuoteFolio` y los `.js` (v2 + ownership) usan `(window.amxDedupFetch || fetch)`.
2. **Módulo de ownership** (`quote-owners`): `…/ownership`, `…/collaborators`, `…/access` + 2 de las re-cargas del quote. Overhead no contemplado en el `init`; revisar si puede compartir el quote ya cargado.
3. **`vehicle-rate-prices/all` ≈ 71.6 KB** — el payload más pesado; ver si se puede adelgazar/cachear.
4. Repetidos esperables: `current` ×5 (exchange/transfer/agency + driver + guide), `formula` ×3, `tours` ×2, `all` ×2, `active` ×4.
5. **El N+1 (Fase 4) no se observó** aquí → bajar su prioridad hasta reproducirlo (cotización con cliente + ítems). Subir prioridad del **dedup del quote** (Fase 1).

> **Reprioritización tras medir:** el mayor retorno inmediato y de bajo riesgo es **deduplicar `/api/quotes/:id` (3×→1×)** y revisar el módulo de ownership, antes que el N+1.

> Por acción: pendiente de medir con el snippet (`__reqReset()` → acción → `__reqReport()`).

---

# Plan de carga inicial (latencia) — análisis 2026-06-24

> **Estado:** PLAN (no implementado). El foco aquí no es el #requests sino el **tiempo**: cada endpoint tarda **2–5 s** y la carga **se serializa** en partes.
> Mide siempre el **tiempo por endpoint** (DevTools → columna Tiempo) antes/después, no solo el conteo.

## Diagnóstico (dónde se va el tiempo)

**Frontend — el critical path se serializa** (`public/dashboards/admin/sections/quote-services-v2.js`, `init()` ~línea 299):
- `await this.loadQuoteData()` (~línea 305) corre **solo y bloqueando** ANTES del `Promise.all` del resto → la request más lenta (`/api/quotes/:id`, ~4–5 s) va por delante de todo.
- Tras el batch paralelo hay **más etapas en serie**: `await loadPricingRates()` (~339) y `await loadClientSpecificPricing()` (~349).

**Backend — latencia alta por request:**
- `QuoteController.getQuoteById` (~src/application/controllers/api/QuoteController.js:984): `useMasterKey` + `.include(client, companyClientPtr, rate, createdBy)` + **4 consultas secuenciales** de acceso/ownership tras el quote (`hasAccess`, `checkQuoteAccess`, `getUserAccess`, `getCurrentOwner`).
- `*-rate/current` y `/formula`: 1–3 s para **un solo registro**, **sin caché de servidor** (se reconsulta cada request).
- `vehicle-rate-prices/all`: **71.6 KB** (objetos completos rate+vehicleType, sin proyección).
- Catálogos completos (`tours`/`experiences` con `length=1000`) en cada carga.
- Probables **índices Mongo faltantes** en `{active, exists}` de las clases consultadas.

> Nota: el "~15 s total" de algún análisis es **extrapolación**; lo medible real es requests de 2–5 s y waterfall hasta ~12 s. La conclusión firme: hay segundos que hoy corren en serie y podrían solaparse, + latencias de backend que bajan mucho con caché/índices/proyección.

## Fases (de menor a mayor riesgo)

### IL-1 — Caché de servidor para rates/formulas — ✅ IMPLEMENTADO
- **Qué:** caché en memoria con TTL (15 min) en `getCurrent*` de `ExchangeRate`/`TransferRate`/`AgencyRate`/`DriverTourRate`/`GuideTransportRate`/`GreeterRate`. Las `/formula` (Guide/Greeter) se benefician automáticamente porque `getFormulaConfiguration` lee de `getCurrentRate`.
- **Cómo:** helper reutilizable `src/infrastructure/cache/ttlCache.js` (`TtlCache`); cada modelo cachea su `getCurrent*` e **invalida** (`clear()`) en todos los writes (create / softDelete / updateFormulaConfiguration).
- **Efecto:** 5–8 requests de 1–3 s → ~ms (cache hit) tras la primera consulta.
- **Riesgo:** bajo. Instancia única → invalidación completa. Multi-instancia → consistencia eventual ≤ TTL (rates cambian rara vez).
- **Verificar:** recargar la vista 2 veces; los `*-rate/current` y `/formula` deben tardar ~ms en la 2ª. Tras editar un rate, debe reflejarse de inmediato (invalidación).

### IL-2 — Índices Mongo `{active, exists}` (riesgo muy bajo)
- **Qué:** índices en las clases consultadas con `active`/`exists` (+ `createdAt` donde se ordena): Quote, Tour, Experience, VehicleRatePrices, *Rate*.
- **Efecto:** reduce escaneos en todas las consultas filtradas; transversal.
- **Riesgo:** muy bajo (aditivo). Verificar que no existan ya.

### IL-3 — Acelerar `getQuoteById` — ✅ parcial (paralelizar accesos)
- **Hecho:** las 3 consultas independientes (`collaborationService.hasAccess`, `getUserAccess`, `ownershipService.getCurrentOwner`) pasan de **secuenciales a `Promise.all`** en `QuoteController.getQuoteById`. El fallback legacy `checkQuoteAccess` (que necesita el objeto `quote`) queda condicional debajo.
- **Efecto:** ~0.5–1 s menos en la request más bloqueante (común: acceso concedido).
- **Riesgo:** bajo (son lecturas). En el caso denegado se hacen 2 lecturas extra antes del 403 — raro y sin impacto de seguridad.
- **Pendiente (opcional):** revisar/quitar `.include()` no usados + proyección de campos en el quote (no hecho — requiere auditar dependencias del front).

### IL-4 — Adelgazar `vehicle-rate-prices/all` — ✅ vía modo `?lite=1`
- **Hallazgo:** el endpoint ya devolvía un DTO (no objetos completos); el peso es por la **cantidad** de registros. Y NO se podía recortar a secas porque `experience-services.js` usa `vehicleTypeName`/`vehicleTypeCode` del cache (dropdown de vehículos).
- **Hecho:** modo **`?lite=1`** que devuelve solo `{rateId, vehicleTypeId, pricePerHour, currency}` y **omite las 2 consultas extra** a Rate/VehicleType + el mapa `rateColors`. La vista de cotización (`loadVehicleRatePrices`) lo pide lite (solo usa eso en `getWaitingTimePrice`); `experience-services` sigue con el modo completo.
- **Efecto:** payload ~55% menor en la cotización + 2 consultas menos en el backend para ese request.
- **Riesgo:** bajo (aditivo; el modo completo no cambia). Verificado: v2.js solo lee `vehicleTypeId/rateId/pricePerHour/currency` del cache.

### IL-4b — `provider-experiencias/all` era el verdadero 71 KB — ✅ vía `?lite=1`
- **Hallazgo (con captura del usuario):** había **dos** endpoints `/all`. `vehicle-rate-prices/all` ya bajó (~2.78 KB). El de **71.6 KB era `/api/provider-experiencias/all`** (`loadProviderExperiences`), que devuelve **todas las fotos** y además las **procesa una por una** (URLs firmadas de S3) → grueso del payload Y de la latencia.
- **Hecho:** `?lite=1` en `getAllProviderExperiencias` que **omite el procesamiento de fotos** (itera sobre `[]` → `photos: []`); el resto de campos queda **idéntico**. La cotización lo pide lite (no usa fotos). `experience-services` sigue con el modo completo.
- **Efecto:** payload ~71 KB → pequeño + se evitan N×M llamadas a S3 por foto (gran ahorro de latencia en backend).
- **Riesgo:** bajo (aditivo; solo cambia con `?lite=1`). Verificado: v2.js no lee `.photos` de `providerExperiencesCache`.

### IL-4c — `tours` y `vehicles` también cargaban imágenes — ✅ vía `?lite=1`
- **Hallazgo:** `ToursController.getTours` traía imágenes **por cada tour** (`TourImage.getImagesForTour(tour.id)` → **N+1**) + optimización/S3 — explica por qué `tours` tardaba 2–5 s aunque el payload fuera chico. `VehicleController.getVehicles` traía la imagen primaria por vehículo (batch) + URL S3.
- **Hecho:** `?lite=1` en ambos: tours omite la consulta de imágenes por tour (`photos: []`), vehicles omite el batch de imágenes (`imageUrl: ''`). La cotización pide ambos lite. **Verificado: v2.js no usa `.photos`/`.imageUrl` de tours ni vehículos.** Los paneles admin siguen con el modo completo.
- **Efecto:** elimina el **N+1 de imágenes de tours** (gran ahorro de latencia) y el trabajo S3 de vehículos. Riesgo bajo (aditivo).

### B — Caché de servidor para `/rates/active` y `/vehicle-types/active` — ✅ IMPLEMENTADO
- **Hallazgo:** estos endpoints hacen su propia `Parse.Query` en el **controlador** (no usan el método del modelo), así que el caché va en el controlador.
- **Hecho:** `TtlCache` (15 min) sobre el `options` formateado en `RateController.getActiveRates` y `VehicleTypeController.getActiveVehicleTypes`. Se cachean **objetos planos** (sin Parse.Object → sin riesgo de mutación). **Invalidación** en todas las escrituras del mismo controlador: rates (create/update/toggle/delete) y vehicle-types (create/update/delete/toggle).
- **Efecto:** `/rates/active` y `/vehicle-types/active` (~1 s c/u) → ~ms desde la 2ª carga.
- **Riesgo:** bajo. Si alguna escritura ocurriera por otra vía no contemplada, el TTL (15 min) es la red de seguridad. Rates/tipos cambian rara vez.

### IL-5 — Lazy-load de lo no crítico (medio)
- **Qué:** cargar `loadClientSpecificPricing` y catálogos pesados **bajo demanda** (al abrir el modal / seleccionar item) en vez de en `init`. Quitar `?_t=Date.now()` de datos sesión-estática.
- **Riesgo:** medio (timing: verificar dependencias en init).

### IL-6 — No bloquear con el quote — ✅ IMPLEMENTADO (solape)
- **Auditoría:** `this.clientId` viene del DOM (`getClientId`), no del quote. `processServiceItems` se auto-carga lo que necesita (`await ensureToursCache()`), así que **no depende** de que el batch termine. El batch no usa resultados del quote. El re-render final ya existía tras cargar rates.
- **Hecho:** en `init()`, `loadQuoteData()` se dispara **sin `await`** (`const quoteReady = ...`) para **solapar** su red+proceso con el `Promise.all` del batch; se hace `await quoteReady` **después del batch**, antes del re-render/pricing (que sí dependen de los servicios). `clientId` se fija antes del disparo.
- **Efecto:** ~4–5 s que antes iban en serie ahora se solapan con el batch (carga inicial total ≈ max en vez de suma).
- **Riesgo:** bajo-medio. Posible flash de render incompleto (lo corrige el re-render post-batch) y, en el peor caso, un fetch de tours duplicado si `ensureToursCache` corre antes que `loadAllTours` (tours queda cacheado igual). `loadQuoteData` tiene su propio try/catch → `quoteReady` no rechaza en el hueco.

## Orden sugerido
IL-2 (índices) → IL-1 (caché rates) → IL-3 (getQuoteById) → IL-4 (payload) → IL-5 (lazy) → IL-6 (paralelizar quote, con auditoría).
Una fase por PR, midiendo **tiempos por endpoint** y el tiempo total ("Finalizar"/Load) antes/después.

## Verificación
- Capturar tiempos por endpoint (DevTools) y el total antes/después de cada fase.
- Sin regresiones funcionales (precios, fórmulas, render, guardado).
