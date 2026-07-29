/**
 * POST /api/webhooks/stripe — REAL concurrency (full app + Parse real + mongodb-memory-server).
 *
 * The two idempotency layers of this PR can only be proven by actually racing them; a sequential test
 * dressed up as "concurrent" would pass even against the fetch-then-save implementation the plan
 * forbids. Every case here fires with Promise.all against the real unique index (Capa A) and the real
 * conditional update (Capa B), with real Stripe signatures.
 *
 * The single most important assertion in the whole PR lives here: two DIFFERENT legitimate success
 * events for the SAME Payment, arriving in the same millisecond window, must recalculate the
 * reservation EXACTLY once — not zero (a lost confirmation, the client's money vanishes from the CRM)
 * and not twice (a guard with a hole).
 */

const request = require('supertest');
const Parse = require('parse/node');
const Stripe = require('stripe');
const { MongoClient } = require('mongodb');
const PaymentService = require('../../../src/application/services/PaymentService');
const stripeClient = require('../../../src/infrastructure/payments/stripeClient');
const atomicStore = require('../../../src/infrastructure/payments/paymentAtomicStore');
const { ensureGatewayEventUniqueIndex } = require('../../../scripts/seeds/026-create-gatewayevent-class');

const SECRET = 'whsec_concurrency_secret_00001';
const RUN = `cc${Date.now().toString(36)}`;
// Stripe drops a delivery that takes longer than this; the whole handler must fit well inside it.
const STRIPE_TIMEOUT_MS = 20000;

const signer = Stripe('sk_test_dummy_signing_key');
const sign = (payload) => signer.webhooks.generateTestHeaderString({ payload, secret: SECRET });

