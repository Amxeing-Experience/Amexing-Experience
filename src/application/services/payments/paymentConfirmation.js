/**
 * paymentConfirmation - THE single place where a confirmed gateway charge is applied to a Payment
 * and to its reservation's rollup.
 *
 * Four paths can now reach the same Payment row within the same seconds: the webhook (PR5), the
 * browser-return polling, the reconciliation job and the TTL sweep. Each of them locates the row its
 * own way — the webhook by metadata.paymentId, the polling by the session id in the URL, the job by
 * its own candidate query — but from the moment the row is in hand, all of them must do the SAME
 * thing, in the same order, with the same guards. Three copies of this logic is exactly the
 * duplication that already made two implementations of one money criterion diverge earlier in this
 * roadmap, so there is one copy and the callers are thin.
 *
 * The order is not cosmetic. First the conditional, atomic transition, which is the ONLY arbiter of
 * who won and is never a fetch-then-save. Then the revive, if the row was retired by our own
 * housekeeping — BEFORE the rollup, because loadAndCompute reads through exists:true and would
 * otherwise recompute without this charge. Then the rollup itself: recalculate on a real transition,
 * recalculateIfStale when the row was already at the destination (a sibling event, or a delivery
 * that died before its rollup). Last, the reporting: shout about money the rollup still cannot see,
 * and mark a charge that landed on an already-cancelled reservation.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');
const BaseModel = require('../../../domain/models/BaseModel');
const PaymentService = require('../PaymentService');
const { allowedSourceStatuses } = require('./stripeWebhookEvents');
const {
  atomicTransitionPayment,
  reviveIfSystemRetired,
  flagRefundReview,
  flagRollupRepair,
  backfillAuditFields,
} = require('../../../infrastructure/payments/paymentAtomicStore');

/**
 * Load the CURRENT row (fresh read, never the copy the caller held before the conditional update),
 * including soft-deleted ones.
 *
 * queryAll and not queryExisting, for the same reason the webhook uses it to locate the Payment in
 * the first place: the money moved regardless of our housekeeping, so a retired row must stay
 * readable. A vanished row answers the question legitimately (OBJECT_NOT_FOUND -> null); anything
 * else — a Mongo blip, a timeout — propagates, so the caller fails loudly and gets retried instead
 * of silently deciding the rollup is fine.
 * @param {string} paymentId - Parse objectId of the Payment.
 * @returns {Promise<(object|null)>} The Payment, or null when it no longer exists.
 * @example
 * const row = await loadCurrent(payment.id);
 */
async function loadCurrent(paymentId) {
  try {
    return await BaseModel.queryAll('Payment').get(paymentId, { useMasterKey: true });
  } catch (readErr) {
    if (readErr && readErr.code === Parse.Error.OBJECT_NOT_FOUND) return null;
    throw readErr;
  }
}

/**
 * Whether the row this confirmation just wrote is soft-deleted, i.e. invisible to the rollup.
 *
 * The document the conditional update RETURNED is the authoritative answer, and it is the only one
 * that is not stale: the caller's copy was read before the write, so in the very race this PR exists
 * for — housekeeping retires the row while a confirmation is in flight — that copy still says
 * exists:true and would skip the revive, losing the charge. The caller's copy is used only as a
 * fallback when no document came back at all.
 * @param {(object|null)} updatedDoc - What atomicTransitionPayment returned.
 * @param {object} payment - The Payment the caller located.
 * @returns {boolean} True when the row is soft-deleted.
 */
function isInvisible(updatedDoc, payment) {
  if (updatedDoc && typeof updatedDoc === 'object' && Object.prototype.hasOwnProperty.call(updatedDoc, 'exists')) {
    return updatedDoc.exists === false;
  }
  return !!payment.get && payment.get('exists') === false;
}

