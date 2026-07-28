/**
 * stripeClient - lazy singleton for the Stripe Node SDK.
 *
 * The `stripe` package is NOT installed in this PR (a deliberate dependency pending the
 * owner's explicit approval, plan seccion 11 / roadmap PR 4 blockers). Therefore
 * require('stripe') MUST be lazy — inside getStripeClient(), never at module scope — so
 * the whole app still boots without the package. Every test injects a mock client via
 * __setClientForTests(); the real require is only ever reached when a real client is
 * actually built (which never happens in tests, and never in prod until the SDK+keys land).
 *
 * Keys are strictly separated test vs live (plan seccion 8.2): production uses
 * STRIPE_SECRET_KEY_LIVE, every other environment uses STRIPE_SECRET_KEY_TEST. A boot-time
 * guard (assertKeyMatchesEnv) fails loud if the two are crossed, so a test key can never
 * run in production nor a live key in development.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

// Pinned Stripe API version (plan seccion 5.8: must be fixed, not floating). Reconfirm the
// vigente version against docs.stripe.com when the SDK is actually installed.
const STRIPE_API_VERSION = '2024-06-20';

// Bounded network resilience: a few short retries leaning on the per-request idempotency key
// (so a retry never duplicates a charge), plus a hard timeout (plan seccion 5.8).
const MAX_NETWORK_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 20000;

// Recognized Stripe secret-key shapes: standard (sk_) AND restricted (rk_) keys, each in live/test mode.
// A restricted LIVE key (rk_live_...) moves real money exactly like sk_live_, so the environment guard
// must gate BOTH families by mode (council MEDIUM). Capturing the mode lets isStripeConfigured() and
// assertKeyMatchesEnv() share one source of truth; an unrecognized prefix is rejected (never assumed test).
const KEY_PREFIX_PATTERN = /^(sk|rk)_(live|test)_/;

// Test-injected client (set by __setClientForTests). When present, getStripeClient() returns
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
 * Fail the boot if the configured key does not match the environment (plan seccion 8.2):
 * a test key in production would silently never move real money; a live key in development
 * would move real money by accident. Either is a loud error, never a silent misconfiguration.
 * @param {string} key - The resolved secret key.
 * @throws {Error} When the key mode contradicts the environment.
 */
function assertKeyMatchesEnv(key) {
  const isProd = process.env.NODE_ENV === 'production';
  const parsed = KEY_PREFIX_PATTERN.exec(key);
  // Reject an unknown prefix outright: a key that is neither sk_/rk_ live/test is a misconfiguration we
  // must never wave through as "probably test" (council MEDIUM).
  if (!parsed) {
    throw new Error('Stripe: secret key has an unrecognized prefix (expected sk_live_/sk_test_/rk_live_/rk_test_)');
  }
  const mode = parsed[2]; // 'live' | 'test'
  if (isProd && mode === 'test') {
    throw new Error('Stripe: production environment is configured with a TEST secret key');
  }
  if (!isProd && mode === 'live') {
    // Covers sk_live_ AND rk_live_ (a restricted live key is just as dangerous outside production).
    throw new Error('Stripe: non-production environment is configured with a LIVE secret key');
  }
}

/**
 * Whether a usable Stripe client can be produced right now — either a test-injected client
 * or a configured secret key for this environment. Never requires the SDK package (a cheap,
 * side-effect-free check safe to call at any time, including when 'stripe' is not installed).
 * @returns {boolean} True when getStripeClient() would succeed.
 */
function isStripeConfigured() {
  // Require a recognized key PREFIX, not merely a non-empty string (council LOW): otherwise a junk value
  // reports "configured" and the failure is deferred until the first real checkout, instead of surfacing
  // as a plain unconfigured state up front.
  return injectedClient !== null || KEY_PREFIX_PATTERN.test(resolveSecretKey());
}

/**
 * Get the singleton Stripe client. Returns a test-injected client when present; otherwise
 * builds (once) and caches a real client from the environment key. The require('stripe') is
 * INSIDE this function on purpose: the app must boot without the package, so the real module
 * is only pulled in when a real client is genuinely needed.
 * @returns {object} The Stripe client (real SDK instance or injected test double).
 * @throws {Error} When neither an injected client nor a valid environment key is available,
 * or when the (lazy) require('stripe') fails because the package is not installed.
 */
function getStripeClient() {
  if (injectedClient !== null) return injectedClient;
  if (builtClient !== null) return builtClient;

  const key = resolveSecretKey();
  if (!key) {
    throw new Error('Stripe secret key is not configured for this environment');
  }
  assertKeyMatchesEnv(key);

  // LAZY require: only reached when actually building a real client. Keeping it here (never at
  // module scope) is what lets the app boot with the `stripe` package absent.
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
