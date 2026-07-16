/**
 * Payment anchor immutability — integration tests (Fase B, ADR-2).
 *
 * End-to-end sobre el flujo real de pagos con Parse + mongodb-memory-server. Verifica el invariante
 * UNIVERSAL del modelo de saldo mixto: reservation.paymentType (heredado de la cotización) NUNCA se
 * reescribe por ningún registro/edición/eliminación de pago — ni para agencia NI para cliente directo
 * (a diferencia del motor viejo, donde solo el cliente directo estaba protegido y la agencia sí
 * re-anclaba). Ningún ajuste automático se crea.
 *
 * Casos: agencia con pago full en otro método (antes re-anclaba, ahora no); cliente directo cross-tier;
 * el exploit $50k/$1 reinterpretado como cobertura minúscula (~$0.83 de $50,000, jamás un salto a
 * $60,500); clientPtr null y clientPtr huérfano (usuario borrado) sin crash; e inmutabilidad a través
 * de add/edit/delete.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('Payment anchor immutability — paymentType nunca cambia (integration)', () => {
  let app;
  let adminToken;
  const createdUserIds = [];

  // Reservación de $100k: efectivo 100000 / transferencia 116000 / tarjeta 121000 (×1.21).
  const HUNDREDK = [{ pricesByType: { efectivo: 100000, transferencia: 116000, tarjeta: 121000 } }];
  // Reservación grande para el exploit: efectivo 50000 / transferencia 58000 / tarjeta 60500.
  const BIG = [{ pricesByType: { efectivo: 50000, transferencia: 58000, tarjeta: 60500 } }];

  const makeUser = async (fields) => {
    const u = new Parse.Object('AmexingUser');
    u.set('exists', true);
    u.set('active', true);
    u.set('email', `anchor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`);
    u.set('username', u.get('email'));
    Object.entries(fields).forEach(([k, v]) => u.set(k, v));
    await u.save(null, { useMasterKey: true });
    createdUserIds.push(u.id);
    return u;
  };

  const createReservation = async (services, paymentType, clientPtr = null) => {
    const reservation = new Parse.Object('Reservation');
    reservation.set('active', true);
    reservation.set('exists', true);
    reservation.set('status', 'confirmed');
    reservation.set('paymentType', paymentType);
    reservation.set('currency', 'MXN');
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

    return reservation.id;
  };

  const fetchReservation = (id) => new Parse.Query('Reservation').get(id, { useMasterKey: true });
  const adjustmentsOf = (reservation) => reservation.get('adjustments') || [];
  // Siempre como admin: admin ve cualquier reservación (sin scoping), aislando que la ÚNICA variable
  // bajo prueba es que el flujo de pago jamás reescribe paymentType (no el dueño de la reservación).
  const postPayment = (id, body) => request(app)
    .post(`/api/reservations/${id}/payments`).set('Authorization', `Bearer ${adminToken}`).send(body);
  const putPayment = (id, pid, body) => request(app)
    .put(`/api/reservations/${id}/payments/${pid}`).set('Authorization', `Bearer ${adminToken}`).send(body);
  const delPayment = (id, pid) => request(app)
    .delete(`/api/reservations/${id}/payments/${pid}`).set('Authorization', `Bearer ${adminToken}`);

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

  describe('agencia: un pago full en otro método YA NO re-ancla (antes sí)', () => {
    it('ancla efectivo + agencia: pago 121000 tarjeta cubre 100% pero paymentType sigue efectivo', async () => {
      const agency = await makeUser({ role: 'department_manager' });
      const id = await createReservation(HUNDREDK, 'efectivo', agency);

      const r = await postPayment(id, { amount: 121000, currency: 'MXN', method: 'tarjeta' });
      expect(r.status).toBe(200);
      const s = r.body.data.summary;
      expect(s.coverageAmount).toBe(100000); // 121000 × (100000/121000)
      expect(s.paymentStatus).toBe('paid');
      expect(s.remainingBase).toBe(0);

      const reservation = await fetchReservation(id);
      expect(reservation.get('paymentType')).toBe('efectivo'); // <-- inmutable (antes re-anclaba a tarjeta)
      expect(adjustmentsOf(reservation)).toHaveLength(0);
    });
  });

  describe('cliente directo: un pago cross-tier tampoco re-ancla', () => {
    it('end_client ancla tarjeta, pago full efectivo: paymentType sigue tarjeta, cierra en paid', async () => {
      const client = await makeUser({ role: 'end_client' });
      const id = await createReservation(HUNDREDK, 'tarjeta', client);

      const r = await postPayment(id, { amount: 100000, currency: 'MXN', method: 'efectivo' });
      expect(r.status).toBe(200);
      const s = r.body.data.summary;
      expect(s.coverageAmount).toBe(121000); // 100000 × (121000/100000) => cubre el ancla tarjeta completo
      expect(s.paymentStatus).toBe('paid');
      // ADR-1b: se pagó en un método más barato que el ancla => balance físico positivo convive con 'paid'.
      expect(s.paidAmount).toBe(100000);
      expect(s.balance).toBe(21000); // 121000 − 100000

      const reservation = await fetchReservation(id);
      expect(reservation.get('paymentType')).toBe('tarjeta');
    });
  });

  describe('exploit $50k / $1 reinterpretado como cobertura minúscula', () => {
    it('ancla efectivo, pago $1 tarjeta: cobertura ~$0.83 (NUNCA un salto a $60,500), paymentType intacto', async () => {
      const agency = await makeUser({ role: 'department_manager' });
      const id = await createReservation(BIG, 'efectivo', agency);

      const r = await postPayment(id, { amount: 1, currency: 'MXN', method: 'tarjeta' });
      expect(r.status).toBe(200);
      const s = r.body.data.summary;
      expect(s.coverageAmount).toBeCloseTo(0.83, 2); // 1 × (50000/60500)
      expect(s.remainingBase).toBeCloseTo(49999.17, 2); // jamás cubre $60,500 completos
      expect(s.paidAmount).toBe(1);
      expect(s.balance).toBe(49999); // 50000 − 1 (dinero físico)

      const reservation = await fetchReservation(id);
      expect(reservation.get('paymentType')).toBe('efectivo'); // NO re-anclada a tarjeta
    });
  });

  describe('clientPtr null / huérfano no crashea; paymentType intacto', () => {
    it('clientPtr null: pago cross-tier 200 sin crash, paymentType intacto', async () => {
      const id = await createReservation(BIG, 'efectivo', null);

      const r = await postPayment(id, { amount: 60500, currency: 'MXN', method: 'tarjeta' });
      expect(r.status).toBe(200);

      const reservation = await fetchReservation(id);
      expect(reservation.get('paymentType')).toBe('efectivo');
    });

    it('clientPtr huérfano (usuario borrado): 200 sin crash, paymentType intacto', async () => {
      const ghost = await makeUser({ role: 'department_manager' });
      const ghostId = ghost.id;
      await ghost.destroy({ useMasterKey: true });
      const idx = createdUserIds.indexOf(ghostId);
      if (idx >= 0) createdUserIds.splice(idx, 1);

      const AmexingUser = Parse.Object.extend('AmexingUser');
      const brokenPtr = AmexingUser.createWithoutData(ghostId);
      const id = await createReservation(BIG, 'transferencia', brokenPtr);

      const r = await postPayment(id, { amount: 1000, currency: 'MXN', method: 'tarjeta' });
      expect(r.status).toBe(200);

      const reservation = await fetchReservation(id);
      expect(reservation.get('paymentType')).toBe('transferencia');
    });
  });

  describe('paymentType inmutable a través de add / edit / delete', () => {
    it('registrar, editar el método, y eliminar: paymentType nunca cambia de su valor original', async () => {
      const id = await createReservation(HUNDREDK, 'efectivo', null);

      const p = await postPayment(id, { amount: 50000, currency: 'MXN', method: 'transferencia' });
      expect(p.status).toBe(200);
      let reservation = await fetchReservation(id);
      expect(reservation.get('paymentType')).toBe('efectivo');

      const upd = await putPayment(id, p.body.data.payment.id, { method: 'tarjeta' });
      expect(upd.status).toBe(200);
      reservation = await fetchReservation(id);
      expect(reservation.get('paymentType')).toBe('efectivo');

      const del = await delPayment(id, p.body.data.payment.id);
      expect(del.status).toBe(200);
      reservation = await fetchReservation(id);
      expect(reservation.get('paymentType')).toBe('efectivo');
    });
  });
});
