/**
 * ExperienceImageController - API controller for experience image management.
 *
 * Handles upload, listing, deletion, and ordering of experience and provider images.
 * Uses multer for file uploads to /public/uploads/experiences/{experienceId}/.
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
const ExperienceImage = require('../../../domain/models/ExperienceImage');

/**
 * ExperienceImageController class for handling experience image operations.
 */
class ExperienceImageController {
  constructor() {
    this.uploadDir = path.join(process.cwd(), 'public', 'uploads', 'experiences');
    this.maxFileSize = 250 * 1024 * 1024; // 250MB
    this.allowedMimeTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
    ];

    // Configure multer for image uploads
    this.upload = multer({
      storage: multer.diskStorage({
        destination: async (req, file, cb) => {
          const experienceId = req.params.id;
          // Sanitize experienceId to prevent path traversal
          const sanitizedId = experienceId.replace(/[^a-zA-Z0-9]/g, '');
          const experienceDir = path.join(this.uploadDir, sanitizedId);

          try {
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            await fs.mkdir(experienceDir, { recursive: true });
            cb(null, experienceDir);
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
          cb(
            new Error(
              'Tipo de archivo no permitido. Solo se aceptan JPG, PNG y WEBP'
            )
          );
        }
      },
    });
  }

  /**
   * Upload an experience image.
   * POST /api/experiences/:id/images.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} JSON response with uploaded image details.
   * @example
   * // Upload image via multipart/form-data
   * // POST /api/experiences/abc123/images
   * // Body: { image: <file> }
   * // Returns: { success: true, data: { id, url, isPrimary, displayOrder } }
   */
  async uploadImage(req, res) {
    try {
      const currentUser = req.user;
      const experienceId = req.params.id;
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

      // Verify experience exists
      const experience = await new Parse.Query('Experience').get(experienceId, {
        useMasterKey: true,
      });

      if (!experience) {
        return res.status(404).json({
          success: false,
          error: 'Experiencia no encontrada',
        });
      }

      // Create image record in database
      const ExperienceImageClass = Parse.Object.extend('ExperienceImage');
      const experienceImage = new ExperienceImageClass();

      experienceImage.set('experienceId', experience);
      experienceImage.set(
        'url',
        `/uploads/experiences/${experienceId}/${file.filename}`
      );
      experienceImage.set('fileName', file.originalname);
      experienceImage.set('fileSize', file.size);
      experienceImage.set('mimeType', file.mimetype);
      experienceImage.set('uploadedBy', currentUser);
      experienceImage.set('uploadedAt', new Date());
      experienceImage.set('active', true);
      experienceImage.set('exists', true);

      // Get existing count and tentatively set as primary if first
      const existingCount = await ExperienceImage.getImageCount(experienceId);
      experienceImage.set('isPrimary', existingCount === 0);
      experienceImage.set('displayOrder', existingCount);

      // Save image first
      await experienceImage.save(null, { useMasterKey: true });

      // Post-upload verification and correction for race conditions
      const primaryImages = await ExperienceImage.findPrimaryImages(experienceId);

      // If multiple primary images exist, keep only the oldest
      if (primaryImages.length > 1) {
        logger.warn('Multiple primary images detected, correcting...', {
          experienceId,
          count: primaryImages.length,
          imageIds: primaryImages.map((img) => img.id),
        });

        // Keep first (oldest by createdAt) as primary, unset others
        for (let i = 1; i < primaryImages.length; i++) {
          primaryImages[i].set('isPrimary', false);
          await primaryImages[i].save(null, { useMasterKey: true });
        }

        logger.info('Primary images corrected', {
          experienceId,
          keptPrimary: primaryImages[0].id,
          correctedCount: primaryImages.length - 1,
        });
      }

      // Recalculate display order based on creation time
      await ExperienceImage.recalculateDisplayOrder(experienceId);

      logger.info('Experience image uploaded', {
        experienceId,
        imageId: experienceImage.id,
        fileName: file.originalname,
        fileSize: file.size,
        uploadedBy: currentUser.id,
      });

      return res.json({
        success: true,
        data: {
          id: experienceImage.id,
          url: experienceImage.get('url'),
          isPrimary: experienceImage.get('isPrimary'),
          displayOrder: experienceImage.get('displayOrder'),
          fileName: experienceImage.get('fileName'),
          fileSize: experienceImage.get('fileSize'),
        },
        message: 'Imagen subida exitosamente',
      });
    } catch (error) {
      logger.error('Error uploading experience image', {
        error: error.message,
        stack: error.stack,
        experienceId: req.params.id,
        userId: req.user?.id,
      });

      return res.status(500).json({
        success: false,
        error: 'Error al subir la imagen',
      });
    }
  }

  /**
   * List all images for an experience.
   * GET /api/experiences/:id/images.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} JSON response with array of images.
   * @example
   * // GET /api/experiences/abc123/images
   * // Returns: { success: true, data: [...images], count: 5 }
   */
  async listImages(req, res) {
    try {
      const experienceId = req.params.id;

      // Verify experience exists
      const experience = await new Parse.Query('Experience').get(experienceId, {
        useMasterKey: true,
      });

      if (!experience) {
        return res.status(404).json({
          success: false,
          error: 'Experiencia no encontrada',
        });
      }

      const images = await ExperienceImage.findByExperience(experienceId);

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
      logger.error('Error listing experience images', {
        error: error.message,
        experienceId: req.params.id,
      });

      return res.status(500).json({
        success: false,
        error: 'Error al obtener las imágenes',
      });
    }
  }

  /**
   * Soft delete an experience image.
   * DELETE /api/experiences/:id/images/:imageId.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} JSON response confirming deletion.
   * @example
   * // DELETE /api/experiences/abc123/images/img456
   * // Returns: { success: true, message: 'Imagen eliminada exitosamente' }
   */
  async deleteImage(req, res) {
    try {
      const currentUser = req.user;
      const { id: experienceId, imageId } = req.params;

      if (!currentUser) {
        return res.status(401).json({
          success: false,
          error: 'Autenticación requerida',
        });
      }

      const LocalExperienceImage = Parse.Object.extend('ExperienceImage');
      const query = new Parse.Query(LocalExperienceImage);
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

      logger.info('Experience image deleted', {
        experienceId,
        imageId,
        deletedBy: currentUser.id,
      });

      return res.json({
        success: true,
        message: 'Imagen eliminada exitosamente',
      });
    } catch (error) {
      logger.error('Error deleting experience image', {
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
   * Set an image as primary for an experience.
   * PATCH /api/experiences/:id/images/:imageId/primary.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} JSON response confirming primary image update.
   * @example
   * // PATCH /api/experiences/abc123/images/img456/primary
   * // Returns: { success: true, message: 'Imagen principal actualizada exitosamente' }
   */
  async setPrimary(req, res) {
    try {
      const currentUser = req.user;
      const { id: experienceId, imageId } = req.params;

      if (!currentUser) {
        return res.status(401).json({
          success: false,
          error: 'Autenticación requerida',
        });
      }

      await ExperienceImage.setPrimaryImage(experienceId, imageId);

      logger.info('Experience primary image set', {
        experienceId,
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
        experienceId: req.params.id,
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
   * Reorder experience images.
   * PATCH /api/experiences/:id/images/reorder.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} JSON response confirming image reordering.
   * @example
   * // PATCH /api/experiences/abc123/images/reorder
   * // Body: { imageIds: ['img1', 'img2', 'img3'] }
   * // Returns: { success: true, message: 'Orden de imágenes actualizado exitosamente' }
   */
  async reorderImages(req, res) {
    try {
      const currentUser = req.user;
      const { id: experienceId } = req.params;
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

      const LocalExperienceImage = Parse.Object.extend('ExperienceImage');

      // Update all images in parallel
      const updatePromises = imageIds.map(async (imageId, index) => {
        const query = new Parse.Query(LocalExperienceImage);
        const image = await query.get(imageId, { useMasterKey: true });
        image.set('displayOrder', index);
        return image.save(null, { useMasterKey: true });
      });

      await Promise.all(updatePromises);

      logger.info('Experience images reordered', {
        experienceId,
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
        experienceId: req.params.id,
        userId: req.user?.id,
      });

      return res.status(500).json({
        success: false,
        error: 'Error al reordenar las imágenes',
      });
    }
  }
}

module.exports = ExperienceImageController;
