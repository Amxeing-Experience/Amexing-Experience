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

// A pending online Payment lives 30 min (aligned with a Checkout Session; the TTL sweep is PR6).
const PENDING_TTL_MS = 30 * 60 * 1000;
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
      reservation, adapter, req,
    } = ctx;
    const reservationId = reservation.id;

    // Fast-path: reuse a non-expired pending; retire an expired one so the unique index frees up.
    const existing = await StripeCheckoutController.findPendingOnline(reservationId);
    if (existing) {
      if (!StripeCheckoutController.isExpired(existing)) {
        const r = await StripeCheckoutController.buildChargeAndSave(existing, reservation, adapter);
        return { checkoutUrl: r.checkoutUrl, paymentId: existing.id, reused: true };
      }
      // Expired pending never counted in the rollup -> no recalculate needed on retirement.
      existing.setGatewayStatus('expired');
      await existing.softDelete(req.userId);
    }

    const payment = StripeCheckoutController.buildPendingPayment(ctx);
    try {
      await payment.save(null, { useMasterKey: true });
    } catch (saveErr) {
      // Cross-process race: another worker won the unique-index create. Reuse the winner.
      if (saveErr && saveErr.code === Parse.Error.DUPLICATE_VALUE) {
        const winner = await StripeCheckoutController.findPendingOnline(reservationId);
        if (winner) {
          const r = await StripeCheckoutController.buildChargeAndSave(winner, reservation, adapter);
          return { checkoutUrl: r.checkoutUrl, paymentId: winner.id, reused: true };
        }
      }
      throw saveErr;
    }

    try {
      const r = await StripeCheckoutController.buildChargeAndSave(payment, reservation, adapter);
      return { checkoutUrl: r.checkoutUrl, paymentId: payment.id, reused: false };
    } catch (providerErr) {
      // Roll back the just-created pending so it never blocks a retry (TTL sweep is PR6).
      await payment.softDelete(req.userId).catch(() => {});
      throw providerErr;
    }
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
      // Reuse the exact FX snapshot mechanism of the manual flow (no reimplementation).
      const { amountMXN, rate } = await PaymentController.toMXN(charge.origAmount, origCurrency);

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

module.exports = StripeCheckoutController;