/**
 * Report what the revive attempt means for the visibility of this charge.
 *
 * Three outcomes, three different noises on purpose. REVIVED is an INFO: our own housekeeping had
 * retired the row, the card then cleared, and the system corrected itself — worth a trace, not an
 * alarm. STILL INVISIBLE is an ERROR: the row is soft-deleted WITHOUT our marker, i.e. staff deleted
 * it deliberately, and restoring it would override a human decision, so this shouts instead of
 * acting (`gatewayStatus:'succeeded' AND exists:false` is the exact runbook query that finds it).
 * ANOTHER PATH REVIVED IT FIRST is silence: a benign race must not escalate to a critical alarm,
 * which is the only reason for the re-read here.
 *
 * The re-read fails LOUD, not quiet: silence is reserved for a row we positively confirmed is back
 * to exists:true. A row that cannot be re-read at all still carries confirmed money nobody can see.
 * @param {object} ctx - Reporting context.
 * @param {object} ctx.payment - The Payment (only its id is used).
 * @param {boolean} ctx.revived - Whether THIS call revived the row.
 * @param {string} ctx.source - Which path is confirming ('webhook' | 'polling' | 'reconciliation').
 * @param {object} ctx.logContext - Extra identifiers for the log line.
 * @returns {Promise<boolean>} True when the charge is (still) invisible to the rollup.
 * @example
 * await reportVisibility({ payment, revived, source: 'webhook', logContext: { eventId } });
 */
async function reportVisibility({
  payment, revived, source, logContext,
}) {
  if (revived) {
    logger.info('Revived a gateway payment our own housekeeping had retired: the charge cleared after all and now counts in the rollup', {
      ...logContext, source, paymentId: payment.id,
    });
    return false;
  }

  let stillHidden = true;
  try {
    const row = await loadCurrent(payment.id);
    stillHidden = !row || row.get('exists') === false;
  } catch (readErr) {
    logger.warn('Could not re-read a just-confirmed gateway payment to check its visibility; assuming the worst', {
      ...logContext, source, paymentId: payment.id, error: readErr && readErr.message,
    });
  }
  if (!stillHidden) return false;

  // No se afirma QUIÉN la ocultó: la ausencia de `retiredBySystem` es evidencia de que no la retiró
  // nuestra maquinaria, pero no prueba una decisión humana (una fila retirada por un camino que aún
  // no marca, o una marca perdida, se ven igual). Atribuir intención en un log de dinero perdido
  // manda al operador a buscar a un responsable que puede no existir.
  logger.error('CRITICAL: confirmed a gateway payment that the rollup cannot see (no auto-retirement marker, so it is NOT auto-revived); the reservation balance will NOT reflect this charge until someone reconciles it by hand', {
    ...logContext, source, paymentId: payment.id,
  });
  return true;
}

/**
 * Mark a charge that landed on an ALREADY CANCELLED reservation.
 *
 * The money is real and is recorded with complete normality — hiding it in the CRM does not send it
 * back, it only makes our books and Stripe disagree, which is the same principle already applied to
 * money made invisible by a soft-delete. What this adds is a persistent, queryable marker plus an
 * error-level log, so the case is not silently "a cancelled reservation that looks paid". PR11 turns
 * the marker into a refund request for Amexing to authorize; nothing is refunded automatically here.
 *
 * A reservation that cannot be read is not an excuse to lose the confirmation: it is logged and the
 * flow continues.
 * @param {object} ctx - Marking context.
 * @param {object} ctx.payment - The Payment just confirmed.
 * @param {string} ctx.reservationId - Its reservation.
 * @param {string} ctx.source - Which path confirmed it.
 * @param {object} ctx.logContext - Extra identifiers for the log line.
 * @returns {Promise<boolean>} True when the marker was written.
 * @example
 * await markIfReservationCancelled({ payment, reservationId, source: 'webhook', logContext: {} });
 */
async function markIfReservationCancelled({
  payment, reservationId, source, logContext,
}) {
  let reservation = null;
  try {
    reservation = await BaseModel.queryAll('Reservation').get(reservationId, { useMasterKey: true });
  } catch (readErr) {
    logger.warn('Could not read the reservation to check whether this confirmed charge landed on a cancelled booking', {
      ...logContext, source, paymentId: payment.id, reservationId, error: readErr && readErr.message,
    });
    return false;
  }
  if (!reservation || reservation.get('status') !== 'cancelled') return false;

  await flagRefundReview(payment.id);
  logger.error('A gateway charge was confirmed against an ALREADY CANCELLED reservation; the payment is recorded and the balance updated, and it is flagged for refund review (requiresRefundReview)', {
    ...logContext, source, paymentId: payment.id, reservationId,
  });
  return true;
}

