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
