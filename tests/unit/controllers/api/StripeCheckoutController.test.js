/**
 * StripeCheckoutController — focused unit tests for the council-round-2 fixes (no Parse server, no
 * network): every collaborating static is stubbed except the pure logic under test.
 *
 * - resolveWinner (MEDIUM): the cross-worker DUPLICATE_VALUE winner is reused ONLY when its FROZEN amount
 *   still matches the current charge; a stale winner is retired and re-priced, bounded to a single retry
 *   (a second collision => a retryable conflict, never a loop).
 * - retirePending (MEDIUM): a transient expireCheckout failure is retried exactly once and never blocks
 *   the local retirement (best-effort, session auto-expires via the frozen expires_at).
 * - frozenSessionExpiresAt (HIGH): the session expiry is derived from the pending's OWN expiresAt/createdAt,
 *   never Date.now(), so an idempotent replay sends identical params, with a cushion wide enough to survive
 *   the SDK's worst-case network budget (review round 3, hallazgo B).
 * - pendingMatchesCharge (hallazgo C): with no charge context the money path fails CLOSED (no reuse).
 * - createOrReusePending rollback (hallazgo D): a failed rollback is logged, never swallowed silently.
 */

// The controller destructures atomicRetirePayment at require time, so the seam has to be the module
// itself (a later jest.spyOn would never be seen by the captured reference).
jest.mock('../../../../src/infrastructure/payments/paymentAtomicStore', () => ({
  atomicRetirePayment: jest.fn().mockResolvedValue({ matchedCount: 1, updatedDoc: { _id: 'pay_1' } }),
}));

const Parse = require('parse/node');
const StripeCheckoutController = require('../../../../src/application/controllers/api/StripeCheckoutController');
const logger = require('../../../../src/infrastructure/logger');
const { atomicRetirePayment } = require('../../../../src/infrastructure/payments/paymentAtomicStore');

// The session-expiry cushion over the pending TTL (kept in sync with the controller constant): 3 min, wide
// enough to survive the SDK's worst-case network budget (3 attempts × 20s) plus the payment.save() round-trip.
const CUSHION_MS = 3 * 60 * 1000;

const duplicateError = () => {
  const err = new Error('E11000 duplicate key');
  err.code = Parse.Error.DUPLICATE_VALUE;
  return err;
};

const makeWinner = (origAmount, origCurrency = 'MXN', id = 'winner1') => ({
  id,
  getOrigAmount: () => origAmount,
  getOrigCurrency: () => origCurrency,
});

const baseCtx = (charge = { origAmount: 9680, currency: 'MXN' }) => ({
  reservation: { id: 'res1' },
  adapter: {},
  req: { userId: 'u1' },
  charge,
});

