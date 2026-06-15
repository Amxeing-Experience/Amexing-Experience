/**
 * PricingHelper - Centralized pricing calculations for AmexingWeb.
 *
 * Provides consistent surcharge calculations and price formatting across
 * the entire application. Integrates with SettingsService to retrieve
 * the configurable surcharge percentage for non-cash payment methods.
 *
 * Key Concepts:
 * - Base Price (Precio Efectivo): Original price for cash payments
 * - Surcharge: Additional percentage for non-cash payment methods (cards, digital wallets)
 * - Total Price (Precio Base): Base price + surcharge (displayed prominently).
 *
 * Legal Terminology:
 * - "Precio efectivo" = Cash discount price (legally correct term)
 * - "Precio base" = Standard price with surcharge included
 * - Cannot legally charge "commission fees", but CAN offer "cash discounts".
 *
 * Usage:
 * - Import as singleton: `const pricingHelper = require('./pricingHelper');`
 * - Used in: DataTables, QuoteController, Invoices, Reports, etc.
 * - Automatic surcharge retrieval from Settings table.
 * @module pricingHelper
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * const pricingHelper = require('../utils/pricingHelper');
 *
 * // Get price breakdown
 * const breakdown = await pricingHelper.getPriceBreakdown(2500);
 * // Returns: {
 * //   basePrice: 2500.00,
 * //   surcharge: 527.25,
 * //   totalPrice: 3027.25,
 * //   surchargePercentage: 21.09
 * // }
 *
 * // Format for display
 * const formatted = pricingHelper.formatMXN(3027.25);
 * // Returns: "$3,027.25"
 */

const SettingsService = require('../services/SettingsService');
const GreeterRate = require('../../domain/models/GreeterRate');
const logger = require('../../infrastructure/logger');
// Motor de cálculo puro e isomórfico: única fuente de verdad para el cálculo de
// cotizaciones (mismas fórmulas en front y back). pricingHelper delega aquí en
// lugar de duplicar la lógica.
const pricingEngine = require('../../domain/pricing/pricingEngine');

/**
 * PricingHelper class - Singleton for pricing calculations.
 */
class PricingHelper {
  constructor() {
    this.settingsService = new SettingsService();

    // Default surcharge percentage (fallback if setting not found)
    this.defaultSurchargePercentage = 21.09;

    // Setting key for surcharge percentage
    this.surchargeSettingKey = 'paymentSurchargePercentage';

    // Greeter rate caching
    this.greeterRateCache = null;
    this.greeterRateCacheTime = null;
    this.greeterRateCacheDuration = 5 * 60 * 1000; // 5 minutes cache
  }

  // ============================================================
  // SURCHARGE CALCULATIONS
  // ============================================================

  /**
   * Calculate surcharge amount for a base price.
   * @param {number} basePrice - Base price (cash price) before surcharge.
   * @param {number|null} surchargePercentage - Optional surcharge percentage override.
   * @returns {Promise<number>} Surcharge amount rounded to 2 decimals.
   * @example
   * // Using system setting
   * const surcharge = await pricingHelper.calculateSurcharge(2500);
   * // Returns: 527.25 (if system setting is 21.09%)
   *
   * // Using custom percentage
   * const surcharge = await pricingHelper.calculateSurcharge(2500, 15);
   * // Returns: 375.00 (15% of 2500)
   */
  async calculateSurcharge(basePrice, surchargePercentage = null) {
    // Validate base price
    if (!basePrice || basePrice <= 0) {
      logger.debug('Base price is zero or negative, returning zero surcharge', {
        basePrice,
      });
      return 0;
    }

    try {
      // Get percentage (use override or fetch from settings)
      const percentage = surchargePercentage !== null
        ? surchargePercentage
        : await this.settingsService.getNumericValue(this.surchargeSettingKey, this.defaultSurchargePercentage);

      // Calculate surcharge
      const surcharge = (basePrice * percentage) / 100;

      // Round to 2 decimal places
      const rounded = Math.round(surcharge * 100) / 100;

      logger.debug('Surcharge calculated', {
        basePrice,
        percentage,
        surcharge: rounded,
      });

      return rounded;
    } catch (error) {
      logger.error('Error calculating surcharge', {
        basePrice,
        surchargePercentage,
        error: error.message,
      });

      // Fallback to default percentage on error
      const fallbackSurcharge = (basePrice * this.defaultSurchargePercentage) / 100;
      return Math.round(fallbackSurcharge * 100) / 100;
    }
  }

