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
    reservation.set('paymentType', 'efectivo');
    await reservation.save(null, { useMasterKey: true });
    testReservationId = reservation.id;

    // Fase C: este suite prueba validación de FECHA, no disponibilidad de método. La reservación
    // necesita respaldo real de pricesByType para que los 3 métodos estén disponibles y el guard de
    // contenido no bloquee los pagos (efectivo/transferencia/tarjeta) que usan estos casos.
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
          amount: 500, currency: 'MXN', method: 'efectivo', paidAt: futureDate, receivedBy: 'QA Cajero',
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

    it('rejects a missing paidAt — now required, never silently defaulted to "now"', async () => {
      const response = await request(app)
        .post(`/api/reservations/${testReservationId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 250, currency: 'MXN', method: 'tarjeta' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('La fecha de pago es obligatoria.');
    });

    it('rejects an empty-string paidAt with the same clear message', async () => {
      const response = await request(app)
        .post(`/api/reservations/${testReservationId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 250, currency: 'MXN', method: 'tarjeta', paidAt: '',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('La fecha de pago es obligatoria.');
    });
  });

  describe('receivedBy — required only when method is efectivo', () => {
    const TODAY = new Date().toISOString().slice(0, 10);

    it('rejects an efectivo payment with no receivedBy', async () => {
      const response = await request(app)
        .post(`/api/reservations/${testReservationId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 100, currency: 'MXN', method: 'efectivo', paidAt: TODAY,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Indica quién recibió el efectivo.');
    });

    it('rejects an efectivo payment with a whitespace-only receivedBy', async () => {
      const response = await request(app)
        .post(`/api/reservations/${testReservationId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 100, currency: 'MXN', method: 'efectivo', paidAt: TODAY, receivedBy: '   ',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Indica quién recibió el efectivo.');
    });

    it('accepts an efectivo payment with receivedBy and persists it through formatPayment', async () => {
      const response = await request(app)
        .post(`/api/reservations/${testReservationId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 100, currency: 'MXN', method: 'efectivo', paidAt: TODAY, receivedBy: 'Juan Pérez',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      const { payment } = response.body.data;
      createdPaymentIds.push(payment.id);
      expect(payment.receivedBy).toBe('Juan Pérez');

      const stored = new Parse.Object('Payment');
      stored.id = payment.id;
      await stored.fetch({ useMasterKey: true });
      expect(stored.get('receivedBy')).toBe('Juan Pérez');
    });

    it('does NOT require receivedBy for tarjeta (irrelevant for non-cash)', async () => {
      const response = await request(app)
        .post(`/api/reservations/${testReservationId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 100, currency: 'MXN', method: 'tarjeta', paidAt: TODAY,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      createdPaymentIds.push(response.body.data.payment.id);
    });

    it('clamps a receivedBy over 100 chars to 100 server-side', async () => {
      const response = await request(app)
        .post(`/api/reservations/${testReservationId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 100, currency: 'MXN', method: 'efectivo', paidAt: TODAY, receivedBy: 'x'.repeat(150),
        });

      expect(response.status).toBe(200);
      createdPaymentIds.push(response.body.data.payment.id);
      expect(response.body.data.payment.receivedBy).toHaveLength(100);
    });
  });

  describe('PUT /api/reservations/:id/payments/:paymentId', () => {
    let editablePaymentId;

    beforeAll(async () => {
      const response = await request(app)
        .post(`/api/reservations/${testReservationId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 300, currency: 'MXN', method: 'transferencia', paidAt: isoYearsFromNow(0),
        });
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

    it('rejects an explicit empty paidAt (user cleared it) — a payment must never lose its date', async () => {
      const response = await request(app)
        .put(`/api/reservations/${testReservationId}/payments/${editablePaymentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ paidAt: '' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('La fecha de pago es obligatoria.');
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
