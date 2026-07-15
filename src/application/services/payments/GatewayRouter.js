/**
 * GatewayRouter - resolves WHICH adapter processes a charge, from currency x toggle
 * (plan seccion 4.5). Currency rules over the toggle:
 * - USD always -> Stripe, regardless of the toggle.
 * - MXN -> whichever the toggle names, UNLESS that gateway is not registered / not
 * MXN-capable / not configured, in which case it falls back to Stripe with a warning log.
 * - If not even Stripe (the baseline terminal) is available, throw NOT_CONFIGURED rather
 * than hand back a broken adapter.
 *
 * The toggle is an explicit parameter to resolve() (Decision #6). In PR1 the caller
 * passes a mock/injected value; PR3 swaps in the real Setting read without touching
 * this class's decision logic.
 *
 * Note on "configured" at the terminal (documented interpretation of the plan's
 * NOT_CONFIGURED case): in PR1 every stub adapter reports isConfigured() === false, so
 * gating the terminal Stripe return on isConfigured() would make the whole layer
 * non-functional and untestable end-to-end. isConfigured() therefore gates only the
 * MXN toggle-honoring decision (honor the toggle vs. fall back to Stripe); the
 * terminal Stripe return requires Stripe to be REGISTERED. When real credentials land
 * (PR4+), isConfigured() additionally gates live use. See the report for this call.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const defaultLogger = require('../../../infrastructure/logger');
const PaymentGatewayError = require('./PaymentGatewayError');

const STRIPE_ID = 'stripe';
const MEXICAN_ID = 'mexican';

/**
 * Currencies the router accepts. Decision #4: anything outside this set (after
 * uppercasing) is rejected up front, never allowed to fall through to the MXN branch.
 * @type {readonly string[]}
 */
const SUPPORTED_CURRENCIES = Object.freeze(['USD', 'MXN']);

/**
 * Normalize a currency argument: trim + uppercase, so 'usd' is treated as USD while
 * garbage (null, '', numbers, objects) collapses to an empty string that is rejected.
 * @param {*} currency - Raw currency argument.
 * @returns {string} Uppercased currency, or '' when not a usable string.
 */
function normalizeCurrency(currency) {
  return typeof currency === 'string' ? currency.trim().toUpperCase() : '';
}

/**
 * @param {*} toggle - Raw toggle value.
 * @returns {boolean} True when the toggle explicitly names the mexican gateway.
 */
function toggleNamesMexican(toggle) {
  return typeof toggle === 'string' && toggle.trim().toLowerCase() === MEXICAN_ID;
}

/**
 * @param {object} adapter - Adapter instance.
 * @returns {boolean} True when the adapter declares MXN support (defensive).
 */
function supportsMxn(adapter) {
  try {
    const currencies = adapter.getSupportedCurrencies();
    return Array.isArray(currencies) && currencies.includes('MXN');
  } catch {
    return false;
  }
}

/**
 * @param {object} adapter - Adapter instance.
 * @returns {boolean} True only when isConfigured() strictly returns true (defensive).
 */
function isConfigured(adapter) {
  try {
    return adapter.isConfigured() === true;
  } catch {
    return false;
  }
}

/**
 * Routes an incoming charge to the correct gateway adapter.
 */
class GatewayRouter {
  /**
   * @param {object} registry - A GatewayRegistry (must expose has() and resolve()).
   * @param {object} [deps] - Optional injected dependencies.
   * @param {object} [deps.logger] - Logger with a warn() method (defaults to the app logger).
   * @throws {PaymentGatewayError} PROVIDER_ERROR when registry is unusable.
   */
  constructor(registry, deps) {
    const injected = deps && typeof deps === 'object' ? deps : {};
    if (!registry || typeof registry.resolve !== 'function' || typeof registry.has !== 'function') {
      throw new PaymentGatewayError(
        PaymentGatewayError.CODES.PROVIDER_ERROR,
        'GatewayRouter requires a GatewayRegistry exposing has() and resolve()'
      );
    }
    this.registry = registry;
    this.logger = injected.logger && typeof injected.logger.warn === 'function'
      ? injected.logger
      : defaultLogger;
  }

