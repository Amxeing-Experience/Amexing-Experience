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
    expect(r.guideTotalCost).toBe(400); // guía sin recargo
    expect(r.baseTotal).toBe(2460);
    expect(r.discountAmount).toBe(0);
    expect(r.subtotal).toBe(2460);
    expect(r.hourlyRatePerVehicle).toBe(515); // 2060 / 4
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
