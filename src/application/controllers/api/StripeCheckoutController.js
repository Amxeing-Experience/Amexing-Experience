/**
 * StripeCheckoutController - POST /api/reservations/:id/pay/checkout (internal, admin-only).
 *
 * Creates a PENDING online Payment and a hosted Stripe Checkout Session for the card balance of
 * a reservation, and returns the checkout URL. The webhook (PR5), not this endpoint, confirms the
 * money — this only opens the session (roadmap PR4). Whole endpoint gated by PAYMENTS_ENABLED.
 *
 * Money is computed SERVER-SIDE (checkoutCharge + PaymentService); any amount/currency in the body
 * is ignored (adversarial I24). No PAN/CVV/exp is ever read from the body or persisted (SAQ-A,
 * plan seccion 8.1) — this handler reads NOTHING from req.body.
 *
 * Anti-double-submit is belt-and-suspenders (plan seccion 6.3): an in-process withReservationLock
 * fast-path for the common double-click, plus the DB partial-unique index (seed 028) that makes at
 * most one pending online Payment per reservation atomic even across PM2 workers. A non-expired
 * pending is reused (same session via the paymentId idempotency key); an expired one is retired
 * (never counted, so no recalculate) so a fresh one can be created without hitting the index.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');
const Payment = require('../../../domain/models/Payment');
const Reservation = require('../../../domain/models/Reservation');
const PaymentService = require('../../services/PaymentService');
const PaymentController = require('./PaymentController');
const { resolveCheckoutCharge } = require('../../services/payments/checkoutCharge');
const GatewayRouter = require('../../services/payments/GatewayRouter');
const PaymentGatewayError = require('../../services/payments/PaymentGatewayError');
const { getGatewayRegistry, decodeGatewayCode } = require('../../services/payments/gatewayBootstrap');
const SettingsService = require('../../services/SettingsService');
const { withReservationLock } = require('../../../infrastructure/concurrency/reservationLock');
const { atomicRetirePayment } = require('../../../infrastructure/payments/paymentAtomicStore');

// A pending online Payment lives 30 min (aligned with a Checkout Session; the TTL sweep is PR6).
const PENDING_TTL_MS = 30 * 60 * 1000;
// The Checkout Session outlives the local pending by this cushion so that, at CREATION, its expires_at
// clears Stripe's now+30min hard minimum (createdAt≈now => pending expiresAt=now+30min => session=now+33min).
// 3 min, not 1: the pending is stamped BEFORE the network work, and the worst case between the stamp and the
// session create is payment.save() plus the SDK's own budget (MAX_NETWORK_RETRIES=2 => up to 3 attempts ×
// REQUEST_TIMEOUT_MS=20s ≈ 60s), which would eat a 1-min cushion exactly when the retry should have saved the
// call. The only cost of the wider cushion is that an orphan session (nobody reclaims it) auto-expires in
// Stripe a couple of minutes later — still self-healing and far under Stripe's 24h default. It does NOT
// reopen the double-session bug: retirePending still expires the old session in Stripe before a new one.
// This session expiry is FROZEN per-Payment (see frozenSessionExpiresAt), never Date.now(), so an idempotent
// replay re-sends identical params and Stripe returns the cached session (council HIGH).
const SESSION_EXPIRY_CUSHION_MS = 3 * 60 * 1000;
// The toggle Setting stores a numeric code; 0 = 'stripe' is the safe default.
const GATEWAY_SETTING_KEY = 'activePaymentGateway';

/**
 * StripeCheckoutController - opens hosted Checkout Sessions for the internal (staff) flow.
 */
