<!-- Created by Denisse Maldonado -->
# Motor de cálculo de cotizaciones (`pricingEngine`)

Única fuente de verdad para el cálculo de precios del builder de cotizaciones. Es la **costura #1** del plan de
estabilización (ver `/Users/mrpatch/.claude/plans/excelente-claude-ahora-mi-toasty-garden.md`).

## Por qué existe

Hoy el cálculo está **duplicado y divergente**:
- El front (`quote-services-v2.js`) calcula con `getDisplayPrice()`, que **lee y muta el DOM** (`#priceTypeSelect`) —
  frágil y con efectos secundarios.
- El front usa recargos por tipo de pago (`transferRate`/`agencyRate`); el back `pricingHelper.js` usa un recargo
  único (`paymentSurchargePercentage` ≈ 21.09%) para otros contextos (DataTables/facturas/reportes).
- El redondeo USD se aplica en PDF/back pero no siempre en el builder → **el total del builder ≠ el del PDF**.

`pricingEngine` resuelve esto siendo **puro e isomórfico**: mismas funciones en el navegador (preview) y en Node
(validar al guardar / alimentar el PDF). Sin DOM, sin Parse, sin fetch — **todo entra por parámetros**.

## Modelo de recargo canónico (builder de cotizaciones)

| Forma de pago | Cálculo |
| :-- | :-- |
| efectivo | sin recargo (con redondeo a efectivo opcional en MXN) |
| transferencia | precio × (1 + `transferRate`/100) |
| tarjeta | precio × (1 + `agencyRate`/100) |
| USD (cualquier pago) | (precio con recargo) ÷ `exchangeRate`, luego redondeo USD a múltiplos de 5 |

**Orden de operaciones (definido una sola vez en `applyDisplayPrice`):**
redondeo a efectivo → recargo por forma de pago → conversión de moneda. El IVA (16%) se aplica al subtotal del total
de la cotización (`calcIVA`/`calcTotalWithIVA`), no por servicio.

## API

```js
const PricingEngine = require('../pricing/pricingEngine'); // Node
// o en navegador: window.PricingEngine (UMD, sin build step)

PricingEngine.applyDisplayPrice(mxnPrice, { paymentType, currency, transferRate, agencyRate, exchangeRate, cashRoundingEnabled });
PricingEngine.calculateADisposicion({ baseVehicleCostPerHour, hours, vehicleQuantity, guideRate, paymentType, currency, transferRate, agencyRate, exchangeRate });
PricingEngine.getADisposicionDiscount(hours);
PricingEngine.calcIVA(subtotal, ivaRate?);   PricingEngine.calcTotalWithIVA(subtotal, ivaRate?);
// primitivos: round2, applyUSDRoundingRules, applyCashRounding, applyPaymentRate, applyGreeterRounding
```

## Estado y próximos pasos

- ✅ **Fase 0/1 (este commit):** motor puro + **tests golden** que congelan el comportamiento actual
  (`tests/unit/domain/pricing/pricingEngine.test.js`, 28 casos verdes). Reproduce exactamente las fórmulas de
  `pricing-utils.js`, `quote-services-v2.js` y `pricingHelper.js`.
- ⏭️ **Siguiente:** servir el módulo al navegador (copia estática o ruta) y hacer que `getDisplayPrice()` y
  `calculateADisposicionPricing()` del front **deleguen** en el motor (sin leer DOM) — verificando contra los golden
  tests que no cambian los números.
- ⏭️ Backend: validar IVA/total al guardar la cotización usando este motor.
- ⏭️ Reconciliar el modelo de recargo del builder (`transferRate`/`agencyRate`) con el de `pricingHelper.js`
  (21.09% único) — decisión de negocio pendiente.
