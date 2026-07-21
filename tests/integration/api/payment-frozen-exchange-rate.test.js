/**
 * Tipo de cambio USD/MXN congelado — integration tests (feat/cambios-pagos).
 *
 * El dueño pidió que la tasa USD/MXN de una reservación en dólares quede FIJA al día de la cotización,
 * para que el saldo no "respire" (suba/baje) cuando la tasa del sistema cambie después sin que nadie
 * toque la reservación. Se persiste `exchangeRateSnapshot` dentro del blob serviceItems (capturado en
 * QuoteController.updateServiceItems cuando la moneda es USD), se propaga a la reservación (createReservation
 * lo hereda; sync lo fija SOLO si aún no existe, nunca lo pisa) y el motor de pagos (PaymentService.
 * loadAndCompute) lo prefiere sobre ExchangeRate.getCurrentValue().
 *
 * Casos: motor congelado gana sobre la tasa vigente (INT-02, "el saldo respira solo" resuelto),
 * reservación legacy sin snapshot cae a la tasa vigente sin romper, captura en updateServiceItems
 * (USD sí / MXN no, re-captura en cada guardado), propagación create/sync (sync nunca pisa un snapshot
 * existente pero fija el primero en una reservación legacy).
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');
const QuoteService = require('../../../src/application/services/QuoteService');
const ExchangeRate = require('../../../src/domain/models/ExchangeRate');

describe('Tipo de cambio USD congelado (integration)', () => {
  let app;
  let adminToken;
  const createdQuoteIds = [];

  // Fija la tasa vigente del sistema de forma determinista (createExchangeRate desactiva la anterior e
  // invalida el caché). Devuelve el valor para legibilidad de los tests.
  const setSystemRate = async (value) => {
    await ExchangeRate.createExchangeRate({ value, description: 'frozen-rate-test' });
    return value;
  };

  const createUsdReservation = async (services, { snapshot } = {}) => {
    const reservation = new Parse.Object('Reservation');
    reservation.set('active', true);
    reservation.set('exists', true);
    reservation.set('status', 'confirmed');
    reservation.set('paymentType', 'efectivo');
    reservation.set('currency', 'USD');
    if (snapshot !== undefined) reservation.set('exchangeRateSnapshot', snapshot);
    await reservation.save(null, { useMasterKey: true });

    await Promise.all(services.map((svc) => {
      const rs = new Parse.Object('ReservationService');
      rs.set('active', true);
      rs.set('exists', true);
      rs.set('reservationPtr', reservation);
      rs.set('subconcept', {
        includeInTotal: true,
        pricesByType: svc.pricesByType || null,
        total: svc.total !== undefined ? svc.total : 0,
      });
      return rs.save(null, { useMasterKey: true });
    }));

    return reservation.id;
  };

  const fetchReservation = (id) => new Parse.Query('Reservation').get(id, { useMasterKey: true });
  const fetchQuote = (id) => new Parse.Query('Quote').get(id, { useMasterKey: true });

  // paidAt es obligatorio y receivedBy lo es para efectivo: se inyectan por defecto (el body los puede
  // sobreescribir) — este suite prueba el tipo de cambio congelado, no esa validación.
  const TODAY = new Date().toISOString().slice(0, 10);
  const postPayment = (id, body) => request(app)
    .post(`/api/reservations/${id}/payments`).set('Authorization', `Bearer ${adminToken}`)
    .send({ paidAt: TODAY, receivedBy: 'QA Cajero', ...body });
  const getPayments = (id) => request(app)
    .get(`/api/reservations/${id}/payments`).set('Authorization', `Bearer ${adminToken}`);

  // Payload válido de service-items (una reservación USD de $100). El motor de precio usa pricesByType.
  const serviceItemsPayload = (currency) => ({
    currency,
    paymentType: 'efectivo',
    subtotal: 100,
    iva: 0,
    total: 100,
    days: [{
      dayNumber: 1,
      dayTitle: 'Día 1',
      dayTotal: 100,
      subconcepts: [{
        time: '09:00',
        concept: 'Traslado',
        type: 'traslado',
        unitPrice: 100,
        total: 100,
        includeInTotal: true,
        pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 },
      }],
    }],
  });

  // serviceItems ya persistido en una cotización (para el flujo QuoteService directo). Un snapshot
  // `undefined` simula el estado legacy (cotización previa a este cambio, sin tasa capturada).
  const usdServiceItems = (snapshot) => ({
    paymentType: 'efectivo',
    currency: 'USD',
    subtotal: 100,
    iva: 0,
    total: 100,
    exchangeRateSnapshot: snapshot,
    days: [{
      dayNumber: 1,
      date: '2026-09-10',
      concept: 'Día 1',
      subconcepts: [{
        type: 'traslado',
        concept: 'Traslado',
        total: 100,
        includeInTotal: true,
        pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 },
      }],
    }],
  });

  const createBareQuote = async () => {
    const q = new Parse.Object('Quote');
    q.set('exists', true);
    q.set('active', true);
    q.set('folio', `QC-FROZEN-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    q.set('numberOfPeople', 1);
    await q.save(null, { useMasterKey: true });
    createdQuoteIds.push(q.id);
    return q;
  };

  const createQuoteWithServiceItems = async (serviceItems) => {
    const q = new Parse.Object('Quote');
    q.set('exists', true);
    q.set('active', true);
    q.set('folio', `QC-FROZEN-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    q.set('numberOfPeople', 1);
    q.set('serviceItems', serviceItems);
    await q.save(null, { useMasterKey: true });
    createdQuoteIds.push(q.id);
    return q;
  };

  const putServiceItems = (quoteId, body) => request(app)
    .put(`/api/quotes/${quoteId}/service-items`).set('Authorization', `Bearer ${adminToken}`).send(body);

  const addAdjustment = (id, body) => request(app)
    .post(`/api/reservations/${id}/adjustments`).set('Authorization', `Bearer ${adminToken}`).send(body);

  // serviceItems MXN con un `total` de servicios controlable, para verificar el neteo de ajustes en
  // syncReservationFromQuote (sin la conversión de moneda del caso USD). pricesByType = total en los
  // 3 métodos para que el precio no dependa del método.
  const mxnServiceItems = (total) => ({
    paymentType: 'efectivo',
    currency: 'MXN',
    subtotal: total,
    iva: 0,
    total,
    days: [{
      dayNumber: 1,
      date: '2026-09-10',
      concept: 'Día 1',
      subconcepts: [{
        type: 'traslado',
        concept: 'Traslado',
        total,
        includeInTotal: true,
        pricesByType: { efectivo: total, transferencia: total, tarjeta: total },
      }],
    }],
  });

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    adminToken = await AuthTestHelper.loginAs('admin', app);
    await setSystemRate(18.5);
  }, 30000);

  afterAll(async () => {
    await Promise.all(createdQuoteIds.map(async (id) => {
      try {
        const q = new Parse.Object('Quote');
        q.id = id;
        await q.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }));
    // Restaura la tasa "normal" (18.5, igual al fallback por defecto) para no contaminar otros archivos.
    try { await setSystemRate(18.5); } catch (e) { /* ignore */ }
  });

  describe('motor de pagos: el snapshot congelado gana sobre la tasa vigente (INT-02)', () => {
    it('una reservación con snapshot NO respira cuando la tasa del sistema cambia después', async () => {
      await setSystemRate(18.5);
      const id = await createUsdReservation(
        [{ pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 } }],
        { snapshot: 18.5 }
      );

      // Pago capturado en MXN (1850 = 100 USD @ 18.5). Este es el único caso donde la tasa importa:
      // un pago MXN contra una reservación USD se reconvierte MXN -> USD (paymentAmountInCurrency).
      const pay = await postPayment(id, { amount: 1850, currency: 'MXN', method: 'efectivo' });
      expect(pay.status).toBe(200);
      const before = pay.body.data.summary;
      expect(before.total).toBe(100); // USD, sin redondeo a múltiplo de 5
      expect(before.coverageAmount).toBe(100); // 1850 / 18.5
      expect(before.paidAmount).toBe(100);
      expect(before.balance).toBe(0);
      expect(before.paymentStatus).toBe('paid');

      // La tasa del sistema sube a 20.0; nadie tocó la reservación.
      await setSystemRate(20.0);
      const after = (await getPayments(id)).body.data.summary;
      // Sigue midiendo con la tasa CONGELADA 18.5: si usara 20.0 daría 1850/20 = 92.5 (partial).
      expect(after.coverageAmount).toBe(100);
      expect(after.paidAmount).toBe(100);
      expect(after.balance).toBe(0);
      expect(after.paymentStatus).toBe('paid');
    });

    it('una reservación legacy SIN snapshot cae a la tasa vigente (fallback), sin romper', async () => {
      await setSystemRate(20.0);
      const id = await createUsdReservation(
        [{ pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 } }]
        // sin snapshot (estado previo a este cambio)
      );

      const pay = await postPayment(id, { amount: 1850, currency: 'MXN', method: 'efectivo' });
      expect(pay.status).toBe(200);
      const s = pay.body.data.summary;
      expect(s.total).toBe(100);
      // Fallback a la tasa vigente 20.0: 1850 / 20 = 92.5 (contraste directo con el caso congelado).
      expect(s.coverageAmount).toBe(92.5);
      expect(s.paidAmount).toBe(92.5);
      expect(s.paymentStatus).toBe('partial');
    });
  });

  describe('captura del snapshot en updateServiceItems (PUT service-items)', () => {
    it('cotización USD guarda exchangeRateSnapshot = tasa vigente y se RE-captura en cada guardado', async () => {
      await setSystemRate(18.5);
      const quote = await createBareQuote();

      const r1 = await putServiceItems(quote.id, serviceItemsPayload('USD'));
      expect(r1.status).toBe(200);
      let saved = await fetchQuote(quote.id);
      expect(saved.get('serviceItems').exchangeRateSnapshot).toBe(18.5);

      // Re-guardar con otra tasa vigente sobreescribe el snapshot de la COTIZACIÓN (los precios también
      // se recalculan con la tasa del momento en cada edición del wizard).
      await setSystemRate(20.0);
      const r2 = await putServiceItems(quote.id, serviceItemsPayload('USD'));
      expect(r2.status).toBe(200);
      saved = await fetchQuote(quote.id);
      expect(saved.get('serviceItems').exchangeRateSnapshot).toBe(20.0);
    });

    it('cotización MXN nunca agrega exchangeRateSnapshot (no aplica, evita ruido en el dato)', async () => {
      await setSystemRate(18.5);
      const quote = await createBareQuote();

      const r = await putServiceItems(quote.id, serviceItemsPayload('MXN'));
      expect(r.status).toBe(200);
      const saved = await fetchQuote(quote.id);
      const serviceItems = saved.get('serviceItems');
      expect(serviceItems.currency).toBe('MXN');
      expect('exchangeRateSnapshot' in serviceItems).toBe(false);
    });
  });

  describe('propagación cotización -> reservación', () => {
    it('createReservationFromQuote propaga el snapshot en la creación inicial (caso feliz)', async () => {
      const quoteService = new QuoteService();
      const adminUser = await AuthTestHelper.getUserByRole('admin');
      const quote = await createQuoteWithServiceItems(usdServiceItems(18.5));

      const result = await quoteService.createReservationFromQuote(quote, adminUser);
      expect(result).toBeTruthy();

      const reservation = await fetchReservation(result.id);
      expect(reservation.get('currency')).toBe('USD');
      expect(reservation.get('exchangeRateSnapshot')).toBe(18.5);
    });

    it('syncReservationFromQuote NUNCA pisa un snapshot ya existente', async () => {
      const quoteService = new QuoteService();
      const adminUser = await AuthTestHelper.getUserByRole('admin');
      const quote = await createQuoteWithServiceItems(usdServiceItems(18.5));

      const created = await quoteService.createReservationFromQuote(quote, adminUser);
      let reservation = await fetchReservation(created.id);
      expect(reservation.get('exchangeRateSnapshot')).toBe(18.5);

      // La cotización se re-edita después con OTRA tasa (20.0) y se vuelve a sincronizar.
      const reedited = usdServiceItems(20.0);
      quote.set('serviceItems', reedited);
      await quote.save(null, { useMasterKey: true });
      const syncResult = await quoteService.syncReservationFromQuote(quote, reedited);
      expect(syncResult.synced).toBe(true); // la reservación fue encontrada y sincronizada

      reservation = await fetchReservation(created.id);
      // Conserva 18.5 (tasa del día de la cotización), NO adopta 20.0.
      expect(reservation.get('exchangeRateSnapshot')).toBe(18.5);
    });

    it('syncReservationFromQuote fija el PRIMER snapshot en una reservación legacy sin él', async () => {
      const quoteService = new QuoteService();
      const adminUser = await AuthTestHelper.getUserByRole('admin');
      // Reservación creada desde una cotización legacy (serviceItems sin exchangeRateSnapshot).
      const quote = await createQuoteWithServiceItems(usdServiceItems(undefined));

      const created = await quoteService.createReservationFromQuote(quote, adminUser);
      let reservation = await fetchReservation(created.id);
      expect(reservation.get('exchangeRateSnapshot')).toBeUndefined();

      // Una sincronización posterior (ya con este cambio) trae un snapshot: la reservación adquiere el
      // primero que ve, porque todavía no tenía ninguno.
      const withSnapshot = usdServiceItems(19.25);
      quote.set('serviceItems', withSnapshot);
      await quote.save(null, { useMasterKey: true });
      await quoteService.syncReservationFromQuote(quote, withSnapshot);

      reservation = await fetchReservation(created.id);
      expect(reservation.get('exchangeRateSnapshot')).toBe(19.25);
    });

    it('syncReservationFromQuote respeta un ajuste YA existente: totalAmount = nuevoTotal − ajuste (council L0F1)', async () => {
      const quoteService = new QuoteService();
      const adminUser = await AuthTestHelper.getUserByRole('admin');
      // Reservación MXN de $1000 creada desde una cotización.
      const quote = await createQuoteWithServiceItems(mxnServiceItems(1000));
      const created = await quoteService.createReservationFromQuote(quote, adminUser);

      let reservation = await fetchReservation(created.id);
      expect(reservation.get('totalAmount')).toBe(1000);
      expect(reservation.get('servicesSubtotal')).toBe(1000);

      // Se aplica un descuento de $500 DESPUÉS de crear la reservación (vía el endpoint real, que es
      // quien llama recalculateTotal). Total esperado: 1000 − 500 = 500.
      const adj = await addAdjustment(created.id, { type: 'discount', amount: 500, description: 'Cortesía' });
      expect(adj.status).toBe(200);
      reservation = await fetchReservation(created.id);
      expect(reservation.get('totalAmount')).toBe(500);

      // La cotización de origen se re-edita: los servicios ahora suman $1200. Al sincronizar, el
      // total NO debe volver al crudo $1200 (bug previo): debe conservar el descuento existente
      // -> 1200 − 500 = 700. Y servicesSubtotal (base con IVA para ajustes) debe reflejar el nuevo $1200.
      const reedited = mxnServiceItems(1200);
      quote.set('serviceItems', reedited);
      await quote.save(null, { useMasterKey: true });
      const syncResult = await quoteService.syncReservationFromQuote(quote, reedited);
      expect(syncResult.synced).toBe(true);

      reservation = await fetchReservation(created.id);
      expect(reservation.get('servicesSubtotal')).toBe(1200);
      expect(reservation.get('totalAmount')).toBe(700);
      // El array de ajustes sigue intacto (no se borró, solo se re-neteó sobre el nuevo subtotal).
      expect((reservation.get('adjustments') || []).length).toBe(1);
    });

    it('syncReservationFromQuote sin ajustes: totalAmount = total crudo de la cotización (sin regresión)', async () => {
      const quoteService = new QuoteService();
      const adminUser = await AuthTestHelper.getUserByRole('admin');
      const quote = await createQuoteWithServiceItems(mxnServiceItems(800));
      const created = await quoteService.createReservationFromQuote(quote, adminUser);

      // Re-edición a $950 sin ningún ajuste aplicado: el total sincronizado es el crudo, igual que antes.
      const reedited = mxnServiceItems(950);
      quote.set('serviceItems', reedited);
      await quote.save(null, { useMasterKey: true });
      await quoteService.syncReservationFromQuote(quote, reedited);

      const reservation = await fetchReservation(created.id);
      expect(reservation.get('servicesSubtotal')).toBe(950);
      expect(reservation.get('totalAmount')).toBe(950);
    });
  });
});