class StripeCheckoutController {
  /**
   * Find the current non-soft-deleted pending online Payment for a reservation, if any.
   * @param {string} reservationId - Reservation objectId.
   * @returns {Promise<object|null>} The pending Payment, or null.
   * @example
   * const p = await StripeCheckoutController.findPendingOnline(id);
   */
  static async findPendingOnline(reservationId) {
    const reservationPtr = new Reservation();
    reservationPtr.id = reservationId;
    const query = new Parse.Query('Payment');
    query.equalTo('reservationPtr', reservationPtr);
    query.equalTo('channel', 'online');
    query.equalTo('gatewayStatus', 'requires_payment');
    query.equalTo('exists', true);
    query.descending('createdAt');
    return query.first({ useMasterKey: true });
  }

  /**
   * @param {object} payment - Payment object.
   * @returns {boolean} True when the pending has passed its expiresAt.
   */
  static isExpired(payment) {
    const exp = payment.getExpiresAt && payment.getExpiresAt();
    return !!exp && new Date(exp).getTime() < Date.now();
  }

  /**
   * Whether a pending's FROZEN amount/currency still matches the freshly computed charge (council BUG C).
   * A pending is safe to reuse only if its origAmount/origCurrency (snapshotted when it was created) still
   * equals the current balance; otherwise (e.g. a manual payment landed in the 30-min window and lowered
   * the balance) reusing it would charge the stale, higher amount. Cent tolerance on the amount; exact
   * currency match.
   * @param {object} payment - The existing pending Payment.
   * @param {object} charge - The freshly resolved charge ({ origAmount, currency }).
   * @returns {boolean} True when the pending may be reused as-is.
   * @example
   * StripeCheckoutController.pendingMatchesCharge(pending, { origAmount: 9680, currency: 'MXN' });
   */
  static pendingMatchesCharge(payment, charge) {
    // No charge context (unreachable today: both callers always pass one). Fail CLOSED — on a money path the
    // safe default with no context is "do not reuse", never "reuse whatever is there".
    if (!charge) return false;
    const prevAmount = Number(payment.getOrigAmount());
    const nextAmount = Number(charge.origAmount);
    if (!Number.isFinite(prevAmount) || !Number.isFinite(nextAmount)) return false;
    const prevCurrency = String(payment.getOrigCurrency() || '').toUpperCase();
    const nextCurrency = String(charge.currency || '').toUpperCase();
    return prevCurrency === nextCurrency && Math.abs(prevAmount - nextAmount) <= 0.01;
  }

  /**
   * Retire a pending online Payment: close its Stripe Checkout Session (so it can never be paid in
   * parallel with a fresh one), mark it terminal ('expired'), and soft-delete it. Expiring the remote
   * session is best-effort: if Stripe already expired/completed it, that is logged and NON-fatal (council
   * BUG B). Reused both when replacing an expired/stale pending and when rolling back a provider failure.
   *
   * The local retirement is ONE conditional write (atomicRetirePayment), never the old
   * setGatewayStatus('expired') + softDelete() pair. That pair was a fetch-then-save across a network
   * call: while expireCheckout was in flight the webhook could confirm this very row, and the save
   * would then push a real 'succeeded' charge back to 'expired' + exists:false — money the rollup can
   * no longer see, and the exact reason the "stranded money" runbook query was not exact before. With
   * the guard inside the write, a row that has already been confirmed simply matches nothing, which is
   * treated as SUCCESS: there is no pending left to retire. Never a retry, never a throw.
   * @param {object} payment - The pending Payment to retire.
   * @param {object} adapter - The resolved gateway adapter (must expose expireCheckout).
   * @returns {Promise<boolean>} True when this call actually retired the row; false when it had
   * already moved past 'requires_payment' (a clean no-op).
   * @example
   * await StripeCheckoutController.retirePending(existing, adapter);
   */
  static async retirePending(payment, adapter) {
    const sessionId = payment.getGatewaySessionId && payment.getGatewaySessionId();
    if (sessionId && adapter && typeof adapter.expireCheckout === 'function') {
      // Best-effort: one bounded retry absorbs a transient provider blip (never a loop). If it still fails,
      // the residual is small and self-healing: the FROZEN expires_at (council HIGH) auto-expires the orphan
      // Stripe session in ~31 min, and no money moves until the webhook (PR5); the definitive sweep is PR6.
      try {
        await adapter.expireCheckout(sessionId);
      } catch (firstErr) {
        try {
          await adapter.expireCheckout(sessionId);
        } catch (expireErr) {
          // Already expired/consumed in Stripe, or a persistent provider error: never block the retirement.
          logger.warn('Could not expire old Stripe checkout session on retirement after one retry (non-fatal, session auto-expires in ~31 min)', {
            sessionId, error: expireErr && expireErr.message,
          });
        }
      }
    }

    const { matchedCount } = await atomicRetirePayment(payment.id);
    if (matchedCount === 0) {
      logger.info('Pending online Payment was no longer pending at retirement time (already confirmed or retired); nothing was rewritten', {
        paymentId: payment.id,
      });
      return false;
    }
    return true;
  }

