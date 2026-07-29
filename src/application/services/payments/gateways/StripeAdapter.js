/**
 * StripeAdapter (PR4: real Checkout Sessions).
 *
 * Implements the PaymentGatewayService contract against the Stripe SDK for the ONE capability
 * this PR turns on: building a hosted Checkout Session (buildCheckout/createCharge). The SDK is
 * reached only through an INJECTABLE client (constructor option in tests, the lazy
 * stripeClient singleton in production), so a) the app boots without the `stripe` package and
 * b) every test drives a mock client with zero network (plan seccion 5.1/5.8).
 *
 * Still deferred (kept as NOT_CONFIGURED, never exposed by an endpoint here): getCharge is the
 * defensive polling of PR6; refund is PR11; verifyWebhook is PR5. They remain OVERRIDDEN (so the
 * registry's own-vs-inherited check passes), they just are not wired yet.
 *
 * Money conventions (plan seccion 5.2): amount travels in the MAJOR unit and already includes
 * commission, so there is NO surcharge — unit_amount = Math.round(amount * 100) verbatim, and the
 * currency goes to the SDK in lowercase ('usd'/'mxn'). The session is restricted to card (the
 * tarjeta tier). The webhook (PR5), not the redirect, is the source of truth.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const PaymentGatewayService = require('../PaymentGatewayService');
const PaymentGatewayError = require('../PaymentGatewayError');
const { getStripeClient, isStripeConfigured } = require('../../../../infrastructure/payments/stripeClient');
const { redactGatewayPayload } = require('../../../../infrastructure/payments/redactGatewayPayload');

const GATEWAY_ID = 'stripe';

// Checkout Session lifetime FALLBACK. Stripe requires expires_at within [now+30min, now+24h]. The local
// pending Payment lives PENDING_TTL_MS (30 min exactos en el controller); un colchón de 1 min sobre ese TTL
// mantiene la sesión y el pendiente local alineados (ambos ~30 min) sin caer bajo el mínimo de Stripe por
// latencia. Antes NO se fijaba expires_at (Stripe la dejaba pagable ~24h) mientras el pendiente local
// expiraba a 30 min: dos sesiones cobrables => doble-cobro (council BUG B).
// OJO: el valor REAL de producción viaja congelado por-Payment en chargeRequest.sessionExpiresAt (lo fija
// el controller a partir del expiresAt del pendiente). Este SESSION_TTL_MS solo se usa como respaldo cuando
// no llega ese anchor (p.ej. un test unitario aislado del adapter) — nunca en el flujo del controller, donde
// derivar expires_at de Date.now() rompería la idempotencia del replay (council HIGH).
const SESSION_TTL_MS = 31 * 60 * 1000;

/**
 * Stripe processes USD and, as the MXN fallback in the router, declares MXN too
 * (plan seccion 4.5: Stripe is the deterministic fallback for MXN when the mexican gateway is
 * unavailable). Advertised in MAJOR-unit ISO codes; the SDK conversion to lowercase minor-unit
 * happens inside buildCheckout.
 * @type {readonly string[]}
 */
const SUPPORTED_CURRENCIES = Object.freeze(['USD', 'MXN']);

// Currencies Stripe actually accepts from this adapter, in the lowercase form the SDK expects.
const SDK_CURRENCIES = Object.freeze(['usd', 'mxn']);

/**
 * Build the NOT_CONFIGURED error used by the not-yet-wired capabilities (refund/webhook/getCharge).
 * @param {string} capability - The capability being invoked.
 * @returns {PaymentGatewayError} The typed NOT_CONFIGURED error to throw.
 */
function notConfigured(capability) {
  return new PaymentGatewayError(
    PaymentGatewayError.CODES.NOT_CONFIGURED,
    `Stripe "${capability}" is not wired in this build (deferred to a later PR)`,
    { gateway: GATEWAY_ID }
  );
}

