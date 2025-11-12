/**
 * VehicleImageController - API controller for vehicle image management with S3 storage.
 *
 * Handles upload, listing, deletion, and ordering of vehicle images.
 * Uses FileStorageService for direct AWS SDK uploads to S3 (no Parse Server adapter).
 *
 * Migration Notes:
 * - Migrated from multer disk storage to direct S3 uploads via AWS SDK
 * - Uses FileStorageService for file operations (direct AWS SDK integration)
 * - Stores s3Key, s3Bucket, s3Region in database (not Parse.File)
 * - Maintains backwards compatibility with legacy imageFile (Parse.File) for old images
 * - Supports presigned URLs for private bucket access
 * - Includes PCI DSS security logging for all operations.
 * @author Amexing Development Team
 * @version 3.0.0 (Direct S3 Upload + Security Logging)
 * @since 1.0.0
 */

const Parse = require('parse/node');
const crypto = require('crypto');
const path = require('path');
const logger = require('../../../infrastructure/logger');
const VehicleImage = require('../../../domain/models/VehicleImage');
const FileStorageService = require('../../services/FileStorageService');

/**
 * VehicleImageController class for handling vehicle image operations with S3 storage.
 */
class VehicleImageController {
  constructor() {
    this.maxFileSize = 250 * 1024 * 1024; // 250MB
    this.allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

    // Initialize FileStorageService for S3 operations
    this.fileStorageService = new FileStorageService({
      baseFolder: 'vehicles',
      isPublic: false, // Use presigned URLs with IAM role credentials
      deletionStrategy: process.env.S3_DELETION_STRATEGY || 'move',
      presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
    });
  }

