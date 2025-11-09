/**
 * Experience Images API Routes with S3 Storage
 * Handles image upload, listing, deletion, and ordering for experiences and providers.
 *
 * Migration Notes:
 * - Uses multer memory storage (no local filesystem)
 * - Files uploaded to S3 via direct AWS SDK
 * - Maintains same API interface for backwards compatibility
 * - Includes PCI DSS security logging.
 * @author Amexing Development Team
 * @version 3.0.0 (Direct S3 Upload + Security Logging)
 * @since 2024-01-15
 */

const express = require('express');
const multer = require('multer');
const ExperienceImageController = require('../../../application/controllers/api/ExperienceImageController');
const { authenticateToken, requireRole } = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();
const controller = new ExperienceImageController();

// Configure multer for memory storage (no local files)
// Files are buffered in memory and then uploaded to S3
const upload = multer({
  storage: multer.memoryStorage(), // Store in memory, not disk
  limits: {
    fileSize: 250 * 1024 * 1024, // 250MB max file size
    files: 10, // Maximum 10 files at once
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Solo se aceptan JPG, PNG y WEBP'));
    }
  },
});

/**
 * Multer error handler middleware.
 * Converts multer errors to proper 400 responses.
 * @param err
 * @param req
 * @param res
 * @param next
 * @example
 */
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // Multer-specific errors (file size, file count, etc.)
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
  if (err) {
    // Custom fileFilter errors
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
  next();
};

/**
 * Upload a new image for an experience (S3 storage).
 * POST /api/experiences/:id/images.
 * @access admin, superadmin
 */
router.post(
  '/:id/images',
  authenticateToken,
  requireRole(['admin', 'superadmin']),
  upload.single('image'), // Use memory storage middleware
  handleMulterError, // Handle multer errors
  controller.uploadImage.bind(controller)
);

/**
 * Get all images for an experience.
 * GET /api/experiences/:id/images.
 * @access public
 */
router.get('/:id/images', authenticateToken, controller.listImages.bind(controller));

/**
 * Delete (soft delete) an experience image.
 * DELETE /api/experiences/:id/images/:imageId.
 * @access public
 */
router.delete(
  '/:id/images/:imageId',
  authenticateToken,
  requireRole(['admin', 'superadmin']),
  controller.deleteImage.bind(controller)
);

/**
 * Reorder experience images.
 * PATCH /api/experiences/:id/images/reorder.
 * @access public
 * NOTE: Must be defined BEFORE /:imageId/primary to avoid Express matching 'reorder' as :imageId
 */
router.patch(
  '/:id/images/reorder',
  authenticateToken,
  requireRole(['admin', 'superadmin']),
  controller.reorderImages.bind(controller)
);

/**
 * Set an image as the primary image for an experience.
 * PATCH /api/experiences/:id/images/:imageId/primary.
 * @access public
 */
router.patch(
  '/:id/images/:imageId/primary',
  authenticateToken,
  requireRole(['admin', 'superadmin']),
  controller.setPrimary.bind(controller)
);

module.exports = router;