  /**
   * Resolve the MXN amount + FX rate for the pending, preferring the reservation's FROZEN
   * exchangeRateSnapshot over the live rate (council LOW): the rest of the reservation's balance
   * (PaymentService.loadAndCompute) is measured against that frozen snapshot, so the online pending's
   * Payment.amount must use the same rate to stay consistent. Falls back to the live rate (PaymentController.toMXN)
   * only for a missing/corrupt snapshot (legacy reservations), matching loadAndCompute's policy.
   * @param {object} reservation - The reservation (carries exchangeRateSnapshot).
   * @param {number} origAmount - Charge amount in the reservation currency.
   * @param {string} origCurrency - Reservation currency (MXN|USD).
   * @returns {Promise<{amountMXN:number, rate:number}>} MXN amount and the rate used.
   * @example
   * const { amountMXN, rate } = await StripeCheckoutController.resolveAmountMXN(reservation, 100, 'USD');
   */
  static async resolveAmountMXN(reservation, origAmount, origCurrency) {
    if (String(origCurrency).toUpperCase() === 'MXN') return { amountMXN: origAmount, rate: 1 };
    const snapshot = Number(reservation.get('exchangeRateSnapshot'));
    if (Number.isFinite(snapshot) && snapshot > 0) {
      return { amountMXN: Math.round(origAmount * snapshot * 100) / 100, rate: snapshot };
    }
    // Legacy/corrupt snapshot: same fallback as PaymentService.loadAndCompute (live rate).
    return PaymentController.toMXN(origAmount, origCurrency);
  }

  /**
   * The FROZEN Checkout Session expires_at (ms epoch) for a pending, derived from its OWN expiresAt (set
   * once in buildPendingPayment), NEVER from Date.now(). Passing this to buildCheckout keeps an idempotent
   * replay's params byte-identical so Stripe returns the cached session instead of a 400 idempotency
   * mismatch (council HIGH). On a reuse ~29 min after creation the value can sit only ~1-2 min ahead of now;
   * that is CORRECT — for a matching idempotencyKey Stripe returns the cached session WITHOUT re-checking its
   * now+30min minimum, it only compares params. A legacy pending without expiresAt anchors on createdAt so
   * the value is still stable per-Payment.
   * @param {object} payment - The pending Payment (carries expiresAt/createdAt).
   * @returns {number} The frozen session expiry, ms epoch.
   * @example
   * StripeCheckoutController.frozenSessionExpiresAt(pending);
   */
  static frozenSessionExpiresAt(payment) {
    const exp = payment.getExpiresAt && payment.getExpiresAt();
    const expMs = exp ? new Date(exp).getTime() : NaN;
    if (Number.isFinite(expMs)) return expMs + SESSION_EXPIRY_CUSHION_MS;
    const createdMs = payment.createdAt ? new Date(payment.createdAt).getTime() : Date.now();
    return createdMs + PENDING_TTL_MS + SESSION_EXPIRY_CUSHION_MS;
  }

