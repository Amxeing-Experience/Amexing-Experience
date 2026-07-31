/**
 * paymentAtomicStore - CONDITIONAL, atomic state transition of a Payment row (webhook Capa B).
 *
 * Why it bypasses the Parse SDK: Parse offers no conditional write (there is no Parse.Object.save()
 * equivalent of findOneAndUpdate with a filter on the current value). Doing it "the obvious way" —
 * query the Payment, compare gatewayStatus in JavaScript, then .save() — is a read-then-write race:
 * two near-simultaneous deliveries (or the future defensive polling of PR6) can both read the same
 * stale 'requires_payment' before either writes, and both would then believe they won the transition
 * and fire PaymentService.recalculate. The filter has to live INSIDE the write, at the database, which
 * is what this module does. Precedent for dropping to the driver already exists in the repo: the
 * GatewayEvent unique index in scripts/seeds/026-create-gatewayevent-class.js.
 *
 * Connection handling follows stripeClient.js, NOT healthCheck.js: a LAZY singleton built once and
 * reused by every webhook. healthCheck opens a fresh MongoClient per ping, which is acceptable for a
 * diagnostic but not on a path that must answer inside Stripe's 20s budget under load. The cached
 * value is the CONNECT PROMISE (not the client), so two concurrent webhooks arriving before the first
 * connect resolves share that one connect instead of racing two of them.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

// Parse stores each class in a same-named Mongo collection (no collectionPrefix configured).
const PAYMENT_COLLECTION = 'Payment';

// Bounded, so a Mongo blip surfaces as a 500 (Stripe retries) instead of hanging past the 20s budget.
const SERVER_SELECTION_TIMEOUT_MS = 10000;

// Cached CONNECT promise + the client it produced (kept for close()). Never one connection per request.
let connectPromise = null;
let cachedClient = null;

// Test seam: an injected Db short-circuits the singleton entirely.
let injectedDb = null;

/**
 * Resolve the Mongo Db handle: the injected test Db, or the lazily-built cached singleton.
 * @returns {Promise<object>} A connected mongodb Db handle.
 * @throws {Error} When DATABASE_URI is not configured.
 */
async function getDb() {
  if (injectedDb) return injectedDb;

  if (!connectPromise) {
    const uri = typeof process.env.DATABASE_URI === 'string' ? process.env.DATABASE_URI.trim() : '';
    if (!uri) throw new Error('paymentAtomicStore: DATABASE_URI is not configured');
    // Lazy require, same reasoning as stripeClient: nothing is pulled in until a real transition runs.
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS });
    connectPromise = client.connect()
      .then((connected) => {
        cachedClient = connected;
        return connected;
      })
      .catch((err) => {
        // A failed connect must NOT poison the cache forever: drop it so the next webhook retries.
        connectPromise = null;
        cachedClient = null;
        throw err;
      });
  }

  const client = await connectPromise;
  return process.env.DATABASE_NAME ? client.db(process.env.DATABASE_NAME) : client.db();
}

/**
 * Normalize what findOneAndUpdate returned into { matchedCount, updatedDoc }.
 *
 * mongodb@6 returns the document directly; older drivers wrap it in { value, lastErrorObject, ok }.
 * Discriminate on 'lastErrorObject'/'ok' — fields that belong ONLY to the legacy wrapper and never to
 * a Payment document — rather than on 'value': a Payment that ever grew its own field literally named
 * 'value' would make a 'value'-based check misread the whole document as the wrapper, silently
 * turning a real write into "matchedCount 0" (which would skip the rollup recalculation and leave a
 * paid reservation showing a balance).
 * @param {*} result - Whatever the driver returned.
 * @returns {{matchedCount: number, updatedDoc: (object|null)}} The normalized outcome.
 */
function normalizeResult(result) {
  const isLegacyWrapper = !!result
    && (Object.prototype.hasOwnProperty.call(result, 'lastErrorObject')
      || Object.prototype.hasOwnProperty.call(result, 'ok'));
  const updatedDoc = isLegacyWrapper ? result.value : result;
  return { matchedCount: updatedDoc ? 1 : 0, updatedDoc: updatedDoc || null };
}

