/**
 * Propina POR SERVICIO sin doble conteo — integration tests (Parse + mongodb-memory-server).
 *
 * Regresión del "tercer total" en su variante de propina por servicio: el wizard guardaba el
 * subconcepto con la propina HORNEADA en total/subtotal, y el servidor la volvía a sumar vía
 * sumServiceTipsFromDays -> doble conteo en el header (totalAmount) y, peor, rechazo 400 en el PUT
 * cuando la propina neta superaba $1.00 (evaluateTotalsConsistency). El fix: el subconcepto guarda
 * SOLO precio; la propina se suma UNA sola vez en el total (mismo patrón que la propina general).
 *
 * I1 es la prueba central: el PUT que antes daba 400 ahora da 200. El resto blinda que el header
 * cuadra con el motor de pagos (summary.total) y que reservaciones viejas con el bug se autocorrigen.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');
const PaymentService = require('../../../src/application/services/PaymentService');
const QuoteService = require('../../../src/application/services/QuoteService');
const { buildSubconcept } = require('../../helpers/serviceItemsFixture');

describe('Propina por servicio sin doble conteo (integration)', () => {
  let app;
  let adminToken;
  let adminUser;
  const quoteService = new QuoteService();
  // Rastreo de todo lo creado para limpiar en afterAll y no contaminar otras suites (--runInBand,
  // mismo proceso, BD compartida).
  const created = { reservations: [], quotes: [] };

  const uniqueFolio = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Payload de serviceItems (1 día). Sirve tanto para el PUT como para el snapshot de la cotización.
  const siBody = (subs, {
    subtotal, total, globalTip = null, paymentType = 'efectivo',
  }) => ({
    paymentType,
    currency: 'MXN',
    subtotal,
    iva: 0,
    total,
    globalTip,
    suggestedTipPct: 10,
    days: [{
      dayNumber: 1,
      dayTitle: '',
      date: '2026-08-15',
      dayTotal: subs.reduce((s, x) => s + (x.total || 0), 0),
      subconcepts: subs,
    }],
  });

  const emptySI = {
    days: [{ dayNumber: 1, dayTitle: '', subconcepts: [] }],
    subtotal: 0, iva: 0, total: 0, currency: 'MXN', paymentType: 'efectivo',
  };

  const makeQuote = async (serviceItems, status = 'draft') => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', status);
    quote.set('folio', uniqueFolio('QTE-SVCTIP'));
    quote.set('numberOfPeople', 2);
    quote.set('client', adminUser);
    quote.set('serviceItems', serviceItems);
    await quote.save(null, { useMasterKey: true });
    created.quotes.push(quote.id);
    return quote;
  };

  const putSI = (quoteId, body, token = adminToken) => request(app)
    .put(`/api/quotes/${quoteId}/service-items`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

  const fetchQuote = (id) => new Parse.Query('Quote').get(id, { useMasterKey: true });
  const fetchReservation = (id) => new Parse.Query('Reservation').get(id, { useMasterKey: true });

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    adminToken = await AuthTestHelper.loginAs('admin', app);

    adminUser = new Parse.Object('AmexingUser');
    adminUser.set('exists', true);
    adminUser.set('active', true);
    adminUser.set('role', 'admin');
    adminUser.set('email', `svctip-admin-${Date.now()}@test.local`);
    adminUser.set('username', adminUser.get('email'));
    await adminUser.save(null, { useMasterKey: true });
  }, 30000);

  afterAll(async () => {
    for (const reservationId of created.reservations) {
      try {
        const reservationPtr = new Parse.Object('Reservation');
        reservationPtr.id = reservationId;
        const svcQuery = new Parse.Query('ReservationService');
        svcQuery.equalTo('reservationPtr', reservationPtr);
        const services = await svcQuery.find({ useMasterKey: true });
        await Parse.Object.destroyAll(services, { useMasterKey: true });
      } catch (e) { /* already gone */ }
      try {
        const reservationPtr = new Parse.Object('Reservation');
        reservationPtr.id = reservationId;
        const payQuery = new Parse.Query('Payment');
        payQuery.equalTo('reservationPtr', reservationPtr);
        const payments = await payQuery.find({ useMasterKey: true });
        await Parse.Object.destroyAll(payments, { useMasterKey: true });
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
    if (adminUser) { try { await adminUser.destroy({ useMasterKey: true }); } catch (e) { /* already gone */ } }
  });

  describe('PUT /service-items: el guardado ya no se rechaza por la propina (evaluateTotalsConsistency)', () => {
    it('I1: propina $150 fija sin hornear -> 200; el subconcepto guarda SOLO el precio ($2000) [antes daba 400]', async () => {
      const sc = buildSubconcept({
        id: 'i1', priceEfectivo: 2000, tipType: 'amount', tipValue: 150, bakeTipBug: false,
      });
      const quote = await makeQuote(emptySI, 'draft');
      const res = await putSI(quote.id, siBody([sc], { subtotal: 2000, total: 2150 }));
      expect(res.status).toBe(200);
      const saved = await fetchQuote(quote.id);
      expect(saved.get('serviceItems').days[0].subconcepts[0].total).toBe(2000);
    });

    it('I1b: propina 10% ($200 sobre $2000) sin hornear -> 200', async () => {
      const sc = buildSubconcept({
        id: 'i1b', priceEfectivo: 2000, tipType: 'percent', tipValue: 10, bakeTipBug: false,
      });
      const quote = await makeQuote(emptySI, 'draft');
      const res = await putSI(quote.id, siBody([sc], { subtotal: 2000, total: 2200 }));
      expect(res.status).toBe(200);
      const saved = await fetchQuote(quote.id);
      expect(saved.get('serviceItems').days[0].subconcepts[0].total).toBe(2000);
    });

    it('I1c: si alguien vuelve a HORNEAR la propina, el PUT la rechaza (400) e identifica el servicio', async () => {
      const sc = buildSubconcept({
        id: 'i1c', priceEfectivo: 2000, tipType: 'amount', tipValue: 150, bakeTipBug: true,
      });
      const quote = await makeQuote(emptySI, 'draft');
      const res = await putSI(quote.id, siBody([sc], { subtotal: 2150, total: 2150 }));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Servicio i1c/);
      expect(res.body.error).toContain('$150.00');
    });

    it('I8: subtotal limpio (2000) + total con la propina incluida (2200) -> 200; serviceItems.total conserva 2200', async () => {
      const sc = buildSubconcept({
        id: 'i8', priceEfectivo: 2000, tipType: 'percent', tipValue: 10, bakeTipBug: false,
      });
      const quote = await makeQuote(emptySI, 'draft');
      const res = await putSI(quote.id, siBody([sc], { subtotal: 2000, total: 2200 }));
      expect(res.status).toBe(200);
      const saved = await fetchQuote(quote.id);
      expect(saved.get('serviceItems').total).toBe(2200); // el backend no descarta la propina que sí viene en total
    });
  });

  describe('header (totalAmount) sin doble conteo tras propagar a la reservación', () => {
    it('I2: reservación real + PUT limpio (1 servicio $2000, propina 10%) -> totalAmount 2200, NUNCA 2400', async () => {
      const initial = buildSubconcept({ id: 'i2', priceEfectivo: 2000, bakeTipBug: false });
      const quote = await makeQuote(siBody([initial], { subtotal: 2000, total: 2000 }), 'scheduled');
      const reservationResult = await quoteService.createReservationFromQuote(quote, adminUser);
      created.reservations.push(reservationResult.id);

      const sc = buildSubconcept({
        id: 'i2', priceEfectivo: 2000, tipType: 'percent', tipValue: 10, bakeTipBug: false,
      });
      const res = await putSI(quote.id, siBody([sc], { subtotal: 2000, total: 2200 }));
      expect(res.status).toBe(200);

      const reservation = await fetchReservation(reservationResult.id);
      expect(reservation.get('totalAmount')).toBe(2200); // 2000 + 200 propina, nunca 2400
    });

    it('I3: 2 servicios + propina por servicio + propina global via PUT -> totalAmount 3400 (cada término una vez)', async () => {
      const s1 = buildSubconcept({ id: 'i3a', priceEfectivo: 1000 });
      const s2 = buildSubconcept({
        id: 'i3b', priceEfectivo: 2000, tipType: 'amount', tipValue: 100,
      });
      const quote = await makeQuote(siBody([s1, s2], { subtotal: 3000, total: 3100 }), 'scheduled');
      const reservationResult = await quoteService.createReservationFromQuote(quote, adminUser);
      created.reservations.push(reservationResult.id);

      const res = await putSI(quote.id, siBody([s1, s2], {
        subtotal: 3000, total: 3400, globalTip: { type: 'percent', value: 10, mandatory: false },
      }));
      expect(res.status).toBe(200);

      const reservation = await fetchReservation(reservationResult.id);
      expect(reservation.get('totalAmount')).toBe(3400); // 3000 + 100 servicio + 300 general
    });

    it('I4: createReservationFromQuote desde cero -> totalAmount 3400, servicesSubtotal 3000 (limpio)', async () => {
      const s1 = buildSubconcept({ id: 'i4a', priceEfectivo: 1000 });
      const s2 = buildSubconcept({
        id: 'i4b', priceEfectivo: 2000, tipType: 'amount', tipValue: 100,
      });
      const quote = await makeQuote(siBody([s1, s2], {
        subtotal: 3000, total: 3400, globalTip: { type: 'percent', value: 10, mandatory: false },
      }), 'scheduled');
      const reservationResult = await quoteService.createReservationFromQuote(quote, adminUser);
      created.reservations.push(reservationResult.id);

      const reservation = await fetchReservation(reservationResult.id);
      expect(reservation.get('totalAmount')).toBe(3400);
      expect(reservation.get('servicesSubtotal')).toBe(3000);
    });

    it('I5: reservación vieja con la propina horneada (servicesSubtotal 2200) se autocorrige tras un sync limpio', async () => {
      const sc = buildSubconcept({
        id: 'i5', priceEfectivo: 2000, tipType: 'percent', tipValue: 10, bakeTipBug: false,
      });
      const correctedSI = siBody([sc], { subtotal: 2000, total: 2200 });
      const quote = await makeQuote(correctedSI, 'scheduled');

      // Reservación "vieja": subtotal con la propina horneada (2000 + 200) y RS con tipAmount 200 aparte
      // -> recalcular sobre estos datos daría 2400 (doble conteo). El sync con el payload limpio la sana.
      const reservation = new Parse.Object('Reservation');
      reservation.set('active', true);
      reservation.set('exists', true);
      reservation.set('status', 'confirmed');
      reservation.set('quotePtr', quote);
      reservation.set('paymentType', 'efectivo');
      reservation.set('currency', 'MXN');
      reservation.set('servicesSubtotal', 2200);
      reservation.set('totalAmount', 2400);
      await reservation.save(null, { useMasterKey: true });
      created.reservations.push(reservation.id);

      // dayNumber + subconcept.id: 'i5' IGUALES a los del payload de correctedSI -- así
      // reservationServiceMatchKey empareja por "id:i5" y se ejercita la rama real de
      // reconciliación (actualizar en su lugar), no la de crear-uno-nuevo/dejar huérfano
      // (council L2F0: sin el id, el match caía al fallback por contenido y el test no
      // probaba lo que decía probar).
      const rs = new Parse.Object('ReservationService');
      rs.set('active', true);
      rs.set('exists', true);
      rs.set('reservationPtr', reservation);
      rs.set('dayNumber', 1);
      rs.set('subconcept', {
        id: 'i5', includeInTotal: true, pricesByType: { efectivo: 2000 }, total: 2000, tipAmount: 200,
      });
      await rs.save(null, { useMasterKey: true });

      await quoteService.syncReservationFromQuote(quote, correctedSI);

      const after = await fetchReservation(reservation.id);
      expect(after.get('totalAmount')).toBe(2200); // 2000 limpio + 200 propina, ya NO 2400
      expect(after.get('servicesSubtotal')).toBe(2000);

      // Confirma que se ACTUALIZÓ el RS existente (rama matched-update), no que se creó uno
      // nuevo dejando el viejo huérfano: debe seguir habiendo exactamente 1 RS activo.
      const activeRS = await new Parse.Query('ReservationService')
        .equalTo('reservationPtr', reservation).equalTo('active', true).find({ useMasterKey: true });
      expect(activeRS.length).toBe(1);
      expect(activeRS[0].id).toBe(rs.id); // mismo objeto, actualizado in-place
      expect(activeRS[0].get('subconcept').tipAmount).toBe(200);

      // Invariante del "tercer total" también en el escenario de auto-sanación.
      const summary = await PaymentService.summarize(reservation.id);
      expect(summary.total).toBe(2200);
      expect(summary.total).toBe(after.get('totalAmount'));
    });
  });

  describe('invariante: el header cuadra EXACTO con el motor de pagos', () => {
    it('I6: PaymentService.summarize.total === reservation.totalAmount (ambos 3400)', async () => {
      const s1 = buildSubconcept({ id: 'i6a', priceEfectivo: 1000 });
      const s2 = buildSubconcept({
        id: 'i6b', priceEfectivo: 2000, tipType: 'amount', tipValue: 100,
      });
      const quote = await makeQuote(siBody([s1, s2], {
        subtotal: 3000, total: 3400, globalTip: { type: 'percent', value: 10, mandatory: false },
      }), 'scheduled');
      const reservationResult = await quoteService.createReservationFromQuote(quote, adminUser);
      created.reservations.push(reservationResult.id);

      const reservation = await fetchReservation(reservationResult.id);
      const summary = await PaymentService.summarize(reservationResult.id);
      expect(reservation.get('totalAmount')).toBe(3400);
      expect(summary.total).toBe(3400);
      expect(summary.total).toBe(reservation.get('totalAmount'));
    });
  });
});
