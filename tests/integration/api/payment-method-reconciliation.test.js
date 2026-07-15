/**
 * Payment method reconciliation — integration tests (Fase 0).
 *
 * End-to-end over the real addPayment/updatePayment/deletePayment flow with Parse +
 * mongodb-memory-server: verifies that reservation.paymentType is reconciled against the
 * real method of the payments, the single tagged reconciliation adjustment is
 * created/replaced/removed (never stacked), and the balance converges exactly.
 *
 * Critical cases: the $200-phantom-balance 3-payment sequence (Bug 2) converging to
 * balance 0, negotiated pricing (Bug 1), the RBAC-adjacent auto-adjustment for a
 * nivel-4 actor, delete/soft-delete exclusion, and updatePayment excluding itself.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

const RECON_SOURCE = 'payment-method-reconciliation';

describe('Payment method reconciliation (integration)', () => {
  let app;
  let adminToken;
  let agencyToken;
  // Dueño agencia de las reservaciones: role string 'department_manager' (=> isAgency true, preserva el
  // re-anclaje que estas pruebas verifican) Y departmentId del manager de prueba (=> Fix 2 le da acceso).
  let agencyOwner;

  // Clean pricesByType (base × 1.16 / × 1.21): T(efectivo)=10000, T(transferencia)=11600, T(tarjeta)=12100.
  const CLEAN = [{ pricesByType: { efectivo: 10000, transferencia: 11600, tarjeta: 12100 } }];
  // Negotiated ("dirty"): service A tarjeta at 120 (not 121) + service B flat 50.
  // T(efectivo)=150, T(transferencia)=166, T(tarjeta)=170.
  const NEGOTIATED = [
    { pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 120 } },
    { total: 50 },
  ];

  const createReservation = async (services, paymentType, currency = 'MXN') => {
    const reservation = new Parse.Object('Reservation');
    reservation.set('active', true);
    reservation.set('exists', true);
    reservation.set('status', 'confirmed');
    reservation.set('paymentType', paymentType);
    reservation.set('currency', currency);
    reservation.set('clientPtr', agencyOwner); // dueño agencia (isAgency true + acceso Fix 2)
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

  const fetchReservation = async (id) => new Parse.Query('Reservation').get(id, { useMasterKey: true });
  const reconAdjustments = (reservation) => (reservation.get('adjustments') || [])
    .filter((a) => a && a.source === RECON_SOURCE);

  const postPayment = (reservationId, body, token = adminToken) => request(app)
    .post(`/api/reservations/${reservationId}/payments`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    adminToken = await AuthTestHelper.loginAs('admin', app);
    agencyToken = await AuthTestHelper.loginAs('department_manager', app);

    // Dueño agencia: role string 'department_manager' (isAgency true) + departmentId del manager de
    // prueba (test-dept-events) para que Fix 2 le conceda acceso al registrar pagos con agencyToken.
    agencyOwner = new Parse.Object('AmexingUser');
    agencyOwner.set('exists', true);
    agencyOwner.set('active', true);
    agencyOwner.set('role', 'department_manager');
    agencyOwner.set('departmentId', 'test-dept-events');
    agencyOwner.set('email', `recon-agency-${Date.now()}@test.local`);
    agencyOwner.set('username', agencyOwner.get('email'));
    await agencyOwner.save(null, { useMasterKey: true });
  }, 30000);

  afterAll(async () => {
    if (agencyOwner) {
      try { await agencyOwner.destroy({ useMasterKey: true }); } catch (e) { /* already gone */ }
    }
  });

  describe('Bug 2 — 3 cruces secuenciales de tier convergen a balance $0 (sin saldo fantasma)', () => {
    it('$2,320 transferencia -> $4,840 tarjeta -> $4,640 transferencia = balance 0, un solo ajuste $200', async () => {
      const id = await createReservation(CLEAN, 'efectivo');

      // Paso 1: primer pago (transferencia). El paymentType de la cotización (efectivo) se re-ancla limpio.
      const r1 = await postPayment(id, { amount: 2320, currency: 'MXN', method: 'transferencia' });
      expect(r1.status).toBe(200);
      expect(r1.body.data.summary.balance).toBe(9280); // 11600 − 2320

      // Paso 2: pago en tarjeta (parcial) bajo un método distinto -> ajuste de reconciliación.
      const r2 = await postPayment(id, { amount: 4840, currency: 'MXN', method: 'tarjeta' });
      expect(r2.status).toBe(200);
      expect(r2.body.data.summary.balance).toBe(4640);

      // Paso 3: pago en transferencia que salda el resto.
      const r3 = await postPayment(id, { amount: 4640, currency: 'MXN', method: 'transferencia' });
      expect(r3.status).toBe(200);
      expect(r3.body.data.summary.balance).toBe(0); // <-- balance 0 EXACTO, no $200 fantasma
      expect(r3.body.data.summary.paymentStatus).toBe('paid');

      const reservation = await fetchReservation(id);
      const recon = reconAdjustments(reservation);
      expect(recon).toHaveLength(1); // EXACTAMENTE uno, nunca dos apilados
      expect(recon[0].amount).toBe(200); // $200, no $400 (fórmula vieja/defectuosa)
      expect(recon[0].type).toBe('charge');
      expect(reservation.get('paymentType')).toBe('transferencia'); // el ancla no se reescribe en complex
    });
  });

  describe('escenario simple (none) — el primer pago establece el método real', () => {
    it('sin pagos previos, pago en método distinto al de la cotización actualiza paymentType sin crear ajuste', async () => {
      const id = await createReservation(CLEAN, 'efectivo');

      const res = await postPayment(id, { amount: 12100, currency: 'MXN', method: 'tarjeta' });
      expect(res.status).toBe(200);
      expect(res.body.data.summary.balance).toBe(0);

      const reservation = await fetchReservation(id);
      expect(reservation.get('paymentType')).toBe('tarjeta');
      expect(reconAdjustments(reservation)).toHaveLength(0);
    });
  });

  describe('escenario complejo (complex) — pago previo en otra tier', () => {
    it('liquidación completa cruzando de transferencia a tarjeta crea un ajuste $400 y no toca paymentType', async () => {
      const id = await createReservation(CLEAN, 'transferencia');

      await postPayment(id, { amount: 2320, currency: 'MXN', method: 'transferencia' });
      const res = await postPayment(id, { amount: 9680, currency: 'MXN', method: 'tarjeta' });
      expect(res.status).toBe(200);
      expect(res.body.data.summary.balance).toBe(0);

      const reservation = await fetchReservation(id);
      const recon = reconAdjustments(reservation);
      expect(recon).toHaveLength(1);
      expect(recon[0].amount).toBe(400);
      expect(reservation.get('paymentType')).toBe('transferencia');
    });
  });

  describe('Bug 1 — reconciliación con precio negociado, no constantes fijas', () => {
    it('parcial transferencia + resto tarjeta al techo real ($67.59) converge a balance 0', async () => {
      const id = await createReservation(NEGOTIATED, 'transferencia');

      await postPayment(id, { amount: 100, currency: 'MXN', method: 'transferencia' });
      const res = await postPayment(id, { amount: 67.59, currency: 'MXN', method: 'tarjeta' });
      expect(res.status).toBe(200);
      // Sin advertencia: $67.59 es exactamente el techo real (no dispara mecanismo (a)).
      expect(res.body.warning).toBeNull();
      expect(res.body.data.summary.balance).toBe(0);

      const reservation = await fetchReservation(id);
      const recon = reconAdjustments(reservation);
      expect(recon).toHaveLength(1);
      expect(recon[0].amount).toBeCloseTo(1.59, 2);
    });
  });

  describe('red de seguridad — eliminar/editar pagos no deja saldo fantasma', () => {
    it('eliminar el pago que cruzó de tier remueve el ajuste taggeado (no lo deja huérfano)', async () => {
      const id = await createReservation(CLEAN, 'transferencia');

      await postPayment(id, { amount: 2320, currency: 'MXN', method: 'transferencia' });
      const cross = await postPayment(id, { amount: 4840, currency: 'MXN', method: 'tarjeta' });
      const crossId = cross.body.data.payment.id;

      let reservation = await fetchReservation(id);
      expect(reconAdjustments(reservation)).toHaveLength(1); // el ajuste existe tras el cruce

      const del = await request(app)
        .delete(`/api/reservations/${id}/payments/${crossId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(del.status).toBe(200);
      expect(del.body.data.summary.balance).toBe(9280); // 11600 − 2320, sin fantasma

      reservation = await fetchReservation(id);
      expect(reconAdjustments(reservation)).toHaveLength(0); // removido, no huérfano en $0
    });

    it('editar el monto de un pago (mismo método) recalcula sin crear un ajuste espurio', async () => {
      const id = await createReservation(CLEAN, 'efectivo');

      const p = await postPayment(id, { amount: 5000, currency: 'MXN', method: 'efectivo' });
      const paymentId = p.body.data.payment.id;

      const upd = await request(app)
        .put(`/api/reservations/${id}/payments/${paymentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 6000, currency: 'MXN' });
      expect(upd.status).toBe(200);
      expect(upd.body.data.summary.balance).toBe(4000); // 10000 − 6000

      const reservation = await fetchReservation(id);
      expect(reconAdjustments(reservation)).toHaveLength(0);
    });

    it('un pago borrado (soft-delete) se excluye del historial de comparación de tiers', async () => {
      const id = await createReservation(CLEAN, 'transferencia');

      await postPayment(id, { amount: 2320, currency: 'MXN', method: 'transferencia' });
      const cross = await postPayment(id, { amount: 4840, currency: 'MXN', method: 'tarjeta' });
      await request(app)
        .delete(`/api/reservations/${id}/payments/${cross.body.data.payment.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Con el pago tarjeta ya borrado, un segundo transferencia salda todo en un solo método consistente.
      const res = await postPayment(id, { amount: 9280, currency: 'MXN', method: 'transferencia' });
      expect(res.status).toBe(200);
      expect(res.body.data.summary.balance).toBe(0);

      const reservation = await fetchReservation(id);
      expect(reconAdjustments(reservation)).toHaveLength(0); // el tarjeta borrado NO fuerza complex
    });
  });

  describe('RBAC — el ajuste automático se crea aunque lo dispare un actor nivel 4 (agencia)', () => {
    it('una agencia (department_manager) registra el pago que cruza de tier y el ajuste se crea sin 403', async () => {
      const id = await createReservation(CLEAN, 'transferencia');

      // Un actor nivel 4 NO puede llamar POST /adjustments directamente (admin-only) pero SÍ registrar pagos.
      await postPayment(id, { amount: 2320, currency: 'MXN', method: 'transferencia' }, agencyToken);
      const res = await postPayment(id, { amount: 4840, currency: 'MXN', method: 'tarjeta' }, agencyToken);
      expect(res.status).toBe(200); // no 403

      const reservation = await fetchReservation(id);
      const recon = reconAdjustments(reservation);
      expect(recon).toHaveLength(1);
      expect(recon[0].amount).toBe(200);
    });
  });

  describe('sobrepago — advierte, nunca bloquea', () => {
    it('un pago que excede el techo esperado devuelve advertencia con status 200 (no 4xx)', async () => {
      const id = await createReservation(CLEAN, 'tarjeta');

      // Techo esperado del primer pago en tarjeta = T(tarjeta) = 12100; capturamos mucho más.
      const res = await postPayment(id, { amount: 20000, currency: 'MXN', method: 'tarjeta' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.warning).toBeTruthy(); // advertencia de mecanismo (a)
      expect(res.body.data.summary.paymentStatus).toBe('paid'); // sobrepago permitido
    });
  });

  describe('USD — la reconciliación opera sobre montos ya convertidos a MXN', () => {
    it('un pago en USD se reconcilia con su equivalente en MXN (nunca el monto crudo)', async () => {
      const id = await createReservation(CLEAN, 'efectivo');

      const res = await postPayment(id, { amount: 100, currency: 'USD', method: 'efectivo' });
      expect(res.status).toBe(200);
      const { payment, summary } = res.body.data;
      expect(payment.origCurrency).toBe('USD');
      expect(payment.amount).toBeGreaterThan(100); // convertido a MXN (rate > 1)
      // El rollup usa el monto MXN, no el USD crudo.
      expect(summary.paidAmount).toBe(payment.amount);
    });
  });
});
