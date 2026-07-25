/**
 * Precio USD congelado de servicios NO tocados al editar OTRO servicio — integration tests
 * (Parse + mongodb-memory-server, feat/cambios-pagos).
 *
 * Sospecha investigada (severidad MEDIA, sin confirmar): al editar UN servicio (A) de una cotización
 * USD ya convertida a reservación, ¿el precio en USD de los DEMÁS servicios (B, no tocados) se
 * recalcula con la tasa VIGENTE del día de la edición en vez de conservar la tasa congelada?
 *
 * Escenario reproducido EXACTO al reporte: (a) Quote USD con 2 servicios A y B con pricesByType.efectivo
 * distintos y tasa activa X; (b) convertir a reservación y capturar el pricesByType/total en USD de AMBOS
 * tal como quedan en ReservationService; (c) cambiar la tasa activa del sistema a Y (real ExchangeRate,
 * sin mock); (d) editar SOLO A vía PUT /api/quotes/:id/service-items (cambio trivial de A, B con el MISMO
 * payload); (e) re-leer el ReservationService de B y comparar contra el snapshot de (b).
 *
 * Además se incluye una prueba de CARACTERIZACIÓN (no es el escenario del reporte): cuando el cliente
 * (el wizard) MANDA B con precios recalculados, el backend los persiste — documenta que el backend es una
 * capa de persistencia pura aquí y que el congelamiento del precio de servicio depende de que el cliente
 * mande B sin cambios. El ancla de pagos (reservation.exchangeRateSnapshot) permanece intacta en ambos.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');
const QuoteService = require('../../../src/application/services/QuoteService');
const ExchangeRate = require('../../../src/domain/models/ExchangeRate');

const round2 = (n) => Math.round(n * 100) / 100;

describe('Precio USD congelado de servicios no tocados (integration)', () => {
  let app;
  let adminToken;
  let adminUser;
  const quoteService = new QuoteService();
  const created = { quotes: [], reservations: [] };

  const uniqueFolio = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Fija la tasa vigente del sistema de forma determinista (desactiva la anterior e invalida el caché).
  const setSystemRate = async (value) => {
    await ExchangeRate.createExchangeRate({ value, description: 'frozen-untouched-test' });
    return value;
  };

  // Subconcepto USD con id estable. Sin descuento ni propina: total == pricesByType.efectivo, de modo que
  // la validación de consistencia del controller (total del subconcepto vs pricesByType[forma]) cuadre.
  const usdSub = (id, ef, { time = '09:00' } = {}) => ({
    id,
    time,
    concept: `Servicio ${id}`,
    type: 'concepto',
    unitPrice: ef,
    total: ef,
    includeInTotal: true,
    pricesByType: { efectivo: ef, transferencia: round2(ef * 1.16), tarjeta: round2(ef * 1.21) },
  });

  // Blob serviceItems USD completo (mismo shape que manda el wizard y que valida updateServiceItems).
  const buildServiceItems = (subs, snapshot) => {
    const subtotal = round2(subs.reduce((s, x) => s + x.total, 0));
    return {
      currency: 'USD',
      paymentType: 'efectivo',
      subtotal,
      iva: 0,
      total: subtotal,
      exchangeRateSnapshot: snapshot,
      days: [{
        dayNumber: 1,
        dayTitle: 'Día 1',
        date: '2026-09-10',
        dayTotal: subtotal,
        subconcepts: subs,
      }],
    };
  };

  const createScheduledUsdQuote = async (serviceItems) => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', 'scheduled'); // ya es reservación: PUT protege los servicios existentes por id
    quote.set('folio', uniqueFolio('QTE-FROZEN-UNTOUCHED'));
    quote.set('numberOfPeople', 2);
    quote.set('client', adminUser);
    quote.set('serviceItems', serviceItems);
    await quote.save(null, { useMasterKey: true });
    created.quotes.push(quote.id);
    return quote;
  };

  const fetchReservation = (id) => new Parse.Query('Reservation').get(id, { useMasterKey: true });

  // ReservationService activos de una reservación, indexados por subconcept.id.
  const fetchServicesById = async (reservationId) => {
    const reservationPtr = new Parse.Object('Reservation');
    reservationPtr.id = reservationId;
    const services = await new Parse.Query('ReservationService')
      .equalTo('reservationPtr', reservationPtr)
      .equalTo('exists', true)
      .limit(1000)
      .find({ useMasterKey: true });
    const byId = new Map();
    services.forEach((rs) => {
      const sub = rs.get('subconcept') || {};
      if (sub.id) byId.set(sub.id, rs);
    });
    return byId;
  };

  const putServiceItems = (quoteId, body) => request(app)
    .put(`/api/quotes/${quoteId}/service-items`).set('Authorization', `Bearer ${adminToken}`).send(body);

  // Convierte la cotización a reservación y devuelve el id de la reservación creada.
  const convertToReservation = async (quote) => {
    const result = await quoteService.createReservationFromQuote(quote, adminUser);
    created.reservations.push(result.id);
    return result.id;
  };

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    adminToken = await AuthTestHelper.loginAs('admin', app);
    adminUser = await AuthTestHelper.getUserByRole('admin');
    await setSystemRate(18.5);
  }, 30000);

  afterAll(async () => {
    for (const reservationId of created.reservations) {
      try {
        const reservationPtr = new Parse.Object('Reservation');
        reservationPtr.id = reservationId;
        const services = await new Parse.Query('ReservationService')
          .equalTo('reservationPtr', reservationPtr).find({ useMasterKey: true });
        await Parse.Object.destroyAll(services, { useMasterKey: true });
      } catch (e) { /* already gone */ }
      try {
        const reservation = await new Parse.Query('Reservation').get(reservationId, { useMasterKey: true });
        await reservation.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }
    for (const quoteId of created.quotes) {
      try {
        const quote = await new Parse.Query('Quote').get(quoteId, { useMasterKey: true });
        await quote.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }
    // Restaura la tasa por defecto (18.5) para no contaminar otros archivos en la misma corrida --runInBand.
    try { await setSystemRate(18.5); } catch (e) { /* ignore */ }
  });

  it('FROZEN-01: editar A (cambio trivial) NO recalcula el precio USD de B (no tocado) con la tasa nueva', async () => {
    // (a) Tasa X = 18.5. Quote USD con A (efectivo 100) y B (efectivo 250).
    await setSystemRate(18.5);
    const A = usdSub('svcA', 100);
    const B = usdSub('svcB', 250);
    const quote = await createScheduledUsdQuote(buildServiceItems([A, B], 18.5));

    // (b) Convertir a reservación y capturar el snapshot persistido de AMBOS servicios.
    const reservationId = await convertToReservation(quote);
    let servicesById = await fetchServicesById(reservationId);
    expect(servicesById.has('svcA')).toBe(true);
    expect(servicesById.has('svcB')).toBe(true);

    const bBefore = servicesById.get('svcB').get('subconcept');
    expect(bBefore.pricesByType.efectivo).toBe(250);
    expect(bBefore.total).toBe(250);

    const reservationBefore = await fetchReservation(reservationId);
    expect(reservationBefore.get('exchangeRateSnapshot')).toBe(18.5); // ancla de pagos

    // (c) La tasa activa del sistema cambia a Y = 25.0 (bien distinta de X). Nadie más toca la reservación.
    await setSystemRate(25.0);

    // (d) Editar SOLO A (cambio trivial: la hora 09:00 -> 10:30). B viaja con el MISMO payload (mismos
    // pricesByType/total). El precio base de A NO cambia (sigue 100), solo un campo descriptivo.
    const editedA = usdSub('svcA', 100, { time: '10:30' });
    const put = await putServiceItems(quote.id, buildServiceItems([editedA, B], 18.5));
    expect(put.status).toBe(200);

    // (e) Re-leer B (no tocado) y comparar contra el snapshot de (b).
    servicesById = await fetchServicesById(reservationId);
    const bAfter = servicesById.get('svcB').get('subconcept');

    // Núcleo de la sospecha: el precio USD de B NO debe recalcularse con la tasa 25.0.
    expect(bAfter.pricesByType.efectivo).toBe(250); // si el bug existiera podría verse 250*18.5/25 = 185
    expect(bAfter.total).toBe(250);
    expect(bAfter.pricesByType.transferencia).toBe(B.pricesByType.transferencia);
    expect(bAfter.pricesByType.tarjeta).toBe(B.pricesByType.tarjeta);

    // Control: la edición de A SÍ se aplicó (la hora cambió), así que el "sin cambio" de B no es porque
    // el PUT haya sido un no-op global.
    const aAfter = servicesById.get('svcA');
    expect(aAfter.get('subconcept').time).toBe('10:30');
    expect(aAfter.get('subconcept').pricesByType.efectivo).toBe(100); // el precio base de A tampoco cambió

    // El ancla de pagos de la reservación sigue congelada en 18.5 (sync nunca la pisa).
    const reservationAfter = await fetchReservation(reservationId);
    expect(reservationAfter.get('exchangeRateSnapshot')).toBe(18.5);
  });

  it('FROZEN-02: caracterización — si el cliente MANDA B recalculado, el backend lo persiste (capa de persistencia pura)', async () => {
    // NO es el escenario del reporte: aquí el cliente (wizard) reconvierte B a la tasa nueva y lo manda.
    // Documenta que el backend confía en lo que recibe: el congelamiento del PRECIO de servicio depende de
    // que el cliente reenvíe B sin cambios; el backend no lo recalcula ni lo defiende por su cuenta.
    await setSystemRate(18.5);
    const A = usdSub('svcA', 100);
    const B = usdSub('svcB', 250);
    const quote = await createScheduledUsdQuote(buildServiceItems([A, B], 18.5));
    const reservationId = await convertToReservation(quote);

    let servicesById = await fetchServicesById(reservationId);
    expect(servicesById.get('svcB').get('subconcept').pricesByType.efectivo).toBe(250);

    await setSystemRate(25.0);

    // El cliente reconvierte B con la tasa nueva: 250 USD @18.5 == 4625 MXN -> 4625/25 = 185 USD.
    const recalculatedB = usdSub('svcB', 185);
    const put = await putServiceItems(quote.id, buildServiceItems([A, recalculatedB], 18.5));
    expect(put.status).toBe(200);

    servicesById = await fetchServicesById(reservationId);
    const bAfter = servicesById.get('svcB').get('subconcept');
    // El backend persiste lo que mandó el cliente (comportamiento actual documentado).
    expect(bAfter.pricesByType.efectivo).toBe(185);
    expect(bAfter.total).toBe(185);

    // El ancla de pagos sigue intacta incluso en este caso (los pagos no "respiran").
    const reservationAfter = await fetchReservation(reservationId);
    expect(reservationAfter.get('exchangeRateSnapshot')).toBe(18.5);
  });
});