/**
 * Move the reservation rollup for a confirmation that earned it, and mark the cancelled-booking case.
 *
 * A real transition RECALCULATES; a Payment merely found already at the destination only VERIFIES
 * (recalculateIfStale), which rewrites nothing when the persisted rollup is already right. The
 * difference is what keeps a sibling event or a re-delivery from double-counting.
 *
 * The reservation id comes from the Payment we loaded from OUR database, never from provider
 * metadata: metadata travels with the event and is only as trustworthy as the event, while the
 * Payment's own reservationPtr is the authoritative link.
 * @param {object} ctx - Rollup context.
 * @param {object} ctx.payment - The Payment.
 * @param {boolean} ctx.shouldRecalculate - True when THIS call really transitioned it.
 * @param {boolean} ctx.isSuccess - True when the destination is 'succeeded'.
 * @param {string} ctx.source - Which path is confirming.
 * @param {object} ctx.context - Log identifiers.
 * @returns {Promise<{staleRollupRepaired: boolean, flaggedForRefundReview: boolean}>} What happened.
 * @example
 * await runRollup({ payment, shouldRecalculate: true, isSuccess: true, source: 'webhook', context });
 */
async function runRollup({
  payment, shouldRecalculate, isSuccess, source, context,
}) {
  const reservationPtr = payment.getReservationPtr && payment.getReservationPtr();
  const reservationId = reservationPtr && reservationPtr.id;
  if (!reservationId) {
    logger.error('Confirmed online Payment has no reservationPtr; rollup could not be recalculated', {
      ...context, source, paymentId: payment.id,
    });
    return { staleRollupRepaired: false, flaggedForRefundReview: false };
  }

  // THE one gap the atomic transition cannot close by itself. The row is already 'succeeded' and
  // visible; if the rollup now blows up, the reservation keeps showing a balance for money that was
  // really collected, and that state matches NO reconciliation branch (it is neither pending nor
  // retired) and NO runbook query. Only the webhook self-heals, because it answers 500 and Stripe
  // re-delivers — the polling and the two jobs swallow their errors by design.
  //
  // So: leave a durable, queryable marker, shout, and RE-THROW. The re-throw is what preserves the
  // webhook's retry contract; the marker is what gives every other path something to find later.
  // ANTES del rollup a propósito: si el rollup revienta, el re-throw impide llegar al final de esta
  // función, y en el reintento `shouldRecalculate` ya es false (la fila está en el destino), así que la
  // marca no volvería a evaluarse NUNCA. Un cobro sobre una reservación cancelada se quedaría sin
  // `requiresRefundReview`, que es justo lo que PR11 convierte en solicitud de reembolso.
  // Su propio fallo NO puede bloquear el rollup: el saldo es dinero, la marca es una bandera.
  let flaggedForRefundReview = false;
  if (shouldRecalculate && isSuccess) {
    try {
      flaggedForRefundReview = await markIfReservationCancelled({
        payment, reservationId, source, logContext: context,
      });
    } catch (markErr) {
      logger.error('Could not flag a gateway charge landed on a cancelled reservation; the rollup continues', {
        ...context, source, paymentId: payment.id, reservationId, error: markErr && markErr.message,
      });
    }
  }

  let staleRollupRepaired = false;
  try {
    if (shouldRecalculate) {
      await PaymentService.recalculate(reservationId);
    } else {
      const outcome = await PaymentService.recalculateIfStale(reservationId);
      staleRollupRepaired = !!(outcome && outcome.healed);
    }
  } catch (rollupErr) {
    try {
      await flagRollupRepair(payment.id);
    } catch (flagErr) {
      logger.error('CRITICAL: could not even flag a gateway payment whose rollup failed; it will not be picked up automatically', {
        ...context, source, paymentId: payment.id, reservationId, error: flagErr && flagErr.message,
      });
    }
    logger.error('CRITICAL: a gateway charge is confirmed but its reservation rollup could NOT be written; the money was collected and the balance is stale until this is repaired (flagged requiresRollupRepair; the reconciliation job retries it)', {
      ...context, source, paymentId: payment.id, reservationId, error: rollupErr && rollupErr.message,
    });
    throw rollupErr;
  }

  // The rollup is current again, so a marker left by an earlier failed attempt no longer applies.
  if (payment.get && payment.get('requiresRollupRepair') === true) {
    await flagRollupRepair(payment.id, false);
  }

  return { staleRollupRepaired, flaggedForRefundReview };
}

