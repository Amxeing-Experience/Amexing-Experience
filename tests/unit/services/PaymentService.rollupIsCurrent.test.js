/**
 * PaymentService.rollupIsCurrent + recalculateIfStale — the stale-rollup repair (unit, zero DB).
 *
 * The webhook cannot tell a legitimate sibling event ('checkout.session.completed' after
 * 'payment_intent.succeeded' for the same paymentId) apart from the retry of a delivery that died
 * between Capa B and the rollup: both see "matchedCount 0 + the Payment is already at the destination".
 * The unambiguous evidence is the ROLLUP itself — a dead delivery leaves it stale, a sibling event finds
 * it current — which is what these two functions turn into a decision.
 *
 * Everything money-related here lives in the predicate, so it is pinned without a database: the
 * comparison must treat a never-written field as stale (fail-safe) and must not let a float artifact
 * count as a difference, while one centavo DOES count.
 */

const PaymentService = require('../../../src/application/services/PaymentService');
const logger = require('../../../src/infrastructure/logger');

/**
 * A Parse-Reservation-shaped double whose get/set share one store, so a write inside
 * recalculateIfStale is visible to the next read exactly as it would be after a real save.
 * @param {object} [initial] - Initially persisted fields.
 * @returns {object} The double, plus a `save` jest.fn and the raw `store`.
 */
const reservationDouble = (initial = {}) => {
  const store = { ...initial };
  return {
    store,
    get: (field) => store[field],
    set: (field, value) => { store[field] = value; },
    save: jest.fn().mockResolvedValue(undefined),
  };
};

const summaryOf = ({ paidAmount, balance, paymentStatus, total = 1000 }) => ({
  reservationId: 'res_1', paidAmount, balance, paymentStatus, total,
});

describe('PaymentService.rollupIsCurrent', () => {
  const summary = summaryOf({ paidAmount: 1000, balance: 0, paymentStatus: 'paid' });

  it('exact match on the three persisted fields => current', () => {
    const reservation = reservationDouble({ paidAmount: 1000, balance: 0, paymentStatus: 'paid' });
    expect(PaymentService.rollupIsCurrent(reservation, summary)).toBe(true);
  });

  // A rollup that was never written is the fingerprint of the half-finished delivery, so it MUST read
  // as stale. null is the dangerous one: a Number(null) coercion would make it equal to a summary of 0.
  it.each([
    ['paidAmount undefined', { balance: 0, paymentStatus: 'paid' }],
    ['paidAmount null', { paidAmount: null, balance: 0, paymentStatus: 'paid' }],
    ['balance undefined', { paidAmount: 1000, paymentStatus: 'paid' }],
    ['balance null', { paidAmount: 1000, balance: null, paymentStatus: 'paid' }],
    ['paymentStatus undefined', { paidAmount: 1000, balance: 0 }],
    ['paymentStatus empty', { paidAmount: 1000, balance: 0, paymentStatus: '' }],
    ['paymentStatus null', { paidAmount: 1000, balance: 0, paymentStatus: null }],
    ['nothing at all (a brand-new reservation)', {}],
  ])('%s => stale', (_label, stored) => {
    expect(PaymentService.rollupIsCurrent(reservationDouble(stored), summary)).toBe(false);
  });

  it('a zeroed rollup against a zero summary IS current (0 is a legitimate persisted value)', () => {
    const reservation = reservationDouble({ paidAmount: 0, balance: 1000, paymentStatus: 'pending' });
    const zero = summaryOf({ paidAmount: 0, balance: 1000, paymentStatus: 'pending' });
    expect(PaymentService.rollupIsCurrent(reservation, zero)).toBe(true);
  });

  it('a 0.001 difference is float noise from round2, not money => current', () => {
    const reservation = reservationDouble({ paidAmount: 1000.001, balance: -0.001, paymentStatus: 'paid' });
    expect(PaymentService.rollupIsCurrent(reservation, summary)).toBe(true);
  });

  it.each([
    ['one centavo more paid', { paidAmount: 1000.01, balance: 0, paymentStatus: 'paid' }],
    ['one centavo less paid', { paidAmount: 999.99, balance: 0, paymentStatus: 'paid' }],
    ['one centavo of balance', { paidAmount: 1000, balance: 0.01, paymentStatus: 'paid' }],
  ])('%s IS money => stale', (_label, stored) => {
    expect(PaymentService.rollupIsCurrent(reservationDouble(stored), summary)).toBe(false);
  });

  it('the same amounts with a different paymentStatus => stale (the badge is part of the rollup)', () => {
    const reservation = reservationDouble({ paidAmount: 1000, balance: 0, paymentStatus: 'partial' });
    expect(PaymentService.rollupIsCurrent(reservation, summary)).toBe(false);
  });

  it('the same paidAmount with a different balance => stale', () => {
    const reservation = reservationDouble({ paidAmount: 1000, balance: 250, paymentStatus: 'paid' });
    expect(PaymentService.rollupIsCurrent(reservation, summary)).toBe(false);
  });

  it.each([
    ['a numeric string', '1000'],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['an object', {}],
    ['a boolean', true],
  ])('a paidAmount stored as %s => stale (never coerced)', (_label, value) => {
    const reservation = reservationDouble({ paidAmount: value, balance: 0, paymentStatus: 'paid' });
    expect(PaymentService.rollupIsCurrent(reservation, summary)).toBe(false);
  });

  it('a partial rollup that matches its own summary => current (does not depend on balance being 0)', () => {
    const reservation = reservationDouble({ paidAmount: 400, balance: 600, paymentStatus: 'partial' });
    const partial = summaryOf({ paidAmount: 400, balance: 600, paymentStatus: 'partial' });
    expect(PaymentService.rollupIsCurrent(reservation, partial)).toBe(true);
  });
});

