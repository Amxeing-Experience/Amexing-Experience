/**
 * Public reservation breakdown — integration tests.
 *
 * Hits GET /reservations/:folio (public, no session) over the real app + Parse +
 * mongodb-memory-server, asserting the rendered HTML for: the corrected roleName-based
 * isAgency resolution (agency via role WITHOUT clientCategory, clientCategory-set-but-role-
 * different OR condition, end_client without roleId not crashing, missing/broken clientPtr
 * defaulting to false), the summarize()-throws architecture (framing/adjustment rows still
 * render while paid/balance/status fall back to raw reservation fields), the efectivo
 * cash-rounding NOT falsely opening the IVA row, USD currency, and the itinerary route
 * (out of scope for payment info) still rendering 200 with no regression.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');
const PaymentService = require('../../../src/application/services/PaymentService');

describe('Public reservation payment breakdown (integration)', () => {
  let app;
  let adminToken;

  const createdReservationIds = [];
  const createdServiceIds = [];
  const createdUserIds = [];
  const createdPaymentIds = [];
  let folioSeq = 100;

  // Clean pricesByType (base × 1.16 / × 1.21).
  const CLEAN = [{ pricesByType: { efectivo: 10000, transferencia: 11600, tarjeta: 12100 } }];

  const makeUser = async (fields = {}) => {
    const u = new Parse.Object('AmexingUser');
    const email = `pubresv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    u.set('exists', true);
    u.set('active', true);
    u.set('email', email);
    u.set('username', email);
    u.set('firstName', 'Test');
    u.set('lastName', 'Owner');
    Object.entries(fields).forEach(([k, v]) => u.set(k, v));
    await u.save(null, { useMasterKey: true });
    createdUserIds.push(u.id);
    return u;
  };

  const makeReservation = async ({
    services = [], paymentType = 'efectivo', currency = 'MXN', clientPtr = null, raw = {},
  } = {}) => {
    folioSeq += 1;
    const folio = `TST-2607-${String(folioSeq).padStart(3, '0')}`;
    const r = new Parse.Object('Reservation');
    r.set('exists', true);
    r.set('active', true);
    r.set('status', 'confirmed');
    r.set('folio', folio);
    r.set('paymentType', paymentType);
    r.set('currency', currency);
    if (clientPtr) r.set('clientPtr', clientPtr);
    Object.entries(raw).forEach(([k, v]) => r.set(k, v));
    await r.save(null, { useMasterKey: true });
    createdReservationIds.push(r.id);

    await Promise.all(services.map(async (svc) => {
      const rs = new Parse.Object('ReservationService');
      rs.set('exists', true);
      rs.set('active', true);
      rs.set('reservationPtr', r);
      rs.set('subconcept', {
        type: 'transport',
        includeInTotal: true,
        pricesByType: svc.pricesByType || null,
        total: svc.total !== undefined ? svc.total : 0,
      });
      await rs.save(null, { useMasterKey: true });
      createdServiceIds.push(rs.id);
    }));
    return { id: r.id, folio, reservation: r };
  };

  const getPublic = (folio) => request(app).get(`/reservations/${folio}`);
  // The payment section is everything after the "Resumen de pago" title.
  const paySection = (html) => html.split('Resumen de pago')[1] || '';

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    adminToken = await AuthTestHelper.loginAs('admin', app);
  }, 30000);

  afterAll(async () => {
    const destroyAll = async (ClassName, ids) => Promise.all(ids.map(async (id) => {
      try {
        const o = new Parse.Object(ClassName);
        o.id = id;
        await o.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }));
    await destroyAll('Payment', createdPaymentIds);
    await destroyAll('ReservationService', createdServiceIds);
    await destroyAll('Reservation', createdReservationIds);
    await destroyAll('AmexingUser', createdUserIds);
  });

  describe('isAgency resolution from the owning clientPtr (role string, no Role fetch)', () => {
    it('agency via role department_manager WITHOUT clientCategory => agency framing (IVA), never "descuento"', async () => {
      const agency = await makeUser({ role: 'department_manager' }); // real-shaped: role set, clientCategory absent
      const { folio } = await makeReservation({ services: CLEAN, paymentType: 'tarjeta', clientPtr: agency });

      const res = await getPublic(folio);
      expect(res.status).toBe(200);
      const s = paySection(res.text);
      expect(s).toContain('IVA + comisión de tarjeta');
      expect(/descuento/i.test(res.text)).toBe(false);
    });

    it('clientCategory === "agency" set but role different => still agency framing (OR condition)', async () => {
      const user = await makeUser({ role: 'end_client', clientCategory: 'agency' });
      const { folio } = await makeReservation({ services: CLEAN, paymentType: 'tarjeta', clientPtr: user });

      const res = await getPublic(folio);
      expect(res.status).toBe(200);
      expect(paySection(res.text)).toContain('IVA + comisión de tarjeta');
    });

    it('end_client WITHOUT roleId does not crash => cliente-directo framing (200)', async () => {
      const endClient = await makeUser({ role: 'end_client' }); // no roleId at all
      const { folio } = await makeReservation({ services: CLEAN, paymentType: 'efectivo', clientPtr: endClient });

      const res = await getPublic(folio);
      expect(res.status).toBe(200);
      expect(paySection(res.text)).toContain('Descuento pago efectivo');
    });

    it('missing clientPtr => defaults to false (cliente-directo framing, 200)', async () => {
      const { folio } = await makeReservation({ services: CLEAN, paymentType: 'efectivo', clientPtr: null });

      const res = await getPublic(folio);
      expect(res.status).toBe(200);
      expect(paySection(res.text)).toContain('Descuento pago efectivo');
    });

    it('broken clientPtr (points to a deleted user) => no crash, defaults to false (200)', async () => {
      const ghost = await makeUser({ role: 'department_manager' });
      const ghostId = ghost.id;
      await ghost.destroy({ useMasterKey: true });
      // Remove from cleanup list (already gone).
      const idx = createdUserIds.indexOf(ghostId);
      if (idx >= 0) createdUserIds.splice(idx, 1);

      const AmexingUser = Parse.Object.extend('AmexingUser');
      const brokenPtr = AmexingUser.createWithoutData(ghostId);
      const { folio } = await makeReservation({ services: CLEAN, paymentType: 'efectivo', clientPtr: brokenPtr });

      const res = await getPublic(folio);
      expect(res.status).toBe(200);
      // Falls back to cliente-directo framing without throwing.
      expect(paySection(res.text)).toContain('Descuento pago efectivo');
    });
  });

  describe('summarize() throws — degraded architecture', () => {
    it('framing/discount rows render, paid/balance fall back, y Total a pagar = balance + paidAmount', async () => {
      const { folio } = await makeReservation({
        services: CLEAN,
        paymentType: 'efectivo',
        clientPtr: null, // cliente directo
        raw: {
          paidAmount: 33, balance: 88, paymentStatus: 'partial',
        },
      });

      const spy = jest.spyOn(PaymentService, 'summarize').mockRejectedValue(new Error('forced summarize failure'));
      try {
        const res = await getPublic(folio);
        expect(res.status).toBe(200);
        const s = paySection(res.text);
        // Computed OUTSIDE the try/catch: the discount framing survives the failure.
        expect(s).toContain('Descuento pago efectivo');
        // Fell back to the raw reservation fields inside the catch.
        expect(/Pagado<\/span><span class="v">\$33/.test(s)).toBe(true);
        // Fix Fase 2: en el fallback el Total a pagar deriva de balance + paidAmount (88 + 33 = 121),
        // NUNCA del total de solo-servicios (CLEAN efectivo = 10000), que contradecía el desglose de
        // ajustes ya renderizado. Mismo patrón que ReservationController.getReservationById (Fase 3).
        expect(/Total a pagar<\/span><span class="v">\$121\b/.test(s)).toBe(true);
        expect(/Total a pagar<\/span><span class="v">\$10,000/.test(s)).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('efectivo cash rounding must NOT open the IVA row (end-to-end)', () => {
    it('agency + efectivo with a nonzero cash-rounding surcharge renders no IVA row', async () => {
      const agency = await makeUser({ role: 'department_manager' });
      // efectivo 102 -> cash rounding to 100 -> surcharge -2, but efectivo must never show IVA.
      const { folio } = await makeReservation({
        services: [{ pricesByType: { efectivo: 102, transferencia: 118.32, tarjeta: 123.42 }, total: 123.42 }],
        paymentType: 'efectivo',
        clientPtr: agency,
      });

      const res = await getPublic(folio);
      expect(res.status).toBe(200);
      expect(/\bIVA\b/.test(paySection(res.text))).toBe(false);
    });
  });

  describe('Currency and itinerary regression', () => {
    it('USD reservation renders 200 with USD-suffixed amounts', async () => {
      const { folio } = await makeReservation({
        services: [{ pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 }, total: 121 }],
        paymentType: 'tarjeta',
        currency: 'USD',
        clientPtr: null,
      });

      const res = await getPublic(folio);
      expect(res.status).toBe(200);
      expect(paySection(res.text)).toContain('USD');
    });

    it('itinerary route (out of scope for payment info) still renders 200 with no regression', async () => {
      const { folio } = await makeReservation({ services: CLEAN, paymentType: 'tarjeta', clientPtr: null });

      const res = await request(app).get(`/reservations/${folio}/itinerary`);
      expect(res.status).toBe(200);
    });
  });
});
