/**
 * ServiceListHelpers — el modelo compartido de la lista de servicios.
 *
 * Estas pruebas nacen de un reporte de divergencias sobre los 291 servicios de la base: cada caso de
 * abajo corresponde a una diferencia REAL que existía entre el detalle de reservación y el itinerario
 * del cliente, o a un dato de la base que rompía una de las dos. No son ejemplos inventados.
 */

const H = require('../../../../../../src/presentation/views/dashboards/shared/serviceListHelpers');

describe('isTransportType — `traslado` es un type legado y VIVO', () => {
  // 28 servicios de la base lo usan, del 9 de marzo al 24 de julio. El detalle solo reconocía
  // 'transport', así que esos traslados no calculaban plazas y perdían pick-up, duración y pasajeros.
  it.each(['transport', 'traslado'])('reconoce %s', (t) => {
    expect(H.isTransportType(t)).toBe(true);
  });

  it.each(['tour', 'experience', 'a-disposicion', 'concepto', '', undefined])('no reconoce %s', (t) => {
    expect(H.isTransportType(t)).toBe(false);
  });
});

describe('hoursText — una sola forma de escribir horas', () => {
  // Convivían "hora/horas" en el detalle, "hour/hours" en el itinerario y un "6h" pegado en Espera.
  it('usa singular en 1 y plural en el resto', () => {
    expect(H.hoursText(1)).toBe('1 hr');
    expect(H.hoursText(6)).toBe('6 hrs');
    expect(H.hoursText(0)).toBe('0 hrs');
  });

  it('tolera cadenas y basura sin romper', () => {
    expect(H.hoursText('4')).toBe('4 hrs');
    expect(H.hoursText(undefined)).toBe('0 hrs');
    expect(H.hoursText('x')).toBe('0 hrs');
  });
});

describe('roundDownTo15 — hora de pick-up al cuarto ANTERIOR', () => {
  it('redondea hacia abajo, nunca hacia arriba', () => {
    expect(H.roundDownTo15('14:18')).toBe('14:15');
    expect(H.roundDownTo15('14:59')).toBe('14:45');
    expect(H.roundDownTo15('14:00')).toBe('14:00');
  });

  it('devuelve la entrada tal cual si no es una hora', () => {
    expect(H.roundDownTo15('')).toBe('');
    expect(H.roundDownTo15('mañana')).toBe('mañana');
    expect(H.roundDownTo15('ab:cd')).toBe('ab:cd');
  });
});

describe('durationLabel — cada tipo guarda la duración en un campo distinto', () => {
  // El `duration: 1` espurio está en 12 de 14 subconceptos de JUL-2607-001, incluidos dos conceptos.
  // Con `duration || hours`, un a-disposición de 6 h se anunciaba como "1 hr".
  it('a-disposición usa `hours` aunque arrastre un `duration` espurio', () => {
    expect(H.durationLabel({ type: 'a-disposicion', hours: 6, duration: 1 })).toBe('6 hrs');
  });

  it('traslado usa `routeDuration`, que está en MINUTOS', () => {
    expect(H.durationLabel({ type: 'transport', routeDuration: 105 })).toBe('1 hr 45 min');
    expect(H.durationLabel({ type: 'transport', routeDuration: 45 })).toBe('45 min');
    expect(H.durationLabel({ type: 'transport', routeDuration: 120 })).toBe('2 hrs');
  });

  it('un traslado NO usa `duration`, aunque lo traiga', () => {
    expect(H.durationLabel({ type: 'transport', duration: 1 })).toBe('');
  });

  it('tour y experiencia usan `duration`', () => {
    expect(H.durationLabel({ type: 'tour', duration: 4 })).toBe('4 hrs');
    expect(H.durationLabel({ type: 'experience', duration: 1 })).toBe('1 hr');
  });

  it('un concepto no tiene duración', () => {
    expect(H.durationLabel({ type: 'concepto', duration: 1, hours: 3 })).toBe('');
  });
});

