/**
 * Vehicle - Domain model for fleet vehicle management.
 *
 * Manages the physical vehicle inventory used for transportation services.
 * Each vehicle has a type (Pointer to VehicleType), optional rate (Pointer to Rate),
 * capacity, and maintenance information.
 *
 * Lifecycle States:
 * - active: true, exists: true = Available for bookings
 * - active: false, exists: true = Inactive/maintenance (not bookable but preserved)
 * - active: false, exists: false = Soft deleted (audit trail only).
 * @augments BaseModel
 * @author Amexing Development Team
 * @version 1.1.0
 * @since 1.0.0
 * @example
 * // Create new vehicle with rate
 * const vehicle = new Vehicle();
 * vehicle.setVehicleType(vehicleTypePointer);
 * vehicle.setRate(ratePointer); // Optional
 * vehicle.setBrand('Mercedes-Benz');
 * vehicle.setModel('Clase E');
 * vehicle.setYear(2024);
 * await vehicle.save();
 *
 * // Query active vehicles
 * const activeVehicles = await Vehicle.queryActive('Vehicle').find();
 *
 * // Find by license plate
 * const vehicle = await Vehicle.findByLicensePlate('ABC-123-XYZ');
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * Vehicle class for managing fleet inventory.
 * @class Vehicle
 * @augments BaseModel
 */
