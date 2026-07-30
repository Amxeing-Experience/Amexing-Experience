/**
 * StripeAdapter.verifyWebhook — signature verification (REAL SDK crypto, zero network).
 *
 * Nothing here mocks constructEvent: the signatures are produced by the SDK's own
 * webhooks.generateTestHeaderString and verified by the SDK's own constructEvent, with a dummy
 * whsec_ secret. Mocking the verifier would test our plumbing against our own assumptions instead of
 * against the mechanism that actually guards the endpoint.
 *
 * The distinction that matters most: "no secret configured" (NOT_CONFIGURED, a deployment mistake)
 * must NEVER be reported as "signature invalid" (INVALID_SIGNATURE, a rejected delivery). Collapsing
 * them is how a broken deployment hides for weeks behind a symptom that looks like an attack.
 */

const Stripe = require('stripe');
const StripeAdapter = require('../../../../../src/application/services/payments/gateways/StripeAdapter');
const PaymentGatewayError = require('../../../../../src/application/services/payments/PaymentGatewayError');
const stripeClient = require('../../../../../src/infrastructure/payments/stripeClient');

const SECRET_A = 'whsec_test_secret_alpha_0123456789';
const SECRET_B = 'whsec_test_secret_bravo_9876543210';

// A signing-only SDK instance: constructing it performs no I/O, and only .webhooks is ever used.
const signer = Stripe('sk_test_dummy_signing_key_not_used_for_io');

const buildPayload = (overrides = {}) => JSON.stringify({
  id: 'evt_unit_1',
  type: 'checkout.session.completed',
  livemode: false,
  data: { object: { id: 'cs_test_1', object: 'checkout.session', metadata: { paymentId: 'pay1' } } },
  ...overrides,
});

const sign = (payload, secret, timestamp) => signer.webhooks.generateTestHeaderString(
  timestamp === undefined ? { payload, secret } : { payload, secret, timestamp }
);

