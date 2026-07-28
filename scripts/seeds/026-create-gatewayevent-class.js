/**
 * Seed 026 - Create GatewayEvent class + Payment gateway fields
 *
 * Two additive schema changes for the online payment gateway (PR 2, plan seccion 6.2/6.4).
 *
 * 1) Creates the GatewayEvent Parse class (webhook event log) with its UNIQUE compound index
 * (gateway, eventId). The unique index is created DIRECTLY via the Mongo driver because
 * Parse.Schema.addIndex in parse-server 9 copies only {key, name} and never the `unique` flag
 * (MongoStorageAdapter.setIndexesWithSchemaFormat), so schema.addIndex would create a compound-
 * but-NOT-unique index. The unique index is what makes webhook idempotency atomic: the handler
 * inserts and catches the DUPLICATE_VALUE error (Parse 137 / Mongo 11000).
 *
 * 2) Adds the 9 new gateway fields to the existing Payment class (channel/gateway/gatewayStatus/
 * gatewayIntentId/gatewaySessionId/gatewayChargeId/gatewayRaw/expiresAt/confirmedAt), additive,
 * leaving existing manual-payment fields intact.
 *
 * Idempotent: the class check, the addFieldIfNotExists-style updates, and the driver createIndex
 * (same spec + name) can all run multiple times safely.
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2026-07-24
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

// Seed configuration
const SEED_NAME = '026-create-gatewayevent-class';
const VERSION = '1.0.0';
const CLASS_NAME = 'GatewayEvent';
const UNIQUE_INDEX_NAME = 'gateway_eventId_unique';

// PCI-sensitive Payment gateway fields that formatPayment already OMITS from the HTTP DTO. They are
// also hidden at the schema level via protectedFields so a direct GET /parse/classes/Payment without
// masterKey can never leak them (PR 4/5 fill gatewayRaw with the raw provider payload). The publicly
// exposed fields (channel/gateway/gatewayStatus/gatewayChargeId) are intentionally NOT protected.
const PCI_PROTECTED_FIELDS = ['gatewayRaw', 'gatewayIntentId', 'gatewaySessionId'];

// New gateway fields for the existing Payment class (plan seccion 6.2). Type-tagged so the
// addFieldIfNotExists loop knows which Parse.Schema adder to call.
const PAYMENT_GATEWAY_FIELDS = [
  { name: 'channel', type: 'String' },
  { name: 'gateway', type: 'String' },
  { name: 'gatewayStatus', type: 'String' },
  { name: 'gatewayIntentId', type: 'String' },
  { name: 'gatewaySessionId', type: 'String' },
  { name: 'gatewayChargeId', type: 'String' },
  { name: 'gatewayRaw', type: 'Object' },
  { name: 'expiresAt', type: 'Date' },
  { name: 'confirmedAt', type: 'Date' },
];

/**
 * Create the UNIQUE compound index (gateway, eventId) on GatewayEvent directly via the Mongo driver.
 *
 * Exported so tests (and the webhook path) can guarantee the same unique index against any Mongo Db
 * (e.g. the jest mongodb-memory-server) without going through Parse.Schema.addIndex, which does NOT
 * enforce uniqueness in parse-server 9. Idempotent: createIndex with an identical spec + name is a
 * no-op if the index already exists.
 * @param {import('mongodb').Db} db - Connected Mongo Db handle (the DB that backs Parse).
 * @param {string} [collectionName] - Collection to index (defaults to the GatewayEvent class name).
 * @returns {Promise<string>} The created/existing index name.
 * @example
 * await ensureGatewayEventUniqueIndex(client.db());
 */
async function ensureGatewayEventUniqueIndex(db, collectionName = CLASS_NAME) {
  const collection = db.collection(collectionName);
  const name = await collection.createIndex(
    { gateway: 1, eventId: 1 },
    { unique: true, name: UNIQUE_INDEX_NAME }
  );
  return name;
}

/**
 * Post-creation verification: confirm the unique compound index actually exists on the collection.
 * createIndex can resolve without giving us uniqueness in edge cases (a same-named non-unique index
 * already present raises IndexOptionsConflict, but we double-check regardless), so we read the live
 * index list and require a { unique:true } index whose key is exactly { gateway:1, eventId:1 }. Throws
 * a fatal error if it is missing — the seed must never report success without real DB-level idempotency.
 * @param {import('mongodb').Db} db - Connected Mongo Db handle.
 * @param {string} [collectionName] - Collection to inspect (defaults to the GatewayEvent class name).
 * @returns {Promise<string>} The verified index name.
 * @example
 * await assertGatewayEventUniqueIndex(client.db());
 */
