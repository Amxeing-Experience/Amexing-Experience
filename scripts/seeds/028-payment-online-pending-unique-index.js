/* eslint-disable no-underscore-dangle, jsdoc/check-indentation */
// no-underscore-dangle: Mongo/Parse internal fields (_id, _p_reservationPtr, _updated_at) are
// unavoidable when deduping/indexing through the raw Mongo driver (the reason this seed exists —
// Parse.Schema cannot create a partial unique index). check-indentation: the header uses inline
// braces like { key: 1 } that the rule misreads as indentation.
/**
 * Seed 028 - Partial unique index on Payment (one pending online charge per reservation)
 *
 * Anti-double-submit at the DATABASE level for online card checkout (plan seccion 6.3, roadmap
 * PR 4). The app-side withReservationLock only protects a single Node process; under PM2 cluster
 * (production/staging run instances:'max', exec_mode:'cluster') two workers can still race the same
 * reservation and each open a Checkout Session -> a real DOUBLE CHARGE. This index closes that gap
 * atomically: at most one Payment per reservation may have channel:'online' AND
 * gatewayStatus:'requires_payment' AND exists:true at a time.
 *
 * PARTIAL unique index on { _p_reservationPtr: 1 } with
 * partialFilterExpression { channel:'online', gatewayStatus:'requires_payment', exists:true } —
 * NOT a full unique index. Manual payments (no `channel`) and any non-pending/soft-deleted online
 * payment fall OUTSIDE the filter, so a reservation can still have many manual payments, past
 * succeeded/expired online charges, and exactly one live pending. The checkout controller catches
 * the DUPLICATE_VALUE this raises and reuses the existing pending.
 *
 * `_p_reservationPtr` is Parse's Mongo storage for the `reservationPtr` Pointer column
 * ("Reservation$<objectId>"). Created directly via the Mongo driver, same reason as seeds 026/027:
 * Parse.Schema.addIndex in parse-server 9 drops both the `unique` flag and partialFilterExpression.
 *
 * Idempotent: dedupe is a no-op when there are no live-pending duplicates; createIndex with an
 * identical spec + name is a no-op. Fatal on failure (re-throw), same contract as seeds 026/027 —
 * the shared seed-runner only records 'failed' when run() throws.
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2026-07-27
 */

const logger = require('../../src/infrastructure/logger');

const SEED_NAME = '028-payment-online-pending-unique-index';
const VERSION = '1.0.0';
const CLASS_NAME = 'Payment';
const UNIQUE_INDEX_NAME = 'payment_online_pending_unique';
const RESERVATION_PTR_FIELD = '_p_reservationPtr';
const PARTIAL_FILTER = { channel: 'online', gatewayStatus: 'requires_payment', exists: true };

/**
 * Collapse duplicate LIVE-pending online rows per reservation down to one, keeping the most
 * recently updated and soft-deleting (exists:false, active:false, gatewayStatus:'expired') the
 * rest. MUST run before the unique index is created, or createIndex fails on pre-existing
 * duplicates. A pending online Payment never counts in the rollup, so soft-deleting a duplicate
 * pending moves no money — the losers are retired exactly as the TTL sweep (PR6) would.
 * @param {import('mongodb').Db} db - Connected Mongo Db handle (the DB that backs Parse).
 * @param {string} [collectionName] - Collection to dedupe (defaults to the Payment class name).
 * @returns {Promise<{keysDeduped: number, rowsSoftDeleted: number}>} What the dedupe changed.
 * @example
 * await dedupePendingOnlinePayments(client.db());
 */
