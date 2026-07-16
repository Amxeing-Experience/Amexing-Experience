/**
 * PaymentService Unit Tests
 * Covers the pure pricing/status helpers (no Parse): chargeAmount, serviceBase,
 * computeTotals, deriveStatus. Modelo por método: se COBRA pricesByType[paymentType],
 * el valor ya calculado y aprobado por la cotización -- NO se recalcula con ninguna
 * tasa ni factor. Efectivo en MXN se redondea a múltiplo de 5 (regla física del
 * efectivo); tarjeta/transferencia NUNCA se redondean, se cobran exactas.
 */

const PaymentService = require('../../../src/application/services/PaymentService');

// Redondeo a 2 decimales, igual que el round2 interno del servicio (no exportado).
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

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
      expect(PaymentService.computeTotals([{ total: 101 }], 'efectivo', 0, 'MXN').total).toBe(100);
      expect(PaymentService.computeTotals([{ total: 103.6 }], 'efectivo', 0, 'MXN').total).toBe(105);
    });

    it('no redondea a múltiplo de 5 cuando la moneda es USD', () => {
      expect(PaymentService.computeTotals([{ total: 101 }], 'efectivo', 0, 'USD').total).toBe(101);
    });

    it('adds net adjustments as final pesos (no cambia por método)', () => {
      const t = PaymentService.computeTotals(items, 'transferencia', 20);
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
      const t = PaymentService.computeTotals([{ pricesByType: { efectivo: 1000, tarjeta: 1210 } }], 'tarjeta', 100);
      expect(t.total).toBe(1310); // 1210 + 100
    });

    it('un ajuste de descuento (neto negativo) baja el total', () => {
      const t = PaymentService.computeTotals([{ pricesByType: { efectivo: 1000, tarjeta: 1210 } }], 'tarjeta', -200);
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
      const t = PaymentService.computeTotals([{ pricesByType: { efectivo: 1000 } }], 'efectivo', -1500);
      expect(t.total).toBe(0);
    });

    it('el redondeo a múltiplo de 5 no distingue mayúsculas en la moneda (mxn/MXN)', () => {
      expect(PaymentService.computeTotals([{ pricesByType: { efectivo: 101 } }], 'efectivo', 0, 'mxn').total).toBe(100);
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

    // Firma extendida: tolerancia de cierre. Default 0.01 preserva el comportamiento estricto previo.
    it('la tolerancia default 0.01 mantiene el cierre estricto (no cambia los casos históricos)', () => {
      expect(PaymentService.deriveStatus(100, 99)).toBe('partial'); // 1 > 0.01
      expect(PaymentService.deriveStatus(100, 100)).toBe('paid');
      expect(PaymentService.deriveStatus(100, 100.01)).toBe('paid'); // sobrepago
    });

    it('tolerancia $5 (MXN): un residuo de redondeo de efectivo cierra como paid, no partial', () => {
      expect(PaymentService.deriveStatus(1005, 1002.6, 5)).toBe('paid'); // residuo 2.4 <= 5
      expect(PaymentService.deriveStatus(1005, 999, 5)).toBe('partial'); // 6 > 5 sigue parcial
    });

    it('contraste MXN($5) vs USD($0.01): un mismo saldo de $4 cierra en MXN pero sigue parcial en USD', () => {
      expect(PaymentService.deriveStatus(1000, 996, 5)).toBe('paid'); // 4 <= 5 (MXN)
      expect(PaymentService.deriveStatus(1000, 996, 0.01)).toBe('partial'); // 4 > 0.01 (USD)
    });
  });

  // ---------------------------------------------------------------------------
  // Motor de saldo mixto (Fase B1) — funciones puras re-basadas SIEMPRE al ancla.
  // ---------------------------------------------------------------------------
  describe('totalForMethod', () => {
    const items = [
      { pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 } },
      { total: 50 }, // legacy: fallback a total en cualquier método
    ];

    it('devuelve servicesTotal por método (valor ya aprobado por la cotización)', () => {
      expect(PaymentService.totalForMethod(items, 'efectivo')).toBe(150); // 100 + 50
      expect(PaymentService.totalForMethod(items, 'transferencia')).toBe(166); // 116 + 50
      expect(PaymentService.totalForMethod(items, 'tarjeta')).toBe(171); // 121 + 50
    });

    it('efectivo en MXN se redondea a múltiplo de 5; USD no', () => {
      expect(PaymentService.totalForMethod([{ pricesByType: { efectivo: 103 } }], 'efectivo', 'MXN')).toBe(100); // decimal 0 baja
      expect(PaymentService.totalForMethod([{ pricesByType: { efectivo: 103.6 } }], 'efectivo', 'MXN')).toBe(105); // decimal > 0.5 sube
      expect(PaymentService.totalForMethod([{ pricesByType: { efectivo: 103 } }], 'efectivo', 'USD')).toBe(103);
    });

    it('reservación 100% legacy sin pricesByType: mismo total para los 3 métodos (ratio 1)', () => {
      const legacy = [{ total: 200 }];
      expect(PaymentService.totalForMethod(legacy, 'efectivo')).toBe(200);
      expect(PaymentService.totalForMethod(legacy, 'transferencia')).toBe(200);
      expect(PaymentService.totalForMethod(legacy, 'tarjeta')).toBe(200);
    });

    it('sin servicios cobrables devuelve 0', () => {
      expect(PaymentService.totalForMethod([], 'tarjeta')).toBe(0);
      expect(PaymentService.totalForMethod([{ includeInTotal: false, total: 999 }], 'efectivo')).toBe(0);
    });
  });

  describe('resolveTolerance', () => {
    it('MXN => $5 (redondeo de efectivo a múltiplo de 5 es la única fuente de desvío)', () => {
      expect(PaymentService.resolveTolerance('MXN')).toBe(5);
      expect(PaymentService.resolveTolerance('mxn')).toBe(5); // case-insensitive
    });

    it('USD u otra moneda => $0.01 (centavo estándar)', () => {
      expect(PaymentService.resolveTolerance('USD')).toBe(0.01);
      expect(PaymentService.resolveTolerance('EUR')).toBe(0.01);
    });
  });

  describe('baseEquivalente', () => {
    // Base efectivo=100,000 / transferencia=116,300 / tarjeta=123,200 (tasas ilustrativas del dueño).
    const THREE = [{ pricesByType: { efectivo: 100000, transferencia: 116300, tarjeta: 123200 } }];

    it('REGRESIÓN del bug del council: ancla=tarjeta, pago 100% tarjeta => cobertura EXACTA 123,200 (nunca 100,000)', () => {
      const cov = PaymentService.baseEquivalente(
        { amount: 123200, method: 'tarjeta' },
        { serviceItems: THREE, anchoredMethod: 'tarjeta' }
      );
      expect(cov).toBe(123200); // re-basado al ancla real (tarjeta), no a efectivo hardcodeado
      expect(cov).not.toBe(100000); // el bug viejo: 123200 × (100000/123200)
    });

    it('pago en el mismo método que el ancla convierte 1:1', () => {
      const cov = PaymentService.baseEquivalente(
        { amount: 50000, method: 'efectivo' },
        { serviceItems: THREE, anchoredMethod: 'efectivo' }
      );
      expect(cov).toBe(50000);
    });

    it('ancla efectivo (barato), pago en tarjeta (caro) cubre MENOS base real', () => {
      const cov = PaymentService.baseEquivalente(
        { amount: 123200, method: 'tarjeta' },
        { serviceItems: THREE, anchoredMethod: 'efectivo' }
      );
      expect(round2(cov)).toBe(100000); // 123200 × (100000/123200)
    });

    it('ancla tarjeta (caro), pago en efectivo (barato) cubre MÁS base real', () => {
      const cov = PaymentService.baseEquivalente(
        { amount: 100000, method: 'efectivo' },
        { serviceItems: THREE, anchoredMethod: 'tarjeta' }
      );
      expect(round2(cov)).toBe(123200); // 100000 × (123200/100000)
    });

    it('guarda: base del ancla <= 0 (sin servicios cobrables) => cobertura 0, sin NaN/Infinity', () => {
      const cov = PaymentService.baseEquivalente(
        { amount: 500, method: 'tarjeta' },
        { serviceItems: [{ includeInTotal: false, total: 999 }], anchoredMethod: 'efectivo' }
      );
      expect(cov).toBe(0);
      expect(Number.isFinite(cov)).toBe(true);
    });

    it('guarda: método corrupto (null/no válido) => 1:1 sin convertir', () => {
      expect(PaymentService.baseEquivalente(
        { amount: 500, method: null },
        { serviceItems: THREE, anchoredMethod: 'efectivo' }
      )).toBe(500);
      expect(PaymentService.baseEquivalente(
        { amount: 500, method: 'bitcoin' },
        { serviceItems: THREE, anchoredMethod: 'efectivo' }
      )).toBe(500);
    });

    it('guarda: monto no finito (Infinity/NaN) => 0 (fail-safe, hueco #4)', () => {
      expect(PaymentService.baseEquivalente(
        { amount: Infinity, method: 'tarjeta' },
        { serviceItems: THREE, anchoredMethod: 'efectivo' }
      )).toBe(0);
      expect(PaymentService.baseEquivalente(
        { amount: NaN, method: 'efectivo' },
        { serviceItems: THREE, anchoredMethod: 'efectivo' }
      )).toBe(0);
    });

    it('reservación 100% legacy (ratio 1): cobertura == monto crudo en cualquier método', () => {
      const legacy = [{ total: 200 }];
      expect(PaymentService.baseEquivalente(
        { amount: 200, method: 'tarjeta' },
        { serviceItems: legacy, anchoredMethod: 'efectivo' }
      )).toBe(200);
    });
  });

  describe('remainingBreakdown', () => {
    const THREE = [{ pricesByType: { efectivo: 100000, transferencia: 116300, tarjeta: 123200 } }];

    it('EJEMPLO EXACTO DEL DUEÑO: $100k ancla efectivo, pago $50k efectivo => montoParaSaldar 50k/58,150/61,600, 50% restante', () => {
      const b = PaymentService.remainingBreakdown(
        [{ amount: 50000, method: 'efectivo' }],
        { serviceItems: THREE, anchoredMethod: 'efectivo' }
      );
      expect(b.totalDue).toBe(100000);
      expect(b.coverageAmount).toBe(50000);
      expect(b.remainingBase).toBe(50000);
      expect(b.remainingPercent).toBe(50);
      expect(b.montoParaSaldar).toEqual({
        efectivo: 50000,
        transferencia: 58150, // 50000 × (116300/100000)
        tarjeta: 61600, // 50000 × (123200/100000)
      });
    });

    it('ancla=tarjeta, único pago 100% tarjeta => remainingBase 0, cobertura completa (cierra en cero)', () => {
      const b = PaymentService.remainingBreakdown(
        [{ amount: 123200, method: 'tarjeta' }],
        { serviceItems: THREE, anchoredMethod: 'tarjeta' }
      );
      expect(b.totalDue).toBe(123200);
      expect(b.coverageAmount).toBe(123200);
      expect(b.remainingBase).toBe(0);
      expect(b.remainingPercent).toBe(0);
      expect(b.montoParaSaldar).toEqual({ efectivo: 0, transferencia: 0, tarjeta: 0 });
    });

    it('sobrepago (cobertura > deuda): remainingBase se clampa a 0, nunca negativo (hueco #2)', () => {
      const b = PaymentService.remainingBreakdown(
        [{ amount: 200000, method: 'efectivo' }],
        { serviceItems: THREE, anchoredMethod: 'efectivo' }
      );
      expect(b.coverageAmount).toBe(200000);
      expect(b.remainingBase).toBe(0);
      expect(b.remainingPercent).toBe(0);
    });

    it('sin pagos: remainingBase == totalDue, cobertura 0', () => {
      const b = PaymentService.remainingBreakdown([], { serviceItems: THREE, anchoredMethod: 'efectivo' });
      expect(b.coverageAmount).toBe(0);
      expect(b.remainingBase).toBe(100000);
      expect(b.remainingPercent).toBe(100);
    });

    it('ajuste manual (hallazgo #3): el ratio de conversión usa servicesTotal; el ajuste se suma una vez al saldo', () => {
      const withAdj = [{ pricesByType: { efectivo: 100000, transferencia: 116000, tarjeta: 120000 } }];
      const b = PaymentService.remainingBreakdown(
        [],
        {
          serviceItems: withAdj, anchoredMethod: 'efectivo', adjustmentsNet: 10000,
        }
      );
      expect(b.totalDue).toBe(110000); // 100000 servicios + 10000 ajuste
      expect(b.remainingBase).toBe(110000); // sin pagos, todo el saldo (incluye el ajuste)
      // El ratio de tarjeta usa servicesTotal (120000/100000 = 1.2) sobre el saldo, no .total.
      expect(b.montoParaSaldar.tarjeta).toBe(132000); // 110000 × (120000/100000)
      expect(b.montoParaSaldar.efectivo).toBe(110000);
    });

    it('ajuste manual + pago cross-tier que cubre exactamente el saldo => cierra en $0 sin residuo (hallazgo #3)', () => {
      const svc = [{ pricesByType: { efectivo: 100000, transferencia: 112000, tarjeta: 125000 } }];
      // totalDue = 100000 + 25000 = 125000. Un pago tarjeta de 156250 cubre 156250×(100000/125000)=125000.
      const b = PaymentService.remainingBreakdown(
        [{ amount: 156250, method: 'tarjeta' }],
        {
          serviceItems: svc, anchoredMethod: 'efectivo', adjustmentsNet: 25000,
        }
      );
      expect(b.totalDue).toBe(125000);
      expect(b.coverageAmount).toBe(125000);
      expect(b.remainingBase).toBe(0);
    });

    it('tolerancia de redondeo de efectivo (hueco #4): residuo <= $5 MXN cierra en $0', () => {
      // efectivo 1002.6 -> redondea a 1005; pagar 1002.6 deja un residuo de 2.4 -> saldado.
      const svc = [{ pricesByType: { efectivo: 1002.6, tarjeta: 1210 } }];
      const b = PaymentService.remainingBreakdown(
        [{ amount: 1002.6, method: 'efectivo' }],
        { serviceItems: svc, anchoredMethod: 'efectivo' }
      );
      expect(b.totalDue).toBe(1005); // redondeado
      expect(b.remainingBase).toBe(0); // residuo 2.4 dentro de la tolerancia $5
    });

    it('guarda: sin servicios cobrables (base 0) => montoParaSaldar todo 0, sin NaN', () => {
      const b = PaymentService.remainingBreakdown(
        [{ amount: 100, method: 'tarjeta' }],
        { serviceItems: [{ includeInTotal: false, total: 999 }], anchoredMethod: 'efectivo' }
      );
      expect(b.totalDue).toBe(0);
      expect(b.remainingBase).toBe(0);
      expect(b.remainingPercent).toBe(0);
      expect(b.montoParaSaldar).toEqual({ efectivo: 0, transferencia: 0, tarjeta: 0 });
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

  describe('buildSummary (ADR-1b: paidAmount/balance sin cambio de fórmula, paymentStatus por cobertura)', () => {
    // Mirror de loadAndCompute: construye `computed` a partir de datos planos, con totals consistentes.
    const build = (serviceItems, paymentType, paymentRows, { currency = 'MXN', adjustmentsNet = 0 } = {}) => ({
      totals: PaymentService.computeTotals(serviceItems, paymentType, adjustmentsNet, currency),
      paidGlobal: PaymentService.sumPayments(paymentRows),
      serviceItems,
      paymentType,
      currency,
      paymentRows,
    });

    // Base efectivo=100,000 / transferencia=116,300 / tarjeta=123,200.
    const THREE = [{ pricesByType: { efectivo: 100000, transferencia: 116300, tarjeta: 123200 } }];

    it('pago parcial en el MISMO método que el ancla: total/paidAmount/balance/status como siempre', () => {
      const summary = PaymentService.buildSummary('r1', build(THREE, 'tarjeta', [{ amount: 100000, method: 'tarjeta' }]));
      expect(summary.reservationId).toBe('r1');
      expect(summary.total).toBe(123200);
      expect(summary.paidAmount).toBe(100000); // Σ amount crudo
      expect(summary.balance).toBe(23200); // total − paid
      expect(summary.paymentStatus).toBe('partial'); // cobertura 100000 < 123200
      expect(summary.coverageAmount).toBe(100000);
    });

    it('does not expose a per-service breakdown', () => {
      const summary = PaymentService.buildSummary('r1', build(THREE, 'efectivo', []));
      expect(summary).not.toHaveProperty('services');
    });

    // ADR-1b / Pregunta 0: el ÚNICO campo que cambia de significado es paymentStatus (cobertura
    // equivalente-ancla); paidAmount/balance siguen siendo dinero físico crudo, ambos expuestos.
    it('ancla TARJETA, cobertura 100% pagada en EFECTIVO: status "paid" CONVIVE con balance físico positivo', () => {
      // Ancla tarjeta ($123,200); se paga el equivalente completo en efectivo ($100,000, más barato).
      const summary = PaymentService.buildSummary('r1', build(THREE, 'tarjeta', [{ amount: 100000, method: 'efectivo' }]));
      expect(summary.coverageAmount).toBe(123200); // $100k efectivo cubre $123,200 tarjeta
      expect(summary.paymentStatus).toBe('paid'); // deriva de la cobertura, NO del balance crudo
      expect(summary.paidAmount).toBe(100000); // Σ amount crudo (dinero físico), NO la cobertura
      expect(summary.balance).toBe(23200); // 123200 − 100000, POSITIVO (fórmula intacta)
      expect(summary.remainingBase).toBe(0); // el saldo por cobertura sí cierra en 0
    });

    it('paidAmount/balance = dinero físico crudo aun con métodos MEZCLADOS y status "paid"', () => {
      // $50k efectivo (cubre 61,600) + $61,600 tarjeta (cubre 61,600) => cobertura 123,200 completa.
      const summary = PaymentService.buildSummary('r1', build(THREE, 'tarjeta', [
        { amount: 50000, method: 'efectivo' },
        { amount: 61600, method: 'tarjeta' },
      ]));
      expect(summary.coverageAmount).toBe(123200);
      expect(summary.paymentStatus).toBe('paid');
      expect(summary.paidAmount).toBe(111600); // 50000 + 61600 crudo, NUNCA la cobertura 123200
      expect(summary.balance).toBe(11600); // 123200 − 111600 (dinero físico), positivo
    });

    it('sobrepago en el mismo método: status paid, balance negativo, coveragePercent > 100 sin truncar', () => {
      const summary = PaymentService.buildSummary('r1', build(THREE, 'tarjeta', [{ amount: 130000, method: 'tarjeta' }]));
      expect(summary.paymentStatus).toBe('paid');
      expect(summary.paidAmount).toBe(130000);
      expect(summary.balance).toBe(-6800); // 123200 − 130000
      expect(summary.coveragePercent).toBeGreaterThan(100); // crudo (hueco #1): 130000/123200 ≈ 105.52%
    });

    it('sin pagos: pending, con los campos aditivos de saldo restante (Requisito 8)', () => {
      const summary = PaymentService.buildSummary('r1', build(THREE, 'efectivo', []));
      expect(summary.paymentStatus).toBe('pending');
      expect(summary.paidAmount).toBe(0);
      expect(summary.balance).toBe(100000);
      expect(summary.coverageAmount).toBe(0);
      expect(summary.remainingBase).toBe(100000);
      expect(summary.remainingPercent).toBe(100);
      expect(summary.montoParaSaldar).toEqual({ efectivo: 100000, transferencia: 116300, tarjeta: 123200 });
    });
  });

});
