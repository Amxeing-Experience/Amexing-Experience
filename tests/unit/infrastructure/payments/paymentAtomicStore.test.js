/**
 * paymentAtomicStore — lazy CACHED MongoClient singleton + the exact shape of the conditional update.
 *
 * Two things are asserted here that an integration test cannot show: that the client is built and
 * connected ONCE and reused by every webhook (a fresh connection per delivery would be the difference
 * between answering inside Stripe's 20s budget and not answering at all under load), and that the
 * filter really carries the status guard INSIDE the write — the whole point of dropping to the driver
 * instead of doing a Parse read-then-save.
 *
 * The mongodb driver is mocked so the construction/connect count is observable; the real end-to-end
 * behavior against Mongo is covered by the webhook integration suites.
 */

const connectCalls = [];
const constructions = [];
let findOneAndUpdateImpl;

jest.mock('mongodb', () => ({
  MongoClient: class FakeMongoClient {
    constructor(uri, options) {
      constructions.push({ uri, options });
      this.closed = false;
    }

    async connect() {
      connectCalls.push(Date.now());
      // A real connect is async; resolving on a later tick is what makes a naive
      // "if (!client) build" implementation build twice under concurrency.
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      if (this.shouldFail) throw new Error('connect failed');
      return this;
    }

    db() {
      return {
        collection: () => ({
          findOneAndUpdate: (...args) => findOneAndUpdateImpl(...args),
        }),
      };
    }

    async close() {
      this.closed = true;
    }
  },
}));

const store = require('../../../../src/infrastructure/payments/paymentAtomicStore');

