/**
 * ClientProfileController - RESTful API for a Client's profile sub-resources:
 * addresses (ClientAddress), travel preferences (TravelPreference), and loyalty
 * programs (the Client.loyaltyPrograms array of { type, number }).
 *
 * Mirrors ClientEmployeesController conventions: nested under /api/clients/:clientId,
 * useMasterKey writes, sendSuccess/sendError responses, audit logging. Restricted to
 * SuperAdmin/Admin via the route's validateClientAccess middleware.
 * @author Amexing Development Team
 * @version 1.0.0
 */

const multer = require('multer');
const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');
const ClientAddress = require('../../../domain/models/ClientAddress');
const TravelPreference = require('../../../domain/models/TravelPreference');
const ClientPassport = require('../../../domain/models/ClientPassport');
const FileStorageService = require('../../services/FileStorageService');
const ServerImageOptimizationService = require('../../services/ServerImageOptimizationService');

// Accepted document types for a passport copy (image or PDF) and the upload size cap.
const PASSPORT_DOC_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const PASSPORT_DOC_MIME = /^(image\/|application\/pdf$)/;

// Multer (memory storage) for the passport document upload — mirrors ProfileImageController.
const passportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PASSPORT_DOC_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (PASSPORT_DOC_MIME.test(file.mimetype)) cb(null, true);
    else cb(new Error('Tipo de archivo no permitido. Solo imágenes o PDF.'));
  },
});

/**
 * Controller exposing RESTful handlers for a Client/AmexingUser profile's
 * sub-resources: addresses, travel preferences, loyalty programs, passports and trips.
 * @example
 */
class ClientProfileController {
  constructor() {
    // Image variants go through the optimizer; PDFs use FileStorageService's direct S3 upload.
    this.serverOptimizationService = new ServerImageOptimizationService();
    this.fileStorageService = new FileStorageService();

    this.getAddresses = this.getAddresses.bind(this);
    this.createAddress = this.createAddress.bind(this);
    this.updateAddress = this.updateAddress.bind(this);
    this.deleteAddress = this.deleteAddress.bind(this);
    this.getTravelPreferences = this.getTravelPreferences.bind(this);
    this.createTravelPreference = this.createTravelPreference.bind(this);
    this.updateTravelPreference = this.updateTravelPreference.bind(this);
    this.deleteTravelPreference = this.deleteTravelPreference.bind(this);
    this.getLoyaltyPrograms = this.getLoyaltyPrograms.bind(this);
    this.saveLoyaltyPrograms = this.saveLoyaltyPrograms.bind(this);
    this.getPassports = this.getPassports.bind(this);
    this.createPassport = this.createPassport.bind(this);
    this.updatePassport = this.updatePassport.bind(this);
    this.uploadPassportDocument = this.uploadPassportDocument.bind(this);
    this.deletePassport = this.deletePassport.bind(this);
    this.revealPassportNumber = this.revealPassportNumber.bind(this);
    this.getTrips = this.getTrips.bind(this);
  }

  // ---------- helpers ----------

  // Owner is decided by the route family, not the body:
  //   /api/clients/:clientId/...  → Client owner
  //   /api/agents/:agentId/...    → AmexingUser owner
  /**
   * Derive the owner (type and id) from the request route params.
   * @param {object} req - Express request.
   * @returns {{ownerType: string, ownerId: string}} The resolved owner descriptor.
   * @example
   */
  resolveOwner(req) {
    if (req.params.agentId) return { ownerType: 'amexingUser', ownerId: req.params.agentId };
    return { ownerType: 'client', ownerId: req.params.clientId };
  }

