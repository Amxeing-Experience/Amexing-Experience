/**
 * StripeReturnController - GET /api/reservations/:id/pay/success (PUBLIC; Stripe redirects the
 * payer's browser here and that browser carries no Authorization header).
 *
 * Defensive polling: the webhook confirms the overwhelming majority of charges, but a delivery can
 * be lost, delayed for minutes, or arrive after the payer is already looking at this page. This
 * endpoint is the second chance — it ASKS Stripe about the session the browser brought and, if the
 * money really cleared, applies the exact same confirmation the webhook would have (the shared
 * paymentConfirmation core, never a private copy of it).
 *
 * Three rules make a public, unauthenticated money endpoint safe to have.
 *
 * ONE — the confirmation is never gated by PAYMENTS_ENABLED. The flag decides whether a NEW charge
 * may be started, not whether an EXISTING one is real: money that already moved has to be recorded
 * whatever the flag says. Same criterion as the webhook.
 *
 * TWO — a LOCAL funnel runs before any outgoing call: the shape of the session id, then the local
 * row (queryAll, so a soft-deleted row is still found), then ownership against the :id in the URL.
 * Only what survives all three reaches the network, so nobody can make this endpoint hammer Stripe
 * with arbitrary ids. The final cut is derived from allowedSourceStatuses('succeeded') and NOT from
 * a private list of "terminal" statuses — a 'failed' row is not terminal (a declined card leaves the
 * session open and the payer retries on it), and neither the TTL sweep nor the reconciliation ever
 * looks at a failed row, so this endpoint is its only remaining safety net.
 *
 * THREE — it only ever WRITES the 'succeeded' destination. Any other answer from Stripe is read-only
 * here. Letting an anonymous route move a live row to 'failed'/'expired' would hide it from
 * findPendingOnline and turn the orphan-session bug into an anonymous double-charge trigger.
 *
 * The response is always the same generic message with the same status, in every branch: success,
 * anomaly, unknown session, provider error. Any variation would turn this into an oracle for probing
 * other reservations' payment state.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const logger = require('../../../infrastructure/logger');
const BaseModel = require('../../../domain/models/BaseModel');
const StripeAdapter = require('../../services/payments/gateways/StripeAdapter');
const { canStillReachSucceeded } = require('../../services/payments/stripeCheckoutStatus');
const { applyConfirmation } = require('../../services/payments/paymentConfirmation');

// Stripe Checkout Session ids are cs_test_.../cs_live_... — opaque, alphanumeric, and nowhere near
// this long. The cap is what keeps a megabyte of junk out of the logs and out of a Parse query.
const SESSION_ID_PATTERN = /^cs_[A-Za-z0-9_]{1,180}$/;

// The one answer this endpoint gives, no matter what happened behind it.
const GENERIC_MESSAGE = 'Pago recibido, en confirmación. La reservación se actualiza automáticamente en cuanto la pasarela confirme el cobro.';

let cachedAdapter = null;

/**
 * The Stripe adapter used for the lookup (lazy singleton; it resolves its SDK client on each call,
 * so a test-injected client is always honored).
 * @returns {object} The StripeAdapter instance.
 */
function stripeAdapter() {
  if (!cachedAdapter) cachedAdapter = new StripeAdapter();
  return cachedAdapter;
}

/**
 * StripeReturnController - the payer's return from hosted Checkout, with real effects.
 */
class StripeReturnController {
  /**
   * The only response shape this endpoint produces.
   * @param {object} res - Express response.
   * @returns {object} The Express response.
   */
  static generic(res) {
    return res.json({ success: true, message: GENERIC_MESSAGE });
  }

  /**
   * Validate the shape of the session id WITHOUT ever echoing it.
   *
   * Anything a stranger can put in a query string is something a stranger can put in our logs, so
   * only its length and whether it matched are recorded — never the value.
   * @param {*} raw - The raw session_id query parameter.
   * @returns {(string|null)} The usable session id, or null.
   * @example
   * StripeReturnController.parseSessionId(req.query.session_id);
   */
  static parseSessionId(raw) {
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    return SESSION_ID_PATTERN.test(value) ? value : null;
  }

  /**
   * Find the Payment that owns this Checkout Session.
   *
   * queryAll, never queryExisting: a row the TTL sweep already retired is exactly the case this
   * endpoint has to be able to confirm and revive, and it would be invisible to an exists:true query.
   * @param {string} sessionId - The validated Checkout Session id.
   * @returns {Promise<(object|null)>} The Payment, or null.
   * @example
   * const payment = await StripeReturnController.findBySession('cs_test_123');
   */
  static async findBySession(sessionId) {
    const query = BaseModel.queryAll('Payment');
    query.equalTo('gatewaySessionId', sessionId);
    query.descending('createdAt');
    const payment = await query.first({ useMasterKey: true });
    return payment || null;
  }

