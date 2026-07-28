/**
 * GatewayEvent - Domain model for payment gateway webhook events.
 *
 * One record per event received from a payment provider (Stripe/Openpay). Its whole
 * reason for existing is idempotency: a UNIQUE compound index on (gateway, eventId)
 * lets the webhook handler insert-and-catch the duplicate-value error (Parse code 137,
 * DUPLICATE_VALUE) instead of a race-prone check-then-act, so a provider that retries
 * the same event never gets processed twice under concurrency.
 *
 * The unique index is NOT created via Parse.Schema.addIndex (parse-server 9 copies only
 * {key, name}, never the `unique` flag) but directly via the Mongo driver at schema-seed
 * time — see scripts/seeds/026-create-gatewayevent-class.js (ensureGatewayEventUniqueIndex).
 *
 * Soft-delete and audit (modifiedBy/deletedBy/deletedAt) are inherited from BaseModel.
 * @augments BaseModel
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');

/**
 * GatewayEvent class for idempotent gateway webhook processing.
 * @class GatewayEvent
 * @augments BaseModel
 */
class GatewayEvent extends BaseModel {
  constructor() {
    super('GatewayEvent');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  getGateway() {
    return this.get('gateway');
  }

  setGateway(gateway) {
    this.set('gateway', gateway);
  }

  getEventId() {
    return this.get('eventId');
  }

  setEventId(eventId) {
    this.set('eventId', eventId);
  }

  getType() {
    return this.get('type');
  }

  setType(type) {
    this.set('type', type);
  }

  getProcessedAt() {
    return this.get('processedAt');
  }

  setProcessedAt(processedAt) {
    this.set('processedAt', processedAt);
  }

  getRaw() {
    return this.get('raw');
  }

  setRaw(raw) {
    this.set('raw', raw);
  }
}

// Register the subclass with Parse
Parse.Object.registerSubclass('GatewayEvent', GatewayEvent);

module.exports = GatewayEvent;
