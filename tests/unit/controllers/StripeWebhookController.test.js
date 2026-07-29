/**
 * StripeWebhookController — the gate BEFORE any persistence (unit, real signature crypto).
 *
 * Everything asserted here happens before the handler is allowed to touch the database: an
 * unverifiable signature, a missing secret, and a test/live crossing must each produce their own
 * status code AND leave Parse completely untouched (no GatewayEvent, no Payment query, no rollup).
 * The spies are the point — a 400 that still wrote a GatewayEvent would let an attacker fill the
 * idempotency table with event ids, permanently suppressing the real deliveries that follow.
 */

// The controller destructures atomicTransitionPayment at require time, so the module (not a property
// spy) is what has to be replaced. Layer B against a real Mongo is covered by the integration suites.
jest.mock('../../../src/infrastructure/payments/paymentAtomicStore', () => ({
  atomicTransitionPayment: jest.fn(),
  setDbForTests: jest.fn(),
  closeForTests: jest.fn(),
}));

const Parse = require('parse/node');
const Stripe = require('stripe');
const StripeWebhookController = require('../../../src/application/controllers/api/StripeWebhookController');
const GatewayEvent = require('../../../src/domain/models/GatewayEvent');
const PaymentService = require('../../../src/application/services/PaymentService');
const stripeClient = require('../../../src/infrastructure/payments/stripeClient');
const atomicStore = require('../../../src/infrastructure/payments/paymentAtomicStore');

const SECRET = 'whsec_unit_controller_secret_abc';
const signer = Stripe('sk_test_dummy_signing_key');

const sign = (payload, secret = SECRET) => signer.webhooks.generateTestHeaderString({ payload, secret });

const makeRes = () => {
  const res = { statusCode: null, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.body = payload; return res; });
  return res;
};

const makeReq = (payload, header) => ({
  body: Buffer.from(payload),
  headers: header === undefined ? {} : { 'stripe-signature': header },
});

const buildPayload = (overrides = {}) => JSON.stringify({
  id: `evt_unit_${Math.random().toString(36).slice(2)}`,
  type: 'checkout.session.completed',
  livemode: false,
  data: { object: { id: 'cs_x', object: 'checkout.session', metadata: { paymentId: 'nope' } } },
  ...overrides,
});