describe('paymentAtomicStore', () => {
  const savedUri = process.env.DATABASE_URI;
  let lastCall;

  beforeEach(async () => {
    await store.closeForTests();
    connectCalls.length = 0;
    constructions.length = 0;
    process.env.DATABASE_URI = 'mongodb://127.0.0.1:27018/AmexingTEST';
    lastCall = null;
    findOneAndUpdateImpl = (filter, update, options) => {
      lastCall = { filter, update, options };
      return Promise.resolve({ _id: 'pay_1', gatewayStatus: 'succeeded' });
    };
  });

  afterAll(async () => {
    await store.closeForTests();
    if (savedUri === undefined) delete process.env.DATABASE_URI;
    else process.env.DATABASE_URI = savedUri;
  });

  const transition = (id = 'pay_1', overrides = {}) => store.atomicTransitionPayment(id, {
    fromStatuses: ['requires_payment', 'processing'],
    toStatus: 'succeeded',
    ...overrides,
  });

  describe('lazy CACHED singleton (never a connection per webhook)', () => {
    it('requiring the module connects nothing at all', () => {
      expect(constructions).toHaveLength(0);
      expect(connectCalls).toHaveLength(0);
    });

    it('ten sequential transitions build ONE client and connect ONCE', async () => {
      for (let i = 0; i < 10; i += 1) {
        await transition(`pay_${i}`); // eslint-disable-line no-await-in-loop
      }
      expect(constructions).toHaveLength(1);
      expect(connectCalls).toHaveLength(1);
    });

    it('ten CONCURRENT transitions (before the first connect resolves) still connect ONCE', async () => {
      // Caching the client instead of the connect PROMISE would open ten connections here.
      await Promise.all(Array.from({ length: 10 }, (_, i) => transition(`pay_${i}`)));
      expect(constructions).toHaveLength(1);
      expect(connectCalls).toHaveLength(1);
    });

    it('the connection is bounded by a server-selection timeout (a Mongo blip cannot hang past 20s)', async () => {
      await transition();
      expect(constructions[0].options.serverSelectionTimeoutMS).toBeLessThanOrEqual(15000);
      expect(constructions[0].options.serverSelectionTimeoutMS).toBeGreaterThan(0);
    });

    it('a FAILED connect does not poison the cache: the next webhook retries and succeeds', async () => {
      const { MongoClient } = require('mongodb');
      const originalConnect = MongoClient.prototype.connect;
      let first = true;
      MongoClient.prototype.connect = async function failingOnce() {
        connectCalls.push(Date.now());
        await new Promise((resolve) => { setTimeout(resolve, 5); });
        if (first) { first = false; throw new Error('connect failed'); }
        return this;
      };
      try {
        await expect(transition()).rejects.toThrow(/connect failed/);
        // A cached, permanently-rejected promise would make every later webhook fail forever.
        await expect(transition()).resolves.toEqual(
          expect.objectContaining({ matchedCount: 1 })
        );
        expect(constructions).toHaveLength(2); // rebuilt, not reused-broken
      } finally {
        MongoClient.prototype.connect = originalConnect;
      }
    });

    it('a missing DATABASE_URI fails loudly instead of connecting somewhere unexpected', async () => {
      await store.closeForTests();
      delete process.env.DATABASE_URI;
      await expect(transition()).rejects.toThrow(/DATABASE_URI/);
      expect(constructions).toHaveLength(0);
    });
  });

  describe('the guard lives INSIDE the write (not a read-then-save)', () => {
    it('filters by _id AND the allowed source statuses in the same operation', async () => {
      await transition('pay_abc');
      expect(lastCall.filter).toEqual({
        _id: 'pay_abc',
        gatewayStatus: { $in: ['requires_payment', 'processing'] },
      });
      expect(lastCall.options).toEqual({ returnDocument: 'after' });
    });

    it('sets the destination status and refreshes Parse\'s updatedAt', async () => {
      await transition('pay_abc');
      expect(lastCall.update.$set.gatewayStatus).toBe('succeeded');
      expect(lastCall.update.$set._updated_at).toBeInstanceOf(Date);
    });

    it('merges extraSet (e.g. confirmedAt) into the same atomic write', async () => {
      const confirmedAt = new Date();
      await transition('pay_abc', { extraSet: { confirmedAt } });
      expect(lastCall.update.$set.confirmedAt).toBe(confirmedAt);
      expect(lastCall.update.$set.gatewayStatus).toBe('succeeded');
    });

    it('extraSet can NEVER override the destination status (applied last on purpose)', async () => {
      await transition('pay_abc', { extraSet: { gatewayStatus: 'refunded', amount: 999999 } });
      expect(lastCall.update.$set.gatewayStatus).toBe('succeeded');
    });

    it('coerces a non-string paymentId rather than sending a raw object into the filter', async () => {
      await store.atomicTransitionPayment(12345, {
        fromStatuses: ['requires_payment'], toStatus: 'failed',
      });
      expect(lastCall.filter._id).toBe('12345');
    });
  });

  describe('result normalization', () => {
    it('a returned document => matchedCount 1 (mongodb@6 shape)', async () => {
      findOneAndUpdateImpl = () => Promise.resolve({ _id: 'p', gatewayStatus: 'succeeded' });
      expect(await transition()).toEqual({
        matchedCount: 1, updatedDoc: { _id: 'p', gatewayStatus: 'succeeded' },
      });
    });

    it('null => matchedCount 0 (no document matched the guard)', async () => {
      findOneAndUpdateImpl = () => Promise.resolve(null);
      expect(await transition()).toEqual({ matchedCount: 0, updatedDoc: null });
    });

    it('the legacy { value } wrapper is understood too (driver-bump safety)', async () => {
      findOneAndUpdateImpl = () => Promise.resolve({ value: { _id: 'p' }, ok: 1 });
      expect(await transition()).toEqual({ matchedCount: 1, updatedDoc: { _id: 'p' } });
    });

    it('the legacy wrapper with a null value => matchedCount 0', async () => {
      findOneAndUpdateImpl = () => Promise.resolve({ value: null, ok: 1 });
      expect(await transition()).toEqual({ matchedCount: 0, updatedDoc: null });
    });

    it('the FULL legacy wrapper (value + lastErrorObject + ok) unwraps to the document', async () => {
      const doc = { _id: 'p', gatewayStatus: 'succeeded' };
      findOneAndUpdateImpl = () => Promise.resolve({
        value: doc, lastErrorObject: { n: 1, updatedExisting: true }, ok: 1,
      });
      expect(await transition()).toEqual({ matchedCount: 1, updatedDoc: doc });
    });

    it('the legacy wrapper is recognized by lastErrorObject alone (no ok field)', async () => {
      findOneAndUpdateImpl = () => Promise.resolve({ value: { _id: 'p' }, lastErrorObject: { n: 1 } });
      expect(await transition()).toEqual({ matchedCount: 1, updatedDoc: { _id: 'p' } });
    });

    it('the legacy wrapper that matched nothing (value null + lastErrorObject) => matchedCount 0', async () => {
      findOneAndUpdateImpl = () => Promise.resolve({
        value: null, lastErrorObject: { n: 0, updatedExisting: false }, ok: 1,
      });
      expect(await transition()).toEqual({ matchedCount: 0, updatedDoc: null });
    });

    // The wrapper is detected by lastErrorObject/ok — metadata that belongs ONLY to the driver's
    // legacy envelope — never by the presence of 'value', which is an ordinary word a Payment could
    // legitimately own one day. Keyed on 'value', a document carrying a FALSY one would unwrap to
    // that falsy value and report matchedCount 0 for a transition that really happened: the rollup
    // would be skipped and the reservation would keep showing a balance for money already collected.
    it.each([
      ['a string', 'algo-no-relacionado'],
      ['null', null],
      ['zero', 0],
      ['false', false],
      ['an empty string', ''],
      ['an object', { anidado: true }],
    ])('a modern document owning a field named "value" (%s) is still read as the document', async (_label, value) => {
      const doc = {
        _id: 'p', gatewayStatus: 'succeeded', amount: 1000, value,
      };
      findOneAndUpdateImpl = () => Promise.resolve(doc);
      expect(await transition()).toEqual({ matchedCount: 1, updatedDoc: doc });
    });

    it('undefined (a driver that returns nothing at all) => matchedCount 0, never a crash', async () => {
      findOneAndUpdateImpl = () => Promise.resolve(undefined);
      expect(await transition()).toEqual({ matchedCount: 0, updatedDoc: null });
    });
  });

  describe('argument validation (a malformed call must never become an unguarded write)', () => {
    it.each([
      ['no paymentId', [null, { fromStatuses: ['requires_payment'], toStatus: 'succeeded' }]],
      ['empty paymentId', ['', { fromStatuses: ['requires_payment'], toStatus: 'succeeded' }]],
      ['no options', ['pay_1', undefined]],
      ['empty fromStatuses', ['pay_1', { fromStatuses: [], toStatus: 'succeeded' }]],
      ['fromStatuses not an array', ['pay_1', { fromStatuses: 'requires_payment', toStatus: 'succeeded' }]],
      ['no toStatus', ['pay_1', { fromStatuses: ['requires_payment'] }]],
      ['empty toStatus', ['pay_1', { fromStatuses: ['requires_payment'], toStatus: '' }]],
    ])('%s => throws, and nothing is written', async (_label, args) => {
      let called = false;
      findOneAndUpdateImpl = () => { called = true; return Promise.resolve(null); };
      await expect(store.atomicTransitionPayment(...args)).rejects.toThrow(/required/);
      expect(called).toBe(false);
    });
  });

  describe('test seam', () => {
    it('an injected Db short-circuits the singleton entirely (no client is ever built)', async () => {
      let seen = null;
      store.setDbForTests({
        collection: () => ({
          findOneAndUpdate: (filter) => { seen = filter; return Promise.resolve(null); },
        }),
      });
      try {
        const result = await transition('pay_injected');
        expect(result.matchedCount).toBe(0);
        expect(seen._id).toBe('pay_injected');
        expect(constructions).toHaveLength(0);
      } finally {
        store.setDbForTests(null);
      }
    });
  });
});
