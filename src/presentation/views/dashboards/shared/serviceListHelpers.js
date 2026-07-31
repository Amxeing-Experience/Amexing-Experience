/**
 * ServiceListHelpers — funciones PURAS de la lista de servicios, compartidas por el detalle de
 * reservación (booking-detail.ejs, en el navegador) y el itinerario del cliente
 * (reservation-itinerary.ejs, en el servidor para el PDF).
 *
 * Por qué existe: esa lista vivía escrita dos veces y divergía sola. Un reporte sobre los 291
 * servicios de la base encontró que el orden de los servicios difería en 9 de 93 grupos día, que la
 * etiqueta de personas difería en 122 de 291, que `traslado` —un valor de type legado y vivo— solo
 * lo reconocía una de las dos, y que las horas se escribían de cuatro formas distintas. Ninguna de
 * esas divergencias la introdujo nadie a propósito: aparecieron al tocar un archivo y no el otro.
 *
 * Isomórfico y sin build step, mismo patrón que paymentBreakdownHelpers.js y pricingEngine.js.
 * En el navegador entra como <script src="/shared/services/serviceListHelpers.js"> y queda en
 * window.ServiceListHelpers; en el servidor se hace require y se pasa como local a la plantilla EJS,
 * porque ahí dentro no hay `require`; y Jest lo requiere directo.
 *
 * PURO: sin DOM, sin fetch, sin estado. Todo entra por parámetros y todo lo que sale es dato o
 * texto — el HTML se arma en cada vista, porque el detalle es un banco de trabajo (círculos que
 * asignan, cobertura, precios) y el itinerario es un documento. Lo que se comparte es el MODELO.
 *
 * FORMA DE ENTRADA: un objeto "plano" con los campos del subconcepto más `type`. El itinerario ya
 * trabaja así; el detalle lo arma con un adaptador (ver serviceFacts en booking-detail.ejs). Se
 * eligió una sola forma a propósito: dos formas era justo lo que permitía que divergieran.
 * @module serviceListHelpers
 */

