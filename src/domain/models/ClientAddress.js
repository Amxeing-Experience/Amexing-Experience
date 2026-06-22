/**
 * ClientAddress - One of potentially several postal addresses for a Client.
 *
 * A Client can have multiple addresses; exactly one may be marked isFavorite.
 * Schema (Parse class ClientAddress): client (Pointer<Client>), label, street,
 * city, state, zipCode, country (String), isFavorite (Boolean).
 * @augments BaseModel
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

class ClientAddress extends BaseModel {
  constructor() {
    super('ClientAddress');
  }

  static create(data) {
    const address = new ClientAddress();

    if (data.ownerType && data.ownerId) {
      address.setOwner(data.ownerType, data.ownerId);
    } else if (data.client) {
      address.setClient(data.client);
    }
    address.set('label', data.label || '');
    address.set('street', data.street || '');
    address.set('city', data.city || '');
    address.set('state', data.state || '');
    address.set('zipCode', data.zipCode || '');
    address.set('country', data.country || 'MX');
    address.set('isFavorite', data.isFavorite === true);

    return address;
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

  getLabel() { return this.get('label') || ''; }

  setLabel(label) { this.set('label', label); }

  getStreet() { return this.get('street') || ''; }

  setStreet(street) { this.set('street', street); }

  getCity() { return this.get('city') || ''; }

  setCity(city) { this.set('city', city); }

  getState() { return this.get('state') || ''; }

  setState(state) { this.set('state', state); }

  getZipCode() { return this.get('zipCode') || ''; }

  setZipCode(zipCode) { this.set('zipCode', zipCode); }

  getCountry() { return this.get('country') || 'MX'; }

  setCountry(country) { this.set('country', country); }

  isFavorite() { return this.get('isFavorite') === true; }

  setIsFavorite(favorite) { this.set('isFavorite', favorite === true); }

  toJSON() {
    return {
      id: this.id,
      clientId: this.getOwnerId(),
      ownerType: this.getOwnerType(),
      label: this.getLabel(),
      street: this.getStreet(),
      city: this.getCity(),
      state: this.getState(),
      zipCode: this.getZipCode(),
      country: this.getCountry(),
      isFavorite: this.isFavorite(),
    };
  }

  static validate(data) {
    const errors = [];
    if (!data.client && !data.ownerId) errors.push('Owner (client or user) is required');
    if (!data.street || data.street.trim() === '') errors.push('Street is required');
    if (!data.city || data.city.trim() === '') errors.push('City is required');
    return errors;
  }

  /**
   * All addresses for a client, favorite first.
   * @param {string} clientId - Client objectId.
   * @returns {Promise<ClientAddress[]>}
   * @example
   */
  static async getByClient(clientId) {
    try {
      const Client = require('./Client');
      const pointer = new Client();
      pointer.id = clientId;

      const query = new Parse.Query('ClientAddress');
      query.equalTo('client', pointer);
      query.descending('isFavorite');
      query.ascending('label');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting addresses by client', { clientId, error: error.message });
      return [];
    }
  }

  static async getByOwner(ownerType, ownerId) {
    if (ownerType === 'amexingUser') {
      try {
        const AmexingUser = Parse.Object.extend('AmexingUser');
        const pointer = new AmexingUser();
        pointer.id = ownerId;
        const query = new Parse.Query('ClientAddress');
        query.equalTo('ownerUser', pointer);
        query.descending('isFavorite');
        query.ascending('label');
        return await query.find({ useMasterKey: true });
      } catch (error) {
        logger.error('Error getting addresses by owner user', { ownerId, error: error.message });
        return [];
      }
    }
    return ClientAddress.getByClient(ownerId);
  }
}

Parse.Object.registerSubclass('ClientAddress', ClientAddress);

module.exports = ClientAddress;
