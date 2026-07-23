/**
 * Reactivar una reservación cancelada — integration tests (Parse + mongodb-memory-server).
 *
 * Cuando un admin cancela una reservación (quote.status='rejected', reservation.status='cancelled') y luego
 * la "reactiva" volviendo la cotización a 'scheduled', la Reservation y sus ReservationService DEBEN
 * revivir. Antes del fix los 4 callers que buscaban "¿ya existe reservación?" solo filtraban exists:true
 * (encontraban la cancelada y la trataban como "ya existe"), así que la rama de reactivación de
 * createReservationFromQuote nunca corría. Además, esa rama sólo volteaba el status de los servicios sin
 * reconciliar su subconcept, de modo que reservation.totalAmount (recalculado) divergía del motor de pagos.
 *
 * REACT-I1: prueba a nivel de servicio que reactivar reconcilia el subconcepto editado y que header==motor.
 * REACT-I2: prueba que la reactivación es alcanzable por el flujo HTTP real (PUT /api/quotes/:id).
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');
const PaymentService = require('../../../src/application/services/PaymentService');
const QuoteService = require('../../../src/application/services/QuoteService');
const { buildSubconcept } = require('../../helpers/serviceItemsFixture');

describe('Reactivar reservación cancelada (integration)', () => {
  let app;
  let adminToken;
  let adminUser;
  const quoteService = new QuoteService();
  const created = { reservations: [], quotes: [] };

  const uniqueFolio = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // serviceItems de 1 día; el dayTotal se deriva de la suma de subconceptos.
  const siBody = (subs, {
    subtotal, total, globalTip = null, currency = 'MXN', paymentType = 'efectivo',
  }) => ({
    paymentType,
    currency,
    subtotal,
    iva: 0,
    total,
    globalTip,
    days: [{
      dayNumber: 1,
      dayTitle: '',
      date: '2026-08-15',
      dayTotal: subs.reduce((s, x) => s + (x.total || 0), 0),
      subconcepts: subs,
    }],
  });

  const makeQuote = async (serviceItems, status = 'scheduled') => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', status);
    quote.set('folio', uniqueFolio('QTE-REACT'));
    quote.set('numberOfPeople', 2);
    quote.set('client', adminUser);
    quote.set('serviceItems', serviceItems);
    await quote.save(null, { useMasterKey: true });
    created.quotes.push(quote.id);
    return quote;
  };

  const fetchQuote = (id) => new Parse.Query('Quote').get(id, { useMasterKey: true });
  const fetchReservation = (id) => new Parse.Query('Reservation').get(id, { useMasterKey: true });
  const findServices = (reservation) => new Parse.Query('ReservationService')
    .equalTo('reservationPtr', reservation).equalTo('exists', true).find({ useMasterKey: true });

  // Cancela como lo hace cancelReservation: reservación + servicios activos en 'cancelled'.
  const cancelDirect = async (reservationId) => {
    const reservation = await fetchReservation(reservationId);
    reservation.set('status', 'cancelled');
    await reservation.save(null, { useMasterKey: true });
    const services = await new Parse.Query('ReservationService')
      .equalTo('reservationPtr', reservation).equalTo('active', true).equalTo('exists', true)
      .find({ useMasterKey: true });
    services.forEach((s) => s.set('status', 'cancelled'));
    if (services.length > 0) await Parse.Object.saveAll(services, { useMasterKey: true });
  };

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    adminToken = await AuthTestHelper.loginAs('admin', app);

    adminUser = new Parse.Object('AmexingUser');
    adminUser.set('exists', true);
    adminUser.set('active', true);
    adminUser.set('role', 'admin');
    adminUser.set('email', `react-admin-${Date.now()}@test.local`);
    adminUser.set('username', adminUser.get('email'));
    await adminUser.save(null, { useMasterKey: true });
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
        const reservationPtr = new Parse.Object('Reservation');
        reservationPtr.id = reservationId;
        const payments = await new Parse.Query('Payment')
          .equalTo('reservationPtr', reservationPtr).find({ useMasterKey: true });
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

  describe('nivel de servicio: reactivar reconcilia el subconcepto editado', () => {
    it('REACT-I1: se edita descuento+propina por servicio estando cancelada; al reactivar, header==motor (1800) y el RS refleja lo NUEVO', async () => {
      // 1 servicio $2000 efectivo, sin descuento/propina.
      const initial = buildSubconcept({ id: 'react1', priceEfectivo: 2000 });
      const quote = await makeQuote(siBody([initial], { subtotal: 2000, total: 2000 }), 'scheduled');
      const first = await quoteService.createReservationFromQuote(quote, adminUser);
      created.reservations.push(first.id);

      const before = await fetchReservation(first.id);
      expect(before.get('totalAmount')).toBe(2000);

      // Cancelar (reservación + servicios).
      await cancelDirect(first.id);

      // El vendedor edita el MISMO subconcepto mientras está cancelada: discountAmount 300 + propina $100
      // fija (tipAmount:100). sub.total pasa de 2000 a 1700. subtotal 1700, total 1800 (1700+100).
      const edited = buildSubconcept({
        id: 'react1', priceEfectivo: 2000, discountAmount: 300, tipType: 'amount', tipValue: 100,
      });
      expect(edited.total).toBe(1700);
      expect(edited.tipAmount).toBe(100);
      quote.set('serviceItems', siBody([edited], { subtotal: 1700, total: 1800 }));
      await quote.save(null, { useMasterKey: true });

      // Reactivar: toma la rama existing.status === 'cancelled' de createReservationFromQuote.
      const reactivated = await quoteService.createReservationFromQuote(quote, adminUser);
      expect(reactivated.id).toBe(first.id);

      const after = await fetchReservation(first.id);
      expect(after.get('totalAmount')).toBe(1800); // 1700 + 100 propina

      // AMBOS coinciden ahora (antes divergían 1800 header vs 2000 motor por el subconcepto viejo).
      const summary = await PaymentService.summarize(first.id);
      expect(summary.total).toBe(1800);
      expect(summary.total).toBe(after.get('totalAmount'));

      // El ReservationService reactivado: ya NO 'cancelled' y su subconcept trae los valores NUEVOS.
      const services = await findServices(after);
      expect(services).toHaveLength(1);
      expect(services[0].get('status')).not.toBe('cancelled');
      const sub = services[0].get('subconcept');
      expect(sub.discountAmount).toBe(300);
      expect(sub.tipAmount).toBe(100);
      expect(sub.total).toBe(1700);
    });
  });

  describe('flujo HTTP real: PUT /api/quotes/:id {status:scheduled} reactiva la reservación', () => {
    it('REACT-I2: reservación cancelada vía cancelReservation; el PUT de "Agendado" la deja NO cancelada (alcanzable por HTTP)', async () => {
      const sc = buildSubconcept({ id: 'react2', priceEfectivo: 2000 });
      const quote = await makeQuote(siBody([sc], { subtotal: 2000, total: 2000 }), 'scheduled');
      const res0 = await quoteService.createReservationFromQuote(quote, adminUser);
      created.reservations.push(res0.id);

      let reservation = await fetchReservation(res0.id);
      expect(reservation.get('status')).not.toBe('cancelled');

      // Cancelar por el flujo real: quote -> 'rejected', reservación + servicios -> 'cancelled'.
      await quoteService.cancelReservation(adminUser, quote.id, 'QA cancel', 'admin');
      reservation = await fetchReservation(res0.id);
      expect(reservation.get('status')).toBe('cancelled'); // precondición del bug
      expect((await fetchQuote(quote.id)).get('status')).toBe('rejected');

      // El MISMO request que dispara la UI de "Agendado".
      const res = await request(app)
        .put(`/api/quotes/${quote.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'scheduled' });
      expect(res.status).toBe(200);

      // La Reservation YA NO está cancelada (la reactivación real la deja 'pending').
      const afterReservation = await fetchReservation(res0.id);
      expect(afterReservation.get('status')).not.toBe('cancelled');
      expect(afterReservation.get('status')).toBe('pending');

      // Sus ReservationService tampoco siguen cancelados.
      const rsAfter = await findServices(afterReservation);
      expect(rsAfter.length).toBeGreaterThan(0);
      rsAfter.forEach((s) => expect(s.get('status')).not.toBe('cancelled'));

      // Y la cotización quedó agendada.
      expect((await fetchQuote(quote.id)).get('status')).toBe('scheduled');
    });
  });
});