describe('startTime — en una SALIDA a aeropuerto encabeza el pick-up, no el vuelo', () => {
  // El pasajero leía "18:00" y entendía que a esa hora pasaban por él; la camioneta sale 3h45 antes.
  const salida = {
    type: 'transport', transportType: 'aeropuerto', directionType: 'departure', time: '18:00',
  };

  it('usa la hora sugerida de pick-up, redondeada', () => {
    expect(H.startTime({ ...salida, flightDepartureTimeSuggested: '14:18' })).toBe('14:15');
  });

  it('sin hora sugerida cae a la del servicio', () => {
    expect(H.startTime(salida)).toBe('18:00');
  });

  it('una LLEGADA usa la hora del servicio: ahí solo hay una', () => {
    expect(H.startTime({
      type: 'transport', transportType: 'aeropuerto', directionType: 'arrival', time: '12:00',
    })).toBe('12:00');
  });

  it('extrae la hora del inicio de un rango cuando no hay `time`', () => {
    expect(H.startTime({ type: 'experience', selectedSchedule: '09:00 - 15:00' })).toBe('09:00');
  });

  it('sin ninguna hora capturada devuelve vacío', () => {
    expect(H.startTime({ type: 'transport' })).toBe('');
  });
});

describe('peopleLabel — cada tipo guarda el desglose en campos distintos', () => {
  // La divergencia más grande del reporte: 122 de 291 servicios.
  it('un traslado lee transportAdults/Children/Infants', () => {
    expect(H.peopleLabel({
      type: 'transport', transportAdults: 4, transportChildren: 2, transportInfants: 1,
    })).toBe('4 adultos, 2 niños, 1 infante');
  });

  it('un traslado NO lee adultsQuantity: está vacío en los 112 de la base', () => {
    expect(H.peopleLabel({ type: 'transport', adultsQuantity: 9 })).toBe('9 adultos');
  });

  it('respalda con `persons`, que 84 traslados llenan y el itinerario ignoraba', () => {
    expect(H.peopleLabel({ type: 'transport', persons: 1 })).toBe('1 persona');
  });

  it('separa a los adultos sin alcohol en vez de sumarlos', () => {
    // El itinerario los sumaba: "2 adultos" donde el detalle decía "1 adulto, 1 sin alcohol".
    expect(H.peopleLabel({
      type: 'experience', adultsQuantity: 1, childrenQuantity: 1, adultsNoAlcoholQuantity: 1,
    })).toBe('1 adulto, 1 niño, 1 sin alcohol');
  });

  it('un concepto con gente capturada sí la muestra', () => {
    // 12 de 30 conceptos de la base tienen conteo; el detalle no lo mostraba.
    expect(H.peopleLabel({ type: 'concepto', adultsQuantity: 2 })).toBe('2 adultos');
    expect(H.peopleLabel({ type: 'concepto', persons: 3 })).toBe('3 personas');
  });

  it('un walking tour cae a su propio conteo cuando no hay desglose', () => {
    expect(H.peopleLabel({ type: 'tour', isWalkingTour: true, walkingTourPeopleCount: 5 }))
      .toBe('5 personas');
  });

  it('sin ningún conteo devuelve vacío, no "0 personas"', () => {
    expect(H.peopleLabel({ type: 'transport' })).toBe('');
    expect(H.peopleLabel({ type: 'concepto' })).toBe('');
  });

  it('singulariza cada categoría por separado', () => {
    expect(H.peopleLabel({
      type: 'transport', transportAdults: 1, transportChildren: 1, transportInfants: 1,
    })).toBe('1 adulto, 1 niño, 1 infante');
  });
});