  /**
   * Calculate price with surcharge applied.
   * @param {number} basePrice - Base price (cash price) before surcharge.
   * @param {number|null} surchargePercentage - Optional surcharge percentage override.
   * @returns {Promise<number>} Total price (base + surcharge) rounded to 2 decimals.
   * @example
   * const totalPrice = await pricingHelper.calculatePriceWithSurcharge(2500);
   * // Returns: 3027.25 (if surcharge is 21.09%)
   */
  async calculatePriceWithSurcharge(basePrice, surchargePercentage = null) {
    const surcharge = await this.calculateSurcharge(basePrice, surchargePercentage);
    const total = basePrice + surcharge;

    // Round to 2 decimal places
    const rounded = Math.round(total * 100) / 100;

    return rounded;
  }

  /**
   * Get comprehensive price breakdown with all components.
   * @param {number} basePrice - Base price (cash price) before surcharge.
   * @param {number|null} surchargePercentage - Optional surcharge percentage override.
   * @returns {Promise<object>} Price breakdown object.
   * @property {number} basePrice - Original base price (cash discount price).
   * @property {number} surcharge - Calculated surcharge amount.
   * @property {number} totalPrice - Total price with surcharge (standard display price).
   * @property {number} surchargePercentage - Percentage used for calculation.
   * @example
   * const breakdown = await pricingHelper.getPriceBreakdown(2500);
   * // Returns: {
   * //   basePrice: 2500.00,
   * //   surcharge: 527.25,
   * //   totalPrice: 3027.25,
   * //   surchargePercentage: 21.09
   * // }
   */
  async getPriceBreakdown(basePrice, surchargePercentage = null) {
    try {
      // Get percentage (use override or fetch from settings)
      const percentage = surchargePercentage !== null
        ? surchargePercentage
        : await this.settingsService.getNumericValue(this.surchargeSettingKey, this.defaultSurchargePercentage);

      const surcharge = await this.calculateSurcharge(basePrice, percentage);
      const totalPrice = basePrice + surcharge;

      return {
        basePrice: Math.round(basePrice * 100) / 100,
        surcharge: Math.round(surcharge * 100) / 100,
        totalPrice: Math.round(totalPrice * 100) / 100,
        surchargePercentage: percentage,
      };
    } catch (error) {
      logger.error('Error getting price breakdown', {
        basePrice,
        surchargePercentage,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Calculate multiple price breakdowns for a list of items.
   * @param {Array<{price: number}>} items - Array of items with price property.
   * @param {number|null} surchargePercentage - Optional surcharge percentage override.
   * @returns {Promise<Array<object>>} Array of price breakdowns.
   * @example
   * const items = [
   *   { id: 1, name: 'Service A', price: 2500 },
   *   { id: 2, name: 'Service B', price: 3500 }
   * ];
   * const breakdowns = await pricingHelper.getBulkPriceBreakdown(items);
   */
  async getBulkPriceBreakdown(items, surchargePercentage = null) {
    const percentage = surchargePercentage !== null
      ? surchargePercentage
      : await this.settingsService.getNumericValue(this.surchargeSettingKey, this.defaultSurchargePercentage);

    return Promise.all(items.map((item) => this.getPriceBreakdown(item.price, percentage)));
  }

  // ============================================================
  // GREETER PRICING CALCULATIONS
  // ============================================================

  /**
   * Get current greeter rate configuration with caching.
   * @returns {Promise<object>} Greeter rate configuration with basePrice and hourlyRate.
   * @example
   * const config = await pricingHelper.getCurrentGreeterRate();
   * // Returns: { basePrice: 760, hourlyRate: 640 }
   */
  async getCurrentGreeterRate() {
    // Check if cache is still valid
    const now = Date.now();
    if (this.greeterRateCache
        && this.greeterRateCacheTime
        && (now - this.greeterRateCacheTime) < this.greeterRateCacheDuration) {
      return this.greeterRateCache;
    }

    try {
      // Fetch current greeter rate from database
      const currentRate = await GreeterRate.getCurrentRate();

      if (currentRate) {
        this.greeterRateCache = {
          basePrice: currentRate.get('basePrice') || 760,
          hourlyRate: currentRate.get('hourlyRate') || 640,
        };
      } else {
        // Fallback to default values
        this.greeterRateCache = {
          basePrice: 760,
          hourlyRate: 640,
        };
      }

      this.greeterRateCacheTime = now;

      logger.debug('Greeter rate configuration loaded', {
        cached: this.greeterRateCache,
        cacheTime: this.greeterRateCacheTime,
      });

      return this.greeterRateCache;
    } catch (error) {
      logger.error('Failed to load greeter rate configuration, using fallback', {
        error: error.message,
      });

      // Return fallback values on error
      const fallback = { basePrice: 760, hourlyRate: 640 };
      this.greeterRateCache = fallback;
      this.greeterRateCacheTime = now;

      return fallback;
    }
  }

  /**
   * Calculate greeter service price based on duration using configurable rates.
   * Formula: basePrice + (hourlyRate * duration)
   * Note: Special rounding is now applied to final service totals, not individual greeter calculations.
   * @param {number} duration - Duration in hours (can be decimal).
   * @returns {Promise<number>} Calculated greeter price (unrounded).
   * @example
   * const price = await pricingHelper.calculateGreeterPrice(0.5);
   * // Uses current configured rates, e.g.: 760 + (640 * 0.5) = 1080 (unrounded)
   */
  async calculateGreeterPrice(duration) {
    // Get current greeter configuration
    const config = await this.getCurrentGreeterRate();
    const { basePrice, hourlyRate } = config;

    // Validate duration
    if (!duration || duration <= 0) {
      logger.debug('Duration is zero or negative, returning base greeter price', {
        duration,
        basePrice,
      });
      return basePrice;
    }

    // Calculate final price using configurable formula (no special rounding applied here)
    const finalPrice = basePrice + (hourlyRate * duration);

    logger.debug('Greeter price calculated with configurable rates (unrounded)', {
      duration,
      basePrice,
      hourlyRate,
      finalPrice,
    });

    return finalPrice;
  }

  /**
   * Apply greeter-specific rounding rules to any price.
   * If last two digits < 50, round down to nearest 100; otherwise round up.
   * @param {number} price - Price to round.
   * @returns {number} Rounded price.
   * @example
   * pricingHelper.applyGreeterRounding(1049); // Returns: 1000
   * pricingHelper.applyGreeterRounding(1050); // Returns: 1100
   * pricingHelper.applyGreeterRounding(1100); // Returns: 1100
   */
  applyGreeterRounding(price) {
    // Delegado al motor único (misma fórmula).
    return pricingEngine.applyGreeterRounding(price);
  }

  // ============================================================
  // CURRENCY ROUNDING UTILITIES
  // ============================================================

  /**
   * Apply standardized USD rounding rules across all admin components.
   * Uses sophisticated multiple-of-5 based rounding with special conditions.
   *
   * Rules:
   * - All prices rounded to nearest multiple of 5
   * - Numbers ending in 3 or 8 (before decimal) round UP to next multiple of 5
   * - For remainders: ≤2.7 rounds down, >2.7 rounds up.
   * @param {number} usdPrice - USD price to round.
   * @returns {number} Rounded USD price.
   * @example
   * pricingHelper.applyUSDRoundingRules(23.45); // Returns: 25 (ends in 3, rounds up)
   * pricingHelper.applyUSDRoundingRules(26.2);  // Returns: 25 (remainder 1.2 ≤ 2.7)
   * pricingHelper.applyUSDRoundingRules(27.8);  // Returns: 30 (remainder 2.8 > 2.7)
   */
  applyUSDRoundingRules(usdPrice) {
    // Delegado al motor único (misma fórmula).
    return pricingEngine.applyUSDRoundingRules(usdPrice);
  }

  // ============================================================
  // CÁLCULO CANÓNICO DE COTIZACIONES (delegado al motor puro)
  // ============================================================

  /**
   * Precio mostrado para una forma de pago, con el RATE pasado por parámetro
   * (no hardcodeado). Modelo del builder: efectivo / transferencia (`transferRate`) /
   * tarjeta (`agencyRate`), con conversión USD opcional. Misma lógica que el front.
   * @param {number} basePrice - Precio base en MXN.
   * @param {object} [opts] - { paymentType, currency, transferRate, agencyRate, exchangeRate, cashRoundingEnabled }.
   * @returns {number} Precio mostrado en la moneda pedida.
   * @example
   * pricingHelper.getDisplayPrice(1000, { paymentType: 'transferencia', transferRate: 3 }); // 1030
   */
  getDisplayPrice(basePrice, opts = {}) {
    return pricingEngine.applyDisplayPrice(basePrice, opts);
  }

  /**
   * Descuento por volumen de A-Disposición según horas.
   * @param {number} hours
   * @returns {number} Porcentaje de descuento.
   */
  getADisposicionDiscount(hours) {
    return pricingEngine.getADisposicionDiscount(hours);
  }

  /**
   * Cálculo completo de A-Disposición con los rates por parámetro (no hardcodeados).
   * @param {object} params - ver pricingEngine.calculateADisposicion.
   * @returns {object} Desglose completo.
   */
  calculateADisposicion(params) {
    return pricingEngine.calculateADisposicion(params);
  }

  /**
   * IVA de un subtotal (tasa configurable, default 16%).
   * @param {number} subtotal
   * @param {number} [ivaRate]
   * @returns {number}
   */
  calcIVA(subtotal, ivaRate) {
    return pricingEngine.calcIVA(subtotal, ivaRate);
  }

  /**
   * Subtotal + IVA.
   * @param {number} subtotal
   * @param {number} [ivaRate]
   * @returns {number}
   */
  calcTotalWithIVA(subtotal, ivaRate) {
    return pricingEngine.calcTotalWithIVA(subtotal, ivaRate);
  }

  // ============================================================
  // FORMATTING UTILITIES
  // ============================================================

  /**
   * Format price in Mexican pesos (MXN).
   * @param {number} amount - Amount to format.
   * @returns {string} Formatted price string (e.g., "$10,000.00").
   * @example
   * const formatted = pricingHelper.formatMXN(3027.25);
   * // Returns: "$3,027.25"
   */
  formatMXN(amount) {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
    }).format(amount || 0);
  }

  /**
   * Format price without currency symbol (for calculations/display).
   * @param {number} amount - Amount to format.
   * @returns {string} Formatted number string (e.g., "10,000.00").
   * @example
   * const formatted = pricingHelper.formatNumber(3027.25);
   * // Returns: "3,027.25"
   */
  formatNumber(amount) {
    return new Intl.NumberFormat('es-MX', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount || 0);
  }

  /**
   * Format price breakdown as HTML for display in DataTables.
   * @param {number} basePrice - Base price (cash price).
   * @param {number|null} surchargePercentage - Optional surcharge percentage override.
   * @returns {Promise<string>} HTML string with formatted price breakdown.
   * @example
   * const html = await pricingHelper.formatPriceBreakdownHTML(2500);
   * // Returns HTML with:
   * // - Small muted text: "Efectivo: $2,500.00"
   * // - Large bold green: "$3,027.25"
   * // - Tiny muted text: "+21.09% otros métodos"
   */
  async formatPriceBreakdownHTML(basePrice, surchargePercentage = null) {
    const breakdown = await this.getPriceBreakdown(basePrice, surchargePercentage);

    return `
      <div class="price-breakdown">
        <div class="base-price text-muted" style="font-size: 0.875rem;">
          <small>Efectivo: ${this.formatMXN(breakdown.basePrice)}</small>
        </div>
        <div class="total-price fw-bold text-success" style="font-size: 1.1rem;">
          ${this.formatMXN(breakdown.totalPrice)}
        </div>
        <div class="surcharge-info text-muted" style="font-size: 0.75rem;">
          <small>+${breakdown.surchargePercentage}% otros métodos de pago</small>
        </div>
      </div>
    `.trim();
  }

  /**
   * Format price breakdown as plain object for JSON responses.
   * @param {number} basePrice - Base price (cash price).
   * @param {number|null} surchargePercentage - Optional surcharge percentage override.
   * @returns {Promise<object>} Formatted price breakdown object.
   * @example
   * const formatted = await pricingHelper.formatPriceBreakdownJSON(2500);
   * // Returns: {
   * //   basePriceFormatted: "$2,500.00",
   * //   surchargeFormatted: "$527.25",
   * //   totalPriceFormatted: "$3,027.25",
   * //   ...breakdown
   * // }
   */
  async formatPriceBreakdownJSON(basePrice, surchargePercentage = null) {
    const breakdown = await this.getPriceBreakdown(basePrice, surchargePercentage);

    return {
      ...breakdown,
      basePriceFormatted: this.formatMXN(breakdown.basePrice),
      surchargeFormatted: this.formatMXN(breakdown.surcharge),
      totalPriceFormatted: this.formatMXN(breakdown.totalPrice),
      surchargePercentageFormatted: `${breakdown.surchargePercentage}%`,
    };
  }

  // ============================================================
  // REVERSE CALCULATIONS
  // ============================================================

  /**
   * Calculate base price from total price (reverse surcharge calculation).
   * Useful when you have the total price and need to find the cash discount price.
   * @param {number} totalPrice - Total price with surcharge included.
   * @param {number|null} surchargePercentage - Optional surcharge percentage override.
   * @returns {Promise<number>} Base price (cash discount price) rounded to 2 decimals.
   * @example
   * const basePrice = await pricingHelper.calculateBasePriceFromTotal(3027.25);
   * // Returns: 2500.00 (if surcharge is 21.09%)
   *
   * // Formula: basePrice = totalPrice / (1 + (percentage / 100))
   */
  async calculateBasePriceFromTotal(totalPrice, surchargePercentage = null) {
    try {
      const percentage = surchargePercentage !== null
        ? surchargePercentage
        : await this.settingsService.getNumericValue(this.surchargeSettingKey, this.defaultSurchargePercentage);

      const basePrice = totalPrice / (1 + percentage / 100);
      const rounded = Math.round(basePrice * 100) / 100;

      logger.debug('Base price calculated from total', {
        totalPrice,
        percentage,
        basePrice: rounded,
      });

      return rounded;
    } catch (error) {
      logger.error('Error calculating base price from total', {
        totalPrice,
        surchargePercentage,
        error: error.message,
      });
      throw error;
    }
  }

  // ============================================================
  // CONFIGURATION
  // ============================================================

  /**
   * Get current surcharge percentage from settings.
   * @returns {Promise<number>} Current surcharge percentage.
   * @example
   * const percentage = await pricingHelper.getCurrentSurchargePercentage();
   * // Returns: 21.09
   */
  async getCurrentSurchargePercentage() {
    return this.settingsService.getNumericValue(this.surchargeSettingKey, this.defaultSurchargePercentage);
  }

  /**
   * Clear cached surcharge percentage (force refresh from database).
   * Call this after updating settings via seed or direct DB access.
   * @example
   * // After running seed or DB update
   * pricingHelper.clearCache();
   */
  clearCache() {
    this.settingsService.clearCache();
    logger.info('PricingHelper cache cleared');
  }
}

// Export as singleton
module.exports = new PricingHelper();
