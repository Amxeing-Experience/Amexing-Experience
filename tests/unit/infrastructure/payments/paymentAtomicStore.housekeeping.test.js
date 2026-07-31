/**
 * paymentAtomicStore — the PR6 housekeeping writes (retire / revive / reconciliation cursor /
 * refund-review flag), asserted at the level an integration test cannot show: the EXACT filter and
 * $set each one sends to Mongo.
 *
 * The two that matter are a matched pair. atomicRetirePayment must never be able to walk a confirmed
 * charge backwards (its status filter is the guard, and it is fixed inside the module — no caller can
 * widen it), and reviveIfSystemRetired must bring back ONLY what our own housekeeping retired, never
 * a row staff deleted on purpose. Getting either half wrong is money: the first loses a charge that
 * just cleared, the second resurrects a record somebody deliberately removed.
 *
 * The mongodb driver is mocked so the write shape is observable; the end-to-end behavior against a
 * real Mongo is covered by the PR6 integration suites.
 */

let findOneAndUpdateImpl;

jest.mock('mongodb', () => ({
  MongoClient: class FakeMongoClient {
    async connect() { return this; }

    db() {
      return {
        collection: () => ({
          findOneAndUpdate: (...args) => findOneAndUpdateImpl(...args),
        }),
      };
    }

    async close() { /* nothing to close */ }
  },
}));

const store = require('../../../../src/infrastructure/payments/paymentAtomicStore');

