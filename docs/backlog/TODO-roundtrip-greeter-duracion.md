<!-- Created by Denisse Maldonado -->
# TODO — Round-trip: greeter ×2, duración de viaje y regreso distinto

> **Estado:** ✅ CONFIRMADO POR EL CLIENTE (2026-06-30). Implementado en `feature/quotes-ajustes-8`.
> Decisión: **greeter ×2** y **guía ×4** en round-trip (= 2× el valor de one-way); **one-way sin cambio**
> (guía conserva su ×2 base del motor, greeter ×1). Se aplicó en las DOS rutas (guardado
> `collectServiceData` y preview `updateDevPaymentBreakdown`). NO se hizo el punto 2 (guía ×1 en
> one-way) ni el punto 3 (regreso con duración distinta) — el cliente NO los pidió.
> Fecha original: 2026-06-25. Created by Denisse Maldonado.

## Contexto
En transporte **round-trip**, la duración de viaje y los add-ons (greeter/guía) deben reflejar
ida + vuelta. Se hicieron ajustes pero **falta validación del cliente** sobre cómo debe quedar.

## Lo que YA se hizo (en la rama, sin mergear)
- **Greeter ×2 en round-trip** (igual que el transporte): `updateDevPaymentBreakdown` aplica
  `legMultiplier` al greeter (antes ×1 → se sub-cobraba). Se propaga a transferencia/tarjeta vía
  el motor de precios; al separar departure/arrival el total se divide ÷2 → ×1 por pierna.
  - Trazabilidad: `public/dashboards/admin/sections/quote-services-v2.js` → `updateDevPaymentBreakdown` (greeter `* legMultiplier`).
- **Duración estimada de viaje** visible en round-trip + en horas y minutos, con hint
  "Ida y vuelta (×2): total Xh Ym" (solo display, no toca fórmulas).

## Pendiente de confirmar con el cliente
1. **¿El greeter ×2 en round-trip es correcto?** (asumido sí, consistente con el transporte).
2. **Guía en one-way:** hoy el guía aplica su `roundTripMultiplier` (×2) **siempre**, incluso en
   one-way (comportamiento preexistente). ¿Debe el guía seguir el patrón del greeter/transporte
   (×1 en one-way, ×2 en round-trip)? → cambio en la **fórmula del guía** (`pricingEngine.calculateGuideTransportCost`), con cuidado.
3. **Regreso con duración distinta (opción B):** hoy se asume regreso = ida (×2). Si el cliente
   necesita capturar una duración de **vuelta diferente** que afecte guía/greeter, implica dos
   campos (Ida + Vuelta) y ajustar los cálculos a `ida + vuelta` en vez de `×2`. Cambio mayor,
   aparte y bien probado.

## Cuando el cliente conteste
- Si todo OK → mergear la rama.
- Si quiere guía como greeter (×1 one-way) → implementar punto 2.
- Si quiere regreso distinto → implementar punto 3 (opción B).
