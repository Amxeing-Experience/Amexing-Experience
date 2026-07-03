/**
 * Payment paidAt date-validation integration tests
 * Covers PaymentController.addPayment/updatePayment's use of validateDate
 * (shared standard: 1900-01-01 .. today + 20y, future allowed).
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('Payment paidAt date validation (integration)', () => {
  let app;
  let adminToken;
  let testReservationId;
  const createdPaymentIds = [];

  // Relative dates so the test doesn't rot as "today" advances.
  const isoYearsFromNow = (years) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + years);
    return d.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    adminToken = await AuthTestHelper.loginAs('admin', app);

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
        // Payment might already be gone
      }
    }
    if (testReservationId) {
      try {
        const reservation = new Parse.Object('Reservation');
        reservation.id = testReservationId;
        await reservation.destroy({ useMasterKey: true });
      } catch (error) {
        // Reservation might already be gone
      }
    }
  });

  describe('POST /api/reservations/:id/payments', () => {
    it('rejects a paidAt before 1900', async () => {
      const response = await request(app)
        .post(`/api/reservations/${testReservationId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 100, currency: 'MXN', method: 'efectivo', paidAt: '1850-01-01',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('1900');
    });

    it('rejects an unparsable paidAt string', async () => {
      const response = await request(app)
        .post(`/api/reservations/${testReservationId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 100, currency: 'MXN', method: 'efectivo', paidAt: 'not-a-date',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('rejects a paidAt more than 20 years in the future', async () => {
      const response = await request(app)
        .post(`/api/reservations/${testReservationId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 100, currency: 'MXN', method: 'efectivo', paidAt: isoYearsFromNow(21),
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('lejana');
    });

    it('accepts a paidAt exactly 1 year in the future and persists it', async () => {
      const futureDate = isoYearsFromNow(1);
      const response = await request(app)
        .post(`/api/reservations/${testReservationId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 500, currency: 'MXN', method: 'efectivo', paidAt: futureDate,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      const { payment } = response.body.data;
      createdPaymentIds.push(payment.id);
      expect(new Date(payment.paidAt).toISOString().slice(0, 10)).toBe(futureDate);

      const stored = new Parse.Object('Payment');
      stored.id = payment.id;
      await stored.fetch({ useMasterKey: true });
      expect(stored.get('paidAt').toISOString().slice(0, 10)).toBe(futureDate);
    });

    it('defaults paidAt to now when omitted', async () => {
      const before = Date.now();
      const response = await request(app)
        .post(`/api/reservations/${testReservationId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 250, currency: 'MXN', method: 'tarjeta' });
      const after = Date.now();

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      const { payment } = response.body.data;
      createdPaymentIds.push(payment.id);

      const paidAtMs = new Date(payment.paidAt).getTime();
      expect(paidAtMs).toBeGreaterThanOrEqual(before - 1000);
      expect(paidAtMs).toBeLessThanOrEqual(after + 1000);
    });
  });

  describe('PUT /api/reservations/:id/payments/:paymentId', () => {
    let editablePaymentId;

    beforeAll(async () => {
      const response = await request(app)
        .post(`/api/reservations/${testReservationId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 300, currency: 'MXN', method: 'transferencia' });
      editablePaymentId = response.body.data.payment.id;
      createdPaymentIds.push(editablePaymentId);
    });

    it('rejects a paidAt before 1900', async () => {
      const response = await request(app)
        .put(`/api/reservations/${testReservationId}/payments/${editablePaymentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ paidAt: '1850-01-01' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('skips date validation when paidAt is omitted from the body', async () => {
      // Put the payment's stored paidAt in a state that WOULD fail validation, then confirm a PUT
      // that doesn't touch paidAt succeeds and leaves it untouched.
      const stored = new Parse.Object('Payment');
      stored.id = editablePaymentId;
      await stored.fetch({ useMasterKey: true });
      const priorPaidAt = stored.get('paidAt');

      const response = await request(app)
        .put(`/api/reservations/${testReservationId}/payments/${editablePaymentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'updated' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.payment.paidAt).toBe(priorPaidAt.toISOString());
    });

    it('accepts a valid future paidAt (+2 years)', async () => {
      const futureDate = isoYearsFromNow(2);
      const response = await request(app)
        .put(`/api/reservations/${testReservationId}/payments/${editablePaymentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ paidAt: futureDate });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(new Date(response.body.data.payment.paidAt).toISOString().slice(0, 10)).toBe(futureDate);
    });
  });
});
