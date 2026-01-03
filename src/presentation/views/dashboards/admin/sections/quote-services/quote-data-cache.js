/**
 * QuoteDataCache - Client-side caching layer for quote service data.
 *
 * Provides intelligent caching with TTL management and pattern-based invalidation
 * to reduce redundant API calls and improve user experience.
 *
 * Features:
 * - Configurable TTL (time-to-live) per cache entry
 * - Pattern-based cache invalidation
 * - Automatic expiration handling
 * - Cache statistics and monitoring.
 * @class QuoteDataCache
 * @example
 * const cache = new QuoteDataCache(10 * 60 * 1000); // 10 minutes TTL
 * cache.set('rates_all', ratesData);
 * const rates = cache.get('rates_all'); // Returns data if not expired
 */
class QuoteDataCache {
  /**
   * Create a new QuoteDataCache instance.
   * @param {number} defaultTTL - Default time-to-live in milliseconds (default: 10 minutes).
   * @example
   */
  constructor(defaultTTL = 10 * 60 * 1000) {
    this.cache = new Map();
    this.defaultTTL = defaultTTL;
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      invalidations: 0,
    };
  }

  /**
   * Get item from cache.
   * @param {string} key - Cache key.
   * @returns {*} Cached data or null if not found/expired.
   * @example
   * const rates = cache.get('rates_all');
   * if (rates) {
   *   console.log('Cache hit!');
   * }
   */
  get(key) {
    const item = this.cache.get(key);

    if (!item) {
      this.stats.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return item.data;
  }

  /**
   * Set item in cache.
   * @param {string} key - Cache key.
   * @param {*} data - Data to cache.
   * @param {number} [ttl] - Optional custom TTL in milliseconds.
   * @returns {void}
   * @example
   * cache.set('rates_all', ratesData);
   * cache.set('services_rate_123', servicesData, 5 * 60 * 1000); // 5 min custom TTL
   */
  set(key, data, ttl = this.defaultTTL) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
    this.stats.sets++;
  }

  /**
   * Check if key exists and is not expired.
   * @param {string} key - Cache key.
   * @returns {boolean} True if key exists and is valid.
   * @example
   * if (cache.has('rates_all')) {
   *   console.log('Rates are cached');
   * }
   */
  has(key) {
    const item = this.cache.get(key);
    if (!item) return false;

    // Check if expired
    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Invalidate (delete) specific cache entry.
   * @param {string} key - Cache key to invalidate.
   * @returns {boolean} True if key was deleted.
   * @example
   * cache.invalidate('rates_all');
   */
  invalidate(key) {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.invalidations++;
    }
    return deleted;
  }

  /**
   * Invalidate all cache entries matching a pattern.
   * @param {string|RegExp} pattern - String prefix or RegExp pattern to match keys.
   * @returns {number} Number of keys invalidated.
   * @example
   * cache.invalidatePattern('services_rate_'); // Invalidate all services by rate
   * cache.invalidatePattern(/^tour_/); // Invalidate all tour data
   */
  invalidatePattern(pattern) {
    let count = 0;
    // eslint-disable-next-line security/detect-non-literal-regexp
    const regex = pattern instanceof RegExp ? pattern : new RegExp(`^${pattern}`);

    // eslint-disable-next-line no-restricted-syntax
    for (const [key] of this.cache.entries()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count += 1;
        this.stats.invalidations += 1;
      }
    }

    return count;
  }

  /**
   * Clear all cache entries.
   * @returns {void}
   * @example
   * cache.clear(); // Clear everything
   */
  clear() {
    const { size } = this.cache;
    this.cache.clear();
    this.stats.invalidations += size;
  }

  /**
   * Remove expired entries from cache.
   * @returns {number} Number of expired entries removed.
   * @example
   * const cleaned = cache.cleanup();
   * console.log(`Removed ${cleaned} expired entries`);
   */
  cleanup() {
    let count = 0;
    const now = Date.now();

    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > item.ttl) {
        this.cache.delete(key);
        count++;
      }
    }

    return count;
  }

  /**
   * Get cache statistics.
   * @returns {object} Cache statistics object.
   * @example
   * const stats = cache.getStats();
   * console.log(`Hit rate: ${stats.hitRate}%`);
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) : 0;

    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: parseFloat(hitRate),
    };
  }

  /**
   * Reset cache statistics.
   * @returns {void}
   * @example
   * cache.resetStats();
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      invalidations: 0,
    };
  }

  /**
   * Get all cache keys.
   * @returns {string[]} Array of all cache keys.
   * @example
   * const keys = cache.getKeys();
   * console.log(`Cached keys: ${keys.join(', ')}`);
   */
  getKeys() {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache size (number of entries).
   * @returns {number} Number of cached entries.
   * @example
   * console.log(`Cache has ${cache.size()} entries`);
   */
  size() {
    return this.cache.size;
  }

  /**
   * Get or set cache entry (lazy loading pattern)
   * If key exists and is valid, return cached data.
   * Otherwise, call loader function, cache result, and return it.
   * @param {string} key - Cache key.
   * @param {Function} loader - Async function to load data if not cached.
   * @param {number} [ttl] - Optional custom TTL.
   * @returns {Promise<*>} Cached or freshly loaded data.
   * @example
   * const rates = await cache.getOrSet('rates_all', async () => {
   *   const response = await fetch('/api/rates/active');
   *   return response.json();
   * });
   */
  async getOrSet(key, loader, ttl = this.defaultTTL) {
    // Try to get from cache
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    // Load fresh data
    const data = await loader();

    // Cache it
    this.set(key, data, ttl);

    return data;
  }

  /**
   * Create a debounced cache invalidation function
   * Useful for invalidating cache when user changes form values frequently.
   * @param {string} pattern - Pattern to invalidate.
   * @param {number} delay - Debounce delay in milliseconds.
   * @returns {Function} Debounced invalidation function.
   * @example
   * const debouncedInvalidate = cache.createDebouncedInvalidation('services_', 500);
   * // Call multiple times, only executes after 500ms of inactivity
   * debouncedInvalidate();
   */
  createDebouncedInvalidation(pattern, delay = 500) {
    let timeoutId = null;

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        this.invalidatePattern(pattern);
        timeoutId = null;
      }, delay);
    };
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = QuoteDataCache;
}
