/**
 * paymentHousekeeping - the two BACKGROUND safety nets around the online rollup: the TTL sweep that
 * retires abandoned pendings, and the reconciliation that asks Stripe about rows whose webhook never
 * came.
 *
 * The logic lives here, not inside Parse.Cloud.job, for the same reason aplicarInflacionJob already
 * does: a Cloud Job wrapper cannot be driven from a test, and these two touch money. src/cloud/main.js
 * registers two thin wrappers over these functions.
 *
 * Both are LOT-based and per-row tolerant: one bad candidate never aborts the batch. Neither is gated
 * by PAYMENTS_ENABLED — the flag decides whether a NEW charge may be started, not whether an existing
 * one is real — and neither applies any RBAC: they run under useMasterKey with no user context, so a
 * requireRoleLevel here would be a category error.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');
const BaseModel = require('../../../domain/models/BaseModel');
const StripeAdapter = require('./gateways/StripeAdapter');
const StripeCheckoutController = require('../../controllers/api/StripeCheckoutController');
const PaymentService = require('../PaymentService');
const { applyConfirmation } = require('./paymentConfirmation');
const {
  atomicRetirePayment,
  stampReconciled,
  flagRollupRepair,
} = require('../../../infrastructure/payments/paymentAtomicStore');

// Extra slack on top of the session cushion, for webhook delivery latency and clock drift between our
// process and Stripe. It may be tuned, but the sweep must NEVER act before
// expiresAt + SESSION_EXPIRY_CUSHION_MS: until that instant the Checkout Session is still payable in
// Stripe, and retiring the row then is a race we would be creating ourselves.
const SWEEP_SAFETY_MARGIN_MS = 2 * 60 * 1000;

// How long a row already reconciled is left alone before being looked at again. Without it, a genuinely
// stuck 'processing' row would be queried on every single run forever.
const RECONCILE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

// How far back the SECOND branch of the candidate query reaches. A CHOSEN number, not a derived one:
// after this long, a charge whose webhook never arrived is a manual investigation, not a job's job.
// Named and exported rather than buried as a literal, precisely because it is a judgement call.
const RECONCILE_RETIRED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Batch ceilings. Both jobs are cron-driven, so a bounded batch that runs again in minutes is strictly
// better than an unbounded one that can hold a connection for a long time.
const SWEEP_BATCH_LIMIT = 500;
const RECONCILE_BATCH_LIMIT = 100;

// How many stuck 'processing' ids a single log line carries. The count is always exact; the ids are a
// sample, so a pathological run cannot produce a megabyte of log.
const STUCK_SAMPLE_LIMIT = 20;

let cachedAdapter = null;

/**
 * The Stripe adapter used for reconciliation lookups (lazy singleton; it resolves its SDK client on
 * each call, so a test-injected client is always honored).
 * @returns {object} The StripeAdapter instance.
 */
function stripeAdapter() {
  if (!cachedAdapter) cachedAdapter = new StripeAdapter();
  return cachedAdapter;
}

/**
 * The instant before which a pending's Checkout Session is certainly dead in Stripe too.
 *
 * Derived from the SAME constants the checkout controller stamps on the pending, never from a second
 * copy of those numbers: a sweep measuring against a shorter cushion would retire a row whose session
 * is still payable, which is exactly the race the cushion exists to avoid.
 * @param {Date} [now] - The reference instant (injectable for tests).
 * @returns {Date} Rows whose expiresAt is older than this may be retired.
 * @example
 * sweepThreshold(); // ~35 min behind now
 */
function sweepThreshold(now = new Date()) {
  return new Date(now.getTime() - StripeCheckoutController.SESSION_EXPIRY_CUSHION_MS - SWEEP_SAFETY_MARGIN_MS);
}

/**
 * Log the 'processing' rows that are stuck past the threshold.
 *
 * They have a ceiling of ALERT, never of retirement. `expiresAt` is stamped once at creation and never
 * refreshed, so EVERY 'processing' row satisfies the sweep threshold by construction — retiring one
 * would be retiring money that is still in flight at the provider. One aggregated line per run, never
 * one per row.
 * @param {Date} threshold - The sweep threshold.
 * @returns {Promise<number>} How many stuck rows were found.
 * @example
 * await reportStuckProcessing(sweepThreshold());
 */
