# Historias de usuario — rama `feature/nuevos-ajustes-9`

Desglose de todas las historias de usuario cubiertas por los cambios de esta rama.
Cada historia incluye un breve **detalle técnico** para trazabilidad.

> Rol principal: **Administrador** del panel (crea/edita experiencias y proveedores).
> Alcance: editor de experiencias, desglose de tarifas, autoguardado, versionado de
> precio, tabla de experiencias y borrado de experiencias de proveedor/establecimiento.

---

## Épica 0 — Rediseño base del editor y nuevo flujo de servicios (commit `3c4b860`)

**Objetivo:** modernizar el editor de experiencias y sentar las bases del alta de servicios.

- **US-0.1 — Hero editable + reorganización de paneles**
  Como admin, quiero editar **Tipo, Destino y Descripción** en un hero, y tener los
  ajustes agrupados en paneles claros: **Tarifas**, **Términos y condiciones**
  (mínimo privado, buy-out, cancelación) y **Logística** (Tiempos + Disponibilidad).
  *Detalle:* se eliminó el panel de Destino (movido al hero) y se fusionaron Tiempos +
  Disponibilidad en "Logística".

- **US-0.2 — Catálogo como drawer**
  Como admin, quiero abrir el **catálogo** como panel lateral (offcanvas) para arrastrar
  servicios sin perder de vista la lista.

- **US-0.3 — "Entradas" como tipo de servicio propio**
  Como admin, quiero agregar **Entradas** (boletos de acceso) como un tipo de servicio,
  con selector de boleto, precio automático y persistencia.

- **US-0.4 — Transporte por cantidad de vehículos (por capacidad)**
  Como admin, quiero que el transporte calcule por **cantidad de vehículos** según la
  capacidad de pax, con opción de combinaciones.

- **US-0.5 — Alta progresiva con chips por tipo**
  Como admin, quiero un botón por **tipo de servicio** (Catálogo/Experiencia/Tour/
  Traslado/Concepto/Entradas) para agregar directo.

- **US-0.6 — Barra general de Guía/Chofer + duración; capacidad Mín/Máx única**
  Como admin, quiero una **guía/chofer generales** para toda la experiencia y una
  **capacidad Mín/Máx** que alimente el desglose por pax.

> Nota: la Épica 0 quedó en el commit `3c4b860`; las Épicas 1–6 en `ae4e703`. El PR
> abarca ambos commits.

---

## Épica 1 — Alta y edición de servicios 100% inline (editor de experiencias)

**Objetivo:** aprovechar el espacio de cada fila y quitar el modal; cada servicio se
edita en su propia fila.

- **US-1.1 — Concepto y Entradas inline**
  Como admin, quiero agregar/editar **Concepto** y **Entradas** directo en la fila
  (sin abrir panel), para capturar rápido conceptos sueltos y boletos.
  *Detalle:* el chip crea la fila; `Entrada` es un dropdown que autollena el precio;
  `Concepto` es texto libre. Sin badges sobrantes.

- **US-1.2 — Experiencia inline**
  Como admin, quiero elegir la experiencia por **dropdown** y capturar duración y
  precios (**Adulto/Niño/Sin alcohol**) en la misma línea.
  *Detalle:* al elegir la experiencia se autollenan concepto, precios y duración.
  Fila 1: Experiencia · Duración · Incluye. Fila 2: precios.

- **US-1.3 — Traslado inline (ruta completa)**
  Como admin, quiero armar el traslado inline: **Origen → Destino**, **Segmento**,
  **vehículo por capacidad**, duración y opciones (Redondo/Greeter), sin panel.
  *Detalle:* datalists de POIs compartidos; reusa el picker de vehículos de la tarjeta
  (`card-veh-picker`) con debounce en el refetch de ruta.

- **US-1.4 — Tour inline (vehículo y a pie)**
  Como admin, quiero editar el tour inline: **con vehículo** (segmento + picker) o
  **a pie** (precios por grupo S/M/L), según el tour elegido.
  *Detalle:* fork por `isWalkingTour`; se persiste `tourBase` (base por vehículo) para
  no perder el precio unitario al recargar; migración de tours viejos (chofer).

- **US-1.5 — Duración unificada en horas + minutos**
  Como admin, quiero que **Experiencia, Tour y Traslado** usen el mismo control de
  duración `[h] [m]`, para consistencia.
  *Detalle:* `renderInlineDurationHM`; la fuente de verdad sigue siendo `service.hours`.

