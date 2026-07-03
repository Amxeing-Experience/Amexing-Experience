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
    it('sums every payment amount into a single global total', () => {
      const rows = [
        { amount: 100 },
        { amount: 50 },
        { amount: 200 },
        { amount: 30 },
      ];
      expect(PaymentService.sumPayments(rows)).toBe(380);
    });

    it('ignores any per-service tag — all amounts count toward the grand total', () => {
      const rows = [
        { amount: 100, reservationServiceId: 'a' },
        { amount: 50, reservationServiceId: null },
      ];
      expect(PaymentService.sumPayments(rows)).toBe(150);
    });

    it('rounds the total to cents', () => {
      expect(PaymentService.sumPayments([{ amount: 33.333 }, { amount: 0.007 }])).toBe(33.34);
    });

    it('handles empty/invalid input', () => {
      expect(PaymentService.sumPayments([])).toBe(0);
      expect(PaymentService.sumPayments(null)).toBe(0);
    });
  });

  describe('buildSummary', () => {
    const computed = {
      totals: {
        subtotal: 200, adjustments: 0, iva: 32, tip: 0, total: 232,
      },
      paidGlobal: 100,
    };

    it('reports the grand total, paid amount and remaining balance', () => {
      const summary = PaymentService.buildSummary('r1', computed);
      expect(summary.reservationId).toBe('r1');
      expect(summary.total).toBe(232);
      expect(summary.paidAmount).toBe(100);
      expect(summary.balance).toBe(132); // total − paid
      expect(summary.paymentStatus).toBe('partial');
    });

    it('does not expose a per-service breakdown', () => {
      const summary = PaymentService.buildSummary('r1', computed);
      expect(summary).not.toHaveProperty('services');
    });

    it('is paid when payments cover the total and allows overpay (negative balance)', () => {
      const paid = PaymentService.buildSummary('r1', { totals: { total: 232 }, paidGlobal: 232 });
      expect(paid.paymentStatus).toBe('paid');
      expect(paid.balance).toBe(0);
      const over = PaymentService.buildSummary('r1', { totals: { total: 232 }, paidGlobal: 300 });
      expect(over.paymentStatus).toBe('paid');
      expect(over.balance).toBe(-68);
    });
  });
});