describe('StripeWebhookController.handle — pre-persistence gate', () => {
  const savedSecrets = process.env.STRIPE_WEBHOOK_SECRETS;
  const savedNodeEnv = process.env.NODE_ENV;
  let saveSpy;
  let querySpy;
  let recalcSpy;
  const transitionSpy = atomicStore.atomicTransitionPayment;

  beforeAll(() => {
    stripeClient.setClientForTests({ webhooks: signer.webhooks });
  });

  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRETS = SECRET;
    saveSpy = jest.spyOn(GatewayEvent.prototype, 'save').mockResolvedValue(undefined);
    querySpy = jest.spyOn(Parse.Query.prototype, 'first').mockResolvedValue(undefined);
    recalcSpy = jest.spyOn(PaymentService, 'recalculate').mockResolvedValue({});
    transitionSpy.mockReset();
    transitionSpy.mockResolvedValue({ matchedCount: 0 });
  });

  afterEach(() => {
    saveSpy.mockRestore();
    querySpy.mockRestore();
    recalcSpy.mockRestore();
    process.env.NODE_ENV = savedNodeEnv;
  });

  afterAll(() => {
    stripeClient.resetForTests();
    if (savedSecrets === undefined) delete process.env.STRIPE_WEBHOOK_SECRETS;
    else process.env.STRIPE_WEBHOOK_SECRETS = savedSecrets;
  });

  const expectNothingTouched = () => {
    expect(saveSpy).not.toHaveBeenCalled();
    expect(querySpy).not.toHaveBeenCalled();
    expect(recalcSpy).not.toHaveBeenCalled();
    expect(transitionSpy).not.toHaveBeenCalled();
  };

  describe('invalid signature => 400', () => {
    it('a signature from an unknown secret => 400, nothing persisted', async () => {
      const payload = buildPayload();
      const res = makeRes();
      await StripeWebhookController.handle(makeReq(payload, sign(payload, 'whsec_other_secret')), res);
      expect(res.statusCode).toBe(400);
      expectNothingTouched();
    });

    it('no stripe-signature header at all => 400, nothing persisted', async () => {
      const payload = buildPayload();
      const res = makeRes();
      await StripeWebhookController.handle(makeReq(payload, undefined), res);
      expect(res.statusCode).toBe(400);
      expectNothingTouched();
    });

    it('a body already parsed into an object (mis-mount) => 400, nothing persisted', async () => {
      const payload = buildPayload();
      const res = makeRes();
      await StripeWebhookController.handle({
        body: JSON.parse(payload),
        headers: { 'stripe-signature': sign(payload) },
      }, res);
      expect(res.statusCode).toBe(400);
      expectNothingTouched();
    });
  });

  describe('no usable secret => 503 (NOT 400)', () => {
    it.each([
      ['unset', undefined],
      ['empty', ''],
      ['only commas', ',,'],
      ['non-whsec junk', 'sk_test_wrong_variable'],
    ])('%s => 503, nothing persisted', async (_label, value) => {
      if (value === undefined) delete process.env.STRIPE_WEBHOOK_SECRETS;
      else process.env.STRIPE_WEBHOOK_SECRETS = value;
      const payload = buildPayload();
      const res = makeRes();
      await StripeWebhookController.handle(makeReq(payload, sign(payload)), res);
      expect(res.statusCode).toBe(503);
      expectNothingTouched();
    });

    it('a MISCONFIGURED deployment is never reported as an invalid signature', async () => {
      // Same request, two configurations: the only difference is whether a secret exists. If both
      // answered 400 the deployment bug would be invisible in the logs.
      const payload = buildPayload();
      const header = sign(payload);

      process.env.STRIPE_WEBHOOK_SECRETS = SECRET;
      const okRes = makeRes();
      await StripeWebhookController.handle(makeReq(payload, header), okRes);
      expect(okRes.statusCode).toBe(200);

      delete process.env.STRIPE_WEBHOOK_SECRETS;
      const badRes = makeRes();
      await StripeWebhookController.handle(makeReq(payload, header), badRes);
      expect(badRes.statusCode).toBe(503);
    });
  });

  describe('test/live crossing => 400 (the webhook counterpart of the API-key guard)', () => {
    it('a LIVE event delivered to a non-production environment is rejected', async () => {
      const payload = buildPayload({ livemode: true });
      const res = makeRes();
      await StripeWebhookController.handle(makeReq(payload, sign(payload)), res);
      expect(res.statusCode).toBe(400);
      expectNothingTouched();
    });

    it('a TEST event delivered to production is rejected (a free "paid" reservation otherwise)', async () => {
      process.env.NODE_ENV = 'production';
      const payload = buildPayload({ livemode: false });
      const res = makeRes();
      await StripeWebhookController.handle(makeReq(payload, sign(payload)), res);
      expect(res.statusCode).toBe(400);
      expectNothingTouched();
    });

    it('an event with NO livemode flag is treated as test mode: rejected in production', async () => {
      process.env.NODE_ENV = 'production';
      const payload = JSON.stringify({ id: 'evt_nolive', type: 'checkout.session.completed', data: { object: {} } });
      const res = makeRes();
      await StripeWebhookController.handle(makeReq(payload, sign(payload)), res);
      expect(res.statusCode).toBe(400);
      expectNothingTouched();
    });

    it('a LIVE event IS accepted in production', async () => {
      process.env.NODE_ENV = 'production';
      const payload = buildPayload({ livemode: true });
      const res = makeRes();
      await StripeWebhookController.handle(makeReq(payload, sign(payload)), res);
      expect(res.statusCode).toBe(200);
      expect(saveSpy).toHaveBeenCalled();
    });
  });

  describe('out-of-scope event types are recorded but never applied', () => {
    it.each(['charge.refunded', 'charge.dispute.created', 'customer.subscription.deleted'])(
      '%s => 200, GatewayEvent written, no Payment lookup and no rollup',
      async (type) => {
        const payload = buildPayload({ type });
        const res = makeRes();
        await StripeWebhookController.handle(makeReq(payload, sign(payload)), res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ received: true, handled: false });
        expect(saveSpy).toHaveBeenCalledTimes(1); // Capa A still records it
        expect(querySpy).not.toHaveBeenCalled(); // but no Payment is even looked up
        expect(transitionSpy).not.toHaveBeenCalled();
        expect(recalcSpy).not.toHaveBeenCalled();
      }
    );
  });

  describe('duplicate event (Capa A) short-circuits before any Payment work', () => {
    it('a DUPLICATE_VALUE on the GatewayEvent insert => 200 duplicate, no Payment touched', async () => {
      const dup = new Parse.Error(Parse.Error.DUPLICATE_VALUE, 'duplicate');
      saveSpy.mockRejectedValueOnce(dup);
      const payload = buildPayload();
      const res = makeRes();
      await StripeWebhookController.handle(makeReq(payload, sign(payload)), res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ received: true, duplicate: true });
      expect(querySpy).not.toHaveBeenCalled();
      expect(transitionSpy).not.toHaveBeenCalled();
      expect(recalcSpy).not.toHaveBeenCalled();
    });
  });

  describe('uncorrelatable metadata => 200 anomaly (never 500, never a new Payment)', () => {
    it.each([
      ['missing metadata', {}],
      ['empty metadata', { metadata: {} }],
      ['empty paymentId', { metadata: { paymentId: '' } }],
      ['whitespace paymentId', { metadata: { paymentId: '   ' } }],
      ['non-string paymentId', { metadata: { paymentId: 12345 } }],
      ['null paymentId', { metadata: { paymentId: null } }],
    ])('%s => 200 handled:false, no transition, no rollup', async (_label, objectExtras) => {
      const payload = buildPayload({
        data: { object: { id: 'cs_y', object: 'checkout.session', ...objectExtras } },
      });
      const res = makeRes();
      await StripeWebhookController.handle(makeReq(payload, sign(payload)), res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ received: true, handled: false });
      expect(transitionSpy).not.toHaveBeenCalled();
      expect(recalcSpy).not.toHaveBeenCalled();
    });
  });

  describe('an internal failure retracts the Capa A marker and asks Stripe to retry', () => {
    it('a Capa B failure => 500 AND the GatewayEvent is destroyed (so the retry is not swallowed)', async () => {
      const destroy = jest.fn().mockResolvedValue(undefined);
      // The saved GatewayEvent needs an id for the retraction path to consider it persisted.
      saveSpy.mockImplementationOnce(function saved() {
        this.id = 'ge_fake_id';
        this.destroy = destroy;
        return Promise.resolve(this);
      });
      querySpy.mockResolvedValueOnce({ id: 'pay_1', getReservationPtr: () => ({ id: 'res_1' }) });
      transitionSpy.mockRejectedValueOnce(new Error('mongo down'));

      const payload = buildPayload();
      const res = makeRes();
      await StripeWebhookController.handle(makeReq(payload, sign(payload)), res);

      expect(res.statusCode).toBe(500); // 5xx = Stripe retries
      expect(destroy).toHaveBeenCalledTimes(1); // and the retry will NOT hit the duplicate short-circuit
      expect(recalcSpy).not.toHaveBeenCalled();
    });
  });

  describe('recalculate is keyed on the Payment, never on metadata.reservationId', () => {
    it('uses the reservationPtr of the located Payment even when metadata says otherwise', async () => {
      querySpy.mockResolvedValueOnce({
        id: 'pay_real',
        getReservationPtr: () => ({ id: 'reservacion_autoritativa' }),
      });
      transitionSpy.mockResolvedValueOnce({ matchedCount: 1 });

      const payload = buildPayload({
        data: {
          object: {
            id: 'cs_z',
            object: 'checkout.session',
            metadata: { paymentId: 'pay_real', reservationId: 'reservacion_INYECTADA_POR_EL_EVENTO' },
          },
        },
      });
      const res = makeRes();
      await StripeWebhookController.handle(makeReq(payload, sign(payload)), res);

      expect(res.statusCode).toBe(200);
      expect(recalcSpy).toHaveBeenCalledTimes(1);
      expect(recalcSpy).toHaveBeenCalledWith('reservacion_autoritativa');
    });

    it('a matchedCount of 0 (no real transition) never triggers the rollup', async () => {
      querySpy.mockResolvedValueOnce({ id: 'pay_x', getReservationPtr: () => ({ id: 'res_x' }) });
      transitionSpy.mockResolvedValueOnce({ matchedCount: 0 });
      const payload = buildPayload();
      const res = makeRes();
      await StripeWebhookController.handle(makeReq(payload, sign(payload)), res);
      expect(res.body).toEqual({ received: true, handled: false });
      expect(recalcSpy).not.toHaveBeenCalled();
    });

    it('a non-succeeded destination never triggers the rollup even when it DID transition', async () => {
      querySpy.mockResolvedValue({ id: 'pay_f', getReservationPtr: () => ({ id: 'res_f' }) });
      transitionSpy.mockResolvedValue({ matchedCount: 1 });
      for (const type of ['payment_intent.payment_failed', 'checkout.session.expired']) {
        const payload = buildPayload({
          type,
          data: { object: { id: 'o', metadata: { paymentId: 'pay_f' } } },
        });
        const res = makeRes();
        await StripeWebhookController.handle(makeReq(payload, sign(payload)), res);
        expect(res.statusCode).toBe(200);
      }
      expect(transitionSpy).toHaveBeenCalledTimes(2);
      expect(recalcSpy).not.toHaveBeenCalled();
    });

    it('the transition is always filtered by the source allowlist {requires_payment, processing}', async () => {
      querySpy.mockResolvedValueOnce({ id: 'pay_g', getReservationPtr: () => ({ id: 'res_g' }) });
      transitionSpy.mockResolvedValueOnce({ matchedCount: 1 });
      const payload = buildPayload({
        data: { object: { id: 'o', metadata: { paymentId: 'pay_g' } } },
      });
      await StripeWebhookController.handle(makeReq(payload, sign(payload)), makeRes());

      const [paymentId, options] = transitionSpy.mock.calls[0];
      expect(paymentId).toBe('pay_g');
      expect(options.fromStatuses.sort()).toEqual(['processing', 'requires_payment']);
      expect(options.toStatus).toBe('succeeded');
      expect(options.extraSet.confirmedAt).toBeInstanceOf(Date);
    });

    it('a non-succeeded destination does NOT stamp confirmedAt', async () => {
      querySpy.mockResolvedValueOnce({ id: 'pay_h', getReservationPtr: () => ({ id: 'res_h' }) });
      transitionSpy.mockResolvedValueOnce({ matchedCount: 1 });
      const payload = buildPayload({
        type: 'checkout.session.expired',
        data: { object: { id: 'o', metadata: { paymentId: 'pay_h' } } },
      });
      await StripeWebhookController.handle(makeReq(payload, sign(payload)), makeRes());
      expect(transitionSpy.mock.calls[0][1].extraSet).toEqual({});
    });
  });
});
