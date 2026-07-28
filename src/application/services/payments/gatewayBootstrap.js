/**
 * gatewayBootstrap - the ONE real wiring point of the payment gateway layer.
 *
 * Until now the only place a GatewayRegistry was ever populated with real adapters was
 * the test suite (gateway-wiring.test.js wires it by hand). This module is the
 * production equivalent: it builds a single GatewayRegistry, registers the two Fase 1
 * adapters (StripeAdapter as 'stripe', OpenpayAdapter as 'mexican') and hands it back as
 * a lazy singleton so the whole app resolves against the exact same instances.
 *
 * Lazy singleton on purpose: GatewayRegistry.register() throws PaymentGatewayError on a
 * duplicate id (plan seccion 4.3), so the registry must be built exactly once. Every call
 * after the first returns the cached registry WITHOUT re-registering anything.
 *
 * The toggle is persisted as a NUMERIC code (0 = 'stripe', 1 = 'mexican'), not a string,
 * because the Setting.value column is fixed to Number in Parse (the two pre-existing
 * settings are numeric and Parse cannot change a column's type in place). This module owns
 * the number<->id translation (encodeGatewayId / decodeGatewayCode); the number never
 * leaves the API boundary -- callers always speak the string ids 'stripe'/'mexican'.
 *
 * The toggle stays an explicit argument to router.resolve() (never read inside the
 * router), keeping the routing decision pure and the Setting read at the call site.
 * See @example below for how the future checkout (PR4) is expected to consume this.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // How the future checkout (PR4) is expected to consume this:
 * const { getGatewayRegistry, decodeGatewayCode } = require('.../payments/gatewayBootstrap');
 * const GatewayRouter = require('.../payments/GatewayRouter');
 * const SettingsService = require('.../services/SettingsService');
 * const router = new GatewayRouter(getGatewayRegistry());
 * const code = await new SettingsService().getNumericValue('activePaymentGateway', 0);
 * const toggle = decodeGatewayCode(code); // numeric code -> 'stripe' | 'mexican'
 * const adapter = router.resolve(currency, toggle); // currency rules over toggle (seccion 4.5)
 */

const GatewayRegistry = require('./GatewayRegistry');
const StripeAdapter = require('./gateways/StripeAdapter');
const OpenpayAdapter = require('./gateways/OpenpayAdapter');

/**
 * Numeric-code <-> gateway-id translation. The code is what lives in Setting.value (a
 * Number column); the id is what the API and the router speak. Keep this the single source
 * of truth for the encoding so the seed, the controller and any future reader agree.
 * @type {Readonly<{[code: number]: string}>}
 */
const GATEWAY_CODE_TO_ID = Object.freeze({ 0: 'stripe', 1: 'mexican' });

/**
 * Inverse of GATEWAY_CODE_TO_ID, derived so the two can never drift.
 * @type {Readonly<{[id: string]: number}>}
 */
const ID_TO_GATEWAY_CODE = Object.freeze(
  Object.fromEntries(
    Object.entries(GATEWAY_CODE_TO_ID).map(([code, id]) => [id, Number(code)])
  )
);

/**
 * Safe default when a stored code is missing or corrupt: fall back to Stripe, the gateway
 * that is always valid (USD always uses it and it is the seed default).
 * @type {string}
 */
const DEFAULT_GATEWAY_ID = GATEWAY_CODE_TO_ID[0];

/**
 * Encode a gateway id into the numeric code persisted in Setting.value.
 * Strict on purpose: an unmapped id is a programming error (the controller validates the
 * id against the registry before calling this), so fail loud rather than persist garbage.
 * @param {string} id - Gateway id ('stripe' | 'mexican').
 * @returns {number} The numeric code (0 | 1).
 * @throws {Error} When id is not a known gateway id.
 */
function encodeGatewayId(id) {
  const code = ID_TO_GATEWAY_CODE[id];
  if (code === undefined) {
    throw new Error(`Cannot encode unknown gateway id "${id}" to a numeric code`);
  }
  return code;
}

/**
 * Decode the numeric code read from Setting.value back into a gateway id.
 * Never throws: an unknown/corrupt code (e.g. a value written by hand or a future code we
 * do not know yet) falls back to 'stripe' so the read endpoint stays up instead of 500ing.
 * @param {number} code - The stored numeric code.
 * @returns {string} The gateway id ('stripe' | 'mexican'), or 'stripe' as a safe default.
 */
function decodeGatewayCode(code) {
  return GATEWAY_CODE_TO_ID[code] || DEFAULT_GATEWAY_ID;
}

/**
 * Cached registry instance. Built on the first getGatewayRegistry() call and reused
 * thereafter so callers never re-register (which would throw) and always share the same
 * adapter instances.
 * @type {GatewayRegistry|null}
 */
let registrySingleton = null;

/**
 * Get the application's single, fully wired GatewayRegistry.
 * @returns {GatewayRegistry} The lazily built, cached registry with both adapters.
 */
function getGatewayRegistry() {
  if (registrySingleton) {
    return registrySingleton;
  }

  const registry = new GatewayRegistry();
  // Each adapter is keyed by its own getId(): StripeAdapter -> 'stripe',
  // OpenpayAdapter -> 'mexican' (never 'openpay', see OpenpayAdapter naming trap).
  registry.register(new StripeAdapter());
  registry.register(new OpenpayAdapter());

  registrySingleton = registry;
  return registrySingleton;
}

module.exports = { getGatewayRegistry, encodeGatewayId, decodeGatewayCode };