/**
 * Strip the two fields this module owns from a caller-supplied extraSet.
 *
 * `gatewayStatus` ya lo aplica el store al final, así que nunca era escribible. `confirmedAt` SÍ lo
 * era en un destino no exitoso (el spread del caller entraba y el sello propio solo se agrega cuando
 * isSuccess), contradiciendo lo que promete el JSDoc de `extraSet`. Se hace cierto en el código en vez
 * de corregir el comentario: es la marca de cuándo entró el dinero, no un campo de uso general.
 * @param {object} [extraSet] - Campos extra propuestos por el llamador.
 * @returns {object} Los mismos campos, sin los dos que este módulo gobierna.
 * @example
 * sanitizeExtraSet({ gatewayChargeId: 'ch_1', confirmedAt: new Date() }); // { gatewayChargeId: 'ch_1' }
 */
const MODULE_OWNED_FIELDS = ['gatewayStatus', 'confirmedAt'];

function sanitizeExtraSet(extraSet) {
  if (!extraSet || typeof extraSet !== 'object') return {};
  return Object.fromEntries(
    Object.entries(extraSet).filter(([field]) => !MODULE_OWNED_FIELDS.includes(field))
  );
}

/**
 * Rescata el rastro de auditoría cuando un evento hermano ya había llevado la fila al destino.
 *
 * En esa rama el update condicional no matcheó, así que el `extraSet` de ESTE llamador se descartó
 * ENTERO. Sus dos consumidores traen datos que no deben perderse: los ids del proveedor (sin
 * `gatewayChargeId` no hay con qué reembolsar en PR11) y, sobre todo, el `gatewayRaw` que registra
 * una discrepancia de monto/moneda contra Stripe. Ese último es el caso COMÚN — el webhook suele
 * ganar la carrera — y dejaba la discrepancia solo en un log rotado, en vez del marcador durable y
 * consultable que el resto de este archivo se esfuerza en dejar.
 *
 * Nada de esto es monetario, y el store solo escribe lo que está ausente, así que jamás pisa al
 * ganador. Su fallo nunca tumba una confirmación que ya ocurrió.
 *
 * Vive aparte y no en línea para no pasar de max-lines-per-function en applyConfirmation, igual que
 * warnIfInvisibleToRollup en el controller del webhook.
 * @param {object} input - Datos del rescate.
 * @param {string} input.paymentId - Parse objectId del Payment.
 * @param {object} [input.extraSet] - El extraSet que propuso el llamador.
 * @param {string} input.source - Qué camino está confirmando.
 * @param {object} input.context - Identificadores de log.
 * @returns {Promise<void>} Resuelve siempre, haya o no escrito.
 * @example
 * await rescueAuditTrail({ paymentId: 'pay_1', extraSet: { gatewayChargeId: 'ch_1' }, source: 'polling', context });
 */
async function rescueAuditTrail({
  paymentId, extraSet, source, context,
}) {
  const proposed = sanitizeExtraSet(extraSet);
  if (Object.keys(proposed).length === 0) return;
  try {
    await backfillAuditFields(paymentId, proposed);
  } catch (backfillErr) {
    logger.warn('Could not backfill the audit trail after a sibling event won the transition; a recorded amount/currency discrepancy may exist only in the logs', {
      ...context, source, paymentId, error: backfillErr && backfillErr.message,
    });
  }
}

/**
 * Apply a translated destination to a Payment: transition, revive, rollup, report.
 * @param {object} input - Confirmation input.
 * @param {object} input.payment - The Payment, ALREADY located by the caller.
 * @param {object} input.destination - { gatewayStatus, crossesThreshold } from stripeWebhookEvents
 * (webhook) or stripeCheckoutStatus (polling / reconciliation).
 * @param {string} input.source - 'webhook' | 'polling' | 'reconciliation' (logging + diagnostics).
 * @param {object} [input.extraSet] - Extra Payment fields to persist inside the SAME atomic write
 * (e.g. gatewayChargeId, gatewayRaw). It can never override gatewayStatus/confirmedAt.
 * @param {object} [input.logContext] - Extra identifiers to carry into every log line.
 * @returns {Promise<object>} { applied, revived, recalculated, staleRollupChecked,
 * staleRollupRepaired, invisibleToRollup, flaggedForRefundReview }.
 * @example
 * await applyConfirmation({ payment, destination, source: 'polling' });
 */
