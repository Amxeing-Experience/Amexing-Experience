/**
 * Seed 029 — Payment rollup fields + session index (Parse real + mongodb-memory-server).
 *
 * Two things worth an integration test rather than a unit one.
 *
 * The INDEX, because the public payment-return endpoint looks a Payment up BY SESSION ID on every
 * visit: without it, an anonymous route does a full collection scan per request. It must be sparse
 * (only online rows carry the column) and NOT unique — uniqueness is already guaranteed upstream by
 * the idempotency key, and a unique index here would turn any legacy duplicate into a hard write
 * failure on a money path.
 *
 * The INTERACTION with seed 028's partial unique index, because it is what lets the system recover: a
 * row the sweep retires must free the "one live pending per reservation" slot, or after the very
 * first sweep no new checkout could ever be opened for that reservation again.
 */

const Parse = require('parse/node');
const { MongoClient } = require('mongodb');
const Payment = require('../../../src/domain/models/Payment');
const {
  ensurePaymentSessionIndex,
  assertPaymentSessionIndex,
  SESSION_INDEX_NAME,
  PAYMENT_ROLLUP_FIELDS,
  PCI_PROTECTED_FIELDS,
} = require('../../../scripts/seeds/029-payment-rollup-online-fields');
const {
  ensurePaymentPendingUniqueIndex,
} = require('../../../scripts/seeds/028-payment-online-pending-unique-index');
const { atomicRetirePayment, closeForTests } = require('../../../src/infrastructure/payments/paymentAtomicStore');

