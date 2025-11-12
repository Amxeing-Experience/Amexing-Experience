/**
 * PricingHelper Unit Tests
 * Tests pricing calculations, surcharge logic, and formatting functionality
 */

const pricingHelper = require('../../../src/application/utils/pricingHelper');
const SettingsService = require('../../../src/application/services/SettingsService');

// Mock SettingsService
jest.mock('../../../src/application/services/SettingsService');

describe('PricingHelper Unit Tests', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Default mock: return 21.09% surcharge
    SettingsService.prototype.getNumericValue = jest.fn().mockResolvedValue(21.09);
  });

  describe('calculateSurcharge', () => {
    it('should calculate surcharge correctly with system setting', async () => {
      const basePrice = 1000;
      const surcharge = await pricingHelper.calculateSurcharge(basePrice);

      expect(surcharge).toBe(210.9);
      expect(SettingsService.prototype.getNumericValue).toHaveBeenCalledWith(
        'paymentSurchargePercentage',
        21.09
      );
    });

    it('should calculate surcharge with custom percentage', async () => {
      const basePrice = 1000;
      const customPercentage = 15;
      const surcharge = await pricingHelper.calculateSurcharge(basePrice, customPercentage);

      expect(surcharge).toBe(150);
      // Should NOT call settings service when custom percentage provided
      expect(SettingsService.prototype.getNumericValue).not.toHaveBeenCalled();
    });

    it('should return 0 for zero base price', async () => {
      const surcharge = await pricingHelper.calculateSurcharge(0);

      expect(surcharge).toBe(0);
    });

    it('should return 0 for negative base price', async () => {
      const surcharge = await pricingHelper.calculateSurcharge(-100);

      expect(surcharge).toBe(0);
    });

    it('should round to 2 decimal places', async () => {
      const basePrice = 1234.56;
      const surcharge = await pricingHelper.calculateSurcharge(basePrice);

      // 1234.56 * 21.09% = 260.37 (rounded to 2 decimals)
      expect(surcharge).toBe(260.37);
    });
  });

  describe('calculatePriceWithSurcharge', () => {
    it('should calculate total price correctly', async () => {
      const basePrice = 2500;
      const totalPrice = await pricingHelper.calculatePriceWithSurcharge(basePrice);

      // 2500 + (2500 * 21.09%) = 2500 + 527.25 = 3027.25
      expect(totalPrice).toBe(3027.25);
    });

    it('should calculate total price with custom percentage', async () => {
      const basePrice = 2500;
      const customPercentage = 10;
      const totalPrice = await pricingHelper.calculatePriceWithSurcharge(basePrice, customPercentage);

      // 2500 + (2500 * 10%) = 2500 + 250 = 2750
      expect(totalPrice).toBe(2750);
    });
  });

  describe('getPriceBreakdown', () => {
    it('should return complete price breakdown', async () => {
      const basePrice = 2500;
      const breakdown = await pricingHelper.getPriceBreakdown(basePrice);

      expect(breakdown).toEqual({
        basePrice: 2500,
        surcharge: 527.25,
        totalPrice: 3027.25,
        surchargePercentage: 21.09
      });
    });

    it('should handle small prices correctly', async () => {
      const basePrice = 10;
      const breakdown = await pricingHelper.getPriceBreakdown(basePrice);

      expect(breakdown.basePrice).toBe(10);
      expect(breakdown.surcharge).toBe(2.11);
      expect(breakdown.totalPrice).toBe(12.11);
      expect(breakdown.surchargePercentage).toBe(21.09);
    });

    it('should handle large prices correctly', async () => {
      const basePrice = 100000;
      const breakdown = await pricingHelper.getPriceBreakdown(basePrice);

      expect(breakdown.basePrice).toBe(100000);
      expect(breakdown.surcharge).toBe(21090);
      expect(breakdown.totalPrice).toBe(121090);
      expect(breakdown.surchargePercentage).toBe(21.09);
    });
  });

  describe('calculateBasePriceFromTotal', () => {
    it('should calculate base price from total price', async () => {
      const totalPrice = 3027.25;
      const basePrice = await pricingHelper.calculateBasePriceFromTotal(totalPrice);

      // 3027.25 / (1 + 0.2109) = 3027.25 / 1.2109 = 2500
      expect(basePrice).toBe(2500);
    });

    it('should work with custom percentage', async () => {
      const totalPrice = 2750;
      const customPercentage = 10;
      const basePrice = await pricingHelper.calculateBasePriceFromTotal(totalPrice, customPercentage);

      // 2750 / (1 + 0.10) = 2750 / 1.10 = 2500
      expect(basePrice).toBe(2500);
    });

    it('should be inverse of calculatePriceWithSurcharge', async () => {
      const originalBasePrice = 2500;

      // Forward calculation
      const totalPrice = await pricingHelper.calculatePriceWithSurcharge(originalBasePrice);

      // Reverse calculation
      const calculatedBasePrice = await pricingHelper.calculateBasePriceFromTotal(totalPrice);

      expect(calculatedBasePrice).toBe(originalBasePrice);
    });
  });

  describe('formatMXN', () => {
    it('should format Mexican pesos correctly', () => {
      const formatted = pricingHelper.formatMXN(3027.25);

      expect(formatted).toMatch(/\$3,027\.25/);
    });

    it('should format zero correctly', () => {
      const formatted = pricingHelper.formatMXN(0);

      expect(formatted).toMatch(/\$0\.00/);
    });

    it('should format large numbers with commas', () => {
      const formatted = pricingHelper.formatMXN(1234567.89);

      expect(formatted).toMatch(/\$1,234,567\.89/);
    });

    it('should handle null/undefined as zero', () => {
      const formatted = pricingHelper.formatMXN(null);

      expect(formatted).toMatch(/\$0\.00/);
    });
  });

  describe('formatNumber', () => {
    it('should format number with 2 decimals', () => {
      const formatted = pricingHelper.formatNumber(3027.25);

      expect(formatted).toBe('3,027.25');
    });

    it('should add decimal places if needed', () => {
      const formatted = pricingHelper.formatNumber(1000);

      expect(formatted).toBe('1,000.00');
    });
  });

  describe('getBulkPriceBreakdown', () => {
    it('should calculate breakdowns for multiple items', async () => {
      const items = [
        { id: 1, name: 'Service A', price: 2500 },
        { id: 2, name: 'Service B', price: 3500 },
        { id: 3, name: 'Service C', price: 1500 }
      ];

      const breakdowns = await pricingHelper.getBulkPriceBreakdown(items);

      expect(breakdowns).toHaveLength(3);
      expect(breakdowns[0].basePrice).toBe(2500);
      expect(breakdowns[1].basePrice).toBe(3500);
      expect(breakdowns[2].basePrice).toBe(1500);

      // Verify all have surcharge calculated
      breakdowns.forEach(breakdown => {
        expect(breakdown.surcharge).toBeGreaterThan(0);
        expect(breakdown.totalPrice).toBeGreaterThan(breakdown.basePrice);
      });
    });

    it('should use same percentage for all items', async () => {
      const items = [
        { price: 1000 },
        { price: 2000 }
      ];

      const breakdowns = await pricingHelper.getBulkPriceBreakdown(items);

      expect(breakdowns[0].surchargePercentage).toBe(21.09);
      expect(breakdowns[1].surchargePercentage).toBe(21.09);
    });
  });

  describe('getCurrentSurchargePercentage', () => {
    it('should retrieve current surcharge percentage', async () => {
      const percentage = await pricingHelper.getCurrentSurchargePercentage();

      expect(percentage).toBe(21.09);
      expect(SettingsService.prototype.getNumericValue).toHaveBeenCalledWith(
        'paymentSurchargePercentage',
        21.09
      );
    });
  });

  describe('clearCache', () => {
    it('should call SettingsService clearCache', () => {
      SettingsService.prototype.clearCache = jest.fn();

      pricingHelper.clearCache();

      expect(SettingsService.prototype.clearCache).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle decimal base prices', async () => {
      const basePrice = 2500.99;
      const breakdown = await pricingHelper.getPriceBreakdown(basePrice);

      expect(breakdown.basePrice).toBe(2500.99);
      expect(breakdown.surcharge).toBeGreaterThan(0);
      expect(breakdown.totalPrice).toBeGreaterThan(basePrice);
    });

    it('should handle very small surcharge percentages', async () => {
      const basePrice = 1000;
      const customPercentage = 0.01; // 0.01%
      const surcharge = await pricingHelper.calculateSurcharge(basePrice, customPercentage);

      expect(surcharge).toBe(0.1);
    });

    it('should handle 100% surcharge', async () => {
      const basePrice = 1000;
      const customPercentage = 100;
      const surcharge = await pricingHelper.calculateSurcharge(basePrice, customPercentage);

      expect(surcharge).toBe(1000);
    });
  });
});