/**
 * Coerce a Stripe field that may be an id string or an expanded object into its opaque id.
 * @param {object|string} value - Stripe field (e.g. session.payment_intent).
 * @returns {(string|null)} The opaque id, or null.
 */
function toId(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
  return null;
}

/**
 * Validate a ChargeRequest and derive the SDK amount/currency. Rejects a non-positive/NaN amount
 * (PROVIDER_ERROR) and an unsupported currency (UNSUPPORTED_CURRENCY) BEFORE any SDK call.
 * @param {object} req - The ChargeRequest.
 * @returns {{ amount: number, currency: string }} Major-unit amount and lowercase SDK currency.
 * @throws {PaymentGatewayError} On a bad amount or currency.
 * @example
 * const { amount, currency } = validateChargeRequest({ amount: 9680, currency: 'MXN' });
 */
function validateChargeRequest(req) {
  const amount = Number(req.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PaymentGatewayError(
      PaymentGatewayError.CODES.PROVIDER_ERROR,
      'Stripe checkout amount must be a positive, finite number',
      { gateway: GATEWAY_ID }
    );
  }
  const currency = String(req.currency || '').trim().toLowerCase();
  if (!SDK_CURRENCIES.includes(currency)) {
    throw new PaymentGatewayError(
      PaymentGatewayError.CODES.UNSUPPORTED_CURRENCY,
      `Stripe does not support currency "${String(req.currency)}"`,
      { gateway: GATEWAY_ID }
    );
  }
  return { amount, currency };
}

/**
 * Resolve the Checkout Session expires_at (Unix seconds). MUST be STABLE per-Payment: an idempotent replay
 * (same idempotencyKey) has to re-send params IDENTICAL to the first call, or Stripe rejects it (typ. 400
 * idempotency-key-in-use with different params). Since expires_at travels in the request BODY (not in
 * requestOptions, where the idempotencyKey lives), deriving it from Date.now() at call time would make the
 * reuse/winner replays drift and fail (council HIGH). The caller (StripeCheckoutController) therefore passes
 * a FROZEN sessionExpiresAt (ms epoch, derived once from the pending's own expiresAt); only a direct adapter
 * call without that anchor (e.g. an isolated unit test) falls back to a fresh window from now.
 * @param {object} req - The ChargeRequest.
 * @returns {number} expires_at in Unix seconds.
 */
function resolveExpiresAtSeconds(req) {
  const frozenMs = Number(req.sessionExpiresAt);
  if (Number.isFinite(frozenMs) && frozenMs > 0) return Math.floor(frozenMs / 1000);
  return Math.floor((Date.now() + SESSION_TTL_MS) / 1000);
}

/**
 * Build the Checkout Session params for a validated request (minor unit, no surcharge, card only,
 * metadata on session AND intent).
 * @param {object} req - The ChargeRequest.
 * @param {number} amount - Major-unit amount.
 * @param {string} currency - Lowercase SDK currency.
 * @returns {object} Stripe checkout.sessions.create params.
 * @example
 * const params = buildSessionParams(req, 9680, 'mxn');
 */
function buildSessionParams(req, amount, currency) {
  const metadata = {
    reservationId: String(req.reservationId || ''),
    paymentId: String(req.paymentId || ''),
  };
  if (req.reservationServiceId) metadata.reservationServiceId = String(req.reservationServiceId);

  const params = {
    mode: 'payment',
    payment_method_types: ['card'], // card tier only (plan seccion 5.2bis)
    line_items: [{
      quantity: 1,
      price_data: {
        currency,
        unit_amount: Math.round(amount * 100), // minor unit, no surcharge (plan seccion 5.2)
        product_data: { name: req.description || `Reservacion ${metadata.reservationId}` },
      },
    }],
    metadata,
    payment_intent_data: { metadata },
    // Unix seconds. CONGELADO por-Payment (sessionExpiresAt del controller), NUNCA Date.now() al momento de
    // la llamada: así un replay idempotente (reuso/winner) manda params idénticos y Stripe devuelve la sesión
    // cacheada en vez de un 400 por idempotency-key con params distintos (council HIGH). Sigue alineado al TTL
    // del pendiente local (+1 min de colchón) para que la sesión no quede cobrable horas después (council BUG B).
    expires_at: resolveExpiresAtSeconds(req),
    success_url: req.successUrl,
    cancel_url: req.cancelUrl,
  };
  if (req.customer && typeof req.customer === 'object' && req.customer.email) {
    params.customer_email = String(req.customer.email);
  }
  return params;
}

