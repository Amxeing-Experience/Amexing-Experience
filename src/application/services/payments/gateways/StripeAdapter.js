/**
 * StripeAdapter (PR1 stub).
 *
 * Implements the full PaymentGatewayService contract but performs ZERO network/SDK
 * calls. It exists so GatewayRouter/GatewayRegistry have a real instance to resolve
 * and route to, end-to-end, without any credentials or HTTP (plan seccion 4.1).
 *
 * Decision #7: charge-related capabilities always throw NOT_CONFIGURED (rather than
 * returning fake deterministic data), applied consistently across all methods and
 * both adapters. Not-yet-wired is more honest than fake data that a later reader might
 * mistake for something real. The real Stripe Checkout implementation lands in PR4.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const PaymentGatewayService = require('../PaymentGatewayService');
const PaymentGatewayError = require('../PaymentGatewayError');

const GATEWAY_ID = 'stripe';

/**
 * Stripe processes USD and, as the MXN fallback in the router, declares MXN too
 * (plan seccion 4.5: Stripe is the deterministic fallback for MXN when the mexican
 * gateway is unavailable).
 * @type {readonly string[]}
 */
const SUPPORTED_CURRENCIES = Object.freeze(['USD', 'MXN']);

/**
 * Build the NOT_CONFIGURED error used by every charge-related stub method.
 * @param {string} capability - The capability being invoked.
 * @returns {PaymentGatewayError} The typed NOT_CONFIGURED error to throw.
 */
function notConfigured(capability) {
  return new PaymentGatewayError(
    PaymentGatewayError.CODES.NOT_CONFIGURED,
    `Stripe gateway is not configured yet; "${capability}" is unavailable in this build`,
    { gateway: GATEWAY_ID }
  );
}

/**
 * Stripe gateway adapter (stub).
 * @augments PaymentGatewayService
 */
class StripeAdapter extends PaymentGatewayService {
  /** @returns {string} The gateway id, exactly "stripe". */
  getId() {
    return GATEWAY_ID;
  }

  /** @returns {string[]} A fresh copy of the supported currency codes. */
  getSupportedCurrencies() {
    return [...SUPPORTED_CURRENCIES];
  }

  /** @returns {boolean} Always false in PR1: no real credentials exist yet. */
  isConfigured() {
    return false;
  }

  /** @throws {PaymentGatewayError} Always NOT_CONFIGURED (Decision #7). */
  createCharge() {
    throw notConfigured('createCharge');
  }

  /** @throws {PaymentGatewayError} Always NOT_CONFIGURED (Decision #7). */
  getCharge() {
    throw notConfigured('getCharge');
  }

  /** @throws {PaymentGatewayError} Always NOT_CONFIGURED (Decision #7). */
  refund() {
    throw notConfigured('refund');
  }

  /** @throws {PaymentGatewayError} Always NOT_CONFIGURED (Decision #7). */
  verifyWebhook() {
    throw notConfigured('verifyWebhook');
  }
}

module.exports = StripeAdapter;
