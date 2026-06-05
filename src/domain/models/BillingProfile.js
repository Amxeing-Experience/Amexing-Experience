/**
 * BillingProfile - Domain model for user billing/invoicing profiles.
 *
 * Stores billing profiles for users. Each user can have multiple profiles
 * (e.g., one Mexican company + one US company) with country-specific
 * fiscal information for invoicing purposes.
 *
 * Lifecycle States:
 * - active: true, exists: true = Available for billing
 * - active: false, exists: true = Inactive (not selectable but preserved)
 * - active: false, exists: false = Soft deleted (audit trail only).
 * @augments BaseModel
 * @author Created by Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Create new billing profile
 * const profile = new BillingProfile();
 * profile.setUserPtr(userPointer);
 * profile.setCountry('MX');
 * profile.setLabel('NUBA México');
 * profile.setIsPrimary(true);
 * profile.setRfc('XAXX010101000');
 * profile.setRazonSocial('NUBA México S.A. de C.V.');
 * await profile.save();
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * BillingProfile class for managing user billing/invoicing profiles.
 * @class BillingProfile
 * @augments BaseModel
 */
class BillingProfile extends BaseModel {
  /**
   * Create a BillingProfile instance.
   * @example
   * // Usage example documented above
   */
  constructor() {
    super('BillingProfile');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get user pointer reference.
   * @returns {Parse.Object} AmexingUser pointer.
   * @example
   * const user = profile.getUserPtr();
   */
  getUserPtr() {
    return this.get('userPtr');
  }

  /**
   * Set user pointer reference.
   * @param {Parse.Object} userPtr - AmexingUser pointer.
   * @example
   * profile.setUserPtr(userPointer);
   */
  setUserPtr(userPtr) {
    this.set('userPtr', userPtr);
  }

  /**
   * Get country ISO code.
   * @returns {string} Country ISO code (e.g., "MX", "US").
   * @example
   * const country = profile.getCountry();
   */
  getCountry() {
    return this.get('country') || '';
  }

  /**
   * Set country ISO code.
   * @param {string} country - Country ISO code (e.g., "MX", "US").
   * @example
   * profile.setCountry('MX');
   */
  setCountry(country) {
    this.set('country', country);
  }

  /**
   * Get user-friendly label.
   * @returns {string} Label (e.g., "NUBA México").
   * @example
   * const label = profile.getLabel();
   */
  getLabel() {
    return this.get('label') || '';
  }

  /**
   * Set user-friendly label.
   * @param {string} label - User-friendly name for the profile.
   * @example
   * profile.setLabel('NUBA México');
   */
  setLabel(label) {
    this.set('label', label);
  }

  /**
   * Get whether this is the primary billing profile.
   * @returns {boolean} True if primary.
   * @example
   * const isPrimary = profile.getIsPrimary();
   */
  getIsPrimary() {
    return this.get('isPrimary') || false;
  }

  /**
   * Set whether this is the primary billing profile.
   * @param {boolean} isPrimary - True to set as primary.
   * @example
   * profile.setIsPrimary(true);
   */
  setIsPrimary(isPrimary) {
    this.set('isPrimary', !!isPrimary);
  }

  /**
   * Get RFC tax ID (Mexico only).
   * @returns {string} RFC tax identifier.
   * @example
   * const rfc = profile.getRfc();
   */
  getRfc() {
    return this.get('rfc') || '';
  }

  /**
   * Set RFC tax ID (Mexico only).
   * @param {string} rfc - RFC tax identifier.
   * @example
   * profile.setRfc('XAXX010101000');
   */
  setRfc(rfc) {
    this.set('rfc', rfc);
  }

  /**
   * Get international tax ID.
   * @returns {string} Tax ID.
   * @example
   * const taxId = profile.getTaxId();
   */
  getTaxId() {
    return this.get('taxId') || '';
  }

  /**
   * Set international tax ID.
   * @param {string} taxId - Tax identifier.
   * @example
   * profile.setTaxId('12-3456789');
   */
  setTaxId(taxId) {
    this.set('taxId', taxId);
  }

  /**
   * Get razon social / legal name (Mexico).
   * @returns {string} Razon social.
   * @example
   * const razonSocial = profile.getRazonSocial();
   */
  getRazonSocial() {
    return this.get('razonSocial') || '';
  }

  /**
   * Set razon social / legal name (Mexico).
   * @param {string} razonSocial - Legal name.
   * @example
   * profile.setRazonSocial('NUBA México S.A. de C.V.');
   */
  setRazonSocial(razonSocial) {
    this.set('razonSocial', razonSocial);
  }

  /**
   * Get commercial name (International).
   * @returns {string} Commercial name.
   * @example
   * const name = profile.getCommercialName();
   */
  getCommercialName() {
    return this.get('commercialName') || '';
  }

  /**
   * Set commercial name (International).
   * @param {string} commercialName - Commercial name.
   * @example
   * profile.setCommercialName('NUBA Travel Inc.');
   */
  setCommercialName(commercialName) {
    this.set('commercialName', commercialName);
  }

  /**
   * Get regimen fiscal (Mexico only).
   * @returns {string} Fiscal regime.
   * @example
   * const regimen = profile.getRegimenFiscal();
   */
  getRegimenFiscal() {
    return this.get('regimenFiscal') || '';
  }

  /**
   * Set regimen fiscal (Mexico only).
   * @param {string} regimenFiscal - Fiscal regime.
   * @example
   * profile.setRegimenFiscal('601');
   */
  setRegimenFiscal(regimenFiscal) {
    this.set('regimenFiscal', regimenFiscal);
  }

  /**
   * Get uso CFDI (Mexico only).
   * @returns {string} CFDI usage code.
   * @example
   * const usoCfdi = profile.getUsoCfdi();
   */
  getUsoCfdi() {
    return this.get('usoCfdi') || '';
  }

  /**
   * Set uso CFDI (Mexico only).
   * @param {string} usoCfdi - CFDI usage code.
   * @example
   * profile.setUsoCfdi('G03');
   */
  setUsoCfdi(usoCfdi) {
    this.set('usoCfdi', usoCfdi);
  }

  /**
   * Get codigo postal (Mexico only - 5 digit postal code).
   * @returns {string} Codigo postal.
   * @example
   * const cp = profile.getCodigoPostal();
   */
  getCodigoPostal() {
    return this.get('codigoPostal') || '';
  }

  /**
   * Set codigo postal (Mexico only - 5 digit postal code).
   * @param {string} codigoPostal - 5 digit postal code.
   * @example
   * profile.setCodigoPostal('06600');
   */
  setCodigoPostal(codigoPostal) {
    this.set('codigoPostal', codigoPostal);
  }

  /**
   * Get street type.
   * @returns {string} Street type (Calle, Avenida, Boulevard, etc.).
   * @example
   * const streetType = profile.getStreetType();
   */
  getStreetType() {
    return this.get('streetType') || '';
  }

  /**
   * Set street type.
   * @param {string} streetType - Street type (Calle, Avenida, Boulevard, etc.).
   * @example
   * profile.setStreetType('Avenida');
   */
  setStreetType(streetType) {
    this.set('streetType', streetType);
  }

  /**
   * Get street name.
   * @returns {string} Street name.
   * @example
   * const street = profile.getStreet();
   */
  getStreet() {
    return this.get('street') || '';
  }

  /**
   * Set street name.
   * @param {string} street - Street name.
   * @example
   * profile.setStreet('Paseo de la Reforma');
   */
  setStreet(street) {
    this.set('street', street);
  }

  /**
   * Get exterior number.
   * @returns {string} Exterior number.
   * @example
   * const extNum = profile.getExteriorNumber();
   */
  getExteriorNumber() {
    return this.get('exteriorNumber') || '';
  }

  /**
   * Set exterior number.
   * @param {string} exteriorNumber - Exterior number.
   * @example
   * profile.setExteriorNumber('222');
   */
  setExteriorNumber(exteriorNumber) {
    this.set('exteriorNumber', exteriorNumber);
  }

  /**
   * Get interior number (optional).
   * @returns {string} Interior number.
   * @example
   * const intNum = profile.getInteriorNumber();
   */
  getInteriorNumber() {
    return this.get('interiorNumber') || '';
  }

  /**
   * Set interior number (optional).
   * @param {string} interiorNumber - Interior number.
   * @example
   * profile.setInteriorNumber('Piso 3');
   */
  setInteriorNumber(interiorNumber) {
    this.set('interiorNumber', interiorNumber);
  }

  /**
   * Get colonia (Mexico only).
   * @returns {string} Colonia name.
   * @example
   * const colonia = profile.getColonia();
   */
  getColonia() {
    return this.get('colonia') || '';
  }

  /**
   * Set colonia (Mexico only).
   * @param {string} colonia - Colonia name.
   * @example
   * profile.setColonia('Juárez');
   */
  setColonia(colonia) {
    this.set('colonia', colonia);
  }

  /**
   * Get city.
   * @returns {string} City name.
   * @example
   * const city = profile.getCity();
   */
  getCity() {
    return this.get('city') || '';
  }

  /**
   * Set city.
   * @param {string} city - City name.
   * @example
   * profile.setCity('Ciudad de México');
   */
  setCity(city) {
    this.set('city', city);
  }

  /**
   * Get state.
   * @returns {string} State name.
   * @example
   * const state = profile.getState();
   */
  getState() {
    return this.get('state') || '';
  }

  /**
   * Set state.
   * @param {string} state - State name.
   * @example
   * profile.setState('CDMX');
   */
  setState(state) {
    this.set('state', state);
  }

  /**
   * Get international postal/zip code.
   * @returns {string} Postal code.
   * @example
   * const postalCode = profile.getPostalCode();
   */
  getPostalCode() {
    return this.get('postalCode') || '';
  }

  /**
   * Set international postal/zip code.
   * @param {string} postalCode - Postal or zip code.
   * @example
   * profile.setPostalCode('10001');
   */
  setPostalCode(postalCode) {
    this.set('postalCode', postalCode);
  }

  /**
   * Get contact first name.
   * @returns {string} First name of billing contact.
   * @example
   * const firstName = profile.getFirstName();
   */
  getFirstName() {
    return this.get('firstName') || '';
  }

  /**
   * Set contact first name.
   * @param {string} firstName - First name of billing contact.
   * @example
   * profile.setFirstName('Juan');
   */
  setFirstName(firstName) {
    this.set('firstName', firstName);
  }

  /**
   * Get contact last name.
   * @returns {string} Last name of billing contact.
   * @example
   * const lastName = profile.getLastName();
   */
  getLastName() {
    return this.get('lastName') || '';
  }

  /**
   * Set contact last name.
   * @param {string} lastName - Last name of billing contact.
   * @example
   * profile.setLastName('Pérez');
   */
  setLastName(lastName) {
    this.set('lastName', lastName);
  }

  /**
   * Get contact phone number.
   * @returns {string} Phone number of billing contact.
   * @example
   * const phone = profile.getPhone();
   */
  getPhone() {
    return this.get('phone') || '';
  }

  /**
   * Set contact phone number.
   * @param {string} phone - Phone number of billing contact.
   * @example
   * profile.setPhone('+52 55 1234 5678');
   */
  setPhone(phone) {
    this.set('phone', phone);
  }

  /**
   * Get billing email address.
   * @returns {string} Email for invoicing.
   * @example
   * const email = profile.getEmailFacturacion();
   */
  getEmailFacturacion() {
    return this.get('emailFacturacion') || '';
  }

  /**
   * Set billing email address.
   * @param {string} emailFacturacion - Email for invoicing.
   * @example
   * profile.setEmailFacturacion('facturacion@nuba.mx');
   */
  setEmailFacturacion(emailFacturacion) {
    this.set('emailFacturacion', emailFacturacion);
  }

  /**
   * Get constancia fiscal S3 key (Mexico).
   * @returns {string} S3 key for constancia de situacion fiscal.
   * @example
   * const s3Key = profile.getConstanciaFiscalS3Key();
   */
  getConstanciaFiscalS3Key() {
    return this.get('constanciaFiscalS3Key') || '';
  }

  /**
   * Set constancia fiscal S3 key (Mexico).
   * @param {string} constanciaFiscalS3Key - S3 key for constancia de situacion fiscal.
   * @example
   * profile.setConstanciaFiscalS3Key('billing/constancias/abc123.pdf');
   */
  setConstanciaFiscalS3Key(constanciaFiscalS3Key) {
    this.set('constanciaFiscalS3Key', constanciaFiscalS3Key);
  }

  /**
   * Get constancia fiscal URL.
   * @returns {string} URL for constancia de situacion fiscal.
   * @example
   * const url = profile.getConstanciaFiscalUrl();
   */
  getConstanciaFiscalUrl() {
    return this.get('constanciaFiscalUrl') || '';
  }

  /**
   * Set constancia fiscal URL.
   * @param {string} constanciaFiscalUrl - URL for constancia de situacion fiscal.
   * @example
   * profile.setConstanciaFiscalUrl('https://s3.amazonaws.com/...');
   */
  setConstanciaFiscalUrl(constanciaFiscalUrl) {
    this.set('constanciaFiscalUrl', constanciaFiscalUrl);
  }

  /**
   * Get constancia fiscal upload date.
   * @returns {Date|null} Upload date or null.
   * @example
   * const date = profile.getConstanciaFiscalUploadDate();
   */
  getConstanciaFiscalUploadDate() {
    return this.get('constanciaFiscalUploadDate') || null;
  }

  /**
   * Set constancia fiscal upload date.
   * @param {Date} constanciaFiscalUploadDate - Upload date.
   * @example
   * profile.setConstanciaFiscalUploadDate(new Date());
   */
  setConstanciaFiscalUploadDate(constanciaFiscalUploadDate) {
    this.set('constanciaFiscalUploadDate', constanciaFiscalUploadDate);
  }

  /**
   * Get additional documents array.
   * @returns {Array} Array of document objects [{s3Key, url, fileName, uploadDate}].
   * @example
   * const docs = profile.getAdditionalDocuments();
   */
  getAdditionalDocuments() {
    return this.get('additionalDocuments') || [];
  }

  /**
   * Set additional documents array.
   * @param {Array} additionalDocuments - Array of document objects [{s3Key, url, fileName, uploadDate}].
   * @example
   * profile.setAdditionalDocuments([{s3Key: 'docs/file.pdf', url: '...', fileName: 'file.pdf', uploadDate: new Date()}]);
   */
  setAdditionalDocuments(additionalDocuments) {
    if (additionalDocuments && Array.isArray(additionalDocuments)) {
      this.set('additionalDocuments', additionalDocuments);
    } else {
      this.set('additionalDocuments', []);
    }
  }

  // =================
  // BUSINESS LOGIC
  // =================

  /**
   * Check if this is a Mexican billing profile.
   * @returns {boolean} True if country is MX.
   * @example
   * if (profile.isMexican()) { ... }
   */
  isMexican() {
    return this.getCountry() === 'MX';
  }

  /**
   * Check if this is an international billing profile.
   * @returns {boolean} True if country is not MX.
   * @example
   * if (profile.isInternational()) { ... }
   */
  isInternational() {
    return this.getCountry() !== 'MX' && this.getCountry() !== '';
  }

  /**
   * Get display name for this profile.
   * @returns {string} Display name (label or razonSocial/commercialName).
   * @example
   * const displayName = profile.getDisplayName();
   */
  getDisplayName() {
    return this.getLabel() || this.getRazonSocial() || this.getCommercialName() || '';
  }

  /**
   * Parse Server validation method - called automatically during set() operations.
   * Only validates field constraints, not required field presence.
   * @returns {void} Parse Server expects no return value on success.
   * @example
   */
  validate() {
    // Skip validation if object is being initialized (no createdAt means it's new)
    if (!this.get('createdAt')) {
      return;
    }

    const errors = [];

    const label = this.get('label');
    if (label && label.length > 280) {
      errors.push('Label must be 280 characters or less');
    }

    const rfc = this.get('rfc');
    if (rfc && (rfc.length < 12 || rfc.length > 13)) {
      errors.push('RFC must be 12 or 13 characters');
    }

    const codigoPostal = this.get('codigoPostal');
    if (codigoPostal && !/^\d{5}$/.test(codigoPostal)) {
      errors.push('Codigo postal must be exactly 5 digits');
    }

    const emailFacturacion = this.get('emailFacturacion');
    if (emailFacturacion && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailFacturacion)) {
      errors.push('Email facturacion must be a valid email address');
    }

    if (errors.length > 0) {
      throw new Error(errors.join(', '));
    }
  }

