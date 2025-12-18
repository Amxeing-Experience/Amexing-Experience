/**
 * Billing API Routes
 * Handles billing information operations for users
 * Created by Denisse Maldonado.
 */

const express = require('express');
const BillingController = require('../../../application/controllers/api/BillingController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();
const billingController = new BillingController();

// Apply JWT authentication to all billing routes
router.use((req, res, next) => {
  if (jwtMiddleware && jwtMiddleware.authenticateJWT) {
    return jwtMiddleware.authenticateJWT(req, res, next);
  }
  next();
});

// GET /api/billing/get - Get user's billing information
router.get('/get', (req, res) => billingController.getBillingInfo(req, res));

// POST /api/billing/save - Save user's billing information
router.post('/save', (req, res) => billingController.saveBillingInfo(req, res));

// GET /api/billing/get-user/:userId - Get billing information for any user (admin access)
router.get('/get-user/:userId', (req, res) => billingController.getUserBillingInfo(req, res));

module.exports = router;