/**
 * Atomically move a Payment to `toStatus` ONLY IF its current gatewayStatus is one of `fromStatuses`.
 *
 * The filter is part of the write, so exactly one of N concurrent callers can ever match: the winner
 * gets matchedCount 1, every loser gets 0 and must treat it as a clean no-op (never a retry, never an
 * error). That single boolean — "did the document actually change?" — is what the caller keys the
 * recalculate decision on, instead of the event type, which is what makes the convergence of
 * checkout.session.completed + payment_intent.succeeded fire the rollup exactly once.
 * @param {string} paymentId - Parse objectId of the Payment (its Mongo _id).
 * @param {object} options - Transition options.
 * @param {string[]} options.fromStatuses - Allowed CURRENT statuses (the monotonic guard).
 * @param {string} options.toStatus - Destination gatewayStatus.
 * @param {object} [options.extraSet] - Extra fields to set alongside (e.g. { confirmedAt: new Date() }).
 * Cannot override gatewayStatus: the destination is applied last, on purpose.
 * @returns {Promise<{matchedCount: number, updatedDoc: (object|null)}>} 1/the new doc when the
 * transition applied, 0/null when it did not.
 * @example
 * await atomicTransitionPayment(id, { fromStatuses: ['requires_payment'], toStatus: 'succeeded' });
 */
async function atomicTransitionPayment(paymentId, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const fromStatuses = Array.isArray(opts.fromStatuses) ? opts.fromStatuses : [];
  const toStatus = String(opts.toStatus || '');
  if (!paymentId || fromStatuses.length === 0 || !toStatus) {
    throw new Error('paymentAtomicStore: paymentId, fromStatuses and toStatus are required');
  }

  const db = await getDb();
  const updates = {
    ...(opts.extraSet && typeof opts.extraSet === 'object' ? opts.extraSet : {}),
    // Applied LAST so a caller-supplied extraSet can never rewrite the destination status.
    gatewayStatus: toStatus,
    // Parse's updatedAt lives in _updated_at; keeping it in sync means a Parse read of this row does
    // not look untouched after a driver-level write.
    _updated_at: new Date(),
  };

  const result = await db.collection(PAYMENT_COLLECTION).findOneAndUpdate(
    { _id: String(paymentId), gatewayStatus: { $in: fromStatuses } },
    { $set: updates },
    { returnDocument: 'after' }
  );

  return normalizeResult(result);
}

/**
 * Statuses a pending online Payment may legally be RETIRED from. Fixed inside this module and
 * deliberately NOT a parameter: 'processing' is excluded because expiresAt is stamped once at
 * creation and never refreshed, so every 'processing' row satisfies the sweep threshold by
 * construction — retiring one would be retiring money that is still in flight at the provider.
 * @type {readonly string[]}
 */
const RETIRABLE_STATUSES = Object.freeze(['requires_payment']);

/**
 * Atomically retire a pending online Payment: terminal status + soft-delete + the housekeeping
 * marker, in ONE conditional write.
 *
 * It replaces the old setGatewayStatus('expired') + softDelete(userId) pair, which was a
 * fetch-then-save: between the read and the save a webhook could confirm the very same row, and the
 * save would then push a 'succeeded' charge back to 'expired' + exists:false — money the rollup can
 * no longer see. Here the source-status filter lives inside the write, so a row that has already
 * moved on simply matches nothing (matchedCount 0), which every caller must treat as a clean no-op.
 *
 * `retiredBySystem:true` is the whole point of routing both housekeeping callers through here: it is
 * what later authorizes reviveIfSystemRetired to bring the row back if the card really cleared. A
 * deliberate staff delete never passes through this function and therefore never gets the marker.
 * `deletedBy` is intentionally NOT set — there is no user behind housekeeping, and its absence next
 * to a present deletedAt is a second, independent trace of an automatic retirement.
 *
 * `exists:true` is part of the filter for that same reason, and it is not decoration.
 * PaymentController.deletePayment reaches a LIVE pending (its loadPayment filters exists:true), so a
 * staff delete landing while this function's expireCheckout call is still in flight would otherwise
 * find the row still at 'requires_payment' and stamp retiredBySystem:true on top of it — turning a
 * deliberate human deletion into something the revive is authorized to resurrect. Filtering on
 * exists:true makes that a clean no-op instead: there is genuinely nothing left to retire.
 * @param {string} paymentId - Parse objectId of the Payment (its Mongo _id).
 * @returns {Promise<{matchedCount: number, updatedDoc: (object|null)}>} 1/the new doc when the row
 * was retired, 0/null when it had already moved past 'requires_payment' or was already deleted.
 * @example
 * const { matchedCount } = await atomicRetirePayment(pending.id); // 0 => already confirmed, leave it
 */
