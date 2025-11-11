/**
 * Experience - Domain model for experiences and providers management.
 *
 * Manages the catalog of experiences (tours, packages) and providers.
 * Experiences can contain other experiences creating packages.
 * Type field differentiates between "Experience" and "Provider".
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
 * // Create new experience
 * const experience = new Experience();
 * experience.setName('Tour Centro Histórico');
 * experience.setType('Experience');
 * experience.setCost(500);
 * await experience.save();
 *
 * // Create package with included experiences
 * const package = new Experience();
 * package.setName('Tour Centro + Gastronómico');
 * package.setType('Experience');
 * package.setIncludedExperiences([tourCentro, tourGastro]);
 * package.setCost(1200);
 * await package.save();
 *
 * // Query active experiences
 * const activeExperiences = await Experience.queryActive('Experience').find();
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * Experience class for managing experiences and providers.
 * @class Experience
 * @augments BaseModel
 */
class Experience extends BaseModel {
  /**
   * Create an Experience instance.
   * @example
   * // Usage example documented above
   */
  constructor() {
    super('Experience');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get experience name.
   * @returns {string} Experience name.
   * @example
   * // Usage example documented above
   */
  getName() {
    return this.get('name') || '';
  }

  /**
   * Set experience name.
   * @param {string} name - Experience name.
   * @example
   * // Usage example documented above
   */
  setName(name) {
    this.set('name', name);
  }

  /**
   * Get experience description.
   * @returns {string} Description.
   * @example
   * // Usage example documented above
   */
  getDescription() {
    return this.get('description') || '';
  }

  /**
   * Set experience description.
   * @param {string} description - Description.
   * @example
   * // Usage example documented above
   */
  setDescription(description) {
    this.set('description', description);
  }

  /**
   * Get included experiences (Array of Pointers).
   * @returns {Parse.Object[]} Array of Experience pointers.
   * @example
   * // Usage example documented above
   */
  getIncludedExperiences() {
    return this.get('experiences') || [];
  }

  /**
   * Set included experiences.
   * @param {Parse.Object[]} experiencesArray - Array of Experience pointers.
   * @example
   * // Usage example documented above
   */
  setIncludedExperiences(experiencesArray) {
    this.set('experiences', experiencesArray);
  }

  /**
   * Get included tours (Array of Pointers).
   * @returns {Parse.Object[]} Array of Tour pointers.
   * @example
   * const tours = experience.getIncludedTours();
   * console.log(tours); // Array of Tour pointers
   */
  getIncludedTours() {
    return this.get('tours') || [];
  }

  /**
   * Set included tours.
   * @param {Parse.Object[]} toursArray - Array of Tour pointers.
   * @example
   * experience.setIncludedTours([tour1, tour2]);
   */
  setIncludedTours(toursArray) {
    this.set('tours', toursArray);
  }

  /**
   * Add experience to package.
   * @param {Parse.Object} experiencePointer - Experience pointer to add.
   * @example
   * // Usage example documented above
   */
  addExperience(experiencePointer) {
    const current = this.getIncludedExperiences();
    current.push(experiencePointer);
    this.setIncludedExperiences(current);
  }

  /**
   * Remove experience from package.
   * @param {string} experienceId - Experience ID to remove.
   * @example
   * // Usage example documented above
   */
  removeExperience(experienceId) {
    const current = this.getIncludedExperiences();
    const filtered = current.filter((exp) => exp.id !== experienceId);
    this.setIncludedExperiences(filtered);
  }

  /**
   * Add tour to package.
   * @param {Parse.Object} tourPointer - Tour pointer to add.
   * @example
   * experience.addTour(tourPointer);
   */
  addTour(tourPointer) {
    const current = this.getIncludedTours();
    current.push(tourPointer);
    this.setIncludedTours(current);
  }

  /**
   * Remove tour from package.
   * @param {string} tourId - Tour ID to remove.
   * @example
   * experience.removeTour('tour123');
   */
  removeTour(tourId) {
    const current = this.getIncludedTours();
    const filtered = current.filter((tour) => tour.id !== tourId);
    this.setIncludedTours(filtered);
  }

  /**
   * Get experience type (Experience or Provider).
   * @returns {string} Type.
   * @example
   * // Usage example documented above
   */
  getType() {
    return this.get('type') || 'Experience';
  }

  /**
   * Set experience type.
   * @param {string} type - Type (Experience or Provider).
   * @example
   * // Usage example documented above
   */
  setType(type) {
    const validTypes = ['Experience', 'Provider'];
    if (!validTypes.includes(type)) {
      throw new Error(`Invalid type: ${type}. Must be Experience or Provider`);
    }
    this.set('type', type);
  }

  /**
   * Get experience cost.
   * @returns {number} Cost.
   * @example
   * // Usage example documented above
   */
  getCost() {
    return this.get('cost') || 0;
  }

  /**
   * Set experience cost.
   * @param {number} cost - Cost amount.
   * @example
   * // Usage example documented above
   */
  setCost(cost) {
    if (cost < 0) {
      throw new Error('Cost must be greater than or equal to 0');
    }
    this.set('cost', cost);
  }

  /**
   * Get main image URL (presigned S3 URL).
   * @returns {string} Main image URL or empty string.
   * @example
   * const mainImage = experience.getMainImage();
   * console.log(mainImage); // 'https://s3.amazonaws.com/bucket/experiences/...'
   */
  getMainImage() {
    return this.get('mainImage') || '';
  }

  /**
   * Set main image URL (presigned S3 URL).
   * @param {string} url - Main image URL (presigned S3 URL).
   * @example
   * experience.setMainImage('https://s3.amazonaws.com/bucket/experiences/...');
   */
  setMainImage(url) {
    this.set('mainImage', url);
  }

  /**
   * Get provider type (for Provider type experiences only).
   * @returns {string|null} Provider type or null if not set.
   * @example
   * const providerType = provider.getProviderType();
   * console.log(providerType); // 'Exclusivo' or null
   */
  getProviderType() {
    return this.get('providerType') || null;
  }

  /**
   * Set provider type (for Provider type experiences only).
   * @param {string} providerType - Provider type (Exclusivo, Compartido, Privado).
   * @example
   * provider.setProviderType('Exclusivo');
   */
  setProviderType(providerType) {
    const validTypes = ['Exclusivo', 'Compartido', 'Privado'];
    if (!validTypes.includes(providerType)) {
      throw new Error(`Invalid provider type: ${providerType}. Must be Exclusivo, Compartido, or Privado`);
    }
    this.set('providerType', providerType);
  }

  /**
   * Get duration in hours.
   * @returns {number|null} Duration in hours or null if not set.
   * @example
   * const duration = experience.getDuration();
   * console.log(duration); // 2.5 or null
   */
  getDuration() {
    return this.get('duration') || null;
  }

  /**
   * Set duration in hours.
   * @param {number} duration - Duration in hours (must be positive).
   * @example
   * experience.setDuration(2.5);
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
   * Get vehicle type (optional relationship to VehicleType).
   * @returns {object|null} VehicleType Parse object or null if not set.
   * @example
   * const vehicleType = experience.getVehicleType();
   * console.log(vehicleType?.get('name')); // 'Sedan' or null
   */
  getVehicleType() {
    return this.get('vehicleType') || null;
  }

  /**
   * Set vehicle type (optional relationship to VehicleType).
   * @param {object|null} vehicleType - VehicleType Parse object, Pointer, or null.
   * @example
   * experience.setVehicleType(vehicleTypePointer);
   * // or clear the relationship
   * experience.setVehicleType(null);
   */
  setVehicleType(vehicleType) {
    this.set('vehicleType', vehicleType);
  }

  // =================
  // BUSINESS LOGIC
  // =================

  /**
   * Check if this experience is a package (contains other experiences or tours).
   * @returns {boolean} True if package.
   * @example
   * // Usage example documented above
   */
  isPackage() {
    return this.getIncludedExperiences().length > 0 || this.getIncludedTours().length > 0;
  }

  /**
   * Get number of included experiences.
   * @returns {number} Count of included experiences.
   * @example
   * // Usage example documented above
   */
  getIncludedCount() {
    return this.getIncludedExperiences().length;
  }

  /**
   * Get number of included tours.
   * @returns {number} Count of included tours.
   * @example
   * const tourCount = experience.getIncludedToursCount();
   * console.log(tourCount); // 3
   */
  getIncludedToursCount() {
    return this.getIncludedTours().length;
  }

  /**
   * Get total count of included items (experiences + tours).
   * @returns {number} Total count of included experiences and tours.
   * @example
   * const totalItems = experience.getTotalIncludedCount();
   * console.log(totalItems); // 5 (2 experiences + 3 tours)
   */
  getTotalIncludedCount() {
    return this.getIncludedExperiences().length + this.getIncludedTours().length;
  }

  /**
   * Check if experience is available for booking.
   * @returns {boolean} True if available.
   * @example
   * // Usage example documented above
   */
  isAvailable() {
    return this.isActive();
  }

  /**
   * Get display name for experience.
   * @returns {string} Display name.
   * @example
   * // Usage example documented above
   */
  getDisplayName() {
    if (!this.isPackage()) {
      return this.getName();
    }

    const experiencesCount = this.getIncludedCount();
    const toursCount = this.getIncludedToursCount();
    const items = [];

    if (experiencesCount > 0) {
      items.push(`${experiencesCount} experiencias`);
    }
    if (toursCount > 0) {
      items.push(`${toursCount} tours`);
    }

    const packageInfo = items.length > 0 ? ` (${items.join(', ')})` : '';
    return `${this.getName()}${packageInfo}`;
  }

  /**
   * Validate experience data before save.
   * @returns {object} Validation result {valid: boolean, errors: string[]}.
   * @example
   * // Usage example documented above
   */
  validate() {
    const errors = [];

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

    if (!this.getType()) {
      errors.push('Type is required');
    }

    const validTypes = ['Experience', 'Provider'];
    if (!validTypes.includes(this.getType())) {
      errors.push('Type must be Experience or Provider');
    }

    // Validate providerType for Provider type experiences (optional field)
    if (this.getType() === 'Provider') {
      const providerType = this.get('providerType'); // Get raw value to check for null/undefined
      if (providerType) {
        // Only validate if providerType is provided
        const validProviderTypes = ['Exclusivo', 'Compartido', 'Privado'];
        if (!validProviderTypes.includes(providerType)) {
          errors.push('Provider type must be Exclusivo, Compartido, or Privado');
        }
      }
    }

    const cost = this.getCost();
    if (cost < 0) {
      errors.push('Cost must be greater than or equal to 0');
    }

    // Validate duration (optional field)
    const duration = this.get('duration');
    if (duration !== null && duration !== undefined) {
      if (duration < 0) {
        errors.push('Duration must be greater than or equal to 0');
      }
    }

    const experiences = this.getIncludedExperiences();
    const tours = this.getIncludedTours();
    const totalItems = this.getTotalIncludedCount();

    if (experiences.length > 20) {
      errors.push('Maximum 20 experiences per package');
    }

    if (tours.length > 20) {
      errors.push('Maximum 20 tours per package');
    }

    if (totalItems > 30) {
      errors.push('Maximum 30 total items (experiences + tours) per package');
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
   * Find experiences by type.
   * @param {string} type - Type (Experience or Provider).
   * @returns {Promise<Experience[]>} Array of experiences.
   * @example
   * // Usage example documented above
   */
  static async findByType(type) {
    try {
      const query = BaseModel.queryActive('Experience');
      query.equalTo('type', type);
      query.include('experiences');
      query.include('tours');
      query.include('tours');
      query.ascending('name');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error finding experiences by type', {
        type,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Find experience by name.
   * @param {string} name - Experience name.
   * @returns {Promise<Experience|undefined>} Experience or undefined.
   * @example
   * // Usage example documented above
   */
  static async findByName(name) {
    try {
      const query = new Parse.Query('Experience');
      query.equalTo('name', name);
      query.equalTo('exists', true);
      query.include('experiences');
      query.include('tours');

      const result = await query.first({ useMasterKey: true });
      return result;
    } catch (error) {
      logger.error('Error finding experience by name', {
        name,
        error: error.message,
      });
      return undefined;
    }
  }

  /**
   * Get available experiences (active and exists).
   * @param {string} type - Optional type filter (Experience or Provider).
   * @returns {Promise<Experience[]>} Array of available experiences.
   * @example
   * // Usage example documented above
   */
  static async getAvailable(type = null) {
    try {
      const query = BaseModel.queryActive('Experience');
      if (type) {
        query.equalTo('type', type);
      }
      query.include('experiences');
      query.include('tours');
      query.ascending('name');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting available experiences', {
        type,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Check if experience name is unique.
   * @param {string} name - Name to check.
   * @param {string} excludeId - Exclude this ID from check (for updates).
   * @returns {Promise<boolean>} True if unique.
   * @example
   * // Usage example documented above
   */
  static async isNameUnique(name, excludeId = null) {
    try {
      const query = new Parse.Query('Experience');
      query.equalTo('name', name);
      query.equalTo('exists', true);

      if (excludeId) {
        query.notEqualTo('objectId', excludeId);
      }

      const count = await query.count({ useMasterKey: true });
      return count === 0;
    } catch (error) {
      logger.error('Error checking name uniqueness', {
        name,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Get packages that include a specific experience.
   * @param {string} experienceId - Experience ID to search for.
   * @returns {Promise<Experience[]>} Array of packages containing the experience.
   * @example
   * // Usage example documented above
   */
  static async getPackagesContaining(experienceId) {
    try {
      const experiencePointer = {
        __type: 'Pointer',
        className: 'Experience',
        objectId: experienceId,
      };

      const query = new Parse.Query('Experience');
      query.equalTo('exists', true);
      query.equalTo('experiences', experiencePointer);
      query.include('experiences');
      query.include('tours');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting packages containing experience', {
        experienceId,
        error: error.message,
      });
      return [];
    }
  }
}

// COMMENTED OUT: registerSubclass causes issues with set() + save() for fields
// The BaseModel inheritance interferes with Parse.Object field updates
// Using Parse.Object.extend('Experience') directly works correctly
// Parse.Object.registerSubclass('Experience', Experience);

module.exports = Experience;
