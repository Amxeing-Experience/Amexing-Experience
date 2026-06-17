<!-- Created by Denisse Maldonado -->
# Migración al motor de cálculo (el "árbol de nodos")

Objetivo: que **todos** los nodos de costo (vehículo, tiempo de espera, guía/chofer,
greeter, vehículos adicionales, descuentos, recargos, moneda, IVA) se calculen dentro del
motor único (`src/domain/pricing/pricingEngine.js`), de modo que builder, validación backend
y PDF compartan **una sola fuente de verdad**. Hoy el motor era solo la capa final (recargo +
redondeo + moneda + IVA) y un nodo suelto (A-Disposición) que ni el front ni el back usaban.

## Reglas de negocio vigentes (decisión del cliente)

- **Recargo uniforme:** el recargo por forma de pago (transferencia/tarjeta) se aplica a
  **TODOS** los nodos, **incluidos guía/chofer y greeter**. (Antes guía/greeter quedaban
  exentos; se cambió a petición del cliente.) En la práctica:
  `total_forma_pago = total_efectivo × (1 + %)`.
- **Vehículo principal de transporte = siempre 1.** El campo "Cantidad" no multiplica el
  vehículo principal; para varios vehículos se usan **vehículos adicionales** (siempre
  desglosados).
- **A-Disposición:** la opción de chofer se renombró a **"Incluir Guía"** (solo etiqueta; el
  id/rate internos siguen igual). Se agregó **"Incluir Greeter"**: mismo cálculo que transporte
  (base + tarifa/h × horas), con recargo, y se suma **después** del descuento por volumen (el
  greeter no se descuenta). Persiste como `includeGreeter`. Guía y greeter son **mutuamente
  excluyentes**.
- **A-Disposición — vehículos adicionales:** se pueden agregar vehículos adicionales de **tipo y
  segmento distintos** (cada fila: segmento + vehículo, con su **tarifa/hora**). Cada uno =
  `tarifa/h × horas`, con recargo, y **entra al descuento** por volumen (es tiempo de vehículo).
  La "Cantidad" sigue siendo solo del vehículo principal. Persiste como
  `aDisposicionAdditionalVehicles: [{ vehicleTypeId, rateId, hourlyRate, ... }]`.

## Estado por tipo de servicio

| Tipo | Nodos en el motor | Front conectado | Notas |
| :-- | :-- | :-- | :-- |
| **Transporte** | ✅ vehículo · espera · guía/chofer · greeter · vehículo adicional · extras | ✅ ruta principal **y** fallback | **HECHO** (ver abajo) |
| **Tours (con vehículos)** | ✅ vehículo · guía · vehículo adicional · extras (reusa `composeServiceNodes`) | ✅ `calculateVehicleTourDevBreakdown` usa el motor | **HECHO** |
| **A-Disposición** | ✅ vehículo × horas × cantidad · guía · **greeter (add-on)** · descuento por volumen · recargo · moneda | ✅ `calculateADisposicionPricing` delega al motor | **HECHO** |
| **Experiencias** | ✅ recargo vía `composeServiceNodes` (1 nodo: total base) | ✅ guardado + desglose | **HECHO** (sin duración; ver abajo) |
| **Walking tours** | ✅ recargo vía `composeServiceNodes` (1 nodo: total base) | ✅ desglose + fallback | **HECHO** (tiers/override en baseTotal) |
| **Concepto** | ✅ recargo vía `composeServiceNodes` (1 nodo: unitario + por persona) | ✅ guardado + dev prices + desglose | **HECHO** (fix por-persona + C2) |
| Backend (validar al guardar) | 🟡 log-only | `updateServiceItems` verifica con el motor | Observa y loggea divergencias (subtotal vs Σ subconcepts; total = subtotal+IVA; total por-subconcept vs pricesByType[formaPago]); NO cambia ni bloquea. Recálculo autoritativo desde catálogo = capa futura |

## Transporte — qué se hizo (1er nodo del árbol)

Funciones nuevas en el motor (puras, con golden tests en
`tests/unit/domain/pricing/pricingEngine.test.js`):