describe('StripeCheckoutController.resolveWinner (winner re-check, council MEDIUM)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reuses a winner whose FROZEN amount still matches the current charge (no churn)', async () => {
    const winner = makeWinner(9680, 'MXN'); // matches charge 9680 MXN
    jest.spyOn(StripeCheckoutController, 'findPendingOnline').mockResolvedValue(winner);
    const retire = jest.spyOn(StripeCheckoutController, 'retirePending').mockResolvedValue();
    const build = jest.spyOn(StripeCheckoutController, 'buildChargeAndSave')
      .mockResolvedValue({ checkoutUrl: 'https://pay/winner' });

    const out = await StripeCheckoutController.resolveWinner(baseCtx());

    expect(out).toEqual({ checkoutUrl: 'https://pay/winner', paymentId: 'winner1', reused: true });
    expect(retire).not.toHaveBeenCalled();
    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0][0]).toBe(winner); // built against the winner itself
  });

  it('RETIRES a winner whose amount drifted and re-prices a fresh pending (never reuses the stale amount)', async () => {
    const staleWinner = makeWinner(12100, 'MXN'); // charge is now 9680 -> stale, over-priced
    const fresh = { id: 'fresh1', save: jest.fn().mockResolvedValue({}) };
    jest.spyOn(StripeCheckoutController, 'findPendingOnline').mockResolvedValue(staleWinner);
    const retire = jest.spyOn(StripeCheckoutController, 'retirePending').mockResolvedValue();
    jest.spyOn(StripeCheckoutController, 'buildPendingPayment').mockReturnValue(fresh);
    const build = jest.spyOn(StripeCheckoutController, 'buildChargeAndSave')
      .mockResolvedValue({ checkoutUrl: 'https://pay/fresh' });

    const out = await StripeCheckoutController.resolveWinner(baseCtx({ origAmount: 9680, currency: 'MXN' }));

    expect(out).toEqual({ checkoutUrl: 'https://pay/fresh', paymentId: 'fresh1', reused: false });
    expect(retire).toHaveBeenCalledTimes(1);
    expect(retire.mock.calls[0][0]).toBe(staleWinner); // the stale winner was retired
    expect(fresh.save).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0][0]).toBe(fresh); // charged against the fresh, correctly-priced pending
  });

  it('RETIRES a stale winner whose currency drifted (exact currency match), re-prices', async () => {
    const staleWinner = makeWinner(9680, 'USD'); // same number, different currency -> stale
    const fresh = { id: 'fresh2', save: jest.fn().mockResolvedValue({}) };
    jest.spyOn(StripeCheckoutController, 'findPendingOnline').mockResolvedValue(staleWinner);
    const retire = jest.spyOn(StripeCheckoutController, 'retirePending').mockResolvedValue();
    jest.spyOn(StripeCheckoutController, 'buildPendingPayment').mockReturnValue(fresh);
    jest.spyOn(StripeCheckoutController, 'buildChargeAndSave').mockResolvedValue({ checkoutUrl: 'https://pay/fresh2' });

    const out = await StripeCheckoutController.resolveWinner(baseCtx({ origAmount: 9680, currency: 'MXN' }));

    expect(out.reused).toBe(false);
    expect(retire).toHaveBeenCalledTimes(1);
  });

  it('bounded: a SECOND collision after retiring reuses a matching contender (single retry, no loop)', async () => {
    const staleWinner = makeWinner(12100, 'MXN', 'winnerStale');
    const contender = makeWinner(9680, 'MXN', 'contender1'); // correctly priced -> reused
    const fresh = { id: 'fresh3', save: jest.fn().mockRejectedValue(duplicateError()) };
    const find = jest.spyOn(StripeCheckoutController, 'findPendingOnline')
      .mockResolvedValueOnce(staleWinner) // first: the winner
      .mockResolvedValueOnce(contender); // second: the contender after our retire lost the re-race
    jest.spyOn(StripeCheckoutController, 'retirePending').mockResolvedValue();
    jest.spyOn(StripeCheckoutController, 'buildPendingPayment').mockReturnValue(fresh);
    const build = jest.spyOn(StripeCheckoutController, 'buildChargeAndSave')
      .mockResolvedValue({ checkoutUrl: 'https://pay/contender' });

    const out = await StripeCheckoutController.resolveWinner(baseCtx({ origAmount: 9680, currency: 'MXN' }));

    expect(out).toEqual({ checkoutUrl: 'https://pay/contender', paymentId: 'contender1', reused: true });
    expect(find).toHaveBeenCalledTimes(2); // exactly one re-fetch, not a loop
    expect(fresh.save).toHaveBeenCalledTimes(1); // exactly one re-create attempt
    expect(build.mock.calls[0][0]).toBe(contender);
  });

  it('bounded: a SECOND collision with a STALE contender surfaces a retryable 409 conflict (no loop)', async () => {
    const staleWinner = makeWinner(12100, 'MXN', 'winnerStale');
    const staleContender = makeWinner(15000, 'MXN', 'contenderStale'); // still not the current charge
    const fresh = { id: 'fresh4', save: jest.fn().mockRejectedValue(duplicateError()) };
    jest.spyOn(StripeCheckoutController, 'findPendingOnline')
      .mockResolvedValueOnce(staleWinner)
      .mockResolvedValueOnce(staleContender);
    jest.spyOn(StripeCheckoutController, 'retirePending').mockResolvedValue();
    jest.spyOn(StripeCheckoutController, 'buildPendingPayment').mockReturnValue(fresh);
    const build = jest.spyOn(StripeCheckoutController, 'buildChargeAndSave').mockResolvedValue({ checkoutUrl: 'x' });

    await expect(StripeCheckoutController.resolveWinner(baseCtx({ origAmount: 9680, currency: 'MXN' })))
      .rejects.toMatchObject({ checkoutConflict: true });
    expect(build).not.toHaveBeenCalled();
  });

  it('a non-DUPLICATE error on the re-create is rethrown as-is (not swallowed as a conflict)', async () => {
    const staleWinner = makeWinner(12100, 'MXN');
    const boom = new Error('mongo down');
    const fresh = { id: 'fresh5', save: jest.fn().mockRejectedValue(boom) };
    jest.spyOn(StripeCheckoutController, 'findPendingOnline').mockResolvedValue(staleWinner);
    jest.spyOn(StripeCheckoutController, 'retirePending').mockResolvedValue();
    jest.spyOn(StripeCheckoutController, 'buildPendingPayment').mockReturnValue(fresh);
    jest.spyOn(StripeCheckoutController, 'buildChargeAndSave').mockResolvedValue({ checkoutUrl: 'x' });

    await expect(StripeCheckoutController.resolveWinner(baseCtx())).rejects.toBe(boom);
  });

  it('winner vanished before we could read it => retryable conflict (not a 500)', async () => {
    jest.spyOn(StripeCheckoutController, 'findPendingOnline').mockResolvedValue(null);
    await expect(StripeCheckoutController.resolveWinner(baseCtx()))
      .rejects.toMatchObject({ checkoutConflict: true });
  });
});

