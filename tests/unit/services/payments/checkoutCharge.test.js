/**
 * checkoutCharge.resolveCheckoutCharge — pure money + tier-rejection logic (no Parse/DB/SDK).
 *
 * Proves the card checkout amount is exactly remainingBreakdown(...).montoParaSaldar['tarjeta']
 * (reuse, not reimplementation): the plan's mixed-payment example (base 10000, prior transferencia
 * 2320 -> 9680), anchor invariance of that number, multiple prior payments, and the base case. Plus
 * the mandatory rejections (plan seccion 5.2bis): efectivo/transferencia with no prior counting
 * payment, already-settled (remainingBase 0), and a cancelled reservation.
 */

const { resolveCheckoutCharge } = require('../../../../src/application/services/payments/checkoutCharge');

// Clean tier prices base × 1.16 / × 1.21: efectivo=10000, transferencia=11600, tarjeta=12100.
const CLEAN = [{ pricesByType: { efectivo: 10000, transferencia: 11600, tarjeta: 12100 } }];

describe('resolveCheckoutCharge (pure money + rejection)', () => {
  describe('U1-U7 — amount reuses remainingBreakdown.montoParaSaldar.tarjeta', () => {
    it('U1 base case: tarjeta anchor, no prior payments => full card total 12100', () => {
      const r = resolveCheckoutCharge({ paymentType: 'tarjeta', serviceItems: CLEAN, paymentRows: [] });
      expect(r.ok).toBe(true);
      expect(r.origAmount).toBe(12100);
    });

    it('U2 plan example: base 10000, prior 2320 transferencia => card remainder 9680', () => {
      const r = resolveCheckoutCharge({
        paymentType: 'transferencia',
        serviceItems: CLEAN,
        paymentRows: [{ amount: 2320, method: 'transferencia' }],
      });
      expect(r.ok).toBe(true);
      expect(r.origAmount).toBe(9680);
    });

    it.each(['efectivo', 'transferencia', 'tarjeta'])(
      'U3 anchor invariance: prior 2320 transferencia => 9680 regardless of anchor "%s"',
      (anchor) => {
        const r = resolveCheckoutCharge({
          paymentType: anchor,
          serviceItems: CLEAN,
          paymentRows: [{ amount: 2320, method: 'transferencia' }],
        });
        expect(r.ok).toBe(true);
        expect(r.origAmount).toBe(9680);
      }
    );

    it('U4 multiple prior payments in distinct tiers => card remainder 7260', () => {
      // 2320 transferencia -> 2000 base ; 2420 tarjeta -> 2000 base ; remaining base 6000 -> 6000×1.21.
      const r = resolveCheckoutCharge({
        paymentType: 'efectivo',
        serviceItems: CLEAN,
        paymentRows: [
          { amount: 2320, method: 'transferencia' },
          { amount: 2420, method: 'tarjeta' },
        ],
      });
      expect(r.ok).toBe(true);
      expect(r.origAmount).toBe(7260);
    });

    it('U5 mixed allowed on an efectivo reservation WITH a prior counting payment => 9680', () => {
      const r = resolveCheckoutCharge({
        paymentType: 'efectivo',
        serviceItems: CLEAN,
        paymentRows: [{ amount: 2320, method: 'transferencia' }],
      });
      expect(r.ok).toBe(true);
      expect(r.origAmount).toBe(9680);
    });

    it('U6 returns the reservation currency uppercased', () => {
      const r = resolveCheckoutCharge({ paymentType: 'tarjeta', currency: 'usd', serviceItems: CLEAN, paymentRows: [] });
      expect(r.ok).toBe(true);
      expect(r.currency).toBe('USD');
    });

    it('U7 exposes remainingBase alongside the amount', () => {
      const r = resolveCheckoutCharge({ paymentType: 'tarjeta', serviceItems: CLEAN, paymentRows: [] });
      expect(r.remainingBase).toBe(12100);
    });
  });

  describe('U8-U12 — mandatory rejections (plan seccion 5.2bis)', () => {
    it('U8 efectivo reservation, no prior payments => rejected 422', () => {
      const r = resolveCheckoutCharge({ paymentType: 'efectivo', serviceItems: CLEAN, paymentRows: [] });
      expect(r.ok).toBe(false);
      expect(r.httpStatus).toBe(422);
      expect(r.error).toMatch(/efectivo\/transferencia/);
    });

    it('U9 transferencia reservation, no prior payments => rejected 422', () => {
      const r = resolveCheckoutCharge({ paymentType: 'transferencia', serviceItems: CLEAN, paymentRows: [] });
      expect(r.ok).toBe(false);
      expect(r.httpStatus).toBe(422);
    });

    it('U10 tarjeta reservation, no prior payments => allowed (never rejected)', () => {
      const r = resolveCheckoutCharge({ paymentType: 'tarjeta', serviceItems: CLEAN, paymentRows: [] });
      expect(r.ok).toBe(true);
    });

    it('U11 already settled (remainingBase 0) => rejected 422 (no $0 session)', () => {
      const r = resolveCheckoutCharge({
        paymentType: 'efectivo',
        serviceItems: CLEAN,
        paymentRows: [{ amount: 10000, method: 'efectivo' }],
      });
      expect(r.ok).toBe(false);
      expect(r.httpStatus).toBe(422);
      expect(r.error).toMatch(/saldada/);
    });

    it('U12 cancelled reservation => rejected 422 before any money math', () => {
      const r = resolveCheckoutCharge({
        status: 'cancelled', paymentType: 'tarjeta', serviceItems: CLEAN, paymentRows: [],
      });
      expect(r.ok).toBe(false);
      expect(r.httpStatus).toBe(422);
      expect(r.error).toMatch(/cancelada/);
    });

    it('empty reservation (no services) => rejected 422 (remainingBase 0)', () => {
      const r = resolveCheckoutCharge({ paymentType: 'tarjeta', serviceItems: [], paymentRows: [] });
      expect(r.ok).toBe(false);
      expect(r.httpStatus).toBe(422);
    });
  });
});