describe('iconKey — el riel distingue llegada de salida', () => {
  it('un traslado de aeropuerto distingue la dirección', () => {
    expect(H.iconKey({ type: 'transport', transportType: 'aeropuerto', directionType: 'departure' })).toBe('departure');
    expect(H.iconKey({ type: 'transport', transportType: 'aeropuerto', directionType: 'arrival' })).toBe('arrival');
  });

  it('sin dirección, una llegada es el caso por defecto', () => {
    expect(H.iconKey({ type: 'transport', transportType: 'aeropuerto' })).toBe('arrival');
  });

  it('el resto de los traslados usan el ícono genérico, incluido el type legado', () => {
    expect(H.iconKey({ type: 'transport', transportType: 'punto-a-punto' })).toBe('transfer');
    expect(H.iconKey({ type: 'traslado' })).toBe('transfer');
  });

  it('«a disposición» es transporte, no experiencia', () => {
    // Caía al default y salía con el ícono de experiencias, que no le corresponde: es un vehículo
    // con chofer por horas.
    expect(H.iconKey({ type: 'a-disposicion' })).toBe('transfer');
  });

  it('tour y experiencia', () => {
    expect(H.iconKey({ type: 'tour' })).toBe('city');
    expect(H.iconKey({ type: 'experience' })).toBe('experience');
    expect(H.iconKey({ type: 'concepto' })).toBe('experience');
  });
});

describe('locationLines — direcciones en traslados, nombres en el resto', () => {
  it('un traslado sencillo muestra pick-up y drop-off', () => {
    expect(H.locationLines({ type: 'transport', pickupAddress: 'Hotel Rosewood', dropoffAddress: 'BJX' }))
      .toEqual([
        { label: 'Pick-up', value: 'Hotel Rosewood' },
        { label: 'Drop-off', value: 'BJX' },
      ]);
  });

  it('un redondo desglosa ida y regreso', () => {
    expect(H.locationLines({
      type: 'transport',
      tripType: 'round-trip',
      pickupAddressIda: 'A',
      dropoffAddressIda: 'B',
      pickupAddressVuelta: 'B',
      dropoffAddressVuelta: 'A',
    }).map((l) => l.label)).toEqual([
      'Pick-up (ida)', 'Drop-off (ida)', 'Pick-up (regreso)', 'Drop-off (regreso)',
    ]);
  });

  it('un tour usa origen y destino por nombre, porque su título no es la ruta', () => {
    expect(H.locationLines({ type: 'tour', originName: 'San Miguel', destinationName: 'Querétaro' }))
      .toEqual([
        { label: 'Desde', value: 'San Miguel' },
        { label: 'Hacia', value: 'Querétaro' },
      ]);
  });

  it('omite los renglones vacíos y recorta espacios', () => {
    expect(H.locationLines({ type: 'transport', pickupAddress: '  Hotel  ', dropoffAddress: '   ' }))
      .toEqual([{ label: 'Pick-up', value: 'Hotel' }]);
  });

  it('sin ninguna ubicación devuelve lista vacía', () => {
    expect(H.locationLines({ type: 'transport' })).toEqual([]);
  });
});

describe('attendeeNames — devuelve el DATO, no el HTML', () => {
  // Cada vista lo envuelve distinto: el detalle en su renglón, el itinerario como línea corrida.
  it('limpia espacios y descarta vacíos', () => {
    expect(H.attendeeNames({ attendees: [' Ana ', '', '   ', 'Luis'] })).toEqual(['Ana', 'Luis']);
  });

  it('tolera nulos dentro de la lista', () => {
    expect(H.attendeeNames({ attendees: [null, 'Ana', undefined] })).toEqual(['Ana']);
  });

  it('sin lista devuelve arreglo vacío, no null', () => {
    expect(H.attendeeNames({})).toEqual([]);
    expect(H.attendeeNames({ attendees: 'Ana' })).toEqual([]);
  });

  it('NO escapa: eso le toca a quien lo pinta', () => {
    expect(H.attendeeNames({ attendees: ['<b>Ana</b>'] })).toEqual(['<b>Ana</b>']);
  });
});

