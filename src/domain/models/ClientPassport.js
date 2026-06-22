/**
 * ClientPassport - One of potentially several passports for a Client.
 *
 * The passport number is envelope-encrypted via SensitiveDataVault (same engine and
 * 'client.passport' field policy as Client) and only ever returned masked unless an
 * authorized role reveals it (audited). Schema (Parse class ClientPassport): client
 * (Pointer<Client>), passportNumberEncrypted, passportDocument (File), countryOfIssue,
 * nationality, dateOfIssue (Date), expirationDate (Date), label.
 * @augments BaseModel
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

const FIELD_KEY = 'client.passport';

class ClientPassport extends BaseModel {
  constructor() {
    super('ClientPassport');
  }

  // Date columns must be Date objects, not the strings the UI sends (e.g. '2019-07-16').
  static toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  static create(data) {
    const passport = new ClientPassport();

    if (data.ownerType && data.ownerId) {
      passport.setOwner(data.ownerType, data.ownerId);
    } else if (data.client) {
      passport.setClient(data.client);
    }
    passport.set('label', data.label || '');
    passport.set('countryOfIssue', data.countryOfIssue || '');
    passport.set('nationality', data.nationality || '');
    if (data.dateOfIssue !== undefined) passport.set('dateOfIssue', ClientPassport.toDate(data.dateOfIssue));
    if (data.expirationDate !== undefined) passport.set('expirationDate', ClientPassport.toDate(data.expirationDate));
    if (data.passportDocument !== undefined) passport.set('passportDocument', data.passportDocument);

    return passport;
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

  // Set the owner as either a Client ('client') or an AmexingUser ('amexingUser').
  setOwner(ownerType, ownerId) {
    if (ownerType === 'amexingUser') {
      // AmexingUser is not a registered Parse subclass — build the pointer via extend().
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

  static async getByOwner(ownerType, ownerId) {
    if (ownerType === 'amexingUser') {
      try {
        const AmexingUser = Parse.Object.extend('AmexingUser');
        const pointer = new AmexingUser();
        pointer.id = ownerId;
        const query = new Parse.Query('ClientPassport');
        query.equalTo('ownerUser', pointer);
        query.ascending('label');
        return await query.find({ useMasterKey: true });
      } catch (error) {
        logger.error('Error getting passports by owner user', { ownerId, error: error.message });
        return [];
      }
    }
    return ClientPassport.getByClient(ownerId);
  }

  getLabel() { return this.get('label') || ''; }

  setLabel(label) { this.set('label', label); }

  getCountryOfIssue() { return this.get('countryOfIssue') || ''; }

  setCountryOfIssue(v) { this.set('countryOfIssue', v); }

  getNationality() { return this.get('nationality') || ''; }

  setNationality(v) { this.set('nationality', v); }

  getDateOfIssue() { return this.get('dateOfIssue') || null; }

  setDateOfIssue(v) { this.set('dateOfIssue', ClientPassport.toDate(v)); }

  getExpirationDate() { return this.get('expirationDate') || null; }

  setExpirationDate(v) { this.set('expirationDate', ClientPassport.toDate(v)); }

  getPassportDocument() { return this.get('passportDocument') || null; }

  setPassportDocument(file) { this.set('passportDocument', file); }

  // ---- Passport number (encrypted at rest via SensitiveDataVault, masked by default) ----

  hasNumber() { return !!this.get('passportNumberEncrypted'); }

  // Encrypt a raw passport number for storage. Async (key resolution is async).
  async setNumber(rawValue) {
    const vault = require('../../application/services/SensitiveDataVault');
    if (!rawValue) {
      this.unset('passportNumberEncrypted');
      return;
    }
    this.set('passportNumberEncrypted', await vault.encryptField(FIELD_KEY, rawValue));
  }

  // Masked number (last 4); safe to return anywhere, audited as a masked read.
  async getNumberMasked(ctx = {}) {
    const vault = require('../../application/services/SensitiveDataVault');
    return vault.maskField(FIELD_KEY, this.get('passportNumberEncrypted'), { ...ctx, recordId: this.id });
  }

  // Decrypt the full number — authorized + audited by the vault (default-deny).
  async getNumber(ctx = {}) {
    const vault = require('../../application/services/SensitiveDataVault');
    const user = ctx.user || ctx;
    return vault.decryptField(FIELD_KEY, this.get('passportNumberEncrypted'), { user, recordId: this.id });
  }

  // Safe serialization: masked number only, never the raw/encrypted value.
  async toSafeJSON(ctx = {}) {
    return {
      id: this.id,
      clientId: this.getOwnerId(),
      ownerType: this.getOwnerType(),
      label: this.getLabel(),
      hasNumber: this.hasNumber(),
      numberMasked: await this.getNumberMasked(ctx),
      countryOfIssue: this.getCountryOfIssue(),
      nationality: this.getNationality(),
      dateOfIssue: this.getDateOfIssue(),
      expirationDate: this.getExpirationDate(),
      passportDocument: this.getPassportDocument() ? this.getPassportDocument().url() : null,
    };
  }

  static validate(data) {
    const errors = [];
    if (!data.client && !data.ownerId) errors.push('Owner (client or user) is required');
    return errors;
  }

  /**
   * All passports for a client.
   * @param {string} clientId - Client objectId.
   * @returns {Promise<ClientPassport[]>}
   * @example
   */
  static async getByClient(clientId) {
    try {
      const Client = require('./Client');
      const pointer = new Client();
      pointer.id = clientId;

      const query = new Parse.Query('ClientPassport');
      query.equalTo('client', pointer);
      query.ascending('label');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting passports by client', { clientId, error: error.message });
      return [];
    }
  }
}

Parse.Object.registerSubclass('ClientPassport', ClientPassport);

module.exports = ClientPassport;