- **US-1.6 — Guía y Chofer por servicio (con global)**
  Como admin, quiero ver y marcar **Guía**/**Chofer** en cada servicio, y que el
  **global** de arriba los aplique a todos, para saber de un vistazo qué incluye cada uno.
  *Detalle:* checkboxes `includeGuide`/`includeChofer` en todos los tipos; el toggle
  general marca/desmarca en todos y repinta. Traslado cobra Guía; Tour cobra Chofer.

- **US-1.7 — Consistencia visual de las filas**
  Como admin, quiero que "Incluye" (Guía/Chofer) quede alineado a la derecha y las
  filas ordenadas igual en todos los tipos.
  *Detalle:* `ms-auto` en el grupo Incluye; fuentes de inputs/labels más grandes
  (excepto el picker de vehículos).

---

## Épica 2 — Desglose de tarifas

- **US-2.1 — Renombrar y simplificar**
  Como admin, quiero que la sección se llame **"Desglose de tarifas"**, con letra más
  grande, sin icono ni texto explicativo largo ni tags (`por pax`/`por capacidad`/`fijo`).

- **US-2.2 — Columnas Mín · Intermedio · Máx (intermedio editable)**
  Como admin, quiero ver el precio a **Mín**, un **intermedio editable** y **Máx**, para
  simular distintos tamaños de grupo.
  *Detalle:* input de pax en el encabezado intermedio, **acotado a [Mín, Máx]**; se quitó
  el "detalle itemizado" colapsable.

- **US-2.3 — Vehículo por capacidad: prioridad de upgrade**
  Como admin, quiero que al superar la capacidad se sugiera **un solo vehículo de
  capacidad mínima que cubra** antes que **varios** vehículos.
  *Detalle:* `serviceAtPax` prioriza seleccionado→un-vehículo-que-cubra→varios; aplica a
  **Traslado y Tour**; usa caché de ruta / `tourPricesMap` (se recalcula al calentar caché).

- **US-2.4 — Copiar por-persona a Precio Adulto**
  Como admin, quiero un botón que ponga el **por-persona del Máx** en **Precio Adulto**,
  para usarlo como precio de venta.
  *Detalle:* setea `#experienceCost` y dispara su autoguardado; no automático (no pisa
  ediciones manuales).

- **US-2.5 — Inputs de capacidad más anchos**
  Como admin, quiero los campos **Mín/Máx** más anchos y legibles.

---

## Épica 3 — Autoguardado de la experiencia completa

- **US-3.1 — Autoguardar todo (menos imágenes)**
  Como admin, quiero que **toda** la experiencia se autoguarde (nombre, tipo, destino,
  precios, políticas, notas, disponibilidad, guía/chofer general, mín/máx, duración),
  no solo los servicios.
  *Detalle:* `buildExperienceInfoBody` compartido por autosave y guardado manual; PUT
  con debounce; disparado por hero + form + controles de la sección Servicios.

- **US-3.2 — Aviso de guardado visible al hacer scroll**
  Como admin, quiero un **toast flotante** ("Guardando…/Cambios guardados") visible
  aunque esté haciendo scroll.
  *Detalle:* toast `position:fixed` en `<body>`. Se retiró el indicador antiguo de la
  sección de servicios.

- **US-3.3 — Imágenes solo con botón + "Guardar imágenes"**
  Como admin, quiero que las imágenes (pesadas) **no** se autoguarden y tener un botón
  **"Guardar imágenes"** en el panel de Fotos, para no olvidarlas al cambiar de sección.
  *Detalle:* autosave excluye inputs de imagen; `saveImagesOnly` sube portada + fotos
  (asegura borrador si es nueva). Se quitó "(Opcional)" de Fotos y se agregó aviso.

---

## Épica 4 — Versionado de precio explícito

- **US-4.1 — Versionar solo cuando el usuario lo pide**
  Como admin, quiero un **checkbox "Crear nueva versión de precio"**: si no lo marco, el
  precio se actualiza **en el mismo registro** (mismo id); si lo marco, se crea la versión
  histórica.
  *Detalle backend (`updateExperience`):* solo versiona si `createVersion === true`; si
  no, `set('cost')` en el mismo objeto. El autoguardado nunca versiona.

- **US-4.2 — No perder la experiencia al versionar**
  Como admin, quiero que al versionar (nuevo id) el detalle **siga funcionando** y no se
  "pierda" la experiencia.
  *Detalle:* `applyVersionedId` adopta el id nuevo (id de trabajo, builder de servicios y
  URL vía `replaceState`); la lista siempre muestra la versión vigente.

---

## Épica 5 — Tabla de experiencias (lista)

- **US-5.1 — Columnas relevantes**
  Como admin, quiero ver **Categoría** y **Destino** en vez de **Duración** y
  **Mín. Personas**.
  *Detalle:* columna de categoría muestra la etiqueta real vía
  `ExperienceCategories.labelFor` (fetch + redibujo); destino desde `destinationPOI.name`.

- **US-5.2 — Sin panel blanco**
  Como admin, quiero la **pura tabla** sin la tarjeta blanca (como en traslados).
  *Detalle:* se quitó el wrapper `card`/`card-body`, conservando `#experiences-content`.

---

## Épica 6 — Borrado de experiencias de proveedor/establecimiento

- **US-6.1 — El borrado persiste sin depender de "Guardar"**
  Como admin, quiero que al eliminar una experiencia de un proveedor/establecimiento se
  borre **de inmediato** (con confirmación), para que no reaparezca al recargar.
  *Detalle:* el botón hace `DELETE /api/providers/:id/experiencias/:expId` (soft-delete)
  al instante si ya está guardada; si falla, no la quita de la UI y avisa. Se corrigió
  además la reconciliación al guardar en proveedores (corría solo con `length > 0`).

- **US-6.2 — Loader en el botón de eliminar**
  Como admin, quiero ver un **spinner** en el botón mientras borra, para saber que sí
  está pasando algo.

---

_Documento generado como parte de la rama `feature/nuevos-ajustes-9`._

Created by Denisse Maldonado