describe('todas las funciones toleran una entrada vacía', () => {
  // Las llaman dos vistas con formas de dato distintas; una entrada nula no debe tumbar el render.
  it.each([
    ['durationLabel', () => H.durationLabel(undefined)],
    ['startTime', () => H.startTime(undefined)],
    ['peopleLabel', () => H.peopleLabel(undefined)],
    ['durationLabel con objeto vacío', () => H.durationLabel({})],
    ['startTime con objeto vacío', () => H.startTime({})],
    ['peopleLabel con objeto vacío', () => H.peopleLabel({})],
    ['iconKey', () => H.iconKey(undefined)],
  ])('%s no lanza y devuelve cadena', (_, fn) => {
    expect(typeof fn()).toBe('string');
  });

  it.each([
    ['locationLines', () => H.locationLines(undefined)],
    ['attendeeNames', () => H.attendeeNames(undefined)],
  ])('%s no lanza y devuelve arreglo', (_, fn) => {
    expect(Array.isArray(fn())).toBe(true);
  });
});

describe('vehicleSlotCount', () => {
  it('cuenta 0 en experiencias aunque quantity sea > 0: ahí quantity son PERSONAS', () => {
    expect(H.vehicleSlotCount({ type: 'experience', quantity: 4 })).toBe(0);
  });

  it('cuenta 0 en un tour caminando aunque traiga datos de vehículo', () => {
    expect(H.vehicleSlotCount({ type: 'tour', isWalkingTour: true, vehicleTypeName: 'VAN', quantity: 2 })).toBe(0);
  });

  it('cuenta 0 en un tour SIN datos de vehículo: no todo tour lleva camioneta', () => {
    expect(H.vehicleSlotCount({ type: 'tour', quantity: 3 })).toBe(0);
  });

  it('cuenta el tour que sí trae datos de vehículo', () => {
    expect(H.vehicleSlotCount({ type: 'tour', vehicleTypeName: 'SUBURBAN', quantity: 3 })).toBe(3);
  });

  it('en «a disposición» lee vehicleCount, no quantity', () => {
    expect(H.vehicleSlotCount({ type: 'a-disposicion', quantity: 5, vehicleCount: 2 })).toBe(2);
  });

  it('cubre el tipo legado `traslado` igual que `transport`', () => {
    expect(H.vehicleSlotCount({ type: 'traslado', quantity: 2 })).toBe(2);
  });

  it('un traslado sin quantity capturado sigue pidiendo una plaza', () => {
    expect(H.vehicleSlotCount({ type: 'transport' })).toBe(1);
  });
});

describe('vehicleTypeAsName', () => {
  it('descarta un objectId de Parse para no imprimírselo al cliente como modelo', () => {
    expect(H.vehicleTypeAsName('YtuCemqCpI')).toBe('');
  });

  it('conserva el nombre cuando el campo trae el NOMBRE, que pasa en registros viejos', () => {
    expect(H.vehicleTypeAsName('SEDAN')).toBe('SEDAN');
  });

  it('conserva nombres de 10 caracteres que no parecen objectId', () => {
    expect(H.vehicleTypeAsName('Van Turíst')).toBe('Van Turíst');
  });
});

describe('pairOffersDriver', () => {
  it('un traslado siempre ofrece chofer: sin chofer no hay traslado', () => {
    expect(H.pairOffersDriver({ type: 'transport', includeGuide: false })).toBe(true);
  });

  it('un tour sin "Guía + Chofer" NO ofrece chofer: solo el vehículo', () => {
    expect(H.pairOffersDriver({ type: 'tour', includeGuide: false })).toBe(false);
  });

  it('un tour con "Guía + Chofer" sí lo ofrece', () => {
    expect(H.pairOffersDriver({ type: 'tour', includeGuide: true })).toBe(true);
  });

  it('«a disposición» nunca lo ofrece en la plaza: ahí el chofer va como rol', () => {
    expect(H.pairOffersDriver({ type: 'a-disposicion', includeGuide: true })).toBe(false);
  });
});