- `calculateGreeterPrice({ durationMinutes, basePrice, hourlyRate })` — `base + porHora × horas`
  (duración 0 → base). Sin recargo.
- `calculateGuideTransportCost({ durationMinutes, guideRate, roundTripMultiplier, minimumCharge, componentsCost })`
  — fórmula simple `horas × multiplicador × tarifa`, respeta cargo mínimo, y soporta el
  evaluador avanzado (`componentsCost`). Duración 0 → 0. Sin recargo.
- `composeServiceNodes({ transferRate, agencyRate, nodes:[{key, efectivo, surcharge}] })`
  — compone los nodos y aplica la **regla de recargo en un solo lugar**: vehículo, espera y
  vehículos adicionales **sí** reciben recargo; guía y greeter **no**. Devuelve los tres
  totales (efectivo/transferencia/tarjeta) + el desglose por nodo.

Front reconectado (`public/dashboards/admin/sections/quote-services-v2.js`):

1. `calculateGuideTransportCost` y `calculateGreeterPrice` ahora **resuelven caché/config** y
   **delegan la fórmula al motor** (con fallback idéntico si el motor no cargó).
2. El bloque de desglose (`updateDevPaymentBreakdown`) arma los nodos en efectivo y llama a
   `PricingEngine.composeServiceNodes`; de ahí salen `_transportBreakdownTotals` (lo que se
   guarda en `pricesByType`).
3. El **fallback** de `collectServiceData` (al editar sin recalcular) también pasa por el motor.

### Corrección de bug encontrada al migrar
El **fallback** de `collectServiceData` aplicaba el recargo al total **completo, incluyendo
guía y greeter** — divergía de la ruta principal y **sobre-cobraba** transferencia/tarjeta
cuando el servicio tenía guía o greeter. Al enrutarlo por el motor, ambos caminos ahora
coinciden (guía/greeter sin recargo). *Único cambio de valor de esta fase, y es a favor de la
regla correcta.*

## A-Disposición — qué se hizo (2º nodo conectado)

`calculateADisposicionPricing` (front) era una réplica inline de `calculateADisposicion` del
motor (el del motor se modeló sobre ella). Ahora **delega al motor**: resuelve la moneda del
DOM y llama a `PricingEngine.calculateADisposicion({ baseVehicleCostPerHour, hours,
vehicleQuantity, guideRate, paymentType, currency, transferRate, agencyRate, exchangeRate,
cashRoundingEnabled })`, con fallback idéntico si el motor no cargó. Todos los callers
(incluido el que arma `_aDisposicionBreakdownTotals`) usan ahora el motor. Mismos valores
(ya cubiertos por los golden tests de a-disposición).

## Tours con vehículos — qué se hizo (3er nodo conectado)

`calculateVehicleTourDevBreakdown` calculaba por forma de pago con `getPaymentMultiplier`
(= `1 + rate/100`), guía sin recargo — misma forma que transporte. Ahora precomputa los nodos
en efectivo (vehículo · guía · vehículo adicional · extras) y **reusa
`PricingEngine.composeServiceNodes`** (con fallback). El texto del desglose queda igual; los
totales (`pricesByType` los parsea `collectServiceData` del texto) salen del motor.

## Experiencias — qué se hizo (4º nodo conectado)

`collectServiceData` (precio guardado) y el desglose ahora arman el total base
(adultos·niños·sin-alcohol × precio) y aplican el recargo vía
`PricingEngine.composeServiceNodes` (un solo nodo `base`, con recargo).

**Fix de valor (decisión del cliente):** el **fallback de precio de niño/sin-alcohol → precio
de adulto** (E2) estaba solo en `calculateServicePrice` (preview); ahora también en el precio
**guardado** y el desglose (`childPrice || adultPrice`, igual sin-alcohol). Antes el guardado
cobraba $0 por niño/sin-alcohol cuando faltaba ese precio (divergía del preview).

**Duración:** se decidió dejar experiencias **plano** (por persona, sin duración). Hoy no hay
campo de duración para experiencias y el `× duration` de `calculateServicePrice` es no-op
(`service.duration` nunca se setea → `|| 1`). Sin cambio.

