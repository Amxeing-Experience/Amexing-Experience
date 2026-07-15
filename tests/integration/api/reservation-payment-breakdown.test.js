/**
 * GET /api/reservations/:id — desglose de pagos en el payload (Fase 3, integration).
 *
 * End-to-end sobre Parse + mongodb-memory-server: payment.tip viaja igual para admin/
 * department_manager/client (sin filtrar por rol) y el payload ya NO incluye tipByService, el RBAC no
 * regresiona (agencia/agente siguen sin poder POST/DELETE /adjustments pero sí POST /payments; nivel 3
 * sigue con 403 en GET /:id; superadmin sigue en el allowlist de /adjustments), reconciliación de Fase 0
 * + propina real de Fase 1 se ven juntas en el payload, una reservación cancelada sigue exponiendo el
 * payload completo (el modo solo-lectura es de UI, no de backend), y el fallback de summarize() fallido
 * expone total = balance + paidAmount.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');
const PaymentService = require('../../../src/application/services/PaymentService');

const RECON_SOURCE = 'payment-method-reconciliation';

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

  // Clean pricesByType (base × 1.16 / × 1.21).
  const CLEAN = [{ pricesByType: { efectivo: 10000, transferencia: 11600, tarjeta: 12100 } }];

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

  describe('payment.tip viaja igual para los 3 roles (sin filtrar por rol)', () => {
    it('admin, department_manager y client reciben el MISMO payment.tip agregado', async () => {
      const { id } = await createReservation([{ total: 1000, concept: 'Traslado' }]);
      await postPayment(id, { amount: 1000, tip: 80, method: 'efectivo' });

      const [asAdmin, asManager, asClient] = await Promise.all([
        getReservation(id, adminToken),
        getReservation(id, managerToken),
        getReservation(id, clientToken),
      ]);

      expect(asAdmin.status).toBe(200);
      expect(asManager.status).toBe(200);
      expect(asClient.status).toBe(200);

      // El tip agregado es idéntico entre roles.
      expect(asAdmin.body.data.payment.tip).toBe(80);
      expect(asManager.body.data.payment.tip).toBe(80);
      expect(asClient.body.data.payment.tip).toBe(80);
    });
  });

  describe('N1 — el payload ya NO expone tipByService (payment.tip sí)', () => {
    it('un pago con tip > 0 devuelve payment.tipByService undefined y payment.tip correcto (200)', async () => {
      const { id } = await createReservation([{ total: 500 }]);
      await postPayment(id, { amount: 500, tip: 60, method: 'efectivo' });

      const res = await getReservation(id, managerToken);
      expect(res.status).toBe(200);
      expect(res.body.data.payment.tipByService).toBeUndefined();
      expect(res.body.data.payment.tip).toBe(60);
    });
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

  describe('cross-fase — reconciliación (Fase 0) + propina real (Fase 1) juntas en el payload', () => {
    it('un cruce de tier genera el ajuste automático Y la propina se ve, ambos en GET /:id', async () => {
      const { id } = await createReservation(CLEAN, 'transferencia');

      await postPayment(id, { amount: 2320, tip: 50, method: 'transferencia' });
      await postPayment(id, { amount: 9680, tip: 70, method: 'tarjeta' });

      const res = await getReservation(id, adminToken);
      expect(res.status).toBe(200);
      const { payment, adjustments } = res.body.data;

      // Fase 0: ajuste de reconciliación visible.
      const recon = (adjustments || []).filter((a) => a && a.source === RECON_SOURCE);
      expect(recon).toHaveLength(1);
      expect(recon[0].amount).toBe(400);
      expect(recon[0].type).toBe('charge');

      // Fase 1: propina agregada real, visible en el mismo payload.
      expect(payment.tip).toBe(120); // 50 + 70
    });
  });

  describe('reservación cancelada sigue exponiendo el payload completo (solo-lectura es de UI)', () => {
    it('GET /:id sobre una cancelada devuelve payment.total/tip igual', async () => {
      const { id } = await createReservation(
        [{ total: 1000, concept: 'Traslado' }],
        'efectivo',
        { status: 'cancelled' }
      );
      await postPayment(id, { amount: 1000, tip: 40, method: 'efectivo' });

      const res = await getReservation(id, managerToken);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cancelled');
      expect(res.body.data.payment.total).toBeGreaterThan(0);
      expect(res.body.data.payment.tip).toBe(40);
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
});