describe('StripeCheckoutController.retirePending (bounded expireCheckout retry + atomic retirement)', () => {
  afterEach(() => jest.restoreAllMocks());

  beforeEach(() => {
    atomicRetirePayment.mockReset();
    atomicRetirePayment.mockResolvedValue({ matchedCount: 1, updatedDoc: { _id: 'pay_1' } });
  });

  const makePending = () => ({ id: 'pay_1', getGatewaySessionId: () => 'cs_old' });

  it('expires the old session once on success, then retires the row with ONE conditional write', async () => {
    const payment = makePending();
    const adapter = { expireCheckout: jest.fn().mockResolvedValue({ status: 'expired' }) };
    await expect(StripeCheckoutController.retirePending(payment, adapter)).resolves.toBe(true);
    expect(adapter.expireCheckout).toHaveBeenCalledTimes(1);
    expect(adapter.expireCheckout).toHaveBeenCalledWith('cs_old');
    // The status + soft-delete + system marker all travel inside atomicRetirePayment now: no
    // setGatewayStatus/save pair can race a confirmation that landed during expireCheckout.
    expect(atomicRetirePayment).toHaveBeenCalledTimes(1);
    expect(atomicRetirePayment).toHaveBeenCalledWith('pay_1');
  });

  it('retries expireCheckout exactly once on a transient failure, then completes', async () => {
    const payment = makePending();
    const adapter = {
      expireCheckout: jest.fn()
        .mockRejectedValueOnce(new Error('transient 500'))
        .mockResolvedValueOnce({ status: 'expired' }),
    };
    await StripeCheckoutController.retirePending(payment, adapter);
    expect(adapter.expireCheckout).toHaveBeenCalledTimes(2); // one retry
    expect(atomicRetirePayment).toHaveBeenCalledTimes(1);
  });

  it('two failures => still retires locally (non-fatal, no throw, no third attempt)', async () => {
    const payment = makePending();
    const adapter = {
      expireCheckout: jest.fn()
        .mockRejectedValueOnce(new Error('boom1'))
        .mockRejectedValueOnce(new Error('boom2')),
    };
    await expect(StripeCheckoutController.retirePending(payment, adapter)).resolves.toBe(true);
    expect(adapter.expireCheckout).toHaveBeenCalledTimes(2); // bounded: never a third attempt
    expect(atomicRetirePayment).toHaveBeenCalledTimes(1);
  });

  it('no session id => never calls the provider, still retires locally', async () => {
    const payment = { id: 'pay_1', getGatewaySessionId: () => null };
    const adapter = { expireCheckout: jest.fn() };
    await StripeCheckoutController.retirePending(payment, adapter);
    expect(adapter.expireCheckout).not.toHaveBeenCalled();
    expect(atomicRetirePayment).toHaveBeenCalledTimes(1);
  });

  it('a row confirmed during the expireCheckout call is a SILENT SUCCESS, never a retry or a throw', async () => {
    // matchedCount 0 = the webhook won while we were talking to Stripe. There is no pending left to
    // retire; insisting would be exactly the backwards walk this hardening exists to prevent.
    atomicRetirePayment.mockResolvedValue({ matchedCount: 0, updatedDoc: null });
    const payment = makePending();
    const adapter = { expireCheckout: jest.fn().mockResolvedValue({}) };
    await expect(StripeCheckoutController.retirePending(payment, adapter)).resolves.toBe(false);
    expect(atomicRetirePayment).toHaveBeenCalledTimes(1); // never a second attempt
  });
});

