/**
 * stripeWebhookEvents - PURE translation of a Stripe event type into the normalized Payment
 * gatewayStatus this PR knows how to apply (plan PR5 seccion 4.4), plus the allowlist of SOURCE
 * statuses from which that transition is legal, PER DESTINATION (seccion 4.5).
 *
 * Deliberately dependency-free (no Parse, no SDK, no env): the whole point is that the money
 * decision "which event means what" is unit-testable in isolation and can NEVER throw — an
 * unknown/absent/garbage event type resolves to null (safe no-op), never an exception that would
 * turn a harmless out-of-scope webhook into a 500 + a Stripe retry storm.
 *
 * NOTE: this vocabulary is NOT the older `GatewayEvent` typedef of PaymentGatewayService
 * (succeeded/failed/refunded/pending/unknown). That typedef describes a normalized ADAPTER-level
 * event shape; this map produces Payment.gatewayStatus values, which include 'expired'.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

/**
 * The 4 events covered by PR5 and their destination Payment.gatewayStatus.
 *
 * `crossesThreshold` = whether the destination crosses the counts/does-not-count line of the rollup
 * (PaymentService.countsInRollup). Only 'succeeded' does: 'failed'/'expired' never counted before
 * and do not count now, so there is nothing to recalculate for them.
 *
 * charge.refunded / charge.dispute.* are intentionally ABSENT (PR11 owns them, plan seccion 3):
 * they resolve to null here, which is a recorded-but-not-applied no-op, never an error.
 * @type {Readonly<object>}
 */
const EVENT_MAP = Object.freeze({
  'checkout.session.completed': Object.freeze({ gatewayStatus: 'succeeded', crossesThreshold: true }),
  'payment_intent.succeeded': Object.freeze({ gatewayStatus: 'succeeded', crossesThreshold: true }),
  'payment_intent.payment_failed': Object.freeze({ gatewayStatus: 'failed', crossesThreshold: false }),
  'checkout.session.expired': Object.freeze({ gatewayStatus: 'expired', crossesThreshold: false }),
});

/**
 * Statuses a Payment may legally be in for a NON-money destination ('failed'/'expired') to apply.
 *
 * 'requires_payment' is the state PR4 creates the pending in. 'processing' is future-proofing for an
 * eventual payment_intent.processing (async methods): no code produces it today, and listing it costs
 * nothing while omitting it would silently strand such a Payment later. Everything else is excluded ON
 * PURPOSE: that exclusion IS the monotonic guard for these destinations — a late 'failed'/'expired' can
 * never walk a succeeded/refunded/disputed Payment backwards, because the conditional update simply
 * matches no document.
 * @type {readonly string[]}
 */
const PENDING_SOURCE_STATUSES = Object.freeze(['requires_payment', 'processing']);

/**
 * Statuses a Payment may legally be in for the MONEY destination ('succeeded') to apply.
 *
 * Adds 'failed' and 'expired' to the pending ones, and that addition is a money bug fix, not a
 * loosening: a declined card leaves the Checkout Session `open`/`unpaid`, so the payer can retry with
 * ANOTHER card in the SAME session, reusing the same PaymentIntent and the same metadata.paymentId. A
 * PaymentIntent's machine ends in succeeded or canceled — a failed attempt does not close it — so when
 * payment_intent.succeeded finally arrives, THAT is the truth and our 'failed' row is stale. 'expired'
 * follows the principle findPayment already states ("the money moved regardless of our housekeeping"):
 * if the TTL sweep marked it expired but the payer actually paid, the real money wins. Without these
 * two, Stripe charges the card and the CRM never learns (matchedCount 0, a 200, no retry).
 *
 * The terminal MONEY states of other PRs — 'refunded', 'dispute_lost', 'disputed' — stay excluded from
 * every destination: that is the part of the monotonic guard that must never be relaxed.
 * @type {readonly string[]}
 */
const SUCCEEDED_SOURCE_STATUSES = Object.freeze(['requires_payment', 'processing', 'failed', 'expired']);

/**
 * Source allowlist PER DESTINATION. A single global list cannot express that 'failed' -> 'succeeded' is
 * legitimate (the retry that finally cleared) while 'succeeded' -> 'failed' is not (a late notification
 * for an attempt already superseded).
 * @type {Readonly<object>}
 */
const SOURCES_BY_DESTINATION = Object.freeze({
  succeeded: SUCCEEDED_SOURCE_STATUSES,
  failed: PENDING_SOURCE_STATUSES,
  expired: PENDING_SOURCE_STATUSES,
});

/**
 * Translate a Stripe event type into its destination gatewayStatus, or null when out of scope.
 *
 * Uses an own-property check instead of a bare lookup so that an adversarial type like 'constructor'
 * or '__proto__' resolves to null rather than to something inherited from Object.prototype.
 * @param {*} eventType - The raw Stripe event type (any value; only a known string maps).
 * @returns {({gatewayStatus: string, crossesThreshold: boolean}|null)} The destination, or null for
 * an unknown/invalid type (safe no-op).
 * @example
 * translateEvent('checkout.session.completed'); // { gatewayStatus: 'succeeded', crossesThreshold: true }
 * translateEvent('charge.refunded'); // null (PR11)
 */
function translateEvent(eventType) {
  if (typeof eventType !== 'string' || eventType.length === 0) return null;
  if (!Object.prototype.hasOwnProperty.call(EVENT_MAP, eventType)) return null;
  const entry = EVENT_MAP[eventType];
  return { gatewayStatus: entry.gatewayStatus, crossesThreshold: entry.crossesThreshold };
}

/**
 * The source-status allowlist for the conditional update, for ONE destination (fresh copy; the module
 * constants stay frozen).
 *
 * An unknown/absent destination falls back to the pending-only list, which is the fail-safe answer: the
 * narrowest guard, never the widest.
 * @param {*} destinationStatus - The destination gatewayStatus of this transition.
 * @returns {string[]} Statuses a Payment may transition FROM into that destination.
 * @example
 * allowedSourceStatuses('succeeded'); // ['requires_payment', 'processing', 'failed', 'expired']
 * allowedSourceStatuses('failed'); // ['requires_payment', 'processing']
 */
function allowedSourceStatuses(destinationStatus) {
  const key = typeof destinationStatus === 'string' ? destinationStatus : '';
  const sources = Object.prototype.hasOwnProperty.call(SOURCES_BY_DESTINATION, key)
    ? SOURCES_BY_DESTINATION[key]
    : PENDING_SOURCE_STATUSES;
  return [...sources];
}

module.exports = { translateEvent, allowedSourceStatuses, EVENT_MAP };
