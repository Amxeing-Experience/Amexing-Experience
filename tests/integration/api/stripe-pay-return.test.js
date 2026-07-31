/**
 * GET /api/reservations/:id/pay/success — defensive polling (full app + Parse real + memory Mongo,
 * Stripe SDK mocked, zero network).
 *
 * This is a PUBLIC, unauthenticated route that can move money, so the suite is built around the
 * three properties that make that acceptable:
 *
 * - OWNERSHIP. A session id belonging to reservation A, visited with reservation B in the URL, must
 *   change nothing and reveal nothing — not even by answering differently.
 * - THE OUTGOING CALL IS EARNED. Garbage, unknown and already-terminal sessions never reach Stripe;
 *   'failed' and 'expired' rows DO, because a declined card leaves the session open and the payer
 *   retries on it, and no other mechanism of this PR ever looks at a failed row.
 * - IT ONLY WRITES 'succeeded'. Anything else Stripe reports is read-only here: an anonymous route
 *   that could push a live row to failed/expired would hide it from the checkout reuse logic and
 *   turn the orphan-session bug into an anonymous double-charge trigger.
 */

const request = require('supertest');
const Parse = require('parse/node');
const Payment = require('../../../src/domain/models/Payment');
const PaymentService = require('../../../src/application/services/PaymentService');
const StripeWebhookController = require('../../../src/application/controllers/api/StripeWebhookController');
const housekeeping = require('../../../src/application/services/payments/paymentHousekeeping');
const stripeClient = require('../../../src/infrastructure/payments/stripeClient');
const atomicStore = require('../../../src/infrastructure/payments/paymentAtomicStore');

const RUN = `pr${Date.now().toString(36)}`;
const RATE_LIMIT_KEYS = ['::ffff:127.0.0.1', '127.0.0.1', '::1'];
const GENERIC = 'Pago recibido, en confirmación. La reservación se actualiza automáticamente en cuanto la pasarela confirme el cobro.';

