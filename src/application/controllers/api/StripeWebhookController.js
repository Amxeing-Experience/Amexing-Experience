/**
 * StripeWebhookController - POST /api/webhooks/stripe (public route; the SIGNATURE is the only auth).
 *
 * Closes the loop PR4 opened: PR4 creates a pending online Payment and hands the payer a hosted
 * Checkout Session, but nothing in the CRM ever learns whether the card actually cleared. This handler
 * is that authoritative confirmation — NOT the browser redirect, which the payer can skip, forge, or
 * simply close before it fires.
 *
 * Two independent idempotency layers, because they defend against different things.
 * Capa A (GatewayEvent + its UNIQUE (gateway,eventId) index) answers "we already saw THIS event": it is
 * written insert-first and catches the duplicate, never check-then-insert, so two simultaneous
 * deliveries of the same event are separated by the database, not by a query both could pass.
 * Capa B (conditional update on Payment, paymentAtomicStore) answers "this Payment may still move": two
 * DIFFERENT legitimate events (checkout.session.completed and payment_intent.succeeded both mean
 * 'succeeded' and both carry the same paymentId) each clear Capa A, so only an atomic filter on the
 * current status can decide which one truly transitions the money — and therefore which one, exactly
 * one, triggers PaymentService.recalculate.
 *
 * Status codes are a protocol with Stripe, not decoration: 200 = handled or deliberately ignored (stop
 * retrying), 400 = we reject this delivery (bad signature, crossed mode) and no retry will help,
 * 503 = we are not configured to verify anything, 500 = OUR failure, please retry.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');
const BaseModel = require('../../../domain/models/BaseModel');
const GatewayEvent = require('../../../domain/models/GatewayEvent');
const PaymentService = require('../../services/PaymentService');
const PaymentGatewayError = require('../../services/payments/PaymentGatewayError');
const StripeAdapter = require('../../services/payments/gateways/StripeAdapter');
const { translateEvent, allowedSourceStatuses } = require('../../services/payments/stripeWebhookEvents');
const { redactGatewayPayload } = require('../../../infrastructure/payments/redactGatewayPayload');
const { atomicTransitionPayment } = require('../../../infrastructure/payments/paymentAtomicStore');

const GATEWAY_ID = 'stripe';

// Hard-wired to Stripe: this endpoint takes NO gateway parameter from the URL or the body, so nothing
// a caller sends can route a payload into another provider's verification (plan seccion 8). Openpay
// signs differently and gets its own controller in its own PR.
let cachedAdapter = null;

/**
 * The Stripe adapter used for signature verification (lazy singleton; resolves its SDK client on each
 * call, so a test-injected client is always honored).
 * @returns {object} The StripeAdapter instance.
 */
function stripeAdapter() {
  if (!cachedAdapter) cachedAdapter = new StripeAdapter();
  return cachedAdapter;
}

/**
 * StripeWebhookController - verifies, deduplicates and applies Stripe payment events.
 */
class StripeWebhookController {
  /**
   * Map a verification failure to its HTTP answer. A missing secret is a 503 (configuration), an
   * unverifiable signature is a 400 (rejection) — never the same code, or a deployment mistake would
   * be indistinguishable from an attack.
   * @param {Error} err - The error raised by verifyWebhook.
   * @param {object} res - Express response.
   * @returns {object} The Express response.
   */
  static rejectVerification(err, res) {
    const isNotConfigured = err instanceof PaymentGatewayError
      && err.code === PaymentGatewayError.CODES.NOT_CONFIGURED;
    if (isNotConfigured) {
      logger.error('Stripe webhook received but no usable signing secret is configured for this environment', {
        gateway: GATEWAY_ID,
      });
      return res.status(503).json({ success: false, error: 'Webhook no configurado' });
    }
    // The message is already PAN-redacted by PaymentGatewayError and carries no event payload.
    logger.warn('Stripe webhook signature verification failed', {
      gateway: GATEWAY_ID,
      message: err && err.message,
    });
    return res.status(400).json({ success: false, error: 'Firma inválida' });
  }

