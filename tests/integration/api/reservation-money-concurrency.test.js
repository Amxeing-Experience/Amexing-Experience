/**
 * Serialización de escrituras de dinero por reservación — integration (mongodb-memory-server real).
 *
 * Antes, PaymentService.recalculate y ReservationController.addAdjustment/removeAdjustment hacían
 * read-compute-write sin lock: dos operaciones casi simultáneas sobre la MISMA reservación podían
 * interleavear y la última en guardar pisaba a la otra (lost update). withReservationLock encola las
 * operaciones por reservationId; distintas reservaciones no se bloquean entre sí.
 *
 * Casos: (1) dos recalculate en paralelo sobre la misma reservación => paidAmount final = suma de TODOS
 * los pagos; (2) dos addAdjustment concurrentes => AMBOS ajustes sobreviven y totalAmount los netea;
 * (3) operaciones sobre reservaciones distintas completan sin bloquearse; (4) removeAdjustment sigue OK.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');
const PaymentService = require('../../../src/application/services/PaymentService');

describe('Reservation money-write serialization (integration)', () => {
  let app;
  let adminToken;

  // Precio "limpio" base × 1.16 / × 1.21: efectivo=10000, transferencia=11600, tarjeta=12100.
  const CLEAN = [{ pricesByType: { efectivo: 10000, transferencia: 11600, tarjeta: 12100 } }];

  const createReservation = async (services, paymentType, { servicesSubtotal } = {}) => {
    const reservation = new Parse.Object('Reservation');
    reservation.set('active', true);
    reservation.set('exists', true);
    reservation.set('status', 'confirmed');
    reservation.set('paymentType', paymentType);
    reservation.set('currency', 'MXN');
    if (servicesSubtotal !== undefined) reservation.set('servicesSubtotal', servicesSubtotal);
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

  const createPayment = async (reservationId, amount, method) => {
    const reservationPtr = new Parse.Object('Reservation');
    reservationPtr.id = reservationId;
    const payment = new Parse.Object('Payment');
    payment.set('exists', true);
    payment.set('active', true);
    payment.set('reservationPtr', reservationPtr);
    payment.set('amount', amount);
    payment.set('origAmount', amount);
    payment.set('origCurrency', 'MXN');
    payment.set('method', method);
    payment.set('paidAt', new Date());
    await payment.save(null, { useMasterKey: true });
    return payment.id;
  };

  const fetchReservation = (id) => new Parse.Query('Reservation').get(id, { useMasterKey: true });
  const adjustmentsOf = (reservation) => reservation.get('adjustments') || [];

  const postAdjustment = (id, body, token = adminToken) => request(app)
    .post(`/api/reservations/${id}/adjustments`).set('Authorization', `Bearer ${token}`).send(body);
  const delAdjustment = (id, adjustmentId, token = adminToken) => request(app)
    .delete(`/api/reservations/${id}/adjustments/${adjustmentId}`).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    adminToken = await AuthTestHelper.loginAs('admin', app);
  }, 30000);

  describe('PaymentService.recalculate concurrente sobre la MISMA reservación', () => {
    it('dos recalculate en paralelo => paidAmount final = suma de TODOS los pagos existentes', async () => {
      const id = await createReservation(CLEAN, 'efectivo'); // total efectivo = 10000

      // Dos pagos reales creados ANTES de disparar los recálculos en paralelo.
      await createPayment(id, 3000, 'efectivo');
      await createPayment(id, 4000, 'efectivo');

      const [s1, s2] = await Promise.all([
        PaymentService.recalculate(id),
        PaymentService.recalculate(id),
      ]);

      // Ambos recálculos ven los 2 pagos (7000) y coinciden; ninguno pierde un pago.
      expect(s1.paidAmount).toBe(7000);
      expect(s2.paidAmount).toBe(7000);
      expect(s1.paymentStatus).toBe('partial'); // 7000 de 10000

      const reservation = await fetchReservation(id);
      expect(reservation.get('paidAmount')).toBe(7000);
      expect(reservation.get('balance')).toBe(3000); // 10000 - 7000
    });
  });

  describe('addAdjustment concurrente sobre la MISMA reservación', () => {
    it('dos ajustes casi simultáneos => AMBOS sobreviven y totalAmount los netea (ninguno se pierde)', async () => {
      const id = await createReservation(CLEAN, 'efectivo', { servicesSubtotal: 10000 });

      const [r1, r2] = await Promise.all([
        postAdjustment(id, { type: 'charge', description: 'Cargo A', amount: 500 }),
        postAdjustment(id, { type: 'charge', description: 'Cargo B', amount: 300 }),
      ]);

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);

      const reservation = await fetchReservation(id);
      const adjustments = adjustmentsOf(reservation);
      expect(adjustments).toHaveLength(2); // sin lock, uno se perdería por last-write-wins
      expect(adjustments.map((a) => a.description).sort()).toEqual(['Cargo A', 'Cargo B']);
      // servicesSubtotal 10000 + 500 + 300 = 10800.
      expect(reservation.get('totalAmount')).toBe(10800);
    });

    it('un descuento y un cargo concurrentes se netean ambos', async () => {
      const id = await createReservation(CLEAN, 'efectivo', { servicesSubtotal: 10000 });

      const [r1, r2] = await Promise.all([
        postAdjustment(id, { type: 'charge', description: 'Extra', amount: 1000 }),
        postAdjustment(id, { type: 'discount', description: 'Cortesia', amount: 400 }),
      ]);

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);

      const reservation = await fetchReservation(id);
      expect(adjustmentsOf(reservation)).toHaveLength(2);
      // 10000 + 1000 - 400 = 10600.
      expect(reservation.get('totalAmount')).toBe(10600);
    });
  });

  describe('reservaciones DISTINTAS no se bloquean entre sí', () => {
    it('un ajuste en cada reservación, en paralelo, completa correctamente', async () => {
      const [idA, idB] = await Promise.all([
        createReservation(CLEAN, 'efectivo', { servicesSubtotal: 10000 }),
        createReservation(CLEAN, 'efectivo', { servicesSubtotal: 20000 }),
      ]);

      const [rA, rB] = await Promise.all([
        postAdjustment(idA, { type: 'charge', description: 'Solo A', amount: 100 }),
        postAdjustment(idB, { type: 'charge', description: 'Solo B', amount: 200 }),
      ]);

      expect(rA.status).toBe(200);
      expect(rB.status).toBe(200);

      const [resA, resB] = await Promise.all([fetchReservation(idA), fetchReservation(idB)]);
      expect(adjustmentsOf(resA)).toHaveLength(1);
      expect(adjustmentsOf(resB)).toHaveLength(1);
      expect(resA.get('totalAmount')).toBe(10100); // 10000 + 100
      expect(resB.get('totalAmount')).toBe(20200); // 20000 + 200
    });
  });

  describe('removeAdjustment sigue funcionando tras el refactor', () => {
    it('agregar y luego eliminar un ajuste deja el array vacío y el total en el subtotal de servicios', async () => {
      const id = await createReservation(CLEAN, 'efectivo', { servicesSubtotal: 10000 });

      const added = await postAdjustment(id, { type: 'charge', description: 'Temporal', amount: 750 });
      expect(added.status).toBe(200);
      const adjustmentId = added.body.data.adjustment.id;

      const removed = await delAdjustment(id, adjustmentId);
      expect(removed.status).toBe(200);
      expect(removed.body.data.adjustments).toHaveLength(0);

      const reservation = await fetchReservation(id);
      expect(adjustmentsOf(reservation)).toHaveLength(0);
      expect(reservation.get('totalAmount')).toBe(10000); // vuelve al subtotal de servicios
    });

    it('404 al eliminar un ajuste inexistente (el lock no altera el manejo de errores)', async () => {
      const id = await createReservation(CLEAN, 'efectivo', { servicesSubtotal: 10000 });
      const res = await delAdjustment(id, 'adj_inexistente');
      expect(res.status).toBe(404);
    });
  });
});
