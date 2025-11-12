/**
 * ExperienceImage - Domain model for experience image management.
 *
 * Manages the image gallery for each experience and provider in the catalog.
 * Supports multiple images per experience with primary image designation and ordering.
 *
 * Lifecycle States:
 * - active: true, exists: true = Visible in gallery
 * - active: false, exists: true = Hidden but preserved
 * - active: false, exists: false = Soft deleted (audit trail only).
 * @augments BaseModel
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Create new experience image
 * const experienceImage = new ExperienceImage();
 * experienceImage.setExperience(experiencePointer);
 * experienceImage.setUrl('/uploads/experiences/123/image.jpg');
 * experienceImage.setFileName('tour-centro-historico.jpg');
 * await experienceImage.save();
 *
 * // Query images for an experience
 * const images = await ExperienceImage.findByExperience('experienceId123');
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * ExperienceImage class for managing experience gallery images.
 * @class ExperienceImage
 * @augments BaseModel
 */
class ExperienceImage extends BaseModel {
  /**
   * Create an ExperienceImage instance.
   * @example
   * const experienceImage = new ExperienceImage();
   */
  constructor() {
    super('ExperienceImage');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get experience (Pointer to Experience).
   * @returns {Parse.Object} Experience pointer.
   * @example
   * const experience = experienceImage.getExperience();
   */
  getExperience() {
    return this.get('experienceId');
  }

  /**
   * Set experience.
   * @param {Parse.Object} experience - Experience pointer.
   * @example
   * experienceImage.setExperience(experiencePointer);
   */
  setExperience(experience) {
    this.set('experienceId', experience);
  }

  /**
   * Get Parse.File (legacy support for old images).
   * @returns {Parse.File|null} Parse.File object or null.
   * @example
   * const imageFile = experienceImage.getImageFile();
   */
  getImageFile() {
    return this.get('imageFile') || null;
  }

  /**
   * Set Parse.File (legacy support).
   * @param {Parse.File} file - Parse.File object.
   * @example
   * experienceImage.setImageFile(parseFile);
   */
  setImageFile(file) {
    this.set('imageFile', file);
  }

  /**
   * Get S3 key (new S3 direct upload).
   * @returns {string} S3 key.
   * @example
   * const s3Key = experienceImage.getS3Key(); // 'experiences/exp123-timestamp.jpg'
   */
  getS3Key() {
    return this.get('s3Key') || '';
  }

  /**
   * Set S3 key.
   * @param {string} key - S3 key.
   * @example
   * experienceImage.setS3Key('experiences/exp123-timestamp.jpg');
   */
  setS3Key(key) {
    this.set('s3Key', key);
  }

  /**
   * Get S3 bucket name.
   * @returns {string} S3 bucket name.
   * @example
   * const bucket = experienceImage.getS3Bucket(); // 'amexing-bucket'
   */
  getS3Bucket() {
    return this.get('s3Bucket') || '';
  }

  /**
   * Set S3 bucket name.
   * @param {string} bucket - S3 bucket name.
   * @example
   * experienceImage.setS3Bucket('amexing-bucket');
   */
  setS3Bucket(bucket) {
    this.set('s3Bucket', bucket);
  }

  /**
   * Get S3 region.
   * @returns {string} S3 region.
   * @example
   * const region = experienceImage.getS3Region(); // 'us-east-2'
   */
  getS3Region() {
    return this.get('s3Region') || '';
  }

  /**
   * Set S3 region.
   * @param {string} region - S3 region.
   * @example
   * experienceImage.setS3Region('us-east-2');
   */
  setS3Region(region) {
    this.set('s3Region', region);
  }

  /**
   * Get image URL (presigned S3 URL or legacy local path).
   * Priority: imageFile (Parse.File) > url (legacy local path).
   * @returns {string} Image URL path or presigned URL.
   * @example
   * const url = experienceImage.getUrl(); // Presigned S3 URL or legacy path
   */
  getUrl() {
    // Priority: imageFile (Parse.File with presigned URL) > url (legacy local)
    const imageFile = this.get('imageFile');
    if (imageFile) {
      return imageFile.url(); // S3 presigned URL from Parse.File
    }
    return this.get('url') || ''; // Legacy local path
  }

  /**
   * Set image URL (legacy support).
   * @param {string} url - Image URL path.
   * @example
   * experienceImage.setUrl('/uploads/experiences/123/image.jpg');
   */
  setUrl(url) {
    this.set('url', url);
  }

  /**
   * Get original filename.
   * @returns {string} Original filename.
   * @example
   * const fileName = experienceImage.getFileName(); // 'tour-centro-historico.jpg'
   */
  getFileName() {
    return this.get('fileName') || '';
  }

  /**
   * Set original filename.
   * @param {string} fileName - Original filename.
   * @example
   * experienceImage.setFileName('tour-centro-historico.jpg');
   */
  setFileName(fileName) {
    this.set('fileName', fileName);
  }

  /**
   * Get file size in bytes.
   * @returns {number} File size.
   * @example
   * const size = experienceImage.getFileSize(); // 524288 (512 KB)
   */
  getFileSize() {
    return this.get('fileSize') || 0;
  }

  /**
   * Set file size.
   * @param {number} fileSize - File size in bytes.
   * @example
   * experienceImage.setFileSize(524288);
   */
  setFileSize(fileSize) {
    this.set('fileSize', fileSize);
  }

  /**
   * Get MIME type.
   * @returns {string} MIME type.
   * @example
   * const mimeType = experienceImage.getMimeType(); // 'image/jpeg'
   */
  getMimeType() {
    return this.get('mimeType') || '';
  }

  /**
   * Set MIME type.
   * @param {string} mimeType - MIME type (image/jpeg, image/png, etc.).
   * @example
   * experienceImage.setMimeType('image/jpeg');
   */
  setMimeType(mimeType) {
    this.set('mimeType', mimeType);
  }

  /**
   * Get display order.
   * @returns {number} Display order.
   * @example
   * const order = experienceImage.getDisplayOrder(); // 0
   */
  getDisplayOrder() {
    return this.get('displayOrder') || 0;
  }

  /**
   * Set display order.
   * @param {number} order - Display order.
   * @example
   * experienceImage.setDisplayOrder(0);
   */
  setDisplayOrder(order) {
    this.set('displayOrder', order);
  }

  /**
   * Check if this is the primary image.
   * @returns {boolean} True if primary image.
   * @example
   * if (experienceImage.isPrimary()) { console.log('This is the main image'); }
   */
  isPrimary() {
    return this.get('isPrimary') || false;
  }

  /**
   * Set as primary image.
   * @param {boolean} isPrimary - Primary status.
   * @example
   * experienceImage.setPrimary(true);
   */
  setPrimary(isPrimary) {
    this.set('isPrimary', isPrimary);
  }

  /**
   * Get uploaded by user.
   * @returns {Parse.Object} User pointer.
   * @example
   * const uploader = experienceImage.getUploadedBy();
   */
  getUploadedBy() {
    return this.get('uploadedBy');
  }

  /**
   * Set uploaded by user.
   * @param {Parse.Object} user - User pointer.
   * @example
   * experienceImage.setUploadedBy(currentUser);
   */
  setUploadedBy(user) {
    this.set('uploadedBy', user);
  }

  /**
   * Get uploaded date.
   * @returns {Date} Upload date.
   * @example
   * const uploadDate = experienceImage.getUploadedAt();
   */
  getUploadedAt() {
    return this.get('uploadedAt');
  }

  /**
   * Set uploaded date.
   * @param {Date} date - Upload date.
   * @example
   * experienceImage.setUploadedAt(new Date());
   */
  setUploadedAt(date) {
    this.set('uploadedAt', date);
  }

  // =================
  // STATIC METHODS
  // =================

  /**
   * Find all images for an experience.
   * @param {string} experienceId - Experience ID.
   * @returns {Promise<Array<Parse.Object>>} Array of experience images.
   * @example
   * const images = await ExperienceImage.findByExperience('abc123');
   */
  static async findByExperience(experienceId) {
    try {
      const LocalExperienceImage = Parse.Object.extend('ExperienceImage');
      const query = new Parse.Query(LocalExperienceImage);

      const experience = await new Parse.Query('Experience').get(experienceId, {
        useMasterKey: true,
      });
      query.equalTo('experienceId', experience);
      query.equalTo('exists', true);
      query.ascending('displayOrder');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error finding images by experience', {
        experienceId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Set primary image for an experience.
   * @param {string} experienceId - Experience ID.
   * @param {string} imageId - Image ID to set as primary.
   * @returns {Promise<void>}
   * @example
   * await ExperienceImage.setPrimaryImage('experienceId123', 'imageId456');
   */
  static async setPrimaryImage(experienceId, imageId) {
    try {
      const images = await this.findByExperience(experienceId);

      // Update all images in parallel
      const updatePromises = images.map((img) => {
        img.set('isPrimary', img.id === imageId);
        return img.save(null, { useMasterKey: true });
      });

      await Promise.all(updatePromises);

      logger.info('Primary image set', { experienceId, imageId });
    } catch (error) {
      logger.error('Error setting primary image', {
        experienceId,
        imageId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get count of images for an experience.
   * @param {string} experienceId - Experience ID.
   * @returns {Promise<number>} Count of images.
   * @example
   * const count = await ExperienceImage.getImageCount('experienceId123');
   */
  static async getImageCount(experienceId) {
    try {
      const LocalExperienceImage = Parse.Object.extend('ExperienceImage');
      const query = new Parse.Query(LocalExperienceImage);

      const experience = await new Parse.Query('Experience').get(experienceId, {
        useMasterKey: true,
      });
      query.equalTo('experienceId', experience);
      query.equalTo('exists', true);

      return await query.count({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting image count', {
        experienceId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get primary image for an experience.
   * @param {string} experienceId - Experience ID.
   * @returns {Promise<Parse.Object|null>} Primary image or null.
   * @example
   * const primaryImage = await ExperienceImage.getPrimaryImage('experienceId123');
   */
  static async getPrimaryImage(experienceId) {
    try {
      const LocalExperienceImage = Parse.Object.extend('ExperienceImage');
      const query = new Parse.Query(LocalExperienceImage);

      const experience = await new Parse.Query('Experience').get(experienceId, {
        useMasterKey: true,
      });
      query.equalTo('experienceId', experience);
      query.equalTo('exists', true);
      query.equalTo('isPrimary', true);

      return await query.first({ useMasterKey: true });
    } catch (error) {
      logger.error('Error getting primary image', {
        experienceId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Find all primary images for an experience (for race condition detection).
   * @param {string} experienceId - Experience ID.
   * @returns {Promise<Array<Parse.Object>>} Array of primary images ordered by creation time.
   * @example
   * const primaryImages = await ExperienceImage.findPrimaryImages('experienceId123');
   */
  static async findPrimaryImages(experienceId) {
    try {
      const LocalExperienceImage = Parse.Object.extend('ExperienceImage');
      const query = new Parse.Query(LocalExperienceImage);

      const experience = await new Parse.Query('Experience').get(experienceId, {
        useMasterKey: true,
      });
      query.equalTo('experienceId', experience);
      query.equalTo('exists', true);
      query.equalTo('isPrimary', true);
      query.ascending('createdAt');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error finding primary images', {
        experienceId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Recalculate display order based on creation time.
   * @param {string} experienceId - Experience ID.
   * @returns {Promise<void>}
   * @example
   * await ExperienceImage.recalculateDisplayOrder('experienceId123');
   */
  static async recalculateDisplayOrder(experienceId) {
    try {
      const images = await this.findByExperience(experienceId);

      // Sort by creation time
      images.sort((a, b) => a.get('createdAt').getTime() - b.get('createdAt').getTime());

      // Update display order based on sorted position
      const updatePromises = images.map((img, index) => {
        img.set('displayOrder', index);
        return img.save(null, { useMasterKey: true });
      });

      await Promise.all(updatePromises);

      logger.info('Display order recalculated', {
        experienceId,
        imageCount: images.length,
      });
    } catch (error) {
      logger.error('Error recalculating display order', {
        experienceId,
        error: error.message,
      });
      throw error;
    }
  }
}

module.exports = ExperienceImage;
