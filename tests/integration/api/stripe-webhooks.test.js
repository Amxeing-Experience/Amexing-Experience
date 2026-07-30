/**
 * POST /api/webhooks/stripe — integration (full app + Parse real + mongodb-memory-server).
 *
 * Signatures are REAL: every request is signed with the Stripe SDK's own
 * webhooks.generateTestHeaderString against a dummy whsec_ secret and verified by the SDK's own
 * constructEvent. Nothing about the verification is mocked, so a mounting mistake (a parsed body
 * instead of the raw Buffer) fails these tests exactly as it would fail in production. Zero network.
 *
 * Covers: the mount smoke test (the highest-risk bug of this PR), the money path
 * (checkout.session.completed confirms the Payment and moves the reservation rollup), convergence of
 * the two success events, the non-counting events, Capa A deduplication, uncorrelatable metadata,
 * the monotonic guard against a late 'succeeded' for any terminal state, PCI redaction of both logs
 * and the persisted GatewayEvent.raw, the endpoint's own rate limiter, and the fact that the
 * signature — not a JWT — is the only authentication.
 */

const request = require('supertest');
const Parse = require('parse/node');
const Stripe = require('stripe');
const { MongoClient } = require('mongodb');
const logger = require('../../../src/infrastructure/logger');
const PaymentService = require('../../../src/application/services/PaymentService');
const stripeClient = require('../../../src/infrastructure/payments/stripeClient');
const atomicStore = require('../../../src/infrastructure/payments/paymentAtomicStore');
const { ensureGatewayEventUniqueIndex } = require('../../../scripts/seeds/026-create-gatewayevent-class');

const SECRET_A = 'whsec_integration_alpha_secret_0001';
const SECRET_B = 'whsec_integration_bravo_secret_0002';
const RATE_LIMIT_KEYS = ['::ffff:127.0.0.1', '127.0.0.1', '::1'];
// Unique per run: the memory DB is shared by the whole jest process, so event ids must never collide
// with a sibling suite's rows (the unique index is global to the collection).
const RUN = `wh${Date.now().toString(36)}`;

const signer = Stripe('sk_test_dummy_signing_key');
const sign = (payload, secret = SECRET_A) => signer.webhooks.generateTestHeaderString({ payload, secret });

/**
 * Reset every express-rate-limit middleware in the app for the known test IPs. The webhook limiter is
 * 100/min and this suite sends far more than that across its cases.
 * @param {object} expressApp - The Express app.
 */