## Walking tours — qué se hizo (5º nodo conectado)

En la capa de recargo, walking es como experiencias: `baseTotal × recargo`. Toda la complejidad
(tiers, varios grupos, override por-grupo, override de total manual, USD→MXN) queda en calcular
`baseTotal`; el recargo por forma de pago ahora pasa por `PricingEngine.composeServiceNodes`
(un nodo `base`) en el desglose y en el fallback de `collectServiceData`. El texto del desglose
(por grupo o manual) queda igual. Sin cambio de valores.

## Concepto — qué se hizo (6º nodo conectado) + cierre de C2

Concepto tiene dos precios: **unitario** (`conceptoClientPrice`) y **por persona**
(`conceptoPricePerPerson` × total de personas). El recargo siempre aplica (C1, checkbox oculto
y forzado).

**Fix de valor (decisión del cliente):** el precio **guardado** (`collectServiceData`) y la ruta
de dev prices (`updateDevPaymentPrices`) **omitían el por-persona** — solo guardaban el unitario,
divergiendo del desglose/preview. Ahora las tres rutas (guardado, dev prices, desglose) calculan
`base = unitario + personas × porPersona` y aplican el recargo vía
`PricingEngine.composeServiceNodes`. Esto **cierra la deuda C2** (las dos rutas dev ya no divergen).

## Desglose del servicio unificado (espejo del dev breakdown)

`updateServicePriceBreakdown` (lo que ve el cliente) recalculaba por su cuenta en experiencia y
concepto, divergiendo del dev breakdown (la fuente de verdad vía el motor). Ahora **todos los
tipos espejean el dev breakdown** con un solo helper `collectServiceBreakdownItemsFromDev()`:

- **Convención única** (decisión del cliente): cada renglón ya viene **con el recargo aplicado**,
  **sin** línea de "Recargo" aparte. Se unificó en los dev breakdowns de transporte, experiencia
  y concepto (a-disposición y walking ya cumplían).
- Experiencia y concepto pasan a espejar (antes recalculaban). Transporte y a-disposición ya
  espejeaban; walking y vehicle tour espejean por sus propias funciones.
- **Garantía global contra el "una interacción atrás":** `updateServicePriceBreakdown` refresca el
  dev breakdown **al inicio, para TODOS los tipos** (antes de los early-returns de tour). Así el
  desglose siempre espeja datos frescos **sin depender del orden** en que cada uno de los ~57
  listeners llame. (Verificado sin recursión: ni `updateDevPaymentBreakdown` ni las funciones de
  tour llaman de vuelta a `updateServicePriceBreakdown`.) Aun así, los handlers clave también se
  ordenaron dev→service (guía/greeter, vehículo adicional).
- Bugs reportados resueltos: experiencia con niño/sin-alcohol sin precio (salen las 3 líneas al
  precio de adulto); vehículo adicional de transporte aparece en el desglose al seleccionarlo.

Resultado: desglose mostrado == dev breakdown == precio guardado, para todos los tipos, siempre
calculado por el motor único.

**Cuadre de centavos (cosmético):** los renglones se muestran redondeados, así que la suma de la
columna podía quedar a 1 centavo del Total (que es el autoritativo/cobrado). `reconcileBreakdownItemsToTotal`
absorbe ese residual (solo si es ≤ $1) en el último renglón **positivo** (no toca descuentos), en
los tres caminos de render (principal, walking, vehicle tour). El Total no cambia; solo cuadra la columna.

## Pendientes diferidos

- **A-Disposición — precio por-vehículo "baila por centavos" al subir la cantidad:** causado por
  el redondeo a efectivo (`applyCashRounding`) aplicado al **total agregado** y luego dividido
  entre la cantidad para el renglón por-vehículo. El total siempre queda en múltiplos de $5; solo
  el renglón unitario se ve raro. **Decisión de producto pendiente:** ¿el redondeo a $5 va sobre
  el total o sobre el precio por-vehículo?

## Siguiente
- Migrar experiencias (por persona × duración), walking (tiers), concepto (cliente + por persona).
- Validación de total en backend con el mismo motor al guardar.
- Barrido del desglose/display (los pendientes de arriba).
