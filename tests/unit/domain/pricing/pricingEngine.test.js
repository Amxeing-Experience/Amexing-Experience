/**
 * PricingEngine — tests golden / caracterización.
 *
 * Congelan el comportamiento ACTUAL del cálculo de cotizaciones para poder
 * refactorizar el builder sin cambiar los números (la red de seguridad de la Fase 0).
 * Los valores esperados se derivaron de las fórmulas reales en:
 *   - public/dashboard/js/utils/pricing-utils.js (applyUSDRoundingRules/applyCashRounding/applyPaymentRate)
 *   - public/dashboards/admin/sections/quote-services-v2.js (getDisplayPrice, calculateADisposicionPricing, getADisposicionDiscount)
 *   - src/application/utils/pricingHelper.js (applyGreeterRounding)
 *
 * @author Denisse Maldonado
 */

const PricingEngine = require('../../../../src/domain/pricing/pricingEngine');

describe('PricingEngine — primitivos puros', () => {
  describe('applyUSDRoundingRules', () => {
    it('sube al múltiplo de 5 si el resto > 2.7', () => {
      expect(PricingEngine.applyUSDRoundingRules(23.45)).toBe(25); // resto 3.45 > 2.7
      expect(PricingEngine.applyUSDRoundingRules(27.8)).toBe(30); // resto 2.8 > 2.7
    });
    it('baja al múltiplo de 5 si el resto ≤ 2.7', () => {
      expect(PricingEngine.applyUSDRoundingRules(26.2)).toBe(25); // resto 1.2 ≤ 2.7
      expect(PricingEngine.applyUSDRoundingRules(47.619)).toBe(45); // resto 2.619 ≤ 2.7
    });
    it('mantiene múltiplos exactos de 5', () => {
      expect(PricingEngine.applyUSDRoundingRules(50)).toBe(50);
      expect(PricingEngine.applyUSDRoundingRules(55.55)).toBe(55);
    });
  });

  describe('applyCashRounding', () => {
    it('decimal ≤ 0.50 baja al múltiplo de 5', () => {
      expect(PricingEngine.applyCashRounding(17.0)).toBe(15);
      expect(PricingEngine.applyCashRounding(17.3)).toBe(15);
      expect(PricingEngine.applyCashRounding(22.5)).toBe(20);
    });
    it('decimal > 0.50 sube al múltiplo de 5', () => {
      expect(PricingEngine.applyCashRounding(17.6)).toBe(20);
      expect(PricingEngine.applyCashRounding(22.51)).toBe(25);
    });
  });

  describe('applyPaymentRate', () => {
    it('transferencia aplica transferRate', () => {
      expect(PricingEngine.applyPaymentRate(100, 'transferencia', 3, 5)).toBeCloseTo(103, 5);
    });
    it('tarjeta aplica agencyRate', () => {
      expect(PricingEngine.applyPaymentRate(100, 'tarjeta', 3, 5)).toBeCloseTo(105, 5);
    });
    it('efectivo no cambia el precio', () => {
      expect(PricingEngine.applyPaymentRate(100, 'efectivo', 3, 5)).toBe(100);
    });
  });

  describe('applyGreeterRounding', () => {
    it('últimos 2 dígitos < 50 baja a la centena', () => {
      expect(PricingEngine.applyGreeterRounding(1049)).toBe(1000);
    });
    it('últimos 2 dígitos ≥ 50 sube a la centena', () => {
      expect(PricingEngine.applyGreeterRounding(1050)).toBe(1100);
    });
    it('múltiplos exactos de 100 se mantienen', () => {
      expect(PricingEngine.applyGreeterRounding(1100)).toBe(1100);
    });
  });
});

