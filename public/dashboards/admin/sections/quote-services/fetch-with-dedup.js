/**
 * Request Deduplication Layer
 * Prevents duplicate simultaneous HTTP requests to the same endpoint
 *
 * @module FetchWithDedup
 */

// Track in-flight requests
const inFlightRequests = new Map();

/**
 * Generate unique key for request
 * @param {string} url - Request URL
 * @param {Object} options - Fetch options
 * @returns {string} Unique request key
 */
function generateRequestKey(url, options = {}) {
  const method = options.method || 'GET';
  const body = options.body || '';
  return `${method}:${url}:${body}`;
}

/**
 * Fetch with request deduplication
 * If a request to the same URL with same options is already in flight,
 * returns the existing promise instead of creating a new request
 *
 * @param {string} url - Request URL
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>} Fetch response
 *
 * @example
 * // Multiple simultaneous calls only create 1 HTTP request
 * const [r1, r2, r3] = await Promise.all([
 *   fetchWithDedup('/api/rates'),
 *   fetchWithDedup('/api/rates'),  // Reuses first request
 *   fetchWithDedup('/api/rates')   // Reuses first request
 * ]);
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
    .then(response => {
      // Clone response so it can be used multiple times
      return response.clone();
    })
    .finally(() => {
      // Remove from in-flight when complete
      inFlightRequests.delete(requestKey);
    });

  // Store in-flight request
  inFlightRequests.set(requestKey, requestPromise);

  return requestPromise;
}

/**
 * Fetch JSON with deduplication
 * Convenience wrapper that automatically parses JSON response
 *
 * @param {string} url - Request URL
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} Parsed JSON response
 *
 * @example
 * const data = await fetchJSONWithDedup('/api/rates');
 */
async function fetchJSONWithDedup(url, options = {}) {
  const response = await fetchWithDedup(url, options);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch with deduplication and retry logic
 * Automatically retries failed requests with exponential backoff
 *
 * @param {string} url - Request URL
 * @param {Object} options - Fetch options
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 * @param {number} retryDelay - Initial retry delay in ms (default: 1000)
 * @returns {Promise<Response>} Fetch response
 *
 * @example
 * const response = await fetchWithDedupAndRetry('/api/rates', {}, 3, 1000);
 */
async function fetchWithDedupAndRetry(url, options = {}, maxRetries = 3, retryDelay = 1000) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchWithDedup(url, options);
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        const delay = retryDelay * Math.pow(2, attempt); // Exponential backoff
        console.log(`[FetchWithDedup] Retry ${attempt + 1}/${maxRetries} after ${delay}ms for: ${url}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Get count of in-flight requests
 * @returns {number} Number of active requests
 */
function getInFlightCount() {
  return inFlightRequests.size;
}

/**
 * Get list of in-flight request URLs
 * @returns {Array<string>} Array of request URLs currently in flight
 */
function getInFlightRequests() {
  return Array.from(inFlightRequests.keys());
}

/**
 * Clear all in-flight requests
 * Use with caution - may cause promise rejections
 */
function clearInFlightRequests() {
  inFlightRequests.clear();
}

// Make available globally
window.fetchWithDedup = fetchWithDedup;
window.fetchJSONWithDedup = fetchJSONWithDedup;
window.fetchWithDedupAndRetry = fetchWithDedupAndRetry;
window.getInFlightCount = getInFlightCount;
window.getInFlightRequests = getInFlightRequests;
window.clearInFlightRequests = clearInFlightRequests;
