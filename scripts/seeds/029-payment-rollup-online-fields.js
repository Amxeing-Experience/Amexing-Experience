/* eslint-disable jsdoc/check-indentation */
// check-indentation: the header uses inline braces like { key: 1 } that the rule misreads.
/**
 * Seed 029 - Payment fields + session index for the online rollup safety net (PR 6)
 *
 * Three additive schema fields on the existing Payment class plus one lookup index. All additive:
 * no existing column is touched and no row is rewritten.
 *
 * 1) `retiredBySystem` (Boolean) - marks a soft-delete performed by OUR housekeeping (the TTL sweep
 *    or retirePending) as opposed to a deliberate staff delete. `deletedBy` cannot tell them apart
 *    (both call softDelete(req.userId) with a real user), so a dedicated flag is the only
 *    unambiguous signal. It is the ONLY gate of the revive: a Payment soft-deleted deliberately is
 *    never restored automatically.
 * 2) `lastReconciledAt` (Date) - written by the reconciliation job when getCharge answered, so a row
 *    is not re-queried against Stripe on every run and the batch can be ordered oldest-first.
 * 3) `requiresRefundReview` (Boolean) - a charge confirmed against an ALREADY CANCELLED reservation.
 *    The money is real and is recorded normally; this flag is what PR 11 turns into a refund request
 *    so those cases do not have to be hunted down historically.
 * 4) `requiresRollupRepair` (Boolean) - a charge that WAS confirmed but whose reservation rollup then
 *    failed to be written. Without it that row is unfindable: it is already 'succeeded' and visible,
 *    so it matches no reconciliation branch and no stranded-money query, while the reservation keeps
 *    showing a balance for money that was really collected.
 *
 * 5) Sparse index on `gatewaySessionId`: the public return endpoint (GET .../pay/success) looks the
 *    Payment up BY SESSION ID on every visit. Sparse, because only online rows carry the column, and
 *    NOT unique: uniqueness is already guaranteed upstream (one session per pending, keyed by the
 *    payment id as idempotency key) and a unique index here would turn any legacy duplicate into a
 *    hard write failure on a money path.
 *
 * Idempotent: the addFieldIfNotExists-style update only adds missing fields, and createIndex with an
 * identical spec + name is a no-op. Fatal on failure (re-throw), same contract as seeds 026/028 —
 * the shared seed-runner only records 'failed' when run() throws.
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2026-07-30
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

const SEED_NAME = '029-payment-rollup-online-fields';
const VERSION = '1.0.0';
const CLASS_NAME = 'Payment';
const SESSION_INDEX_NAME = 'payment_gateway_session_lookup';

// New PR6 fields for the existing Payment class. Type-tagged so the add loop knows which
// Parse.Schema adder to call.
const PAYMENT_ROLLUP_FIELDS = [
  { name: 'retiredBySystem', type: 'Boolean' },
  { name: 'lastReconciledAt', type: 'Date' },
  { name: 'requiresRefundReview', type: 'Boolean' },
  { name: 'requiresRollupRepair', type: 'Boolean' },
];

// Internal fields that must never reach a client through a maskerKey-less Parse REST read. Seed 026
// already protected gatewayRaw/gatewayIntentId/gatewaySessionId; these follow the same rule (they are
// housekeeping/audit state, not user-facing payment data).
const PCI_PROTECTED_FIELDS = [
  'retiredBySystem', 'lastReconciledAt', 'requiresRefundReview', 'requiresRollupRepair',
];

/**
 * Add the missing PR6 fields to the existing Payment class (additive, addFieldIfNotExists-style).
 * @returns {Promise<number>} Count of fields actually added.
 * @example
 * await addPaymentRollupFields();
 */
async function addPaymentRollupFields() {
  const paymentSchema = new Parse.Schema(CLASS_NAME);
  const current = await paymentSchema.get({ useMasterKey: true });
  const existingFields = (current && current.fields) || {};

  const toAdd = PAYMENT_ROLLUP_FIELDS.filter((f) => !existingFields[f.name]);
  if (toAdd.length === 0) {
    logger.info(`[${SEED_NAME}] Payment already has all PR6 rollup fields, nothing to add`);
    return 0;
  }

  const updateSchema = new Parse.Schema(CLASS_NAME);
  for (const field of toAdd) {
    if (field.type === 'Boolean') updateSchema.addBoolean(field.name);
    else if (field.type === 'Date') updateSchema.addDate(field.name);
  }
  await updateSchema.update({ useMasterKey: true });
  logger.info(`[${SEED_NAME}] Added ${toAdd.length} rollup field(s) to Payment`, {
    fields: toAdd.map((f) => f.name),
  });
  return toAdd.length;
}

/**
 * Add the PR6 internal fields to the public protectedFields bucket, preserving every existing CLP
 * operation and every field seed 026 already protected. Idempotent (a Set absorbs re-adds).
 * @returns {Promise<void>} Resolves once the CLP update is persisted.
 * @example
 * await protectRollupFields();
 */
