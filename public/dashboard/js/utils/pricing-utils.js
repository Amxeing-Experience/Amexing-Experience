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

  /**
   * Apply cash rounding rules for efectivo payments.
   * Rounds to nearest 5 pesos to eliminate cents and facilitate cash transactions.
   * - Amounts with <= 0.50 centavos: Round down to nearest 5.
   * - Amounts with > 0.50 centavos: Round up to nearest 5.
   * @param {number} price - Price to round for cash payment.
   * @returns {number} Rounded price suitable for cash (multiple of 5).
   * @example
   * applyCashRounding(17.00); // Returns: 15
   * applyCashRounding(17.30); // Returns: 15
   * applyCashRounding(17.60); // Returns: 20
   * applyCashRounding(22.50); // Returns: 20
   * applyCashRounding(22.51); // Returns: 25
   */
  function applyCashRounding(price) {
    const integerPart = Math.floor(price);
    const decimalPart = price - integerPart;

    if (decimalPart <= 0.50) {
      // Round down to nearest multiple of 5
      return Math.floor(integerPart / 5) * 5;
    }
    // Round up to nearest multiple of 5
    if (integerPart === 0) {
      return 5; // Special case: 0.xx rounds up to 5
    }
    return Math.ceil(integerPart / 5) * 5;
  }

  // Cash rounding setting management
  let cashRoundingEnabled = true; // Default to enabled for backward compatibility
  let cashRoundingSettingCached = false;

  /**
   * Check if cash rounding is enabled via admin settings
   * @returns {Promise<boolean>} True if cash rounding is enabled, false otherwise
   * @example
   * if (await isCashRoundingEnabled()) {
   *   price = applyCashRounding(price);
   * }
   */
  async function isCashRoundingEnabled() {
    if (cashRoundingSettingCached) {
      return cashRoundingEnabled;
    }

    try {
      const response = await fetch('/api/settings/cash-rounding', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          cashRoundingEnabled = data.data.enabled;
          cashRoundingSettingCached = true;
          
          // Cache for 5 minutes to reduce API calls
          setTimeout(() => {
            cashRoundingSettingCached = false;
          }, 5 * 60 * 1000);
          
          return cashRoundingEnabled;
        }
      }
    } catch (error) {
      console.warn('Failed to load cash rounding setting, using default:', error);
    }

    // Default to enabled for backward compatibility
    return true;
  }

  /**
   * Synchronous version that returns cached value or default
   * Use this in scenarios where async calls are not practical
   * @returns {boolean} Cached cash rounding setting or default (true)
   */
  function isCashRoundingEnabledSync() {
    return cashRoundingSettingCached ? cashRoundingEnabled : true;
  }

  /**
   * Refresh the cash rounding setting cache
   * Call this when the setting is updated in admin panel
   */
  async function refreshCashRoundingSetting() {
    cashRoundingSettingCached = false;
    return await isCashRoundingEnabled();
  }

  // Public API
  return {
    applyUSDRoundingRules,
    applyPaymentRate,
    applyCashRounding,
    isCashRoundingEnabled,
    isCashRoundingEnabledSync,
    refreshCashRoundingSetting,
    formatPriceWithCurrency,
    loadCurrentRates,
  };
}());
