/**
 * DataKey - The key store: one row per DEK version per data class.
 *
 * Holds the KEK-WRAPPED DEK only (never cleartext), in a collection separate from
 * the data it protects (satisfies PCI DSS 3.6.1.2 — DEK stored apart from the data,
 * wrapped by a separately-stored KEK). Lifecycle:
 * active   - used to encrypt new data and to decrypt
 * retiring - decrypt-only; rotation re-encrypts records off this key
 * retired  - no record references it anymore
 * Invariant: exactly one active DEK per dataClass.
 *
 * This class must have master-key-only CLP so it is never readable via REST/LiveQuery.
 */

const Parse = require('parse/node');

/**
 * Parse subclass for the key store: one row per KEK-wrapped DEK version per data class.
 * Stores only the wrapped DEK (never cleartext) and tracks its lifecycle status
 * (active, retiring, retired), with exactly one active DEK per dataClass.
 * @augments Parse.Object
 * @example
 * const dk = DataKey.create({ keyId: 'k1', dataClass: 'client.passport', wrappedDek, kekRef: 'env:v1' });
 * await dk.save(null, { useMasterKey: true });
 */
class DataKey extends Parse.Object {
  constructor() {
    super('DataKey');
  }

  static create({
    keyId, dataClass, wrappedDek, kekRef, status = 'active',
  }) {
    const dk = new DataKey();
    dk.set('keyId', keyId);
    dk.set('dataClass', dataClass);
    dk.set('wrappedDek', wrappedDek);
    dk.set('kekRef', kekRef);
    dk.set('status', status);
    return dk;
  }

  getKeyId() { return this.get('keyId'); }

  getDataClass() { return this.get('dataClass'); }

  getWrappedDek() { return this.get('wrappedDek'); }

  getKekRef() { return this.get('kekRef'); }

  getStatus() { return this.get('status'); }

  setStatus(status) { this.set('status', status); }

  static async findActive(dataClass) {
    const query = new Parse.Query('DataKey');
    query.equalTo('dataClass', dataClass);
    query.equalTo('status', 'active');
    return query.first({ useMasterKey: true });
  }

  static async findByKeyId(keyId) {
    const query = new Parse.Query('DataKey');
    query.equalTo('keyId', keyId);
    return query.first({ useMasterKey: true });
  }

  static async findByStatus(dataClass, status) {
    const query = new Parse.Query('DataKey');
    query.equalTo('dataClass', dataClass);
    query.equalTo('status', status);
    return query.find({ useMasterKey: true });
  }
}

Parse.Object.registerSubclass('DataKey', DataKey);

module.exports = DataKey;
