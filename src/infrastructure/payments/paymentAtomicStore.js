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

  // mongodb@6 returns the document directly; older drivers wrap it in { value }. Handle both so a
  // driver bump can never silently turn a real transition into "matchedCount 0" (which would skip
  // the rollup recalculation and leave a paid reservation showing a balance).
  const updatedDoc = result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result;
  return { matchedCount: updatedDoc ? 1 : 0, updatedDoc: updatedDoc || null };
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

module.exports = { atomicTransitionPayment, setDbForTests, closeForTests };