/**
 * Normalize a created Stripe session to the provider-independent ChargeResult shape.
 * @param {object} session - The Stripe Checkout Session.
 * @param {number} amount - Major-unit amount charged.
 * @param {string} isoCurrency - The MAJOR-unit ISO currency (uppercase).
 * @returns {object} { gateway, status, checkoutUrl, gatewaySessionId, gatewayIntentId, amount, currency }.
 * @example
 * mapSession(session, 9680, 'MXN');
 */
function mapSession(session, amount, isoCurrency) {
  return {
    gateway: GATEWAY_ID,
    status: 'requires_payment',
    checkoutUrl: (session && session.url) || null,
    gatewaySessionId: (session && session.id) || null,
    gatewayIntentId: toId(session && session.payment_intent),
    amount,
    currency: isoCurrency,
    // PCI-safe audit snapshot only (opaque ids + amount/currency/status): the raw SDK object is
    // never surfaced. Callers that log/persist this cannot leak last4/brand/PAN (plan seccion 8.1).
    raw: redactGatewayPayload(session),
  };
}

/**
 * Stripe gateway adapter (real Checkout Session creation).
 * @augments PaymentGatewayService
 */
class StripeAdapter extends PaymentGatewayService {
  /**
   * @param {object} [options] - Adapter options.
   * @param {object} [options.client] - Injected Stripe client (tests). When absent, the lazy
   * stripeClient singleton is used (production).
   */
  constructor(options = {}) {
    super();
    // An injected client is the test seam; production leaves it null and resolves lazily.
    this.injectedClient = options && options.client ? options.client : null;
  }

  /**
   * Resolve the Stripe client: the injected one, or the lazy production singleton.
   * @returns {object} The Stripe client.
   */
  client() {
    if (this.injectedClient) return this.injectedClient;
    return getStripeClient();
  }

  /**
   * @returns {string} The gateway id, exactly "stripe".
   */
  getId() {
    return GATEWAY_ID;
  }

  /**
   * @returns {string[]} A fresh copy of the supported currency codes.
   */
  getSupportedCurrencies() {
    return [...SUPPORTED_CURRENCIES];
  }

  /**
   * @returns {boolean} True when a client is injected or a valid environment key exists.
   */
  isConfigured() {
    if (this.injectedClient) return true;
    return isStripeConfigured();
  }

