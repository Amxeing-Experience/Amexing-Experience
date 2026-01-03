/**
 * QuoteServiceHelper.
 * Shared utility functions for quote service operations.
 * Extracted from QuoteController and quote-services.ejs to eliminate duplication.
 * @module QuoteServiceHelper
 */

/**
 * Get day of week code from date string.
 * @param {string} dateString - Date in YYYY-MM-DD format.
 * @returns {number} Day code (0=Sunday, 1=Monday, ..., 6=Saturday).
 * @example
 * getDayOfWeekCode('2024-12-25') // Returns 3 (Wednesday)
 */
function getDayOfWeekCode(dateString) {
  if (!dateString) return null;

  try {
    const date = new Date(`${dateString}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;

    return date.getDay(); // 0 (Sunday) to 6 (Saturday)
  } catch (error) {
    console.error('Error parsing date:', error);
    return null;
  }
}

/**
 * Filter items by vehicle capacity
 * Removes items where capacity is less than required number of people.
 * @param {Array} items - Items with vehicleCapacity property.
 * @param {number} numberOfPeople - Required capacity.
 * @returns {Array} Filtered items.
 * @example
 * const vehicles = [
 *   { name: 'Sedan', vehicleCapacity: 4 },
 *   { name: 'Van', vehicleCapacity: 8 }
 * ];
 * filterByCapacity(vehicles, 6) // Returns only Van
 */
function filterByCapacity(items, numberOfPeople) {
  if (!numberOfPeople || numberOfPeople <= 0) {
    return items; // No filtering if numberOfPeople not specified
  }

  return items.filter((item) => {
    const capacity = item.vehicleCapacity || item.capacity || 0;
    return capacity >= numberOfPeople;
  });
}

/**
 * Filter items by day-of-week availability
 * Checks if item's availability array includes the target day code.
 * @param {Array} items - Items with availability property.
 * @param {number} dayCode - Target day code (0-6).
 * @returns {Array} Filtered items.
 * @example
 * const experiences = [
 *   { name: 'Tour A', availability: [{ day: 0 }, { day: 2 }] }, // Sun, Tue
 *   { name: 'Tour B', availability: [{ day: 1 }, { day: 3 }] }  // Mon, Wed
 * ];
 * filterByDayAvailability(experiences, 2) // Returns only Tour A
 */
function filterByDayAvailability(items, dayCode) {
  if (dayCode === null || dayCode === undefined) {
    return items; // No filtering if day code not specified
  }

  return items.filter((item) => {
    if (!item.availability || !Array.isArray(item.availability)) {
      return false; // Exclude items without availability data
    }

    return item.availability.some((avail) => avail.day === dayCode);
  });
}

/**
 * Check if a single item is available on a specific day.
 * @param {object} item - Item with availability array.
 * @param {number} dayCode - Target day code (0-6).
 * @returns {boolean} True if available on specified day.
 * @example
 * const experience = { availability: [{ day: 0 }, { day: 2 }] };
 * isAvailableOnDay(experience, 2) // Returns true
 * isAvailableOnDay(experience, 1) // Returns false
 */
function isAvailableOnDay(item, dayCode) {
  if (!item || !item.availability || !Array.isArray(item.availability)) {
    return false;
  }

  if (dayCode === null || dayCode === undefined) {
    return true; // Consider available if no day specified
  }

  return item.availability.some((avail) => avail.day === dayCode);
}

/**
 * Calculate price breakdown with IVA and surcharges
 * Uses the pricing helper to get detailed breakdown.
 * @param {number} basePrice - Base price before IVA and surcharges.
 * @param {object} options - Optional parameters.
 * @param {number} options.surchargePercentage - Surcharge percentage to apply.
 * @returns {Promise<object>} Price breakdown with subtotal, iva, total.
 * @example
 * const breakdown = await calculatePricing(1000, { surchargePercentage: 25 });
 * // Returns: { subtotal: 1250, iva: 200, total: 1450 }
 */
async function calculatePricing(basePrice, options = {}) {
  // eslint-disable-next-line import/extensions
  const pricingHelper = require('./PricingHelper');

  let priceWithSurcharge = basePrice;

  // Apply surcharge if specified
  if (options.surchargePercentage && options.surchargePercentage > 0) {
    const surchargeAmount = basePrice * (options.surchargePercentage / 100);
    priceWithSurcharge = basePrice + surchargeAmount;
  }

  // Get price breakdown (includes IVA calculation)
  const breakdown = await pricingHelper.getPriceBreakdown(priceWithSurcharge);

  return {
    basePrice,
    surcharge: priceWithSurcharge - basePrice,
    surchargePercentage: options.surchargePercentage || 0,
    ...breakdown,
  };
}

/**
 * Validate and normalize date string
 * Ensures date is in YYYY-MM-DD format.
 * @param {string} dateString - Date string to validate.
 * @returns {string|null} Normalized date string or null if invalid.
 * @example
 * validateDateString('2024-12-25') // Returns '2024-12-25'
 * validateDateString('invalid') // Returns null
 */
function validateDateString(dateString) {
  if (!dateString) return null;

  // Check YYYY-MM-DD format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateString)) {
    return null;
  }

  // Validate date is real
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return dateString;
}

/**
 * Get day name from day code.
 * @param {number} dayCode - Day code (0-6).
 * @param {string} locale - Locale for day names (default: 'es-MX').
 * @returns {string} Day name.
 * @example
 * getDayName(0) // Returns 'Domingo'
 * getDayName(1, 'en-US') // Returns 'Monday'
 */
function getDayName(dayCode, locale = 'es-MX') {
  const dayNames = {
    'es-MX': ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
    'en-US': ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  };

  const names = dayNames[locale] || dayNames['es-MX'];
  return names[dayCode] || '';
}

/**
 * Build cache key for quote service data
 * Creates consistent cache keys for different data types.
 * @param {string} type - Data type (rates, services, tours, experiences).
 * @param {object} params - Parameters for cache key.
 * @returns {string} Cache key.
 * @example
 * buildCacheKey('services', { rateId: '123', numberOfPeople: 5 })
 * // Returns 'services_rate_123_people_5'
 */
function buildCacheKey(type, params = {}) {
  const parts = [type];

  // Add parameters in consistent order
  if (params.rateId) parts.push(`rate_${params.rateId}`);
  if (params.destinationId) parts.push(`dest_${params.destinationId}`);
  if (params.numberOfPeople) parts.push(`people_${params.numberOfPeople}`);
  if (params.dayDate) parts.push(`date_${params.dayDate}`);
  if (params.dayCode !== undefined) parts.push(`day_${params.dayCode}`);

  return parts.join('_');
}

module.exports = {
  getDayOfWeekCode,
  filterByCapacity,
  filterByDayAvailability,
  isAvailableOnDay,
  calculatePricing,
  validateDateString,
  getDayName,
  buildCacheKey,
};
