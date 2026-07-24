/**
 * OpenpayAdapter (PR1 stub).
 *
 * Implements the full PaymentGatewayService contract with ZERO network/SDK calls, same
 * as StripeAdapter. Exists so the router can resolve/route to a real MXN gateway
 * instance end-to-end without credentials (plan seccion 4.1).
 *
 * NAMING TRAP (analysis/roadmap seccion 1): getId() MUST return 'mexican', NOT
 * 'openpay'. The abstraction keys the gateway by its role/currency-market ('mexican'),
 * not by the vendor name; hardcoding 'openpay' is the exact bug that broke the
 * abandoned branch, because the router/toggle resolve by the 'mexican' id.
 *
 * Decision #7: charge-related capabilities always throw NOT_CONFIGURED (same approach
 * as StripeAdapter, for internal consistency). The real Openpay implementation lands
 * in PR9; isConfigured() stays false until its onboarding credentials exist.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const PaymentGatewayService = require('../PaymentGatewayService');
const PaymentGatewayError = require('../PaymentGatewayError');

const GATEWAY_ID = 'mexican'; // NOT 'openpay' -- see the naming trap note above.

/**
 * Openpay only clears MXN reliably (plan seccion 4.5: mexican gateways do not charge
 * USD dependably, so USD always routes to Stripe).
 * @type {readonly string[]}
 */
const SUPPORTED_CURRENCIES = Object.freeze(['MXN']);

/**
 * Build the NOT_CONFIGURED error used by every charge-related stub method.
 * @param {string} capability - The capability being invoked.
 * @returns {PaymentGatewayError} The typed NOT_CONFIGURED error to throw.
 */
function notConfigured(capability) {
  return new PaymentGatewayError(
    PaymentGatewayError.CODES.NOT_CONFIGURED,
    `Openpay gateway is not configured yet; "${capability}" is unavailable in this build`,
    { gateway: GATEWAY_ID }
  );
}

/**
 * Openpay (mexican) gateway adapter (stub).
 * @augments PaymentGatewayService
 */
class OpenpayAdapter extends PaymentGatewayService {
  /**
   * @returns {string} The gateway id, exactly "mexican" (never "openpay").
   */
  getId() {
    return GATEWAY_ID;
  }

  /**
   * @returns {string[]} A fresh copy of the supported currency codes (MXN only).
   */
  getSupportedCurrencies() {
    return [...SUPPORTED_CURRENCIES];
  }

  /**
   * @returns {boolean} Always false in PR1: Openpay onboarding is not complete.
   */
  isConfigured() {
    return false;
  }

  /**
   * @throws {PaymentGatewayError} Always NOT_CONFIGURED (Decision #7).
   */
  createCharge() {
    throw notConfigured('createCharge');
  }

  /**
   * @throws {PaymentGatewayError} Always NOT_CONFIGURED (Decision #7).
   */
  getCharge() {
    throw notConfigured('getCharge');
  }

  /**
   * @throws {PaymentGatewayError} Always NOT_CONFIGURED (Decision #7).
   */
  refund() {
    throw notConfigured('refund');
  }

  /**
   * @throws {PaymentGatewayError} Always NOT_CONFIGURED (Decision #7).
   */
  verifyWebhook() {
    throw notConfigured('verifyWebhook');
  }
}

module.exports = OpenpayAdapter;