  /**
   * Whether this Payment really belongs to the reservation in the URL.
   *
   * Checked LOCALLY and BEFORE the network call, so a stranger's session id never buys an outgoing
   * request, and re-checked against the metadata Stripe returns afterwards (see handle): both
   * sources have to agree, because either one alone could be the forged half.
   * @param {object} payment - The located Payment.
   * @param {string} reservationId - The :id from the URL.
   * @returns {boolean} True when the row belongs to that reservation.
   * @example
   * StripeReturnController.belongsToReservation(payment, req.params.id);
   */
  static belongsToReservation(payment, reservationId) {
    const ptr = payment.getReservationPtr && payment.getReservationPtr();
    return !!ptr && !!ptr.id && ptr.id === reservationId;
  }

  /**
   * The fields worth persisting alongside the confirmation, when Stripe reported them.
   *
   * Deliberately NOT amount/origAmount/origCurrency: a discrepancy is reported, never silently
   * "corrected". Correcting a charge is a refund authorized by Amexing (PR11), not a job's or an
   * anonymous endpoint's decision.
   * @param {object} charge - The normalized getCharge result.
   * @returns {object} Extra fields for the atomic write.
   * @example
   * StripeReturnController.persistableFields(charge); // { gatewayChargeId: 'ch_1' }
   */
  static persistableFields(charge) {
    const extra = {};
    if (charge.gatewayChargeId) extra.gatewayChargeId = charge.gatewayChargeId;
    if (charge.gatewayIntentId) extra.gatewayIntentId = charge.gatewayIntentId;
    return extra;
  }

  /**
   * GET /api/reservations/:id/pay/success — confirm from the browser's return, defensively.
   * @param {object} req - Express request (public: no JWT, no roles).
   * @param {object} res - Express response.
   * @returns {Promise<object>} Always the same generic JSON.
   * @example
   * GET /api/reservations/abc123/pay/success?session_id=cs_test_456
   */
  static async handle(req, res) {
    const reservationId = req.params.id;
    const sessionId = StripeReturnController.parseSessionId(req.query && req.query.session_id);
    if (!sessionId) {
      // warn, not error: this is a channel any anonymous caller can fill at will.
      logger.warn('Payment return visited without a usable session_id (nothing was read or written)', {
        reservationId, sessionIdLength: typeof (req.query && req.query.session_id) === 'string' ? req.query.session_id.length : 0,
      });
      return StripeReturnController.generic(res);
    }

    try {
      const payment = await StripeReturnController.findBySession(sessionId);
      if (!payment || !StripeReturnController.belongsToReservation(payment, reservationId)) {
        logger.warn('Payment return could not be correlated to a Payment of this reservation (nothing modified)', {
          reservationId, found: !!payment,
        });
        return StripeReturnController.generic(res);
      }

      // The local cut, derived from the shared allowlist: if no confirmation could legally apply to
      // this row any more, the answer is already in our database and Stripe is not called at all.
      // That is what keeps a payer refreshing this page from generating one API call per refresh.
      const localStatus = payment.getGatewayStatus && payment.getGatewayStatus();
      if (!canStillReachSucceeded(localStatus)) {
        return StripeReturnController.generic(res);
      }

      const charge = await stripeAdapter().getCharge({ gatewaySessionId: sessionId });

      // Second half of the ownership check: what Stripe itself says this session was created for.
      // Both sources must agree with the URL; either one alone could be the forged half.
      const meta = charge.metadata || {};
      if (meta.reservationId !== reservationId || meta.paymentId !== payment.id) {
        logger.error('Payment return: the session Stripe returned does not correlate with the local Payment/reservation (anomaly, nothing modified)', {
          reservationId, paymentId: payment.id,
        });
        return StripeReturnController.generic(res);
      }

      // Read-only for everything except the money: this route may confirm a charge, never fail one.
      if (!charge.ok || charge.gatewayStatus !== 'succeeded') {
        return StripeReturnController.generic(res);
      }

      if (process.env.PAYMENTS_ENABLED !== 'true') {
        logger.warn('Confirming a real gateway charge while PAYMENTS_ENABLED is off: the flag gates STARTING a charge, never recording one that already moved', {
          reservationId, paymentId: payment.id,
        });
      }

      await applyConfirmation({
        payment,
        destination: { gatewayStatus: charge.gatewayStatus, crossesThreshold: charge.crossesThreshold },
        source: 'polling',
        extraSet: StripeReturnController.persistableFields(charge),
        logContext: { reservationId },
      });
      return StripeReturnController.generic(res);
    } catch (err) {
      // Never a 500 and never a different body: the payer sees the same page either way, and a
      // failure here is recoverable by the webhook, the reconciliation job, or the next visit.
      logger.error('Payment return processing failed (the webhook and the reconciliation job remain as the confirmation path)', {
        reservationId, error: err && err.message,
      });
      return StripeReturnController.generic(res);
    }
  }
}

module.exports = StripeReturnController;
