/**
 * Payment endpoint access-by-role integration tests.
 * Payments moved from admin/superadmin-only to requireRoleLevel(4): agencies (department_manager)
 * and agents (client) can now register/see payments; roles below level 4 (employee) still can't.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('Payment endpoints — access by role (integration)', () => {
  let app;
  let adminToken;
  let managerToken; // department_manager = level 4 (agencia)
  let employeeToken; // employee = level 3 (below the payments threshold)
  let testReservationId;
  const createdPaymentIds = [];

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    adminToken = await AuthTestHelper.loginAs('admin', app);
    managerToken = await AuthTestHelper.loginAs('department_manager', app);
    employeeToken = await AuthTestHelper.loginAs('employee', app);

    const reservation = new Parse.Object('Reservation');
    reservation.set('active', true);
    reservation.set('exists', true);
    reservation.set('status', 'confirmed');
    // Fix 2 (ownership scope): the reservation must belong to the acting agency (its clientPtr is a
    // user in the manager's departmentId) — the manager itself qualifies. Without this the new 404
    // scoping would hide it from the department_manager and this suite's intent (agency operates on
    // ITS OWN reservation) would be lost.
    const managerUser = await AuthTestHelper.getUserByRole('department_manager');
    reservation.set('clientPtr', managerUser);
    reservation.set('paymentType', 'efectivo');
    await reservation.save(null, { useMasterKey: true });
    testReservationId = reservation.id;

    // Fase C: este suite prueba ACCESO por rol, no disponibilidad de método. La reservación necesita
    // respaldo real de pricesByType para que efectivo y tarjeta (usados abajo) estén disponibles y el
    // guard de contenido no interfiera con lo que aquí se verifica (RBAC por nivel).
    const service = new Parse.Object('ReservationService');
    service.set('active', true);
    service.set('exists', true);
    service.set('reservationPtr', reservation);
    service.set('subconcept', {
      includeInTotal: true,
      pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 },
      total: 100,
    });
    await service.save(null, { useMasterKey: true });
  }, 30000);

  afterAll(async () => {
    for (const paymentId of createdPaymentIds) {
      try {
        const payment = new Parse.Object('Payment');
        payment.id = paymentId;
        await payment.destroy({ useMasterKey: true });
      } catch (error) {
        // already gone
      }
    }
    if (testReservationId) {
      try {
        const reservation = new Parse.Object('Reservation');
        reservation.id = testReservationId;
        await reservation.destroy({ useMasterKey: true });
      } catch (error) {
        // already gone
      }
    }
  });

  const TODAY = new Date().toISOString().slice(0, 10);

  it('lets a department_manager (agencia, level 4) register a payment', async () => {
    const response = await request(app)
      .post(`/api/reservations/${testReservationId}/payments`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        amount: 100, currency: 'MXN', method: 'efectivo', paidAt: TODAY, receivedBy: 'QA Cajero',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    createdPaymentIds.push(response.body.data.payment.id);
  });

  it('lets a department_manager list payments', async () => {
    const response = await request(app)
      .get(`/api/reservations/${testReservationId}/payments`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data.payments)).toBe(true);
  });

  it('still lets an admin register a payment (no regression)', async () => {
    const response = await request(app)
      .post(`/api/reservations/${testReservationId}/payments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        amount: 200, currency: 'MXN', method: 'tarjeta', paidAt: TODAY,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    createdPaymentIds.push(response.body.data.payment.id);
  });

  it('denies a role below level 4 (employee) from registering a payment', async () => {
    const response = await request(app)
      .post(`/api/reservations/${testReservationId}/payments`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ amount: 100, currency: 'MXN', method: 'efectivo' });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  it('denies a role below level 4 (employee) from listing payments', async () => {
    const response = await request(app)
      .get(`/api/reservations/${testReservationId}/payments`)
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(response.status).toBe(403);
  });
});
