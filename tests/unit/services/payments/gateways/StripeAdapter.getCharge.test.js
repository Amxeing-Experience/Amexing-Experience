/**
 * StripeAdapter.getCharge — the read-only lookup polling and reconciliation share (SDK mocked, zero
 * network).
 *
 * Three things are asserted that the integration suites cannot show:
 *
 * - WHICH SDK call is made, with WHICH arguments. With a session id it must be
 *   checkout.sessions.retrieve WITH expand:['payment_intent'] — that expansion is what carries
 *   amount_received and latest_charge, so dropping it would silently disable the amount-discrepancy
 *   check without failing anything visibly.
 * - The amount fails CLOSED. A 0 / negative / NaN / missing amount must come out as null, never as a
 *   number the discrepancy check would compare against a real origAmount and "report" as a mismatch.
 * - PCI: the result never carries the SDK object. A session/intent stuffed with
 *   payment_method_details/customer_details must produce a result whose full JSON contains no
 *   last4/brand/cvc/email.
 */

const StripeAdapter = require('../../../../../src/application/services/payments/gateways/StripeAdapter');
const PaymentGatewayError = require('../../../../../src/application/services/payments/PaymentGatewayError');

// Card-adjacent junk every fixture carries, so the PCI assertions have something real to catch.
const CARD_JUNK = {
  payment_method_details: { card: { last4: '4242', brand: 'visa', exp_month: 12 } },
  customer_details: { email: 'pagador@example.com', name: 'Pagador Prueba' },
  payment_method_options: { card: { cvc_token: 'cvc_123' } },
};

const makeAdapter = ({ session, intent, fail } = {}) => {
  const sessions = {
    retrieve: jest.fn(async () => {
      if (fail) throw fail;
      return session;
    }),
  };
  const paymentIntents = {
    retrieve: jest.fn(async () => {
      if (fail) throw fail;
      return intent;
    }),
  };
  const client = { checkout: { sessions }, paymentIntents };
  return { adapter: new StripeAdapter({ client }), sessions, paymentIntents };
};

const paidSession = (extra = {}) => ({
  id: 'cs_test_ok',
  object: 'checkout.session',
  status: 'complete',
  payment_status: 'paid',
  currency: 'mxn',
  amount_total: 100000,
  metadata: { reservationId: 'res1', paymentId: 'pay1' },
  payment_intent: {
    id: 'pi_test_ok',
    object: 'payment_intent',
    status: 'succeeded',
    currency: 'mxn',
    amount_received: 100000,
    latest_charge: 'ch_test_ok',
    metadata: { reservationId: 'res1', paymentId: 'pay1' },
    ...CARD_JUNK,
  },
  ...CARD_JUNK,
  ...extra,
});