describe('Seed 029 — Payment rollup fields and session index (integration)', () => {
  let mongoClient;
  let targetDb;
  let counter = 0;
  const created = [];

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
    return `resSeed029_${Date.now()}_${counter}`;
  };

  const reservationPtr = (id) => {
    const ptr = new Parse.Object('Reservation');
    ptr.id = id;
    return ptr;
  };

  const makePending = async (reservationId, sessionId) => {
    const p = new Payment();
    p.setReservationPtr(reservationPtr(reservationId));
    p.setChannel('online');
    p.setGateway('stripe');
    p.setGatewayStatus('requires_payment');
    p.setMethod('tarjeta');
    p.setAmount(1000);
    if (sessionId) p.setGatewaySessionId(sessionId);
    p.set('active', true);
    p.set('exists', true);
    await p.save(null, { useMasterKey: true });
    created.push(p);
    return p;
  };

  beforeAll(async () => {
    require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    Parse.initialize('test-app-id', null, 'test-master-key');
    Parse.serverURL = 'http://localhost:1339/parse';
    Parse.masterKey = 'test-master-key';

    mongoClient = new MongoClient(process.env.TEST_DATABASE_URI || process.env.DATABASE_URI);
    await mongoClient.connect();
    targetDb = await findParseDb(mongoClient);
    if (!targetDb) throw new Error('Could not locate the Parse Mongo db (_SCHEMA collection not found)');
    // Materialize the collection so createIndex has something to attach to.
    await makePending(newReservationId(), `cs_seed029_boot_${Date.now()}`);
  }, 60000);

  afterAll(async () => {
    for (const o of created) {
      try { await o.destroy({ useMasterKey: true }); } catch { /* gone */ }
    }
    await closeForTests();
    if (mongoClient) await mongoClient.close();
  }, 60000);

  describe('the gatewaySessionId lookup index', () => {
    it('is created SPARSE and NOT unique, and the seed verifies its own work', async () => {
      const name = await ensurePaymentSessionIndex(targetDb);
      expect(name).toBe(SESSION_INDEX_NAME);
      await expect(assertPaymentSessionIndex(targetDb)).resolves.toBe(SESSION_INDEX_NAME);

      const found = (await targetDb.collection('Payment').indexes())
        .find((i) => i.name === SESSION_INDEX_NAME);
      expect(found).toBeDefined();
      expect(found.key).toEqual({ gatewaySessionId: 1 });
      expect(found.sparse).toBe(true);
      // NOT unique on purpose: a duplicate here must never be a hard write failure on a money path.
      expect(found.unique).toBeUndefined();
    });

    it('is idempotent (an identical spec + name is a no-op)', async () => {
      await ensurePaymentSessionIndex(targetDb);
      await ensurePaymentSessionIndex(targetDb);
      const matching = (await targetDb.collection('Payment').indexes())
        .filter((i) => i.key && i.key.gatewaySessionId === 1);
      expect(matching).toHaveLength(1);
    });

    it('being sparse, it does not force manual payments (which have no session) into the index', async () => {
      await ensurePaymentSessionIndex(targetDb);
      const manual = new Payment();
      manual.setReservationPtr(reservationPtr(newReservationId()));
      manual.setMethod('efectivo');
      manual.setAmount(500);
      manual.set('active', true);
      manual.set('exists', true);
      await expect(manual.save(null, { useMasterKey: true })).resolves.toBeDefined();
      created.push(manual);
    });

    it('a lookup by session id finds the row the public return endpoint needs', async () => {
      await ensurePaymentSessionIndex(targetDb);
      const sessionId = `cs_seed029_lookup_${Date.now()}`;
      const payment = await makePending(newReservationId(), sessionId);

      const q = new Parse.Query('Payment');
      q.equalTo('gatewaySessionId', sessionId);
      const found = await q.first({ useMasterKey: true });
      expect(found).toBeDefined();
      expect(found.id).toBe(payment.id);
    });
  });

  describe('the retirement frees the seed-028 slot (or no new checkout could ever be opened again)', () => {
    it('a swept row leaves the partial unique index, so a fresh pending can be created', async () => {
      await ensurePaymentPendingUniqueIndex(targetDb);
      const reservationId = newReservationId();
      const first = await makePending(reservationId, `cs_seed029_slot_a_${Date.now()}`);

      // While it is live, the index really is enforcing one-per-reservation.
      const blocked = new Payment();
      blocked.setReservationPtr(reservationPtr(reservationId));
      blocked.setChannel('online');
      blocked.setGateway('stripe');
      blocked.setGatewayStatus('requires_payment');
      blocked.setMethod('tarjeta');
      blocked.setAmount(1000);
      blocked.set('active', true);
      blocked.set('exists', true);
      await expect(blocked.save(null, { useMasterKey: true })).rejects.toMatchObject({
        code: Parse.Error.DUPLICATE_VALUE,
      });

      // Retire it exactly as the sweep does.
      const { matchedCount } = await atomicRetirePayment(first.id);
      expect(matchedCount).toBe(1);

      // Now the slot is free: exists:false puts the row outside the partial filter.
      const replacement = await makePending(reservationId, `cs_seed029_slot_b_${Date.now()}`);
      expect(replacement.id).toBeDefined();
      expect(replacement.id).not.toBe(first.id);
    });
  });

  describe('the schema contract the seed encodes', () => {
    it('declares exactly the four PR6 fields, with the right types', () => {
      expect(PAYMENT_ROLLUP_FIELDS).toEqual([
        { name: 'retiredBySystem', type: 'Boolean' },
        { name: 'lastReconciledAt', type: 'Date' },
        { name: 'requiresRefundReview', type: 'Boolean' },
        { name: 'requiresRollupRepair', type: 'Boolean' },
      ]);
    });

    it('protects all four from a masterKey-less read (they are internal housekeeping state)', () => {
      expect(PCI_PROTECTED_FIELDS.sort()).toEqual([
        'lastReconciledAt', 'requiresRefundReview', 'requiresRollupRepair', 'retiredBySystem',
      ]);
    });

    it('is registered in the manifest (the omission that bit seeds 027/028 does not repeat)', () => {
      const manifest = require('../../../scripts/seeds/manifest.json');
      const entry = manifest.seeds.find((s) => s.name === '029-payment-rollup-online-fields');
      expect(entry).toBeDefined();
      expect(entry.enabled).toBe(true);
      expect(entry.file).toBe('029-payment-rollup-online-fields.js');
      expect(entry.environments.sort()).toEqual(['development', 'production', 'staging']);
      expect(entry.order).toBe(29);
    });
  });
});
