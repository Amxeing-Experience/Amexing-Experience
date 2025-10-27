/**
 * VehicleImageController - API controller for vehicle image management.
 *
 * Handles upload, listing, deletion, and ordering of vehicle images.
 * Uses multer for file uploads to /public/uploads/vehicles/{vehicleId}/.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-01-15
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');
const VehicleImage = require('../../../domain/models/VehicleImage');

/**
 * VehicleImageController class for handling vehicle image operations.
 */
class VehicleImageController {
  constructor() {
    this.uploadDir = path.join(process.cwd(), 'public', 'uploads', 'vehicles');
    this.maxFileSize = 250 * 1024 * 1024; // 250MB
    this.allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

    // Configure multer for image uploads
    this.upload = multer({
      storage: multer.diskStorage({
        destination: async (req, file, cb) => {
          const vehicleId = req.params.id;
          // Sanitize vehicleId to prevent path traversal
          const sanitizedId = vehicleId.replace(/[^a-zA-Z0-9]/g, '');
          const vehicleDir = path.join(this.uploadDir, sanitizedId);

          try {
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            await fs.mkdir(vehicleDir, { recursive: true });
            cb(null, vehicleDir);
          } catch (error) {
            cb(error);
          }
        },
        filename: (req, file, cb) => {
          // Generate secure random filename
          const uniqueSuffix = crypto.randomBytes(16).toString('hex');
          const ext = path.extname(file.originalname).toLowerCase();
          cb(null, `${Date.now()}-${uniqueSuffix}${ext}`);
        },
      }),
      limits: {
        fileSize: this.maxFileSize,
        files: 10, // Maximum 10 files at once
      },
      fileFilter: (req, file, cb) => {
        // Validate file type
        if (this.allowedMimeTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('Tipo de archivo no permitido. Solo se aceptan JPG, PNG y WEBP'));
        }
      },
    });
  }

  /**
   * Upload a vehicle image.
   * POST /api/vehicles/:id/images.
   * @param {object} req - Express request object.
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
      const { file } = req;

      if (!currentUser) {
        return res.status(401).json({
          success: false,
          error: 'Autenticación requerida',
        });
      }

      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'No se recibió ningún archivo',
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

      // Create image record in database
      const VehicleImageClass = Parse.Object.extend('VehicleImage');
      const vehicleImage = new VehicleImageClass();

      vehicleImage.set('vehicleId', vehicle);
      vehicleImage.set('url', `/uploads/vehicles/${vehicleId}/${file.filename}`);
      vehicleImage.set('fileName', file.originalname);
      vehicleImage.set('fileSize', file.size);
      vehicleImage.set('mimeType', file.mimetype);
      vehicleImage.set('uploadedBy', currentUser);
      vehicleImage.set('uploadedAt', new Date());
      vehicleImage.set('active', true);
      vehicleImage.set('exists', true);

      // Get existing count and tentatively set as primary if first
      const existingCount = await VehicleImage.getImageCount(vehicleId);
      vehicleImage.set('isPrimary', existingCount === 0);
      vehicleImage.set('displayOrder', existingCount);

      // Save image first
      await vehicleImage.save(null, { useMasterKey: true });

      // Post-upload verification and correction for race conditions
      const primaryImages = await VehicleImage.findPrimaryImages(vehicleId);

      // If multiple primary images exist, keep only the oldest
      if (primaryImages.length > 1) {
        logger.warn('Multiple primary images detected, correcting...', {
          vehicleId,
          count: primaryImages.length,
          imageIds: primaryImages.map((img) => img.id),
        });

        // Keep first (oldest by createdAt) as primary, unset others
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

      logger.info('Vehicle image uploaded', {
        vehicleId,
        imageId: vehicleImage.id,
        fileName: file.originalname,
        fileSize: file.size,
        uploadedBy: currentUser.id,
      });

      return res.json({
        success: true,
        data: {
          id: vehicleImage.id,
          url: vehicleImage.get('url'),
          isPrimary: vehicleImage.get('isPrimary'),
          displayOrder: vehicleImage.get('displayOrder'),
          fileName: vehicleImage.get('fileName'),
          fileSize: vehicleImage.get('fileSize'),
        },
        message: 'Imagen subida exitosamente',
      });
    } catch (error) {
      logger.error('Error uploading vehicle image', {
        error: error.message,
        stack: error.stack,
        vehicleId: req.params.id,
        userId: req.user?.id,
      });

      return res.status(500).json({
        success: false,
        error: 'Error al subir la imagen',
      });
    }
  }

  /**
   * List all images for a vehicle.
   * GET /api/vehicles/:id/images.
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

      const data = images.map((img) => ({
        id: img.id,
        url: img.get('url'),
        fileName: img.get('fileName'),
        fileSize: img.get('fileSize'),
        isPrimary: img.get('isPrimary'),
        displayOrder: img.get('displayOrder'),
        uploadedAt: img.get('uploadedAt'),
      }));

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

      return res.status(500).json({
        success: false,
        error: 'Error al obtener las imágenes',
      });
    }
  }

  /**
   * Soft delete a vehicle image.
   * DELETE /api/vehicles/:id/images/:imageId.
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

      // Soft delete
      image.set('exists', false);
      image.set('active', false);
      await image.save(null, { useMasterKey: true });

      logger.info('Vehicle image deleted', {
        vehicleId,
        imageId,
        deletedBy: currentUser.id,
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

      return res.status(500).json({
        success: false,
        error: 'Error al eliminar la imagen',
      });
    }
  }

  /**
   * Set an image as primary for a vehicle.
   * PATCH /api/vehicles/:id/images/:imageId/primary.
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

      return res.status(500).json({
        success: false,
        error: 'Error al establecer imagen principal',
      });
    }
  }

  /**
   * Reorder vehicle images.
   * PATCH /api/vehicles/:id/images/reorder.
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

      return res.status(500).json({
        success: false,
        error: 'Error al reordenar las imágenes',
      });
    }
  }
}

module.exports = VehicleImageController;
