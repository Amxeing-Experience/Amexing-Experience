# Historias de usuario — rama `feature/nuevos-ajustes-10`

Desglose de las historias de usuario cubiertas por esta rama.
Cada historia incluye un breve **detalle técnico** para trazabilidad.

> Rol principal: **Administrador**. Alcance: autoguardado de experiencias de
> proveedor/establecimiento, índice unificado de todas las experiencias, y assets
> (banner + video del hero de la página de Transporte).

---

## Épica 1 — Autoguardado de experiencias de proveedor y establecimiento (estrategia B)

**Objetivo:** que las experiencias anidadas en proveedores/establecimientos se guarden
solas (como ya pasa en el editor de experiencias), sin depender del botón "Guardar".

- **US-1.1 — Autoguardado por experiencia**
  Como admin, quiero que cada experiencia (tarjeta) de un proveedor/establecimiento se
  **autoguarde** al cambiar sus campos, para no perder cambios.
  *Detalle:* al cambiar un campo (debounce 900 ms) → `PUT` si ya tiene id, o `POST` si es
  nueva (adopta el id devuelto para no duplicar). Candado anti-carrera por tarjeta.
  Refactor `buildExperienciaPayload` / `buildEstablishmentExperienciaPayload` (por-tarjeta).

- **US-1.2 — Autoguardado de los campos del proveedor/establecimiento**
  Como admin, quiero que nombre/descripción/destino del proveedor/establecimiento se
  autoguarden.
  *Detalle:* `PUT` al proveedor/establecimiento (solo en edición).

- **US-1.3 — Botón "Guardar fotos" por tarjeta**
  Como admin, quiero un botón dedicado para subir las fotos de cada experiencia (son
  pesadas y no deben autoguardarse en cada tecla).
  *Detalle:* `saveExperienciaPhotos` sube vía `PUT` con `photos`; si la tarjeta es nueva,
  primero la autoguarda para obtener id. Aviso "las fotos no se autoguardan".

- **US-1.4 — Bloqueo del botón "Agregar experiencia" hasta guardar el proveedor nuevo**
  Como admin, quiero que en un proveedor/establecimiento **nuevo** no se puedan agregar
  experiencias hasta guardarlo (el autoguardado necesita que exista).
  *Detalle:* `syncAddExperienciaEnabled` deshabilita el botón cuando no hay id; se habilita
  al crear/guardar o al cargar uno existente (con tooltip explicativo).

- **US-1.5 — Aviso de guardado + borrado inmediato**
  Como admin, quiero ver que sí se guardó (toast flotante) y que el borrado persista al
  instante.
  *Detalle:* toast fijo por sección; el botón de eliminar ya borra en backend con loader
  (de la rama anterior), reforzado aquí.

---

## Épica 2 — Índice unificado "Todas las experiencias" (solo lectura)

**Objetivo:** un lugar donde carguen TODAS las experiencias (estándar + de proveedor + de
establecimiento) para descubrir/buscar y saltar al editor correcto.

- **US-2.1 — Lista combinada de las 3 fuentes**
  Como admin, quiero ver en una sola tabla las experiencias **estándar**, de **proveedores**
  y de **establecimientos**.
  *Detalle backend:* `GET /api/experiences/all-combined` (admin) normaliza `Experience`
  (type=Experience) + `ProviderExperiencia` (con su proveedor) en filas con `source`,
  `category`, `destino`, `active`, `parentId`, `parentName`. Ignora huérfanas.

- **US-2.2 — Filtros de origen y categoría + búsqueda**
  Como admin, quiero filtrar por **origen** (Experiencia / Proveedor / Establecimiento) y
  por **categoría**, además de la búsqueda de texto.
  *Detalle:* datos ortogonales (valor crudo para filtrar, etiqueta/badge para mostrar);
  el filtro de categoría se puebla con las categorías presentes en los datos. Filtros en
  `col-md-6`.

- **US-2.3 — Deep-link al editor correcto**
  Como admin, quiero que al abrir una fila me lleve a **su** editor.
  *Detalle:* estándar → `/dashboard/admin/experiences/:id`; proveedor/establecimiento →
  su sección con `?open=<parentId>`, y las tablas de proveedores/establecimientos hacen
  **auto-open** de ese registro al detectar `?open=`.

- **US-2.4 — Nueva pestaña "Todas"**
  Como admin, quiero una pestaña dedicada.
  *Detalle:* pill `?section=all` + `all-experiences-table.ejs`, mismo look (sin panel
  blanco, paleta de marca, categoría/destino como en la lista de experiencias).

---

## Épica 3 — Assets del hero de Transporte

- **US-3.1 — Banner "book vehicles" optimizado**
  Como visitante, quiero que el banner cargue rápido sin verse pixeleado.
  *Detalle:* `book_vehicles.png` (1.2 MB, RGBA) → **`book_vehicles.webp`** (218 KB),
  conservando transparencia; referencia actualizada + `loading="lazy"`.

- **US-3.2 — El video del hero arranca sin esperar la descarga completa**
  Como visitante, quiero ver el video enseguida (no una imagen fija por segundos).
  *Detalle:* `preload="metadata"` → `preload="auto"` + `play()` en `loadeddata` (espeja el
  fix del hero del home); el mp4 ya tiene faststart.

- **US-3.3 — Poster nítido**
  Como visitante, quiero que el instante inicial no se vea pixeleado.
  *Detalle:* nuevo `video_tesla_poster.webp` extraído del **frame real del video** (evita el
  poster escalado desde una fuente menor); transición poster→video sin salto.

---

_Documento generado como parte de la rama `feature/nuevos-ajustes-10`._

Created by Denisse Maldonado