describe('StripeCheckoutController.frozenSessionExpiresAt (HIGH — stable, never Date.now())', () => {
  it('derives from the pending expiresAt + the cushion (independent of the current clock)', () => {
    const expiresAt = new Date('2030-01-01T00:30:00.000Z');
    const payment = { getExpiresAt: () => expiresAt };
    expect(StripeCheckoutController.frozenSessionExpiresAt(payment))
      .toBe(expiresAt.getTime() + CUSHION_MS);
  });

  it('the cushion has real margin over the SDK network budget (>= 3 min, review round 3 hallazgo B)', () => {
    // Worst case between stamping expiresAt and creating the session: payment.save() + up to 3 SDK attempts
    // × REQUEST_TIMEOUT_MS 20s ≈ 60s. A 60s cushion left zero margin exactly when the retry should help.
    const expiresAt = new Date('2030-01-01T00:30:00.000Z');
    const cushion = StripeCheckoutController.frozenSessionExpiresAt({ getExpiresAt: () => expiresAt })
      - expiresAt.getTime();
    expect(cushion).toBeGreaterThanOrEqual(3 * 60 * 1000);
    // Still far below Stripe's 24h maximum for expires_at (30min pending + cushion must fit the window).
    expect(cushion + 30 * 60 * 1000).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it('is identical no matter what Date.now() reports (idempotency-safe replay)', () => {
    const expiresAt = new Date('2030-06-01T12:00:00.000Z');
    const payment = { getExpiresAt: () => expiresAt };
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    try {
      const a = StripeCheckoutController.frozenSessionExpiresAt(payment);
      nowSpy.mockReturnValue(9_999_999_999);
      const b = StripeCheckoutController.frozenSessionExpiresAt(payment);
      expect(a).toBe(b);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('falls back to createdAt + pending TTL + cushion when expiresAt is missing (legacy pending)', () => {
    const createdAt = new Date('2030-01-01T00:00:00.000Z');
    const payment = { getExpiresAt: () => null, createdAt };
    expect(StripeCheckoutController.frozenSessionExpiresAt(payment))
      .toBe(createdAt.getTime() + 30 * 60 * 1000 + CUSHION_MS);
  });
});

describe('StripeCheckoutController.pendingMatchesCharge (fail-closed default, review round 3 hallazgo C)', () => {
  const pending = () => ({ getOrigAmount: () => 9680, getOrigCurrency: () => 'MXN' });

  it.each([[undefined], [null]])('NO charge context (%p) => does NOT reuse (money path fails closed)', (charge) => {
    // Both callers always pass a charge today; if a future caller does not, the safe answer is "create a
    // fresh, correctly-priced pending", never "reuse whatever pending exists".
    expect(StripeCheckoutController.pendingMatchesCharge(pending(), charge)).toBe(false);
  });

  it('an exact amount+currency match still reuses (no needless churn)', () => {
    expect(StripeCheckoutController.pendingMatchesCharge(pending(), { origAmount: 9680, currency: 'mxn' }))
      .toBe(true);
  });

  it('a sub-cent drift reuses; a real cent-level drift does not', () => {
    // Tolerancia <= 0.01 (el == exacto en float sería frágil: 9680.01 - 9680 ya da 0.0100000000002).
    expect(StripeCheckoutController.pendingMatchesCharge(pending(), { origAmount: 9680.005, currency: 'MXN' }))
      .toBe(true);
    expect(StripeCheckoutController.pendingMatchesCharge(pending(), { origAmount: 9680.5, currency: 'MXN' }))
      .toBe(false);
  });
});

describe('StripeCheckoutController.createOrReusePending rollback (review round 3 hallazgo D)', () => {
  afterEach(() => jest.restoreAllMocks());

  const ctx = () => ({
    reservation: { id: 'res1' },
    adapter: {},
    req: { userId: 'u1' },
    charge: { origAmount: 9680, currency: 'MXN' },
  });

  it('a FAILED rollback (softDelete throws) is LOGGED, and the original provider error still propagates', async () => {
    const providerErr = new Error('stripe down');
    const softDeleteErr = new Error('mongo write failed');
    const fresh = { id: 'p1', save: jest.fn().mockResolvedValue({}) };
    jest.spyOn(StripeCheckoutController, 'findPendingOnline').mockResolvedValue(null);
    jest.spyOn(StripeCheckoutController, 'buildPendingPayment').mockReturnValue(fresh);
    jest.spyOn(StripeCheckoutController, 'buildChargeAndSave').mockRejectedValue(providerErr);
    jest.spyOn(StripeCheckoutController, 'retirePending').mockRejectedValue(softDeleteErr);
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    await expect(StripeCheckoutController.createOrReusePending(ctx())).rejects.toBe(providerErr);
    // Before the fix this was .catch(() => {}): a pending left alive (requires_payment + exists:true) blocks
    // the partial unique index for that reservation until the PR6 sweep, with zero trace in the logs.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toMatchObject({
      reservationId: 'res1', paymentId: 'p1', error: 'mongo write failed',
    });
  });

  it('a successful rollback logs nothing and still propagates the provider error', async () => {
    const providerErr = new Error('stripe down');
    const fresh = { id: 'p2', save: jest.fn().mockResolvedValue({}) };
    jest.spyOn(StripeCheckoutController, 'findPendingOnline').mockResolvedValue(null);
    jest.spyOn(StripeCheckoutController, 'buildPendingPayment').mockReturnValue(fresh);
    jest.spyOn(StripeCheckoutController, 'buildChargeAndSave').mockRejectedValue(providerErr);
    const retire = jest.spyOn(StripeCheckoutController, 'retirePending').mockResolvedValue();
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    await expect(StripeCheckoutController.createOrReusePending(ctx())).rejects.toBe(providerErr);
    expect(retire).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