describe('POST /api/webhooks/stripe — concurrency (integration)', () => {
  let app;
  let mongoClient;
  let parseDb;
  const savedSecrets = process.env.STRIPE_WEBHOOK_SECRETS;
  const created = [];
  let eventCounter = 0;

  const nextEventId = (tag) => {
    eventCounter += 1;
    return `evt_${RUN}_${tag}_${eventCounter}`;
  };

  const reservationPtr = (id) => {
    const ptr = new Parse.Object('Reservation');
    ptr.id = id;
    return ptr;
  };

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

  const createPendingOnline = async (reservationId, amount = 1000) => {
    const p = new Parse.Object('Payment');
    p.set('reservationPtr', reservationPtr(reservationId));
    p.set('amount', amount);
    p.set('origAmount', amount);
    p.set('origCurrency', 'MXN');
    p.set('method', 'tarjeta');
    p.set('channel', 'online');
    p.set('gateway', 'stripe');
    p.set('gatewayStatus', 'requires_payment');
    p.set('expiresAt', new Date(Date.now() + 30 * 60 * 1000));
    p.set('active', true);
    p.set('exists', true);
    await p.save(null, { useMasterKey: true });
    created.push(p);
    return p;
  };

  const makeEvent = ({
    type = 'checkout.session.completed', eventId, paymentId, reservationId,
  }) => ({
    id: eventId,
    object: 'event',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    data: {
      object: {
        id: `obj_${eventId}`,
        object: type.startsWith('checkout.') ? 'checkout.session' : 'payment_intent',
        status: 'complete',
        amount_total: 100000,
        currency: 'mxn',
        metadata: { paymentId, reservationId },
      },
    },
  });

  const postEvent = (event) => {
    const payload = JSON.stringify(event);
    return request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', sign(payload))
      .send(payload);
  };

  const reloadPayment = async (id) => new Parse.Query('Payment').get(id, { useMasterKey: true });
  const reloadReservation = async (id) => new Parse.Query('Reservation').get(id, { useMasterKey: true });
  const countEvents = async (eventId) => {
    const q = new Parse.Query('GatewayEvent');
    q.equalTo('gateway', 'stripe');
    q.equalTo('eventId', eventId);
    return q.count({ useMasterKey: true });
  };

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });

    Parse.initialize('test-app-id', null, 'test-master-key');
    Parse.serverURL = 'http://localhost:1339/parse';
    Parse.masterKey = 'test-master-key';

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
    // Without this UNIQUE index Capa A degrades to check-then-act and every race below is meaningless.
    await ensureGatewayEventUniqueIndex(parseDb);
    const indexes = await parseDb.collection('GatewayEvent').indexes();
    const unique = indexes.find((i) => i.unique === true && i.key && i.key.gateway === 1 && i.key.eventId === 1);
    if (!unique) throw new Error('GatewayEvent unique index missing; the concurrency assertions would be vacuous');

    stripeClient.setClientForTests({ webhooks: signer.webhooks });
    process.env.STRIPE_WEBHOOK_SECRETS = SECRET;
  }, 60000);

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
  describe('Capa A — the SAME event delivered twice at once', () => {
    it('two simultaneous deliveries of one eventId => exactly 1 GatewayEvent, 1 handled + 1 duplicate', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const eventId = nextEventId('same');
      const event = makeEvent({ paymentId: payment.id, reservationId, eventId });

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      let responses;
      try {
        responses = await Promise.all([postEvent(event), postEvent(event)]);
        expect(recalcSpy).toHaveBeenCalledTimes(1);
      } finally {
        recalcSpy.mockRestore();
      }

      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      const duplicates = responses.filter((r) => r.body.duplicate === true);
      const handled = responses.filter((r) => r.body.handled === true);
      expect(duplicates).toHaveLength(1); // the database, not a pre-query, separated them
      expect(handled).toHaveLength(1);

      expect(await countEvents(eventId)).toBe(1);
      expect((await reloadPayment(payment.id)).get('gatewayStatus')).toBe('succeeded');
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('balance')).toBe(0);
      expect(reservation.get('paymentStatus')).toBe('paid');
    }, 30000);

    it('FIVE simultaneous deliveries of one eventId => still exactly 1 row and 1 recalculate', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const eventId = nextEventId('five');
      const event = makeEvent({ paymentId: payment.id, reservationId, eventId });

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      let responses;
      try {
        responses = await Promise.all(Array.from({ length: 5 }, () => postEvent(event)));
        expect(recalcSpy).toHaveBeenCalledTimes(1);
      } finally {
        recalcSpy.mockRestore();
      }

      expect(responses.every((r) => r.status === 200)).toBe(true);
      expect(responses.filter((r) => r.body.duplicate === true)).toHaveLength(4);
      expect(await countEvents(eventId)).toBe(1);
      expect((await reloadReservation(reservationId)).get('paidAmount')).toBe(1000);
    }, 30000);
  });

  // ---------------------------------------------------------------------------------------------
  describe('Capa B — TWO DIFFERENT events for the same Payment, at the same time', () => {
    it('completed + intent.succeeded raced => recalculate EXACTLY once, whoever wins', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const idA = nextEventId('bA');
      const idB = nextEventId('bB');

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      const startedAt = Date.now();
      let responses;
      try {
        responses = await Promise.all([
          postEvent(makeEvent({ type: 'checkout.session.completed', eventId: idA, paymentId: payment.id, reservationId })),
          postEvent(makeEvent({ type: 'payment_intent.succeeded', eventId: idB, paymentId: payment.id, reservationId })),
        ]);
        // Not zero (the confirmation would be lost) and not two (the guard would have a hole).
        expect(recalcSpy).toHaveBeenCalledTimes(1);
        expect(recalcSpy).toHaveBeenCalledWith(reservationId);
      } finally {
        recalcSpy.mockRestore();
      }
      const elapsed = Date.now() - startedAt;

      // BOTH cleared Capa A (distinct eventIds), so only Capa B could have arbitrated.
      expect(await countEvents(idA)).toBe(1);
      expect(await countEvents(idB)).toBe(1);
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      expect(responses.filter((r) => r.body.handled === true)).toHaveLength(1);
      expect(responses.filter((r) => r.body.handled === false)).toHaveLength(1);

      expect((await reloadPayment(payment.id)).get('gatewayStatus')).toBe('succeeded');
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('paymentStatus')).toBe('paid');

      // Timing is a hard requirement, not a nicety: past 20s Stripe abandons the delivery.
      expect(elapsed).toBeLessThan(STRIPE_TIMEOUT_MS);
    }, 30000);

    it('a success and a failure raced => exactly one wins, the Payment never holds both', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      let calls;
      try {
        await Promise.all([
          postEvent(makeEvent({ type: 'checkout.session.completed', eventId: nextEventId('mixS'), paymentId: payment.id, reservationId })),
          postEvent(makeEvent({ type: 'payment_intent.payment_failed', eventId: nextEventId('mixF'), paymentId: payment.id, reservationId })),
        ]);
        calls = recalcSpy.mock.calls.length;
      } finally {
        recalcSpy.mockRestore();
      }

      const finalStatus = (await reloadPayment(payment.id)).get('gatewayStatus');
      expect(['succeeded', 'failed']).toContain(finalStatus);

      // The rollup and the status must agree: money counted if and only if 'succeeded' won.
      const summary = await PaymentService.summarize(reservationId);
      if (finalStatus === 'succeeded') {
        expect(calls).toBe(1);
        expect(summary.paidAmount).toBe(1000);
      } else {
        expect(calls).toBe(0);
        expect(summary.paidAmount).toBe(0);
      }
    }, 30000);

    it('FOUR distinct success events raced => one transition, one recalculate, no double counting', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const types = [
        'checkout.session.completed',
        'payment_intent.succeeded',
        'checkout.session.completed',
        'payment_intent.succeeded',
      ];

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      let responses;
      try {
        responses = await Promise.all(types.map((type, i) => postEvent(makeEvent({
          type, eventId: nextEventId(`quad${i}`), paymentId: payment.id, reservationId,
        }))));
        expect(recalcSpy).toHaveBeenCalledTimes(1);
      } finally {
        recalcSpy.mockRestore();
      }

      expect(responses.filter((r) => r.body.handled === true)).toHaveLength(1);
      expect(responses.filter((r) => r.body.handled === false)).toHaveLength(3);
      const reservation = await reloadReservation(reservationId);
      expect(reservation.get('paidAmount')).toBe(1000); // never 2000/4000
      expect(reservation.get('balance')).toBe(0);
    }, 30000);
  });

  // ---------------------------------------------------------------------------------------------
  describe('independent Payments do not interfere', () => {
    it('three reservations confirmed simultaneously each get their own single recalculate', async () => {
      const ids = await Promise.all([createReservation(1000), createReservation(500), createReservation(250)]);
      const payments = await Promise.all([
        createPendingOnline(ids[0], 1000),
        createPendingOnline(ids[1], 500),
        createPendingOnline(ids[2], 250),
      ]);

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      try {
        const responses = await Promise.all(payments.map((p, i) => postEvent(makeEvent({
          eventId: nextEventId(`multi${i}`), paymentId: p.id, reservationId: ids[i],
        }))));
        expect(responses.every((r) => r.status === 200 && r.body.handled === true)).toBe(true);
        expect(recalcSpy).toHaveBeenCalledTimes(3);
      } finally {
        recalcSpy.mockRestore();
      }

      const reservations = await Promise.all(ids.map(reloadReservation));
      expect(reservations.map((r) => r.get('paidAmount'))).toEqual([1000, 500, 250]);
      expect(reservations.every((r) => r.get('paymentStatus') === 'paid')).toBe(true);
    }, 30000);
  });

  // ---------------------------------------------------------------------------------------------
  describe('timing budget', () => {
    it('a single confirmation round-trip finishes well inside Stripe\'s 20s window', async () => {
      const reservationId = await createReservation(1000);
      const payment = await createPendingOnline(reservationId, 1000);
      const startedAt = Date.now();
      const r = await postEvent(makeEvent({
        eventId: nextEventId('timing'), paymentId: payment.id, reservationId,
      }));
      const elapsed = Date.now() - startedAt;
      expect(r.status).toBe(200);
      expect(elapsed).toBeLessThan(STRIPE_TIMEOUT_MS);
    }, 30000);
  });
});