async function reportStuckProcessing(threshold) {
  const query = BaseModel.queryExisting('Payment');
  query.equalTo('channel', 'online');
  query.equalTo('gatewayStatus', 'processing');
  query.lessThan('expiresAt', threshold);
  query.limit(SWEEP_BATCH_LIMIT);
  const rows = await query.find({ useMasterKey: true });
  if (rows.length === 0) return 0;

  logger.warn('Online payments stuck in "processing" past the sweep threshold; they are NEVER retired (the money may still be in flight) and are left for the reconciliation job', {
    count: rows.length,
    sample: rows.slice(0, STUCK_SAMPLE_LIMIT).map((p) => p.id),
  });
  return rows.length;
}

/**
 * Retire abandoned online pendings whose Checkout Session is certainly dead in Stripe too.
 *
 * ONLY 'requires_payment', and ONLY past the cushion+margin threshold. Every other status is out of
 * scope by construction, manual payments never carry `channel:'online'` at all, and the retirement is
 * per-row and conditional: between the query that built the batch and the moment a given row is
 * processed, a webhook may have confirmed it, and the filter inside the write turns that into a silent
 * no-op instead of an overwrite.
 *
 * It never recalculates anything: a pending never counted in the rollup, so retiring it moves no money.
 * @param {object} [options] - Options.
 * @param {Date} [options.now] - Reference instant (tests).
 * @returns {Promise<object>} { scanned, retired, skipped, failed, stuckProcessing }.
 * @example
 * const stats = await sweepExpiredOnlinePayments();
 */
async function sweepExpiredOnlinePayments(options = {}) {
  const threshold = sweepThreshold(options.now);

  const query = BaseModel.queryExisting('Payment');
  query.equalTo('channel', 'online');
  query.equalTo('gatewayStatus', 'requires_payment');
  query.lessThan('expiresAt', threshold);
  query.ascending('expiresAt');
  query.limit(SWEEP_BATCH_LIMIT);
  const candidates = await query.find({ useMasterKey: true });

  const stats = {
    scanned: candidates.length, retired: 0, skipped: 0, failed: 0, stuckProcessing: 0,
  };
  for (const payment of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { matchedCount } = await atomicRetirePayment(payment.id);
      if (matchedCount === 1) stats.retired += 1;
      else stats.skipped += 1; // confirmed (or retired) in the meantime: leave it exactly as it is
    } catch (err) {
      stats.failed += 1;
      logger.error('Could not retire an expired online pending; the rest of the batch continues', {
        paymentId: payment.id, error: err && err.message,
      });
    }
  }

  stats.stuckProcessing = await reportStuckProcessing(threshold);
  logger.info('Expired online pending sweep finished', { ...stats, threshold: threshold.toISOString() });
  return stats;
}

/**
 * Branch (i) of the reconciliation candidates: rows STILL LIVE and stale.
 *
 * Staleness is measured against `expiresAt` and the SAME threshold the sweep uses, not a second
 * notion of "old": expiresAt is createdAt + the pending TTL, so the two are equivalent for anything
 * the checkout controller created, and expiresAt is the one with a meaning ("its session is dead in
 * Stripe too"). A row with no expiresAt at all is out of scope for both jobs — nothing that creates an
 * online Payment leaves it unset.
 *
 * 'processing' is included even though nothing produces it today: it is the one status the sweep must
 * never touch, so reconciliation is its only path out.
 * @param {Date} ageThreshold - Rows whose expiresAt is older than this are stale enough to ask about.
 * @param {Date} cooldownThreshold - Rows reconciled before this may be asked about again.
 * @returns {Promise<object[]>} The live candidates.
 */
