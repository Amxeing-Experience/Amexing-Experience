/**
 * PaymentService.countsInRollup — pure truth table (no Parse, no DB).
 *
 * The money-side allowlist that decides whether a Payment feeds the rollup (paidGlobal):
 * manual (falsy gatewayStatus: null/undefined/'') and online succeeded/disputed count; everything
 * else — pending, processing, failed, expired, refunded, dispute_lost, and any unknown/new status —
 * does NOT (fail-safe: an unmodeled status never inflates the balance). Case-sensitive by design.
 */

const PaymentService = require('../../../src/application/services/PaymentService');

describe('PaymentService.countsInRollup (truth table)', () => {
  // [input, expected, note]
  const cases = [
    [undefined, true, 'manual (undefined) always counts'],
    [null, true, 'manual (null) always counts'],
    ['requires_payment', false, 'pending online never counted'],
    ['processing', false, 'in-flight online does not count'],
    ['succeeded', true, 'confirmed online counts'],
    ['failed', false, 'declined card never counted'],
    ['expired', false, 'abandoned/TTL never counted'],
    ['refunded', false, 'money returned -> stops counting'],
    ['disputed', true, 'chargeback OPEN: money still captured, keeps counting'],
    ['dispute_lost', false, 'chargeback LOST: only terminal dispute state that stops counting'],
    ['foobar', false, 'unknown status -> fail-safe, does NOT count'],
    ['', true, "empty string treated as MANUAL (falsy) -> counts, so a legit manual payment stored with '' never drops from the rollup / overcharges the client"],
  ];

  it.each(cases)('countsInRollup(%p) === %p (%s)', (input, expected) => {
    expect(PaymentService.countsInRollup(input)).toBe(expected);
  });

  describe('case-sensitive / whitespace-sensitive (documented risk: statuses are stored verbatim)', () => {
    it("uppercase 'SUCCEEDED' does NOT count (not normalized)", () => {
      expect(PaymentService.countsInRollup('SUCCEEDED')).toBe(false);
    });

    it("padded ' succeeded ' does NOT count (no trim)", () => {
      expect(PaymentService.countsInRollup(' succeeded ')).toBe(false);
    });
  });
});
