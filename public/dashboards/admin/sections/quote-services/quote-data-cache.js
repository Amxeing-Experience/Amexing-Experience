/**
 * QuoteDataCache - Intelligent caching layer with TTL management
 * Provides time-to-live (TTL) based caching with pattern invalidation
 *
 * @class QuoteDataCache
 * @example
 * const cache = new QuoteDataCache(10 * 60 * 1000); // 10 minutes TTL
 * cache.set('rates', ratesData);
 * const rates = cache.get('rates'); // Returns cached data or null if expired
 */
class QuoteDataCache {
  /**
   * Create a new cache instance
   * @param {number} defaultTTL - Default time-to-live in milliseconds (default: 10 minutes)
   */
  constructor(defaultTTL = 10 * 60 * 1000) {
    this.cache = new Map();
    this.defaultTTL = defaultTTL;
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      invalidations: 0
    };
  }

  /**
   * Get cached value by key
   * @param {string} key - Cache key
   * @returns {*} Cached value or null if not found/expired
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
   * Set cached value
   * @param {string} key - Cache key
   * @param {*} data - Data to cache
   * @param {number} ttl - Time-to-live in milliseconds (optional, uses defaultTTL)
   */
  set(key, data, ttl = this.defaultTTL) {
    this.cache.set(key, {
      data: data,
      timestamp: Date.now(),
      ttl: ttl
    });
    this.stats.sets++;
  }

  /**
   * Delete cached value by key
   * @param {string} key - Cache key
   * @returns {boolean} True if key existed
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Clear all cached values
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Check if key exists in cache (not expired)
   * @param {string} key - Cache key
   * @returns {boolean} True if key exists and not expired
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Get all cache keys
   * @returns {Array<string>} Array of cache keys
   */
  getKeys() {
    return Array.from(this.cache.keys());
  }

  /**
   * Invalidate cache entries matching pattern
   * @param {RegExp|string} pattern - Pattern to match (regex or string prefix)
   * @returns {number} Number of entries invalidated
   *
   * @example
   * cache.invalidatePattern(/^services_/); // Invalidate all service cache
   * cache.invalidatePattern('rates_'); // Invalidate all rates cache
   */
  invalidatePattern(pattern) {
    let count = 0;
    const regex = pattern instanceof RegExp ? pattern : new RegExp(`^${pattern}`);

    for (const [key, value] of this.cache.entries()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
        this.stats.invalidations++;
      }
    }

    return count;
  }

  /**
   * Get cache statistics
   * @returns {Object} Statistics object with hits, misses, hitRate, size
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) : 0;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      sets: this.stats.sets,
      invalidations: this.stats.invalidations,
      size: this.cache.size,
      hitRate: parseFloat(hitRate)
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      invalidations: 0
    };
  }

  /**
   * Get or set cached value (convenience method)
   * @param {string} key - Cache key
   * @param {Function} loader - Async function to load data if not cached
   * @param {number} ttl - Time-to-live in milliseconds (optional)
   * @returns {Promise<*>} Cached or loaded data
   *
   * @example
   * const rates = await cache.getOrSet('rates', async () => {
   *   const response = await fetch('/api/rates');
   *   return response.json();
   * });
   */
  async getOrSet(key, loader, ttl = this.defaultTTL) {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    const data = await loader();
    this.set(key, data, ttl);
    return data;
  }
}

// Make available globally
window.QuoteDataCache = QuoteDataCache;