  /**
   * Build (or, via idempotency, re-fetch) the Checkout Session for a pending Payment and persist
   * the session/intent ids on it. Uses the payment id as the idempotency key so a retry returns
   * the SAME session (no double session, no double charge).
   * @param {object} payment - The pending Payment.
   * @param {object} reservation - The reservation (for id/folio).
   * @param {object} adapter - The resolved gateway adapter.
   * @returns {Promise<object>} The normalized checkout result.
   * @example
   * const r = await StripeCheckoutController.buildChargeAndSave(payment, reservation, adapter);
   */
  static async buildChargeAndSave(payment, reservation, adapter) {
    const reservationId = reservation.id;
    const baseUrl = process.env.APP_BASE_URL || 'http://localhost:1337';
    const metadata = { reservationId, paymentId: payment.id };
    const result = await adapter.buildCheckout({
      amount: payment.getOrigAmount(),
      currency: payment.getOrigCurrency(),
      reservationId,
      paymentId: payment.id,
      idempotencyKey: payment.id,
      // FROZEN per-Payment (never Date.now()) so the reuse/winner replays send identical params (council HIGH).
      sessionExpiresAt: StripeCheckoutController.frozenSessionExpiresAt(payment),
      description: `Reservación ${reservation.get('folio') || reservationId}`,
      metadata,
      // Redirect targets are UX only (the webhook is the source of truth) and are derived from
      // server config, NEVER from the client body (adversarial I24).
      successUrl: `${baseUrl}/api/reservations/${reservationId}/pay/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/api/reservations/${reservationId}/pay/cancel`,
    });

    if (result.gatewaySessionId) payment.setGatewaySessionId(result.gatewaySessionId);
    if (result.gatewayIntentId) payment.setGatewayIntentId(result.gatewayIntentId);
    await payment.save(null, { useMasterKey: true });
    return result;
  }

  /**
   * Resolve which gateway processes the charge for a currency, honoring the toggle (USD forces
   * Stripe; MXN honors the toggle with a Stripe fallback — plan seccion 4.5).
   * @param {string} currency - 'MXN' or 'USD'.
   * @returns {Promise<object>} The resolved adapter instance.
   * @example
   * const adapter = await StripeCheckoutController.resolveGateway('USD');
   */
  static async resolveGateway(currency) {
    const registry = getGatewayRegistry();
    const router = new GatewayRouter(registry);
    const code = await new SettingsService().getNumericValue(GATEWAY_SETTING_KEY, 0);
    const toggle = decodeGatewayCode(code);
    return router.resolve(currency, toggle);
  }

  /**
   * Instantiate the pending online Payment (not yet saved).
   * @param {object} ctx - Build context.
   * @param {object} ctx.reservation - The reservation.
   * @param {string} ctx.gatewayId - Resolved gateway id.
   * @param {object} ctx.charge - Resolved charge ({ origAmount }).
   * @param {string} ctx.origCurrency - Original currency (MXN|USD).
   * @param {number} ctx.amountMXN - Amount in MXN (rollup base).
   * @param {number} ctx.rate - FX snapshot rate.
   * @param {object} ctx.req - Express request (for registeredBy).
   * @returns {object} The unsaved Payment.
   * @example
   * const p = StripeCheckoutController.buildPendingPayment(ctx);
   */
  static buildPendingPayment({
    reservation, gatewayId, charge, origCurrency, amountMXN, rate, req,
  }) {
    const payment = new Payment();
    payment.setReservationPtr(reservation);
    payment.setChannel('online');
    payment.setGateway(gatewayId);
    payment.setGatewayStatus('requires_payment');
    payment.setMethod('tarjeta');
    payment.setOrigAmount(charge.origAmount);
    payment.setOrigCurrency(origCurrency);
    payment.setExchangeRate(rate);
    payment.setAmount(amountMXN);
    payment.setExpiresAt(new Date(Date.now() + PENDING_TTL_MS));
    payment.setRegisteredBy(req.user);
    payment.set('active', true);
    payment.set('exists', true);
    return payment;
  }