describe('PricingEngine — applyDisplayPrice (orden canónico, sin DOM)', () => {
  it('efectivo + MXN aplica redondeo a efectivo', () => {
    expect(PricingEngine.applyDisplayPrice(17.3, { paymentType: 'efectivo', currency: 'MXN' })).toBe(15);
  });
  it('efectivo + MXN sin redondeo cuando cashRoundingEnabled=false', () => {
    expect(PricingEngine.applyDisplayPrice(17.3, { paymentType: 'efectivo', currency: 'MXN', cashRoundingEnabled: false })).toBe(17.3);
  });
  it('transferencia aplica recargo, sin redondeo a efectivo', () => {
    expect(PricingEngine.applyDisplayPrice(1000, { paymentType: 'transferencia', transferRate: 3 })).toBeCloseTo(1030, 5);
  });
  it('tarjeta aplica recargo de agencia', () => {
    expect(PricingEngine.applyDisplayPrice(1000, { paymentType: 'tarjeta', agencyRate: 5 })).toBeCloseTo(1050, 5);
  });
  it('USD convierte y aplica redondeo USD (no aplica redondeo a efectivo)', () => {
    expect(PricingEngine.applyDisplayPrice(1000, { paymentType: 'efectivo', currency: 'USD', exchangeRate: 21 })).toBe(45); // 1000/21=47.61 → 45
    expect(PricingEngine.applyDisplayPrice(1000, { paymentType: 'efectivo', currency: 'USD', exchangeRate: 18 })).toBe(55); // 1000/18=55.55 → 55
  });
});

describe('PricingEngine — getADisposicionDiscount (tiers por volumen)', () => {
  it.each([
    [16, 10],
    [20, 10],
    [12, 7.5],
    [10, 5],
    [8, 2.5],
    [7, 0],
    [0, 0],
  ])('hours=%i → %p%%', (hours, expected) => {
    expect(PricingEngine.getADisposicionDiscount(hours)).toBe(expected);
  });
});

describe('PricingEngine — calculateADisposicion (desglose completo)', () => {
  it('efectivo MXN, 8h × 2 vehículos, aplica descuento de 2.5%', () => {
    const r = PricingEngine.calculateADisposicion({
      baseVehicleCostPerHour: 500,
      hours: 8,
      vehicleQuantity: 2,
      guideRate: 0,
      paymentType: 'efectivo',
      currency: 'MXN',
    });
    expect(r.baseVehicleTotal).toBe(8000);
    expect(r.vehicleTotalWithSurcharge).toBe(8000);
    expect(r.guideTotalCost).toBe(0);
    expect(r.baseTotal).toBe(8000);
    expect(r.discountAmount).toBe(200); // 8000 × 2.5%
    expect(r.subtotal).toBe(7800);
    expect(r.finalTotal).toBe(7800);
    expect(r.hourlyRatePerVehicle).toBe(500);
  });

  it('transferencia, 10h × 2 vehículos: descuento 5% sobre el total CON recargo (515)', () => {
    const r = PricingEngine.calculateADisposicion({
      baseVehicleCostPerHour: 500,
      hours: 10,
      vehicleQuantity: 2,
      guideRate: 0,
      paymentType: 'transferencia',
      transferRate: 3,
      currency: 'MXN',
    });
    expect(r.baseVehicleTotal).toBe(10000);
    expect(r.vehicleTotalWithSurcharge).toBe(10300); // 10000 × 1.03
    expect(r.discountAmount).toBe(515); // 5% de 10,300 (total CON recargo), no de 10,000
    expect(r.subtotal).toBe(9785); // 10,300 − 515
    expect(r.finalTotal).toBe(9785);
  });

  it('transferencia con guía, 4h × 1 vehículo, sin descuento (<8h)', () => {
    const r = PricingEngine.calculateADisposicion({
      baseVehicleCostPerHour: 500,
      hours: 4,
      vehicleQuantity: 1,
      guideRate: 100,
      paymentType: 'transferencia',
      transferRate: 3,
      currency: 'MXN',
    });
    expect(r.baseVehicleTotal).toBe(2000);
    expect(r.vehicleTotalWithSurcharge).toBe(2060); // 2000 × 1.03
    expect(r.guideTotalCost).toBe(412); // guía CON recargo: 400 × 1.03 (regla uniforme)
    expect(r.baseTotal).toBe(2472); // 2060 + 412
    expect(r.discountAmount).toBe(0);
    expect(r.subtotal).toBe(2472);
    expect(r.hourlyRatePerVehicle).toBe(515); // 2060 / 4
  });

  it('greeter add-on: recibe recargo y se suma después (transferencia, 4h)', () => {
    const r = PricingEngine.calculateADisposicion({
      baseVehicleCostPerHour: 500,
      hours: 4,
      vehicleQuantity: 1,
      guideRate: 0,
      greeterCost: 1720, // base en efectivo (base 760 + 640×1.5, etc.)
      paymentType: 'transferencia',
      transferRate: 3,
      currency: 'MXN',
    });
    expect(r.vehicleTotalWithSurcharge).toBe(2060); // 2000 × 1.03
    expect(r.greeterTotalCost).toBeCloseTo(1771.6, 4); // 1720 × 1.03 (con recargo)
    expect(r.discountAmount).toBe(0);
    expect(r.subtotal).toBeCloseTo(3831.6, 4); // 2060 + 1771.6
  });

  it('greeter NO entra en el descuento por volumen (8h, descuento solo a vehículo+guía)', () => {
    const r = PricingEngine.calculateADisposicion({
      baseVehicleCostPerHour: 500,
      hours: 8,
      vehicleQuantity: 2,
      guideRate: 0,
      greeterCost: 1720,
      paymentType: 'efectivo',
      currency: 'MXN',
    });
    expect(r.baseVehicleTotal).toBe(8000);
    expect(r.discountAmount).toBe(200); // 2.5% de 8000 (NO de 9720)
    expect(r.greeterTotalCost).toBe(1720); // efectivo: sin recargo
    expect(r.subtotal).toBe(9520); // 8000 − 200 + 1720
  });

  it('vehículos adicionales entran al descuento (8h, efectivo)', () => {
    const r = PricingEngine.calculateADisposicion({
      baseVehicleCostPerHour: 500,
      hours: 8,
      vehicleQuantity: 1,
      guideRate: 0,
      additionalVehiclesCost: 2400, // efectivo ya sumado: 300/h × 8h
      paymentType: 'efectivo',
      currency: 'MXN',
    });
    expect(r.vehicleTotalWithSurcharge).toBe(4000);
    expect(r.additionalVehiclesTotal).toBe(2400);
    expect(r.baseTotal).toBe(6400); // 4000 + 0 + 2400
    expect(r.discountAmount).toBe(160); // 2.5% de 6400 (incluye adicionales)
    expect(r.subtotal).toBe(6240); // 6400 − 160
  });
});