  /**
   * Whether a verified event belongs to THIS environment's Stripe mode.
   *
   * stripeClient guards a crossed API key by its sk_/rk_ prefix; a webhook secret carries no mode, so
   * the equivalent guard has to be the event's own livemode flag. Both crossings are dangerous and both
   * are rejected: a LIVE event landing in dev/staging would confirm a real customer's money in a
   * throwaway database (and nowhere real), and a TEST event landing in production would mark a real
   * reservation paid for free. A missing flag is treated as test mode, which is the fail-safe reading
   * in production (rejected there, accepted outside).
   * @param {object} event - The verified Stripe event.
   * @returns {boolean} True when the event's mode matches the environment.
   * @example
   * StripeWebhookController.livemodeMatchesEnv({ livemode: false }); // true outside production
   */
  static livemodeMatchesEnv(event) {
    const expectsLive = process.env.NODE_ENV === 'production';
    return !!(event && event.livemode) === expectsLive;
  }

  /**
   * Capa A: record the event, insert-first. A DUPLICATE_VALUE from the unique (gateway,eventId) index
   * is not an error, it is the answer: Stripe re-delivered something we already processed.
   * @param {object} event - The verified Stripe event.
   * @returns {Promise<{gatewayEvent: (object|null), duplicate: boolean}>} The saved row, or the
   * duplicate verdict.
   * @example
   * const { duplicate } = await StripeWebhookController.recordEvent(event);
   */
  static async recordEvent(event) {
    const gatewayEvent = new GatewayEvent();
    gatewayEvent.setGateway(GATEWAY_ID);
    gatewayEvent.setEventId(event.id);
    gatewayEvent.setType(event.type);
    // PCI: the REDACTED inner object (opaque ids + amount/currency/status), never the SDK object and
    // never the envelope — id/type already have their own dedicated columns.
    gatewayEvent.setRaw(redactGatewayPayload(event.data && event.data.object));
    gatewayEvent.setProcessedAt(new Date());
    gatewayEvent.set('active', true);
    gatewayEvent.set('exists', true);

    try {
      await gatewayEvent.save(null, { useMasterKey: true });
      return { gatewayEvent, duplicate: false };
    } catch (saveErr) {
      if (saveErr && saveErr.code === Parse.Error.DUPLICATE_VALUE) {
        return { gatewayEvent: null, duplicate: true };
      }
      throw saveErr;
    }
  }

  /**
   * Locate the Payment this event refers to, by the paymentId PR4 put in the metadata of BOTH the
   * Session and the PaymentIntent (so either event type converges on the same row).
   *
   * queryAll (not queryExisting) on purpose: a Payment soft-deleted by the future TTL sweep of PR6 must
   * still be findable — the money moved regardless of our housekeeping. Returns null instead of throwing
   * for anything uncorrelatable; a webhook we cannot match is never a 500.
   * @param {object} eventObject - event.data.object (Session or PaymentIntent).
   * @returns {Promise<(object|null)>} The Payment, or null.
   * @example
   * const payment = await StripeWebhookController.findPayment(event.data.object);
   */
  static async findPayment(eventObject) {
    const metadata = (eventObject && eventObject.metadata) || {};
    const paymentId = typeof metadata.paymentId === 'string' ? metadata.paymentId.trim() : '';
    if (!paymentId) return null;
    const query = BaseModel.queryAll('Payment');
    query.equalTo('objectId', paymentId);
    const payment = await query.first({ useMasterKey: true });
    return payment || null;
  }

  /**
   * Whether the Payment is ALREADY at `gatewayStatus` right now (fresh read, never the copy loaded
   * before the conditional update).
   *
   * Only used to decide whether the rollup is worth CHECKING after Capa B matched nothing; it never
   * decides the transition itself.
   *
   * A vanished row answers the question legitimately (it is not at the destination, and no retry would
   * change that), so OBJECT_NOT_FOUND is the one error worth swallowing. Anything else — a Mongo blip, a
   * timeout — is NOT swallowed: returning false there would answer 200 and stop Stripe from retrying,
   * which is precisely how a stale rollup would become permanent, since a confirmed payment gets no
   * further events to repair it later. Letting it propagate reaches the handler's catch, retracts the
   * GatewayEvent and answers 500, which is the same "OUR failure, please retry" contract as the rest of
   * this controller. The cost of being wrong in that direction is one redundant retry that finds the
   * rollup current and writes nothing.
   * @param {string} paymentId - Parse objectId of the Payment.
   * @param {string} gatewayStatus - The destination status to compare against.
   * @returns {Promise<boolean>} True when the row already holds that status.
   * @example
   * await StripeWebhookController.isAlreadyAt(payment.id, 'succeeded');
   */
  static async isAlreadyAt(paymentId, gatewayStatus) {
    let current = null;
    try {
      current = await BaseModel.queryAll('Payment').get(paymentId, { useMasterKey: true });
    } catch (readErr) {
      if (readErr && readErr.code === Parse.Error.OBJECT_NOT_FOUND) return false;
      throw readErr;
    }
    return !!current && current.get('gatewayStatus') === gatewayStatus;
  }

