/**
 * TourImage model for managing tour images.
 * Similar to VehicleImage but for tours.
 * Created by Denisse Maldonado.
 */

const Parse = require('parse/node');

/**
 * TourImage class representing tour images in the database.
 * @augments Parse.Object
 */
class TourImage extends Parse.Object {
  constructor() {
    super('TourImage');
  }

  /**
   * Get image count for a tour.
   * @param {string} tourId - Tour ID.
   * @returns {Promise<number>} Count of images.
   * @example
   */
  static async getImageCount(tourId) {
    const query = new Parse.Query(TourImage);
    const tourPointer = {
      __type: 'Pointer',
      className: 'Tour',
      objectId: tourId,
    };
    query.equalTo('tourId', tourPointer);
    query.equalTo('exists', true);
    query.equalTo('active', true);
    return query.count({ useMasterKey: true });
  }

  /**
   * Find primary images for a tour.
   * @param {string} tourId - Tour ID.
   * @returns {Promise<Array>} Array of primary images.
   * @example
   */
  static async findPrimaryImages(tourId) {
    const query = new Parse.Query(TourImage);
    const tourPointer = {
      __type: 'Pointer',
      className: 'Tour',
      objectId: tourId,
    };
    query.equalTo('tourId', tourPointer);
    query.equalTo('isPrimary', true);
    query.equalTo('exists', true);
    query.equalTo('active', true);
    query.ascending('createdAt');
    return query.find({ useMasterKey: true });
  }

  /**
   * Get all images for a tour.
   * @param {string} tourId - Tour ID.
   * @returns {Promise<Array>} Array of tour images.
   * @example
   */
  static async getImagesForTour(tourId) {
    const query = new Parse.Query(TourImage);
    const tourPointer = {
      __type: 'Pointer',
      className: 'Tour',
      objectId: tourId,
    };
    query.equalTo('tourId', tourPointer);
    query.equalTo('exists', true);
    query.equalTo('active', true);
    query.ascending('displayOrder');
    query.include('uploadedBy');

    const results = await query.find({ useMasterKey: true });

    return results;
  }

  /**
   * Delete image (logical deletion).
   * @param {string} imageId - Image ID to delete.
   * @returns {Promise<void>}
   * @example
   */
  static async deleteImage(imageId) {
    const query = new Parse.Query(TourImage);
    const image = await query.get(imageId, { useMasterKey: true });

    if (image) {
      image.set('exists', false);
      image.set('active', false);
      image.set('deletedAt', new Date());
      await image.save(null, { useMasterKey: true });
    }
  }

  /**
   * Set image as primary.
   * @param {string} imageId - Image ID to set as primary.
   * @param {string} tourId - Tour ID.
   * @returns {Promise<void>}
   * @example
   */
  static async setPrimary(imageId, tourId) {
    // First, unset all primary images for this tour
    const primaryImages = await TourImage.findPrimaryImages(tourId);
    for (const img of primaryImages) {
      img.set('isPrimary', false);
      await img.save(null, { useMasterKey: true });
    }

    // Set the new primary image
    const query = new Parse.Query(TourImage);
    const image = await query.get(imageId, { useMasterKey: true });
    if (image) {
      image.set('isPrimary', true);
      await image.save(null, { useMasterKey: true });
    }
  }

  /**
   * Reorder images.
   * @param {string} tourId - Tour ID.
   * @param {Array<string>} orderedImageIds - Array of image IDs in desired order.
   * @returns {Promise<void>}
   * @example
   */
  static async reorderImages(tourId, orderedImageIds) {
    for (let i = 0; i < orderedImageIds.length; i++) {
      const query = new Parse.Query(TourImage);
      const image = await query.get(orderedImageIds[i], { useMasterKey: true });
      if (image) {
        image.set('displayOrder', i);
        await image.save(null, { useMasterKey: true });
      }
    }
  }
}

// Register the subclass
Parse.Object.registerSubclass('TourImage', TourImage);

module.exports = TourImage;
