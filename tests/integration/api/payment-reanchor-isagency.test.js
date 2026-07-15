/**
 * Re-anclaje de paymentType condicionado a isAgency — integration (Fix 1, hallazgo crítico).
 *
 * End-to-end sobre el flujo real addPayment + resolvePaymentMethodChange con Parse +
 * mongodb-memory-server. Verifica que el re-anclaje automático de reservation.paymentType
 * (recalcular todo el total al nuevo tier) solo ocurre para AGENCIAS, resuelto desde el DUEÑO
 * de la reservación (clientPtr) con el mismo criterio que PublicReservationController.
 *
 * Casos: clientPtr null / end_client sin roleId / clientPtr huérfano => conservador (nunca
 * re-ancla); agencia real con SOLO el role string (caso dominante en producción, sin
 * clientCategory) => sí re-ancla (esto PRUEBA que el .include('clientPtr') faltante quedó
 * arreglado: sin él clientPtr.get('role') sería vacío y jamás re-anclaría); round-trip completo
 * del exploit ($50k, pago de $1 en otro método) confirmando que paymentType NO cambia y el balance
 * solo refleja el ajuste de centavos; y la interacción con el framing público de Fase 2.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

const RECON_SOURCE = 'payment-method-reconciliation';

describe('paymentType re-anchor conditioned on isAgency (integration)', () => {
  let app;
  let adminToken;

  const createdUserIds = [];
  let folioSeq = 700;

  // Clean pricesByType (base × 1.16 / × 1.21): T(efectivo)=10000, T(transferencia)=11600, T(tarjeta)=12100.
  const CLEAN = [{ pricesByType: { efectivo: 10000, transferencia: 11600, tarjeta: 12100 } }];
  // Reservación grande para el exploit: efectivo 50000, tarjeta 60500 (×1.21).
  const BIG = [{ pricesByType: { efectivo: 50000, transferencia: 58000, tarjeta: 60500 } }];

  const makeUser = async (fields) => {
    const u = new Parse.Object('AmexingUser');
    u.set('exists', true);
    u.set('active', true);
    u.set('email', `reanchor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`);
    u.set('username', u.get('email'));
    Object.entries(fields).forEach(([k, v]) => u.set(k, v));
    await u.save(null, { useMasterKey: true });
    createdUserIds.push(u.id);
    return u;
  };

  const createReservation = async (services, paymentType, clientPtr = null) => {
    folioSeq += 1;
    const reservation = new Parse.Object('Reservation');
    reservation.set('active', true);
    reservation.set('exists', true);
    reservation.set('status', 'confirmed');
    reservation.set('paymentType', paymentType);
    reservation.set('currency', 'MXN');
    reservation.set('folio', `RAN-2607-${String(folioSeq).padStart(3, '0')}`);
    if (clientPtr) reservation.set('clientPtr', clientPtr);
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
    return { id: reservation.id, folio: reservation.get('folio') };
  };

  const fetchReservation = (id) => new Parse.Query('Reservation').get(id, { useMasterKey: true });
  const reconAdjustments = (reservation) => (reservation.get('adjustments') || [])
    .filter((a) => a && a.source === RECON_SOURCE);
  // Pagos SIEMPRE como admin: admin ve cualquier reservación (Fix 2 no lo bloquea), así el único
  // factor bajo prueba es isAgency del DUEÑO (clientPtr), no el rol del que registra el pago.
  const postPayment = (id, body) => request(app)
    .post(`/api/reservations/${id}/payments`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    adminToken = await AuthTestHelper.loginAs('admin', app);
  }, 30000);

  afterAll(async () => {
    await Promise.all(createdUserIds.map(async (id) => {
      try {
        const u = new Parse.Object('AmexingUser');
        u.id = id;
        await u.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }));
  });

  describe('cliente directo / indeterminado => conservador (nunca re-ancla)', () => {
    it('clientPtr null: primer pago cross-tier NO re-ancla paymentType, deja el ajuste acotado', async () => {
      const { id } = await createReservation(CLEAN, 'efectivo', null);

      const res = await postPayment(id, { amount: 12100, currency: 'MXN', method: 'tarjeta' });
      expect(res.status).toBe(200);

      const reservation = await fetchReservation(id);
      expect(reservation.get('paymentType')).toBe('efectivo'); // NO re-anclado a tarjeta
      const recon = reconAdjustments(reservation);
      expect(recon).toHaveLength(1);
      expect(recon[0].amount).toBe(2100); // 12100 tarjeta − 10000 efectivo, como cargo acotado
      expect(res.body.data.summary.balance).toBe(0); // total efectivo 10000 + 2100 = 12100, pagado 12100
    });

    it('end_client SIN roleId ni clientCategory (solo role string) => conservador', async () => {
      const endClient = await makeUser({ role: 'end_client' });
      const { id } = await createReservation(CLEAN, 'efectivo', endClient);

      const res = await postPayment(id, { amount: 12100, currency: 'MXN', method: 'tarjeta' });
      expect(res.status).toBe(200);

      const reservation = await fetchReservation(id);
      expect(reservation.get('paymentType')).toBe('efectivo'); // cliente directo nunca re-ancla
      expect(reconAdjustments(reservation)).toHaveLength(1);
    });

    it('clientPtr huérfano (usuario borrado) => sin crash, conservador (fail-closed)', async () => {
      const ghost = await makeUser({ role: 'department_manager' });
      const ghostId = ghost.id;
      await ghost.destroy({ useMasterKey: true });
      const idx = createdUserIds.indexOf(ghostId);
      if (idx >= 0) createdUserIds.splice(idx, 1);

      const AmexingUser = Parse.Object.extend('AmexingUser');
      const brokenPtr = AmexingUser.createWithoutData(ghostId);
      const { id } = await createReservation(CLEAN, 'efectivo', brokenPtr);

      const res = await postPayment(id, { amount: 12100, currency: 'MXN', method: 'tarjeta' });
      expect(res.status).toBe(200); // no crashea al resolver isAgency sobre un pointer roto

      const reservation = await fetchReservation(id);
      expect(reservation.get('paymentType')).toBe('efectivo'); // huérfano => isAgency false => no re-ancla
    });

    it('ROUND-TRIP del exploit: reservación $50k, pago de $1 en tarjeta => paymentType intacto, balance solo baja el centavo del ajuste (NUNCA re-anclada a $60,500)', async () => {
      const { id } = await createReservation(BIG, 'efectivo', null); // cliente directo

      const res = await postPayment(id, { amount: 1, currency: 'MXN', method: 'tarjeta' });
      expect(res.status).toBe(200);

      const reservation = await fetchReservation(id);
      // El bug: OLD re-anclaba efectivo -> tarjeta y reprecia la reservación completa +$10,500.
      expect(reservation.get('paymentType')).toBe('efectivo'); // <-- NO re-anclada
      const recon = reconAdjustments(reservation);
      expect(recon).toHaveLength(1);
      expect(recon[0].amount).toBeCloseTo(0.17, 2); // ≈ 1 − 1×(50000/60500), NUNCA ~10,500
      // Balance = total efectivo (50000) + 0.17 − 1 pagado ≈ 49999.17; jamás ≈60,499 (re-anclado).
      expect(res.body.data.summary.balance).toBeCloseTo(49999.17, 2);
      expect(res.body.data.summary.balance).toBeLessThan(51000);
    });
  });

  describe('agencia real => re-ancla (y prueba que el .include(clientPtr) quedó arreglado)', () => {
    it('agencia con SOLO el role string (sin clientCategory, caso dominante en prod): primer pago full tarjeta re-ancla a tarjeta', async () => {
      const agency = await makeUser({ role: 'department_manager' }); // real: role set, clientCategory ausente
      const { id } = await createReservation(BIG, 'efectivo', agency);

      const res = await postPayment(id, { amount: 60500, currency: 'MXN', method: 'tarjeta' });
      expect(res.status).toBe(200);

      const reservation = await fetchReservation(id);
      // Si el .include('clientPtr') faltara, clientPtr.get('role') sería vacío => isAgency false =>
      // paymentType seguiría 'efectivo'. Que aquí sea 'tarjeta' confirma que el include es necesario Y
      // suficiente para resolver isAgency correctamente sobre datos reales de producción.
      expect(reservation.get('paymentType')).toBe('tarjeta'); // <-- re-anclado (comportamiento de agencia)
      expect(reconAdjustments(reservation)).toHaveLength(0); // sin ajuste: es re-anclaje limpio
      expect(res.body.data.summary.balance).toBe(0); // total tarjeta 60500, pagado 60500
    });

    it('agencia vía clientCategory="agency" (aunque el role difiera): también re-ancla (condición OR)', async () => {
      const agency = await makeUser({ role: 'end_client', clientCategory: 'agency' });
      const { id } = await createReservation(BIG, 'efectivo', agency);

      const res = await postPayment(id, { amount: 60500, currency: 'MXN', method: 'tarjeta' });
      expect(res.status).toBe(200);

      const reservation = await fetchReservation(id);
      expect(reservation.get('paymentType')).toBe('tarjeta');
    });
  });

  describe('interacción cross-fase con el framing público de Fase 2', () => {
    it('un cliente directo con pago cross-tier: el desglose público sigue 200 y renderiza descuento + ajuste', async () => {
      const { id, folio } = await createReservation(CLEAN, 'efectivo', null);

      const pay = await postPayment(id, { amount: 12100, currency: 'MXN', method: 'tarjeta' });
      expect(pay.status).toBe(200);

      const res = await request(app).get(`/reservations/${folio}`);
      expect(res.status).toBe(200);
      const section = res.text.split('Resumen de pago')[1] || '';
      // Sigue siendo cliente directo (paymentType intacto en efectivo) => framing de descuento.
      expect(section).toContain('Descuento pago efectivo');
      // Y el ajuste acotado de la reconciliación se itemiza con su descripción neutral.
      expect(section).toContain('Ajuste por método de pago');
    });
  });
});
