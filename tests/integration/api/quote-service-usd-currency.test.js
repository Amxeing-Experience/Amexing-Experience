/**
 * Reservaciones USD: descuento/propina por servicio — integration tests (Parse + mongodb-memory-server).
 *
 * Cobertura (código YA correcto, sin bug — solo faltaba prueba): una reservación en USD calcula el header
 * (totalAmount) y el motor de pagos (summarize) con descuento y propina por servicio, SIN el redondeo a
 * múltiplo de 5 del efectivo MXN (ese cash-rounding está saltado por ser USD), y el descuento se escala por
 * el factor tarjeta/efectivo igual que en MXN.
 */

const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');
const PaymentService = require('../../../src/application/services/PaymentService');
const QuoteService = require('../../../src/application/services/QuoteService');
const { buildSubconcept } = require('../../helpers/serviceItemsFixture');

describe('Reservaciones USD: descuento/propina por servicio (integration)', () => {
  let adminUser;
  const quoteService = new QuoteService();
  const created = { reservations: [], quotes: [] };

  const uniqueFolio = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const usdSI = (subs, { subtotal, total, paymentType }) => ({
    paymentType,
    currency: 'USD',
    subtotal,
    iva: 0,
    total,
    globalTip: null,
    exchangeRateSnapshot: 18.5, // congelado: evita cualquier lookup de ExchangeRate en el motor
    days: [{
      dayNumber: 1,
      dayTitle: '',
      date: '2026-08-15',
      dayTotal: subs.reduce((s, x) => s + (x.total || 0), 0),
      subconcepts: subs,
    }],
  });

  const makeQuote = async (serviceItems) => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', 'scheduled');
    quote.set('folio', uniqueFolio('QTE-USD'));
    quote.set('numberOfPeople', 2);
    quote.set('client', adminUser);
    quote.set('serviceItems', serviceItems);
    await quote.save(null, { useMasterKey: true });
    created.quotes.push(quote.id);
    return quote;
  };

  const fetchReservation = (id) => new Parse.Query('Reservation').get(id, { useMasterKey: true });

  beforeAll(async () => {
    require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    // No se usa token HTTP aquí (se invoca el service directo), pero se autentica para forzar el seed.
    await AuthTestHelper.loginAs('admin');

    adminUser = new Parse.Object('AmexingUser');
    adminUser.set('exists', true);
    adminUser.set('active', true);
    adminUser.set('role', 'admin');
    adminUser.set('email', `usd-admin-${Date.now()}@test.local`);
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

  it('USD-I1: efectivo, precio 100 USD − descuento 15 + propina $10 => total 95; sin redondeo a múltiplo de 5', async () => {
    const sc = buildSubconcept({
      id: 'usd1',
      priceEfectivo: 100,
      priceTransferencia: 116,
      priceTarjeta: 121,
      discountAmount: 15,
      tipType: 'amount',
      tipValue: 10,
      paymentType: 'efectivo',
    });
    expect(sc.total).toBe(85); // 100 − 15 descuento
    expect(sc.tipAmount).toBe(10);

    const quote = await makeQuote(usdSI([sc], { subtotal: 85, total: 95, paymentType: 'efectivo' }));
    const result = await quoteService.createReservationFromQuote(quote, adminUser);
    created.reservations.push(result.id);

    const reservation = await fetchReservation(result.id);
    expect(reservation.get('totalAmount')).toBe(95); // 85 + 10 propina

    const summary = await PaymentService.summarize(result.id);
    expect(summary.total).toBe(95);
    expect(summary.subtotal).toBe(85); // USD: sin redondeo a múltiplo de 5
    expect(summary.total).toBe(reservation.get('totalAmount'));
  });

  it('USD-I2: tarjeta, el descuento escala por tarjeta/efectivo (18.15) => chargeAmount 102.85, total 112.85', async () => {
    // El descuento (15 en efectivo) se escala por el factor tarjeta/efectivo (121/100) también en USD.
    expect(PaymentService.chargeAmount(
      { pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 }, discountAmount: 15 },
      'tarjeta'
    )).toBe(102.85); // 121 − round2(15 * 121/100) = 121 − 18.15

    const sc = buildSubconcept({
      id: 'usd2',
      priceEfectivo: 100,
      priceTransferencia: 116,
      priceTarjeta: 121,
      discountAmount: 15,
      tipType: 'amount',
      tipValue: 10,
      paymentType: 'tarjeta',
    });
    expect(sc.total).toBe(102.85); // 121 − 18.15

    const quote = await makeQuote(usdSI([sc], { subtotal: 102.85, total: 112.85, paymentType: 'tarjeta' }));
    const result = await quoteService.createReservationFromQuote(quote, adminUser);
    created.reservations.push(result.id);

    const reservation = await fetchReservation(result.id);
    expect(reservation.get('totalAmount')).toBe(112.85); // 102.85 + 10 propina

    const summary = await PaymentService.summarize(result.id);
    expect(summary.total).toBe(112.85);
    expect(summary.total).toBe(reservation.get('totalAmount'));
  });
});