describe('StripeAdapter.verifyWebhook (real signature mechanism)', () => {
  const savedSecrets = process.env.STRIPE_WEBHOOK_SECRETS;
  let adapter;

  beforeEach(() => {
    // Inject a client that exposes the REAL webhooks helper (and nothing else) — no API key needed to
    // verify a signature, and no network is reachable from here.
    stripeClient.setClientForTests({ webhooks: signer.webhooks });
    adapter = new StripeAdapter();
    process.env.STRIPE_WEBHOOK_SECRETS = SECRET_A;
  });

  afterAll(() => {
    stripeClient.resetForTests();
    if (savedSecrets === undefined) delete process.env.STRIPE_WEBHOOK_SECRETS;
    else process.env.STRIPE_WEBHOOK_SECRETS = savedSecrets;
  });

  describe('happy path', () => {
    it('a correctly signed Buffer body verifies and returns the parsed event', () => {
      const payload = buildPayload();
      const event = adapter.verifyWebhook(Buffer.from(payload), sign(payload, SECRET_A));
      expect(event.id).toBe('evt_unit_1');
      expect(event.type).toBe('checkout.session.completed');
      expect(event.data.object.metadata.paymentId).toBe('pay1');
    });

    it('a correctly signed string body verifies too (Buffer or string, never a parsed object)', () => {
      const payload = buildPayload({ id: 'evt_unit_str' });
      expect(adapter.verifyWebhook(payload, sign(payload, SECRET_A)).id).toBe('evt_unit_str');
    });
  });

  describe('rotation — a LIST of secrets, tried in order', () => {
    it('a signature made with the SECOND secret of two still verifies', () => {
      process.env.STRIPE_WEBHOOK_SECRETS = `${SECRET_A},${SECRET_B}`;
      const payload = buildPayload({ id: 'evt_rot_2nd' });
      expect(adapter.verifyWebhook(payload, sign(payload, SECRET_B)).id).toBe('evt_rot_2nd');
    });

    it('a signature made with the FIRST secret of two still verifies (no ordering bias)', () => {
      process.env.STRIPE_WEBHOOK_SECRETS = `${SECRET_A},${SECRET_B}`;
      const payload = buildPayload({ id: 'evt_rot_1st' });
      expect(adapter.verifyWebhook(payload, sign(payload, SECRET_A)).id).toBe('evt_rot_1st');
    });

    it('whitespace and empty entries around the commas are tolerated', () => {
      process.env.STRIPE_WEBHOOK_SECRETS = `  ,  ${SECRET_A} ,, ${SECRET_B}  ,`;
      const payload = buildPayload({ id: 'evt_rot_ws' });
      expect(adapter.verifyWebhook(payload, sign(payload, SECRET_B)).id).toBe('evt_rot_ws');
    });

    it('a secret NOT in the list is rejected even if the list is long', () => {
      process.env.STRIPE_WEBHOOK_SECRETS = `${SECRET_A},${SECRET_B}`;
      const payload = buildPayload();
      expect(() => adapter.verifyWebhook(payload, sign(payload, 'whsec_not_in_the_list')))
        .toThrow(expect.objectContaining({ code: PaymentGatewayError.CODES.INVALID_SIGNATURE }));
    });
  });

  describe('NOT_CONFIGURED (503 territory) — never confused with a bad signature', () => {
    const notConfiguredCases = [
      ['unset', undefined],
      ['empty string', ''],
      ['only whitespace', '   '],
      ['only commas', ',,,'],
      ['only whitespace and commas', ' , , '],
      ['a pasted API key instead of a webhook secret', 'sk_test_51abcdef'],
      ['a publishable key', 'pk_test_51abcdef'],
      ['junk', 'not-a-secret'],
      ['several invalid entries', 'foo,bar,sk_live_nope'],
    ];

    it.each(notConfiguredCases)('%s => NOT_CONFIGURED', (_label, value) => {
      if (value === undefined) delete process.env.STRIPE_WEBHOOK_SECRETS;
      else process.env.STRIPE_WEBHOOK_SECRETS = value;
      const payload = buildPayload();
      let thrown;
      try {
        adapter.verifyWebhook(payload, sign(payload, SECRET_A));
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(PaymentGatewayError);
      expect(thrown.code).toBe(PaymentGatewayError.CODES.NOT_CONFIGURED);
      expect(thrown.code).not.toBe(PaymentGatewayError.CODES.INVALID_SIGNATURE);
    });

    it('a list mixing one VALID whsec_ with junk still works (the junk is dropped, not fatal)', () => {
      process.env.STRIPE_WEBHOOK_SECRETS = `garbage,${SECRET_A},sk_test_wrong`;
      const payload = buildPayload({ id: 'evt_mixed' });
      expect(adapter.verifyWebhook(payload, sign(payload, SECRET_A)).id).toBe('evt_mixed');
    });

    it('a client without .webhooks => NOT_CONFIGURED (not a signature rejection)', () => {
      stripeClient.setClientForTests({ checkout: { sessions: {} } });
      const isolated = new StripeAdapter();
      const payload = buildPayload();
      expect(() => isolated.verifyWebhook(payload, sign(payload, SECRET_A)))
        .toThrow(expect.objectContaining({ code: PaymentGatewayError.CODES.NOT_CONFIGURED }));
    });

    it('no client at all and no API key => NOT_CONFIGURED (not a 500, not a signature rejection)', () => {
      stripeClient.resetForTests();
      const savedKey = process.env.STRIPE_SECRET_KEY_TEST;
      delete process.env.STRIPE_SECRET_KEY_TEST;
      try {
        const isolated = new StripeAdapter();
        const payload = buildPayload();
        expect(() => isolated.verifyWebhook(payload, sign(payload, SECRET_A)))
          .toThrow(expect.objectContaining({ code: PaymentGatewayError.CODES.NOT_CONFIGURED }));
      } finally {
        if (savedKey !== undefined) process.env.STRIPE_SECRET_KEY_TEST = savedKey;
        stripeClient.setClientForTests({ webhooks: signer.webhooks });
      }
    });

    it('the thrown message carries WHY the client is unusable (a crossed key is not "missing")', () => {
      // Two very different deployment mistakes share the NOT_CONFIGURED code, so the message is the
      // only thing that tells an operator which one to fix. A bare catch {} threw the same sentence
      // for both and the real cause died inside the SDK/stripeClient error.
      stripeClient.resetForTests();
      const savedKey = process.env.STRIPE_SECRET_KEY_TEST;
      process.env.STRIPE_SECRET_KEY_TEST = 'sk_live_llave_de_produccion_por_error';
      try {
        const isolated = new StripeAdapter();
        const payload = buildPayload();
        let thrown;
        try {
          isolated.verifyWebhook(payload, sign(payload, SECRET_A));
        } catch (err) {
          thrown = err;
        }
        expect(thrown).toBeInstanceOf(PaymentGatewayError);
        expect(thrown.code).toBe(PaymentGatewayError.CODES.NOT_CONFIGURED);
        expect(thrown.message).toMatch(/LIVE secret key/i);
        // ...and the credential itself never travels in the message.
        expect(thrown.message).not.toContain('sk_live_llave_de_produccion_por_error');
      } finally {
        if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY_TEST;
        else process.env.STRIPE_SECRET_KEY_TEST = savedKey;
        stripeClient.setClientForTests({ webhooks: signer.webhooks });
      }
    });

    it('the thrown message says "not configured" when there is no key at all (different cause, same code)', () => {
      stripeClient.resetForTests();
      const savedKey = process.env.STRIPE_SECRET_KEY_TEST;
      delete process.env.STRIPE_SECRET_KEY_TEST;
      try {
        const isolated = new StripeAdapter();
        const payload = buildPayload();
        let thrown;
        try {
          isolated.verifyWebhook(payload, sign(payload, SECRET_A));
        } catch (err) {
          thrown = err;
        }
        expect(thrown.code).toBe(PaymentGatewayError.CODES.NOT_CONFIGURED);
        expect(thrown.message).toMatch(/secret key is not configured/i);
        expect(thrown.message).not.toMatch(/LIVE secret key/i); // distinguishable from the case above
      } finally {
        if (savedKey !== undefined) process.env.STRIPE_SECRET_KEY_TEST = savedKey;
        stripeClient.setClientForTests({ webhooks: signer.webhooks });
      }
    });

    it('isWebhookConfigured() agrees with the thrown code', () => {
      process.env.STRIPE_WEBHOOK_SECRETS = 'junk-only';
      expect(adapter.isWebhookConfigured()).toBe(false);
      process.env.STRIPE_WEBHOOK_SECRETS = SECRET_A;
      expect(adapter.isWebhookConfigured()).toBe(true);
    });
  });

  describe('INVALID_SIGNATURE (400 territory)', () => {
    it('a signature made with the WRONG secret is rejected', () => {
      const payload = buildPayload();
      expect(() => adapter.verifyWebhook(payload, sign(payload, 'whsec_wrong_secret_value')))
        .toThrow(expect.objectContaining({ code: PaymentGatewayError.CODES.INVALID_SIGNATURE }));
    });

    it('a TAMPERED body (amount edited after signing) is rejected', () => {
      const payload = JSON.stringify({ id: 'evt_t', type: 'payment_intent.succeeded', data: { object: { amount: 100 } } });
      const header = sign(payload, SECRET_A);
      const tampered = JSON.stringify({ id: 'evt_t', type: 'payment_intent.succeeded', data: { object: { amount: 999999 } } });
      expect(() => adapter.verifyWebhook(tampered, header))
        .toThrow(expect.objectContaining({ code: PaymentGatewayError.CODES.INVALID_SIGNATURE }));
    });

    const badHeaders = [
      ['missing (undefined)', undefined],
      ['empty', ''],
      ['garbage', 'not-a-signature'],
      ['well-formed but fake', 't=1,v1=deadbeef'],
      ['array (header injection attempt)', ['t=1', 'v1=deadbeef']],
      ['null', null],
    ];
    it.each(badHeaders)('a %s stripe-signature header is rejected', (_label, header) => {
      const payload = buildPayload();
      expect(() => adapter.verifyWebhook(payload, header))
        .toThrow(expect.objectContaining({ code: PaymentGatewayError.CODES.INVALID_SIGNATURE }));
    });

    it('an ALREADY-PARSED body (the mis-mounting bug) is rejected, never silently accepted', () => {
      // This is exactly what a wrong mount in index.js would deliver: a plain object instead of the
      // raw Buffer. It must fail closed.
      const payload = buildPayload();
      const header = sign(payload, SECRET_A);
      expect(() => adapter.verifyWebhook(JSON.parse(payload), header))
        .toThrow(expect.objectContaining({ code: PaymentGatewayError.CODES.INVALID_SIGNATURE }));
    });

    it('an empty body is rejected', () => {
      const payload = buildPayload();
      expect(() => adapter.verifyWebhook(Buffer.alloc(0), sign(payload, SECRET_A)))
        .toThrow(expect.objectContaining({ code: PaymentGatewayError.CODES.INVALID_SIGNATURE }));
    });
  });

  describe('replay tolerance — the SDK default (5 min), never 0', () => {
    it('a signature stamped 10 minutes ago is rejected (outside the window)', () => {
      const payload = buildPayload({ id: 'evt_old' });
      const oldTs = Math.floor(Date.now() / 1000) - 10 * 60;
      expect(() => adapter.verifyWebhook(payload, sign(payload, SECRET_A, oldTs)))
        .toThrow(expect.objectContaining({ code: PaymentGatewayError.CODES.INVALID_SIGNATURE }));
    });

    it('a signature stamped 4 minutes ago still verifies — proving tolerance is NOT 0', () => {
      // With tolerance:0 the SDK rejects anything not stamped in the current second, so this exact
      // assertion is what makes "we never pass tolerance: 0" a behavioral fact, not a code comment.
      const payload = buildPayload({ id: 'evt_recent' });
      const recentTs = Math.floor(Date.now() / 1000) - 4 * 60;
      expect(adapter.verifyWebhook(payload, sign(payload, SECRET_A, recentTs)).id).toBe('evt_recent');
    });

    it('a signature stamped 60 seconds ago verifies (ordinary network latency)', () => {
      const payload = buildPayload({ id: 'evt_1min' });
      const ts = Math.floor(Date.now() / 1000) - 60;
      expect(adapter.verifyWebhook(payload, sign(payload, SECRET_A, ts)).id).toBe('evt_1min');
    });

    it('the source code never passes a tolerance argument to constructEvent', () => {
      // Static belt to the behavioral suspenders above: a future refactor that adds `, 0` would be
      // caught here even if it somehow kept the 4-minute case green.
      const fs = require('fs');
      const path = require('path');
      const source = fs.readFileSync(
        path.join(__dirname, '../../../../../src/application/services/payments/gateways/StripeAdapter.js'),
        'utf8'
      );
      const calls = source.match(/constructEvent\([^)]*\)/g) || [];
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.split(',')).toHaveLength(3); // rawBody, signatureHeader, secret — nothing else
      }
      // No tolerance is ever assigned/passed anywhere (the word only survives in prose comments).
      expect(source).not.toMatch(/tolerance\s*[:=]/);
    });
  });
});
