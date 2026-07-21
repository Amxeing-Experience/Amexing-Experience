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
const ClientDocument = require('../../../domain/models/ClientDocument');
const FileStorageService = require('../../services/FileStorageService');
const ServerImageOptimizationService = require('../../services/ServerImageOptimizationService');

// Accepted document types for a passport copy (image or PDF) and the upload size cap. The (?!svg)
// excludes image/svg+xml: SVG can carry script that would execute when the presigned URL is opened.
const PASSPORT_DOC_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const PASSPORT_DOC_MIME = /^(image\/(?!svg)|application\/pdf$)/;

// Client documents (base64-in-JSON upload — WAF returns 426 for multipart binary): image or PDF, ≤10MB.
const CLIENT_DOC_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const CLIENT_DOC_MIME = /^(image\/(?!svg)|application\/pdf$)/;
const CLIENT_DOC_LABEL_MAX = 60;

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
    this.saveTravelPreferences = this.saveTravelPreferences.bind(this);
    this.getLoyaltyPrograms = this.getLoyaltyPrograms.bind(this);
    this.saveLoyaltyPrograms = this.saveLoyaltyPrograms.bind(this);
    this.getPassports = this.getPassports.bind(this);
    this.createPassport = this.createPassport.bind(this);
    this.updatePassport = this.updatePassport.bind(this);
    this.uploadPassportDocument = this.uploadPassportDocument.bind(this);
    this.deletePassport = this.deletePassport.bind(this);
    this.revealPassportNumber = this.revealPassportNumber.bind(this);
    this.getDocuments = this.getDocuments.bind(this);
    this.uploadDocument = this.uploadDocument.bind(this);
    this.updateDocument = this.updateDocument.bind(this);
    this.deleteDocument = this.deleteDocument.bind(this);
    this.getTrips = this.getTrips.bind(this);
  }

  // ---------- helpers ----------

  // Owner is decided by the route family, not the body:
  //   /api/clients/:clientId/...  → Client owner
  //   /api/agents/:agentId/...    → AmexingUser owner
  /**
   * Derive the owner (type and id) from the request route params.
   * @param {object} req - Express request.
   * @returns {Promise<{ownerType: string, ownerId: string}>} The resolved owner descriptor.
   * @example
   */
  async resolveOwner(req) {
    if (req.params.agentId) return { ownerType: 'amexingUser', ownerId: req.params.agentId };
    const ownerId = req.params.clientId;
    // El cliente puede ser AmexingUser (end_client, modelo nuevo) o Client legado.
    const isAmexingUser = await new Parse.Query('AmexingUser')
      .get(ownerId, { useMasterKey: true }).then(() => true).catch(() => false);
    return { ownerType: isAmexingUser ? 'amexingUser' : 'client', ownerId };
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
    const owner = await this.resolveOwner(req);
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
    const owner = await this.resolveOwner(req);
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
    const owner = await this.resolveOwner(req);
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
    const owner = await this.resolveOwner(req);
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
    const owner = await this.resolveOwner(req);
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
    const owner = await this.resolveOwner(req);
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
    const owner = await this.resolveOwner(req);
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
    const owner = await this.resolveOwner(req);
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

  /**
   * Reemplaza todo el set de preferencias de viaje del owner en un solo guardado
   * (la UI envía todas las categorías a la vez).
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async saveTravelPreferences(req, res) {
    const owner = await this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);

      const incoming = Array.isArray(req.body.preferences) ? req.body.preferences : [];
      const clean = incoming
        .filter((p) => p && typeof p.type === 'string' && p.type.trim()
          && typeof p.option === 'string' && p.option.trim())
        .map((p) => ({ type: p.type.trim(), option: p.option.trim() }));

      // Replace-all: drop the existing rows, then insert the submitted set.
      const existing = await TravelPreference.getByOwner(owner.ownerType, owner.ownerId);
      if (existing.length) await Parse.Object.destroyAll(existing, { useMasterKey: true });

      const created = clean.map((p) => TravelPreference.create({
        ...p, ownerType: owner.ownerType, ownerId: owner.ownerId,
      }));
      if (created.length) await Parse.Object.saveAll(created, { useMasterKey: true });

      this.sendSuccess(res, { preferences: created.map((p) => p.toJSON()) }, 'Preferencias guardadas');
    } catch (error) {
      logger.error('Error in ClientProfileController.saveTravelPreferences', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  // ---------- loyalty programs (loyaltyPrograms array of { type, number } on the owner) ----------

  async getLoyaltyPrograms(req, res) {
    const owner = await this.resolveOwner(req);
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
    const owner = await this.resolveOwner(req);
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

  // Verify the file's real content matches its declared mimetype by magic bytes. The browser-sent
  // mimetype can lie: a macOS AppleDouble "._" metadata file, or a spoofed/script payload renamed to
  // look like an image. Returns true only when the bytes are a recognized PDF or raster image
  // consistent with `mimetype`. Shared by the passport and document upload paths.
  static contentMatchesMime(buffer, mimetype) {
    const sig = buffer.slice(0, 16);
    const isPdf = buffer.slice(0, 1024).includes('%PDF');
    const isImage = (sig[0] === 0xFF && sig[1] === 0xD8) // JPEG
      || (sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4E && sig[3] === 0x47) // PNG
      || (sig[0] === 0x47 && sig[1] === 0x49 && sig[2] === 0x46) // GIF
      || (sig.slice(0, 4).toString('latin1') === 'RIFF' && sig.slice(8, 12).toString('latin1') === 'WEBP')
      || (sig.slice(4, 8).toString('latin1') === 'ftyp') // AVIF/HEIC
      || (sig[0] === 0x42 && sig[1] === 0x4D); // BMP
    if (mimetype === 'application/pdf') return isPdf;
    if (mimetype.startsWith('image/')) return isImage;
    return false;
  }

  /**
   * Serializa un pasaporte resolviendo la URL presignada del documento desde su S3 key.
   * @param {Parse.Object} passport - El pasaporte a serializar.
   * @param {object} [ctx] - Contexto para toSafeJSON.
   * @returns {Promise<object>} JSON seguro del pasaporte (con passportDocument URL si aplica).
   * @example
   */
  async serializePassport(passport, ctx = {}) {
    const json = await passport.toSafeJSON(ctx);
    if (json.passportDocumentS3Key) {
      json.passportDocument = await this.fileStorageService.getPresignedUrl(json.passportDocumentS3Key);
    }
    return json;
  }

  async getPassports(req, res) {
    const owner = await this.resolveOwner(req);
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
    const owner = await this.resolveOwner(req);
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
    const owner = await this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);
      const passport = await this.findOwnedRecord('ClientPassport', req.params.id, owner);

      // Validate incoming date changes against the shared standard, merging with the stored values so
      // the expiry-after-issue check still holds when only one of the two dates is edited.
      const dateErrors = ClientPassport.validate({
        ownerId: owner.ownerId,
        dateOfIssue: req.body.dateOfIssue !== undefined ? req.body.dateOfIssue : passport.getDateOfIssue(),
        expirationDate: req.body.expirationDate !== undefined ? req.body.expirationDate : passport.getExpirationDate(),
      });
      if (dateErrors.length) return this.sendError(res, dateErrors.join(', '), 400);

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

  /**
   * Sube la copia del pasaporte por el pipeline S3 (imágenes → optimizador, PDFs → subida directa).
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async uploadPassportDocument(req, res) {
    const owner = await this.resolveOwner(req);
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

      // Verify the actual content by magic bytes before storing anything (the browser mimetype lies
      // for a macOS "._" metadata file, etc.). Shared helper — same check the document path uses.
      if (!ClientProfileController.contentMatchesMime(file.buffer, file.mimetype)) {
        logger.warn('Rejected passport document with mismatched content', {
          mimetype: file.mimetype, first8Hex: file.buffer.slice(0, 8).toString('hex'), originalname: file.originalname,
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
    const owner = await this.resolveOwner(req);
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
    const owner = await this.resolveOwner(req);
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

  // ---------- documents (ClientDocument; files in S3, no field-level encryption) ----------

  /**
   * Serializa un documento resolviendo la URL presignada (documentUrl) desde su S3 key.
   * @param {Parse.Object} doc - El documento a serializar.
   * @returns {Promise<object>} JSON seguro del documento (con documentUrl si aplica).
   * @example
   */
  async serializeDocument(doc) {
    const json = doc.toSafeJSON();
    if (json.s3Key) {
      json.documentUrl = await this.fileStorageService.getPresignedUrl(json.s3Key);
    }
    return json;
  }

  async getDocuments(req, res) {
    const owner = await this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);
      const documents = await ClientDocument.getByOwner(owner.ownerType, owner.ownerId);
      const data = await Promise.all(documents.map((d) => this.serializeDocument(d)));
      this.sendSuccess(res, { documents: data }, 'Documents retrieved successfully');
    } catch (error) {
      logger.error('Error in ClientProfileController.getDocuments', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, 'Failed to retrieve documents', error.status || 500);
    }
  }

  // Validate a base64 document payload and store it via the same S3 pipeline as the passport copy
  // (images → optimizer with AVIF/WebP variants, PDFs → direct). Returns { s3Key, size, safeName }.
  // Throws an Error with `.status` 400 on bad input (the caller's catch turns it into the response).
  async storeDocumentFile(owner, {
    fileBase64, fileName, mimeType, label, userId,
  }) {
    /**
     * Crea un Error con `.status` 400 (el catch del caller lo convierte en la respuesta).
     * @param {string} msg - Mensaje de error.
     * @returns {Error} Error con status 400.
     * @example
     */
    const fail = (msg) => Object.assign(new Error(msg), { status: 400 });

    if (!fileBase64) throw fail('No se recibió ningún archivo');
    if (!mimeType || !CLIENT_DOC_MIME.test(mimeType)) throw fail('Tipo de archivo no permitido. Solo imágenes o PDF.');
    // Reject clearly-oversized payloads before allocating the Buffer (base64 is ~1.37× the bytes).
    if (typeof fileBase64 !== 'string' || fileBase64.length > Math.ceil(CLIENT_DOC_MAX_BYTES * 1.4)) {
      throw fail('El archivo supera el límite de 10MB');
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    if (!buffer.length) throw fail('Archivo inválido');
    if (buffer.length > CLIENT_DOC_MAX_BYTES) throw fail('El archivo supera el límite de 10MB');
    // The declared mimeType can lie; verify the real content by magic bytes.
    if (!ClientProfileController.contentMatchesMime(buffer, mimeType)) {
      logger.warn('Rejected client document with mismatched content', {
        mimeType, first8Hex: buffer.slice(0, 8).toString('hex'), fileName,
      });
      throw fail('El archivo no es un PDF o imagen válido.');
    }

    const entityPath = `documents/${owner.ownerId}`;
    const safeName = (fileName || 'documento').replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueName = `document-${owner.ownerId}-${Date.now()}-${safeName}`;

    let s3Key;
    if (mimeType.startsWith('image/')) {
      const result = await this.serverOptimizationService.uploadOptimizedImage(
        buffer,
        uniqueName,
        mimeType,
        { entityPath, entityId: owner.ownerId }
      );
      s3Key = result && result.originalS3Key;
    } else {
      const result = await this.fileStorageService.uploadFile(buffer, uniqueName, mimeType, {
        entityId: entityPath,
        metadata: { label, ownerType: owner.ownerType, ownerId: owner.ownerId },
        userContext: { userId },
      });
      s3Key = result && result.s3Key;
    }
    if (!s3Key) throw new Error('Error al subir el documento');
    return { s3Key, size: buffer.length, safeName };
  }

  /**
   * Sube un documento del cliente vía base64-en-JSON (multipart lo bloquea el WAF, HTTP 426).
   * Body: { fileBase64, fileName, mimeType, label }.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async uploadDocument(req, res) {
    const owner = await this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);

      const { fileBase64, fileName, mimeType } = req.body;

      // The document type is free text (the admin types it; the predefined labels are only datalist
      // suggestions), so any document the existing tags don't cover is allowed. Trim + clamp length.
      const label = (req.body.label || '').trim().slice(0, CLIENT_DOC_LABEL_MAX);
      if (!label) return this.sendError(res, 'Escribe el tipo de documento', 400);

      const stored = await this.storeDocumentFile(owner, {
        fileBase64, fileName, mimeType, label, userId: req.user?.id,
      });

      const doc = ClientDocument.create({
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        label,
        customLabel: '',
        fileName: fileName || stored.safeName,
        mimeType,
        size: stored.size,
        s3Key: stored.s3Key,
        isSensitive: ClientDocument.isSensitiveLabel(label),
        uploadedBy: req.user,
      });
      await doc.save(null, { useMasterKey: true });

      logger.info('Client document uploaded', {
        ...owner, documentId: doc.id, s3Key: stored.s3Key, userId: req.user?.id,
      });
      this.sendSuccess(res, { document: await this.serializeDocument(doc) }, 'Documento subido exitosamente', 201);
    } catch (error) {
      logger.error('Error in ClientProfileController.uploadDocument', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  // Update a document's type (label) and optionally replace its file — mirrors the passport edit:
  // the PUT updates fields, and if a new file is sent it's stored via the same pipeline and the old
  // S3 object is cleaned up. Body: { label, [fileBase64, fileName, mimeType] }.
  async updateDocument(req, res) {
    const owner = await this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);
      const doc = await this.findOwnedRecord('ClientDocument', req.params.docId, owner);

      const label = (req.body.label || '').trim().slice(0, CLIENT_DOC_LABEL_MAX);
      if (!label) return this.sendError(res, 'Escribe el tipo de documento', 400);
      doc.setLabel(label);
      doc.setSensitive(ClientDocument.isSensitiveLabel(label));

      // File replacement is optional — when no new file is sent the current one is kept.
      const { fileBase64, fileName, mimeType } = req.body;
      if (fileBase64) {
        const oldS3Key = doc.getS3Key();
        const stored = await this.storeDocumentFile(owner, {
          fileBase64, fileName, mimeType, label, userId: req.user?.id,
        });
        doc.setS3Key(stored.s3Key);
        doc.setFileName(fileName || stored.safeName);
        doc.setMimeType(mimeType);
        doc.setSize(stored.size);
        // Best-effort cleanup of the replaced file (the row already points at the new one).
        if (oldS3Key && oldS3Key !== stored.s3Key) {
          try {
            await this.fileStorageService.deleteFile(oldS3Key);
          } catch (e) {
            logger.warn('Failed to delete replaced document file from S3', { s3Key: oldS3Key, error: e.message });
          }
        }
      }

      await doc.save(null, { useMasterKey: true });
      this.sendSuccess(res, { document: await this.serializeDocument(doc) }, 'Documento actualizado');
    } catch (error) {
      logger.error('Error in ClientProfileController.updateDocument', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  /**
   * Soft-delete a document owned by the request owner (and remove the S3 file).
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<void>}
   * @example
   */
  async deleteDocument(req, res) {
    const owner = await this.resolveOwner(req);
    try {
      await this.validateOwnerExists(owner);
      const doc = await this.findOwnedRecord('ClientDocument', req.params.docId, owner);
      const s3Key = doc.getS3Key();
      await doc.softDelete(req.user);
      // Best-effort S3 cleanup; the row is already soft-deleted regardless.
      if (s3Key) {
        try {
          await this.fileStorageService.deleteFile(s3Key);
        } catch (e) {
          logger.warn('Failed to delete document file from S3', { s3Key, error: e.message });
        }
      }
      this.sendSuccess(res, { id: req.params.docId }, 'Documento eliminado');
    } catch (error) {
      logger.error('Error in ClientProfileController.deleteDocument', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  // ---------- trips (read-only: quotes/reservations linked to this client) ----------

  async getTrips(req, res) {
    const owner = await this.resolveOwner(req);
    try {
      const ownerObj = await this.validateOwnerExists(owner);

      /**
       * Nombre visible de un usuario: nombre+apellido, o email/username como fallback.
       * @param {Parse.Object} u - AmexingUser (o null).
       * @returns {string} Nombre a mostrar, o cadena vacía.
       * @example
       */
      const userName = (u) => (u
        ? (`${u.get('firstName') || ''} ${u.get('lastName') || ''}`.trim() || u.get('email') || u.get('username') || '')
        : '');
      /**
       * Nombre de la AGENCIA dueña de la cotización (via el pointer `client`, un AmexingUser
       * role department_manager). Usa contextualData.companyName (p.ej. 'Nuba'), con fallbacks.
       * @param {Parse.Object} clientPtr - Pointer al cliente/agencia.
       * @returns {string} Nombre de la agencia, o cadena vacía si no aplica.
       * @example
       */
      const agencyNameOf = (clientPtr) => {
        if (!clientPtr || clientPtr.get('role') !== 'department_manager') return '';
        const cd = clientPtr.get('contextualData') || {};
        return cd.companyName || cd.agencyName || userName(clientPtr);
      };

      let query;
      if (owner.ownerType === 'amexingUser' && ownerObj.get('role') === 'department_manager') {
        // Agency view: every quote of the agency points to this department manager via `client`
        // (regardless of which agent owns/created it). One simple query covers the whole agency.
        const AmexingUser = Parse.Object.extend('AmexingUser');
        query = new Parse.Query('Quote');
        query.equalTo('client', AmexingUser.createWithoutData(owner.ownerId));
      } else if (owner.ownerType === 'amexingUser') {
        // A migrated person's trips can be linked by either of two pointers:
        //   new quotes  → Quote.client (Pointer<AmexingUser>) + clientType 'direct'
        //   old quotes  → Quote.companyClientPtr (Pointer<Client> == legacyClientId)
        const AmexingUser = Parse.Object.extend('AmexingUser');
        const userPtr = AmexingUser.createWithoutData(owner.ownerId);
        const byClient = new Parse.Query('Quote');
        byClient.equalTo('client', userPtr);
        byClient.equalTo('clientType', 'direct');

        // Clientes de agencia se referencian en la quote como clientFinalId (string).
        const byFinal = new Parse.Query('Quote');
        byFinal.equalTo('clientFinalId', owner.ownerId);

        const subQueries = [byClient, byFinal];
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
      query.limit(1000); // the trips table paginates client-side (DataTables) — load the full list
      query.include('client'); // the agency (department manager)
      query.include('owner'); // responsible person (exposed as a plus)
      query.include('createdBy');
      const quotes = await query.find({ useMasterKey: true });

      const trips = quotes.map((q) => {
        // Services are denormalized on the quote: serviceItems.days[].subconcepts[]. Count them
        // (one subconcept = one service, matching what the itinerary shows) — no extra queries.
        const si = q.get('serviceItems');
        const serviceCount = si && Array.isArray(si.days)
          ? si.days.reduce((sum, d) => sum + (Array.isArray(d.subconcepts) ? d.subconcepts.length : 0), 0)
          : 0;
        // Responsible person (the "plus"): owner, falling back to creator when owner has no name.
        const ownerPtr = q.get('owner');
        const createdByPtr = q.get('createdBy');
        const agentObj = (ownerPtr && (ownerPtr.get('firstName') || ownerPtr.get('lastName') || ownerPtr.get('email')))
          ? ownerPtr : createdByPtr;
        return {
          id: q.id,
          folio: q.get('folio') || '',
          eventType: q.get('eventType') || '',
          status: q.get('status') || '',
          startDate: q.get('startDate') || null,
          endDate: q.get('endDate') || null,
          createdAt: q.get('createdAt'),
          serviceCount,
          agency: agencyNameOf(q.get('client')),
          agent: userName(agentObj),
        };
      });

      this.sendSuccess(res, { trips }, 'Trips retrieved successfully');
    } catch (error) {
      logger.error('Error in ClientProfileController.getTrips', { error: error.message, ownerId: owner.ownerId });
      this.sendError(res, 'Failed to retrieve trips', error.status || 500);
    }
  }
}

module.exports = ClientProfileController;
