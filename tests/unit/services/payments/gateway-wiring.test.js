/**
 * Gateway wiring test.
 * Real (non-mocked) GatewayRegistry + GatewayRouter + both real stub adapters wired
 * together. Drives the full currency x toggle table end-to-end through the real wiring,
 * confirms reference equality (the router hands back the actual registered instance,
 * not a clone), late registration, and that resolved capabilities are genuinely
 * callable (NOT_CONFIGURED, never NOT_IMPLEMENTED).
 *
 * Note: both real stubs report isConfigured() === false in PR1, so the "mexican wins"
 * row (MXN + toggle=mexican -> mexican) is unreachable here -- it correctly falls back
 * to Stripe. That is expected and is not forced.
 */

const GatewayRegistry = require('../../../../src/application/services/payments/GatewayRegistry');
const GatewayRouter = require('../../../../src/application/services/payments/GatewayRouter');
const StripeAdapter = require('../../../../src/application/services/payments/gateways/StripeAdapter');
const OpenpayAdapter = require('../../../../src/application/services/payments/gateways/OpenpayAdapter');
const PaymentGatewayError = require('../../../../src/application/services/payments/PaymentGatewayError');

const silentLogger = { warn: () => {}, info: () => {}, error: () => {} };

function wire() {
  const registry = new GatewayRegistry();
  const stripe = new StripeAdapter();
  const mexican = new OpenpayAdapter();
  registry.register(stripe);
  registry.register(mexican);
  const router = new GatewayRouter(registry, { logger: silentLogger });
  return {
    registry, router, stripe, mexican,
  };
}

describe('gateway wiring (registry + router + real stub adapters)', () => {
  it('registers both adapters under their own ids', () => {
    const { registry } = wire();
    expect(registry.list().sort()).toEqual(['mexican', 'stripe']);
  });

  describe('full currency x toggle table (both stubs unconfigured -> always Stripe)', () => {
    const rows = [
      ['USD', 'stripe'],
      ['USD', 'mexican'],
      ['MXN', 'stripe'],
      ['MXN', 'mexican'],
      ['MXN', 'ghost-corrupt-id'],
      ['usd', 'mexican'],
      ['mxn', 'mexican'],
    ];

    rows.forEach(([currency, toggle]) => {
      it(`${currency} + toggle=${toggle} resolves to the registered Stripe instance`, () => {
        const { router, stripe } = wire();
        expect(router.resolve(currency, toggle)).toBe(stripe);
      });
    });
  });

  it('router returns the ACTUAL registered instance (reference equality, not a clone)', () => {
    const { router, registry, stripe } = wire();
    const resolved = router.resolve('USD', 'stripe');
    expect(resolved).toBe(stripe);
    expect(resolved).toBe(registry.resolve('stripe'));
  });

  it('late registration does not break resolution', () => {
    const registry = new GatewayRegistry();
    const router = new GatewayRouter(registry, { logger: silentLogger });
    // Nothing registered yet: no terminal gateway available.
    expect(() => router.resolve('USD', 'stripe')).toThrow(
      expect.objectContaining({ code: PaymentGatewayError.CODES.NOT_CONFIGURED })
    );

    const stripe = new StripeAdapter();
    registry.register(stripe);
    expect(router.resolve('USD', 'stripe')).toBe(stripe);
  });

  it('resolved instance capabilities are genuinely callable (NOT_CONFIGURED, not NOT_IMPLEMENTED)', () => {
    const { router } = wire();
    const resolved = router.resolve('MXN', 'mexican'); // falls back to stripe

    expect(resolved.getId()).toBe('stripe');
    expect(resolved.getSupportedCurrencies()).toEqual(['USD', 'MXN']);
    expect(resolved.isConfigured()).toBe(false);

    let error;
    try {
      resolved.createCharge({ amount: 100, currency: 'MXN' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PaymentGatewayError);
    expect(error.code).toBe(PaymentGatewayError.CODES.NOT_CONFIGURED);
    expect(error.code).not.toBe(PaymentGatewayError.CODES.NOT_IMPLEMENTED);
  });

  it('an unconfigured mexican toggle never wins in PR1 (falls back to Stripe)', () => {
    const { router, stripe, mexican } = wire();
    expect(mexican.isConfigured()).toBe(false);
    expect(router.resolve('MXN', 'mexican')).toBe(stripe);
    expect(router.resolve('MXN', 'mexican')).not.toBe(mexican);
  });
});