async function liveCandidates(ageThreshold, cooldownThreshold) {
  const base = () => {
    const q = BaseModel.queryExisting('Payment');
    q.equalTo('channel', 'online');
    q.containedIn('gatewayStatus', ['requires_payment', 'processing']);
    q.lessThan('expiresAt', ageThreshold);
    return q;
  };
  const neverReconciled = base();
  neverReconciled.doesNotExist('lastReconciledAt');
  const cooledDown = base();
  cooledDown.lessThan('lastReconciledAt', cooldownThreshold);

  const query = Parse.Query.or(neverReconciled, cooledDown);
  query.limit(RECONCILE_BATCH_LIMIT);
  return query.find({ useMasterKey: true });
}

/**
 * Branch (ii) of the reconciliation candidates: rows THE SWEEP ITSELF RETIRED.
 *
 * Without this branch the job is born dead. The sweep retires every 'requires_payment' row roughly
 * every 35 minutes BY DESIGN, so an exists:true query finds no candidates in normal operation — and a
 * real charge whose webhook never arrived ends up 'expired' + exists:false: invisible to the rollup,
 * invisible to a live-only query, and not even caught by the runbook's stranded-money query, which
 * looks for 'succeeded'. That row is the literal case this job exists for.
 *
 * It is safe because the revive only ever fires on `retiredBySystem:true` (never on a deliberate staff
 * delete), getCharge can work from the intent id once the session is gone, and an 'expired' destination
 * applied to an already-'expired' row is a guaranteed no-op through the source allowlist.
 *
 * The COOLDOWN here is the same one branch (i) uses, and deliberately NOT a `doesNotExist` one-shot.
 * `lastReconciledAt` is stamped as soon as Stripe answers — including when it answers "still open"
 * (ok:false) — and both jobs share one staleness threshold, so a row routinely gets stamped while it
 * is still LIVE and is retired by the sweep minutes later. A one-shot filter would then have sealed
 * it out of this branch forever: if the payer really did pay and the webhook was lost, that charge
 * would be invisible to the rollup, to both branches, to the sweep, and to every runbook query (the
 * stranded-money one looks for 'succeeded'; this row reads 'expired'). The 7-day window is what
 * bounds the branch; permanent exclusion was never needed for that.
 * @param {Date} windowStart - How far back this branch reaches.
 * @param {Date} cooldownThreshold - Rows reconciled before this may be asked about again.
 * @returns {Promise<object[]>} The retired candidates.
 */
async function retiredCandidates(windowStart, cooldownThreshold) {
  const base = () => {
    // queryAll, never queryExisting: these rows are soft-deleted BY DEFINITION.
    const q = BaseModel.queryAll('Payment');
    q.equalTo('channel', 'online');
    q.equalTo('gatewayStatus', 'expired');
    q.equalTo('retiredBySystem', true);
    q.equalTo('exists', false);
    q.greaterThan('createdAt', windowStart);
    return q;
  };
  const neverReconciled = base();
  neverReconciled.doesNotExist('lastReconciledAt');
  const cooledDown = base();
  cooledDown.lessThan('lastReconciledAt', cooldownThreshold);

  const query = Parse.Query.or(neverReconciled, cooledDown);
  query.limit(RECONCILE_BATCH_LIMIT);
  return query.find({ useMasterKey: true });
}

/**
 * Order the batch by lastReconciledAt ASCENDING, with never-reconciled rows FIRST.
 *
 * Never by age of creation: the rows that are stuck are by definition the oldest, so they would occupy
 * the head of every batch forever and permanently crowd out the candidates that still have recoverable
 * money behind them.
 * @param {object[]} rows - The union of both branches.
 * @returns {object[]} The same rows, ordered.
 * @example
 * orderBatch([...live, ...retired]);
 */
function orderBatch(rows) {
  const stamp = (p) => {
    const value = p.get && p.get('lastReconciledAt');
    const ms = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(ms) ? ms : -Infinity; // absent (or corrupt) sorts first
  };
  return [...rows].sort((a, b) => stamp(a) - stamp(b));
}

