/**
 * GatewayRegistry unit tests.
 * Pure logic, no Parse/Mongo/network. Covers register/resolve/list happy path,
 * duplicate registration, unknown-id resolution, empty registry, and fail-fast
 * rejection of malformed ids / instances / id arguments (typed errors, never raw
 * TypeErrors).
 */

const GatewayRegistry = require('../../../../src/application/services/payments/GatewayRegistry');
const PaymentGatewayError = require('../../../../src/application/services/payments/PaymentGatewayError');
const PaymentGatewayService = require('../../../../src/application/services/payments/PaymentGatewayService');
const StripeAdapter = require('../../../../src/application/services/payments/gateways/StripeAdapter');
const OpenpayAdapter = require('../../../../src/application/services/payments/gateways/OpenpayAdapter');

/**
 * Build a minimal duck-typed adapter with all required capabilities.
 * @param {object} overrides - Fields to override (e.g. a custom getId).
 * @returns {object} A registrable adapter-like object.
 */
function makeMockAdapter(overrides = {}) {
  return {
    getId: () => 'mock',
    getSupportedCurrencies: () => ['MXN'],
    isConfigured: () => true,
    createCharge: () => ({}),
    getCharge: () => ({}),
    refund: () => ({}),
    verifyWebhook: () => ({}),
    ...overrides,
  };
}

