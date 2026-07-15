/**
 * GatewayRouter unit tests (RTR matrix).
 * Pure logic, no Parse/Mongo/network. Drives the full currency x toggle decision table
 * (plan seccion 4.5) with controllable fake adapters + a fake registry + an injected
 * spy logger: happy paths, USD-forces-Stripe, fallback-to-Stripe on unconfigured /
 * unregistered / corrupt toggles, adversarial toggle & currency inputs, empty registry,
 * and no-shared-mutable-state.
 */

const GatewayRouter = require('../../../../src/application/services/payments/GatewayRouter');
const PaymentGatewayError = require('../../../../src/application/services/payments/PaymentGatewayError');

/**
 * Build a controllable fake adapter.
 * @param {string} id - Gateway id.
 * @param {string[]} currencies - Supported currencies.
 * @param {boolean} configured - isConfigured() value.
 * @returns {object} A fake adapter instance.
 */
function fakeAdapter(id, currencies, configured) {
  return {
    getId: () => id,
    getSupportedCurrencies: () => currencies,
    isConfigured: () => configured,
    createCharge: () => ({}),
    getCharge: () => ({}),
    refund: () => ({}),
    verifyWebhook: () => ({}),
  };
}

/**
 * Build a fake registry backed by a plain object map.
 * @param {object} map - id -> adapter.
 * @returns {object} A registry-like object with has()/resolve().
 */
function fakeRegistry(map) {
  return {
    has: (id) => Object.prototype.hasOwnProperty.call(map, id),
    resolve: (id) => {
      if (!Object.prototype.hasOwnProperty.call(map, id)) {
        throw new PaymentGatewayError(PaymentGatewayError.CODES.UNKNOWN_GATEWAY, `no ${id}`);
      }
      return map[id];
    },
  };
}

