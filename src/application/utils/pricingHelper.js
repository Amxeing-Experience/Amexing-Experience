/**
 * PricingHelper - Centralized pricing calculations for AmexingWeb.
 *
 * Provides consistent surcharge calculations and price formatting across
 * the entire application. Integrates with SettingsService to retrieve
 * the configurable surcharge percentage for non-cash payment methods.
 *
 * Key Concepts:
 * - Base Price (Precio Contado): Original price for cash payments
 * - Surcharge: Additional percentage for non-cash payment methods (cards, digital wallets)
 * - Total Price (Precio Base): Base price + surcharge (displayed prominently).
 *
 * Legal Terminology:
 * - "Precio contado" = Cash discount price (legally correct term)
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
const logger = require('../../infrastructure/logger');

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
   * // - Small muted text: "Contado: $2,500.00"
   * // - Large bold green: "$3,027.25"
   * // - Tiny muted text: "+21.09% otros métodos"
   */
  async formatPriceBreakdownHTML(basePrice, surchargePercentage = null) {
    const breakdown = await this.getPriceBreakdown(basePrice, surchargePercentage);

    return `
      <div class="price-breakdown">
        <div class="base-price text-muted" style="font-size: 0.875rem;">
          <small>Contado: ${this.formatMXN(breakdown.basePrice)}</small>
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
