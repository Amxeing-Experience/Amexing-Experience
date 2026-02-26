/**
 * Profile Image API Routes
 * Handles profile image upload, retrieval, and deletion
 * Created by Denisse Maldonado.
 */

const express = require('express');

const router = express.Router();
const ProfileImageController = require('../../../application/controllers/api/ProfileImageController');
const { authenticateToken } = require('../../../application/middleware/jwtMiddleware');

// Initialize controller
const profileImageController = new ProfileImageController();

// Apply authentication middleware to all routes
router.use(authenticateToken);

/**
 * POST /api/profile/image
 * Upload and optimize profile image for current user.
 */
router.post(
  '/image',
  profileImageController.getUploadMiddleware(),
  profileImageController.uploadProfileImage.bind(profileImageController)
);

/**
 * GET /api/profile/image
 * Get optimized profile image URL for current user.
 */
router.get('/image', profileImageController.getProfileImage.bind(profileImageController));

/**
 * GET /api/profile/:userId/image
 * Get optimized profile image URL for specific user.
 */
router.get('/:userId/image', profileImageController.getProfileImage.bind(profileImageController));

/**
 * DELETE /api/profile/image
 * Delete profile image for current user.
 */
router.delete('/image', profileImageController.deleteProfileImage.bind(profileImageController));

module.exports = router;
