const express = require('express');

const router = express.Router();
const AtomicController = require('../../application/controllers/atomicController');

/**
 * Atomic Design Component Showcase Routes
 * Public routes for viewing and testing atomic design components.
 *
 * These routes provide a comprehensive component library interface for developers
 * to explore, test, and understand available components in the atomic design system.
 * All routes are public to facilitate easy access during development.
 *
 * Routes:
 * - GET /atomic - Main showcase index
 * - GET /atomic/dashboard - Dashboard components showcase
 * - GET /atomic/auth - Authentication components showcase
 * - GET /atomic/common - Common/shared components showcase.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2.0.0
 */

// Main atomic design showcase index
router.get('/', AtomicController.index);

// Dashboard components showcase
router.get('/dashboard', AtomicController.dashboard);

// Authentication components showcase
router.get('/auth', AtomicController.auth);

// Common components showcase
router.get('/common', AtomicController.common);

// Redirect legacy paths for consistency
router.get('/components', (req, res) => {
  res.redirect(301, '/atomic');
});

router.get('/styleguide', (req, res) => {
  res.redirect(301, '/atomic');
});

module.exports = router;
