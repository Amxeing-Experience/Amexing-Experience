/**
 * Greeter API Routes
 * RESTful endpoints for greeter services management.
 *
 * Created by Denisse Maldonado.
 * @version 1.0.0
 * @since 1.0.0
 */

const express = require('express');
const GreeterController = require('../../../application/controllers/api/GreeterController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();
const greeterController = new GreeterController();

/**
 * GET /api/greeter
 * Get all greeter services with DataTables server-side processing.
 * Access: Client level and above (includes client, department_manager, admin, superadmin).
 */
router.get(
  '/',
  jwtMiddleware.requireRoleLevel(2), // Client level and above
  (req, res) => greeterController.getGreeterServices(req, res)
);

/**
 * GET /api/greeter/:id
 * Get single greeter service by ID.
 * Access: Client level and above (includes client, department_manager, admin, superadmin).
 */
router.get(
  '/:id',
  jwtMiddleware.requireRoleLevel(2), // Client level and above
  (req, res) => greeterController.getGreeterService(req, res)
);

/**
 * POST /api/greeter
 * Create new greeter service.
 * Access: Admin, SuperAdmin.
 */
router.post(
  '/',
  jwtMiddleware.requireRoleLevel(6), // Admin or SuperAdmin
  async (req, res, _next) => {
    try {
      await greeterController.createGreeterService(req, res);
    } catch (error) {
      console.error('Error in greeter POST route:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Internal server error',
          details: error.message,
        });
      }
    }
  }
);

/**
 * PUT /api/greeter/:id
 * Update greeter service.
 * Access: Admin, SuperAdmin.
 */
router.put(
  '/:id',
  jwtMiddleware.requireRoleLevel(6), // Admin or SuperAdmin
  async (req, res, _next) => {
    try {
      await greeterController.updateGreeterService(req, res);
    } catch (error) {
      console.error('Error in greeter PUT route:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Internal server error',
          details: error.message,
        });
      }
    }
  }
);

/**
 * DELETE /api/greeter/:id
 * Soft delete greeter service.
 * Access: Admin, SuperAdmin.
 */
router.delete(
  '/:id',
  jwtMiddleware.requireRoleLevel(6), // Admin or SuperAdmin
  (req, res) => greeterController.deleteGreeterService(req, res)
);

module.exports = router;
