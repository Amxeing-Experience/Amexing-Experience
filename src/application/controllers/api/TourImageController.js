/**
 * TourImageController for managing tour images.
 * Based on VehicleImageController but adapted for tours.
 * Created by Denisse Maldonado.
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');
const TourImage = require('../../../domain/models/TourImage');
const FileStorageService = require('../../services/FileStorageService');
const ImageOptimizationService = require('../../services/ImageOptimizationService');
const ServerImageOptimizationService = require('../../services/ServerImageOptimizationService');

/**
 * TourImageController - Handles tour image upload and optimization operations.
 * Provides API endpoints for managing tour images with S3 storage and multi-format optimization.
 * @class TourImageController
 * @example
 * const controller = new TourImageController();
 * controller.uploadTourImage(req, res);
 */
class TourImageController {
  constructor() {
    // Initialize services with dependency injection
    this.fileStorageService = new FileStorageService({
      baseFolder: 'tours',
      isPublic: false,
      presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
    });

    this.imageOptimizationService = new ImageOptimizationService({
      enableOptimization: process.env.ENABLE_IMAGE_OPTIMIZATION === 'true',
      formatPriority: ['avif', 'webp', 'jpeg'],
    });

    this.serverOptimizationService = new ServerImageOptimizationService({
      formats: ['avif', 'webp', 'jpeg'],
      sizes: ['thumb', 'mobile', 'desktop', 'original'],
      quality: {
        avif: parseInt(process.env.SHARP_AVIF_QUALITY) || 50,
        webp: parseInt(process.env.SHARP_WEBP_QUALITY) || 80,
        jpeg: parseInt(process.env.SHARP_JPEG_QUALITY) || 85,
      },
    });
  }