describe('paymentAtomicStore — PR6 housekeeping writes', () => {
  const savedUri = process.env.DATABASE_URI;
  let lastCall;

  beforeEach(async () => {
    await store.closeForTests();
    process.env.DATABASE_URI = 'mongodb://127.0.0.1:27018/AmexingTEST';
    lastCall = null;
    findOneAndUpdateImpl = (filter, update, options) => {
      lastCall = { filter, update, options };
      return Promise.resolve({ _id: 'pay_1' });
    };
  });

  afterAll(async () => {
    await store.closeForTests();
    if (savedUri === undefined) delete process.env.DATABASE_URI;
    else process.env.DATABASE_URI = savedUri;
  });

  // -----------------------------------------------------------------------------------------
  describe('atomicRetirePayment — RBS-U1/U2/U8', () => {
    it('filters by _id AND requires_payment ONLY AND exists, and retires in one write', async () => {
      await store.atomicRetirePayment('pay_abc');

      expect(lastCall.filter).toEqual({
        _id: 'pay_abc',
        gatewayStatus: { $in: ['requires_payment'] },
        exists: true,
      });
      const { $set } = lastCall.update;
      expect($set.gatewayStatus).toBe('expired');
      expect($set.exists).toBe(false);
      expect($set.active).toBe(false);
      expect($set.retiredBySystem).toBe(true);
      expect($set.deletedAt).toBeInstanceOf(Date);
      expect($set._updated_at).toBeInstanceOf(Date);
      expect(lastCall.options).toEqual({ returnDocument: 'after' });
      // ONE conditional operation, never a read followed by a save.
      expect(Object.keys(lastCall.update)).toEqual(['$set']);
    });

    it('never carries a user in deletedBy (housekeeping has no author, and its absence is the trace)', async () => {
      await store.atomicRetirePayment('pay_abc');
      expect(Object.prototype.hasOwnProperty.call(lastCall.update.$set, 'deletedBy')).toBe(false);
    });

    it('does NOT include processing among the retirable statuses (money still in flight)', async () => {
      await store.atomicRetirePayment('pay_abc');
      expect(lastCall.filter.gatewayStatus.$in).not.toContain('processing');
      expect(store.RETIRABLE_STATUSES).toEqual(['requires_payment']);
    });

    it('a row that already moved on matches nothing => matchedCount 0, no throw', async () => {
      findOneAndUpdateImpl = () => Promise.resolve(null);
      await expect(store.atomicRetirePayment('pay_abc'))
        .resolves.toEqual({ matchedCount: 0, updatedDoc: null });
    });

    it('a row STAFF already deleted is never stamped as system-retired (the invariant of the revive)', async () => {
      // deletePayment reaches a LIVE pending, so a staff delete can land while expireCheckout is in
      // flight. Without exists:true in the filter, this write would put retiredBySystem:true on a
      // deliberate human deletion — and the revive would later be authorized to resurrect it.
      findOneAndUpdateImpl = (filter) => {
        const deletedByStaff = { _id: 'pay_abc', gatewayStatus: 'requires_payment', exists: false };
        const matches = filter.exists === true && deletedByStaff.exists === true;
        return Promise.resolve(matches ? deletedByStaff : null);
      };
      await expect(store.atomicRetirePayment('pay_abc'))
        .resolves.toEqual({ matchedCount: 0, updatedDoc: null });
    });

    it('coerces a non-string paymentId instead of sending a raw value into the filter', async () => {
      await store.atomicRetirePayment(12345);
      expect(lastCall.filter._id).toBe('12345');
    });

    it.each([[null], [undefined], ['']])('a falsy paymentId (%p) throws and writes nothing', async (id) => {
      let called = false;
      findOneAndUpdateImpl = () => { called = true; return Promise.resolve(null); };
      await expect(store.atomicRetirePayment(id)).rejects.toThrow(/required/);
      expect(called).toBe(false);
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('reviveIfSystemRetired — RBS-U3/U4/U5', () => {
    it('matches only a row flagged retiredBySystem AND soft-deleted, and restores visibility', async () => {
      await store.reviveIfSystemRetired('pay_abc');

      expect(lastCall.filter).toEqual({
        _id: 'pay_abc',
        retiredBySystem: true,
        exists: false,
      });
      const { $set } = lastCall.update;
      expect($set.exists).toBe(true);
      expect($set.active).toBe(true);
      expect($set.retiredBySystem).toBe(false);
      expect($set._updated_at).toBeInstanceOf(Date);
      expect(lastCall.options).toEqual({ returnDocument: 'after' });
    });

    it('keeps the deletion audit trail (deletedAt/deletedBy are never unset, unlike restore())', async () => {
      await store.reviveIfSystemRetired('pay_abc');
      expect(Object.prototype.hasOwnProperty.call(lastCall.update, '$unset')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(lastCall.update.$set, 'deletedAt')).toBe(false);
    });

    it('never touches a money field (only visibility flags move)', async () => {
      await store.reviveIfSystemRetired('pay_abc');
      expect(Object.keys(lastCall.update.$set).sort())
        .toEqual(['_updated_at', 'active', 'exists', 'retiredBySystem']);
    });

    it('a DELIBERATE staff delete (no marker) matches nothing => matchedCount 0, doc untouched', async () => {
      // The filter itself is the assertion: Mongo will not match a row without retiredBySystem:true.
      findOneAndUpdateImpl = (filter) => {
        const deliberatelyDeleted = { _id: 'pay_abc', exists: false }; // no retiredBySystem at all
        const matches = filter.retiredBySystem === true && deliberatelyDeleted.retiredBySystem === true;
        return Promise.resolve(matches ? deliberatelyDeleted : null);
      };
      await expect(store.reviveIfSystemRetired('pay_abc'))
        .resolves.toEqual({ matchedCount: 0, updatedDoc: null });
    });

    it('a row that is already visible is a clean no-op (idempotent under a double attempt)', async () => {
      findOneAndUpdateImpl = (filter) => {
        const alreadyBack = { _id: 'pay_abc', exists: true, retiredBySystem: false };
        const matches = filter.exists === false && alreadyBack.exists === false;
        return Promise.resolve(matches ? alreadyBack : null);
      };
      await expect(store.reviveIfSystemRetired('pay_abc'))
        .resolves.toEqual({ matchedCount: 0, updatedDoc: null });
    });

    it.each([[null], [undefined], ['']])('a falsy paymentId (%p) throws and writes nothing', async (id) => {
      let called = false;
      findOneAndUpdateImpl = () => { called = true; return Promise.resolve(null); };
      await expect(store.reviveIfSystemRetired(id)).rejects.toThrow(/required/);
      expect(called).toBe(false);
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('stampReconciled — the batch cursor', () => {
    it('writes only lastReconciledAt, filtered by _id, with no status condition', async () => {
      const at = new Date('2026-07-30T12:00:00.000Z');
      await store.stampReconciled('pay_abc', at);
      expect(lastCall.filter).toEqual({ _id: 'pay_abc' });
      expect(lastCall.update.$set.lastReconciledAt).toBe(at);
      expect(Object.keys(lastCall.update.$set).sort()).toEqual(['_updated_at', 'lastReconciledAt']);
    });

    it('defaults to now when no timestamp is given', async () => {
      await store.stampReconciled('pay_abc');
      expect(lastCall.update.$set.lastReconciledAt).toBeInstanceOf(Date);
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('flagRefundReview — the cancelled-reservation marker', () => {
    it('sets only requiresRefundReview, filtered by _id', async () => {
      await store.flagRefundReview('pay_abc');
      expect(lastCall.filter).toEqual({ _id: 'pay_abc' });
      expect(lastCall.update.$set.requiresRefundReview).toBe(true);
      expect(Object.keys(lastCall.update.$set).sort()).toEqual(['_updated_at', 'requiresRefundReview']);
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('flagRollupRepair — the confirmed-but-unrolled marker', () => {
    it('sets only requiresRollupRepair, filtered by _id', async () => {
      await store.flagRollupRepair('pay_abc');
      expect(lastCall.filter).toEqual({ _id: 'pay_abc' });
      expect(lastCall.update.$set.requiresRollupRepair).toBe(true);
      expect(Object.keys(lastCall.update.$set).sort()).toEqual(['_updated_at', 'requiresRollupRepair']);
    });

    it('clears with an explicit false (the repair path closes its own alert)', async () => {
      await store.flagRollupRepair('pay_abc', false);
      expect(lastCall.update.$set.requiresRollupRepair).toBe(false);
    });

    it.each([['a truthy string', '1'], ['a number', 1], ['null', null]])(
      'coerces %s to a strict FALSE (a Mongo filter matches literal true, never truthy)',
      async (_label, value) => {
        await store.flagRollupRepair('pay_abc', value);
        expect(typeof lastCall.update.$set.requiresRollupRepair).toBe('boolean');
        expect(lastCall.update.$set.requiresRollupRepair).toBe(false);
      }
    );

    it('an omitted argument means SET (the default), never clear', async () => {
      await store.flagRollupRepair('pay_abc', undefined);
      expect(lastCall.update.$set.requiresRollupRepair).toBe(true);
    });

    it('never touches a money field nor the lifecycle flags', async () => {
      await store.flagRollupRepair('pay_abc');
      expect(Object.prototype.hasOwnProperty.call(lastCall.update.$set, 'gatewayStatus')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(lastCall.update.$set, 'exists')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(lastCall.update.$set, 'amount')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('backfillAuditFields — rellena SOLO lo ausente', () => {
    it('exige que CADA campo propuesto siga ausente, así que nunca pisa al ganador', async () => {
      await store.backfillAuditFields('pay_abc', { gatewayChargeId: 'ch_tarde', gatewayIntentId: 'pi_tarde' });

      expect(lastCall.filter).toEqual({
        _id: 'pay_abc',
        gatewayChargeId: { $in: [null, ''] },
        gatewayIntentId: { $in: [null, ''] },
      });
      expect(lastCall.update.$set.gatewayChargeId).toBe('ch_tarde');
      expect(lastCall.update.$set.gatewayIntentId).toBe('pi_tarde');
    });

    it('el gatewayRaw de una discrepancia viaja igual, en UNA sola escritura condicional', async () => {
      const raw = { id: 'ch_1', discrepancy: { storedAmount: 100, chargedAmount: 120 } };
      await store.backfillAuditFields('pay_abc', { gatewayRaw: raw });

      expect(lastCall.filter).toEqual({ _id: 'pay_abc', gatewayRaw: { $in: [null, ''] } });
      expect(lastCall.update.$set.gatewayRaw).toEqual(raw);
      expect(Object.keys(lastCall.update)).toEqual(['$set']);
    });

    it('un campo fuera del allowlist se ignora: el nombre nunca es elección del llamador', async () => {
      await store.backfillAuditFields('pay_abc', { amount: 999999, gatewayChargeId: 'ch_tarde' });

      expect(Object.prototype.hasOwnProperty.call(lastCall.update.$set, 'amount')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(lastCall.filter, 'amount')).toBe(false);
      expect(lastCall.update.$set.gatewayChargeId).toBe('ch_tarde');
    });

    it('no toca el estado ni las banderas de ciclo de vida ni el monto', async () => {
      await store.backfillAuditFields('pay_abc', { gatewayChargeId: 'ch_tarde' });
      ['gatewayStatus', 'exists', 'active', 'amount', 'confirmedAt'].forEach((campo) => {
        expect(Object.prototype.hasOwnProperty.call(lastCall.update.$set, campo)).toBe(false);
      });
    });

    it.each([[{}], [{ gatewayChargeId: '' }], [{ amount: 1 }], [null]])(
      'sin nada rescatable (%p) no escribe en absoluto',
      async (fields) => {
        const out = await store.backfillAuditFields('pay_abc', fields);
        expect(lastCall).toBeNull();
        expect(out.matchedCount).toBe(0);
      }
    );

    it('sin paymentId lanza, como el resto del store', async () => {
      await expect(store.backfillAuditFields('', { gatewayChargeId: 'ch_tarde' }))
        .rejects.toThrow('paymentId is required');
    });
  });
});