  /**
   * Capa B + rollup: apply the destination status to the Payment this event points at.
   *
   * Returns false (a clean no-op, never an error) for every case that must not move money: an
   * uncorrelatable paymentId, or a Payment already past the allowed source states. A no-op still
   * VERIFIES the reservation rollup when the Payment is already at the destination (see below), which
   * repairs a delivery that died between Capa B and the recalculate without ever rewriting a rollup
   * that is already correct.
   * @param {object} event - The verified Stripe event.
   * @param {object} destination - The translated destination { gatewayStatus, crossesThreshold }.
   * @returns {Promise<boolean>} True when the Payment actually transitioned.
   * @example
   * const applied = await StripeWebhookController.applyToPayment(event, { gatewayStatus: 'succeeded' });
   */
  static async applyToPayment(event, destination) {
    const eventObject = (event.data && event.data.object) || {};
    const payment = await StripeWebhookController.findPayment(eventObject);
    if (!payment) {
      logger.warn('Stripe webhook could not be correlated to a Payment (anomaly, nothing modified)', {
        eventId: event.id,
        type: event.type,
        metadataPaymentId: (eventObject.metadata && eventObject.metadata.paymentId) || null,
      });
      return false;
    }

    // Conditional, atomic. Only 'succeeded' stamps confirmedAt. The source allowlist is per DESTINATION
    // (stripeWebhookEvents): 'succeeded' also accepts a 'failed'/'expired' row, because a declined card
    // leaves the session open for a retry with another card on the same PaymentIntent and paymentId.
    const isSuccess = destination.gatewayStatus === 'succeeded';
    const { matchedCount } = await atomicTransitionPayment(payment.id, {
      fromStatuses: allowedSourceStatuses(destination.gatewayStatus),
      toStatus: destination.gatewayStatus,
      extraSet: isSuccess ? { confirmedAt: new Date() } : {},
    });

    // The rollup moves if and only if the transition ACTUALLY crosses the counts/does-not-count line of
    // PaymentService.countsInRollup — that is what `crossesThreshold` means (stripeWebhookEvents.js), and
    // it is deliberately NOT the same thing as "this event means success" (`isSuccess`, used only for
    // confirmedAt above). Today the two happen to coincide (only 'succeeded' counts), but PR11 will add
    // charge.refunded with { gatewayStatus:'refunded', crossesThreshold:true } — keying on isSuccess would
    // silently skip the rollup for a refund. Keying on matchedCount (not on the event type) is what makes
    // the two success events converge into exactly one recalculate, whichever of them wins the race.
    const shouldRecalculate = matchedCount === 1 && destination.crossesThreshold;

    // The OTHER branch: matchedCount 0 on a counting destination when the Payment is ALREADY at that
    // destination. Capa B can succeed and THEN recalculate throw below, which makes the outer catch
    // retract the GatewayEvent so Stripe retries; that retry clears Capa A but no longer matches Capa B's
    // filter, so keying the rollup only on matchedCount would abandon it forever — a paid reservation
    // showing a balance with nothing left to retry it.
    //
    // This evidence is AMBIGUOUS on purpose and must never be read as "rewrite the rollup": the exact
    // same state is what a perfectly ordinary sibling event sees (checkout.session.completed and
    // payment_intent.succeeded both mean 'succeeded' for the same paymentId, and the loser of that race
    // finds the Payment already at the destination too). So it only decides "this is worth CHECKING".
    // recalculateIfStale does the unambiguous part: inside the same per-reservation lock, it compares the
    // persisted rollup against a fresh computation and writes only when they differ. A dead delivery left
    // a stale rollup and gets repaired; a sibling event queues behind the winner's recalculate, re-reads
    // what the winner persisted, finds it current and writes nothing.
    const shouldCheckStaleRollup = !shouldRecalculate
      && matchedCount === 0
      && destination.crossesThreshold
      && await StripeWebhookController.isAlreadyAt(payment.id, destination.gatewayStatus);

    let repairedStaleRollup = false;
    if (shouldRecalculate || shouldCheckStaleRollup) {
      // The reservation comes from the Payment we just loaded from OUR database, never from
      // metadata.reservationId: metadata travels with the event and is only as trustworthy as the event,
      // while the Payment's own reservationPtr is the authoritative link.
      const reservationPtr = payment.getReservationPtr && payment.getReservationPtr();
      const reservationId = reservationPtr && reservationPtr.id;
      if (!reservationId) {
        logger.error('Confirmed online Payment has no reservationPtr; rollup could not be recalculated', {
          eventId: event.id, paymentId: payment.id,
        });
      } else if (shouldRecalculate) {
        await PaymentService.recalculate(reservationId);
      } else {
        const outcome = await PaymentService.recalculateIfStale(reservationId);
        repairedStaleRollup = !!(outcome && outcome.healed);
      }
    }

    logger.info('Stripe webhook processed', {
      eventId: event.id,
      type: event.type,
      paymentId: payment.id,
      gatewayStatus: destination.gatewayStatus,
      applied: matchedCount === 1,
      recalculated: shouldRecalculate,
      staleRollupChecked: shouldCheckStaleRollup,
      staleRollupRepaired: repairedStaleRollup,
    });
    return matchedCount === 1;
  }

