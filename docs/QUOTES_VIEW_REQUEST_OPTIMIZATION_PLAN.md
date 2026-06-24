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

## Fase 2 — No re-pedir catálogos por día (bajo riesgo)

Hoy el catálogo completo se carga en init y luego se **vuelve a pedir por día**:
- `loadDayExperiences(dayId)` y `loadDayTours(dayId)` (reconfirmar líneas) re-fetchean en vez de filtrar del catálogo ya en memoria (`experiencesCache` / `toursCache`).

**Acción:** que `loadDayExperiences/loadDayTours` **filtren del cache ya cargado** (cliente-side) en lugar de hacer una nueva llamada. Si necesitan un filtro server-side específico, validar que aporte algo que el cache no tenga.

**Verificación:** al agregar experiencia/tour a un día NO debe aparecer un nuevo request de catálogo en Network.
**Riesgo:** bajo. **Esfuerzo:** bajo.

---

## Fase 3 — Deduplicar `prices-by-route` (bajo-medio)

`/api/services/prices-by-route` se llama en varios flujos (selección de segmento/origen/destino y de nuevo al guardar el servicio), repetido para la misma ruta.

**Acción:**
1. Centralizar la llamada en una función única cacheada por la clave `origen|destino|rateId|clientId`.
2. Reusar el resultado entre el lookup de selección y el guardado, en vez de volver a pedir.
3. Encauzarla por `fetchWithDedup` para que clics rápidos no disparen llamadas paralelas idénticas.

> Nota: ya existe `this.cachedRouteDuration` y `this.transportPriceData` — extender esa idea a un cache por-ruta consistente.

**Verificación:** seleccionar segmento y luego guardar el servicio NO debe generar dos `prices-by-route` para la misma ruta; alternar rápido entre rutas no dispara duplicados paralelos.
**Riesgo:** medio (no romper el flujo de precio/duración). **Esfuerzo:** bajo-medio.

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
