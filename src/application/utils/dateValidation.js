/**
 * dateValidation - One standard for validating user-entered date fields across the app.
 *
 * Two categories, with bounds recomputed on every call so "today" always advances (never
 * hardcoded):
 *  - PAST-ONLY  (birth dates, passport issue dates): 1900-01-01 .. today. No future.
 *  - FUTURE-OK  (passport expiration, payment/reservation dates): 1900-01-01 .. today + MAX_FUTURE_YEARS.
 *
 * The SERVER is the source of truth (validateDate); the <input> min/max attributes built with
 * todayISO()/maxFutureISO() are UX only and can be bypassed, so both layers must be applied.
 * @module application/utils/dateValidation
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

// Nobody alive today was born (nor a passport issued) before this — blocks year 0-1899 typos.
const MIN_DATE_ISO = '1900-01-01';
// Sane upper bound for future-allowed dates: blocks absurd typos (e.g. year 9999) while covering
// reservations and passport validity (max ~10y) comfortably.
const MAX_FUTURE_YEARS = 20;

/**
 * Validate a single optional date value against the shared rules.
 * @param {*} value - Date value (ISO string / Date). Empty/undefined/null = OK (optional field).
 * @param {object} [opts] - Options.
 * @param {string} [opts.fieldName] - Human label used in the error message.
 * @param {boolean} [opts.allowFuture] - When false (default) a future date is rejected.
 * @param {number} [opts.maxFutureYears] - Cap for future dates when allowFuture is true.
 * @returns {string|null} A human-readable error message, or null when valid/empty.
 * @example
 * validateDate('1800-05-01', { fieldName: 'Fecha de nacimiento' }); // 'Fecha de nacimiento no puede ser anterior a 1900'
 * validateDate('2050-01-01', { fieldName: 'Fecha de pago', allowFuture: true }); // null
 */
function validateDate(value, {
  fieldName = 'Fecha', allowFuture = false, maxFutureYears = MAX_FUTURE_YEARS,
} = {}) {
  if (value === undefined || value === null || value === '') return null;

  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return `${fieldName} inválida`;

  if (d < new Date(MIN_DATE_ISO)) return `${fieldName} no puede ser anterior a 1900`;

  const now = new Date();
  // Boundaries computed in UTC: date-only strings ('YYYY-MM-DD') parse as UTC midnight, so
  // comparing them against a local-time boundary shifts the cutoff by the server's UTC offset
  // (e.g. a server west of Greenwich would let a same-day-UTC future date slip through as "past").
  if (!allowFuture) {
    // Compare against end-of-today so a same-day date isn't rejected by a few hours of time zone.
    const endOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
    if (d > endOfToday) return `${fieldName} no puede ser una fecha futura`;
  } else {
    const maxDate = new Date(Date.UTC(now.getUTCFullYear() + maxFutureYears, now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
    if (d > maxDate) return `${fieldName} es demasiado lejana`;
  }
  return null;
}

/**
 * ISO 'today' (YYYY-MM-DD) for the max attribute of a past-only date input.
 * @returns {string} Today's date in YYYY-MM-DD.
 * @example
 * todayISO(); // '2026-06-30'
 */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * ISO 'today + years' (YYYY-MM-DD) for the max attribute of a future-allowed date input.
 * @param {number} [years] - Years ahead of today (defaults to MAX_FUTURE_YEARS).
 * @returns {string} The capped future date in YYYY-MM-DD.
 * @example
 * maxFutureISO(); // '2046-06-30'
 */
function maxFutureISO(years = MAX_FUTURE_YEARS) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  MIN_DATE_ISO,
  MAX_FUTURE_YEARS,
  validateDate,
  todayISO,
  maxFutureISO,
};
