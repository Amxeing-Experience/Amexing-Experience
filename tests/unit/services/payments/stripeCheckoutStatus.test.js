/**
 * stripeCheckoutStatus — the translation table PR6 asks Stripe for, as opposed to the one PR5 is
 * told (stripeWebhookEvents).
 *
 * Two properties are load-bearing and neither is decoration:
 *
 * 1) The table is an ALLOWLIST WITH AN EXPLICIT DEFAULT, not an enumeration of cells. Every state
 *    that is not one of the three recognized ones must resolve to { ok:false } — "still pending" —
 *    including the ones that look terminal but are not. 'requires_payment_method' is the dangerous
 *    one: it is a DECLINED card, the session stays open and payable, and treating it as terminal
 *    would tell a payer "your payment failed" seconds before Stripe charges them.
 * 2) It REUSES allowedSourceStatuses instead of keeping its own copy. The module is mocked with a
 *    sentinel list below, so a hardcoded parallel array cannot pass these assertions.
 */

// A sentinel the real module would never return: if stripeCheckoutStatus kept its own copy of the
// source allowlist, fromStatuses would not equal this and the reuse tests would fail.
const SENTINEL = Object.freeze(['SENTINEL_SOURCE_A', 'SENTINEL_SOURCE_B']);

jest.mock('../../../../src/application/services/payments/stripeWebhookEvents', () => {
  const actual = jest.requireActual('../../../../src/application/services/payments/stripeWebhookEvents');
  return { ...actual, allowedSourceStatuses: jest.fn(() => [...SENTINEL_FOR_MOCK]) };
});

// jest.mock is hoisted above const declarations, so the sentinel has to reach it through a global.
global.SENTINEL_FOR_MOCK = SENTINEL;

const webhookEvents = require('../../../../src/application/services/payments/stripeWebhookEvents');
const { translateCheckoutStatus, canStillReachSucceeded } = require('../../../../src/application/services/payments/stripeCheckoutStatus');