describe('PricingEngine — IVA / totales', () => {
  it('calcula IVA al 16% por defecto', () => {
    expect(PricingEngine.calcIVA(7800)).toBe(1248);
  });
  it('total = subtotal + IVA', () => {
    expect(PricingEngine.calcTotalWithIVA(7800)).toBe(9048);
  });
  it('permite tasa de IVA configurable', () => {
    expect(PricingEngine.calcIVA(1000, 0.08)).toBe(80);
  });
});

describe('PricingEngine — greeter (calculateGreeterPrice)', () => {
  it('precio = base + porHora × horas', () => {
    // 1.5h con base 760 + 640/h → 760 + 960 = 1720 (idéntico a calculateGreeterPrice del builder)
    expect(PricingEngine.calculateGreeterPrice({ durationMinutes: 90, basePrice: 760, hourlyRate: 640 })).toBe(1720);
  });
  it('duración 0 o inválida devuelve la tarifa base', () => {
    expect(PricingEngine.calculateGreeterPrice({ durationMinutes: 0, basePrice: 760, hourlyRate: 640 })).toBe(760);
    expect(PricingEngine.calculateGreeterPrice({ durationMinutes: -10, basePrice: 760, hourlyRate: 640 })).toBe(760);
  });
});

describe('PricingEngine — guía/chofer (calculateGuideTransportCost)', () => {
  it('fórmula simple: horas × multiplicador × tarifa', () => {
    // 1.5h × 2 × 400 = 1200 (idéntico a la fórmula simple del builder)
    expect(PricingEngine.calculateGuideTransportCost({
      durationMinutes: 90, guideRate: 400, roundTripMultiplier: 2, minimumCharge: 0,
    })).toBe(1200);
  });
  it('respeta el cargo mínimo', () => {
    expect(PricingEngine.calculateGuideTransportCost({
      durationMinutes: 90, guideRate: 400, roundTripMultiplier: 2, minimumCharge: 1500,
    })).toBe(1500);
  });
  it('usa componentsCost cuando viene del evaluador avanzado', () => {
    expect(PricingEngine.calculateGuideTransportCost({
      durationMinutes: 90, guideRate: 400, componentsCost: 999, minimumCharge: 0,
    })).toBe(999);
    // componentsCost también respeta el mínimo
    expect(PricingEngine.calculateGuideTransportCost({
      durationMinutes: 90, guideRate: 400, componentsCost: 999, minimumCharge: 1200,
    })).toBe(1200);
  });
  it('duración 0 devuelve 0', () => {
    expect(PricingEngine.calculateGuideTransportCost({
      durationMinutes: 0, guideRate: 400, roundTripMultiplier: 2,
    })).toBe(0);
  });
});

