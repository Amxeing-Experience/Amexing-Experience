/**
 * Tour Images API Routes.
 * Created by Denisse Maldonado.
 */

const express = require('express');
const multer = require('multer');

const router = express.Router();
const { authenticateToken, requireRole } = require('../../../application/middleware/jwtMiddleware');
const TourImageController = require('../../../application/controllers/api/TourImageController');

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 250 * 1024 * 1024, // 250MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images only
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'), false);
    }
    cb(null, true);
  },
});

const controller = new TourImageController();

// Tour image routes
router.post(
  '/:tourId/images/upload',
  authenticateToken,
  requireRole(['superadmin', 'admin', 'department_manager', 'employee_amexing']),
  upload.single('image'),
  (req, res) => controller.uploadImage(req, res)
);

router.get('/:tourId/images', authenticateToken, (req, res) => controller.getImages(req, res));

router.delete(
  '/:tourId/images/:imageId',
  authenticateToken,
  requireRole(['superadmin', 'admin', 'department_manager']),
  (req, res) => controller.deleteImage(req, res)
);

router.put(
  '/:tourId/images/:imageId/primary',
  authenticateToken,
  requireRole(['superadmin', 'admin', 'department_manager']),
  (req, res) => controller.setPrimary(req, res)
);

router.put(
  '/:tourId/images/reorder',
  authenticateToken,
  requireRole(['superadmin', 'admin', 'department_manager']),
  (req, res) => controller.reorderImages(req, res)
);

module.exports = router;