const ServiceListHelpers = (() => {
  /**
   * `traslado` es un valor de type LEGADO que sigue vivo: 28 servicios en la base, del 9 de marzo al
   * 24 de julio, en 24 reservaciones. Vive aquí porque lo consultan media docena de funciones y con
   * que una se olvide, ese traslado pierde su dirección de pick-up, su duración o su conteo de
   * pasajeros sin que nada avise.
   * @param {string} type - Tipo del servicio.
   * @returns {boolean} True si es un traslado, en cualquiera de sus dos nombres.
   * @example
   * isTransportType('traslado') // true
   */
  function isTransportType(type) {
    return type === 'transport' || type === 'traslado';
  }

  /**
   * Horas en una sola forma: "1 hr", "6 hrs". Antes convivían "hora/horas" en el detalle,
   * "hour/hours" en el itinerario y un "6h" pegado en los tiempos de espera.
   * @param {number|string} h - Cantidad de horas.
   * @returns {string} Texto con la unidad.
   * @example
   * hoursText(1) // '1 hr'
   */
  function hoursText(h) {
    const n = Number(h) || 0;
    return `${n} hr${n === 1 ? '' : 's'}`;
  }

  /**
   * Redondea una hora HH:MM hacia ABAJO al cuarto anterior. Se usa en la hora de pick-up sugerida
   * para no anunciarle al pasajero un minuto exacto que nadie va a cumplir.
   * @param {string} timeStr - Hora en formato HH:MM.
   * @returns {string} Hora redondeada, o la entrada tal cual si no es interpretable.
   * @example
   * roundDownTo15('14:22') // '14:15'
   */
  function roundDownTo15(timeStr) {
    const s = String(timeStr == null ? '' : timeStr);
    if (!s.includes(':')) return s;
    const [hours, minutes] = s.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return s;
    const total = Math.floor((hours * 60 + minutes) / 15) * 15;
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  /**
   * Duración del servicio POR TIPO: cada uno la guarda en un campo distinto y no son intercambiables.
   * Un a-disposición usa `hours` (horas contratadas), un tour o experiencia usa `duration` (del
   * catálogo, en horas), un traslado usa `routeDuration` (de la ruta, en MINUTOS) y un concepto no
   * tiene ninguna.
   * El orden importa: los subconceptos arrastran un `duration: 1` espurio en todo lo que no es tour,
   * así que evaluar `duration || hours` lo hacía ganar y un a-disposición de 6 h se anunciaba "1 hr".
   * @param {object} f - Servicio en forma plana.
   * @returns {string} Texto de duración, o '' cuando el tipo no tiene.
   * @example
   * durationLabel({ type: 'transport', routeDuration: 105 }) // '1 hr 45 min'
   */
  function durationLabel(f) {
    const s = f || {};
    if (s.type === 'a-disposicion') {
      const h = Number(s.hours || 0);
      return h > 0 ? hoursText(h) : '';
    }
    if (s.type === 'tour' || s.type === 'experience' || s.type === 'experiencia') {
      const h = Number(s.duration || s.hours || 0);
      return h > 0 ? hoursText(h) : '';
    }
    if (isTransportType(s.type)) {
      const min = Number(s.routeDuration || 0);
      if (min <= 0) return '';
      const h = Math.floor(min / 60);
      const m = min % 60;
      if (h === 0) return `${m} min`;
      return m ? `${hoursText(h)} ${m} min` : hoursText(h);
    }
    return '';
  }

  /**
   * Hora que encabeza el servicio. En una SALIDA a aeropuerto NO es la del avión sino la del
   * PICK-UP: el pasajero leía "18:00" y entendía que a esa hora pasaban por él, cuando la camioneta
   * sale mucho antes. La del vuelo se muestra aparte, en la tabla de vuelos.
   * @param {object} f - Servicio en forma plana.
   * @returns {string} Hora HH:MM, o '' si no hay ninguna capturada.
   * @example
   * startTime({ type: 'transport', transportType: 'aeropuerto', directionType: 'departure',
   *   time: '18:00', flightDepartureTimeSuggested: '14:18' }) // '14:15'
   */
  function startTime(f) {
    const s = f || {};
    if (isTransportType(s.type) && s.transportType === 'aeropuerto' && s.directionType === 'departure') {
      const suggested = s.flightDepartureTimeSuggested;
      if (suggested) return roundDownTo15(suggested) || suggested;
    }
    let t = s.time || s.startTime || '';
    if (!t && s.selectedSchedule) {
      const m = String(s.selectedSchedule).match(/^(\d{1,2}:\d{2})/);
      if (m) [, t] = m;
    }
    return t;
  }

  /**
   * Cuánta gente va, POR TIPO de servicio. Cada tipo guarda el desglose en campos distintos y esa es
   * la razón de que las dos vistas divergieran en 122 de 291 servicios: el itinerario leía
   * `adultsQuantity` en los traslados, donde está vacío en los 112 de la base, e ignoraba `persons`,
   * que llenan 84. Resultado: 84 traslados sin conteo de pasajeros en el documento del cliente.
   *
   * Los adultos "sin alcohol" van como categoría PROPIA y no sumados a adultos: es lo que se cotizó
   * distinto, así que esconderlo dentro del total pierde el dato.
   *
   * El respaldo genérico corre para cualquier tipo sin rama propia —conceptos, sobre todo— y por eso
   * un concepto con gente capturada ahora sí la muestra: son 12 de 30 en la base.
   * @param {object} f - Servicio en forma plana.
   * @returns {string} Ej. "4 adultos, 2 niños, 1 infante", o '' si no hay ningún conteo.
   * @example
   * peopleLabel({ type: 'transport', transportAdults: 2 }) // '2 adultos'
   */
  function peopleLabel(f) {
    const s = f || {};
    const parts = [];
    /**
     * Agrega "N sustantivo" a la lista, omitiendo los conteos en cero.
     * @param {number} n - Conteo.
     * @param {string} sing - Sustantivo en singular.
     * @param {string} plur - Sustantivo en plural.
     * @returns {void}
     * @example
     * push(2, 'adulto', 'adultos') // agrega "2 adultos"
     */
    const push = (n, sing, plur) => {
      const v = Number(n) || 0;
      if (v > 0) parts.push(`${v} ${v === 1 ? sing : plur}`);
    };

    if (isTransportType(s.type)) {
      push(s.transportAdults, 'adulto', 'adultos');
      push(s.transportChildren, 'niño', 'niños');
      push(s.transportInfants, 'infante', 'infantes');
    } else if (s.type === 'experience' || s.type === 'experiencia') {
      push(s.adultsQuantity, 'adulto', 'adultos');
      push(s.childrenQuantity, 'niño', 'niños');
      push(s.infantsQuantity, 'infante', 'infantes');
      push(s.adultsNoAlcoholQuantity, 'sin alcohol', 'sin alcohol');
    } else if (s.type === 'tour' && s.isWalkingTour) {
      push(s.adultsQuantity, 'adulto', 'adultos');
      push(s.childrenQuantity, 'niño', 'niños');
      push(s.infantsQuantity, 'infante', 'infantes');
      if (!parts.length) push(s.walkingTourPeopleCount, 'persona', 'personas');
    }

    // Desglose genérico para los tipos sin rama propia (conceptos, tours con vehículo).
    if (!parts.length) {
      push(s.adultsQuantity, 'adulto', 'adultos');
      push(s.childrenQuantity, 'niño', 'niños');
      push(s.infantsQuantity, 'infante', 'infantes');
    }
    // Último recurso: el conteo plano del servicio o el de la reservación.
    if (!parts.length) push(s.persons || s.numberOfPeople, 'persona', 'personas');
    return parts.join(', ');
  }

  /**
   * Clave del ícono del riel de la línea de tiempo. Los traslados de aeropuerto distinguen llegada de
   * salida —son documentos distintos para el pasajero— y «a disposición» usa el de traslado porque es
   * un vehículo con chofer por horas, no una experiencia.
   * @param {object} f - Servicio en forma plana.
   * @returns {string} Nombre del archivo bajo /images/icons, sin extensión.
   * @example
   * iconKey({ type: 'transport', transportType: 'aeropuerto', directionType: 'departure' }) // 'departure'
   */
  function iconKey(f) {
    const s = f || {};
    if (isTransportType(s.type)) {
      if (s.transportType === 'aeropuerto') return s.directionType === 'departure' ? 'departure' : 'arrival';
      return 'transfer';
    }
    if (s.type === 'tour') return 'city';
    if (s.type === 'a-disposicion') return 'transfer';
    return 'experience';
  }

  /**
   * Ubicaciones del servicio, en renglones etiquetados. En los TRASLADOS son las DIRECCIONES exactas
   * de pick-up y drop-off: la ruta ya la dice el título, pero la calle y el punto de encuentro son lo
   * que de verdad necesita quien va a llegar ahí. En tours y experiencias se conserva el origen y el
   * destino por nombre, porque ahí el título es el nombre del servicio y no la ruta.
   * @param {object} f - Servicio en forma plana.
   * @returns {Array<{label: string, value: string}>} Renglones con valor, sin los vacíos.
   * @example
   * locationLines({ type: 'transport', pickupAddress: 'Hotel Rosewood' })
   * // [{ label: 'Pick-up', value: 'Hotel Rosewood' }]
   */
  function locationLines(f) {
    const s = f || {};
    const lines = [];
    /**
     * Agrega un renglón etiquetado si el valor trae algo.
     * @param {string} label - Etiqueta del renglón.
     * @param {string} value - Valor a mostrar.
     * @returns {void}
     * @example
     * add('Pick-up', 'Hotel Xcaret')
     */
    const add = (label, value) => {
      const v = String(value == null ? '' : value).trim();
      if (v) lines.push({ label, value: v });
    };
    if (isTransportType(s.type)) {
      if (s.tripType === 'round-trip') {
        add('Pick-up (ida)', s.pickupAddressIda);
        add('Drop-off (ida)', s.dropoffAddressIda);
        add('Pick-up (regreso)', s.pickupAddressVuelta);
        add('Drop-off (regreso)', s.dropoffAddressVuelta);
      } else {
        add('Pick-up', s.pickupAddress);
        add('Drop-off', s.dropoffAddress);
      }
    } else {
      add('Desde', s.originName);
      add('Hacia', s.destinationName);
      add('Pick-up', s.pickupAddress);
    }
    return lines;
  }

  /**
   * Nombres de las personas del servicio, ya limpios. Devuelve el DATO y no el HTML porque cada vista
   * lo envuelve distinto: el detalle en su propio renglón, el itinerario como línea corrida. Escapar
   * es responsabilidad de quien lo pinta — son nombres escritos a mano.
   * @param {object} f - Servicio en forma plana.
   * @returns {Array<string>} Nombres no vacíos, en su orden original.
   * @example
   * attendeeNames({ attendees: [' Ana ', '', 'Luis'] }) // ['Ana', 'Luis']
   */
  function attendeeNames(f) {
    const list = (f || {}).attendees;
    if (!Array.isArray(list)) return [];
    return list.map((n) => String(n == null ? '' : n).trim()).filter(Boolean);
  }

  /**
   * Nombre de tipo de vehículo utilizable, o cadena vacía si el valor es un objectId de Parse.
   * `vehicleType` guarda normalmente el objectId del catálogo, pero algunos registros traen ahí el
   * NOMBRE ("SEDAN"). Aprovecharlo recupera el tipo sin tocar la base; el guardia evita imprimirle
   * al cliente un objectId como si fuera un modelo. Los objectId son 10 alfanuméricos con mayúsculas
   * y minúsculas mezcladas, forma que ningún nombre del catálogo tiene.
   * @param {string} value - Valor crudo de vehicleType.
   * @returns {string} Nombre, o '' si parece objectId.
   * @example
   * vehicleTypeAsName('SEDAN') // 'SEDAN'
   */
  function vehicleTypeAsName(value) {
    const v = String(value == null ? '' : value).trim();
    if (!v) return '';
    const looksLikeObjectId = /^[A-Za-z0-9]{10}$/.test(v) && /[a-z]/.test(v) && /[A-Z]/.test(v);
    return looksLikeObjectId ? '' : v;
  }

  /**
   * Cuántos vehículos NECESITA el servicio, 0 si no lleva.
   * Experiencias, conceptos y tours caminando nunca llevan vehículo aunque su `quantity` sea > 0:
   * ahí ese campo es el conteo de PERSONAS. En «a disposición» el conteo vive en `vehicleCount`,
   * porque `quantity` cuenta las entradas del servicio.
   * @param {object} f - Servicio en forma plana.
   * @returns {number} Plazas de vehículo pedidas.
   * @example
   * vehicleSlotCount({ type: 'transport', quantity: 2 }) // 2
   */
  function vehicleSlotCount(f) {
    const s = f || {};
    const isAtDisposal = s.type === 'a-disposicion';
    const hasVehicleData = !!(s.vehicleType || s.vehicleTypeName || s.requiresTransport
      || s.additionalVehicleId
      || (Array.isArray(s.extraAdditionalVehicles) && s.extraAdditionalVehicles.length > 0));
    const needsVehicle = isTransportType(s.type) || isAtDisposal
      || (s.type === 'tour' && !s.isWalkingTour && hasVehicleData);
    if (!needsVehicle) return 0;
    if (isAtDisposal) return Number(s.vehicleCount) || 1;
    return Number(s.quantity) || 1;
  }

  /**
   * Tipo y segmento ESPERADOS de cada plaza, en orden: 0 = principal, 1 = adicional cuando venía
   * marcado, 2+ = extras. Es lo que permite que una plaza vacía anuncie «Suburban» en vez del
   * genérico «Vehículo». Las plazas 2+ se leen de `extraAdditionalVehicles` —lo COTIZADO— y no de
   * lo ya asignado, que es donde vive solo lo que alguien alcanzó a capturar.
   * @param {object} f - Servicio en forma plana.
   * @param {Array<object>} [assignedExtras] - Extras ya asignados, para no quedarse corto.
   * @returns {Array<object>} Specs `{ type, segment, color }` por plaza.
   * @example
   * vehicleSlotSpecs({ vehicleTypeName: 'Suburban' }) // [{ type: 'Suburban', segment: '', color: '' }]
   */
  function vehicleSlotSpecs(f, assignedExtras) {
    const s = f || {};
    const specs = [{
      type: s.vehicleTypeName || vehicleTypeAsName(s.vehicleType) || '',
      segment: s.categoryName || '',
      color: s.categoryColor || '',
    }];
    if (s.additionalVehicleTypeName) {
      specs.push({
        type: s.additionalVehicleTypeName,
        segment: s.additionalVehicleSegmentName || '',
        color: s.additionalVehicleSegmentColor || '',
      });
    }
    const expected = Array.isArray(s.extraAdditionalVehicles) ? s.extraAdditionalVehicles : [];
    const assigned = Array.isArray(assignedExtras) ? assignedExtras : [];
    for (let i = 0; i < Math.max(expected.length, assigned.length); i += 1) {
      const exp = expected[i] || {};
      const asg = assigned[i] || {};
      specs.push({
        type: exp.vehicleTypeName || asg.vehicleName || '',
        segment: exp.segmentName || asg.segmentName || '',
        color: exp.segmentColor || asg.segmentColor || '',
      });
    }
    return specs;
  }

  /**
   * Indica si la PLAZA ofrece chofer. El checkbox de la cotización se llama "Guía + Chofer" y lo que
   * contrata es el CHOFER; el guía va aparte, por tipo, en roleRows().
   * En traslados siempre: sin chofer no hay traslado. En tours solo con "Guía + Chofer" marcado,
   * porque el tour ya trae guía propio y el chofer es el extra. En «a disposición» nunca en la
   * plaza: ahí el chofer se captura en el campo de guía y sale como renglón de rol. El resto se
   * comporta como el tour.
   * @param {object} f - Servicio en forma plana.
   * @returns {boolean} true si la plaza puede pedir chofer.
   * @example
   * pairOffersDriver({ type: 'tour', includeGuide: false }) // false
   */
  function pairOffersDriver(f) {
    const s = f || {};
    if (s.type === 'a-disposicion') return false;
    return isTransportType(s.type) ? true : !!s.includeGuide;
  }

  /**
   * Construye las plazas chofer+vehículo del servicio, una por índice.
   *
   * Se construyen INDEXADAS POR PLAZA y no apilando lo asignado: solo así un hueco sigue siendo el
   * hueco de ESA plaza. Apilando, un servicio con la principal vacía y una extra asignada corría la
   * extra al lugar 0 y la plaza pendiente heredaba el tipo esperado de otra: anunciaba el vehículo
   * equivocado. Hoy no hay ninguno así en la base (0 de 37 con extras), y es justo por eso que
   * conviene cerrarlo ahora. El índice es además lo que le dice al selector del detalle dónde
   * escribir: plaza 0 → campos de primer nivel, plaza i → extras[i - 1].
   * @param {object} f - Servicio en forma plana.
   * @param {object} [assigned] - `{ driver, vehicle, extras }` ya resueltos.
   * @returns {Array<object>} Plazas en orden.
   * @example
   * buildVehicleSlots({ type: 'transport', quantity: 1 }, {}).length // 1
   */
  function buildVehicleSlots(f, assigned) {
    // Las plazas extra guardan un blob plano (ids + nombres + lo ya resuelto del catálogo); se
    // reconstruye con la misma forma que la principal para que el renglón las lea igual.
    /**
     * Chofer de una plaza extra, con la misma forma que el de la plaza principal.
     * @param {object} ea - Entrada del blob plano de extraAssignments.
     * @returns {object|null} Chofer, o null si la plaza no tiene.
     * @example
     * extraDriver({ driverId: 'd1', driverName: 'Ana' }) // { id: 'd1', fullName: 'Ana', ... }
     */
    const extraDriver = (ea) => (ea && ea.driverId ? {
      id: ea.driverId,
      fullName: ea.driverName,
      phone: ea.driverPhone || '',
      profilePhotoUrl: ea.driverPhotoUrl || '',
    } : null);
    /**
     * Vehículo de una plaza extra, con la misma forma que el de la plaza principal.
     * @param {object} ea - Entrada del blob plano de extraAssignments.
     * @returns {object|null} Vehículo, o null si la plaza no tiene.
     * @example
     * extraVehicle({ vehicleId: 'v1', vehicleName: 'Hiace' }) // { id: 'v1', name: 'Hiace', ... }
     */
    const extraVehicle = (ea) => (ea && ea.vehicleId ? {
      id: ea.vehicleId,
      name: ea.vehicleName,
      plate: ea.vehiclePlate || '',
      imageUrl: ea.vehicleImageUrl || '',
    } : null);
    const s = f || {};
    const a = assigned || {};
    const extras = Array.isArray(a.extras) ? a.extras : [];
    const qty = vehicleSlotCount(s);
    const specs = vehicleSlotSpecs(s, extras);
    const offersDriver = pairOffersDriver(s);

    // Manda lo mayor entre el conteo capturado, lo cotizado y lo YA asignado: un `quantity` mal
    // capturado no debe ocultar a nadie real. Sin vehículo solo se dibuja lo asignado — specs
    // siempre trae la plaza principal, y sin ese guardia un tour caminando pediría camioneta.
    let lastFilledExtra = -1;
    extras.forEach((e, i) => { if (e && (e.driverId || e.vehicleId)) lastFilledExtra = i; });
    const mainFilled = (a.driver || a.vehicle) ? 1 : 0;
    const implied = lastFilledExtra >= 0 ? lastFilledExtra + 2 : mainFilled;
    const total = qty > 0 ? Math.max(qty, specs.length, implied) : implied;

    const slots = [];
    for (let i = 0; i < total; i += 1) {
      const spec = specs[i] || {};
      const ea = i === 0 ? null : (extras[i - 1] || null);
      const driver = i === 0 ? (a.driver || null) : extraDriver(ea);
      const vehicle = i === 0 ? (a.vehicle || null) : extraVehicle(ea);
      const hasDriver = !!(driver && driver.fullName);
      const hasVehicle = !!(vehicle && vehicle.name);
      slots.push({
        slotIndex: i,
        // null = la plaza escribe en los campos de primer nivel.
        extraIndex: i === 0 ? null : i - 1,
        driver: hasDriver ? driver : null,
        vehicle: hasVehicle ? vehicle : null,
        driverId: hasDriver ? (driver.id || '') : '',
        vehicleId: hasVehicle ? (vehicle.id || '') : '',
        pending: !hasDriver && !hasVehicle,
        offersDriver,
        needsDriver: hasVehicle && !hasDriver && offersDriver,
        needsVehicle: hasDriver && !hasVehicle,
        expectedType: spec.type || '',
        label: spec.type || 'Vehículo',
        // El segmento se hereda del servicio cuando la plaza no trae uno propio: los campos por
        // plaza existen para poder DIFERIR del servicio y casi nunca están capturados, así que sin
        // la herencia un traslado Premium de dos vehículos anunciaba "Premium" solo en la primera.
        segmentName: spec.segment || s.categoryName || '',
        segmentColor: spec.color || s.categoryColor || '',
        totalSlots: total,
      });
    }
    return slots;
  }

  /**
   * Roles que NO van amarrados a un vehículo, en el orden en que se dibujan.
   *
   * `includeGuide` / `includeGreeter` dicen si el servicio los lleva contratados, así que un rol
   * contratado y sin asignar también sale por confirmar. Un tour SIEMPRE trae guía propio y un
   * «a disposición» SIEMPRE trae chofer —ahí el chofer vive en el campo de guía, por eso su pool es
   * de choferes—, así que esos dos no dependen del checkbox.
   *
   * Customer Support: es OPCIONAL —siempre se puede asignar, pero no se contrata—, así que nunca
   * sale como plaza pendiente. Cuando se conoce el de la RESERVACIÓN, su renglón se dibuja solo si
   * DIVERGE: con el global puesto, mostrarlo siempre repetía el mismo nombre en los catorce
   * servicios, y donde no hay nadie el hueco es de la reservación, no del servicio.
   * @param {object} f - Servicio en forma plana.
   * @param {object} [assigned] - `{ guide, greeter, serviceCustomer }` ya resueltos.
   * @param {object} [opts] - `{ reservationSupportId }` para la regla de divergencia.
   * @returns {Array<object>} Renglones `{ role, person, field, pool, pending, ... }`.
   * @example
   * roleRows({ type: 'tour' }, {}).map((r) => r.role) // ['Guía']
   */
  function roleRows(f, assigned, opts) {
    const s = f || {};
    const a = assigned || {};
    const o = opts || {};
    const isAtDisposal = s.type === 'a-disposicion';
    const support = (a.serviceCustomer && a.serviceCustomer.fullName) ? a.serviceCustomer : null;
    // El mismo id capturado aparte no cuenta como divergencia: no difiere de nada.
    const supportDiverges = !!support
      && !(o.reservationSupportId && support.id === o.reservationSupportId);

    return [
      {
        person: a.guide || null,
        role: isAtDisposal ? 'Chofer' : 'Guía',
        field: 'guideId',
        pool: isAtDisposal ? 'drivers' : 'guides',
        always: s.type === 'tour' || isAtDisposal,
        expected: !!s.includeGuide,
      },
      {
        person: a.greeter || null,
        role: 'Greeter',
        field: 'greeterId',
        pool: 'greeters',
        expected: !!s.includeGreeter,
      },
      {
        person: supportDiverges ? support : null,
        role: 'Customer Support',
        field: 'serviceCustomerId',
        pool: 'admins',
        note: supportDiverges ? 'solo este servicio' : '',
        // Nombre del global, para que el selector ofrezca "Usar el de la reservación" en vez de un
        // "Quitar asignación" que no dice a qué se vuelve.
        inheritLabel: (supportDiverges && o.reservationSupportName) ? o.reservationSupportName : '',
        always: supportDiverges,
        optional: true,
      },
    ]
      .filter((r) => r.always || (r.person && r.person.fullName) || r.expected)
      .map((r) => {
        const has = !!(r.person && r.person.fullName);
        return {
          ...r,
          person: has ? r.person : null,
          ownId: has ? (r.person.id || '') : '',
          pending: !has && !r.optional,
        };
      });
  }

  /**
   * Minutos desde medianoche de la hora de un servicio, o null si no tiene.
   * Acepta el rango "HH:MM - HH:MM" que usan las llegadas y se queda con el INICIO.
   * @param {string} timeStr - Hora capturada.
   * @returns {number|null} Minutos, o null.
   * @example
   * timeToMinutes('14:15 - 15:00') // 855
   */
  function timeToMinutes(timeStr) {
    if (!timeStr) return null;
    const rango = String(timeStr).match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
    if (rango) return parseInt(rango[1], 10) * 60 + parseInt(rango[2], 10);
    const suelta = String(timeStr).match(/^(\d{1,2}):(\d{2})/);
    if (suelta) return parseInt(suelta[1], 10) * 60 + parseInt(suelta[2], 10);
    return null;
  }

  /**
   * Compara dos servicios del MISMO día por hora, para ordenarlos.
   *
   * Los servicios SIN hora van PRIMERO, no al final: es el orden del itinerario del cliente, que es
   * el documento de referencia, y el 76% de los servicios no tiene hora capturada.
   *
   * La comparación es NUMÉRICA aunque la consulta a la base ordene por cadena: con horas bien
   * formadas dan el mismo resultado, pero una hora sin cero a la izquierda ("9:00") el orden de
   * cadena la mandaría después de "14:15". Hoy no hay ninguna así en la base; esto es para que el
   * día que la haya, las dos vistas no se separen en silencio.
   * @param {object} a - Servicio.
   * @param {object} b - Servicio.
   * @returns {number} Negativo, cero o positivo.
   * @example
   * [{ time: '14:15' }, { time: '9:00' }].sort(compareByTime)[0].time // '9:00'
   */
  function compareByTime(a, b) {
    const ma = timeToMinutes((a || {}).time);
    const mb = timeToMinutes((b || {}).time);
    if (ma === null && mb === null) return 0;
    if (ma === null) return -1;
    if (mb === null) return 1;
    return ma - mb;
  }

  return {
    iconKey,
    locationLines,
    attendeeNames,
    isTransportType,
    hoursText,
    roundDownTo15,
    durationLabel,
    startTime,
    peopleLabel,
    vehicleTypeAsName,
    vehicleSlotCount,
    vehicleSlotSpecs,
    pairOffersDriver,
    buildVehicleSlots,
    roleRows,
    timeToMinutes,
    compareByTime,
  };
})();

// Node (servidor y Jest). En el navegador el IIFE de arriba ya dejó window.ServiceListHelpers.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ServiceListHelpers;
}