/**
 * Branch (iii): rows whose charge is confirmed but whose rollup could not be written.
 *
 * They need no provider call at all — the money is already settled locally, what failed was OUR
 * write. Recovery is simply re-running the rollup repair and clearing the marker, which also makes
 * this branch the lever an operator can pull by hand (set the marker, run the job).
 *
 * A diferencia de las otras dos, esta rama NO lleva enfriamiento, y es deliberado: una reparación no
 * consulta al proveedor, así que el enfriamiento —que existe para no machacar a Stripe— aquí solo
 * retrasaría seis horas un arreglo que puede hacerse de inmediato, dejando una alerta CRITICAL viva
 * todo ese rato.
 *
 * Lo que sí hereda es el ORDEN. repairRollup devuelve 'skipped' sobre una fila sin reservationPtr,
 * irreparable por definición, y esa fila conserva su marca para siempre. Sin ordenar, las
 * irreparables se acumulan y compiten por los mismos lugares del lote, desplazando candidatos con
 * dinero recuperable detrás — y son justamente las que nunca van a dejar de aparecer. Como el camino
 * de omisión ahora estampa `lastReconciledAt`, ordenar por ese cursor las manda al final de la fila
 * sin excluir a nadie: el arreglo es de prioridad, no de visibilidad.
 * @returns {Promise<object[]>} The rows awaiting a rollup repair, neediest first.
 */
async function rollupRepairCandidates() {
  // queryAll: a row can need a repair whether or not it is visible.
  const query = BaseModel.queryAll('Payment');
  query.equalTo('requiresRollupRepair', true);
  query.limit(RECONCILE_BATCH_LIMIT);
  return orderBatch(await query.find({ useMasterKey: true }));
}

/**
 * Whether what Stripe reported differs from what the Payment froze at creation time.
 *
 * ONLY meaningful for a 'succeeded' destination, and the caller enforces that: an expired/canceled
 * session legitimately reports an amount of 0, so running this check on one would raise a false alarm
 * on every single pass.
 *
 * A cent of tolerance, because both sides are rounded money and anything below that is float noise.
 * @param {object} payment - The local Payment.
 * @param {object} charge - The normalized getCharge result.
 * @returns {(object|null)} The discrepancy detail, or null when they agree.
 * @example
 * amountDiscrepancy(payment, charge); // { expectedAmount: 1000, reportedAmount: 1500, ... }
 */
function amountDiscrepancy(payment, charge) {
  const expectedAmount = Number(payment.get('origAmount'));
  const expectedCurrency = String(payment.get('origCurrency') || '').toUpperCase();
  const reportedAmount = charge.amountReceived;
  const reportedCurrency = String(charge.currency || '').toUpperCase();

  // An unusable reported amount is not a discrepancy: getCharge already refused it, and inventing a
  // mismatch out of "we could not tell" would cry wolf on every pass.
  if (typeof reportedAmount !== 'number') return null;
  if (!Number.isFinite(expectedAmount)) return null;

  const amountDiffers = Math.abs(expectedAmount - reportedAmount) > 0.01;
  const currencyDiffers = !!reportedCurrency && reportedCurrency !== expectedCurrency;
  if (!amountDiffers && !currencyDiffers) return null;

  return {
    expectedAmount, expectedCurrency, reportedAmount, reportedCurrency,
  };
}

/**
 * Report a discrepancy WITHOUT ever correcting it, and build the evidence to persist.
 *
 * The transition itself still proceeds — the money did arrive, and blocking it would leave the
 * reservation showing a balance for a charge that really happened, which is worse. What never happens
 * is rewriting amount/origAmount/origCurrency: correcting a gateway charge is a refund authorized by
 * Amexing (PR11), never a job silently re-pricing a money record. Level `error`, not `warn`, because a
 * human has to look before anyone trusts the displayed balance.
 * @param {object} payment - The local Payment.
 * @param {object} charge - The normalized getCharge result.
 * @returns {object} Extra fields to persist inside the confirmation write ({} when they agree).
 * @example
 * const extra = reportDiscrepancy(payment, charge);
 */
