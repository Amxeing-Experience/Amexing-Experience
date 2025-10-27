/**
 * Experience Images API Routes
 * Handles image upload, listing, deletion, and ordering for experiences and providers.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-01-15
 */

const express = require('express');
const ExperienceImageController = require('../../../application/controllers/api/ExperienceImageController');
const { authenticateToken, requireRole } = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();
const controller = new ExperienceImageController();

/**
 * Upload a new image for an experience.
 * POST /api/experiences/:id/images.
 * @access public
 */
router.post(
  '/:id/images',
  authenticateToken,
  requireRole(['admin', 'superadmin']),
  (req, res, next) => {
    controller.upload.single('image')(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          error: err.message,
        });
      }
      next();
    });
  },
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

/**
 * Reorder experience images.
 * PATCH /api/experiences/:id/images/reorder.
 * @access public
 */
router.patch(
  '/:id/images/reorder',
  authenticateToken,
  requireRole(['admin', 'superadmin']),
  controller.reorderImages.bind(controller)
);

module.exports = router;
