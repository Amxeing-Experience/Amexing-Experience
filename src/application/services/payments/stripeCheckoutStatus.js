/**
 * stripeCheckoutStatus - PURE translation of what Stripe REPORTS about a Checkout Session /
 * PaymentIntent into the normalized Payment gatewayStatus we may apply, for the two paths that ASK
 * instead of being told: the browser-return polling and the reconciliation job.
 *
 * Sibling of stripeWebhookEvents.js, and deliberately NOT a copy of it: the webhook translates an
 * EVENT TYPE, this translates a live STATE. What both must share, and what lives in exactly one
 * place, is the monotonic guard — which source statuses are legal toward each destination. That is
 * imported from stripeWebhookEvents (allowedSourceStatuses) and never re-declared here; two
 * implementations of one money criterion already diverged once in this roadmap.
 *
 * Dependency-free otherwise (no Parse, no SDK, no env) and it can NEVER throw: an unknown, absent or
 * adversarial combination resolves to { ok:false } — "still pending, ask again later" — which is a
 * safe no-op, never an exception that would turn a routine poll into a 500.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const { allowedSourceStatuses } = require('./stripeWebhookEvents');

/**
 * Build the answer for a destination we DO recognize, attaching the shared source allowlist so every
 * caller transitions with the same guard the webhook uses.
 * @param {string} gatewayStatus - The destination Payment.gatewayStatus.
 * @param {boolean} crossesThreshold - Whether it crosses the rollup counts/does-not-count line.
 * @returns {{ok: boolean, gatewayStatus: string, crossesThreshold: boolean}}
 * The recognized destination.
 */
function terminal(gatewayStatus, crossesThreshold) {
  // NO devuelve fromStatuses: quien transiciona (applyConfirmation) lo deriva de
  // allowedSourceStatuses con el destino en la mano. Publicarlo aquí creaba una SEGUNDA copia del
  // mismo criterio de dinero, que nadie consumía y que podía divergir — justo lo que este módulo
  // existe para impedir.
  return { ok: true, gatewayStatus, crossesThreshold };
}

/**
 * The DEFAULT answer: this state does not map to any destination we may apply.
 *
 * It is an explicit default and not a missing table cell, which is the whole reason the hole cannot
 * reappear with the next status Stripe invents. It absorbs, without enumerating them: 'open',
 * 'requires_payment_method' (a DECLINED card — the session stays open and payable, so it is NOT
 * terminal), 'processing', 'requires_action', 'requires_capture', 'complete' with payment_status
 * 'unpaid', unknown strings, and anything that is not an object at all.
 * @returns {{ok: boolean}} The pending answer.
 */
function pending() {
  return { ok: false };
}

/**
 * Safely read a string field off a value that may be anything at all.
 * @param {*} source - Candidate object.
 * @param {string} field - Field name.
 * @returns {string} The string value, or '' for anything else.
 */
function str(source, field) {
  return source && typeof source === 'object' && typeof source[field] === 'string' ? source[field] : '';
}

/**
 * Translate a Stripe Checkout Session and/or PaymentIntent into the destination we may apply.
 *
 * The order is money-first and is itself the decision: a paid session or a succeeded intent wins over
 * everything, and a CANCELED INTENT beats an 'open' session, because a canceled intent leaves that
 * session unpayable no matter what its own status field still says.
 *
 * 'canceled' maps to our existing 'expired' on purpose, instead of inventing a 'canceled'
 * gatewayStatus: a new value would sit outside the succeeded source allowlist and would SEAL the row
 * against a later legitimate confirmation. The consequence is deliberate and worth stating: this
 * module can only ever produce 'succeeded' or 'expired'. 'failed' stays exclusive to the webhook,
 * which is the only path that is TOLD an attempt failed rather than inferring it from a state.
 * @param {object} [session] - The Stripe Checkout Session (or nothing, when only an intent is known).
 * @param {object} [intent] - The Stripe PaymentIntent (expanded from the session, or fetched alone).
 * @returns {{ok: boolean, gatewayStatus?: string, crossesThreshold?: boolean}}
 * The destination, or { ok:false } when the provider state maps to nothing we may apply.
 * @example
 * translateCheckoutStatus({ status: 'complete', payment_status: 'paid' }); // succeeded
 * translateCheckoutStatus({ status: 'open' }, { status: 'canceled' }); // expired (the intent wins)
 * translateCheckoutStatus({ status: 'open' }, { status: 'requires_payment_method' }); // { ok:false }
 */
function translateCheckoutStatus(session, intent) {
  if (str(intent, 'status') === 'succeeded' || str(session, 'payment_status') === 'paid') {
    return terminal('succeeded', true);
  }
  if (str(intent, 'status') === 'canceled') return terminal('expired', false);
  if (str(session, 'status') === 'expired') return terminal('expired', false);
  return pending();
}

/**
 * Whether a Payment in `localStatus` could still legally reach 'succeeded'.
 *
 * This is the ONLY criterion the polling endpoint may use to decide it can answer from the local row
 * without calling Stripe — and it is derived from the shared allowlist, never from a private list of
 * "terminal" statuses. That distinction is money: a 'failed' row is NOT terminal (a declined card
 * leaves the session open and the payer retries on it, the exact bug PR5 had to close), and neither
 * the TTL sweep (which only looks at 'requires_payment') nor the reconciliation reaches a failed row,
 * so this endpoint is its only remaining safety net.
 * @param {*} localStatus - The Payment's current gatewayStatus.
 * @returns {boolean} True when a confirmation could still legitimately apply to that row.
 * @example
 * canStillReachSucceeded('failed'); // true — the same session may still be paid
 * canStillReachSucceeded('succeeded'); // false — nothing left to ask Stripe about
 */
function canStillReachSucceeded(localStatus) {
  return allowedSourceStatuses('succeeded').includes(localStatus);
}

module.exports = { translateCheckoutStatus, canStillReachSucceeded };
