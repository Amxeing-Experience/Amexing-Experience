/**
 * Experiences API Routes - RESTful endpoints for experiences and providers management.
 *
 * Provides Ajax-ready API endpoints for managing experiences catalog.
 * Read operations available to authenticated admins, write operations restricted to Admin/SuperAdmin.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE)
 * - Role-based access control
 * - DataTables server-side integration
 * - Rate limiting and security headers
 * - Type filtering (Experience vs Provider)
 * - Comprehensive error handling.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Usage
 * router.use('/experiences', experiencesRoutes);
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const ExperienceController = require('../../../application/controllers/api/ExperienceController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();

// Rate limiting for experience operations
const experienceApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Higher limit for read-heavy operations
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// More restrictive rate limiting for write operations
const writeOperationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit write operations
  message: {
    success: false,
    error: 'Too many modification requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all routes
router.use(experienceApiLimiter);

// =================
// READ ROUTES (require admin authentication)
// =================

/**
 * GET /api/experiences - Get experiences with DataTables server-side processing.
 *
 * Supports type filtering via query parameter: ?type=Experience or ?type=Provider
 * Access: Admin (level 6+)
 * Returns: Paginated list of experiences with included experiences information.
 */
router.get(
  '/',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager and above
  (req, res) => ExperienceController.getExperiences(req, res)
);

/**
 * GET /api/experiences/:id/dependencies - Check experience/provider dependencies.
 *
 * Access: Admin (level 6+)
 * Returns: List of experiences that include this experience/provider.
 * Used for validation before deactivate/delete operations.
 * NOTE: This route must be before /:id to avoid route conflicts.
 */
router.get(
  '/:id/dependencies',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager and above
  (req, res) => ExperienceController.checkDependencies(req, res)
);

/**
 * GET /api/experiences/:id - Get single experience by ID.
 *
 * Access: Admin (level 6+)
 * Returns: Experience details with included experiences array.
 */
router.get(
  '/:id',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager and above
  (req, res) => ExperienceController.getExperienceById(req, res)
);

// =================
// WRITE ROUTES (require admin/superadmin)
// =================

/**
 * POST /api/experiences - Create new experience.
 *
 * Access: Admin (level 6+)
 * Body: { name, description, type, cost, experiences? }
 * Returns: Created experience.
 */
router.post(
  '/',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => ExperienceController.createExperience(req, res)
);

/**
 * PUT /api/experiences/:id - Update experience.
 *
 * Access: Admin (level 6+)
 * Body: { name?, description?, cost?, experiences?, active? }
 * Returns: Updated experience.
 */
router.put(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => ExperienceController.updateExperience(req, res)
);

/**
 * DELETE /api/experiences/:id - Soft delete experience.
 *
 * Access: Admin (level 6+)
 * Returns: Success message.
 *
 * Note: Sets exists=false for audit trail.
 */
router.delete(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin and above
  (req, res) => ExperienceController.deleteExperience(req, res)
);

module.exports = router;
