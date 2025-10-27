/**
 * Vehicle Images API Routes
 * Handles image upload, listing, deletion, and ordering for vehicles.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-01-15
 */

const express = require('express');
const VehicleImageController = require('../../../application/controllers/api/VehicleImageController');
const { authenticateToken, requireRole } = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();
const controller = new VehicleImageController();

/**
 * Upload a new image for a vehicle.
 * POST /api/vehicles/:id/images.
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
 * Get all images for a vehicle.
 * GET /api/vehicles/:id/images.
 * @access public
 */
router.get('/:id/images', authenticateToken, controller.listImages.bind(controller));

/**
 * Delete (soft delete) a vehicle image.
 * DELETE /api/vehicles/:id/images/:imageId.
 * @access public
 */
router.delete(
  '/:id/images/:imageId',
  authenticateToken,
  requireRole(['admin', 'superadmin']),
  controller.deleteImage.bind(controller)
);

/**
 * Set an image as the primary image for a vehicle.
 * PATCH /api/vehicles/:id/images/:imageId/primary.
 * @access public
 */
router.patch(
  '/:id/images/:imageId/primary',
  authenticateToken,
  requireRole(['admin', 'superadmin']),
  controller.setPrimary.bind(controller)
);

/**
 * Reorder vehicle images.
 * PATCH /api/vehicles/:id/images/reorder.
 * @access public
 */
router.patch(
  '/:id/images/reorder',
  authenticateToken,
  requireRole(['admin', 'superadmin']),
  controller.reorderImages.bind(controller)
);

module.exports = router;
