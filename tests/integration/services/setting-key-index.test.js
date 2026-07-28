/**
 * Setting.key partial unique index — integration (Parse real + mongodb-memory-server).
 *
 * Exercises seed 027's exported helpers against the jest memory Mongo and proves:
 * - dedupeActiveSettings collapses active duplicates to one (keeps newest, soft-deletes the rest);
 * - the index is created as PARTIAL unique on { key:1 } with partialFilterExpression { exists:true };
 * - uniqueness is enforced at the DB level under real concurrency (two saves of the same active key
 *   => 1 ok, 1 DUPLICATE_VALUE), not by an app-side check-then-act;
 * - a soft-deleted (exists:false) row and an active row can share a key (rollback pattern preserved),
 *   which a full unique index would have rejected.
 */

/* eslint-disable no-underscore-dangle */
// Mongo/Parse internal fields (_id, _created_at, _updated_at) are used directly to seed the exact
// duplicate / soft-deleted rows the partial unique index must handle.

const Parse = require('parse/node');
const { MongoClient } = require('mongodb');
const {
  dedupeActiveSettings,
  ensureSettingKeyUniqueIndex,
  assertSettingKeyUniqueIndex,
  UNIQUE_INDEX_NAME,
} = require('../../../scripts/seeds/027-setting-key-unique-index');

describe('Setting.key partial unique index (integration)', () => {
  let mongoClient;
  let targetDb;
  const created = [];

  const findParseDb = async (client) => {
    const { databases } = await client.db('admin').admin().listDatabases();
    for (const d of databases) {
      if (!['admin', 'local', 'config'].includes(d.name)) {
        const cols = await client.db(d.name).listCollections({ name: '_SCHEMA' }).toArray();
        if (cols.length) return client.db(d.name);
      }
    }
    return null;
  };

  // Insert an active Setting row straight through Mongo (bypassing Parse validate), so we can seed
  // the exact duplicate/soft-deleted states the index must handle. Returns the inserted _id.
  const insertRaw = async (key, value, { exists = true, active = true } = {}) => {
    const now = new Date();
    const res = await targetDb.collection('Setting').insertOne({
      _id: `${key}_${Math.round(value)}_${created.length}_${exists ? 'a' : 'x'}`,
      key,
      value,
      valueType: 'number',
      category: 'test',
      exists,
      active,
      _created_at: now,
      _updated_at: now,
    });
    created.push(res.insertedId);
    return res.insertedId;
  };

  const activeCount = async (key) => targetDb.collection('Setting').countDocuments({ key, exists: true });

  beforeAll(async () => {
    Parse.initialize('test-app-id', null, 'test-master-key');
    Parse.serverURL = 'http://localhost:1339/parse';
    Parse.masterKey = 'test-master-key';

    // Ensure the Setting class (and thus the Mongo collection) exists first.
    const schema = new Parse.Schema('Setting');
    try {
      await schema.get({ useMasterKey: true });
    } catch (e) {
      schema.addString('key');
      schema.addNumber('value');
      schema.addString('valueType');
      schema.addString('category');
      schema.addBoolean('active');
      schema.addBoolean('exists');
      await schema.save({ useMasterKey: true });
    }

    const uri = process.env.TEST_DATABASE_URI || process.env.DATABASE_URI;
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    targetDb = await findParseDb(mongoClient);
    if (!targetDb) throw new Error('Could not locate the Parse Mongo db (_SCHEMA collection not found)');
  }, 30000);

  afterAll(async () => {
    // Drop the index so it cannot leak into other suites sharing the memory Mongo, then clean rows.
    try { await targetDb.collection('Setting').dropIndex(UNIQUE_INDEX_NAME); } catch (e) { /* not there */ }
    for (const id of created) {
      try { await targetDb.collection('Setting').deleteOne({ _id: id }); } catch (e) { /* gone */ }
    }
    if (mongoClient) await mongoClient.close();
  });

  it('dedupe collapses active duplicates to one (newest kept) before indexing', async () => {
    // Two active rows for the same key — exactly the non-deterministic state the seed fixes.
    await insertRaw('qaDupKey', 0);
    await new Promise((r) => { setTimeout(r, 5); });
    await insertRaw('qaDupKey', 1); // newer _updated_at -> should be the survivor
    expect(await activeCount('qaDupKey')).toBe(2);

    const stats = await dedupeActiveSettings(targetDb);
    expect(stats.rowsSoftDeleted).toBeGreaterThanOrEqual(1);
    expect(await activeCount('qaDupKey')).toBe(1);

    // The surviving active row is the newest (value 1).
    const survivor = await targetDb.collection('Setting').findOne({ key: 'qaDupKey', exists: true });
    expect(survivor.value).toBe(1);
  });

  it('creates the index as PARTIAL unique on { key:1 } (exists:true)', async () => {
    await ensureSettingKeyUniqueIndex(targetDb);
    const name = await assertSettingKeyUniqueIndex(targetDb);
    expect(name).toBe(UNIQUE_INDEX_NAME);

    const idx = (await targetDb.collection('Setting').indexes())
      .find((i) => i.name === UNIQUE_INDEX_NAME);
    expect(idx.unique).toBe(true);
    expect(idx.key).toEqual({ key: 1 });
    expect(idx.partialFilterExpression).toEqual({ exists: true });
  });

  it('two concurrent inserts of the same ACTIVE key => 1 ok, 1 DUPLICATE_VALUE, count 1', async () => {
    const makeSetting = (val) => {
      const s = new Parse.Object('Setting');
      s.set('key', 'qaConcurrentKey');
      s.set('value', val);
      s.set('valueType', 'number');
      s.set('category', 'test');
      s.set('active', true);
      s.set('exists', true);
      return s;
    };
    const a = makeSetting(0);
    const b = makeSetting(1);

    const results = await Promise.allSettled([
      a.save(null, { useMasterKey: true }),
      b.save(null, { useMasterKey: true }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe(Parse.Error.DUPLICATE_VALUE);
    expect(await activeCount('qaConcurrentKey')).toBe(1);

    if (a.id) created.push(a.id);
    if (b.id) created.push(b.id);
  });

  it('a soft-deleted row and an active row can share a key (rollback pattern preserved)', async () => {
    // Simulate seed rollback: an old soft-deleted row for a key that also has a fresh active row.
    await insertRaw('qaRollbackKey', 0, { exists: false, active: false });
    const active = new Parse.Object('Setting');
    active.set('key', 'qaRollbackKey');
    active.set('value', 1);
    active.set('valueType', 'number');
    active.set('category', 'test');
    active.set('active', true);
    active.set('exists', true);
    // Must NOT throw despite the same-key soft-deleted row (partial index ignores exists:false).
    await active.save(null, { useMasterKey: true });
    created.push(active.id);

    expect(await activeCount('qaRollbackKey')).toBe(1);
    expect(await targetDb.collection('Setting').countDocuments({ key: 'qaRollbackKey' })).toBe(2);
  });
});
