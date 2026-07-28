/**
 * gatewayBootstrap unit tests.
 * Verifies the ONE production wiring point: a single GatewayRegistry with both Fase 1
 * adapters registered under their own ids, exposed as a lazy singleton that never
 * re-registers (which would throw PaymentGatewayError on a duplicate id).
 *
 * Also verifies the numeric-code <-> id translation (encodeGatewayId / decodeGatewayCode):
 * the toggle is persisted as a Number (Setting.value is a Number column) and only speaks
 * the string ids at the API boundary.
 */

const {
  getGatewayRegistry,
  encodeGatewayId,
  decodeGatewayCode,
} = require('../../../../src/application/services/payments/gatewayBootstrap');
const GatewayRegistry = require('../../../../src/application/services/payments/GatewayRegistry');
const StripeAdapter = require('../../../../src/application/services/payments/gateways/StripeAdapter');
const OpenpayAdapter = require('../../../../src/application/services/payments/gateways/OpenpayAdapter');

describe('gatewayBootstrap.getGatewayRegistry', () => {
  it('returns a real GatewayRegistry', () => {
    expect(getGatewayRegistry()).toBeInstanceOf(GatewayRegistry);
  });

  it('registers both adapters under their own ids', () => {
    expect(getGatewayRegistry().list().sort()).toEqual(['mexican', 'stripe']);
  });

  it('resolves "stripe" to a StripeAdapter', () => {
    expect(getGatewayRegistry().resolve('stripe')).toBeInstanceOf(StripeAdapter);
  });

  it('resolves "mexican" to an OpenpayAdapter self-identifying as "mexican" (never "openpay")', () => {
    const adapter = getGatewayRegistry().resolve('mexican');
    expect(adapter).toBeInstanceOf(OpenpayAdapter);
    expect(adapter.getId()).toBe('mexican');
    expect(adapter.getId()).not.toBe('openpay');
  });

  it('is a singleton: repeated calls return the SAME registry and never throw on re-registration', () => {
    // Five straight calls -- if the module re-registered on any call, the duplicate-id
    // guard in GatewayRegistry.register() would throw PaymentGatewayError.
    const first = getGatewayRegistry();
    for (let i = 0; i < 5; i += 1) {
      expect(getGatewayRegistry()).toBe(first);
    }
  });

  it('hands back the SAME adapter instances across calls', () => {
    expect(getGatewayRegistry().resolve('stripe')).toBe(getGatewayRegistry().resolve('stripe'));
    expect(getGatewayRegistry().resolve('mexican')).toBe(getGatewayRegistry().resolve('mexican'));
  });
});

describe('gatewayBootstrap numeric-code <-> id translation', () => {
  it('encodeGatewayId maps each id to its numeric code', () => {
    expect(encodeGatewayId('stripe')).toBe(0);
    expect(encodeGatewayId('mexican')).toBe(1);
  });

  it('encodeGatewayId returns an actual number, never a string', () => {
    expect(typeof encodeGatewayId('stripe')).toBe('number');
    expect(typeof encodeGatewayId('mexican')).toBe('number');
  });

  it('encodeGatewayId throws on an unknown id (never silently coerces to garbage)', () => {
    expect(() => encodeGatewayId('openpay')).toThrow();
    expect(() => encodeGatewayId('STRIPE')).toThrow(); // encoder expects already-normalized ids
    expect(() => encodeGatewayId('')).toThrow();
    expect(() => encodeGatewayId(undefined)).toThrow();
    expect(() => encodeGatewayId(null)).toThrow();
  });

  it('decodeGatewayCode maps each numeric code back to its id', () => {
    expect(decodeGatewayCode(0)).toBe('stripe');
    expect(decodeGatewayCode(1)).toBe('mexican');
  });

  it('decodeGatewayCode falls back to "stripe" for an unknown/corrupt code (never throws)', () => {
    expect(decodeGatewayCode(2)).toBe('stripe');
    expect(decodeGatewayCode(-1)).toBe('stripe');
    expect(decodeGatewayCode(1.5)).toBe('stripe');
    expect(decodeGatewayCode(NaN)).toBe('stripe');
    expect(decodeGatewayCode(undefined)).toBe('stripe');
    expect(decodeGatewayCode(null)).toBe('stripe');
  });

  it('round-trips id -> code -> id for every registered gateway', () => {
    for (const id of getGatewayRegistry().list()) {
      expect(decodeGatewayCode(encodeGatewayId(id))).toBe(id);
    }
  });
});
