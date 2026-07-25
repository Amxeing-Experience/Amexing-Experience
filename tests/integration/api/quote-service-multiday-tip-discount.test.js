/**
 * Multi-día: propina y descuento por servicio en días distintos — integration tests
 * (Parse + mongodb-memory-server).
 *
 * Cobertura (código YA correcto, sin bug — solo faltaba prueba): con servicios en varios días, cada día se
 * valida contra la suma de SUS subconceptos (sin fuga de un día a otro), el header (totalAmount) cuadra con
 * el motor de pagos, y tras crear la reservación cada ReservationService conserva su dayNumber (el servicio
 * del día 2 no se cruza con el día 1).
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');
const PaymentService = require('../../../src/application/services/PaymentService');
const QuoteService = require('../../../src/application/services/QuoteService');
const { buildSubconcept } = require('../../helpers/serviceItemsFixture');

describe('Multi-día: propina/descuento por servicio (integration)', () => {
  let app;
  let adminToken;
  let adminUser;
  const quoteService = new QuoteService();
  const created = { reservations: [], quotes: [] };

  const uniqueFolio = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const emptySI = {
    days: [{ dayNumber: 1, dayTitle: '', subconcepts: [] }],
    subtotal: 0, iva: 0, total: 0, currency: 'MXN', paymentType: 'efectivo',
  };

  const makeQuote = async (serviceItems) => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', 'draft');
    quote.set('folio', uniqueFolio('QTE-MULTIDAY'));
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
    adminUser.set('email', `multiday-admin-${Date.now()}@test.local`);
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

  it('MULTIDAY-I1: día1 (svc $1000 + propina $100) y día2 (svc $2000 − descuento $200); total 2900, dayNumber preservado', async () => {
    // Día 1: servicio $1000 con propina fija $100 (tipAmount:100), total limpio 1000.
    const svc1 = buildSubconcept({
      id: 'md1', priceEfectivo: 1000, tipType: 'amount', tipValue: 100,
    });
    // Día 2: servicio $2000 con descuento $200, total 1800.
    const svc2 = buildSubconcept({ id: 'md2', priceEfectivo: 2000, discountAmount: 200 });
    expect(svc1.total).toBe(1000);
    expect(svc1.tipAmount).toBe(100);
    expect(svc2.total).toBe(1800);

    const quote = await makeQuote(emptySI);

    // PUT real: cada día se valida contra la suma de SUS subconceptos (día1=1000, día2=1800).
    const body = {
      currency: 'MXN',
      paymentType: 'efectivo',
      subtotal: 2800,
      iva: 0,
      total: 2900, // 2800 + 100 propina del servicio del día 1
      days: [
        {
          dayNumber: 1, dayTitle: '', dayTotal: 1000, subconcepts: [svc1],
        },
        {
          dayNumber: 2, dayTitle: '', dayTotal: 1800, subconcepts: [svc2],
        },
      ],
    };
    const res = await putSI(quote.id, body);
    expect(res.status).toBe(200); // sin fuga entre días: día1=1000 y día2=1800 validan OK

    // Crear la reservación desde el snapshot ya guardado.
    const saved = await fetchQuote(quote.id);
    const result = await quoteService.createReservationFromQuote(saved, adminUser);
    created.reservations.push(result.id);

    const reservation = await fetchReservation(result.id);
    expect(reservation.get('totalAmount')).toBe(2900); // 2800 subtotal + 100 propina servicio día 1

    const summary = await PaymentService.summarize(result.id);
    expect(summary.total).toBe(2900);
    expect(summary.total).toBe(reservation.get('totalAmount'));

    // Cada ReservationService conserva su dayNumber (día 2 NO se cruza con día 1).
    const services = await new Parse.Query('ReservationService')
      .equalTo('reservationPtr', reservation).equalTo('exists', true).find({ useMasterKey: true });
    expect(services).toHaveLength(2);
    const day1Svc = services.find((s) => Number(s.get('subconcept').total) === 1000);
    const day2Svc = services.find((s) => Number(s.get('subconcept').total) === 1800);
    expect(day1Svc).toBeTruthy();
    expect(day2Svc).toBeTruthy();
    expect(day1Svc.get('dayNumber')).toBe(1);
    expect(day2Svc.get('dayNumber')).toBe(2);
  });
});
