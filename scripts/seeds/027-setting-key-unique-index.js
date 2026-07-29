/* eslint-disable no-underscore-dangle, jsdoc/check-indentation */
// no-underscore-dangle: Mongo/Parse internal fields (_id, _created_at, _updated_at) are unavoidable
// when deduping/sorting through the raw Mongo driver (the reason this seed exists — Parse.Schema
// cannot create a partial unique index). check-indentation: the detailed header below uses inline
// braces like { key: 1 } that the rule misreads as indentation.
/**
 * Seed 027 - Unique index on Setting.key (active rows only)
 *
 * Hardening flagged during PR 3 review: Setting.key had NO database-level uniqueness, so the
 * find-then-create path in SettingsController / seed 008 could, under a race (two concurrent PUTs,
 * or a PUT racing the first seed) or a rollback+re-run, leave TWO active rows for the same key,
 * making Setting.findByKey().first() non-deterministic. For a money-routing key like
 * activePaymentGateway (PR 3) that means reading the wrong toggle. This seed closes it at the DB
 * level, the only place a check-then-act app guard cannot (Setting.isKeyUnique is not atomic).
 *
 * PARTIAL unique index on { key: 1 } with partialFilterExpression { exists: true } — deliberately
 * NOT a full unique index (unlike migration 004's licensePlate_unique). The Setting soft-delete /
 * rollback pattern (seed 008 rollback sets exists:false, a later re-run creates a fresh exists:true
 * row with the SAME key) legitimately keeps a soft-deleted row and an active row sharing one key; a
 * FULL unique index would reject that. The partial index enforces uniqueness ONLY among active
 * (exists:true) rows — exactly the set the app reads via findByKey (which filters exists:true) —
 * so it preserves the rollback pattern while killing the non-deterministic active duplicate.
 *
 * Created directly via the Mongo driver, same reason as seed 026: Parse.Schema.addIndex in
 * parse-server 9 drops both the `unique` flag and partialFilterExpression.
 *
 * Idempotent: dedupe is a no-op when there are no active duplicates; createIndex with an identical
 * spec + name is a no-op if the index already exists. Fatal on failure (re-throw), same contract as
 * seed 026 — the shared seed-runner only records 'failed' when run() throws.
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2026-07-28
 */

const logger = require('../../src/infrastructure/logger');

const SEED_NAME = '027-setting-key-unique-index';
const VERSION = '1.0.0';
const CLASS_NAME = 'Setting';
const UNIQUE_INDEX_NAME = 'setting_key_unique_active';
const PARTIAL_FILTER = { exists: true };

/**
 * Collapse active (exists:true) duplicate rows per key down to one, keeping the most recently
 * updated and soft-deleting (exists:false, active:false) the rest. MUST run before the unique index
 * is created, or createIndex fails on the pre-existing duplicates. Never destroys data — soft-delete
 * keeps the losing rows for audit, and the partial index ignores exists:false rows.
 * @param {import('mongodb').Db} db - Connected Mongo Db handle (the DB that backs Parse).
 * @param {string} [collectionName] - Collection to dedupe (defaults to the Setting class name).
 * @returns {Promise<{keysDeduped: number, rowsSoftDeleted: number}>} What the dedupe changed.
 * @example
 * await dedupeActiveSettings(client.db());
 */
async function dedupeActiveSettings(db, collectionName = CLASS_NAME) {
  const collection = db.collection(collectionName);
  // Group active rows by key; only keys with >1 active row need work.
  const dups = await collection.aggregate([
    { $match: { exists: true } },
    { $group: { _id: '$key', ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  let rowsSoftDeleted = 0;
  for (const group of dups) {
    // Re-fetch the active rows for this key sorted by _updated_at desc so the newest wins. Sorting
    // here (not in the aggregate) keeps the winner selection explicit and driver-version agnostic.
    const rows = await collection
      .find({ key: group._id, exists: true })
      .sort({ _updated_at: -1, _id: -1 })
      .toArray();
    const losers = rows.slice(1); // keep rows[0] (newest), soft-delete the rest
    for (const loser of losers) {
      await collection.updateOne(
        { _id: loser._id },
        { $set: { exists: false, active: false, _updated_at: new Date() } }
      );
      rowsSoftDeleted += 1;
    }
    logger.warn(`[${SEED_NAME}] Deduped key "${group._id}": kept 1 active, soft-deleted ${losers.length}`);
  }
  return { keysDeduped: dups.length, rowsSoftDeleted };
}

/**
 * Create the PARTIAL unique index on { key: 1 } (exists:true only) directly via the Mongo driver.
 * Exported so tests (and any future reader) can guarantee the same index against any Mongo Db
 * (e.g. the jest mongodb-memory-server). Idempotent: an identical spec + name is a no-op.
 * @param {import('mongodb').Db} db - Connected Mongo Db handle.
 * @param {string} [collectionName] - Collection to index (defaults to the Setting class name).
 * @returns {Promise<string>} The created/existing index name.
 * @example
 * await ensureSettingKeyUniqueIndex(client.db());
 */
async function ensureSettingKeyUniqueIndex(db, collectionName = CLASS_NAME) {
  const collection = db.collection(collectionName);
  const name = await collection.createIndex(
    { key: 1 },
    { unique: true, name: UNIQUE_INDEX_NAME, partialFilterExpression: PARTIAL_FILTER }
  );
  return name;
}

/**
 * Post-creation verification: confirm the partial unique index actually exists on the collection
 * with the exact key, unique flag, and partialFilterExpression. createIndex can resolve without the
 * exact options in edge cases, so we read the live index list and assert. Throws a fatal error if it
 * is missing — the seed must never report success without real DB-level uniqueness.
 * @param {import('mongodb').Db} db - Connected Mongo Db handle.
 * @param {string} [collectionName] - Collection to inspect (defaults to the Setting class name).
 * @returns {Promise<string>} The verified index name.
 * @example
 * await assertSettingKeyUniqueIndex(client.db());
 */
async function assertSettingKeyUniqueIndex(db, collectionName = CLASS_NAME) {
  const indexes = await db.collection(collectionName).indexes();
  const found = indexes.find((i) => i.unique === true
    && i.key
    && i.key.key === 1
    && Object.keys(i.key).length === 1
    && i.partialFilterExpression
    && i.partialFilterExpression.exists === true);
  if (!found) {
    throw new Error(
      `[${SEED_NAME}] FATAL: partial unique index on { key:1 } (exists:true) is NOT present on `
      + `${collectionName} after creation — Setting.key uniqueness would be unenforced. Aborting seed.`
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
  if (!uri) throw new Error('DATABASE_URI not set; cannot create the Setting.key unique index');

  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const db = process.env.DATABASE_NAME ? client.db(process.env.DATABASE_NAME) : client.db();
    const stats = await dedupeActiveSettings(db);
    const name = await ensureSettingKeyUniqueIndex(db);
    // Fail loud if the index did not end up as specified — the whole point of the seed.
    await assertSettingKeyUniqueIndex(db);
    logger.info(`[${SEED_NAME}] Partial unique index ensured + verified on ${CLASS_NAME}.key: ${name}`, stats);
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
  description: 'Create a partial unique index on Setting.key (active rows only) after deduping',
  dedupeActiveSettings,
  ensureSettingKeyUniqueIndex,
  assertSettingKeyUniqueIndex,
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