  /**
   * Reuse a non-expired pending, retire an expired one, or create a fresh pending, then open its
   * Checkout Session. Runs inside withReservationLock (fast-path); the DB unique index (seed 028)
   * is the cross-process belt, caught here as DUPLICATE_VALUE and turned into a reuse.
   * @param {object} ctx - Same context as buildPendingPayment plus { adapter }.
   * @returns {Promise<object>} { checkoutUrl, paymentId, reused }.
   * @example
   * await StripeCheckoutController.createOrReusePending(ctx);
   */
  static async createOrReusePending(ctx) {
    const {
      reservation, adapter, charge,
    } = ctx;
    const reservationId = reservation.id;

    // Fast-path: reuse a non-expired pending ONLY if its frozen amount/currency still matches the current
    // charge; otherwise (expired, OR the balance drifted in the 30-min window) retire it — expiring its
    // Stripe session so two sessions are never chargeable at once (council BUG B) — and create a fresh,
    // correctly-priced pending (council BUG C). Retiring also frees the partial unique index.
    const existing = await StripeCheckoutController.findPendingOnline(reservationId);
    if (existing) {
      if (!StripeCheckoutController.isExpired(existing)
        && StripeCheckoutController.pendingMatchesCharge(existing, charge)) {
        const r = await StripeCheckoutController.buildChargeAndSave(existing, reservation, adapter);
        return { checkoutUrl: r.checkoutUrl, paymentId: existing.id, reused: true };
      }
      // Never counted in the rollup -> no recalculate needed on retirement.
      await StripeCheckoutController.retirePending(existing, adapter);
    }

    const payment = StripeCheckoutController.buildPendingPayment(ctx);
    try {
      await payment.save(null, { useMasterKey: true });
    } catch (saveErr) {
      // Cross-process race: another worker won the unique-index create. Reuse/re-price the winner.
      if (saveErr && saveErr.code === Parse.Error.DUPLICATE_VALUE) {
        return StripeCheckoutController.resolveWinner(ctx);
      }
      throw saveErr;
    }

    try {
      const r = await StripeCheckoutController.buildChargeAndSave(payment, reservation, adapter);
      return { checkoutUrl: r.checkoutUrl, paymentId: payment.id, reused: false };
    } catch (providerErr) {
      // Roll back the just-created pending so it never blocks a retry: expire any session that WAS
      // created before the failure and leave it terminal ('expired'), not the half-open
      // 'requires_payment' the old rollback left behind (council BUG B + LOW consistency).
      // retirePending already swallows+logs its own expireCheckout failures, so the only thing that can
      // escape here is a failed conditional write — which leaves the pending alive (requires_payment +
      // exists:true) blocking the partial unique index until the TTL sweep picks it up. Log it (never
      // silence it); the flow is unchanged: the original providerErr is what propagates.
      await StripeCheckoutController.retirePending(payment, adapter).catch((retireErr) => {
        logger.warn('Rollback of a just-created online pending failed; it may block new checkouts for this reservation until the TTL sweep', {
          reservationId,
          paymentId: payment.id,
          error: retireErr && retireErr.message,
        });
      });
      throw providerErr;
    }
  }

  /**
   * A retryable conflict: the anti-double-submit unique index blocked us and, after a single bounded
   * retry, no correctly-priced pending could be established (sustained cross-worker contention). Surfaced
   * as a 409 the caller can simply retry (it will then find/reuse the settled pending), never an infinite
   * loop against the index.
   * @returns {Error} The tagged conflict error.
   * @example
   * throw StripeCheckoutController.checkoutConflict();
   */
  static checkoutConflict() {
    const err = new Error('Concurrent online checkout creation conflict for this reservation');
    err.checkoutConflict = true;
    return err;
  }

