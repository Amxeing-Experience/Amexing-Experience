/**
 * StripeWebhookController — the gate BEFORE any persistence, and the rollup decision itself
 * (unit, real signature crypto).
 *
 * Everything asserted in the first block happens before the handler is allowed to touch the
 * database: an unverifiable signature, a missing secret, and a test/live crossing must each produce
 * their own status code AND leave Parse completely untouched (no GatewayEvent, no Payment query, no
 * rollup). The spies are the point — a 400 that still wrote a GatewayEvent would let an attacker fill
 * the idempotency table with event ids, permanently suppressing the real deliveries that follow.
 *
 * The second block drives applyToPayment directly, because the two rules it encodes cannot both be
 * reached through translateEvent today: the rollup is keyed on destination.crossesThreshold (NOT on
 * "the event means success"), and a matchedCount of 0 is not automatically a no-op — when the Payment
 * is ALREADY at the destination, the reservation rollup gets VERIFIED (recalculateIfStale), which
 * repairs a delivery that died mid-flight without ever rewriting a rollup another delivery already got
 * right. Calling the method with an explicit destination is what lets a PR11-shaped
 * { gatewayStatus:'refunded', crossesThreshold:true } be tested before PR11 exists.
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
const logger = require('../../../src/infrastructure/logger');
const stripeClient = require('../../../src/infrastructure/payments/stripeClient');
const atomicStore = require('../../../src/infrastructure/payments/paymentAtomicStore');
const { translateEvent } = require('../../../src/application/services/payments/stripeWebhookEvents');

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
  let getSpy;
  let recalcSpy;
  let healSpy;
  const transitionSpy = atomicStore.atomicTransitionPayment;

  beforeAll(() => {
    stripeClient.setClientForTests({ webhooks: signer.webhooks });
  });

  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRETS = SECRET;
    saveSpy = jest.spyOn(GatewayEvent.prototype, 'save').mockResolvedValue(undefined);
    querySpy = jest.spyOn(Parse.Query.prototype, 'first').mockResolvedValue(undefined);
    // The self-heal re-read (Query.get) is spied separately from findPayment (Query.first) so each
    // case says explicitly which of the two reads it is driving. Default: the Payment cannot be
    // re-read, which is the safest no-op.
    getSpy = jest.spyOn(Parse.Query.prototype, 'get')
      .mockRejectedValue(new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Object not found.'));
    recalcSpy = jest.spyOn(PaymentService, 'recalculate').mockResolvedValue({});
    healSpy = jest.spyOn(PaymentService, 'recalculateIfStale').mockResolvedValue({ healed: true });
    transitionSpy.mockReset();
    transitionSpy.mockResolvedValue({ matchedCount: 0 });
  });

  afterEach(() => {
    saveSpy.mockRestore();
    querySpy.mockRestore();
    getSpy.mockRestore();
    recalcSpy.mockRestore();
    healSpy.mockRestore();
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
    expect(getSpy).not.toHaveBeenCalled();
    expect(recalcSpy).not.toHaveBeenCalled();
    expect(healSpy).not.toHaveBeenCalled();
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

    it('the retry that compensation creates DOES repair the rollup (Capa B already at destination)', async () => {
      // The exact sequence the compensation produces, end to end through handle():
      // delivery 1 transitions the Payment and then the rollup explodes => 500 + the GatewayEvent is
      // retracted; delivery 2 (Stripe's retry of the SAME event) clears Capa A again but finds nothing
      // left to transition. Keying the rollup only on matchedCount===1 would abandon it there forever.
      // The repair goes through recalculateIfStale, never recalculate: it must not rewrite a rollup that
      // some other delivery already got right.
      const destroy = jest.fn().mockResolvedValue(undefined);
      saveSpy.mockImplementation(function saved() {
        this.id = 'ge_retry_id';
        this.destroy = destroy;
        return Promise.resolve(this);
      });
      querySpy.mockResolvedValue({ id: 'pay_r', getReservationPtr: () => ({ id: 'res_r' }) });
      const payload = buildPayload({
        data: { object: { id: 'cs_r', metadata: { paymentId: 'pay_r' } } },
      });
      const header = sign(payload);

      transitionSpy.mockResolvedValueOnce({ matchedCount: 1 });
      recalcSpy.mockRejectedValueOnce(new Error('rollup down'));
      const first = makeRes();
      await StripeWebhookController.handle(makeReq(payload, header), first);
      expect(first.statusCode).toBe(500);
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(recalcSpy).toHaveBeenCalledTimes(1);

      transitionSpy.mockResolvedValueOnce({ matchedCount: 0 });
      getSpy.mockResolvedValueOnce({ get: (field) => (field === 'gatewayStatus' ? 'succeeded' : undefined) });
      const second = makeRes();
      await StripeWebhookController.handle(makeReq(payload, header), second);

      expect(second.statusCode).toBe(200);
      // Still handled:false — no NEW transition happened; what got repaired is the rollup.
      expect(second.body).toEqual({ received: true, handled: false });
      expect(recalcSpy).toHaveBeenCalledTimes(1); // still just the failed first attempt
      expect(healSpy).toHaveBeenCalledTimes(1);
      expect(healSpy).toHaveBeenCalledWith('res_r');
      expect(destroy).toHaveBeenCalledTimes(1); // the retry succeeded: its Capa A row stays
    });

    it('a repair that FAILS => 500 and the Capa A row is retracted again (the retry chain continues)', async () => {
      const destroy = jest.fn().mockResolvedValue(undefined);
      saveSpy.mockImplementation(function saved() {
        this.id = 'ge_heal_fail';
        this.destroy = destroy;
        return Promise.resolve(this);
      });
      querySpy.mockResolvedValue({ id: 'pay_hf', getReservationPtr: () => ({ id: 'res_hf' }) });
      transitionSpy.mockResolvedValueOnce({ matchedCount: 0 });
      getSpy.mockResolvedValueOnce({ get: () => 'succeeded' });
      healSpy.mockRejectedValueOnce(new Error('rollup down'));

      const payload = buildPayload({ data: { object: { id: 'cs_hf', metadata: { paymentId: 'pay_hf' } } } });
      const res = makeRes();
      await StripeWebhookController.handle(makeReq(payload, sign(payload)), res);

      expect(res.statusCode).toBe(500);
      expect(destroy).toHaveBeenCalledTimes(1);
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

    it('a matchedCount of 0 with the Payment NOT at the destination never touches the rollup', async () => {
      querySpy.mockResolvedValueOnce({ id: 'pay_x', getReservationPtr: () => ({ id: 'res_x' }) });
      transitionSpy.mockResolvedValueOnce({ matchedCount: 0 });
      // The re-read is what separates "nothing happened" from "a previous attempt already moved it".
      getSpy.mockResolvedValueOnce({ get: () => 'requires_payment' });
      const payload = buildPayload();
      const res = makeRes();
      await StripeWebhookController.handle(makeReq(payload, sign(payload)), res);
      expect(res.body).toEqual({ received: true, handled: false });
      expect(getSpy).toHaveBeenCalledTimes(1);
      expect(recalcSpy).not.toHaveBeenCalled();
      expect(healSpy).not.toHaveBeenCalled(); // not even the cheap verification
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

    it('a succeeded transition is filtered by the source allowlist of THAT destination', async () => {
      querySpy.mockResolvedValueOnce({ id: 'pay_g', getReservationPtr: () => ({ id: 'res_g' }) });
      transitionSpy.mockResolvedValueOnce({ matchedCount: 1 });
      const payload = buildPayload({
        data: { object: { id: 'o', metadata: { paymentId: 'pay_g' } } },
      });
      await StripeWebhookController.handle(makeReq(payload, sign(payload)), makeRes());

      const [paymentId, options] = transitionSpy.mock.calls[0];
      expect(paymentId).toBe('pay_g');
      // failed/expired included: a declined card can be retried on the same session/paymentId.
      expect(options.fromStatuses.sort())
        .toEqual(['expired', 'failed', 'processing', 'requires_payment']);
      expect(options.toStatus).toBe('succeeded');
      expect(options.extraSet.confirmedAt).toBeInstanceOf(Date);
    });

    it.each([
      ['payment_intent.payment_failed', 'failed'],
      ['checkout.session.expired', 'expired'],
    ])('%s only accepts a PENDING source (it can never walk succeeded backwards)', async (type, toStatus) => {
      querySpy.mockResolvedValueOnce({ id: 'pay_n', getReservationPtr: () => ({ id: 'res_n' }) });
      transitionSpy.mockResolvedValueOnce({ matchedCount: 1 });
      const payload = buildPayload({
        type,
        data: { object: { id: 'o', metadata: { paymentId: 'pay_n' } } },
      });
      await StripeWebhookController.handle(makeReq(payload, sign(payload)), makeRes());

      const options = transitionSpy.mock.calls[0][1];
      expect(options.toStatus).toBe(toStatus);
      expect(options.fromStatuses.sort()).toEqual(['processing', 'requires_payment']);
      expect(options.fromStatuses).not.toContain('succeeded');
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

// -------------------------------------------------------------------------------------------------
describe('StripeWebhookController.applyToPayment — which transitions move the rollup', () => {
  let firstSpy;
  let getSpy;
  let recalcSpy;
  let healSpy;
  let infoSpy;
  let errorSpy;
  const transitionSpy = atomicStore.atomicTransitionPayment;

  const SUCCESS = { gatewayStatus: 'succeeded', crossesThreshold: true };
  // What PR11 will add to stripeWebhookEvents: it counts (it crosses the rollup line) without meaning
  // "the card cleared". Written literally so this suite fails the day the two ideas get collapsed again.
  const REFUND = { gatewayStatus: 'refunded', crossesThreshold: true };

  const paymentDouble = (reservationId = 'res_1') => ({
    id: 'pay_1',
    getReservationPtr: () => (reservationId ? { id: reservationId } : null),
  });

  const paymentAt = (gatewayStatus) => ({
    get: (field) => (field === 'gatewayStatus' ? gatewayStatus : undefined),
  });

  const anEvent = (type = 'checkout.session.completed') => ({
    id: 'evt_apply_1',
    type,
    data: { object: { id: 'cs_1', metadata: { paymentId: 'pay_1' } } },
  });

  const lastInfoMeta = () => infoSpy.mock.calls[infoSpy.mock.calls.length - 1][1];

  beforeEach(() => {
    firstSpy = jest.spyOn(Parse.Query.prototype, 'first').mockResolvedValue(paymentDouble());
    getSpy = jest.spyOn(Parse.Query.prototype, 'get')
      .mockRejectedValue(new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Object not found.'));
    recalcSpy = jest.spyOn(PaymentService, 'recalculate').mockResolvedValue({});
    healSpy = jest.spyOn(PaymentService, 'recalculateIfStale').mockResolvedValue({ healed: true });
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    transitionSpy.mockReset();
    transitionSpy.mockResolvedValue({ matchedCount: 0 });
  });

  afterEach(() => {
    firstSpy.mockRestore();
    getSpy.mockRestore();
    recalcSpy.mockRestore();
    healSpy.mockRestore();
    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('the decision is crossesThreshold, never "this event means success"', () => {
    it('a destination that CROSSES the line without meaning success (PR11 refund) still recalculates', async () => {
      transitionSpy.mockResolvedValueOnce({ matchedCount: 1 });
      const applied = await StripeWebhookController.applyToPayment(anEvent('charge.refunded'), REFUND);
      expect(applied).toBe(true);
      expect(recalcSpy).toHaveBeenCalledTimes(1);
      expect(recalcSpy).toHaveBeenCalledWith('res_1');
      // confirmedAt remains keyed on "means success", which a refund is not: the two stay separate.
      expect(transitionSpy.mock.calls[0][1].extraSet).toEqual({});
      expect(getSpy).not.toHaveBeenCalled();
    });

    it('a destination that MEANS success but does NOT cross the line never recalculates', async () => {
      transitionSpy.mockResolvedValueOnce({ matchedCount: 1 });
      await StripeWebhookController.applyToPayment(
        anEvent(),
        { gatewayStatus: 'succeeded', crossesThreshold: false }
      );
      expect(recalcSpy).not.toHaveBeenCalled();
      // ...yet confirmedAt IS stamped, proving the inverse of the pair above.
      expect(transitionSpy.mock.calls[0][1].extraSet.confirmedAt).toBeInstanceOf(Date);
    });

    it.each(['payment_intent.payment_failed', 'checkout.session.expired'])(
      'the REAL map entry for %s never recalculates and never even issues the extra read',
      async (type) => {
        const destination = translateEvent(type);
        expect(destination.crossesThreshold).toBe(false); // fails loudly if the map ever changes
        transitionSpy.mockResolvedValueOnce({ matchedCount: 1 });
        await StripeWebhookController.applyToPayment(anEvent(type), destination);
        transitionSpy.mockResolvedValueOnce({ matchedCount: 0 });
        await StripeWebhookController.applyToPayment(anEvent(type), destination);
        expect(recalcSpy).not.toHaveBeenCalled();
        expect(getSpy).not.toHaveBeenCalled();
      }
    );

    it('a destination with no crossesThreshold at all recalculates nothing (fails closed)', async () => {
      transitionSpy.mockResolvedValueOnce({ matchedCount: 1 });
      await StripeWebhookController.applyToPayment(anEvent(), { gatewayStatus: 'succeeded' });
      expect(recalcSpy).not.toHaveBeenCalled();
    });

    it('a real transition recalculates exactly once and never also runs the stale check', async () => {
      transitionSpy.mockResolvedValueOnce({ matchedCount: 1 });
      getSpy.mockResolvedValue(paymentAt('succeeded'));
      await StripeWebhookController.applyToPayment(anEvent(), SUCCESS);
      expect(recalcSpy).toHaveBeenCalledTimes(1);
      expect(healSpy).not.toHaveBeenCalled();
      expect(getSpy).not.toHaveBeenCalled();
    });
  });

  // The trigger (matchedCount 0 + already at destination) is AMBIGUOUS by construction: a sibling event
  // and the retry of a dead delivery look identical here. So this branch never calls recalculate — it
  // calls recalculateIfStale, which compares the persisted rollup against a fresh computation inside the
  // per-reservation lock and writes only when they differ.
  describe('stale-rollup check — matchedCount 0 with the Payment already at the destination', () => {
    it('verifies (never blindly recalculates) when the Payment is ALREADY at the destination', async () => {
      transitionSpy.mockResolvedValueOnce({ matchedCount: 0 });
      getSpy.mockResolvedValueOnce(paymentAt('succeeded'));
      const applied = await StripeWebhookController.applyToPayment(anEvent(), SUCCESS);
      // No NEW transition: Stripe still hears handled:false. What may be repaired is the rollup.
      expect(applied).toBe(false);
      expect(recalcSpy).not.toHaveBeenCalled();
      expect(healSpy).toHaveBeenCalledTimes(1);
      expect(healSpy).toHaveBeenCalledWith('res_1');
      expect(getSpy).toHaveBeenCalledWith('pay_1', { useMasterKey: true });
    });

    it('works for the PR11 refund destination too, not just for succeeded', async () => {
      transitionSpy.mockResolvedValueOnce({ matchedCount: 0 });
      getSpy.mockResolvedValueOnce(paymentAt('refunded'));
      await StripeWebhookController.applyToPayment(anEvent('charge.refunded'), REFUND);
      expect(healSpy).toHaveBeenCalledTimes(1);
      expect(recalcSpy).not.toHaveBeenCalled();
    });

    it('a check that finds the rollup CURRENT is reported as not repaired', async () => {
      transitionSpy.mockResolvedValueOnce({ matchedCount: 0 });
      getSpy.mockResolvedValueOnce(paymentAt('succeeded'));
      healSpy.mockResolvedValueOnce({ healed: false });
      await StripeWebhookController.applyToPayment(anEvent(), SUCCESS);
      expect(lastInfoMeta()).toMatchObject({ staleRollupChecked: true, staleRollupRepaired: false });
    });

    it.each([
      ['an outcome without the flag', {}],
      ['a null outcome', null],
      ['an undefined outcome', undefined],
    ])('%s is reported as not repaired (never a truthy guess)', async (_label, outcome) => {
      transitionSpy.mockResolvedValueOnce({ matchedCount: 0 });
      getSpy.mockResolvedValueOnce(paymentAt('succeeded'));
      healSpy.mockResolvedValueOnce(outcome);
      await StripeWebhookController.applyToPayment(anEvent(), SUCCESS);
      expect(lastInfoMeta()).toMatchObject({ staleRollupChecked: true, staleRollupRepaired: false });
    });

    it.each([
      ['still pending — nothing ever transitioned it', 'requires_payment'],
      ['mid-flight on an async method', 'processing'],
      ['in a foreign terminal state', 'failed'],
      ['expired', 'expired'],
      ['already refunded (a late succeeded must not resurrect it)', 'refunded'],
      ['dispute_lost', 'dispute_lost'],
      ['carrying an empty status', ''],
      ['carrying no status at all', undefined],
      ['carrying a status of another shape', { objeto: 'raro' }],
    ])('does NOT even check the rollup when the re-read shows the Payment %s', async (_label, status) => {
      transitionSpy.mockResolvedValueOnce({ matchedCount: 0 });
      getSpy.mockResolvedValueOnce(paymentAt(status));
      const applied = await StripeWebhookController.applyToPayment(anEvent(), SUCCESS);
      expect(applied).toBe(false);
      expect(recalcSpy).not.toHaveBeenCalled();
      expect(healSpy).not.toHaveBeenCalled();
    });

    it('a re-read finding NO row is a clean no-op (it answers the question; a retry would not help)', async () => {
      const gone = new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Object not found.');
      transitionSpy.mockResolvedValueOnce({ matchedCount: 0 });
      getSpy.mockRejectedValueOnce(gone);
      await expect(StripeWebhookController.applyToPayment(anEvent(), SUCCESS)).resolves.toBe(false);
      expect(healSpy).not.toHaveBeenCalled();
      expect(recalcSpy).not.toHaveBeenCalled();
    });

    it('a re-read that FAILS for any other reason PROPAGATES, so Stripe retries instead of getting a 200', async () => {
      // Swallowing this would answer 200 and end the retry chain, and a confirmed payment gets no further
      // events — so a rollup left stale by a half-finished delivery would become permanent.
      transitionSpy.mockResolvedValueOnce({ matchedCount: 0 });
      getSpy.mockRejectedValueOnce(new Error('mongo down'));
      await expect(StripeWebhookController.applyToPayment(anEvent(), SUCCESS)).rejects.toThrow('mongo down');
      expect(healSpy).not.toHaveBeenCalled();
      expect(recalcSpy).not.toHaveBeenCalled();
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
    ])('a re-read resolving %s does not check the rollup', async (_label, value) => {
      transitionSpy.mockResolvedValueOnce({ matchedCount: 0 });
      getSpy.mockResolvedValueOnce(value);
      await expect(StripeWebhookController.applyToPayment(anEvent(), SUCCESS)).resolves.toBe(false);
      expect(healSpy).not.toHaveBeenCalled();
    });

    it.each([
      ['a Payment with no reservationPtr', { id: 'pay_1', getReservationPtr: () => null }],
      ['a Payment without the accessor at all', { id: 'pay_1' }],
      ['a reservationPtr with no id', { id: 'pay_1', getReservationPtr: () => ({}) }],
    ])('%s logs an error instead of touching the rollup (and never throws)', async (_label, double) => {
      firstSpy.mockResolvedValueOnce(double);
      transitionSpy.mockResolvedValueOnce({ matchedCount: 0 });
      getSpy.mockResolvedValueOnce(paymentAt('succeeded'));
      await expect(StripeWebhookController.applyToPayment(anEvent(), SUCCESS)).resolves.toBe(false);
      expect(recalcSpy).not.toHaveBeenCalled();
      expect(healSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('the same missing-reservationPtr guard covers the transition branch (not duplicated per branch)', async () => {
      firstSpy.mockResolvedValueOnce({ id: 'pay_1', getReservationPtr: () => null });
      transitionSpy.mockResolvedValueOnce({ matchedCount: 1 });
      await expect(StripeWebhookController.applyToPayment(anEvent(), SUCCESS)).resolves.toBe(true);
      expect(recalcSpy).not.toHaveBeenCalled();
      expect(healSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('a repair that fails PROPAGATES (so Capa A is retracted and Stripe retries again)', async () => {
      // Swallowing it here would answer 200, keep the Capa A row, and permanently strand the rollup.
      transitionSpy.mockResolvedValueOnce({ matchedCount: 0 });
      getSpy.mockResolvedValueOnce(paymentAt('succeeded'));
      healSpy.mockRejectedValueOnce(new Error('rollup down'));
      await expect(StripeWebhookController.applyToPayment(anEvent(), SUCCESS)).rejects.toThrow('rollup down');
    });

    it('an uncorrelatable Payment never reaches the re-read (no transition was even attempted)', async () => {
      firstSpy.mockResolvedValueOnce(undefined);
      const applied = await StripeWebhookController.applyToPayment(anEvent(), SUCCESS);
      expect(applied).toBe(false);
      expect(transitionSpy).not.toHaveBeenCalled();
      expect(getSpy).not.toHaveBeenCalled();
      expect(recalcSpy).not.toHaveBeenCalled();
      expect(healSpy).not.toHaveBeenCalled();
    });
  });

  describe('the log distinguishes the two rollup paths (operability of the repair)', () => {
    it('a normal transition => applied true, recalculated true, nothing checked', async () => {
      transitionSpy.mockResolvedValueOnce({ matchedCount: 1 });
      await StripeWebhookController.applyToPayment(anEvent(), SUCCESS);
      expect(lastInfoMeta()).toMatchObject({
        paymentId: 'pay_1',
        applied: true,
        recalculated: true,
        staleRollupChecked: false,
        staleRollupRepaired: false,
      });
    });

    it('a repair => applied false, recalculated false, checked and repaired true', async () => {
      transitionSpy.mockResolvedValueOnce({ matchedCount: 0 });
      getSpy.mockResolvedValueOnce(paymentAt('succeeded'));
      healSpy.mockResolvedValueOnce({ healed: true });
      await StripeWebhookController.applyToPayment(anEvent(), SUCCESS);
      expect(lastInfoMeta()).toMatchObject({
        applied: false,
        recalculated: false,
        staleRollupChecked: true,
        staleRollupRepaired: true,
      });
    });

    it('a plain no-op => nothing recalculated, nothing checked', async () => {
      transitionSpy.mockResolvedValueOnce({ matchedCount: 0 });
      getSpy.mockResolvedValueOnce(paymentAt('requires_payment'));
      await StripeWebhookController.applyToPayment(anEvent(), SUCCESS);
      expect(lastInfoMeta()).toMatchObject({
        applied: false,
        recalculated: false,
        staleRollupChecked: false,
        staleRollupRepaired: false,
      });
    });
  });
});
