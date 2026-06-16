<!-- Created by Denisse Maldonado -->
# Migración al motor de cálculo (el "árbol de nodos")

Objetivo: que **todos** los nodos de costo (vehículo, tiempo de espera, guía/chofer,
greeter, vehículos adicionales, descuentos, recargos, moneda, IVA) se calculen dentro del
motor único (`src/domain/pricing/pricingEngine.js`), de modo que builder, validación backend
y PDF compartan **una sola fuente de verdad**. Hoy el motor era solo la capa final (recargo +
redondeo + moneda + IVA) y un nodo suelto (A-Disposición) que ni el front ni el back usaban.

## Estado por tipo de servicio

| Tipo | Nodos en el motor | Front conectado | Notas |
| :-- | :-- | :-- | :-- |
| **Transporte** | ✅ vehículo · espera · guía/chofer · greeter · vehículo adicional · extras | ✅ ruta principal **y** fallback | **HECHO** (ver abajo) |
| Tours (con vehículos) | ⚪ pendiente | parcial (solo recargo display) | base + vehículo adicional siguen inline |
| **A-Disposición** | ✅ vehículo × horas × cantidad · guía · descuento por volumen · recargo · moneda | ✅ `calculateADisposicionPricing` delega al motor | **HECHO** |
| Experiencias | ⚪ pendiente | inline | por persona × duración |
| Walking tours | ⚪ pendiente | inline | tiers / varios grupos |
| Concepto | ⚪ pendiente | inline | precio cliente + por persona |
| Backend (validar al guardar) | ❌ | — | hoy es passthrough; debe re-correr el motor |

## Transporte — qué se hizo (1er nodo del árbol)

Funciones nuevas en el motor (puras, con golden tests en
`tests/unit/domain/pricing/pricingEngine.test.js`):

- `calculateGreeterPrice({ durationMinutes, basePrice, hourlyRate })` — `base + porHora × horas`
  (duración 0 → base). Sin recargo.
- `calculateGuideTransportCost({ durationMinutes, guideRate, roundTripMultiplier, minimumCharge, componentsCost })`
  — fórmula simple `horas × multiplicador × tarifa`, respeta cargo mínimo, y soporta el
  evaluador avanzado (`componentsCost`). Duración 0 → 0. Sin recargo.
- `calculateTransport({ transferRate, agencyRate, nodes:[{key, efectivo, surcharge}] })`
  — compone los nodos y aplica la **regla de recargo en un solo lugar**: vehículo, espera y
  vehículos adicionales **sí** reciben recargo; guía y greeter **no**. Devuelve los tres
  totales (efectivo/transferencia/tarjeta) + el desglose por nodo.

Front reconectado (`public/dashboards/admin/sections/quote-services-v2.js`):

1. `calculateGuideTransportCost` y `calculateGreeterPrice` ahora **resuelven caché/config** y
   **delegan la fórmula al motor** (con fallback idéntico si el motor no cargó).
2. El bloque de desglose (`updateDevPaymentBreakdown`) arma los nodos en efectivo y llama a
   `PricingEngine.calculateTransport`; de ahí salen `_transportBreakdownTotals` (lo que se
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

## Siguiente
- Migrar tours (vehículo + adicional), experiencias (por persona × duración), walking (tiers),
  concepto (cliente + por persona) como nodos del motor.
- Validación de total en backend con el mismo motor al guardar.
