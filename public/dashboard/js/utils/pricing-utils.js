/**
 * Pricing Utilities for Admin Dashboard Components.
 *
 * Centralized client-side pricing functions to ensure consistency
 * across all admin dashboard pages (A Disposición, Tours, Services, etc.).
 * @author Denisse Maldonado
 * @version 1.0.0
 */

window.PricingUtils = (function () {
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
   * PricingUtils.applyUSDRoundingRules(23.45); // Returns: 25 (ends in 3, rounds up)
   */
  function applyUSDRoundingRules(usdPrice) {
    const base = Math.floor(usdPrice / 5) * 5;
    const remainder = usdPrice % 5;

    if (remainder === 0) {
      const lastDigitBeforeDecimal = Math.floor(usdPrice) % 10;
      if (lastDigitBeforeDecimal === 3 || lastDigitBeforeDecimal === 8) {
        return base + 5; // Round up for numbers ending in 3 or 8
      }
      return base; // Keep as multiple of 5
    } if (remainder <= 2.7) {
      return base; // Round down
    }
    return base + 5; // Round up
  }

  /**
   * Format price with currency symbol and proper localization.
   * @param {number} price - Price to format.
   * @param {string} currency - Currency code ('MXN' or 'USD').
   * @returns {string} Formatted price string.
   * @example
   * formatPriceWithCurrency(100, 'USD'); // Returns: "$100.00 USD"
   */
  function formatPriceWithCurrency(price, currency) {
    const numPrice = parseFloat(price) || 0;
    if (currency === 'USD') {
      return `$${numPrice.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} USD`;
    }
    return `$${numPrice.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;
  }

  /**
   * Load current exchange, transfer, and agency rates from API.
   * @returns {Promise<object>} Object with exchangeRate, transferRate, agencyRate.
   * @example
   * const rates = await loadCurrentRates();
   */
  async function loadCurrentRates() {
    try {
      const [exchangeResponse, transferResponse, agencyResponse] = await Promise.all([
        fetch('/api/exchange-rate/current'),
        fetch('/api/transfer-rate/current'),
        fetch('/api/agency-rate/current'),
      ]);

      const exchangeData = await exchangeResponse.json();
      const transferData = await transferResponse.json();
      const agencyData = await agencyResponse.json();

      return {
        exchangeRate: exchangeData.success ? (exchangeData.data.value || 20.0) : 20.0,
        transferRate: transferData.success ? (transferData.data.value || 3.0) : 3.0,
        agencyRate: agencyData.success ? (agencyData.data.value || 5.0) : 5.0,
      };
    } catch (error) {
      return {
        exchangeRate: 20.0,
        transferRate: 3.0,
        agencyRate: 5.0,
      };
    }
  }

  /**
   * Apply payment method rate to price.
   * @param {number} price - Base price.
   * @param {string} paymentType - Payment method.
   * @param {number} transferRate - Transfer rate percentage.
   * @param {number} agencyRate - Agency rate percentage.
   * @returns {number} Price with rate applied.
   * @example
   * applyPaymentRate(100, 'transferencia', 3, 5); // Returns: 103
   */
  function applyPaymentRate(price, paymentType, transferRate, agencyRate) {
    if (paymentType === 'transferencia') {
      return price * (1 + transferRate / 100);
    } if (paymentType === 'tarjeta') {
      return price * (1 + agencyRate / 100);
    }
    return price;
  }

  // Public API
  return {
    applyUSDRoundingRules,
    applyPaymentRate,
    formatPriceWithCurrency,
    loadCurrentRates,
  };
}());