describe('PricingEngine — composición de nodos (composeServiceNodes)', () => {
  const RATES = { transferRate: 3, agencyRate: 5 };

  it('vehículo solo: recarga transferencia/tarjeta, sin otros nodos', () => {
    const r = PricingEngine.composeServiceNodes({
      ...RATES,
      nodes: [{ key: 'vehicle', efectivo: 3000, surcharge: true }],
    });
    expect(r.efectivo).toBeCloseTo(3000, 6);
    expect(r.transferencia).toBeCloseTo(3090, 6); // 3000 × 1.03
    expect(r.tarjeta).toBeCloseTo(3150, 6); // 3000 × 1.05
  });

  it('el flag surcharge:false deja el nodo sin recargo (primitivo del compositor)', () => {
    // El compositor es genérico y respeta el flag; sirve para verificar la mecánica.
    const r = PricingEngine.composeServiceNodes({
      ...RATES,
      nodes: [{ key: 'x', efectivo: 1200, surcharge: false }],
    });
    expect(r.nodes.x.transferencia).toBe(1200);
    expect(r.nodes.x.tarjeta).toBe(1200);
  });

  it('composición completa con regla uniforme: TODOS los nodos reciben recargo', () => {
    // Regla de negocio actual: guía y greeter también reciben recargo (surcharge:true).
    const r = PricingEngine.composeServiceNodes({
      ...RATES,
      nodes: [
        { key: 'vehicle', efectivo: 1000, surcharge: true },
        { key: 'waiting', efectivo: 200, surcharge: true },
        { key: 'guide', efectivo: 1200, surcharge: true },
        { key: 'greeter', efectivo: 1720, surcharge: true },
        { key: 'additionalVehicle', efectivo: 500, surcharge: true },
        { key: 'extraVehicles', efectivo: 0, surcharge: true },
      ],
    });
    // efectivo = 4620 → transferencia = 4620×1.03, tarjeta = 4620×1.05
    expect(r.efectivo).toBeCloseTo(4620, 6);
    expect(r.transferencia).toBeCloseTo(4758.6, 6);
    expect(r.tarjeta).toBeCloseTo(4851, 6);
    // guía y greeter ahora SÍ cambian con la forma de pago
    expect(r.nodes.guide.transferencia).toBeCloseTo(1236, 6);
    expect(r.nodes.greeter.tarjeta).toBeCloseTo(1806, 6);
  });

  it('el total equivale a sumar los nodos por forma de pago (paridad con el builder)', () => {
    const nodes = [
      { key: 'vehicle', efectivo: 1234.5, surcharge: true },
      { key: 'waiting', efectivo: 321, surcharge: true },
      { key: 'guide', efectivo: 980, surcharge: false },
      { key: 'greeter', efectivo: 1720, surcharge: false },
      { key: 'additionalVehicle', efectivo: 650, surcharge: true },
      { key: 'extraVehicles', efectivo: 410, surcharge: true },
    ];
    const r = PricingEngine.composeServiceNodes({ ...RATES, nodes });
    // Referencia: misma suma que hace el builder hoy (nodo a nodo).
    const ref = nodes.reduce((acc, n) => {
      acc.efectivo += n.efectivo;
      acc.transferencia += n.surcharge ? n.efectivo * 1.03 : n.efectivo;
      acc.tarjeta += n.surcharge ? n.efectivo * 1.05 : n.efectivo;
      return acc;
    }, { efectivo: 0, transferencia: 0, tarjeta: 0 });
    expect(r.efectivo).toBeCloseTo(ref.efectivo, 6);
    expect(r.transferencia).toBeCloseTo(ref.transferencia, 6);
    expect(r.tarjeta).toBeCloseTo(ref.tarjeta, 6);
  });
});
