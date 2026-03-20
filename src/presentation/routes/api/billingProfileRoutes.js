/**
 * Billing Profile API Routes
 * Handles billing profile CRUD operations and document uploads
 * Created by Denisse Maldonado.
 */

const express = require('express');
const BillingProfileController = require('../../../application/controllers/api/BillingProfileController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();
const billingProfileController = new BillingProfileController();

// Apply authentication - supports both JWT (API) and session (dashboard)
router.use((req, res, next) => {
  // If already authenticated via session (dashboard middleware)
  if (req.user && req.user.id) {
    return next();
  }
  // Otherwise try JWT authentication
  if (jwtMiddleware && jwtMiddleware.authenticateJWT) {
    return jwtMiddleware.authenticateJWT(req, res, next);
  }
  next();
});

// GET /api/billing-profiles - List current user's billing profiles
router.get('/', (req, res) => billingProfileController.list(req, res));

// GET /api/billing-profiles/user/:userId - Get billing profiles for a specific user (admin only)
router.get('/user/:userId', (req, res) => billingProfileController.getByUser(req, res));

// GET /api/billing-profiles/:id - Get billing profile by ID
router.get('/:id', (req, res) => billingProfileController.getById(req, res));

// POST /api/billing-profiles - Create a new billing profile
router.post('/', (req, res) => billingProfileController.create(req, res));

// PUT /api/billing-profiles/:id - Update a billing profile
router.put('/:id', (req, res) => billingProfileController.update(req, res));

// DELETE /api/billing-profiles/:id - Soft delete a billing profile
router.delete('/:id', (req, res) => billingProfileController.remove(req, res));

// POST /api/billing-profiles/:id/upload-constancia - Upload constancia document
router.post('/:id/upload-constancia', (req, res) => billingProfileController.uploadConstancia(req, res));

// POST /api/billing-profiles/:id/upload-document - Upload a general document
router.post('/:id/upload-document', (req, res) => billingProfileController.uploadDocument(req, res));

// DELETE /api/billing-profiles/:id/document/:docIndex - Remove a document by index
router.delete('/:id/document/:docIndex', (req, res) => billingProfileController.removeDocument(req, res));

// GET /api/billing-profiles/:id/download-constancia - Download constancia via proxy
router.get('/:id/download-constancia', (req, res) => billingProfileController.downloadConstancia(req, res));

module.exports = router;