  // Validate the owner exists, branching on type. Returns the Parse object.
  /**
   * Validate that the owner exists, branching on owner type.
   * @param {{ownerType: string, ownerId: string}} owner - The owner descriptor.
   * @returns {Promise<Parse.Object>} The resolved owner Parse object.
   * @example
   */
  async validateOwnerExists({ ownerType, ownerId }) {
    if (ownerType === 'amexingUser') {
      const query = new Parse.Query('AmexingUser');
      query.equalTo('exists', true);
      const user = await query.get(ownerId, { useMasterKey: true });
      if (!user) throw new Error('User not found');
      return user;
    }
    return this.validateClientExists(ownerId);
  }

  /**
   * Validate that a Client record exists and is not soft-deleted.
   * @param {string} clientId - The Client objectId.
   * @returns {Promise<Parse.Object>} The resolved Client Parse object.
   * @example
   */
  async validateClientExists(clientId) {
    const query = new Parse.Query('Client');
    query.equalTo('exists', true);
    const client = await query.get(clientId, { useMasterKey: true });
    if (!client) throw new Error('Client not found');
    return client;
  }

  /**
   * Send a standardized success JSON response.
   * @param {object} res - Express response.
   * @param {*} data - Payload to return under the data key.
   * @param {string} [message] - Human-readable success message.
   * @param {number} [statusCode] - HTTP status code.
   * @returns {void}
   * @example
   */
  sendSuccess(res, data, message = 'Success', statusCode = 200) {
    res.status(statusCode).json({
      success: true, data, message, timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send a standardized error JSON response.
   * @param {object} res - Express response.
   * @param {string} message - Error message to return.
   * @param {number} [statusCode] - HTTP status code.
   * @returns {void}
   * @example
   */
  sendError(res, message, statusCode = 500) {
    res.status(statusCode).json({
      success: false, error: message, timestamp: new Date().toISOString(),
    });
  }

  // Find a sub-record and confirm it belongs to the owner (Client or AmexingUser) in the path.
  /**
   * Fetch a sub-record and confirm it belongs to the given owner, else throw 403.
   * @param {string} className - The Parse class name of the sub-record.
   * @param {string} recordId - The objectId of the sub-record.
   * @param {{ownerType: string, ownerId: string}} owner - The expected owner descriptor.
   * @returns {Promise<Parse.Object>} The owned record Parse object.
   * @example
   */
  async findOwnedRecord(className, recordId, owner) {
    const record = await new Parse.Query(className).get(recordId, { useMasterKey: true });
    // Models expose getOwnerId()/getOwnerType(); legacy rows resolve to ('client', client.id).
    let recordOwnerId;
    if (typeof record.getOwnerId === 'function') {
      recordOwnerId = record.getOwnerId();
    } else {
      recordOwnerId = record.get('client') ? record.get('client').id : null;
    }
    const recordOwnerType = typeof record.getOwnerType === 'function'
      ? record.getOwnerType()
      : 'client';
    if (recordOwnerId !== owner.ownerId || recordOwnerType !== owner.ownerType) {
      const err = new Error('Record does not belong to specified owner');
      err.status = 403;
      throw err;
    }
    return record;
  }

  // ---------- addresses ----------

  async getAddresses(req, res) {
    const owner = this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);
      const addresses = await ClientAddress.getByOwner(owner.ownerType, owner.ownerId);
      this.sendSuccess(res, { addresses: addresses.map((a) => a.toJSON()) }, 'Addresses retrieved successfully');
    } catch (error) {
      logger.error('Error in ClientProfileController.getAddresses', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, 'Failed to retrieve addresses', error.status || 500);
    }
  }

  /**
   * Create a new address for the owner, enforcing single-favorite invariant.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async createAddress(req, res) {
    const owner = this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);

      const data = { ...req.body, ownerType: owner.ownerType, ownerId: owner.ownerId };
      const errors = ClientAddress.validate(data);
      if (errors.length) return this.sendError(res, errors.join(', '), 400);

      const address = ClientAddress.create(data);
      if (data.isFavorite) await this.clearFavoriteAddress(owner);
      await address.save(null, { useMasterKey: true });

      logger.info('Address created', { ...owner, addressId: address.id, userId: req.user?.id });
      this.sendSuccess(res, { address: address.toJSON() }, 'Dirección creada exitosamente', 201);
    } catch (error) {
      logger.error('Error in ClientProfileController.createAddress', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  async updateAddress(req, res) {
    const owner = this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);
      const address = await this.findOwnedRecord('ClientAddress', req.params.id, owner);

      const fields = ['label', 'street', 'city', 'state', 'zipCode', 'colonia', 'country'];
      fields.forEach((f) => { if (req.body[f] !== undefined) address.set(f, req.body[f]); });
      if (req.body.isFavorite === true) {
        await this.clearFavoriteAddress(owner);
        address.set('isFavorite', true);
      } else if (req.body.isFavorite === false) {
        address.set('isFavorite', false);
      }
      await address.save(null, { useMasterKey: true });

      this.sendSuccess(res, { address: address.toJSON() }, 'Dirección actualizada');
    } catch (error) {
      logger.error('Error in ClientProfileController.updateAddress', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  /**
   * Delete an address owned by the request owner.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async deleteAddress(req, res) {
    const owner = this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);
      const address = await this.findOwnedRecord('ClientAddress', req.params.id, owner);
      await address.destroy({ useMasterKey: true });
      this.sendSuccess(res, { id: req.params.id }, 'Dirección eliminada');
    } catch (error) {
      logger.error('Error in ClientProfileController.deleteAddress', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  // Only one favorite per owner: clear the flag on the others before setting a new one.
  async clearFavoriteAddress(owner) {
    const current = await ClientAddress.getByOwner(owner.ownerType, owner.ownerId);
    const favorites = current.filter((a) => a.isFavorite());
    if (favorites.length) {
      favorites.forEach((a) => a.set('isFavorite', false));
      await Parse.Object.saveAll(favorites, { useMasterKey: true });
    }
  }

  // ---------- travel preferences ----------

  async getTravelPreferences(req, res) {
    const owner = this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);
      const prefs = await TravelPreference.getByOwner(owner.ownerType, owner.ownerId);
      this.sendSuccess(res, { preferences: prefs.map((p) => p.toJSON()) }, 'Preferences retrieved successfully');
    } catch (error) {
      logger.error('Error in ClientProfileController.getTravelPreferences', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, 'Failed to retrieve preferences', error.status || 500);
    }
  }

  /**
   * Create a new travel preference for the owner.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async createTravelPreference(req, res) {
    const owner = this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);

      const data = { ...req.body, ownerType: owner.ownerType, ownerId: owner.ownerId };
      const errors = TravelPreference.validate(data);
      if (errors.length) return this.sendError(res, errors.join(', '), 400);

      const pref = TravelPreference.create(data);
      await pref.save(null, { useMasterKey: true });
      this.sendSuccess(res, { preference: pref.toJSON() }, 'Preferencia creada exitosamente', 201);
    } catch (error) {
      logger.error('Error in ClientProfileController.createTravelPreference', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  async updateTravelPreference(req, res) {
    const owner = this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);
      const pref = await this.findOwnedRecord('TravelPreference', req.params.id, owner);

      ['type', 'option'].forEach((f) => { if (req.body[f] !== undefined) pref.set(f, req.body[f]); });
      await pref.save(null, { useMasterKey: true });
      this.sendSuccess(res, { preference: pref.toJSON() }, 'Preferencia actualizada');
    } catch (error) {
      logger.error('Error in ClientProfileController.updateTravelPreference', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  /**
   * Delete a travel preference owned by the request owner.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async deleteTravelPreference(req, res) {
    const owner = this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);
      const pref = await this.findOwnedRecord('TravelPreference', req.params.id, owner);
      await pref.destroy({ useMasterKey: true });
      this.sendSuccess(res, { id: req.params.id }, 'Preferencia eliminada');
    } catch (error) {
      logger.error('Error in ClientProfileController.deleteTravelPreference', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  // ---------- loyalty programs (loyaltyPrograms array of { type, number } on the owner) ----------

  async getLoyaltyPrograms(req, res) {
    const owner = this.resolveOwner(req);
    try {
      const ownerObj = await this.validateOwnerExists(owner);
      this.sendSuccess(res, { loyaltyPrograms: ownerObj.get('loyaltyPrograms') || [] }, 'Loyalty programs retrieved successfully');
    } catch (error) {
      logger.error('Error in ClientProfileController.getLoyaltyPrograms', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, 'Failed to retrieve loyalty programs', error.status || 500);
    }
  }

  // Replaces the whole list (the UI sends the full set after an inline edit/add/delete).
  /**
   * Replace the owner's full loyalty programs list with a sanitized set.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async saveLoyaltyPrograms(req, res) {
    const owner = this.resolveOwner(req);
    try {
      const ownerObj = await this.validateOwnerExists(owner);

      const programs = Array.isArray(req.body.loyaltyPrograms) ? req.body.loyaltyPrograms : [];
      const clean = programs
        .filter((p) => p && typeof p.type === 'string' && p.type.trim())
        .map((p) => ({ type: p.type.trim(), number: (p.number || '').toString().trim() }));

      ownerObj.set('loyaltyPrograms', clean);
      await ownerObj.save(null, { useMasterKey: true });
      this.sendSuccess(res, { loyaltyPrograms: clean }, 'Programas de lealtad guardados');
    } catch (error) {
      logger.error('Error in ClientProfileController.saveLoyaltyPrograms', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  // ---------- passports (ClientPassport; number encrypted, returned masked) ----------

  // Multer middleware for the passport document upload (single file, field 'document').
  static documentUploadMiddleware() {
    return passportUpload.single('document');
  }

  // Serialize a passport, resolving the presigned passportDocument URL from its S3 key when set.
  async serializePassport(passport, ctx = {}) {
    const json = await passport.toSafeJSON(ctx);
    if (json.passportDocumentS3Key) {
      json.passportDocument = await this.fileStorageService.getPresignedUrl(json.passportDocumentS3Key);
    }
    return json;
  }

  async getPassports(req, res) {
    const owner = this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);
      const passports = await ClientPassport.getByOwner(owner.ownerType, owner.ownerId);
      // toSafeJSON is async (decrypts to mask); never returns the raw/encrypted number.
      // serializePassport additionally resolves the presigned document URL from the S3 key.
      const data = await Promise.all(passports.map((p) => this.serializePassport(p)));
      this.sendSuccess(res, { passports: data }, 'Passports retrieved successfully');
    } catch (error) {
      logger.error('Error in ClientProfileController.getPassports', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, 'Failed to retrieve passports', error.status || 500);
    }
  }

  /**
   * Create a passport for the owner, encrypting the number, returning masked JSON.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async createPassport(req, res) {
    const owner = this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);

      const data = { ...req.body, ownerType: owner.ownerType, ownerId: owner.ownerId };
      const errors = ClientPassport.validate(data);
      if (errors.length) return this.sendError(res, errors.join(', '), 400);

      const passport = ClientPassport.create(data);
      if (req.body.number) await passport.setNumber(req.body.number);
      await passport.save(null, { useMasterKey: true });

      logger.info('Passport created', { ...owner, passportId: passport.id, userId: req.user?.id });
      // Document is uploaded separately via POST /passports/:id/document (S3 pipeline).
      this.sendSuccess(res, { passport: await this.serializePassport(passport) }, 'Pasaporte creado exitosamente', 201);
    } catch (error) {
      logger.error('Error in ClientProfileController.createPassport', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  async updatePassport(req, res) {
    const owner = this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);
      const passport = await this.findOwnedRecord('ClientPassport', req.params.id, owner);

      const setters = {
        label: 'setLabel',
        countryOfIssue: 'setCountryOfIssue',
        nationality: 'setNationality',
        dateOfIssue: 'setDateOfIssue',
        expirationDate: 'setExpirationDate',
      };
      Object.entries(setters).forEach(([f, setter]) => {
        if (req.body[f] !== undefined) passport[setter](req.body[f]);
      });
      if (req.body.verified !== undefined) passport.setVerified(req.body.verified);
      // Empty means "keep the existing number" (the edit form shows "Dejar vacío para conservar");
      // only re-encrypt when a new number was actually typed, so saving doesn't wipe it.
      if (typeof req.body.number === 'string' && req.body.number.trim() !== '') {
        await passport.setNumber(req.body.number.trim());
      }
      await passport.save(null, { useMasterKey: true });

      this.sendSuccess(res, { passport: await this.serializePassport(passport) }, 'Pasaporte actualizado');
    } catch (error) {
      logger.error('Error in ClientProfileController.updatePassport', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  // Upload the passport copy via the S3 pipeline: images → optimizer, PDFs → direct S3 upload.
  async uploadPassportDocument(req, res) {
    const owner = this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);
      const passport = await this.findOwnedRecord('ClientPassport', req.params.id, owner);

      const { file } = req;
      if (!file) return this.sendError(res, 'No se recibió ningún archivo', 400);
      // Multer already guards type/size; re-check here for a clear 400 (e.g. direct API calls).
      if (!PASSPORT_DOC_MIME.test(file.mimetype)) {
        return this.sendError(res, 'Tipo de archivo no permitido. Solo imágenes o PDF.', 400);
      }
      if (file.size > PASSPORT_DOC_MAX_BYTES) {
        return this.sendError(res, 'El archivo supera el límite de 5MB', 400);
      }

      // The mimetype the browser sends can lie: a macOS AppleDouble "._" metadata file (magic
      // 0x00051607) gets picked instead of the real PDF and uploaded as application/pdf, producing an
      // unreadable document. Verify the actual content by magic bytes before storing anything.
      const sig = file.buffer.slice(0, 16);
      const isPdf = file.buffer.slice(0, 1024).includes('%PDF');
      const isImage = (sig[0] === 0xFF && sig[1] === 0xD8) // JPEG
        || (sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4E && sig[3] === 0x47) // PNG
        || (sig[0] === 0x47 && sig[1] === 0x49 && sig[2] === 0x46) // GIF
        || (sig.slice(0, 4).toString('latin1') === 'RIFF' && sig.slice(8, 12).toString('latin1') === 'WEBP')
        || (sig.slice(4, 8).toString('latin1') === 'ftyp') // AVIF/HEIC
        || (sig[0] === 0x42 && sig[1] === 0x4D); // BMP
      if ((file.mimetype === 'application/pdf' && !isPdf) || (file.mimetype.startsWith('image/') && !isImage)) {
        logger.warn('Rejected passport document with mismatched content', {
          mimetype: file.mimetype, first8Hex: sig.slice(0, 8).toString('hex'), originalname: file.originalname,
        });
        return this.sendError(
          res,
          'El archivo no es un PDF o imagen válido. Si proviene de una Mac, sube el PDF real, '
          + 'no el archivo de metadatos "._" que macOS crea junto a él.',
          400
        );
      }

      const entityPath = `passports/${owner.ownerId}`;
      const uniqueName = `passport-${passport.id}-${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      let s3Key;
      if (file.mimetype.startsWith('image/')) {
        const result = await this.serverOptimizationService.uploadOptimizedImage(
          file.buffer,
          uniqueName,
          file.mimetype,
          { entityPath, entityId: passport.id }
        );
        s3Key = result && result.originalS3Key;
      } else {
        // PDF: no image optimization — store directly via FileStorageService.uploadFile.
        const result = await this.fileStorageService.uploadFile(
          file.buffer,
          uniqueName,
          file.mimetype,
          { entityId: entityPath }
        );
        s3Key = result && result.s3Key;
      }
      if (!s3Key) throw new Error('Error al subir el documento');

      passport.setPassportDocumentS3Key(s3Key);
      await passport.save(null, { useMasterKey: true });

      const url = await this.fileStorageService.getPresignedUrl(s3Key);
      logger.info('Passport document uploaded', {
        ...owner, passportId: passport.id, s3Key, userId: req.user?.id,
      });
      this.sendSuccess(res, { passportDocument: url, passportDocumentS3Key: s3Key }, 'Documento subido exitosamente');
    } catch (error) {
      logger.error('Error in ClientProfileController.uploadPassportDocument', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  /**
   * Delete a passport owned by the request owner.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async deletePassport(req, res) {
    const owner = this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);
      const passport = await this.findOwnedRecord('ClientPassport', req.params.id, owner);
      await passport.destroy({ useMasterKey: true });
      this.sendSuccess(res, { id: req.params.id }, 'Pasaporte eliminado');
    } catch (error) {
      logger.error('Error in ClientProfileController.deletePassport', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  // Reveal the full number — authorized (admin/superadmin) + audited by the vault.
  /**
   * Reveal the full decrypted passport number for an authorized, audited user.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async revealPassportNumber(req, res) {
    const owner = this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);
      const passport = await this.findOwnedRecord('ClientPassport', req.params.id, owner);

      const user = { id: req.user?.id, role: req.userRole || req.user?.role };
      const number = await passport.getNumber({ user });
      if (number === null) return this.sendError(res, 'No autorizado para ver el número completo', 403);

      this.sendSuccess(res, { number }, 'Número revelado');
    } catch (error) {
      logger.error('Error in ClientProfileController.revealPassportNumber', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  // ---------- trips (read-only: quotes/reservations linked to this client) ----------

  async getTrips(req, res) {
    const owner = this.resolveOwner(req);
    try {
      const ownerObj = await this.validateOwnerExists(owner);

      // A migrated person's trips can be linked by either of two pointers:
      //   new quotes  → Quote.client (Pointer<AmexingUser>) + clientType 'direct'
      //   old quotes  → Quote.companyClientPtr (Pointer<Client> == legacyClientId)
      let query;
      if (owner.ownerType === 'amexingUser') {
        const AmexingUser = Parse.Object.extend('AmexingUser');
        const userPtr = AmexingUser.createWithoutData(owner.ownerId);
        const byClient = new Parse.Query('Quote');
        byClient.equalTo('client', userPtr);
        byClient.equalTo('clientType', 'direct');

        const subQueries = [byClient];
        const legacyClientId = ownerObj.get('legacyClientId');
        if (legacyClientId) {
          const Client = Parse.Object.extend('Client');
          const clientPtr = Client.createWithoutData(legacyClientId);
          const byLegacy = new Parse.Query('Quote');
          byLegacy.equalTo('companyClientPtr', clientPtr);
          subQueries.push(byLegacy);
        }
        query = subQueries.length > 1 ? Parse.Query.or(...subQueries) : byClient;
      } else {
        // Legacy Client record (may also be an agency-owned sub-client).
        query = new Parse.Query('Quote');
        query.equalTo('companyClientPtr', ownerObj);
      }

      query.equalTo('exists', true);
      query.descending('createdAt');
      query.limit(100);
      const quotes = await query.find({ useMasterKey: true });

      const trips = quotes.map((q) => ({
        id: q.id,
        folio: q.get('folio') || '',
        eventType: q.get('eventType') || '',
        status: q.get('status') || '',
        startDate: q.get('startDate') || null,
        endDate: q.get('endDate') || null,
        createdAt: q.get('createdAt'),
      }));

      this.sendSuccess(res, { trips }, 'Trips retrieved successfully');
    } catch (error) {
      logger.error('Error in ClientProfileController.getTrips', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, 'Failed to retrieve trips', error.status || 500);
    }
  }
}

module.exports = ClientProfileController;
