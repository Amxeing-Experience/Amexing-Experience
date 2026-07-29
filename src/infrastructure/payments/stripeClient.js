/**
 * stripeClient - lazy singleton for the Stripe Node SDK.
 *
 * The `stripe` package IS installed (package.json, dependency approved for this PR). The
 * require stays LAZY — inside getStripeClient(), never at module scope — for two reasons that
 * are still live: with PAYMENTS_ENABLED=false (today's normal state) the SDK is never loaded
 * into the process at all, and every test injects a mock client via setClientForTests() so
 * the real require is never reached there either.
 *
 * Keys are strictly separated test vs live (plan seccion 8.2): production uses
 * STRIPE_SECRET_KEY_LIVE, every other environment uses STRIPE_SECRET_KEY_TEST. The env guard
 * (assertKeyMatchesEnv) is NOT a boot-time check: it runs inside the FIRST getStripeClient()
 * call that actually builds a client, which with the feature flag off can be weeks after boot.
 * The cheap pre-check isStripeConfigured() therefore applies the SAME key+mode rule without
 * throwing, so a crossed key surfaces as a clean "not configured" (503) instead of a
 * provider error (502) raised mid-charge.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

// Pinned Stripe API version (plan seccion 5.8: must be fixed, not floating). Deliberate value,
// not an inherited placeholder: it is the default of the installed SDK (stripe@22.3.2 ->
// node_modules/stripe/cjs/apiVersion.js, ApiVersion '2026-06-24.dahlia') and the version Stripe
// reported as vigente in the real sandbox verification. Bump it consciously with an SDK upgrade.
const STRIPE_API_VERSION = '2026-06-24.dahlia';

// Bounded network resilience: a few short retries leaning on the per-request idempotency key
// (so a retry never duplicates a charge), plus a hard timeout (plan seccion 5.8).
const MAX_NETWORK_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 20000;

// Recognized Stripe secret-key shapes: standard (sk_) AND restricted (rk_) keys, each in live/test mode.
// A restricted LIVE key (rk_live_...) moves real money exactly like sk_live_, so the environment guard
// must gate BOTH families by mode (council MEDIUM). Capturing the mode lets isStripeConfigured() and
// assertKeyMatchesEnv() share one source of truth; an unrecognized prefix is rejected (never assumed test).
const KEY_PREFIX_PATTERN = /^(sk|rk)_(live|test)_/;

// Test-injected client (set by setClientForTests). When present, getStripeClient() returns
// it verbatim and the real require('stripe') is never reached.
let injectedClient = null;

// Cached real client, built lazily on the first getStripeClient() call in a real environment.
let builtClient = null;

/**
 * Resolve the correct secret key for the current environment: LIVE in production, TEST
 * everywhere else. Trimmed; returns '' when the relevant variable is unset.
 * @returns {string} The environment's Stripe secret key, or '' when not configured.
 */
function resolveSecretKey() {
  const isProd = process.env.NODE_ENV === 'production';
  const key = isProd ? process.env.STRIPE_SECRET_KEY_LIVE : process.env.STRIPE_SECRET_KEY_TEST;
  return typeof key === 'string' ? key.trim() : '';
}

/**
 * Parse a secret key into its mode and whether that mode matches the current environment.
 * SINGLE source of truth shared by the throwing guard (assertKeyMatchesEnv) and the cheap
 * pre-check (isStripeConfigured), so "configured" can never report true for a key the guard
 * would then reject.
 * @param {string} key - The candidate secret key.
 * @returns {{valid: boolean, mode: (string|null), matchesEnv: boolean}} Parsed key shape.
 */
function inspectKey(key) {
  const parsed = KEY_PREFIX_PATTERN.exec(key || '');
  // An unknown prefix is a misconfiguration we must never wave through as "probably test" (council MEDIUM).
  if (!parsed) return { valid: false, mode: null, matchesEnv: false };
  const mode = parsed[2]; // 'live' | 'test'
  const isProd = process.env.NODE_ENV === 'production';
  return { valid: true, mode, matchesEnv: isProd ? mode === 'live' : mode === 'test' };
}

/**
 * Fail loud if the configured key does not match the environment (plan seccion 8.2): a test key
 * in production would silently never move real money; a live key (sk_ or rk_) outside production
 * would move real money by accident. Runs on the first real client build, NOT at boot.
 * @param {string} key - The resolved secret key.
 * @throws {Error} When the key prefix is unrecognized or its mode contradicts the environment.
 */
function assertKeyMatchesEnv(key) {
  const { valid, mode, matchesEnv } = inspectKey(key);
  if (!valid) {
    throw new Error('Stripe: secret key has an unrecognized prefix (expected sk_live_/sk_test_/rk_live_/rk_test_)');
  }
  if (matchesEnv) return;
  throw new Error(mode === 'test'
    ? 'Stripe: production environment is configured with a TEST secret key'
    : 'Stripe: non-production environment is configured with a LIVE secret key');
}

/**
 * Whether a usable Stripe client can be produced right now — either a test-injected client or a
 * key whose prefix AND mode are valid for this environment. Never requires the SDK package (a
 * cheap, side-effect-free check safe to call at any time).
 *
 * The mode check matters for error classification: reporting "configured" for a key that
 * assertKeyMatchesEnv will reject (e.g. an sk_live_ key in staging) let the controller's guard
 * pass and turned a pure CONFIGURATION problem into a PROVIDER_ERROR/502 raised mid-charge,
 * instead of the correct NOT_CONFIGURED/503.
 * @returns {boolean} True when getStripeClient() would succeed.
 */
function isStripeConfigured() {
  if (injectedClient !== null) return true;
  return inspectKey(resolveSecretKey()).matchesEnv;
}

/**
 * Get the singleton Stripe client. Returns a test-injected client when present; otherwise
 * builds (once) and caches a real client from the environment key. The require('stripe') is
 * INSIDE this function on purpose: the SDK is only pulled into the process when a real client
 * is genuinely needed (never with PAYMENTS_ENABLED=false, never under an injected test client).
 * @returns {object} The Stripe client (real SDK instance or injected test double).
 * @throws {Error} When neither an injected client nor a valid environment key is available
 * (missing key, unrecognized prefix, or a mode that contradicts the environment).
 */
function getStripeClient() {
  if (injectedClient !== null) return injectedClient;
  if (builtClient !== null) return builtClient;

  const key = resolveSecretKey();
  if (!key) {
    throw new Error('Stripe secret key is not configured for this environment');
  }
  assertKeyMatchesEnv(key);

  // LAZY require: only reached when actually building a real client, so the SDK is never loaded
  // with the payments flag off nor in tests (which inject a client).
  // eslint-disable-next-line global-require, import/no-unresolved
  const Stripe = require('stripe');
  builtClient = Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: MAX_NETWORK_RETRIES,
    timeout: REQUEST_TIMEOUT_MS,
    telemetry: false,
  });
  return builtClient;
}

/**
 * Inject a mock/stub Stripe client for tests (zero network, zero real require). Passing a
 * falsy value clears the injection. Also drops any previously built real client so the next
 * getStripeClient() re-resolves cleanly. TEST SEAM ONLY.
 * @param {(object|null)} client - The test double, or null to clear.
 */
function setClientForTests(client) {
  injectedClient = client || null;
  builtClient = null;
}

/**
 * Reset all cached/injected state (test hygiene between suites). TEST SEAM ONLY.
 */
function resetForTests() {
  injectedClient = null;
  builtClient = null;
}

module.exports = {
  getStripeClient,
  isStripeConfigured,
  STRIPE_API_VERSION,
  setClientForTests,
  resetForTests,
};
