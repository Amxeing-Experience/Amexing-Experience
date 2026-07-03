/**
 * TravelPreference - A single travel preference for a Client.
 *
 * Each record is one (type, option) pair, e.g. Type "tour_interest" option "viñedos"
 * or type "transport_category" option "Sprinter". A client has many.
 * Schema (Parse class TravelPreference): client (Pointer<Client>), type, option (String).
 * @augments BaseModel
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * Parse subclass modeling a single (type, option) travel preference for a Client
 * (or AmexingUser), e.g. Type "tour_interest" with option "viñedos". A client may
 * have many such records.
 * @augments BaseModel
 * @example
 * const pref = TravelPreference.create({ client: 'abc123', type: 'tour_interest', option: 'viñedos' });
 * await pref.save(null, { useMasterKey: true });
 */
class TravelPreference extends BaseModel {
  constructor() {
    super('TravelPreference');
  }

  static create(data) {
    const pref = new TravelPreference();

    if (data.ownerType && data.ownerId) {
      pref.setOwner(data.ownerType, data.ownerId);
    } else if (data.client) {
      pref.setClient(data.client);
    }
    pref.set('type', data.type || '');
    pref.set('option', data.option || '');

    return pref;
  }

  getClient() {
    return this.get('client');
  }

  setClient(client) {
    if (typeof client === 'string') {
      const Client = require('./Client');
      const pointer = new Client();
      pointer.id = client;
      this.set('client', pointer);
    } else {
      this.set('client', client);
    }
  }

  // ---- Polymorphic owner (Client or AmexingUser). Legacy rows have no ownerType ⇒ 'client'. ----

  getOwnerType() { return this.get('ownerType') || 'client'; }

  getOwnerId() {
    if (this.getOwnerType() === 'amexingUser') {
      const u = this.get('ownerUser');
      return u ? u.id : null;
    }
    const c = this.get('client');
    return c ? c.id : null;
  }

  setOwner(ownerType, ownerId) {
    if (ownerType === 'amexingUser') {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const pointer = new AmexingUser();
      pointer.id = ownerId;
      this.set('ownerType', 'amexingUser');
      this.set('ownerUser', pointer);
      this.unset('client');
    } else {
      this.setClient(ownerId);
      this.set('ownerType', 'client');
      this.unset('ownerUser');
    }
  }

  getType() { return this.get('type') || ''; }

  setType(type) { this.set('type', type); }

  getOption() { return this.get('option') || ''; }

  setOption(option) { this.set('option', option); }

  /**
   * Serialize this preference to a plain object for API responses.
   * @returns {object} Plain object with id, clientId, ownerType, type and option.
   * @example
   * const json = pref.toJSON();
   * // { id: '...', clientId: '...', ownerType: 'client', type: 'tour_interest', option: 'viñedos' }
   */
  toJSON() {
    return {
      id: this.id,
      clientId: this.getOwnerId(),
      ownerType: this.getOwnerType(),
      type: this.getType(),
      option: this.getOption(),
    };
  }

  static validate(data) {
    const errors = [];
    if (!data.client && !data.ownerId) errors.push('Owner (client or user) is required');
    if (!data.type || data.type.trim() === '') errors.push('Type is required');
    if (!data.option || data.option.trim() === '') errors.push('Option is required');
    return errors;
  }

  /**
   * All preferences for a client, grouped-friendly (ordered by type then option).
   * @param {string} clientId - Client objectId.
   * @returns {Promise<TravelPreference[]>}
   * @example
   */
  static async getByClient(clientId) {
    try {
      const Client = require('./Client');
      const pointer = new Client();
      pointer.id = clientId;

      const query = new Parse.Query('TravelPreference');
      query.equalTo('client', pointer);
      query.ascending('type');
      query.addAscending('option');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting travel preferences by client', { clientId, error: error.message });
      return [];
    }
  }

  static async getByOwner(ownerType, ownerId) {
    if (ownerType === 'amexingUser') {
      try {
        const AmexingUser = Parse.Object.extend('AmexingUser');
        const pointer = new AmexingUser();
        pointer.id = ownerId;
        const query = new Parse.Query('TravelPreference');
        query.equalTo('ownerUser', pointer);
        query.ascending('type');
        query.addAscending('option');
        return await query.find({ useMasterKey: true });
      } catch (error) {
        logger.error('Error getting travel preferences by owner user', { ownerId, error: error.message });
        return [];
      }
    }
    return TravelPreference.getByClient(ownerId);
  }
}

Parse.Object.registerSubclass('TravelPreference', TravelPreference);

module.exports = TravelPreference;