class Vehicle extends BaseModel {
  /**
   * Create a Vehicle instance.
   * @example
   * // Usage example documented above
   */
  constructor() {
    super('Vehicle');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get vehicle type (Pointer to VehicleType).
   * @returns {Parse.Object} VehicleType pointer.
   * @example
   * // Usage example documented above
   */
  getVehicleType() {
    return this.get('vehicleTypeId');
  }

  /**
   * Set vehicle type.
   * @param {Parse.Object} vehicleType - VehicleType pointer.
   * @example
   * // Usage example documented above
   */
  setVehicleType(vehicleType) {
    this.set('vehicleTypeId', vehicleType);
  }

  /**
   * Get service ID (Pointer to Service).
   * @returns {Parse.Object} Service pointer.
   * @example
   * // Usage example documented above
   */
  getService() {
    return this.get('serviceId');
  }

  /**
   * Set service.
   * @param {Parse.Object} service - Service pointer.
   * @example
   * // Usage example documented above
   */
  setService(service) {
    this.set('serviceId', service);
  }

  /**
   * Get rate (Pointer to Rate).
   * @returns {Parse.Object} Rate pointer.
   * @example
   * const rate = vehicle.getRate();
   * if (rate) {
   *   console.log('Rate:', rate.get('name'));
   * }
   */
  getRate() {
    return this.get('rateId');
  }

  /**
   * Set rate.
   * @param {Parse.Object|null} rate - Rate pointer or null to remove rate.
   * @example
   * vehicle.setRate(ratePointer);
   * // Or remove rate
   * vehicle.setRate(null);
   */
  setRate(rate) {
    if (rate === null) {
      this.unset('rateId');
    } else {
      this.set('rateId', rate);
    }
  }

  /**
   * Get vehicle brand.
   * @returns {string} Brand name.
   * @example
   * // Usage example documented above
   */
  getBrand() {
    return this.get('brand') || '';
  }

  /**
   * Set vehicle brand.
   * @param {string} brand - Brand name.
   * @example
   * // Usage example documented above
   */
  setBrand(brand) {
    this.set('brand', brand);
  }

  /**
   * Get vehicle model.
   * @returns {string} Model name.
   * @example
   * // Usage example documented above
   */
  getModel() {
    return this.get('model') || '';
  }

  /**
   * Set vehicle model.
   * @param {string} model - Model name.
   * @example
   * // Usage example documented above
   */
  setModel(model) {
    this.set('model', model);
  }

  /**
   * Get manufacturing year.
   * @returns {number} Year.
   * @example
   * // Usage example documented above
   */
  getYear() {
    return this.get('year') || new Date().getFullYear();
  }

  /**
   * Set manufacturing year.
   * @param {number} year - Year.
   * @example
   * // Usage example documented above
   */
  setYear(year) {
    this.set('year', year);
  }

  /**
   * Get license plate.
   * @returns {string} License plate number.
   * @example
   * // Usage example documented above
   */
  getLicensePlate() {
    return this.get('licensePlate') || '';
  }

  /**
   * Set license plate.
   * @param {string} plate - License plate number.
   * @example
   * // Usage example documented above
   */
  setLicensePlate(plate) {
    this.set('licensePlate', plate.toUpperCase());
  }

  /**
   * Get passenger capacity.
   * @returns {number} Capacity.
   * @example
   * // Usage example documented above
   */
  getCapacity() {
    return this.get('capacity') || 4;
  }

  /**
   * Set passenger capacity.
   * @param {number} capacity - Capacity.
   * @example
   * // Usage example documented above
   */
  setCapacity(capacity) {
    this.set('capacity', capacity);
  }

  /**
   * Get vehicle color.
   * @returns {string} Color.
   * @example
   * // Usage example documented above
   */
  getColor() {
    return this.get('color') || '';
  }

  /**
   * Set vehicle color.
   * @param {string} color - Color.
   * @example
   * // Usage example documented above
   */
  setColor(color) {
    this.set('color', color);
  }

  /**
   * Get vehicle images.
   * @returns {string[]} Array of image URLs.
   * @example
   * // Usage example documented above
   */
  getImages() {
    return this.get('images') || [];
  }

  /**
   * Set vehicle images.
   * @param {string[]} images - Array of image URLs.
   * @example
   * // Usage example documented above
   */
  setImages(images) {
    this.set('images', images);
  }

  /**
   * Add image to vehicle.
   * @param {string} imageUrl - Image URL.
   * @example
   * // Usage example documented above
   */
  addImage(imageUrl) {
    const images = this.getImages();
    images.push(imageUrl);
    this.setImages(images);
  }

  /**
   * Get vehicle features.
   * @returns {string[]} Array of features.
   * @example
   * // Usage example documented above
   */
  getFeatures() {
    return this.get('features') || [];
  }

  /**
   * Set vehicle features.
   * @param {string[]} features - Array of features.
   * @example
   * // Usage example documented above
   */
  setFeatures(features) {
    this.set('features', features);
  }

  /**
   * Add feature to vehicle.
   * @param {string} feature - Feature name.
   * @example
   * // Usage example documented above
   */
  addFeature(feature) {
    const features = this.getFeatures();
    features.push(feature);
    this.setFeatures(features);
  }

  /**
   * Get maintenance status.
   * @returns {string} Status (operational|maintenance|repair|out_of_service).
   * @example
   * // Usage example documented above
   */
  getMaintenanceStatus() {
    return this.get('maintenanceStatus') || 'operational';
  }

  /**
   * Set maintenance status.
   * @param {string} status - Status.
   * @example
   * // Usage example documented above
   */
  setMaintenanceStatus(status) {
    const validStatuses = ['operational', 'maintenance', 'repair', 'out_of_service'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid maintenance status: ${status}`);
    }
    this.set('maintenanceStatus', status);
  }

  /**
   * Get insurance expiry date.
   * @returns {Date} Insurance expiry.
   * @example
   * // Usage example documented above
   */
  getInsuranceExpiry() {
    return this.get('insuranceExpiry');
  }

  /**
   * Set insurance expiry date.
   * @param {Date} date - Expiry date.
   * @example
   * // Usage example documented above
   */
  setInsuranceExpiry(date) {
    this.set('insuranceExpiry', date);
  }

  // =================
  // BUSINESS LOGIC
  // =================

  /**
   * Check if vehicle is operational and available for bookings.
   * @returns {boolean} True if available.
   * @example
   * // Usage example documented above
   */
  isAvailable() {
    return this.isActive() && this.getMaintenanceStatus() === 'operational';
  }

  /**
   * Check if insurance is expired.
   * @returns {boolean} True if expired.
   * @example
   * // Usage example documented above
   */
  isInsuranceExpired() {
    const expiry = this.getInsuranceExpiry();
    if (!expiry) return true;
    return new Date(expiry) < new Date();
  }

  /**
   * Get display name for vehicle.
   * @returns {string} Display name (e.g., "Mercedes-Benz Clase E 2024").
   * @example
   * // Usage example documented above
   */
  getDisplayName() {
    return `${this.getBrand()} ${this.getModel()} ${this.getYear()}`;
  }

  /**
   * Validate vehicle data before save.
   * @returns {object} Validation result {valid: boolean, errors: string[]}.
   * @example
   * // Usage example documented above
   */
  validate() {
    const errors = [];

    if (!this.getVehicleType()) {
      errors.push('Vehicle type is required');
    }

    if (!this.getBrand()) {
      errors.push('Brand is required');
    }

    if (!this.getModel()) {
      errors.push('Model is required');
    }

    const year = this.getYear();
    if (year < 1990 || year > new Date().getFullYear() + 1) {
      errors.push('Year must be between 1990 and next year');
    }

    if (!this.getLicensePlate()) {
      errors.push('License plate is required');
    }

    const capacity = this.getCapacity();
    if (capacity < 1 || capacity > 100) {
      errors.push('Capacity must be between 1 and 100');
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
   * Find vehicle by license plate.
   * @param {string} licensePlate - License plate number.
   * @returns {Promise<Vehicle|undefined>} Vehicle or undefined.
   * @example
   * // Usage example documented above
   */
  static async findByLicensePlate(licensePlate) {
    try {
      const query = new Parse.Query('Vehicle');
      query.equalTo('licensePlate', licensePlate.toUpperCase());
      query.equalTo('exists', true);
      query.include('vehicleTypeId');

      const result = await query.first({ useMasterKey: true });
      return result;
    } catch (error) {
      logger.error('Error finding vehicle by license plate', {
        licensePlate,
        error: error.message,
      });
      return undefined;
    }
  }

  /**
   * Get vehicles by type.
   * @param {Parse.Object} vehicleType - VehicleType pointer.
   * @returns {Promise<Vehicle[]>} Array of vehicles.
   * @example
   * // Usage example documented above
   */
  static async getByType(vehicleType) {
    try {
      const query = BaseModel.queryActive('Vehicle');
      query.equalTo('vehicleTypeId', vehicleType);
      query.include('vehicleTypeId');
      query.ascending('brand', 'model');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting vehicles by type', {
        vehicleTypeId: vehicleType?.id,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get available vehicles (operational and active).
   * @returns {Promise<Vehicle[]>} Array of available vehicles.
   * @example
   * // Usage example documented above
   */
  static async getAvailable() {
    try {
      const query = BaseModel.queryActive('Vehicle');
      query.equalTo('maintenanceStatus', 'operational');
      query.include('vehicleTypeId');
      query.ascending('brand', 'model');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting available vehicles', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Check if license plate is unique.
   * @param {string} licensePlate - License plate to check.
   * @param {string} excludeId - Exclude this ID from check (for updates).
   * @returns {Promise<boolean>} True if unique.
   * @example
   * // Usage example documented above
   */
  static async isLicensePlateUnique(licensePlate, excludeId = null) {
    try {
      const query = new Parse.Query('Vehicle');
      query.equalTo('licensePlate', licensePlate.toUpperCase());
      query.equalTo('exists', true);

      if (excludeId) {
        query.notEqualTo('objectId', excludeId);
      }

      const count = await query.count({ useMasterKey: true });
      return count === 0;
    } catch (error) {
      logger.error('Error checking license plate uniqueness', {
        licensePlate,
        error: error.message,
      });
      return false;
    }
  }
}

// COMMENTED OUT: registerSubclass causes issues with set() + save() for fields
// The BaseModel inheritance interferes with Parse.Object field updates
// Using Parse.Object.extend('Vehicle') directly works correctly
// Parse.Object.registerSubclass('Vehicle', Vehicle);

module.exports = Vehicle;
