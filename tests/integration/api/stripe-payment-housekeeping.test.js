/**
 * The two background safety nets — TTL sweep and reconciliation (full Parse + memory Mongo, Stripe
 * SDK mocked, zero network).
 *
 * The sweep is asserted mostly by what it must NOT touch: manual payments, live pendings, anything
 * already terminal, and above all 'processing'. `expiresAt` is stamped once at creation and never
 * refreshed, so every processing row satisfies the threshold by construction — retiring one would be
 * retiring money still in flight at the provider.
 *
 * The reconciliation is asserted mostly by its candidate query. The sweep retires every
 * 'requires_payment' row every ~35 minutes BY DESIGN, so a live-only query would find nothing in
 * normal operation and the job would be born dead: a real charge whose webhook never arrived sits at
 * 'expired' + exists:false, invisible to the rollup AND to the runbook's stranded-money query (which
 * looks for 'succeeded'). REC-I2 is that exact row being recovered.
 */

const Parse = require('parse/node');
const { MongoClient } = require('mongodb');
const Payment = require('../../../src/domain/models/Payment');
const PaymentService = require('../../../src/application/services/PaymentService');
const StripeWebhookController = require('../../../src/application/controllers/api/StripeWebhookController');
const StripeCheckoutController = require('../../../src/application/controllers/api/StripeCheckoutController');
const housekeeping = require('../../../src/application/services/payments/paymentHousekeeping');
const { applyConfirmation } = require('../../../src/application/services/payments/paymentConfirmation');
const stripeClient = require('../../../src/infrastructure/payments/stripeClient');
const atomicStore = require('../../../src/infrastructure/payments/paymentAtomicStore');
const logger = require('../../../src/infrastructure/logger');
const {
  ensurePaymentPendingUniqueIndex,
} = require('../../../scripts/seeds/028-payment-online-pending-unique-index');

const RUN = `hk${Date.now().toString(36)}`;
const CUSHION = StripeCheckoutController.SESSION_EXPIRY_CUSHION_MS; // 3 min
const MARGIN = housekeeping.SWEEP_SAFETY_MARGIN_MS; // 2 min
const MINUTE = 60 * 1000;

