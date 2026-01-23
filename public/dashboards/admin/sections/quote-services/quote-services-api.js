/**
 * QuoteServicesAPI - Centralized API layer with caching and prefetch
 * Provides unified interface for all quote services API calls
 *
 * @module QuoteServicesAPI
 */

/**
 * Create Quote Services API instance
 * @param {Object} options - Configuration options
 * @param {number} options.cacheTTL - Cache time-to-live in milliseconds (default: 10 minutes)
 * @returns {Object} API object with methods
 *
 * @example
 * const quoteAPI = createQuoteServicesAPI({ cacheTTL: 10 * 60 * 1000 });
 * const rates = await quoteAPI.getRates();
 */
function createQuoteServicesAPI(options = {}) {
  const cache = new QuoteDataCache(options.cacheTTL || 10 * 60 * 1000);

  /**
   * Get authentication token from localStorage
   * @returns {string|null} JWT token
   */
  function getAuthToken() {
    return localStorage.getItem('authToken');
  }

  /**
   * Create authenticated fetch options
   * @param {Object} options - Additional fetch options
   * @returns {Object} Fetch options with auth header
   */
  function createAuthOptions(options = {}) {
    const token = getAuthToken();
    return {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    };
  }

  /**
   * Get quote data
   * @param {string} quoteId - Quote ID
   * @returns {Promise<Object>} Quote data
   */
  async function getQuote(quoteId) {
    const cacheKey = `quote_${quoteId}`;

    return cache.getOrSet(cacheKey, async () => {
      const url = `/api/quotes/${quoteId}`;
      const response = await fetchWithDedup(url, createAuthOptions());

      if (!response.ok) {
        throw new Error(`Failed to fetch quote: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to load quote data');
      }

      return result.data;
    });
  }

  /**
   * Get active rates
   * @returns {Promise<Array>} Array of rate objects
   */
  async function getRates() {
    const cacheKey = 'rates_all';

    return cache.getOrSet(cacheKey, async () => {
      const url = '/api/rates/active';
      return fetchJSONWithDedup(url, createAuthOptions());
    });
  }

  /**
   * Get services by rate
   * @param {string} rateId - Rate ID
   * @returns {Promise<Array>} Array of service objects
   */
  async function getServicesByRate(rateId) {
    if (!rateId) return [];

    const cacheKey = `services_rate_${rateId}`;

    return cache.getOrSet(cacheKey, async () => {
      const url = `/api/services-by-rate/${rateId}`;
      return fetchJSONWithDedup(url, createAuthOptions());
    });
  }

  /**
   * Get experiences with optional day filtering
   * @param {string} type - Experience type (default: 'Experience')
   * @param {string} dayDate - Date in YYYY-MM-DD format for filtering (optional)
   * @returns {Promise<Array>} Array of experience objects
   */
  async function getExperiences(type = 'Experience', dayDate = null) {
    const cacheKey = dayDate
      ? `experiences_${type}_day_${dayDate}`
      : `experiences_${type}_all`;

    return cache.getOrSet(cacheKey, async () => {
      let url = `/api/experiences?type=${type}&length=1000`;
      if (dayDate) {
        url += `&dayDate=${dayDate}`;
      }

      return fetchJSONWithDedup(url, createAuthOptions());
    });
  }

  /**
   * Get tour destinations by rate with optional day filtering
   * @param {string} rateId - Rate ID
   * @param {string} dayDate - Date in YYYY-MM-DD format for filtering (optional)
   * @returns {Promise<Array>} Array of destination objects
   */
  async function getTourDestinations(rateId, dayDate = null) {
    if (!rateId) return [];

    const cacheKey = dayDate
      ? `tour_destinations_${rateId}_day_${dayDate}`
      : `tour_destinations_${rateId}_all`;

    return cache.getOrSet(cacheKey, async () => {
      let url = `/api/quotes/tours/destinations-by-rate/${rateId}`;
      if (dayDate) {
        url += `?dayDate=${dayDate}`;
      }

      return fetchJSONWithDedup(url, createAuthOptions());
    });
  }

  /**
   * Get tour vehicles by rate, destination, and number of people
   * @param {string} rateId - Rate ID
   * @param {string} destinationId - Destination ID
   * @param {number} numberOfPeople - Number of people
   * @param {string} dayDate - Date in YYYY-MM-DD format for filtering (optional)
   * @returns {Promise<Array>} Array of vehicle objects
   */
  async function getTourVehicles(rateId, destinationId, numberOfPeople, dayDate = null) {
    if (!rateId || !destinationId) return [];

    const cacheKey = dayDate
      ? `tour_vehicles_${rateId}_${destinationId}_${numberOfPeople}_day_${dayDate}`
      : `tour_vehicles_${rateId}_${destinationId}_${numberOfPeople}_all`;

    return cache.getOrSet(cacheKey, async () => {
      let url = `/api/quotes/tours/vehicles-by-rate-destination/${rateId}/${destinationId}?numberOfPeople=${numberOfPeople}`;
      if (dayDate) {
        url += `&dayDate=${dayDate}`;
      }

      return fetchJSONWithDedup(url, createAuthOptions());
    });
  }

  /**
   * Update quote service items
   * @param {string} quoteId - Quote ID
   * @param {Object} serviceItems - Service items data
   * @returns {Promise<Object>} Update result
   */
  async function updateServiceItems(quoteId, serviceItems) {
    const url = `/api/quotes/${quoteId}`;

    const response = await fetch(url, createAuthOptions({
      method: 'PUT',
      body: JSON.stringify({ serviceItems })
    }));

    if (!response.ok) {
      throw new Error(`Failed to update service items: ${response.statusText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Failed to update service items');
    }

    // Invalidate quote cache
    cache.delete(`quote_${quoteId}`);

    return result;
  }

  /**
   * Prefetch common data in background
   * Loads rates, services, and tour destinations to populate cache
   * @param {string} quoteId - Quote ID
   * @param {string} rateId - Rate ID (optional)
   * @returns {Promise<void>}
   */
  async function prefetchCommonData(quoteId, rateId = null) {
    console.log('[QuoteServicesAPI] Prefetching common data...');

    const prefetchPromises = [
      getRates() // Always prefetch rates
    ];

    // Prefetch rate-specific data if rateId provided
    if (rateId) {
      prefetchPromises.push(
        getServicesByRate(rateId),
        getTourDestinations(rateId)
      );
    }

    try {
      await Promise.all(prefetchPromises);
      console.log('[QuoteServicesAPI] Prefetch completed successfully');
    } catch (error) {
      console.warn('[QuoteServicesAPI] Prefetch failed (non-critical):', error);
    }
  }

  /**
   * Invalidate all cache entries related to numberOfPeople changes
   * Call this when numberOfPeople changes to refresh capacity-dependent data
   */
  function invalidatePeopleCache() {
    const count = cache.invalidatePattern(/tour_vehicles_/);
    console.log(`[QuoteServicesAPI] Invalidated ${count} people-dependent cache entries`);
  }

  /**
   * Invalidate all cache entries related to date changes
   * Call this when day dates change to refresh day-dependent data
   */
  function invalidateDateCache() {
    const count = cache.invalidatePattern(/_day_/);
    console.log(`[QuoteServicesAPI] Invalidated ${count} date-dependent cache entries`);
  }

  /**
   * Invalidate all cache entries related to rate changes
   * Call this when rate changes to refresh rate-dependent data
   */
  function invalidateRateCache() {
    const patterns = [/^services_rate_/, /^tour_destinations_/, /^tour_vehicles_/];
    let totalCount = 0;

    patterns.forEach(pattern => {
      totalCount += cache.invalidatePattern(pattern);
    });

    console.log(`[QuoteServicesAPI] Invalidated ${totalCount} rate-dependent cache entries`);
  }

  /**
   * Clear all cache
   */
  function clearCache() {
    cache.clear();
    console.log('[QuoteServicesAPI] Cache cleared');
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  function getCacheStats() {
    return cache.getStats();
  }

  // Return public API
  return {
    // Data fetching
    getQuote,
    getRates,
    getServicesByRate,
    getExperiences,
    getTourDestinations,
    getTourVehicles,
    updateServiceItems,

    // Optimization
    prefetchCommonData,

    // Cache management
    invalidatePeopleCache,
    invalidateDateCache,
    invalidateRateCache,
    clearCache,
    getCacheStats,

    // Direct cache access (for advanced use)
    cache
  };
}

// Make available globally
window.createQuoteServicesAPI = createQuoteServicesAPI;
