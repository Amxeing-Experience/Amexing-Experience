<!-- Created by Denisse Maldonado -->
# Auditoría de fórmulas (PR 2): Experiencias · Walking tours · Concepto

Continuación de `auditoria-formulas.md`. Mismos pasos: para cada punto, marcar **correcto** o el
**valor/regla correcta**. Cada corrección se hará en el motor (un solo lugar, con golden test).

Leyenda: 🔴 bug confirmado · 🟡 a confirmar (regla de negocio) · ⚪ robustez/refactor (valor hoy OK).

---

## EXPERIENCIAS

Fórmula actual: `total = (adultos×precioAdulto + niños×precioNiño + sinAlcohol×precioSinAlcohol) × duración`,
luego recargo por forma de pago sobre el total. (quote-services-v2.js: `calculateServicePrice`)

### E1. 🔴 Los precios de cliente NO se cargan para experiencias
La carga de ClientPrices está **hardcodeada a `itemType: 'TOUR'`** → para experiencias **nunca** se aplica el
precio especial del cliente (siempre usa el de catálogo). El modelo SÍ soporta `itemType: EXPERIENCES`.
**Pregunta:** ¿las experiencias deben respetar precios por cliente (como tours)? (asumo que sí → es bug)

### E2. 🟡 Sin precio de niño / sin alcohol → se cobra $0 (gratis)
Si la experiencia no tiene `price_child`/`price_no_alcohol`, el cálculo usa **0** (niños/sin-alcohol gratis).
Ej.: 2 adultos @500 + 1 niño sin precio de niño → 1,000 (el niño suma 0).
**Pregunta:** si falta el precio de niño/sin-alcohol, ¿debe usar el **precio de adulto** como fallback, o $0 es correcto?

### E3. ⚪ Semántica de duración (confirmar)
Los precios por persona se **multiplican por la duración**. Ej.: 2 adultos @500, 1.5h → (1,000)×1.5 = 1,500.
**Pregunta:** ¿el precio por persona se multiplica por horas, o el precio ya es por toda la experiencia (duración=1)?

**Worked example (E):** 2 adultos @500 + 1 niño @300, 1.5h → efectivo **1,950**; transferencia 2% → **1,989**.

---

## WALKING TOURS

Fórmula actual: asigna grupos por *tiers* (greedy, ej. 25 personas → 1 grupo de 25 en el tier que aplica),
`base = Σ(precio_tier × horas)`, luego recargo por forma de pago **sobre el total**. (`calculateWalkingTourGroups`/`getWalkingTourPrice`)

### W1. 🟡 Override manual NO lleva recargo (inconsistente entre tipos)
En walking tours, el precio manual se toma **tal cual** (cuenta como efectivo, sin recargo) — esto coincide con el
Excel. PERO en **transporte/A-Disposición el precio manual SÍ lleva recargo**. Hay inconsistencia entre tipos.
**Pregunta:** ¿el precio manual debe contar **siempre como efectivo** (sin recargo) en TODOS los tipos, o debe
llevar recargo? (definir la regla uniforme)

### W2. 🟡 Override por grupo: guardado SIN recargo, mostrado CON recargo
En modo "precio por grupo", el desglose en pantalla aplica recargo a los grupos, pero lo que se **guarda** suma los
precios manuales **sin** recargo → lo guardado ≠ lo mostrado. (depende de la decisión de W1)

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
| E1 | Experiencias: client prices no cargan | 🔴 bug | ¿Experiencias respetan precio por cliente? (sí→fix) |
| E2 | Experiencias: niño/sin-alcohol = $0 | 🟡 | ¿fallback a precio adulto o $0? |
| W1 | Walking: manual sin recargo (inconsistente) | 🟡 | ¿regla uniforme: manual = efectivo o con recargo? |
| W2 | Walking: guardado≠mostrado en override por grupo | 🟡 | (depende de W1) |
| E3/C1 | Semántica duración / toggle concepto | ⚪ | confirmar intención |
| C2 | Concepto: 2 rutas + nombres confusos | ⚪ | se resuelve al migrar al motor |

## Proceso
1. El cliente confirma cada punto (correcto / regla correcta).
2. Por cada confirmado: corregir en `pricingEngine` (migrando walking-tier / experience-per-person / concepto al
   motor) + golden tests + smoke test.
