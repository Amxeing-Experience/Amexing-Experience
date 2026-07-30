/**
 * PaymentGatewayService - abstract base contract for every payment gateway adapter.
 *
 * This is the ONLY thing the caller (PaymentController and any future charge point)
 * ever talks to, together with the GatewayRouter: it never knows Stripe or Openpay
 * directly (plan seccion 4.2). Every capability is declared here; a concrete adapter
 * that fails to override one throws an explicit NOT_IMPLEMENTED PaymentGatewayError
 * when that capability is invoked (never a silent failure or a raw "is not a
 * function" TypeError).
 *
 * The normalized shapes below (ChargeRequest / ChargeResult / RefundRequest /
 * RefundResult / GatewayEvent) are the CRM's provider-independent vocabulary. Amounts
 * always travel in the MAJOR unit (pesos/dollars) + currency; each adapter absorbs the
 * minor-unit conversion internally (plan seccion 4.2).
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const PaymentGatewayError = require('./PaymentGatewayError');

/**
 * Normalized charge request (provider-independent). Amount is in the MAJOR unit and
 * already includes commission (no surcharge is added downstream).
 * @typedef {object} ChargeRequest
 * @property {number} amount - Amount in the major unit (e.g. 1850.00).
 * @property {string} currency - 'MXN' or 'USD'.
 * @property {string} reservationId - Reservation the charge is tied to.
 * @property {string} [reservationServiceId] - Optional service within the reservation.
 * @property {string} idempotencyKey - Unique per-attempt key (prevents double charge).
 * @property {string} [description] - Human description for the provider receipt.
 * @property {object} [customer] - Minimal customer data for the receipt (name/email).
 * @property {object} [metadata] - Keys to recover reservation/payment/user provider-side.
 * @property {string} [successUrl] - Return URL on success (hosted flow).
 * @property {string} [cancelUrl] - Return URL on cancel (hosted flow).
 */

/**
 * Normalized charge result (provider-independent).
 * @typedef {object} ChargeResult
 * @property {string} gateway - Gateway id that processed the charge.
 * @property {string} chargeId - Provider-side charge/intent id (anchor for refunds).
 * @property {string} status - Normalized status (e.g. requires_action, pending,
 * succeeded, failed, refunded, canceled).
 * @property {number} amount - Charged amount in the major unit.
 * @property {string} currency - 'MXN' or 'USD'.
 * @property {(string|null)} checkoutUrl - Hosted checkout URL when applicable, else null.
 * @property {(string|null)} [declineCode] - Normalized decline code when it failed.
 * @property {(string|null)} [paidAt] - Payment timestamp when applicable.
 * @property {object} [raw] - Raw provider payload, for internal audit ONLY (never the PAN).
 */

/**
 * Normalized refund request (provider-independent).
 * @typedef {object} RefundRequest
 * @property {string} chargeId - Provider-side id of the original charge.
 * @property {number} [amount] - Amount to refund; omit for a full refund.
 * @property {string} idempotencyKey - Unique per-attempt key (prevents double refund).
 */

/**
 * Normalized refund result (provider-independent).
 * @typedef {object} RefundResult
 * @property {string} gateway - Gateway id that processed the refund.
 * @property {string} refundId - Provider-side refund id.
 * @property {string} status - Normalized refund status.
 * @property {number} amount - Refunded amount in the major unit.
 * @property {string} currency - 'MXN' or 'USD'.
 */

/**
 * Normalized webhook event (provider-independent). Decision #12: in PR1 this is a
 * JSDoc typedef ONLY. It is NOT the Parse model of the same name (that lands in PR2);
 * no GatewayEvent.js class/file is created here.
 * NOTE (PR5): this `type` vocabulary is the ADAPTER-level one described here, and it is NOT the set of
 * Payment.gatewayStatus values the Stripe webhook applies. That translation (which includes 'expired',
 * absent from this list) lives in its own pure module, services/payments/stripeWebhookEvents.js — do not
 * read this typedef as the authoritative webhook mapping.
 * @typedef {object} GatewayEvent
 * @property {string} gateway - Gateway id that originated the event.
 * @property {string} type - Normalized event type (succeeded/failed/refunded/pending/unknown).
 * @property {string} eventId - Provider event id (idempotency key of the webhook).
 * @property {(string|null)} [chargeId] - Associated charge id, when applicable.
 * @property {(number|null)} [amount] - Associated amount, when applicable.
 * @property {(string|null)} [currency] - Associated currency, when applicable.
 * @property {object} [metadata] - Keys to recover the reservation/payment involved.
 */

/**
 * Abstract base every adapter must extend.
 */
class PaymentGatewayService {
  constructor() {
    // Decision #10: this is an abstract contract; instantiating it directly is a
    // programming error. A cheap new.target guard turns it into a loud failure.
    if (new.target === PaymentGatewayService) {
      throw new PaymentGatewayError(
        PaymentGatewayError.CODES.NOT_IMPLEMENTED,
        'PaymentGatewayService is abstract; instantiate a concrete adapter instead'
      );
    }
  }

  /**
   * Identify the gateway (e.g. "stripe", "mexican"). Adapters must override.
   */
  getId() {
    throw PaymentGatewayService.notImplemented(this, 'getId');
  }

  /**
   * Declare the ISO currency codes this gateway supports. Adapters must override.
   */
  getSupportedCurrencies() {
    throw PaymentGatewayService.notImplemented(this, 'getSupportedCurrencies');
  }

  /**
   * Report whether the gateway has valid credentials. Adapters must override.
   */
  isConfigured() {
    throw PaymentGatewayService.notImplemented(this, 'isConfigured');
  }

  /**
   * Create a charge / build a hosted checkout (ChargeRequest -> ChargeResult).
   */
  createCharge() {
    throw PaymentGatewayService.notImplemented(this, 'createCharge');
  }

  /**
   * Look up an existing charge by its provider id (reconciliation / polling).
   */
  getCharge() {
    throw PaymentGatewayService.notImplemented(this, 'getCharge');
  }

  /**
   * Refund a charge (RefundRequest -> RefundResult).
   */
  refund() {
    throw PaymentGatewayService.notImplemented(this, 'refund');
  }

  /**
   * Verify a webhook signature and normalize it to a GatewayEvent.
   */
  verifyWebhook() {
    throw PaymentGatewayService.notImplemented(this, 'verifyWebhook');
  }

  /**
   * Build a NOT_IMPLEMENTED error for a capability. Tags the gateway id only when the
   * adapter actually overrides getId(), which also prevents infinite recursion when
   * getId() itself is the un-overridden capability being reported.
   * @param {PaymentGatewayService} instance - The adapter instance invoking the base.
   * @param {string} capability - The capability method name that was not overridden.
   * @returns {PaymentGatewayError} The typed NOT_IMPLEMENTED error to throw.
   */
  static notImplemented(instance, capability) {
    let gatewayId = null;
    if (instance && instance.getId !== PaymentGatewayService.prototype.getId) {
      try {
        const id = instance.getId();
        gatewayId = typeof id === 'string' ? id : null;
      } catch {
        gatewayId = null;
      }
    }
    return new PaymentGatewayError(
      PaymentGatewayError.CODES.NOT_IMPLEMENTED,
      `Capability "${capability}" is not implemented by this payment gateway adapter`,
      { gateway: gatewayId }
    );
  }
}

module.exports = PaymentGatewayService;
