/**
 * Payment pending-online unique index — integration (Parse real + mongodb-memory-server).
 *
 * Applies the seed's exported ensurePaymentPendingUniqueIndex() against the jest memory Mongo, then
 * proves the anti-double-submit guard is enforced at the DATABASE level (not an app-side
 * check-then-act): two concurrent pending online Payments for the SAME reservation
 * (Promise.allSettled) yield exactly one success and one Parse.Error.DUPLICATE_VALUE (137). Two
 * DISTINCT reservations both succeed (per-reservation scope). A manual payment and a succeeded
 * online payment both coexist with a pending online one for the same reservation (partial filter:
 * only channel:'online' + gatewayStatus:'requires_payment' + exists:true is unique).
 */

const Parse = require('parse/node');
const { MongoClient } = require('mongodb');
const Payment = require('../../../src/domain/models/Payment');
const {
  ensurePaymentPendingUniqueIndex,
  UNIQUE_INDEX_NAME,
} = require('../../../scripts/seeds/028-payment-online-pending-unique-index');

describe('Payment pending-online unique index (integration)', () => {
  let mongoClient;
  let targetDb;
  let counter = 0;
  const created = [];

  // The memory-server URI can omit the db name, and Parse creates physical collections lazily, so
  // locate Parse's db via its always-present _SCHEMA collection (same technique as the GatewayEvent
  // index test).
  const findParseDb = async (client) => {
    const { databases } = await client.db('admin').admin().listDatabases();
    for (const d of databases) {
      if (['admin', 'local', 'config'].includes(d.name)) continue;
      const cols = await client.db(d.name).listCollections({ name: '_SCHEMA' }).toArray();
      if (cols.length) return client.db(d.name);
    }
    return null;
  };

  const newReservationId = () => {
    counter += 1;
    return `resPendIdx${Date.now()}_${counter}`;
  };

  const reservationPtr = (id) => {
    const ptr = new Parse.Object('Reservation');
    ptr.id = id;
    return ptr;
  };

  const makePending = (reservationId) => {
    const p = new Payment();
    p.setReservationPtr(reservationPtr(reservationId));
    p.setChannel('online');
    p.setGateway('stripe');
    p.setGatewayStatus('requires_payment');
    p.setMethod('tarjeta');
    p.setAmount(1000);
    p.set('active', true);
    p.set('exists', true);
    return p;
  };

  const countPending = async (reservationId) => {
    const q = new Parse.Query('Payment');
    q.equalTo('reservationPtr', reservationPtr(reservationId));
    q.equalTo('channel', 'online');
    q.equalTo('gatewayStatus', 'requires_payment');
    q.equalTo('exists', true);
    return q.count({ useMasterKey: true });
  };

  beforeAll(async () => {
    Parse.initialize('test-app-id', null, 'test-master-key');
    Parse.serverURL = 'http://localhost:1339/parse';
    Parse.masterKey = 'test-master-key';

    // Ensure the Payment collection exists (save + destroy a throwaway row), then apply the index.
    const seed = makePending(newReservationId());
    await seed.save(null, { useMasterKey: true });
    await seed.destroy({ useMasterKey: true });

    const uri = process.env.TEST_DATABASE_URI || process.env.DATABASE_URI;
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    targetDb = await findParseDb(mongoClient);
    if (!targetDb) throw new Error('Could not locate the Parse Mongo db (_SCHEMA collection not found)');
    await ensurePaymentPendingUniqueIndex(targetDb);
  }, 30000);

  afterAll(async () => {
    for (const o of created) {
      try { await o.destroy({ useMasterKey: true }); } catch (e) { /* gone */ }
    }
    if (mongoClient) await mongoClient.close();
  });

  it('index exists as unique + partial on _p_reservationPtr (channel/gatewayStatus/exists)', async () => {
    const indexes = await targetDb.collection('Payment').indexes();
    const idx = indexes.find((i) => i.name === UNIQUE_INDEX_NAME);
    expect(idx).toBeDefined();
    expect(idx.unique).toBe(true);
    expect(idx.key).toEqual({ _p_reservationPtr: 1 });
    expect(idx.partialFilterExpression).toEqual({
      channel: 'online', gatewayStatus: 'requires_payment', exists: true,
    });
  });

  it('two concurrent pending online payments (same reservation) => 1 ok, 1 DUPLICATE_VALUE, count 1', async () => {
    const id = newReservationId();
    const a = makePending(id);
    const b = makePending(id);

    const results = await Promise.allSettled([
      a.save(null, { useMasterKey: true }),
      b.save(null, { useMasterKey: true }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe(Parse.Error.DUPLICATE_VALUE); // 137, from Mongo 11000
    expect(await countPending(id)).toBe(1);

    if (a.id) created.push(a);
    if (b.id) created.push(b);
  });

  it('two DISTINCT reservations both get their own pending (per-reservation scope)', async () => {
    const idA = newReservationId();
    const idB = newReservationId();
    const a = makePending(idA);
    const b = makePending(idB);
    await Promise.all([
      a.save(null, { useMasterKey: true }),
      b.save(null, { useMasterKey: true }),
    ]);
    created.push(a, b);
    expect(await countPending(idA)).toBe(1);
    expect(await countPending(idB)).toBe(1);
  });

  it('a manual payment coexists with a pending online one for the SAME reservation', async () => {
    const id = newReservationId();
    const pending = makePending(id);
    await pending.save(null, { useMasterKey: true });
    created.push(pending);

    // Manual payment: no channel/gatewayStatus -> outside the partial filter -> not blocked.
    const manual = new Payment();
    manual.setReservationPtr(reservationPtr(id));
    manual.setMethod('efectivo');
    manual.setAmount(500);
    manual.set('active', true);
    manual.set('exists', true);
    await expect(manual.save(null, { useMasterKey: true })).resolves.toBeDefined();
    created.push(manual);
    expect(await countPending(id)).toBe(1);
  });

  it('a succeeded online payment coexists with a pending online one (only requires_payment is unique)', async () => {
    const id = newReservationId();
    const pending = makePending(id);
    await pending.save(null, { useMasterKey: true });
    created.push(pending);

    const succeeded = makePending(id);
    succeeded.setGatewayStatus('succeeded'); // outside the partial filter -> allowed alongside
    await expect(succeeded.save(null, { useMasterKey: true })).resolves.toBeDefined();
    created.push(succeeded);
    expect(await countPending(id)).toBe(1);
  });
});
