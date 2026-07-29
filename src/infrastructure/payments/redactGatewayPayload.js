/**
 * redactGatewayPayload - reduce a raw payment-provider (Stripe/Openpay) object down to a
 * small, PCI-safe shape for logging (plan seccion 8.1). Only opaque ids + amount/currency/
 * status survive; nested provider objects (charges, payment_method_details, customer_details)
 * that can carry last4/brand/PAN-adjacent data are NEVER returned. Analogous in intent to the
 * PAN maskers already in the codebase (PaymentGatewayError.redactPan, logger.js).
 *
 * Rule of thumb: if it is not an opaque id or a plain amount/currency/status scalar, it does
 * not come out of here.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

/**
 * Coerce a provider field that may be either an id string or an expanded object into its
 * opaque id (or null). Prevents an expanded `payment_intent`/`charge` object (which drags
 * along card details) from leaking through.
 * @param {*} value - A provider field (id string, expanded object, or nullish).
 * @returns {(string|null)} The opaque id, or null.
 */
function toId(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
  return null;
}

/**
 * Pick the first finite numeric candidate (Stripe uses amount_total on sessions, amount on
 * intents/charges).
 * @param {object} payload - Raw provider object.
 * @returns {(number|null)} A safe integer minor-unit amount, or null.
 */
function pickAmount(payload) {
  if (Number.isFinite(payload.amount_total)) return payload.amount_total;
  if (Number.isFinite(payload.amount)) return payload.amount;
  return null;
}

/**
 * Redact a raw provider payload to only PCI-safe, loggable fields.
 * @param {*} payload - Raw provider object (Stripe Checkout Session / PaymentIntent / Charge).
 * @returns {object} A curated, log-safe shape: { id, object, status, amount, currency, paymentIntent, charge }.
 * @example
 * logger.info('checkout', redactGatewayPayload(session)); // never logs last4/brand/PAN
 */
function redactGatewayPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  return {
    id: typeof payload.id === 'string' ? payload.id : null,
    object: typeof payload.object === 'string' ? payload.object : null,
    status: typeof payload.status === 'string' ? payload.status : null,
    amount: pickAmount(payload),
    currency: typeof payload.currency === 'string' ? payload.currency : null,
    paymentIntent: toId(payload.payment_intent),
    charge: toId(payload.charge),
  };
}

module.exports = { redactGatewayPayload };
