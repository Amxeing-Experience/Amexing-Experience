/**
 * ProfileImageController - Handles profile image upload with optimization
 * Implements server-side image optimization for profile pictures
 * Created by Denisse Maldonado.
 */

const multer = require('multer');
const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');
const FileStorageService = require('../../services/FileStorageService');
const ImageOptimizationService = require('../../services/ImageOptimizationService');
const ServerImageOptimizationService = require('../../services/ServerImageOptimizationService');

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and AVIF are allowed.'));
    }
  },
});

class ProfileImageController {
  constructor() {
    this.fileStorageService = new FileStorageService();

    // Initialize optimization services
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
   * Upload and optimize profile image.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async uploadProfileImage(req, res) {
    try {
      // Debug logging
      logger.info('ProfileImageController.uploadProfileImage called', {
        hasUser: !!req.user,
        hasFile: !!req.file,
        headers: req.headers,
      });

      const currentUser = req.user;
      if (!currentUser) {
        logger.error('No user in request');
        return this.sendError(res, 'Authentication required', 401);
      }

      const { file } = req;
      if (!file) {
        logger.error('No file in request');
        return this.sendError(res, 'No file uploaded', 400);
      }

      // Get user ID consistently - req.user should already be a Parse User object from JWT middleware
      const userId = currentUser.id;
      const userEmail = currentUser.get('email');
      const username = currentUser.get('username');

      logger.info('Profile image upload started', {
        userId,
        userType: typeof currentUser,
        isParseObject: currentUser instanceof Parse.Object,
        fileName: file.originalname,
        fileSize: file.size,
        currentUserKeys: Object.keys(currentUser),
      });

      // Generate unique filename
      const fileExtension = file.originalname.split('.').pop().toLowerCase();
      const timestamp = Date.now();
      const uniqueFileName = `profile_${userId}_${timestamp}.${fileExtension}`;

      // Process with server optimization service
      const optimizationResult = await this.serverOptimizationService.uploadOptimizedImage(
        file.buffer,
        uniqueFileName,
        file.mimetype,
        {
          entityPath: `profiles/${userId}`,
          entityId: userId,
          userContext: {
            userId,
            email: userEmail,
            username,
          },
        }
      );

      if (!optimizationResult || !optimizationResult.originalS3Key) {
        throw new Error('Failed to upload and optimize profile image');
      }

      // Get presigned URL for the optimized image
      const presignedUrl = await this.fileStorageService.getPresignedUrl(optimizationResult.originalS3Key);

      // Update user profile with new image
      // The user from JWT middleware should already be a Parse User object
      const user = currentUser;

      logger.info('Using user object for profile update', {
        isParseObject: user instanceof Parse.Object,
        hasGetMethod: typeof user.get === 'function',
        hasSaveMethod: typeof user.save === 'function',
        className: user.className,
      });

      // Store profile image data
      user.set('profilePicture', presignedUrl);
      user.set('profilePictureS3Key', optimizationResult.originalS3Key);
      user.set('profilePictureOptimization', {
        optimizedVariants: optimizationResult.optimizedVariants,
        metadata: optimizationResult.metadata,
      });

      await user.save(null, { useMasterKey: true });

      logger.info('Profile image uploaded successfully', {
        userId,
        s3Key: optimizationResult.originalS3Key,
        optimizedFormats: optimizationResult.optimizedVariants ? Object.keys(optimizationResult.optimizedVariants) : [],
      });

      res.json({
        success: true,
        message: 'Profile image uploaded successfully',
        data: {
          url: presignedUrl,
          s3Key: optimizationResult.originalS3Key,
          optimization: optimizationResult.metadata,
        },
      });
    } catch (error) {
      logger.error('Error uploading profile image', {
        userId: req.user?.id,
        error: error.message,
        stack: error.stack,
        errorName: error.name,
        errorDetails: error,
      });

      if (error.message.includes('Invalid file type')) {
        return this.sendError(res, error.message, 400);
      }

      return this.sendError(res, error.message || 'Failed to upload profile image', 500);
    }
  }

  /**
   * Get optimized profile image URL.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getProfileImage(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const userId = req.params.userId || currentUser.id;
      const acceptHeader = req.get('accept');

      // Get user data
      const userQuery = new Parse.Query(Parse.User);
      const user = await userQuery.get(userId, { useMasterKey: true });

      const s3Key = user.get('profilePictureS3Key');
      if (!s3Key) {
        return res.json({
          success: true,
          data: {
            url: null,
            hasProfileImage: false,
          },
        });
      }

      // Get optimized image URL based on browser capabilities
      let imageData = null;
      const optimization = user.get('profilePictureOptimization');

      if (s3Key && this.imageOptimizationService?.enableOptimization && optimization) {
        // Create a mock Parse object with the required fields for optimization service
        const mockImage = {
          get: (field) => {
            if (field === 's3Key') return s3Key;
            if (field === 'optimizedVariants') return optimization.optimizedVariants;
            if (field === 'optimizationMetadata') return optimization.metadata;
            return null;
          },
        };

        imageData = await this.imageOptimizationService.getImageWithOptimalFormat(mockImage, acceptHeader);
      } else {
        // Fallback to original image
        const url = await this.fileStorageService.getPresignedUrl(s3Key);
        imageData = { url };
      }

      res.json({
        success: true,
        data: {
          url: imageData.url,
          hasProfileImage: true,
          optimization: imageData.optimizationMetadata,
        },
      });
    } catch (error) {
      logger.error('Error getting profile image', {
        userId: req.user?.id,
        error: error.message,
      });

      this.sendError(res, 'Failed to get profile image', 500);
    }
  }

  /**
   * Delete profile image.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async deleteProfileImage(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Get user data
      const userQuery = new Parse.Query(Parse.User);
      const user = await userQuery.get(currentUser.id, { useMasterKey: true });

      // Clear profile image fields
      user.unset('profilePicture');
      user.unset('profilePictureS3Key');
      user.unset('profilePictureOptimization');

      await user.save(null, { useMasterKey: true });

      logger.info('Profile image deleted', {
        userId: currentUser.id,
      });

      res.json({
        success: true,
        message: 'Profile image deleted successfully',
      });
    } catch (error) {
      logger.error('Error deleting profile image', {
        userId: req.user?.id,
        error: error.message,
      });

      this.sendError(res, 'Failed to delete profile image', 500);
    }
  }

  /**
   * Send error response.
   * @param {object} res - Express response object.
   * @param {string} message - Error message.
   * @param {number} statusCode - HTTP status code.
   * @example
   */
  sendError(res, message, statusCode = 500) {
    res.status(statusCode).json({
      success: false,
      error: message,
    });
  }

  /**
   * Get multer upload middleware.
   * @returns {object} Multer middleware.
   * @example
   */
  getUploadMiddleware() {
    return upload.single('profileImage');
  }
}

module.exports = ProfileImageController;
