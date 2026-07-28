/**
 * POST /api/reservations/:id/pay/checkout — integration (Parse real + Memory DB, Stripe SDK mocked).
 *
 * The internal (staff) Checkout Session flow of PR4. Covers RBAC admin-only at level 6 (the inverted-
 * level trap: client=5 and department_manager=4 are BOTH rejected, plus a forged-admin-claim that the
 * DB-backed level overrides), the PAYMENTS_ENABLED master flag (off/wrong-case => 503), the pending
 * online Payment (created but out of the rollup, DTO free of PCI fields), belt-and-suspenders anti-
 * double-submit (concurrent + sequential reuse, expired-pending replacement), server-side amount (a
 * client-supplied amount/PAN is ignored and never persisted), and the toggle/router wiring (USD forces
 * Stripe; MXN+mexican falls back to Stripe). Zero network: the Stripe client is a mock.
 */

const request = require('supertest');
const Parse = require('parse/node');
const jwt = require('jsonwebtoken');
const AuthTestHelper = require('../../helpers/authTestHelper');
const stripeClient = require('../../../src/infrastructure/payments/stripeClient');
const { encodeGatewayId } = require('../../../src/application/services/payments/gatewayBootstrap');

const GATEWAY_KEY = 'activePaymentGateway';
const RATE_LIMIT_KEYS = ['::ffff:127.0.0.1', '127.0.0.1', '::1'];

// Clean tier prices base × 1.16 / × 1.21: efectivo=10000, transferencia=11600, tarjeta=12100.
const CLEAN = [{ pricesByType: { efectivo: 10000, transferencia: 11600, tarjeta: 12100 } }];
const CLEAN_USD = [{ pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 } }];

/**
 * Reset every express-rate-limit middleware in the app for the known test IPs (the reservation
 * write limiter caps at 200/15min; this suite plus siblings can exceed it). Test-only.
 * @param {object} expressApp - The Express app.
 */
function resetRateLimiters(expressApp) {
  const rootRouter = expressApp.router || expressApp._router;
  if (!rootRouter || !Array.isArray(rootRouter.stack)) return;
  const seen = new Set();
  const walk = (stack) => {
    for (const layer of stack) {
      if (!layer) continue;
      const handle = layer.handle;
      if (handle && !seen.has(handle)) {
        seen.add(handle);
        if (typeof handle.resetKey === 'function') {
          for (const key of RATE_LIMIT_KEYS) {
            try { handle.resetKey(key); } catch { /* key not in store yet */ }
          }
        }
        if (Array.isArray(handle.stack)) walk(handle.stack);
      }
      if (layer.route && Array.isArray(layer.route.stack)) walk(layer.route.stack);
    }
  };
  walk(rootRouter.stack);
}