  /**
   * Explicit validation method that returns validation result object.
   * Use this for manual validation checks in controllers.
   * @returns {object} Validation result {valid: boolean, errors: string[]}.
   * @example
   * const validation = profile.validateExplicitly();
   * if (!validation.valid) { console.log(validation.errors); }
   */
  validateExplicitly() {
    const errors = [];

    // Skip validation if object is being initialized (no createdAt means it's new)
    if (!this.get('createdAt')) {
      return {
        valid: true,
        errors: [],
      };
    }

    if (!this.getUserPtr()) {
      errors.push('User pointer is required');
    }

    if (!this.getCountry()) {
      errors.push('Country is required');
    }

    if (!this.getLabel()) {
      errors.push('Label is required');
    }

    const label = this.get('label');
    if (label && label.length > 280) {
      errors.push('Label must be 280 characters or less');
    }

    // Mexico-specific validations
    if (this.isMexican()) {
      if (!this.getRfc()) {
        errors.push('RFC is required for Mexican billing profiles');
      }

      const rfc = this.get('rfc');
      if (rfc && (rfc.length < 12 || rfc.length > 13)) {
        errors.push('RFC must be 12 or 13 characters');
      }

      if (!this.getRazonSocial()) {
        errors.push('Razon social is required for Mexican billing profiles');
      }

      if (!this.getRegimenFiscal()) {
        errors.push('Regimen fiscal is required for Mexican billing profiles');
      }

      if (!this.getUsoCfdi()) {
        errors.push('Uso CFDI is required for Mexican billing profiles');
      }

      const codigoPostal = this.get('codigoPostal');
      if (!codigoPostal) {
        errors.push('Codigo postal is required for Mexican billing profiles');
      } else if (!/^\d{5}$/.test(codigoPostal)) {
        errors.push('Codigo postal must be exactly 5 digits');
      }
    }

    // International-specific validations
    if (this.isInternational()) {
      if (!this.getTaxId()) {
        errors.push('Tax ID is required for international billing profiles');
      }

      if (!this.getCommercialName()) {
        errors.push('Commercial name is required for international billing profiles');
      }
    }

    // Common validations
    if (!this.getEmailFacturacion()) {
      errors.push('Email facturacion is required');
    }

    const emailFacturacion = this.get('emailFacturacion');
    if (emailFacturacion && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailFacturacion)) {
      errors.push('Email facturacion must be a valid email address');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // =================
  // STATIC METHODS
  // =================

  /**
   * Get all active billing profiles for a user.
   * @param {string} userId - AmexingUser ID.
   * @returns {Promise<BillingProfile[]>} Array of billing profiles.
   * @example
   * const profiles = await BillingProfile.getByUser(userId);
   */
  static async getByUser(userId) {
    try {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const userPointer = new AmexingUser();
      userPointer.id = userId;

      const query = BaseModel.queryActive('BillingProfile');
      query.equalTo('userPtr', userPointer);
      query.descending('isPrimary');
      query.ascending('label');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting billing profiles by user', {
        userId,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get the primary billing profile for a user.
   * @param {string} userId - AmexingUser ID.
   * @returns {Promise<BillingProfile|undefined>} Primary billing profile or undefined.
   * @example
   * const primary = await BillingProfile.getPrimaryForUser(userId);
   */
  static async getPrimaryForUser(userId) {
    try {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const userPointer = new AmexingUser();
      userPointer.id = userId;

      const query = BaseModel.queryActive('BillingProfile');
      query.equalTo('userPtr', userPointer);
      query.equalTo('isPrimary', true);

      const result = await query.first({ useMasterKey: true });
      return result;
    } catch (error) {
      logger.error('Error getting primary billing profile for user', {
        userId,
        error: error.message,
      });
      return undefined;
    }
  }
}

// Register the subclass with Parse
Parse.Object.registerSubclass('BillingProfile', BillingProfile);

module.exports = BillingProfile;
