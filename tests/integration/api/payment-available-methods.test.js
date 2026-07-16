/**
 * Available payment methods — integration tests (Fase C, carrito de pagos).
 *
 * End-to-end sobre el flujo real de pagos con Parse + mongodb-memory-server. Verifica que los métodos
 * de pago aceptados se DERIVAN de los datos de la cotización (pricesByType por servicio + paymentType
 * ancla) y NUNCA se hardcodean: registrar/editar un pago en un método sin respaldo en la reservación
 * se rechaza con 400, mientras el método ancla siempre pasa (invariante) aunque su llave falte o esté
 * corrupta. Cubre además: exposición de availableMethods/anchoredMethod en el summary de lectura, que
 * el guard es de DATOS (mismo 400 para admin y para agencia nivel 4), que el rechazo por FORMA
 * (Payment.isValidMethod) sigue ocurriendo antes y con su propio mensaje, la semántica de edición sin
 * método vs con método explícito, el alcance por reservación (no por servicio individual), y el flujo
 * REAL quote -> reservación que hereda paymentType (no un fixture armado a mano).
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');
const PaymentService = require('../../../src/application/services/PaymentService');
const QuoteService = require('../../../src/application/services/QuoteService');

describe('Payment available methods — derivados de pricesByType (integration)', () => {
  let app;
  let adminToken;
  let managerToken; // department_manager = nivel 4 (agencia)
  const createdQuoteIds = [];

  // Crea una reservación + sus ReservationService. Cada `svc` puede fijar includeInTotal, pricesByType
  // y total. Devuelve el id de la reservación y los ids de servicio (para pruebas por servicio).
  const createReservation = async (services, paymentType, currency = 'MXN', clientPtr = null) => {
    const reservation = new Parse.Object('Reservation');
    reservation.set('active', true);
    reservation.set('exists', true);
    reservation.set('status', 'confirmed');
    reservation.set('paymentType', paymentType);
    reservation.set('currency', currency);
    if (clientPtr) reservation.set('clientPtr', clientPtr);
    await reservation.save(null, { useMasterKey: true });

    const created = await Promise.all(services.map((svc) => {
      const rs = new Parse.Object('ReservationService');
      rs.set('active', true);
      rs.set('exists', true);
      rs.set('reservationPtr', reservation);
      rs.set('subconcept', {
        includeInTotal: svc.includeInTotal !== false,
        pricesByType: svc.pricesByType || null,
        total: svc.total !== undefined ? svc.total : 0,
      });
      return rs.save(null, { useMasterKey: true });
    }));

    return { reservationId: reservation.id, serviceIds: created.map((s) => s.id) };
  };

  const fetchReservation = (id) => new Parse.Query('Reservation').get(id, { useMasterKey: true });

  const postPayment = (id, body, token = adminToken) => request(app)
    .post(`/api/reservations/${id}/payments`).set('Authorization', `Bearer ${token}`).send(body);
  const getPayments = (id, token = adminToken) => request(app)
    .get(`/api/reservations/${id}/payments`).set('Authorization', `Bearer ${token}`);
  const putPayment = (id, pid, body, token = adminToken) => request(app)
    .put(`/api/reservations/${id}/payments/${pid}`).set('Authorization', `Bearer ${token}`).send(body);

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    adminToken = await AuthTestHelper.loginAs('admin', app);
    managerToken = await AuthTestHelper.loginAs('department_manager', app);
  }, 30000);

  afterAll(async () => {
    await Promise.all(createdQuoteIds.map(async (id) => {
      try {
        const q = new Parse.Object('Quote');
        q.id = id;
        await q.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }));
  });

  describe('método disponible pasa; método sin respaldo se rechaza con 400 + lista exacta', () => {
    it('ancla efectivo, servicios con efectivo+transferencia: transferencia 200, tarjeta 400', async () => {
      const { reservationId } = await createReservation(
        [{ pricesByType: { efectivo: 100, transferencia: 116 } }],
        'efectivo'
      );

      const ok = await postPayment(reservationId, { amount: 50, currency: 'MXN', method: 'transferencia' });
      expect(ok.status).toBe(200);

      const blocked = await postPayment(reservationId, { amount: 50, currency: 'MXN', method: 'tarjeta' });
      expect(blocked.status).toBe(400);
      expect(blocked.body.success).toBe(false);
      expect(blocked.body.error).toBe(
        'Método no disponible para esta reservación. Métodos disponibles: efectivo, transferencia'
      );
    });
  });

  describe('CRÍTICO: el pago en el método ancla SIEMPRE pasa aunque su llave falte o esté corrupta', () => {
    it('ancla tarjeta, pricesByType SIN tarjeta (corrupta): pago tarjeta => 200', async () => {
      const { reservationId } = await createReservation(
        [{ pricesByType: { efectivo: 100, tarjeta: 'corrupto' } }], // tarjeta no finita => sin respaldo en datos
        'tarjeta'
      );

      const r = await postPayment(reservationId, { amount: 100, currency: 'MXN', method: 'tarjeta' });
      expect(r.status).toBe(200); // el ancla nunca queda fuera, pese al dato corrupto

      // efectivo también está (respaldo real); transferencia NO (ni respaldo ni ancla).
      const blocked = await postPayment(reservationId, { amount: 100, currency: 'MXN', method: 'transferencia' });
      expect(blocked.status).toBe(400);
    });
  });

  describe('reservación 100% legacy (sin pricesByType): solo el ancla es válida', () => {
    it('ancla efectivo: pago efectivo 200, transferencia y tarjeta 400', async () => {
      const { reservationId } = await createReservation([{ total: 200 }], 'efectivo');

      const ok = await postPayment(reservationId, { amount: 100, currency: 'MXN', method: 'efectivo' });
      expect(ok.status).toBe(200);

      const t = await postPayment(reservationId, { amount: 100, currency: 'MXN', method: 'transferencia' });
      expect(t.status).toBe(400);
      const c = await postPayment(reservationId, { amount: 100, currency: 'MXN', method: 'tarjeta' });
      expect(c.status).toBe(400);
    });
  });

  describe('GET expone availableMethods y anchoredMethod correctos', () => {
    it('servicios 3/3, ancla transferencia: summary lista los 3 y el ancla', async () => {
      const { reservationId } = await createReservation(
        [{ pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 } }],
        'transferencia'
      );

      const res = await getPayments(reservationId);
      expect(res.status).toBe(200);
      const { summary } = res.body.data;
      expect(summary.availableMethods).toEqual(['efectivo', 'transferencia', 'tarjeta']);
      expect(summary.anchoredMethod).toBe('transferencia');
    });
  });

  describe('RBAC — el guard es de DATOS: agencia (nivel 4) recibe EXACTAMENTE el mismo 400 que admin', () => {
    it('reservación de la agencia, tarjeta sin respaldo: admin 400 y agencia 400 con idéntico mensaje', async () => {
      const managerUser = await AuthTestHelper.getUserByRole('department_manager');
      const { reservationId } = await createReservation(
        [{ pricesByType: { efectivo: 100, transferencia: 116 } }],
        'efectivo',
        'MXN',
        managerUser
      );

      const asAdmin = await postPayment(reservationId, { amount: 50, currency: 'MXN', method: 'tarjeta' }, adminToken);
      const asAgency = await postPayment(reservationId, { amount: 50, currency: 'MXN', method: 'tarjeta' }, managerToken);

      expect(asAdmin.status).toBe(400);
      expect(asAgency.status).toBe(400);
      expect(asAgency.body.error).toBe(asAdmin.body.error); // mismo guard de datos, no de permisos
    });
  });

  describe('un método con FORMA inválida se rechaza ANTES por Payment.isValidMethod (sin duplicar mensaje)', () => {
    it("method 'cheque': 400 con el mensaje de método inválido, NO el de 'no disponible'", async () => {
      const { reservationId } = await createReservation(
        [{ pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 } }],
        'efectivo'
      );

      const r = await postPayment(reservationId, { amount: 50, currency: 'MXN', method: 'cheque' });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('Método inválido. Use: efectivo, transferencia, tarjeta');
      expect(r.body.error).not.toContain('no disponible');
    });
  });

  describe('updatePayment: sin método en el body NO re-valida el histórico; con método explícito SÍ', () => {
    it('editar solo el monto de un pago cuyo método ya no está disponible => 200; cambiar a ese método => 400', async () => {
      // Reservación donde solo efectivo está disponible.
      const { reservationId } = await createReservation([{ pricesByType: { efectivo: 100 } }], 'efectivo');

      // Pago histórico en transferencia (creado directo, como si el respaldo de precio hubiese cambiado
      // después de registrarlo). No pasa por el guard de addPayment a propósito.
      const legacyPayment = new Parse.Object('Payment');
      legacyPayment.set('exists', true);
      legacyPayment.set('active', true);
      legacyPayment.set('reservationPtr', Parse.Object.extend('Reservation').createWithoutData(reservationId));
      legacyPayment.set('amount', 50);
      legacyPayment.set('origAmount', 50);
      legacyPayment.set('origCurrency', 'MXN');
      legacyPayment.set('method', 'transferencia');
      await legacyPayment.save(null, { useMasterKey: true });

      // Editar solo el monto (sin method) => el guard no corre, 200 pese a que 'transferencia' ya no está.
      const edit = await putPayment(reservationId, legacyPayment.id, { amount: 60 });
      expect(edit.status).toBe(200);

      // Cambiar el método explícitamente a uno no disponible => 400.
      const changeMethod = await putPayment(reservationId, legacyPayment.id, { method: 'transferencia' });
      expect(changeMethod.status).toBe(400);
      expect(changeMethod.body.error).toContain('Método no disponible');
    });
  });

  describe('el guard usa los métodos de la RESERVACIÓN completa, no del servicio individual', () => {
    it('pago atado a un servicio que solo respalda efectivo, en tarjeta (respaldada por OTRO servicio) => 200', async () => {
      const { reservationId, serviceIds } = await createReservation(
        [
          { pricesByType: { efectivo: 100 } }, // servicio A: solo efectivo
          { pricesByType: { efectivo: 100, tarjeta: 121 } }, // servicio B: respalda tarjeta
        ],
        'efectivo'
      );
      const serviceA = serviceIds[0];

      const r = await postPayment(reservationId, {
        amount: 50, currency: 'MXN', method: 'tarjeta', reservationServiceId: serviceA,
      });
      expect(r.status).toBe(200); // tarjeta disponible a nivel reservación (por B), aunque A no la respalde
    });
  });

  describe('un servicio NO facturable no aporta métodos a la unión, aunque traiga pricesByType completo', () => {
    it('único servicio includeInTotal:false con 3/3: solo el ancla efectivo; tarjeta => 400', async () => {
      const { reservationId } = await createReservation(
        [{ includeInTotal: false, pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 } }],
        'efectivo'
      );

      const res = await getPayments(reservationId);
      expect(res.body.data.summary.availableMethods).toEqual(['efectivo']);

      const blocked = await postPayment(reservationId, { amount: 50, currency: 'MXN', method: 'tarjeta' });
      expect(blocked.status).toBe(400);
    });
  });

  describe('flujo REAL quote -> reservación (no fixture): paymentType se hereda de serviceItems', () => {
    it('createReservationFromQuote hereda paymentType y los métodos se derivan de los datos reales', async () => {
      const quoteService = new QuoteService();
      const adminUser = await AuthTestHelper.getUserByRole('admin');

      const quote = new Parse.Object('Quote');
      quote.set('exists', true);
      quote.set('active', true);
      quote.set('folio', `QC-FASEC-${Date.now()}`);
      quote.set('numberOfPeople', 2);
      quote.set('serviceItems', {
        paymentType: 'transferencia',
        currency: 'MXN',
        total: 116,
        days: [{
          dayNumber: 1,
          concept: 'Día 1',
          date: '2026-08-10',
          subconcepts: [{
            type: 'transport',
            concept: 'Traslado aeropuerto',
            total: 100,
            includeInTotal: true,
            pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 },
          }],
        }],
      });
      await quote.save(null, { useMasterKey: true });
      createdQuoteIds.push(quote.id);

      const result = await quoteService.createReservationFromQuote(quote, adminUser);
      expect(result).toBeTruthy();

      const reservation = await fetchReservation(result.id);
      // El ancla se HEREDA del serviceItems.paymentType de la cotización (no seteado a mano).
      expect(reservation.get('paymentType')).toBe('transferencia');

      // Fase C end-to-end: los métodos disponibles salen de los pricesByType que el flujo real persistió.
      const methods = await PaymentService.loadAvailableMethods(reservation);
      expect(methods).toEqual(['efectivo', 'transferencia', 'tarjeta']);
    });
  });
});