function resetRateLimiters(expressApp) {
  const rootRouter = expressApp.router || expressApp._router;
  if (!rootRouter || !Array.isArray(rootRouter.stack)) return;
  const seen = new Set();
  const walk = (stack) => {
    for (const layer of stack) {
      if (!layer) continue;
      const { handle } = layer;
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

describe('POST /api/webhooks/stripe (integration)', () => {
  let app;
  let mongoClient;
  let parseDb;
  const savedSecrets = process.env.STRIPE_WEBHOOK_SECRETS;
  const created = [];
  let eventCounter = 0;

  const reservationPtr = (id) => {
    const ptr = new Parse.Object('Reservation');
    ptr.id = id;
    return ptr;
  };

  // Total-only subconcept + efectivo anchor: every method resolves 1:1 against the total, so the
  // rollup numbers are unambiguous (same fixture shape as payment-rollup-gateway-filter.test.js).
  const createReservation = async (total = 1000) => {
    const reservation = new Parse.Object('Reservation');
    reservation.set('active', true);
    reservation.set('exists', true);
    reservation.set('status', 'confirmed');
    reservation.set('paymentType', 'efectivo');
    reservation.set('currency', 'MXN');
    await reservation.save(null, { useMasterKey: true });
    created.push(reservation);

    const rs = new Parse.Object('ReservationService');
    rs.set('active', true);
    rs.set('exists', true);
    rs.set('reservationPtr', reservation);
    rs.set('subconcept', { includeInTotal: true, pricesByType: null, total });
    await rs.save(null, { useMasterKey: true });
    created.push(rs);
    return reservation.id;
  };

  // The exact state PR4 leaves behind before any webhook arrives.
  const createPendingOnline = async (reservationId, amount = 1000, gatewayStatus = 'requires_payment') => {
    const p = new Parse.Object('Payment');
    p.set('reservationPtr', reservationPtr(reservationId));
    p.set('amount', amount);
    p.set('origAmount', amount);
    p.set('origCurrency', 'MXN');
    p.set('method', 'tarjeta');
    p.set('channel', 'online');
    p.set('gateway', 'stripe');
    p.set('gatewayStatus', gatewayStatus);
    p.set('gatewaySessionId', `cs_test_${reservationId}`);
    p.set('expiresAt', new Date(Date.now() + 30 * 60 * 1000));
    p.set('active', true);
    p.set('exists', true);
    await p.save(null, { useMasterKey: true });
    created.push(p);
    return p;
  };

  const reloadPayment = async (id) => new Parse.Query('Payment').get(id, { useMasterKey: true });
  const reloadReservation = async (id) => new Parse.Query('Reservation').get(id, { useMasterKey: true });

  const countEvents = async (eventId) => {
    const q = new Parse.Query('GatewayEvent');
    q.equalTo('gateway', 'stripe');
    q.equalTo('eventId', eventId);
    return q.count({ useMasterKey: true });
  };

  const findEvent = async (eventId) => {
    const q = new Parse.Query('GatewayEvent');
    q.equalTo('eventId', eventId);
    return q.first({ useMasterKey: true });
  };

  const nextEventId = (tag = 'e') => {
    eventCounter += 1;
    return `evt_${RUN}_${tag}_${eventCounter}`;
  };

  /**
   * A realistic Stripe event whose data.object deliberately carries card-adjacent junk
   * (payment_method_details, customer_details) so PCI redaction is proven against a payload that
   * actually contains something to leak.
   * @param {object} options - Event options.
   * @returns {object} The event object.
   */
  const makeEvent = ({
    type = 'checkout.session.completed', eventId, paymentId, reservationId, objectExtras = {},
  }) => ({
    id: eventId || nextEventId(),
    object: 'event',
    api_version: '2026-06-24.dahlia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    data: {
      object: {
        id: `cs_test_${RUN}`,
        object: type.startsWith('checkout.') ? 'checkout.session' : 'payment_intent',
        status: 'complete',
        amount_total: 100000,
        amount: 100000,
        currency: 'mxn',
        payment_intent: `pi_test_${RUN}`,
        latest_charge: `ch_test_${RUN}`,
        payment_method_details: { card: { last4: '4242', brand: 'visa', exp_month: 12 } },
        customer_details: { email: 'pagador@example.com', name: 'Pagador Prueba' },
        metadata: {
          ...(paymentId === undefined ? {} : { paymentId }),
          ...(reservationId === undefined ? {} : { reservationId }),
        },
        ...objectExtras,
      },
    },
  });

  const postEvent = (event, { secret = SECRET_A, headers = {} } = {}) => {
    const payload = JSON.stringify(event);
    const req = request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', sign(payload, secret));
    Object.entries(headers).forEach(([k, v]) => req.set(k, v));
    return req.send(payload);
  };

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });

    Parse.initialize('test-app-id', null, 'test-master-key');
    Parse.serverURL = 'http://localhost:1339/parse';
    Parse.masterKey = 'test-master-key';

    // Capa A is only atomic if the DB-level unique index exists — mirror seed 026 (schema, then index).
    const schema = new Parse.Schema('GatewayEvent');
    try {
      await schema.get({ useMasterKey: true });
    } catch {
      schema.addString('gateway');
      schema.addString('eventId');
      schema.addString('type');
      schema.addDate('processedAt');
      schema.addObject('raw');
      schema.addBoolean('active');
      schema.addBoolean('exists');
      await schema.save({ useMasterKey: true });
    }

    mongoClient = new MongoClient(process.env.TEST_DATABASE_URI || process.env.DATABASE_URI);
    await mongoClient.connect();
    const { databases } = await mongoClient.db('admin').admin().listDatabases();
    for (const d of databases) {
      if (['admin', 'local', 'config'].includes(d.name)) continue;
      const cols = await mongoClient.db(d.name).listCollections({ name: '_SCHEMA' }).toArray();
      if (cols.length) { parseDb = mongoClient.db(d.name); break; }
    }
    if (!parseDb) throw new Error('Could not locate the Parse Mongo db (_SCHEMA collection not found)');
    await ensureGatewayEventUniqueIndex(parseDb);

    // Real webhook crypto, no API key needed and no network reachable.
    stripeClient.setClientForTests({ webhooks: signer.webhooks });
    process.env.STRIPE_WEBHOOK_SECRETS = SECRET_A;
  }, 60000);

  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRETS = SECRET_A;
    resetRateLimiters(app);
  });

  afterAll(async () => {
    stripeClient.resetForTests();
    if (savedSecrets === undefined) delete process.env.STRIPE_WEBHOOK_SECRETS;
    else process.env.STRIPE_WEBHOOK_SECRETS = savedSecrets;
    for (const o of created) {
      try { await o.destroy({ useMasterKey: true }); } catch { /* gone */ }
    }
    const q = new Parse.Query('GatewayEvent');
    q.startsWith('eventId', `evt_${RUN}`);
    q.limit(1000);
    const rows = await q.find({ useMasterKey: true });
    for (const row of rows) {
      try { await row.destroy({ useMasterKey: true }); } catch { /* gone */ }
    }
    await atomicStore.closeForTests();
    if (mongoClient) await mongoClient.close();
  }, 60000);

  // ---------------------------------------------------------------------------------------------
  describe('MOUNT SMOKE TEST — the raw Buffer actually reaches the handler', () => {
    it('a really-signed event answers 200 through the full app (raw body survived the mount)', async () => {
      const reservationId = await createReservation();
      const payment = await createPendingOnline(reservationId);
      const r = await postEvent(makeEvent({
        paymentId: payment.id, reservationId, eventId: nextEventId('smoke'),
      }));
      expect(r.status).toBe(200);
    });

    it('the SAME payload interpreted as a parsed object cannot be verified — so the 200 above proves the mount', async () => {
      // Negative control for the exact failure a wrong mount produces: had the route been registered
      // after express.json (or inside initPromise.then), req.body would be this object and the SDK
      // would refuse it with its "parsed JavaScript object" message instead of returning an event.
      const payload = JSON.stringify(makeEvent({ paymentId: 'x', eventId: nextEventId('ctrl') }));
      const header = sign(payload);
      expect(() => signer.webhooks.constructEvent(JSON.parse(payload), header, SECRET_A))
        .toThrow(/parsed JavaScript object|string or a Buffer/i);
      // And the raw form is what verifies.
      expect(signer.webhooks.constructEvent(payload, header, SECRET_A).object).toBe('event');
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('money path — checkout.session.completed confirms and recalculates', () => {
    it('confirms the Payment (succeeded + confirmedAt) and moves the reservation rollup to paid', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);

      // Precondition: a pending online payment does NOT count.
      const before = await PaymentService.summarize(reservationId);
      expect(before.paidAmount).toBe(0);
      expect(before.balance).toBe(1000);
      expect(before.paymentStatus).toBe('pending');

      const r = await postEvent(makeEvent({
        paymentId: payment.id, reservationId, eventId: nextEventId('paid'),
      }));
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ received: true, handled: true });

      const reloaded = await reloadPayment(payment.id);
      expect(reloaded.get('gatewayStatus')).toBe('succeeded');
      expect(reloaded.get('confirmedAt')).toBeInstanceOf(Date);

      // Persisted on the reservation by recalculate, not just computed on the fly.
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('balance')).toBe(0);
      expect(reservation.get('paymentStatus')).toBe('paid');
    });

    it('a PARTIAL online payment leaves the reservation partial with the exact remaining balance', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 400);
      await postEvent(makeEvent({ paymentId: payment.id, reservationId, eventId: nextEventId('part') }));

      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(400);
      expect(reservation.get('balance')).toBe(600);
      expect(reservation.get('paymentStatus')).toBe('partial');
    });

    it('payment_intent.succeeded alone (session event never arrived) confirms just the same', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const r = await postEvent(makeEvent({
        type: 'payment_intent.succeeded', paymentId: payment.id, reservationId, eventId: nextEventId('pi'),
      }));
      expect(r.status).toBe(200);
      expect((await reloadPayment(payment.id)).get('gatewayStatus')).toBe('succeeded');
      expect((await reloadReservation(reservationId)).get('paymentStatus')).toBe('paid');
    });

    it('the online Payment DTO still hides the PCI ids after confirmation', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      await postEvent(makeEvent({ paymentId: payment.id, reservationId, eventId: nextEventId('dto') }));
      const reloaded = await reloadPayment(payment.id);
      // The webhook must not have written any card-adjacent field onto the Payment row.
      const json = JSON.stringify(reloaded.toJSON());
      expect(json).not.toContain('4242');
      expect(json).not.toContain('visa');
      expect(json).not.toContain('pagador@example.com');
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Exactly ONE rollup write for the whole convergence, and it is not a matter of luck: the losing
  // event does not recalculate, it VERIFIES. recalculateIfStale runs inside the same per-reservation
  // lock recalculate uses, so the loser queues behind the winner, re-reads what the winner persisted,
  // finds it current and writes nothing (healed:false).
  describe('convergence — the two success events transition and recalculate exactly once', () => {
    it('payment_intent.succeeded AFTER checkout.session.completed: no second transition, no second write', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);

      // Spies WITHOUT replacing the implementation: the real rollup still runs, we only count calls.
      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      const healSpy = jest.spyOn(PaymentService, 'recalculateIfStale');
      try {
        await postEvent(makeEvent({ paymentId: payment.id, reservationId, eventId: nextEventId('conv1') }));
        expect(recalcSpy).toHaveBeenCalledTimes(1);

        const second = await postEvent(makeEvent({
          type: 'payment_intent.succeeded', paymentId: payment.id, reservationId, eventId: nextEventId('conv2'),
        }));
        expect(second.status).toBe(200);
        // Distinct eventId => it clears Capa A; Capa B is what stops the TRANSITION.
        expect(second.body).toEqual({ received: true, handled: false });
        expect(recalcSpy).toHaveBeenCalledTimes(1);
        expect(recalcSpy.mock.calls.map(([id]) => id)).toEqual([reservationId]);
        // The sibling only verified, and found nothing to repair.
        expect(healSpy).toHaveBeenCalledTimes(1);
        expect(healSpy).toHaveBeenCalledWith(reservationId);
        await expect(healSpy.mock.results[0].value).resolves.toMatchObject({ healed: false });
      } finally {
        recalcSpy.mockRestore();
        healSpy.mockRestore();
      }

      const reloaded = await reloadPayment(payment.id);
      expect(reloaded.get('gatewayStatus')).toBe('succeeded');
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000); // never 2000
      expect(reservation.get('balance')).toBe(0);
      expect(reservation.get('paymentStatus')).toBe('paid');
    });

    it('the reverse order (session event AFTER the intent event) behaves identically', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      try {
        await postEvent(makeEvent({
          type: 'payment_intent.succeeded', paymentId: payment.id, reservationId, eventId: nextEventId('rev1'),
        }));
        await postEvent(makeEvent({ paymentId: payment.id, reservationId, eventId: nextEventId('rev2') }));
        expect(recalcSpy).toHaveBeenCalledTimes(1);
      } finally {
        recalcSpy.mockRestore();
      }
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(1000);
    });

    it('the sibling event does not REWRITE the reservation (updatedAt is untouched)', async () => {
      // Spy-independent proof of "one write": if the loser persisted the same values again, Parse would
      // still bump _updated_at. This is the assertion that would catch a regression to an unconditional
      // recalculate even if someone deleted the call-count expectations above.
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      await postEvent(makeEvent({ paymentId: payment.id, reservationId, eventId: nextEventId('nowrite1') }));
      const afterFirst = await reloadReservation(reservationId);
      const stamp = afterFirst.updatedAt.getTime();

      // A second of separation, so an actual rewrite could not be mistaken for the same timestamp.
      await new Promise((resolve) => { setTimeout(resolve, 1100); });
      const sibling = await postEvent(makeEvent({
        type: 'payment_intent.succeeded', paymentId: payment.id, reservationId, eventId: nextEventId('nowrite2'),
      }));
      expect(sibling.body).toEqual({ received: true, handled: false });

      const afterSibling = await reloadReservation(reservationId);
      expect(afterSibling.updatedAt.getTime()).toBe(stamp);
      expect(afterSibling.get('paidAmount')).toBe(1000);
    });

    it('a PARTIAL rollup is also recognized as current (the check does not assume balance 0)', async () => {
      // 400 of 1000: the sibling must find paidAmount/balance/paymentStatus='partial' all current and
      // write nothing. A comparison that only looked at "is it paid?" would repair this one forever.
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 400);
      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      const healSpy = jest.spyOn(PaymentService, 'recalculateIfStale');
      try {
        await postEvent(makeEvent({ paymentId: payment.id, reservationId, eventId: nextEventId('part1') }));
        const reservation = await reloadReservation(reservationId);
        expect(reservation.get('paymentStatus')).toBe('partial');
        const stamp = reservation.updatedAt.getTime();
        await new Promise((resolve) => { setTimeout(resolve, 1100); });

        await postEvent(makeEvent({
          type: 'payment_intent.succeeded', paymentId: payment.id, reservationId, eventId: nextEventId('part2'),
        }));
        expect(recalcSpy).toHaveBeenCalledTimes(1);
        expect(healSpy).toHaveBeenCalledTimes(1);
        await expect(healSpy.mock.results[0].value).resolves.toMatchObject({ healed: false });

        const after = await reloadReservation(reservationId);
        expect(after.updatedAt.getTime()).toBe(stamp);
        expect(after.get('paidAmount')).toBe(400);
        expect(after.get('balance')).toBe(600);
        expect(after.get('paymentStatus')).toBe('partial');
      } finally {
        recalcSpy.mockRestore();
        healSpy.mockRestore();
      }
    });

    it('FIVE more success events after the first change nothing (idempotent, never accumulative)', async () => {
      // Adversarial version of the same invariant: whatever Stripe re-sends, paidAmount stays 1000 and
      // the rollup is written exactly once no matter how many deliveries verify it.
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const types = [
        'checkout.session.completed', 'payment_intent.succeeded', 'checkout.session.completed',
        'payment_intent.succeeded', 'checkout.session.completed', 'payment_intent.succeeded',
      ];
      const bodies = [];
      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      const healSpy = jest.spyOn(PaymentService, 'recalculateIfStale');
      try {
        for (const [i, type] of types.entries()) {
          // eslint-disable-next-line no-await-in-loop
          const r = await postEvent(makeEvent({
            type, paymentId: payment.id, reservationId, eventId: nextEventId(`flood${i}`),
          }));
          bodies.push(r.body);
        }
        expect(recalcSpy).toHaveBeenCalledTimes(1);
        expect(healSpy).toHaveBeenCalledTimes(5);
        const outcomes = await Promise.all(healSpy.mock.results.map((r) => r.value));
        expect(outcomes.filter((o) => o.healed)).toHaveLength(0); // nothing was ever stale
      } finally {
        recalcSpy.mockRestore();
        healSpy.mockRestore();
      }
      expect(bodies.filter((b) => b.handled === true)).toHaveLength(1); // exactly ONE transition
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('balance')).toBe(0);
      expect((await reloadPayment(payment.id)).get('gatewayStatus')).toBe('succeeded');
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('non-counting events — status changes, money does not', () => {
    it.each([
      ['payment_intent.payment_failed', 'failed'],
      ['checkout.session.expired', 'expired'],
    ])('%s => gatewayStatus %s, balance untouched, no recalculate', async (type, expected) => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      try {
        const r = await postEvent(makeEvent({
          type, paymentId: payment.id, reservationId, eventId: nextEventId('neg'),
        }));
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ received: true, handled: true });
        expect(recalcSpy).not.toHaveBeenCalled();
      } finally {
        recalcSpy.mockRestore();
      }

      expect((await reloadPayment(payment.id)).get('gatewayStatus')).toBe(expected);
      expect((await reloadPayment(payment.id)).get('confirmedAt')).toBeUndefined();
      const summary = await PaymentService.summarize(reservationId);
      expect(summary.paidAmount).toBe(0);
      expect(summary.balance).toBe(1000);
    });

  });

  // ---------------------------------------------------------------------------------------------
  // A declined card does NOT end the story: the Checkout Session stays open/unpaid and the payer can
  // retry with another card in the SAME session, on the same PaymentIntent and the same
  // metadata.paymentId. Treating 'failed' as terminal made Stripe charge the card while the CRM kept a
  // failed row and answered 200 (no retry) — real money, silently lost. These are the cases that pin the
  // per-destination source allowlist.
  describe('a declined card retried successfully in the same session', () => {
    it('failed -> succeeded transitions, stamps confirmedAt and recalculates exactly once', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);

      const failed = await postEvent(makeEvent({
        type: 'payment_intent.payment_failed', paymentId: payment.id, reservationId, eventId: nextEventId('dec1'),
      }));
      expect(failed.body).toEqual({ received: true, handled: true });
      expect((await reloadPayment(payment.id)).get('gatewayStatus')).toBe('failed');
      expect((await PaymentService.summarize(reservationId)).paidAmount).toBe(0);

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      try {
        const retried = await postEvent(makeEvent({
          type: 'payment_intent.succeeded', paymentId: payment.id, reservationId, eventId: nextEventId('dec2'),
        }));
        expect(retried.status).toBe(200);
        expect(retried.body).toEqual({ received: true, handled: true }); // a REAL transition, not a no-op
        expect(recalcSpy).toHaveBeenCalledTimes(1);
        expect(recalcSpy).toHaveBeenCalledWith(reservationId);
      } finally {
        recalcSpy.mockRestore();
      }

      const reloaded = await reloadPayment(payment.id);
      expect(reloaded.get('gatewayStatus')).toBe('succeeded');
      expect(reloaded.get('confirmedAt')).toBeInstanceOf(Date);
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('balance')).toBe(0);
      expect(reservation.get('paymentStatus')).toBe('paid');
    });

    it('the same works through checkout.session.completed (either success event may carry the retry)', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000, 'failed');
      const r = await postEvent(makeEvent({
        paymentId: payment.id, reservationId, eventId: nextEventId('dec3'),
      }));
      expect(r.body).toEqual({ received: true, handled: true });
      expect((await reloadPayment(payment.id)).get('gatewayStatus')).toBe('succeeded');
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(1000);
    });

    it('two failed attempts before the successful one still converge on a single confirmation', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      await postEvent(makeEvent({
        type: 'payment_intent.payment_failed', paymentId: payment.id, reservationId, eventId: nextEventId('dec4a'),
      }));
      // The second failure no longer matches (already 'failed'): a clean no-op, not an error.
      const secondFailure = await postEvent(makeEvent({
        type: 'payment_intent.payment_failed', paymentId: payment.id, reservationId, eventId: nextEventId('dec4b'),
      }));
      expect(secondFailure.body).toEqual({ received: true, handled: false });

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      try {
        await postEvent(makeEvent({
          type: 'payment_intent.succeeded', paymentId: payment.id, reservationId, eventId: nextEventId('dec4c'),
        }));
        expect(recalcSpy).toHaveBeenCalledTimes(1);
      } finally {
        recalcSpy.mockRestore();
      }
      expect((await reloadReservation(reservationId)).get('paymentStatus')).toBe('paid');
    });

    it('an EXPIRED pending that turns out to be paid is confirmed too (real money beats housekeeping)', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000, 'expired');
      const r = await postEvent(makeEvent({
        type: 'payment_intent.succeeded', paymentId: payment.id, reservationId, eventId: nextEventId('exp2ok'),
      }));
      expect(r.body).toEqual({ received: true, handled: true });
      const reloaded = await reloadPayment(payment.id);
      expect(reloaded.get('gatewayStatus')).toBe('succeeded');
      expect(reloaded.get('confirmedAt')).toBeInstanceOf(Date);
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(1000);
    });

    it('a late failure NEVER walks a confirmed Payment backwards (the guard that must not loosen)', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      await postEvent(makeEvent({ paymentId: payment.id, reservationId, eventId: nextEventId('back1') }));
      expect((await reloadPayment(payment.id)).get('gatewayStatus')).toBe('succeeded');

      const late = await postEvent(makeEvent({
        type: 'payment_intent.payment_failed', paymentId: payment.id, reservationId, eventId: nextEventId('back2'),
      }));
      expect(late.status).toBe(200);
      expect(late.body).toEqual({ received: true, handled: false });
      expect((await reloadPayment(payment.id)).get('gatewayStatus')).toBe('succeeded');
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('paymentStatus')).toBe('paid');
    });

    it('a late expiration NEVER walks a confirmed Payment backwards either', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      await postEvent(makeEvent({ paymentId: payment.id, reservationId, eventId: nextEventId('back3') }));
      const late = await postEvent(makeEvent({
        type: 'checkout.session.expired', paymentId: payment.id, reservationId, eventId: nextEventId('back4'),
      }));
      expect(late.body).toEqual({ received: true, handled: false });
      expect((await reloadPayment(payment.id)).get('gatewayStatus')).toBe('succeeded');
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(1000);
    });

    it.each(['refunded', 'dispute_lost', 'disputed'])(
      'a Payment at %p is NEVER re-confirmed by a success event (money-terminal states stay excluded)',
      async (terminal) => {
        const reservationId = await createReservation(1000);
        const payment = await createPendingOnline(reservationId, 1000, terminal);
        const r = await postEvent(makeEvent({
          type: 'payment_intent.succeeded', paymentId: payment.id, reservationId, eventId: nextEventId(`nores_${terminal}`),
        }));
        expect(r.body).toEqual({ received: true, handled: false });
        const reloaded = await reloadPayment(payment.id);
        expect(reloaded.get('gatewayStatus')).toBe(terminal);
        expect(reloaded.get('confirmedAt')).toBeUndefined();
      }
    );
  });

  // ---------------------------------------------------------------------------------------------
  describe('order is not guaranteed — a late succeeded never walks a terminal state backwards', () => {
    // 'expired' is deliberately NOT here: it is a legitimate source for 'succeeded' (the payer paid a
    // session our housekeeping had given up on), covered in the declined-card describe above.
    it.each(['refunded', 'dispute_lost', 'disputed'])(
      'a Payment fixed at %p ignores a late checkout.session.completed (matchedCount 0, no recalculate)',
      async (terminal) => {
        const reservationId = await createReservation(1000);
        const payment = await createPendingOnline(reservationId, 1000, terminal);
        const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
        try {
          const r = await postEvent(makeEvent({
            paymentId: payment.id, reservationId, eventId: nextEventId(`term_${terminal}`),
          }));
          expect(r.status).toBe(200);
          expect(r.body).toEqual({ received: true, handled: false });
          expect(recalcSpy).not.toHaveBeenCalled();
        } finally {
          recalcSpy.mockRestore();
        }
        // The state is exactly what it was: the conditional update selected no document.
        const reloaded = await reloadPayment(payment.id);
        expect(reloaded.get('gatewayStatus')).toBe(terminal);
        expect(reloaded.get('confirmedAt')).toBeUndefined();
      }
    );

    it('a Payment ALREADY at succeeded is not re-transitioned, but its stale rollup IS repaired', async () => {
      // Same "matchedCount 0" as the terminal states above, opposite meaning: the destination of this
      // event is exactly where the Payment already is, which is the fingerprint of a rollup that never
      // completed (a delivery that died between Capa B and the recalculate). The fixture reproduces
      // that end state literally: a succeeded Payment on a reservation whose rollup was never written.
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000, 'succeeded');
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBeUndefined();

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      const healSpy = jest.spyOn(PaymentService, 'recalculateIfStale');
      let r;
      try {
        r = await postEvent(makeEvent({
          paymentId: payment.id, reservationId, eventId: nextEventId('healstale'),
        }));
        // The repair goes through the verifying path, never through a blind recalculate.
        expect(recalcSpy).not.toHaveBeenCalled();
        expect(healSpy).toHaveBeenCalledTimes(1);
        expect(healSpy).toHaveBeenCalledWith(reservationId);
        await expect(healSpy.mock.results[0].value).resolves.toMatchObject({ healed: true });
      } finally {
        recalcSpy.mockRestore();
        healSpy.mockRestore();
      }

      expect(r.status).toBe(200);
      expect(r.body).toEqual({ received: true, handled: false }); // no NEW transition
      const reloaded = await reloadPayment(payment.id);
      expect(reloaded.get('gatewayStatus')).toBe('succeeded');
      expect(reloaded.get('confirmedAt')).toBeUndefined(); // the row itself was not rewritten
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('balance')).toBe(0);
      expect(reservation.get('paymentStatus')).toBe('paid');
    });

    it('a Payment already at failed ignores a second failure event without recomputing anything', async () => {
      // The counterpart of the case above: 'failed' does not cross the rollup line, so "already at the
      // destination" must NOT buy a recompute — not even a harmless verification.
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000, 'failed');
      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      const healSpy = jest.spyOn(PaymentService, 'recalculateIfStale');
      try {
        const r = await postEvent(makeEvent({
          type: 'payment_intent.payment_failed', paymentId: payment.id, reservationId, eventId: nextEventId('reFail'),
        }));
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ received: true, handled: false });
        expect(recalcSpy).not.toHaveBeenCalled();
        expect(healSpy).not.toHaveBeenCalled();
      } finally {
        recalcSpy.mockRestore();
        healSpy.mockRestore();
      }
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBeUndefined();
    });

    it('a SOFT-DELETED pending is still reachable and confirmable (queryAll, not queryExisting)', async () => {
      // The future TTL sweep of PR6 will soft-delete abandoned pendings; the money moving afterwards
      // must still be recorded, so Capa B has to be able to revive one.
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      payment.set('exists', false);
      await payment.save(null, { useMasterKey: true });

      const r = await postEvent(makeEvent({
        paymentId: payment.id, reservationId, eventId: nextEventId('soft'),
      }));
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ received: true, handled: true });
      expect((await reloadPayment(payment.id)).get('gatewayStatus')).toBe('succeeded');
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Capa A — the same event twice (sequential retry)', () => {
    it('a re-delivered eventId answers 200 duplicate, keeps ONE GatewayEvent and never recalculates twice', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const eventId = nextEventId('dup');
      const event = makeEvent({ paymentId: payment.id, reservationId, eventId });

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      try {
        const first = await postEvent(event);
        expect(first.body).toEqual({ received: true, handled: true });
        // Same event object => same signature => exactly what a Stripe retry sends.
        const second = await postEvent(event);
        expect(second.status).toBe(200);
        expect(second.body).toEqual({ received: true, duplicate: true });
        expect(recalcSpy).toHaveBeenCalledTimes(1);
      } finally {
        recalcSpy.mockRestore();
      }

      expect(await countEvents(eventId)).toBe(1);
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(1000);
    });

    it('a duplicate arriving SECONDS later (our own timeout, Stripe retries) is still a clean no-op', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const event = makeEvent({ paymentId: payment.id, reservationId, eventId: nextEventId('slow') });
      await postEvent(event);
      await new Promise((resolve) => { setTimeout(resolve, 1200); });
      const retry = await postEvent(event);
      expect(retry.body).toEqual({ received: true, duplicate: true });
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(1000);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('a rollup that dies after Capa B — the compensation retry must finish the job', () => {
    /**
     * Make PaymentService.recalculate fail its first `times` invocations and then run for real.
     * Reproduces the one interleaving that strands money: the Payment transitions, the rollup blows up,
     * the GatewayEvent is retracted, and the retry arrives to find nothing left to transition.
     * @param {number} times - How many leading invocations must throw.
     * @returns {object} The jest spy (restore it in a finally).
     */
    const failRecalculate = (times) => {
      const real = PaymentService.recalculate.bind(PaymentService);
      let calls = 0;
      return jest.spyOn(PaymentService, 'recalculate').mockImplementation(async (id) => {
        calls += 1;
        if (calls <= times) throw new Error('rollup caido (simulado)');
        return real(id);
      });
    };

    it('the retry of the SAME event completes the rollup even though Capa B no longer matches', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const eventId = nextEventId('heal');
      const event = makeEvent({ paymentId: payment.id, reservationId, eventId });

      const recalcSpy = failRecalculate(1);
      const healSpy = jest.spyOn(PaymentService, 'recalculateIfStale');
      try {
        const first = await postEvent(event);
        expect(first.status).toBe(500); // OUR failure => Stripe will retry

        // Capa B DID move the status (the money is confirmed)...
        expect((await reloadPayment(payment.id)).get('gatewayStatus')).toBe('succeeded');
        // ...the reservation never learned about it (this is the stranded state)...
        expect((await reloadReservation(reservationId)).get('paidAmount')).toBeUndefined();
        // ...and the Capa A marker was retracted, so the retry is not swallowed as a duplicate.
        expect(await countEvents(eventId)).toBe(0);

        const retry = await postEvent(event);
        expect(retry.status).toBe(200);
        // handled:false — there was nothing left to transition; what the retry repaired is the rollup.
        expect(retry.body).toEqual({ received: true, handled: false });
        // The stranded rollup is the unambiguous evidence, so THIS one really does write.
        expect(recalcSpy).toHaveBeenCalledTimes(1); // only the failed first attempt
        expect(healSpy).toHaveBeenCalledTimes(1);
        await expect(healSpy.mock.results[0].value).resolves.toMatchObject({ healed: true });
      } finally {
        recalcSpy.mockRestore();
        healSpy.mockRestore();
      }

      expect(await countEvents(eventId)).toBe(1); // the successful retry keeps its Capa A row
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('balance')).toBe(0);
      expect(reservation.get('paymentStatus')).toBe('paid');
    });

    it('a failed rollup AND a failed repair still converge on the third delivery (repeatable)', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const eventId = nextEventId('heal2');
      const event = makeEvent({ paymentId: payment.id, reservationId, eventId });

      // The second delivery no longer reaches recalculate (Capa B does not match any more): it reaches
      // the repair, which must fail there too for the third one to still have work to do.
      const recalcSpy = failRecalculate(1);
      const healSpy = jest.spyOn(PaymentService, 'recalculateIfStale')
        .mockRejectedValueOnce(new Error('repair caida (simulada)'));
      try {
        expect((await postEvent(event)).status).toBe(500);
        expect((await postEvent(event)).status).toBe(500);
        expect(await countEvents(eventId)).toBe(0); // retracted every time
        const third = await postEvent(event);
        expect(third.status).toBe(200);
        expect(recalcSpy).toHaveBeenCalledTimes(1);
        expect(healSpy).toHaveBeenCalledTimes(2); // one rejected, one real
        await expect(healSpy.mock.results[1].value).resolves.toMatchObject({ healed: true });
      } finally {
        recalcSpy.mockRestore();
        healSpy.mockRestore();
      }

      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('paymentStatus')).toBe('paid');
    });

    it('a DIFFERENT success event repairs it too (the heal keys on the Payment, not on the event id)', async () => {
      // Stripe does not promise that the retry is the only thing that arrives next: the sibling event
      // (payment_intent.succeeded) may show up first and must be able to finish the abandoned rollup.
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);

      const recalcSpy = failRecalculate(1);
      try {
        const first = await postEvent(makeEvent({
          paymentId: payment.id, reservationId, eventId: nextEventId('healA'),
        }));
        expect(first.status).toBe(500);
        expect((await reloadReservation(reservationId)).get('paidAmount')).toBeUndefined();

        const sibling = await postEvent(makeEvent({
          type: 'payment_intent.succeeded', paymentId: payment.id, reservationId, eventId: nextEventId('healB'),
        }));
        expect(sibling.status).toBe(200);
        expect(sibling.body).toEqual({ received: true, handled: false });
      } finally {
        recalcSpy.mockRestore();
      }

      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('paymentStatus')).toBe('paid');
    });

    it('a rollup failure on a NON-counting event is not healed later (nothing to heal)', async () => {
      // checkout.session.expired never touches the rollup, so a failure there cannot strand money and
      // the retry must not manufacture a recompute for it.
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const event = makeEvent({
        type: 'checkout.session.expired', paymentId: payment.id, reservationId, eventId: nextEventId('healExp'),
      });

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      const healSpy = jest.spyOn(PaymentService, 'recalculateIfStale');
      try {
        expect((await postEvent(event)).status).toBe(200);
        const retry = await postEvent(event); // same id => Capa A duplicate
        expect(retry.body).toEqual({ received: true, duplicate: true });
        const sibling = await postEvent(makeEvent({
          type: 'checkout.session.expired', paymentId: payment.id, reservationId, eventId: nextEventId('healExp2'),
        }));
        expect(sibling.body).toEqual({ received: true, handled: false });
        expect(recalcSpy).not.toHaveBeenCalled();
        expect(healSpy).not.toHaveBeenCalled(); // not even the verification
      } finally {
        recalcSpy.mockRestore();
        healSpy.mockRestore();
      }
      expect((await reloadPayment(payment.id)).get('gatewayStatus')).toBe('expired');
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('uncorrelatable / out-of-scope events — recorded, never a 500, never a new Payment', () => {
    const paymentCount = async () => new Parse.Query('Payment').count({ useMasterKey: true });

    it.each([
      ['a paymentId that does not exist in this database', 'objectIdQueNoExiste99'],
      ['an empty paymentId', ''],
      ['a paymentId with only spaces', '   '],
      ['a syntactically impossible paymentId', '../../etc/passwd'],
      ['a very long paymentId', 'x'.repeat(500)],
    ])('%s => 200, Capa A row created, zero Payments created', async (_label, paymentId) => {
      const eventId = nextEventId('anom');
      const beforeCount = await paymentCount();
      const r = await postEvent(makeEvent({ paymentId, eventId }));
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ received: true, handled: false });
      // Capa A does NOT depend on being able to locate the Payment: the event is recorded regardless.
      expect(await countEvents(eventId)).toBe(1);
      expect(await paymentCount()).toBe(beforeCount);
    });

    it('an event with NO metadata at all => 200, recorded, nothing created', async () => {
      const eventId = nextEventId('nometa');
      const r = await postEvent(makeEvent({ eventId }));
      expect(r.status).toBe(200);
      expect(await countEvents(eventId)).toBe(1);
    });

    it.each(['charge.refunded', 'charge.dispute.created', 'invoice.paid', 'evento.inventado'])(
      'out-of-scope type %p => 200, recorded with its real type, Payment untouched',
      async (type) => {
        const reservationId = await createReservation(1000);
        const payment = await createPendingOnline(reservationId, 1000);
        const eventId = nextEventId('oos');
        const r = await postEvent(makeEvent({
          type, paymentId: payment.id, reservationId, eventId,
        }));
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ received: true, handled: false });
        const row = await findEvent(eventId);
        expect(row.get('type')).toBe(type);
        expect((await reloadPayment(payment.id)).get('gatewayStatus')).toBe('requires_payment');
      }
    );
  });

  // ---------------------------------------------------------------------------------------------
  describe('rejected deliveries — nothing is written at all', () => {
    it('an invalid signature => 400, zero GatewayEvent, Payment untouched', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const eventId = nextEventId('badsig');
      const r = await postEvent(makeEvent({ paymentId: payment.id, reservationId, eventId }), {
        secret: 'whsec_a_secret_we_do_not_trust',
      });
      expect(r.status).toBe(400);
      expect(await countEvents(eventId)).toBe(0);
      expect((await reloadPayment(payment.id)).get('gatewayStatus')).toBe('requires_payment');
    });

    it('no stripe-signature header => 400, nothing written', async () => {
      const eventId = nextEventId('nosig');
      const payload = JSON.stringify(makeEvent({ eventId }));
      const r = await request(app)
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .send(payload);
      expect(r.status).toBe(400);
      expect(await countEvents(eventId)).toBe(0);
    });

    it('a tampered body (amount raised after signing) => 400', async () => {
      const event = makeEvent({ eventId: nextEventId('tamper') });
      const payload = JSON.stringify(event);
      const header = sign(payload);
      const tampered = JSON.stringify({ ...event, data: { object: { ...event.data.object, amount_total: 999999999 } } });
      const r = await request(app)
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', header)
        .send(tampered);
      expect(r.status).toBe(400);
    });

    it('a LIVE event in this (non-production) environment => 400, nothing written', async () => {
      const eventId = nextEventId('live');
      const event = { ...makeEvent({ eventId }), livemode: true };
      const r = await postEvent(event);
      expect(r.status).toBe(400);
      expect(await countEvents(eventId)).toBe(0);
    });

    it('no configured secret => 503 (NOT 400) and nothing written', async () => {
      delete process.env.STRIPE_WEBHOOK_SECRETS;
      const eventId = nextEventId('unconf');
      const r = await postEvent(makeEvent({ eventId }));
      expect(r.status).toBe(503);
      expect(await countEvents(eventId)).toBe(0);
      process.env.STRIPE_WEBHOOK_SECRETS = SECRET_A;
    });

    it('garbage (non-JSON) body with a valid-looking signature => 400, no crash', async () => {
      const r = await request(app)
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', sign('{"a":1}'))
        .send('not json at all <<<>>>');
      expect(r.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('secret rotation on the live endpoint', () => {
    it('with two secrets configured, an event signed by the SECOND one is accepted', async () => {
      process.env.STRIPE_WEBHOOK_SECRETS = `${SECRET_A},${SECRET_B}`;
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const r = await postEvent(makeEvent({
        paymentId: payment.id, reservationId, eventId: nextEventId('rot'),
      }), { secret: SECRET_B });
      expect(r.status).toBe(200);
      expect((await reloadPayment(payment.id)).get('gatewayStatus')).toBe('succeeded');
      process.env.STRIPE_WEBHOOK_SECRETS = SECRET_A;
    });

    it('after rotation completes (old secret dropped), the old signature is rejected', async () => {
      process.env.STRIPE_WEBHOOK_SECRETS = SECRET_B;
      const r = await postEvent(makeEvent({ eventId: nextEventId('rotold') }), { secret: SECRET_A });
      expect(r.status).toBe(400);
      process.env.STRIPE_WEBHOOK_SECRETS = SECRET_A;
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('the signature is the ONLY authentication (public route)', () => {
    it('a signed event with no Authorization header is processed normally', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const r = await postEvent(makeEvent({
        paymentId: payment.id, reservationId, eventId: nextEventId('noauth'),
      }));
      expect(r.status).toBe(200);
      expect(r.body.handled).toBe(true);
    });

    it('a BOGUS Authorization header changes nothing (it is simply ignored)', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const r = await postEvent(makeEvent({
        paymentId: payment.id, reservationId, eventId: nextEventId('bogusauth'),
      }), { headers: { Authorization: 'Bearer not.a.real.token' } });
      expect(r.status).toBe(200);
      expect(r.body.handled).toBe(true);
    });

    it('a valid JWT does NOT substitute for a signature', async () => {
      const eventId = nextEventId('jwtonly');
      const payload = JSON.stringify(makeEvent({ eventId }));
      const r = await request(app)
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .send(payload);
      expect(r.status).toBe(400);
      expect(await countEvents(eventId)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('PCI — no card-adjacent field survives, in logs or in the database', () => {
    it('the persisted GatewayEvent.raw is the redacted shape only', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const eventId = nextEventId('pciraw');
      await postEvent(makeEvent({ paymentId: payment.id, reservationId, eventId }));

      const row = await findEvent(eventId);
      const raw = row.get('raw');
      expect(Object.keys(raw).sort()).toEqual(
        ['amount', 'charge', 'currency', 'id', 'object', 'paymentIntent', 'status'].sort()
      );
      expect(JSON.stringify(raw)).not.toContain('4242');
      expect(JSON.stringify(raw)).not.toContain('visa');
      expect(JSON.stringify(raw)).not.toContain('pagador@example.com');
      // The dedicated columns carry the identity, not `raw`.
      expect(row.get('eventId')).toBe(eventId);
      expect(row.get('type')).toBe('checkout.session.completed');
      expect(row.get('processedAt')).toBeInstanceOf(Date);
      expect(row.get('gateway')).toBe('stripe');
    });

    it('no logger call carries card data or the whole SDK object', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const captured = [];
      const capture = (...args) => { captured.push(JSON.stringify(args)); };
      const spies = ['info', 'warn', 'error', 'debug']
        .map((level) => jest.spyOn(logger, level).mockImplementation(capture));
      try {
        await postEvent(makeEvent({
          paymentId: payment.id, reservationId, eventId: nextEventId('pcilog'),
        }));
        // Also exercise the rejection paths, which log too.
        await postEvent(makeEvent({ paymentId: payment.id, eventId: nextEventId('pcilog2') }), {
          secret: 'whsec_wrong_one_here',
        });
        await postEvent(makeEvent({ paymentId: 'noexiste', eventId: nextEventId('pcilog3') }));
      } finally {
        spies.forEach((s) => s.mockRestore());
      }

      const blob = captured.join('\n');
      expect(blob.length).toBeGreaterThan(0);
      for (const forbidden of ['4242', 'visa', 'last4', 'payment_method_details', 'customer_details', 'pagador@example.com', 'exp_month']) {
        expect(blob).not.toContain(forbidden);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Kept LAST on purpose: it deliberately exhausts the webhook limiter's window.
  describe('rate limiter — its own instance, isolated from the rest of the API', () => {
    it('over 100 requests in the window => 429 on the excess, and /api/reservations is unaffected', async () => {
      resetRateLimiters(app);
      const payload = JSON.stringify({ id: nextEventId('flood'), type: 'checkout.session.completed' });
      const fire = () => request(app)
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'deliberately-invalid')
        .send(payload);

      const statuses = [];
      for (let i = 0; i < 100; i += 1) {
        statuses.push((await fire()).status); // eslint-disable-line no-await-in-loop
      }
      expect(statuses.every((s) => s === 400)).toBe(true); // all inside the window, all rejected on signature

      const overflow = await fire();
      expect(overflow.status).toBe(429);

      // A different limiter instance entirely: the reservations router still answers its own 401.
      const reservations = await request(app).get('/api/reservations');
      expect(reservations.status).not.toBe(429);
      expect(reservations.status).toBe(401);

      resetRateLimiters(app);
    }, 60000);
  });
});