async function atomicRetirePayment(paymentId) {
  if (!paymentId) throw new Error('paymentAtomicStore: paymentId is required');

  const now = new Date();
  const db = await getDb();
  const result = await db.collection(PAYMENT_COLLECTION).findOneAndUpdate(
    { _id: String(paymentId), gatewayStatus: { $in: [...RETIRABLE_STATUSES] }, exists: true },
    {
      $set: {
        gatewayStatus: 'expired',
        exists: false,
        active: false,
        deletedAt: now,
        retiredBySystem: true,
        _updated_at: now,
      },
    },
    { returnDocument: 'after' }
  );
  return normalizeResult(result);
}

/**
 * Atomically bring back a Payment that OUR housekeeping soft-deleted, once its charge is confirmed.
 *
 * PaymentService reads payments through queryExisting (exists:true), so a retired row stays out of
 * paidAmount/balance forever even though the card cleared. This is the only sanctioned way back in,
 * and it is gated by `retiredBySystem:true`: a row staff deleted on purpose has no such marker, so
 * the filter matches nothing and the deliberate decision stands (the caller shouts instead).
 *
 * BaseModel.restore() is deliberately NOT used: it leaves the record active:false, it is a
 * fetch-then-save on a row three other paths may be writing to in the same window, and it unsets
 * deletedAt/deletedBy — erasing exactly the audit trail you want to keep on a money row that was
 * retired and then resurrected. Those two stamps are kept here on purpose.
 * @param {string} paymentId - Parse objectId of the Payment.
 * @returns {Promise<{matchedCount: number, updatedDoc: (object|null)}>} 1/the new doc when the row
 * was revived, 0/null when there was nothing to revive (never retired, already back, or deliberate).
 * @example
 * const { matchedCount } = await reviveIfSystemRetired(payment.id); // 1 => it is visible again
 */
async function reviveIfSystemRetired(paymentId) {
  if (!paymentId) throw new Error('paymentAtomicStore: paymentId is required');

  const db = await getDb();
  const result = await db.collection(PAYMENT_COLLECTION).findOneAndUpdate(
    { _id: String(paymentId), retiredBySystem: true, exists: false },
    {
      $set: {
        exists: true, active: true, retiredBySystem: false, _updated_at: new Date(),
      },
    },
    { returnDocument: 'after' }
  );
  return normalizeResult(result);
}

/**
 * Stamp the reconciliation cursor on a Payment (unconditional on status, filtered by _id).
 *
 * Written ONLY after the provider actually answered, so a row whose lookup failed stays at the head
 * of the next batch instead of being silently parked. It touches no money field and no lifecycle
 * field, so it can never interfere with a transition racing it.
 * @param {string} paymentId - Parse objectId of the Payment.
 * @param {Date} [at] - The timestamp to record (defaults to now).
 * @returns {Promise<{matchedCount: number, updatedDoc: (object|null)}>} 1 when the row exists.
 * @example
 * await stampReconciled(payment.id);
 */
async function stampReconciled(paymentId, at = new Date()) {
  if (!paymentId) throw new Error('paymentAtomicStore: paymentId is required');

  const db = await getDb();
  const result = await db.collection(PAYMENT_COLLECTION).findOneAndUpdate(
    { _id: String(paymentId) },
    { $set: { lastReconciledAt: at, _updated_at: new Date() } },
    { returnDocument: 'after' }
  );
  return normalizeResult(result);
}

/**
 * Set ONE boolean audit marker on a Payment, filtered by _id only.
 *
 * Shared by the two markers below rather than exposed: a generic "set any field" on a money table is
 * exactly the shape that turns into mass-assignment later, so the field name is never a caller's
 * choice — each marker gets its own named, greppable function.
 * @param {string} paymentId - Parse objectId of the Payment.
 * @param {string} field - The marker column.
 * @param {boolean} value - The value to store.
 * @returns {Promise<{matchedCount: number, updatedDoc: (object|null)}>} 1 when the row exists.
 */
