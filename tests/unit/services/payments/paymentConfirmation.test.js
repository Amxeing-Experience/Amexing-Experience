/**
 * paymentConfirmation — the ONE confirmation core, unit-level (no Parse server, no Mongo, no SDK).
 *
 * What is pinned here is the decision tree the three callers now share, and above all the REVIVE
 * pair, which is where money is won or lost:
 *
 * - Our own housekeeping retired the row and the card then cleared => revive it, INFO. Without this,
 *   loadAndCompute (exists:true) recomputes the rollup WITHOUT a charge that really happened.
 * - Staff deleted the row deliberately and a confirmation arrives => do NOT revive, ERROR. This is
 *   the symmetric half the plan's first draft was missing: restoring here would silently override a
 *   human decision.
 * - Another path revived it a millisecond earlier => silence. A benign race must not page anybody.
 *
 * It also pins that the row's post-write state, not the caller's pre-write copy, decides whether a
 * revive is attempted: the caller read the Payment BEFORE the transition, so in the exact race this
 * PR exists for its copy still says exists:true.
 */

jest.mock('../../../../src/infrastructure/payments/paymentAtomicStore', () => ({
  atomicTransitionPayment: jest.fn(),
  reviveIfSystemRetired: jest.fn(),
  flagRefundReview: jest.fn(),
  flagRollupRepair: jest.fn(),
  backfillChargeId: jest.fn(),
}));

const Parse = require('parse/node');
const PaymentService = require('../../../../src/application/services/PaymentService');
const logger = require('../../../../src/infrastructure/logger');
const store = require('../../../../src/infrastructure/payments/paymentAtomicStore');
const { applyConfirmation } = require('../../../../src/application/services/payments/paymentConfirmation');

const SUCCESS = { gatewayStatus: 'succeeded', crossesThreshold: true };
const EXPIRED = { gatewayStatus: 'expired', crossesThreshold: false };

