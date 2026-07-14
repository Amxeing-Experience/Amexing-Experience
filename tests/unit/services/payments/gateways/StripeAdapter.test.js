/**
 * StripeAdapter (PR1 stub) unit tests.
 * Pure logic, no Parse/Mongo/network. Identity, supported currencies, unconfigured
 * state, and consistent NOT_CONFIGURED behavior of charge-related capabilities under
 * repeated / malformed inputs.
 */

const StripeAdapter = require('../../../../../src/application/services/payments/gateways/StripeAdapter');
const PaymentGatewayService = require('../../../../../src/application/services/payments/PaymentGatewayService');
const PaymentGatewayError = require('../../../../../src/application/services/payments/PaymentGatewayError');

const CAPABILITIES = [
  'getId',
  'getSupportedCurrencies',
  'isConfigured',
  'createCharge',
  'getCharge',
  'refund',
  'verifyWebhook',
];
const CHARGE_METHODS = ['createCharge', 'getCharge', 'refund', 'verifyWebhook'];

describe('StripeAdapter (stub)', () => {
  let adapter;
  beforeEach(() => {
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

  it('isConfigured() is false (no real credentials in PR1)', () => {
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
        adapter[cap]();
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

    it('behaves identically across repeated calls', () => {
      const codes = [];
      for (let i = 0; i < 5; i += 1) {
        try {
          adapter.createCharge({ amount: i });
        } catch (e) {
          codes.push(e.code);
        }
      }
      expect(codes).toEqual(Array(5).fill(PaymentGatewayError.CODES.NOT_CONFIGURED));
    });
  });
});
