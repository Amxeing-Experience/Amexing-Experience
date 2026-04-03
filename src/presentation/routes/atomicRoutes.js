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

// Test validation components route
router.get('/test-validation', (req, res) => {
  res.render('test-components', {
    title: 'Test Validation Components',
  });
});

// Debug validation components route
router.get('/debug-validation', (req, res) => {
  try {
    res.render('templates/auth-layout', {
      title: 'Debug Validation Components',
      headerTitle: 'Debug Validation',
      body: `
                <div class="container mt-4">
                    <h3>Testing Atomic Validation Components</h3>
                    <form>
                        <div class="row">
                            <div class="col-md-6">
                                <h5>Email Component</h5>
                                <%- include('../atoms/common/email-input', {
                                    name: 'email',
                                    id: 'debug-email',
                                    label: 'Email Test',
                                    required: true,
                                    placeholder: 'test@example.com',
                                    helpText: 'Debug email validation'
                                }) %>
                            </div>
                            <div class="col-md-6">
                                <h5>Phone Component</h5>
                                <%- include('../atoms/common/phone-input', {
                                    name: 'phone',
                                    id: 'debug-phone',
                                    label: 'Phone Test',
                                    required: false,
                                    countryCode: 'MX',
                                    placeholder: '999 123 4567',
                                    helpText: 'Debug phone validation'
                                }) %>
                            </div>
                        </div>
                        <div class="row">
                            <div class="col-md-6">
                                <h5>RFC Component</h5>
                                <%- include('../atoms/common/rfc-input', {
                                    name: 'rfc',
                                    id: 'debug-rfc',
                                    label: 'RFC Test',
                                    required: false,
                                    placeholder: 'ABCD123456ABC',
                                    helpText: 'Debug RFC validation'
                                }) %>
                            </div>
                            <div class="col-md-6">
                                <h5>URL Component</h5>
                                <%- include('../atoms/common/url-input', {
                                    name: 'website',
                                    id: 'debug-url',
                                    label: 'Website Test',
                                    required: false,
                                    placeholder: 'https://example.com',
                                    helpText: 'Debug URL validation'
                                }) %>
                            </div>
                        </div>
                    </form>
                </div>
            `,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
    });
  }
});

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
