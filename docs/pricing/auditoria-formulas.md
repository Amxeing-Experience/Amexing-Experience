<!-- Created by Denisse Maldonado -->
# Auditoría de fórmulas de cotización (fase de corrección)

Convierte el reporte vago del cliente ("muchos errores de cálculo") en una **lista precisa** con los
números **actuales exactos** (generados por el motor `pricingEngine`). Para cada punto: marcar si está
**correcto** o, si no, el **valor correcto esperado**. Cada corrección se hará en el motor (una sola vez,
con test golden actualizado, propagando a builder + PDF + backend).

Leyenda: 🔴 sospecha fuerte de bug · 🟡 a confirmar · ⚪ probablemente correcto (confirmar).

---

## 1. 🔴 Recargo por forma de pago — DOS modelos distintos conviviendo

Sobre una base de **$1,000**:

| Contexto | efectivo | transferencia | tarjeta |
| :-- | --: | --: | --: |
| Builder de cotizaciones (rates por forma de pago) | 1,000 | **1,030** (3%) | **1,050** (5%) |
| DataTables / facturas / reportes (`pricingHelper`, 21.09% único) | 1,000 | **1,210.90** | **1,210.90** |

El builder cobra 3%/5% según el rate vigente; otros contextos cobran un **21.09% fijo hardcodeado**.
Tú confirmaste que "siempre es con el rate correspondiente" → **el 21.09% en DataTables/facturas estaría mal.**

**Pregunta:** ¿confirmamos que TODOS los contextos deben usar transferRate/agencyRate vigentes (3%/5%) y
eliminamos el 21.09%? ¿O hay contextos donde el 21.09% sí aplica?

---

## 2. 🔴 Descuento de A-Disposición — base vs. total con recargo

Ejemplo: $500/h × 10h × 2 vehículos, transferencia 3%. Descuento por volumen (10h) = 5%.

| Concepto | Valor actual |
| :-- | --: |
| Base vehículos (sin recargo) | 10,000 |
| Con recargo 3% | 10,300 |
| Descuento aplicado | **500** (= 5% de 10,000, la base SIN recargo) |
| Subtotal | **9,800** (= 10,300 − 500) |

El descuento se calcula sobre la base **sin recargo** (500) pero se resta del total **con recargo** (10,300).
Es inconsistente: o el descuento debería ser 5% del total con recargo (**515**), o ambos sobre la base.

**Pregunta:** ¿el descuento debe ser sobre la base sin recargo (500) o sobre el total con recargo (515)?

---

## 3. 🟡 Fórmula y redondeo de Greeter

Fórmula actual: `basePrice (760) + hourlyRate (640) × horas`, redondeado a la centena (últimos 2 dígitos
<50 baja, ≥50 sube).

| Duración | Cálculo | Redondeado |
| --: | --: | --: |
| 0.5 h | 1,080 | **1,100** (sube) |
| 1 h | 1,400 | 1,400 |
| 2 h | 2,040 | **2,000** (baja, pierde 40) |

El Excel pedía "revisar la fórmula de greeter/guía".

**Pregunta:** ¿la fórmula (760 + 640×h) y el redondeo a centena son correctos? Si no, ¿cuál es la fórmula
y el redondeo correctos?

---

## 4. 🟡 Redondeo a efectivo (múltiplos de $5 MXN)

| Precio | Efectivo |
| --: | --: |
| 1,234 | **1,230** (baja, pierde 4) |
| 1,237.60 | **1,240** (sube) |

Regla: decimal ≤ 0.50 baja al múltiplo de 5, > 0.50 sube. Aplica solo en efectivo + MXN.

**Pregunta:** ¿es correcto redondear el efectivo a múltiplos de $5 (perdiendo centavos/pesos)? ¿La regla
del corte en 0.50 es la deseada?

---

## 5. ⚪ Redondeo USD (a confirmar)

Multiplos de 5; termina en 3 u 8 sube; resto ≤2.7 baja, >2.7 sube. Ej: 23.45→25, 26.2→25, 27.8→30.
Flujo: 1,000 MXN transferencia 3% a USD@20 → **50 USD**.

NOTA: hoy la moneda USD está **deshabilitada** en el builder (forzado a MXN, listener comentado). El motor
ya soporta USD para cuando se reactive.

**Pregunta:** ¿estas reglas de redondeo USD son las correctas? ¿Se quiere reactivar USD?

---

## 6. ⚪ IVA (16%)

Subtotal 1,000 → IVA 160 → total 1,160. Se aplica al subtotal final de la cotización.

**Pregunta:** ¿16% correcto? ¿Aplica a todos los servicios o hay exentos?

---

## Proceso de corrección

1. El cliente marca cada punto (correcto / valor correcto).
2. Por cada bug confirmado: corregir en `pricingEngine` (un solo lugar) + actualizar su test golden al valor
   correcto + (si aplica) ajustar los call sites.
3. Verificar: tests verdes + smoke test (builder == PDF) del caso corregido.
