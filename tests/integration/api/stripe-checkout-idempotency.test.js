/**
 * POST /api/reservations/:id/pay/checkout — Stripe idempotency regression (council HIGH).
 *
 * The stripe-checkout suite's shared mock ignores the create params, so it could never catch the HIGH
 * regression the fix closes: a time-varying expires_at (Date.now() at call time) travels in the request
 * BODY, so on the REUSE path buildChargeAndSave re-sends DIFFERENT params under the SAME idempotency key
 * once time has passed — which Stripe rejects (idempotency-key-in-use with different params), surfacing a
 * 502 exactly in the anti-double-submit mechanism.
 *
 * This suite drives an idempotency-STRICT mock: it records the params of the first call per idempotencyKey
 * and, on a same-key replay whose params drifted, THROWS (as Stripe would); a same-key replay with
 * identical params returns the cached session. The simulated clock is advanced between the two POSTs (via a
 * Date.now spy) so, WITHOUT the fix, the reuse replay would drift and 502; WITH the fix (expires_at frozen
 * per-Payment) the params stay byte-identical and Stripe returns the cached session -> 200. Zero network.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');
const stripeClient = require('../../../src/infrastructure/payments/stripeClient');
const { encodeGatewayId } = require('../../../src/application/services/payments/gatewayBootstrap');

const GATEWAY_KEY = 'activePaymentGateway';
const RATE_LIMIT_KEYS = ['::ffff:127.0.0.1', '127.0.0.1', '::1'];
const CLEAN = [{ pricesByType: { efectivo: 10000, transferencia: 11600, tarjeta: 12100 } }];

/**
 * Reset every express-rate-limit middleware for the known test IPs (same helper as the sibling suite).
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

describe('POST /api/reservations/:id/pay/checkout — Stripe idempotency (council HIGH)', () => {
  let app;
  let adminToken;
  let stripeCreate;
  let stripeExpire;
  let idempotencyStore;
  let sessionCounter = 0;
  const savedFlag = process.env.PAYMENTS_ENABLED;

  const postCheckout = (id, token = adminToken) => request(app)
    .post(`/api/reservations/${id}/pay/checkout`).set('Authorization', `Bearer ${token}`).send({});

  const reservationPtr = (id) => {
    const ptr = new Parse.Object('Reservation');
    ptr.id = id;
    return ptr;
  };

  const createReservation = async () => {
    const reservation = new Parse.Object('Reservation');
    reservation.set('active', true);
    reservation.set('exists', true);
    reservation.set('status', 'confirmed');
    reservation.set('paymentType', 'tarjeta');
    reservation.set('currency', 'MXN');
    await reservation.save(null, { useMasterKey: true });
    const rs = new Parse.Object('ReservationService');
    rs.set('active', true);
    rs.set('exists', true);
    rs.set('reservationPtr', reservation);
    rs.set('subconcept', { includeInTotal: true, pricesByType: CLEAN[0].pricesByType, total: 0 });
    await rs.save(null, { useMasterKey: true });
    return reservation.id;
  };

  const onlinePayments = async (reservationId) => {
    const q = new Parse.Query('Payment');
    q.equalTo('reservationPtr', reservationPtr(reservationId));
    q.equalTo('channel', 'online');
    q.equalTo('exists', true);
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

    // Idempotency-STRICT mock: replays under the same key must carry identical params, or Stripe rejects.
    sessionCounter = 0;
    idempotencyStore = new Map(); // idempotencyKey -> { paramsJson, session }
    stripeCreate = jest.fn().mockImplementation(async (params, options) => {
      const key = options && options.idempotencyKey;
      const paramsJson = JSON.stringify(params);
      if (key && idempotencyStore.has(key)) {
        const prior = idempotencyStore.get(key);
        if (prior.paramsJson !== paramsJson) {
          const err = new Error('Keys for idempotent requests can only be used with the same parameters (idempotency_key_in_use)');
          err.type = 'StripeIdempotencyError';
          err.statusCode = 400;
          throw err;
        }
        return prior.session; // identical params -> cached session, verbatim
      }
      sessionCounter += 1;
      const session = {
        id: `cs_idem_${sessionCounter}`,
        url: `https://checkout.stripe.com/c/pay/cs_idem_${sessionCounter}`,
        payment_intent: `pi_idem_${sessionCounter}`,
        status: 'open',
      };
      if (key) idempotencyStore.set(key, { paramsJson, session });
      return session;
    });
    stripeExpire = jest.fn().mockImplementation(async (sessionId) => ({ id: sessionId, status: 'expired' }));
    stripeClient.setClientForTests({ checkout: { sessions: { create: stripeCreate, expire: stripeExpire } } });

    process.env.PAYMENTS_ENABLED = 'true';
    await setGatewaySetting('stripe');
  }, 30000);

  beforeEach(() => { resetRateLimiters(app); });

  afterAll(async () => {
    stripeClient.resetForTests();
    if (savedFlag === undefined) delete process.env.PAYMENTS_ENABLED;
    else process.env.PAYMENTS_ENABLED = savedFlag;
    const q = new Parse.Query('Setting');
    q.equalTo('key', GATEWAY_KEY);
    const rows = await q.find({ useMasterKey: true });
    for (const row of rows) { try { await row.destroy({ useMasterKey: true }); } catch (e) { /* gone */ } }
  });

  it('the idempotency-strict mock REJECTS a same-key replay whose params drifted (the mock has teeth)', async () => {
    const key = 'idem_teeth_key';
    await stripeCreate({ a: 1 }, { idempotencyKey: key });
    await expect(stripeCreate({ a: 2 }, { idempotencyKey: key })).rejects.toThrow(/idempoten/i);
    await expect(stripeCreate({ a: 1 }, { idempotencyKey: key })).resolves.toBeDefined(); // identical -> cached
  });

  it('reuse AFTER the clock advances re-sends IDENTICAL params (frozen expires_at) -> cached session, 200', async () => {
    const id = await createReservation();

    // Freeze "now" at t0 for the first checkout, then jump +5 min (still < the 30-min pending TTL, so the
    // pending is REUSED, not retired). Without the fix, the second buildSessionParams would recompute
    // expires_at from Date.now() -> DIFFERENT params under the SAME idempotency key -> the strict mock throws
    // -> the adapter wraps it as PROVIDER_ERROR -> the endpoint answers 502. With the fix it stays 200.
    const t0 = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
    let r1;
    let r2;
    let params1;
    let params2;
    let key1;
    let key2;
    try {
      r1 = await postCheckout(id);
      const c1 = stripeCreate.mock.calls[stripeCreate.mock.calls.length - 1];
      params1 = JSON.stringify(c1[0]);
      key1 = c1[1] && c1[1].idempotencyKey;

      nowSpy.mockReturnValue(t0 + 5 * 60 * 1000); // 5 minutes later

      r2 = await postCheckout(id);
      const c2 = stripeCreate.mock.calls[stripeCreate.mock.calls.length - 1];
      params2 = JSON.stringify(c2[0]);
      key2 = c2[1] && c2[1].idempotencyKey;
    } finally {
      nowSpy.mockRestore();
    }

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200); // regression closed: the replay did NOT 502

    const pend = await onlinePayments(id);
    expect(pend).toHaveLength(1); // reused, not a second pending

    // Same idempotency key AND byte-identical params across both calls (the frozen expires_at is the crux).
    expect(key1).toBe(pend[0].id);
    expect(key2).toBe(key1);
    expect(params2).toBe(params1);
    // expires_at was NOT recomputed from the advanced clock.
    expect(JSON.parse(params2).expires_at).toBe(JSON.parse(params1).expires_at);
    // Stripe returned the SAME (cached) session, so no second checkout URL/session was ever opened.
    expect(r2.body.data.checkoutUrl).toBe(r1.body.data.checkoutUrl);
    expect(stripeExpire).not.toHaveBeenCalled(); // nothing retired: this was a clean reuse
  });
});
