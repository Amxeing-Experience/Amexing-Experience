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

    // FIX council (L4F0): un null explícito para el método es finito (Number(null) === 0) => 0, NO cae al
    // fallback item.total. DEBE coincidir con getServicePriceByType del cliente (mismo input, mismo 0).
    it('un null explícito en pricesByType[método] da 0 (no cae a item.total)', () => {
      expect(PaymentService.chargeAmount({ pricesByType: { tarjeta: null }, total: 500 }, 'tarjeta')).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Descuento por servicio (Fase 1): pricesByType es la base PURA; el descuento (discountAmount,
  // en efectivo) se resta ESCALADO por el factor de forma de pago, con la misma fórmula que el front
  // (getServiceDiscountInPaymentType) y el server (evaluateTotalsConsistency). Antes chargeAmount
  // devolvía el bruto y el motor de pagos divergía de reservation.totalAmount por el monto del descuento.
  // ---------------------------------------------------------------------------
  describe('chargeAmount / computeTotals con descuento por servicio (Fase 1)', () => {
    it('U-DISC1: resta el descuento en efectivo (factor 1) del precio bruto', () => {
      expect(PaymentService.chargeAmount({ pricesByType: { efectivo: 2000 }, discountAmount: 300 }, 'efectivo')).toBe(1700);
    });

    it('U-DISC2: computeTotals refleja el descuento (efectivo 2000 − 300 = 1700)', () => {
      const t = PaymentService.computeTotals(
        [{ pricesByType: { efectivo: 2000, tarjeta: 2320 }, total: 1700, discountAmount: 300 }],
        'efectivo'
      );
      expect(t.total).toBe(1700);
    });

    it('U-DISC3: descuento + propina juntos (2000 − 200 + 180 = 1980, NO 2180)', () => {
      const t = PaymentService.computeTotals(
        [{
          pricesByType: { efectivo: 2000 }, total: 1800, discountAmount: 200, tipAmount: 180,
        }],
        'efectivo', 0, 'MXN', 180
      );
      expect(t.total).toBe(1980);
    });

    it('U-DISC4: un descuento mayor al precio del método no da negativo (clamp a 0)', () => {
      expect(PaymentService.chargeAmount({ pricesByType: { efectivo: 100 }, discountAmount: 150 }, 'efectivo')).toBe(0);
    });

    // --- Edge cases (QA adversarial) ---

    it('escala el descuento por el factor de tarjeta (mismo % de descuento que en efectivo)', () => {
      // efectivo 2000 / tarjeta 2320 (factor 1.16). Descuento efectivo 300 -> en tarjeta 300*1.16 = 348.
      // Cobro tarjeta = 2320 − 348 = 1972.
      expect(PaymentService.chargeAmount(
        { pricesByType: { efectivo: 2000, tarjeta: 2320 }, discountAmount: 300 }, 'tarjeta'
      )).toBe(1972);
    });

    it('descuento 0 / negativo / no numérico se ignora (cobra el bruto tal cual)', () => {
      const prices = { efectivo: 1000 };
      expect(PaymentService.chargeAmount({ pricesByType: prices, discountAmount: 0 }, 'efectivo')).toBe(1000);
      expect(PaymentService.chargeAmount({ pricesByType: prices, discountAmount: -50 }, 'efectivo')).toBe(1000);
      expect(PaymentService.chargeAmount({ pricesByType: prices, discountAmount: 'abc' }, 'efectivo')).toBe(1000);
      expect(PaymentService.chargeAmount({ pricesByType: prices }, 'efectivo')).toBe(1000);
    });

    it('sin base efectivo utilizable (efBase<=0): resta el descuento bruto, sin escalar', () => {
      // pricesByType.efectivo ausente/0 -> no hay factor; se resta discEf directo del método pedido.
      expect(PaymentService.chargeAmount({ pricesByType: { tarjeta: 500 }, discountAmount: 100 }, 'tarjeta')).toBe(400);
    });

    it('el fallback a item.total (dato legacy sin pricesByType) NO vuelve a restar el descuento (total ya es neto)', () => {
      // total ya viene neto del wizard; aplicar el descuento otra vez lo doble-contaría.
      expect(PaymentService.chargeAmount({ total: 1700, discountAmount: 300 }, 'efectivo')).toBe(1700);
    });

    it('un servicio excluido del total aporta 0 aunque tenga descuento', () => {
      expect(PaymentService.chargeAmount(
        { includeInTotal: false, pricesByType: { efectivo: 2000 }, discountAmount: 300 }, 'efectivo'
      )).toBe(0);
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

    it('un ajuste que aterriza en X.XX5 exacto (ej. 0.5% de descuento sobre 201) redondea al centavo correcto, no lo pierde por punto flotante', () => {
      // 201 * 0.5 / 100 = 1.005 exacto. Math.round((1.005*100))/100 sin Number.EPSILON da 1.00 (pierde
      // un centavo real) porque 1.005 se representa como 1.00499999999999989 en IEEE-754 double.
      const t = PaymentService.computeTotals([], 'efectivo', 1.005, 'USD');
      expect(t.total).toBe(1.01);
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

  // ---------------------------------------------------------------------------
  // Fase 2 (propina cobrada) — la propina es un monto FIJO en pesos que NUNCA
  // escala con el método de pago; se suma DESPUÉS del redondeo a efectivo y de
  // los ajustes, dentro del clamp final, sin re-redondear a múltiplo de 5.
  // ---------------------------------------------------------------------------
  describe('computeTotals con propina (Fase 2)', () => {
    // Precio limpio: efectivo 10000 / transferencia 11600 / tarjeta 12100.
    const items = [{ pricesByType: { efectivo: 10000, transferencia: 11600, tarjeta: 12100 } }];

    it('la propina NO escala por método: se suma la MISMA cantidad plana al ancla efectivo y al ancla tarjeta', () => {
      const ef = PaymentService.computeTotals(items, 'efectivo', 0, 'MXN', 300);
      const tj = PaymentService.computeTotals(items, 'tarjeta', 0, 'MXN', 300);
      expect(ef.tip).toBe(300);
      expect(tj.tip).toBe(300); // NO 300*1.21
      expect(ef.total).toBe(10300); // 10000 + 300
      expect(tj.total).toBe(12400); // 12100 + 300 (plano)
      // La propina no afecta servicesTotal (base de conversión entre métodos) ni el recargo.
      expect(ef.servicesTotal).toBe(10000);
      expect(tj.servicesTotal).toBe(12100);
      expect(tj.surcharge).toBe(2100); // 12100 - 10000, intacto
    });

    it('tip=0 (default) es retro-compatible: total sin propina, campo tip = 0', () => {
      const t = PaymentService.computeTotals(items, 'efectivo');
      expect(t.tip).toBe(0);
      expect(t.total).toBe(10000);
    });

    it('tip negativo / NaN / Infinity se clampan a 0 (nunca contaminan el total)', () => {
      expect(PaymentService.computeTotals(items, 'efectivo', 0, 'MXN', -50).tip).toBe(0);
      expect(PaymentService.computeTotals(items, 'efectivo', 0, 'MXN', NaN).tip).toBe(0);
      expect(PaymentService.computeTotals(items, 'efectivo', 0, 'MXN', Infinity).tip).toBe(0);
      expect(PaymentService.computeTotals(items, 'efectivo', 0, 'MXN', -50).total).toBe(10000);
    });

    it('redondea la propina a 2 decimales sin arrastre de punto flotante (1.005 -> 1.01)', () => {
      const t = PaymentService.computeTotals([], 'efectivo', 0, 'USD', 1.005);
      expect(t.tip).toBe(1.01);
      expect(t.total).toBe(1.01);
    });

    it('ORDEN: el efectivo se redondea a múltiplo de 5 ANTES, la propina se suma DESPUÉS sin re-redondear', () => {
      // efectivo 103 -> cash round 100; + propina 7 = 107 (NO se re-redondea a 105/110).
      const t = PaymentService.computeTotals([{ pricesByType: { efectivo: 103 } }], 'efectivo', 0, 'MXN', 7);
      expect(t.servicesTotal).toBe(100); // servicios redondeados a múltiplo de 5
      expect(t.total).toBe(107); // 100 + 7, la propina NO se re-redondea
    });

    it('un ajuste-descuento mayor a servicios+propina deja el total en 0 (nunca negativo)', () => {
      // 1000 servicios − 1500 descuento + 300 propina = −200 -> clamp 0.
      const t = PaymentService.computeTotals([{ pricesByType: { efectivo: 1000 } }], 'efectivo', -1500, 'MXN', 300);
      expect(t.total).toBe(0);
    });

    it('moneda USD: sin redondeo a múltiplo de 5, la propina se suma plana', () => {
      const t = PaymentService.computeTotals([{ pricesByType: { efectivo: 101 } }], 'efectivo', 0, 'USD', 50);
      expect(t.servicesTotal).toBe(101); // USD no redondea efectivo
      expect(t.total).toBe(151); // 101 + 50
    });

    it('la propina convive con ajustes: servicios + ajuste neto + propina, todos planos', () => {
      const t = PaymentService.computeTotals(items, 'tarjeta', 100, 'MXN', 300);
      expect(t.adjustments).toBe(100);
      expect(t.tip).toBe(300);
      expect(t.total).toBe(12500); // 12100 + 100 + 300
    });
  });

  describe('sumServiceTips (Fase 2 — suma la propina por servicio, solo lectura)', () => {
    it('suma tipAmount de los servicios activos', () => {
      expect(PaymentService.sumServiceTips([{ tipAmount: 100 }, { tipAmount: 300 }])).toBe(400);
    });

    it('excluye includeInTotal:false (aporta $0 igual que su precio)', () => {
      expect(PaymentService.sumServiceTips([
        { tipAmount: 100 },
        { includeInTotal: false, tipAmount: 999 },
      ])).toBe(100);
    });

    it('ignora tipAmount no finito o negativo (NaN/Infinity/negativo -> 0)', () => {
      expect(PaymentService.sumServiceTips([
        { tipAmount: NaN }, { tipAmount: Infinity }, { tipAmount: -50 }, { tipAmount: 200 },
      ])).toBe(200);
    });

    it('suma exacta con muchos servicios, sin deriva de centavos', () => {
      const items = Array.from({ length: 10 }, () => ({ tipAmount: 0.1 }));
      expect(PaymentService.sumServiceTips(items)).toBe(1); // 10 × 0.10 = 1.00 exacto (round2)
    });

    it('un servicio sin tipAmount cuenta como 0; vacío/null -> 0', () => {
      expect(PaymentService.sumServiceTips([{ total: 100 }, { tipAmount: 50 }])).toBe(50);
      expect(PaymentService.sumServiceTips([])).toBe(0);
      expect(PaymentService.sumServiceTips(null)).toBe(0);
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

    it('ajuste manual (hallazgo #3, corregido por council L0F0/L5F0): el ajuste NUNCA escala por método, solo la parte de servicios', () => {
      const withAdj = [{ pricesByType: { efectivo: 100000, transferencia: 116000, tarjeta: 120000 } }];
      const b = PaymentService.remainingBreakdown(
        [],
        {
          serviceItems: withAdj, anchoredMethod: 'efectivo', adjustmentsNet: 10000,
        }
      );
      expect(b.totalDue).toBe(110000); // 100000 servicios + 10000 ajuste
      expect(b.remainingBase).toBe(110000); // sin pagos, todo el saldo (incluye el ajuste)
      // Fix council: el ratio de tarjeta (120000/100000=1.2) SOLO escala los 100000 de servicios; el
      // ajuste de 10000 se suma PLANO, sin escalar. Antes (bug L0F0/L5F0) se multiplicaba TODO el saldo
      // (incluido el ajuste) por 1.2, dando 132000 -- $2,000 de más cobrados de haberse saldado en tarjeta.
      expect(b.montoParaSaldar.tarjeta).toBe(130000); // 100000×1.2 + 10000
      expect(b.montoParaSaldar.efectivo).toBe(110000);
    });

    it('FIX council (L0F0/L5F0): la propina NUNCA escala por método en montoParaSaldar', () => {
      const svc = [{ pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 } }];
      // Sin pagos: remainingServices=1000 (toda la base sin cubrir), remainingFlat=300 (la propina, plana).
      const sinPagos = PaymentService.remainingBreakdown(
        [],
        { serviceItems: svc, anchoredMethod: 'efectivo', reservationTip: 300 }
      );
      expect(sinPagos.totalDue).toBe(1300);
      // Antes (bug): 1300 × 1.21 = 1573. Correcto: 1000×1.21 + 300 = 1510 (la propina no escala).
      expect(sinPagos.montoParaSaldar.tarjeta).toBe(1510);
      expect(sinPagos.montoParaSaldar.efectivo).toBe(1300); // == remainingBase, sin cambio

      // Pago parcial de 700 en efectivo: remainingServices=300 (1000-700), remainingFlat=300 (sin tocar).
      const pagoParcial = PaymentService.remainingBreakdown(
        [{ amount: 700, method: 'efectivo' }],
        { serviceItems: svc, anchoredMethod: 'efectivo', reservationTip: 300 }
      );
      expect(pagoParcial.remainingBase).toBe(600);
      expect(pagoParcial.montoParaSaldar.efectivo).toBe(600); // == remainingBase (identidad del ancla)
      expect(pagoParcial.montoParaSaldar.tarjeta).toBe(663); // 300×1.21 + 300, no 600×1.21=726

      // Pago de 1100 en efectivo: ya cubrió TODA la base de servicios + parte de la propina.
      // remainingServices=0, remainingFlat=200 (300-100) => el remanente es IGUAL en los 3 métodos.
      const serviciosCubiertos = PaymentService.remainingBreakdown(
        [{ amount: 1100, method: 'efectivo' }],
        { serviceItems: svc, anchoredMethod: 'efectivo', reservationTip: 300 }
      );
      expect(serviciosCubiertos.montoParaSaldar).toEqual({ efectivo: 200, transferencia: 200, tarjeta: 200 });
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

    it('FIX council (L0F0): base de servicios 0 pero saldo por ajuste => montoParaSaldar refleja el remanente, no $0 con 100%', () => {
      // Servicios sin base cobrable + un cargo manual de $400 (adjustmentsNet). Sin "regla de tres" que
      // aplicar (no hay tier de servicios): saldar en cualquier método cuesta el remanente completo.
      const b = PaymentService.remainingBreakdown(
        [],
        { serviceItems: [{ includeInTotal: false, total: 999 }], anchoredMethod: 'efectivo', adjustmentsNet: 400 }
      );
      expect(b.totalDue).toBe(400);
      expect(b.remainingBase).toBe(400);
      expect(b.remainingPercent).toBe(100);
      // Antes: { efectivo: 0, transferencia: 0, tarjeta: 0 } contradiciendo el 100% mostrado.
      expect(b.montoParaSaldar).toEqual({ efectivo: 400, transferencia: 400, tarjeta: 400 });
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

  // ---------------------------------------------------------------------------
  // FIX council (L5F0) — el pago (siempre almacenado en MXN) se expresa en la moneda de la reservación
  // antes de alimentar el motor de cobertura, para no mezclar MXN con pricesByType/totalDue en USD.
  // ---------------------------------------------------------------------------
  describe('paymentAmountInCurrency', () => {
    it('reservación MXN: usa el amount (MXN) tal cual, ignora la tasa (Fase B intacta)', () => {
      expect(PaymentService.paymentAmountInCurrency({ amount: 1850, origAmount: 1850, origCurrency: 'MXN' }, 'MXN', 18.5)).toBe(1850);
      // Sin snapshot (reservación/legacy MXN) tampoco convierte.
      expect(PaymentService.paymentAmountInCurrency({ amount: 500 }, 'MXN')).toBe(500);
    });

    it('reservación USD + pago capturado en USD: usa origAmount EXACTO (sin tasa, sin drift)', () => {
      // El bug del council: 10 USD se guardaba como 185 MXN y el motor lo tomaba como 185 (18.5x inflado).
      expect(PaymentService.paymentAmountInCurrency({ amount: 185, origAmount: 10, origCurrency: 'USD' }, 'USD', 18.5)).toBe(10);
      // La tasa vigente NO afecta al pago USD (usa su snapshot), aunque haya cambiado desde la captura.
      expect(PaymentService.paymentAmountInCurrency({ amount: 185, origAmount: 10, origCurrency: 'USD' }, 'USD', 20)).toBe(10);
    });

    it('reservación USD + pago capturado en MXN: reconvierte MXN -> USD con la tasa vigente', () => {
      // Un pago MXN contra una reservación USD SÍ necesita la tasa (su snapshot es 1, inservible para MXN->USD).
      expect(PaymentService.paymentAmountInCurrency({ amount: 1850, origAmount: 1850, origCurrency: 'MXN' }, 'USD', 18.5)).toBe(100);
    });

    it('reservación USD + pago USD sin snapshot (legacy): cae a la conversión por tasa vigente', () => {
      expect(PaymentService.paymentAmountInCurrency({ amount: 185, origCurrency: 'USD' }, 'USD', 18.5)).toBe(10);
    });

    it('reservación USD sin tasa utilizable: no inventa unidades, devuelve el MXN crudo (último recurso)', () => {
      expect(PaymentService.paymentAmountInCurrency({ amount: 185, origCurrency: 'MXN' }, 'USD', 0)).toBe(185);
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

    // --- Fase 2 (propina cobrada): expuesta desglosada y sumada al total/saldo ---
    // Mirror de loadAndCompute con propina: generalTip/serviceTipsTotal viajan en `computed`.
    const buildTip = (serviceItems, paymentType, paymentRows, generalTip, serviceTipsTotal, currency = 'MXN') => {
      const reservationTip = PaymentService.sumServiceTips([{ tipAmount: generalTip }, { tipAmount: serviceTipsTotal }]);
      return {
        totals: PaymentService.computeTotals(serviceItems, paymentType, 0, currency, reservationTip),
        paidGlobal: PaymentService.sumPayments(paymentRows),
        serviceItems,
        paymentType,
        currency,
        paymentRows,
        generalTip,
        serviceTipsTotal,
      };
    };
    const TIP_ITEMS = [{ pricesByType: { efectivo: 10000, tarjeta: 12100 } }];

    it('expone tip/generalTip/serviceTipsTotal (Fase 2); su suma es siempre tip y el total ya la incluye', () => {
      const summary = PaymentService.buildSummary('r1', buildTip(TIP_ITEMS, 'efectivo', [], 100, 300));
      expect(summary.generalTip).toBe(100);
      expect(summary.serviceTipsTotal).toBe(300);
      expect(summary.tip).toBe(400);
      expect(summary.generalTip + summary.serviceTipsTotal).toBe(summary.tip);
      expect(summary.total).toBe(10400); // 10000 servicios + 400 propina
      expect(summary.remainingBase).toBe(10400); // sin pagos, el saldo incluye la propina
    });

    it('retro-compatible: sin propina en computed, tip/generalTip/serviceTipsTotal = 0', () => {
      const summary = PaymentService.buildSummary('r1', build(THREE, 'efectivo', []));
      expect(summary.tip).toBe(0);
      expect(summary.generalTip).toBe(0);
      expect(summary.serviceTipsTotal).toBe(0);
    });

    it('pago que cubre SOLO los servicios deja el saldo = propina pendiente (partial)', () => {
      const rows = [{ amount: 10000, method: 'efectivo' }];
      const summary = PaymentService.buildSummary('r1', buildTip(TIP_ITEMS, 'efectivo', rows, 300, 0));
      expect(summary.total).toBe(10300);
      expect(summary.paidAmount).toBe(10000);
      expect(summary.paymentStatus).toBe('partial'); // faltó la propina
      expect(summary.balance).toBe(300); // exactamente la propina pendiente
      expect(summary.remainingBase).toBe(300);
    });

    it('pago EXACTO de servicios+propina en el método ancla cierra en paid, saldo 0', () => {
      const rows = [{ amount: 10300, method: 'efectivo' }];
      const summary = PaymentService.buildSummary('r1', buildTip(TIP_ITEMS, 'efectivo', rows, 300, 0));
      expect(summary.paymentStatus).toBe('paid');
      expect(summary.balance).toBe(0);
      expect(summary.remainingBase).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // FIX (dinero): el redondeo físico de efectivo (múltiplo de 5) NO debe filtrarse a la conversión
  // equivalente-ancla. Es un cobro REAL solo cuando el efectivo es el método ANCLA; cuando es apenas la
  // referencia de precio de un pago hecho en OTRO método, aplicarlo achica el denominador (tierTotal) e
  // infla el equivalente del pago en efectivo -> coverageAmount por encima del total (bug del 100.04% en
  // una reservación pagada al 100%). El fix usa totalForMethodRaw (sin redondeo) SOLO para el tier del
  // pago, deja el ancla (baseTotal) con su redondeo real, y hace explícito el short-circuit mismo-método.
  // ---------------------------------------------------------------------------
  describe('baseEquivalente/buildSummary: el redondeo de efectivo NO se filtra a la conversión equivalente-ancla', () => {
    // Un servicio cuyo total en efectivo (1002) NO es múltiplo de 5: applyCashRounding lo bajaría a 1000.
    const ITEM = [{ pricesByType: { efectivo: 1002, transferencia: 1160 } }];
    // Mirror mínimo de loadAndCompute para ejercer buildSummary (coveragePercent vive ahí).
    const build = (serviceItems, paymentType, paymentRows) => ({
      totals: PaymentService.computeTotals(serviceItems, paymentType, 0, 'MXN'),
      paidGlobal: PaymentService.sumPayments(paymentRows),
      serviceItems,
      paymentType,
      currency: 'MXN',
      paymentRows,
    });

    it('ancla transferencia, pago en efectivo: el tier usa el efectivo CRUDO (1002), no el redondeado (1000)', () => {
      // Antes (bug): 501 × (1160 / applyCashRounding(1002)=1000) = 581.16 (inflado).
      // Ahora: 501 × (1160/1002) = 580 exacto (501/1002 = 0.5 -> 0.5 × 1160).
      const cov = PaymentService.baseEquivalente(
        { amount: 501, method: 'efectivo' },
        { serviceItems: ITEM, anchoredMethod: 'transferencia' }
      );
      expect(round2(cov)).toBe(580); // no 581.16
    });

    it('REPRO del bug (100.04%): ancla transferencia, pago exacto repartido efectivo+transferencia => coveragePercent EXACTO 100', () => {
      // Deuda (transferencia) = 1160. Pago 501 efectivo (cubre 580) + 580 transferencia (1:1) = 1160 exacto.
      const summary = PaymentService.buildSummary('r1', build(ITEM, 'transferencia', [
        { amount: 501, method: 'efectivo' },
        { amount: 580, method: 'transferencia' },
      ]));
      expect(summary.total).toBe(1160);
      expect(summary.coverageAmount).toBe(1160);
      expect(summary.coveragePercent).toBe(100); // antes: 100.1 (redondeo de efectivo filtrado)
      expect(summary.remainingBase).toBe(0);
      expect(summary.paymentStatus).toBe('paid');
    });

    it('REPRO 3 efectivo + 3 transferencia (como la reservación real mfHAmASvF7): coveragePercent EXACTO 100', () => {
      const summary = PaymentService.buildSummary('r1', build(ITEM, 'transferencia', [
        { amount: 167, method: 'efectivo' },
        { amount: 167, method: 'efectivo' },
        { amount: 167, method: 'efectivo' }, // 3 × 167 = 501 efectivo -> 580 transferencia
        { amount: 200, method: 'transferencia' },
        { amount: 200, method: 'transferencia' },
        { amount: 180, method: 'transferencia' }, // 3 pagos = 580 transferencia
      ]));
      expect(summary.coveragePercent).toBe(100); // sin decimal parásito por el redondeo de efectivo
      expect(summary.remainingBase).toBe(0);
      expect(summary.paymentStatus).toBe('paid');
    });

    it('SIN REGRESIÓN — ancla efectivo, pago en transferencia: el ancla SÍ conserva su total redondeado (1000)', () => {
      // baseTotal = totalForMethod('efectivo') = applyCashRounding(1002) = 1000 (monto REAL a cobrar en
      // efectivo, intacto). El tier transferencia nunca se redondea, así que raw == totalForMethod: idéntico.
      const summary = PaymentService.buildSummary('r1', build(ITEM, 'efectivo', [
        { amount: 1160, method: 'transferencia' },
      ]));
      expect(summary.total).toBe(1000); // efectivo ancla redondeado (regla física intacta)
      expect(summary.coverageAmount).toBe(1000); // 1160 × (1000/1160)
      expect(summary.coveragePercent).toBe(100);
      expect(summary.paymentStatus).toBe('paid');
    });

    it('MISMO MÉTODO — ancla efectivo, pago en efectivo: cobertura == monto crudo (ratio 1 explícito, sin reconvertir)', () => {
      // Short-circuit: mismo método que el ancla devuelve el monto tal cual, sin pasar por baseTotal/tierTotal.
      expect(PaymentService.baseEquivalente(
        { amount: 777, method: 'efectivo' },
        { serviceItems: ITEM, anchoredMethod: 'efectivo' }
      )).toBe(777);
      // El cliente paga los 1000 que se le cobran (efectivo redondeado) y cierra al 100%.
      const summary = PaymentService.buildSummary('r1', build(ITEM, 'efectivo', [
        { amount: 1000, method: 'efectivo' },
      ]));
      expect(summary.coverageAmount).toBe(1000);
      expect(summary.coveragePercent).toBe(100);
      expect(summary.paymentStatus).toBe('paid');
    });

    it('SOBREPAGO GENUINO (no por redondeo): ancla transferencia, pago grande en efectivo => coveragePercent > 100 (Fase D intacta)', () => {
      // Pago 1503 efectivo contra deuda 1160 transferencia: cubre 1503 × (1160/1002) = 1740 (>> 1160).
      // Sobrepago REAL de ~$580 en un método más barato, no un artefacto de redondeo (margen grande).
      const summary = PaymentService.buildSummary('r1', build(ITEM, 'transferencia', [
        { amount: 1503, method: 'efectivo' },
      ]));
      expect(summary.coverageAmount).toBe(1740);
      expect(summary.coveragePercent).toBe(150); // sobrepago genuino se sigue mostrando > 100
      expect(summary.coveragePercent).toBeGreaterThan(100);
      expect(summary.paymentStatus).toBe('paid');
    });
  });

  // ---------------------------------------------------------------------------
  // Fase C (carrito de pagos) — métodos disponibles derivados de pricesByType,
  // NUNCA hardcodeados. Inspecciona la llave directamente (no usa el fallback a
  // total de chargeAmount) y siempre mantiene el ancla disponible.
  // ---------------------------------------------------------------------------
  describe('deriveAvailableMethods', () => {
    it('2 servicios con los 3 métodos completos => unión completa en orden canónico', () => {
      const items = [
        { pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 } },
        { pricesByType: { efectivo: 200, transferencia: 232, tarjeta: 242 } },
      ];
      expect(PaymentService.deriveAvailableMethods(items, 'efectivo'))
        .toEqual(['efectivo', 'transferencia', 'tarjeta']);
    });

    it('es UNIÓN, no intersección: un servicio 2/3 + otro 3/3 => los 3', () => {
      const items = [
        { pricesByType: { efectivo: 100, transferencia: 116 } }, // sin tarjeta
        { pricesByType: { efectivo: 200, transferencia: 232, tarjeta: 242 } }, // completo
      ];
      expect(PaymentService.deriveAvailableMethods(items, 'efectivo'))
        .toEqual(['efectivo', 'transferencia', 'tarjeta']);
    });

    it('NaN / Infinity / string corrupto en una llave la EXCLUYEN (no es finita)', () => {
      const items = [{ pricesByType: { efectivo: 100, transferencia: NaN, tarjeta: 'corrupto' } }];
      // transferencia (NaN) y tarjeta ('corrupto') no son finitos => fuera; solo efectivo respaldado.
      expect(PaymentService.deriveAvailableMethods(items, 'efectivo')).toEqual(['efectivo']);
      const inf = [{ pricesByType: { efectivo: 100, tarjeta: Infinity } }];
      expect(PaymentService.deriveAvailableMethods(inf, 'efectivo')).toEqual(['efectivo']);
    });

    it('una llave corrupta en un servicio pero respaldada por OTRO servicio SÍ cuenta', () => {
      const items = [
        { pricesByType: { efectivo: 100, tarjeta: NaN } }, // tarjeta corrupta aquí
        { pricesByType: { efectivo: 100, tarjeta: 121 } }, // pero válida aquí
      ];
      expect(PaymentService.deriveAvailableMethods(items, 'efectivo'))
        .toEqual(['efectivo', 'tarjeta']);
    });

    it('100% legacy sin pricesByType => solo el ancla (NO los 3 por fallback a total)', () => {
      const items = [{ total: 200 }, { total: 50 }];
      expect(PaymentService.deriveAvailableMethods(items, 'efectivo')).toEqual(['efectivo']);
      expect(PaymentService.deriveAvailableMethods(items, 'tarjeta')).toEqual(['tarjeta']);
    });

    it('legacy parcial (un servicio con pricesByType + otro legacy) no reduce la unión', () => {
      const items = [
        { pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 } },
        { total: 50 }, // legacy: no aporta ni resta métodos
      ];
      expect(PaymentService.deriveAvailableMethods(items, 'efectivo'))
        .toEqual(['efectivo', 'transferencia', 'tarjeta']);
    });

    it('0 servicios => [anchoredMethod]', () => {
      expect(PaymentService.deriveAvailableMethods([], 'transferencia')).toEqual(['transferencia']);
      expect(PaymentService.deriveAvailableMethods(null, 'efectivo')).toEqual(['efectivo']);
    });

    it('includeInTotal:false NO cuenta para la unión', () => {
      const items = [{ includeInTotal: false, pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 } }];
      // El único servicio está excluido del total => solo queda el ancla.
      expect(PaymentService.deriveAvailableMethods(items, 'efectivo')).toEqual(['efectivo']);
    });

    it('CRÍTICO: el ancla SIEMPRE está presente aunque ningún servicio traiga su llave', () => {
      // Servicios solo respaldan efectivo/transferencia; ancla = tarjeta (sin respaldo en datos).
      const items = [{ pricesByType: { efectivo: 100, transferencia: 116 } }];
      const methods = PaymentService.deriveAvailableMethods(items, 'tarjeta');
      expect(methods).toContain('tarjeta'); // invariante: el ancla nunca queda fuera
      expect(methods).toEqual(['efectivo', 'transferencia', 'tarjeta']);
    });

    it('ancla corrupta (no es uno de los 3 tokens) NUNCA se inyecta', () => {
      // Con servicios que respaldan métodos: se devuelven esos, sin el token inválido.
      const withData = [{ pricesByType: { efectivo: 100, tarjeta: 121 } }];
      expect(PaymentService.deriveAvailableMethods(withData, 'bitcoin')).toEqual(['efectivo', 'tarjeta']);
    });

    it('FIX council (L0F1): ancla corrupta SIN respaldo cae a los métodos canónicos, no a lista vacía', () => {
      // Antes devolvía [] -> el guard del controller bloqueaba TODO pago para todos los roles. Ahora se
      // exponen los 3 métodos canónicos (nunca el token inválido) para no bloquear la operación real.
      const methods = PaymentService.deriveAvailableMethods([{ total: 200 }], 'bitcoin');
      expect(methods).toEqual(['efectivo', 'transferencia', 'tarjeta']);
      expect(methods).not.toContain('bitcoin');
    });

    it('llaves extra no reconocidas (oxxo) se ignoran; solo cuentan los validMethods', () => {
      const items = [{ pricesByType: { efectivo: 100, oxxo: 999 } }];
      expect(PaymentService.deriveAvailableMethods(items, 'efectivo')).toEqual(['efectivo']);
    });

    it('el orden de salida es SIEMPRE canónico, sin importar el orden de las llaves', () => {
      const items = [{ pricesByType: { tarjeta: 121, efectivo: 100, transferencia: 116 } }];
      expect(PaymentService.deriveAvailableMethods(items, 'tarjeta'))
        .toEqual(['efectivo', 'transferencia', 'tarjeta']);
    });

    it('respeta un validMethods personalizado (subconjunto + orden dado)', () => {
      const items = [{ pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 } }];
      expect(PaymentService.deriveAvailableMethods(items, 'efectivo', ['tarjeta', 'efectivo']))
        .toEqual(['tarjeta', 'efectivo']);
    });
  });

});
