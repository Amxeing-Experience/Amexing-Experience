/**
 * PaymentGatewayError - typed error for the payment gateway abstraction layer.
 *
 * Normalizes every failure that any gateway adapter (Stripe/Openpay/...) can raise
 * into a small, closed set of codes so the caller can map a failure to an HTTP
 * response without ever interpreting a provider's own error vocabulary (plan
 * seccion 4.2). Defense-in-depth for a PCI-DSS-adjacent codebase: PAN-like digit
 * runs are masked out of the human-facing message, and the raw provider payload is
 * kept non-enumerable so it can never leak through JSON/structured logging.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

/**
 * Closed set of normalized error codes.
 *
 * The first six map 1:1 to plan seccion 4.2. UNKNOWN_GATEWAY is the 7th
 * (Decision #3): it is semantically distinct from NOT_CONFIGURED. NOT_CONFIGURED =
 * a gateway that IS registered but has no valid credentials yet; UNKNOWN_GATEWAY =
 * an id that was never registered at all.
 * @type {Readonly<object>}
 */
const CODES = Object.freeze({
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  UNSUPPORTED_CURRENCY: 'UNSUPPORTED_CURRENCY',
  CARD_DECLINED: 'CARD_DECLINED',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  UNKNOWN_GATEWAY: 'UNKNOWN_GATEWAY',
});

const VALID_CODES = new Set(Object.values(CODES));

// Decision #9: basic PAN redaction. A card number is 13-19 digits, but humans copy-paste
// PANs grouped with single space/dash/dot separators (e.g. 4-4-4-4 or 4-6-5), which a
// plain consecutive-digit pattern would miss. We instead capture any run that begins and
// ends on a digit and is made only of digits + those separators, then count the digits in
// the callback and mask the whole run once it holds at least a full PAN's worth (>= 13).
// Anchoring on \d at both ends preserves surrounding whitespace/punctuation; the single
// unbounded repetition (no nested quantifier) keeps star height 1 -> not ReDoS-prone. No
// upper digit cap: an over-long run may still embed a PAN, so it is masked in full.
const PAN_PATTERN = /\d[\d .-]{11,}\d/g;
const PAN_MIN_DIGITS = 13;

/**
 * Mask PAN-like digit runs inside a string, including groups split by single space, dash,
 * or dot separators (standard card grouping). A candidate is only masked when it actually
 * carries >= 13 digits, so separator-heavy short sequences (phone numbers, dates) survive.
 * @param {string} text - Text to sanitize (already coerced to a string).
 * @returns {string} Text with any PAN-like sequence replaced by a fixed mask.
 */
function redactPan(text) {
  return String(text).replace(PAN_PATTERN, (match) => {
    const digitCount = match.replace(/\D/g, '').length;
    return digitCount >= PAN_MIN_DIGITS ? '[REDACTED]' : match;
  });
}

/**
 * Typed, normalized payment gateway error.
 * @augments Error
 */
class PaymentGatewayError extends Error {
  /**
   * @param {string} code - One of PaymentGatewayError.CODES.
   * @param {string} [message] - Safe, human-facing message (will be PAN-redacted).
   * @param {object} [options] - Extra, non-sensitive context.
   * @param {string} [options.gateway] - Gateway id related to the error, when known.
   * @param {*} [options.providerError] - Raw provider payload, kept for internal
   * audit only (non-enumerable, never serialized).
   */
  constructor(code, message, options) {
    // Decision #8: reject any code outside the closed set synchronously. This turns a
    // typo (e.g. 'NOT_CONFIGURD') into an immediate, loud failure during development
    // instead of a silently-miscoded error at runtime.
    if (!VALID_CODES.has(code)) {
      throw new Error(`PaymentGatewayError: unknown error code "${String(code)}"`);
    }

    const opts = options && typeof options === 'object' ? options : {};

    // Decision #9: never let a non-string argument (e.g. a raw provider error object,
    // which may embed a PAN) reach .message. Coerce to the code as a safe fallback,
    // then PAN-redact whatever remains.
    const rawMessage = typeof message === 'string' && message.length > 0 ? message : code;
    super(redactPan(rawMessage));

    this.name = 'PaymentGatewayError';
    this.code = code;
    this.gateway = typeof opts.gateway === 'string' ? opts.gateway : null;

    // Decision #9: the raw provider payload is retained for internal audit ONLY, as a
    // non-enumerable property, so JSON.stringify and structured loggers never emit it.
    Object.defineProperty(this, 'providerError', {
      value: 'providerError' in opts ? opts.providerError : null,
      enumerable: false,
      writable: false,
      configurable: false,
    });

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, PaymentGatewayError);
    }
  }

  /**
   * Curated serialization: only safe fields. Never exposes providerError or the
   * stack trace, so logging the serialized error cannot leak provider internals.
   * @returns {{name: string, code: string, message: string, gateway: (string|null)}}
   * The safe, log/user-facing shape.
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      gateway: this.gateway,
    };
  }
}

PaymentGatewayError.CODES = CODES;

module.exports = PaymentGatewayError;