async function protectRollupFields() {
  const current = await new Parse.Schema(CLASS_NAME).get({ useMasterKey: true });
  const base = (current && current.classLevelPermissions) || {};

  // Preserve current permissions verbatim; fall back to the public default only for a genuinely
  // absent key (never for an explicit {}, which means masterKey-only).
  const publicDefault = { '*': true };
  const op = (key) => (base[key] !== undefined ? base[key] : publicDefault);

  const existingProtected = base.protectedFields || {};
  const publicProtected = new Set(existingProtected['*'] || []);
  PCI_PROTECTED_FIELDS.forEach((f) => publicProtected.add(f));

  const schema = new Parse.Schema(CLASS_NAME);
  schema.setCLP({
    find: op('find'),
    get: op('get'),
    count: op('count'),
    create: op('create'),
    update: op('update'),
    delete: op('delete'),
    addField: op('addField'),
    protectedFields: { ...existingProtected, '*': Array.from(publicProtected) },
  });
  await schema.update({ useMasterKey: true });
  logger.info(`[${SEED_NAME}] Payment PR6 internal fields protected (protectedFields '*')`, {
    fields: PCI_PROTECTED_FIELDS,
  });
}

/**
 * Create the SPARSE (non-unique) lookup index on Payment.gatewaySessionId directly via the Mongo
 * driver. Exported so tests can guarantee the same index against any Mongo Db (e.g. the jest
 * mongodb-memory-server). Idempotent: an identical spec + name is a no-op.
 * @param {import('mongodb').Db} db - Connected Mongo Db handle.
 * @param {string} [collectionName] - Collection to index (defaults to the Payment class name).
 * @returns {Promise<string>} The created/existing index name.
 * @example
 * await ensurePaymentSessionIndex(client.db());
 */
async function ensurePaymentSessionIndex(db, collectionName = CLASS_NAME) {
  return db.collection(collectionName).createIndex(
    { gatewaySessionId: 1 },
    { sparse: true, name: SESSION_INDEX_NAME }
  );
}

/**
 * Post-creation verification: the sparse index really exists with that exact key.
 * @param {import('mongodb').Db} db - Connected Mongo Db handle.
 * @param {string} [collectionName] - Collection to inspect (defaults to the Payment class name).
 * @returns {Promise<string>} The verified index name.
 * @example
 * await assertPaymentSessionIndex(client.db());
 */
async function assertPaymentSessionIndex(db, collectionName = CLASS_NAME) {
  const indexes = await db.collection(collectionName).indexes();
  const found = indexes.find((i) => i.key
    && i.key.gatewaySessionId === 1
    && Object.keys(i.key).length === 1
    && i.sparse === true);
  if (!found) {
    throw new Error(
      `[${SEED_NAME}] FATAL: sparse index on { gatewaySessionId:1 } is NOT present on `
      + `${collectionName} after creation — the public payment-return endpoint would do a full `
      + 'collection scan on every visit. Aborting seed.'
    );
  }
  return found.name;
}

/**
 * Ensure the index against the DB from DATABASE_URI (create + verify).
 * @returns {Promise<string>} The verified index name.
 */
async function ensureIndexFromEnv() {
  const uri = process.env.DATABASE_URI;
  if (!uri) throw new Error('DATABASE_URI not set; cannot create the Payment gatewaySessionId index');

  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const db = process.env.DATABASE_NAME ? client.db(process.env.DATABASE_NAME) : client.db();
    await ensurePaymentSessionIndex(db);
    return assertPaymentSessionIndex(db);
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
    const fieldsAdded = await addPaymentRollupFields();
    await protectRollupFields();
    const indexName = await ensureIndexFromEnv();

    const statistics = { fieldsAdded, indexName };
    const duration = Date.now() - startTime;
    logger.info(`[${SEED_NAME}] Seed completed successfully`, { duration: `${duration}ms`, ...statistics });
    return {
      success: true, seedName: SEED_NAME, version: VERSION, statistics, duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`[${SEED_NAME}] Seed execution failed`, { error: error.message, duration: `${duration}ms` });
    // RE-THROW: the seed-runner ignores result.success and only records 'failed' when run() throws.
    throw error;
  }
}

module.exports = {
  run,
  seedName: SEED_NAME,
  version: VERSION,
  description: 'Add Payment rollup-online fields (retiredBySystem/lastReconciledAt/requiresRefundReview) and the gatewaySessionId lookup index',
  addPaymentRollupFields,
  protectRollupFields,
  ensurePaymentSessionIndex,
  assertPaymentSessionIndex,
  PAYMENT_ROLLUP_FIELDS,
  PCI_PROTECTED_FIELDS,
  SESSION_INDEX_NAME,
};

// Allow direct execution for testing.
if (require.main === module) {
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
