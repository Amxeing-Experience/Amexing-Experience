/**
 * StripeAdapter identity + not-yet-wired-capability unit tests (no Parse/Mongo/network).
 *
 * As of PR4 the charge path (buildCheckout/createCharge) is REAL and covered by
 * StripeAdapter.buildCheckout.test.js against a mock client. As of PR5 verifyWebhook is REAL too and
 * covered by StripeAdapter.verifyWebhook.test.js; what remains asserted here is its UNCONFIGURED
 * behavior (no signing secret in the environment), which must stay NOT_CONFIGURED rather than degrade
 * into a signature rejection. The genuinely deferred capabilities are getCharge (PR6) and refund
 * (PR11): they must keep failing NOT_CONFIGURED (an override, never the inherited NOT_IMPLEMENTED)
 * under repeated / malformed inputs.
 */

const StripeAdapter = require('../../../../../src/application/services/payments/gateways/StripeAdapter');
const PaymentGatewayService = require('../../../../../src/application/services/payments/PaymentGatewayService');
const PaymentGatewayError = require('../../../../../src/application/services/payments/PaymentGatewayError');
const stripeClient = require('../../../../../src/infrastructure/payments/stripeClient');

const CAPABILITIES = [
  'getId',
  'getSupportedCurrencies',
  'isConfigured',
  'createCharge',
  'getCharge',
  'refund',
  'verifyWebhook',
];
// Capabilities still NOT wired -> they throw NOT_CONFIGURED synchronously. createCharge (PR4) and
// verifyWebhook (PR5) are deliberately excluded: both are real paths now, each with its own suite.
const CHARGE_METHODS = ['getCharge', 'refund'];

describe('StripeAdapter', () => {
  let adapter;
  const savedWebhookSecrets = process.env.STRIPE_WEBHOOK_SECRETS;

  beforeEach(() => {
    // No injected client / no key -> isConfigured() must read false, independent of test order.
    stripeClient.resetForTests();
    // No signing secret either: this suite asserts the UNCONFIGURED shape of every capability.
    delete process.env.STRIPE_WEBHOOK_SECRETS;
    adapter = new StripeAdapter();
  });

  afterAll(() => {
    if (savedWebhookSecrets === undefined) delete process.env.STRIPE_WEBHOOK_SECRETS;
    else process.env.STRIPE_WEBHOOK_SECRETS = savedWebhookSecrets;
  });

  it('is a PaymentGatewayService', () => {
    expect(adapter).toBeInstanceOf(PaymentGatewayService);
  });

  it('getId() returns exactly "stripe"', () => {
    expect(adapter.getId()).toBe('stripe');
  });

  it('getSupportedCurrencies() returns exactly ["USD","MXN"]', () => {
    expect(adapter.getSupportedCurrencies()).toEqual(['USD', 'MXN']);
  });

  it('getSupportedCurrencies() returns a fresh copy (caller mutation is isolated)', () => {
    const first = adapter.getSupportedCurrencies();
    first.push('EUR');
    expect(adapter.getSupportedCurrencies()).toEqual(['USD', 'MXN']);
  });

  it('isConfigured() is false with no injected client and no environment key', () => {
    expect(adapter.isConfigured()).toBe(false);
  });

  it('all 7 capabilities exist as functions', () => {
    CAPABILITIES.forEach((cap) => {
      expect(typeof adapter[cap]).toBe('function');
    });
  });

  it('no capability throws NOT_IMPLEMENTED (all are overridden)', () => {
    CAPABILITIES.forEach((cap) => {
      try {
        const out = adapter[cap]();
        // createCharge is async (real Checkout path): swallow its rejection so it never leaks as
        // an unhandled promise rejection. Its NOT_IMPLEMENTED-vs-real behavior is covered by
        // StripeAdapter.buildCheckout.test.js.
        if (out && typeof out.then === 'function') out.catch(() => {});
      } catch (e) {
        expect(e.code).not.toBe(PaymentGatewayError.CODES.NOT_IMPLEMENTED);
      }
    });
  });

  describe('charge-related methods throw NOT_CONFIGURED consistently (Decision #7)', () => {
    CHARGE_METHODS.forEach((method) => {
      it(`${method}() throws NOT_CONFIGURED`, () => {
        let error;
        try {
          adapter[method]();
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(PaymentGatewayError);
        expect(error.code).toBe(PaymentGatewayError.CODES.NOT_CONFIGURED);
        expect(error.gateway).toBe('stripe');
      });
    });

    const malformed = [
      ['no args', []],
      ['empty object', [{}]],
      ['negative amount', [{ amount: -100, currency: 'MXN' }]],
      ['empty idempotency key', [{ amount: 100, currency: 'MXN', idempotencyKey: '' }]],
      ['null', [null]],
      ['garbage string', ['not-a-charge']],
    ];

    CHARGE_METHODS.forEach((method) => {
      malformed.forEach(([label, args]) => {
        it(`${method}(${label}) still throws NOT_CONFIGURED, never an unrelated error`, () => {
          let error;
          try {
            adapter[method](...args);
          } catch (e) {
            error = e;
          }
          expect(error).toBeInstanceOf(PaymentGatewayError);
          expect(error).not.toBeInstanceOf(TypeError);
          expect(error.code).toBe(PaymentGatewayError.CODES.NOT_CONFIGURED);
        });
      });
    });

    it('behaves identically across repeated calls (deferred capability stays NOT_CONFIGURED)', () => {
      const codes = [];
      for (let i = 0; i < 5; i += 1) {
        try {
          adapter.refund({ chargeId: `ch_${i}` });
        } catch (e) {
          codes.push(e.code);
        }
      }
      expect(codes).toEqual(Array(5).fill(PaymentGatewayError.CODES.NOT_CONFIGURED));
    });
  });

  // verifyWebhook is implemented (PR5), but with no signing secret in the environment it must report
  // a CONFIGURATION problem, never a signature rejection — otherwise a missing secret in a deployment
  // is indistinguishable in the logs from someone hammering the endpoint with forged payloads.
  describe('verifyWebhook without a configured signing secret', () => {
    it('isWebhookConfigured() is false', () => {
      expect(adapter.isWebhookConfigured()).toBe(false);
    });

    const inputs = [
      ['no args', []],
      ['raw body only', [Buffer.from('{}')]],
      ['body + garbage signature', [Buffer.from('{}'), 'not-a-signature']],
      ['nulls', [null, null]],
      ['already-parsed object', [{ id: 'evt_1' }, 't=1,v1=abc']],
    ];

    it.each(inputs)('verifyWebhook(%s) throws NOT_CONFIGURED, not INVALID_SIGNATURE', (_label, args) => {
      let error;
      try {
        adapter.verifyWebhook(...args);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(PaymentGatewayError);
      expect(error.code).toBe(PaymentGatewayError.CODES.NOT_CONFIGURED);
      expect(error.code).not.toBe(PaymentGatewayError.CODES.INVALID_SIGNATURE);
      expect(error.gateway).toBe('stripe');
    });
  });
});
