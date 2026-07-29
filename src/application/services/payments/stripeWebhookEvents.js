/**
 * stripeWebhookEvents - PURE translation of a Stripe event type into the normalized Payment
 * gatewayStatus this PR knows how to apply (plan PR5 seccion 4.4), plus the allowlist of SOURCE
 * statuses from which that transition is legal (seccion 4.5).
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
 * Statuses a Payment may legally be in for ANY of this PR's destinations to apply.
 *
 * 'requires_payment' is the state PR4 creates the pending in. 'processing' is future-proofing for an
 * eventual payment_intent.processing (async methods): no code produces it today, and listing it costs
 * nothing while omitting it would silently strand such a Payment later. Everything else — including the
 * destinations themselves and the terminal states of other PRs (refunded/dispute_lost/disputed) — is
 * excluded ON PURPOSE: that exclusion IS the monotonic guard. A late 'succeeded' can never walk a
 * refunded/expired/failed Payment backwards, because the conditional update simply matches no document.
 * @type {readonly string[]}
 */
const ALLOWED_SOURCE_STATUSES = Object.freeze(['requires_payment', 'processing']);

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
 * The source-status allowlist for the conditional update (fresh copy; the module constant stays frozen).
 * @returns {string[]} Statuses a Payment may transition FROM in this PR.
 * @example
 * allowedSourceStatuses(); // ['requires_payment', 'processing']
 */
function allowedSourceStatuses() {
  return [...ALLOWED_SOURCE_STATUSES];
}

module.exports = { translateEvent, allowedSourceStatuses, EVENT_MAP };
