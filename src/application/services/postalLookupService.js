/**
 * PostalLookupService - Resolves a postal code to its state/province and city using the free
 * Zippopotam.us public API (no key required). Used by the client address form to auto-fill
 * Estado/Ciudad. Results are cached in memory since postal data is effectively static.
 */
const logger = require('../../infrastructure/logger');

const SUPPORTED = new Set(['mx', 'us', 'ca']);
const TIMEOUT_MS = 4000;
const cache = new Map();

/**
 * Look up a postal code's location.
 * @param {string} country - ISO country code (mx | us | ca).
 * @param {string} code - The postal code (digits for MX/US, alphanumeric FSA for CA).
 * @returns {Promise<{country: string, postalCode: string, state: string, city: string}|null>}
 * @example
 */
async function lookup(country, code) {
  const iso = String(country || '').toLowerCase().trim();
  if (!SUPPORTED.has(iso)) return null;

  // Sanitize: MX/US use the 5 digits; CA uses the alphanumeric FSA (first 3 chars).
  let q = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  q = iso === 'ca' ? q.slice(0, 3) : q.replace(/\D/g, '').slice(0, 5);
  if (!q) return null;

  const key = `${iso}/${q}`;
  if (cache.has(key)) return cache.get(key);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`https://api.zippopotam.us/${iso}/${q}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) { cache.set(key, null); return null; }

    const data = await res.json();
    const place = (data.places || [])[0] || {};
    const result = {
      country: data.country || null,
      postalCode: data['post code'] || q,
      state: place.state || null,
      city: place['place name'] || null,
    };
    cache.set(key, result);
    return result;
  } catch (error) {
    logger.warn('postalLookupService.lookup failed', { country: iso, code: q, error: error.message });
    return null;
  }
}

module.exports = { lookup };
