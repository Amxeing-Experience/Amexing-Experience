/**
 * Propina cobrada (Fase 2) — integration tests (Parse + mongodb-memory-server).
 *
 * Verifica que la PROPINA (general de la reservación + por servicio) se COBRA de verdad: se suma al
 * total y al saldo, es un monto FIJO en pesos que NUNCA escala con el método de pago, y el motor de
 * pagos la deriva de fuentes crudas (reservation.tip + subconcept.tipAmount de los servicios activos),
 * IGNORANDO los campos legacy totalAmount/servicesSubtotal. Cubre también el recálculo de la propina
 * general en QuoteService (create/sync) y el fix del "tercer total" (recalculateTotal == summary.total).
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');
const PaymentService = require('../../../src/application/services/PaymentService');
const QuoteService = require('../../../src/application/services/QuoteService');
const ReservationController = require('../../../src/application/controllers/api/ReservationController');

describe('Propina cobrada (Fase 2, integration)', () => {
  let app;
  let adminToken;
  let agencyToken;
  let agencyOwner;
  let adminUser;
  const quoteService = new QuoteService();
  // Rastreo de todo lo creado en este archivo para limpiar en afterAll — sin esto, las reservaciones/
  // cotizaciones quedan huérfanas en la BD compartida de mongodb-memory-server y contaminan OTRAS
  // suites que corren en el mismo proceso (--runInBand) sin sembrar sus propios datos (ej.
  // reservations.test.js, que asume la BD vacía y solo filtra lo que ya encuentra).
  const created = { reservations: [], quotes: [] };

  // Crea una reservación con servicios (subconcept.tipAmount) y una propina general opcional.
  const createReservation = async (services, paymentType, {
    currency = 'MXN', tip = 0, exchangeRateSnapshot = null, clientPtr = null,
    servicesSubtotal = null, totalAmount = null,
  } = {}) => {
    const reservation = new Parse.Object('Reservation');
    reservation.set('active', true);
    reservation.set('exists', true);
    reservation.set('status', 'confirmed');
    reservation.set('paymentType', paymentType);
    reservation.set('currency', currency);
    if (tip) reservation.set('tip', tip);
    if (exchangeRateSnapshot) reservation.set('exchangeRateSnapshot', exchangeRateSnapshot);
    if (clientPtr) reservation.set('clientPtr', clientPtr);
    if (servicesSubtotal !== null) reservation.set('servicesSubtotal', servicesSubtotal);
    if (totalAmount !== null) reservation.set('totalAmount', totalAmount);
    await reservation.save(null, { useMasterKey: true });
    created.reservations.push(reservation.id);

    await Promise.all(services.map((s) => {
      const rs = new Parse.Object('ReservationService');
      rs.set('active', true);
      rs.set('exists', true);
      rs.set('reservationPtr', reservation);
      rs.set('subconcept', {
        includeInTotal: s.includeInTotal !== false,
        pricesByType: s.pricesByType || null,
        total: s.total !== undefined ? s.total : 0,
        tipAmount: s.tipAmount || 0,
      });
      return rs.save(null, { useMasterKey: true });
    }));

    return reservation.id;
  };

  const fetchReservation = (id) => new Parse.Query('Reservation').get(id, { useMasterKey: true });

  const TODAY = new Date().toISOString().slice(0, 10);
  const postPayment = (id, body, token = adminToken) => request(app)
    .post(`/api/reservations/${id}/payments`).set('Authorization', `Bearer ${token}`)
    .send({ paidAt: TODAY, receivedBy: 'QA Cajero', ...body });
  const getPayments = (id, token = adminToken) => request(app)
    .get(`/api/reservations/${id}/payments`).set('Authorization', `Bearer ${token}`);

  // Quote con serviceItems (globalTip + subconceptos con tipAmount) para ejercitar QuoteService.
  const makeQuote = async (globalTip, subs, { subtotal, total, currency = 'MXN' }) => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', 'scheduled');
    quote.set('folio', `QTE-TIP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    quote.set('numberOfPeople', 2);
    quote.set('client', adminUser);
    quote.set('serviceItems', {
      paymentType: 'efectivo',
      currency,
      subtotal,
      total,
      globalTip,
      days: [{
        dayNumber: 1,
        date: '2026-08-15',
        subconcepts: subs,
      }],
    });
    await quote.save(null, { useMasterKey: true });
    created.quotes.push(quote.id);
    return quote;
  };

  const subA = {
    concept: 'Servicio A', type: 'concepto', pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 }, discountAmount: 0, tipAmount: 100, includeInTotal: true,
  };
  const subB = {
    concept: 'Servicio B', type: 'concepto', pricesByType: { efectivo: 2000, transferencia: 2320, tarjeta: 2420 }, discountAmount: 0, tipAmount: 300, includeInTotal: true,
  };

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    adminToken = await AuthTestHelper.loginAs('admin', app);
    agencyToken = await AuthTestHelper.loginAs('department_manager', app);

    agencyOwner = new Parse.Object('AmexingUser');
    agencyOwner.set('exists', true);
    agencyOwner.set('active', true);
    agencyOwner.set('role', 'department_manager');
    agencyOwner.set('departmentId', 'test-dept-events');
    agencyOwner.set('email', `tips-agency-${Date.now()}@test.local`);
    agencyOwner.set('username', agencyOwner.get('email'));
    await agencyOwner.save(null, { useMasterKey: true });

    adminUser = new Parse.Object('AmexingUser');
    adminUser.set('exists', true);
    adminUser.set('active', true);
    adminUser.set('role', 'admin');
    adminUser.set('email', `tips-admin-${Date.now()}@test.local`);
    adminUser.set('username', adminUser.get('email'));
    await adminUser.save(null, { useMasterKey: true });
  }, 30000);

  afterAll(async () => {
    // Cascada: primero los ReservationService/Payment de cada reservación rastreada, luego las
    // reservaciones/cotizaciones mismas, luego los usuarios — para no dejar nada huérfano en la BD
    // compartida que otras suites (--runInBand, mismo proceso) puedan recoger sin querer.
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
        const payQuery = new Parse.Query('Payment');
        const reservationPtr = new Parse.Object('Reservation');
        reservationPtr.id = reservationId;
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
    for (const u of [agencyOwner, adminUser]) {
      if (u) { try { await u.destroy({ useMasterKey: true }); } catch (e) { /* already gone */ } }
    }
  });

  describe('motor de pagos: la propina se suma al total (general + por servicio)', () => {
    it('EJEMPLO EXACTO: 2 servicios (tip $100 fijo + tip 15%=$300 sobre $2000) + general 10% => total 3700', async () => {
      // general 10% sobre servicios activos (1000+2000=3000) = 300; por servicio 100+300 = 400.
      const id = await createReservation([subA, subB], 'efectivo', { tip: 300 });
      const s = await PaymentService.summarize(id);
      expect(s.subtotal).toBe(3000); // base efectivo (servicios, sin propina)
      expect(s.generalTip).toBe(300);
      expect(s.serviceTipsTotal).toBe(400); // 100 + 300
      expect(s.tip).toBe(700); // combinada
      expect(s.total).toBe(3700); // 3000 + 700
    });

    it('anti-doble-conteo: totalAmount/servicesSubtotal corruptos NO afectan al summary (deriva de los servicios reales)', async () => {
      const id = await createReservation([subA, subB], 'efectivo', {
        tip: 300, servicesSubtotal: 99999, totalAmount: 88888,
      });
      const s = await PaymentService.summarize(id);
      expect(s.total).toBe(3700); // ignora los campos legacy corruptos
      expect(s.tip).toBe(700);
    });

    it('servicio includeInTotal:false con tip>0 NO suma (ni su precio ni su propina)', async () => {
      const id = await createReservation([
        { pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 }, tipAmount: 100 },
        { pricesByType: { efectivo: 5000, transferencia: 5800, tarjeta: 6050 }, tipAmount: 999, includeInTotal: false },
      ], 'efectivo', { tip: 0 });
      const s = await PaymentService.summarize(id);
      expect(s.subtotal).toBe(1000); // el excluido no aporta su precio
      expect(s.serviceTipsTotal).toBe(100); // ni su propina
      expect(s.total).toBe(1100);
    });

    it('la propina es plana: mismo monto en efectivo y en tarjeta (no escala con el recargo)', async () => {
      const items = [{ pricesByType: { efectivo: 10000, transferencia: 11600, tarjeta: 12100 }, tipAmount: 0 }];
      const idEf = await createReservation(items, 'efectivo', { tip: 300 });
      const idTj = await createReservation(items, 'tarjeta', { tip: 300 });
      const sEf = await PaymentService.summarize(idEf);
      const sTj = await PaymentService.summarize(idTj);
      expect(sEf.tip).toBe(300);
      expect(sTj.tip).toBe(300); // idéntica, no 300*1.21
      expect(sEf.total).toBe(10300); // 10000 + 300
      expect(sTj.total).toBe(12400); // 12100 + 300 (propina plana)
    });

    it('reservación USD: la propina ya está en USD, sin conversión extra por el tipo de cambio', async () => {
      const id = await createReservation(
        [{ pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 }, tipAmount: 10 }],
        'efectivo',
        { currency: 'USD', tip: 5, exchangeRateSnapshot: 18.5 }
      );
      const s = await PaymentService.summarize(id);
      expect(s.subtotal).toBe(100); // USD, sin redondeo a múltiplo de 5
      expect(s.tip).toBe(15); // 5 general + 10 servicio, en USD (nunca ×18.5)
      expect(s.total).toBe(115);
    });
  });

  describe('cobertura de pago con propina (vía API real)', () => {
    it('pago que cubre solo servicios => partial, saldo = propina pendiente; luego se salda => paid, saldo 0', async () => {
      const id = await createReservation(
        [{ pricesByType: { efectivo: 10000, transferencia: 11600, tarjeta: 12100 }, tipAmount: 0 }],
        'efectivo',
        { tip: 300, clientPtr: agencyOwner }
      );

      const r1 = await postPayment(id, { amount: 10000, currency: 'MXN', method: 'efectivo' });
      expect(r1.status).toBe(200);
      const s1 = r1.body.data.summary;
      expect(s1.total).toBe(10300);
      expect(s1.paymentStatus).toBe('partial'); // faltó la propina
      expect(s1.balance).toBe(300); // exactamente la propina pendiente

      const r2 = await postPayment(id, { amount: 300, currency: 'MXN', method: 'efectivo' });
      expect(r2.status).toBe(200);
      const s2 = r2.body.data.summary;
      expect(s2.paymentStatus).toBe('paid');
      expect(s2.balance).toBe(0);
    });

    it('RBAC: admin y department_manager (nivel 4) leen el MISMO total/propina para la misma reservación', async () => {
      const id = await createReservation([subA, subB], 'efectivo', { tip: 300, clientPtr: agencyOwner });
      const asAdmin = await getPayments(id, adminToken);
      const asAgency = await getPayments(id, agencyToken);
      expect(asAdmin.status).toBe(200);
      expect(asAgency.status).toBe(200);
      expect(asAgency.body.data.summary.total).toBe(asAdmin.body.data.summary.total);
      expect(asAgency.body.data.summary.tip).toBe(asAdmin.body.data.summary.tip);
      expect(asAdmin.body.data.summary.total).toBe(3700);
    });
  });

  describe('fix del "tercer total": recalculateTotal (header) == summary.total (motor)', () => {
    it('el header (totalAmount) coincide EXACTO con el total del motor de pagos, ya con propina', async () => {
      const id = await createReservation(
        [{ pricesByType: { efectivo: 10000, transferencia: 11600, tarjeta: 12100 }, tipAmount: 200 }],
        'efectivo',
        { tip: 300, servicesSubtotal: 10000 }
      );
      const reservation = await fetchReservation(id);
      await ReservationController.recalculateTotal(reservation);
      await reservation.save(null, { useMasterKey: true });

      const s = await PaymentService.summarize(id);
      const updated = await fetchReservation(id);
      expect(s.total).toBe(10500); // 10000 + 300 general + 200 servicio
      expect(updated.get('totalAmount')).toBe(s.total); // header == motor, sin divergencia
    });
  });

  describe('QuoteService.createReservationFromQuote (propina general recalculada, no el snapshot)', () => {
    it('setea reservation.tip recalculado, servicesSubtotal LIMPIO y totalAmount ya con propina', async () => {
      // globalTip.amount=999 es basura (calculado contra tarjeta); debe recomputarse a 300 (10% de 3000).
      const quote = await makeQuote(
        { type: 'percent', value: 10, amount: 999 },
        [subA, subB],
        { subtotal: 3000, total: 3300 }
      );
      const result = await quoteService.createReservationFromQuote(quote, adminUser);
      created.reservations.push(result.id);
      expect(result).toBeTruthy();

      const reservation = await fetchReservation(result.id);
      expect(reservation.get('tip')).toBe(300); // recalculado, NO 999
      expect(reservation.get('servicesSubtotal')).toBe(3000); // subtotal limpio, NO total 3300
      expect(reservation.get('totalAmount')).toBe(3700); // 3000 + 300 general + 400 servicio

      const s = await PaymentService.summarize(result.id);
      expect(s.total).toBe(3700);
      expect(reservation.get('totalAmount')).toBe(s.total);
    });
  });

  describe('QuoteService.syncReservationFromQuote (re-sincroniza la propina, preserva ajustes/pagos)', () => {
    it('cambiar globalTip 10%->5% actualiza reservation.tip sin pisar ajustes ni exchangeRateSnapshot ni el pago', async () => {
      const quote = await makeQuote(
        { type: 'percent', value: 10, amount: 300 },
        [subA, subB],
        { subtotal: 3000, total: 3300 }
      );
      const result = await quoteService.createReservationFromQuote(quote, adminUser);
      created.reservations.push(result.id);

      // Ajuste manual + tasa congelada + un pago, todos deben sobrevivir a la re-sincronización.
      const reservation = await fetchReservation(result.id);
      reservation.set('adjustments', [{
        id: 'adj_keep', type: 'charge', description: 'Cargo manual', amount: 500,
      }]);
      reservation.set('exchangeRateSnapshot', 18.5);
      await reservation.save(null, { useMasterKey: true });
      await postPayment(result.id, { amount: 1000, currency: 'MXN', method: 'efectivo' });

      // Re-edición: globalTip baja de 10% a 5%.
      const newSI = {
        paymentType: 'efectivo',
        currency: 'MXN',
        subtotal: 3000,
        total: 3150,
        globalTip: { type: 'percent', value: 5, amount: 0 },
        days: [{ dayNumber: 1, date: '2026-08-15', subconcepts: [subA, subB] }],
      };
      await quoteService.syncReservationFromQuote(quote, newSI);

      const after = await fetchReservation(result.id);
      expect(after.get('tip')).toBe(150); // 5% de 3000
      expect(after.get('servicesSubtotal')).toBe(3000);
      expect(after.get('exchangeRateSnapshot')).toBe(18.5); // NO pisado
      const adj = after.get('adjustments');
      expect(adj).toHaveLength(1); // ajuste preservado
      expect(adj[0].amount).toBe(500);
      // totalAmount = 3000 subtotal + 500 cargo + 150 general + 400 servicio = 4050.
      expect(after.get('totalAmount')).toBe(4050);

      // El pago no se tocó; el saldo del motor sí refleja el nuevo total.
      const pays = await getPayments(result.id);
      expect(pays.body.data.payments).toHaveLength(1);
      expect(pays.body.data.payments[0].amount).toBe(1000);
      expect(pays.body.data.summary.total).toBe(4050);
      expect(pays.body.data.summary.balance).toBe(3050); // 4050 - 1000
    });

    it('quitar un servicio con propina baja el total; el pago existente no se toca, el saldo cambia', async () => {
      const quote = await makeQuote(
        { type: 'percent', value: 10, amount: 300 },
        [subA, subB],
        { subtotal: 3000, total: 3300 }
      );
      const result = await quoteService.createReservationFromQuote(quote, adminUser);
      created.reservations.push(result.id);
      await postPayment(result.id, { amount: 1000, currency: 'MXN', method: 'efectivo' });

      // Sync que ELIMINA el servicio B (tip 300); queda solo A (tip 100).
      const newSI = {
        paymentType: 'efectivo',
        currency: 'MXN',
        subtotal: 1000,
        total: 1100,
        globalTip: { type: 'percent', value: 10, amount: 0 },
        days: [{ dayNumber: 1, date: '2026-08-15', subconcepts: [subA] }],
      };
      await quoteService.syncReservationFromQuote(quote, newSI);

      const s = await PaymentService.summarize(result.id);
      expect(s.subtotal).toBe(1000); // solo A
      expect(s.serviceTipsTotal).toBe(100); // el tip de B ya no cuenta (servicio removido)
      expect(s.generalTip).toBe(100); // 10% de 1000
      expect(s.total).toBe(1200); // 1000 + 100 + 100

      const pays = await getPayments(result.id);
      expect(pays.body.data.payments).toHaveLength(1); // el pago sobrevive
      expect(s.paidAmount).toBe(1000);
      expect(s.balance).toBe(200); // 1200 - 1000
    });
  });

  describe('reactivar una reservación cancelada recalcula la propina GENERAL desde la cotización ACTUAL', () => {
    // Recálculo de propina general + subtotal + total al reactivar. La reconciliación de los
    // ReservationService editados/agregados/quitados mientras la reservación estuvo cancelada se prueba
    // aparte (quote-reactivation.test.js, REACT-I1); aquí los 2 servicios no cambian, sólo baja la general.
    it('la cotización se edita MIENTRAS la reservación está cancelada (baja la propina general); al reactivar, refleja lo nuevo, no lo congelado', async () => {
      const quote = await makeQuote(
        { type: 'percent', value: 10, amount: 300 },
        [subA, subB],
        { subtotal: 3000, total: 3300 }
      );
      const first = await quoteService.createReservationFromQuote(quote, adminUser);
      created.reservations.push(first.id);
      expect(first.id).toBeTruthy();

      const reservation = await fetchReservation(first.id);
      expect(reservation.get('tip')).toBe(300); // 10% de 3000, antes de cancelar

      // Se cancela (mismo criterio que usa el resto del código: status 'cancelled' en reservación y
      // servicios). Nadie sincroniza una reservación cancelada, así que sus campos quedan congelados.
      reservation.set('status', 'cancelled');
      await reservation.save(null, { useMasterKey: true });
      const svcQuery = new Parse.Query('ReservationService');
      svcQuery.equalTo('reservationPtr', reservation);
      const services = await svcQuery.find({ useMasterKey: true });
      services.forEach((svc) => svc.set('status', 'cancelled'));
      await Parse.Object.saveAll(services, { useMasterKey: true });

      // El vendedor edita la cotización MIENTRAS está cancelada: baja la propina general de 10% a 5%
      // (mismos 2 servicios, sin agregar/quitar ninguno). Nadie propaga esto a la reservación cancelada.
      quote.set('serviceItems', {
        paymentType: 'efectivo',
        currency: 'MXN',
        subtotal: 3000,
        total: 3150,
        globalTip: { type: 'percent', value: 5, amount: 999 }, // amount basura, debe ignorarse
        days: [{ dayNumber: 1, date: '2026-08-15', subconcepts: [subA, subB] }],
      });
      await quote.save(null, { useMasterKey: true });

      // Reactivar (mismo método que la conversión normal; toma la rama "existing.status === cancelled").
      const reactivated = await quoteService.createReservationFromQuote(quote, adminUser);
      expect(reactivated.id).toBe(first.id);

      const after = await fetchReservation(first.id);
      expect(after.get('status')).toBe('pending'); // reactivada
      expect(after.get('tip')).toBe(150); // 5% de 3000 (la NUEVA base), NO 300 (lo congelado)
      expect(after.get('servicesSubtotal')).toBe(3000);

      const s = await PaymentService.summarize(first.id);
      expect(s.serviceTipsTotal).toBe(400); // 100 + 300, servicios sin cambio
      expect(s.generalTip).toBe(150);
      expect(s.total).toBe(3550); // 3000 + 150 + 400
      expect(after.get('totalAmount')).toBe(s.total); // header == motor, sin divergencia
    });
  });

  describe('FIX 4 — propina fija por servicio: paridad server-side entre paymentType (regresión)', () => {
    // El monto que se persiste (subconcept.tipAmount) y factura (PaymentService.sumServiceTips) es
    // PLANO: no escala con el método de pago. El bug era solo de display; estas pruebas blindan que el
    // motor de dinero nunca re-escale, en las 3 formas de pago.
    const svc2000 = { pricesByType: { efectivo: 2000, transferencia: 2320, tarjeta: 2420 } };

    it('F4-I01: 3 reservaciones idénticas salvo paymentType, tipAmount:100 fijo -> serviceTipsTotal===100 en las 3', async () => {
      const items = (method) => [{ ...svc2000, total: svc2000.pricesByType[method], tipAmount: 100 }];
      const idEf = await createReservation(items('efectivo'), 'efectivo');
      const idTr = await createReservation(items('transferencia'), 'transferencia');
      const idTj = await createReservation(items('tarjeta'), 'tarjeta');
      const [sEf, sTr, sTj] = await Promise.all([
        PaymentService.summarize(idEf), PaymentService.summarize(idTr), PaymentService.summarize(idTj),
      ]);
      expect(sEf.serviceTipsTotal).toBe(100);
      expect(sTr.serviceTipsTotal).toBe(100); // nunca 116
      expect(sTj.serviceTipsTotal).toBe(100); // nunca 121
    });

    it('F4-I02: PUT service-items paymentType tarjeta con tipType:amount,tipValue:100,tipAmount:100 -> 200; tipAmount persiste 100 (no recalcula)', async () => {
      const quote = new Parse.Object('Quote');
      quote.set('exists', true);
      quote.set('active', true);
      quote.set('status', 'draft');
      quote.set('folio', `QTE-F4I02-${Date.now()}`);
      quote.set('numberOfPeople', 2);
      quote.set('serviceItems', {
        days: [{ dayNumber: 1, dayTitle: '', subconcepts: [] }], subtotal: 0, iva: 0, total: 0, currency: 'MXN', paymentType: 'efectivo',
      });
      await quote.save(null, { useMasterKey: true });
      created.quotes.push(quote.id);

      const svcSub = {
        id: 'svc1', concept: 'S', type: 'concepto', pricesByType: { efectivo: 2000, transferencia: 2320, tarjeta: 2420 }, total: 2420, includeInTotal: true, tipType: 'amount', tipValue: 100, tipAmount: 100,
      };
      const res = await request(app)
        .put(`/api/quotes/${quote.id}/service-items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          days: [{
            dayNumber: 1, dayTitle: '', dayTotal: 2420, subconcepts: [svcSub],
          }],
          subtotal: 2420, iva: 0, total: 2420, currency: 'MXN', paymentType: 'tarjeta',
        });
      expect(res.status).toBe(200);
      const saved = await new Parse.Query('Quote').get(quote.id, { useMasterKey: true });
      const savedSub = saved.get('serviceItems').days[0].subconcepts.find((x) => x.id === 'svc1');
      expect(savedSub.tipAmount).toBe(100); // literal: el server no lo re-escala a tarjeta (2420*5% etc.)
    });

    it('F4-I03: propina percent (tipAmount:300 = 15% de 2000 efectivo) -> serviceTipsTotal===300 anclada a efectivo Y a tarjeta', async () => {
      const items = (method) => [{ ...svc2000, total: svc2000.pricesByType[method], tipAmount: 300 }];
      const idEf = await createReservation(items('efectivo'), 'efectivo');
      const idTj = await createReservation(items('tarjeta'), 'tarjeta');
      const [sEf, sTj] = await Promise.all([PaymentService.summarize(idEf), PaymentService.summarize(idTj)]);
      expect(sEf.serviceTipsTotal).toBe(300);
      expect(sTj.serviceTipsTotal).toBe(300); // nunca 363
    });

    it('F4-I04: crear efectivo con tipAmount:100, cambiar reservation.paymentType a tarjeta -> serviceTipsTotal sigue 100 (congelado)', async () => {
      const id = await createReservation([{ ...svc2000, total: 2000, tipAmount: 100 }], 'efectivo');
      expect((await PaymentService.summarize(id)).serviceTipsTotal).toBe(100);
      const reservation = await fetchReservation(id);
      reservation.set('paymentType', 'tarjeta');
      await reservation.save(null, { useMasterKey: true });
      expect((await PaymentService.summarize(id)).serviceTipsTotal).toBe(100); // no re-escala al cambiar el ancla
    });
  });

  describe('H7 — SUBIR la propina general tras un pago ya registrado', () => {
    it('H7-I01: globalTip percent 5->15 con un pago de $1000 ya hecho (base 3000, serviceTips 400) -> tip=450, balance=2850, pago intacto', async () => {
      const quote = await makeQuote(
        { type: 'percent', value: 5, amount: 150 },
        [subA, subB],
        { subtotal: 3000, total: 3150 }
      );
      const result = await quoteService.createReservationFromQuote(quote, adminUser);
      created.reservations.push(result.id);
      const before = await fetchReservation(result.id);
      expect(before.get('tip')).toBe(150); // 5% de 3000

      await postPayment(result.id, { amount: 1000, currency: 'MXN', method: 'efectivo' });

      // Re-edición: globalTip SUBE de 5% a 15%.
      const newSI = {
        paymentType: 'efectivo',
        currency: 'MXN',
        subtotal: 3000,
        total: 3450,
        globalTip: { type: 'percent', value: 15, amount: 0 },
        days: [{ dayNumber: 1, date: '2026-08-15', subconcepts: [subA, subB] }],
      };
      await quoteService.syncReservationFromQuote(quote, newSI);

      const after = await fetchReservation(result.id);
      expect(after.get('tip')).toBe(450); // 15% de 3000, propina general recalculada al alza

      const pays = await getPayments(result.id);
      expect(pays.body.data.payments).toHaveLength(1); // el pago sobrevive
      expect(pays.body.data.payments[0].amount).toBe(1000);
      const s = pays.body.data.summary;
      expect(s.total).toBe(3850); // 3000 + 450 general + 400 servicio
      expect(s.balance).toBe(2850); // 3850 - 1000
    });
  });

  describe('H9 — igualdad algebraica: total == subtotal + adjustments + generalTip + serviceTipsTotal', () => {
    // Efectivo con precios múltiplo de 5 (sin recargo ni deriva de redondeo) para que la igualdad sea
    // exacta término a término, no solo el número final.
    const setAdjustments = async (id, adjustments) => {
      const reservation = await fetchReservation(id);
      reservation.set('adjustments', adjustments);
      await reservation.save(null, { useMasterKey: true });
    };

    it('H9-I01: general 300 + servicio 200 + CARGO 500 -> total 11000, y la igualdad se cumple término a término', async () => {
      const id = await createReservation(
        [{ pricesByType: { efectivo: 10000, transferencia: 11600, tarjeta: 12100 }, total: 10000, tipAmount: 200 }],
        'efectivo',
        { tip: 300 }
      );
      await setAdjustments(id, [{ id: 'adj_ch', type: 'charge', description: 'Extra', amount: 500 }]);
      const s = await PaymentService.summarize(id);
      expect(s.total).toBe(s.subtotal + s.adjustments + s.generalTip + s.serviceTipsTotal);
      expect(s.total).toBe(11000); // 10000 + 500 + 300 + 200
    });

    it('H9-I02: general 300 + servicio 200 + DESCUENTO 400 -> total 10100, igualdad término a término', async () => {
      const id = await createReservation(
        [{ pricesByType: { efectivo: 10000, transferencia: 11600, tarjeta: 12100 }, total: 10000, tipAmount: 200 }],
        'efectivo',
        { tip: 300 }
      );
      await setAdjustments(id, [{ id: 'adj_di', type: 'discount', description: 'Cortesía', amount: 400 }]);
      const s = await PaymentService.summarize(id);
      expect(s.adjustments).toBe(-400); // neto (descuento resta)
      expect(s.total).toBe(s.subtotal + s.adjustments + s.generalTip + s.serviceTipsTotal);
      expect(s.total).toBe(10100); // 10000 - 400 + 300 + 200
    });
  });

  describe('H10 — pago parcial en método NO-ancla: la propina plana se suma igual en los 3 métodos', () => {
    it('H10-I01: base efectivo 10000, tip 300, pago 6050 tarjeta -> montoParaSaldar.tarjeta === 6350 (servicios escalan, propina NO)', async () => {
      const id = await createReservation(
        [{ pricesByType: { efectivo: 10000, transferencia: 11600, tarjeta: 12100 }, total: 10000, tipAmount: 0 }],
        'efectivo',
        { tip: 300 }
      );
      const pay = await postPayment(id, { amount: 6050, currency: 'MXN', method: 'tarjeta' });
      expect(pay.status).toBe(200);
      const s = await PaymentService.summarize(id);
      // Cobertura equivalente-ancla del pago tarjeta 6050 = 5000 efectivo; restante servicios 5000.
      // El restante de servicios escala por método; la propina de 300 se suma PLANA en los 3.
      expect(s.montoParaSaldar.efectivo).toBe(5300); // 5000 + 300
      expect(s.montoParaSaldar.transferencia).toBe(6100); // 5800 + 300
      expect(s.montoParaSaldar.tarjeta).toBe(6350); // 6050 + 300 (nunca 300*1.21)
    });
  });

  describe('H11 — editar descuento/propina POR SERVICIO tras un pago ya registrado', () => {
    // El pago YA hecho no se toca; sólo cambian el total y el saldo. El descuento/propina por servicio se
    // editan MEDIANTE una re-sincronización (syncReservationFromQuote) que reconcilia el subconcepto.
    const svc = (over = {}) => ({
      id: over.id || 'pe',
      concept: 'Servicio PE',
      type: 'concepto',
      pricesByType: { efectivo: 2000, transferencia: 2320, tarjeta: 2420 },
      discountAmount: 0,
      tipAmount: 0,
      total: 2000,
      includeInTotal: true,
      ...over,
    });
    const newSI = (subs, { subtotal, total }) => ({
      paymentType: 'efectivo',
      currency: 'MXN',
      subtotal,
      total,
      globalTip: null,
      days: [{ dayNumber: 1, date: '2026-08-15', subconcepts: subs }],
    });

    it('PAYEDIT-I1: pago $1000 hecho; luego se agrega descuento 300 + propina $100 -> total 1800, balance 800, partial, pago intacto', async () => {
      const quote = await makeQuote(null, [svc({ id: 'pe1' })], { subtotal: 2000, total: 2000 });
      const result = await quoteService.createReservationFromQuote(quote, adminUser);
      created.reservations.push(result.id);

      const pay = await postPayment(result.id, { amount: 1000, currency: 'MXN', method: 'efectivo' });
      expect(pay.status).toBe(200);

      // Edición POR SERVICIO: mismo subconcepto (id 'pe1') con descuento 300 + propina fija $100.
      const edited = svc({
        id: 'pe1', discountAmount: 300, tipType: 'amount', tipValue: 100, tipAmount: 100, total: 1700,
      });
      await quoteService.syncReservationFromQuote(quote, newSI([edited], { subtotal: 1700, total: 1800 }));

      const reservation = await fetchReservation(result.id);
      expect(reservation.get('totalAmount')).toBe(1800); // 1700 + 100 propina

      const pays = await getPayments(result.id);
      expect(pays.body.data.payments).toHaveLength(1);
      expect(pays.body.data.payments[0].amount).toBe(1000); // el pago viejo sigue intacto

      const s = pays.body.data.summary;
      expect(s.total).toBe(1800);
      expect(s.balance).toBe(800); // 1800 - 1000
      expect(s.paymentStatus).toBe('partial');
      expect(s.serviceTipsTotal).toBe(100);
    });

    it('PAYEDIT-I2: pago $2000 (cubría el original); luego SOLO descuento 300 -> total 1700, balance -300 (sobrepago), sigue paid', async () => {
      const quote = await makeQuote(null, [svc({ id: 'pe2' })], { subtotal: 2000, total: 2000 });
      const result = await quoteService.createReservationFromQuote(quote, adminUser);
      created.reservations.push(result.id);

      const pay = await postPayment(result.id, { amount: 2000, currency: 'MXN', method: 'efectivo' });
      expect(pay.status).toBe(200);
      expect(pay.body.data.summary.paymentStatus).toBe('paid'); // cubría el total original

      // Edición POR SERVICIO: SOLO descuento 300 (sin propina). Nuevo total 1700.
      const edited = svc({ id: 'pe2', discountAmount: 300, total: 1700 });
      await quoteService.syncReservationFromQuote(quote, newSI([edited], { subtotal: 1700, total: 1700 }));

      const reservation = await fetchReservation(result.id);
      expect(reservation.get('totalAmount')).toBe(1700);

      const s = await PaymentService.summarize(result.id);
      expect(s.total).toBe(1700);
      expect(s.balance).toBe(-300); // sobrepago permitido (2000 - 1700)
      expect(s.paymentStatus).toBe('paid'); // no se rompe por aplicar el descuento después
    });
  });
});