  /**
   * POST /api/webhooks/stripe — verify, deduplicate and apply one Stripe event.
   * @param {object} req - Express request; req.body MUST be the raw Buffer (see the mount in index.js).
   * @param {object} res - Express response.
   * @returns {Promise<object>} The Express response.
   * @example
   * app.post('/api/webhooks/stripe', express.raw(...), (req, res) => StripeWebhookController.handle(req, res));
   */
  static async handle(req, res) {
    // 1) Signature. First line of defense; nothing below runs, and Parse is never touched, until it passes.
    let event;
    try {
      event = stripeAdapter().verifyWebhook(req.body, req.headers['stripe-signature']);
    } catch (verifyErr) {
      return StripeWebhookController.rejectVerification(verifyErr, res);
    }

    // 1b) Test/live crossing (the webhook counterpart of stripeClient's key guard).
    if (!StripeWebhookController.livemodeMatchesEnv(event)) {
      logger.error('Stripe webhook rejected: event livemode does not match this environment', {
        eventId: event.id,
        type: event.type,
        eventLivemode: !!event.livemode,
        nodeEnv: process.env.NODE_ENV,
      });
      return res.status(400).json({ success: false, error: 'Evento de un modo distinto al de este entorno' });
    }

    let recorded = null;
    try {
      // 2) Capa A.
      const { gatewayEvent, duplicate } = await StripeWebhookController.recordEvent(event);
      if (duplicate) {
        logger.info('Stripe webhook duplicate event ignored (Capa A)', { eventId: event.id, type: event.type });
        return res.status(200).json({ received: true, duplicate: true });
      }
      recorded = gatewayEvent;

      // 3) Translate. 4) Out of scope => recorded and done (charge.refunded and friends are PR11).
      const destination = translateEvent(event.type);
      if (!destination) {
        logger.info('Stripe webhook event type out of scope for this build (recorded, no Payment touched)', {
          eventId: event.id, type: event.type,
        });
        return res.status(200).json({ received: true, handled: false });
      }

      // 5/6/7) Locate the Payment, transition it atomically, recalculate only on a real transition.
      // An uncorrelatable paymentId is an anomaly + 200 (a retry would not fix the data), never a 500.
      const applied = await StripeWebhookController.applyToPayment(event, destination);
      return res.status(200).json({ received: true, handled: applied });
    } catch (err) {
      // Capa A writes the "already processed" marker BEFORE the work is done. If the work then fails we
      // must retract that marker, or Stripe's retry would hit the duplicate short-circuit, answer 200,
      // and the Payment would stay 'requires_payment' forever with the money already captured. Removing
      // the row makes the retry reprocess cleanly.
      if (recorded && recorded.id) {
        try {
          await recorded.destroy({ useMasterKey: true });
        } catch (cleanupErr) {
          logger.error('CRITICAL: Stripe webhook failed AND its GatewayEvent could not be retracted; the retry will be swallowed as a duplicate and this payment may stay unconfirmed', {
            eventId: event.id, type: event.type, error: cleanupErr && cleanupErr.message,
          });
        }
      }
      logger.error('Stripe webhook processing failed', {
        eventId: event.id, type: event.type, error: err && err.message,
      });
      // 500 so Stripe retries: this is OUR failure, not a bad delivery.
      return res.status(500).json({ success: false, error: 'Error procesando el webhook' });
    }
  }
}

module.exports = StripeWebhookController;
