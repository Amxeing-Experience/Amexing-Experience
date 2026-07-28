/**
 * StripeAdapter identity + not-yet-wired-capability unit tests (no Parse/Mongo/network).
 *
 * As of PR4 the charge path (buildCheckout/createCharge) is REAL and covered by
 * StripeAdapter.buildCheckout.test.js against a mock client. Here we assert the pieces that are
 * still stub-shaped: identity, supported currencies, unconfigured state when no client/key is
 * present, and that the DEFERRED capabilities (getCharge=PR6, refund=PR11, verifyWebhook=PR5)
 * still fail with NOT_CONFIGURED (an override, never the inherited NOT_IMPLEMENTED) under repeated
 * / malformed inputs.
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
// Capabilities NOT yet wired in PR4 -> still throw NOT_CONFIGURED synchronously. createCharge is
// deliberately excluded: it is the real (async) Checkout path now.
const CHARGE_METHODS = ['getCharge', 'refund', 'verifyWebhook'];

describe('StripeAdapter', () => {
  let adapter;
  beforeEach(() => {
    // No injected client / no key -> isConfigured() must read false, independent of test order.
    stripeClient.resetForTests();
    adapter = new StripeAdapter();
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
});
