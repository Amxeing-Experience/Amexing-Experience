<!-- Created by Denisse Maldonado -->
# Auditoría de fórmulas (PR 2): Experiencias · Walking tours · Concepto

Continuación de `auditoria-formulas.md`. Mismos pasos: para cada punto, marcar **correcto** o el
**valor/regla correcta**. Cada corrección se hará en el motor (un solo lugar, con golden test).

Leyenda: 🔴 bug confirmado · 🟡 a confirmar (regla de negocio) · ⚪ robustez/refactor (valor hoy OK).

---

## EXPERIENCIAS

Fórmula actual: `total = (adultos×precioAdulto + niños×precioNiño + sinAlcohol×precioSinAlcohol) × duración`,
luego recargo por forma de pago sobre el total. (quote-services-v2.js: `calculateServicePrice`)

### E1. ✅ NO es bug (verificado)
Confirmado con el cliente: **las experiencias no tienen precio de cliente** (intencional). Y los **transportes SÍ
aplican precio de cliente** por otra ruta: `prices-by-route` pasa `clientId` (quote-services-v2.js:12940) y el backend
`getPricesByRoute` consulta `ClientPrices` con `itemType: 'SERVICES'` (ServicesController.js:3936+). El `'TOUR'`
hardcodeado del front es solo el cache de tours. Sin cambios.

### E2. ✅ RESUELTO — fallback a precio de adulto
Decisión del cliente: si falta `price_child`/`price_no_alcohol`, usar el **precio de adulto**. Corregido en
`calculateServicePrice` (`childPrice = service.childPrice || adultPrice`, igual sin-alcohol).

### E3. ⚪ Semántica de duración (confirmar)
Los precios por persona se **multiplican por la duración**. Ej.: 2 adultos @500, 1.5h → (1,000)×1.5 = 1,500.
**Pregunta:** ¿el precio por persona se multiplica por horas, o el precio ya es por toda la experiencia (duración=1)?

**Worked example (E):** 2 adultos @500 + 1 niño @300, 1.5h → efectivo **1,950**; transferencia 2% → **1,989**.

---

## WALKING TOURS

Fórmula actual: asigna grupos por *tiers* (greedy, ej. 25 personas → 1 grupo de 25 en el tier que aplica),
`base = Σ(precio_tier × horas)`, luego recargo por forma de pago **sobre el total**. (`calculateWalkingTourGroups`/`getWalkingTourPrice`)

### W1. ✅ RESUELTO — el manual es la base en efectivo y se le aplica recargo
Decisión del cliente: el precio manual es la **base en efectivo**; el cálculo le agrega el recargo correspondiente.
Hallazgo: el override **por grupo ya lo hacía bien** (base por tier × recargo). El gap real era el override de
**total manual**, que ignoraba el manual y calculaba de los tiers. Corregido: en total-override la base = precio
manual y se aplican los recargos (efectivo/transferencia/tarjeta) encima.

### W2. ✅ RESUELTO con W1
El override por grupo ya aplicaba recargo en los totales por forma de pago (`_walkingTourBreakdownTotals`, que es lo
que se guarda). El total-override ahora también. Guardado == mostrado.

**Worked example (W):** tiers, 25 personas, 3h, base 4,800 → transferencia 5% → **5,040**. Override manual 2,500 →
queda **2,500** (sin recargo).

---

## CONCEPTO

Fórmula: `base = precioCliente + (totalPersonas × precioPorPersona)`, luego recargo por forma de pago.
Tiene un toggle único `conceptoApplySurcharges`. (`updateConceptoServicePrice` / dev breakdown)

### C1. ⚪ Toggle de recargos exclusivo de concepto (confirmar intención)
Solo concepto tiene un checkbox para **aplicar o no** el recargo por forma de pago; los demás tipos siempre lo
aplican. Probablemente intencional (negociación con cliente).
**Pregunta:** ¿es correcto que concepto pueda desactivar el recargo y los demás no?

### C2. ⚪ Dos rutas de cálculo (robustez, valor hoy correcto)
`updateDevPaymentPrices` (sin por-persona) y `updateDevPaymentBreakdown` (con por-persona) calculan concepto por
caminos distintos; hoy dan el mismo número, pero pueden divergir. Además hay nombres de variable confusos
(`transferenciaBase` se usa para tarjeta; el valor es correcto por coincidencia). Migrar concepto al motor lo
unifica. *No es bug de valor; es deuda.*

**Worked example (C):** precioCliente 1,000 + 3 personas ×100, transferencia 2.5% → **1,332.50**; tarjeta 5% → **1,365**.

---

## Resumen de prioridad

| # | Tipo | Severidad | Necesita decisión del cliente |
| :-- | :-- | :-- | :-- |
| E1 | Experiencias client prices | ✅ no bug | Cerrado: experiencias sin client price (intencional); transportes sí aplican vía prices-by-route |
| E2 | Experiencias: niño/sin-alcohol = $0 | ✅ resuelto | Fallback a precio de adulto |
| W1 | Walking: manual sin recargo | ✅ resuelto | Manual = base efectivo + recargo (total-override corregido) |
| W2 | Walking: guardado≠mostrado | ✅ resuelto | Con W1 (por-grupo ya estaba bien) |
| E3/C1 | Semántica duración / toggle concepto | ⚪ | confirmar intención (no urgente) |
| C2 | Concepto: 2 rutas + nombres confusos | ⚪ | se resuelve al migrar al motor |

## Proceso
1. El cliente confirma cada punto (correcto / regla correcta).
2. Por cada confirmado: corregir en `pricingEngine` (migrando walking-tier / experience-per-person / concepto al
   motor) + golden tests + smoke test.
