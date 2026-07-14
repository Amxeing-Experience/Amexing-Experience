/**
 * PaymentGatewayError unit tests.
 * Pure logic, no Parse/Mongo/network. Covers the 7 codes (6 original + UNKNOWN_GATEWAY),
 * no provider-detail leakage, non-string message safety, unknown-code rejection, and
 * PAN redaction.
 */

const PaymentGatewayError = require('../../../../src/application/services/payments/PaymentGatewayError');

const ALL_CODES = [
  'NOT_IMPLEMENTED',
  'NOT_CONFIGURED',
  'UNSUPPORTED_CURRENCY',
  'CARD_DECLINED',
  'INVALID_SIGNATURE',
  'PROVIDER_ERROR',
  'UNKNOWN_GATEWAY',
];

describe('PaymentGatewayError', () => {
  describe('codes', () => {
    it('exposes exactly the 7 expected codes', () => {
      expect(Object.keys(PaymentGatewayError.CODES).sort()).toEqual([...ALL_CODES].sort());
    });

    it('CODES is frozen (cannot be mutated at runtime)', () => {
      expect(Object.isFrozen(PaymentGatewayError.CODES)).toBe(true);
    });
  });

  describe('shape per code', () => {
    ALL_CODES.forEach((code) => {
      it(`${code} instantiates with the expected shape`, () => {
        const err = new PaymentGatewayError(PaymentGatewayError.CODES[code], 'human message');
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(PaymentGatewayError);
        expect(err.name).toBe('PaymentGatewayError');
        expect(err.code).toBe(code);
        expect(err.message).toBe('human message');
        expect(err.gateway).toBeNull();
        expect(typeof err.stack).toBe('string');
      });
    });

    it('captures an optional gateway id', () => {
      const err = new PaymentGatewayError(PaymentGatewayError.CODES.NOT_CONFIGURED, 'x', { gateway: 'stripe' });
      expect(err.gateway).toBe('stripe');
    });

    it('a non-string gateway option collapses to null', () => {
      const err = new PaymentGatewayError(PaymentGatewayError.CODES.PROVIDER_ERROR, 'x', { gateway: 42 });
      expect(err.gateway).toBeNull();
    });
  });

  describe('unknown/invalid code', () => {
    it('throws synchronously for a code outside the closed set', () => {
      expect(() => new PaymentGatewayError('NOT_CONFIGURD', 'typo')).toThrow(/unknown error code/i);
    });

    it('throws for undefined/null/number codes', () => {
      expect(() => new PaymentGatewayError(undefined, 'x')).toThrow();
      expect(() => new PaymentGatewayError(null, 'x')).toThrow();
      expect(() => new PaymentGatewayError(123, 'x')).toThrow();
    });

    it('the thrown error for an unknown code is NOT itself a coded PaymentGatewayError', () => {
      let thrown;
      try {
        // eslint-disable-next-line no-new
        new PaymentGatewayError('BOGUS', 'x');
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown.code).toBeUndefined();
    });
  });

  describe('non-string message safety', () => {
    it('a numeric message does not crash and falls back to the code', () => {
      const err = new PaymentGatewayError(PaymentGatewayError.CODES.PROVIDER_ERROR, 12345);
      expect(err.message).toBe('PROVIDER_ERROR');
    });

    it('null/undefined/empty message fall back to the code', () => {
      expect(new PaymentGatewayError(PaymentGatewayError.CODES.PROVIDER_ERROR, null).message).toBe('PROVIDER_ERROR');
      expect(new PaymentGatewayError(PaymentGatewayError.CODES.PROVIDER_ERROR).message).toBe('PROVIDER_ERROR');
      expect(new PaymentGatewayError(PaymentGatewayError.CODES.PROVIDER_ERROR, '').message).toBe('PROVIDER_ERROR');
    });

    it('an object (raw provider error) as the message never leaks into .message', () => {
      const rawProviderError = { pan: '4242424242424242', secret: 'sk_live_leak', decline: 'do_not_honor' };
      const err = new PaymentGatewayError(PaymentGatewayError.CODES.CARD_DECLINED, rawProviderError);
      expect(err.message).toBe('CARD_DECLINED');
      expect(err.message).not.toContain('4242');
      expect(err.message).not.toContain('sk_live');
      expect(err.message).not.toContain('do_not_honor');
    });

    it('a null options argument does not crash the constructor', () => {
      const err = new PaymentGatewayError(PaymentGatewayError.CODES.PROVIDER_ERROR, 'ok', null);
      expect(err.gateway).toBeNull();
    });
  });

  describe('provider payload isolation', () => {
    it('a raw providerError is retained but non-enumerable and excluded from JSON', () => {
      const rawProviderError = { pan: '4111111111111111', internal: 'stack-of-stripe' };
      const err = new PaymentGatewayError(PaymentGatewayError.CODES.PROVIDER_ERROR, 'safe message', {
        providerError: rawProviderError,
      });

      expect(err.providerError).toBe(rawProviderError); // available for internal audit
      expect(Object.prototype.propertyIsEnumerable.call(err, 'providerError')).toBe(false);

      const serialized = JSON.stringify(err);
      expect(serialized).not.toContain('providerError');
      expect(serialized).not.toContain('4111');
      expect(serialized).not.toContain('stack-of-stripe');
    });

    it('toJSON exposes only the safe curated fields', () => {
      const err = new PaymentGatewayError(PaymentGatewayError.CODES.NOT_CONFIGURED, 'oops', { gateway: 'mexican' });
      expect(err.toJSON()).toEqual({
        name: 'PaymentGatewayError',
        code: 'NOT_CONFIGURED',
        message: 'oops',
        gateway: 'mexican',
      });
    });

    it('providerError defaults to null when omitted', () => {
      const err = new PaymentGatewayError(PaymentGatewayError.CODES.PROVIDER_ERROR, 'x');
      expect(err.providerError).toBeNull();
    });
  });

  describe('PAN redaction (defense-in-depth)', () => {
    it('masks a 16-digit PAN embedded in the message', () => {
      const err = new PaymentGatewayError(PaymentGatewayError.CODES.CARD_DECLINED, 'card 4242424242424242 was declined');
      expect(err.message).not.toContain('4242424242424242');
      expect(err.message).toContain('[REDACTED]');
    });

    it('masks 13-19 digit ranges (min and max PAN length)', () => {
      const min13 = new PaymentGatewayError(PaymentGatewayError.CODES.PROVIDER_ERROR, 'x 1234567890123 y');
      const max19 = new PaymentGatewayError(PaymentGatewayError.CODES.PROVIDER_ERROR, 'x 1234567890123456789 y');
      expect(min13.message).toBe('x [REDACTED] y');
      expect(max19.message).toBe('x [REDACTED] y');
    });

    it('does NOT mask short numbers (amounts, order ids, ivas)', () => {
      const err = new PaymentGatewayError(PaymentGatewayError.CODES.PROVIDER_ERROR, 'amount 1850 for reservation 4021');
      expect(err.message).toBe('amount 1850 for reservation 4021');
    });

    it('redaction is applied in toJSON output too', () => {
      const err = new PaymentGatewayError(PaymentGatewayError.CODES.CARD_DECLINED, 'pan=4000000000000002');
      expect(err.toJSON().message).not.toContain('4000000000000002');
    });
  });
});
