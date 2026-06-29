# Plan: Rediseño UX de la Calculadora "A Disposición"

**Estado:** Pendiente de validar con cliente (Michelle) antes de implementar.
**Vista:** `/dashboard/admin/a-disposicion`
**Archivo:** `src/presentation/views/dashboards/admin/a-disposicion.ejs`
**Rama sugerida:** crear desde `development` cuando se retome.

---

## Contexto / decisiones ya tomadas

- La página tiene **dos bloques** y **ambos se quedan en la misma página**:
  1. **Calculadora de Servicios por Horas** (visible para todos) — Michelle pidió que la gente pueda calcular/ver precios. Es **solo consulta** (no guarda ni agrega a cotización).
  2. **Administrar Precios por Hora** (CRUD, **solo admin**) — se queda donde está (no se separa a price-settings).
- Solo se rediseña la **calculadora**. El CRUD de precios no se toca (salvo que ya quedó en paleta salvia).
- **Colores ya migrados a marca** (salvia): el header de la calculadora usa `var(--brand-gradient)` y el hover del breadcrumb `var(--brand-primary-active)`. (Hecho en rama `feature/admin-theme-2`.)

## Problemas de UX actuales (calculadora)

1. **Wizard de 4 columnas con revelado secuencial** (Paso 1 Tarifa → Paso 2 Vehículo → Fotos → Paso 3 Datos) con placeholders ("Selecciona tarifa primero" / "Completa pasos anteriores") que gastan espacio y se sienten lentos para algo que debe ser consulta rápida.
2. La columna **"Fotos"** (carrusel) es decorativa y ocupa ~25% del ancho.
3. El **Total** (lo que la gente busca) está abajo, en tarjeta, compitiendo con la rejilla estática de descuentos.

## Diseño aprobado (a implementar)

**Estimador rápido con resultado protagonista, usando pills (NO dropdowns).**
Razón: hay pocas tarifas y pocos tipos de vehículo → pills (todo visible, un clic) y consistente con el theme.

Layout objetivo:
```
┌─ Calculadora de Servicios por Horas ─────────────────────────────┐
│  Tarifa:  [pills salvia]                                          │
│  Vehículo:[pills salvia]   (se habilitan al elegir tarifa)        │
│  Vehículos [2]   Horas [4]    Moneda [pills]   Pago [pills]       │
├───────────────────────────────────┬──────────────────────────────┤
│  (miniatura del vehículo + specs) │   TOTAL  $X,XXX MXN  (grande) │
│                                   │   Base $… · Descuento −10%     │
│                                   │   ⓘ ver tabla de descuentos    │
└───────────────────────────────────┴──────────────────────────────┘
```

Reglas del rediseño:
1. **Pills para Tarifa y Vehículo** (salvia, `btn-outline-primary` o pill de marca). Vehículo se **habilita/deshabilita** (no aparece/desaparece con placeholders).
2. **Moneda y Pago**: compactos; pueden ser pills también (2–3 opciones) para consistencia, o selects chicos.
3. **Total = héroe**: grande, a la derecha, **actualiza en vivo** con cada cambio (ya hay lógica de cálculo; reutilizarla).
4. **Descuento contextual**: mostrar el aplicado inline ("16+ horas → −10% aplicado") + la **tabla completa en un popover/ⓘ** (en vez de media fila estática).
5. **Fotos como apoyo**: miniatura del vehículo seleccionado junto a specs, no columna dedicada (quitar/encoger el carrusel).
6. **Compacto y responsive**: en móvil apila limpio, menos scroll.

## Pendiente de confirmar con el cliente

- [ ] ¿Agregar botón **"Copiar estimado"** (copia el total al portapapeles para pegar en correo/chat)? Útil porque es solo consulta.
- [ ] ¿Moneda/Pago como pills o selects chicos?
- [ ] ¿La miniatura de foto aporta o se puede quitar del todo?

## Notas de implementación

- Reutilizar la lógica de cálculo existente (rate × vehículo × horas × descuentos + redondeo efectivo). Solo cambia la **presentación/markup**, no el cálculo.
- Mantener el **desglose administrativo (efectivo)** que hoy ve admin/superadmin.
- No tocar el bloque CRUD "Administrar Precios por Hora".
- Usar variables de marca (`var(--brand-*)`), nada de hex naranja/ámbar.
- Verificar que el EJS compila tras los cambios.