describe('GatewayRegistry', () => {
  describe('happy path', () => {
    it('registers and resolves an adapter by its own id', () => {
      const registry = new GatewayRegistry();
      const stripe = new StripeAdapter();
      registry.register(stripe);
      expect(registry.resolve('stripe')).toBe(stripe);
    });

    it('keys the adapter by getId() (openpay adapter registers as "mexican")', () => {
      const registry = new GatewayRegistry();
      registry.register(new OpenpayAdapter());
      expect(registry.has('mexican')).toBe(true);
      expect(registry.has('openpay')).toBe(false);
    });

    it('lists all registered ids', () => {
      const registry = new GatewayRegistry();
      registry.register(new StripeAdapter());
      registry.register(new OpenpayAdapter());
      expect(registry.list().sort()).toEqual(['mexican', 'stripe']);
    });

    it('register() is chainable', () => {
      const registry = new GatewayRegistry();
      const result = registry.register(new StripeAdapter());
      expect(result).toBe(registry);
    });

    it('has() reports registration state', () => {
      const registry = new GatewayRegistry();
      expect(registry.has('stripe')).toBe(false);
      registry.register(new StripeAdapter());
      expect(registry.has('stripe')).toBe(true);
    });
  });

  describe('empty registry', () => {
    it('list() returns an empty array', () => {
      expect(new GatewayRegistry().list()).toEqual([]);
    });

    it('resolve() on an empty registry throws UNKNOWN_GATEWAY', () => {
      const registry = new GatewayRegistry();
      let error;
      try {
        registry.resolve('stripe');
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(PaymentGatewayError);
      expect(error.code).toBe(PaymentGatewayError.CODES.UNKNOWN_GATEWAY);
    });
  });

  describe('duplicate registration (Decision #1)', () => {
    it('throws PROVIDER_ERROR when the same id is registered twice', () => {
      const registry = new GatewayRegistry();
      registry.register(new StripeAdapter());
      let error;
      try {
        registry.register(new StripeAdapter());
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(PaymentGatewayError);
      expect(error.code).toBe(PaymentGatewayError.CODES.PROVIDER_ERROR);
    });

    it('does not overwrite the original instance after a rejected duplicate', () => {
      const registry = new GatewayRegistry();
      const first = new StripeAdapter();
      registry.register(first);
      expect(() => registry.register(new StripeAdapter())).toThrow(PaymentGatewayError);
      expect(registry.resolve('stripe')).toBe(first);
    });
  });

  describe('resolve of unregistered / wrong-typed id', () => {
    it('unregistered id throws a typed UNKNOWN_GATEWAY error', () => {
      const registry = new GatewayRegistry();
      registry.register(new StripeAdapter());
      let error;
      try {
        registry.resolve('ghost');
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(PaymentGatewayError);
      expect(error.code).toBe(PaymentGatewayError.CODES.UNKNOWN_GATEWAY);
    });

    [null, undefined, 42, {}, [], ''].forEach((badId) => {
      it(`resolve(${JSON.stringify(badId)}) throws a typed error, not a raw TypeError`, () => {
        const registry = new GatewayRegistry();
        let error;
        try {
          registry.resolve(badId);
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(PaymentGatewayError);
        expect(error).not.toBeInstanceOf(TypeError);
        expect(error.code).toBe(PaymentGatewayError.CODES.UNKNOWN_GATEWAY);
      });
    });
  });

  describe('fail-fast shape validation at registration (Decision #2)', () => {
    [null, undefined, 42, 'stripe', true].forEach((badInstance) => {
      it(`rejects a non-object instance (${JSON.stringify(badInstance)}) with PROVIDER_ERROR`, () => {
        const registry = new GatewayRegistry();
        let error;
        try {
          registry.register(badInstance);
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(PaymentGatewayError);
        expect(error.code).toBe(PaymentGatewayError.CODES.PROVIDER_ERROR);
      });
    });

    it('rejects an instance missing a required capability', () => {
      const registry = new GatewayRegistry();
      const incomplete = makeMockAdapter();
      delete incomplete.refund;
      let error;
      try {
        registry.register(incomplete);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(PaymentGatewayError);
      expect(error.code).toBe(PaymentGatewayError.CODES.PROVIDER_ERROR);
    });

    it('rejects an instance whose getId() returns an empty/whitespace id', () => {
      const registry = new GatewayRegistry();
      expect(() => registry.register(makeMockAdapter({ getId: () => '' }))).toThrow(PaymentGatewayError);
      expect(() => registry.register(makeMockAdapter({ getId: () => '   ' }))).toThrow(PaymentGatewayError);
    });

    it('rejects an instance whose getId() returns a non-string', () => {
      const registry = new GatewayRegistry();
      expect(() => registry.register(makeMockAdapter({ getId: () => 123 }))).toThrow(PaymentGatewayError);
      expect(() => registry.register(makeMockAdapter({ getId: () => null }))).toThrow(PaymentGatewayError);
    });

    it('rejects an instance whose getId() throws', () => {
      const registry = new GatewayRegistry();
      const throwingId = makeMockAdapter({
        getId: () => {
          throw new Error('boom');
        },
      });
      let error;
      try {
        registry.register(throwingId);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(PaymentGatewayError);
      expect(error.code).toBe(PaymentGatewayError.CODES.PROVIDER_ERROR);
    });

    it('a required capability that is present but not a function is rejected', () => {
      const registry = new GatewayRegistry();
      const badRefund = makeMockAdapter({ refund: 'not-a-function' });
      expect(() => registry.register(badRefund)).toThrow(PaymentGatewayError);
    });

    it('rejects a PaymentGatewayService subclass that inherits an abstract stub instead of overriding it', () => {
      // Overrides 6 of 7 capabilities; refund() is left as the inherited base stub, which
      // passes a naive typeof-function check but only throws NOT_IMPLEMENTED when invoked.
      class MissingRefundAdapter extends PaymentGatewayService {
        getId() { return 'future'; }

        getSupportedCurrencies() { return ['MXN']; }

        isConfigured() { return true; }

        createCharge() { return {}; }

        getCharge() { return {}; }

        verifyWebhook() { return {}; }
      }
      const registry = new GatewayRegistry();
      let error;
      try {
        registry.register(new MissingRefundAdapter());
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(PaymentGatewayError);
      expect(error.code).toBe(PaymentGatewayError.CODES.PROVIDER_ERROR);
      expect(registry.has('future')).toBe(false); // registration failed loud, nothing keyed
    });

    it('accepts a fully-overriding PaymentGatewayService subclass (StripeAdapter regression guard)', () => {
      // StripeAdapter/OpenpayAdapter extend PaymentGatewayService and override every
      // capability, so the inherited-stub guard must NOT reject them.
      const registry = new GatewayRegistry();
      expect(() => registry.register(new StripeAdapter())).not.toThrow();
      expect(registry.has('stripe')).toBe(true);
    });
  });

  describe('no shared mutable state across instances', () => {
    it('two registries do not share adapters', () => {
      const a = new GatewayRegistry();
      const b = new GatewayRegistry();
      a.register(new StripeAdapter());
      expect(a.has('stripe')).toBe(true);
      expect(b.has('stripe')).toBe(false);
    });
  });
});