  /**
   * Resolve the adapter that must process a charge for the given currency.
   * @param {string} currency - 'USD' or 'MXN' (case-insensitive).
   * @param {string} toggle - Active gateway id for MXN (mock/injected in PR1).
   * @returns {object} The resolved gateway adapter instance.
   * @throws {PaymentGatewayError} UNSUPPORTED_CURRENCY for a bad currency;
   * NOT_CONFIGURED when no terminal gateway is available.
   */
  resolve(currency, toggle) {
    // Decision #4: normalize + validate the currency BEFORE consulting the toggle.
    const normalized = normalizeCurrency(currency);
    if (!SUPPORTED_CURRENCIES.includes(normalized)) {
      throw new PaymentGatewayError(
        PaymentGatewayError.CODES.UNSUPPORTED_CURRENCY,
        `Unsupported currency for payment routing: "${String(currency)}"`
      );
    }

    // USD always forces Stripe, regardless of the toggle (currency rules over toggle).
    if (normalized === 'USD') {
      if (toggleNamesMexican(toggle)) {
        this.logger.warn('gateway-router: usd-forces-stripe (toggle ignored for USD payment)');
      }
      return this.resolveTerminalStripe(normalized);
    }

    // MXN: honor the toggle only when it names a usable gateway; otherwise fall back.
    const toggled = this.resolveMxnToggle(toggle);
    if (toggled) {
      return toggled;
    }

    // Decision #5: deterministic fallback to Stripe when the toggle is unusable.
    return this.resolveTerminalStripe(normalized);
  }

  /**
   * Resolve the MXN toggle target, or null to signal "fall back to Stripe".
   * @param {string} toggle - Active gateway id for MXN.
   * @returns {(object|null)} The toggled adapter when usable, else null.
   */
  resolveMxnToggle(toggle) {
    if (typeof toggle !== 'string' || toggle.trim().length === 0) {
      this.logger.warn('gateway-router: empty/invalid MXN toggle, falling back to Stripe');
      return null;
    }
    // Normalize the toggle the same way toggleNamesMexican() does (trim + lowercase):
    // registry ids are canonical lowercase (adapter.getId()), so a valid-but-wrong-case
    // toggle like 'Mexican'/'MEXICAN' must resolve, not fall through to the Stripe
    // fallback and log the same "not registered" warning as a genuinely corrupt id.
    const id = toggle.trim().toLowerCase();
    if (!this.registry.has(id)) {
      // Corrupt / unknown toggle id -> fallback (never a hard error, per plan 4.5).
      this.logger.warn(`gateway-router: MXN toggle "${id}" is not registered, falling back to Stripe`);
      return null;
    }
    const adapter = this.registry.resolve(id);
    if (!supportsMxn(adapter) || !isConfigured(adapter)) {
      this.logger.warn(`gateway-router: MXN toggle "${id}" not configured/MXN-capable, falling back to Stripe`);
      return null;
    }
    return adapter;
  }

  /**
   * Resolve the baseline terminal (Stripe): USD processor and MXN fallback.
   * @param {string} currency - Normalized currency, for the error message.
   * @returns {object} The Stripe adapter instance.
   * @throws {PaymentGatewayError} NOT_CONFIGURED when Stripe is not even registered.
   */
  resolveTerminalStripe(currency) {
    if (!this.registry.has(STRIPE_ID)) {
      throw new PaymentGatewayError(
        PaymentGatewayError.CODES.NOT_CONFIGURED,
        `No payment gateway available to process ${currency}: Stripe is not registered`,
        { gateway: STRIPE_ID }
      );
    }
    return this.registry.resolve(STRIPE_ID);
  }
}

module.exports = GatewayRouter;
