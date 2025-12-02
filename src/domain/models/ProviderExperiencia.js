/**
 * ProviderExperiencia - Domain model for provider services management.
 *
 * Manages individual services (experiencias) offered by providers.
 * Each provider can have multiple experiencias with their own pricing and descriptions.
 *
 * Lifecycle States:
 * - active: true, exists: true = Available for booking
 * - active: false, exists: true = Inactive (not bookable but preserved)
 * - active: false, exists: false = Soft deleted (audit trail only).
 * @augments BaseModel
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Create new provider experiencia
 * const experiencia = new ProviderExperiencia();
 * experiencia.setProvider(providerPointer);
 * experiencia.setName('Tour Gastronómico Premium');
 * experiencia.setDescription('Experiencia culinaria por los mejores restaurantes');
 * experiencia.setPrice(1500);
 * await experiencia.save();
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * ProviderExperiencia class for managing provider services.
 * @class ProviderExperiencia
 * @augments BaseModel
 */
class ProviderExperiencia extends BaseModel {
  /**
   * Create a ProviderExperiencia instance.
   * @example
   * // Usage example documented above
   */
  constructor() {
    super('ProviderExperiencia');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get provider reference.
   * @returns {Parse.Object} Provider pointer.
   * @example
   * const provider = experiencia.getProvider();
   */
  getProvider() {
    return this.get('provider');
  }

  /**
   * Set provider reference.
   * @param {Parse.Object} provider - Provider pointer.
   * @example
   * experiencia.setProvider(providerPointer);
   */
  setProvider(provider) {
    this.set('provider', provider);
  }

  /**
   * Get experiencia name.
   * @returns {string} Experiencia name.
   * @example
   * const name = experiencia.getName();
   */
  getName() {
    return this.get('name') || '';
  }

  /**
   * Set experiencia name.
   * @param {string} name - Experiencia name.
   * @example
   * experiencia.setName('Tour Gastronómico');
   */
  setName(name) {
    this.set('name', name);
  }

  /**
   * Get experiencia description.
   * @returns {string} Description.
   * @example
   * const description = experiencia.getDescription();
   */
  getDescription() {
    return this.get('description') || '';
  }

  /**
   * Set experiencia description.
   * @param {string} description - Description.
   * @example
   * experiencia.setDescription('Tour por los mejores restaurantes');
   */
  setDescription(description) {
    this.set('description', description);
  }

  /**
   * Get experiencia price.
   * @returns {number} Price.
   * @example
   * const price = experiencia.getPrice();
   */
  getPrice() {
    return this.get('price') || 0;
  }

  /**
   * Set experiencia price.
   * @param {number} price - Price amount.
   * @example
   * experiencia.setPrice(1500);
   */
  setPrice(price) {
    if (price < 0) {
      throw new Error('Price must be greater than or equal to 0');
    }
    this.set('price', price);
  }

  /**
   * Get duration in hours.
   * @returns {number|null} Duration in hours or null if not set.
   * @example
   * const duration = experiencia.getDuration();
   */
  getDuration() {
    return this.get('duration') || null;
  }

  /**
   * Set duration in hours.
   * @param {number} duration - Duration in hours (must be positive).
   * @example
   * experiencia.setDuration(3.5);
   */
  setDuration(duration) {
    if (duration !== null && duration !== undefined) {
      if (duration < 0) {
        throw new Error('Duration must be greater than or equal to 0');
      }
      this.set('duration', parseFloat(duration));
    } else {
      this.set('duration', null);
    }
  }

  /**
   * Get minimum people required.
   * @returns {number|null} Minimum people or null if not set.
   * @example
   * const minPeople = experiencia.getMinPeople();
   */
  getMinPeople() {
    return this.get('min_people') || null;
  }

  /**
   * Set minimum people required.
   * @param {number} minPeople - Minimum people (must be positive).
   * @example
   * experiencia.setMinPeople(2);
   */
  setMinPeople(minPeople) {
    if (minPeople !== null && minPeople !== undefined) {
      if (minPeople < 1) {
        throw new Error('Minimum people must be greater than 0');
      }
      this.set('min_people', parseInt(minPeople, 10));
    } else {
      this.set('min_people', null);
    }
  }

  /**
   * Get maximum people allowed.
   * @returns {number|null} Maximum people or null if not set.
   * @example
   * const maxPeople = experiencia.getMaxPeople();
   */
  getMaxPeople() {
    return this.get('max_people') || null;
  }

  /**
   * Set maximum people allowed.
   * @param {number} maxPeople - Maximum people (must be positive).
   * @example
   * experiencia.setMaxPeople(10);
   */
  setMaxPeople(maxPeople) {
    if (maxPeople !== null && maxPeople !== undefined) {
      if (maxPeople < 1) {
        throw new Error('Maximum people must be greater than 0');
      }
      this.set('max_people', parseInt(maxPeople, 10));
    } else {
      this.set('max_people', null);
    }
  }

  /**
   * Get experiencia tipo.
   * @returns {string|null} Tipo or null if not set.
   * @example
   * const tipo = experiencia.getTipo();
   */
  getTipo() {
    return this.get('tipo') || null;
  }

  /**
   * Set experiencia tipo.
   * @param {string} tipo - Tipo (Exclusivo, Compartido, Privado).
   * @example
   * experiencia.setTipo('Exclusivo');
   */
  setTipo(tipo) {
    if (tipo && !['Exclusivo', 'Compartido', 'Privado'].includes(tipo)) {
      throw new Error(`Invalid tipo: ${tipo}. Must be Exclusivo, Compartido, or Privado`);
    }
    this.set('tipo', tipo);
  }

  /**
   * Get display order.
   * @returns {number} Display order.
   * @example
   * const order = experiencia.getDisplayOrder();
   */
  getDisplayOrder() {
    return this.get('displayOrder') || 0;
  }

  /**
   * Set display order.
   * @param {number} order - Display order.
   * @example
   * experiencia.setDisplayOrder(1);
   */
  setDisplayOrder(order) {
    this.set('displayOrder', parseInt(order, 10));
  }

  // =================
  // BUSINESS LOGIC
  // =================

  /**
   * Check if experiencia is available for booking.
   * @returns {boolean} True if available.
   * @example
   * if (experiencia.isAvailable()) { ... }
   */
  isAvailable() {
    return this.isActive();
  }

  /**
   * Get display name for experiencia.
   * @returns {string} Display name.
   * @example
   * const displayName = experiencia.getDisplayName();
   */
  getDisplayName() {
    return this.getName();
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

    // Only validate field constraints, not required field presence
    const name = this.get('name');
    if (name && name.length > 200) {
      errors.push('Name must be 200 characters or less');
    }

    const description = this.get('description');
    if (description && description.length > 1000) {
      errors.push('Description must be 1000 characters or less');
    }

    const price = this.getPrice();
    if (price !== undefined && price !== null && price < 0) {
      errors.push('Price must be greater than or equal to 0');
    }

    // Validate tipo (optional field)
    const tipo = this.get('tipo');
    if (tipo) {
      const validTipos = ['Exclusivo', 'Compartido', 'Privado'];
      if (!validTipos.includes(tipo)) {
        errors.push('Tipo must be Exclusivo, Compartido, or Privado');
      }
    }

    // Validate optional fields
    const duration = this.get('duration');
    if (duration !== null && duration !== undefined && duration < 0) {
      errors.push('Duration must be greater than or equal to 0');
    }

    const minPeople = this.get('min_people');
    if (minPeople !== null && minPeople !== undefined && minPeople < 1) {
      errors.push('Minimum people must be greater than 0');
    }

    const maxPeople = this.get('max_people');
    if (maxPeople !== null && maxPeople !== undefined) {
      if (maxPeople < 1) {
        errors.push('Maximum people must be greater than 0');
      }
      if (minPeople && maxPeople < minPeople) {
        errors.push('Maximum people must be greater than or equal to minimum people');
      }
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
   * const validation = experiencia.validateExplicitly();
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

    if (!this.getProvider()) {
      errors.push('Provider is required');
    }

    if (!this.getName()) {
      errors.push('Name is required');
    }

    if (this.getName().length > 200) {
      errors.push('Name must be 200 characters or less');
    }

    if (!this.getDescription()) {
      errors.push('Description is required');
    }

    if (this.getDescription().length > 1000) {
      errors.push('Description must be 1000 characters or less');
    }

    const price = this.getPrice();
    if (price < 0) {
      errors.push('Price must be greater than or equal to 0');
    }

    // Validate tipo (optional field)
    const tipo = this.get('tipo');
    if (tipo) {
      const validTipos = ['Exclusivo', 'Compartido', 'Privado'];
      if (!validTipos.includes(tipo)) {
        errors.push('Tipo must be Exclusivo, Compartido, or Privado');
      }
    }

    // Validate optional fields
    const duration = this.get('duration');
    if (duration !== null && duration !== undefined) {
      if (duration < 0) {
        errors.push('Duration must be greater than or equal to 0');
      }
    }

    const minPeople = this.get('min_people');
    if (minPeople !== null && minPeople !== undefined) {
      if (minPeople < 1) {
        errors.push('Minimum people must be greater than 0');
      }
    }

    const maxPeople = this.get('max_people');
    if (maxPeople !== null && maxPeople !== undefined) {
      if (maxPeople < 1) {
        errors.push('Maximum people must be greater than 0');
      }
      if (minPeople && maxPeople < minPeople) {
        errors.push('Maximum people must be greater than or equal to minimum people');
      }
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
   * Find experiencias by provider.
   * @param {string} providerId - Provider ID.
   * @returns {Promise<ProviderExperiencia[]>} Array of experiencias.
   * @example
   * const experiencias = await ProviderExperiencia.findByProvider(providerId);
   */
  static async findByProvider(providerId) {
    try {
      const providerPointer = {
        __type: 'Pointer',
        className: 'Experience',
        objectId: providerId,
      };

      const query = BaseModel.queryActive('ProviderExperiencia');
      query.equalTo('provider', providerPointer);
      query.ascending('displayOrder');
      query.ascending('name');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error finding experiencias by provider', {
        providerId,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Find experiencia by name for a provider.
   * @param {string} providerId - Provider ID.
   * @param {string} name - Experiencia name.
   * @returns {Promise<ProviderExperiencia|undefined>} Experiencia or undefined.
   * @example
   * const experiencia = await ProviderExperiencia.findByProviderAndName(providerId, 'Tour Premium');
   */
  static async findByProviderAndName(providerId, name) {
    try {
      const providerPointer = {
        __type: 'Pointer',
        className: 'Experience',
        objectId: providerId,
      };

      const query = new Parse.Query('ProviderExperiencia');
      query.equalTo('provider', providerPointer);
      query.equalTo('name', name);
      query.equalTo('exists', true);

      const result = await query.first({ useMasterKey: true });
      return result;
    } catch (error) {
      logger.error('Error finding experiencia by provider and name', {
        providerId,
        name,
        error: error.message,
      });
      return undefined;
    }
  }

  /**
   * Get available experiencias for a provider.
   * @param {string} providerId - Provider ID.
   * @returns {Promise<ProviderExperiencia[]>} Array of available experiencias.
   * @example
   * const available = await ProviderExperiencia.getAvailable(providerId);
   */
  static async getAvailable(providerId) {
    try {
      const providerPointer = {
        __type: 'Pointer',
        className: 'Experience',
        objectId: providerId,
      };

      const query = BaseModel.queryActive('ProviderExperiencia');
      query.equalTo('provider', providerPointer);
      query.ascending('displayOrder');
      query.ascending('name');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting available experiencias', {
        providerId,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Check if experiencia name is unique for a provider.
   * @param {string} providerId - Provider ID.
   * @param {string} name - Name to check.
   * @param {string} excludeId - Exclude this ID from check (for updates).
   * @returns {Promise<boolean>} True if unique.
   * @example
   * const isUnique = await ProviderExperiencia.isNameUnique(providerId, 'Tour VIP', excludeId);
   */
  static async isNameUnique(providerId, name, excludeId = null) {
    try {
      const providerPointer = {
        __type: 'Pointer',
        className: 'Experience',
        objectId: providerId,
      };

      const query = new Parse.Query('ProviderExperiencia');
      query.equalTo('provider', providerPointer);
      query.equalTo('name', name);
      query.equalTo('exists', true);

      if (excludeId) {
        query.notEqualTo('objectId', excludeId);
      }

      const count = await query.count({ useMasterKey: true });
      return count === 0;
    } catch (error) {
      logger.error('Error checking name uniqueness', {
        providerId,
        name,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Count experiencias for a provider.
   * @param {string} providerId - Provider ID.
   * @returns {Promise<number>} Count of experiencias.
   * @example
   * const count = await ProviderExperiencia.countByProvider(providerId);
   */
  static async countByProvider(providerId) {
    try {
      const providerPointer = {
        __type: 'Pointer',
        className: 'Experience',
        objectId: providerId,
      };

      const query = BaseModel.queryActive('ProviderExperiencia');
      query.equalTo('provider', providerPointer);

      return await query.count({ useMasterKey: true });
    } catch (error) {
      logger.error('Error counting experiencias by provider', {
        providerId,
        error: error.message,
      });
      return 0;
    }
  }

  /**
   * Get availability schedule.
   * @returns {Array|null} Availability array or null if not set.
   * @example
   * const availability = experiencia.getAvailability();
   */
  getAvailability() {
    return this.get('availability') || null;
  }

  /**
   * Set availability schedule.
   * @param {Array} availability - Availability schedule array.
   * @example
   * experiencia.setAvailability([{day: 1, startTime: '09:00', endTime: '18:00'}]);
   */
  setAvailability(availability) {
    if (availability && Array.isArray(availability)) {
      this.set('availability', availability);
    } else {
      this.set('availability', null);
    }
  }
}

// Register the subclass with Parse
Parse.Object.registerSubclass('ProviderExperiencia', ProviderExperiencia);

module.exports = ProviderExperiencia;
