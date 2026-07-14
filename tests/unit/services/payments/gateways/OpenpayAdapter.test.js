/**
 * OpenpayAdapter (PR1 stub) unit tests.
 * Pure logic, no Parse/Mongo/network. The load-bearing assertion is the naming trap:
 * getId() MUST be "mexican", NOT "openpay". Also: MXN-only currencies, unconfigured
 * state, and consistent NOT_CONFIGURED behavior of charge-related capabilities.
 */

const OpenpayAdapter = require('../../../../../src/application/services/payments/gateways/OpenpayAdapter');
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

describe('OpenpayAdapter (stub)', () => {
  let adapter;
  beforeEach(() => {
    adapter = new OpenpayAdapter();
  });

  it('is a PaymentGatewayService', () => {
    expect(adapter).toBeInstanceOf(PaymentGatewayService);
  });

  it('getId() returns exactly "mexican" (NOT "openpay") -- the naming trap', () => {
    expect(adapter.getId()).toBe('mexican');
    expect(adapter.getId()).not.toBe('openpay');
  });

  it('getSupportedCurrencies() returns exactly ["MXN"] (no USD)', () => {
    expect(adapter.getSupportedCurrencies()).toEqual(['MXN']);
    expect(adapter.getSupportedCurrencies()).not.toContain('USD');
  });

  it('getSupportedCurrencies() returns a fresh copy (caller mutation is isolated)', () => {
    const first = adapter.getSupportedCurrencies();
    first.push('USD');
    expect(adapter.getSupportedCurrencies()).toEqual(['MXN']);
  });

  it('isConfigured() is false (Openpay onboarding not complete in PR1)', () => {
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
      it(`${method}() throws NOT_CONFIGURED tagged with gateway "mexican"`, () => {
        let error;
        try {
          adapter[method]();
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(PaymentGatewayError);
        expect(error.code).toBe(PaymentGatewayError.CODES.NOT_CONFIGURED);
        expect(error.gateway).toBe('mexican');
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
  });
});
