/**
 * Gateway wiring via the REAL production bootstrap.
 * Unlike gateway-wiring.test.js (which builds a registry by hand), this drives the
 * currency x toggle decision through the exact registry the app ships
 * (gatewayBootstrap.getGatewayRegistry()) + a real GatewayRouter, end-to-end.
 *
 * Both adapters report isConfigured() === false in this phase, so the "mexican wins" row
 * is unreachable: a mexican toggle correctly falls back to Stripe.
 */

const {
  getGatewayRegistry,
} = require('../../../../src/application/services/payments/gatewayBootstrap');
const GatewayRouter = require('../../../../src/application/services/payments/GatewayRouter');
const StripeAdapter = require('../../../../src/application/services/payments/gateways/StripeAdapter');

const silentLogger = { warn: () => {}, info: () => {}, error: () => {} };

function realRouter() {
  return new GatewayRouter(getGatewayRegistry(), { logger: silentLogger });
}

describe('gateway wiring through the real bootstrap (router + production registry)', () => {
  it('MXN + toggle=mexican falls back to Stripe (real end-to-end fallback)', () => {
    const resolved = realRouter().resolve('MXN', 'mexican');
    expect(resolved).toBeInstanceOf(StripeAdapter);
    expect(resolved.getId()).toBe('stripe');
  });

  it('USD + toggle=mexican resolves to Stripe (usd-forces-stripe)', () => {
    const resolved = realRouter().resolve('USD', 'mexican');
    expect(resolved).toBeInstanceOf(StripeAdapter);
    expect(resolved.getId()).toBe('stripe');
  });

  it('MXN + toggle=stripe resolves straight to Stripe', () => {
    const resolved = realRouter().resolve('MXN', 'stripe');
    expect(resolved).toBeInstanceOf(StripeAdapter);
    expect(resolved.getId()).toBe('stripe');
  });

  it('returns the ACTUAL registered Stripe instance (reference equality, not a clone)', () => {
    const registry = getGatewayRegistry();
    expect(realRouter().resolve('USD', 'stripe')).toBe(registry.resolve('stripe'));
  });
});