function reportDiscrepancy(payment, charge) {
  const discrepancy = amountDiscrepancy(payment, charge);
  if (!discrepancy) return {};

  logger.error('AMOUNT/CURRENCY MISMATCH between Stripe and the stored gateway payment; the charge is confirmed as-is and NOTHING monetary is rewritten (a correction is a refund authorized by Amexing, never an automatic edit)', {
    paymentId: payment.id, ...discrepancy,
  });
  return {
    // gatewayRaw is PCI-safe (already redacted) and never serialized to a client: it is the audit
    // trail a human needs to resolve this by hand.
    gatewayRaw: { ...charge.raw, discrepancy },
  };
}

/**
 * Reconcile ONE candidate against Stripe.
 * @param {object} payment - The candidate Payment.
 * @returns {Promise<string>} What happened: 'confirmed' | 'applied' | 'pending' | 'skipped'.
 */
async function reconcileOne(payment) {
  // Another provider's row landing in this batch is skipped, never crashed on: getCharge is Stripe's.
  if (payment.get('gateway') && payment.get('gateway') !== 'stripe') return 'skipped';

  const gatewaySessionId = payment.get('gatewaySessionId') || '';
  const gatewayIntentId = payment.get('gatewayIntentId') || '';
  if (!gatewaySessionId && !gatewayIntentId) {
    // The residual of a checkout whose rollback failed before any id was persisted. There is nothing
    // to ask Stripe about, and asking with two empty ids would be a guaranteed provider error.
    logger.warn('Reconciliation candidate has no Stripe session or intent id; nothing can be looked up (left for manual review)', {
      paymentId: payment.id,
    });
    return 'skipped';
  }

  const charge = await stripeAdapter().getCharge({ gatewaySessionId, gatewayIntentId });
  // Stamped as soon as the provider answered — and only then, so a row whose lookup FAILED stays at
  // the head of the next batch instead of being silently parked for the cooldown. Both branches
  // treat the stamp as a cooldown, never as a permanent exclusion, so a row parked here always
  // comes back.
  await stampReconciled(payment.id);

  if (!charge.ok) {
    // For a LIVE row this is ordinary (its session is simply still open). For a RETIRED one it is
    // not: its session is long dead, so "no terminal answer" means we still cannot tell whether that
    // money moved. The aggregated `pending` counter cannot tell the two apart, so this row says so.
    if (payment.get('exists') === false) {
      logger.warn('A retired online payment could not be resolved against the provider (no terminal answer); it stays in the reconciliation window and will be retried after the cooldown', {
        paymentId: payment.id,
      });
    }
    return 'pending';
  }

  const isSuccess = charge.gatewayStatus === 'succeeded';
  const extraSet = {
    ...(isSuccess ? reportDiscrepancy(payment, charge) : {}),
    ...(charge.gatewayChargeId ? { gatewayChargeId: charge.gatewayChargeId } : {}),
    ...(charge.gatewayIntentId ? { gatewayIntentId: charge.gatewayIntentId } : {}),
  };

  const outcome = await applyConfirmation({
    payment,
    destination: { gatewayStatus: charge.gatewayStatus, crossesThreshold: charge.crossesThreshold },
    source: 'reconciliation',
    extraSet,
    logContext: { paymentId: payment.id },
  });
  if (!outcome.applied) return 'pending';
  return isSuccess ? 'confirmed' : 'applied';
}

/**
 * Repair ONE row whose rollup failed after its charge was confirmed.
 *
 * recalculateIfStale, not recalculate: it writes only when the persisted rollup really differs, so a
 * marker left behind by an attempt that actually succeeded on a later retry costs one comparison and
 * no write. The marker is cleared only on success — a repair that fails again keeps it.
 * @param {object} payment - The flagged Payment.
 * @returns {Promise<string>} 'repaired' | 'skipped'.
 */
