/**
 * Lista de servicios de una reservación — el renderizador compartido.
 *
 * La pintan tres vistas: el detalle de admin, el de client y el de department_manager. Vivía solo en
 * la plantilla de admin, así que las otras dos se quedaron con un layout de dos columnas de hace
 * varias versiones. Aquí adentro no se toca el DOM ni se suscribe nada: buildHtml() devuelve una
 * cadena y cada vista decide dónde ponerla y qué eventos enlazar. Es lo que permite que el admin
 * enganche el botón de estatus y las otras dos no tengan que saber que existe.
 *
 * El MODELO —qué plazas pide un servicio, qué roles lleva, cómo se cuenta la gente— vive aparte, en
 * serviceListHelpers.js. Aquí solo está el HTML.
 *
 * La sangría de estas funciones se conserva como estaba en la plantilla: sus plantillas literales
 * arrastran esa sangría al HTML que producen, así que redentar cambiaría el render.
 * Created by Denisse Maldonado.
 */

/* eslint-disable indent */
/* global PaymentBreakdownHelpers, ServiceListHelpers */
const ServiceListRenderer = (() => {
  // Contexto de la llamada en curso, que fija buildHtml(): de dónde salen la reservación, el formato
  // de moneda y si esta vista puede asignar. Se guarda aquí en vez de pasarse por parámetro a las
  // treinta funciones porque ninguna de ellas lo modifica: es de solo lectura durante el render.
  let vista = {};

  // La píldora del renglón, solo para los estados que son EXCEPCIÓN.
  //
  // `pending` ("Asignaciones pendientes") y `assigned` ("Asignada") se retiraron. Medido sobre la
  // base: pending es el 67% de los servicios y assigned el 3%, y en 68 de 76 reservaciones TODOS
  // los renglones traían la misma píldora —96% en una de 57 servicios—. Una señal que se prende en
  // casi todo no discrimina nada, y en ámbar hacía ver como advertencia el estado normal de
  // arranque de una reservación.
  //
  // Lo que decían ya lo dicen mejor los círculos de asignación: punteado y pálido = falta, foto o
  // iniciales = cubierto, y por PLAZA en vez de por servicio. `assigned` además podía mentir: el
  // API lo pone en cuanto existe UN chofer, sin mirar vehículos ni plazas extra, así que un
  // traslado de tres vehículos con un chofer se anunciaba "Asignada" con dos plazas pendientes.
  //
  // Completada / Cancelada / Confirmada sí se quedan: son hechos que ningún otro elemento del
  // renglón muestra, y al ser raros la píldora vuelve a saltar. El estado NO cambia: se sigue
  // guardando igual y sigue alimentando el estado general de la reservación y el botón de toggle.
  const SVC_EXCEPTION_STATUSES = new Set(['completed', 'cancelled', 'confirmed', 'in_progress', 'hold']);
  // Etiqueta del día ("Miércoles. Jul 29"). Sigue siendo propia de esta vista: el itinerario arma la
  // suya con los días en inglés, que es una decisión de ese documento y no del modelo.
  const SVC_DOW = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const SVC_MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
      'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  /**
   * Formatea un importe con la moneda de la reservación, delegando en la vista.
   * @param {...*} args - Importe y moneda.
   * @returns {string} Importe formateado.
   * @example
   * formatCurrency(1500, 'MXN') // '$1,500.00'
   */
  const formatCurrency = (...args) => vista.formatCurrency(...args);

    /**
     *
     * @param name
     * @example
     */
    function getInitials(name) {
        if (!name) return '?';
        return name.split(' ').map((w) => w[0]).filter(Boolean).join('')
.substring(0, 2)
.toUpperCase();
    }

    // getServicePriceByTypeGross se retiró de aquí con el precio por servicio: era el precio REAL de
    // la LÍNEA, para no aparentar $0 en un "Pago externo". Sigue en paymentBreakdownHelpers, que lo
    // usan agencia y agente, y el agregado financiero sigue con getServicePriceByType.
    /**
     *
     * @param svc
     * @param paymentType
     * @example
     */
    function getServiceDiscountByType(svc, paymentType) {
        return PaymentBreakdownHelpers.getServiceDiscountByType(svc, paymentType);
    }

    // "Incluye / no incluye" de tours y experiencias, en dos columnas. Las trae el API desde el
    // catálogo (el subconcepto guardado no las tiene), así que pueden faltar, venir vacías o traer
    // entradas en blanco. Mismo formato que el itinerario del cliente.
    /**
     *
     * @param svc
     * @example
     */
    function svcIncludesHtml(svc) {
        const esc = PaymentBreakdownHelpers.escapeHtml;
        /**
         * Limpia una lista del catálogo, que puede venir nula o con huecos.
         * @param {Array} list - Lista cruda.
         * @returns {Array} Lista sin valores vacíos.
         * @example
         * pick(['Guía', null]) // ['Guía']
         */
        const pick = (list) => (Array.isArray(list) ? list.filter(Boolean) : []);
        const yes = pick(svc.includes);
        const no = pick(svc.notIncludes);
        if (!yes.length && !no.length) return '';
        /**
         * Una columna de "incluye" / "no incluye". Se omite entera si no tiene renglones.
         * @param {string} label - Rótulo de la columna.
         * @param {Array<string>} items - Renglones.
         * @param {string} cls - Clase que le da su color.
         * @returns {string} HTML de la columna, o cadena vacía.
         * @example
         * col('Incluye', ['Guía'], 'is-yes')
         */
        const col = (label, items, cls) => (items.length ? `
            <div class="svc-inc-col">
                <div class="svc-inc-lbl">${label}</div>
                <ul class="svc-inc-list ${cls}">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
            </div>` : '');
        return `<div class="svc-inc">${col('Incluye', yes, 'is-yes')}${col('No incluye', no, 'is-no')}</div>`;
    }

    // La foto va ENCIMA de las iniciales, así que si la URL falla quedan las iniciales visibles
    // en vez de un círculo vacío (el patrón anterior alternaba display y dependía del hermano).
    /**
     *
     * @param person
     * @param pick
     * @param extraCls
     * @example
     */
    function svcAvatar(person, pick, extraCls) {
        const esc = PaymentBreakdownHelpers.escapeHtml;
        const name = (person && person.fullName) || '';
        const photo = (person && person.profilePhotoUrl) || '';
        // Sin `pick` la foto conserva su clic para ampliarse; con `pick` el círculo asigna, y una
        // misma zona no puede hacer las dos cosas.
        const img = photo
            ? `<img src="${esc(photo)}"${pick ? '' : ` class="photo-preview-trigger" data-photo="${esc(photo)}" data-name="${esc(name)}"`} onerror="this.remove()">`
            : '';
        return `<span class="svc-av${pick ? ' is-pick' : ''}${extraCls ? ` ${extraCls}` : ''}" ${pick || ''}>${esc(getInitials(name) || '·')}${img}</span>`;
    }

    /**
     *
     * @param vehicle
     * @param pick
     * @example
     */
    function svcVehicleAvatar(vehicle, pick) {
        const esc = PaymentBreakdownHelpers.escapeHtml;
        const name = (vehicle && vehicle.name) || '';
        const photo = (vehicle && vehicle.imageUrl) || '';
        const img = photo
            ? `<img src="${esc(photo)}"${pick ? '' : ` class="photo-preview-trigger" data-photo="${esc(photo)}" data-name="${esc(name)}"`} onerror="this.remove()">`
            : '';
        return `<span class="svc-av svc-av-veh${pick ? ' is-pick' : ''}" ${pick || ''}><i class="ti ti-car"></i>${img}</span>`;
    }

    /**
     *
     * @param icon
     * @param pick
     * @example
     */
    function svcPendingAvatar(icon, pick) {
        return `<span class="svc-av svc-av-pend${pick ? ' is-pick' : ''}" ${pick || ''}><i class="ti ti-${icon}"></i></span>`;
    }

    // Punto del segmento: el color se VALIDA en vez de escaparse, porque entra a un style inline.
  /**
   * Mitad del chofer en una pareja: su círculo, el hueco punteado, o nada.
   * El hueco solo aparece si la plaza OFRECE chofer; un tour sin "Guía + Chofer" muestra únicamente
   * el vehículo, y en «a disposición» el chofer es un renglón de rol.
   * @param {object} pair - Plaza.
   * @param {string} pick - Atributos del selector, o cadena vacía si no es clicable.
   * @returns {string} HTML de la mitad.
   * @example
   * driverHalf({ pending: true, offersDriver: true }, '') // círculo punteado
   */
  function driverHalf(pair, pick) {
    if (pair.driver) return svcAvatar(pair.driver, pick);
    const faltante = (pair.pending || pair.needsDriver) && pair.offersDriver !== false;
    return faltante ? svcPendingAvatar('steering-wheel', pick) : '';
  }

  /**
   * Mitad del vehículo en una pareja: su círculo, el hueco punteado, o nada.
   * @param {object} pair - Plaza.
   * @param {string} pick - Atributos del selector, o cadena vacía si no es clicable.
   * @returns {string} HTML de la mitad.
   * @example
   * vehicleHalf({ pending: true }, '') // círculo punteado
   */
  function vehicleHalf(pair, pick) {
    if (pair.vehicle) return svcVehicleAvatar(pair.vehicle, pick);
    return (pair.pending || pair.needsVehicle) ? svcPendingAvatar('car', pick) : '';
  }

  /**
   * Rótulo de la plaza para el TÍTULO del selector, que una vez abierto es la única pista de cuál se
   * está editando. Con una sola plaza no hace falta: no hay de dónde escoger.
   * @param {object} p - Plaza.
   * @param {boolean} hasPrimaryAdditional - Si la cotización marcó un vehículo adicional.
   * @returns {string} Rótulo, o cadena vacía.
   * @example
   * slotLabelFor({ totalSlots: 2, slotIndex: 0 }, false) // 'Vehículo principal'
   */
  function slotLabelFor(p, hasPrimaryAdditional) {
    if (p.totalSlots <= 1) return '';
    if (p.slotIndex === 0) return 'Vehículo principal';
    if (p.slotIndex === 1 && hasPrimaryAdditional) return 'Vehículo adicional';
    return `Vehículo extra ${p.slotIndex - (hasPrimaryAdditional ? 1 : 0)}`;
  }

  /**
   * Cobertura de la asignación, DERIVADA de las plazas y los roles contratados.
   * Solo la ve la vista de operación: al cliente no le dice nada que falte 1 de 2 por asignar —es
   * trabajo interno— y en cambio le siembra una duda sobre un servicio que ya tiene contratado.
   * Lo que RESALTA es la buena noticia, que hoy es la rara: 226 de 291 servicios están sin asignar,
   * así que pintar el faltante en ámbar reconstruiría el muro de advertencias que quitamos de la
   * píldora de estado. El estado común va callado y el completo salta.
   * @param {number} hechos - Plazas y roles ya cubiertos.
   * @param {number} total - Plazas y roles que pide el servicio.
   * @returns {string} HTML de la etiqueta, o cadena vacía si no hay nada que cubrir.
   * @example
   * coverageBadge(2, 2) // '<span class="svc-cov is-done">…Asignación completa</span>'
   */
  function coverageBadge(hechos, total) {
    if (total === 0) return '';
    if (hechos === total) {
      return '<span class="svc-cov is-done"><i class="ti ti-circle-check"></i>Asignación completa</span>';
    }
    return `<span class="svc-cov">${hechos} de ${total} asignado${total === 1 ? '' : 's'}</span>`;
  }

  /**
   *
   * @param pair
   * @example
   */
    function svcSegmentBit(pair) {
        const esc = PaymentBreakdownHelpers.escapeHtml;
        if (!pair.segmentName) return '';
        const color = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/.test(String(pair.segmentColor || '').trim())
            ? String(pair.segmentColor).trim() : '';
        const dot = color ? `<span class="svc-seg-dot" style="background:${color};"></span>` : '';
        return `${dot}${esc(pair.segmentName)}`;
    }

    // El objetivo del clic es el CÍRCULO, no el renglón: cada avatar representa a una persona o a un
    // vehículo, así que tocar el del chofer para cambiar al chofer es inequívoco. Cada uno abre su
    // propio selector —uno para el chofer, otro para el vehículo— en vez de un panel con los dos.
    //
    // Devuelve los atributos que van DENTRO de la etiqueta del avatar; vacío cuando no se puede
    // asignar, y entonces el avatar queda inerte.
    /**
     *
     * @param ctx
     * @param extra
     * @param title
     * @example
     */
    function svcPickAttrs(ctx, extra, title) {
        if (!ctx || !ctx.canAssign) return '';
        const esc = PaymentBreakdownHelpers.escapeHtml;
        const parts = [`data-service-id="${esc(ctx.serviceId)}"`, 'role="button" tabindex="0"'];
        if (title) parts.push(`title="${esc(title)}"`);
        Object.entries(extra || {}).forEach(([k, v]) => {
            if (v === null || v === undefined || v === '') return;
            parts.push(`data-${k}="${esc(v)}"`);
        });
        return parts.join(' ');
    }

    // Teléfono como enlace, solo si existe.
    /**
     *
     * @param phone
     * @example
     */
    function svcTelLink(phone) {
        const esc = PaymentBreakdownHelpers.escapeHtml;
        return phone ? ` · <a href="tel:${esc(phone)}" class="svc-assign-tel">${esc(phone)}</a>` : '';
    }

    /**
     *
     * @param pair
     * @param ctx
     * @example
     */
    function svcPairRow(pair, ctx) {
        const esc = PaymentBreakdownHelpers.escapeHtml;
        // Lo común a las dos mitades de la pareja: de qué plaza son y dónde escribe.
        const slot = {
            'slot-index': pair.slotIndex,
            'extra-index': pair.extraIndex === null ? '' : pair.extraIndex,
            'slot-label': pair.slotLabel,
        };
        // El círculo del chofer solo existe si la plaza lo ofrece (ver pairOffersDriver): un tour sin
        // "Guía + Chofer" muestra únicamente el vehículo, y en «a disposición» el chofer es un rol.
        //
        // Excepción: si YA hay alguien asignado, el círculo sigue siendo clicable aunque el servicio
        // no lo contrate. La regla es no poder asignar fuera de lo contratado, no quedarse sin poder
        // corregir lo que ya está mal —hay un tour en la base justo así.
        const driverPickable = pair.offersDriver !== false || !!pair.driver;
        const driverPick = !driverPickable ? '' : svcPickAttrs(
ctx,
            { ...slot, 'slot-kind': 'driver', 'current-id': pair.driverId },
            pair.driver ? 'Cambiar chofer' : 'Asignar chofer'
);
        const vehiclePick = svcPickAttrs(
ctx,
            {
 ...slot, 'slot-kind': 'vehicle', 'current-id': pair.vehicleId, 'expected-type': pair.expectedType,
},
            pair.vehicle ? 'Cambiar vehículo' : `Asignar vehículo${pair.expectedType ? ` (${pair.expectedType})` : ''}`
);
        const duo = `<span class="svc-duo">${driverHalf(pair, driverPick)}${vehicleHalf(pair, vehiclePick)}</span>`;
        const attrs = 'class="svc-assign-row"';
        if (pair.pending) {
            // La negrita lleva el tipo esperado; el estado baja a la segunda línea, junto al
            // segmento y a la plaza que ocupa.
            const bits = [];
            const seg = svcSegmentBit(pair);
            if (seg) bits.push(seg);
            bits.push('<span class="svc-pend-txt">Pendiente</span>');
            return `<div ${attrs}>${duo}<div class="svc-assign-meta">
                <div class="n svc-pend-name">${esc(pair.label)}</div>
                <div>${bits.join(' · ')}</div>
            </div></div>`;
        }
        // Una línea por DUEÑO. Antes iba todo en una sola cadena —"Juan Empleado · Audi Clase A" y
        // debajo "Premium · Placas AUDICALSEA · 4423155632"— y con el mismo separador entre cosas de
        // personas y de vehículos no se distinguía de quién era qué. Ahora el teléfono va pegado a
        // quien lo contesta y la placa al vehículo que la lleva; el segmento queda solo al final
        // porque no es de ninguno de los dos: es de la plaza.
        const lines = [];
        if (pair.driver) {
            lines.push(`<div class="n">${esc(pair.driver.fullName)}${svcTelLink(pair.driver.phone)}</div>`);
        } else if (pair.needsDriver) {
            lines.push('<div class="svc-pend-txt">Conductor pendiente</div>');
        }
        if (pair.vehicle) {
            // La placa va en cápsula monoespaciada en vez de con la palabra "Placas" delante: la forma
            // dice que es un identificador, y eso aguanta datos que la palabra tenía que rescatar —de
            // 9 placas capturadas, 5 no parecen placa ("A", "E", "AUDICALSEA") y sin recuadro se leían
            // como parte del nombre del vehículo.
            const plate = pair.vehicle.plate
                ? ` <span class="svc-plate">${esc(pair.vehicle.plate)}</span>` : '';
            lines.push(`<div><span class="svc-veh-name">${esc(pair.vehicle.name)}</span>${plate}</div>`);
        } else if (pair.needsVehicle) {
            lines.push(`<div class="svc-pend-txt">${pair.expectedVehicleName
                ? `${esc(pair.expectedVehicleName)} pendiente` : 'Vehículo pendiente'}</div>`);
        }
        const segBit = svcSegmentBit(pair);
        if (segBit) lines.push(`<div>${segBit}</div>`);
        return `<div ${attrs}>${duo}<div class="svc-assign-meta">${lines.join('')}</div></div>`;
    }

    /**
     *
     * @param row
     * @param ctx
     * @example
     */
    function svcRoleRow(row, ctx) {
        const esc = PaymentBreakdownHelpers.escapeHtml;
        const p = row.person;
        // `ownId` es lo que de verdad guarda el campo del servicio, y NO el id de quien se muestra:
        // en un renglón heredado se muestra a la persona de la reservación mientras el campo está
        // vacío. Confundirlos haría que el selector la marcara como actual y ofreciera "quitar" algo
        // que no existe.
        const pick = svcPickAttrs(ctx, {
            'slot-kind': 'role',
            'role-field': row.field,
            'role-pool': row.pool,
            'role-label': row.role,
            'current-id': row.ownId || '',
            'inherit-label': row.inheritLabel || '',
        }, `${row.ownId ? 'Cambiar' : 'Asignar'} ${String(row.role).toLowerCase()}`);
        const attrs = 'class="svc-assign-row"';
        const avatar = p ? svcAvatar(p, pick) : svcPendingAvatar('user', pick);
        const note = row.note ? `<div class="svc-assign-src">${esc(row.note)}</div>` : '';
        const body = p
            ? `<div class="n">${esc(p.fullName)}${svcTelLink(p.phone)}</div>${note}`
            : `<div class="n ${row.optional ? 'svc-opt-txt' : 'svc-pend-txt'}">${row.optional ? 'Opcional' : 'Pendiente'}</div>`;
        return `<div ${attrs}>${avatar}<div class="svc-assign-meta">
            <div class="svc-assign-role">${esc(row.role)}</div>${body}
        </div></div>`;
    }

    /**
     *
     * @param status
     * @example
     */
    function getReservationStatusBadge(status) {
        const map = {
            pending: { label: 'Asignaciones pendientes', cls: 'bg-warning text-dark' },
            assigned: { label: 'Asignada', cls: 'bg-info text-white' },
            in_progress: { label: 'En Progreso', cls: 'bg-primary text-white' },
            completed: { label: 'Completada', cls: 'bg-success text-white' },
            cancelled: { label: 'Cancelada', cls: 'bg-danger text-white' },
            confirmed: { label: 'Confirmada', cls: 'bg-success text-white' },
            hold: { label: 'En Espera', cls: 'bg-warning text-dark' },
        };
        const s = map[status] || { label: status, cls: 'bg-secondary text-white' };
        return `<span class="badge ${s.cls}" title="Estado operacional de reservación">${s.label}</span>`;
    }

    /**
     *
     * @param status
     * @example
     */
    function svcExceptionBadge(status) {
        return SVC_EXCEPTION_STATUSES.has(status) ? getReservationStatusBadge(status) : '';
    }

    // Notas en el formato del itinerario (renderNotes): las líneas que empiezan con "-" se convierten
    // en viñetas y el resto queda como párrafos. ESCAPA el texto — antes se interpolaba crudo en el
    // innerHTML, así que una nota con HTML se ejecutaba (stored XSS, el mismo vector que los tests ya
    // cubren para referencia de pago y descripción de ajuste).
    /**
     *
     * @param text
     * @example
     */
    function renderServiceNotes(text) {
        const esc = PaymentBreakdownHelpers.escapeHtml;
        const lines = String(text == null ? '' : text).split('\n');
        if (!lines.some((l) => l.trim().startsWith('-'))) return esc(text);
        let html = '';
        let inList = false;
        for (const raw of lines) {
            const line = raw.trim();
            if (line.startsWith('-')) {
                if (!inList) { html += '<ul class="svc-notes-list">'; inList = true; }
                html += `<li>${esc(line.replace(/^-\s*/, ''))}</li>`;
            } else {
                if (inList) { html += '</ul>'; inList = false; }
                if (line) html += `<div>${esc(line)}</div>`;
            }
        }
        if (inList) html += '</ul>';
        return html;
    }

    // PNG de /images/icons y no la fuente Tabler, que no tiene glifo para todos los tipos.
    // El módulo compartido trabaja sobre una forma PLANA (subconcepto + type); esta vista tiene el
    // subconcepto anidado. Este adaptador es el único lugar donde se traduce: dos formas de dato era
    // justo lo que permitía que las dos vistas divergieran.
    /**
     *
     * @param svc
     * @example
     */
    function serviceFacts(svc) {
        const s = svc || {};
        const sub = s.subconcept || {};
        return {
            ...sub,
            type: s.type || sub.type,
            time: s.time || sub.time || '',
            flightDepartureTimeSuggested: s.flightDepartureTimeSuggested
                || sub.flightDepartureTimeSuggested || '',
            // Esta vista los lee del primer nivel; el itinerario, del subconcepto. Gana el de arriba.
            originName: s.originName || sub.originName || '',
            destinationName: s.destinationName || sub.destinationName || '',
            transportType: sub.transportType || s.transportType || '',
            directionType: sub.directionType || s.directionType || '',
            // ReservationService guarda además su PROPIO vehicleTypeName al margen del subconcepto;
            // sin este respaldo las plazas de esos servicios volverían al genérico «Vehículo».
            vehicleTypeName: sub.vehicleTypeName || s.vehicleTypeName || '',
            additionalVehicleTypeName: sub.additionalVehicleTypeName || s.additionalVehicleTypeName || '',
            additionalVehicleSegmentName: sub.additionalVehicleSegmentName || s.additionalVehicleSegmentName || '',
        };
    }

    // Línea destacada bajo el título en vez de un renglón perdido dentro de la sección PERSONAS.
    /**
     *
     * @param svc
     * @example
     */
    function servicePeopleLabel(svc) {
        return ServiceListHelpers.peopleLabel(serviceFacts(svc));
    }

    // Renglones etiquetados bajo el título, en el hueco que dejó "Desde/Hacia": esas direcciones
    // vivían enterradas en la sección UBICACIONES.
    /**
     *
     * @param svc
     * @example
     */
    function serviceLocationLines(svc) {
        return ServiceListHelpers.locationLines(serviceFacts(svc));
    }

    // Nombres de las personas del servicio, justo bajo el conteo: esa línea dice CUÁNTOS ("3 adultos,
    // 1 niño"), esta QUIÉNES. Sin rótulo ni contador: apiladas se entiende la relación, y un segundo
    // conteo junto al primero invitaba a leer un error cuando difieren (los nombres capturados no
    // tienen por qué ser todos los pasajeros).
    // El módulo devuelve los NOMBRES; el envoltorio los pinta, que es lo que difiere entre vistas.
    /**
     *
     * @param svc
     * @example
     */
    function serviceAttendeesLine(svc) {
        const names = ServiceListHelpers.attendeeNames(serviceFacts(svc));
        if (!names.length) return '';
        return `<div class="svc-names">${PaymentBreakdownHelpers.escapeHtml(names.join(', '))}</div>`;
    }

    // Hora OPERATIVA del servicio: cuándo hay que estar ahí. En un traslado de SALIDA a aeropuerto hay
    // DOS horas distintas y no son intercambiables:
    //   svc.time                     -> hora del VUELO (18:00) — su lugar es la tabla de Vuelos
    //   flightDepartureTimeSuggested -> hora de PICK-UP (14:15), calculada hacia atrás desde el vuelo
    //                                   restando la ruta y la anticipación de aeropuerto
    // Para el chofer manda la de pick-up, así que es la que encabeza el servicio. En LLEGADAS hay una
    // sola —el chofer pasa cuando aterriza el avión—, así que ahí no cambia nada.
    /**
     *
     * @param svc
     * @example
     */
    function servicePickupTime(svc) {
        return ServiceListHelpers.startTime(serviceFacts(svc));
    }

    // Hora del VUELO, cuando es un dato distinto al pick-up (solo salidas a aeropuerto). Sirve para
    // aclarar en el encabezado que la hora mostrada NO es la del avión.
    /**
     *
     * @param svc
     * @example
     */
    function serviceFlightTime(svc) {
        const sub = svc.subconcept || {};
        if (svc.type !== 'transport' || sub.transportType !== 'aeropuerto') return '';
        const m = String(svc.time || sub.time || sub.selectedSchedule || '').match(/^(\d{1,2}:\d{2})/);
        return m ? m[1] : '';
    }

    /**
     *
     * @param h
     * @example
     */
    function hoursText(h) {
        return ServiceListHelpers.hoursText(h);
    }

    /**
     *
     * @param svc
     * @example
     */
    function serviceDurationLabel(svc) {
        return ServiceListHelpers.durationLabel(serviceFacts(svc));
    }

    /**
     *
     * @param dateStr
     * @example
     */
    function itinDayLabel(dateStr) {
        if (!dateStr) return '';
        // "YYYY-MM-DD" se arma como fecha LOCAL (igual que toDate del itinerario): pasarla por
        // new Date(str) la interpretaría como UTC y correría el día en zonas con offset negativo.
        const plain = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr));
        const d = plain
            ? (() => { const [y, m, dd] = String(dateStr).split('-').map(Number); return new Date(y, m - 1, dd); })()
            : new Date(dateStr);
        if (Number.isNaN(d.getTime())) return '';
        return `${SVC_DOW[d.getDay()]}. ${SVC_MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
    }

    // Envoltorios finos sobre ServiceListHelpers, para no tocar los call sites (mismo criterio que
    // los de PaymentBreakdownHelpers). La lógica vive en /shared/services/serviceListHelpers.js.
    /**
     *
     * @param svc
     * @example
     */
    function isTransportType(svc) {
        return ServiceListHelpers.isTransportType(svc && svc.type);
    }

    /**
     *
     * @param svc
     * @example
     */
    function getServiceIconKey(svc) {
        return ServiceListHelpers.iconKey(serviceFacts(svc));
    }

    // Returns a human-readable concept for a service. A-disposición services often have
    // an empty concept field — fall back to the literal type label instead of a dash.
    /**
     *
     * @param svc
     * @example
     */
    function getDisplayConcept(svc) {
        const raw = (svc?.concept || '').trim();
        if (raw) return raw;
        if (svc?.type === 'a-disposicion') return 'A Disposición';
        return '—';
    }

    // Build a single detail line: small icon + label (optional) + value.
    /**
     *
     * @param icon
     * @param value
     * @param label
     * @example
     */
    function detailLine(icon, value, label) {
        if (value == null || value === '') return '';
        const labelHtml = label ? `<span class="text-muted me-1">${label}:</span>` : '';
        return `<div class="d-flex align-items-center gap-1 small text-dark">
                    <i class="ti ti-${icon} text-secondary" style="font-size: 0.9rem;"></i>
                    ${labelHtml}<span>${value}</span>
                </div>`;
    }

    // Build a section: small header + flex-wrap of items.
    /**
     *
     * @param icon
     * @param title
     * @param items
     * @example
     */
    function detailSection(icon, title, items) {
        const filtered = items.filter(Boolean);
        if (filtered.length === 0) return '';
        return `<div class="mt-2">
                    <div class="d-flex align-items-center gap-1 text-secondary mb-1" style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;">
                        <i class="ti ti-${icon}"></i>${title}
                    </div>
                    <div class="d-flex flex-wrap" style="row-gap: 0.15rem; column-gap: 1.25rem;">
                        ${filtered.join('')}
                    </div>
                </div>`;
    }

    /**
     *
     * @param svc
     * @example
     */
    function getSubconceptDetails(svc) {
        const sub = svc.subconcept;
        if (!sub) return '';
        // ===== Sections (replaces the legacy badge row) =====
        // Build categorized detail lines so the operator can scan the info quickly.

        // SERVICIO — vehicle count, included roles, hotel, etc.
        // "Sencillo — Salida" salió de aquí: la DIRECCIÓN ya la dice el ícono del riel (arrival.png vs
        // departure.png en traslados de aeropuerto) y el REDONDO se ve en Ubicaciones, que en ese caso
        // desglosa pick-up y drop-off de ida y de regreso.
        // El CONTEO de vehículos ("2 vehículos") también salió: el bloque de asignaciones dibuja una
        // plaza por vehículo —con su tipo y segmento, asignada o pendiente—, así que contarlos aparte
        // decía menos y en otro lugar.
        const servicioItems = [];
        const guideLabel = svc.type === 'a-disposicion' ? 'Chofer' : 'Guía';
        if (sub.includeGuide === true) {
            servicioItems.push(detailLine('map-pin', `${guideLabel} incluido`));
        }
        if (sub.includeGreeter === true) {
            const inVehicle = sub.greeterInVehicle ? ' (en vehículo)' : ' (en punto)';
            servicioItems.push(detailLine('hand-stop', `Greeter incluido${inVehicle}`));
        }
        if (svc.type === 'tour' && sub.hotelName) {
            servicioItems.push(detailLine('building', sub.hotelName, 'Hotel'));
        }
        // Entradas asociadas a la experiencia (boletos de acceso): nombre + ×cantidad si > 1.
        if (svc.type === 'experience' && Array.isArray(sub.experienceEntradas)) {
            const incEntradas = sub.experienceEntradas.filter((e) => e && e.included !== false);
            if (incEntradas.length > 0) {
                const listEnt = incEntradas
                    .map((e) => `${PaymentBreakdownHelpers.escapeHtml(e.name || 'Entrada')}${Number(e.quantity) > 1 ? ` ×${e.quantity}` : ''}`)
                    .join(', ');
                servicioItems.push(detailLine('ticket', `Entradas: ${listEnt}`));
            }
        }
        // Entradas asociadas al/los destino(s) del tour (boletos de acceso): nombre + ×cantidad si > 1.
        if (svc.type === 'tour' && Array.isArray(sub.tourEntradas)) {
            const incEntradas = sub.tourEntradas.filter((e) => e && e.included !== false);
            if (incEntradas.length > 0) {
                const listEnt = incEntradas
                    .map((e) => `${PaymentBreakdownHelpers.escapeHtml(e.name || 'Entrada')}${Number(e.quantity) > 1 ? ` ×${e.quantity}` : ''}`)
                    .join(', ');
                servicioItems.push(detailLine('ticket', `Entradas: ${listEnt}`));
            }
        }

        // HORARIO — solo lo que NO está ya en el encabezado del servicio.
        // La hora de pick-up de los traslados de aeropuerto salió de aquí: ahora encabeza el servicio
        // (servicePickupTime), donde se lee de inmediato en vez de bajo un rótulo "Horario" que no
        // decía de qué hora hablaba. La del vuelo vive en la tabla de Vuelos.
        const horarioItems = [];
        // El "Horario" de experiencias y a-disposición (selectedSchedule) también salió: su hora de
        // inicio ya encabeza el servicio, y cuando es un rango ("09:00 – 15:00") el final se deduce de
        // la duración que va al lado ("09:00 - 6 horas").
        // La DURACIÓN (horas contratadas de a-disposición y duración de ruta de un traslado) ya se
        // muestra junto a la hora, arriba del título — ver serviceDurationLabel. Aquí se repetía.
        if (sub.waitingTimeHours) {
            horarioItems.push(detailLine('clock-pause', hoursText(sub.waitingTimeHours), 'Espera'));
        }
        if (Array.isArray(sub.extraAdditionalVehicles)) {
            sub.extraAdditionalVehicles.forEach((v) => {
                const wh = parseFloat(v && v.waitingHours) || 0;
                if (wh > 0) horarioItems.push(detailLine('clock-pause', hoursText(wh), `Espera ${(v.vehicleTypeName || 'adicional')}`));
            });
        }

        // PERSONAS desapareció como sección: el CONTEO se movió a la línea destacada bajo el título
        // (servicePeopleLabel) y la lista nominal de ASISTENTES a su propio renglón etiquetado, junto a
        // las ubicaciones (serviceAttendeesLine). No quedaba nada más que mostrar aquí.
        // "Walking tour" era lo único que se perdía al mover el conteo: su etiqueta describía la
        // naturaleza del tour, no su gente. Pasa a SERVICIO, que es donde vive ese tipo de dato.
        if (svc.type === 'tour' && sub.isWalkingTour) {
            servicioItems.push(detailLine('walk', 'Walking tour'));
        }

        // VUELOS — mini tabla en el formato del itinerario (.itin-flight): encabezado chico arriba y el
        // valor en negrita abajo, en vez del renglón "AeroMéxico AM123 @ 14:15".
        // Se conservan dos columnas que el itinerario no tiene: la HORA del vuelo (distinta al pick-up
        // del Horario) y los VUELOS ADICIONALES, que aquí van como renglones extra de la misma tabla.
        // Terminal y Puerta se incluyen por fidelidad, pero hoy siempre salen "—": el dato no existe en
        // el modelo, y el itinerario también los deja fijos en "—".
        const flightRows = [];
        if (isTransportType(svc)) {
            if (sub.airline || sub.flightNumber) {
                // Hora real del vuelo (llegada o salida del avión), distinta al pick-up del Horario.
                const fm = String(svc.time || sub.selectedSchedule || sub.time || '').match(/^(\d{1,2}:\d{2})/);
                flightRows.push({ airline: sub.airline, flightNumber: sub.flightNumber, time: fm ? fm[1] : '' });
            }
            if (Array.isArray(sub.additionalFlights)) {
                sub.additionalFlights.forEach((f) => {
                    const airline = (f.airline || '').trim();
                    const flightNumber = (f.flightNumber || '').trim();
                    const time = (f.flightTime || '').trim();
                    if (airline || flightNumber || time) flightRows.push({ airline, flightNumber, time });
                });
            }
        }
        // El texto de aerolínea/vuelo lo escribe el usuario: se escapa (antes se interpolaba crudo).
        const escF = PaymentBreakdownHelpers.escapeHtml;
        const vuelosHtml = flightRows.length
            ? `<div class="svc-flight">
                 <div class="h">Aerolínea</div><div class="h">Vuelo</div><div class="h">Hora</div><div class="h">Terminal</div><div class="h">Puerta</div>
                 ${flightRows.map((f) => `<div class="v">${escF(f.airline) || '—'}</div><div class="v">${escF(f.flightNumber) || '—'}</div><div class="v">${escF(f.time) || '—'}</div><div class="v">—</div><div class="v">—</div>`).join('')}
               </div>`
            : '';

        // OTROS — discounts, etc.
        const otrosItems = [];
        if (svc.type === 'a-disposicion' && sub.discountPercent) {
            otrosItems.push(detailLine('discount-2', `${Number(sub.discountPercent) || 0}% descuento`));
        }
        // Fase 2d: descuento y propina por servicio (ya reflejados en el total del servicio). El
        // descuento se escala por la forma de pago (getServiceDiscountByType) para coincidir con el
        // precio por método mostrado arriba (getServicePriceByType), en vez del monto bruto en efectivo.
        if (Number(sub.discountAmount) > 0) {
            const dPct = (sub.discountType === 'percent' && sub.discountValue) ? ` ${Number(sub.discountValue) || 0}%` : '';
            const dScaled = getServiceDiscountByType(svc, vista.reservationData.paymentType);
            otrosItems.push(detailLine('discount-2', `Descuento${dPct} −${formatCurrency(dScaled, vista.reservationData.currency)}`));
        }
        if (Number(sub.tipAmount) > 0) {
            const tPct = (sub.tipType === 'percent' && sub.tipValue) ? ` ${Number(sub.tipValue) || 0}%` : '';
            const tMand = sub.tipMandatory ? ' (obligatoria)' : '';
            otrosItems.push(detailLine('coin', `Propina${tPct} +${formatCurrency(sub.tipAmount, vista.reservationData.currency)}${tMand}`));
        }

        // UBICACIONES salió de las secciones: sus direcciones ahora encabezan el servicio como
        // renglones etiquetados (serviceLocationLines), donde se leen sin tener que bajar la vista.

        const sectionsHtml = [
            detailSection('info-circle', 'Servicio', servicioItems),
            detailSection('clock', 'Horario', horarioItems),
            // Sin encabezado de sección: la mini tabla ya rotula sus columnas (Aerolínea / Vuelo / …),
            // así que un "VUELOS" encima solo repetía. El itinerario tampoco lo lleva.
            vuelosHtml,
            detailSection('award', 'Otros', otrosItems),
        ].filter(Boolean).join('');

        // Notes — render each note channel as its own callout so the operator can quickly
        // tell who the note is for. Prefer the subconcept snapshot, with sensible fallbacks.
        // Visibility by role:
        //   notes (general)  → all roles
        //   clientNotes      → client + department_manager + admin/superadmin
        //   providerNotes    → admin/superadmin only
        //   teamNotes        → admin/superadmin only
        //   internalNotes    → admin/superadmin only
        // El rol viaja en el contexto y NO se adivina: de él depende qué canales de notas se
        // pintan, y las de proveedor, equipo e internas no son para el cliente. Sin valor, se asume
        // el rol menos privilegiado.
        const rol = vista.userRole || '';
        const isAdmin = rol === 'admin' || rol === 'superadmin';
        const isClientFacing = isAdmin || rol === 'department_manager' || rol === 'client';
        const noteChannels = [
            // Sin rótulo: es el canal general y por defecto, así que anunciarlo no distinguía nada —
            // a diferencia de proveedor / equipo / internas, donde saber a quién va dirigida es el dato.
            {
 label: '', icon: 'notes', tier: '', text: (sub.notes || svc.notes || '').trim(), visible: true,
},
            {
 label: 'Notas del cliente', icon: 'user', tier: 'is-client', text: (sub.agencyNotes || '').trim(), visible: true,
},
            {
 label: 'Notas del cliente (catálogo)', icon: 'book', tier: 'is-client', text: (sub.clientNotes || '').trim(), visible: isClientFacing,
},
            {
 label: 'Notas del proveedor', icon: 'building', tier: 'is-ops', text: (sub.providerNotes || '').trim(), visible: isAdmin,
},
            {
 label: 'Notas del equipo', icon: 'users', tier: 'is-ops', text: (sub.teamNotes || '').trim(), visible: isAdmin,
},
            {
 label: 'Notas internas', icon: 'lock', tier: 'is-internal', text: (sub.internalNotes || '').trim(), visible: isAdmin,
},
        ].filter((n) => n.visible && n.text);

        // Formato del itinerario (.itin-desc + renderNotes): texto corrido justificado, sin caja gris
        // ni filete de color. Se CONSERVA la etiqueta del canal —reducida a un rótulo en versalitas—
        // porque el itinerario solo tiene notas de cara al cliente y no necesita distinguirlas, pero
        // aquí saber si una nota es del proveedor, del equipo o interna es justo lo que importa.
        const notesHtml = noteChannels.map((n) => `
            <div class="svc-note">
                ${n.label ? `<span class="svc-note-lbl ${n.tier}"><i class="ti ti-${n.icon}"></i>${n.label}</span>` : ''}
                <div class="svc-note-body">${renderServiceNotes(n.text)}</div>
            </div>
        `).join('');

        // La descripción del CATÁLOGO va antes de las notas: describe qué es el tour o la experiencia,
        // y las notas son lo particular de esta reservación. La trae el API (el subconcepto no la
        // guarda) y se verificó que no duplica ninguna nota ya mostrada.
        const catalogDesc = String(svc.catalogDescription || '').trim();
        const catalogDescHtml = catalogDesc
            ? `<div class="svc-note"><div class="svc-note-body">${renderServiceNotes(catalogDesc)}</div></div>`
            : '';

        return sectionsHtml + catalogDescHtml + notesHtml;
    }

    /**
     *
     * @param services
     * @param contexto
     * @example
     */
    function buildHtml(services, contexto) {
    vista = contexto || {};

        const days = {};
        services.forEach((svc) => {
            const key = svc.dayNumber || 1;
            // El título se guarda TAL CUAL (sin caer a "Dia N"): la barra ya nombra el día, así que un
            // título de respaldo se leería duplicado ("Día 1 — Dia 1").
            if (!days[key]) days[key] = { title: svc.dayTitle || '', date: svc.serviceDate, services: [] };
            days[key].services.push(svc);
        });

        // Orden dentro del día: lo decide ServiceListHelpers.compareByTime, el mismo comparador que
        // aplica el itinerario del cliente. Antes cada vista traía el suyo y divergían en 9 de 93
        // grupos día, porque el 76% de los servicios no tiene hora capturada y no coincidían en
        // dónde poner a los que no la tienen.
        Object.values(days).forEach((d) => {
            d.services.sort(ServiceListHelpers.compareByTime);
        });

        if (Object.keys(days).length === 0) {
            return '<div class="text-center py-4 text-muted">No hay servicios en esta reservacion</div>';
        }

        const canAssign = vista.allowAssign !== false
                && vista.reservationData.status !== 'cancelled' && vista.reservationData.status !== 'completed';
        // Si esta vista es la de OPERACIÓN. Se lee de la bandera CRUDA y no de canAssign: canAssign ya
        // es falso en reservaciones canceladas o completadas, y ahí admin sigue necesitando ver la
        // cobertura —es justo donde la revisa—. Lo que decide es de quién es la vista, no si en este
        // momento se puede asignar.
        const esOperacion = vista.allowAssign !== false;

        let html = '<div class="svc-timeline">';
        Object.keys(days).sort((a, b) => a - b).forEach((dayNum) => {
            const day = days[dayNum];
            // Cada día es su propio contenedor para que el riel de la línea de tiempo se corte al
            // final del día (el :last-child de .svc-entry es por día, no de toda la lista).
            // "Miércoles. Jul 29 · Día 1 — Llegada". El día del paquete y su título se conservan
            // porque identifican el día en la operación; el itinerario del cliente no los necesita.
            const dayDate = itinDayLabel(day.date);
            // El título del día lo escribe una persona en la cotización, igual que el nombre del
            // servicio: se escapa. La fecha y el número los arma esta función, así que no hace falta.
            const dayTit = day.title ? ` — ${PaymentBreakdownHelpers.escapeHtml(day.title)}` : '';
            const dayLbl = `${dayDate ? `${dayDate} · ` : ''}Día ${dayNum}${dayTit}`;
            html += `<div class="svc-day"><div class="svc-day-bar">${dayLbl}</div>`;

            day.services.forEach((svc) => {
                // Plazas chofer+vehículo y renglones de rol: los arma ServiceListHelpers, el mismo
                // modelo que usa el itinerario del cliente. Aquí solo se adapta la forma del dato,
                // se agrega lo que únicamente esta vista necesita (el rótulo del selector) y se pinta.
                const facts = serviceFacts(svc);
                const extras = svc.extraAssignments || [];
                const isAtDisposal = svc.type === 'a-disposicion';
                const assigned = {
                    driver: svc.assignedDriver || null,
                    vehicle: svc.assignedVehicle || null,
                    guide: svc.assignedGuide || null,
                    greeter: svc.assignedGreeter || null,
                    serviceCustomer: svc.assignedServiceCustomer || null,
                    extras,
                };

                const slots = ServiceListHelpers.buildVehicleSlots(facts, assigned);
                // El rótulo NO se pinta en el renglón —ahí lo distinguen el tipo y el segmento—, pero
                // es el título del selector, que una vez abierto es la única pista de cuál plaza se
                // está editando. Vive aquí porque el itinerario no tiene selector.
                // `hasPrimaryAdditional` se lee igual que en el modelo (por el nombre del tipo): de él
                // depende cómo se NOMBRA la plaza 1, y si se calculara distinto el rótulo diría
                // "Vehículo extra 1" donde la plaza es la adicional.
                const hasPrimaryAdditional = !!facts.additionalVehicleTypeName;
                const pairs = slots.map((p) => ({ ...p, slotLabel: slotLabelFor(p, hasPrimaryAdditional) }));

                // Customer Support: HERENCIA con override. La reservación tiene uno global y un
                // servicio puede tener el suyo porque alguien más se encarga de ese en particular; el
                // renglón se dibuja SOLO cuando diverge. Mostrarlo siempre repetía en cada servicio un
                // dato que ya vive en el chip del encabezado, y donde no hay nadie el hueco es de la
                // RESERVACIÓN, no del servicio.
                const resSupport = vista.reservationData.serviceCustomer || null;
                const roles = ServiceListHelpers.roleRows(facts, assigned, {
                    reservationSupportId: resSupport ? resSupport.id : '',
                    reservationSupportName: resSupport ? resSupport.fullName : '',
                });
                // Que exista renglón de Customer Support ES la divergencia: el módulo ya aplicó la
                // regla, así que se lee de su resultado en vez de recalcularla y arriesgar que las
                // dos versiones se separen.
                const supportDiverges = roles.some((r) => r.field === 'serviceCustomerId');

                const slotCtx = { serviceId: svc.id, canAssign: canAssign && svc.status !== 'cancelled', isAtDisposal };
                const pairsHtml = pairs.map((p) => svcPairRow(p, slotCtx)).join('');
                const rolesHtml = roles.map((r) => svcRoleRow(r, slotCtx)).join('');

                // Cobertura de la asignación, DERIVADA de las plazas y los roles contratados. Sustituye
                // al botón de "Marcar completada": ese estado se ponía a mano y por eso podía mentir —en
                // la base hay 3 servicios "assigned" y 1 "completed" sin nadie asignado—. Esto no se
                // puede marcar, se calcula, así que contesta "sí o no" sin poder equivocarse.
                //
                // El Customer Support NO cuenta: es opcional por definición, y contarlo dejaría a todos
                // los servicios incompletos para siempre.
                let asgTotal = 0;
                let asgDone = 0;
                pairs.forEach((pair) => {
                    asgTotal += 1;
                    if (pair.vehicle) asgDone += 1;
                    if (pair.offersDriver) {
                        asgTotal += 1;
                        if (pair.driver) asgDone += 1;
                    }
                });
                roles.forEach((r) => {
                    if (r.optional) return;
                    asgTotal += 1;
                    if (r.person) asgDone += 1;
                });
                // Lo que RESALTA es la buena noticia, que hoy es la rara: 226 de 291 servicios están
                // sin asignar, así que pintar el faltante en ámbar reconstruiría el muro de advertencias
                // que quitamos de la píldora. El estado común va callado y el completo salta.
                const coverageHtml = coverageBadge(asgDone, asgTotal);

                // Punto de entrada CALLADO para darle un Customer Support propio a este servicio.
                // Cuando no diverge del global no hay renglón —a propósito, para no repetir catorce
                // veces un dato que ya vive en el encabezado—, pero sin él tampoco habría dónde hacer
                // clic para crear el primer override. Así que va solo el círculo: chico, apagado, sin
                // nombre ni rótulo, y a opacidad completa al pasar el mouse por el servicio. El ícono
                // de audífonos es el mismo del chip del encabezado, así que se explica sin texto.
                const supportQuietHtml = (!supportDiverges && slotCtx.canAssign)
                    ? `<div class="svc-assign-row is-quiet">${svcPendingAvatar('headset', svcPickAttrs(slotCtx, {
                        'slot-kind': 'role',
                        'role-field': 'serviceCustomerId',
                        'role-pool': 'admins',
                        'role-label': 'Customer Support',
                        'current-id': '',
                    }, 'Asignar un Customer Support solo para este servicio'))}<span class="svc-quiet-lbl">Customer Support propio</span></div>`
                    : '';

                // Ubicaciones en renglones etiquetados, formato del itinerario (ver serviceLocationLines).
                // Se escapan: son direcciones escritas a mano y antes se interpolaban crudas.
                const routeParts = serviceLocationLines(svc).map((l) => `<span class="lbl">${l.label}:</span> <b>${PaymentBreakdownHelpers.escapeHtml(l.value)}</b>`);
                const route = routeParts.length ? `<div class="svc-route">${routeParts.join('<br>')}</div>` : '';

                // Hora + duración, como en el itinerario ("09:00 · 2 h"). La duración también aparece
                // en la sección HORARIO de los detalles; queda duplicada a propósito hasta que decidas
                // de cuál de los dos sitios quitarla.
                // "09:00 - 4 horas", con el guion como separador igual que .itin-time del itinerario.
                // La hora es la de PICK-UP (ver servicePickupTime): en una salida a aeropuerto difiere de
                // la del vuelo, y es la que necesita quien opera. Cuando son distintas, el title lo
                // aclara para que nadie lea 14:15 pensando que es la hora del avión.
                const durLabel = serviceDurationLabel(svc);
                const pickupTime = servicePickupTime(svc);
                const flightTime = serviceFlightTime(svc);
                const timeTitle = (flightTime && flightTime !== pickupTime)
                    ? ` title="Hora de pick-up · el vuelo es a las ${flightTime}"` : '';
                const timeHtml = (pickupTime || durLabel)
                    ? `<div class="svc-time"${timeTitle}>${pickupTime}${pickupTime && durLabel ? ' - ' : ''}${durLabel}</div>`
                    : '';

                // El PRECIO por servicio salió de la línea: esta lista es la vista de OPERACIÓN —quién
                // va, a qué hora, en qué vehículo—, y el dinero vive completo en el Resumen Financiero
                // y en el carrito de pagos. Con él se fue también el badge "Pago externo", que existía
                // para explicar por qué un precio aparecía en $0. Agencia y agente todavía pintan
                // ambos; se alinean al portar esta maqueta.

                html += `
                <div class="svc-entry">
                    <div class="svc-rail"><div class="svc-icon"><img src="/images/icons/${getServiceIconKey(svc)}.png" alt="" onerror="this.style.display='none'"></div></div>
                    <div class="svc-body">
                        <div class="svc-head">
                            <div class="svc-head-main">
                                ${timeHtml}
                                <div class="svc-title">${PaymentBreakdownHelpers.escapeHtml(getDisplayConcept(svc))}</div>
                                ${route}
                                ${servicePeopleLabel(svc) ? `<div class="svc-people"><strong>${servicePeopleLabel(svc)}</strong></div>` : ''}
                                ${serviceAttendeesLine(svc)}
                            </div>
                            <div class="svc-side">
                        ${esOperacion && svc.type === 'concepto' && svc.status !== 'cancelled'
                            ? '<span class="svc-cov is-none">No requiere asignación</span>'
                            : svcExceptionBadge(svc.status)}
                        ${esOperacion && svc.status !== 'cancelled' && svc.type !== 'concepto' ? coverageHtml : ''}
                        ${canAssign && svc.status === 'completed'
                            ? `<button class="svc-status-btn is-revert status-toggle-btn" data-service-id="${svc.id}" data-next-status="assigned"><i class="ti ti-arrow-back-up"></i>Revertir</button>`
                            : ''}
                            </div>
                        </div>
                        ${getSubconceptDetails(svc)}
                        ${svcIncludesHtml(svc)}
                        ${pairsHtml || rolesHtml || supportQuietHtml
                            ? `<div class="svc-assign">${pairsHtml}${rolesHtml}${supportQuietHtml}</div>`
                            : ''}
                    </div>
                </div>`;
            });
            html += '</div>';
        });
        html += '</div>';

        return html;
    }

  return {
    buildHtml,
    svcAvatar,
    svcPendingAvatar,
    svcPickAttrs,
    svcTelLink,
  };
})();

// Node (Jest). En el navegador el IIFE de arriba ya dejó window.ServiceListRenderer.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ServiceListRenderer;
}
