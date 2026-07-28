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
 *   never Date.now(), so an idempotent replay sends identical params.
 */

const Parse = require('parse/node');
const StripeCheckoutController = require('../../../../src/application/controllers/api/StripeCheckoutController');

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

describe('StripeCheckoutController.retirePending (bounded expireCheckout retry, council MEDIUM)', () => {
  afterEach(() => jest.restoreAllMocks());

  const makePending = () => ({
    getGatewaySessionId: () => 'cs_old',
    setGatewayStatus: jest.fn(),
    softDelete: jest.fn().mockResolvedValue({}),
  });

  it('expires the old session once on success, then soft-deletes as terminal expired', async () => {
    const payment = makePending();
    const adapter = { expireCheckout: jest.fn().mockResolvedValue({ status: 'expired' }) };
    await StripeCheckoutController.retirePending(payment, adapter, { userId: 'u1' });
    expect(adapter.expireCheckout).toHaveBeenCalledTimes(1);
    expect(adapter.expireCheckout).toHaveBeenCalledWith('cs_old');
    expect(payment.setGatewayStatus).toHaveBeenCalledWith('expired');
    expect(payment.softDelete).toHaveBeenCalledWith('u1');
  });

  it('retries expireCheckout exactly once on a transient failure, then completes', async () => {
    const payment = makePending();
    const adapter = {
      expireCheckout: jest.fn()
        .mockRejectedValueOnce(new Error('transient 500'))
        .mockResolvedValueOnce({ status: 'expired' }),
    };
    await StripeCheckoutController.retirePending(payment, adapter, { userId: 'u1' });
    expect(adapter.expireCheckout).toHaveBeenCalledTimes(2); // one retry
    expect(payment.softDelete).toHaveBeenCalledTimes(1);
  });

  it('two failures => still soft-deletes (non-fatal, no throw, no third attempt)', async () => {
    const payment = makePending();
    const adapter = {
      expireCheckout: jest.fn()
        .mockRejectedValueOnce(new Error('boom1'))
        .mockRejectedValueOnce(new Error('boom2')),
    };
    await expect(StripeCheckoutController.retirePending(payment, adapter, { userId: 'u1' })).resolves.toBeUndefined();
    expect(adapter.expireCheckout).toHaveBeenCalledTimes(2); // bounded: never a third attempt
    expect(payment.setGatewayStatus).toHaveBeenCalledWith('expired');
    expect(payment.softDelete).toHaveBeenCalledWith('u1');
  });

  it('no session id => never calls the provider, still retires locally', async () => {
    const payment = { getGatewaySessionId: () => null, setGatewayStatus: jest.fn(), softDelete: jest.fn().mockResolvedValue({}) };
    const adapter = { expireCheckout: jest.fn() };
    await StripeCheckoutController.retirePending(payment, adapter, { userId: 'u1' });
    expect(adapter.expireCheckout).not.toHaveBeenCalled();
    expect(payment.softDelete).toHaveBeenCalledWith('u1');
  });
});

describe('StripeCheckoutController.frozenSessionExpiresAt (HIGH — stable, never Date.now())', () => {
  it('derives from the pending expiresAt + a 1-min cushion (independent of the current clock)', () => {
    const expiresAt = new Date('2030-01-01T00:30:00.000Z');
    const payment = { getExpiresAt: () => expiresAt };
    expect(StripeCheckoutController.frozenSessionExpiresAt(payment))
      .toBe(expiresAt.getTime() + 60 * 1000);
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
      .toBe(createdAt.getTime() + 30 * 60 * 1000 + 60 * 1000);
  });
});