/**
 * Reset every express-rate-limit middleware in the app for the known test IPs.
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

describe('GET /api/reservations/:id/pay/success (integration)', () => {
  let app;
  const created = [];
  const savedFlag = process.env.PAYMENTS_ENABLED;
  let retrieveSession;
  let retrieveIntent;

  const reservationPtr = (id) => {
    const ptr = new Parse.Object('Reservation');
    ptr.id = id;
    return ptr;
  };

  const createReservation = async (total = 1000, currency = 'MXN', status = 'confirmed') => {
    const reservation = new Parse.Object('Reservation');
    reservation.set('active', true);
    reservation.set('exists', true);
    reservation.set('status', status);
    reservation.set('paymentType', 'efectivo');
    reservation.set('currency', currency);
    if (currency === 'USD') reservation.set('exchangeRateSnapshot', 18.5);
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

  let sessionCounter = 0;
  const nextSession = () => {
    sessionCounter += 1;
    return `cs_test_${RUN}_${sessionCounter}`;
  };

  const createPendingOnline = async ({
    reservationId, amount = 1000, gatewayStatus = 'requires_payment', sessionId, origCurrency = 'MXN',
    origAmount, exists = true, retiredBySystem,
  }) => {
    const p = new Payment();
    p.set('reservationPtr', reservationPtr(reservationId));
    p.set('amount', amount);
    p.set('origAmount', origAmount === undefined ? amount : origAmount);
    p.set('origCurrency', origCurrency);
    p.set('method', 'tarjeta');
    p.set('channel', 'online');
    p.set('gateway', 'stripe');
    p.set('gatewayStatus', gatewayStatus);
    p.set('gatewaySessionId', sessionId || nextSession());
    p.set('expiresAt', new Date(Date.now() + 30 * 60 * 1000));
    p.set('active', exists);
    p.set('exists', exists);
    if (retiredBySystem !== undefined) p.set('retiredBySystem', retiredBySystem);
    await p.save(null, { useMasterKey: true });
    created.push(p);
    return p;
  };

  const reload = async (id) => new Parse.Query('Payment').get(id, { useMasterKey: true });
  const reloadReservation = async (id) => new Parse.Query('Reservation').get(id, { useMasterKey: true });

  // The Stripe objects the mocked SDK hands back, with card-adjacent junk so PCI has something real
  // to catch.
  const paidSession = ({
    sessionId, paymentId, reservationId, amountMinor = 100000, currency = 'mxn',
  }) => ({
    id: sessionId,
    object: 'checkout.session',
    status: 'complete',
    payment_status: 'paid',
    currency,
    amount_total: amountMinor,
    metadata: { reservationId, paymentId },
    customer_details: { email: 'pagador@example.com' },
    payment_intent: {
      id: `pi_${sessionId}`,
      object: 'payment_intent',
      status: 'succeeded',
      currency,
      amount_received: amountMinor,
      latest_charge: `ch_${sessionId}`,
      metadata: { reservationId, paymentId },
      payment_method_details: { card: { last4: '4242', brand: 'visa' } },
    },
  });

  const openSession = ({ sessionId, paymentId, reservationId }) => ({
    id: sessionId,
    object: 'checkout.session',
    status: 'open',
    payment_status: 'unpaid',
    currency: 'mxn',
    amount_total: 100000,
    metadata: { reservationId, paymentId },
    payment_intent: { id: `pi_${sessionId}`, status: 'requires_payment_method', amount_received: 0 },
  });

  const expiredSession = ({ sessionId, paymentId, reservationId }) => ({
    id: sessionId,
    object: 'checkout.session',
    status: 'expired',
    payment_status: 'unpaid',
    currency: 'mxn',
    amount_total: 100000,
    metadata: { reservationId, paymentId },
    payment_intent: { id: `pi_${sessionId}`, status: 'canceled', amount_received: 0 },
  });

  const visit = (reservationId, sessionId) => {
    const req = request(app).get(`/api/reservations/${reservationId}/pay/success`);
    return sessionId === undefined ? req : req.query({ session_id: sessionId });
  };

  const confirmViaWebhook = (payment, reservationId) => StripeWebhookController.applyToPayment({
    id: `evt_${RUN}_${payment.id}`,
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_x', metadata: { paymentId: payment.id, reservationId } } },
  }, { gatewayStatus: 'succeeded', crossesThreshold: true });

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    Parse.initialize('test-app-id', null, 'test-master-key');
    Parse.serverURL = 'http://localhost:1339/parse';
    Parse.masterKey = 'test-master-key';
  }, 60000);

  // The two CONV cases below drive the background jobs, which scan the WHOLE Payment collection. Any
  // row still lying around — from an earlier case here or from a sibling suite — would join their
  // batch and make "exactly one recalculate" mean nothing. Wiping per case is what keeps those counts
  // exact; with --runInBand no other suite is mid-flight.
  const wipePayments = async () => {
    const q = new Parse.Query('Payment');
    q.limit(1000);
    const rows = await q.find({ useMasterKey: true });
    if (rows.length) await Parse.Object.destroyAll(rows, { useMasterKey: true });
  };

  beforeEach(async () => {
    resetRateLimiters(app);
    retrieveSession = jest.fn();
    retrieveIntent = jest.fn();
    stripeClient.setClientForTests({
      checkout: { sessions: { retrieve: retrieveSession } },
      paymentIntents: { retrieve: retrieveIntent },
    });
    process.env.PAYMENTS_ENABLED = 'true';
    await wipePayments();
  });

  afterAll(async () => {
    stripeClient.resetForTests();
    if (savedFlag === undefined) delete process.env.PAYMENTS_ENABLED;
    else process.env.PAYMENTS_ENABLED = savedFlag;
    for (const o of created) {
      try { await o.destroy({ useMasterKey: true }); } catch { /* gone */ }
    }
    await atomicStore.closeForTests();
  }, 60000);

  // -----------------------------------------------------------------------------------------
  describe('PL-I1 — the happy path', () => {
    it('confirms the charge, moves the rollup, and answers the generic message with no Stripe data', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline({ reservationId });
      const sessionId = payment.get('gatewaySessionId');
      retrieveSession.mockResolvedValue(paidSession({ sessionId, paymentId: payment.id, reservationId }));

      const r = await visit(reservationId, sessionId);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ success: true, message: GENERIC });
      // No provider detail whatsoever reaches the payer's browser.
      const body = JSON.stringify(r.body);
      expect(body).not.toContain('cs_test');
      expect(body).not.toContain('4242');
      expect(body).not.toContain('succeeded');

      const row = await reload(payment.id);
      expect(row.get('gatewayStatus')).toBe('succeeded');
      expect(row.get('confirmedAt')).toBeInstanceOf(Date);
      expect(row.get('gatewayChargeId')).toBe(`ch_${sessionId}`);

      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('balance')).toBe(0);
      expect(reservation.get('paymentStatus')).toBe('paid');
    });

    it('PL-I13: a partial online charge leaves the reservation partial with the exact balance', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline({ reservationId, amount: 400 });
      const sessionId = payment.get('gatewaySessionId');
      retrieveSession.mockResolvedValue(paidSession({
        sessionId, paymentId: payment.id, reservationId, amountMinor: 40000,
      }));

      await visit(reservationId, sessionId);
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(400);
      expect(reservation.get('balance')).toBe(600);
      expect(reservation.get('paymentStatus')).toBe('partial');
    });

    it('PL-I14: a USD reservation counts the FROZEN origAmount, with no reconversion', async () => {
      const reservationId = await createReservation(100, 'USD');
      // 100 USD at the frozen snapshot 18.5 => 1850 MXN stored in `amount`.
      const payment = await createPendingOnline({
        reservationId, amount: 1850, origAmount: 100, origCurrency: 'USD',
      });
      const sessionId = payment.get('gatewaySessionId');
      retrieveSession.mockResolvedValue(paidSession({
        sessionId, paymentId: payment.id, reservationId, amountMinor: 10000, currency: 'usd',
      }));

      await visit(reservationId, sessionId);
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(100); // exact USD snapshot, never 1850/18.5 drift
      expect(reservation.get('balance')).toBe(0);
      expect(reservation.get('paymentStatus')).toBe('paid');
      const row = await reload(payment.id);
      expect(row.get('origAmount')).toBe(100);
      expect(row.get('origCurrency')).toBe('USD');
      expect(row.get('amount')).toBe(1850);
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('PL-I2/PL-I7 — when the outgoing call happens, and when it does not', () => {
    it('PL-I2: after the row is terminal, a second visit answers locally without calling Stripe', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline({ reservationId });
      const sessionId = payment.get('gatewaySessionId');
      retrieveSession.mockResolvedValue(paidSession({ sessionId, paymentId: payment.id, reservationId }));

      await visit(reservationId, sessionId);
      await visit(reservationId, sessionId);
      await visit(reservationId, sessionId);
      // ONE call in total: the first visit confirmed, and 'succeeded' can no longer reach 'succeeded'.
      expect(retrieveSession).toHaveBeenCalledTimes(1);
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(1000);
    });

    it.each(['succeeded', 'refunded', 'disputed', 'dispute_lost'])(
      'a row already at %p never calls Stripe (nothing could legally apply any more)',
      async (status) => {
        const reservationId = await createReservation(1000);
        const payment = await createPendingOnline({ reservationId, gatewayStatus: status });
        const r = await visit(reservationId, payment.get('gatewaySessionId'));
        expect(r.status).toBe(200);
        expect(retrieveSession).not.toHaveBeenCalled();
        expect((await reload(payment.id)).get('gatewayStatus')).toBe(status);
      }
    );

    it.each(['requires_payment', 'processing', 'failed', 'expired'])(
      'PL-I7: a row at %p DOES call Stripe — it is not terminal and this is its only safety net',
      async (status) => {
        const reservationId = await createReservation(1000);
        const payment = await createPendingOnline({ reservationId, gatewayStatus: status });
        const sessionId = payment.get('gatewaySessionId');
        retrieveSession.mockResolvedValue(paidSession({ sessionId, paymentId: payment.id, reservationId }));

        await visit(reservationId, sessionId);
        expect(retrieveSession).toHaveBeenCalledTimes(1);
        expect(retrieveSession).toHaveBeenCalledWith(sessionId, { expand: ['payment_intent'] });
        // And a declined card that was retried successfully really is confirmed from here.
        expect((await reload(payment.id)).get('gatewayStatus')).toBe('succeeded');
        expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(1000);
      }
    );
  });

  // -----------------------------------------------------------------------------------------
  describe('PL-I8 — the polling only ever WRITES succeeded', () => {
    it.each([
      ['an expired session', expiredSession],
      ['a still-open session with a declined intent', openSession],
    ])('%s changes nothing at all', async (_label, build) => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline({ reservationId });
      const sessionId = payment.get('gatewaySessionId');
      retrieveSession.mockResolvedValue(build({ sessionId, paymentId: payment.id, reservationId }));

      const before = await reload(payment.id);
      const stamp = before.updatedAt.getTime();

      const r = await visit(reservationId, sessionId);
      expect(r.body).toEqual({ success: true, message: GENERIC });

      const after = await reload(payment.id);
      expect(after.get('gatewayStatus')).toBe('requires_payment'); // never 'expired', never 'failed'
      expect(after.get('exists')).toBe(true);
      expect(after.updatedAt.getTime()).toBe(stamp); // literally not rewritten
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBeUndefined();
    });

    it('a canceled intent on a still-open session is NOT written either (read-only branch)', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline({ reservationId });
      const sessionId = payment.get('gatewaySessionId');
      retrieveSession.mockResolvedValue({
        id: sessionId,
        object: 'checkout.session',
        status: 'open',
        currency: 'mxn',
        metadata: { reservationId, paymentId: payment.id },
        payment_intent: { id: `pi_${sessionId}`, status: 'canceled', amount_received: 0 },
      });
      await visit(reservationId, sessionId);
      expect((await reload(payment.id)).get('gatewayStatus')).toBe('requires_payment');
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('PL-I4/PL-I5/PL-I6 — ownership and hostile input', () => {
    it('PL-I4: a session of reservation A visited with reservation B in the URL changes NOTHING', async () => {
      const resA = await createReservation(1000);
      const resB = await createReservation(2000);
      const paymentA = await createPendingOnline({ reservationId: resA });
      const sessionId = paymentA.get('gatewaySessionId');
      retrieveSession.mockResolvedValue(paidSession({ sessionId, paymentId: paymentA.id, reservationId: resA }));

      const r = await visit(resB, sessionId);
      expect(r.status).toBe(200); // never a 404/403 that would confirm A exists
      expect(r.body).toEqual({ success: true, message: GENERIC });
      // Rejected LOCALLY: Stripe was never even asked about somebody else's session.
      expect(retrieveSession).not.toHaveBeenCalled();

      expect((await reload(paymentA.id)).get('gatewayStatus')).toBe('requires_payment');
      expect((await reloadReservation(resA)).get('paidAmount')).toBeUndefined();
      expect((await reloadReservation(resB)).get('paidAmount')).toBeUndefined();
    });

    it('PL-I5: metadata that CLAIMS the session belongs here is not enough — both sources must agree', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline({ reservationId });
      const sessionId = payment.get('gatewaySessionId');
      // The local row does belong here, but Stripe reports the session was created for another
      // reservation/payment. Trusting either source alone is what this rejects.
      retrieveSession.mockResolvedValue(paidSession({
        sessionId, paymentId: 'otroPaymentId', reservationId: 'otraReservacion',
      }));

      const r = await visit(reservationId, sessionId);
      expect(r.body).toEqual({ success: true, message: GENERIC });
      expect((await reload(payment.id)).get('gatewayStatus')).toBe('requires_payment');
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBeUndefined();
    });

    it('metadata whose paymentId points at a DIFFERENT row of the same reservation is rejected too', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline({ reservationId });
      const other = await createPendingOnline({ reservationId, gatewayStatus: 'expired' });
      const sessionId = payment.get('gatewaySessionId');
      retrieveSession.mockResolvedValue(paidSession({
        sessionId, paymentId: other.id, reservationId,
      }));

      await visit(reservationId, sessionId);
      expect((await reload(payment.id)).get('gatewayStatus')).toBe('requires_payment');
      expect((await reload(other.id)).get('gatewayStatus')).toBe('expired');
    });

    it.each([
      ['no session_id at all', undefined],
      ['an empty session_id', ''],
      ['only whitespace', '   '],
      ['a non-cs_ value', 'pi_test_123'],
      ['a path traversal', '../../etc/passwd'],
      ['an SQL-ish injection', "cs_test_1' OR '1'='1"],
      ['a NoSQL-ish injection', '{"$ne":null}'],
      ['an XSS payload', '<script>alert(1)</script>'],
      ['a 5000-char id', `cs_test_${'x'.repeat(5000)}`],
      ['a cs_ id with hostile characters', 'cs_test_../../../secret'],
      ['a unicode lookalike', 'cs_test_ｅｖｉｌ'],
      ['a newline injection', 'cs_test_1\nX-Injected: 1'],
    ])('PL-I6: %s => the same generic 200, no Stripe call, nothing written', async (_label, sessionId) => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline({ reservationId });
      const r = await visit(reservationId, sessionId);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ success: true, message: GENERIC });
      // The raw value is never echoed back to the caller.
      if (typeof sessionId === 'string' && sessionId.length > 3) {
        expect(JSON.stringify(r.body)).not.toContain(sessionId.slice(0, 12));
      }
      expect(retrieveSession).not.toHaveBeenCalled();
      expect((await reload(payment.id)).get('gatewayStatus')).toBe('requires_payment');
    });

    it('a well-formed session id nobody owns => generic 200, no Stripe call', async () => {
      const reservationId = await createReservation(1000);
      const r = await visit(reservationId, 'cs_test_esta_sesion_no_existe');
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ success: true, message: GENERIC });
      expect(retrieveSession).not.toHaveBeenCalled();
    });

    it('a reservation id that does not exist => generic 200, nothing created', async () => {
      const r = await visit('reservacionInexistente', 'cs_test_lo_que_sea_1');
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ success: true, message: GENERIC });
    });

    it('a Stripe failure (resource_missing) => generic 200, never a 500, nothing written', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline({ reservationId });
      const err = new Error('No such checkout.session');
      err.code = 'resource_missing';
      retrieveSession.mockRejectedValue(err);

      const r = await visit(reservationId, payment.get('gatewaySessionId'));
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ success: true, message: GENERIC });
      expect((await reload(payment.id)).get('gatewayStatus')).toBe('requires_payment');
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('PL-I3 — the REAL race against the webhook', () => {
    it('polling and webhook fired together: one recalculate, the exact amount, never double', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline({ reservationId });
      const sessionId = payment.get('gatewaySessionId');
      retrieveSession.mockResolvedValue(paidSession({ sessionId, paymentId: payment.id, reservationId }));

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      try {
        await Promise.all([
          visit(reservationId, sessionId),
          confirmViaWebhook(payment, reservationId),
        ]);
        expect(recalcSpy).toHaveBeenCalledTimes(1);
        expect(recalcSpy).toHaveBeenCalledWith(reservationId);
      } finally {
        recalcSpy.mockRestore();
      }

      expect((await reload(payment.id)).get('gatewayStatus')).toBe('succeeded');
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000); // never 2000
      expect(reservation.get('balance')).toBe(0);
      expect(reservation.get('paymentStatus')).toBe('paid');
    }, 30000);

    it('two simultaneous visits of the same URL confirm exactly once', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline({ reservationId });
      const sessionId = payment.get('gatewaySessionId');
      retrieveSession.mockResolvedValue(paidSession({ sessionId, paymentId: payment.id, reservationId }));

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      try {
        const responses = await Promise.all([
          visit(reservationId, sessionId),
          visit(reservationId, sessionId),
        ]);
        expect(responses.map((r) => r.status)).toEqual([200, 200]);
        expect(recalcSpy).toHaveBeenCalledTimes(1);
      } finally {
        recalcSpy.mockRestore();
      }
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(1000);
    }, 30000);
  });

  // -----------------------------------------------------------------------------------------
  // The two remaining pairs of the convergence matrix. Both are REAL races (Promise.all), because a
  // sequential version would pass even against the fetch-then-save this whole PR exists to remove.
  describe('CONV-2/CONV-3 — polling racing the two background jobs', () => {
    it('CONV-2: polling vs reconciliation => one recalculate, the exact amount', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline({ reservationId });
      const sessionId = payment.get('gatewaySessionId');
      // Both paths ask Stripe about the same session and get the same truth.
      retrieveSession.mockResolvedValue(paidSession({ sessionId, paymentId: payment.id, reservationId }));
      // Make the row old enough to be a reconciliation candidate.
      payment.set('expiresAt', new Date(Date.now() - 60 * 60 * 1000));
      await payment.save(null, { useMasterKey: true });

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      try {
        await Promise.all([
          visit(reservationId, sessionId),
          housekeeping.reconcileStalePayments(),
        ]);
        expect(recalcSpy).toHaveBeenCalledTimes(1);
        expect(recalcSpy).toHaveBeenCalledWith(reservationId);
      } finally {
        recalcSpy.mockRestore();
      }

      const row = await reload(payment.id);
      expect(row.get('gatewayStatus')).toBe('succeeded');
      expect(row.get('exists')).toBe(true);
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000); // never 2000
      expect(reservation.get('balance')).toBe(0);
    }, 30000);

    it('CONV-3: polling vs the TTL sweep => the charge ends visible and counted exactly once', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline({ reservationId });
      const sessionId = payment.get('gatewaySessionId');
      retrieveSession.mockResolvedValue(paidSession({ sessionId, paymentId: payment.id, reservationId }));
      payment.set('expiresAt', new Date(Date.now() - 60 * 60 * 1000));
      await payment.save(null, { useMasterKey: true });

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      try {
        await Promise.all([
          visit(reservationId, sessionId),
          housekeeping.sweepExpiredOnlinePayments(),
        ]);
        expect(recalcSpy).toHaveBeenCalledTimes(1);
      } finally {
        recalcSpy.mockRestore();
      }

      // Whichever landed first, the confirmation revives what the sweep retired.
      const row = await reload(payment.id);
      expect(row.get('gatewayStatus')).toBe('succeeded');
      expect(row.get('exists')).toBe(true);
      expect(row.get('retiredBySystem')).toBe(false);
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('balance')).toBe(0);
      expect(reservation.get('paymentStatus')).toBe('paid');
    }, 30000);
  });

  // -----------------------------------------------------------------------------------------
  describe('PL-I11 — ADR-3 applies here too: a discrepancy never rewrites the record', () => {
    it.each([
      ['a HIGHER amount than expected', 150000, 'mxn'],
      ['a LOWER amount than expected', 50000, 'mxn'],
      ['a different CURRENCY', 100000, 'usd'],
    ])('%s leaves amount/origAmount/origCurrency bit-identical', async (_label, amountMinor, currency) => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline({ reservationId });
      const sessionId = payment.get('gatewaySessionId');
      retrieveSession.mockResolvedValue(paidSession({
        sessionId, paymentId: payment.id, reservationId, amountMinor, currency,
      }));

      const before = await reload(payment.id);
      const snapshot = {
        amount: before.get('amount'),
        origAmount: before.get('origAmount'),
        origCurrency: before.get('origCurrency'),
        exchangeRate: before.get('exchangeRate'),
      };

      await visit(reservationId, sessionId);

      const after = await reload(payment.id);
      expect(after.get('amount')).toBe(snapshot.amount);
      expect(after.get('origAmount')).toBe(snapshot.origAmount);
      expect(after.get('origCurrency')).toBe(snapshot.origCurrency);
      expect(after.get('exchangeRate')).toBe(snapshot.exchangeRate);
      // The transition itself still happens: the money DID move, it is just not silently re-priced.
      expect(after.get('gatewayStatus')).toBe('succeeded');
      // And the rollup counts the LOCAL amount, never what Stripe reported.
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(1000);
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('the revive reaches this path too', () => {
    it('a row the sweep retired is brought back and counted when the polling confirms it', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline({
        reservationId, gatewayStatus: 'expired', exists: false, retiredBySystem: true,
      });
      const sessionId = payment.get('gatewaySessionId');
      retrieveSession.mockResolvedValue(paidSession({ sessionId, paymentId: payment.id, reservationId }));

      await visit(reservationId, sessionId);

      const row = await reload(payment.id);
      expect(row.get('gatewayStatus')).toBe('succeeded');
      expect(row.get('exists')).toBe(true);
      expect(row.get('active')).toBe(true);
      expect(row.get('retiredBySystem')).toBe(false);
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(1000);
    });

    it('a row staff deleted DELIBERATELY is confirmed but never revived (the balance stays untouched)', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline({
        reservationId, gatewayStatus: 'expired', exists: false, // no retiredBySystem marker
      });
      const sessionId = payment.get('gatewaySessionId');
      retrieveSession.mockResolvedValue(paidSession({ sessionId, paymentId: payment.id, reservationId }));

      await visit(reservationId, sessionId);

      const row = await reload(payment.id);
      expect(row.get('gatewayStatus')).toBe('succeeded'); // detectable: this is the runbook query
      expect(row.get('exists')).toBe(false); // the human decision stands
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(0);
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('PL-I12 — the feature flag gates STARTING a charge, never recording one', () => {
    it('with PAYMENTS_ENABLED off the confirmation still happens', async () => {
      // If someone ever "hardens" getStripeClient with the flag, this test is what catches it: the
      // option we chose silently becomes the one we rejected.
      process.env.PAYMENTS_ENABLED = 'false';
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline({ reservationId });
      const sessionId = payment.get('gatewaySessionId');
      retrieveSession.mockResolvedValue(paidSession({ sessionId, paymentId: payment.id, reservationId }));

      const r = await visit(reservationId, sessionId);
      expect(r.status).toBe(200);
      expect(retrieveSession).toHaveBeenCalledTimes(1);
      expect((await reload(payment.id)).get('gatewayStatus')).toBe('succeeded');
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(1000);
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('CANC — a charge confirmed through this path on a cancelled reservation', () => {
    it('CANC-1: records it, updates the rollup, and leaves the persistent refund-review mark', async () => {
      const reservationId = await createReservation(1000, 'MXN', 'cancelled');
      const payment = await createPendingOnline({ reservationId });
      const sessionId = payment.get('gatewaySessionId');
      retrieveSession.mockResolvedValue(paidSession({ sessionId, paymentId: payment.id, reservationId }));

      await visit(reservationId, sessionId);

      const row = await reload(payment.id);
      expect(row.get('gatewayStatus')).toBe('succeeded');
      expect(row.get('requiresRefundReview')).toBe(true);
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(1000);
    });

    it('CANC-2: the same charge on a LIVE reservation leaves no mark', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline({ reservationId });
      const sessionId = payment.get('gatewaySessionId');
      retrieveSession.mockResolvedValue(paidSession({ sessionId, paymentId: payment.id, reservationId }));

      await visit(reservationId, sessionId);
      expect((await reload(payment.id)).get('requiresRefundReview')).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------------------------
  // Kept LAST on purpose: it deliberately exhausts this route's own limiter window.
  describe('PL-I9/PL-I10 — public, but with its own ceiling', () => {
    it('PL-I9: no JWT is required (a plain browser visit is never a 401)', async () => {
      const reservationId = await createReservation(1000);
      const r = await visit(reservationId, 'cs_test_sin_token_alguno');
      expect(r.status).toBe(200);
      expect(r.status).not.toBe(401);
    });

    it('a bogus Authorization header changes nothing (it is simply ignored)', async () => {
      const reservationId = await createReservation(1000);
      const r = await request(app)
        .get(`/api/reservations/${reservationId}/pay/success`)
        .query({ session_id: 'cs_test_con_token_falso' })
        .set('Authorization', 'Bearer not.a.real.token');
      expect(r.status).toBe(200);
    });

    it('PL-I10: its own limiter is far tighter than the shared read limiter (60, not 400)', async () => {
      resetRateLimiters(app);
      const reservationId = await createReservation(1000);
      const statuses = [];
      for (let i = 0; i < 60; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        statuses.push((await visit(reservationId, `cs_test_flood_${i}`)).status);
      }
      expect(statuses.every((s) => s === 200)).toBe(true);
      const overflow = await visit(reservationId, 'cs_test_flood_overflow');
      expect(overflow.status).toBe(429);

      // A different limiter instance entirely: the authenticated router still answers its own 401.
      const other = await request(app).get('/api/reservations');
      expect(other.status).toBe(401);
      resetRateLimiters(app);
    }, 60000);
  });
});
