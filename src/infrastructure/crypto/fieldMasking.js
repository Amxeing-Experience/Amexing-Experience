/**
 * FieldMasking - Field-type-aware masking for sensitive values.
 *
 * Replaces a fixed last-4 rule so each data type masks per its own policy:
 * - last4 (passport): bullet all but the last 4 chars.
 * - pan (card): show at most first 6 + last 4 (PCI DSS 3.4.1), bullet the middle.
 */

const BULLET = '•';

/**
 *
 * @param value
 * @example
 */
function maskLast4(value) {
  if (!value) return '';
  const v = String(value).trim();
  if (v.length <= 4) return BULLET.repeat(v.length);
  return BULLET.repeat(v.length - 4) + v.slice(-4);
}

/**
 *
 * @param value
 * @example
 */
function maskPan(value) {
  if (!value) return '';
  const v = String(value).replace(/\s+/g, '');
  if (v.length <= 10) return BULLET.repeat(v.length); // too short to safely show first6+last4
  const first6 = v.slice(0, 6);
  const last4 = v.slice(-4);
  return first6 + BULLET.repeat(v.length - 10) + last4;
}

/**
 * Mask a value according to a named rule.
 * @param {string} rule - 'last4' | 'pan'.
 * @param {string} value - Raw value.
 * @returns {string} Masked value.
 * @example
 */
function maskByRule(rule, value) {
  switch (rule) {
    case 'pan': return maskPan(value);
    case 'last4':
    default: return maskLast4(value);
  }
}

module.exports = { maskLast4, maskPan, maskByRule };
