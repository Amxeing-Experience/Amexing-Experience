/**
 * Descuento por servicio en el motor de pagos — integration tests (Parse + mongodb-memory-server).
 *
 * Regresión del descuento IGNORADO por PaymentService: chargeAmount leía pricesByType[método] BRUTO y
 * nunca restaba subconcept.discountAmount, así que summarize().total (y por ende balance/paymentStatus)
 * divergía de reservation.totalAmount por exactamente el monto del descuento. Impacto real: un cliente
 * que pagaba el total correcto (ya con descuento) quedaba con balance positivo (= el descuento) PARA
 * SIEMPRE y paymentStatus nunca llegaba a 'paid'.
 *
 * El fix: chargeAmount resta el descuento escalado por el mismo factor de forma de pago que el front
 * (getServiceDiscountInPaymentType) y el server (evaluateTotalsConsistency); toServiceItems ahora expone
 * discountAmount para que llegue hasta el motor. Estas pruebas verifican, con reservaciones reales, que
 * el header y el motor cuadran y que un pago del total neto salda de verdad.
 */

const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');
const PaymentService = require('../../../src/application/services/PaymentService');
const QuoteService = require('../../../src/application/services/QuoteService');
const { buildSubconcept } = require('../../helpers/serviceItemsFixture');

describe('Descuento por servicio en el motor de pagos (integration)', () => {
  let app;
  let adminUser;
  const quoteService = new QuoteService();
  const created = { reservations: [], quotes: [] };

  const uniqueFolio = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Payload de serviceItems (1 día). subtotal = suma de los subconcept.total NETOS (ya con descuento),
  // igual que el wizard (getServiceDisplayPrice). El header lo usa tal cual para servicesSubtotal.
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

  const makeQuote = async (serviceItems, status = 'scheduled') => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', status);
    quote.set('folio', uniqueFolio('QTE-SVCDISC'));
    quote.set('numberOfPeople', 2);
    quote.set('client', adminUser);
    quote.set('serviceItems', serviceItems);
    await quote.save(null, { useMasterKey: true });
    created.quotes.push(quote.id);
    return quote;
  };

  const fetchReservation = (id) => new Parse.Query('Reservation').get(id, { useMasterKey: true });

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    // Login para asegurar que el Parse test server está arriba; el token no se usa (sin HTTP).
    await AuthTestHelper.loginAs('admin', app);

    adminUser = new Parse.Object('AmexingUser');
    adminUser.set('exists', true);
    adminUser.set('active', true);
    adminUser.set('role', 'admin');
    adminUser.set('email', `svcdisc-admin-${Date.now()}@test.local`);
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

  it('I-DISC1: 1 servicio $2000 con descuento $300 (sin propina) -> totalAmount 1700 Y summarize().total 1700 (antes daba 2000)', async () => {
    const sc = buildSubconcept({ id: 'idisc1', priceEfectivo: 2000, discountAmount: 300 });
    const quote = await makeQuote(siBody([sc], { subtotal: 1700, total: 1700 }));
    const reservationResult = await quoteService.createReservationFromQuote(quote, adminUser);
    created.reservations.push(reservationResult.id);

    const reservation = await fetchReservation(reservationResult.id);
    const summary = await PaymentService.summarize(reservationResult.id);
    expect(reservation.get('totalAmount')).toBe(1700);
    expect(summary.total).toBe(1700); // el motor ya resta el descuento, sin divergir del header
    expect(summary.total).toBe(reservation.get('totalAmount'));
  });

  it('I-DISC2: $2000 con descuento $200 + propina 10% (sobre el neto) -> totalAmount 1980 Y summarize().total 1980', async () => {
    const sc = buildSubconcept({
      id: 'idisc2', priceEfectivo: 2000, discountAmount: 200, tipType: 'percent', tipValue: 10,
    });
    // neto 1800, propina 10% sobre 1800 = 180 -> total 1980.
    const quote = await makeQuote(siBody([sc], { subtotal: 1800, total: 1980 }));
    const reservationResult = await quoteService.createReservationFromQuote(quote, adminUser);
    created.reservations.push(reservationResult.id);

    const reservation = await fetchReservation(reservationResult.id);
    const summary = await PaymentService.summarize(reservationResult.id);
    expect(reservation.get('totalAmount')).toBe(1980);
    expect(summary.total).toBe(1980);
    expect(summary.serviceTipsTotal).toBe(180); // propina sobre el neto, una sola vez
    expect(summary.total).toBe(reservation.get('totalAmount'));
  });

  it('I-DISC3 (impacto real): un pago del total neto ($1700) salda la reservación -> balance 0, paymentStatus "paid" (antes: balance 300 para siempre)', async () => {
    const sc = buildSubconcept({ id: 'idisc3', priceEfectivo: 2000, discountAmount: 300 });
    const quote = await makeQuote(siBody([sc], { subtotal: 1700, total: 1700 }));
    const reservationResult = await quoteService.createReservationFromQuote(quote, adminUser);
    created.reservations.push(reservationResult.id);

    // Pago REAL del total correcto (ya con descuento). Antes del fix el motor creía que se debían
    // $2000, así que $1700 dejaba un balance de $300 y el status atascado en 'partial' para siempre.
    const reservationPtr = new Parse.Object('Reservation');
    reservationPtr.id = reservationResult.id;
    const payment = new Parse.Object('Payment');
    payment.set('active', true);
    payment.set('exists', true);
    payment.set('reservationPtr', reservationPtr);
    payment.set('amount', 1700);
    payment.set('method', 'efectivo');
    payment.set('paidAt', new Date());
    await payment.save(null, { useMasterKey: true });

    await PaymentService.recalculate(reservationResult.id);

    const after = await fetchReservation(reservationResult.id);
    expect(after.get('balance')).toBe(0);
    expect(after.get('paymentStatus')).toBe('paid');
  });
});
