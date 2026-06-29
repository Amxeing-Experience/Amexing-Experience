/**
 * PaymentService Unit Tests
 * Covers the pure pricing/status helpers (no Parse): servicePrice, computeTotals, deriveStatus.
 */

const PaymentService = require('../../../src/application/services/PaymentService');

describe('PaymentService pure helpers', () => {
  describe('servicePrice', () => {
    it('uses pricesByType for the given payment tier', () => {
      const item = { pricesByType: { efectivo: 100, transferencia: 110, tarjeta: 120 } };
      expect(PaymentService.servicePrice(item, 'efectivo')).toBe(100);
      expect(PaymentService.servicePrice(item, 'tarjeta')).toBe(120);
    });

    it('falls back to total when pricesByType is missing the tier', () => {
      expect(PaymentService.servicePrice({ total: 50 }, 'efectivo')).toBe(50);
      expect(PaymentService.servicePrice({ pricesByType: {}, total: 75 }, 'efectivo')).toBe(75);
    });

    it('returns 0 when excluded from total or empty', () => {
      expect(PaymentService.servicePrice({ includeInTotal: false, total: 999 }, 'efectivo')).toBe(0);
      expect(PaymentService.servicePrice({}, 'efectivo')).toBe(0);
      expect(PaymentService.servicePrice(null, 'efectivo')).toBe(0);
    });
  });

  describe('computeTotals', () => {
    const items = [
      { id: 'a', pricesByType: { efectivo: 100, tarjeta: 120 } },
      { id: 'b', total: 50 },
    ];

    it('computes subtotal, 16% IVA and total mirroring the public reservation logic', () => {
      const t = PaymentService.computeTotals(items, 'efectivo');
      expect(t.subtotal).toBe(150);
      expect(t.iva).toBe(24);
      expect(t.servicesTotal).toBe(174);
      expect(t.total).toBe(174);
    });

    it('exposes per-service totals con IVA', () => {
      const t = PaymentService.computeTotals(items, 'efectivo');
      expect(t.perService.a).toBe(116);
      expect(t.perService.b).toBe(58);
    });

    it('honors the payment tier for the subtotal', () => {
      const t = PaymentService.computeTotals(items, 'tarjeta');
      expect(t.subtotal).toBe(170);
      expect(t.iva).toBe(27.2);
      expect(t.total).toBe(197.2);
    });

    it('adds the reservation-level tip on top (no IVA on tip)', () => {
      const t = PaymentService.computeTotals(items, 'efectivo', 30);
      expect(t.tip).toBe(30);
      expect(t.total).toBe(204);
      expect(t.servicesTotal).toBe(174);
    });

    it('skips services excluded from the total', () => {
      const withExcluded = [...items, { id: 'c', includeInTotal: false, total: 999 }];
      const t = PaymentService.computeTotals(withExcluded, 'efectivo');
      expect(t.subtotal).toBe(150);
      expect(t.perService.c).toBe(0);
    });

    it('rounds to cents', () => {
      const t = PaymentService.computeTotals([{ id: 'x', total: 33.333 }], 'efectivo');
      expect(t.subtotal).toBe(33.33);
      expect(t.iva).toBe(5.33);
      expect(t.total).toBe(38.66);
    });

    it('returns zeros for no items', () => {
      const t = PaymentService.computeTotals([], 'efectivo');
      expect(t.subtotal).toBe(0);
      expect(t.iva).toBe(0);
      expect(t.total).toBe(0);
      expect(t.perService).toEqual({});
    });
  });

  describe('deriveStatus', () => {
    it('is pending when nothing is paid', () => {
      expect(PaymentService.deriveStatus(174, 0)).toBe('pending');
    });

    it('is partial when paid is below the total', () => {
      expect(PaymentService.deriveStatus(174, 100)).toBe('partial');
    });

    it('is paid when paid covers the total exactly', () => {
      expect(PaymentService.deriveStatus(174, 174)).toBe('paid');
    });

    it('is paid when overpaid (balance negative)', () => {
      expect(PaymentService.deriveStatus(174, 200)).toBe('paid');
    });
  });

  describe('sumPayments', () => {
    it('sums into a global total and a per-service breakdown', () => {
      const rows = [
        { amount: 100, reservationServiceId: 'a' },
        { amount: 50, reservationServiceId: 'a' },
        { amount: 200, reservationServiceId: 'b' },
        { amount: 30, reservationServiceId: null },
      ];
      const { paidGlobal, paidByService } = PaymentService.sumPayments(rows);
      expect(paidGlobal).toBe(380);
      expect(paidByService.a).toBe(150);
      expect(paidByService.b).toBe(200);
      expect(paidByService).not.toHaveProperty('null');
    });

    it('handles empty/invalid input', () => {
      expect(PaymentService.sumPayments([])).toEqual({ paidGlobal: 0, paidByService: {} });
      expect(PaymentService.sumPayments(null)).toEqual({ paidGlobal: 0, paidByService: {} });
    });
  });
});