describe('POST /api/reservations/:id/pay/checkout (integration)', () => {
  let app;
  let adminToken;
  let superadminToken;
  let managerToken; // department_manager = level 4
  let clientToken; // client = level 5 (below the level-6 guard)
  let employeeToken; // employee = level 3
  let stripeCreate;
  let sessionCounter = 0;
  const savedFlag = process.env.PAYMENTS_ENABLED;

  const postCheckout = (id, token = adminToken, body = {}) => request(app)
    .post(`/api/reservations/${id}/pay/checkout`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

  const getPayments = (id, token = adminToken) => request(app)
    .get(`/api/reservations/${id}/payments`).set('Authorization', `Bearer ${token}`);

  const reservationPtr = (id) => {
    const ptr = new Parse.Object('Reservation');
    ptr.id = id;
    return ptr;
  };

  const createReservation = async (services = CLEAN, paymentType = 'tarjeta', currency = 'MXN', opts = {}) => {
    const reservation = new Parse.Object('Reservation');
    reservation.set('active', true);
    reservation.set('exists', true);
    reservation.set('status', opts.status || 'confirmed');
    reservation.set('paymentType', paymentType);
    reservation.set('currency', currency);
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

  const createManualPayment = async (reservationId, amount, method) => {
    const p = new Parse.Object('Payment');
    p.set('reservationPtr', reservationPtr(reservationId));
    p.set('amount', amount);
    p.set('origAmount', amount);
    p.set('origCurrency', 'MXN');
    p.set('method', method);
    p.set('paidAt', new Date());
    p.set('active', true);
    p.set('exists', true);
    await p.save(null, { useMasterKey: true });
    return p.id;
  };

  const onlinePayments = async (reservationId, { includeDeleted = false } = {}) => {
    const q = new Parse.Query('Payment');
    q.equalTo('reservationPtr', reservationPtr(reservationId));
    q.equalTo('channel', 'online');
    if (!includeDeleted) q.equalTo('exists', true);
    q.descending('createdAt');
    return q.find({ useMasterKey: true });
  };

  const setGatewaySetting = async (id) => {
    const q = new Parse.Query('Setting');
    q.equalTo('key', GATEWAY_KEY);
    q.equalTo('exists', true);
    const existing = await q.first({ useMasterKey: true });
    const setting = new Parse.Object('Setting');
    if (existing) setting.id = existing.id;
    setting.set('key', GATEWAY_KEY);
    setting.set('category', 'payments');
    setting.set('displayName', 'Pasarela de Pago Activa');
    setting.set('description', 'test');
    setting.set('editable', true);
    setting.set('active', true);
    setting.set('exists', true);
    setting.set('value', encodeGatewayId(id));
    setting.set('valueType', 'number');
    await setting.save(null, { useMasterKey: true });
  };

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });

    adminToken = await AuthTestHelper.loginAs('admin', app);
    superadminToken = await AuthTestHelper.loginAs('superadmin', app);
    managerToken = await AuthTestHelper.loginAs('department_manager', app);
    clientToken = await AuthTestHelper.loginAs('client', app);
    employeeToken = await AuthTestHelper.loginAs('employee', app);

    // Inject a mock Stripe client (zero network). The bootstrap StripeAdapter resolves through
    // stripeClient.getStripeClient(), so this makes the whole app use the mock and report configured.
    sessionCounter = 0;
    stripeCreate = jest.fn().mockImplementation(async () => {
      sessionCounter += 1;
      return {
        id: `cs_test_${sessionCounter}`,
        url: `https://checkout.stripe.com/c/pay/cs_test_${sessionCounter}`,
        payment_intent: `pi_test_${sessionCounter}`,
        status: 'open',
      };
    });
    stripeClient.setClientForTests({ checkout: { sessions: { create: stripeCreate } } });

    process.env.PAYMENTS_ENABLED = 'true';
    await setGatewaySetting('stripe');
  }, 30000);

  beforeEach(() => {
    resetRateLimiters(app);
  });

  afterAll(async () => {
    stripeClient.resetForTests();
    if (savedFlag === undefined) delete process.env.PAYMENTS_ENABLED;
    else process.env.PAYMENTS_ENABLED = savedFlag;
    const q = new Parse.Query('Setting');
    q.equalTo('key', GATEWAY_KEY);
    const rows = await q.find({ useMasterKey: true });
    for (const row of rows) { try { await row.destroy({ useMasterKey: true }); } catch (e) { /* gone */ } }
  });

  describe('RBAC (I1-I7)', () => {
    it('I1 admin => 200 with a checkoutUrl', async () => {
      const id = await createReservation();
      const r = await postCheckout(id, adminToken);
      expect(r.status).toBe(200);
      expect(r.body.success).toBe(true);
      expect(r.body.data.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    });

    it('I2 superadmin => 200', async () => {
      const id = await createReservation();
      const r = await postCheckout(id, superadminToken);
      expect(r.status).toBe(200);
    });

    it('I3 department_manager (level 4) => 403, no pending created', async () => {
      const id = await createReservation();
      const r = await postCheckout(id, managerToken);
      expect(r.status).toBe(403);
      expect(await onlinePayments(id)).toHaveLength(0);
    });

    it('I4 client (level 5) => 403 (inverted-level trap: 5 < 6)', async () => {
      const id = await createReservation();
      const r = await postCheckout(id, clientToken);
      expect(r.status).toBe(403);
      expect(await onlinePayments(id)).toHaveLength(0);
    });

    it('I5 employee (level 3) => 403', async () => {
      const id = await createReservation();
      const r = await postCheckout(id, employeeToken);
      expect(r.status).toBe(403);
    });

    it('I6 no token => 401', async () => {
      const id = await createReservation();
      const r = await request(app).post(`/api/reservations/${id}/pay/checkout`).send({});
      expect(r.status).toBe(401);
    });

    it('I7 forged "admin" role claim over a client roleId => 403 (DB-backed level wins over stale claim)', async () => {
      const id = await createReservation();
      const clientTok = await AuthTestHelper.loginAs('client');
      const decoded = jwt.decode(clientTok);
      const { iat, exp, ...rest } = decoded;
      // The string role claim says admin, but roleId still points to the client Role (level 5): the
      // middleware resolves roleObject FRESH from that roleId, so the escalation is ignored.
      const forged = jwt.sign({ ...rest, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '8h' });
      const r = await postCheckout(id, forged);
      expect(r.status).toBe(403);
      expect(await onlinePayments(id)).toHaveLength(0);
    });
  });

  describe('PAYMENTS_ENABLED master flag (I8-I11)', () => {
    afterEach(() => { process.env.PAYMENTS_ENABLED = 'true'; });

    it('I8 "true" => 200 and creates a pending', async () => {
      process.env.PAYMENTS_ENABLED = 'true';
      const id = await createReservation();
      const r = await postCheckout(id);
      expect(r.status).toBe(200);
      expect(await onlinePayments(id)).toHaveLength(1);
    });

    it('I9 unset => 503, nothing created, SDK never called', async () => {
      delete process.env.PAYMENTS_ENABLED;
      stripeCreate.mockClear();
      const id = await createReservation();
      const r = await postCheckout(id);
      expect(r.status).toBe(503);
      expect(await onlinePayments(id)).toHaveLength(0);
      expect(stripeCreate).not.toHaveBeenCalled();
    });

    it('I10 "TRUE" (wrong case) => 503 (strict === "true")', async () => {
      process.env.PAYMENTS_ENABLED = 'TRUE';
      const id = await createReservation();
      const r = await postCheckout(id);
      expect(r.status).toBe(503);
      expect(await onlinePayments(id)).toHaveLength(0);
    });

    it('I11 "1" => 503', async () => {
      process.env.PAYMENTS_ENABLED = '1';
      const id = await createReservation();
      const r = await postCheckout(id);
      expect(r.status).toBe(503);
    });
  });

  describe('pending Payment + rollup + DTO (I12-I15)', () => {
    it('I12 creates exactly one pending online Payment (channel/gateway/status/method)', async () => {
      const id = await createReservation();
      await postCheckout(id);
      const pend = await onlinePayments(id);
      expect(pend).toHaveLength(1);
      expect(pend[0].get('channel')).toBe('online');
      expect(pend[0].get('gateway')).toBe('stripe');
      expect(pend[0].get('gatewayStatus')).toBe('requires_payment');
      expect(pend[0].get('method')).toBe('tarjeta');
      expect(pend[0].get('gatewaySessionId')).toMatch(/^cs_test_/);
    });

    it('I13 the pending does NOT count in the rollup (paidAmount stays 0)', async () => {
      const id = await createReservation();
      await postCheckout(id);
      const res = await getPayments(id);
      expect(res.status).toBe(200);
      expect(res.body.data.summary.paidAmount).toBe(0);
      expect(res.body.data.summary.paymentStatus).toBe('pending');
    });

    it('I14 the pending appears in the listing but with paidAmount unchanged', async () => {
      const id = await createReservation();
      await postCheckout(id);
      const res = await getPayments(id);
      const online = res.body.data.payments.filter((p) => p.channel === 'online');
      expect(online).toHaveLength(1);
      expect(res.body.data.summary.paidAmount).toBe(0);
    });

    it('I15 the pending DTO exposes channel/gateway/gatewayStatus but NOT the PCI ids', async () => {
      const id = await createReservation();
      await postCheckout(id);
      const res = await getPayments(id);
      const dto = res.body.data.payments.find((p) => p.channel === 'online');
      expect(dto.gateway).toBe('stripe');
      expect(dto.gatewayStatus).toBe('requires_payment');
      expect(dto).not.toHaveProperty('gatewayIntentId');
      expect(dto).not.toHaveProperty('gatewaySessionId');
      expect(dto).not.toHaveProperty('gatewayRaw');
    });
  });

  describe('anti-double-submit (I16-I18, I31)', () => {
    it('I16 two concurrent POSTs => both 200, exactly ONE pending (in-process lock)', async () => {
      const id = await createReservation();
      const [r1, r2] = await Promise.all([postCheckout(id), postCheckout(id)]);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(await onlinePayments(id)).toHaveLength(1);
    });

    it('I17 sequential double POST reuses the same pending (one Payment)', async () => {
      const id = await createReservation();
      const r1 = await postCheckout(id);
      const r2 = await postCheckout(id);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(await onlinePayments(id)).toHaveLength(1);
    });

    it('I18 concurrent POSTs on DISTINCT reservations create one pending each', async () => {
      const [idA, idB] = await Promise.all([createReservation(), createReservation()]);
      const [rA, rB] = await Promise.all([postCheckout(idA), postCheckout(idB)]);
      expect(rA.status).toBe(200);
      expect(rB.status).toBe(200);
      expect(await onlinePayments(idA)).toHaveLength(1);
      expect(await onlinePayments(idB)).toHaveLength(1);
    });

    it('I31 an EXPIRED pending is retired and a fresh one is created', async () => {
      const id = await createReservation();
      await postCheckout(id);
      const [pending] = await onlinePayments(id);
      const oldId = pending.id;
      pending.set('expiresAt', new Date(Date.now() - 60000)); // force expiry
      await pending.save(null, { useMasterKey: true });

      const r = await postCheckout(id);
      expect(r.status).toBe(200);

      const live = await onlinePayments(id); // exists:true
      expect(live).toHaveLength(1);
      expect(live[0].id).not.toBe(oldId);

      const all = await onlinePayments(id, { includeDeleted: true });
      const retired = all.find((p) => p.id === oldId);
      expect(retired.get('exists')).toBe(false);
      expect(retired.get('gatewayStatus')).toBe('expired');
    });
  });

  describe('idempotency / reuse (I19-I20)', () => {
    it('I19 reuse returns a checkoutUrl on both calls', async () => {
      const id = await createReservation();
      const r1 = await postCheckout(id);
      const r2 = await postCheckout(id);
      expect(r1.body.data.checkoutUrl).toBeTruthy();
      expect(r2.body.data.checkoutUrl).toBeTruthy();
    });

    it('I20 reuse uses the SAME idempotency key (=paymentId) and creates no 2nd Payment', async () => {
      const id = await createReservation();
      await postCheckout(id);
      await postCheckout(id);
      const pend = await onlinePayments(id);
      expect(pend).toHaveLength(1);
      const keys = stripeCreate.mock.calls.map((c) => c[1] && c[1].idempotencyKey);
      expect(new Set(keys).size).toBe(1); // identical key across both calls
      expect(keys[0]).toBe(pend[0].id);
    });
  });

  describe('server-side amount + PCI (I24-I26)', () => {
    it('I24 ignores a client-supplied amount/currency/PAN (server computes the charge)', async () => {
      const id = await createReservation(CLEAN, 'tarjeta'); // card total 12100
      const r = await postCheckout(id, adminToken, {
        amount: 1, currency: 'MXN', number: '4242424242424242', cvc: '123',
      });
      expect(r.status).toBe(200);
      const [pending] = await onlinePayments(id);
      expect(pending.get('origAmount')).toBe(12100); // NOT the client's 1
    });

    it('I25 the pending DTO never leaks gatewayIntentId/gatewaySessionId/gatewayRaw', async () => {
      const id = await createReservation();
      await postCheckout(id);
      const res = await getPayments(id);
      const dto = res.body.data.payments.find((p) => p.channel === 'online');
      expect(dto).not.toHaveProperty('gatewayIntentId');
      expect(dto).not.toHaveProperty('gatewaySessionId');
      expect(dto).not.toHaveProperty('gatewayRaw');
    });

    it('I26 a body with number/cvc/exp does not break and is never persisted', async () => {
      const id = await createReservation();
      const r = await postCheckout(id, adminToken, { number: '4111111111111111', cvc: '999', exp: '12/30' });
      expect(r.status).toBe(200);
      const [pending] = await onlinePayments(id);
      expect(pending.get('number')).toBeUndefined();
      expect(pending.get('cvc')).toBeUndefined();
      expect(JSON.stringify(pending.toJSON())).not.toContain('4111111111111111');
    });
  });

  describe('toggle / router wiring (I27-I29)', () => {
    afterAll(async () => { await setGatewaySetting('stripe'); });

    it('I27 USD reservation forces Stripe even when toggle=mexican', async () => {
      await setGatewaySetting('mexican');
      const id = await createReservation(CLEAN_USD, 'tarjeta', 'USD');
      const r = await postCheckout(id);
      expect(r.status).toBe(200);
      const [pending] = await onlinePayments(id);
      expect(pending.get('gateway')).toBe('stripe');
      expect(pending.get('origCurrency')).toBe('USD');
    });

    it('I28 MXN + toggle=mexican falls back to Stripe (Openpay unconfigured)', async () => {
      await setGatewaySetting('mexican');
      const id = await createReservation();
      await postCheckout(id);
      const [pending] = await onlinePayments(id);
      expect(pending.get('gateway')).toBe('stripe');
    });

    it('I29 MXN + toggle=stripe resolves to Stripe', async () => {
      await setGatewaySetting('stripe');
      const id = await createReservation();
      await postCheckout(id);
      const [pending] = await onlinePayments(id);
      expect(pending.get('gateway')).toBe('stripe');
    });
  });

  describe('tier rejection + mixed formula (E2E)', () => {
    it('efectivo reservation with no prior payments => 422, no pending', async () => {
      const id = await createReservation(CLEAN, 'efectivo');
      const r = await postCheckout(id);
      expect(r.status).toBe(422);
      expect(await onlinePayments(id)).toHaveLength(0);
    });

    it('efectivo reservation WITH a prior counting payment => 200, mixed card remainder 9680', async () => {
      const id = await createReservation(CLEAN, 'efectivo');
      await createManualPayment(id, 2320, 'transferencia'); // counts in the rollup
      const r = await postCheckout(id);
      expect(r.status).toBe(200);
      const [pending] = await onlinePayments(id);
      expect(pending.get('origAmount')).toBe(9680);
    });

    it('already-settled reservation => 422 (no $0 session)', async () => {
      const id = await createReservation(CLEAN, 'tarjeta');
      await createManualPayment(id, 12100, 'tarjeta'); // fully covers the card total
      const r = await postCheckout(id);
      expect(r.status).toBe(422);
      expect(await onlinePayments(id)).toHaveLength(0);
    });

    it('cancelled reservation => 422', async () => {
      const id = await createReservation(CLEAN, 'tarjeta', 'MXN', { status: 'cancelled' });
      const r = await postCheckout(id);
      expect(r.status).toBe(422);
    });
  });
});
