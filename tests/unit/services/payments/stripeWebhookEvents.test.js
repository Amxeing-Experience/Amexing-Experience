/**
 * stripeWebhookEvents — pure event translation (no Parse, no SDK, no env).
 *
 * The money decision "which Stripe event means what" lives here, so it is tested here in isolation:
 * the 4 covered events map to the exact gatewayStatus of the plan's table 4.4, only 'succeeded'
 * crosses the counts/does-not-count threshold of the rollup, and EVERY other input — an event type
 * this build does not handle, a prototype key, an empty string, a non-string — resolves to a safe
 * null instead of throwing. A throw here would turn a harmless out-of-scope webhook into a 500 and a
 * Stripe retry storm.
 */

const {
  translateEvent,
  allowedSourceStatuses,
} = require('../../../../src/application/services/payments/stripeWebhookEvents');

describe('stripeWebhookEvents.translateEvent (pure)', () => {
  describe('the 4 covered events (plan tabla 4.4)', () => {
    it('checkout.session.completed => succeeded, crosses the threshold', () => {
      expect(translateEvent('checkout.session.completed')).toEqual({
        gatewayStatus: 'succeeded', crossesThreshold: true,
      });
    });

    it('payment_intent.succeeded => succeeded, crosses the threshold (converges with the session event)', () => {
      expect(translateEvent('payment_intent.succeeded')).toEqual({
        gatewayStatus: 'succeeded', crossesThreshold: true,
      });
    });

    it('payment_intent.payment_failed => failed, does NOT cross (never counted, still does not)', () => {
      expect(translateEvent('payment_intent.payment_failed')).toEqual({
        gatewayStatus: 'failed', crossesThreshold: false,
      });
    });

    it('checkout.session.expired => expired, does NOT cross', () => {
      expect(translateEvent('checkout.session.expired')).toEqual({
        gatewayStatus: 'expired', crossesThreshold: false,
      });
    });

    it('exactly two event types cross the threshold, and both mean succeeded', () => {
      const covered = [
        'checkout.session.completed',
        'payment_intent.succeeded',
        'payment_intent.payment_failed',
        'checkout.session.expired',
      ];
      const crossing = covered.filter((t) => translateEvent(t).crossesThreshold);
      expect(crossing).toEqual(['checkout.session.completed', 'payment_intent.succeeded']);
      expect(crossing.every((t) => translateEvent(t).gatewayStatus === 'succeeded')).toBe(true);
    });
  });

  describe('everything else is a safe no-op (null), never a throw', () => {
    // charge.refunded / dispute.* are PR11 by design (plan seccion 3): recorded, not applied.
    const outOfScope = [
      'charge.refunded',
      'charge.dispute.created',
      'charge.dispute.closed',
      'payment_intent.processing',
      'checkout.session.async_payment_failed',
      'customer.created',
      'un.evento.inventado',
      'CHECKOUT.SESSION.COMPLETED', // case-sensitive on purpose: provider types are verbatim
      ' checkout.session.completed', // padded: not the same type
      'checkout.session.completed ',
      '',
    ];
    it.each(outOfScope)('type %p => null', (type) => {
      expect(translateEvent(type)).toBeNull();
    });

    const nonStrings = [null, undefined, 0, 1, true, false, {}, [], () => {}, Symbol('x'), 12345n];
    it.each(nonStrings.map((v) => [typeof v === 'symbol' ? 'Symbol' : String(v), v]))(
      'non-string input (%s) => null without throwing',
      (_label, value) => {
        expect(() => translateEvent(value)).not.toThrow();
        expect(translateEvent(value)).toBeNull();
      }
    );

    // A bare map lookup would return Object.prototype members for these, which downstream would read
    // as a truthy "destination" and try to write a garbage gatewayStatus onto a real Payment.
    const prototypeKeys = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];
    it.each(prototypeKeys)('prototype key %p => null (no inherited lookup)', (key) => {
      expect(translateEvent(key)).toBeNull();
    });
  });

  describe('the returned destination is a copy (callers cannot poison the table)', () => {
    it('mutating the result does not change the next translation', () => {
      const first = translateEvent('checkout.session.completed');
      first.gatewayStatus = 'refunded';
      first.crossesThreshold = false;
      expect(translateEvent('checkout.session.completed')).toEqual({
        gatewayStatus: 'succeeded', crossesThreshold: true,
      });
    });
  });

  describe('allowedSourceStatuses (Capa B monotonic guard)', () => {
    it('is exactly {requires_payment, processing}', () => {
      expect(allowedSourceStatuses().sort()).toEqual(['processing', 'requires_payment']);
    });

    it("keeps 'processing' even though nothing produces it today (future payment_intent.processing)", () => {
      expect(allowedSourceStatuses()).toContain('processing');
    });

    it('excludes every terminal/other status, which IS the anti-regression guard', () => {
      const list = allowedSourceStatuses();
      for (const terminal of ['succeeded', 'failed', 'expired', 'refunded', 'disputed', 'dispute_lost']) {
        expect(list).not.toContain(terminal);
      }
    });

    it('returns a fresh array each call (mutating it cannot widen the guard)', () => {
      const a = allowedSourceStatuses();
      a.push('refunded');
      expect(allowedSourceStatuses()).not.toContain('refunded');
    });
  });
});