describe('StripeAdapter.getCharge', () => {
  // -----------------------------------------------------------------------------------------
  describe('GC-U8/U9 — which call, with which arguments', () => {
    it('with a session id: checkout.sessions.retrieve WITH expand:[payment_intent], and no intent call', async () => {
      const { adapter, sessions, paymentIntents } = makeAdapter({ session: paidSession() });
      await adapter.getCharge({ gatewaySessionId: 'cs_test_ok' });
      expect(sessions.retrieve).toHaveBeenCalledTimes(1);
      expect(sessions.retrieve).toHaveBeenCalledWith('cs_test_ok', { expand: ['payment_intent'] });
      expect(paymentIntents.retrieve).not.toHaveBeenCalled();
    });

    it('with ONLY an intent id: paymentIntents.retrieve, and no session call', async () => {
      const intent = {
        id: 'pi_alone', object: 'payment_intent', status: 'succeeded', currency: 'usd', amount_received: 5000,
      };
      const { adapter, sessions, paymentIntents } = makeAdapter({ intent });
      await adapter.getCharge({ gatewayIntentId: 'pi_alone' });
      expect(paymentIntents.retrieve).toHaveBeenCalledTimes(1);
      expect(paymentIntents.retrieve).toHaveBeenCalledWith('pi_alone');
      expect(sessions.retrieve).not.toHaveBeenCalled();
    });

    it('with BOTH ids the session wins (one round-trip yields the intent too)', async () => {
      const { adapter, sessions, paymentIntents } = makeAdapter({ session: paidSession() });
      await adapter.getCharge({ gatewaySessionId: 'cs_test_ok', gatewayIntentId: 'pi_test_ok' });
      expect(sessions.retrieve).toHaveBeenCalledTimes(1);
      expect(paymentIntents.retrieve).not.toHaveBeenCalled();
    });

    it('trims the ids before sending them', async () => {
      const { adapter, sessions } = makeAdapter({ session: paidSession() });
      await adapter.getCharge({ gatewaySessionId: '  cs_test_ok  ' });
      expect(sessions.retrieve).toHaveBeenCalledWith('cs_test_ok', { expand: ['payment_intent'] });
    });

    it.each([
      ['no argument at all', undefined],
      ['an empty object', {}],
      ['both ids empty', { gatewaySessionId: '', gatewayIntentId: '' }],
      ['both ids whitespace', { gatewaySessionId: '   ', gatewayIntentId: '\t' }],
      ['both ids null', { gatewaySessionId: null, gatewayIntentId: null }],
      ['non-string ids', { gatewaySessionId: 123, gatewayIntentId: {} }],
      ['a string instead of an object', 'cs_test_ok'],
    ])('%s => fails CLOSED and the SDK is never called with undefined', async (_label, lookup) => {
      const { adapter, sessions, paymentIntents } = makeAdapter({ session: paidSession() });
      await expect(adapter.getCharge(lookup)).rejects.toThrow(PaymentGatewayError);
      await expect(adapter.getCharge(lookup)).rejects.toMatchObject({
        code: PaymentGatewayError.CODES.PROVIDER_ERROR,
      });
      expect(sessions.retrieve).not.toHaveBeenCalled();
      expect(paymentIntents.retrieve).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('the normalized result', () => {
    it('a paid session yields succeeded plus every id the caller has to persist', async () => {
      const { adapter } = makeAdapter({ session: paidSession() });
      const out = await adapter.getCharge({ gatewaySessionId: 'cs_test_ok' });
      expect(out.ok).toBe(true);
      expect(out.gatewayStatus).toBe('succeeded');
      expect(out.crossesThreshold).toBe(true);
      expect(out.gatewaySessionId).toBe('cs_test_ok');
      expect(out.gatewayIntentId).toBe('pi_test_ok');
      expect(out.gatewayChargeId).toBe('ch_test_ok');
      expect(out.amountReceived).toBe(1000); // MAJOR unit
      expect(out.currency).toBe('MXN'); // uppercase ISO
      expect(out.metadata).toEqual({ reservationId: 'res1', paymentId: 'pay1' });
    });

    it('an unexpanded payment_intent (a plain id string) still yields the intent id', async () => {
      const session = { ...paidSession(), payment_intent: 'pi_string_only' };
      const { adapter } = makeAdapter({ session });
      const out = await adapter.getCharge({ gatewaySessionId: 'cs_test_ok' });
      expect(out.gatewayIntentId).toBe('pi_string_only');
      // No expanded intent => the session total is the only amount available.
      expect(out.amountReceived).toBe(1000);
      expect(out.gatewayChargeId).toBeNull();
    });

    it('an intent-only lookup yields the intent id and its charge', async () => {
      const intent = {
        id: 'pi_alone',
        object: 'payment_intent',
        status: 'succeeded',
        currency: 'usd',
        amount_received: 5000,
        latest_charge: { id: 'ch_expanded', ...CARD_JUNK },
        metadata: { reservationId: 'resX', paymentId: 'payX' },
      };
      const { adapter } = makeAdapter({ intent });
      const out = await adapter.getCharge({ gatewayIntentId: 'pi_alone' });
      expect(out.gatewaySessionId).toBeNull();
      expect(out.gatewayIntentId).toBe('pi_alone');
      expect(out.gatewayChargeId).toBe('ch_expanded');
      expect(out.amountReceived).toBe(50);
      expect(out.currency).toBe('USD');
      expect(out.metadata).toEqual({ reservationId: 'resX', paymentId: 'payX' });
    });

    it('a still-open session yields ok:false with the ids, and nothing that looks like a destination', async () => {
      const session = {
        id: 'cs_open',
        object: 'checkout.session',
        status: 'open',
        payment_status: 'unpaid',
        currency: 'mxn',
        amount_total: 100000,
        payment_intent: { id: 'pi_open', status: 'requires_payment_method', amount_received: 0 },
        metadata: { reservationId: 'res1', paymentId: 'pay1' },
      };
      const { adapter } = makeAdapter({ session });
      const out = await adapter.getCharge({ gatewaySessionId: 'cs_open' });
      expect(out.ok).toBe(false);
      expect(out.gatewayStatus).toBeUndefined();
      expect(out.crossesThreshold).toBeUndefined();
      expect(out.gatewaySessionId).toBe('cs_open');
      expect(out.gatewayIntentId).toBe('pi_open');
    });

    it('missing metadata comes out as empty strings, never undefined ids to compare against', async () => {
      const session = { ...paidSession(), metadata: undefined, payment_intent: { id: 'pi_x', status: 'succeeded', amount_received: 100 } };
      const { adapter } = makeAdapter({ session });
      const out = await adapter.getCharge({ gatewaySessionId: 'cs_test_ok' });
      expect(out.metadata).toEqual({ reservationId: '', paymentId: '' });
    });

    it('a missing currency comes out as an empty string, never "UNDEFINED"', async () => {
      const intent = { id: 'pi_nc', status: 'succeeded', amount_received: 100 };
      const { adapter } = makeAdapter({ intent });
      const out = await adapter.getCharge({ gatewayIntentId: 'pi_nc' });
      expect(out.currency).toBe('');
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('GC-U7 — the amount fails CLOSED', () => {
    it.each([
      ['zero', 0],
      ['a negative amount', -100],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['null', null],
      ['undefined', undefined],
      ['a numeric string', '100000'],
      ['an object', { amount: 100000 }],
      ['a boolean', true],
    ])('%p never becomes an amountReceived: it is null', async (_label, amountReceived) => {
      const session = {
        ...paidSession(),
        amount_total: amountReceived,
        payment_intent: {
          id: 'pi_bad', status: 'succeeded', currency: 'mxn', amount_received: amountReceived,
        },
      };
      const { adapter } = makeAdapter({ session });
      const out = await adapter.getCharge({ gatewaySessionId: 'cs_test_ok' });
      // The status still resolves (the money DID move); only the figure is refused.
      expect(out.gatewayStatus).toBe('succeeded');
      expect(out.amountReceived).toBeNull();
    });

    it('a fractional minor-unit amount is rounded to whole cents, not left as a float artifact', async () => {
      const session = {
        ...paidSession(),
        payment_intent: {
          id: 'pi_frac', status: 'succeeded', currency: 'mxn', amount_received: 100000.4,
        },
      };
      const { adapter } = makeAdapter({ session });
      expect((await adapter.getCharge({ gatewaySessionId: 'cs_test_ok' })).amountReceived).toBe(1000);
    });

    it('a one-cent amount survives (the smallest real charge is not mistaken for garbage)', async () => {
      const session = {
        ...paidSession(),
        payment_intent: {
          id: 'pi_cent', status: 'succeeded', currency: 'mxn', amount_received: 1,
        },
      };
      const { adapter } = makeAdapter({ session });
      expect((await adapter.getCharge({ gatewaySessionId: 'cs_test_ok' })).amountReceived).toBe(0.01);
    });

    it('a very large amount is not truncated', async () => {
      const session = {
        ...paidSession(),
        payment_intent: {
          id: 'pi_big', status: 'succeeded', currency: 'mxn', amount_received: 99999999999,
        },
      };
      const { adapter } = makeAdapter({ session });
      expect((await adapter.getCharge({ gatewaySessionId: 'cs_test_ok' })).amountReceived).toBe(999999999.99);
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('GC-U10 — PCI: the SDK object never comes out', () => {
    it('the whole result JSON carries no card-adjacent field', async () => {
      const { adapter } = makeAdapter({ session: paidSession() });
      const out = await adapter.getCharge({ gatewaySessionId: 'cs_test_ok' });
      const blob = JSON.stringify(out);
      for (const forbidden of ['4242', 'visa', 'last4', 'cvc', 'exp_month', 'payment_method_details', 'customer_details', 'pagador@example.com']) {
        expect(blob).not.toContain(forbidden);
      }
    });

    it('raw is the redacted shape only (the same curated keys the webhook persists)', async () => {
      const { adapter } = makeAdapter({ session: paidSession() });
      const out = await adapter.getCharge({ gatewaySessionId: 'cs_test_ok' });
      expect(Object.keys(out.raw).sort()).toEqual(
        ['amount', 'charge', 'currency', 'id', 'object', 'paymentIntent', 'status'].sort()
      );
    });

    it('an intent-only lookup redacts just the same', async () => {
      const intent = {
        id: 'pi_alone', object: 'payment_intent', status: 'succeeded', currency: 'mxn', amount_received: 100, ...CARD_JUNK,
      };
      const { adapter } = makeAdapter({ intent });
      const out = await adapter.getCharge({ gatewayIntentId: 'pi_alone' });
      expect(JSON.stringify(out)).not.toContain('4242');
      expect(JSON.stringify(out)).not.toContain('pagador@example.com');
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('GC-U11 — an SDK failure is wrapped, never surfaced raw', () => {
    it('a resource_missing error becomes a PROVIDER_ERROR with a redacted message', async () => {
      const sdkErr = new Error('No such checkout.session: cs_test_missing');
      sdkErr.type = 'StripeInvalidRequestError';
      sdkErr.code = 'resource_missing';
      sdkErr.charge = { payment_method_details: { card: { last4: '4242', brand: 'visa' } } };
      const { adapter } = makeAdapter({ fail: sdkErr });

      await expect(adapter.getCharge({ gatewaySessionId: 'cs_test_missing' })).rejects.toThrow(PaymentGatewayError);
      let caught;
      try {
        await adapter.getCharge({ gatewaySessionId: 'cs_test_missing' });
      } catch (err) {
        caught = err;
      }
      expect(caught.code).toBe(PaymentGatewayError.CODES.PROVIDER_ERROR);
      expect(caught.message).toContain('Stripe charge lookup failed');
      // The raw SDK error is NOT attached: a property walk must not reach card data.
      const walked = JSON.stringify(caught, Object.getOwnPropertyNames(caught));
      expect(walked).not.toContain('4242');
      expect(walked).not.toContain('visa');
      expect(walked).not.toContain('payment_method_details');
    });

    it('an error with no message still produces a usable PROVIDER_ERROR', async () => {
      const { adapter } = makeAdapter({ fail: {} });
      await expect(adapter.getCharge({ gatewayIntentId: 'pi_x' })).rejects.toMatchObject({
        code: PaymentGatewayError.CODES.PROVIDER_ERROR,
      });
    });

    it('a network timeout is wrapped the same way (never leaks the SDK vocabulary upward)', async () => {
      const timeout = new Error('Request aborted due to timeout being reached (20000ms)');
      const { adapter } = makeAdapter({ fail: timeout });
      await expect(adapter.getCharge({ gatewaySessionId: 'cs_slow' })).rejects.toThrow(/Stripe charge lookup failed/);
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('it is READ-ONLY', () => {
    it('never touches any write capability of the SDK client', async () => {
      const sessions = {
        retrieve: jest.fn(async () => paidSession()),
        create: jest.fn(),
        expire: jest.fn(),
      };
      const paymentIntents = { retrieve: jest.fn(), create: jest.fn(), cancel: jest.fn() };
      const adapter = new StripeAdapter({ client: { checkout: { sessions }, paymentIntents } });
      await adapter.getCharge({ gatewaySessionId: 'cs_test_ok' });
      expect(sessions.create).not.toHaveBeenCalled();
      expect(sessions.expire).not.toHaveBeenCalled();
      expect(paymentIntents.create).not.toHaveBeenCalled();
      expect(paymentIntents.cancel).not.toHaveBeenCalled();
    });
  });
});
