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

  // ---------------------------------------------------------------------------
  // Fase 1 — agregación real de propina desde Payment.tip (no Reservation.tip),
  // desglose por servicio y neutralidad de la propina sobre el balance.
  // ---------------------------------------------------------------------------
  describe('sumTips', () => {
    it('sums every payment tip into a single global total', () => {
      expect(PaymentService.sumTips([{ tip: 100 }, { tip: 50 }, { tip: 200 }])).toBe(350);
    });

    it('treats a missing or non-numeric tip as 0 (same defensiveness as sumPayments)', () => {
      expect(PaymentService.sumTips([{ tip: 100 }, {}, { tip: 'abc' }, { tip: null }])).toBe(100);
    });

    it('rounds the total to cents', () => {
      expect(PaymentService.sumTips([{ tip: 33.333 }, { tip: 0.007 }])).toBe(33.34);
    });

    it('handles empty/invalid input', () => {
      expect(PaymentService.sumTips([])).toBe(0);
      expect(PaymentService.sumTips(null)).toBe(0);
    });
  });

  describe('groupTipsByService', () => {
    it('groups tips by service id and keeps the whole-reservation pool in the null bucket', () => {
      const rows = [
        { tip: 200, reservationServiceId: 'svcA' },
        { tip: 300, reservationServiceId: null },
        { tip: 50, reservationServiceId: 'svcA' },
      ];
      expect(PaymentService.groupTipsByService(rows)).toEqual([
        { reservationServiceId: 'svcA', tip: 250 },
        { reservationServiceId: null, tip: 300 },
      ]);
    });

    it("collapses '' / null / undefined service ids into a single null pool bucket", () => {
      const rows = [
        { tip: 10, reservationServiceId: '' },
        { tip: 20, reservationServiceId: undefined },
        { tip: 30, reservationServiceId: null },
      ];
      expect(PaymentService.groupTipsByService(rows)).toEqual([{ reservationServiceId: null, tip: 60 }]);
    });

    it('omits zero-tip buckets to avoid UI noise', () => {
      const rows = [
        { tip: 0, reservationServiceId: 'svcA' },
        { tip: 100, reservationServiceId: 'svcB' },
      ];
      expect(PaymentService.groupTipsByService(rows)).toEqual([{ reservationServiceId: 'svcB', tip: 100 }]);
    });

    it('preserves the structural invariant Σ bucket.tip === sumTips(sameRows)', () => {
      const rows = [
        { tip: 12.5, reservationServiceId: 'svcA' },
        { tip: 7.25, reservationServiceId: 'svcB' },
        { tip: 30.25, reservationServiceId: null },
        { tip: 0, reservationServiceId: 'svcC' },
      ];
      const grouped = PaymentService.groupTipsByService(rows);
      const groupedTotal = grouped.reduce((sum, b) => sum + b.tip, 0);
      expect(Math.round(groupedTotal * 100) / 100).toBe(PaymentService.sumTips(rows));
    });

    it('handles empty/invalid input', () => {
      expect(PaymentService.groupTipsByService([])).toEqual([]);
      expect(PaymentService.groupTipsByService(null)).toEqual([]);
    });
  });

  describe('buildSummary exposes tipByService (and is back-compatible)', () => {
    it('passes through the tipByService breakdown when provided', () => {
      const summary = PaymentService.buildSummary('r1', {
        totals: {
          subtotal: 100, adjustments: 0, iva: 0, tip: 50, total: 150,
        },
        paidGlobal: 150,
        tipByService: [{ reservationServiceId: 'svcA', tip: 50 }],
      });
      expect(summary.tip).toBe(50);
      expect(summary.tipByService).toEqual([{ reservationServiceId: 'svcA', tip: 50 }]);
    });

    it('defaults tipByService to an empty array when the computed input omits it', () => {
      const summary = PaymentService.buildSummary('r1', { totals: { total: 100 }, paidGlobal: 0 });
      expect(summary.tipByService).toEqual([]);
    });
  });

  describe('propina agregada — el arreglo del saldo fantasma (fix crítico)', () => {
    // Reproduce lo que hace loadAndCompute: la propina se toma de sumTips(rows) y paidGlobal
    // DEBE incluirla (sumPayments + sumTips), o quedaría un saldo fantasma igual a la propina.
    const compose = (serviceItems, paymentType, rows, currency = 'MXN') => {
      const tipTotal = PaymentService.sumTips(rows);
      const totals = PaymentService.computeTotals(serviceItems, paymentType, tipTotal, 0, currency);
      const paidGlobal = Math.round((PaymentService.sumPayments(rows) + tipTotal) * 100) / 100;
      return PaymentService.buildSummary('r', {
        totals, paidGlobal, tipByService: PaymentService.groupTipsByService(rows),
      });
    };

    it('pago 100% propina (servicios = $0) queda paid, balance 0 — sin saldo fantasma', () => {
      const summary = compose([], 'efectivo', [{ amount: 0, tip: 100, reservationServiceId: null }]);
      expect(summary.total).toBe(100);
      expect(summary.paidAmount).toBe(100);
      expect(summary.balance).toBe(0);
      expect(summary.paymentStatus).toBe('paid');
      expect(summary.tip).toBe(100);
      expect(summary.tipByService).toEqual([{ reservationServiceId: null, tip: 100 }]);
    });

    it('la propina es neutral al balance de servicios (pago parcial de servicios + propina)', () => {
      // servicesTotal (tarjeta) = 400; pago amount 200 (servicios) + tip 100.
      const summary = compose([{ pricesByType: { efectivo: 331, tarjeta: 400 } }], 'tarjeta', [
        { amount: 200, tip: 100, reservationServiceId: null },
      ]);
      expect(summary.total).toBe(500); // 400 servicios + 100 propina
      expect(summary.paidAmount).toBe(300); // 200 servicios + 100 propina
      expect(summary.balance).toBe(200); // 400 − 200 de servicios; la propina no mueve el balance
      expect(summary.paymentStatus).toBe('partial');
      expect(summary.tip).toBe(100);
    });

    it('pago 0% propina se comporta exactamente igual que sin propina', () => {
      const summary = compose([{ total: 1000 }], 'efectivo', [{ amount: 1000, tip: 0, reservationServiceId: null }]);
      expect(summary.tip).toBe(0);
      expect(summary.balance).toBe(0);
      expect(summary.paymentStatus).toBe('paid');
      expect(summary.tipByService).toEqual([]);
    });
  });

  describe('el redondeo a múltiplo de 5 del efectivo NUNCA toca la porción de propina', () => {
    it('los servicios en efectivo se redondean (102.6 -> 105) pero la propina se suma exacta (2.4)', () => {
      // servicesTotal efectivo 102.6 -> 105 (múltiplo de 5); tip 2.4 se agrega crudo, sin redondear.
      const t = PaymentService.computeTotals([{ pricesByType: { efectivo: 102.6 } }], 'efectivo', 2.4, 0, 'MXN');
      expect(t.servicesTotal).toBe(105); // redondeado a múltiplo de 5
      expect(t.tip).toBe(2.4); // exacto, sin redondeo a múltiplo de 5
      // Si el redondeo se aplicara al total (107.4 -> 105) la propina se perdería; 107.4 lo descarta.
      expect(t.total).toBe(107.4); // 105 + 2.4, el total NO se vuelve múltiplo de 5
    });

    it('la propina no recibe el factor de método (16%/21%) en ningún método', () => {
      const base = [{ pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 } }];
      expect(PaymentService.computeTotals(base, 'efectivo', 100).tip).toBe(100);
      expect(PaymentService.computeTotals(base, 'transferencia', 100).tip).toBe(100);
      expect(PaymentService.computeTotals(base, 'tarjeta', 100).tip).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  // Fase 0 — reconciliación de reservation.paymentType vs. método real de pago.
  // Ratio derivado del pricesByType REAL de la reservación (Bug 1); ajuste único
  // recalculado desde el historial completo y REEMPLAZADO, nunca apilado (Bug 2).
  // ---------------------------------------------------------------------------
  describe('decidePaymentMethodChange (pure decision)', () => {
    // Precio "limpio" (base × 1.16 / × 1.21). T(efectivo)=10000, T(transferencia)=11600, T(tarjeta)=12100.
    const clean = [{ pricesByType: { efectivo: 10000, transferencia: 11600, tarjeta: 12100 } }];
    // Precio negociado ("sucio"): servicio A con tarjeta en 120 (no 121) + servicio B plano 50.
    // T(efectivo)=150, T(transferencia)=166, T(tarjeta)=170.
    const negotiated = [
      { pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 120 } },
      { total: 50 },
    ];

    describe('frontera escenario simple / complejo', () => {
      it('un pago previo con el MISMO método que el nuevo -> none, sin ajuste, sin tocar paymentType', () => {
        const d = PaymentService.decidePaymentMethodChange({
          serviceItems: clean,
          anchoredMethod: 'efectivo',
          priorPayments: [{ method: 'efectivo', amount: 5000 }],
          currentPayment: { method: 'efectivo', amount: 5000 },
        });
        expect(d.scenario).toBe('none');
        expect(d.paymentTypeUpdate).toBeNull();
        expect(d.reconciliationAdjustment.action).toBe('noop');
      });

      it('un pago previo con método DISTINTO -> complex, no toca paymentType', () => {
        const d = PaymentService.decidePaymentMethodChange({
          serviceItems: clean,
          anchoredMethod: 'transferencia',
          priorPayments: [{ method: 'transferencia', amount: 2320 }],
          currentPayment: { method: 'tarjeta', amount: 4840 },
        });
        expect(d.scenario).toBe('complex');
        expect(d.paymentTypeUpdate).toBeNull();
      });

      it('sin pagos previos, primer pago en método distinto al de la cotización -> actualiza paymentType, sin ajuste', () => {
        const d = PaymentService.decidePaymentMethodChange({
          serviceItems: clean,
          anchoredMethod: 'efectivo',
          priorPayments: [],
          currentPayment: { method: 'transferencia', amount: 2320 },
        });
        expect(d.scenario).toBe('none');
        expect(d.paymentTypeUpdate).toBe('transferencia');
        expect(d.reconciliationAdjustment.action).toBe('noop');
      });
    });

    describe('regla de tres — ejemplo numérico del documento', () => {
      it('liquidación completa: techo $9,680, ajuste cargo $400 (fórmula vieja y corregida coinciden aquí)', () => {
        const d = PaymentService.decidePaymentMethodChange({
          serviceItems: clean,
          anchoredMethod: 'transferencia',
          priorPayments: [{ method: 'transferencia', amount: 2320 }],
          currentPayment: { method: 'tarjeta', amount: 9680 },
          existingReconciliationAdjustment: null,
        });
        expect(d.scenario).toBe('complex');
        expect(d.expectedCeiling).toBe(9680);
        expect(d.reconciliationAdjustment.action).toBe('create');
        expect(d.reconciliationAdjustment.type).toBe('charge');
        expect(d.reconciliationAdjustment.amount).toBe(400);
        expect(d.paymentTypeUpdate).toBeNull();
      });

      it('generaliza a TRES tiers distintos sin cambios a la fórmula (Σ baseEquivalente)', () => {
        const d = PaymentService.decidePaymentMethodChange({
          serviceItems: clean,
          anchoredMethod: 'efectivo',
          priorPayments: [
            { method: 'efectivo', amount: 3000 }, // base 3000
            { method: 'transferencia', amount: 3480 }, // base 3000
          ],
          currentPayment: { method: 'tarjeta', amount: 4840 }, // base 4000
        });
        expect(d.scenario).toBe('complex');
        expect(d.reconciliationAdjustment.amount).toBe(1320); // 11320 − 10000
        // Convergencia: total anclado a efectivo + ajuste == dinero cobrado.
        const total = PaymentService.computeTotals(clean, 'efectivo', 0, 1320).total;
        expect(total - (3000 + 3480 + 4840)).toBe(0);
      });
    });

    describe('Bug 2 — 3 cruces secuenciales convergen a balance $0, ajuste reemplaza (no apila)', () => {
      it('secuencia $2,320 transferencia -> $4,840 tarjeta -> $4,640 transferencia = balance 0, un solo ajuste $200', () => {
        // Paso 1: primer pago, sin previos. Cotización en efectivo, pago en transferencia.
        const s1 = PaymentService.decidePaymentMethodChange({
          serviceItems: clean,
          anchoredMethod: 'efectivo',
          priorPayments: [],
          currentPayment: { method: 'transferencia', amount: 2320 },
          existingReconciliationAdjustment: null,
        });
        expect(s1.scenario).toBe('none');
        expect(s1.paymentTypeUpdate).toBe('transferencia');
        expect(s1.reconciliationAdjustment.action).toBe('noop');

        // Paso 2: pago en tarjeta (parcial). paymentType queda en transferencia (el ancla).
        const s2 = PaymentService.decidePaymentMethodChange({
          serviceItems: clean,
          anchoredMethod: 'transferencia',
          priorPayments: [{ method: 'transferencia', amount: 2320 }],
          currentPayment: { method: 'tarjeta', amount: 4840 },
          existingReconciliationAdjustment: null,
        });
        expect(s2.scenario).toBe('complex');
        expect(s2.reconciliationAdjustment.action).toBe('create');
        expect(s2.reconciliationAdjustment.amount).toBe(200); // NO 400 (fórmula vieja/defectuosa)

        // Paso 3: pago en transferencia que salda el resto. Recalcula desde cero -> mismo $200 -> replace.
        const s3 = PaymentService.decidePaymentMethodChange({
          serviceItems: clean,
          anchoredMethod: 'transferencia',
          priorPayments: [
            { method: 'transferencia', amount: 2320 },
            { method: 'tarjeta', amount: 4840 },
          ],
          currentPayment: { method: 'transferencia', amount: 4640 },
          existingReconciliationAdjustment: { id: 'x', type: 'charge', amount: 200 },
        });
        expect(s3.scenario).toBe('complex');
        expect(s3.reconciliationAdjustment.action).toBe('replace'); // reemplaza, NO crea un segundo
        expect(s3.reconciliationAdjustment.amount).toBe(200);

        // Verificación end-to-end: total (transferencia + $200) == dinero cobrado -> balance 0 exacto.
        const total = PaymentService.computeTotals(clean, 'transferencia', 0, 200).total;
        const paid = 2320 + 4840 + 4640;
        expect(total).toBe(11800);
        expect(total - paid).toBe(0);
      });
    });

    describe('Bug 1 — el techo deriva del pricesByType real, nunca de constantes 1.16/1.21 fijas', () => {
      it('precio negociado: techo $67.59 (real), NUNCA $77.19 (constantes fijas)', () => {
        const d = PaymentService.decidePaymentMethodChange({
          serviceItems: negotiated,
          anchoredMethod: 'transferencia',
          priorPayments: [{ method: 'transferencia', amount: 100 }],
          currentPayment: { method: 'tarjeta', amount: 67.59 },
          existingReconciliationAdjustment: null,
        });
        expect(d.expectedCeiling).toBe(67.59);
        expect(d.expectedCeiling).not.toBe(77.19); // regresión contra hardcodear factores
      });

      it('para el caso limpio da el mismo número que la fórmula con constantes (superconjunto estricto)', () => {
        const d = PaymentService.decidePaymentMethodChange({
          serviceItems: clean,
          anchoredMethod: 'transferencia',
          priorPayments: [{ method: 'transferencia', amount: 2320 }],
          currentPayment: { method: 'tarjeta', amount: 100 },
        });
        // remainingBaseBefore = 10000 − 2000 = 8000; techo = 8000 × 1.21 = 9680.
        expect(d.expectedCeiling).toBe(9680);
      });
    });

    describe('mecanismo (a) — tolerancia diferenciada efectivo vs. tarjeta/transferencia (warn, no bloquea)', () => {
      const tol = [{ pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 } }];

      it('efectivo dentro de $5 del techo NO advierte', () => {
        const d = PaymentService.decidePaymentMethodChange({
          serviceItems: tol, anchoredMethod: 'efectivo', priorPayments: [], currentPayment: { method: 'efectivo', amount: 1005 },
        });
        expect(d.expectedCeiling).toBe(1000);
        expect(d.warning).toBeNull();
      });

      it('efectivo más de $5 sobre el techo SÍ advierte (sin bloquear)', () => {
        const d = PaymentService.decidePaymentMethodChange({
          serviceItems: tol, anchoredMethod: 'efectivo', priorPayments: [], currentPayment: { method: 'efectivo', amount: 1006 },
        });
        expect(d.warning).toBeTruthy();
        // sigue devolviendo una decisión válida (nunca lanza / bloquea)
        expect(d.scenario).toBe('none');
      });

      it('tarjeta dentro de $0.01 NO advierte; más de $0.01 SÍ', () => {
        const ok = PaymentService.decidePaymentMethodChange({
          serviceItems: tol, anchoredMethod: 'tarjeta', priorPayments: [], currentPayment: { method: 'tarjeta', amount: 1210.01 },
        });
        expect(ok.warning).toBeNull();
        const warn = PaymentService.decidePaymentMethodChange({
          serviceItems: tol, anchoredMethod: 'tarjeta', priorPayments: [], currentPayment: { method: 'tarjeta', amount: 1210.02 },
        });
        expect(warn.warning).toBeTruthy();
      });

      it('transferencia con más de $0.01 de diferencia advierte', () => {
        const d = PaymentService.decidePaymentMethodChange({
          serviceItems: tol, anchoredMethod: 'transferencia', priorPayments: [], currentPayment: { method: 'transferencia', amount: 1160.05 },
        });
        expect(d.warning).toBeTruthy();
      });
    });

    describe('reglas de creación de ajuste — delta 0 / remove / replace', () => {
      it('delta 0 sin ajuste previo -> noop', () => {
        const d = PaymentService.decidePaymentMethodChange({
          serviceItems: clean, anchoredMethod: 'efectivo', priorPayments: [], currentPayment: { method: 'efectivo', amount: 10000 }, existingReconciliationAdjustment: null,
        });
        expect(d.reconciliationAdjustment.action).toBe('noop');
      });

      it('delta 0 con ajuste previo (estado vuelve a consistente) -> remove', () => {
        const d = PaymentService.decidePaymentMethodChange({
          serviceItems: clean, anchoredMethod: 'efectivo', priorPayments: [], currentPayment: { method: 'efectivo', amount: 10000 }, existingReconciliationAdjustment: { id: 'x', type: 'charge', amount: 400 },
        });
        expect(d.reconciliationAdjustment.action).toBe('remove');
      });

      it('idempotencia: recalcular sobre el mismo estado converge al mismo monto (in-place replace, no duplica)', () => {
        const first = PaymentService.decidePaymentMethodChange({
          serviceItems: clean, anchoredMethod: 'transferencia', priorPayments: [{ method: 'transferencia', amount: 2320 }], currentPayment: { method: 'tarjeta', amount: 4840 }, existingReconciliationAdjustment: null,
        });
        expect(first.reconciliationAdjustment.action).toBe('create');
        const second = PaymentService.decidePaymentMethodChange({
          serviceItems: clean, anchoredMethod: 'transferencia', priorPayments: [{ method: 'transferencia', amount: 2320 }], currentPayment: { method: 'tarjeta', amount: 4840 }, existingReconciliationAdjustment: { id: 'x', type: 'charge', amount: 200 },
        });
        expect(second.reconciliationAdjustment.action).toBe('replace');
        expect(second.reconciliationAdjustment.amount).toBe(first.reconciliationAdjustment.amount);
      });

      it('el ajuste negativo se registra como discount', () => {
        // Ancla a tarjeta; un pago previo en tarjeta ya cubrió el total y además entró un pago en efectivo
        // (tier más barata) -> cobrar el total tarjeta completo sobrestima, el ajuste baja como discount.
        const d = PaymentService.decidePaymentMethodChange({
          serviceItems: clean, anchoredMethod: 'tarjeta', priorPayments: [{ method: 'tarjeta', amount: 12100 }], currentPayment: { method: 'efectivo', amount: 1000 }, existingReconciliationAdjustment: null,
        });
        expect(d.scenario).toBe('complex'); // tarjeta previo != efectivo actual
        expect(d.reconciliationAdjustment.type).toBe('discount');
        expect(d.reconciliationAdjustment.amount).toBe(210); // |13100 − 11000×1.21|
      });

      it('la descripción del ajuste respeta el maxlength de 150 caracteres', () => {
        const d = PaymentService.decidePaymentMethodChange({
          serviceItems: clean, anchoredMethod: 'transferencia', priorPayments: [{ method: 'transferencia', amount: 2320 }], currentPayment: { method: 'tarjeta', amount: 4840 }, reconciliationDescription: 'X'.repeat(200),
        });
        expect(d.reconciliationAdjustment.description.length).toBeLessThanOrEqual(150);
      });
    });

    describe('delete / recálculo sin pago actual (currentPayment null)', () => {
      it('al quedar un solo método consistente, elimina el ajuste taggeado (remove)', () => {
        const d = PaymentService.decidePaymentMethodChange({
          serviceItems: clean,
          anchoredMethod: 'transferencia',
          priorPayments: [{ method: 'transferencia', amount: 2320 }],
          currentPayment: null,
          existingReconciliationAdjustment: { id: 'x', type: 'charge', amount: 200 },
        });
        expect(d.scenario).toBe('none');
        expect(d.paymentTypeUpdate).toBeNull();
        expect(d.expectedCeiling).toBe(0);
        expect(d.reconciliationAdjustment.action).toBe('remove');
      });
    });

    describe('moneda USD — el efectivo no se redondea a múltiplo de 5', () => {
      it('techo en USD refleja el efectivo sin redondear (101), no el redondeo MXN (100)', () => {
        const usd = PaymentService.decidePaymentMethodChange({
          serviceItems: [{ pricesByType: { efectivo: 101, tarjeta: 120 } }], currency: 'USD', anchoredMethod: 'efectivo', priorPayments: [], currentPayment: { method: 'efectivo', amount: 101 },
        });
        expect(usd.expectedCeiling).toBe(101);
        const mxn = PaymentService.decidePaymentMethodChange({
          serviceItems: [{ pricesByType: { efectivo: 101, tarjeta: 120 } }], currency: 'MXN', anchoredMethod: 'efectivo', priorPayments: [], currentPayment: { method: 'efectivo', amount: 101 },
        });
        expect(mxn.expectedCeiling).toBe(100);
      });
    });

    describe('entradas corruptas / adversariales', () => {
      it('método corrupto (null) en un pago previo fuerza complex + warning, sin lanzar, tratado con el tier del ancla (aporta 0)', () => {
        const d = PaymentService.decidePaymentMethodChange({
          serviceItems: clean,
          anchoredMethod: 'transferencia',
          priorPayments: [{ method: null, amount: 2320 }],
          currentPayment: { method: 'transferencia', amount: 4640 },
          existingReconciliationAdjustment: null,
        });
        expect(d.scenario).toBe('complex');
        expect(d.warning).toBeTruthy();
        expect(d.warning).toMatch(/inválido/);
        expect(d.reconciliationAdjustment.action).toBe('noop'); // el corrupto no aporta ni resta
      });

      it('método corrupto (cadena vacía) también fuerza complex', () => {
        const d = PaymentService.decidePaymentMethodChange({
          serviceItems: clean, anchoredMethod: 'efectivo', priorPayments: [{ method: '', amount: 100 }], currentPayment: { method: 'efectivo', amount: 100 },
        });
        expect(d.scenario).toBe('complex');
        expect(d.warning).toBeTruthy();
      });

      it('monto no numérico en un pago previo se trata como 0 (no NaN)', () => {
        const d = PaymentService.decidePaymentMethodChange({
          serviceItems: clean, anchoredMethod: 'efectivo', priorPayments: [{ method: 'efectivo', amount: 'abc' }], currentPayment: { method: 'efectivo', amount: 10000 },
        });
        expect(Number.isNaN(d.expectedCeiling)).toBe(false);
        expect(d.reconciliationAdjustment.action).toBe('noop');
      });

      it('reservación sin servicios cobrables (base 0) no truena por división entre cero', () => {
        const d = PaymentService.decidePaymentMethodChange({
          serviceItems: [{ includeInTotal: false, total: 999 }], anchoredMethod: 'efectivo', priorPayments: [], currentPayment: { method: 'tarjeta', amount: 100 },
        });
        expect(d.expectedCeiling).toBe(0);
        expect(d.reconciliationAdjustment.action).toBe('noop');
      });

      it('input vacío {} devuelve una decisión válida sin lanzar', () => {
        const d = PaymentService.decidePaymentMethodChange({});
        expect(d.scenario).toBe('none');
        expect(d.reconciliationAdjustment.action).toBe('noop');
        expect(d.paymentTypeUpdate).toBeNull();
      });
    });
  });
});
