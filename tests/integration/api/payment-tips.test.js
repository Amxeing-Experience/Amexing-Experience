/**
 * Payment tip aggregation — integration tests (Fase 1).
 *
 * End-to-end over the real addPayment/updatePayment/deletePayment flow with Parse +
 * mongodb-memory-server: the tip total is aggregated from the real Payment.tip records (not the
 * dead Reservation.tip field), a 100%-tip payment leaves no phantom balance, tips are grouped by
 * service (tipByService), USD tips convert with the payment's snapshot rate (including an
 * edit-only-tip edit), efectivo cash-rounding never touches the tip, the Fase 0 reconciliation
 * math ignores tips entirely, and the relaxed validation allows tip-only payments while rejecting
 * empty ones. RBAC (nivel 4+) is preserved for tip-bearing payments.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

const RECON_SOURCE = 'payment-method-reconciliation';

describe('Payment tip aggregation (integration)', () => {
  let app;
  let adminToken;
  let agencyToken; // department_manager = level 4
  let employeeToken; // employee = level 3 (below payments threshold)

  // Clean pricesByType (base × 1.16 / × 1.21): T(efectivo)=10000, T(transferencia)=11600, T(tarjeta)=12100.
  const CLEAN = [{ pricesByType: { efectivo: 10000, transferencia: 11600, tarjeta: 12100 } }];

  const createReservation = async (services, paymentType, opts = {}) => {
    const reservation = new Parse.Object('Reservation');
    reservation.set('active', true);
    reservation.set('exists', true);
    reservation.set('status', 'confirmed');
    reservation.set('paymentType', paymentType);
    reservation.set('currency', opts.currency || 'MXN');
    // Legacy dead field: nothing should read this as the tip source anymore.
    if (opts.legacyTip !== undefined) reservation.set('tip', opts.legacyTip);
    await reservation.save(null, { useMasterKey: true });

    const serviceIds = await Promise.all(services.map(async (svc) => {
      const rs = new Parse.Object('ReservationService');
      rs.set('active', true);
      rs.set('exists', svc.exists !== undefined ? svc.exists : true);
      rs.set('reservationPtr', reservation);
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

  const fetchReservation = async (id) => new Parse.Query('Reservation').get(id, { useMasterKey: true });
  const reconAdjustments = (reservation) => (reservation.get('adjustments') || [])
    .filter((a) => a && a.source === RECON_SOURCE);
  const bucketFor = (summary, serviceId) => (summary.tipByService || [])
    .find((b) => b.reservationServiceId === serviceId);

  const postPayment = (reservationId, body, token = adminToken) => request(app)
    .post(`/api/reservations/${reservationId}/payments`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  const putPayment = (reservationId, paymentId, body, token = adminToken) => request(app)
    .put(`/api/reservations/${reservationId}/payments/${paymentId}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  const deletePayment = (reservationId, paymentId, token = adminToken) => request(app)
    .delete(`/api/reservations/${reservationId}/payments/${paymentId}`)
    .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    adminToken = await AuthTestHelper.loginAs('admin', app);
    agencyToken = await AuthTestHelper.loginAs('department_manager', app);
    employeeToken = await AuthTestHelper.loginAs('employee', app);
  }, 30000);

  describe('fix crítico — pago 100% propina no deja saldo fantasma', () => {
    it('servicios $0, un pago { amount: 0, tip: 100 } queda paid con balance 0', async () => {
      const { id } = await createReservation([], 'efectivo');

      const res = await postPayment(id, { amount: 0, tip: 100, method: 'efectivo' });
      expect(res.status).toBe(200);
      const { summary } = res.body.data;
      expect(summary.paymentStatus).toBe('paid');
      expect(summary.balance).toBe(0); // <-- sin saldo fantasma igual a la propina
      expect(summary.tip).toBe(100);
      expect(summary.tipByService).toEqual([{ reservationServiceId: null, tip: 100 }]);
    });
  });

  describe('pago solo-propina (amount 0) NO re-ancla el paymentType de la reservación', () => {
    it('primer pago tip-only con método distinto deja paymentType intacto y agrega la propina', async () => {
      // Reservación con servicios reales (base > 0) cotizada en efectivo. Sin el fix, el primer pago
      // tip-only en tarjeta (amount 0) re-anclaría paymentType a tarjeta, recotizando todo a otro tier.
      const { id } = await createReservation(CLEAN, 'efectivo');

      const res = await postPayment(id, { amount: 0, tip: 50, method: 'tarjeta' });
      expect(res.status).toBe(200);
      const { summary } = res.body.data;
      expect(summary.tip).toBe(50); // la propina sí se agrega
      expect(summary.balance).toBe(10000); // servicios (efectivo) sin pagar; la propina es neutral

      const reservation = await fetchReservation(id);
      expect(reservation.get('paymentType')).toBe('efectivo'); // <-- SIN cambiar: no re-anclado por $0 de servicios
      expect(reconAdjustments(reservation)).toHaveLength(0); // ningún ajuste espurio
    });

    it('primer pago tip-only con el MISMO método que el ancla también deja paymentType intacto (no-op)', async () => {
      const { id } = await createReservation(CLEAN, 'efectivo');

      const res = await postPayment(id, { amount: 0, tip: 50, method: 'efectivo' });
      expect(res.status).toBe(200);
      expect(res.body.data.summary.tip).toBe(50);

      const reservation = await fetchReservation(id);
      expect(reservation.get('paymentType')).toBe('efectivo'); // nada que actualizar en cualquier caso
      expect(reconAdjustments(reservation)).toHaveLength(0);
    });
  });

  describe('fuente de verdad — Reservation.tip (campo muerto) se ignora', () => {
    it('un Reservation.tip legacy = 999 no afecta el agregado; la propina viene de Payment.tip', async () => {
      const { id } = await createReservation([{ total: 400 }], 'efectivo', { legacyTip: 999 });

      const res = await postPayment(id, { amount: 400, tip: 0, method: 'efectivo' });
      expect(res.status).toBe(200);
      const { summary } = res.body.data;
      expect(summary.tip).toBe(0); // NO 999
      expect(summary.balance).toBe(0);
      expect(summary.paymentStatus).toBe('paid');
    });
  });

  describe('pago 0% propina se comporta igual que hoy', () => {
    it('un pago sin campo tip agrega tip 0 y salda los servicios', async () => {
      const { id } = await createReservation([{ total: 500 }], 'efectivo');

      const res = await postPayment(id, { amount: 500, method: 'efectivo' });
      expect(res.status).toBe(200);
      expect(res.body.data.summary.tip).toBe(0);
      expect(res.body.data.summary.balance).toBe(0);
      expect(res.body.data.summary.tipByService).toEqual([]);
    });
  });

  describe('agregación a través de varios pagos', () => {
    it('suma las propinas de todos los pagos existentes', async () => {
      const { id } = await createReservation([{ total: 1000 }], 'efectivo');

      await postPayment(id, { amount: 400, tip: 50, method: 'efectivo' });
      const res = await postPayment(id, { amount: 600, tip: 30, method: 'efectivo' });
      expect(res.status).toBe(200);
      expect(res.body.data.summary.tip).toBe(80); // 50 + 30
      expect(res.body.data.summary.balance).toBe(0); // servicios 1000 saldados
    });
  });

  describe('soft-delete de un pago con propina', () => {
    it('resta la propina del agregado, no solo del balance de servicios', async () => {
      const { id } = await createReservation([{ total: 1000 }], 'efectivo');

      await postPayment(id, { amount: 1000, tip: 200, method: 'efectivo' });
      const tipOnly = await postPayment(id, { amount: 0, tip: 100, method: 'efectivo' });
      expect(tipOnly.body.data.summary.tip).toBe(300);

      const del = await deletePayment(id, tipOnly.body.data.payment.id);
      expect(del.status).toBe(200);
      expect(del.body.data.summary.tip).toBe(200); // 300 − 100
      expect(del.body.data.summary.balance).toBe(0); // servicios siguen saldados por el primer pago
    });
  });

  describe('editar SOLO la propina de un pago', () => {
    it('recalcula el agregado sin tocar el monto de servicios', async () => {
      const { id } = await createReservation([{ total: 1000 }], 'efectivo');

      const p = await postPayment(id, { amount: 1000, tip: 50, method: 'efectivo' });
      const paymentId = p.body.data.payment.id;
      expect(p.body.data.summary.tip).toBe(50);

      const upd = await putPayment(id, paymentId, { tip: 100 });
      expect(upd.status).toBe(200);
      expect(upd.body.data.payment.amount).toBe(1000); // monto de servicios intacto
      expect(upd.body.data.payment.tip).toBe(100);
      expect(upd.body.data.summary.tip).toBe(100);
      expect(upd.body.data.summary.balance).toBe(0);
    });
  });

  describe('propina por concepto — mover el tip entre servicios (reservationServiceId)', () => {
    it('cambia el bucket de tipByService del servicio viejo al nuevo, sin duplicar ni perder el monto', async () => {
      const { id, serviceIds } = await createReservation([{ total: 500 }, { total: 500 }], 'efectivo');
      const [svcA, svcB] = serviceIds;

      const p = await postPayment(id, {
        amount: 0, tip: 80, reservationServiceId: svcA, method: 'efectivo',
      });
      expect(bucketFor(p.body.data.summary, svcA)).toEqual({ reservationServiceId: svcA, tip: 80 });

      const upd = await putPayment(id, p.body.data.payment.id, { reservationServiceId: svcB });
      expect(upd.status).toBe(200);
      const { summary } = upd.body.data;
      expect(bucketFor(summary, svcA)).toBeUndefined(); // el bucket viejo desaparece
      expect(bucketFor(summary, svcB)).toEqual({ reservationServiceId: svcB, tip: 80 });
      expect(summary.tip).toBe(80); // el total no cambió
    });

    it('un pago solo-propina ligado a un servicio se guarda y cae en el bucket del servicio', async () => {
      const { id, serviceIds } = await createReservation([{ total: 1000 }], 'efectivo');
      const [svcA] = serviceIds;

      const res = await postPayment(id, {
        amount: 0, tip: 75, reservationServiceId: svcA, method: 'efectivo',
      });
      expect(res.status).toBe(200);
      const { summary } = res.body.data;
      expect(summary.tip).toBe(75);
      expect(bucketFor(summary, svcA)).toEqual({ reservationServiceId: svcA, tip: 75 });
      expect(summary.balance).toBe(1000); // los servicios NO se pagaron (amount 0)
    });
  });

  describe('conversión de moneda — la propina en USD se convierte igual que el monto', () => {
    it('convierte tip con la MISMA tasa que el monto, y una edición solo-de-propina reusa esa tasa snapshot', async () => {
      const { id } = await createReservation([{ total: 5000 }], 'efectivo');

      const create = await postPayment(id, {
        amount: 100, tip: 10, currency: 'USD', method: 'efectivo',
      });
      expect(create.status).toBe(200);
      const pay = create.body.data.payment;
      const rate = pay.exchangeRate;
      expect(pay.origCurrency).toBe('USD');
      expect(rate).toBeGreaterThan(1);
      expect(pay.amount).toBeCloseTo(Math.round(100 * rate * 100) / 100, 2);
      expect(pay.tip).toBeCloseTo(Math.round(10 * rate * 100) / 100, 2); // convertida, no cruda

      // Editar SOLO la propina: debe reusar la tasa ya snapshotteada en el pago, nunca una tasa fresca.
      const upd = await putPayment(id, pay.id, { tip: 20 });
      expect(upd.status).toBe(200);
      const pay2 = upd.body.data.payment;
      expect(pay2.exchangeRate).toBe(rate); // misma tasa
      expect(pay2.tip).toBeCloseTo(Math.round(20 * rate * 100) / 100, 2);
      expect(pay2.amount).toBe(pay.amount); // el monto de servicios no se toca
    });
  });

  describe('el redondeo a múltiplo de 5 del efectivo NO se aplica a la propina', () => {
    it('la propina con centavos se guarda exacta aunque el método sea efectivo', async () => {
      const { id } = await createReservation([{ pricesByType: { efectivo: 100 } }], 'efectivo');

      const res = await postPayment(id, { amount: 100, tip: 3.33, method: 'efectivo' });
      expect(res.status).toBe(200);
      expect(res.body.data.payment.tip).toBe(3.33); // ni 0 ni 5
      expect(res.body.data.summary.tip).toBe(3.33);
      expect(res.body.data.summary.balance).toBe(0);
    });
  });

  describe('interacción con Fase 0 — la propina NUNCA entra en la matemática de reconciliación', () => {
    it('un cruce de tier con propinas grandes crea el MISMO ajuste $400 (ignora los tips) y balance 0', async () => {
      const { id } = await createReservation(CLEAN, 'transferencia');

      await postPayment(id, { amount: 2320, tip: 500, method: 'transferencia' });
      const res = await postPayment(id, { amount: 9680, tip: 700, method: 'tarjeta' });
      expect(res.status).toBe(200);
      const { summary } = res.body.data;
      expect(summary.tip).toBe(1200); // 500 + 700 agregadas aparte
      expect(summary.balance).toBe(0);
      expect(summary.paymentStatus).toBe('paid');

      const reservation = await fetchReservation(id);
      const recon = reconAdjustments(reservation);
      expect(recon).toHaveLength(1);
      expect(recon[0].amount).toBe(400); // 400 exacto — las propinas (1200) NO lo alteran
      expect(recon[0].type).toBe('charge');
    });
  });

  describe('validación — rechazos de reservationServiceId inválido', () => {
    it('rechaza (404) un reservationServiceId de OTRA reservación', async () => {
      const a = await createReservation([{ total: 100 }], 'efectivo');
      const b = await createReservation([{ total: 100 }], 'efectivo');

      const res = await postPayment(a.id, {
        amount: 0, tip: 50, reservationServiceId: b.serviceIds[0], method: 'efectivo',
      });
      expect(res.status).toBe(404);
    });

    it('rechaza (404) un reservationServiceId soft-deleted', async () => {
      const { id, serviceIds } = await createReservation(
        [{ total: 100, exists: false }],
        'efectivo'
      );

      const res = await postPayment(id, {
        amount: 0, tip: 50, reservationServiceId: serviceIds[0], method: 'efectivo',
      });
      expect(res.status).toBe(404);
    });

    it('rechaza (400) un pago completamente vacío (amount 0, tip 0)', async () => {
      const { id } = await createReservation([{ total: 100 }], 'efectivo');

      const res = await postPayment(id, { amount: 0, tip: 0, method: 'efectivo' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('RBAC — pagos con propina respetan nivel 4+', () => {
    it('una agencia (department_manager, nivel 4) registra un pago solo-propina', async () => {
      const { id } = await createReservation([{ total: 1000 }], 'efectivo');

      const res = await postPayment(id, { amount: 0, tip: 100, method: 'efectivo' }, agencyToken);
      expect(res.status).toBe(200);
      expect(res.body.data.summary.tip).toBe(100);
    });

    it('un employee (nivel 3) NO puede registrar un pago solo-propina (403)', async () => {
      const { id } = await createReservation([{ total: 1000 }], 'efectivo');

      const res = await postPayment(id, { amount: 0, tip: 100, method: 'efectivo' }, employeeToken);
      expect(res.status).toBe(403);
    });
  });

  // Huecos backend que el formulario Fase 4 ejercitará (reservationServiceId y tip SIEMPRE explícitos):
  // el guard `!== undefined` de updatePayment/applyServicePointer solo actúa si la clave viaja en el body.
  describe('Fase 4 — reservationServiceId / tip explícitos (nunca omitidos)', () => {
    it('editar de servicio específico a "general" (reservationServiceId: "") limpia el bucket viejo', async () => {
      const { id, serviceIds } = await createReservation([{ total: 500 }, { total: 500 }], 'efectivo');
      const [svcA] = serviceIds;

      const p = await postPayment(id, {
        amount: 0, tip: 80, reservationServiceId: svcA, method: 'efectivo',
      });
      expect(bucketFor(p.body.data.summary, svcA)).toEqual({ reservationServiceId: svcA, tip: 80 });

      const upd = await putPayment(id, p.body.data.payment.id, { reservationServiceId: '' });
      expect(upd.status).toBe(200);
      const { summary } = upd.body.data;
      expect(bucketFor(summary, svcA)).toBeUndefined(); // bucket del servicio limpiado
      expect(bucketFor(summary, null)).toEqual({ reservationServiceId: null, tip: 80 }); // ahora en general
      expect(summary.tip).toBe(80);
      expect(upd.body.data.payment.reservationServiceId).toBeNull();
    });

    it('editar de "general" a un servicio específico mueve el tip al bucket del servicio', async () => {
      const { id, serviceIds } = await createReservation([{ total: 500 }], 'efectivo');
      const [svcA] = serviceIds;

      const p = await postPayment(id, { amount: 0, tip: 60, method: 'efectivo' }); // general
      expect(bucketFor(p.body.data.summary, null)).toEqual({ reservationServiceId: null, tip: 60 });

      const upd = await putPayment(id, p.body.data.payment.id, { reservationServiceId: svcA });
      expect(upd.status).toBe(200);
      const { summary } = upd.body.data;
      expect(bucketFor(summary, null)).toBeUndefined();
      expect(bucketFor(summary, svcA)).toEqual({ reservationServiceId: svcA, tip: 60 });
    });

    it('un PUT que OMITE reservationServiceId preserva el pointer existente (guard !== undefined)', async () => {
      const { id, serviceIds } = await createReservation([{ total: 500 }, { total: 500 }], 'efectivo');
      const [svcA] = serviceIds;

      const p = await postPayment(id, {
        amount: 0, tip: 40, reservationServiceId: svcA, method: 'efectivo',
      });

      // Editar SOLO las notas: sin la clave reservationServiceId, el pointer NO se toca.
      const upd = await putPayment(id, p.body.data.payment.id, { notes: 'sin tocar el servicio' });
      expect(upd.status).toBe(200);
      expect(upd.body.data.payment.reservationServiceId).toBe(svcA); // intacto
      expect(bucketFor(upd.body.data.summary, svcA)).toEqual({ reservationServiceId: svcA, tip: 40 });
    });

    it('round-trip servicio -> general -> mismo servicio no deja residuos ni duplica el monto', async () => {
      const { id, serviceIds } = await createReservation([{ total: 500 }, { total: 500 }], 'efectivo');
      const [svcA] = serviceIds;

      const p = await postPayment(id, {
        amount: 0, tip: 90, reservationServiceId: svcA, method: 'efectivo',
      });
      const pid = p.body.data.payment.id;

      await putPayment(id, pid, { reservationServiceId: '' }); // -> general
      const back = await putPayment(id, pid, { reservationServiceId: svcA }); // -> mismo servicio
      expect(back.status).toBe(200);
      const { summary } = back.body.data;
      expect(summary.tip).toBe(90); // sin duplicar
      expect(bucketFor(summary, svcA)).toEqual({ reservationServiceId: svcA, tip: 90 });
      expect(bucketFor(summary, null)).toBeUndefined(); // sin residuo en general
    });

    it('bajar la propina a 0 explícito (tip: 0) SÍ limpia el valor viejo en DB (fix del bug colateral)', async () => {
      const { id } = await createReservation([{ total: 1000 }], 'efectivo');

      const p = await postPayment(id, { amount: 1000, tip: 150, method: 'efectivo' });
      expect(p.body.data.summary.tip).toBe(150);

      // El formulario Fase 4 manda tip: 0 explícito (nunca omite la clave); el guard tip !== undefined lo limpia.
      const upd = await putPayment(id, p.body.data.payment.id, { tip: 0 });
      expect(upd.status).toBe(200);
      expect(upd.body.data.payment.tip).toBe(0); // el 150 viejo se limpió, no quedó huérfano
      expect(upd.body.data.summary.tip).toBe(0);
      expect(upd.body.data.summary.balance).toBe(0); // servicios siguen saldados
    });
  });
});
