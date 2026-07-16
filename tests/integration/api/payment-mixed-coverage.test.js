/**
 * Mixed-method coverage engine — integration tests (Fase B, carrito de pagos).
 *
 * End-to-end sobre el flujo real addPayment/updatePayment/deletePayment con Parse +
 * mongodb-memory-server, verificando el MODELO DE SALDO MIXTO que reemplazó al motor de
 * re-anclaje: reservation.paymentType es inmutable, cada pago cuenta por su cobertura
 * equivalente-ancla (baseEquivalente), el estado deriva de la cobertura (no del dinero físico),
 * y NUNCA se crea un ajuste automático de reconciliación.
 *
 * Casos: Bug 2 (3 cruces secuenciales cierran en paid/remainingBase 0), Bug 1 (precio negociado,
 * ratio real 166/170 no 1.16/1.21), RBAC nivel-4 (agencia registra cross-tier sin 403), USD (el
 * efectivo NO se redondea a múltiplo de 5), edición de monto/método que recalcula desde CERO todo
 * el historial, y eliminación de un pago cross-tier sin residuo.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('Payment mixed-method coverage (integration)', () => {
  let app;
  let adminToken;
  let agencyToken;
  // Dueño agencia: role string department_manager + departmentId del manager de prueba, para que el
  // scoping de ownership le conceda acceso al registrar pagos con agencyToken.
  let agencyOwner;

  // Precio "limpio" (base × 1.16 / × 1.21): T(efectivo)=10000, T(transferencia)=11600, T(tarjeta)=12100.
  const CLEAN = [{ pricesByType: { efectivo: 10000, transferencia: 11600, tarjeta: 12100 } }];
  // Precio negociado ("sucio"): A tarjeta 120 (no 121) + B plano 50. T(efectivo)=150, transferencia=166, tarjeta=170.
  const NEGOTIATED = [
    { pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 120 } },
    { total: 50 },
  ];

  const createReservation = async (services, paymentType, currency = 'MXN', clientPtr = null) => {
    const reservation = new Parse.Object('Reservation');
    reservation.set('active', true);
    reservation.set('exists', true);
    reservation.set('status', 'confirmed');
    reservation.set('paymentType', paymentType);
    reservation.set('currency', currency);
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

  const postPayment = (id, body, token = adminToken) => request(app)
    .post(`/api/reservations/${id}/payments`).set('Authorization', `Bearer ${token}`).send(body);
  const getPayments = (id, token = adminToken) => request(app)
    .get(`/api/reservations/${id}/payments`).set('Authorization', `Bearer ${token}`);
  const putPayment = (id, pid, body, token = adminToken) => request(app)
    .put(`/api/reservations/${id}/payments/${pid}`).set('Authorization', `Bearer ${token}`).send(body);
  const delPayment = (id, pid, token = adminToken) => request(app)
    .delete(`/api/reservations/${id}/payments/${pid}`).set('Authorization', `Bearer ${token}`);

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
    agencyOwner.set('email', `mixed-agency-${Date.now()}@test.local`);
    agencyOwner.set('username', agencyOwner.get('email'));
    await agencyOwner.save(null, { useMasterKey: true });
  }, 30000);

  afterAll(async () => {
    if (agencyOwner) {
      try { await agencyOwner.destroy({ useMasterKey: true }); } catch (e) { /* already gone */ }
    }
  });

  describe('Bug 2 — 3 cruces secuenciales cierran en paid / remainingBase 0 (sin ajuste automático)', () => {
    it('ancla efectivo: 2320 transferencia -> 4840 tarjeta -> 4640 transferencia => cobertura 10000, paid', async () => {
      const id = await createReservation(CLEAN, 'efectivo');

      await postPayment(id, { amount: 2320, currency: 'MXN', method: 'transferencia' });
      await postPayment(id, { amount: 4840, currency: 'MXN', method: 'tarjeta' });
      const r3 = await postPayment(id, { amount: 4640, currency: 'MXN', method: 'transferencia' });
      expect(r3.status).toBe(200);

      const s = r3.body.data.summary;
      // 2320×(10000/11600)=2000 ; 4840×(10000/12100)=4000 ; 4640×(10000/11600)=4000 => 10000 exacto.
      expect(s.coverageAmount).toBe(10000);
      expect(s.remainingBase).toBe(0);
      expect(s.paymentStatus).toBe('paid');
      // ADR-1b: paidAmount/balance = dinero físico crudo (se pagó en métodos más caros que el ancla).
      expect(s.paidAmount).toBe(11800); // 2320 + 4840 + 4640
      expect(s.balance).toBe(-1800); // 10000 − 11800

      const reservation = await fetchReservation(id);
      expect(reservation.get('paymentType')).toBe('efectivo'); // ancla inmutable
      expect(adjustmentsOf(reservation)).toHaveLength(0); // ningún ajuste automático
    });
  });

  describe('Bug 1 — cobertura con precio negociado (ratio real, no constantes fijas)', () => {
    it('ancla transferencia: 100 transferencia + 67.59 tarjeta cierra remainingBase 0 (usa 166/170)', async () => {
      const id = await createReservation(NEGOTIATED, 'transferencia');

      await postPayment(id, { amount: 100, currency: 'MXN', method: 'transferencia' });
      const r = await postPayment(id, { amount: 67.59, currency: 'MXN', method: 'tarjeta' });
      expect(r.status).toBe(200);

      const s = r.body.data.summary;
      expect(s.remainingBase).toBe(0); // 100 + 67.59×(166/170)=66 => 166 (base transferencia)
      expect(s.paymentStatus).toBe('paid');
      expect(r.body.warning).toBeNull(); // el mecanismo de warning se retiró (siempre null salvo comprobante)

      const reservation = await fetchReservation(id);
      expect(reservation.get('paymentType')).toBe('transferencia');
      expect(adjustmentsOf(reservation)).toHaveLength(0);
    });
  });

  describe('RBAC — una agencia (nivel 4) registra pagos cross-tier sin 403 ni regresión', () => {
    it('department_manager registra transferencia + tarjeta; ambos 200, sin ajuste, ancla intacta', async () => {
      const id = await createReservation(CLEAN, 'transferencia', 'MXN', agencyOwner);

      const r1 = await postPayment(id, { amount: 2320, currency: 'MXN', method: 'transferencia' }, agencyToken);
      expect(r1.status).toBe(200);
      const r2 = await postPayment(id, { amount: 4840, currency: 'MXN', method: 'tarjeta' }, agencyToken);
      expect(r2.status).toBe(200); // no 403 (nivel 4 puede registrar pagos)

      const reservation = await fetchReservation(id);
      expect(adjustmentsOf(reservation)).toHaveLength(0);
      expect(reservation.get('paymentType')).toBe('transferencia'); // agencia YA NO re-ancla
    });
  });

  describe('USD — el efectivo NO se redondea a múltiplo de 5 (tolerancia estricta $0.01)', () => {
    it('reservación USD: total 101 sin redondeo y montoParaSaldar.efectivo 101', async () => {
      const id = await createReservation(
        [{ pricesByType: { efectivo: 101, transferencia: 116, tarjeta: 121 } }],
        'efectivo',
        'USD'
      );

      const res = await getPayments(id);
      expect(res.status).toBe(200);
      const s = res.body.data.summary;
      expect(s.total).toBe(101); // MXN redondearía a 100; USD no
      expect(s.remainingPercent).toBe(100); // sin pagos
      expect(s.montoParaSaldar.efectivo).toBe(101);
    });
  });

  describe('USD — un PAGO REAL refleja la cobertura real, no ~18.5x inflada (council L5F0)', () => {
    it('reservación USD total 101, pago REAL de 10 USD en efectivo: cobertura ~10 y status partial (NO paid inflado)', async () => {
      const id = await createReservation(
        [{ pricesByType: { efectivo: 101, transferencia: 116, tarjeta: 121 } }],
        'efectivo',
        'USD'
      );

      // POST real: el pago se guarda en MXN (10 USD × tasa ~18.5 ≈ 185), pero el motor de cobertura debe
      // medir en USD (origAmount = 10), no tomar 185 contra un total de 101 (bug: coverage ~183% / paid).
      const r = await postPayment(id, { amount: 10, currency: 'USD', method: 'efectivo' });
      expect(r.status).toBe(200);
      const s = r.body.data.summary;
      expect(s.total).toBe(101); // USD, sin redondeo a múltiplo de 5
      expect(s.coverageAmount).toBe(10); // 10 USD cubre 10 USD (mismo método que el ancla), JAMÁS ~185
      expect(s.coveragePercent).toBeLessThan(20); // ~9.9%, nunca ~183%
      expect(s.paymentStatus).toBe('partial'); // 10 de 101, NO 'paid' inflado por mezclar MXN/USD
      expect(s.remainingBase).toBe(91); // 101 − 10, en USD
      expect(s.paidAmount).toBe(10); // en la moneda de la reservación (USD), consistente con el total
      expect(s.balance).toBe(91); // total − paid, ambos en USD
    });
  });

  describe('editar monto/método recalcula desde CERO el historial (nunca un delta incremental)', () => {
    it('bajar el monto de un pago tarjeta a la mitad recalcula la cobertura completa', async () => {
      const id = await createReservation(CLEAN, 'efectivo');

      const p = await postPayment(id, { amount: 12100, currency: 'MXN', method: 'tarjeta' });
      expect(p.body.data.summary.remainingBase).toBe(0); // 12100 tarjeta cubre 10000 efectivo
      const pid = p.body.data.payment.id;

      const upd = await putPayment(id, pid, { amount: 6050, currency: 'MXN' });
      expect(upd.status).toBe(200);
      const s = upd.body.data.summary;
      expect(s.coverageAmount).toBe(5000); // 6050 tarjeta -> 5000 base (recalculado, no delta)
      expect(s.remainingBase).toBe(5000);
      expect(s.paymentStatus).toBe('partial');

      const reservation = await fetchReservation(id);
      expect(reservation.get('paymentType')).toBe('efectivo');
    });

    it('cambiar el método de un pago (tarjeta -> efectivo) recalcula la cobertura desde cero', async () => {
      const id = await createReservation(CLEAN, 'efectivo');

      const p = await postPayment(id, { amount: 6050, currency: 'MXN', method: 'tarjeta' });
      expect(p.body.data.summary.coverageAmount).toBe(5000); // 6050 tarjeta -> 5000 base
      const pid = p.body.data.payment.id;

      const upd = await putPayment(id, pid, { method: 'efectivo' });
      expect(upd.status).toBe(200);
      const s = upd.body.data.summary;
      expect(s.coverageAmount).toBe(6050); // 6050 efectivo -> 6050 base (1:1, mismo método que el ancla)
      expect(s.paidAmount).toBe(6050);
    });
  });

  describe('eliminar un pago cross-tier no deja residuo', () => {
    it('borrar el pago tarjeta deja solo la cobertura del efectivo, sin ajuste huérfano', async () => {
      const id = await createReservation(CLEAN, 'efectivo');

      await postPayment(id, { amount: 5000, currency: 'MXN', method: 'efectivo' });
      const cross = await postPayment(id, { amount: 6050, currency: 'MXN', method: 'tarjeta' });
      expect(cross.body.data.summary.remainingBase).toBe(0); // 5000 + 6050×(10000/12100)=5000 => 10000

      const del = await delPayment(id, cross.body.data.payment.id);
      expect(del.status).toBe(200);
      const s = del.body.data.summary;
      expect(s.coverageAmount).toBe(5000); // solo el efectivo
      expect(s.remainingBase).toBe(5000);
      expect(s.paymentStatus).toBe('partial');

      const reservation = await fetchReservation(id);
      expect(adjustmentsOf(reservation)).toHaveLength(0); // sin residuo
    });
  });
});
