/**
 * VehicleImage - Domain model for vehicle image management.
 *
 * Manages the image gallery for each vehicle in the fleet.
 * Supports multiple images per vehicle with primary image designation and ordering.
 *
 * Lifecycle States:
 * - active: true, exists: true = Visible in gallery
 * - active: false, exists: true = Hidden but preserved
 * - active: false, exists: false = Soft deleted (audit trail only).
 * @augments BaseModel
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2025-10-14
 * @example
 * // Create new vehicle image
 * const vehicleImage = new VehicleImage();
 * vehicleImage.setVehicle(vehiclePointer);
 * vehicleImage.setUrl('/uploads/vehicles/123/image.jpg');
 * vehicleImage.setFileName('mercedes-exterior.jpg');
 * await vehicleImage.save();
 *
 * // Query images for a vehicle
 * const images = await VehicleImage.findByVehicle('vehicleId123');
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * VehicleImage class for managing vehicle gallery images.
 * @class VehicleImage
 * @augments BaseModel
 */
class VehicleImage extends BaseModel {
  /**
   * Create a VehicleImage instance.
   * @example
   * const vehicleImage = new VehicleImage();
   */
  constructor() {
    super('VehicleImage');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get vehicle (Pointer to Vehicle).
   * @returns {Parse.Object} Vehicle pointer.
   * @example
   * const vehicle = vehicleImage.getVehicle();
   */
  getVehicle() {
    return this.get('vehicleId');
  }

  /**
   * Set vehicle.
   * @param {Parse.Object} vehicle - Vehicle pointer.
   * @example
   * vehicleImage.setVehicle(vehiclePointer);
   */
  setVehicle(vehicle) {
    this.set('vehicleId', vehicle);
  }

  /**
   * Get image URL.
   * @returns {string} Image URL path.
   * @example
   * const url = vehicleImage.getUrl(); // '/uploads/vehicles/123/image.jpg'
   */
  getUrl() {
    return this.get('url') || '';
  }

  /**
   * Set image URL.
   * @param {string} url - Image URL path.
   * @example
   * vehicleImage.setUrl('/uploads/vehicles/123/image.jpg');
   */
  setUrl(url) {
    this.set('url', url);
  }

  /**
   * Get original filename.
   * @returns {string} Original filename.
   * @example
   * const fileName = vehicleImage.getFileName(); // 'mercedes-exterior.jpg'
   */
  getFileName() {
    return this.get('fileName') || '';
  }

  /**
   * Set original filename.
   * @param {string} fileName - Original filename.
   * @example
   * vehicleImage.setFileName('mercedes-exterior.jpg');
   */
  setFileName(fileName) {
    this.set('fileName', fileName);
  }

  /**
   * Get file size in bytes.
   * @returns {number} File size.
   * @example
   * const size = vehicleImage.getFileSize(); // 524288 (512 KB)
   */
  getFileSize() {
    return this.get('fileSize') || 0;
  }

  /**
   * Set file size.
   * @param {number} fileSize - File size in bytes.
   * @example
   * vehicleImage.setFileSize(524288);
   */
  setFileSize(fileSize) {
    this.set('fileSize', fileSize);
  }

  /**
   * Get MIME type.
   * @returns {string} MIME type.
   * @example
   * const mimeType = vehicleImage.getMimeType(); // 'image/jpeg'
   */
  getMimeType() {
    return this.get('mimeType') || '';
  }

  /**
   * Set MIME type.
   * @param {string} mimeType - MIME type (image/jpeg, image/png, etc.).
   * @example
   * vehicleImage.setMimeType('image/jpeg');
   */
  setMimeType(mimeType) {
    this.set('mimeType', mimeType);
  }

  /**
   * Get display order.
   * @returns {number} Display order.
   * @example
   * const order = vehicleImage.getDisplayOrder(); // 0
   */
  getDisplayOrder() {
    return this.get('displayOrder') || 0;
  }

  /**
   * Set display order.
   * @param {number} order - Display order.
   * @example
   * vehicleImage.setDisplayOrder(0);
   */
  setDisplayOrder(order) {
    this.set('displayOrder', order);
  }

  /**
   * Check if this is the primary image.
   * @returns {boolean} True if primary image.
   * @example
   * if (vehicleImage.isPrimary()) { console.log('This is the main image'); }
   */
  isPrimary() {
    return this.get('isPrimary') || false;
  }

  /**
   * Set as primary image.
   * @param {boolean} isPrimary - Primary status.
   * @example
   * vehicleImage.setPrimary(true);
   */
  setPrimary(isPrimary) {
    this.set('isPrimary', isPrimary);
  }

  /**
   * Get uploaded by user.
   * @returns {Parse.Object} User pointer.
   * @example
   * const uploader = vehicleImage.getUploadedBy();
   */
  getUploadedBy() {
    return this.get('uploadedBy');
  }

  /**
   * Set uploaded by user.
   * @param {Parse.Object} user - User pointer.
   * @example
   * vehicleImage.setUploadedBy(currentUser);
   */
  setUploadedBy(user) {
    this.set('uploadedBy', user);
  }

  /**
   * Get uploaded date.
   * @returns {Date} Upload date.
   * @example
   * const uploadDate = vehicleImage.getUploadedAt();
   */
  getUploadedAt() {
    return this.get('uploadedAt');
  }

  /**
   * Set uploaded date.
   * @param {Date} date - Upload date.
   * @example
   * vehicleImage.setUploadedAt(new Date());
   */
  setUploadedAt(date) {
    this.set('uploadedAt', date);
  }

  // =================
  // STATIC METHODS
  // =================

  /**
   * Find all images for a vehicle.
   * @param {string} vehicleId - Vehicle ID.
   * @returns {Promise<Array<Parse.Object>>} Array of vehicle images.
   * @example
   * const images = await VehicleImage.findByVehicle('abc123');
   */
  static async findByVehicle(vehicleId) {
    try {
      const LocalVehicleImage = Parse.Object.extend('VehicleImage');
      const query = new Parse.Query(LocalVehicleImage);

      const vehicle = await new Parse.Query('Vehicle').get(vehicleId, { useMasterKey: true });
      query.equalTo('vehicleId', vehicle);
      query.equalTo('exists', true);
      query.ascending('displayOrder');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error finding images by vehicle', {
        vehicleId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Set primary image for a vehicle.
   * @param {string} vehicleId - Vehicle ID.
   * @param {string} imageId - Image ID to set as primary.
   * @returns {Promise<void>}
   * @example
   * await VehicleImage.setPrimaryImage('vehicleId123', 'imageId456');
   */
  static async setPrimaryImage(vehicleId, imageId) {
    try {
      const images = await this.findByVehicle(vehicleId);

      // Update all images in parallel
      const updatePromises = images.map((img) => {
        img.set('isPrimary', img.id === imageId);
        return img.save(null, { useMasterKey: true });
      });

      await Promise.all(updatePromises);

      logger.info('Primary image set', { vehicleId, imageId });
    } catch (error) {
      logger.error('Error setting primary image', {
        vehicleId,
        imageId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get count of images for a vehicle.
   * @param {string} vehicleId - Vehicle ID.
   * @returns {Promise<number>} Count of images.
   * @example
   * const count = await VehicleImage.getImageCount('vehicleId123');
   */
  static async getImageCount(vehicleId) {
    try {
      const LocalVehicleImage = Parse.Object.extend('VehicleImage');
      const query = new Parse.Query(LocalVehicleImage);

      const vehicle = await new Parse.Query('Vehicle').get(vehicleId, { useMasterKey: true });
      query.equalTo('vehicleId', vehicle);
      query.equalTo('exists', true);

      return await query.count({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting image count', {
        vehicleId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get primary image for a vehicle.
   * @param {string} vehicleId - Vehicle ID.
   * @returns {Promise<Parse.Object|null>} Primary image or null.
   * @example
   * const primaryImage = await VehicleImage.getPrimaryImage('vehicleId123');
   */
  static async getPrimaryImage(vehicleId) {
    try {
      const LocalVehicleImage = Parse.Object.extend('VehicleImage');
      const query = new Parse.Query(LocalVehicleImage);

      const vehicle = await new Parse.Query('Vehicle').get(vehicleId, { useMasterKey: true });
      query.equalTo('vehicleId', vehicle);
      query.equalTo('exists', true);
      query.equalTo('isPrimary', true);

      return await query.first({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting primary image', {
        vehicleId,
        error: error.message,
      });
      return null;
    }
  }
}

module.exports = VehicleImage;
