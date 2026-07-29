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

  describe('hallazgo E — la guarda 5.2bis exige un pago previo con IMPORTE real, no una fila vacía', () => {
    it('efectivo + una fila de 0 (sin dinero movido) => sigue rechazado 422', () => {
      // Antes bastaba con que existiera la FILA: un pago de 0 desbloqueaba liquidar el total con tarjeta
      // en una reservación de efectivo/transferencia sin ningún pago real previo.
      const r = resolveCheckoutCharge({
        paymentType: 'efectivo',
        serviceItems: CLEAN,
        paymentRows: [{ amount: 0, method: 'transferencia' }],
      });
      expect(r.ok).toBe(false);
      expect(r.httpStatus).toBe(422);
      expect(r.error).toMatch(/efectivo\/transferencia/);
    });

    it.each([[null], [undefined], ['']])('efectivo + fila con amount %p (no numérico) => rechazado 422', (amount) => {
      const r = resolveCheckoutCharge({
        paymentType: 'efectivo',
        serviceItems: CLEAN,
        paymentRows: [{ amount, method: 'transferencia' }],
      });
      expect(r.ok).toBe(false);
      expect(r.httpStatus).toBe(422);
    });

    it('efectivo + fila de 0 MÁS una fila con importe real => permitido (la real sí cuenta)', () => {
      const r = resolveCheckoutCharge({
        paymentType: 'efectivo',
        serviceItems: CLEAN,
        paymentRows: [
          { amount: 0, method: 'transferencia' },
          { amount: 2320, method: 'transferencia' },
        ],
      });
      expect(r.ok).toBe(true);
      expect(r.origAmount).toBe(9680);
    });

    it('tarjeta con una fila de 0 => sigue permitido (la guarda solo aplica a efectivo/transferencia)', () => {
      const r = resolveCheckoutCharge({
        paymentType: 'tarjeta',
        serviceItems: CLEAN,
        paymentRows: [{ amount: 0, method: 'tarjeta' }],
      });
      expect(r.ok).toBe(true);
      expect(r.origAmount).toBe(12100);
    });
  });

  describe('BUG A — a net-negative flat part (discount > tip) is NOT over-charged by card', () => {
    // The money path that Stripe actually collects is montoParaSaldar.tarjeta. A manual discount of 100
    // (larger than the 0 tip) must REDUCE the card charge, not be dropped. Before the fix this returned
    // 1210 (the service tier with the discount silently ignored), over-charging the client by 100.
    const DISCOUNT_SVC = [{ pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 } }];

    it('tarjeta anchor, adjustmentsNet -100, no prior payments => card charge 1110 (not 1210)', () => {
      const r = resolveCheckoutCharge({
        paymentType: 'tarjeta',
        serviceItems: DISCOUNT_SVC,
        paymentRows: [],
        adjustmentsNet: -100,
      });
      expect(r.ok).toBe(true);
      expect(r.origAmount).toBe(1110); // remainingBase 1110, no longer the over-charged 1210
      expect(r.remainingBase).toBe(1110);
    });
  });
});