  /**
   * Upload a vehicle image to S3 via direct AWS SDK.
   * POST /api/vehicles/:id/images.
   *
   * Changes from v2:
   * - Uses direct AWS SDK S3 upload (not Parse Server adapter)
   * - Stores s3Key, s3Bucket, s3Region in database
   * - No Parse.File dependency for new uploads
   * - Includes PCI DSS security logging
   * - Uses FileStorageService for direct S3 operations.
   * @param {object} req - Express request object with file buffer from multer memory storage.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} JSON response with uploaded image details.
   * @example
   * // Upload image via multipart/form-data
   * // POST /api/vehicles/abc123/images
   * // Body: { image: <file> }
   * // Returns: { success: true, data: { id, url, isPrimary, displayOrder } }
   */
  async uploadImage(req, res) {
    try {
      const currentUser = req.user;
      const vehicleId = req.params.id;

      if (!currentUser) {
        return res.status(401).json({
          success: false,
          error: 'Autenticación requerida',
        });
      }

      // Validate file from multer memory storage
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({
          success: false,
          error: 'No se recibió ningún archivo',
        });
      }

      const { file } = req;

      // Validate file size
      if (file.size > this.maxFileSize) {
        return res.status(400).json({
          success: false,
          error: `Archivo demasiado grande. Máximo: ${this.maxFileSize / 1024 / 1024}MB`,
        });
      }

      // Validate MIME type
      if (!this.allowedMimeTypes.includes(file.mimetype)) {
        return res.status(400).json({
          success: false,
          error: 'Tipo de archivo no permitido. Solo se aceptan JPG, PNG y WEBP',
        });
      }

      // Verify vehicle exists
      const vehicle = await new Parse.Query('Vehicle').get(vehicleId, {
        useMasterKey: true,
      });

      if (!vehicle) {
        return res.status(404).json({
          success: false,
          error: 'Vehículo no encontrado',
        });
      }

      // Generate unique filename for S3
      const timestamp = Date.now();
      const randomHex = crypto.randomBytes(8).toString('hex');
      const extension = path.extname(file.originalname).toLowerCase();
      const uniqueFileName = `${vehicleId}-${timestamp}-${randomHex}${extension}`;

      // Upload directly to S3 using AWS SDK with user context for security logging
      const uploadResult = await this.fileStorageService.uploadFile(file.buffer, uniqueFileName, file.mimetype, {
        entityId: vehicleId,
        userContext: {
          userId: currentUser.id,
          email: currentUser.get('email'),
          username: currentUser.get('username'),
        },
      });

      // Validate upload was successful
      if (!uploadResult || !uploadResult.s3Key) {
        throw new Error('Failed to upload file to S3 - upload result is invalid');
      }

      // Create VehicleImage record in database
      const VehicleImageClass = Parse.Object.extend('VehicleImage');
      const vehicleImage = new VehicleImageClass();

      vehicleImage.set('vehicleId', vehicle);
      vehicleImage.set('s3Key', uploadResult.s3Key); // S3 object key
      vehicleImage.set('s3Bucket', uploadResult.bucket); // S3 bucket name
      vehicleImage.set('s3Region', uploadResult.region); // AWS region
      vehicleImage.set('fileName', file.originalname);
      vehicleImage.set('fileSize', file.size);
      vehicleImage.set('mimeType', file.mimetype);
      vehicleImage.set('uploadedBy', currentUser);
      vehicleImage.set('uploadedAt', new Date());
      vehicleImage.set('active', true);
      vehicleImage.set('exists', true);

      // Get existing count and set as primary if first
      const existingCount = await VehicleImage.getImageCount(vehicleId);
      vehicleImage.set('isPrimary', existingCount === 0);
      vehicleImage.set('displayOrder', existingCount);

      // Save image record
      await vehicleImage.save(null, { useMasterKey: true });

      // Post-upload verification: Handle race conditions for primary images
      const primaryImages = await VehicleImage.findPrimaryImages(vehicleId);

      if (primaryImages.length > 1) {
        logger.warn('Multiple primary images detected, correcting...', {
          vehicleId,
          count: primaryImages.length,
          imageIds: primaryImages.map((img) => img.id),
        });

        // Keep first (oldest) as primary, unset others
        for (let i = 1; i < primaryImages.length; i++) {
          primaryImages[i].set('isPrimary', false);
          await primaryImages[i].save(null, { useMasterKey: true });
        }

        logger.info('Primary images corrected', {
          vehicleId,
          keptPrimary: primaryImages[0].id,
          correctedCount: primaryImages.length - 1,
        });
      }

      // Recalculate display order based on creation time
      await VehicleImage.recalculateDisplayOrder(vehicleId);

      // Generate presigned URL for immediate access
      const presignedUrl = await this.fileStorageService.getPresignedUrl(uploadResult.s3Key);

      logger.info('Vehicle image uploaded to S3', {
        vehicleId,
        imageId: vehicleImage.id,
        fileName: file.originalname,
        fileSize: file.size,
        s3Key: uploadResult.s3Key,
        s3Bucket: uploadResult.bucket,
        uploadedBy: currentUser.id,
      });

      // PCI DSS 10.2.1 - Security event logging for file upload
      logger.logSecurityEvent('FILE_UPLOAD', {
        userId: currentUser.id,
        email: currentUser.get('email'),
        username: currentUser.get('username'),
        role: currentUser.get('role'),
        vehicleId,
        imageId: vehicleImage.id,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        s3Key: uploadResult.s3Key,
        s3Bucket: uploadResult.bucket,
        s3Region: uploadResult.region,
        encryption: uploadResult.encryption,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
        timestamp: new Date().toISOString(),
      });

      return res.json({
        success: true,
        data: {
          id: vehicleImage.id,
          url: presignedUrl, // S3 presigned URL
          fileName: vehicleImage.get('fileName'),
          fileSize: vehicleImage.get('fileSize'),
          isPrimary: vehicleImage.get('isPrimary'),
          displayOrder: vehicleImage.get('displayOrder'),
        },
        message: 'Imagen subida exitosamente',
      });
    } catch (error) {
      logger.error('Error uploading vehicle image to S3', {
        error: error.message,
        stack: error.stack,
        vehicleId: req.params.id,
        userId: req.user?.id,
      });

      // PCI DSS 10.2.1 - Security event logging for failed upload
      if (req.user) {
        logger.logSecurityEvent('FILE_UPLOAD_FAILED', {
          userId: req.user.id,
          email: req.user.get('email'),
          username: req.user.get('username'),
          role: req.user.get('role'),
          vehicleId: req.params.id,
          fileName: req.file?.originalname,
          fileSize: req.file?.size,
          mimeType: req.file?.mimetype,
          errorMessage: error.message,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent'),
          timestamp: new Date().toISOString(),
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Error al subir la imagen',
      });
    }
  }

