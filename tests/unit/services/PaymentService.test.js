/**
 * PaymentService Unit Tests
 * Covers the pure pricing/status helpers (no Parse): chargeAmount, serviceBase,
 * computeTotals, deriveStatus. Modelo por método: se COBRA pricesByType[paymentType],
 * el valor ya calculado y aprobado por la cotización -- NO se recalcula con ninguna
 * tasa ni factor. Efectivo en MXN se redondea a múltiplo de 5 (regla física del
 * efectivo); tarjeta/transferencia NUNCA se redondean, se cobran exactas.
 */

const PaymentService = require('../../../src/application/services/PaymentService');

describe('PaymentService pure helpers', () => {
  describe('chargeAmount', () => {
    it('lee el precio ya calculado para el método pedido, no el de otro método', () => {
      const item = { pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 } };
      expect(PaymentService.chargeAmount(item, 'efectivo')).toBe(100);
      expect(PaymentService.chargeAmount(item, 'transferencia')).toBe(116);
      expect(PaymentService.chargeAmount(item, 'tarjeta')).toBe(121);
    });

    it('falls back to item.total when pricesByType no trae ese método', () => {
      expect(PaymentService.chargeAmount({ total: 50 }, 'tarjeta')).toBe(50);
      expect(PaymentService.chargeAmount({ pricesByType: {}, total: 75 }, 'transferencia')).toBe(75);
      expect(PaymentService.chargeAmount({ pricesByType: { efectivo: 100 }, total: 130 }, 'tarjeta')).toBe(130);
    });

    it('returns 0 when excluded from total or empty', () => {
      expect(PaymentService.chargeAmount({ includeInTotal: false, total: 999 }, 'tarjeta')).toBe(0);
      expect(PaymentService.chargeAmount({}, 'efectivo')).toBe(0);
      expect(PaymentService.chargeAmount(null, 'tarjeta')).toBe(0);
    });

    it('un valor no numérico en pricesByType cae al fallback de total', () => {
      expect(PaymentService.chargeAmount({ pricesByType: { tarjeta: 'abc' }, total: 300 }, 'tarjeta')).toBe(300);
    });
  });

  describe('serviceBase', () => {
    it('reads the efectivo price regardless of other tiers (es chargeAmount(item, "efectivo"))', () => {
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

  describe('computeTotals', () => {
    const items = [
      { id: 'a', pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 120 } },
      { id: 'b', total: 50 }, // sin pricesByType -> fallback a total en cualquier método
    ]; // base (efectivo) = 150

    it('efectivo = Σ pricesByType.efectivo, múltiplo de 5 en MXN', () => {
      const t = PaymentService.computeTotals(items, 'efectivo');
      expect(t.subtotal).toBe(150); // base
      expect(t.iva).toBe(0); // sin recargo (efectivo == base por construcción)
      expect(t.servicesTotal).toBe(150);
      expect(t.total).toBe(150);
    });

    it('transferencia = Σ pricesByType.transferencia (valor YA aprobado, no recalculado)', () => {
      const t = PaymentService.computeTotals(items, 'transferencia');
      expect(t.subtotal).toBe(150); // base efectivo (referencia)
      expect(t.servicesTotal).toBe(166); // 116 + 50 (fallback del item 'b')
      expect(t.iva).toBe(16); // 166 - 150 (recargo mostrado, no usado para cobrar)
      expect(t.total).toBe(166);
    });

    it('tarjeta = Σ pricesByType.tarjeta (valor YA aprobado, no recalculado)', () => {
      const t = PaymentService.computeTotals(items, 'tarjeta');
      expect(t.subtotal).toBe(150);
      expect(t.servicesTotal).toBe(170); // 120 + 50
      expect(t.total).toBe(170);
    });

    it('tarjeta/transferencia NUNCA se redondean a múltiplo de 5 (solo efectivo)', () => {
      const t = PaymentService.computeTotals([{ pricesByType: { efectivo: 1000, tarjeta: 1213.63 } }], 'tarjeta');
      expect(t.total).toBe(1213.63); // exacto, sin redondeo
    });

    it('si el precio guardado difiere de base×porcentaje "limpio" (ej. A-Disposición con descuento), se cobra el guardado tal cual', () => {
      // pricesByType.tarjeta NO es 150*1.21=181.5 -- viene de un cálculo con descuento propio
      // de la cotización (A-Disposición). computeTotals debe respetar ese valor, no recalcularlo.
      const t = PaymentService.computeTotals([{ pricesByType: { efectivo: 150, tarjeta: 175.30 } }], 'tarjeta');
      expect(t.total).toBe(175.30);
    });

    it('redondea el efectivo a múltiplo de 5 (MXN)', () => {
      // 101 → 100 (decimal ≤ 0.50 baja); 103.6 → 105 (> 0.50 sube)
      expect(PaymentService.computeTotals([{ total: 101 }], 'efectivo', 0, 0, 'MXN').total).toBe(100);
      expect(PaymentService.computeTotals([{ total: 103.6 }], 'efectivo', 0, 0, 'MXN').total).toBe(105);
    });

    it('no redondea a múltiplo de 5 cuando la moneda es USD', () => {
      expect(PaymentService.computeTotals([{ total: 101 }], 'efectivo', 0, 0, 'USD').total).toBe(101);
    });

    it('adds the reservation-level tip on top (no cambia por método)', () => {
      const t = PaymentService.computeTotals(items, 'transferencia', 30);
      expect(t.tip).toBe(30);
      expect(t.servicesTotal).toBe(166);
      expect(t.total).toBe(196);
    });

    it('adds net adjustments as final pesos (no cambia por método)', () => {
      const t = PaymentService.computeTotals(items, 'transferencia', 0, 20);
      expect(t.adjustments).toBe(20);
      expect(t.total).toBe(186); // 166 + 20
    });

    it('skips services excluded from the total', () => {
      const withExcluded = [...items, { id: 'c', includeInTotal: false, total: 999 }];
      const t = PaymentService.computeTotals(withExcluded, 'transferencia');
      expect(t.subtotal).toBe(150);
      expect(t.total).toBe(166);
    });

    it('returns zeros for no items', () => {
      const t = PaymentService.computeTotals([], 'tarjeta');
      expect(t.subtotal).toBe(0);
      expect(t.iva).toBe(0);
      expect(t.total).toBe(0);
    });

    // --- Edge cases (QA) ---

    it('fallback: usa item.total cuando el servicio no trae pricesByType en absoluto', () => {
      // Reservaciones viejas sin pricesByType caen al fallback (item.total), sea cual sea el método.
      expect(PaymentService.computeTotals([{ total: 200 }], 'tarjeta').total).toBe(200);
      expect(PaymentService.computeTotals([{ total: 200 }], 'transferencia').total).toBe(200);
      expect(PaymentService.computeTotals([{ total: 200 }], 'efectivo').total).toBe(200);
    });

    it('pricesByType presente pero sin el método pedido -> cae al fallback de item.total', () => {
      expect(PaymentService.computeTotals([{ pricesByType: { efectivo: 100 }, total: 200 }], 'tarjeta').total).toBe(200);
    });

    it('mezcla servicios con y sin pricesByType (fallback por servicio, no por reservación completa)', () => {
      const mixed = [
        { pricesByType: { tarjeta: 121 } }, // tiene tarjeta
        { total: 50 }, // fallback -> 50
      ];
      expect(PaymentService.computeTotals(mixed, 'tarjeta').total).toBe(171); // 121 + 50
    });

    it('el ajuste NO se multiplica ni se ve afectado por el método (se suma como pesos finales)', () => {
      const t = PaymentService.computeTotals([{ pricesByType: { efectivo: 1000, tarjeta: 1210 } }], 'tarjeta', 0, 100);
      expect(t.total).toBe(1310); // 1210 + 100
    });

    it('un ajuste de descuento (neto negativo) baja el total', () => {
      const t = PaymentService.computeTotals([{ pricesByType: { efectivo: 1000, tarjeta: 1210 } }], 'tarjeta', 0, -200);
      expect(t.adjustments).toBe(-200);
      expect(t.total).toBe(1010); // 1210 - 200
    });

    it('efectivo redondea HACIA ARRIBA cuando el decimal supera 0.50', () => {
      // 1002.6 -> múltiplo de 5 hacia arriba = 1005.
      expect(PaymentService.computeTotals([{ pricesByType: { efectivo: 1002.6 } }], 'efectivo').total).toBe(1005);
    });

    it('base 0 da total 0 en cualquier método', () => {
      expect(PaymentService.computeTotals([{ pricesByType: { efectivo: 0, tarjeta: 0 } }], 'tarjeta').total).toBe(0);
      expect(PaymentService.computeTotals([{ pricesByType: { efectivo: 0 } }], 'efectivo').total).toBe(0);
    });

    it('un descuento mayor al total lo clampa a 0 (nunca negativo)', () => {
      // 1000 de servicios − 1500 de descuento -> 0 (no -500).
      const t = PaymentService.computeTotals([{ pricesByType: { efectivo: 1000 } }], 'efectivo', 0, -1500);
      expect(t.total).toBe(0);
    });

    it('el redondeo a múltiplo de 5 no distingue mayúsculas en la moneda (mxn/MXN)', () => {
      expect(PaymentService.computeTotals([{ pricesByType: { efectivo: 101 } }], 'efectivo', 0, 0, 'mxn').total).toBe(100);
    });

    it('método desconocido o vacío cae al fallback de total (sin pricesByType[ese método])', () => {
      expect(PaymentService.computeTotals([{ pricesByType: { efectivo: 500 }, total: 500 }], 'otro').total).toBe(500);
      expect(PaymentService.computeTotals([{ pricesByType: { efectivo: 500 }, total: 500 }], undefined).total).toBe(500);
    });

    it('un valor no numérico en pricesByType[paymentType] cae al fallback de total (no rompe el cálculo)', () => {
      const t = PaymentService.computeTotals([{ pricesByType: { tarjeta: 'abc' }, total: 300 }], 'tarjeta');
      expect(t.total).toBe(300);
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
