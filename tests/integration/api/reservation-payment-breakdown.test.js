/**
 * GET /api/reservations/:id — desglose de pagos en el payload (integration).
 *
 * End-to-end sobre Parse + mongodb-memory-server: el RBAC no regresiona (agencia/agente siguen sin
 * poder POST/DELETE /adjustments pero sí POST /payments; nivel 3 sigue con 403 en GET /:id; superadmin
 * sigue en el allowlist de /adjustments), el fallback de summarize() fallido expone
 * total = balance + paidAmount, y — tras quitar la propina general — dos pagos parciales del mismo
 * método saldan el balance exacto, un pago de monto 0 se rechaza (400) y el DTO ya no expone `tip`.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');
const PaymentService = require('../../../src/application/services/PaymentService');

describe('GET /api/reservations/:id — payment breakdown (integration)', () => {
  let app;
  let adminToken;
  let managerToken; // department_manager = level 4 (agencia)
  let clientToken; // client = level 5 (agente)
  let employeeToken; // employee = level 3 (bajo el umbral)
  let superadminToken;
  // Fix 2 (ownership scope): para que las MISMAS reservaciones sean accesibles por admin, agencia y
  // agente, cada una lleva clientPtr=agencyOwner (dueño agencia en el departmentId del manager) Y
  // quotePtr=clientQuote (cotización cuyo owner es el agente de prueba). Sin esto el nuevo scoping
  // daría 404 a agencia/agente sobre estas reservaciones.
  let agencyOwner;
  let clientQuote;

  const createReservation = async (services, paymentType = 'efectivo', opts = {}) => {
    const reservation = new Parse.Object('Reservation');
    reservation.set('active', true);
    reservation.set('exists', true);
    reservation.set('status', opts.status || 'confirmed');
    reservation.set('paymentType', paymentType);
    reservation.set('currency', opts.currency || 'MXN');
    reservation.set('clientPtr', agencyOwner); // acceso agencia (department filter)
    reservation.set('quotePtr', clientQuote); // acceso agente (quote ownership)
    if (opts.paidAmount !== undefined) reservation.set('paidAmount', opts.paidAmount);
    if (opts.balance !== undefined) reservation.set('balance', opts.balance);
    await reservation.save(null, { useMasterKey: true });

    const serviceIds = await Promise.all(services.map(async (svc, i) => {
      const rs = new Parse.Object('ReservationService');
      rs.set('active', true);
      rs.set('exists', true);
      rs.set('reservationPtr', reservation);
      rs.set('concept', svc.concept || `Servicio ${i + 1}`);
      rs.set('type', 'transport');
      rs.set('subconcept', {
        includeInTotal: true,
        pricesByType: svc.pricesByType || null,
        total: svc.total !== undefined ? svc.total : 0,
      });
      await rs.save(null, { useMasterKey: true });
      return rs.id;
    }));

    return { id: reservation.id, serviceIds };
  };

  const getReservation = (id, token = adminToken) => request(app)
    .get(`/api/reservations/${id}`)
    .set('Authorization', `Bearer ${token}`);
  const postPayment = (id, body, token = adminToken) => request(app)
    .post(`/api/reservations/${id}/payments`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  const postAdjustment = (id, body, token) => request(app)
    .post(`/api/reservations/${id}/adjustments`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  const deleteAdjustment = (id, adjId, token) => request(app)
    .delete(`/api/reservations/${id}/adjustments/${adjId}`)
    .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    adminToken = await AuthTestHelper.loginAs('admin', app);
    managerToken = await AuthTestHelper.loginAs('department_manager', app);
    clientToken = await AuthTestHelper.loginAs('client', app);
    employeeToken = await AuthTestHelper.loginAs('employee', app);
    superadminToken = await AuthTestHelper.loginAs('superadmin', app);

    // Dueño agencia (role string + departmentId del manager) para el acceso de la agencia.
    agencyOwner = new Parse.Object('AmexingUser');
    agencyOwner.set('exists', true);
    agencyOwner.set('active', true);
    agencyOwner.set('role', 'department_manager');
    agencyOwner.set('departmentId', 'test-dept-events');
    agencyOwner.set('email', `breakdown-agency-${Date.now()}@test.local`);
    agencyOwner.set('username', agencyOwner.get('email'));
    await agencyOwner.save(null, { useMasterKey: true });

    // Cotización cuyo owner es el agente de prueba (client) para el acceso del agente (quote ownership).
    const clientUser = await AuthTestHelper.getUserByRole('client');
    clientQuote = new Parse.Object('Quote');
    clientQuote.set('exists', true);
    clientQuote.set('active', true);
    clientQuote.set('owner', clientUser);
    await clientQuote.save(null, { useMasterKey: true });
  }, 30000);

  afterAll(async () => {
    const destroy = async (o) => { try { await o.destroy({ useMasterKey: true }); } catch (e) { /* gone */ } };
    if (agencyOwner) await destroy(agencyOwner);
    if (clientQuote) await destroy(clientQuote);
  });

  describe('RBAC sin regresión', () => {
    it('un employee (nivel 3) sigue con 403 en GET /:id', async () => {
      const { id } = await createReservation([{ total: 100 }]);
      const res = await getReservation(id, employeeToken);
      expect(res.status).toBe(403);
    });

    it('una agencia (department_manager) NO puede POST /adjustments (403 allowlist)', async () => {
      const { id } = await createReservation([{ total: 100 }]);
      const res = await postAdjustment(id, { type: 'charge', amount: 50, description: 'x' }, managerToken);
      expect(res.status).toBe(403);
    });

    it('un agente (client) NO puede POST /adjustments (403 allowlist)', async () => {
      const { id } = await createReservation([{ total: 100 }]);
      const res = await postAdjustment(id, { type: 'charge', amount: 50, description: 'x' }, clientToken);
      expect(res.status).toBe(403);
    });

    it('una agencia NO puede DELETE /adjustments (403), aun sobre un ajuste creado por admin', async () => {
      const { id } = await createReservation([{ total: 100 }]);
      const created = await postAdjustment(id, { type: 'charge', amount: 50, description: 'x' }, adminToken);
      expect(created.status).toBe(200);
      const adjId = created.body.data.adjustment ? created.body.data.adjustment.id
        : (created.body.data.adjustments || []).slice(-1)[0].id;
      const res = await deleteAdjustment(id, adjId, managerToken);
      expect(res.status).toBe(403);
    });

    it('superadmin SIGUE en el allowlist de /adjustments (200)', async () => {
      const { id } = await createReservation([{ total: 100 }]);
      const res = await postAdjustment(id, { type: 'charge', amount: 50, description: 'x' }, superadminToken);
      expect(res.status).toBe(200);
    });

    it('una agencia SÍ puede POST /payments (nivel 4+, 200)', async () => {
      const { id } = await createReservation([{ total: 100 }]);
      const res = await postPayment(id, { amount: 100, method: 'efectivo' }, managerToken);
      expect(res.status).toBe(200);
    });
  });

  describe('fallback — summarize() falla', () => {
    it('deriva total = balance + paidAmount (no crashea)', async () => {
      const { id } = await createReservation([{ total: 1000 }], 'efectivo', {
        paidAmount: 300, balance: 700,
      });

      const spy = jest.spyOn(PaymentService, 'summarize').mockRejectedValueOnce(new Error('boom'));
      try {
        const res = await getReservation(id, adminToken);
        expect(res.status).toBe(200);
        expect(res.body.data.payment.total).toBe(1000); // 700 + 300 derivado
        expect(res.body.data.payment.paidAmount).toBe(300);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('sin propina — balance, validación y DTO', () => {
    it('(a) dos pagos parciales del mismo método sin propina => balance exacto', async () => {
      const { id } = await createReservation([{ total: 1000 }], 'efectivo');
      await postPayment(id, { amount: 400, method: 'efectivo' });
      await postPayment(id, { amount: 600, method: 'efectivo' });

      const res = await getReservation(id, adminToken);
      expect(res.status).toBe(200);
      expect(res.body.data.payment.paidAmount).toBe(1000);
      expect(res.body.data.payment.balance).toBe(0);
      expect(res.body.data.payment.paymentStatus).toBe('paid');
    });

    it('(b) POST /payments {amount:0} => 400 con el mensaje exacto revertido', async () => {
      const { id } = await createReservation([{ total: 1000 }], 'efectivo');
      const res = await postPayment(id, { amount: 0, method: 'efectivo' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('El monto debe ser un número mayor a 0');
    });

    it('(c) el DTO de GET /reservations/:id NO expone la clave tip', async () => {
      const { id } = await createReservation([{ total: 1000 }], 'efectivo');
      await postPayment(id, { amount: 500, method: 'efectivo' });

      const res = await getReservation(id, adminToken);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.data.payment)).not.toContain('tip');
    });
  });
});
