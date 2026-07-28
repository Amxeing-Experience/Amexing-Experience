/**
 * GatewayEvent unique index — integration (Parse real + mongodb-memory-server).
 *
 * Applies the UNIQUE compound index (gateway, eventId) by invoking the seed's exported
 * ensureGatewayEventUniqueIndex() against the jest memory Mongo, then proves idempotency is enforced
 * at the DATABASE level (not by an app-side check-then-act): two concurrent saves of the same
 * gateway+eventId (Promise.all) yield exactly one success and one Parse.Error.DUPLICATE_VALUE (137),
 * with a final count of 1. Distinct eventId (same gateway) and distinct gateway (same eventId) both
 * coexist, confirming the index is COMPOUND, not single-key.
 */

const Parse = require('parse/node');
const { MongoClient } = require('mongodb');
const GatewayEvent = require('../../../src/domain/models/GatewayEvent');
const { ensureGatewayEventUniqueIndex } = require('../../../scripts/seeds/026-create-gatewayevent-class');

describe('GatewayEvent unique index (integration)', () => {
  let mongoClient;
  let targetDb; // the SAME Mongo db the memory Parse server writes to
  const created = [];

  // The memory-server URI can omit the db name in its path (getUri() -> mongodb://host:port/), so we
  // cannot assume it. Parse creates physical collections lazily (only on first insert), so we locate
  // Parse's db via its always-present _SCHEMA collection; ensureGatewayEventUniqueIndex then creates
  // the GatewayEvent collection in THAT same db, which is where Parse subsequently inserts.
  const findParseDb = async (client) => {
    const { databases } = await client.db('admin').admin().listDatabases();
    for (const d of databases) {
      if (['admin', 'local', 'config'].includes(d.name)) continue;
      const cols = await client.db(d.name).listCollections({ name: '_SCHEMA' }).toArray();
      if (cols.length) return client.db(d.name);
    }
    return null;
  };

  beforeAll(async () => {
    Parse.initialize('test-app-id', null, 'test-master-key');
    Parse.serverURL = 'http://localhost:1339/parse';
    Parse.masterKey = 'test-master-key';

    // Ensure the Parse class (and thus the Mongo collection) exists FIRST, mirroring seed 026's order
    // (schema, then unique index). Skips creation if the class already exists.
    const schema = new Parse.Schema('GatewayEvent');
    try {
      await schema.get({ useMasterKey: true });
    } catch (e) {
      schema.addString('gateway');
      schema.addString('eventId');
      schema.addString('type');
      schema.addDate('processedAt');
      schema.addObject('raw');
      schema.addBoolean('active');
      schema.addBoolean('exists');
      await schema.save({ useMasterKey: true });
    }

    // Connect to the SAME Mongo the memory Parse server uses (globalSetup exposes it via env), and
    // apply the unique index via the exact function the seed exports.
    const uri = process.env.TEST_DATABASE_URI || process.env.DATABASE_URI;
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    targetDb = await findParseDb(mongoClient);
    if (!targetDb) throw new Error('Could not locate the Parse Mongo db (_SCHEMA collection not found)');
    await ensureGatewayEventUniqueIndex(targetDb);
  }, 30000);

  afterAll(async () => {
    for (const o of created) {
      try { await o.destroy({ useMasterKey: true }); } catch (e) { /* gone */ }
    }
    if (mongoClient) await mongoClient.close();
  });

  const makeEvent = (gateway, eventId) => {
    const ev = new GatewayEvent();
    ev.set('gateway', gateway);
    ev.set('eventId', eventId);
    ev.set('type', 'payment_intent.succeeded');
    ev.set('active', true);
    ev.set('exists', true);
    return ev;
  };

  const countBy = async (gateway, eventId) => {
    const q = new Parse.Query('GatewayEvent');
    q.equalTo('gateway', gateway);
    q.equalTo('eventId', eventId);
    return q.count({ useMasterKey: true });
  };

  it('index exists as unique + compound on (gateway, eventId)', async () => {
    const indexes = await targetDb.collection('GatewayEvent').indexes();
    const idx = indexes.find((i) => i.name === 'gateway_eventId_unique');
    expect(idx).toBeDefined();
    expect(idx.unique).toBe(true);
    expect(idx.key).toEqual({ gateway: 1, eventId: 1 });
  });

  it('two concurrent saves of the same gateway+eventId => exactly 1 ok, 1 DUPLICATE_VALUE, count 1', async () => {
    const a = makeEvent('stripe', 'evt_concurrent');
    const b = makeEvent('stripe', 'evt_concurrent');

    const results = await Promise.allSettled([
      a.save(null, { useMasterKey: true }),
      b.save(null, { useMasterKey: true }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe(Parse.Error.DUPLICATE_VALUE); // 137, from Mongo 11000
    expect(await countBy('stripe', 'evt_concurrent')).toBe(1);

    // Track the one that survived for cleanup.
    if (a.id) created.push(a);
    else if (b.id) created.push(b);
  });

  it('same gateway, distinct eventId => both save (unique key includes eventId)', async () => {
    const a = makeEvent('stripe', 'evt_a1');
    const b = makeEvent('stripe', 'evt_a2');
    await Promise.all([
      a.save(null, { useMasterKey: true }),
      b.save(null, { useMasterKey: true }),
    ]);
    created.push(a, b);
    expect(await countBy('stripe', 'evt_a1')).toBe(1);
    expect(await countBy('stripe', 'evt_a2')).toBe(1);
  });

  it('same eventId, distinct gateway => both save (index is COMPOUND, not single-key on eventId)', async () => {
    const a = makeEvent('stripe', 'evt_shared');
    const b = makeEvent('mexican', 'evt_shared');
    await Promise.all([
      a.save(null, { useMasterKey: true }),
      b.save(null, { useMasterKey: true }),
    ]);
    created.push(a, b);
    expect(await countBy('stripe', 'evt_shared')).toBe(1);
    expect(await countBy('mexican', 'evt_shared')).toBe(1);
  });
});