async function setMarker(paymentId, field, value) {
  if (!paymentId) throw new Error('paymentAtomicStore: paymentId is required');

  const db = await getDb();
  const result = await db.collection(PAYMENT_COLLECTION).findOneAndUpdate(
    { _id: String(paymentId) },
    { $set: { [field]: value, _updated_at: new Date() } },
    { returnDocument: 'after' }
  );
  return normalizeResult(result);
}

/**
 * Flag a Payment as needing a refund review (a charge that landed on an already-cancelled
 * reservation). A one-way audit marker, never a state machine.
 * @param {string} paymentId - Parse objectId of the Payment.
 * @returns {Promise<{matchedCount: number, updatedDoc: (object|null)}>} 1 when the row exists.
 * @example
 * await flagRefundReview(payment.id);
 */
function flagRefundReview(paymentId) {
  return setMarker(paymentId, 'requiresRefundReview', true);
}

/**
 * Flag a Payment whose charge was confirmed but whose reservation rollup then FAILED to be written.
 *
 * That state is the one hole the atomic transition cannot close by itself: the row is already
 * 'succeeded' and visible, so it matches no reconciliation branch and no runbook query, yet the
 * reservation still shows a balance for money that was really collected. The marker is what makes it
 * findable — and, because the reconciliation treats it as its own candidate branch, self-healing.
 * @param {string} paymentId - Parse objectId of the Payment.
 * @param {boolean} [value] - False clears it once the rollup has been repaired.
 * @returns {Promise<{matchedCount: number, updatedDoc: (object|null)}>} 1 when the row exists.
 * @example
 * await flagRollupRepair(payment.id); // and flagRollupRepair(id, false) once repaired
 */
function flagRollupRepair(paymentId, value = true) {
  return setMarker(paymentId, 'requiresRollupRepair', value === true);
}

/**
 * Inject a Db handle (tests). Passing a falsy value clears the injection. TEST SEAM ONLY.
 * @param {(object|null)} db - The Db double, or null to clear.
 */
function setDbForTests(db) {
  injectedDb = db || null;
}

/**
 * Close the cached client and drop all cached state (test hygiene / graceful shutdown).
 * @returns {Promise<void>} Resolves once the client is closed.
 */
async function closeForTests() {
  injectedDb = null;
  const client = cachedClient;
  connectPromise = null;
  cachedClient = null;
  if (client) await client.close();
}

/**
 * Rellena el id de cargo de la pasarela SOLO si la fila todavía no lo tiene.
 *
 * Existe por la rama ambigua de applyConfirmation: cuando un evento hermano ya llevó la fila al
 * destino, el update condicional no matchea y el `extraSet` del llamador se descarta entero. Si el
 * polling es el único camino que conoce el `gatewayChargeId` y el webhook ganó la carrera, ese id no
 * se guardaba nunca — y es el dato que PR11 necesita para poder reembolsar.
 *
 * Función propia y nombrada en vez de un "set any field" genérico, por la misma razón que setMarker:
 * el nombre del campo jamás es elección del llamador en una tabla de dinero. El filtro exige que el
 * campo esté ausente, así que NUNCA pisa un id ya escrito.
 * @param {string} paymentId - Parse objectId of the Payment.
 * @param {string} gatewayChargeId - El id de cargo a guardar.
 * @returns {Promise<{matchedCount: number, updatedDoc: (object|null)}>} 1 cuando lo rellenó.
 * @example
 * await backfillChargeId(payment.id, 'ch_1abc'); // matchedCount 0 si ya tenía uno
 */
async function backfillChargeId(paymentId, gatewayChargeId) {
  if (!paymentId) throw new Error('paymentAtomicStore: paymentId is required');
  if (!gatewayChargeId) return { matchedCount: 0, updatedDoc: null };

  const db = await getDb();
  const result = await db.collection(PAYMENT_COLLECTION).findOneAndUpdate(
    { _id: String(paymentId), gatewayChargeId: { $in: [null, ''] } },
    { $set: { gatewayChargeId: String(gatewayChargeId), _updated_at: new Date() } },
    { returnDocument: 'after' }
  );
  return normalizeResult(result);
}

module.exports = {
  atomicTransitionPayment,
  atomicRetirePayment,
  backfillChargeId,
  reviveIfSystemRetired,
  stampReconciled,
  flagRefundReview,
  flagRollupRepair,
  setDbForTests,
  closeForTests,
  RETIRABLE_STATUSES,
};