async function assertGatewayEventUniqueIndex(db, collectionName = CLASS_NAME) {
  const indexes = await db.collection(collectionName).indexes();
  const found = indexes.find((i) => i.unique === true
    && i.key
    && i.key.gateway === 1
    && i.key.eventId === 1
    && Object.keys(i.key).length === 2);
  if (!found) {
    throw new Error(
      `[${SEED_NAME}] FATAL: unique index on {gateway:1,eventId:1} is NOT present on ${collectionName} `
      + 'after creation — webhook idempotency would be disabled at the DB level. Aborting seed.'
    );
  }
  return found.name;
}

/**
 * Check if a Parse class exists.
 * @param {string} className - Class to check.
 * @returns {Promise<boolean>} True if the class exists.
 */
async function classExists(className) {
  try {
    const schemas = await Parse.Schema.all({ useMasterKey: true });
    return schemas.some((schema) => schema.className === className);
  } catch (error) {
    logger.error(`[${SEED_NAME}] Error checking class existence`, { className, error: error.message });
    return false;
  }
}

/**
 * Create the GatewayEvent class schema (fields only; the unique index is added separately via driver).
 * @returns {Promise<void>}
 */
async function createGatewayEventClass() {
  const schema = new Parse.Schema(CLASS_NAME);

  // Core fields (plan seccion 6.4).
  schema.addString('gateway'); // 'stripe' | 'mexican'
  schema.addString('eventId'); // provider event id (part of the unique index)
  schema.addString('type'); // provider event type
  schema.addDate('processedAt'); // when the webhook handled it
  schema.addObject('raw'); // raw event payload (diagnostics/reconciliation; never PAN)

  // BaseModel lifecycle fields.
  schema.addBoolean('active');
  schema.addBoolean('exists');

  try {
    await schema.save({ useMasterKey: true });
    logger.info(`[${SEED_NAME}] ${CLASS_NAME} class created`);
  } catch (error) {
    // 103 = "Class already exists": treat as already-created (idempotent even if the prior
    // classExists() check transiently failed on a flaky network and returned false).
    if (error.code === 103) {
      logger.info(`[${SEED_NAME}] ${CLASS_NAME} class already exists (create raced), continuing`);
    } else {
      throw error;
    }
  }
}

/**
 * Set masterKey-only CLPs on GatewayEvent (written only by the server-side webhook handler).
 * @returns {Promise<void>}
 */
async function setGatewayEventCLP() {
  try {
    const schema = new Parse.Schema(CLASS_NAME);
    schema.setCLP({
      find: {},
      count: {},
      get: {},
      create: {}, // masterKey only
      update: {}, // masterKey only
      delete: {}, // masterKey only
      addField: {},
      protectedFields: { '*': [] },
    });
    await schema.update({ useMasterKey: true });
    logger.info(`[${SEED_NAME}] ${CLASS_NAME} CLPs set (masterKey only)`);
  } catch (error) {
    logger.warn(`[${SEED_NAME}] Error setting ${CLASS_NAME} CLPs (may already be set)`, { error: error.message });
  }
}

/**
 * Add the missing gateway fields to the existing Payment class (additive, addFieldIfNotExists-style).
 * @returns {Promise<number>} Count of fields actually added.
 */
async function addPaymentGatewayFields() {
  const paymentSchema = new Parse.Schema('Payment');
  const current = await paymentSchema.get({ useMasterKey: true });
  const existingFields = (current && current.fields) || {};

  const toAdd = PAYMENT_GATEWAY_FIELDS.filter((f) => !existingFields[f.name]);
  if (toAdd.length === 0) {
    logger.info(`[${SEED_NAME}] Payment already has all gateway fields, nothing to add`);
    return 0;
  }

  const updateSchema = new Parse.Schema('Payment');
  for (const field of toAdd) {
    if (field.type === 'String') updateSchema.addString(field.name);
    else if (field.type === 'Date') updateSchema.addDate(field.name);
    else if (field.type === 'Object') updateSchema.addObject(field.name);
  }
  await updateSchema.update({ useMasterKey: true });
  logger.info(`[${SEED_NAME}] Added ${toAdd.length} gateway field(s) to Payment`, {
    fields: toAdd.map((f) => f.name),
  });
  return toAdd.length;
}

/**
 * Harden the PCI-sensitive Payment gateway fields with schema-level protectedFields so they can never
 * be read via a direct Parse REST query without masterKey (formatPayment already hides them on the HTTP
 * path, but the class keeps parse-server's public find/get CLP). Preserves the existing CLP operations
 * (find/get/count/create/update/delete/addField) EXACTLY as they are today and any pre-existing
 * protectedFields, only ADDING the PCI fields to the public ('*') protected bucket. Idempotent (re-adds
 * the same fields to a Set). Does NOT protect channel/gateway/gatewayStatus/gatewayChargeId — those are
 * exposed by formatPayment on purpose.
 * @returns {Promise<void>}
 */