describe('buildVehicleSlots', () => {
  const chofer = { id: 'd1', fullName: 'Alberto Castro' };
  const camioneta = { id: 'v1', name: 'Audi Clase A' };

  it('no dibuja plazas cuando el servicio no lleva vehículo', () => {
    expect(H.buildVehicleSlots({ type: 'experience', quantity: 4 }, {})).toEqual([]);
  });

  it('una plaza vacía anuncia el tipo COTIZADO en vez del genérico «Vehículo»', () => {
    const [slot] = H.buildVehicleSlots({ type: 'transport', quantity: 1, vehicleTypeName: 'MODEL Y' }, {});
    expect(slot.pending).toBe(true);
    expect(slot.label).toBe('MODEL Y');
  });

  it('cae a «Vehículo» solo cuando no hay tipo cotizado', () => {
    const [slot] = H.buildVehicleSlots({ type: 'transport', quantity: 1 }, {});
    expect(slot.label).toBe('Vehículo');
  });

  it('mantiene el HUECO en su lugar: la extra asignada no se corre a la plaza 0', () => {
    const slots = H.buildVehicleSlots(
      { type: 'transport', quantity: 2, vehicleTypeName: 'MODEL Y' },
      { extras: [{ driverId: 'd2', driverName: 'Test Driver', vehicleId: 'v2', vehicleName: 'Hiace' }] },
    );
    expect(slots).toHaveLength(2);
    expect(slots[0].pending).toBe(true);
    expect(slots[0].label).toBe('MODEL Y');
    expect(slots[1].driver.fullName).toBe('Test Driver');
  });

  it('la plaza 0 escribe en primer nivel y la 1 en extras[0]', () => {
    const slots = H.buildVehicleSlots({ type: 'transport', quantity: 2 }, { driver: chofer, vehicle: camioneta });
    expect(slots[0].extraIndex).toBeNull();
    expect(slots[1].extraIndex).toBe(0);
  });

  it('nunca oculta a alguien ya asignado, aunque quantity diga menos', () => {
    const slots = H.buildVehicleSlots(
      { type: 'transport', quantity: 1 },
      { driver: chofer, vehicle: camioneta, extras: [{ driverId: 'd2', driverName: 'Segundo' }] },
    );
    expect(slots).toHaveLength(2);
  });

  it('una plaza con vehículo y sin chofer lo pide, si el servicio lo ofrece', () => {
    const [slot] = H.buildVehicleSlots({ type: 'transport', quantity: 1 }, { vehicle: camioneta });
    expect(slot.needsDriver).toBe(true);
  });

  it('no pide chofer en un tour sin "Guía + Chofer": ese tour va sin chofer contratado', () => {
    const [slot] = H.buildVehicleSlots(
      { type: 'tour', quantity: 1, vehicleTypeName: 'VAN', includeGuide: false },
      { vehicle: camioneta },
    );
    expect(slot.needsDriver).toBe(false);
  });

  it('hereda el segmento del servicio en las plazas sin uno propio', () => {
    const slots = H.buildVehicleSlots(
      { type: 'transport', quantity: 2, categoryName: 'Premium', categoryColor: '#b8894a' },
      {},
    );
    expect(slots.map((s) => s.segmentName)).toEqual(['Premium', 'Premium']);
  });

  it('la plaza extra ASIGNADA también muestra su segmento cotizado', () => {
    const slots = H.buildVehicleSlots(
      {
        type: 'tour',
        quantity: 2,
        vehicleTypeName: 'SUBURBAN',
        includeGuide: true,
        extraAdditionalVehicles: [{ vehicleTypeName: 'MODEL 3', segmentName: 'First Class' }],
      },
      { driver: chofer, vehicle: camioneta, extras: [{ driverId: 'd2', driverName: 'Test', vehicleId: 'v2', vehicleName: 'Hiace' }] },
    );
    expect(slots[1].segmentName).toBe('First Class');
  });

  it('reconstruye teléfono y placa de la plaza extra, que vienen en el blob plano', () => {
    const slots = H.buildVehicleSlots(
      { type: 'transport', quantity: 2 },
      {
        driver: chofer,
        vehicle: camioneta,
        extras: [{
          driverId: 'd2', driverName: 'Test', driverPhone: '5512345678',
          vehicleId: 'v2', vehicleName: 'Hiace', vehiclePlate: 'ABC-12-34',
        }],
      },
    );
    expect(slots[1].driver.phone).toBe('5512345678');
    expect(slots[1].vehicle.plate).toBe('ABC-12-34');
  });
});