  /**
   * Resolve the cross-worker winner of the unique-index race (reached only from a DUPLICATE_VALUE on our
   * own create). The winner is reused ONLY if its FROZEN amount/currency still matches the current charge
   * (council MEDIUM: a manual payment could have landed between our balance read and the winner's create,
   * leaving it over-priced) — the SAME pendingMatchesCharge gate the normal reuse path applies. A stale
   * winner is retired (freeing the index) and a fresh, correctly-priced pending is created, bounded to a
   * SINGLE re-create retry: a second DUPLICATE_VALUE reuses a matching contender or, failing that, returns
   * a clear 409 — never a loop against the index.
   * @param {object} ctx - Same build context as createOrReusePending ({ reservation, adapter, req, charge, ... }).
   * @returns {Promise<object>} { checkoutUrl, paymentId, reused }.
   * @example
   * await StripeCheckoutController.resolveWinner(ctx);
   */
  static async resolveWinner(ctx) {
    const {
      reservation, adapter, charge,
    } = ctx;
    const reservationId = reservation.id;

    const winner = await StripeCheckoutController.findPendingOnline(reservationId);
    if (!winner) throw StripeCheckoutController.checkoutConflict();

    if (StripeCheckoutController.pendingMatchesCharge(winner, charge)) {
      const r = await StripeCheckoutController.buildChargeAndSave(winner, reservation, adapter);
      return { checkoutUrl: r.checkoutUrl, paymentId: winner.id, reused: true };
    }

    // Stale winner (balance drifted): retire it (frees the unique index) and re-price a fresh pending.
    await StripeCheckoutController.retirePending(winner, adapter);
    const fresh = StripeCheckoutController.buildPendingPayment(ctx);
    try {
      await fresh.save(null, { useMasterKey: true });
    } catch (retryErr) {
      if (retryErr && retryErr.code === Parse.Error.DUPLICATE_VALUE) {
        // Another worker slipped a pending in after our retire. Reuse it if correctly priced; otherwise a
        // clear 409 (NO further retry -> no unbounded loop against the index).
        const contender = await StripeCheckoutController.findPendingOnline(reservationId);
        if (contender && StripeCheckoutController.pendingMatchesCharge(contender, charge)) {
          const r = await StripeCheckoutController.buildChargeAndSave(contender, reservation, adapter);
          return { checkoutUrl: r.checkoutUrl, paymentId: contender.id, reused: true };
        }
        throw StripeCheckoutController.checkoutConflict();
      }
      throw retryErr;
    }
    const r = await StripeCheckoutController.buildChargeAndSave(fresh, reservation, adapter);
    return { checkoutUrl: r.checkoutUrl, paymentId: fresh.id, reused: false };
  }