  /**
   * Build a hosted Stripe Checkout Session for a ChargeRequest and normalize the result.
   * Rejects a non-positive/NaN amount BEFORE touching the SDK; wraps any raw SDK failure in a
   * PaymentGatewayError (PROVIDER_ERROR) so a provider error vocabulary never leaks upward.
   * @param {object} chargeRequest - Normalized ChargeRequest (plan seccion 4.2).
   * @param {number} chargeRequest.amount - Amount in the MAJOR unit (already commission-inclusive).
   * @param {string} chargeRequest.currency - 'MXN' or 'USD'.
   * @param {string} chargeRequest.reservationId - Reservation the charge is tied to.
   * @param {string} chargeRequest.paymentId - The pending Payment id (metadata + idempotency anchor).
   * @param {string} chargeRequest.idempotencyKey - Per-attempt idempotency key (usually paymentId).
   * @param {number} [chargeRequest.sessionExpiresAt] - FROZEN session expiry (ms epoch) so an idempotent
   * replay re-sends identical params (council HIGH); when absent, a fresh now-based window is used.
   * @param {string} [chargeRequest.description] - Receipt description.
   * @param {object} [chargeRequest.customer] - { email } for the provider receipt.
   * @param {object} [chargeRequest.metadata] - reservationId/paymentId to recover provider-side.
   * @param {string} [chargeRequest.successUrl] - Redirect on success (UX only; webhook is truth).
   * @param {string} [chargeRequest.cancelUrl] - Redirect on cancel.
   * @returns {Promise<object>} { gateway, status, checkoutUrl, gatewaySessionId, gatewayIntentId, amount, currency }.
   * @throws {PaymentGatewayError} PROVIDER_ERROR (bad amount / SDK failure) or UNSUPPORTED_CURRENCY.
   * @example
   * await adapter.buildCheckout({ amount: 9680, currency: 'MXN', reservationId, paymentId, idempotencyKey: paymentId });
   */
  async buildCheckout(chargeRequest) {
    const req = chargeRequest && typeof chargeRequest === 'object' ? chargeRequest : {};
    const { amount, currency } = validateChargeRequest(req);

    const params = buildSessionParams(req, amount, currency);
    const requestOptions = {};
    if (req.idempotencyKey) requestOptions.idempotencyKey = String(req.idempotencyKey);

    let session;
    try {
      session = await this.client().checkout.sessions.create(params, requestOptions);
    } catch (err) {
      // Never surface a raw SDK error. Wrap ONLY the redacted message; do NOT attach the raw SDK object
      // as providerError (council PCI): a non-enumerable property is still reachable via
      // JSON.stringify(err, Object.getOwnPropertyNames(err)), which would leak last4/brand/PAN-adjacent
      // fields (charge/payment_method_details) that the SDK error may carry.
      throw new PaymentGatewayError(
        PaymentGatewayError.CODES.PROVIDER_ERROR,
        `Stripe checkout session creation failed: ${err && err.message ? err.message : 'unknown error'}`,
        { gateway: GATEWAY_ID }
      );
    }

    return mapSession(session, amount, String(req.currency || '').toUpperCase());
  }

  /**
   * Expire (cancel) a still-open Checkout Session so it can never be paid in parallel with a newer one
   * (council BUG B). Idempotent from the caller's view: if Stripe already expired/completed it, the SDK
   * rejects and this surfaces a PROVIDER_ERROR the caller treats as non-fatal. As with buildCheckout, the
   * raw SDK error is NEVER attached (only the redacted message) so no card-adjacent field can leak.
   * @param {string} sessionId - The Stripe Checkout Session id to expire.
   * @returns {Promise<object>} The expired session object from the SDK.
   * @throws {PaymentGatewayError} PROVIDER_ERROR when the SDK call fails.
   * @example
   * await adapter.expireCheckout('cs_test_123');
   */
  async expireCheckout(sessionId) {
    try {
      return await this.client().checkout.sessions.expire(String(sessionId));
    } catch (err) {
      throw new PaymentGatewayError(
        PaymentGatewayError.CODES.PROVIDER_ERROR,
        `Stripe checkout session expire failed: ${err && err.message ? err.message : 'unknown error'}`,
        { gateway: GATEWAY_ID }
      );
    }
  }

  /**
   * Contract alias: createCharge builds the hosted checkout (ChargeRequest -> ChargeResult).
   * @param {object} chargeRequest - Normalized ChargeRequest.
   * @returns {Promise<object>} The normalized checkout result.
   */
  createCharge(chargeRequest) {
    return this.buildCheckout(chargeRequest);
  }

  /**
   * @throws {PaymentGatewayError} NOT_CONFIGURED — defensive polling lands in PR6.
   */
  getCharge() {
    throw notConfigured('getCharge');
  }

  /**
   * @throws {PaymentGatewayError} NOT_CONFIGURED — refunds land in PR11.
   */
  refund() {
    throw notConfigured('refund');
  }

  /**
   * @throws {PaymentGatewayError} NOT_CONFIGURED — webhook verification lands in PR5.
   */
  verifyWebhook() {
    throw notConfigured('verifyWebhook');
  }
}

module.exports = StripeAdapter;