function spyLogger() {
  return { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
}

// Standard wiring: both gateways registered. Stripe supports USD+MXN, mexican MXN only.
function standardSetup({ mexicanConfigured = true, stripeConfigured = true } = {}) {
  const stripe = fakeAdapter('stripe', ['USD', 'MXN'], stripeConfigured);
  const mexican = fakeAdapter('mexican', ['MXN'], mexicanConfigured);
  const logger = spyLogger();
  const registry = fakeRegistry({ stripe, mexican });
  const router = new GatewayRouter(registry, { logger });
  return {
    stripe, mexican, logger, registry, router,
  };
}

describe('GatewayRouter', () => {
  describe('constructor guard', () => {
    it('throws PROVIDER_ERROR without a usable registry', () => {
      expect(() => new GatewayRouter(null)).toThrow(PaymentGatewayError);
      expect(() => new GatewayRouter({})).toThrow(PaymentGatewayError);
      expect(() => new GatewayRouter({ has: () => true })).toThrow(PaymentGatewayError);
    });

    it('accepts a registry and defaults the logger when none injected', () => {
      const registry = fakeRegistry({ stripe: fakeAdapter('stripe', ['USD', 'MXN'], true) });
      expect(() => new GatewayRouter(registry)).not.toThrow();
    });
  });

  describe('USD forces Stripe (currency > toggle)', () => {
    it('RTR-01: USD + toggle=stripe -> stripe', () => {
      const { router, stripe } = standardSetup();
      expect(router.resolve('USD', 'stripe')).toBe(stripe);
    });

    it('RTR-02: USD + toggle=mexican -> stripe, with a usd-forces-stripe warning', () => {
      const { router, stripe, logger } = standardSetup();
      expect(router.resolve('USD', 'mexican')).toBe(stripe);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('usd-forces-stripe'));
    });

    it('RTR-03: USD does not warn when toggle already points to stripe', () => {
      const { router, logger } = standardSetup();
      router.resolve('USD', 'stripe');
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('MXN toggle honored', () => {
    it('RTR-04: MXN + toggle=mexican (configured, MXN-capable) -> mexican', () => {
      const { router, mexican } = standardSetup();
      expect(router.resolve('MXN', 'mexican')).toBe(mexican);
    });

    it('RTR-05: MXN + toggle=stripe -> stripe', () => {
      const { router, stripe } = standardSetup();
      expect(router.resolve('MXN', 'stripe')).toBe(stripe);
    });
  });

  describe('MXN fallback to Stripe', () => {
    it('RTR-06: MXN + toggle=mexican but mexican NOT configured -> stripe (warn)', () => {
      const { router, stripe, logger } = standardSetup({ mexicanConfigured: false });
      expect(router.resolve('MXN', 'mexican')).toBe(stripe);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('RTR-07: MXN + toggle=mexican but mexican not MXN-capable -> stripe (warn)', () => {
      const stripe = fakeAdapter('stripe', ['USD', 'MXN'], true);
      const mexican = fakeAdapter('mexican', ['USD'], true); // declares no MXN
      const logger = spyLogger();
      const router = new GatewayRouter(fakeRegistry({ stripe, mexican }), { logger });
      expect(router.resolve('MXN', 'mexican')).toBe(stripe);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('RTR-08: MXN + unknown/corrupt toggle id -> stripe (warn)', () => {
      const { router, stripe, logger } = standardSetup();
      expect(router.resolve('MXN', 'ghost-gateway')).toBe(stripe);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not registered'));
    });
  });

  describe('MXN toggle case-insensitivity (normalized like toggleNamesMexican)', () => {
    it('RTR-20: MXN + toggle="Mexican" (valid but wrong case) -> mexican, no warning', () => {
      const { router, mexican, logger } = standardSetup();
      expect(router.resolve('MXN', 'Mexican')).toBe(mexican);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('RTR-21: MXN + toggle="MEXICAN" (upper case) -> mexican', () => {
      const { router, mexican } = standardSetup();
      expect(router.resolve('MXN', 'MEXICAN')).toBe(mexican);
    });

    it('RTR-22: MXN + toggle="  MeXiCaN  " (padded + mixed case) -> mexican', () => {
      const { router, mexican } = standardSetup();
      expect(router.resolve('MXN', '  MeXiCaN  ')).toBe(mexican);
    });

    it('RTR-23: distinguishes valid-but-wrong-case (resolves, no warn) from a genuinely corrupt id (fallback + warn)', () => {
      const {
        router, mexican, stripe, logger,
      } = standardSetup();
      // Wrong case resolves to the mexican gateway and does NOT warn.
      expect(router.resolve('MXN', 'Mexican')).toBe(mexican);
      expect(logger.warn).not.toHaveBeenCalled();
      // A genuinely unregistered id still falls back to Stripe with the "not registered" warning.
      expect(router.resolve('MXN', 'ghost-gateway')).toBe(stripe);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not registered'));
    });
  });

  describe('adversarial toggle values (MXN) all fall back to Stripe', () => {
    const bad = [
      ['null', null],
      ['undefined', undefined],
      ['empty string', ''],
      ['whitespace', '   '],
      ['number', 42],
      ['object', { id: 'mexican' }],
      ['array', ['mexican']],
      ['boolean', true],
      ['giant unicode string', `${'\u{1F4A5}'.repeat(5000)}mexican`],
    ];
    bad.forEach(([label, toggle]) => {
      it(`RTR-09..17: toggle=${label} -> stripe fallback`, () => {
        const { router, stripe } = standardSetup();
        expect(router.resolve('MXN', toggle)).toBe(stripe);
      });
    });
  });

  describe('currency validation (Decision #4)', () => {
    it('RTR-18: lowercase "usd" is normalized and routes to stripe (not rejected)', () => {
      const { router, stripe } = standardSetup();
      expect(router.resolve('usd', 'mexican')).toBe(stripe);
    });

    it('lowercase "mxn" is normalized and honors the mexican toggle', () => {
      const { router, mexican } = standardSetup();
      expect(router.resolve('mxn', 'mexican')).toBe(mexican);
    });

    it('mixed case and padded " Mxn " normalizes correctly', () => {
      const { router, mexican } = standardSetup();
      expect(router.resolve('  Mxn ', 'mexican')).toBe(mexican);
    });

    ['EUR', 'usdt', '', '  ', null, undefined, 123, {}, ['USD'], 'US D'].forEach((cur) => {
      it(`rejects unsupported currency ${JSON.stringify(cur)} with UNSUPPORTED_CURRENCY`, () => {
        const { router } = standardSetup();
        let error;
        try {
          router.resolve(cur, 'stripe');
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(PaymentGatewayError);
        expect(error.code).toBe(PaymentGatewayError.CODES.UNSUPPORTED_CURRENCY);
      });
    });

    it('currency is validated BEFORE the toggle is consulted (empty registry still rejects bad currency)', () => {
      const router = new GatewayRouter(fakeRegistry({}), { logger: spyLogger() });
      expect(() => router.resolve('EUR', 'stripe')).toThrow(
        expect.objectContaining({ code: PaymentGatewayError.CODES.UNSUPPORTED_CURRENCY })
      );
    });
  });

  describe('no terminal gateway available (Decision #5)', () => {
    it('RTR-19: USD with Stripe not registered throws NOT_CONFIGURED', () => {
      const router = new GatewayRouter(fakeRegistry({}), { logger: spyLogger() });
      let error;
      try {
        router.resolve('USD', 'stripe');
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(PaymentGatewayError);
      expect(error.code).toBe(PaymentGatewayError.CODES.NOT_CONFIGURED);
    });

    it('MXN fallback with Stripe not registered throws NOT_CONFIGURED', () => {
      const mexican = fakeAdapter('mexican', ['MXN'], false); // unconfigured -> would fall back
      const router = new GatewayRouter(fakeRegistry({ mexican }), { logger: spyLogger() });
      expect(() => router.resolve('MXN', 'mexican')).toThrow(
        expect.objectContaining({ code: PaymentGatewayError.CODES.NOT_CONFIGURED })
      );
    });
  });

  describe('no shared mutable state across calls', () => {
    it('repeated resolves return the same registered instance without mutation', () => {
      const { router, stripe } = standardSetup();
      const first = router.resolve('USD', 'stripe');
      const second = router.resolve('USD', 'stripe');
      expect(first).toBe(stripe);
      expect(second).toBe(stripe);
      expect(first).toBe(second);
    });

    it('two routers over independent registries do not interfere', () => {
      const a = standardSetup();
      const bRegistry = fakeRegistry({}); // no gateways
      const bRouter = new GatewayRouter(bRegistry, { logger: spyLogger() });
      expect(a.router.resolve('USD', 'stripe')).toBe(a.stripe);
      expect(() => bRouter.resolve('USD', 'stripe')).toThrow(PaymentGatewayError);
    });
  });
});