describe('paymentConfirmation.applyConfirmation', () => {
  let getSpy;
  let recalcSpy;
  let healSpy;
  let infoSpy;
  let warnSpy;
  let errorSpy;

  // A located Payment as each caller hands it over: the copy read BEFORE the transition.
  const paymentDouble = (exists = true, reservationId = 'res_1') => ({
    id: 'pay_1',
    getReservationPtr: () => (reservationId ? { id: reservationId } : null),
    get: (field) => (field === 'exists' ? exists : undefined),
  });

  // A Parse row as loadCurrent would return it.
  const rowDouble = (fields) => ({ get: (field) => fields[field] });

  const criticalLog = () => errorSpy.mock.calls.find(([msg]) => String(msg).includes('rollup cannot see'));
  const reviveLog = () => infoSpy.mock.calls.find(([msg]) => String(msg).includes('Revived a gateway payment'));
  const cancelledLog = () => errorSpy.mock.calls.find(([msg]) => String(msg).includes('ALREADY CANCELLED'));

  beforeEach(() => {
    getSpy = jest.spyOn(Parse.Query.prototype, 'get')
      .mockRejectedValue(new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Object not found.'));
    recalcSpy = jest.spyOn(PaymentService, 'recalculate').mockResolvedValue({});
    healSpy = jest.spyOn(PaymentService, 'recalculateIfStale').mockResolvedValue({ healed: false });
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    store.atomicTransitionPayment.mockReset();
    store.atomicTransitionPayment.mockResolvedValue({ matchedCount: 0, updatedDoc: null });
    store.reviveIfSystemRetired.mockReset();
    store.reviveIfSystemRetired.mockResolvedValue({ matchedCount: 0, updatedDoc: null });
    store.flagRefundReview.mockReset();
    store.flagRefundReview.mockResolvedValue({ matchedCount: 1, updatedDoc: null });
    store.flagRollupRepair.mockReset();
    store.flagRollupRepair.mockResolvedValue({ matchedCount: 1, updatedDoc: null });
    store.backfillChargeId.mockReset();
    store.backfillChargeId.mockResolvedValue({ matchedCount: 1, updatedDoc: null });
  });

  afterEach(() => {
    getSpy.mockRestore();
    recalcSpy.mockRestore();
    healSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const confirm = (overrides = {}) => applyConfirmation({
    payment: paymentDouble(),
    destination: SUCCESS,
    source: 'webhook',
    ...overrides,
  });

  // -----------------------------------------------------------------------------------------
  describe('every caller transitions with the SAME guard (PC-I2 at unit level)', () => {
    it.each(['webhook', 'polling', 'reconciliation'])(
      'source %p sends the shared succeeded allowlist, not a private list',
      async (source) => {
        store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
        await confirm({ source });
        const [paymentId, options] = store.atomicTransitionPayment.mock.calls[0];
        expect(paymentId).toBe('pay_1');
        expect(options.fromStatuses.sort())
          .toEqual(['expired', 'failed', 'processing', 'requires_payment']);
        expect(options.toStatus).toBe('succeeded');
      }
    );

    it('a non-succeeded destination uses the narrower pending-only allowlist', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
      await confirm({ destination: EXPIRED });
      const options = store.atomicTransitionPayment.mock.calls[0][1];
      expect(options.fromStatuses.sort()).toEqual(['processing', 'requires_payment']);
      expect(options.fromStatuses).not.toContain('succeeded');
    });

    it('extraSet travels in the SAME atomic write and can never rewrite the destination', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
      await confirm({ extraSet: { gatewayChargeId: 'ch_1' } });
      const options = store.atomicTransitionPayment.mock.calls[0][1];
      expect(options.extraSet.gatewayChargeId).toBe('ch_1');
      expect(options.extraSet.confirmedAt).toBeInstanceOf(Date);
      expect(options.toStatus).toBe('succeeded');
    });

    it('only a succeeded destination stamps confirmedAt', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
      await confirm({ destination: EXPIRED });
      expect(store.atomicTransitionPayment.mock.calls[0][1].extraSet).toEqual({});
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('WARN-U1/U2/U3 — the revive pair', () => {
    it('WARN-U2: a row OUR housekeeping retired is revived, and it is an INFO (not an alarm)', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: false } });
      store.reviveIfSystemRetired.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });

      const out = await confirm();
      expect(out.revived).toBe(true);
      expect(out.invisibleToRollup).toBe(false);
      expect(reviveLog()).toBeDefined();
      expect(criticalLog()).toBeUndefined();
      // The revive runs BEFORE the rollup, or loadAndCompute would recompute without this charge.
      expect(store.reviveIfSystemRetired.mock.invocationCallOrder[0])
        .toBeLessThan(recalcSpy.mock.invocationCallOrder[0]);
      expect(recalcSpy).toHaveBeenCalledTimes(1);
    });

    it('WARN-U1: a DELIBERATE delete is never revived, and it IS an alarm', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: false } });
      store.reviveIfSystemRetired.mockResolvedValueOnce({ matchedCount: 0, updatedDoc: null });
      getSpy.mockResolvedValueOnce(rowDouble({ exists: false }));

      const out = await confirm();
      expect(out.revived).toBe(false);
      expect(out.invisibleToRollup).toBe(true);
      expect(criticalLog()).toBeDefined();
      expect(criticalLog()[1]).toMatchObject({ paymentId: 'pay_1', gatewayStatus: 'succeeded' });
      expect(reviveLog()).toBeUndefined();
      // Shouting never replaces doing the work: the transition and the rollup still happened.
      expect(recalcSpy).toHaveBeenCalledTimes(1);
    });

    it('WARN-U3: our revive lost a benign race (another path got there first) => no alarm', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: false } });
      store.reviveIfSystemRetired.mockResolvedValueOnce({ matchedCount: 0, updatedDoc: null });
      getSpy.mockResolvedValueOnce(rowDouble({ exists: true })); // somebody already brought it back

      const out = await confirm();
      expect(out.revived).toBe(false);
      expect(out.invisibleToRollup).toBe(false);
      expect(criticalLog()).toBeUndefined();
    });

    it('a re-read that fails leaves the alarm ON (silence is only for a row proven visible)', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: false } });
      getSpy.mockRejectedValueOnce(new Error('mongo down'));
      const out = await confirm();
      expect(out.invisibleToRollup).toBe(true);
      expect(criticalLog()).toBeDefined();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('a live row never even attempts a revive (the common case costs nothing)', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
      const out = await confirm();
      expect(store.reviveIfSystemRetired).not.toHaveBeenCalled();
      expect(out.revived).toBe(false);
      expect(out.invisibleToRollup).toBe(false);
      expect(criticalLog()).toBeUndefined();
    });

    it('the POST-WRITE document decides, not the stale copy the caller read before the transition', async () => {
      // The caller's copy says exists:true (it was read before housekeeping retired the row); the
      // document the conditional update returned says exists:false. Trusting the copy would skip the
      // revive and lose the charge — this is the interleaving the whole marker exists for.
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: false } });
      store.reviveIfSystemRetired.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: null });
      const out = await confirm({ payment: paymentDouble(true) });
      expect(out.revived).toBe(true);
    });

    it('with NO returned document it falls back to the caller copy (never skips the check entirely)', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1 });
      store.reviveIfSystemRetired.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: null });
      const out = await confirm({ payment: paymentDouble(false) });
      expect(out.revived).toBe(true);
    });

    it('a NON-succeeded destination never revives anything (nothing was confirmed)', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: false } });
      const out = await confirm({ destination: EXPIRED });
      expect(store.reviveIfSystemRetired).not.toHaveBeenCalled();
      expect(out.revived).toBe(false);
      expect(criticalLog()).toBeUndefined();
    });

    it('a plain no-op (nothing transitioned, not already at destination) never revives', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 0, updatedDoc: null });
      getSpy.mockResolvedValueOnce(rowDouble({ gatewayStatus: 'refunded', exists: false }));
      const out = await confirm();
      expect(out.applied).toBe(false);
      expect(store.reviveIfSystemRetired).not.toHaveBeenCalled();
      expect(criticalLog()).toBeUndefined();
    });

    it('the ALREADY-AT-DESTINATION branch revives too (the repair path must restore visibility)', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 0, updatedDoc: null });
      getSpy.mockResolvedValueOnce(rowDouble({ gatewayStatus: 'succeeded', exists: false }));
      store.reviveIfSystemRetired.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: null });

      const out = await confirm();
      expect(out.applied).toBe(false);
      expect(out.revived).toBe(true);
      expect(out.staleRollupChecked).toBe(true);
      expect(healSpy).toHaveBeenCalledTimes(1);
      expect(recalcSpy).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('CANC — a charge that lands on an already-cancelled reservation', () => {
    it('CANC-1: records the money, updates the rollup, leaves the marker AND shouts', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
      getSpy.mockResolvedValueOnce(rowDouble({ status: 'cancelled' }));

      const out = await confirm();
      expect(out.applied).toBe(true);
      expect(out.recalculated).toBe(true); // the money IS recorded, never hidden
      expect(out.flaggedForRefundReview).toBe(true);
      expect(store.flagRefundReview).toHaveBeenCalledWith('pay_1');
      expect(cancelledLog()).toBeDefined();
      expect(cancelledLog()[1]).toMatchObject({ paymentId: 'pay_1', reservationId: 'res_1' });
    });

    it.each(['confirmed', 'pending', 'completed', 'in_progress', undefined, ''])(
      'CANC-2: a reservation at %p leaves NO marker',
      async (status) => {
        store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
        getSpy.mockResolvedValueOnce(rowDouble({ status }));
        const out = await confirm();
        expect(out.flaggedForRefundReview).toBe(false);
        expect(store.flagRefundReview).not.toHaveBeenCalled();
        expect(cancelledLog()).toBeUndefined();
      }
    );

    it('a SIBLING confirmation of an already-confirmed charge does not re-flag it', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 0, updatedDoc: null });
      getSpy.mockResolvedValueOnce(rowDouble({ gatewayStatus: 'succeeded', exists: true }));
      const out = await confirm();
      expect(out.flaggedForRefundReview).toBe(false);
      expect(store.flagRefundReview).not.toHaveBeenCalled();
    });

    it('a non-succeeded destination never flags anything', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
      const out = await confirm({ destination: EXPIRED });
      expect(store.flagRefundReview).not.toHaveBeenCalled();
      expect(out.flaggedForRefundReview).toBe(false);
    });

    it('an unreadable reservation logs a warning and NEVER loses the confirmation', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
      getSpy.mockRejectedValueOnce(new Error('mongo down'));
      const out = await confirm();
      expect(out.applied).toBe(true);
      expect(out.recalculated).toBe(true);
      expect(out.flaggedForRefundReview).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('the returned outcome is what the callers key their answers on', () => {
    it('a real transition reports applied + recalculated, nothing checked', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
      await expect(confirm()).resolves.toMatchObject({
        applied: true,
        recalculated: true,
        staleRollupChecked: false,
        staleRollupRepaired: false,
        revived: false,
        invisibleToRollup: false,
        flaggedForRefundReview: false,
      });
    });

    it('a repair reports checked + repaired, never applied', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 0, updatedDoc: null });
      getSpy.mockResolvedValueOnce(rowDouble({ gatewayStatus: 'succeeded', exists: true }));
      healSpy.mockResolvedValueOnce({ healed: true });
      await expect(confirm()).resolves.toMatchObject({
        applied: false,
        recalculated: false,
        staleRollupChecked: true,
        staleRollupRepaired: true,
      });
    });

    it('a Payment with no reservationPtr logs an error instead of touching the rollup', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
      const out = await confirm({ payment: paymentDouble(true, null) });
      expect(out.applied).toBe(true);
      expect(recalcSpy).not.toHaveBeenCalled();
      expect(healSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('a rollup failure PROPAGATES (the caller decides whether to ask for a retry)', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
      recalcSpy.mockRejectedValueOnce(new Error('rollup down'));
      await expect(confirm()).rejects.toThrow('rollup down');
    });
  });

  // -----------------------------------------------------------------------------------------
  // The one window the atomic transition cannot close by itself: the row is already 'succeeded' and
  // visible, so if the rollup then fails it matches NO reconciliation branch and NO stranded-money
  // query, while the reservation keeps showing a balance for money that was really collected. Only
  // the webhook self-heals (500 -> Stripe re-delivers); the polling and both jobs swallow errors.
  describe('a rollup that fails AFTER the transition won', () => {
    const failRollup = () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
      recalcSpy.mockRejectedValueOnce(new Error('rollup down'));
    };

    it('leaves a durable, queryable marker on the row', async () => {
      failRollup();
      await expect(confirm()).rejects.toThrow('rollup down');
      expect(store.flagRollupRepair).toHaveBeenCalledTimes(1);
      expect(store.flagRollupRepair).toHaveBeenCalledWith('pay_1');
    });

    it('shouts that money was collected without a rollup', async () => {
      failRollup();
      await expect(confirm()).rejects.toThrow('rollup down');
      const critical = errorSpy.mock.calls
        .find(([msg]) => String(msg).includes('rollup could NOT be written'));
      expect(critical).toBeDefined();
      expect(critical[1]).toMatchObject({ paymentId: 'pay_1', reservationId: 'res_1' });
    });

    it('STILL re-throws, so the webhook keeps answering 500 and Stripe re-delivers', async () => {
      // Swallowing it here would trade one recoverable failure mode for a silent one.
      failRollup();
      await expect(confirm()).rejects.toThrow('rollup down');
    });

    it('marks the row BEFORE giving up (the flag write precedes the re-throw)', async () => {
      failRollup();
      await expect(confirm()).rejects.toThrow('rollup down');
      expect(store.flagRollupRepair.mock.invocationCallOrder[0])
        .toBeGreaterThan(recalcSpy.mock.invocationCallOrder[0]);
    });

    it('a failure of the MARKER itself is shouted too, and the original error still propagates', async () => {
      failRollup();
      store.flagRollupRepair.mockRejectedValueOnce(new Error('mongo down'));
      await expect(confirm()).rejects.toThrow('rollup down'); // never 'mongo down'
      expect(errorSpy.mock.calls.find(([msg]) => String(msg).includes('could not even flag')))
        .toBeDefined();
    });

    it('the stale-repair branch is covered by the same net', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 0, updatedDoc: null });
      getSpy.mockResolvedValueOnce(rowDouble({ gatewayStatus: 'succeeded', exists: true }));
      healSpy.mockRejectedValueOnce(new Error('repair down'));
      await expect(confirm()).rejects.toThrow('repair down');
      expect(store.flagRollupRepair).toHaveBeenCalledWith('pay_1');
    });

    it('a successful rollup CLEARS a marker an earlier attempt left behind', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
      const flagged = {
        id: 'pay_1',
        getReservationPtr: () => ({ id: 'res_1' }),
        get: (field) => (field === 'requiresRollupRepair' ? true : undefined),
      };
      await confirm({ payment: flagged });
      expect(store.flagRollupRepair).toHaveBeenCalledWith('pay_1', false);
    });

    it('a row that was never flagged is not written to just to clear a marker it never had', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
      await confirm();
      expect(store.flagRollupRepair).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------------------------
  // Revisión de #335: los tres hallazgos, cada uno con el caso exacto que los dispara.
  describe('la marca de reservación cancelada sobrevive a un rollup que revienta', () => {
    // Un cobro sobre una reservación cancelada es lo que PR11 convierte en solicitud de reembolso.
    // Si la marca dependiera de llegar al final de runRollup, un rollup fallido la perdería PARA
    // SIEMPRE: el re-throw corta, y en el reintento matchedCount ya es 0, así que la rama no
    // vuelve a evaluarse nunca.
    const cancelledReservation = () => {
      getSpy.mockReset();
      getSpy.mockResolvedValue({ id: 'res_1', get: (f) => (f === 'status' ? 'cancelled' : undefined) });
    };

    it('se marca aunque el rollup falle y la llamada termine lanzando', async () => {
      cancelledReservation();
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
      recalcSpy.mockRejectedValueOnce(new Error('mongo caido'));

      await expect(confirm()).rejects.toThrow('mongo caido');
      expect(store.flagRefundReview).toHaveBeenCalledWith('pay_1');
    });

    it('su propio fallo NO impide el rollup: el saldo es dinero, la marca es una bandera', async () => {
      cancelledReservation();
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
      store.flagRefundReview.mockRejectedValueOnce(new Error('no se pudo marcar'));

      await expect(confirm()).resolves.toBeDefined();
      expect(recalcSpy).toHaveBeenCalledWith('res_1');
    });
  });

  describe('el gatewayChargeId no se pierde cuando gana el evento hermano', () => {
    // El update condicional no matchea, así que el extraSet del llamador se descarta entero. Si el
    // polling es el único camino que conoce el id de cargo, PR11 se queda sin con qué reembolsar.
    const siblingAlreadyWon = () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 0, updatedDoc: null });
      getSpy.mockReset();
      getSpy.mockResolvedValue(rowDouble({ gatewayStatus: 'succeeded', exists: true }));
    };

    it('lo rellena cuando la fila ya estaba en el destino', async () => {
      siblingAlreadyWon();
      await confirm({ source: 'polling', extraSet: { gatewayChargeId: 'ch_tarde' } });
      expect(store.backfillChargeId).toHaveBeenCalledWith('pay_1', 'ch_tarde');
    });

    it('no escribe nada cuando el llamador no traía id de cargo', async () => {
      siblingAlreadyWon();
      await confirm({ source: 'polling', extraSet: { gatewayRaw: {} } });
      expect(store.backfillChargeId).not.toHaveBeenCalled();
    });

    it('un backfill que falla no tumba la confirmación', async () => {
      siblingAlreadyWon();
      store.backfillChargeId.mockRejectedValueOnce(new Error('mongo caido'));
      await expect(confirm({ source: 'polling', extraSet: { gatewayChargeId: 'ch_tarde' } }))
        .resolves.toBeDefined();
    });

    it('cuando ESTA llamada gana la transición no hay nada que rellenar', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
      await confirm({ source: 'polling', extraSet: { gatewayChargeId: 'ch_ganador' } });
      expect(store.backfillChargeId).not.toHaveBeenCalled();
    });
  });

  describe('extraSet no puede escribir los dos campos que este módulo gobierna', () => {
    it('un confirmedAt del llamador se descarta en un destino NO exitoso', async () => {
      const suyo = new Date('2020-01-01T00:00:00.000Z');
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
      await confirm({ destination: EXPIRED, extraSet: { confirmedAt: suyo, gatewayChargeId: 'ch_1' } });

      const [, options] = store.atomicTransitionPayment.mock.calls[0];
      expect(options.extraSet.confirmedAt).toBeUndefined();
      expect(options.extraSet.gatewayChargeId).toBe('ch_1');
    });

    it('un gatewayStatus del llamador tampoco viaja en el extraSet', async () => {
      store.atomicTransitionPayment.mockResolvedValueOnce({ matchedCount: 1, updatedDoc: { exists: true } });
      await confirm({ extraSet: { gatewayStatus: 'refunded' } });

      const [, options] = store.atomicTransitionPayment.mock.calls[0];
      expect(options.extraSet.gatewayStatus).toBeUndefined();
      expect(options.toStatus).toBe('succeeded');
    });
  });
});