  /**
   * POST /api/reservations/:id/pay/checkout — open a hosted card Checkout Session.
   * @param {object} req - Express request (JWT-authenticated; body is ignored on purpose).
   * @param {object} res - Express response.
   * @returns {Promise<object>} JSON { success:true, data:{ checkoutUrl } }.
   * @example
   * POST /api/reservations/abc123/pay/checkout
   */
  static async createCheckout(req, res) {
    // Master feature flag: strict === 'true' (same convention as GOOGLE_OAUTH_ENABLED). OFF => 503,
    // creating nothing and never touching the SDK.
    if (process.env.PAYMENTS_ENABLED !== 'true') {
      return res.status(503).json({ success: false, error: 'El cobro en línea no está habilitado.' });
    }

    const { id } = req.params;
    try {
      const reservation = await PaymentController.loadReservation(id, req);
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      // Server-side money: reuse PaymentService.loadAndCompute (service mapping + rollup filter +
      // adjustments/tip + counting-only payment rows) and the pure charge resolver.
      const computed = await PaymentService.loadAndCompute(id);
      const charge = resolveCheckoutCharge({
        status: reservation.get('status'),
        paymentType: computed.paymentType,
        currency: computed.currency,
        serviceItems: computed.serviceItems,
        paymentRows: computed.paymentRows,
        adjustmentsNet: computed.totals.adjustments,
        reservationTip: computed.totals.tip,
      });
      if (!charge.ok) {
        return res.status(charge.httpStatus || 422).json({ success: false, error: charge.error });
      }

      const origCurrency = charge.currency;
      // FX consistency (council LOW): use the reservation's FROZEN exchangeRateSnapshot (the same rate the
      // rest of its balance is measured against), falling back to the live rate only for a missing/corrupt
      // snapshot — so the online pending's Payment.amount never drifts from the reservation balance.
      const { amountMXN, rate } = await StripeCheckoutController.resolveAmountMXN(
        reservation,
        charge.origAmount,
        origCurrency
      );

      const adapter = await StripeCheckoutController.resolveGateway(origCurrency);
      const gatewayId = adapter.getId();
      // A resolved-but-unconfigured gateway => 503 (controlled, no charge) rather than a raw failure.
      if (!adapter.isConfigured()) {
        throw new PaymentGatewayError(
          PaymentGatewayError.CODES.NOT_CONFIGURED,
          `Gateway ${gatewayId} is not configured`,
          { gateway: gatewayId }
        );
      }

      // Belt-and-suspenders anti-double-submit: in-process lock (fast-path) wraps the create; the DB
      // unique index (seed 028) is the cross-process belt, handled inside createOrReusePending.
      const outcome = await withReservationLock(id, () => StripeCheckoutController.createOrReusePending({
        reservation, adapter, gatewayId, charge, origCurrency, amountMXN, rate, req,
      }));

      logger.info('Online checkout session created', {
        reservationId: id,
        paymentId: outcome.paymentId,
        gateway: gatewayId,
        origCurrency,
        origAmount: charge.origAmount,
        reused: outcome.reused,
        performedBy: req.userId,
      });

      return res.json({ success: true, data: { checkoutUrl: outcome.checkoutUrl } });
    } catch (error) {
      // Bounded cross-worker contention on the anti-double-submit index (council MEDIUM): retryable, no money
      // moved. 409 so the client just retries and reuses the settled pending — never an index loop.
      if (error && error.checkoutConflict) {
        logger.warn('Online checkout conflict after bounded retry', { reservationId: id, performedBy: req.userId });
        return res.status(409).json({ success: false, error: 'Otro cobro en línea se está creando para esta reservación. Intenta de nuevo.' });
      }
      if (error instanceof PaymentGatewayError) {
        if (error.code === PaymentGatewayError.CODES.NOT_CONFIGURED) {
          return res.status(503).json({ success: false, error: 'El cobro en línea no está disponible en este momento.' });
        }
        if (error.code === PaymentGatewayError.CODES.UNSUPPORTED_CURRENCY) {
          return res.status(422).json({ success: false, error: 'Moneda no soportada para el cobro en línea.' });
        }
        // PROVIDER_ERROR and anything else normalized: the message is already PAN-redacted.
        logger.error('Stripe checkout provider error', { reservationId: id, code: error.code, message: error.message });
        return res.status(502).json({ success: false, error: 'No se pudo iniciar el cobro con la pasarela. Intenta de nuevo.' });
      }
      logger.error('Error creating stripe checkout', { reservationId: id, error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Error al iniciar el cobro en línea' });
    }
  }
}

// The TTL sweep must measure its threshold against the SAME two numbers this controller stamps on a
// pending, not against a second copy of them: a sweep that used a shorter cushion would retire a
// pending whose Checkout Session is still payable in Stripe.
StripeCheckoutController.PENDING_TTL_MS = PENDING_TTL_MS;
StripeCheckoutController.SESSION_EXPIRY_CUSHION_MS = SESSION_EXPIRY_CUSHION_MS;

module.exports = StripeCheckoutController;