describe('online payment housekeeping (integration)', () => {
  const created = [];
  let retrieveSession;
  let retrieveIntent;
  let sessionCounter = 0;
  let mongoClient;
  let parseDb;

  const reservationPtr = (id) => {
    const ptr = new Parse.Object('Reservation');
    ptr.id = id;
    return ptr;
  };

  const createReservation = async (total = 1000, status = 'confirmed') => {
    const reservation = new Parse.Object('Reservation');
    reservation.set('active', true);
    reservation.set('exists', true);
    reservation.set('status', status);
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

  const nextSession = () => {
    sessionCounter += 1;
    return `cs_test_${RUN}_${sessionCounter}`;
  };

  /**
   * A gateway Payment in whatever state a case needs. `expiresAtOffsetMs` is relative to NOW: negative
   * means "already past its TTL by that much", which is how the threshold boundaries are driven.
   * @param {object} spec - Fixture spec.
   * @returns {Promise<object>} The saved Payment.
   */
  const createOnline = async ({
    reservationId, amount = 1000, gatewayStatus = 'requires_payment', expiresAtOffsetMs = -60 * MINUTE,
    exists = true, retiredBySystem, gateway = 'stripe', sessionId, intentId, lastReconciledAt,
    origCurrency = 'MXN', origAmount,
  }) => {
    const p = new Payment();
    p.set('reservationPtr', reservationPtr(reservationId));
    p.set('amount', amount);
    p.set('origAmount', origAmount === undefined ? amount : origAmount);
    p.set('origCurrency', origCurrency);
    p.set('method', 'tarjeta');
    p.set('channel', 'online');
    p.set('gateway', gateway);
    p.set('gatewayStatus', gatewayStatus);
    p.set('gatewaySessionId', sessionId === null ? undefined : (sessionId || nextSession()));
    if (intentId) p.set('gatewayIntentId', intentId);
    if (lastReconciledAt) p.set('lastReconciledAt', lastReconciledAt);
    p.set('expiresAt', new Date(Date.now() + expiresAtOffsetMs));
    p.set('active', exists);
    p.set('exists', exists);
    if (retiredBySystem !== undefined) p.set('retiredBySystem', retiredBySystem);
    await p.save(null, { useMasterKey: true });
    created.push(p);
    return p;
  };

  const createManual = async (reservationId, amount = 500) => {
    const p = new Payment();
    p.set('reservationPtr', reservationPtr(reservationId));
    p.set('amount', amount);
    p.set('method', 'efectivo');
    p.set('paidAt', new Date());
    p.set('expiresAt', new Date(Date.now() - 10 * 60 * MINUTE)); // deliberately ancient
    p.set('active', true);
    p.set('exists', true);
    await p.save(null, { useMasterKey: true });
    created.push(p);
    return p;
  };

  const reload = async (id) => new Parse.Query('Payment').get(id, { useMasterKey: true });
  const reloadReservation = async (id) => new Parse.Query('Reservation').get(id, { useMasterKey: true });

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

  const canceledSession = ({ sessionId, paymentId, reservationId }) => ({
    id: sessionId,
    object: 'checkout.session',
    status: 'expired',
    payment_status: 'unpaid',
    currency: 'mxn',
    amount_total: 100000,
    metadata: { reservationId, paymentId },
    payment_intent: { id: `pi_${sessionId}`, status: 'canceled', amount_received: 0 },
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

  // Route the mocked retrieve by session id, so a batch of several candidates can each get their own
  // answer without depending on call order.
  const routeSessions = (map) => {
    retrieveSession.mockImplementation(async (id) => {
      if (!Object.prototype.hasOwnProperty.call(map, id)) {
        const err = new Error(`No such checkout.session: ${id}`);
        err.code = 'resource_missing';
        throw err;
      }
      const answer = map[id];
      if (answer instanceof Error) throw answer;
      return answer;
    });
  };

  const confirmViaWebhook = (payment, reservationId) => StripeWebhookController.applyToPayment({
    id: `evt_${RUN}_${payment.id}_${Math.random().toString(36).slice(2)}`,
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_x', metadata: { paymentId: payment.id, reservationId } } },
  }, { gatewayStatus: 'succeeded', crossesThreshold: true });

  beforeAll(async () => {
    require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    Parse.initialize('test-app-id', null, 'test-master-key');
    Parse.serverURL = 'http://localhost:1339/parse';
    Parse.masterKey = 'test-master-key';

    // Apply seed 028's partial unique index so the fixtures below are held to the SAME constraint
    // production enforces: at most one live pending online Payment per reservation. Without it a
    // fixture could quietly build a state the real database would reject, and the suite would only
    // fail later, when some other suite happened to create the index first.
    mongoClient = new MongoClient(process.env.TEST_DATABASE_URI || process.env.DATABASE_URI);
    await mongoClient.connect();
    const { databases } = await mongoClient.db('admin').admin().listDatabases();
    for (const d of databases) {
      if (['admin', 'local', 'config'].includes(d.name)) continue;
      const cols = await mongoClient.db(d.name).listCollections({ name: '_SCHEMA' }).toArray();
      if (cols.length) { parseDb = mongoClient.db(d.name); break; }
    }
    if (!parseDb) throw new Error('Could not locate the Parse Mongo db (_SCHEMA collection not found)');
    await ensurePaymentPendingUniqueIndex(parseDb);
  }, 60000);

  // Both jobs scan the WHOLE Payment collection, exactly as they do in production. That makes every
  // count they report a property of the entire database, so a row left behind by a sibling suite
  // would silently join the batch and make an exact assertion here mean nothing. Starting each case
  // from an empty collection is what lets the counts below stay exact instead of approximate; with
  // --runInBand no other suite is mid-flight, so nothing anyone still needs is removed.
  const wipePayments = async () => {
    const q = new Parse.Query('Payment');
    q.limit(1000);
    const rows = await q.find({ useMasterKey: true });
    if (rows.length) await Parse.Object.destroyAll(rows, { useMasterKey: true });
  };

  beforeEach(async () => {
    retrieveSession = jest.fn();
    retrieveIntent = jest.fn();
    stripeClient.setClientForTests({
      checkout: { sessions: { retrieve: retrieveSession } },
      paymentIntents: { retrieve: retrieveIntent },
    });
    await wipePayments();
  });

  afterEach(async () => {
    // Each case runs the real jobs against the shared memory DB, so rows must not leak between cases.
    for (const o of created.splice(0)) {
      try { await o.destroy({ useMasterKey: true }); } catch { /* gone */ }
    }
  });

  afterAll(async () => {
    stripeClient.resetForTests();
    await atomicStore.closeForTests();
    if (mongoClient) await mongoClient.close();
  }, 60000);

  // ===========================================================================================
  describe('TTL sweep', () => {
    it('TTL-I1: past expiresAt but INSIDE the session cushion => NOT swept', async () => {
      const reservationId = await createReservation();
      // Expired one minute ago: in Stripe the session is still payable for two more minutes.
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -1 * MINUTE });

      const stats = await housekeeping.sweepExpiredOnlinePayments();
      expect(stats.retired).toBe(0);
      const row = await reload(payment.id);
      expect(row.get('gatewayStatus')).toBe('requires_payment');
      expect(row.get('exists')).toBe(true);
    });

    it('TTL-I2: past the cushion but INSIDE the safety margin => still NOT swept', async () => {
      const reservationId = await createReservation();
      const payment = await createOnline({
        reservationId, expiresAtOffsetMs: -(CUSHION + MINUTE),
      });

      const stats = await housekeeping.sweepExpiredOnlinePayments();
      expect(stats.retired).toBe(0);
      expect((await reload(payment.id)).get('gatewayStatus')).toBe('requires_payment');
    });

    it('TTL-I3: past cushion + margin => swept, with the housekeeping marker', async () => {
      const reservationId = await createReservation();
      const payment = await createOnline({
        reservationId, expiresAtOffsetMs: -(CUSHION + MARGIN + MINUTE),
      });

      const stats = await housekeeping.sweepExpiredOnlinePayments();
      expect(stats.scanned).toBe(1);
      expect(stats.retired).toBe(1);
      expect(stats.failed).toBe(0);

      const row = await reload(payment.id);
      expect(row.get('gatewayStatus')).toBe('expired');
      expect(row.get('exists')).toBe(false);
      expect(row.get('active')).toBe(false);
      expect(row.get('retiredBySystem')).toBe(true);
      expect(row.get('deletedAt')).toBeInstanceOf(Date);
    });

    it('the threshold is derived from the checkout constants, never from a second copy', async () => {
      const now = new Date('2026-07-30T12:00:00.000Z');
      const expected = new Date(now.getTime() - CUSHION - MARGIN);
      expect(housekeeping.sweepThreshold(now).getTime()).toBe(expected.getTime());
      // And it is never earlier than the cushion alone, which would race a still-payable session.
      expect(housekeeping.sweepThreshold(now).getTime())
        .toBeLessThanOrEqual(now.getTime() - CUSHION);
    });

    it('TTL-I4: a manual payment is never touched, however old', async () => {
      const reservationId = await createReservation();
      const manual = await createManual(reservationId, 500);
      await housekeeping.sweepExpiredOnlinePayments();
      const row = await reload(manual.id);
      expect(row.get('exists')).toBe(true);
      expect(row.get('active')).toBe(true);
      expect(row.get('gatewayStatus')).toBeUndefined();
      expect(row.get('retiredBySystem')).toBeUndefined();
    });

    it('TTL-I5: a live pending (not yet expired) is never touched', async () => {
      const reservationId = await createReservation();
      const live = await createOnline({ reservationId, expiresAtOffsetMs: +20 * MINUTE });
      await housekeeping.sweepExpiredOnlinePayments();
      expect((await reload(live.id)).get('gatewayStatus')).toBe('requires_payment');
      expect((await reload(live.id)).get('exists')).toBe(true);
    });

    it.each(['succeeded', 'failed', 'expired', 'refunded', 'disputed', 'dispute_lost'])(
      'TTL-I6: a row at %p is never touched, however old',
      async (status) => {
        const reservationId = await createReservation();
        const row = await createOnline({
          reservationId, gatewayStatus: status, expiresAtOffsetMs: -10 * 60 * MINUTE,
        });
        const stats = await housekeeping.sweepExpiredOnlinePayments();
        expect(stats.retired).toBe(0);
        const after = await reload(row.id);
        expect(after.get('gatewayStatus')).toBe(status);
        expect(after.get('exists')).toBe(true);
      }
    );

    it('TTL-I7: "processing" is NEVER retired — only reported (retiring it would be retiring money in flight)', async () => {
      const reservationId = await createReservation();
      const processing = await createOnline({
        reservationId, gatewayStatus: 'processing', expiresAtOffsetMs: -10 * 60 * MINUTE,
      });
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      let stats;
      try {
        stats = await housekeeping.sweepExpiredOnlinePayments();
        const alert = warnSpy.mock.calls.find(([msg]) => String(msg).includes('stuck in "processing"'));
        expect(alert).toBeDefined();
        expect(alert[1].count).toBe(1);
        expect(alert[1].sample).toEqual([processing.id]);
      } finally {
        warnSpy.mockRestore();
      }
      expect(stats.retired).toBe(0);
      expect(stats.stuckProcessing).toBe(1);
      const row = await reload(processing.id);
      expect(row.get('gatewayStatus')).toBe('processing');
      expect(row.get('exists')).toBe(true);
    });

    it('a mixed batch retires exactly the ones that qualify and nothing else', async () => {
      // One reservation per LIVE pending, because the partial unique index of seed 028 allows exactly
      // one per reservation — the batch is global, so they still meet inside the same sweep.
      const old = await createOnline({
        reservationId: await createReservation(), expiresAtOffsetMs: -60 * MINUTE,
      });
      const stillYoung = await createOnline({
        reservationId: await createReservation(), expiresAtOffsetMs: -1 * MINUTE,
      });
      const live = await createOnline({
        reservationId: await createReservation(), expiresAtOffsetMs: +20 * MINUTE,
      });
      const reservationId = await createReservation();
      const manual = await createManual(reservationId);
      const confirmed = await createOnline({
        reservationId, gatewayStatus: 'succeeded', expiresAtOffsetMs: -60 * MINUTE,
      });

      const stats = await housekeeping.sweepExpiredOnlinePayments();
      expect(stats.scanned).toBe(1);
      expect(stats.retired).toBe(1);
      expect((await reload(old.id)).get('exists')).toBe(false);
      expect((await reload(stillYoung.id)).get('exists')).toBe(true);
      expect((await reload(live.id)).get('exists')).toBe(true);
      expect((await reload(manual.id)).get('exists')).toBe(true);
      expect((await reload(confirmed.id)).get('exists')).toBe(true);
    });

    it('TTL-I8: a row confirmed midway through the batch is skipped, and the batch does NOT abort', async () => {
      // Separate reservations: two LIVE pendings on one reservation are forbidden by the seed-028
      // index, and the sweep's batch is global anyway.
      const confirmedRes = await createReservation();
      const willBeConfirmed = await createOnline({
        reservationId: confirmedRes, expiresAtOffsetMs: -60 * MINUTE,
      });
      const normal = await createOnline({
        reservationId: await createReservation(), expiresAtOffsetMs: -60 * MINUTE,
      });

      // Confirm one of them AFTER the candidate list would have been built, before the sweep reaches it.
      await confirmViaWebhook(willBeConfirmed, confirmedRes);

      const stats = await housekeeping.sweepExpiredOnlinePayments();
      expect(stats.scanned).toBe(1); // the confirmed one is not even a candidate any more
      expect(stats.retired).toBe(1);
      expect(stats.failed).toBe(0);
      expect((await reload(willBeConfirmed.id)).get('gatewayStatus')).toBe('succeeded');
      expect((await reload(willBeConfirmed.id)).get('exists')).toBe(true);
      expect((await reload(normal.id)).get('exists')).toBe(false);
    });

    it('TTL-I11: the sweep racing retirePending — one wins, the other no-ops, neither throws', async () => {
      const reservationId = await createReservation();
      const pending = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      const adapter = { expireCheckout: jest.fn().mockResolvedValue({}) };

      const [sweepStats, retired] = await Promise.all([
        housekeeping.sweepExpiredOnlinePayments(),
        StripeCheckoutController.retirePending(pending, adapter),
      ]);
      // Exactly one of the two performed the write.
      expect(sweepStats.retired + (retired ? 1 : 0)).toBe(1);
      const row = await reload(pending.id);
      expect(row.get('gatewayStatus')).toBe('expired');
      expect(row.get('exists')).toBe(false);
      expect(row.get('retiredBySystem')).toBe(true);
    }, 30000);

    it('TTL-I12: an empty batch is a clean no-op', async () => {
      const stats = await housekeeping.sweepExpiredOnlinePayments();
      expect(stats).toMatchObject({
        scanned: 0, retired: 0, skipped: 0, failed: 0, stuckProcessing: 0,
      });
    });

    it('TTL-I9: a webhook that lands AFTER the sweep revives the row and the balance is correct', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      await housekeeping.sweepExpiredOnlinePayments();
      expect((await reload(payment.id)).get('exists')).toBe(false);

      const infoSpy = jest.spyOn(logger, 'info');
      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      try {
        await confirmViaWebhook(payment, reservationId);
        expect(recalcSpy).toHaveBeenCalledTimes(1);
        const revived = infoSpy.mock.calls.find(([msg]) => String(msg).includes('Revived a gateway payment'));
        expect(revived).toBeDefined();
      } finally {
        infoSpy.mockRestore();
        recalcSpy.mockRestore();
      }

      const row = await reload(payment.id);
      expect(row.get('gatewayStatus')).toBe('succeeded');
      expect(row.get('exists')).toBe(true);
      expect(row.get('active')).toBe(true);
      expect(row.get('retiredBySystem')).toBe(false);
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('balance')).toBe(0);
      expect(reservation.get('paymentStatus')).toBe('paid');
    });

    it('TTL-I10: a DELIBERATE staff delete is confirmed but never revived, and it shouts', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      // Exactly what PaymentController.deletePayment leaves behind: no housekeeping marker.
      payment.set('exists', false);
      payment.set('active', false);
      payment.set('deletedAt', new Date());
      await payment.save(null, { useMasterKey: true });

      const errorSpy = jest.spyOn(logger, 'error');
      try {
        await confirmViaWebhook(payment, reservationId);
        const critical = errorSpy.mock.calls.find(([msg]) => String(msg).includes('rollup cannot see'));
        expect(critical).toBeDefined();
        expect(critical[1]).toMatchObject({ paymentId: payment.id, gatewayStatus: 'succeeded' });
      } finally {
        errorSpy.mockRestore();
      }

      const row = await reload(payment.id);
      expect(row.get('gatewayStatus')).toBe('succeeded'); // detectable by the runbook query
      expect(row.get('exists')).toBe(false); // the human decision stands
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(0);
    });
  });

  // ===========================================================================================
  describe('reconciliation', () => {
    it('REC-I1: a live pending Stripe reports as paid is confirmed and the rollup moves', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      const sessionId = payment.get('gatewaySessionId');
      routeSessions({ [sessionId]: paidSession({ sessionId, paymentId: payment.id, reservationId }) });

      const stats = await housekeeping.reconcileStalePayments();
      expect(stats.scanned).toBe(1);
      expect(stats.live).toBe(1);
      expect(stats.confirmed).toBe(1);
      expect(stats.failed).toBe(0);

      const row = await reload(payment.id);
      expect(row.get('gatewayStatus')).toBe('succeeded');
      expect(row.get('gatewayChargeId')).toBe(`ch_${sessionId}`);
      expect(row.get('lastReconciledAt')).toBeInstanceOf(Date);
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('balance')).toBe(0);
    });

    it('a pending too YOUNG to be stale is not a candidate at all', async () => {
      const reservationId = await createReservation(1000);
      await createOnline({ reservationId, expiresAtOffsetMs: +20 * MINUTE });
      // createdAt is now, so the age threshold excludes it regardless of expiresAt.
      const stats = await housekeeping.reconcileStalePayments();
      expect(stats.scanned).toBe(0);
      expect(retrieveSession).not.toHaveBeenCalled();
    });

    it('REC-I2: the RETIRED branch recovers a real charge whose webhook never arrived', async () => {
      // Without this branch the job is born dead: the sweep retires every requires_payment row every
      // ~35 min by design, so in normal operation an exists:true query has no candidates, and THIS
      // row — a real charge, invisible to the rollup and to the runbook's 'succeeded' query — is the
      // literal case the job exists for.
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      await housekeeping.sweepExpiredOnlinePayments();
      expect((await reload(payment.id)).get('exists')).toBe(false);
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBeUndefined();

      const sessionId = payment.get('gatewaySessionId');
      routeSessions({ [sessionId]: paidSession({ sessionId, paymentId: payment.id, reservationId }) });

      const stats = await housekeeping.reconcileStalePayments();
      expect(stats.retired).toBe(1);
      expect(stats.confirmed).toBe(1);

      const row = await reload(payment.id);
      expect(row.get('gatewayStatus')).toBe('succeeded');
      expect(row.get('exists')).toBe(true); // revived: it counts again
      expect(row.get('retiredBySystem')).toBe(false);
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('balance')).toBe(0);
      expect(reservation.get('paymentStatus')).toBe('paid');
    });

    it('REC-I3: a reconciled row is COOLED DOWN, not sealed: it does not come back immediately', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      await housekeeping.sweepExpiredOnlinePayments();
      const sessionId = payment.get('gatewaySessionId');
      routeSessions({ [sessionId]: canceledSession({ sessionId, paymentId: payment.id, reservationId }) });

      const first = await housekeeping.reconcileStalePayments();
      expect(first.retired).toBe(1);
      expect(retrieveSession).toHaveBeenCalledTimes(1);
      expect((await reload(payment.id)).get('lastReconciledAt')).toBeInstanceOf(Date);

      const second = await housekeeping.reconcileStalePayments();
      expect(second.retired).toBe(0);
      expect(second.scanned).toBe(0);
      expect(retrieveSession).toHaveBeenCalledTimes(1); // not hammered on every run
    });

    it('a retired row DOES come back once the cooldown elapses (the seal would lose real money)', async () => {
      // The failure chain this closes: a LIVE row gets reconciled, Stripe answers "still open"
      // (ok:false) and the row is stamped; minutes later the sweep retires it. With a one-shot
      // doesNotExist filter, that stamp would have excluded it from the retired branch FOREVER — and
      // if the payer really did pay while the webhook was lost, the charge would be invisible to the
      // rollup, to both branches, to the sweep and to every runbook query.
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      const sessionId = payment.get('gatewaySessionId');

      // 1) While still LIVE, Stripe says the session is open: the row is reconciled and stamped.
      routeSessions({ [sessionId]: openSession({ sessionId, paymentId: payment.id, reservationId }) });
      const firstRun = await housekeeping.reconcileStalePayments();
      expect(firstRun.live).toBe(1);
      expect(firstRun.pending).toBe(1);
      const stamp = await reload(payment.id);
      expect(stamp.get('lastReconciledAt')).toBeInstanceOf(Date);

      // 2) The sweep retires it: it is now a retired-branch candidate, already stamped.
      await housekeeping.sweepExpiredOnlinePayments();
      expect((await reload(payment.id)).get('exists')).toBe(false);

      // 3) The payer HAD paid; the webhook never arrived. After the cooldown the row is examined
      //    again and the charge is recovered.
      routeSessions({ [sessionId]: paidSession({ sessionId, paymentId: payment.id, reservationId }) });
      const later = new Date(Date.now() + housekeeping.RECONCILE_COOLDOWN_MS + MINUTE);
      const secondRun = await housekeeping.reconcileStalePayments({ now: later });
      expect(secondRun.retired).toBe(1);
      expect(secondRun.confirmed).toBe(1);

      const row = await reload(payment.id);
      expect(row.get('gatewayStatus')).toBe('succeeded');
      expect(row.get('exists')).toBe(true);
      expect(row.get('retiredBySystem')).toBe(false);
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('balance')).toBe(0);
      expect(reservation.get('paymentStatus')).toBe('paid');
    });

    it('a retired row with no terminal answer is named in a per-row log, not just counted', async () => {
      // `pending` alone cannot tell "a live checkout still legitimately open" from "a retired row
      // whose money we still cannot account for". Only the second one deserves attention.
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      await housekeeping.sweepExpiredOnlinePayments();
      const sessionId = payment.get('gatewaySessionId');
      routeSessions({ [sessionId]: openSession({ sessionId, paymentId: payment.id, reservationId }) });

      const warnSpy = jest.spyOn(logger, 'warn');
      try {
        const stats = await housekeeping.reconcileStalePayments();
        expect(stats.pending).toBe(1);
        const named = warnSpy.mock.calls
          .find(([msg]) => String(msg).includes('retired online payment could not be resolved'));
        expect(named).toBeDefined();
        expect(named[1]).toEqual({ paymentId: payment.id });
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('a LIVE row still legitimately open produces NO such per-row warning (only the counter)', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      const sessionId = payment.get('gatewaySessionId');
      routeSessions({ [sessionId]: openSession({ sessionId, paymentId: payment.id, reservationId }) });

      const warnSpy = jest.spyOn(logger, 'warn');
      try {
        const stats = await housekeeping.reconcileStalePayments();
        expect(stats.pending).toBe(1);
        expect(warnSpy.mock.calls.find(([msg]) => String(msg).includes('retired online payment could not be resolved')))
          .toBeUndefined();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('REC-I4: the batch is ordered by lastReconciledAt ascending, with never-reconciled first', async () => {
      const rows = [
        { id: 'b', get: () => new Date('2026-07-20T00:00:00.000Z') },
        { id: 'a', get: () => undefined },
        { id: 'c', get: () => new Date('2026-07-25T00:00:00.000Z') },
        { id: 'd', get: () => undefined },
      ];
      const ordered = housekeeping.orderBatch(rows).map((p) => p.id);
      // Never-reconciled rows lead; the rest oldest-first. Ordering by creation age instead would let
      // the permanently stuck rows (the oldest by definition) occupy the head of every batch forever.
      expect(ordered.slice(0, 2).sort()).toEqual(['a', 'd']);
      expect(ordered.slice(2)).toEqual(['b', 'c']);
    });

    it('a corrupt lastReconciledAt sorts first rather than blowing up the ordering', async () => {
      const rows = [
        { id: 'good', get: () => new Date('2026-07-25T00:00:00.000Z') },
        { id: 'corrupt', get: () => 'no-es-una-fecha' },
      ];
      expect(housekeeping.orderBatch(rows).map((p) => p.id)).toEqual(['corrupt', 'good']);
    });

    it.each([
      ['a HIGHER reported amount', 150000, 'mxn'],
      ['a LOWER reported amount', 50000, 'mxn'],
    ])('REC-I5: %s is reported, never written into the record', async (_label, amountMinor) => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      const sessionId = payment.get('gatewaySessionId');
      routeSessions({
        [sessionId]: paidSession({
          sessionId, paymentId: payment.id, reservationId, amountMinor,
        }),
      });

      const before = await reload(payment.id);
      const snapshot = {
        amount: before.get('amount'),
        origAmount: before.get('origAmount'),
        origCurrency: before.get('origCurrency'),
      };

      const errorSpy = jest.spyOn(logger, 'error');
      try {
        await housekeeping.reconcileStalePayments();
        const alert = errorSpy.mock.calls.find(([msg]) => String(msg).includes('AMOUNT/CURRENCY MISMATCH'));
        expect(alert).toBeDefined();
        expect(alert[1]).toMatchObject({
          paymentId: payment.id, expectedAmount: 1000, reportedAmount: amountMinor / 100,
        });
      } finally {
        errorSpy.mockRestore();
      }

      const after = await reload(payment.id);
      expect(after.get('amount')).toBe(snapshot.amount);
      expect(after.get('origAmount')).toBe(snapshot.origAmount);
      expect(after.get('origCurrency')).toBe(snapshot.origCurrency);
      // The charge is still confirmed (the money did arrive) and the evidence is persisted.
      expect(after.get('gatewayStatus')).toBe('succeeded');
      expect(after.get('gatewayRaw').discrepancy).toMatchObject({
        expectedAmount: 1000, reportedAmount: amountMinor / 100,
      });
      // The rollup counts the LOCAL amount, never what Stripe reported.
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(1000);
    });

    it('REC-I6: a CURRENCY mismatch is treated the same way (origCurrency untouched)', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      const sessionId = payment.get('gatewaySessionId');
      routeSessions({
        [sessionId]: paidSession({
          sessionId, paymentId: payment.id, reservationId, amountMinor: 100000, currency: 'usd',
        }),
      });

      const errorSpy = jest.spyOn(logger, 'error');
      try {
        await housekeeping.reconcileStalePayments();
        const alert = errorSpy.mock.calls.find(([msg]) => String(msg).includes('AMOUNT/CURRENCY MISMATCH'));
        expect(alert).toBeDefined();
        expect(alert[1]).toMatchObject({ expectedCurrency: 'MXN', reportedCurrency: 'USD' });
      } finally {
        errorSpy.mockRestore();
      }
      const after = await reload(payment.id);
      expect(after.get('origCurrency')).toBe('MXN');
      expect(after.get('origAmount')).toBe(1000);
    });

    it('REC-I7: a sub-cent difference is NOT reported (float noise is not a discrepancy)', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      const sessionId = payment.get('gatewaySessionId');
      routeSessions({
        [sessionId]: paidSession({
          sessionId, paymentId: payment.id, reservationId, amountMinor: 100000,
        }),
      });

      const errorSpy = jest.spyOn(logger, 'error');
      try {
        await housekeeping.reconcileStalePayments();
        expect(errorSpy.mock.calls.find(([msg]) => String(msg).includes('AMOUNT/CURRENCY MISMATCH')))
          .toBeUndefined();
      } finally {
        errorSpy.mockRestore();
      }
      expect((await reload(payment.id)).get('gatewayRaw')).toBeUndefined();
    });

    it('REC-I8: a CANCELED session never triggers the amount check (its reported amount is legitimately 0)', async () => {
      // Running the check on a non-succeeded destination would raise a false alarm on every pass.
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      const sessionId = payment.get('gatewaySessionId');
      routeSessions({ [sessionId]: canceledSession({ sessionId, paymentId: payment.id, reservationId }) });

      const errorSpy = jest.spyOn(logger, 'error');
      let stats;
      try {
        stats = await housekeeping.reconcileStalePayments();
        expect(errorSpy.mock.calls.find(([msg]) => String(msg).includes('AMOUNT/CURRENCY MISMATCH')))
          .toBeUndefined();
      } finally {
        errorSpy.mockRestore();
      }
      expect(stats.applied).toBe(1);
      const row = await reload(payment.id);
      expect(row.get('gatewayStatus')).toBe('expired'); // canceled maps to expired, never to a new value
      expect(row.get('confirmedAt')).toBeUndefined();
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBeUndefined();
    });

    it('a session Stripe still reports as OPEN leaves the row exactly as it was', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      const sessionId = payment.get('gatewaySessionId');
      routeSessions({ [sessionId]: openSession({ sessionId, paymentId: payment.id, reservationId }) });

      const stats = await housekeeping.reconcileStalePayments();
      expect(stats.pending).toBe(1);
      const row = await reload(payment.id);
      expect(row.get('gatewayStatus')).toBe('requires_payment');
      expect(row.get('lastReconciledAt')).toBeInstanceOf(Date); // it is not re-asked next run
    });

    it('REC-I9/REC-I11: a candidate with NO Stripe id at all is skipped and the batch continues', async () => {
      // The residual of a checkout whose rollback failed before persisting any id, alongside a
      // healthy candidate. Separate reservations (the seed-028 index allows one live pending each).
      const orphan = await createOnline({
        reservationId: await createReservation(1000), expiresAtOffsetMs: -60 * MINUTE, sessionId: null,
      });
      const reservationId = await createReservation(1000);
      const good = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      const sessionId = good.get('gatewaySessionId');
      routeSessions({ [sessionId]: paidSession({ sessionId, paymentId: good.id, reservationId }) });

      const warnSpy = jest.spyOn(logger, 'warn');
      let stats;
      try {
        stats = await housekeeping.reconcileStalePayments();
        expect(warnSpy.mock.calls.find(([msg]) => String(msg).includes('no Stripe session or intent id')))
          .toBeDefined();
      } finally {
        warnSpy.mockRestore();
      }
      expect(stats.skipped).toBe(1);
      expect(stats.confirmed).toBe(1);
      expect(stats.failed).toBe(0);
      // getCharge was never called with two empty ids.
      expect(retrieveSession).toHaveBeenCalledTimes(1);
      expect(retrieveSession).toHaveBeenCalledWith(sessionId, { expand: ['payment_intent'] });
      expect((await reload(orphan.id)).get('gatewayStatus')).toBe('requires_payment');
    });

    it('REC-I9: a provider failure on one candidate never aborts the rest', async () => {
      const broken = await createOnline({
        reservationId: await createReservation(1000), expiresAtOffsetMs: -60 * MINUTE,
      });
      const reservationId = await createReservation(1000);
      const good = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      routeSessions({
        [broken.get('gatewaySessionId')]: new Error('Stripe is having a bad day'),
        [good.get('gatewaySessionId')]: paidSession({
          sessionId: good.get('gatewaySessionId'), paymentId: good.id, reservationId,
        }),
      });

      const stats = await housekeeping.reconcileStalePayments();
      expect(stats.scanned).toBe(2);
      expect(stats.failed).toBe(1);
      expect(stats.confirmed).toBe(1);
      expect((await reload(good.id)).get('gatewayStatus')).toBe('succeeded');
      // The failed one is NOT stamped, so it stays at the head of the next batch.
      expect((await reload(broken.id)).get('lastReconciledAt')).toBeUndefined();
    });

    it('REC-I10: a reservation deleted in the meantime is logged, not fatal', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      const sessionId = payment.get('gatewaySessionId');
      routeSessions({ [sessionId]: paidSession({ sessionId, paymentId: payment.id, reservationId }) });

      // Hard-delete the reservation (the harshest version of "archived in the meantime").
      const reservation = await reloadReservation(reservationId);
      await reservation.destroy({ useMasterKey: true });

      const stats = await housekeeping.reconcileStalePayments();
      expect(stats.scanned).toBe(1);
      expect(stats.failed + stats.confirmed).toBe(1); // whichever way it resolves, the job survives
      // The row's own state is still coherent: it was never left half-written.
      const row = await reload(payment.id);
      expect(['succeeded', 'requires_payment']).toContain(row.get('gatewayStatus'));
    });

    it('REC-I17: an openpay candidate in the batch is skipped without crashing', async () => {
      const reservationId = await createReservation(1000);
      const openpay = await createOnline({
        reservationId, expiresAtOffsetMs: -60 * MINUTE, gateway: 'openpay',
      });
      const stats = await housekeeping.reconcileStalePayments();
      expect(stats.skipped).toBe(1);
      expect(stats.failed).toBe(0);
      expect(retrieveSession).not.toHaveBeenCalled();
      expect((await reload(openpay.id)).get('gatewayStatus')).toBe('requires_payment');
    });

    it('REC-I18: two runs in a row over an unchanged world are both clean no-ops', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      const sessionId = payment.get('gatewaySessionId');
      routeSessions({ [sessionId]: paidSession({ sessionId, paymentId: payment.id, reservationId }) });

      const first = await housekeeping.reconcileStalePayments();
      expect(first.confirmed).toBe(1);

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      let second;
      try {
        second = await housekeeping.reconcileStalePayments();
        expect(recalcSpy).not.toHaveBeenCalled();
      } finally {
        recalcSpy.mockRestore();
      }
      expect(second.scanned).toBe(0);
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(1000); // never 2000
    });

    it('a "processing" row IS a reconciliation candidate (its only way out, since the sweep never takes it)', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({
        reservationId, gatewayStatus: 'processing', expiresAtOffsetMs: -60 * MINUTE,
      });
      const sessionId = payment.get('gatewaySessionId');
      routeSessions({ [sessionId]: paidSession({ sessionId, paymentId: payment.id, reservationId }) });

      const stats = await housekeeping.reconcileStalePayments();
      expect(stats.confirmed).toBe(1);
      expect((await reload(payment.id)).get('gatewayStatus')).toBe('succeeded');
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(1000);
    });

    it('a row with only an INTENT id (its session is gone) is looked up by intent', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({
        reservationId, expiresAtOffsetMs: -60 * MINUTE, sessionId: null, intentId: 'pi_solo_intent',
      });
      retrieveIntent.mockResolvedValue({
        id: 'pi_solo_intent',
        object: 'payment_intent',
        status: 'succeeded',
        currency: 'mxn',
        amount_received: 100000,
        latest_charge: 'ch_solo',
        metadata: { reservationId, paymentId: payment.id },
      });

      const stats = await housekeeping.reconcileStalePayments();
      expect(stats.confirmed).toBe(1);
      expect(retrieveIntent).toHaveBeenCalledWith('pi_solo_intent');
      expect(retrieveSession).not.toHaveBeenCalled();
      expect((await reload(payment.id)).get('gatewayStatus')).toBe('succeeded');
    });

    it('REC-I16: overpay — a manual payment plus an online one confirmed by the job is allowed', async () => {
      const reservationId = await createReservation(1000);
      await createManual(reservationId, 800);
      const payment = await createOnline({ reservationId, amount: 1000, expiresAtOffsetMs: -60 * MINUTE });
      const sessionId = payment.get('gatewaySessionId');
      routeSessions({ [sessionId]: paidSession({ sessionId, paymentId: payment.id, reservationId }) });

      await housekeeping.reconcileStalePayments();
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1800);
      expect(reservation.get('balance')).toBe(-800); // negative balance is allowed by design
      expect(reservation.get('paymentStatus')).toBe('paid');
    });

    it('CANC-1: a charge the job confirms on a CANCELLED reservation is recorded and marked', async () => {
      const reservationId = await createReservation(1000, 'cancelled');
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      const sessionId = payment.get('gatewaySessionId');
      routeSessions({ [sessionId]: paidSession({ sessionId, paymentId: payment.id, reservationId }) });

      const errorSpy = jest.spyOn(logger, 'error');
      try {
        await housekeeping.reconcileStalePayments();
        expect(errorSpy.mock.calls.find(([msg]) => String(msg).includes('ALREADY CANCELLED'))).toBeDefined();
      } finally {
        errorSpy.mockRestore();
      }
      const row = await reload(payment.id);
      expect(row.get('gatewayStatus')).toBe('succeeded');
      expect(row.get('requiresRefundReview')).toBe(true);
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(1000);
    });
  });

  // ===========================================================================================
  // The one window the atomic transition cannot close on its own. The row ends 'succeeded' and
  // visible, so it matches NO other candidate branch and NO stranded-money query, while the
  // reservation still shows a balance for money that was really collected.
  describe('a charge confirmed whose rollup then failed', () => {
    it('is flagged, shouted about, and RECOVERED by the reconciliation on the next run', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      const sessionId = payment.get('gatewaySessionId');
      routeSessions({ [sessionId]: paidSession({ sessionId, paymentId: payment.id, reservationId }) });

      // The rollup blows up exactly once, after the transition has already won.
      const recalcSpy = jest.spyOn(PaymentService, 'recalculate')
        .mockRejectedValueOnce(new Error('rollup caido (simulado)'));
      const errorSpy = jest.spyOn(logger, 'error');
      let stats;
      try {
        stats = await housekeeping.reconcileStalePayments();
        const critical = errorSpy.mock.calls
          .find(([msg]) => String(msg).includes('rollup could NOT be written'));
        expect(critical).toBeDefined();
        expect(critical[1]).toMatchObject({ paymentId: payment.id, reservationId });
      } finally {
        recalcSpy.mockRestore();
        errorSpy.mockRestore();
      }
      expect(stats.failed).toBe(1);

      // The stranded state, verbatim: money confirmed, balance silent, and NOT reachable by the
      // stranded-money query (which looks for exists:false).
      const stranded = await reload(payment.id);
      expect(stranded.get('gatewayStatus')).toBe('succeeded');
      expect(stranded.get('exists')).toBe(true);
      expect(stranded.get('requiresRollupRepair')).toBe(true);
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBeUndefined();

      // Next run: the repair branch picks it up, needs NO provider call, and clears its own flag.
      retrieveSession.mockClear();
      const repairRun = await housekeeping.reconcileStalePayments();
      expect(repairRun.rollupRepair).toBe(1);
      expect(repairRun.repaired).toBe(1);
      expect(repairRun.failed).toBe(0);
      expect(retrieveSession).not.toHaveBeenCalled();

      const repaired = await reload(payment.id);
      expect(repaired.get('requiresRollupRepair')).toBe(false);
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('balance')).toBe(0);
      expect(reservation.get('paymentStatus')).toBe('paid');
    });

    it('a repair that fails again keeps the flag (it is never cleared optimistically)', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({
        reservationId, gatewayStatus: 'succeeded', expiresAtOffsetMs: -60 * MINUTE,
      });
      payment.set('requiresRollupRepair', true);
      await payment.save(null, { useMasterKey: true });

      const healSpy = jest.spyOn(PaymentService, 'recalculateIfStale')
        .mockRejectedValueOnce(new Error('sigue caido'));
      let stats;
      try {
        stats = await housekeeping.reconcileStalePayments();
      } finally {
        healSpy.mockRestore();
      }
      expect(stats.rollupRepair).toBe(1);
      expect(stats.repaired).toBe(0);
      expect(stats.failed).toBe(1);
      expect((await reload(payment.id)).get('requiresRollupRepair')).toBe(true);
    });

    it('a flagged row is processed ONCE, as a repair, even if it also matches another branch', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      payment.set('requiresRollupRepair', true);
      await payment.save(null, { useMasterKey: true });

      const stats = await housekeeping.reconcileStalePayments();
      expect(stats.scanned).toBe(1); // not counted twice
      expect(stats.rollupRepair).toBe(1);
      expect(stats.repaired).toBe(1);
      expect(retrieveSession).not.toHaveBeenCalled(); // a repair needs no provider call
      expect((await reload(payment.id)).get('requiresRollupRepair')).toBe(false);
    });

    it('the polling path leaves the same marker (it swallows its errors by design)', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      const sessionId = payment.get('gatewaySessionId');
      routeSessions({ [sessionId]: paidSession({ sessionId, paymentId: payment.id, reservationId }) });

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate')
        .mockRejectedValueOnce(new Error('rollup caido (simulado)'));
      try {
        await expect(applyConfirmation({
          payment,
          destination: { gatewayStatus: 'succeeded', crossesThreshold: true },
          source: 'polling',
        })).rejects.toThrow('rollup caido (simulado)');
      } finally {
        recalcSpy.mockRestore();
      }
      expect((await reload(payment.id)).get('requiresRollupRepair')).toBe(true);
    });
  });

  // ===========================================================================================
  describe('a staff delete landing while a retirement is in flight', () => {
    it('never stamps the housekeeping marker on a deliberate deletion', async () => {
      // retirePending talks to Stripe first; a staff delete can land in that window, and
      // deletePayment reaches a LIVE pending. If the retirement then matched anyway it would write
      // retiredBySystem:true over a human decision — and the revive would be authorized to undo it.
      const reservationId = await createReservation(1000);
      const pending = await createOnline({ reservationId });

      const adapter = {
        expireCheckout: jest.fn().mockImplementation(async () => {
          // The staff deletion, exactly as PaymentController.deletePayment leaves it.
          pending.set('exists', false);
          pending.set('active', false);
          pending.set('deletedAt', new Date());
          await pending.save(null, { useMasterKey: true });
          return {};
        }),
      };

      const retired = await StripeCheckoutController.retirePending(pending, adapter);
      expect(retired).toBe(false); // nothing left to retire: a clean no-op, never a throw

      const row = await reload(pending.id);
      expect(row.get('exists')).toBe(false);
      expect(row.get('retiredBySystem')).toBeUndefined(); // the decisive assertion
      expect(row.get('gatewayStatus')).toBe('requires_payment');
    });

    it('and a later confirmation therefore does NOT revive it', async () => {
      const reservationId = await createReservation(1000);
      const pending = await createOnline({ reservationId });
      const adapter = {
        expireCheckout: jest.fn().mockImplementation(async () => {
          pending.set('exists', false);
          pending.set('active', false);
          await pending.save(null, { useMasterKey: true });
          return {};
        }),
      };
      await StripeCheckoutController.retirePending(pending, adapter);

      await confirmViaWebhook(pending, reservationId);

      const row = await reload(pending.id);
      expect(row.get('gatewayStatus')).toBe('succeeded'); // the money is still recorded
      expect(row.get('exists')).toBe(false); // the human decision stands
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(0);
    });
  });

  // ===========================================================================================
  describe('convergence — the paths racing each other for real', () => {
    it('CONV-1: webhook vs sweep, fired together', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      try {
        await Promise.all([
          confirmViaWebhook(payment, reservationId),
          housekeeping.sweepExpiredOnlinePayments(),
        ]);
        expect(recalcSpy).toHaveBeenCalledTimes(1);
      } finally {
        recalcSpy.mockRestore();
      }

      const row = await reload(payment.id);
      expect(row.get('gatewayStatus')).toBe('succeeded');
      expect(row.get('exists')).toBe(true);
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('balance')).toBe(0);
    }, 30000);

    it('REC-I12: reconciliation vs webhook, fired together', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      const sessionId = payment.get('gatewaySessionId');
      routeSessions({ [sessionId]: paidSession({ sessionId, paymentId: payment.id, reservationId }) });

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      try {
        await Promise.all([
          housekeeping.reconcileStalePayments(),
          confirmViaWebhook(payment, reservationId),
        ]);
        expect(recalcSpy).toHaveBeenCalledTimes(1);
      } finally {
        recalcSpy.mockRestore();
      }
      expect((await reload(payment.id)).get('gatewayStatus')).toBe('succeeded');
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('balance')).toBe(0);
    }, 30000);

    it('REC-I13: reconciliation vs sweep converge whichever order they land in', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      const sessionId = payment.get('gatewaySessionId');
      routeSessions({ [sessionId]: paidSession({ sessionId, paymentId: payment.id, reservationId }) });

      await Promise.all([
        housekeeping.reconcileStalePayments(),
        housekeeping.sweepExpiredOnlinePayments(),
      ]);

      const row = await reload(payment.id);
      const reservation = await reloadReservation(reservationId);
      // Either the reconciliation confirmed it (money visible) or the sweep retired it first; both
      // are coherent, and in neither case is a confirmed charge left invisible.
      if (row.get('gatewayStatus') === 'succeeded') {
        expect(row.get('exists')).toBe(true);
        expect(reservation.get('paidAmount')).toBe(1000);
      } else {
        expect(row.get('gatewayStatus')).toBe('expired');
        expect(row.get('retiredBySystem')).toBe(true);
        expect(reservation.get('paidAmount')).toBeUndefined();
      }
    }, 30000);

    it('REC-I14: ALL FOUR paths at once => exactly one recalculate and the exact amount', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createOnline({ reservationId, expiresAtOffsetMs: -60 * MINUTE });
      const sessionId = payment.get('gatewaySessionId');
      routeSessions({ [sessionId]: paidSession({ sessionId, paymentId: payment.id, reservationId }) });

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      const adapter = { expireCheckout: jest.fn().mockResolvedValue({}) };
      let results;
      try {
        results = await Promise.all([
          confirmViaWebhook(payment, reservationId),
          housekeeping.reconcileStalePayments(),
          housekeeping.sweepExpiredOnlinePayments(),
          StripeCheckoutController.retirePending(payment, adapter),
        ]);
        // Not zero (the confirmation would be lost) and not more than one (the guard would leak).
        expect(recalcSpy).toHaveBeenCalledTimes(1);
        expect(recalcSpy).toHaveBeenCalledWith(reservationId);
      } finally {
        recalcSpy.mockRestore();
      }
      expect(results).toHaveLength(4); // nothing threw

      const row = await reload(payment.id);
      expect(row.get('gatewayStatus')).toBe('succeeded');
      expect(row.get('exists')).toBe(true); // whoever retired it, the confirmation revived it
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000); // never 2000/4000
      expect(reservation.get('balance')).toBe(0);
      expect(reservation.get('paymentStatus')).toBe('paid');
    }, 30000);
  });
});