describe('stripeCheckoutStatus.translateCheckoutStatus', () => {
  beforeEach(() => {
    webhookEvents.allowedSourceStatuses.mockClear();
    webhookEvents.allowedSourceStatuses.mockImplementation(() => [...SENTINEL]);
  });

  // -----------------------------------------------------------------------------------------
  describe('GC-U1..U3 — the three recognized destinations', () => {
    it('an intent at succeeded => succeeded, crossing the rollup threshold', () => {
      const out = translateCheckoutStatus({ status: 'complete' }, { status: 'succeeded' });
      expect(out.ok).toBe(true);
      expect(out.gatewayStatus).toBe('succeeded');
      expect(out.crossesThreshold).toBe(true);
    });

    it('a session at payment_status paid => succeeded, even with no intent at all', () => {
      const out = translateCheckoutStatus({ status: 'complete', payment_status: 'paid' }, null);
      expect(out.ok).toBe(true);
      expect(out.gatewayStatus).toBe('succeeded');
      expect(out.crossesThreshold).toBe(true);
    });

    it('money wins over everything: a paid session whose intent is canceled still reads succeeded', () => {
      const out = translateCheckoutStatus({ status: 'complete', payment_status: 'paid' }, { status: 'canceled' });
      expect(out.gatewayStatus).toBe('succeeded');
    });

    it('a canceled intent => expired, NOT counting toward the rollup', () => {
      const out = translateCheckoutStatus({ status: 'complete' }, { status: 'canceled' });
      expect(out.ok).toBe(true);
      expect(out.gatewayStatus).toBe('expired');
      expect(out.crossesThreshold).toBe(false);
    });

    it('an OPEN session with a canceled intent => expired: the INTENT wins', () => {
      // A canceled intent leaves the session unpayable regardless of what session.status still says.
      const out = translateCheckoutStatus({ status: 'open' }, { status: 'canceled' });
      expect(out.ok).toBe(true);
      expect(out.gatewayStatus).toBe('expired');
    });

    it('an expired session => expired', () => {
      const out = translateCheckoutStatus({ status: 'expired' }, null);
      expect(out.ok).toBe(true);
      expect(out.gatewayStatus).toBe('expired');
      expect(out.crossesThreshold).toBe(false);
    });

    it('never produces "failed" nor invents a "canceled" gatewayStatus', () => {
      // A 'canceled' value would fall outside the succeeded source allowlist and SEAL the row against
      // a later legitimate confirmation. 'failed' stays exclusive to the webhook.
      const outcomes = [
        translateCheckoutStatus({ status: 'complete', payment_status: 'paid' }),
        translateCheckoutStatus(null, { status: 'canceled' }),
        translateCheckoutStatus({ status: 'expired' }),
      ].map((o) => o.gatewayStatus);
      expect(outcomes).toEqual(['succeeded', 'expired', 'expired']);
      expect(outcomes).not.toContain('failed');
      expect(outcomes).not.toContain('canceled');
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('GC-U4/U5 — the explicit default absorbs everything else, and never throws', () => {
    it('a declined card (open session + requires_payment_method) is NOT terminal', () => {
      const out = translateCheckoutStatus({ status: 'open' }, { status: 'requires_payment_method' });
      expect(out).toEqual({ ok: false });
    });

    it.each([
      ['an open session alone', { status: 'open' }, null],
      ['processing', { status: 'open' }, { status: 'processing' }],
      ['requires_action', { status: 'open' }, { status: 'requires_action' }],
      ['requires_capture', { status: 'complete' }, { status: 'requires_capture' }],
      ['requires_confirmation', { status: 'open' }, { status: 'requires_confirmation' }],
      ['complete but unpaid', { status: 'complete', payment_status: 'unpaid' }, null],
      ['complete + no_payment_required', { status: 'complete', payment_status: 'no_payment_required' }, null],
      ['garbage strings', { status: '../../etc/passwd' }, { status: '<script>' }],
      ['an unknown future status', { status: 'quantum_settled' }, { status: 'quantum_settled' }],
      ['empty objects', {}, {}],
      ['nulls', null, null],
      ['undefined', undefined, undefined],
      ['numbers instead of objects', 42, 7],
      ['strings instead of objects', 'complete', 'succeeded'],
      ['arrays', [], []],
      ['a prototype-polluting shape', { status: 'constructor' }, { status: '__proto__' }],
      ['non-string status values', { status: 1 }, { status: true }],
    ])('%s => { ok:false } and no throw', (_label, session, intent) => {
      let out;
      expect(() => { out = translateCheckoutStatus(session, intent); }).not.toThrow();
      expect(out).toEqual({ ok: false });
    });

    it('called with no arguments at all it still answers { ok:false }', () => {
      expect(translateCheckoutStatus()).toEqual({ ok: false });
    });

    it('the pending answer carries no destination fields to be misread downstream', () => {
      const out = translateCheckoutStatus({ status: 'open' });
      expect(Object.keys(out)).toEqual(['ok']);
      expect(out.gatewayStatus).toBeUndefined();
      expect(out.crossesThreshold).toBeUndefined();
      expect(out.fromStatuses).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('GC-U6 — it REUSES allowedSourceStatuses, it does not duplicate it', () => {
    it('the fromStatuses it returns come from the shared module (sentinel proves it)', () => {
      const out = translateCheckoutStatus({ status: 'complete', payment_status: 'paid' });
      expect(webhookEvents.allowedSourceStatuses).toHaveBeenCalledTimes(1);
      expect(webhookEvents.allowedSourceStatuses).toHaveBeenCalledWith('succeeded');
      expect(out.fromStatuses).toEqual([...SENTINEL]);
    });

    it('the expired destination asks the shared module for ITS own allowlist too', () => {
      const out = translateCheckoutStatus({ status: 'expired' });
      expect(webhookEvents.allowedSourceStatuses).toHaveBeenCalledWith('expired');
      expect(out.fromStatuses).toEqual([...SENTINEL]);
    });

    it('a pending answer never asks for an allowlist (nothing is going to be applied)', () => {
      translateCheckoutStatus({ status: 'open' });
      expect(webhookEvents.allowedSourceStatuses).not.toHaveBeenCalled();
    });

    it('canStillReachSucceeded also derives from the shared module, never a private list', () => {
      expect(canStillReachSucceeded('SENTINEL_SOURCE_A')).toBe(true);
      expect(canStillReachSucceeded('requires_payment')).toBe(false); // not in the sentinel list
      expect(webhookEvents.allowedSourceStatuses).toHaveBeenCalledWith('succeeded');
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('canStillReachSucceeded against the REAL allowlist (ADR-7 enmienda 1)', () => {
    beforeEach(() => {
      const actual = jest.requireActual('../../../../src/application/services/payments/stripeWebhookEvents');
      webhookEvents.allowedSourceStatuses.mockImplementation(actual.allowedSourceStatuses);
    });

    it.each(['requires_payment', 'processing', 'failed', 'expired'])(
      'a %p row still warrants the network call (its session may yet be paid)',
      (status) => { expect(canStillReachSucceeded(status)).toBe(true); }
    );

    it.each(['succeeded', 'refunded', 'disputed', 'dispute_lost'])(
      'a %p row does not: the answer comes from the local row, with no outgoing call',
      (status) => { expect(canStillReachSucceeded(status)).toBe(false); }
    );

    it.each([[null], [undefined], [''], ['inventado'], [42], [{}]])(
      'an unusable local status (%p) does not warrant a call either',
      (status) => { expect(canStillReachSucceeded(status)).toBe(false); }
    );
  });
});