async function repairRollup(payment) {
  const reservationPtr = payment.get('reservationPtr');
  const reservationId = reservationPtr && reservationPtr.id;
  if (!reservationId) {
    // Se estampa el cursor TAMBIÉN en el camino de omisión. Sin esto, una fila irreparable conserva
    // su marca para siempre y esta rama, que ordena y limita como las otras, la vuelve a traer en
    // CADA corrida: las irreparables se acumulan y compiten por los mismos lugares del lote,
    // desplazando candidatos que sí tienen dinero recuperable detrás. El estampado es un
    // enfriamiento, no una exclusión — la fila vuelve, solo que al final de la fila y no siempre.
    await stampReconciled(payment.id);
    logger.error('A payment flagged for rollup repair has no reservationPtr; it cannot be repaired automatically (parked for the cooldown so it stops crowding out real candidates)', {
      paymentId: payment.id,
    });
    return 'skipped';
  }

  await PaymentService.recalculateIfStale(reservationId);
  await flagRollupRepair(payment.id, false);
  logger.info('Repaired the reservation rollup of a gateway charge whose original rollup had failed', {
    paymentId: payment.id, reservationId,
  });
  return 'repaired';
}

/**
 * Reconcile online payments whose webhook never arrived, or arrived and was lost.
 *
 * The candidate set is a UNION of three branches: rows still live and stale, rows the sweep itself
 * retired, and rows whose charge is confirmed but whose rollup failed. Every candidate is processed
 * independently: a failure on one is logged and the batch continues, because a single unreadable row
 * must never block the recovery of the others.
 * @param {object} [options] - Options.
 * @param {Date} [options.now] - Reference instant (tests).
 * @returns {Promise<object>} { scanned, live, retired, rollupRepair, confirmed, applied, pending,
 * repaired, skipped, failed }.
 * @example
 * const stats = await reconcileStalePayments();
 */
async function reconcileStalePayments(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  // The SAME threshold the sweep uses: before it, a live row is simply a checkout in progress.
  const ageThreshold = sweepThreshold(now);
  const cooldownThreshold = new Date(now.getTime() - RECONCILE_COOLDOWN_MS);
  const windowStart = new Date(now.getTime() - RECONCILE_RETIRED_WINDOW_MS);

  const [live, retired, rollupRepair] = await Promise.all([
    liveCandidates(ageThreshold, cooldownThreshold),
    retiredCandidates(windowStart, cooldownThreshold),
    rollupRepairCandidates(),
  ]);
  // A row flagged for repair could also match another branch; process it once, as a repair.
  const flagged = new Set(rollupRepair.map((p) => p.id));
  const batch = orderBatch([...live, ...retired].filter((p) => !flagged.has(p.id)));

  const stats = {
    scanned: batch.length + rollupRepair.length,
    live: live.length,
    retired: retired.length,
    rollupRepair: rollupRepair.length,
    confirmed: 0,
    applied: 0,
    pending: 0,
    repaired: 0,
    skipped: 0,
    failed: 0,
  };
  // Repairs first: they move no money, need no provider call, and clear a CRITICAL alert.
  for (const payment of rollupRepair) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await repairRollup(payment);
      stats[outcome] += 1;
    } catch (err) {
      stats.failed += 1;
      logger.error('Could not repair the rollup of a flagged gateway payment; it stays flagged and the batch continues', {
        paymentId: payment.id, error: err && err.message,
      });
    }
  }
  for (const payment of batch) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await reconcileOne(payment);
      stats[outcome] += 1;
    } catch (err) {
      stats.failed += 1;
      logger.error('Could not reconcile an online payment; the rest of the batch continues', {
        paymentId: payment.id, error: err && err.message,
      });
    }
  }

  logger.info('Online payment reconciliation finished', stats);
  return stats;
}

module.exports = {
  sweepExpiredOnlinePayments,
  reconcileStalePayments,
  sweepThreshold,
  amountDiscrepancy,
  orderBatch,
  SWEEP_SAFETY_MARGIN_MS,
  RECONCILE_COOLDOWN_MS,
  RECONCILE_RETIRED_WINDOW_MS,
  SWEEP_BATCH_LIMIT,
  RECONCILE_BATCH_LIMIT,
};