async function dedupePendingOnlinePayments(db, collectionName = CLASS_NAME) {
  const collection = db.collection(collectionName);
  const dups = await collection.aggregate([
    { $match: PARTIAL_FILTER },
    { $group: { _id: `$${RESERVATION_PTR_FIELD}`, ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  let rowsSoftDeleted = 0;
  for (const group of dups) {
    const rows = await collection
      .find({ ...PARTIAL_FILTER, [RESERVATION_PTR_FIELD]: group._id })
      .sort({ _updated_at: -1, _id: -1 })
      .toArray();
    const losers = rows.slice(1); // keep rows[0] (newest), retire the rest
    for (const loser of losers) {
      await collection.updateOne(
        { _id: loser._id },
        {
          $set: {
            exists: false, active: false, gatewayStatus: 'expired', _updated_at: new Date(),
          },
        }
      );
      rowsSoftDeleted += 1;
    }
    logger.warn(`[${SEED_NAME}] Deduped pending online for "${group._id}": kept 1, retired ${losers.length}`);
  }
  return { keysDeduped: dups.length, rowsSoftDeleted };
}

/**
 * Create the PARTIAL unique index on { _p_reservationPtr: 1 } (live-pending online only) directly
 * via the Mongo driver. Exported so tests (and any future reader) can guarantee the same index
 * against any Mongo Db (e.g. the jest mongodb-memory-server). Idempotent: an identical spec + name
 * is a no-op.
 * @param {import('mongodb').Db} db - Connected Mongo Db handle.
 * @param {string} [collectionName] - Collection to index (defaults to the Payment class name).
 * @returns {Promise<string>} The created/existing index name.
 * @example
 * await ensurePaymentPendingUniqueIndex(client.db());
 */
async function ensurePaymentPendingUniqueIndex(db, collectionName = CLASS_NAME) {
  const collection = db.collection(collectionName);
  const name = await collection.createIndex(
    { [RESERVATION_PTR_FIELD]: 1 },
    { unique: true, name: UNIQUE_INDEX_NAME, partialFilterExpression: PARTIAL_FILTER }
  );
  return name;
}

/**
 * Post-creation verification: confirm the partial unique index actually exists with the exact key,
 * unique flag, and partialFilterExpression. Throws a fatal error if missing — the seed must never
 * report success without real DB-level anti-double-submit.
 * @param {import('mongodb').Db} db - Connected Mongo Db handle.
 * @param {string} [collectionName] - Collection to inspect (defaults to the Payment class name).
 * @returns {Promise<string>} The verified index name.
 * @example
 * await assertPaymentPendingUniqueIndex(client.db());
 */
async function assertPaymentPendingUniqueIndex(db, collectionName = CLASS_NAME) {
  const indexes = await db.collection(collectionName).indexes();
  const found = indexes.find((i) => i.unique === true
    && i.key
    && i.key[RESERVATION_PTR_FIELD] === 1
    && Object.keys(i.key).length === 1
    && i.partialFilterExpression
    && i.partialFilterExpression.channel === 'online'
    && i.partialFilterExpression.gatewayStatus === 'requires_payment'
    && i.partialFilterExpression.exists === true);
  if (!found) {
    throw new Error(
      `[${SEED_NAME}] FATAL: partial unique index on { ${RESERVATION_PTR_FIELD}:1 } `
      + '(channel:online, gatewayStatus:requires_payment, exists:true) is NOT present on '
      + `${collectionName} after creation — online double-charge protection would be unenforced. Aborting seed.`
    );
  }
  return found.name;
}

/**
 * Ensure the index against the DB from DATABASE_URI (dedupe first, then create + verify).
 * @returns {Promise<{keysDeduped: number, rowsSoftDeleted: number}>} Dedupe stats.
 */
async function ensureFromEnv() {
  const uri = process.env.DATABASE_URI;
  if (!uri) throw new Error('DATABASE_URI not set; cannot create the Payment pending-online unique index');

  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const db = process.env.DATABASE_NAME ? client.db(process.env.DATABASE_NAME) : client.db();
    const stats = await dedupePendingOnlinePayments(db);
    const name = await ensurePaymentPendingUniqueIndex(db);
    // Fail loud if the index did not end up as specified — the whole point of the seed.
    await assertPaymentPendingUniqueIndex(db);
    logger.info(`[${SEED_NAME}] Partial unique index ensured + verified on ${CLASS_NAME}: ${name}`, stats);
    return stats;
  } finally {
    await client.close();
  }
}

/**
 * Run the seed.
 * @returns {Promise<object>} Seed result with statistics.
 */
async function run() {
  const startTime = Date.now();
  logger.info(`[${SEED_NAME}] Starting seed execution...`);

  try {
    const stats = await ensureFromEnv();
    const duration = Date.now() - startTime;
    logger.info(`[${SEED_NAME}] Seed completed successfully`, { duration: `${duration}ms`, ...stats });
    return {
      success: true, seedName: SEED_NAME, version: VERSION, statistics: stats, duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`[${SEED_NAME}] Seed execution failed`, { error: error.message, duration: `${duration}ms` });
    // RE-THROW: the seed-runner ignores result.success and only records 'failed' when run() throws.
    throw error;
  }
}

// Export for seed runner + tests. The index/dedupe helpers are reused directly against the jest
// memory Parse/Mongo.
module.exports = {
  run,
  seedName: SEED_NAME,
  version: VERSION,
  description: 'Create a partial unique index on Payment (one pending online charge per reservation)',
  dedupePendingOnlinePayments,
  ensurePaymentPendingUniqueIndex,
  assertPaymentPendingUniqueIndex,
  UNIQUE_INDEX_NAME,
};

// Allow direct execution for testing.
if (require.main === module) {
  const Parse = require('parse/node');
  const envName = ['development', 'staging', 'production'].includes(process.env.NODE_ENV)
    ? process.env.NODE_ENV
    : 'development';
  require('dotenv').config({
    path: require('path').join(__dirname, `../../environments/.env.${envName}`),
  });
  Parse.initialize(
    process.env.PARSE_APP_ID || 'amexing-app-id',
    null,
    process.env.PARSE_MASTER_KEY
  );
  Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

  run()
    .then((result) => {
      console.log('Seed result:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error('Seed failed:', error);
      process.exit(1);
    });
}
