/**
 * ClientDocument - One of potentially several supporting documents for a Client (or AmexingUser
 * agent). Unlike ClientPassport there is no field-level encryption: the file lives in S3 (already
 * AES256 at rest), so we only flag whether the document is sensitive. Schema (Parse class
 * ClientDocument): polymorphic owner (client Pointer<Client> or ownerUser Pointer<AmexingUser>),
 * label, customLabel, fileName, mimeType, size, s3Key, isSensitive, uploadedBy (Pointer<AmexingUser>).
 * @augments BaseModel
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

// Predefined document labels (Spanish MX). "Otro documento" requires a customLabel.
const DOCUMENT_LABELS = [
  'Identificación oficial (INE)',
  'Pasaporte',
  'Visa',
  'Comprobante de pago',
  'Boletos / pase de abordar',
  'Voucher / confirmación de reserva',
  'Seguro de viaje',
  'Datos fiscales (RFC)',
  'Otro documento',
];

// Labels that hold personally sensitive data → isSensitive=true. Financial (Comprobante de pago:
// CLABE/cuenta/tarjeta) and health-adjacent (Seguro de viaje: declaraciones médicas) documents carry
// the same identity-theft/legal-sensitive-data risk as the identity docs already on this list.
const SENSITIVE_LABELS = [
  'Identificación oficial (INE)',
  'Pasaporte',
  'Visa',
  'Datos fiscales (RFC)',
  'Comprobante de pago',
  'Seguro de viaje',
];

/**
 * Parse subclass modeling a single supporting document belonging to a Client (or AmexingUser).
 * The file itself is stored in S3 (the controller resolves a presigned URL from s3Key); the row
 * carries metadata plus an isSensitive flag derived from the label.
 * @augments BaseModel
 * @example
 * const doc = ClientDocument.create({ ownerType: 'client', ownerId: 'abc123', label: 'Visa', s3Key });
 * await doc.save(null, { useMasterKey: true });
 */
class ClientDocument extends BaseModel {
  constructor() {
    super('ClientDocument');
  }

  // Whether a label requires a free-text customLabel ("Otro documento").
  static labelRequiresCustom(label) {
    return label === 'Otro documento';
  }

  // Sensitivity is derived from the label (no caller override).
  static isSensitiveLabel(label) {
    return SENSITIVE_LABELS.includes(label);
  }

  static create(data) {
    const doc = new ClientDocument();

    if (data.ownerType && data.ownerId) {
      doc.setOwner(data.ownerType, data.ownerId);
    } else if (data.client) {
      doc.setClient(data.client);
    }
    doc.set('label', data.label || '');
    doc.set('customLabel', data.customLabel || '');
    doc.set('fileName', data.fileName || '');
    doc.set('mimeType', data.mimeType || '');
    if (data.size !== undefined) doc.set('size', data.size);
    if (data.s3Key !== undefined) doc.set('s3Key', data.s3Key);
    doc.set('isSensitive', data.isSensitive === true);
    if (data.uploadedBy) doc.setUploadedBy(data.uploadedBy);
    doc.set('active', true);
    doc.set('exists', true);

    return doc;
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

  getLabel() { return this.get('label') || ''; }

  setLabel(label) { this.set('label', label); }

  getCustomLabel() { return this.get('customLabel') || ''; }

  setCustomLabel(v) { this.set('customLabel', v); }

  getFileName() { return this.get('fileName') || ''; }

  setFileName(v) { this.set('fileName', v); }

  getMimeType() { return this.get('mimeType') || ''; }

  setMimeType(v) { this.set('mimeType', v); }

  getSize() { return this.get('size') || 0; }

  setSize(v) { this.set('size', v); }

  // S3 key of the document uploaded via the S3 pipeline (the controller resolves a presigned URL).
  getS3Key() { return this.get('s3Key') || null; }

  setS3Key(key) { this.set('s3Key', key); }

  isSensitive() { return this.get('isSensitive') === true; }

  setSensitive(v) { this.set('isSensitive', v === true); }

  getUploadedBy() { return this.get('uploadedBy') || null; }

  setUploadedBy(user) {
    if (typeof user === 'string') {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const pointer = new AmexingUser();
      pointer.id = user;
      this.set('uploadedBy', pointer);
    } else {
      this.set('uploadedBy', user);
    }
  }

  /**
   * Safe serialization for API responses. The controller resolves the presigned documentUrl from
   * s3Key (the raw key is included here so it can do so).
   * @returns {object} Plain object with id, ownerType, ownerId, label, customLabel, fileName, mimeType, size, isSensitive, s3Key, createdAt.
   * @example
   * const json = doc.toSafeJSON();
   */
  toSafeJSON() {
    return {
      id: this.id,
      ownerType: this.getOwnerType(),
      ownerId: this.getOwnerId(),
      label: this.getLabel(),
      customLabel: this.getCustomLabel(),
      fileName: this.getFileName(),
      mimeType: this.getMimeType(),
      size: this.getSize(),
      isSensitive: this.isSensitive(),
      s3Key: this.getS3Key(),
      createdAt: this.get('createdAt'),
    };
  }

  static validate(data) {
    const errors = [];
    if (!data.client && !data.ownerId) errors.push('Owner (client or user) is required');
    if (!data.label || !DOCUMENT_LABELS.includes(data.label)) errors.push('A valid label is required');
    if (ClientDocument.labelRequiresCustom(data.label) && (!data.customLabel || !data.customLabel.trim())) {
      errors.push('customLabel is required for "Otro documento"');
    }
    return errors;
  }

  /**
   * Active, existing documents for an owner (Client or AmexingUser), newest first.
   * @param {string} ownerType - 'client' or 'amexingUser'.
   * @param {string} ownerId - Owner objectId.
   * @returns {Promise<ClientDocument[]>}
   * @example
   */
  static async getByOwner(ownerType, ownerId) {
    try {
      const query = new Parse.Query('ClientDocument');
      if (ownerType === 'amexingUser') {
        const AmexingUser = Parse.Object.extend('AmexingUser');
        const pointer = new AmexingUser();
        pointer.id = ownerId;
        query.equalTo('ownerUser', pointer);
      } else {
        const Client = require('./Client');
        const pointer = new Client();
        pointer.id = ownerId;
        query.equalTo('client', pointer);
      }
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.descending('createdAt');
      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting documents by owner', { ownerType, ownerId, error: error.message });
      return [];
    }
  }
}

Parse.Object.registerSubclass('ClientDocument', ClientDocument);

module.exports = ClientDocument;
module.exports.DOCUMENT_LABELS = DOCUMENT_LABELS;
module.exports.SENSITIVE_LABELS = SENSITIVE_LABELS;