  /**
   * Upload image for a tour.
   * @param req
   * @param res
   * @example
   */
  async uploadImage(req, res) {
    try {
      const { tourId } = req.params;
      const currentUser = req.user;
      const { file } = req;

      if (!currentUser) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'No image file provided',
        });
      }

      // Verify tour exists
      const Tour = Parse.Object.extend('Tour');
      const tourQuery = new Parse.Query(Tour);
      const tour = await tourQuery.get(tourId, { useMasterKey: true });

      if (!tour) {
        return res.status(404).json({
          success: false,
          error: 'Tour not found',
        });
      }

      // Process and optimize image
      const userContext = {
        userId: currentUser.id,
        email: currentUser.get('email'),
        username: currentUser.get('username'),
      };

      const optimizationResult = await this.serverOptimizationService.uploadOptimizedImage(
        file.buffer,
        file.originalname,
        file.mimetype,
        {
          entityPath: `tours/${tourId}`,
          entityId: tourId,
          userContext,
        }
      );

      if (!optimizationResult || !optimizationResult.originalS3Key) {
        throw new Error('Failed to upload and optimize image');
      }

      // Create TourImage record
      const tourImage = new TourImage();

      tourImage.set('tourId', tour);
      tourImage.set('s3Key', optimizationResult.originalS3Key);
      tourImage.set('s3Bucket', process.env.S3_BUCKET);
      tourImage.set('s3Region', process.env.AWS_REGION);
      tourImage.set('fileName', file.originalname);
      tourImage.set('fileSize', file.size);
      tourImage.set('mimeType', file.mimetype);
      tourImage.set('uploadedBy', currentUser);
      tourImage.set('uploadedAt', new Date());
      tourImage.set('active', true);
      tourImage.set('exists', true);

      // Store optimization metadata
      tourImage.set('optimizedVariants', optimizationResult.optimizedVariants);
      tourImage.set('optimizationMetadata', optimizationResult.metadata);

      // Set as primary if first image
      const existingCount = await TourImage.getImageCount(tourId);
      tourImage.set('isPrimary', existingCount === 0);
      tourImage.set('displayOrder', existingCount);

      await tourImage.save(null, { useMasterKey: true });

      logger.info('Tour image uploaded successfully', {
        tourId,
        imageId: tourImage.id,
        userId: currentUser.id,
      });

      res.json({
        success: true,
        data: {
          id: tourImage.id,
          fileName: tourImage.get('fileName'),
          isPrimary: tourImage.get('isPrimary'),
          displayOrder: tourImage.get('displayOrder'),
          optimizationMetadata: tourImage.get('optimizationMetadata'),
        },
      });
    } catch (error) {
      logger.error('Error uploading tour image:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to upload image',
      });
    }
  }

  /**
   * Get all images for a tour.
   * @param req
   * @param res
   * @example
   */
  async getImages(req, res) {
    try {
      const { tourId } = req.params;
      const acceptHeader = req.get('accept');

      const images = await TourImage.getImagesForTour(tourId);

      // Format images with optimized URLs
      const formattedImages = await Promise.all(
        images.map(async (img) => {
          try {
            let imageData;
            const s3Key = img.get('s3Key');

            if (s3Key && this.imageOptimizationService?.enableOptimization) {
              // Get optimized image with best format
              imageData = await this.imageOptimizationService.getImageWithOptimalFormat(img, acceptHeader);
            } else {
              // Fallback to standard presigned URL
              const url = await this.fileStorageService.getPresignedUrl(s3Key);
              imageData = { url };
            }

            return {
              id: img.id,
              fileName: img.get('fileName'),
              url: imageData.url,
              isPrimary: img.get('isPrimary'),
              displayOrder: img.get('displayOrder'),
              fileSize: img.get('fileSize'),
              mimeType: img.get('mimeType'),
              uploadedAt: img.get('uploadedAt'),
              optimizationMetadata: img.get('optimizationMetadata'),
            };
          } catch (error) {
            logger.error('Error formatting tour image:', error);
            return null;
          }
        })
      );

      res.json({
        success: true,
        data: formattedImages.filter((img) => img !== null),
      });
    } catch (error) {
      logger.error('Error getting tour images:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get images',
      });
    }
  }

  /**
   * Delete a tour image.
   * @param req
   * @param res
   * @example
   */
  async deleteImage(req, res) {
    try {
      const { tourId, imageId } = req.params;
      const currentUser = req.user;

      if (!currentUser) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Verify image belongs to tour
      const query = new Parse.Query(TourImage);
      const image = await query.get(imageId, { useMasterKey: true });

      if (!image || image.get('tourId').id !== tourId) {
        return res.status(404).json({
          success: false,
          error: 'Image not found',
        });
      }

      // Logical deletion
      await TourImage.deleteImage(imageId);

      logger.info('Tour image deleted', {
        tourId,
        imageId,
        userId: currentUser.id,
      });

      res.json({
        success: true,
        message: 'Image deleted successfully',
      });
    } catch (error) {
      logger.error('Error deleting tour image:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to delete image',
      });
    }
  }

  /**
   * Set image as primary.
   * @param req
   * @param res
   * @example
   */
  async setPrimary(req, res) {
    try {
      const { tourId, imageId } = req.params;
      const currentUser = req.user;

      if (!currentUser) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      await TourImage.setPrimary(imageId, tourId);

      logger.info('Tour image set as primary', {
        tourId,
        imageId,
        userId: currentUser.id,
      });

      res.json({
        success: true,
        message: 'Image set as primary successfully',
      });
    } catch (error) {
      logger.error('Error setting primary tour image:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to set primary image',
      });
    }
  }

  /**
   * Reorder images.
   * @param req
   * @param res
   * @example
   */
  async reorderImages(req, res) {
    try {
      const { tourId } = req.params;
      const { imageIds } = req.body;
      const currentUser = req.user;

      if (!currentUser) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      if (!Array.isArray(imageIds)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid image IDs',
        });
      }

      await TourImage.reorderImages(tourId, imageIds);

      logger.info('Tour images reordered', {
        tourId,
        imageIds,
        userId: currentUser.id,
      });

      res.json({
        success: true,
        message: 'Images reordered successfully',
      });
    } catch (error) {
      logger.error('Error reordering tour images:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to reorder images',
      });
    }
  }
}

module.exports = TourImageController;
