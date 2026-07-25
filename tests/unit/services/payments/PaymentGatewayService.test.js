/**
 * PaymentGatewayService (abstract base) unit tests.
 * Pure logic, no Parse/Mongo/network. Each of the 7 capabilities must throw an
 * explicit NOT_IMPLEMENTED PaymentGatewayError when not overridden (never a raw
 * "is not a function" TypeError), and the base class cannot be instantiated directly.
 */

const PaymentGatewayService = require('../../../../src/application/services/payments/PaymentGatewayService');
const PaymentGatewayError = require('../../../../src/application/services/payments/PaymentGatewayError');

const CAPABILITIES = [
  'getId',
  'getSupportedCurrencies',
  'isConfigured',
  'createCharge',
  'getCharge',
  'refund',
  'verifyWebhook',
];

// Valid implementations used to fill in every capability EXCEPT the one under test.
const IMPLS = {
  getId: () => 'test-gateway',
  getSupportedCurrencies: () => ['MXN'],
  isConfigured: () => true,
  createCharge: () => ({ status: 'succeeded' }),
  getCharge: () => ({ status: 'succeeded' }),
  refund: () => ({ status: 'refunded' }),
  verifyWebhook: () => ({ type: 'succeeded' }),
};

/**
 * Build a concrete subclass instance that overrides every capability except one, so
 * exactly that one capability falls through to the abstract base thrower.
 * @param {string} missing - The capability to leave un-overridden.
 * @returns {PaymentGatewayService} The partial adapter instance.
 */
function makeAdapterMissing(missing) {
  class PartialAdapter extends PaymentGatewayService {}
  CAPABILITIES.forEach((cap) => {
    if (cap !== missing) {
      PartialAdapter.prototype[cap] = IMPLS[cap];
    }
  });
  return new PartialAdapter();
}

describe('PaymentGatewayService (abstract base)', () => {
  describe('direct instantiation', () => {
    it('throws NOT_IMPLEMENTED when instantiated directly', () => {
      let error;
      try {
        // eslint-disable-next-line no-new
        new PaymentGatewayService();
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(PaymentGatewayError);
      expect(error.code).toBe(PaymentGatewayError.CODES.NOT_IMPLEMENTED);
    });
  });

  describe('each capability isolated (missing exactly one)', () => {
    CAPABILITIES.forEach((cap) => {
      it(`${cap}() throws NOT_IMPLEMENTED when it is the only un-overridden capability`, () => {
        const adapter = makeAdapterMissing(cap);

        let error;
        try {
          adapter[cap]();
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(PaymentGatewayError);
        expect(error.code).toBe(PaymentGatewayError.CODES.NOT_IMPLEMENTED);

        // Every OTHER capability is overridden and must NOT throw NOT_IMPLEMENTED.
        CAPABILITIES.filter((other) => other !== cap).forEach((other) => {
          expect(() => adapter[other]()).not.toThrow();
        });
      });
    });
  });

  describe('subclass overriding nothing', () => {
    class EmptyAdapter extends PaymentGatewayService {}
    const empty = new EmptyAdapter();

    CAPABILITIES.forEach((cap) => {
      it(`${cap}() throws NOT_IMPLEMENTED (not a raw TypeError)`, () => {
        let error;
        try {
          empty[cap]();
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(PaymentGatewayError);
        expect(error).not.toBeInstanceOf(TypeError);
        expect(error.code).toBe(PaymentGatewayError.CODES.NOT_IMPLEMENTED);
      });
    });

    it('getId() reporting does not recurse into a stack overflow', () => {
      // getId itself is the un-overridden capability, so the NOT_IMPLEMENTED builder
      // must not call getId() again. A RangeError here would signal infinite recursion.
      expect(() => empty.getId()).toThrow(PaymentGatewayError);
      expect(() => empty.getId()).not.toThrow(RangeError);
    });
  });
});