describe('roleRows', () => {
  const persona = { id: 'p1', fullName: 'Ana Ruiz' };

  it('un tour SIEMPRE muestra guía: lo trae propio, no depende del checkbox', () => {
    expect(H.roleRows({ type: 'tour' }, {}).map((r) => r.role)).toEqual(['Guía']);
  });

  it('en «a disposición» el renglón es Chofer y su pool son choferes', () => {
    const [row] = H.roleRows({ type: 'a-disposicion' }, {});
    expect(row.role).toBe('Chofer');
    expect(row.pool).toBe('drivers');
  });

  it('un traslado sin "Guía + Chofer" no muestra renglón de guía', () => {
    expect(H.roleRows({ type: 'transport' }, {})).toEqual([]);
  });

  it('un rol contratado y sin asignar sale pendiente', () => {
    const [row] = H.roleRows({ type: 'transport', includeGreeter: true }, {});
    expect(row.role).toBe('Greeter');
    expect(row.pending).toBe(true);
  });

  it('el Customer Support del servicio se oculta cuando es el MISMO de la reservación', () => {
    const rows = H.roleRows({ type: 'transport' }, { serviceCustomer: persona }, { reservationSupportId: 'p1' });
    expect(rows).toEqual([]);
  });

  it('el Customer Support se muestra cuando DIVERGE del de la reservación', () => {
    const rows = H.roleRows({ type: 'transport' }, { serviceCustomer: persona }, { reservationSupportId: 'otro' });
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe('solo este servicio');
  });

  it('sin Customer Support en la reservación, el del servicio se muestra tal cual', () => {
    const rows = H.roleRows({ type: 'transport' }, { serviceCustomer: persona });
    expect(rows.map((r) => r.role)).toEqual(['Customer Support']);
  });

  it('el Customer Support nunca sale pendiente: es opcional, no contratado', () => {
    const rows = H.roleRows({ type: 'tour' }, {}).filter((r) => r.role === 'Customer Support');
    expect(rows).toEqual([]);
  });
});

describe('compareByTime — un solo orden para el detalle y el itinerario', () => {
  it('los servicios SIN hora van primero: es el orden del itinerario, y son el 76%', () => {
    const orden = [{ time: '14:15' }, { time: null }, { time: '09:00' }].sort(H.compareByTime);
    expect(orden.map((s) => s.time)).toEqual([null, '09:00', '14:15']);
  });

  it('toma el INICIO de un rango "HH:MM - HH:MM", como el de las llegadas', () => {
    expect(H.timeToMinutes('14:15 - 15:00')).toBe(855);
  });

  it('ordena numéricamente: "9:00" va antes que "14:15" pese al orden de cadena', () => {
    const orden = [{ time: '14:15' }, { time: '9:00' }].sort(H.compareByTime);
    expect(orden.map((s) => s.time)).toEqual(['9:00', '14:15']);
  });

  it('deja igual dos servicios sin hora, para no alterar su orden de origen', () => {
    expect(H.compareByTime({ time: null }, {})).toBe(0);
  });
});
