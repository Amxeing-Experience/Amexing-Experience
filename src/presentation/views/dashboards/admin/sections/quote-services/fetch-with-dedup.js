/**
 * FetchWithDedup - Request deduplication wrapper for fetch API.
 *
 * Prevents duplicate simultaneous requests to the same endpoint by tracking
 * in-flight requests and returning the same promise for duplicate calls.
 *
 * Benefits:
 * - Reduces server load by preventing duplicate requests
 * - Improves performance by avoiding redundant network calls
 * - Maintains request consistency when multiple components need same data.
 * @example
 * // Multiple calls to same endpoint return same promise
 * const promise1 = fetchWithDedup('/api/rates/active');
 * const promise2 = fetchWithDedup('/api/rates/active'); // Returns same promise as promise1
 *
 * const [rates1, rates2] = await Promise.all([promise1, promise2]);
 * // Only ONE actual HTTP request was made
 */

/**
 * In-flight requests tracker
 * Maps request keys to pending promises.
 * @type {Map<string, Promise>}
 */
const inFlightRequests = new Map();

/**
 * Generate unique cache key for request.
 * @param {string} url - Request URL.
 * @param {object} [options] - Fetch options.
 * @returns {string} Unique request key.
 * @private
 * @example
 */
function generateRequestKey(url, options = {}) {
  // Include method and body in key for POST/PUT requests
  const method = options.method || 'GET';
  const bodyKey = options.body ? JSON.stringify(options.body) : '';

  return `${method}:${url}:${bodyKey}`;
}

/**
 * Fetch with automatic request deduplication.
 * @param {string} url - Request URL.
 * @param {object} [options] - Fetch options (same as standard fetch).
 * @returns {Promise<Response>} Fetch response promise.
 * @throws {Error} If request fails.
 * @example
 * // Basic usage
 * const response = await fetchWithDedup('/api/rates/active');
 * const data = await response.json();
 * @example
 * // With options
 * const response = await fetchWithDedup('/api/quotes/123', {
 *   method: 'PUT',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Authorization': `Bearer ${token}`
 *   },
 *   body: JSON.stringify({ data: 'value' })
 * });
 * @example
 * // Multiple simultaneous calls (only 1 HTTP request)
 * const [rates1, rates2, rates3] = await Promise.all([
 *   fetchWithDedup('/api/rates/active'),
 *   fetchWithDedup('/api/rates/active'),
 *   fetchWithDedup('/api/rates/active')
 * ]);
 * // All three receive the same response
 */
async function fetchWithDedup(url, options = {}) {
  const requestKey = generateRequestKey(url, options);

  // Check if request is already in flight
  if (inFlightRequests.has(requestKey)) {
    console.log(`[FetchWithDedup] Deduplicating request to: ${url}`);
    return inFlightRequests.get(requestKey);
  }

  // Create new request promise
  const requestPromise = fetch(url, options)
    .then((response) => response.clone()) // Clone response so it can be consumed multiple times
    .finally(() => {
      // Remove from in-flight tracker when completed
      inFlightRequests.delete(requestKey);
    });

  // Track in-flight request
  inFlightRequests.set(requestKey, requestPromise);

  return requestPromise;
}

/**
 * Get number of currently in-flight requests.
 * @returns {number} Number of pending requests.
 * @example
 * console.log(`${getInFlightCount()} requests pending`);
 */
function getInFlightCount() {
  return inFlightRequests.size;
}

/**
 * Get all in-flight request keys
 * Useful for debugging.
 * @returns {string[]} Array of request keys.
 * @example
 * console.log('Pending requests:', getInFlightRequests());
 */
function getInFlightRequests() {
  return Array.from(inFlightRequests.keys());
}

/**
 * Clear all in-flight requests
 * WARNING: This does not cancel requests, only removes tracking.
 * @returns {void}
 * @example
 * clearInFlightRequests(); // Clear tracking (for testing)
 */
function clearInFlightRequests() {
  inFlightRequests.clear();
}

/**
 * Fetch JSON with deduplication
 * Convenience wrapper that automatically parses JSON response.
 * @param {string} url - Request URL.
 * @param {object} [options] - Fetch options.
 * @returns {Promise<object>} Parsed JSON response.
 * @throws {Error} If request fails or response is not valid JSON.
 * @example
 * const { data } = await fetchJSONWithDedup('/api/rates/active');
 * console.log('Rates:', data);
 */
async function fetchJSONWithDedup(url, options = {}) {
  const response = await fetchWithDedup(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return response.json();
}

/**
 * Fetch with deduplication and retry logic
 * Automatically retries failed requests with exponential backoff.
 * @param {string} url - Request URL.
 * @param {object} [options] - Fetch options.
 * @param {number} [options.maxRetries] - Maximum retry attempts.
 * @param {number} [options.retryDelay] - Initial retry delay in ms.
 * @returns {Promise<Response>} Fetch response promise.
 * @throws {Error} If all retry attempts fail.
 * @example
 * const response = await fetchWithDedupAndRetry('/api/quotes/123', {
 *   maxRetries: 3,
 *   retryDelay: 1000 // Start with 1 second, doubles each retry
 * });
 */
async function fetchWithDedupAndRetry(url, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const retryDelay = options.retryDelay || 1000;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithDedup(url, options);

      // Only retry on server errors (5xx) or network errors
      if (response.ok || response.status < 500) {
        return response;
      }

      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }

    // Don't wait after last attempt
    if (attempt < maxRetries) {
      const delay = retryDelay * 2 ** attempt; // Exponential backoff
      console.log(`[FetchWithDedup] Retry ${attempt + 1}/${maxRetries} after ${delay}ms for ${url}`);
      await new Promise((resolve) => {
        setTimeout(resolve, delay);
      });
    }
  }

  throw new Error(`Request failed after ${maxRetries} retries: ${lastError.message}`);
}

/**
 * Batch multiple requests with deduplication
 * Executes requests in parallel and returns results in same order.
 * @param {Array<{url: string, options?: object}>} requests - Array of request configs.
 * @returns {Promise<Array<Response>>} Array of responses in same order.
 * @example
 * const results = await batchFetch([
 *   { url: '/api/rates/active' },
 *   { url: '/api/experiences?type=Experience' },
 *   { url: '/api/pois?active=true' }
 * ]);
 *
 * const [rates, experiences, pois] = await Promise.all(
 *   results.map(r => r.json())
 * );
 */
async function batchFetch(requests) {
  return Promise.all(
    requests.map(({ url, options }) => fetchWithDedup(url, options))
  );
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fetchWithDedup,
    fetchJSONWithDedup,
    fetchWithDedupAndRetry,
    batchFetch,
    getInFlightCount,
    getInFlightRequests,
    clearInFlightRequests,
  };
}
