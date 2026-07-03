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
    await reservation.save(null, { useMasterKey: true });
    testReservationId = reservation.id;
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

  it('lets a department_manager (agencia, level 4) register a payment', async () => {
    const response = await request(app)
      .post(`/api/reservations/${testReservationId}/payments`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ amount: 100, currency: 'MXN', method: 'efectivo' });

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
      .send({ amount: 200, currency: 'MXN', method: 'tarjeta' });

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
