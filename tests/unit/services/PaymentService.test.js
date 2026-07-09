/**
 * PaymentService Unit Tests
 * Covers the pure pricing/status helpers (no Parse): serviceBase, methodFactor,
 * computeTotals, deriveStatus. Modelo por método: base (efectivo) × factor —
 * efectivo = base (múltiplo de 5 en MXN), transferencia = base × 1.16, tarjeta = base × 1.21.
 */

const PaymentService = require('../../../src/application/services/PaymentService');

describe('PaymentService pure helpers', () => {
  describe('serviceBase', () => {
    it('reads the efectivo base regardless of tier', () => {
      const item = { pricesByType: { efectivo: 100, transferencia: 110, tarjeta: 120 } };
      expect(PaymentService.serviceBase(item)).toBe(100);
    });

    it('falls back to total when pricesByType has no efectivo', () => {
      expect(PaymentService.serviceBase({ total: 50 })).toBe(50);
      expect(PaymentService.serviceBase({ pricesByType: {}, total: 75 })).toBe(75);
    });

    it('returns 0 when excluded from total or empty', () => {
      expect(PaymentService.serviceBase({ includeInTotal: false, total: 999 })).toBe(0);
      expect(PaymentService.serviceBase({})).toBe(0);
      expect(PaymentService.serviceBase(null)).toBe(0);
    });
  });

  describe('methodFactor', () => {
    it('is 1 for efectivo, 1.16 for transferencia, 1.21 for tarjeta', () => {
      expect(PaymentService.methodFactor('efectivo')).toBe(1);
      expect(PaymentService.methodFactor('transferencia')).toBe(1.16);
      expect(PaymentService.methodFactor('tarjeta')).toBe(1.21);
    });

    it('defaults to 1 for unknown methods', () => {
      expect(PaymentService.methodFactor('otro')).toBe(1);
      expect(PaymentService.methodFactor(undefined)).toBe(1);
    });
  });

  describe('computeTotals', () => {
    const items = [
      { id: 'a', pricesByType: { efectivo: 100, tarjeta: 120 } },
      { id: 'b', total: 50 },
    ]; // base = 150

    it('efectivo = base (sin IVA), múltiplo de 5 en MXN', () => {
      const t = PaymentService.computeTotals(items, 'efectivo');
      expect(t.subtotal).toBe(150); // base
      expect(t.iva).toBe(0); // sin recargo
      expect(t.servicesTotal).toBe(150);
      expect(t.total).toBe(150);
    });

    it('transferencia = base × 1.16 (solo IVA)', () => {
      const t = PaymentService.computeTotals(items, 'transferencia');
      expect(t.subtotal).toBe(150);
      expect(t.iva).toBe(24); // 150 × 0.16
      expect(t.servicesTotal).toBe(174);
      expect(t.total).toBe(174);
    });

    it('tarjeta = base × 1.21 (IVA + comisión de tarjeta)', () => {
      const t = PaymentService.computeTotals(items, 'tarjeta');
      expect(t.subtotal).toBe(150);
      expect(t.iva).toBe(31.5); // 150 × 0.21
      expect(t.total).toBe(181.5);
    });

    it('redondea el efectivo a múltiplo de 5 (MXN)', () => {
      // 101 → 100 (decimal ≤ 0.50 baja); 103.6 → 105 (> 0.50 sube)
      expect(PaymentService.computeTotals([{ total: 101 }], 'efectivo', 0, 0, 'MXN').total).toBe(100);
      expect(PaymentService.computeTotals([{ total: 103.6 }], 'efectivo', 0, 0, 'MXN').total).toBe(105);
    });

    it('no redondea a múltiplo de 5 cuando la moneda es USD', () => {
      expect(PaymentService.computeTotals([{ total: 101 }], 'efectivo', 0, 0, 'USD').total).toBe(101);
    });

    it('adds the reservation-level tip on top (sin factor)', () => {
      const t = PaymentService.computeTotals(items, 'transferencia', 30);
      expect(t.tip).toBe(30);
      expect(t.servicesTotal).toBe(174);
      expect(t.total).toBe(204);
    });

    it('adds net adjustments as final pesos (sin factor)', () => {
      const t = PaymentService.computeTotals(items, 'transferencia', 0, 20);
      expect(t.adjustments).toBe(20);
      expect(t.total).toBe(194); // 174 + 20
    });

    it('skips services excluded from the total', () => {
      const withExcluded = [...items, { id: 'c', includeInTotal: false, total: 999 }];
      const t = PaymentService.computeTotals(withExcluded, 'transferencia');
      expect(t.subtotal).toBe(150);
      expect(t.total).toBe(174);
    });

    it('returns zeros for no items', () => {
      const t = PaymentService.computeTotals([], 'tarjeta');
      expect(t.subtotal).toBe(0);
      expect(t.iva).toBe(0);
      expect(t.total).toBe(0);
    });

    // --- Edge cases (QA) ---

    it('fallback: usa item.total como base cuando el servicio no trae pricesByType.efectivo', () => {
      // Reservaciones viejas sin pricesByType caen al fallback (item.total como base).
      expect(PaymentService.computeTotals([{ total: 200 }], 'tarjeta').total).toBe(242); // 200 × 1.21
      expect(PaymentService.computeTotals([{ total: 200 }], 'transferencia').total).toBe(232); // 200 × 1.16
      expect(PaymentService.computeTotals([{ total: 200 }], 'efectivo').total).toBe(200); // = base
      // pricesByType presente pero sin 'efectivo' -> también cae al fallback.
      expect(PaymentService.computeTotals([{ pricesByType: { tarjeta: 999 }, total: 200 }], 'tarjeta').total).toBe(242);
    });

    it('mezcla servicios con y sin pricesByType (fallback por servicio)', () => {
      const mixed = [
        { pricesByType: { efectivo: 100 } }, // base 100
        { total: 50 }, // fallback -> base 50
      ];
      expect(PaymentService.computeTotals(mixed, 'tarjeta').total).toBe(181.5); // 150 × 1.21
    });

    it('el ajuste NO se multiplica por el factor (se suma como pesos finales)', () => {
      // 1000 × 1.21 = 1210, + 100 de cargo = 1310 (NO (1000+100) × 1.21 = 1331).
      const t = PaymentService.computeTotals([{ pricesByType: { efectivo: 1000 } }], 'tarjeta', 0, 100);
      expect(t.total).toBe(1310);
    });

    it('un ajuste de descuento (neto negativo) baja el total', () => {
      // 1000 × 1.21 = 1210, − 200 de descuento = 1010.
      const t = PaymentService.computeTotals([{ pricesByType: { efectivo: 1000 } }], 'tarjeta', 0, -200);
      expect(t.adjustments).toBe(-200);
      expect(t.total).toBe(1010);
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