  /**
   * List all images for a vehicle with S3 URLs.
   * GET /api/vehicles/:id/images.
   *
   * Changes from v1:
   * - Returns S3 presigned URLs instead of local paths
   * - Handles both S3 (imageFile) and legacy (url) fields
   * - URLs are regenerated on each request (presigned).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} JSON response with array of images.
   * @example
   * // GET /api/vehicles/abc123/images
   * // Returns: { success: true, data: [...images], count: 5 }
   */
  async listImages(req, res) {
    try {
      const vehicleId = req.params.id;

      // Verify vehicle exists
      const vehicle = await new Parse.Query('Vehicle').get(vehicleId, {
        useMasterKey: true,
      });

      if (!vehicle) {
        return res.status(404).json({
          success: false,
          error: 'Vehículo no encontrado',
        });
      }

      const images = await VehicleImage.findByVehicle(vehicleId);

      const data = await Promise.all(
        images.map(async (img) => {
          const s3Key = img.get('s3Key');
          const imageFile = img.get('imageFile'); // Legacy Parse.File support

          // Generate presigned URL from s3Key, or fallback to legacy imageFile or url
          let url = null;
          if (s3Key) {
            url = await this.fileStorageService.getPresignedUrl(s3Key);
          } else if (imageFile) {
            url = imageFile.url(); // Legacy Parse.File
          } else {
            url = img.get('url'); // Very old legacy local path
          }

          return {
            id: img.id,
            url,
            fileName: img.get('fileName'),
            fileSize: img.get('fileSize'),
            isPrimary: img.get('isPrimary'),
            displayOrder: img.get('displayOrder'),
            uploadedAt: img.get('uploadedAt'),
          };
        })
      );

      // PCI DSS 10.2.1 - Security logging for data access (READ operation)
      if (req.user) {
        logger.logDataAccess(req.user.id, 'vehicle_image', 'READ', true);

        logger.logSecurityEvent('DATA_ACCESS_LIST', {
          userId: req.user.id,
          email: req.user.get('email'),
          username: req.user.get('username'),
          role: req.user.get('role'),
          vehicleId,
          imageCount: data.length,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent'),
          timestamp: new Date().toISOString(),
        });
      }

      return res.json({
        success: true,
        data,
        count: data.length,
      });
    } catch (error) {
      logger.error('Error listing vehicle images', {
        error: error.message,
        vehicleId: req.params.id,
      });

      // PCI DSS 10.2.1 - Security logging for failed data access
      if (req.user) {
        logger.logDataAccess(req.user.id, 'vehicle_image', 'READ', false);

        logger.logSecurityEvent('DATA_ACCESS_FAILED', {
          userId: req.user.id,
          email: req.user.get('email'),
          username: req.user.get('username'),
          role: req.user.get('role'),
          vehicleId: req.params.id,
          errorMessage: error.message,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent'),
          timestamp: new Date().toISOString(),
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Error al obtener las imágenes',
      });
    }
  }

  /**
   * Soft delete a vehicle image and move file to deleted/ folder in S3.
   * DELETE /api/vehicles/:id/images/:imageId.
   *
   * Changes from v1:
   * - Moves S3 file to deleted/ folder (via FileStorageService)
   * - Maintains soft delete in database (exists=false)
   * - Files can be recovered from deleted/ folder within retention period.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} JSON response confirming deletion.
   * @example
   * // DELETE /api/vehicles/abc123/images/img456
   * // Returns: { success: true, message: 'Imagen eliminada exitosamente' }
   */
  async deleteImage(req, res) {
    try {
      const currentUser = req.user;
      const { id: vehicleId, imageId } = req.params;

      if (!currentUser) {
        return res.status(401).json({
          success: false,
          error: 'Autenticación requerida',
        });
      }

      const LocalVehicleImage = Parse.Object.extend('VehicleImage');
      const query = new Parse.Query(LocalVehicleImage);
      const image = await query.get(imageId, { useMasterKey: true });

      if (!image) {
        return res.status(404).json({
          success: false,
          error: 'Imagen no encontrada',
        });
      }

      // Check if this image is the primary image before deletion
      const wasPrimaryImage = image.get('isPrimary') === true;

      // Soft delete in database and remove primary flag
      image.set('exists', false);
      image.set('active', false);
      image.set('isPrimary', false);
      await image.save(null, { useMasterKey: true });

      // If deleted image was primary, reassign primary to another active image
      if (wasPrimaryImage) {
        // Get vehicle to update
        const LocalVehicle = Parse.Object.extend('Vehicle');
        const vehicleQuery = new Parse.Query(LocalVehicle);
        const vehicle = await vehicleQuery.get(vehicleId, { useMasterKey: true });

        // Find next available active image
        const imagesQuery = new Parse.Query(LocalVehicleImage);
        imagesQuery.equalTo('vehicleId', vehicle);
        imagesQuery.equalTo('exists', true);
        imagesQuery.equalTo('active', true);
        imagesQuery.ascending('displayOrder');
        imagesQuery.limit(1);

        const nextPrimaryImage = await imagesQuery.first({ useMasterKey: true });

        if (nextPrimaryImage) {
          // Assign new primary image
          nextPrimaryImage.set('isPrimary', true);
          await nextPrimaryImage.save(null, { useMasterKey: true });

          // Update vehicle's mainImage reference
          const mainImageUrl = nextPrimaryImage.get('imageUrl') || nextPrimaryImage.get('s3Url');
          vehicle.set('mainImage', mainImageUrl);
          await vehicle.save(null, { useMasterKey: true });

          logger.info('Primary image reassigned to next available image', {
            vehicleId,
            oldImageId: imageId,
            newImageId: nextPrimaryImage.id,
          });
        } else {
          // No more images, clear vehicle's mainImage
          vehicle.unset('mainImage');
          await vehicle.save(null, { useMasterKey: true });

          logger.info('No more images available, cleared vehicle mainImage', {
            vehicleId,
          });
        }
      }

      // Move file in S3 to deleted/ folder
      // Support both imageFile (legacy Parse.File) and s3Key (new direct upload)
      const imageFile = image.get('imageFile');
      const s3Key = image.get('s3Key');

      if (imageFile || s3Key) {
        try {
          // If imageFile exists (legacy), use it; otherwise use s3Key (new uploads)
          if (imageFile) {
            await this.fileStorageService.deleteFile(imageFile, {
              deletedBy: currentUser.id,
              reason: 'User deleted via API',
            });
          } else {
            // For new S3 uploads, create a mock Parse.File-like object
            const mockParseFile = {
              name: () => s3Key,
              url: () => null, // Not needed for deletion
            };
            await this.fileStorageService.deleteFile(mockParseFile, {
              deletedBy: currentUser.id,
              reason: 'User deleted via API',
            });
          }

          logger.info('Vehicle image file moved to deleted folder', {
            vehicleId,
            imageId,
            s3Key: imageFile ? imageFile.name() : s3Key,
            deletedBy: currentUser.id,
            method: imageFile ? 'imageFile (legacy)' : 's3Key (direct)',
          });
        } catch (s3Error) {
          // Log but don't fail the operation if S3 move fails
          logger.error('Error moving S3 file to deleted folder (non-critical)', {
            vehicleId,
            imageId,
            s3Key: imageFile ? imageFile.name() : s3Key,
            error: s3Error.message,
          });
        }
      }

      logger.info('Vehicle image soft deleted', {
        vehicleId,
        imageId,
        deletedBy: currentUser.id,
      });

      // PCI DSS 10.2.1 - Security logging for file deletion
      logger.logDataAccess(currentUser.id, 'vehicle_image', 'DELETE', true);

      logger.logSecurityEvent('FILE_DELETE', {
        userId: currentUser.id,
        email: currentUser.get('email'),
        username: currentUser.get('username'),
        role: currentUser.get('role'),
        vehicleId,
        imageId,
        fileName: image.get('fileName'),
        s3Key: image.get('s3Key') || imageFile?.name(),
        deletionStrategy: this.fileStorageService.deletionStrategy,
        reason: 'User deleted via API',
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
        timestamp: new Date().toISOString(),
      });

      return res.json({
        success: true,
        message: 'Imagen eliminada exitosamente',
      });
    } catch (error) {
      logger.error('Error deleting vehicle image', {
        error: error.message,
        imageId: req.params.imageId,
        userId: req.user?.id,
      });

      // PCI DSS 10.2.1 - Security logging for failed deletion
      if (req.user) {
        logger.logDataAccess(req.user.id, 'vehicle_image', 'DELETE', false);

        logger.logSecurityEvent('FILE_DELETE_FAILED', {
          userId: req.user.id,
          email: req.user.get('email'),
          username: req.user.get('username'),
          role: req.user.get('role'),
          vehicleId: req.params.id,
          imageId: req.params.imageId,
          errorMessage: error.message,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent'),
          timestamp: new Date().toISOString(),
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Error al eliminar la imagen',
      });
    }
  }

  /**
   * Set an image as primary for a vehicle.
   * PATCH /api/vehicles/:id/images/:imageId/primary.
   *
   * No changes from v1 - works with both S3 and legacy images.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} JSON response confirming primary image update.
   * @example
   * // PATCH /api/vehicles/abc123/images/img456/primary
   * // Returns: { success: true, message: 'Imagen principal actualizada exitosamente' }
   */
  async setPrimary(req, res) {
    try {
      const currentUser = req.user;
      const { id: vehicleId, imageId } = req.params;

      if (!currentUser) {
        return res.status(401).json({
          success: false,
          error: 'Autenticación requerida',
        });
      }

      await VehicleImage.setPrimaryImage(vehicleId, imageId);

      logger.info('Vehicle primary image set', {
        vehicleId,
        imageId,
        setBy: currentUser.id,
      });

      // PCI DSS 10.2.1 - Security logging for image metadata update
      logger.logDataAccess(currentUser.id, 'vehicle_image', 'UPDATE', true);

      logger.logSecurityEvent('IMAGE_PRIMARY_SET', {
        userId: currentUser.id,
        email: currentUser.get('email'),
        username: currentUser.get('username'),
        role: currentUser.get('role'),
        vehicleId,
        imageId,
        action: 'SET_PRIMARY',
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
        timestamp: new Date().toISOString(),
      });

      return res.json({
        success: true,
        message: 'Imagen principal actualizada exitosamente',
      });
    } catch (error) {
      logger.error('Error setting primary image', {
        error: error.message,
        vehicleId: req.params.id,
        imageId: req.params.imageId,
        userId: req.user?.id,
      });

      // PCI DSS 10.2.1 - Security logging for failed update
      if (req.user) {
        logger.logDataAccess(req.user.id, 'vehicle_image', 'UPDATE', false);

        logger.logSecurityEvent('IMAGE_UPDATE_FAILED', {
          userId: req.user.id,
          email: req.user.get('email'),
          username: req.user.get('username'),
          role: req.user.get('role'),
          vehicleId: req.params.id,
          imageId: req.params.imageId,
          action: 'SET_PRIMARY',
          errorMessage: error.message,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent'),
          timestamp: new Date().toISOString(),
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Error al establecer imagen principal',
      });
    }
  }

  /**
   * Reorder vehicle images.
   * PATCH /api/vehicles/:id/images/reorder.
   *
   * No changes from v1 - works with both S3 and legacy images.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} JSON response confirming image reordering.
   * @example
   * // PATCH /api/vehicles/abc123/images/reorder
   * // Body: { imageIds: ['img1', 'img2', 'img3'] }
   * // Returns: { success: true, message: 'Orden de imágenes actualizado exitosamente' }
   */
  async reorderImages(req, res) {
    try {
      const currentUser = req.user;
      const { id: vehicleId } = req.params;
      const { imageIds } = req.body;

      if (!currentUser) {
        return res.status(401).json({
          success: false,
          error: 'Autenticación requerida',
        });
      }

      if (!Array.isArray(imageIds) || imageIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Se requiere un array de IDs de imágenes',
        });
      }

      const LocalVehicleImage = Parse.Object.extend('VehicleImage');

      // Update all images in parallel
      const updatePromises = imageIds.map(async (imageId, index) => {
        const query = new Parse.Query(LocalVehicleImage);
        const image = await query.get(imageId, { useMasterKey: true });
        image.set('displayOrder', index);
        return image.save(null, { useMasterKey: true });
      });

      await Promise.all(updatePromises);

      logger.info('Vehicle images reordered', {
        vehicleId,
        imageCount: imageIds.length,
        reorderedBy: currentUser.id,
      });

      // PCI DSS 10.2.1 - Security logging for image reordering
      logger.logDataAccess(currentUser.id, 'vehicle_image', 'UPDATE', true);

      logger.logSecurityEvent('IMAGE_REORDER', {
        userId: currentUser.id,
        email: currentUser.get('email'),
        username: currentUser.get('username'),
        role: currentUser.get('role'),
        vehicleId,
        imageCount: imageIds.length,
        imageIds,
        action: 'REORDER',
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
        timestamp: new Date().toISOString(),
      });

      return res.json({
        success: true,
        message: 'Orden de imágenes actualizado exitosamente',
      });
    } catch (error) {
      logger.error('Error reordering images', {
        error: error.message,
        vehicleId: req.params.id,
        userId: req.user?.id,
      });

      // PCI DSS 10.2.1 - Security logging for failed reorder
      if (req.user) {
        logger.logDataAccess(req.user.id, 'vehicle_image', 'UPDATE', false);

        logger.logSecurityEvent('IMAGE_UPDATE_FAILED', {
          userId: req.user.id,
          email: req.user.get('email'),
          username: req.user.get('username'),
          role: req.user.get('role'),
          vehicleId: req.params.id,
          action: 'REORDER',
          errorMessage: error.message,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent'),
          timestamp: new Date().toISOString(),
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Error al reordenar las imágenes',
      });
    }
  }
}

module.exports = VehicleImageController;
