/**
 * redactGatewayPayload — PCI redaction of raw provider objects (plan seccion 8.1).
 *
 * Keeps only opaque ids + amount/currency/status; strips nested provider objects
 * (payment_method_details/charges/customer_details) that can carry last4/brand/PAN, and coerces an
 * expanded payment_intent/charge down to its id. Serializing the result must never emit card data.
 */

const { redactGatewayPayload } = require('../../../../src/infrastructure/payments/redactGatewayPayload');

describe('redactGatewayPayload', () => {
  it('keeps only the safe scalar fields of a Checkout Session', () => {
    const session = {
      id: 'cs_123',
      object: 'checkout.session',
      status: 'complete',
      amount_total: 968000,
      currency: 'mxn',
      payment_intent: 'pi_456',
    };
    expect(redactGatewayPayload(session)).toEqual({
      id: 'cs_123',
      object: 'checkout.session',
      status: 'complete',
      amount: 968000,
      currency: 'mxn',
      paymentIntent: 'pi_456',
      charge: null,
    });
  });

  it('coerces an expanded payment_intent/charge object down to its id', () => {
    const out = redactGatewayPayload({
      id: 'cs_1',
      payment_intent: { id: 'pi_9', object: 'payment_intent', last_payment_error: {} },
      charge: { id: 'ch_9', object: 'charge' },
    });
    expect(out.paymentIntent).toBe('pi_9');
    expect(out.charge).toBe('ch_9');
  });

  it('NEVER leaks nested card data (last4/brand/PAN) when serialized', () => {
    const dirty = {
      id: 'cs_dirty',
      amount_total: 1000,
      currency: 'usd',
      payment_method_details: { card: { last4: '4242', brand: 'visa' } },
      customer_details: { name: 'X', tax_ids: [] },
      charges: { data: [{ pan: '4111111111111111' }] },
    };
    const serialized = JSON.stringify(redactGatewayPayload(dirty));
    expect(serialized).not.toContain('4242');
    expect(serialized).not.toContain('4111111111111111');
    expect(serialized).not.toContain('payment_method_details');
    expect(serialized).not.toContain('customer_details');
  });

  it('falls back to the intent amount when there is no amount_total', () => {
    expect(redactGatewayPayload({ id: 'pi_1', amount: 500, currency: 'mxn' }).amount).toBe(500);
  });

  it('returns an empty object for a non-object payload', () => {
    expect(redactGatewayPayload(null)).toEqual({});
    expect(redactGatewayPayload('cs_str')).toEqual({});
    expect(redactGatewayPayload(undefined)).toEqual({});
  });
});
