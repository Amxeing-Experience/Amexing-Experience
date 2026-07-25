/**
 * GatewayRegistry - id -> adapter instance map, populated by an explicit registration
 * at bootstrap (plan seccion 4.3). Exposes register / resolve / list / has. Adding a
 * future gateway is one register() line, with zero changes to callers.
 *
 * The id is always derived from the adapter's own getId(), never passed separately:
 * this is the single source of truth for the id and structurally prevents the exact
 * naming mismatch that broke the abandoned branch (an adapter self-identifying as one
 * id but registered under another).
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const PaymentGatewayError = require('./PaymentGatewayError');
const PaymentGatewayService = require('./PaymentGatewayService');

/**
 * Capabilities every adapter must expose as functions to be registrable.
 * @type {readonly string[]}
 */
const REQUIRED_METHODS = Object.freeze([
  'getId',
  'getSupportedCurrencies',
  'isConfigured',
  'createCharge',
  'getCharge',
  'refund',
  'verifyWebhook',
]);

/**
 * Fail-fast shape validation (Decision #2). Confirms the instance exposes all
 * required capabilities as functions (even ones that would throw NOT_IMPLEMENTED when
 * called must at least EXIST) and returns a usable, non-empty id from getId().
 * @param {object} adapter - Candidate adapter instance.
 * @returns {string} The adapter's own id, to be used as the registry key.
 * @throws {PaymentGatewayError} PROVIDER_ERROR when the shape is invalid.
 */
function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new PaymentGatewayError(
      PaymentGatewayError.CODES.PROVIDER_ERROR,
      'A gateway adapter instance is required to register'
    );
  }

  const missing = REQUIRED_METHODS.find((method) => typeof adapter[method] !== 'function');
  if (missing) {
    throw new PaymentGatewayError(
      PaymentGatewayError.CODES.PROVIDER_ERROR,
      `Gateway adapter is missing required capability "${missing}"`
    );
  }

  // A subclass of PaymentGatewayService that forgets to override a required capability
  // still passes the typeof-function check (it inherits the base abstract stub, which IS
  // a function) and would only throw NOT_IMPLEMENTED when that method is invoked at
  // runtime, in production. Reuse the own-vs-inherited technique from
  // PaymentGatewayService.notImplemented: when adapter[method] is the SAME reference as
  // the base prototype's method, it was never overridden. Fail loud at registration.
  const inheritedStub = REQUIRED_METHODS.find(
    (method) => adapter[method] === PaymentGatewayService.prototype[method]
  );
  if (inheritedStub) {
    throw new PaymentGatewayError(
      PaymentGatewayError.CODES.PROVIDER_ERROR,
      `Gateway adapter inherits the abstract stub for "${inheritedStub}" without overriding it`
    );
  }

  let id;
  try {
    id = adapter.getId();
  } catch {
    // An adapter that cannot even identify itself cannot be keyed into the map.
    throw new PaymentGatewayError(
      PaymentGatewayError.CODES.PROVIDER_ERROR,
      'Gateway adapter getId() must return an id to be registered'
    );
  }
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new PaymentGatewayError(
      PaymentGatewayError.CODES.PROVIDER_ERROR,
      'Gateway adapter getId() must return a non-empty string'
    );
  }
  return id;
}

/**
 * Registry of gateway adapters. Instance-based (not a module singleton) so callers
 * and tests never share mutable state.
 */
class GatewayRegistry {
  constructor() {
    this.adapters = new Map();
  }

  /**
   * Register an adapter under its own getId().
   * @param {object} adapter - Adapter instance implementing the full contract.
   * @returns {GatewayRegistry} this, for chaining.
   * @throws {PaymentGatewayError} PROVIDER_ERROR on a malformed adapter or a
   * duplicate id.
   */
  register(adapter) {
    const id = validateAdapter(adapter);
    // Decision #1: a second registration under the same id is almost always an
    // accidental double-registration at bootstrap. Fail loud rather than silently
    // overwrite a live gateway instance.
    if (this.adapters.has(id)) {
      throw new PaymentGatewayError(
        PaymentGatewayError.CODES.PROVIDER_ERROR,
        `A gateway is already registered under id "${id}"`,
        { gateway: id }
      );
    }
    this.adapters.set(id, adapter);
    return this;
  }

  /**
   * Resolve a registered adapter by id.
   * @param {string} id - Gateway id.
   * @returns {object} The registered adapter instance.
   * @throws {PaymentGatewayError} UNKNOWN_GATEWAY when the id is not a non-empty
   * string or was never registered (typed error, never a raw TypeError).
   */
  resolve(id) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new PaymentGatewayError(
        PaymentGatewayError.CODES.UNKNOWN_GATEWAY,
        'A non-empty string gateway id is required to resolve an adapter'
      );
    }
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new PaymentGatewayError(
        PaymentGatewayError.CODES.UNKNOWN_GATEWAY,
        `No gateway is registered under id "${id}"`,
        { gateway: id }
      );
    }
    return adapter;
  }

  /**
   * @param {string} id - Gateway id.
   * @returns {boolean} True when an adapter is registered under id.
   */
  has(id) {
    return typeof id === 'string' && this.adapters.has(id);
  }

  /**
   * @returns {string[]} The ids of all registered adapters.
   */
  list() {
    return Array.from(this.adapters.keys());
  }
}

module.exports = GatewayRegistry;