async function protectPaymentPciFields() {
  const current = await new Parse.Schema('Payment').get({ useMasterKey: true });
  const base = (current && current.classLevelPermissions) || {};

  // Preserve current operation permissions verbatim; fall back to the public default only for a key
  // that is genuinely absent (never for an explicit {} which means masterKey-only).
  const publicDefault = { '*': true };
  const op = (key) => (base[key] !== undefined ? base[key] : publicDefault);

  const existingProtected = base.protectedFields || {};
  const publicProtected = new Set(existingProtected['*'] || []);
  PCI_PROTECTED_FIELDS.forEach((f) => publicProtected.add(f));

  const clp = {
    find: op('find'),
    get: op('get'),
    count: op('count'),
    create: op('create'),
    update: op('update'),
    delete: op('delete'),
    addField: op('addField'),
    protectedFields: { ...existingProtected, '*': Array.from(publicProtected) },
  };

  const schema = new Parse.Schema('Payment');
  schema.setCLP(clp);
  await schema.update({ useMasterKey: true });
  logger.info(`[${SEED_NAME}] Payment PCI fields protected (protectedFields '*')`, {
    fields: PCI_PROTECTED_FIELDS,
  });
}

/**
 * Ensure the unique index on GatewayEvent via a direct Mongo connection (from DATABASE_URI).
 * @returns {Promise<void>}
 */
async function ensureUniqueIndexFromEnv() {
  const uri = process.env.DATABASE_URI;
  if (!uri) throw new Error('DATABASE_URI not set; cannot create the GatewayEvent unique index');

  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const db = process.env.DATABASE_NAME ? client.db(process.env.DATABASE_NAME) : client.db();
    const name = await ensureGatewayEventUniqueIndex(db);
    // Fail loud if the index did not end up unique — this is the whole point of the seed.
    await assertGatewayEventUniqueIndex(db);
    logger.info(`[${SEED_NAME}] Unique index ensured + verified on ${CLASS_NAME}: ${name}`);
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
  const statistics = { created: 0, skipped: 0, errors: 0 };

  logger.info(`[${SEED_NAME}] Starting seed execution...`);

  try {
    const exists = await classExists(CLASS_NAME);
    if (exists) {
      logger.info(`[${SEED_NAME}] ${CLASS_NAME} class already exists, skipping class creation`);
      statistics.skipped++;
      // Still ensure CLPs (idempotent) in case they drifted.
      await setGatewayEventCLP();
    } else {
      await createGatewayEventClass();
      await setGatewayEventCLP();
      statistics.created++;
    }

    // The unique index is always ensured + verified (idempotent) — it is the whole point of this
    // class. A failure here is CRITICAL and must be fatal (see the re-throw below): the shared
    // seed-runner hardcodes status:'completed' and only records 'failed' when run() THROWS, so
    // swallowing the error would mark the seed done forever with idempotency disabled at the DB level.
    await ensureUniqueIndexFromEnv();

    // Additive Payment fields (idempotent: only missing ones are added).
    await addPaymentGatewayFields();

    // Harden the PCI-sensitive fields at the schema level (protectedFields).
    await protectPaymentPciFields();

    const duration = Date.now() - startTime;
    logger.info(`[${SEED_NAME}] Seed completed successfully`, { duration: `${duration}ms`, statistics });

    return {
      success: true, seedName: SEED_NAME, version: VERSION, statistics, duration,
    };
  } catch (error) {
    statistics.errors++;
    const duration = Date.now() - startTime;
    logger.error(`[${SEED_NAME}] Seed execution failed`, { error: error.message, statistics, duration: `${duration}ms` });
    // RE-THROW: never return {success:false} silently — the seed-runner ignores result.success and
    // would otherwise mark this 'completed'. Throwing forces it to record 'failed' and re-run later.
    throw error;
  }
}

// Export for seed runner + tests. ensureGatewayEventUniqueIndex (index test) and protectPaymentPciFields
// (PCI protectedFields test) are reused directly against the jest memory Parse/Mongo.
module.exports = {
  run,
  seedName: SEED_NAME,
  version: VERSION,
  description: 'Create GatewayEvent class with unique (gateway,eventId) index and add gateway fields to Payment',
  ensureGatewayEventUniqueIndex,
  assertGatewayEventUniqueIndex,
  protectPaymentPciFields,
  PCI_PROTECTED_FIELDS,
};

// Allow direct execution for testing.
if (require.main === module) {
  // Direct-run convenience: default to Dev unless NODE_ENV is a known env name (the seed runner
  // loads its own dotenv, so this block only matters for `node scripts/seeds/026-...js`).
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