describe('PaymentService.recalculateIfStale', () => {
  let loadSpy;
  let buildSpy;
  let recalcSpy;
  let infoSpy;

  const arrange = (stored, summary) => {
    const reservation = reservationDouble(stored);
    loadSpy = jest.spyOn(PaymentService, 'loadAndCompute').mockResolvedValue({ reservation });
    buildSpy = jest.spyOn(PaymentService, 'buildSummary').mockReturnValue(summary);
    return reservation;
  };

  beforeEach(() => {
    // Never called by this path: withReservationLock chains per reservationId and is NOT reentrant, so
    // delegating to recalculate (which takes the same lock) would deadlock silently.
    recalcSpy = jest.spyOn(PaymentService, 'recalculate');
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    if (loadSpy) loadSpy.mockRestore();
    if (buildSpy) buildSpy.mockRestore();
    recalcSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('a CURRENT rollup writes nothing and reports healed:false', async () => {
    const summary = summaryOf({ paidAmount: 1000, balance: 0, paymentStatus: 'paid' });
    const reservation = arrange({ paidAmount: 1000, balance: 0, paymentStatus: 'paid' }, summary);

    const outcome = await PaymentService.recalculateIfStale('res_1');

    expect(outcome).toEqual({ healed: false, summary });
    expect(reservation.save).not.toHaveBeenCalled();
    expect(recalcSpy).not.toHaveBeenCalled();
  });

  it('a STALE rollup persists the three fields and reports healed:true', async () => {
    const summary = summaryOf({ paidAmount: 1000, balance: 0, paymentStatus: 'paid' });
    const reservation = arrange({}, summary); // never written: the stranded state

    const outcome = await PaymentService.recalculateIfStale('res_1');

    expect(outcome).toEqual({ healed: true, summary });
    expect(reservation.save).toHaveBeenCalledTimes(1);
    expect(reservation.store).toMatchObject({ paidAmount: 1000, balance: 0, paymentStatus: 'paid' });
    expect(recalcSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith('Stale reservation payment rollup repaired', expect.objectContaining({
      reservationId: 'res_1', paidAmount: 1000, paymentStatus: 'paid',
    }));
  });

  it('the repair is computed, never incremented: repairing twice leaves the same amount', async () => {
    const summary = summaryOf({ paidAmount: 1000, balance: 0, paymentStatus: 'paid' });
    const reservation = arrange({}, summary);

    const first = await PaymentService.recalculateIfStale('res_1');
    const second = await PaymentService.recalculateIfStale('res_1');

    expect(first.healed).toBe(true);
    expect(second.healed).toBe(false); // the second call finds what the first persisted
    expect(reservation.save).toHaveBeenCalledTimes(1);
    expect(reservation.store.paidAmount).toBe(1000); // never 2000
  });

  it('two CONCURRENT calls for the same reservation produce exactly ONE write', async () => {
    // The lock is the whole mechanism: the second call queues behind the first, re-reads what it
    // persisted, finds the rollup current and writes nothing. Without the lock both would see the
    // stale state and both would write.
    const summary = summaryOf({ paidAmount: 1000, balance: 0, paymentStatus: 'paid' });
    const reservation = arrange({}, summary);

    const outcomes = await Promise.all([
      PaymentService.recalculateIfStale('res_1'),
      PaymentService.recalculateIfStale('res_1'),
    ]);

    expect(outcomes.filter((o) => o.healed)).toHaveLength(1);
    expect(reservation.save).toHaveBeenCalledTimes(1);
  });

  it('a loadAndCompute failure PROPAGATES (so the webhook answers 500 and Stripe retries)', async () => {
    loadSpy = jest.spyOn(PaymentService, 'loadAndCompute').mockRejectedValue(new Error('mongo down'));
    await expect(PaymentService.recalculateIfStale('res_1')).rejects.toThrow('mongo down');
    expect(recalcSpy).not.toHaveBeenCalled();
  });

  it('a save failure PROPAGATES too (never a silent partial repair)', async () => {
    const summary = summaryOf({ paidAmount: 1000, balance: 0, paymentStatus: 'paid' });
    const reservation = arrange({}, summary);
    reservation.save.mockRejectedValueOnce(new Error('save rejected'));
    await expect(PaymentService.recalculateIfStale('res_1')).rejects.toThrow('save rejected');
  });

  it('a failure does not stall the per-reservation queue for the next caller', async () => {
    const summary = summaryOf({ paidAmount: 400, balance: 600, paymentStatus: 'partial' });
    const reservation = reservationDouble({});
    let calls = 0;
    loadSpy = jest.spyOn(PaymentService, 'loadAndCompute').mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient');
      return { reservation };
    });
    buildSpy = jest.spyOn(PaymentService, 'buildSummary').mockReturnValue(summary);

    await expect(PaymentService.recalculateIfStale('res_1')).rejects.toThrow('transient');
    await expect(PaymentService.recalculateIfStale('res_1')).resolves.toEqual({ healed: true, summary });
  });

  it('buildSummary is called with the reservationId and the computed data (no recomputing by hand)', async () => {
    const summary = summaryOf({ paidAmount: 1000, balance: 0, paymentStatus: 'paid' });
    arrange({ paidAmount: 1000, balance: 0, paymentStatus: 'paid' }, summary);
    await PaymentService.recalculateIfStale('res_1');
    expect(loadSpy).toHaveBeenCalledWith('res_1');
    expect(buildSpy).toHaveBeenCalledWith('res_1', expect.objectContaining({ reservation: expect.any(Object) }));
  });
});
