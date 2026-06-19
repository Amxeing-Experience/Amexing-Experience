/**
 * TravelPreference - A single travel preference for a Client.
 *
 * Each record is one (type, option) pair, e.g. type "tour_interest" option "viñedos"
 * or type "transport_category" option "Sprinter". A client has many.
 * Schema (Parse class TravelPreference): client (Pointer<Client>), type, option (String).
 * @augments BaseModel
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

class TravelPreference extends BaseModel {
  constructor() {
    super('TravelPreference');
  }

  static create(data) {
    const pref = new TravelPreference();

    if (data.client) {
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

  getType() { return this.get('type') || ''; }
  setType(type) { this.set('type', type); }

  getOption() { return this.get('option') || ''; }
  setOption(option) { this.set('option', option); }

  toJSON() {
    const client = this.get('client');
    return {
      id: this.id,
      clientId: client ? client.id : null,
      type: this.getType(),
      option: this.getOption(),
    };
  }

  static validate(data) {
    const errors = [];
    if (!data.client) errors.push('Client is required');
    if (!data.type || data.type.trim() === '') errors.push('Type is required');
    if (!data.option || data.option.trim() === '') errors.push('Option is required');
    return errors;
  }

  /**
   * All preferences for a client, grouped-friendly (ordered by type then option).
   * @param {string} clientId - Client objectId.
   * @returns {Promise<TravelPreference[]>}
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
}

Parse.Object.registerSubclass('TravelPreference', TravelPreference);

module.exports = TravelPreference;