async function applyConfirmation({
  payment, destination, source, extraSet, logContext,
}) {
  // Every log line of this confirmation carries the destination, so a critical alert is actionable
  // without cross-referencing the info line next to it.
  const context = { ...(logContext || {}), gatewayStatus: destination.gatewayStatus };
  const isSuccess = destination.gatewayStatus === 'succeeded';

  // Conditional, atomic. The source allowlist is per DESTINATION and comes from ONE shared place:
  // 'succeeded' also accepts a 'failed'/'expired' row, because a declined card leaves the session
  // open for a retry with another card on the same PaymentIntent and paymentId. Only 'succeeded'
  // stamps confirmedAt, and the destination is applied last so extraSet can never rewrite it.
  const { matchedCount, updatedDoc } = await atomicTransitionPayment(payment.id, {
    fromStatuses: allowedSourceStatuses(destination.gatewayStatus),
    toStatus: destination.gatewayStatus,
    extraSet: {
      ...sanitizeExtraSet(extraSet),
      ...(isSuccess ? { confirmedAt: new Date() } : {}),
    },
  });

  // The rollup moves if and only if the transition ACTUALLY crosses the counts/does-not-count line
  // of PaymentService.countsInRollup — deliberately NOT the same thing as "this means success"
  // (isSuccess, used only for confirmedAt). Today they coincide; PR11 adds charge.refunded with
  // crossesThreshold:true, where keying on success would silently skip the rollup for a refund.
  const shouldRecalculate = matchedCount === 1 && destination.crossesThreshold;

  // The OTHER branch: matchedCount 0 on a counting destination when the Payment is ALREADY there.
  // That evidence is AMBIGUOUS on purpose and must never be read as "rewrite the rollup": an
  // ordinary sibling event sees exactly the same state. So it only decides "this is worth CHECKING",
  // and recalculateIfStale does the unambiguous part inside the per-reservation lock.
  let current = null;
  let alreadyAtDestination = false;
  if (!shouldRecalculate && matchedCount === 0 && destination.crossesThreshold) {
    current = await loadCurrent(payment.id);
    alreadyAtDestination = !!current && current.get('gatewayStatus') === destination.gatewayStatus;
  }

  if (alreadyAtDestination) {
    await rescueAuditTrail({
      paymentId: payment.id, extraSet, source, context,
    });
  }

  // Revive BEFORE the rollup: loadAndCompute reads through exists:true, so a row still retired when
  // recalculate runs would be recomputed without this charge and the repair would have to wait for
  // another event that may never come.
  //
  // Only a row that is actually invisible pays for a revive attempt: the overwhelmingly common case
  // (a live row) costs nothing at all, which matters on a webhook path with a 20s budget.
  let revived = false;
  let invisibleToRollup = false;
  if (isSuccess && (matchedCount === 1 || alreadyAtDestination)) {
    const hidden = matchedCount === 1
      ? isInvisible(updatedDoc, payment)
      : current.get('exists') === false;
    if (hidden) {
      const outcome = await reviveIfSystemRetired(payment.id);
      revived = outcome.matchedCount === 1;
      invisibleToRollup = await reportVisibility({
        payment, revived, source, logContext: context,
      });
    }
  }

  const { staleRollupRepaired, flaggedForRefundReview } = (shouldRecalculate || alreadyAtDestination)
    ? await runRollup({
      payment, shouldRecalculate, isSuccess, source, context,
    })
    : { staleRollupRepaired: false, flaggedForRefundReview: false };

  logger.info('Gateway payment confirmation processed', {
    ...context,
    source,
    paymentId: payment.id,
    gatewayStatus: destination.gatewayStatus,
    applied: matchedCount === 1,
    recalculated: shouldRecalculate,
    staleRollupChecked: alreadyAtDestination,
    staleRollupRepaired,
    revived,
    invisibleToRollup,
    flaggedForRefundReview,
  });

  return {
    applied: matchedCount === 1,
    revived,
    recalculated: shouldRecalculate,
    staleRollupChecked: alreadyAtDestination,
    staleRollupRepaired,
    invisibleToRollup,
    flaggedForRefundReview,
  };
}

module.exports = { applyConfirmation, loadCurrent };
